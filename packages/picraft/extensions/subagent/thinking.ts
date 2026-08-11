export const AGENT_THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;

export type AgentThinkingLevel = (typeof AGENT_THINKING_LEVELS)[number];

export function parseAgentThinkingLevel(value: unknown): AgentThinkingLevel | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	return AGENT_THINKING_LEVELS.find((level) => level === normalized);
}

export function getAgentThinkingLevelFromFrontmatter(
	frontmatter: Record<string, unknown>,
): AgentThinkingLevel | undefined {
	return parseAgentThinkingLevel(
		frontmatter["thinking-level"] ?? frontmatter.thinkingLevel ?? frontmatter.thinking,
	);
}
