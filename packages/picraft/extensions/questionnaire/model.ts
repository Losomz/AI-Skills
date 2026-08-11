export interface QuestionnaireOptionInput {
	label: string;
	description?: string;
}

export interface QuestionnaireQuestionInput {
	id: string;
	header?: string;
	question: string;
	options: QuestionnaireOptionInput[];
	multiple?: boolean;
	recommended?: number;
}

export interface QuestionnaireOption {
	label: string;
	description?: string;
}

export interface QuestionnaireQuestion {
	id: string;
	header: string;
	question: string;
	options: QuestionnaireOption[];
	multiple: boolean;
	recommended?: number;
}

export interface QuestionnaireAnswer {
	id: string;
	selectedOptions: string[];
	customInput?: string;
}

export interface QuestionnaireResult {
	questions: QuestionnaireQuestion[];
	answers: QuestionnaireAnswer[];
	cancelled: boolean;
	unavailable?: boolean;
}

export const CUSTOM_OPTION_LABEL = "Type your own answer";
const RESERVED_LABELS = new Set([CUSTOM_OPTION_LABEL.toLowerCase()]);

export function normalizeQuestions(input: readonly QuestionnaireQuestionInput[]): QuestionnaireQuestion[] {
	if (input.length === 0) throw new Error("questions must contain at least one question");
	if (input.length > 4) throw new Error("questions must contain no more than four questions");

	const ids = new Set<string>();
	return input.map((question, index) => {
		const id = question.id.trim();
		if (!id) throw new Error(`question ${index + 1} must have a non-empty id`);
		if (id.length > 64) throw new Error(`question id '${id}' must be at most 64 characters`);
		if (ids.has(id)) throw new Error(`question id '${id}' is duplicated`);
		ids.add(id);

		const prompt = question.question.trim();
		if (!prompt) throw new Error(`question '${id}' must have non-empty text`);
		if (prompt.length > 500) throw new Error(`question '${id}' must be at most 500 characters`);

		const header = question.header?.trim() || `Q${index + 1}`;
		if (header.length > 30) throw new Error(`question header '${header}' must be at most 30 characters`);
		if (question.options.length > 5) throw new Error(`question '${id}' must have no more than five options`);

		const labels = new Set<string>();
		const options = question.options.map((option, optionIndex) => {
			const label = option.label.trim();
			if (!label) throw new Error(`option ${optionIndex + 1} for question '${id}' must have a label`);
			if (label.length > 80) throw new Error(`option '${label}' for question '${id}' must be at most 80 characters`);
			const key = label.toLowerCase();
			if (RESERVED_LABELS.has(key)) throw new Error(`option label '${label}' is reserved by the questionnaire UI`);
			if (labels.has(key)) throw new Error(`option label '${label}' is duplicated for question '${id}'`);
			labels.add(key);

			const description = option.description?.trim();
			if (description && description.length > 240) {
				throw new Error(`description for option '${label}' must be at most 240 characters`);
			}
			return description ? { label, description } : { label };
		});

		const recommended = question.recommended;
		if (recommended !== undefined) {
			if (!Number.isInteger(recommended) || recommended < 0 || recommended >= options.length) {
				throw new Error(`recommended index for question '${id}' does not reference an option`);
			}
		}

		return {
			id,
			header,
			question: prompt,
			options,
			multiple: question.multiple === true,
			...(recommended !== undefined ? { recommended } : {}),
		};
	});
}

export function createAnswers(questions: readonly QuestionnaireQuestion[]): QuestionnaireAnswer[] {
	return questions.map((question) => ({ id: question.id, selectedOptions: [] }));
}

export function orderSelectedOptions(
	question: QuestionnaireQuestion,
	selected: ReadonlySet<string>,
): string[] {
	return question.options.map((option) => option.label).filter((label) => selected.has(label));
}

export function answerFor(
	question: QuestionnaireQuestion,
	selected: ReadonlySet<string>,
	customInput?: string,
): QuestionnaireAnswer {
	const custom = customInput?.trim();
	return {
		id: question.id,
		selectedOptions: orderSelectedOptions(question, selected),
		...(custom ? { customInput: custom } : {}),
	};
}

export function formatQuestionnaireResult(result: QuestionnaireResult): string {
	if (result.unavailable) {
		return "Questionnaire unavailable because this session is not running in Pi TUI. Continue with conservative assumptions or report the ambiguity to the parent conversation.";
	}
	if (result.cancelled) {
		return "User dismissed the questionnaire. Do not repeat the same questions unless the user asks to revisit the decision.";
	}

	const byId = new Map(result.answers.map((answer) => [answer.id, answer]));
	const lines = result.questions.map((question) => {
		const answer = byId.get(question.id);
		const values = [...(answer?.selectedOptions ?? []), ...(answer?.customInput ? [answer.customInput] : [])];
		return question.id + ": " + (values.length > 0 ? values.join(", ") : "Unanswered");
	});
	return `User answers:\n${lines.join("\n")}`;
}

export function unavailableResult(questions: readonly QuestionnaireQuestion[] = []): QuestionnaireResult {
	return {
		questions: Array.from(questions),
		answers: createAnswers(questions),
		cancelled: true,
		unavailable: true,
	};
}
