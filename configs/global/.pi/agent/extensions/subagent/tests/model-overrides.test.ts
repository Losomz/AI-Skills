import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { buildAgentProcessArgs } from "../agent-runner.ts";
import type { AgentConfig } from "../agents.ts";
import {
	decodeSubagentModelConfig,
	formatModelReference,
	getAgentModelKey,
	loadSubagentModelConfig,
	parseCanonicalModelReference,
	resolveAgentModel,
	setAgentModelOverride,
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

test("model override config validates and normalizes v1 data", () => {
	assert.deepEqual(
		decodeSubagentModelConfig({
			version: 1,
			overrides: { " PROJECT:EXPLORE ": { provider: " aimaster ", id: " gpt-5.6-luna " } },
		}),
		{
			version: 1,
			overrides: { "project:explore": { provider: "aimaster", id: "gpt-5.6-luna" } },
		},
	);
	assert.throws(() => decodeSubagentModelConfig({ version: 2, overrides: {} }), /Unsupported/);
	assert.throws(() => decodeSubagentModelConfig({ version: 1, overrides: { bad: { provider: "", id: "x" } } }), /provider/);
});

test("missing and malformed config files are distinguished without overwriting malformed data", async () => {
	const temp = tempConfigPath();
	try {
		assert.deepEqual(loadSubagentModelConfig(temp.file).config, { version: 1, overrides: {} });
		fs.writeFileSync(temp.file, "{broken", "utf8");
		const malformed = loadSubagentModelConfig(temp.file);
		assert.match(malformed.error ?? "", /Invalid subagent model configuration/);
		await assert.rejects(() => setAgentModelOverride(profile(), { provider: "p", id: "m" }, temp.file), /Invalid/);
		assert.equal(fs.readFileSync(temp.file, "utf8"), "{broken");
	} finally {
		fs.rmSync(temp.dir, { recursive: true, force: true });
	}
});

test("setting and resetting an override atomically changes the effective profile", async () => {
	const temp = tempConfigPath();
	try {
		const agent = profile();
		const saved = await setAgentModelOverride(agent, { provider: "openrouter", id: "vendor/model:exacto" }, temp.file);
		assert.deepEqual(saved.overrides[getAgentModelKey(agent)], {
			provider: "openrouter",
			id: "vendor/model:exacto",
		});

		const effective = resolveAgentModel(agent, saved);
		assert.equal(effective.model, "openrouter/vendor/model:exacto");
		assert.equal(effective.modelSource, "override");
		assert.equal(effective.profileModel, "profile/default:high");
		assert.equal(formatModelReference(effective.modelOverride!), "openrouter/vendor/model:exacto");
		assert.deepEqual(buildAgentProcessArgs(effective, "inspect").slice(0, 6), [
			"--mode",
			"json",
			"-p",
			"--no-session",
			"--model",
			"openrouter/vendor/model:exacto",
		]);

		const reset = await setAgentModelOverride(agent, undefined, temp.file);
		const restored = resolveAgentModel(agent, reset);
		assert.equal(restored.model, "profile/default:high");
		assert.equal(restored.modelSource, "profile");
		assert.deepEqual(fs.readdirSync(temp.dir), ["subagent-models.json"]);
	} finally {
		fs.rmSync(temp.dir, { recursive: true, force: true });
	}
});

test("writes reject invalid references and recover an abandoned cross-process lock", async () => {
	const temp = tempConfigPath();
	try {
		const agent = profile();
		await assert.rejects(
			() => setAgentModelOverride(agent, { provider: " ", id: "model" }, temp.file),
			/invalid provider/,
		);
		assert.equal(fs.existsSync(`${temp.file}.lock`), false);

		fs.writeFileSync(`${temp.file}.lock`, "stale", "utf8");
		const stale = new Date(Date.now() - 60_000);
		fs.utimesSync(`${temp.file}.lock`, stale, stale);
		await setAgentModelOverride(agent, { provider: "provider", id: "model" }, temp.file);
		assert.equal(fs.existsSync(`${temp.file}.lock`), false);
		assert.deepEqual(loadSubagentModelConfig(temp.file).config.overrides[getAgentModelKey(agent)], {
			provider: "provider",
			id: "model",
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
				provider: "provider",
				id: `model-${index}`,
			});
		}
	} finally {
		fs.rmSync(temp.dir, { recursive: true, force: true });
	}
});

test("canonical references split only the provider slash and preserve model punctuation", () => {
	assert.deepEqual(parseCanonicalModelReference("openrouter/vendor/model:exacto"), {
		provider: "openrouter",
		id: "vendor/model:exacto",
	});
	assert.equal(parseCanonicalModelReference("missing-provider"), undefined);
	assert.equal(resolveAgentModel(profile({ model: undefined }), { version: 1, overrides: {} }).modelSource, "pi-default");
});
