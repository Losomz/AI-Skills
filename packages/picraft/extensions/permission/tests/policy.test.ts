import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { getPicraftScoutCacheRoot } from "../../shared/scout-cache-paths.ts";
import { canonicalize, collectPermissionRequest, normalizePathForPolicy } from "../core.ts";
import {
	buildPermissionPathPolicy,
	extractSubmittedTempFiles,
	extractTerminalPasteFiles,
} from "../policy.ts";

function fixture(): {
	base: string;
	project: string;
	outside: string;
	cleanup: () => void;
} {
	const base = mkdtempSync(join(tmpdir(), "picraft-permission-policy-"));
	const project = join(base, "project");
	const outside = join(base, "outside");
	mkdirSync(project);
	mkdirSync(outside);
	return { base, project, outside, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

function policyFor(
	item: ReturnType<typeof fixture>,
	agentName: string,
	sessionTrustedFiles: readonly string[] = [],
) {
	const agentDir = join(item.base, agentName);
	const packageDir = join(item.base, `${agentName}-package`);
	mkdirSync(agentDir);
	mkdirSync(packageDir);
	return buildPermissionPathPolicy(item.project, { agentDir, packageDir, sessionTrustedFiles });
}

function requirementKinds(request: ReturnType<typeof collectPermissionRequest>) {
	return request?.requirements.map(({ permission, access }) => ({ permission, access }));
}

test("terminal paste trusts only complete existing file payloads", () => {
	const item = fixture();
	try {
		const image = join(item.outside, `${randomUUID()} dropped image.png`);
		const sensitive = join(item.outside, ".env");
		writeFileSync(image, "image\n");
		writeFileSync(sensitive, "TOKEN=demo\n");
		const paste = (payload: string): string => `\x1b[200~${payload}\x1b[201~`;

		assert.deepEqual(extractTerminalPasteFiles(paste(image)), [canonicalize(image)]);
		assert.deepEqual(extractTerminalPasteFiles(paste(`@${image}`)), [canonicalize(image)]);
		assert.deepEqual(extractTerminalPasteFiles(paste(pathToFileURL(image).href)), [canonicalize(image)]);
		if (process.platform === "win32") {
			const normalized = normalizePathForPolicy(canonicalize(image));
			const match = normalized.match(/^([a-z]):\/(.*)$/i);
			assert.ok(match);
			assert.deepEqual(extractTerminalPasteFiles(paste(`/${match[1]}/${match[2]}`)), [canonicalize(image)]);
			assert.deepEqual(extractTerminalPasteFiles(paste(`/mnt/${match[1]}/${match[2]}`)), [canonicalize(image)]);
		}
		assert.deepEqual(extractTerminalPasteFiles(paste(`"${image}"`)), [canonicalize(image)]);
		assert.deepEqual(
			extractTerminalPasteFiles(`${paste(image)}${paste(sensitive)}`),
			[canonicalize(image), canonicalize(sensitive)],
		);
		assert.deepEqual(extractTerminalPasteFiles(paste(`"${process.execPath}" "${sensitive}"`)), []);
		assert.deepEqual(extractTerminalPasteFiles(image), []);
		assert.deepEqual(extractTerminalPasteFiles(paste(`read ${image}`)), []);
		assert.deepEqual(extractTerminalPasteFiles(paste(item.outside)), []);
		assert.deepEqual(extractTerminalPasteFiles(paste(join(item.outside, "missing.txt"))), []);
		assert.deepEqual(extractTerminalPasteFiles(`\x1b[200~${image}`), []);
	} finally {
		item.cleanup();
	}
});

test("submitted-text fallback remains limited to existing producer-named temp images", () => {
	const attachment = join(tmpdir(), `pi-clipboard-${randomUUID()}.png`);
	const arbitrary = join(tmpdir(), `${randomUUID()}.png`);
	try {
		writeFileSync(attachment, "image\n");
		writeFileSync(arbitrary, "image\n");
		assert.deepEqual(extractSubmittedTempFiles(`inspect ${attachment}`), [canonicalize(attachment)]);
		assert.deepEqual(extractSubmittedTempFiles(`inspect ${arbitrary}`), []);
		assert.deepEqual(extractTerminalPasteFiles(`\x1b[200~${arbitrary}\x1b[201~`), [canonicalize(arbitrary)]);
		assert.deepEqual(extractSubmittedTempFiles(`inspect ${attachment}.missing`), []);
	} finally {
		rmSync(attachment, { force: true });
		rmSync(arbitrary, { force: true });
	}
});

test("session-trusted files use exact approved-read policy", () => {
	const item = fixture();
	try {
		const sensitive = join(item.outside, ".env");
		writeFileSync(sensitive, "TOKEN=demo\n");
		const policy = policyFor(item, "parent", [sensitive]);
		assert.equal(
			collectPermissionRequest({ toolName: "read", input: { path: sensitive } }, item.project, policy),
			undefined,
		);
		assert.deepEqual(
			requirementKinds(
				collectPermissionRequest({ toolName: "write", input: { path: sensitive } }, item.project, policy),
			),
			[{ permission: "external_directory", access: "write" }],
		);
	} finally {
		item.cleanup();
	}
});

test("Scout cache reads are trusted for every agent policy", () => {
	const item = fixture();
	try {
		const cacheRoot = getPicraftScoutCacheRoot();
		for (const agentName of ["parent", "subagent"]) {
			const policy = policyFor(item, agentName);
			assert.equal(
				policy.trustedReadRoots?.some((root) => canonicalize(root) === canonicalize(cacheRoot)),
				true,
			);
			assert.equal(
				policy.projectRoots.some((root) => canonicalize(root) === canonicalize(cacheRoot)),
				false,
			);
			assert.equal(
				collectPermissionRequest(
					{ toolName: "read", input: { path: join(cacheRoot, "entries", "result.json") } },
					item.project,
					policy,
				),
				undefined,
			);
		}
	} finally {
		item.cleanup();
	}
});

test("Scout cache writes still require external-directory permission", () => {
	const item = fixture();
	try {
		const cacheRoot = getPicraftScoutCacheRoot();
		const request = collectPermissionRequest(
			{ toolName: "write", input: { path: join(cacheRoot, "entries", "result.json") } },
			item.project,
			policyFor(item, "parent"),
		);
		assert.deepEqual(requirementKinds(request), [{ permission: "external_directory", access: "write" }]);
	} finally {
		item.cleanup();
	}
});

test("sensitive reads inside the Scout cache still require read permission", () => {
	const item = fixture();
	try {
		const cacheRoot = getPicraftScoutCacheRoot();
		const request = collectPermissionRequest(
			{ toolName: "read", input: { path: join(cacheRoot, "entries", ".env") } },
			item.project,
			policyFor(item, "subagent"),
		);
		assert.deepEqual(requirementKinds(request), [{ permission: "read", access: "read" }]);
	} finally {
		item.cleanup();
	}
});

test("unrelated external reads still require permission", () => {
	const item = fixture();
	try {
		const request = collectPermissionRequest(
			{ toolName: "read", input: { path: join(item.outside, "unrelated.txt") } },
			item.project,
			policyFor(item, "parent"),
		);
		assert.deepEqual(requirementKinds(request), [{ permission: "external_directory", access: "read" }]);
	} finally {
		item.cleanup();
	}
});
