import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createCommitOperation } from "../commit-operation.js";
import { discoverAgents, findAgentByName } from "../../subagent/agents.js";
import { runAgentProcess } from "../../subagent/agent-runner.js";
import { getModelAvailability, getThinkingLevelCompatibility } from "../../subagent/model-catalog.js";
import {
	formatModelReference,
	getSubagentModelConfigPath,
	isEffectiveAgentConfig,
	loadSubagentModelConfig,
	modelReferenceFrom,
	parseCanonicalModelReference,
	resolveAgentModels,
	type ModelReference,
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
		let modelReference: ModelReference | undefined;
		if (profile.modelSource === "override" && profile.modelOverride) {
			modelReference = profile.modelOverride;
			const availability = getModelAvailability(ctx.modelRegistry, profile.modelOverride);
			if (availability !== "available") {
				return `General configured model ${formatModelReference(profile.modelOverride)} is ${availability.replace("-", " ")}. Use /subagent to select another model or return to Default.`;
			}
		} else if (profile.modelSource === "main-agent" && profile.mainModel) {
			modelReference = profile.mainModel;
			const availability = getModelAvailability(ctx.modelRegistry, profile.mainModel);
			if (availability === "runtime-only") {
				return `The main Agent model ${formatModelReference(profile.mainModel)} uses parent-only runtime credentials. Use /subagent to configure a reusable model for General.`;
			}
		} else if (profile.model) {
			modelReference = parseCanonicalModelReference(profile.model);
		}
		if (
			profile.thinkingLevel
			&& modelReference
			&& getThinkingLevelCompatibility(ctx.modelRegistry, modelReference, profile.thinkingLevel) === "unsupported"
		) {
			return `General thinking level ${profile.thinkingLevel} is unsupported by ${formatModelReference(modelReference)}. Use /subagent to choose Default or a supported level.`;
		}
		return undefined;
	},
});
