import { homedir } from "node:os";

import type { ExtensionContext, KeybindingsManager, Theme } from "@earendil-works/pi-coding-agent";
import { type Component, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import type { PermissionRequest } from "./core.ts";
import {
	createPermissionPromptState,
	permissionPageModel,
	presentPermissionRequest,
	reducePermissionPrompt,
	type PermissionPageLine,
	type PermissionPresentation,
	type PermissionPromptDecision,
} from "./presentation.ts";

export type PermissionDecision = PermissionPromptDecision;

export async function requestPermissionDecision(
	ctx: ExtensionContext,
	request: PermissionRequest,
): Promise<PermissionDecision> {
	const presentation = presentPermissionRequest(request, ctx.cwd, homedir());
	if (ctx.mode === "tui") {
		return ctx.ui.custom<PermissionDecision>(
			(tui, theme, keybindings, done) =>
				new PermissionPrompt(
					theme,
					keybindings,
					presentation,
					() => tui.requestRender(),
					() => ctx.ui.setToolsExpanded(!ctx.ui.getToolsExpanded()),
					done,
					ctx.signal,
				),
			{ overlay: false },
		);
	}

	return requestPermissionDecisionFromDialogs(ctx, presentation);
}

async function requestPermissionDecisionFromDialogs(
	ctx: ExtensionContext,
	presentation: PermissionPresentation,
): Promise<PermissionDecision> {
	const selected = await ctx.ui.select(renderDialogTitle(presentation), ["Allow once", "Allow always", "Reject"], {
		signal: ctx.signal,
	});

	if (selected === "Allow once") return { kind: "once" };
	if (selected === "Allow always") return { kind: "always" };

	if (presentation.requester && selected === "Reject") {
		const feedback = await ctx.ui.input(
			`Reject permission [${presentation.requester}]`,
			`Tell ${presentation.requester} what to do differently`,
			{ signal: ctx.signal },
		);
		return feedback?.trim() ? { kind: "reject", feedback: feedback.trim() } : { kind: "reject" };
	}
	return { kind: "reject" };
}

class PermissionPrompt implements Component {
	private state = createPermissionPromptState();
	private readonly onAbort = () => this.finish({ kind: "reject" });
	private finished = false;

	constructor(
		private readonly theme: Theme,
		private readonly keybindings: Pick<KeybindingsManager, "matches">,
		private readonly presentation: PermissionPresentation,
		private readonly requestRender: () => void,
		private readonly toggleToolsExpanded: () => void,
		private readonly done: (decision: PermissionDecision) => void,
		private readonly signal?: AbortSignal,
	) {
		this.signal?.addEventListener("abort", this.onAbort, { once: true });
	}

	dispose(): void {
		this.signal?.removeEventListener("abort", this.onAbort);
	}

	invalidate(): void {}

	render(width: number): string[] {
		const contentWidth = panelContentWidth(width);
		const page = permissionPageModel(this.presentation, this.state, contentWidth);
		const lines = page.map((line) => this.renderLine(line));
		return fitToPanel(lines, width, this.theme);
	}

	handleInput(data: string): void {
		if (this.keybindings.matches(data, "app.tools.expand")) {
			this.toggleToolsExpanded();
			return;
		}
		if (this.state.stage === "feedback") {
			this.handleFeedback(data);
			return;
		}
		if (matchesKey(data, "escape")) {
			this.apply({ type: "escape" });
			return;
		}
		if (isPrevious(data)) {
			this.apply({ type: "move", delta: -1 });
			return;
		}
		if (isNext(data)) {
			this.apply({ type: "move", delta: 1 });
			return;
		}
		if (matchesKey(data, "enter")) this.apply({ type: "submit", agentName: this.presentation.requester });
	}

	private renderLine(line: PermissionPageLine): string {
		if (line.kind === "options") {
			return (line.options ?? []).map((option) => this.renderOption(option)).join("  ");
		}
		if (line.kind === "header" || line.kind === "feedback-heading") {
			return this.theme.fg("warning", this.theme.bold(line.text));
		}
		if (line.kind === "scope-heading" || line.kind === "feedback-instruction") {
			return this.theme.fg("muted", line.text);
		}
		if (line.kind === "target" || line.kind === "scope" || line.kind === "feedback-input") {
			return this.theme.fg("text", line.text);
		}
		if (line.kind === "summary") return this.theme.fg("accent", line.text);
		return line.text;
	}

	private renderOption(option: string): string {
		const text = ` ${option} `;
		const selected = this.state.selected === ["Allow once", "Allow always", "Reject"].indexOf(option);
		return selected ? this.theme.bg("selectedBg", this.theme.bold(text)) : this.theme.fg("muted", text);
	}

	private handleFeedback(data: string): void {
		if (matchesKey(data, "enter")) {
			this.apply({ type: "submit", agentName: this.presentation.requester });
			return;
		}
		if (matchesKey(data, "escape")) {
			this.apply({ type: "escape" });
			return;
		}
		if (matchesKey(data, "backspace")) {
			this.apply({ type: "backspace" });
			return;
		}
		if (isPrintable(data)) this.apply({ type: "append", value: data });
	}

	private apply(action: Parameters<typeof reducePermissionPrompt>[1]): void {
		const result = reducePermissionPrompt(this.state, action);
		if ("decision" in result) {
			this.finish(result.decision);
			return;
		}
		this.state = result.state;
		this.requestRender();
	}

	private finish(decision: PermissionDecision): void {
		if (this.finished) return;
		this.finished = true;
		this.signal?.removeEventListener("abort", this.onAbort);
		this.done(decision);
	}
}

function renderDialogTitle(presentation: PermissionPresentation): string {
	return permissionPageModel(presentation, createPermissionPromptState(), 80)
		.filter((line) => line.kind !== "options")
		.map((line) => line.text)
		.join("\n");
}

function isPrevious(data: string): boolean {
	return matchesKey(data, "left") || matchesKey(data, "up") || matchesKey(data, "h") || matchesKey(data, "k");
}

function isNext(data: string): boolean {
	return (
		matchesKey(data, "right") ||
		matchesKey(data, "down") ||
		matchesKey(data, "l") ||
		matchesKey(data, "j") ||
		matchesKey(data, "tab")
	);
}

function isPrintable(data: string): boolean {
	return data.length > 0 && !data.includes("\u001b") && Array.from(data).every((char) => char >= " " && char !== "\u007f");
}

function panelContentWidth(width: number): number {
	return Math.max(0, width - (width >= 2 ? 2 : 1));
}

function fitToPanel(lines: string[], width: number, theme: Theme): string[] {
	if (width <= 0) return [];
	const border = theme.fg("warning", "│");
	const prefix = width >= 2 ? `${border} ` : border;
	const contentWidth = panelContentWidth(width);
	if (contentWidth === 0) return lines.map(() => prefix);

	return lines.flatMap((line) => {
		const wrapped = line === "" ? [""] : wrapTextWithAnsi(line, contentWidth);
		return wrapped.map((item) => `${prefix}${truncateToWidth(item, contentWidth)}`);
	});
}
