import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";

import {
	formatQuestionnaireResult,
	normalizeQuestions,
	unavailableResult,
	type QuestionnaireQuestionInput,
	type QuestionnaireResult,
} from "./model.ts";
import { requestQuestionnaire } from "./ui.ts";

const OptionSchema = Type.Object(
	{
		label: Type.String({ minLength: 1, maxLength: 80, description: "Concise display label" }),
		description: Type.Optional(
			Type.String({ maxLength: 240, description: "Short explanation of the choice and its tradeoffs" }),
		),
	},
	{ additionalProperties: false },
);

const QuestionSchema = Type.Object(
	{
		id: Type.String({ minLength: 1, maxLength: 64, description: "Stable unique question id" }),
		header: Type.Optional(Type.String({ maxLength: 30, description: "Short tab label" })),
		question: Type.String({ minLength: 1, maxLength: 500, description: "Complete question shown to the user" }),
		options: Type.Array(OptionSchema, { maxItems: 5, description: "Available choices; use an empty array for free text only" }),
		multiple: Type.Optional(Type.Boolean({ description: "Allow selecting more than one option" })),
		recommended: Type.Optional(
			Type.Integer({ minimum: 0, maximum: 4, description: "Zero-based index of the recommended option" }),
		),
	},
	{ additionalProperties: false },
);

const QuestionnaireParameters = Type.Object(
	{
		questions: Type.Array(QuestionSchema, {
			minItems: 1,
			maxItems: 4,
			description: "Related clarification questions to ask together",
		}),
	},
	{ additionalProperties: false },
);

export default function questionnaireExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "questionnaire",
		label: "Clarify Intent",
		description:
			"Ask the user structured clarification questions when missing intent or a consequential preference blocks correct progress. Investigate code, configuration, documentation, and existing conventions first. Default to a conservative standard choice when the decision is reversible or several choices are equally acceptable. Batch related questions, provide concise options with tradeoffs, and never add an Other option because custom input is supplied by the UI.",
		promptSnippet: "Ask one or more structured questions when a material user decision is required",
		promptGuidelines: [
			"Use questionnaire only when unresolved user intent would materially change scope, behavior, compatibility, or an irreversible decision; investigate discoverable facts first.",
			"When choices are known, provide 2-5 concise options with tradeoffs and put the recommended option first. Use an empty options array only for a genuinely open-ended question; free-form input is always available.",
			"Do not use questionnaire for reversible details with a safe conventional default; choose the conservative default and continue.",
		],
		parameters: QuestionnaireParameters,
		executionMode: "sequential",

		async execute(_toolCallId, params, signal, _onUpdate, ctx) {
			const questions = normalizeQuestions(params.questions as QuestionnaireQuestionInput[]);
			if (ctx.mode !== "tui") {
				const details = unavailableResult(questions);
				ctx.abort();
				return {
					content: [{ type: "text" as const, text: formatQuestionnaireResult(details) }],
					details,
					terminate: true,
				};
			}

			const details = await requestQuestionnaire(ctx, questions, signal);
			if (details.cancelled) ctx.abort();
			return {
				content: [{ type: "text" as const, text: formatQuestionnaireResult(details) }],
				details,
				...(details.cancelled ? { terminate: true } : {}),
			};
		},

		renderCall(args, theme) {
			const count = args.questions.length;
			const headers = args.questions.map((question) => question.header || question.id).join(", ");
			const suffix = headers ? ` (${headers})` : "";
			return new Text(
				`${theme.fg("toolTitle", theme.bold("clarify "))}${theme.fg("muted", `${count} question${count === 1 ? "" : "s"}${suffix}`)}`,
				0,
				0,
			);
		},

		renderResult(result, _options, theme) {
			const details = result.details as QuestionnaireResult | undefined;
			if (!details) {
				const content = result.content[0];
				return new Text(content?.type === "text" ? content.text : "", 0, 0);
			}
			if (details.unavailable) return new Text(theme.fg("warning", "Pi TUI unavailable"), 0, 0);
			if (details.cancelled) return new Text(theme.fg("warning", "Questionnaire dismissed"), 0, 0);

			const answers = new Map(details.answers.map((answer) => [answer.id, answer]));
			const lines = details.questions.map((question) => {
				const answer = answers.get(question.id);
				const values = [...(answer?.selectedOptions ?? []), ...(answer?.customInput ? [answer.customInput] : [])];
				const value = values.length > 0 ? values.join(", ") : "Unanswered";
				return `${theme.fg(values.length > 0 ? "success" : "warning", values.length > 0 ? "[x] " : "[ ] ")}${theme.fg("accent", question.header)}: ${theme.fg("text", value)}`;
			});
			return new Text(lines.join("\n"), 0, 0);
		},
	});

	const syncAvailability = (enabled: boolean) => {
		const active = pi.getActiveTools();
		if (enabled && !active.includes("questionnaire")) {
			pi.setActiveTools([...active, "questionnaire"]);
		} else if (!enabled && active.includes("questionnaire")) {
			pi.setActiveTools(active.filter((name) => name !== "questionnaire"));
		}
	};

	pi.on("session_start", (_event, ctx) => syncAvailability(ctx.mode === "tui"));
	pi.on("resources_discover", (_event, ctx) => syncAvailability(ctx.mode === "tui"));
	pi.on("before_agent_start", (_event, ctx) => syncAvailability(ctx.mode === "tui"));
}

