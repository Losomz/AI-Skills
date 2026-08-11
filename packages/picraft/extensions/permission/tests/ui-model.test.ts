import assert from "node:assert/strict";
import { test } from "node:test";

import type { PermissionRequest } from "../core.ts";
import {
	createPermissionPromptState,
	layoutPermissionOptions,
	permissionPageModel,
	presentPermissionRequest,
	reducePermissionPrompt,
	type PermissionPromptState,
} from "../presentation.ts";

const presentation = presentPermissionRequest(
	{
		toolName: "read",
		title: "Read file",
		detail: "/workspace/project/notes.txt",
		requirements: [
			{
				permission: "external_directory",
				pattern: "/workspace/project/notes.txt",
				alwaysPattern: "/workspace/project/*",
				reason: "outside",
			},
		],
		agentName: "Explore",
	} satisfies PermissionRequest,
	"/workspace/project",
	"/home/alice",
);

test("decision model renders one target path without a label", () => {
	const lines = permissionPageModel(presentation, createPermissionPromptState(), 80);
	const text = lines.map((line) => line.text);

	assert.equal(text.filter((line) => line === "notes.txt").length, 1);
	assert.equal(text.some((line) => line.startsWith("Target:")), false);
	assert.equal(text.some((line) => line.includes("Requested by Subagent")), false);
	assert.equal(text[0], "Permission required [Explore]");
});

test("Allow always is a direct reducer decision", () => {
	const state = { ...createPermissionPromptState(), selected: 1 };
	const result = reducePermissionPrompt(state, { type: "submit", agentName: "Explore" });

	assert.deepEqual(result, { decision: { kind: "always" } });
	assert.deepEqual(state, { stage: "decision", selected: 1, feedback: "" });
});

test("feedback stage is isolated from decision content and navigation", () => {
	const state: PermissionPromptState = { stage: "feedback", selected: 2, feedback: "Use the project copy" };
	const moved = reducePermissionPrompt(state, { type: "move", delta: 1 });
	const lines = permissionPageModel(presentation, state, 80);

	assert.deepEqual(moved, { state });
	assert.deepEqual(lines.map((line) => line.text), [
		"Reject permission [Explore]",
		"Tell Explore what to do differently",
		"",
		"> Use the project copy|",
	]);
	assert.equal(lines.some((line) => line.text.includes("notes.txt")), false);
	assert.equal(lines.some((line) => line.text.includes("Read outside project")), false);
});

test("narrow option layout is vertical and wide layout is horizontal", () => {
	const options = ["Allow once", "Allow always", "Reject"];

	assert.deepEqual(layoutPermissionOptions(options, 20), [["Allow once"], ["Allow always"], ["Reject"]]);
	assert.deepEqual(layoutPermissionOptions(options, 40), [options]);
});
