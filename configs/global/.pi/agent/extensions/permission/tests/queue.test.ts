import assert from "node:assert/strict";
import { test } from "node:test";

import { SessionGrants, type PermissionRequest } from "../core.ts";
import { PermissionPromptQueue } from "../queue.ts";
import type { PermissionPromptDecision } from "../presentation.ts";

const requirement = {
	permission: "external_directory" as const,
	pattern: "/workspace/outside/item.txt",
	alwaysPattern: "/workspace/outside/*",
	reason: "outside",
};
const request = {
	toolName: "read",
	title: "Read outside project",
	detail: requirement.pattern,
	requirements: [requirement],
} satisfies PermissionRequest;

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

function options(
	grants: SessionGrants,
	decide: (restrictedRequest: PermissionRequest) => Promise<PermissionPromptDecision>,
) {
	return {
		request,
		grants,
		isAborted: () => false,
		hasUI: true,
		decide,
	};
}

test("a queued duplicate is revalidated after an always decision commits", async () => {
	const queue = new PermissionPromptQueue();
	const grants = new SessionGrants();
	const firstStarted = deferred<void>();
	const firstDecision = deferred<PermissionPromptDecision>();
	const prompted: PermissionRequest[] = [];

	const first = queue.enqueue(
		options(grants, async (restrictedRequest) => {
			prompted.push(restrictedRequest);
			firstStarted.resolve();
			return firstDecision.promise;
		}),
	);
	const second = queue.enqueue(
		options(grants, async (restrictedRequest) => {
			prompted.push(restrictedRequest);
			return { kind: "always" };
		}),
	);

	await firstStarted.promise;
	assert.equal(prompted.length, 1);
	assert.equal(grants.list().length, 0);

	firstDecision.resolve({ kind: "always" });
	const firstResult = await first;
	const secondResult = await second;

	assert.deepEqual(firstResult.decision, { kind: "always" });
	assert.deepEqual(firstResult.outstanding, [requirement]);
	assert.equal(secondResult.decision, undefined);
	assert.deepEqual(secondResult.outstanding, []);
	assert.equal(prompted.length, 1);
	assert.equal(grants.allows(requirement), true);
});

test("allow once does not persist a grant", async () => {
	const queue = new PermissionPromptQueue();
	const grants = new SessionGrants();
	let promptCount = 0;
	const decide = async (_restrictedRequest: PermissionRequest): Promise<PermissionPromptDecision> => {
		promptCount += 1;
		return { kind: "once" };
	};

	const firstResult = await queue.enqueue(options(grants, decide));
	const secondResult = await queue.enqueue(options(grants, decide));

	assert.deepEqual(firstResult.decision, { kind: "once" });
	assert.deepEqual(secondResult.decision, { kind: "once" });
	assert.deepEqual(firstResult.outstanding, [requirement]);
	assert.deepEqual(secondResult.outstanding, [requirement]);
	assert.equal(promptCount, 2);
	assert.equal(grants.list().length, 0);
});

test("aborted and headless requests return rejection without invoking UI", async () => {
	const queue = new PermissionPromptQueue();
	const grants = new SessionGrants();
	let promptCount = 0;
	const decide = async (_restrictedRequest: PermissionRequest): Promise<PermissionPromptDecision> => {
		promptCount += 1;
		return { kind: "always" };
	};

	const aborted = await queue.enqueue({
		...options(grants, decide),
		isAborted: () => true,
	});
	const headless = await queue.enqueue({
		...options(grants, decide),
		hasUI: false,
	});

	assert.deepEqual(aborted.decision, { kind: "reject" });
	assert.deepEqual(headless.decision, { kind: "reject" });
	assert.equal(promptCount, 0);
	assert.equal(grants.list().length, 0);
});
