/** Small, best-effort tool policy for the main Pi agent while Plan is active. */

export const PLAN_TOOL_CANDIDATES = ["read", "bash", "grep", "find", "ls", "questionnaire", "subagent"] as const;

const COMMAND_START = String.raw`(?:^|[;&|\r\n])\s*`;
const WRITE_PATTERNS = [
	new RegExp(`${COMMAND_START}(?:rm|rmdir|mv|cp|mkdir|touch|chmod|chown|ln|tee|truncate|del|erase|copy|move|ren)\\b`, "i"),
	new RegExp(
		`${COMMAND_START}(?:set-content|add-content|clear-content|remove-item|move-item|copy-item|new-item|rename-item|out-file|tee-object|set-item|set-itemproperty|new-itemproperty|remove-itemproperty)\\b`,
		"i",
	),
	new RegExp(
		`${COMMAND_START}git(?:\\s+(?:-[cC]\\s+\\S+|--(?:git-dir|work-tree)(?:=\\S+|\\s+\\S+)))*\\s+(?:add|am|apply|commit|push|pull|fetch|merge|rebase|reset|checkout|switch|restore|stash|cherry-pick|revert|init|clone|clean|rm|mv)\\b`,
		"i",
	),
	new RegExp(`${COMMAND_START}(?:npm|pnpm|yarn)\\s+(?:install|i|add|remove|rm|update|upgrade|ci|publish|init)\\b`, "i"),
	new RegExp(`${COMMAND_START}(?:pip|pip3|uv)\\s+(?:install|uninstall|sync|add|remove)\\b`, "i"),
	new RegExp(`${COMMAND_START}(?:sed|perl)\\b[^;|&\\r\\n]*(?:\\s-i\\S*|\\s--in-place(?:=|\\s|$))`, "i"),
	new RegExp(`${COMMAND_START}(?:sudo|su|kill|pkill|killall|reboot|shutdown)\\b`, "i"),
];

function unique(names: readonly string[]): string[] {
	return Array.from(new Set(names));
}

/** Plan never activates a tool that is missing or was already inactive. */
export function selectPlanTools(availableNames: readonly string[], activeNames: readonly string[]): string[] {
	const available = new Set(availableNames);
	const active = new Set(activeNames);
	return PLAN_TOOL_CANDIDATES.filter((name) => available.has(name) && active.has(name));
}

export function restoreAvailableTools(snapshot: readonly string[], availableNames: readonly string[]): string[] {
	const available = new Set(availableNames);
	return unique(snapshot).filter((name) => available.has(name));
}

function hasFileRedirect(command: string): boolean {
	let quote: "'" | '"' | undefined;
	let escaped = false;
	for (let index = 0; index < command.length; index++) {
		const character = command[index];
		if (escaped) {
			escaped = false;
			continue;
		}
		if (character === "\\" || character === "`") {
			escaped = true;
			continue;
		}
		if (quote) {
			if (character === quote) quote = undefined;
			continue;
		}
		if (character === "'" || character === '"') {
			quote = character;
			continue;
		}
		if (character !== ">") continue;

		let targetIndex = index + 1;
		if (command[targetIndex] === ">") targetIndex += 1;
		if (command[targetIndex] === "&" && /[\d-]/.test(command[targetIndex + 1] ?? "")) continue;
		while (/\s/.test(command[targetIndex] ?? "")) targetIndex += 1;
		const target = command.slice(targetIndex);
		if (/^\/dev\/null(?:$|[\s;&|])/i.test(target)) continue;
		return true;
	}
	return false;
}

export function findCommandViolation(command: string): string | undefined {
	if (hasFileRedirect(command)) return "output redirection";
	if (WRITE_PATTERNS.some((pattern) => pattern.test(command))) return "a common write or system mutation";
	return undefined;
}

export function findToolViolation(toolName: string, input: unknown): string | undefined {
	if (toolName === "edit" || toolName === "write") return `${toolName} is disabled while Plan is active`;
	if (toolName !== "bash") return undefined;
	if (typeof input !== "object" || input === null || !("command" in input) || typeof input.command !== "string" || !input.command.trim()) {
		return "bash input must contain a non-empty string command";
	}
	const violation = findCommandViolation(input.command);
	return violation ? `bash command appears to perform ${violation}` : undefined;
}
