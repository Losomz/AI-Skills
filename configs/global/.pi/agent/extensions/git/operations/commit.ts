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
	modelReferenceFrom,
	resolveAgentModels,
} from "../../subagent/model-overrides.js";

export default createCommitOperation({
	discoverAgents: (cwd, ctx) => {
		const loaded = loadSubagentModelConfig(getSubagentModelConfigPath(getAgentDir()));
		return resolveAgentModels(discoverAgents(cwd, "project").agents, loaded.config, modelReferenceFrom(ctx.model));
	},
	findAgentByName,
	runAgentProcess,
	validateAgentProfile: (profile, ctx) => {
		if (!isEffectiveAgentConfig(profile)) return undefined;
		if (profile.modelSource === "override" && profile.modelOverride) {
			const availability = getModelAvailability(ctx.modelRegistry, profile.modelOverride);
			return availability === "available"
				? undefined
				: `General configured model ${formatModelReference(profile.modelOverride)} is ${availability.replace("-", " ")}. Use /subagent to select another model or return to Default.`;
		}
		if (profile.modelSource === "main-agent" && profile.mainModel) {
			const availability = getModelAvailability(ctx.modelRegistry, profile.mainModel);
			if (availability === "runtime-only") {
				return `The main Agent model ${formatModelReference(profile.mainModel)} uses parent-only runtime credentials. Use /subagent to configure a reusable model for General.`;
			}
		}
		return undefined;
	},
});
