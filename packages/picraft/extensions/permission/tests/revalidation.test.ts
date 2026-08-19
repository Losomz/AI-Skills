import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { PermissionAuthority } from "../authority.ts";
import type { PermissionRequest } from "../core.ts";
import { SessionGrants } from "../core.ts";
import { loadParentGrantView, PermissionSnapshotStore } from "../forwarding.ts";
import { getOutstandingRequirements } from "../presentation.ts";

const external = {
	permission: "external_directory" as const,
	pattern: "/workspace/outside/item.txt",
	alwaysPattern: "/workspace/outside/*",
	reason: "outside",
};
const sensitive = {
	permission: "read" as const,
	pattern: "/workspace/project/.env",
	alwaysPattern: "/workspace/project/.env",
	reason: "sensitive",
};
const request = {
	toolName: "read",
	title: "Read file",
	detail: "/workspace/outside/item.txt",
	requirements: [external, sensitive],
} satisfies PermissionRequest;

test("queued revalidation returns the exact live outstanding requirements", () => {
	const grants = new SessionGrants();
	assert.deepEqual(getOutstandingRequirements(request, grants), [external, sensitive]);

	grants.add([external]);
	assert.deepEqual(getOutstandingRequirements(request, grants), [sensitive]);
});

test("a duplicate queued request skips UI after the first request grants always", () => {
	const grants = new SessionGrants();
	const firstOutstanding = getOutstandingRequirements(request, grants);
	grants.add(firstOutstanding);

	assert.deepEqual(getOutstandingRequirements(request, grants), []);
});

test("authority suppresses every read requirement for an exact trusted file", async () => {
	const authority = new PermissionAuthority();
	const root = mkdtempSync(join(tmpdir(), "picraft-user-approved-"));
	const target = join(root, ".env");
	writeFileSync(target, "TOKEN=demo\n");
	const trustedRequest = {
		toolName: "read",
		title: "Read file",
		detail: target,
		requirements: [
			{
				permission: "external_directory" as const,
				access: "read" as const,
				pattern: target,
				alwaysPattern: `${root}/*`,
				reason: "outside",
			},
			{
				permission: "read" as const,
				access: "read" as const,
				pattern: target,
				alwaysPattern: target,
				reason: "sensitive",
			},
		],
	} satisfies PermissionRequest;
	let promptCount = 0;
	try {
		authority.registerTrustedFile("session", target);
		authority.registerTrustedFile("session", join(root, "missing.txt"));
		assert.equal(authority.trustedFiles("session").length, 1);
		const result = await authority.authorize({
			sessionId: "session",
			requestId: "read-trusted-file",
			request: trustedRequest,
			isAborted: () => false,
			hasUI: true,
			decide: async () => {
				promptCount++;
				return { kind: "always" };
			},
		});
		assert.equal(result.decision, undefined);
		assert.deepEqual(result.outstanding, []);
		assert.equal(promptCount, 0);
	} finally {
		authority.clearAll();
		rmSync(root, { recursive: true, force: true });
	}
});

test("parent snapshots expose exact trusted files as approved reads", () => {
	const root = mkdtempSync(join(tmpdir(), "picraft-permission-forwarding-"));
	const authority = new PermissionAuthority();
	try {
		const store = new PermissionSnapshotStore(root);
		authority.configureSnapshotStore(store);
		authority.activateSession("parent-session");
		const dropped = join(root, "dropped.txt");
		writeFileSync(dropped, "demo\n");
		authority.registerTrustedFile("parent-session", dropped);
		const view = loadParentGrantView(root, "parent-session");
		assert.equal(view?.approvedReadFiles.length, 1);
		assert.equal(view?.revision, 2);

		assert.equal(store.publish("filtered-session", 1, [], [dropped, root, join(root, "missing.txt")]), true);
		const filteredView = loadParentGrantView(root, "filtered-session");
		assert.deepEqual(filteredView?.approvedReadFiles, view?.approvedReadFiles);
	} finally {
		authority.clearAll();
		rmSync(root, { recursive: true, force: true });
	}
});
