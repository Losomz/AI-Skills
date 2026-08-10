import type { ExtensionContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import {
	Editor,
	type EditorTheme,
	type Component,
	type Focusable,
	matchesKey,
	truncateToWidth,
	type TUI,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

import {
	answerFor,
	CUSTOM_OPTION_LABEL,
	type QuestionnaireQuestion,
	type QuestionnaireResult,
} from "./model.ts";

export async function requestQuestionnaire(
	ctx: ExtensionContext,
	questions: QuestionnaireQuestion[],
	signal?: AbortSignal,
): Promise<QuestionnaireResult> {
	return ctx.ui.custom<QuestionnaireResult>(
		(tui, theme, keybindings, done) =>
			new QuestionnairePrompt(tui, theme, keybindings, questions, () => tui.requestRender(), done, signal),
		{ overlay: false },
	);
}

function oneLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

class QuestionnairePrompt implements Component, Focusable {
	private currentTab = 0;
	private optionIndex = 0;
	private editing = false;
	private finished = false;
	private cachedWidth?: number;
	private cachedLines?: string[];
	private readonly selected = new Map<string, Set<string>>();
	private readonly customInputs = new Map<string, string>();
	private readonly editor: Editor;
	private readonly onAbort = () => this.finish(true);
	private focusedValue = false;

	constructor(
		tui: TUI,
		private readonly theme: Theme,
		private readonly keybindings: Pick<KeybindingsManager, "matches">,
		private readonly questions: QuestionnaireQuestion[],
		private readonly requestRender: () => void,
		private readonly done: (result: QuestionnaireResult) => void,
		private readonly signal?: AbortSignal,
	) {
		const editorTheme: EditorTheme = {
			borderColor: (text) => theme.fg("accent", text),
			selectList: {
				selectedPrefix: (text) => theme.fg("accent", text),
				selectedText: (text) => theme.fg("accent", text),
				description: (text) => theme.fg("muted", text),
				scrollInfo: (text) => theme.fg("dim", text),
				noMatch: (text) => theme.fg("warning", text),
			},
		};
		this.editor = new Editor(tui, editorTheme);
		this.editor.onSubmit = (value) => this.saveCustomInput(value);
		for (const question of questions) this.selected.set(question.id, new Set());
		if (signal?.aborted) queueMicrotask(this.onAbort);
		else signal?.addEventListener("abort", this.onAbort, { once: true });
	}

	get focused(): boolean {
		return this.focusedValue;
	}

	set focused(value: boolean) {
		this.focusedValue = value;
		this.editor.focused = value && this.editing;
	}

	dispose(): void {
		this.signal?.removeEventListener("abort", this.onAbort);
	}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
		this.editor.invalidate();
	}

	handleInput(data: string): void {
		if (this.finished) return;
		if (this.editing) {
			if (this.isCancel(data)) {
				this.leaveEditor();
				return;
			}
			this.editor.handleInput(data);
			this.refresh();
			return;
		}

		if (!this.isSimpleSingle() && (matchesKey(data, "tab") || matchesKey(data, "right"))) {
			this.moveTab(1);
			return;
		}
		if (!this.isSimpleSingle() && (matchesKey(data, "shift+tab") || matchesKey(data, "left"))) {
			this.moveTab(-1);
			return;
		}

		if (this.currentTab === this.questions.length) {
			if (this.isConfirm(data)) this.finish(false);
			else if (this.isCancel(data)) this.finish(true);
			return;
		}

		const question = this.currentQuestion();
		if (!question) return;
		const total = question.options.length + 1;
		if (this.isUp(data)) {
			this.optionIndex = total > 0 ? (this.optionIndex - 1 + total) % total : 0;
			this.refresh();
			return;
		}
		if (this.isDown(data)) {
			this.optionIndex = total > 0 ? (this.optionIndex + 1) % total : 0;
			this.refresh();
			return;
		}
		if (this.isConfirm(data)) {
			this.selectCurrent(question);
			return;
		}
		if (this.isCancel(data)) this.finish(true);
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const renderWidth = Math.max(1, width);
		const lines: string[] = [this.theme.fg("accent", "-".repeat(renderWidth))];
		const addWrapped = (prefix: string, value: string) => {
			const prefixWidth = visibleWidth(prefix);
			if (prefixWidth >= renderWidth) {
				lines.push(truncateToWidth(prefix + value, renderWidth));
				return;
			}
			const wrapped = wrapTextWithAnsi(value, renderWidth - prefixWidth);
			for (let index = 0; index < wrapped.length; index++) {
				lines.push(`${index === 0 ? prefix : " ".repeat(prefixWidth)}${wrapped[index]}`);
			}
		};

		if (!this.isSimpleSingle()) {
			const tabs = this.questions.map((question, index) => {
				const answered = (this.selected.get(question.id)?.size ?? 0) > 0 || this.customInputs.has(question.id);
				const label = `${question.header}${answered ? "*" : ""}`;
				return index === this.currentTab ? `[${label}]` : label;
			});
			tabs.push(this.currentTab === this.questions.length ? "[Review]" : "Review");
			addWrapped(" ", this.theme.fg("muted", tabs.join("  ")));
			lines.push("");
		}

		if (this.currentTab === this.questions.length) this.renderReview(lines, addWrapped);
		else this.renderQuestion(lines, renderWidth, addWrapped);

		lines.push("");
		const help = this.editing
			? "Enter submit  Esc back"
			: this.currentTab === this.questions.length
				? "Enter submit  Esc dismiss"
				: this.isSimpleSingle()
					? "Up/Down select  Enter confirm  Esc dismiss"
					: "Tab/Left/Right navigate  Up/Down select  Enter confirm  Esc dismiss";
		addWrapped(" ", this.theme.fg("dim", help));
		lines.push(this.theme.fg("accent", "-".repeat(renderWidth)));

		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	private renderQuestion(
		lines: string[],
		renderWidth: number,
		addWrapped: (prefix: string, value: string) => void,
	): void {
		const question = this.currentQuestion();
		if (!question) return;
		addWrapped(" ", this.theme.fg("text", question.question));
		if (question.multiple) addWrapped(" ", this.theme.fg("muted", "Select every option that applies."));
		lines.push("");

		const selected = this.selected.get(question.id) ?? new Set<string>();
		for (let index = 0; index < question.options.length; index++) {
			const option = question.options[index];
			const active = index === this.optionIndex;
			const mark = question.multiple ? `[${selected.has(option.label) ? "x" : " "}]` : selected.has(option.label) ? "(*)" : "( )";
			const recommended = index === question.recommended ? " (Recommended)" : "";
			addWrapped(active ? "> " : "  ", this.theme.fg(active ? "accent" : "text", `${mark} ${option.label}${recommended}`));
			if (option.description) {
				const descriptionWidth = Math.max(1, renderWidth - 6);
				lines.push(`      ${truncateToWidth(this.theme.fg("muted", oneLine(option.description)), descriptionWidth)}`);
			}
		}

		const customIndex = question.options.length;
		const customActive = customIndex === this.optionIndex;
		const custom = this.customInputs.get(question.id);
		const customMark = question.multiple ? `[${custom ? "x" : " "}]` : custom ? "(*)" : "( )";
		addWrapped(
			customActive ? "> " : "  ",
			this.theme.fg(customActive ? "accent" : "text", `${customMark} ${CUSTOM_OPTION_LABEL}`),
		);
		if (custom && !this.editing) addWrapped("      ", this.theme.fg("muted", custom));

		if (this.editing) {
			lines.push("");
			addWrapped(" ", this.theme.fg("muted", "Your answer:"));
			for (const line of this.editor.render(Math.max(1, renderWidth - 2))) lines.push(` ${line}`);
		}
	}

	private renderReview(lines: string[], addWrapped: (prefix: string, value: string) => void): void {
		addWrapped(" ", this.theme.fg("accent", this.theme.bold("Review answers")));
		lines.push("");
		for (const question of this.questions) {
			const custom = this.customInputs.get(question.id);
			const values = [...(this.selected.get(question.id) ?? []), ...(custom ? [custom] : [])];
			addWrapped(
				" ",
				`${this.theme.fg("muted", `${question.header}: `)}${this.theme.fg(values.length > 0 ? "text" : "warning", values.length > 0 ? values.join(", ") : "Unanswered")}`,
			);
		}
	}

	private selectCurrent(question: QuestionnaireQuestion): void {
		if (this.optionIndex === question.options.length) {
			this.editing = true;
			this.editor.setText(this.customInputs.get(question.id) ?? "");
			this.editor.focused = this.focusedValue;
			this.refresh();
			return;
		}
		const option = question.options[this.optionIndex];
		if (!option) return;
		const selected = this.selected.get(question.id) ?? new Set<string>();
		if (question.multiple) {
			if (selected.has(option.label)) selected.delete(option.label);
			else selected.add(option.label);
			this.selected.set(question.id, selected);
			this.refresh();
			return;
		}
		this.selected.set(question.id, new Set([option.label]));
		this.customInputs.delete(question.id);
		this.advanceAfterAnswer();
	}

	private saveCustomInput(value: string): void {
		const question = this.currentQuestion();
		if (!question) return;
		const custom = value.trim();
		if (custom) {
			this.customInputs.set(question.id, custom);
			if (!question.multiple) this.selected.set(question.id, new Set());
		} else {
			this.customInputs.delete(question.id);
		}
		this.leaveEditor();
		if (custom && !question.multiple) this.advanceAfterAnswer();
	}

	private leaveEditor(): void {
		this.editing = false;
		this.editor.focused = false;
		this.editor.setText("");
		this.refresh();
	}

	private advanceAfterAnswer(): void {
		if (this.isSimpleSingle()) {
			this.finish(false);
			return;
		}
		this.currentTab = Math.min(this.currentTab + 1, this.questions.length);
		this.optionIndex = 0;
		this.refresh();
	}

	private moveTab(delta: -1 | 1): void {
		const total = this.questions.length + 1;
		this.currentTab = (this.currentTab + delta + total) % total;
		this.optionIndex = 0;
		this.editing = false;
		this.editor.focused = false;
		this.editor.setText("");
		this.refresh();
	}

	private currentQuestion(): QuestionnaireQuestion | undefined {
		return this.questions[this.currentTab];
	}

	private isSimpleSingle(): boolean {
		return this.questions.length === 1 && this.questions[0]?.multiple !== true;
	}

	private isUp(data: string): boolean {
		return this.keybindings.matches(data, "tui.select.up") || matchesKey(data, "k");
	}

	private isDown(data: string): boolean {
		return this.keybindings.matches(data, "tui.select.down") || matchesKey(data, "j");
	}

	private isConfirm(data: string): boolean {
		return this.keybindings.matches(data, "tui.select.confirm");
	}

	private isCancel(data: string): boolean {
		return this.keybindings.matches(data, "tui.select.cancel");
	}

	private refresh(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
		this.requestRender();
	}

	private finish(cancelled: boolean): void {
		if (this.finished) return;
		this.finished = true;
		this.signal?.removeEventListener("abort", this.onAbort);
		const answers = this.questions.map((question) =>
			answerFor(question, this.selected.get(question.id) ?? new Set(), this.customInputs.get(question.id)),
		);
		this.done({ questions: this.questions, answers, cancelled });
	}
}
