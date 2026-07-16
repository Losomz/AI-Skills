export interface AgentProcessConfig {
	model?: string;
	tools?: string[];
}

/** Build the argv for one ephemeral Pi agent process. */
export function buildAgentProcessArgs(
	agent: AgentProcessConfig,
	task: string,
	systemPromptPath?: string,
): string[] {
	const args = ["--mode", "json", "-p", "--no-session"];
	if (agent.model) args.push("--model", agent.model);
	if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));
	if (systemPromptPath) args.push("--append-system-prompt", systemPromptPath);
	args.push(`Task: ${task}`);
	return args;
}
