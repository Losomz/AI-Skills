import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { getPicraftScoutCacheRoot } from "../../shared/scout-cache-paths.ts";
import { canonicalize, collectPermissionRequest } from "../core.ts";
import { buildPermissionPathPolicy } from "../policy.ts";

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

function policyFor(item: ReturnType<typeof fixture>, agentName: string) {
	const agentDir = join(item.base, agentName);
	const packageDir = join(item.base, `${agentName}-package`);
	mkdirSync(agentDir);
	mkdirSync(packageDir);
	return buildPermissionPathPolicy(item.project, { agentDir, packageDir });
}

function requirementKinds(request: ReturnType<typeof collectPermissionRequest>) {
	return request?.requirements.map(({ permission, access }) => ({ permission, access }));
}

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
