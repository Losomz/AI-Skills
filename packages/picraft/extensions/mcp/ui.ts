import { getSettingsListTheme, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container, type SettingItem, SettingsList, Text } from "@earendil-works/pi-tui";
import type { McpServerRuntime } from "./state.ts";

export async function selectMcpServer(
	ctx: ExtensionContext,
	runtimes: readonly McpServerRuntime[],
	enabledServers: ReadonlySet<string>,
): Promise<string | undefined> {
	if (runtimes.length === 0) return undefined;
	const choices = runtimes.map((runtime) => {
		const status = runtime.error ? "error" : enabledServers.has(runtime.name) ? "enabled" : "disabled";
		const count = runtime.tools.length > 0 ? `, ${runtime.tools.length} tools` : "";
		return `${runtime.name}  [${status}${count}]`;
	});
	const selected = await ctx.ui.select("MCP Servers", choices);
	if (!selected) return undefined;
	return runtimes[choices.indexOf(selected)]?.name;
}

export async function configureMcpServer(
	ctx: ExtensionContext,
	runtime: McpServerRuntime,
	serverEnabled: boolean,
	selectedTools: ReadonlySet<string>,
	onServerChange: (enabled: boolean) => Promise<boolean>,
	onToolChange: (toolName: string, enabled: boolean) => void,
): Promise<void> {
	await ctx.ui.custom((tui, theme, _keybindings, done) => {
		let pending = Promise.resolve();
		let acceptedServerEnabled = serverEnabled;
		const items: SettingItem[] = [
			{ id: "__server__", label: "Server", currentValue: serverEnabled ? "enabled" : "disabled", values: ["enabled", "disabled"] },
			...runtime.tools.map((tool) => ({
				id: tool.name,
				label: tool.name,
				currentValue: selectedTools.has(tool.name) ? "enabled" : "disabled",
				values: ["enabled", "disabled"],
			})),
		];
		const container = new Container();
		container.addChild(new Text(theme.fg("accent", theme.bold(`MCP: ${runtime.name}`)), 1, 1));
		if (runtime.error) container.addChild(new Text(theme.fg("error", runtime.error), 1, 0));
		const list = new SettingsList(
			items,
			Math.min(items.length + 2, 16),
			getSettingsListTheme(),
			(id, value) => {
				const enabled = value === "enabled";
				if (id === "__server__") {
					pending = pending.then(async () => {
						const accepted = await onServerChange(enabled);
						if (!accepted) {
							list.updateValue("__server__", acceptedServerEnabled ? "enabled" : "disabled");
							ctx.ui.notify(`Unable to ${enabled ? "enable" : "disable"} ${runtime.name}`, "error");
						} else {
							acceptedServerEnabled = enabled;
						}
						tui.requestRender();
					});
					return;
				}
				onToolChange(id, enabled);
				tui.requestRender();
			},
			() => {
				void pending.finally(() => done(undefined));
			},
			{ enableSearch: true },
		);
		container.addChild(list);
		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				list.handleInput?.(data);
				tui.requestRender();
			},
		};
	});
}
