import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createCommitOperation } from "../commit-operation.js";
import { discoverAgents, findAgentByName } from "../../subagent/agents.js";
import { runAgentProcess } from "../../subagent/agent-runner.js";
import { getModelAvailability } from "../../subagent/model-catalog.js";
import {
	formatModelReference,
	getSubagentModelConfigPath,
	isEffectiveAgentConfig,
	loadSubagentModelConfig,
	resolveAgentModels,
} from "../../subagent/model-overrides.js";

export default createCommitOperation({
	discoverAgents: (cwd) => {
		const loaded = loadSubagentModelConfig(getSubagentModelConfigPath(getAgentDir()));
		return resolveAgentModels(discoverAgents(cwd, "project").agents, loaded.config);
	},
	findAgentByName,
	runAgentProcess,
	validateAgentProfile: (profile, ctx) => {
		if (!isEffectiveAgentConfig(profile) || profile.modelSource !== "override" || !profile.modelOverride) {
			return undefined;
		}
		const availability = getModelAvailability(ctx.modelRegistry, profile.modelOverride);
		return availability === "available"
			? undefined
			: `General model override ${formatModelReference(profile.modelOverride)} is ${availability.replace("-", " ")}. Use /subagent-model General to select another model or reset it.`;
	},
});
