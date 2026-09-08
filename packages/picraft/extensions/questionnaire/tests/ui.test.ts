import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";

import type { QuestionnaireQuestion, QuestionnaireResult } from "../model.ts";
import { requestQuestionnaire } from "../ui.ts";

test("questionnaire wraps long option descriptions and preserves explicit line breaks", async () => {
	const width = 30;
	const questions: QuestionnaireQuestion[] = [
		{
			id: "scope",
			header: "Scope",
			question: "Choose a scope",
			options: [
				{
					label: "Focused",
					description:
						"Alpha section contains enough words to wrap across several terminal lines.\nBeta tail marker remains visible.",
				},
			],
			multiple: false,
		},
	];
	const result: QuestionnaireResult = {
		questions,
		answers: [{ id: "scope", selectedOptions: [] }],
		cancelled: true,
	};
	let rendered: string[] = [];
	const ctx = {
		ui: {
			custom: async (factory: (...args: any[]) => any) => {
				const component = factory(
					{ requestRender() {} },
					{ fg: (_color: string, text: string) => text, bold: (text: string) => text },
					{ matches: () => false },
					() => {},
				);
				rendered = component.render(width);
				component.dispose?.();
				return result;
			},
		},
	} as unknown as ExtensionContext;

	await requestQuestionnaire(ctx, questions);

	assert.ok(rendered.filter((line) => line.startsWith("      ")).length >= 4);
	assert.ok(rendered.some((line) => line.startsWith("      Beta tail marker")));
	assert.match(rendered.join("\n"), /remains/);
	assert.match(rendered.join("\n"), /visible\./);
	assert.ok(rendered.every((line) => visibleWidth(line) <= width));
	assert.ok(rendered.every((line) => !line.endsWith("...")));
});
