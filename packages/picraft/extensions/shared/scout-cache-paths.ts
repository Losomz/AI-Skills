import * as os from "node:os";
import * as path from "node:path";

export const SCOUT_CACHE_DIRECTORY_NAME = "scout";

const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9]|lpt[1-9])(?:[.].*)?$/i;

export interface ScoutCachePaths {
	root: string;
	repos: string;
	artifacts: string;
	locks: string;
	hooks: string;
}

export interface ScoutRepositoryReference {
	input: string;
	cloneUrl: string;
	scheme: "http" | "https" | "ssh" | "git";
	host: string;
	pathSegments: string[];
	repository: string;
	identity: string;
}

export class ScoutRepositoryInputError extends Error {
	readonly code: "invalid-url" | "invalid-branch";

	constructor(message: string, code: "invalid-url" | "invalid-branch") {
		super(message);
		this.name = "ScoutRepositoryInputError";
		this.code = code;
	}
}

function invalidUrl(message: string): never {
	throw new ScoutRepositoryInputError(message, "invalid-url");
}

function invalidBranch(message: string): never {
	throw new ScoutRepositoryInputError(message, "invalid-branch");
}

function assertPortablePathSegment(segment: string, label: string): void {
	if (!segment || segment === "." || segment === "..") invalidUrl(`${label} is empty or traverses directories`);
	if (/[\\/]/u.test(segment) || /[\u0000-\u001f\u007f]/u.test(segment)) {
		invalidUrl(`${label} contains an unsafe path character`);
	}
	if (segment.endsWith(".") || segment.endsWith(" ") || WINDOWS_DEVICE_NAME.test(segment)) {
		invalidUrl(`${label} is not portable across supported filesystems`);
	}
}

function decodeRepositoryPath(rawPath: string): string[] {
	let value = rawPath;
	if (!value) invalidUrl("Repository URL must include a repository path");
	if (value.startsWith("/")) value = value.slice(1);
	if (value.endsWith("/")) value = value.slice(0, -1);
	if (!value) invalidUrl("Repository URL must include a repository path");

	const rawSegments = value.split("/");
	if (rawSegments.some((segment) => segment.length === 0)) {
		invalidUrl("Repository URL contains an empty path segment");
	}

	return rawSegments.map((rawSegment) => {
		if (/[\u0000-\u001f\u007f]/u.test(rawSegment)) invalidUrl("Repository URL contains a control character");
		let segment: string;
		try {
			segment = decodeURIComponent(rawSegment);
		} catch {
			invalidUrl("Repository URL contains malformed percent encoding");
		}
		if (segment.includes("?") || segment.includes("#")) {
			invalidUrl("Repository URL contains a query or fragment");
		}
		assertPortablePathSegment(segment, "Repository path segment");
		return segment;
	});
}

function normalizeRepositorySegments(segments: string[]): { pathSegments: string[]; repository: string } {
	if (segments.length === 0) invalidUrl("Repository URL must include a repository path");
	const pathSegments = [...segments];
	let repository = pathSegments[pathSegments.length - 1];
	if (repository.toLowerCase().endsWith(".git")) {
		repository = repository.slice(0, -4);
		assertPortablePathSegment(repository, "Repository name");
		pathSegments[pathSegments.length - 1] = repository;
	}
	return { pathSegments, repository };
}

function makeReference(
	input: string,
	scheme: ScoutRepositoryReference["scheme"],
	host: string,
	rawPath: string,
): ScoutRepositoryReference {
	if (!host) invalidUrl("Repository URL must include a host");
	const lowerHost = host.toLowerCase();
	assertPortablePathSegment(lowerHost, "Repository host");
	const normalized = normalizeRepositorySegments(decodeRepositoryPath(rawPath));
	return {
		input,
		cloneUrl: input,
		scheme,
		host: lowerHost,
		pathSegments: normalized.pathSegments,
		repository: normalized.repository,
		identity: `${lowerHost}/${normalized.pathSegments.join("/")}`,
	};
}

function parseExplicitUrl(input: string): ScoutRepositoryReference {
	if (input.includes("\\")) invalidUrl("Repository URL contains a backslash");
	if (input.includes("?") || input.includes("#")) invalidUrl("Repository URL must not contain a query or fragment");

	const schemeMatch = /^([a-z][a-z0-9+.-]*):\/\//iu.exec(input);
	if (!schemeMatch) invalidUrl("Repository URL must use HTTPS, HTTP, SSH, or Git syntax");
	let url: URL;
	try {
		url = new URL(input);
	} catch {
		invalidUrl("Repository URL is not valid");
	}

	const scheme = url.protocol.slice(0, -1).toLowerCase();
	if (scheme !== "http" && scheme !== "https" && scheme !== "ssh" && scheme !== "git") {
		invalidUrl(`Repository URL scheme is not allowed: ${url.protocol}`);
	}
	if (!url.hostname) invalidUrl("Repository URL must include a host");
	if (url.search || url.hash) invalidUrl("Repository URL must not contain a query or fragment");

	let username: string;
	let password: string;
	try {
		username = decodeURIComponent(url.username);
		password = decodeURIComponent(url.password);
	} catch {
		invalidUrl("Repository URL contains malformed credentials");
	}
	if (password || (username && !(scheme === "ssh" && username === "git"))) {
		invalidUrl("Repository URL must not contain embedded credentials");
	}

	const remainder = input.slice(schemeMatch[0].length);
	const slashIndex = remainder.indexOf("/");
	const rawPath = slashIndex === -1 ? "" : remainder.slice(slashIndex);
	const host = url.port ? `${url.hostname}:${url.port}` : url.hostname;
	return makeReference(input, scheme as ScoutRepositoryReference["scheme"], host, rawPath);
}

function parseScpStyleUrl(input: string): ScoutRepositoryReference | undefined {
	const match = /^git@([^/:?#\\\s]+):(.+)$/u.exec(input);
	if (!match) return undefined;
	return makeReference(input, "ssh", match[1], match[2]);
}

export function parseScoutRepositoryUrl(value: string): ScoutRepositoryReference {
	if (typeof value !== "string") invalidUrl("Repository URL must be a string");
	const input = value.trim();
	if (!input) invalidUrl("Repository URL must not be empty");
	const cloneInput = input.toLowerCase().startsWith("git+") ? input.slice(4) : input;
	return parseScpStyleUrl(cloneInput) ?? parseExplicitUrl(cloneInput);
}

export function validateScoutBranch(value: string): string {
	if (typeof value !== "string") invalidBranch("Branch must be a string");
	if (!value || value.length > 255) invalidBranch("Branch must be between 1 and 255 characters");
	if (value.trim() !== value) invalidBranch("Branch must not have leading or trailing whitespace");
	if (value === "@" || value.toUpperCase() === "HEAD") invalidBranch(`Unsafe branch name: ${value}`);
	if (value.startsWith("-") || value.startsWith("/") || value.endsWith("/") || value.endsWith(".")) {
		invalidBranch(`Unsafe branch name: ${value}`);
	}
	if (value.includes("//") || value.includes("..") || value.includes("@{")) {
		invalidBranch(`Unsafe branch name: ${value}`);
	}
	if (/[\u0000-\u0020\u007f~^:?*\[\\]/u.test(value)) {
		invalidBranch(`Unsafe branch name: ${value}`);
	}
	if (value.split("/").some((part) => part.startsWith(".") || part.toLowerCase().endsWith(".lock"))) {
		invalidBranch(`Unsafe branch name: ${value}`);
	}
	return value;
}

export function encodeScoutPathSegment(value: string): string {
	let result = "";
	for (const byte of Buffer.from(value, "utf8")) {
		const character = String.fromCharCode(byte);
		result += /[a-z0-9._-]/.test(character) ? character : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
	}
	if (!result) throw new ScoutRepositoryInputError("Cache path contains an empty segment", "invalid-url");
	return result;
}

export function getScoutCacheRoot(homeDirectory = os.homedir()): string {
	return path.join(homeDirectory, ".cache", "picraft", SCOUT_CACHE_DIRECTORY_NAME);
}

export function getPicraftScoutCacheRoot(homeDirectory = os.homedir()): string {
	return getScoutCacheRoot(homeDirectory);
}

export function getScoutCachePaths(homeDirectory = os.homedir()): ScoutCachePaths {
	return getScoutCachePathsForRoot(getScoutCacheRoot(homeDirectory));
}

export function getScoutCachePathsForRoot(root: string): ScoutCachePaths {
	const resolvedRoot = path.resolve(root);
	return {
		root: resolvedRoot,
		repos: path.join(resolvedRoot, "repos"),
		artifacts: path.join(resolvedRoot, "artifacts"),
		locks: path.join(resolvedRoot, ".locks"),
		hooks: path.join(resolvedRoot, ".git-hooks-disabled"),
	};
}

export function getScoutRepositoryPath(
	repository: ScoutRepositoryReference | string,
	branch?: string,
	cacheRoot = getScoutCacheRoot(),
): string {
	const reference = typeof repository === "string" ? parseScoutRepositoryUrl(repository) : repository;
	const parentSegments = reference.pathSegments.slice(0, -1).map(encodeScoutPathSegment);
	const repositoryName = branch === undefined
		? encodeScoutPathSegment(reference.repository)
		: `${encodeScoutPathSegment(reference.repository)}@${encodeScoutPathSegment(validateScoutBranch(branch))}`;
	return path.join(
		getScoutCachePathsForRoot(cacheRoot).repos,
		encodeScoutPathSegment(reference.host),
		...parentSegments,
		repositoryName,
	);
}
