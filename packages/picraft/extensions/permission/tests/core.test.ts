import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import {
	canonicalize,
	collectPermissionRequest,
	extractStaticShellPaths,
	isInsideRoots,
	isSensitiveEnvPath,
	resolveToolPath,
	SessionGrants,
	wildcardMatch,
} from "../core.ts";

function fixture(): { root: string; outside: string; cleanup: () => void } {
	const base = mkdtempSync(join(tmpdir(), "picraft-permission-"));
	const root = join(base, "project");
	const outside = join(base, "outside");
	mkdirSync(root);
	mkdirSync(outside);
	writeFileSync(join(root, ".env"), "DEMO_TOKEN=not-a-secret\n");
	writeFileSync(join(root, ".env.example"), "DEMO_TOKEN=example\n");
	return { root, outside, cleanup: () => rmSync(base, { recursive: true, force: true }) };
}

test("wildcards use whole-string matching", () => {
	assert.equal(wildcardMatch("*.env", "/repo/.env", false), true);
	assert.equal(wildcardMatch("/outside/*", "/outside/nested/file.txt", false), true);
	assert.equal(wildcardMatch("*.env", "/repo/.env.example", false), false);
	assert.equal(wildcardMatch("/repo/[draft].txt", "/repo/[draft].txt", false), true);
});

test("sensitive env rules exempt .env.example", () => {
	assert.equal(isSensitiveEnvPath("/repo/.env"), true);
	assert.equal(isSensitiveEnvPath("/repo/.env.local"), true);
	assert.equal(isSensitiveEnvPath("/repo/.env.example"), false);
	assert.equal(isSensitiveEnvPath("/repo/config.env"), false);
});

test("canonical boundary checks include missing descendants", () => {
	const item = fixture();
	try {
		assert.equal(isInsideRoots(join(item.root, "new", "file.txt"), [item.root]), true);
		assert.equal(isInsideRoots(join(item.outside, "file.txt"), [item.root]), false);
		assert.equal(
			canonicalize(join(item.root, "new", "file.txt")),
			resolve(canonicalize(item.root), "new", "file.txt"),
		);
	} finally {
		item.cleanup();
	}
});

test("tool paths follow Pi's @ prefix and file URL normalization", () => {
	const item = fixture();
	try {
		const notes = join(item.root, "notes.txt");
		writeFileSync(notes, "demo\n");
		assert.equal(resolveToolPath("@notes.txt", item.root), canonicalize(notes));
		assert.equal(resolveToolPath(pathToFileURL(notes).href, item.root), canonicalize(notes));
		if (process.platform === "win32") {
			const native = canonicalize("D:/UGit/AgentFramework");
			assert.equal(resolveToolPath("/d/UGit/AgentFramework", item.root), native);
			assert.equal(resolveToolPath("/mnt/d/UGit/AgentFramework", item.root), native);
		}
	} finally {
		item.cleanup();
	}
});

test("read asks for .env but not .env.example or an env write", () => {
	const item = fixture();
	try {
		const envRead = collectPermissionRequest({ toolName: "read", input: { path: ".env" } }, item.root, [item.root]);
		assert.deepEqual(envRead?.requirements.map((item) => item.permission), ["read"]);
		assert.equal(
			collectPermissionRequest({ toolName: "read", input: { path: ".env.example" } }, item.root, [item.root]),
			undefined,
		);
		assert.equal(
			collectPermissionRequest({ toolName: "write", input: { path: ".env" } }, item.root, [item.root]),
			undefined,
		);
	} finally {
		item.cleanup();
	}
});

test("a sensitive file outside the project combines both reasons into one request", () => {
	const item = fixture();
	try {
		const path = join(item.outside, ".env.production");
		const request = collectPermissionRequest({ toolName: "read", input: { path } }, item.root, [item.root]);
		assert.deepEqual(
			request?.requirements.map((item) => item.permission),
			["external_directory", "read"],
		);
	} finally {
		item.cleanup();
	}
});

test("user-approved files bypass exact reads without granting siblings or writes", () => {
	const item = fixture();
	try {
		const dropped = join(item.outside, "dropped notes.txt");
		const sensitive = join(item.outside, ".env.production");
		const sibling = join(item.outside, "sibling.txt");
		writeFileSync(dropped, "demo\n");
		writeFileSync(sensitive, "TOKEN=demo\n");
		writeFileSync(sibling, "other\n");
		const policy = { projectRoots: [item.root], approvedReadFiles: [dropped, sensitive] };

		assert.equal(collectPermissionRequest({ toolName: "read", input: { path: dropped } }, item.root, policy), undefined);
		assert.equal(collectPermissionRequest({ toolName: "read", input: { path: sensitive } }, item.root, policy), undefined);
		assert.equal(
			collectPermissionRequest({ toolName: "bash", input: { command: `cat "${dropped}"` } }, item.root, policy),
			undefined,
		);
		assert.deepEqual(
			collectPermissionRequest({ toolName: "read", input: { path: sibling } }, item.root, policy)?.requirements.map(
				({ permission, access }) => ({ permission, access }),
			),
			[{ permission: "external_directory", access: "read" }],
		);
		assert.deepEqual(
			collectPermissionRequest({ toolName: "write", input: { path: dropped } }, item.root, policy)?.requirements.map(
				({ permission, access }) => ({ permission, access }),
			),
			[{ permission: "external_directory", access: "write" }],
		);
	} finally {
		item.cleanup();
	}
});

test("ordinary trusted reads do not bypass sensitive-file approval", () => {
	const item = fixture();
	try {
		const sensitive = join(item.outside, ".env.production");
		writeFileSync(sensitive, "TOKEN=demo\n");
		const request = collectPermissionRequest(
			{ toolName: "read", input: { path: sensitive } },
			item.root,
			{ projectRoots: [item.root], trustedReadFiles: [sensitive] },
		);
		assert.deepEqual(request?.requirements.map((requirement) => requirement.permission), ["read"]);
	} finally {
		item.cleanup();
	}
});

test("shell scanner extracts static file-command and redirection paths", () => {
	assert.deepEqual(extractStaticShellPaths("cp 'one file.txt' ../outside/ && cat /tmp/value > result.txt"), [
		"one file.txt",
		"../outside/",
		"/tmp/value",
		"result.txt",
	]);
	assert.deepEqual(extractStaticShellPaths("npm test && git status"), []);
});

test("session grants match their always pattern and can be revoked", () => {
	const grants = new SessionGrants();
	const requirement = {
		permission: "external_directory" as const,
		pattern: "/outside/one.txt",
		alwaysPattern: "/outside/*",
		reason: "outside",
	};
	grants.add([requirement]);
	assert.equal(grants.allows({ ...requirement, pattern: "/outside/nested/two.txt" }), true);
	assert.equal(grants.allows({ ...requirement, pattern: "/other/two.txt" }), false);
	assert.equal(grants.remove("external_directory", "/outside/*"), true);
	assert.equal(grants.list().length, 0);
});

test("ordinary project-local read, edit, bash, and search calls do not ask", () => {
	const item = fixture();
	try {
		writeFileSync(join(item.root, "notes.txt"), "demo\n");
		const calls = [
			{ toolName: "read", input: { path: "notes.txt" } },
			{ toolName: "edit", input: { path: "notes.txt" } },
			{ toolName: "bash", input: { command: "npm test" } },
			{ toolName: "grep", input: { pattern: "demo" } },
		];
		for (const call of calls) {
			assert.equal(collectPermissionRequest(call, item.root, [item.root]), undefined);
		}
	} finally {
		item.cleanup();
	}
});
