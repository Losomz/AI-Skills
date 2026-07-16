import { createCommitOperation } from "../commit-operation.js";
import { discoverAgents } from "../../subagent/agents.js";
import { runAgentInIsolatedProcess } from "../../subagent/index.js";

export default createCommitOperation({
	discoverAgents: (cwd) => discoverAgents(cwd, "project").agents,
	runAgent: runAgentInIsolatedProcess,
});
