import { createCommitOperation } from "../commit-operation.js";
import { discoverAgents, findAgentByName } from "../../subagent/agents.js";
import { runAgentProcess } from "../../subagent/agent-runner.js";

export default createCommitOperation({
	discoverAgents: (cwd) => discoverAgents(cwd, "project").agents,
	findAgentByName,
	runAgentProcess,
});
