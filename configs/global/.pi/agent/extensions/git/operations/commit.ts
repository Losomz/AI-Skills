import { createCommitOperation } from "../commit-operation.js";
import { createCommitRunWidget } from "../commit-renderer.js";
import { discoverAgents } from "../../subagent/agents.js";
import { runAgentInIsolatedProcess } from "../../subagent/index.js";

export default createCommitOperation({
	discoverAgents: (cwd) => discoverAgents(cwd, "project").agents,
	runAgent: runAgentInIsolatedProcess,
	createWidget: createCommitRunWidget,
});
