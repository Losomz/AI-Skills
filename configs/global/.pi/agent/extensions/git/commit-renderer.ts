import {
	getMarkdownTheme,
	type CustomEntry,
	type EntryRenderOptions,
	type ExtensionAPI,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { Box, Container, Markdown, Spacer, Text, type Component, type TUI } from "@earendil-works/pi-tui";

import {
	buildCommitRunView,
	GIT_COMMIT_RUN_ENTRY_TYPE,
	type GitCommitRunEntryData,
} from "./commit-operation.js";

function createCommitRunComponent(data: GitCommitRunEntryData, expanded: boolean, theme: Theme): Component {
	const view = buildCommitRunView(data);
	const box = new Box(1, 1, (text) => theme.bg(view.background, text));
	const content = new Container();

	content.addChild(
		new Text(
			`${theme.fg(view.iconColor, view.icon)} ${theme.fg("toolTitle", theme.bold(view.title))}`,
			0,
			0,
		),
	);
	content.addChild(new Text(theme.fg("muted", view.isolationLabel), 0, 0));
	content.addChild(new Text(theme.fg("dim", view.metadata), 0, 0));

	if (expanded) {
		content.addChild(new Text(theme.fg("dim", `cwd:${view.cwd}`), 0, 0));
		if (view.errorMessage) {
			content.addChild(new Text(theme.fg("error", view.errorMessage), 0, 0));
		}
		content.addChild(new Spacer(1));
		content.addChild(
			new Markdown(view.output, 0, 0, getMarkdownTheme(), {
				color: (text) => theme.fg("toolOutput", text),
			}),
		);
	} else {
		content.addChild(new Spacer(1));
		content.addChild(new Text(theme.fg("toolOutput", view.outputPreview), 0, 0));
		if (view.outputTruncated) {
			content.addChild(new Text(theme.fg("dim", "Ctrl+O 展开完整报告"), 0, 0));
		}
	}

	box.addChild(content);
	return box;
}

export function createCommitRunWidget(
	data: GitCommitRunEntryData,
): (tui: TUI, theme: Theme) => Component {
	return (_tui, theme) => createCommitRunComponent(data, false, theme);
}

export function renderCommitRunEntry(
	entry: CustomEntry<GitCommitRunEntryData>,
	options: EntryRenderOptions,
	theme: Theme,
): Component {
	if (!entry.data || entry.data.version !== 1) {
		return new Text(theme.fg("error", "无法显示 Git commit 独立进程记录：不支持的数据版本"), 1, 1);
	}
	return createCommitRunComponent(entry.data, options.expanded, theme);
}

export function registerCommitResultRenderer(pi: ExtensionAPI): void {
	pi.registerEntryRenderer<GitCommitRunEntryData>(GIT_COMMIT_RUN_ENTRY_TYPE, renderCommitRunEntry);
}
