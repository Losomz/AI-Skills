import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmdirSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

import {
	canonicalize,
	requirementAccess,
	SessionGrants,
	type PathAccess,
	type PermissionName,
	type PermissionRequest,
	type PermissionRequirement,
} from "./core.ts";
import type { PermissionPromptDecision } from "./presentation.ts";

const FORWARDING_VERSION = 1;
const POLL_INTERVAL_MS = 200;
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_JSON_BYTES = 128 * 1024;
const HEARTBEAT_INTERVAL_MS = 2000;
const SNAPSHOT_LEASE_MS = 15_000;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;

export interface SnapshotGrant {
	permission: PermissionName;
	access: PathAccess;
	alwaysPattern: string;
}

export interface PermissionGrantSnapshot {
	version: typeof FORWARDING_VERSION;
	sessionId: string;
	revision: number;
	updatedAt: number;
	grants: SnapshotGrant[];
	trustedReadFiles: string[];
}

export interface ForwardedPermissionRequest {
	version: typeof FORWARDING_VERSION;
	id: string;
	createdAt: number;
	targetSessionId: string;
	requesterSessionId: string;
	requesterAgentName?: string;
	request: PermissionRequest;
}

interface ForwardedPermissionResponse {
	version: typeof FORWARDING_VERSION;
	requestId: string;
	responderSessionId: string;
	respondedAt: number;
	decision: { kind: "once" } | { kind: "reject"; feedback?: string };
}

interface ForwardingLocation {
	root: string;
	requests: string;
	responses: string;
	grants: string;
}

export interface ParentGrantView {
	grants: SessionGrants;
	approvedReadFiles: readonly string[];
	revision: number;
}

export interface ParentPermissionRequestOptions {
	forwardingRoot: string;
	parentSessionId: string;
	requesterSessionId: string;
	requesterAgentName?: string;
	request: PermissionRequest;
	isAborted: () => boolean;
}

export type ForwardedPermissionHandler = (
	request: Readonly<ForwardedPermissionRequest>,
) => Promise<PermissionPromptDecision>;

export function permissionForwardingRoot(agentDir: string): string {
	return join(agentDir, "sessions", "permission-forwarding");
}

export class PermissionSnapshotStore {
	private readonly forwardingRoot: string;

	constructor(forwardingRoot: string) {
		this.forwardingRoot = forwardingRoot;
	}

	publish(
		sessionId: string,
		revision: number,
		grants: readonly PermissionRequirement[],
		approvedReadFiles: readonly string[],
	): boolean {
		const location = forwardingLocation(this.forwardingRoot, sessionId);
		if (!location) return false;
		const snapshot: PermissionGrantSnapshot = {
			version: FORWARDING_VERSION,
			sessionId,
			revision,
			updatedAt: Date.now(),
			grants: grants.map((rule) => ({
				permission: rule.permission,
				access: requirementAccess(rule),
				alwaysPattern: rule.alwaysPattern,
			})),
			trustedReadFiles: Array.from(approvedReadFiles),
		};
		return writeJsonAtomic(location.grants, snapshot);
	}

	read(sessionId: string): PermissionGrantSnapshot | undefined {
		const location = forwardingLocation(this.forwardingRoot, sessionId);
		if (!location) return undefined;
		return asGrantSnapshot(readJson(location.grants), sessionId);
	}

	remove(sessionId: string): void {
		const location = forwardingLocation(this.forwardingRoot, sessionId);
		if (!location) return;
		safeDelete(location.grants);
		cleanupEmptyLocation(location);
	}
}

export function loadParentGrantView(
	forwardingRoot: string,
	parentSessionId: string,
): ParentGrantView | undefined {
	const snapshot = new PermissionSnapshotStore(forwardingRoot).read(parentSessionId);
	if (!snapshot) return undefined;
	const grants = new SessionGrants();
	grants.add(snapshot.grants.map((rule) => ({
		permission: rule.permission,
		access: rule.access,
		pattern: rule.alwaysPattern,
		alwaysPattern: rule.alwaysPattern,
		reason: "Inherited from the parent conversation",
	})));
	return {
		grants,
		approvedReadFiles: snapshot.trustedReadFiles,
		revision: snapshot.revision,
	};
}

export async function requestParentPermission(
	options: ParentPermissionRequestOptions,
): Promise<PermissionPromptDecision> {
	const location = forwardingLocation(options.forwardingRoot, options.parentSessionId);
	if (!location || !normalizeSessionId(options.requesterSessionId)) return { kind: "reject" };
	if (!new PermissionSnapshotStore(options.forwardingRoot).read(options.parentSessionId)) {
		return { kind: "reject" };
	}
	ensureDirectory(location.requests);
	ensureDirectory(location.responses);

	const id = randomUUID();
	const requestPath = join(location.requests, `${id}.json`);
	const responsePath = join(location.responses, `${id}.json`);
	const request: ForwardedPermissionRequest = {
		version: FORWARDING_VERSION,
		id,
		createdAt: Date.now(),
		targetSessionId: options.parentSessionId,
		requesterSessionId: options.requesterSessionId,
		...(options.requesterAgentName ? { requesterAgentName: options.requesterAgentName } : {}),
		request: options.request,
	};
	if (!writeJsonAtomic(requestPath, request)) return { kind: "reject" };

	const deadline = Date.now() + REQUEST_TIMEOUT_MS;
	while (Date.now() < deadline) {
		if (options.isAborted()) {
			cleanupExchange(location, requestPath, responsePath);
			return { kind: "reject" };
		}
		if (existsSync(responsePath)) {
			const response = asForwardedResponse(readJson(responsePath));
		if (!new PermissionSnapshotStore(options.forwardingRoot).read(options.parentSessionId)) {
			cleanupExchange(location, requestPath, responsePath);
			return { kind: "reject" };
		}
			cleanupExchange(location, requestPath, responsePath);
			if (
				!response ||
				response.requestId !== id ||
				response.responderSessionId !== options.parentSessionId
			) {
				return { kind: "reject" };
			}
			return response.decision;
		}
		await sleep(POLL_INTERVAL_MS);
	}

	cleanupExchange(location, requestPath, responsePath);
	return { kind: "reject" };
}

export class PermissionForwardingServer {
	private readonly forwardingRoot: string;
	private readonly onHeartbeat?: (sessionId: string) => void;
	private timer: NodeJS.Timeout | undefined;
	private sessionId: string | undefined;
	private handler: ForwardedPermissionHandler | undefined;
	private processing = false;
	private lastHeartbeat = 0;
	private generation = 0;

	constructor(
		forwardingRoot: string,
		onHeartbeat?: (sessionId: string) => void,
	) {
		this.forwardingRoot = forwardingRoot;
		this.onHeartbeat = onHeartbeat;
	}

	start(sessionId: string, handler: ForwardedPermissionHandler): void {
		if (!normalizeSessionId(sessionId)) return;
		this.stop();
		this.sessionId = sessionId;
		this.handler = handler;
		this.timer = setInterval(() => void this.processInbox(), POLL_INTERVAL_MS);
		this.heartbeat(true);
		this.timer.unref();
		void this.processInbox();
	}

	stop(): void {
		this.generation++;
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
		this.sessionId = undefined;
		this.handler = undefined;
		this.lastHeartbeat = 0;
	}

	private async processInbox(): Promise<void> {
		if (!this.sessionId || !this.handler) return;
		this.heartbeat();
		if (this.processing) return;
		const location = forwardingLocation(this.forwardingRoot, this.sessionId);
		if (!location || !existsSync(location.requests)) return;
		const sessionId = this.sessionId;
		const handler = this.handler;
		const generation = this.generation;
		this.processing = true;
		try {
			cleanupStaleFiles(location.responses);
			for (const fileName of listJsonFiles(location.requests)) {
				if (generation !== this.generation) break;
				await this.processRequest(location, fileName, sessionId, handler, generation);
			}
		} finally {
			this.processing = false;
		}
	}

	private heartbeat(force = false): void {
		if (!this.sessionId || !this.onHeartbeat) return;
		const now = Date.now();
		if (!force && now - this.lastHeartbeat < HEARTBEAT_INTERVAL_MS) return;
		this.lastHeartbeat = now;
		try {
			this.onHeartbeat(this.sessionId);
		} catch {
			// A failed heartbeat makes the snapshot expire and child access fail closed.
		}
	}

	private async processRequest(
		location: ForwardingLocation,
		fileName: string,
		sessionId: string,
		handler: ForwardedPermissionHandler,
		generation: number,
	): Promise<void> {
		if (generation !== this.generation) return;
		const requestPath = join(location.requests, fileName);
		const fileId = fileName.slice(0, -5);
		const request = asForwardedRequest(readJson(requestPath));
		if (
			!request ||
			request.id !== fileId ||
			request.targetSessionId !== sessionId ||
			Date.now() - request.createdAt > REQUEST_TIMEOUT_MS ||
			request.createdAt > Date.now() + 60_000
		) {
			safeDelete(requestPath);
			return;
		}

		const responsePath = join(location.responses, `${request.id}.json`);
		if (existsSync(responsePath)) {
			safeDelete(requestPath);
			return;
		}

		let decision: PermissionPromptDecision;
		try {
			decision = await handler(request);
		} catch {
			decision = { kind: "reject" };
		}
		if (generation !== this.generation || this.sessionId !== sessionId) return;
		const response: ForwardedPermissionResponse = {
			version: FORWARDING_VERSION,
			requestId: request.id,
			responderSessionId: sessionId,
			respondedAt: Date.now(),
			decision: decision.kind === "reject" ? decision : { kind: "once" },
		};
		ensureDirectory(location.responses);
		if (writeJsonAtomic(responsePath, response)) safeDelete(requestPath);
	}
}

function forwardingLocation(root: string, sessionId: string): ForwardingLocation | undefined {
	const normalized = normalizeSessionId(sessionId);
	if (!normalized) return undefined;
	const sessionKey = createHash("sha256").update(normalized, "utf8").digest("hex");
	const sessionRoot = join(root, "sessions", sessionKey);
	return {
		root: sessionRoot,
		requests: join(sessionRoot, "requests"),
		responses: join(sessionRoot, "responses"),
		grants: join(sessionRoot, "grants.json"),
	};
}

function normalizeSessionId(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	return normalized && normalized.length <= 512 && normalized.toLowerCase() !== "unknown"
		? normalized
		: undefined;
}

function writeJsonAtomic(filePath: string, value: unknown): boolean {
	ensureDirectory(dirname(filePath));
	const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporaryPath, JSON.stringify(value), {
			encoding: "utf8",
			flag: "wx",
			mode: FILE_MODE,
		});
		renameSync(temporaryPath, filePath);
		return true;
	} catch {
		safeDelete(temporaryPath);
		return false;
	}
}

function readJson(filePath: string): unknown {
	try {
		const size = statSync(filePath).size;
		if (size <= 0 || size > MAX_JSON_BYTES) return undefined;
		return JSON.parse(readFileSync(filePath, "utf8"));
	} catch {
		return undefined;
	}
}

function ensureDirectory(path: string): void {
	try {
		mkdirSync(path, { recursive: true, mode: DIRECTORY_MODE });
	} catch {
		// The caller fails closed when the following read or write cannot proceed.
	}
}

function safeDelete(path: string): void {
	try {
		unlinkSync(path);
	} catch {
		// Missing or locked files are handled by timeout and the next cleanup pass.
	}
}

function listJsonFiles(path: string): string[] {
	try {
		return readdirSync(path)
			.filter((name) => /^[0-9a-f-]{36}[.]json$/i.test(name))
			.sort();
	} catch {
		return [];
	}
}

function cleanupStaleFiles(path: string): void {
	try {
		const now = Date.now();
		for (const name of readdirSync(path)) {
			const filePath = join(path, name);
			if (now - statSync(filePath).mtimeMs > REQUEST_TIMEOUT_MS) safeDelete(filePath);
		}
	} catch {
		// The directory may not exist until the first forwarded request.
	}
}

function cleanupExchange(
	location: ForwardingLocation,
	requestPath: string,
	responsePath: string,
): void {
	safeDelete(requestPath);
	safeDelete(responsePath);
	cleanupEmptyLocation(location);
}

function cleanupEmptyLocation(location: ForwardingLocation): void {
	tryRemoveEmpty(location.requests);
	tryRemoveEmpty(location.responses);
	if (!existsSync(location.grants)) tryRemoveEmpty(location.root);
}

function tryRemoveEmpty(path: string): void {
	try {
		rmdirSync(path);
	} catch {
		// Non-empty and concurrently used directories remain available.
	}
}

function sleep(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function asGrantSnapshot(value: unknown, sessionId: string): PermissionGrantSnapshot | undefined {
	if (!isRecord(value)) return undefined;
	if (
		value.version !== FORWARDING_VERSION ||
		value.sessionId !== sessionId ||
		(typeof value.revision !== "number" || !Number.isSafeInteger(value.revision)) ||
		typeof value.updatedAt !== "number" ||
		Date.now() - value.updatedAt > SNAPSHOT_LEASE_MS ||
		value.updatedAt > Date.now() + 60_000 ||
		!Array.isArray(value.grants) ||
		value.grants.length > 256 ||
		!value.grants.every(isSnapshotGrant) ||
		!Array.isArray(value.trustedReadFiles) ||
		value.trustedReadFiles.length > 512 ||
		!value.trustedReadFiles.every((item) => isBoundedString(item, 32_768))
	) {
		return undefined;
	}
	return {
		...(value as unknown as PermissionGrantSnapshot),
		trustedReadFiles: validSnapshotReadFiles(value.trustedReadFiles as string[]),
	};
}

function validSnapshotReadFiles(files: readonly string[]): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	for (const file of files) {
		try {
			const path = canonicalize(file);
			if (!statSync(path).isFile()) continue;
			const key = process.platform === "win32" ? path.toLowerCase() : path;
			if (seen.has(key)) continue;
			seen.add(key);
			result.push(path);
		} catch {
			// Stale or malformed file entries are omitted without discarding valid session grants.
		}
	}
	return result;
}

function asForwardedRequest(value: unknown): ForwardedPermissionRequest | undefined {
	if (!isRecord(value)) return undefined;
	if (
		value.version !== FORWARDING_VERSION ||
		!isRequestId(value.id) ||
		typeof value.createdAt !== "number" ||
		!normalizeSessionId(value.targetSessionId) ||
		!normalizeSessionId(value.requesterSessionId) ||
		(value.requesterAgentName !== undefined && !isBoundedString(value.requesterAgentName)) ||
		!isPermissionRequest(value.request)
	) {
		return undefined;
	}
	return value as unknown as ForwardedPermissionRequest;
}

function asForwardedResponse(value: unknown): ForwardedPermissionResponse | undefined {
	if (!isRecord(value) || !isRecord(value.decision)) return undefined;
	const decision = value.decision;
	const validDecision =
		decision.kind === "once" ||
		(decision.kind === "reject" &&
			(decision.feedback === undefined || isBoundedString(decision.feedback, 4096)));
	if (
		value.version !== FORWARDING_VERSION ||
		!isRequestId(value.requestId) ||
		!normalizeSessionId(value.responderSessionId) ||
		typeof value.respondedAt !== "number" ||
		!validDecision
	) {
		return undefined;
	}
	return value as unknown as ForwardedPermissionResponse;
}

function isPermissionRequest(value: unknown): value is PermissionRequest {
	if (!isRecord(value)) return false;
	return (
		isBoundedString(value.toolName) &&
		isBoundedString(value.title, 4096) &&
		isBoundedString(value.detail, 32_768) &&
		(value.agentName === undefined || isBoundedString(value.agentName)) &&
		Array.isArray(value.requirements) &&
		value.requirements.length > 0 &&
		value.requirements.length <= 64 &&
		value.requirements.every(isPermissionRequirement)
	);
}

function isPermissionRequirement(value: unknown): value is PermissionRequirement {
	if (!isRecord(value)) return false;
	return (
		isPermissionName(value.permission) &&
		isPathAccess(value.access) &&
		isBoundedString(value.pattern, 32_768) &&
		isBoundedString(value.alwaysPattern, 32_768) &&
		isBoundedString(value.reason, 32_768)
	);
}

function isSnapshotGrant(value: unknown): value is SnapshotGrant {
	return Boolean(
		isRecord(value) &&
			isPermissionName(value.permission) &&
			isPathAccess(value.access) &&
			isBoundedString(value.alwaysPattern, 32_768),
	);
}

function isPermissionName(value: unknown): value is PermissionName {
	return value === "external_directory" || value === "read";
}

function isPathAccess(value: unknown): value is PathAccess {
	return value === "read" || value === "write" || value === "unknown";
}

function isRequestId(value: unknown): value is string {
	return typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
}

function isBoundedString(value: unknown, maximum = 4096): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= maximum;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
