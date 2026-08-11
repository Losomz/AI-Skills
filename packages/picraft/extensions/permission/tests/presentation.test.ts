import assert from "node:assert/strict";
import { test } from "node:test";

import type { PermissionRequest } from "../core.ts";
import { presentPermissionRequest } from "../presentation.ts";

const cwd = "/workspace/project";
const home = "/home/alice";

function request(overrides: Partial<PermissionRequest>): PermissionRequest {
	return {
		toolName: "read",
		title: "Read file",
		detail: "/workspace/project/notes.txt",
		requirements: [],
		...overrides,
	};
}

test("presents an external read under home with compact target and scope", () => {
	const presentation = presentPermissionRequest(
		request({
			detail: "/home/alice/secrets/token.txt",
			agentName: "Explore",
			requirements: [
				{
					permission: "external_directory",
					pattern: "/home/alice/secrets/token.txt",
					alwaysPattern: "/home/alice/secrets/*",
					reason: "outside",
				},
			],
		}),
		cwd,
		home,
	);

	assert.deepEqual(presentation, {
		summary: "Read outside project",
		target: "~/secrets/token.txt",
		requester: "Explore",
		sessionScopes: [{ label: "External", scope: "~/secrets/*" }],
	});
});

test("presents a project-local sensitive environment read relative to cwd", () => {
	const presentation = presentPermissionRequest(
		request({
			detail: "/workspace/project/.env",
			requirements: [
				{
					permission: "read",
					pattern: "/workspace/project/.env",
					alwaysPattern: "/workspace/project/.env",
					reason: "sensitive",
				},
			],
		}),
		cwd,
		home,
	);

	assert.deepEqual(presentation, {
		summary: "Read sensitive file",
		target: ".env",
		requester: undefined,
		sessionScopes: [{ label: "Sensitive read", scope: ".env" }],
	});
});

test("summarizes a sensitive read outside the project as combined", () => {
	const presentation = presentPermissionRequest(
		request({
			detail: "/workspace/outside/.env.production",
			requirements: [
				{
					permission: "external_directory",
					pattern: "/workspace/outside/.env.production",
					alwaysPattern: "/workspace/outside/*",
					reason: "outside",
				},
				{
					permission: "read",
					pattern: "/workspace/outside/.env.production",
					alwaysPattern: "/workspace/outside/.env.production",
					reason: "sensitive",
				},
			],
		}),
		cwd,
		home,
	);

	assert.equal(presentation.summary, "Read sensitive file outside project");
	assert.equal(presentation.target, "../outside/.env.production");
	assert.deepEqual(presentation.sessionScopes, [
		{ label: "External", scope: "../outside/*" },
		{ label: "Sensitive read", scope: "../outside/.env.production" },
	]);
});

test("presents bash as a shell command and normalizes its paths", () => {
	const presentation = presentPermissionRequest(
		request({
			toolName: "bash",
			detail: "$ cat \\home\\alice\\project\\script.sh > \\tmp\\result.txt",
			requirements: [
				{
					permission: "external_directory",
					pattern: "/tmp/result.txt",
					alwaysPattern: "/tmp/*",
					reason: "outside",
				},
			],
		}),
		cwd,
		home,
	);

	assert.equal(presentation.summary, "Shell command");
	assert.equal(presentation.target, "$ cat ~/project/script.sh > /tmp/result.txt");
	assert.deepEqual(presentation.sessionScopes, [{ label: "External", scope: "../../tmp/*" }]);
});

test("uses human action names for external tool summaries", () => {
	const expected = [
		["edit", "Edit outside project"],
		["write", "Write outside project"],
		["ls", "List outside project"],
		["grep", "Search outside project"],
		["find", "Find outside project"],
	] as const;

	for (const [toolName, summary] of expected) {
		const presentation = presentPermissionRequest(
			request({
				toolName,
				title: "External file access",
				detail: "/workspace/outside/item.txt",
				requirements: [
					{
						permission: "external_directory",
						pattern: "/workspace/outside/item.txt",
						alwaysPattern: "/workspace/outside/*",
						reason: "outside",
					},
				],
			}),
			cwd,
			home,
		);
		assert.equal(presentation.summary, summary);
	}
});

test("does not repeat an identical session grant", () => {
	const requirement = {
		permission: "external_directory" as const,
		pattern: "/home/alice/secrets/one.txt",
		alwaysPattern: "/home/alice/secrets/*",
		reason: "outside",
	};
	const presentation = presentPermissionRequest(
		request({
			detail: "/home/alice/secrets/one.txt",
			requirements: [requirement, { ...requirement, pattern: "/home/alice/secrets/two.txt" }],
		}),
		cwd,
		home,
	);

	assert.deepEqual(presentation.sessionScopes, [{ label: "External", scope: "~/secrets/*" }]);
});

test("preserves distinct permission requirements that share a path", () => {
	const presentation = presentPermissionRequest(
		request({
			detail: "/workspace/project/.env",
			requirements: [
				{
					permission: "external_directory",
					pattern: "/workspace/project/.env",
					alwaysPattern: "/workspace/project/.env",
					reason: "outside",
				},
				{
					permission: "read",
					pattern: "/workspace/project/.env",
					alwaysPattern: "/workspace/project/.env",
					reason: "sensitive",
				},
			],
		}),
		cwd,
		home,
	);

	assert.deepEqual(presentation.sessionScopes, [
		{ label: "External", scope: ".env" },
		{ label: "Sensitive read", scope: ".env" },
	]);
});
