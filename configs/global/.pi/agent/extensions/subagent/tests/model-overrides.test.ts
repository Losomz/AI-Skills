import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildAgentProcessArgs } from "../agent-runner.ts";
import type { AgentConfig } from "../agents.ts";
import { getAgentThinkingLevelFromFrontmatter } from "../thinking.ts";
import {
	decodeSubagentModelConfig,
	formatModelReference,
	getAgentModelKey,
	loadSubagentModelConfig,
	parseCanonicalModelReference,
	resolveAgentModel,
	setAgentModelOverride,
	setAgentModelOverrides,
} from "../model-overrides.ts";

function profile(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name: "Explore",
		description: "explore",
		model: "profile/default:high",
		tools: ["read"],
		systemPrompt: "Explore",
		source: "project",
		filePath: "agents/explore.md",
		...overrides,
	};
}

function tempConfigPath(): { dir: string; file: string } {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-model-config-"));
	return { dir, file: path.join(dir, "subagent-models.json") };
}

test("agent frontmatter accepts the canonical thinking-level field and compatibility aliases", () => {
	assert.equal(getAgentThinkingLevelFromFrontmatter({ "thinking-level": "medium" }), "medium");
	assert.equal(getAgentThinkingLevelFromFrontmatter({ thinkingLevel: "HIGH" }), "high");
	assert.equal(getAgentThinkingLevelFromFrontmatter({ thinking: "off" }), "off");
	assert.equal(getAgentThinkingLevelFromFrontmatter({ "thinking-level": "default" }), undefined);
});

test("config migrates v1 model overrides and validates normalized v2 data", () => {
	assert.deepEqual(
		decodeSubagentModelConfig({
			version: 1,
			overrides: { " PROJECT:EXPLORE ": { provider: " aimaster ", id: " gpt-5.6-luna " } },
		}),
		{
			version: 2,
			overrides: {
				"project:explore": { model: { provider: "aimaster", id: "gpt-5.6-luna" } },
			},
		},
	);
	assert.deepEqual(
		decodeSubagentModelConfig({
			version: 2,
			overrides: {
				" PROJECT:GENERAL ": {
					model: { provider: " aimaster ", id: " gpt-5.6-luna " },
					thinkingLevel: " HIGH ",
				},
				"project:explore": { thinkingLevel: "off" },
				"project:empty": {},
			},
		}),
		{
			version: 2,
			overrides: {
				"project:general": {
					model: { provider: "aimaster", id: "gpt-5.6-luna" },
					thinkingLevel: "high",
				},
				"project:explore": { thinkingLevel: "off" },
			},
		},
	);
	assert.throws(() => decodeSubagentModelConfig({ version: 3, overrides: {} }), /Unsupported/);
	assert.throws(
		() => decodeSubagentModelConfig({ version: 2, overrides: { bad: { model: { provider: "", id: "x" } } } }),
		/provider/,
	);
	assert.throws(
		() => decodeSubagentModelConfig({ version: 2, overrides: { bad: { thinkingLevel: "turbo" } } }),
		/invalid thinking level/,
	);
});

test("missing and malformed config files are distinguished without overwriting malformed data", async () => {
	const temp = tempConfigPath();
	try {
		assert.deepEqual(loadSubagentModelConfig(temp.file).config, { version: 2, overrides: {} });
		fs.writeFileSync(temp.file, "{broken", "utf8");
		const malformed = loadSubagentModelConfig(temp.file);
		assert.match(malformed.error ?? "", /Invalid subagent model configuration/);
		await assert.rejects(() => setAgentModelOverride(profile(), { provider: "p", id: "m" }, temp.file), /Invalid/);
		assert.equal(fs.readFileSync(temp.file, "utf8"), "{broken");
	} finally {
		fs.rmSync(temp.dir, { recursive: true, force: true });
	}
});

test("model and thinking overrides resolve independently and Default removes only the selected field", async () => {
	const temp = tempConfigPath();
	try {
		const agent = profile({ thinkingLevel: "low" });
		const saved = await setAgentModelOverrides(
			[{
				agent,
				model: { provider: "openrouter", id: "vendor/model:exacto" },
				thinkingLevel: "high",
			}],
			temp.file,
		);
		assert.deepEqual(saved.overrides[getAgentModelKey(agent)], {
			model: { provider: "openrouter", id: "vendor/model:exacto" },
			thinkingLevel: "high",
		});

		const effective = resolveAgentModel(agent, saved);
		assert.equal(effective.model, "openrouter/vendor/model:exacto");
		assert.equal(effective.modelSource, "override");
		assert.equal(effective.profileModel, "profile/default:high");
		assert.equal(formatModelReference(effective.modelOverride!), "openrouter/vendor/model:exacto");
		assert.equal(effective.thinkingLevel, "high");
		assert.equal(effective.thinkingSource, "override");
		assert.equal(effective.profileThinkingLevel, "low");
		assert.deepEqual(buildAgentProcessArgs(effective, "inspect").slice(0, 8), [
			"--mode",
			"json",
			"-p",
			"--no-session",
			"--model",
			"openrouter/vendor/model:exacto",
			"--thinking",
			"high",
		]);

		const modelReset = await setAgentModelOverride(agent, undefined, temp.file);
		assert.deepEqual(modelReset.overrides[getAgentModelKey(agent)], { thinkingLevel: "high" });
		const restoredModel = resolveAgentModel(agent, modelReset);
		assert.equal(restoredModel.model, "profile/default:high");
		assert.equal(restoredModel.modelSource, "profile");
		assert.equal(restoredModel.thinkingLevel, "high");

		const thinkingReset = await setAgentModelOverrides([{ agent, thinkingLevel: undefined }], temp.file);
		assert.equal(thinkingReset.overrides[getAgentModelKey(agent)], undefined);
		const restoredProfile = resolveAgentModel(agent, thinkingReset);
		assert.equal(restoredProfile.thinkingLevel, "low");
		assert.equal(restoredProfile.thinkingSource, "profile");
		assert.deepEqual(fs.readdirSync(temp.dir), ["subagent-models.json"]);
	} finally {
		fs.rmSync(temp.dir, { recursive: true, force: true });
	}
});

test("writes reject invalid fields and recover an abandoned cross-process lock", async () => {
	const temp = tempConfigPath();
	try {
		const agent = profile();
		await assert.rejects(
			() => setAgentModelOverride(agent, { provider: " ", id: "model" }, temp.file),
			/invalid provider/,
		);
		await assert.rejects(
			() => setAgentModelOverrides([{ agent, thinkingLevel: "turbo" as never }], temp.file),
			/invalid thinking level/,
		);
		assert.equal(fs.existsSync(`${temp.file}.lock`), false);

		fs.writeFileSync(`${temp.file}.lock`, "stale", "utf8");
		const stale = new Date(Date.now() - 60_000);
		fs.utimesSync(`${temp.file}.lock`, stale, stale);
		await setAgentModelOverride(agent, { provider: "provider", id: "model" }, temp.file);
		assert.equal(fs.existsSync(`${temp.file}.lock`), false);
		assert.deepEqual(loadSubagentModelConfig(temp.file).config.overrides[getAgentModelKey(agent)], {
			model: { provider: "provider", id: "model" },
		});
	} finally {
		fs.rmSync(temp.dir, { recursive: true, force: true });
	}
});

test("cross-process updates merge under the file lock instead of losing agent entries", async () => {
	const temp = tempConfigPath();
	const moduleUrl = new URL("../model-overrides.ts", import.meta.url).href;
	try {
		const children = Array.from({ length: 6 }, (_, index) => new Promise<void>((resolve, reject) => {
			const script = `
				const api = await import(process.env.MODEL_OVERRIDE_MODULE);
				await api.setAgentModelOverride({
					name: process.env.AGENT_NAME,
					description: "test",
					systemPrompt: "test",
					source: "project",
					filePath: "test.md"
				}, { provider: "provider", id: process.env.MODEL_ID }, process.env.CONFIG_PATH);
			`;
			const child = spawn(process.execPath, ["--input-type=module", "-e", script], {
				stdio: ["ignore", "ignore", "pipe"],
				env: {
					...process.env,
					MODEL_OVERRIDE_MODULE: moduleUrl,
					AGENT_NAME: `Agent${index}`,
					MODEL_ID: `model-${index}`,
					CONFIG_PATH: temp.file,
				},
			});
			let stderr = "";
			child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
			child.once("error", reject);
			child.once("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `child exited ${code}`)));
		}));
		await Promise.all(children);

		const loaded = loadSubagentModelConfig(temp.file);
		assert.equal(loaded.error, undefined);
		assert.equal(Object.keys(loaded.config.overrides).length, 6);
		for (let index = 0; index < 6; index++) {
			assert.deepEqual(loaded.config.overrides[`project:agent${index}`], {
				model: { provider: "provider", id: `model-${index}` },
			});
		}
	} finally {
		fs.rmSync(temp.dir, { recursive: true, force: true });
	}
});

test("canonical references preserve punctuation and unresolved thinking remains child Pi Default", () => {
	assert.deepEqual(parseCanonicalModelReference("openrouter/vendor/model:exacto"), {
		provider: "openrouter",
		id: "vendor/model:exacto",
	});
	assert.equal(parseCanonicalModelReference("missing-provider"), undefined);
	const effective = resolveAgentModel(profile({ model: undefined }), { version: 2, overrides: {} });
	assert.equal(effective.modelSource, "pi-default");
	assert.equal(effective.thinkingLevel, undefined);
	assert.equal(effective.thinkingSource, "pi-default");
});
