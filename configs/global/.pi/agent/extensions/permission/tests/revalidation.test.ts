import assert from "node:assert/strict";
import { test } from "node:test";

import type { PermissionRequest } from "../core.ts";
import { SessionGrants } from "../core.ts";
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
