import assert from "node:assert/strict";
import * as path from "node:path";
import { test } from "node:test";
import {
	getPicraftScoutCacheRoot,
	getScoutCachePaths,
	getScoutCacheRoot,
	getScoutRepositoryPath,
	parseScoutRepositoryUrl,
	validateScoutBranch,
} from "../../shared/scout-cache-paths.ts";

const TEST_HOME = path.join(path.parse(process.cwd()).root, "picraft-test-home");

test("Scout cache root exposes repositories, reserved artifacts, locks, and disabled hooks directories", () => {
	const paths = getScoutCachePaths(TEST_HOME);
	assert.equal(paths.root, getScoutCacheRoot(TEST_HOME));
	assert.equal(paths.root, getPicraftScoutCacheRoot(TEST_HOME));
	assert.equal(paths.repos, path.join(TEST_HOME, ".cache", "picraft", "scout", "repos"));
	assert.equal(paths.artifacts, path.join(paths.root, "artifacts"));
	assert.equal(paths.locks, path.join(paths.root, ".locks"));
	assert.equal(paths.hooks, path.join(paths.root, ".git-hooks-disabled"));
});

test("repository URL parsing accepts explicit transports and scp syntax", () => {
	const cases = [
		["https://GitHub.com/Org/repo.git", "https", "github.com", "github.com/Org/repo"],
		["git+https://GitHub.com/Org/repo.git", "https", "github.com", "github.com/Org/repo"],
		["http://git.example.test/group/repo", "http", "git.example.test", "git.example.test/group/repo"],
		["ssh://git@git.example.test/group/repo.git", "ssh", "git.example.test", "git.example.test/group/repo"],
		["git://git.example.test/group/repo", "git", "git.example.test", "git.example.test/group/repo"],
		["git@git.example.test:group/repo.git", "ssh", "git.example.test", "git.example.test/group/repo"],
	] as const;

	for (const [url, scheme, host, identity] of cases) {
		const parsed = parseScoutRepositoryUrl(url);
		assert.equal(parsed.scheme, scheme);
		assert.equal(parsed.host, host);
		assert.equal(parsed.identity, identity);
	}
});

test("repository cache paths are deterministic, case-safe, and omit a suffix for the remote default branch", () => {
	const root = path.join(TEST_HOME, "cache");
	const explicit = getScoutRepositoryPath("https://GitHub.com/Org/repo.git", "feature/New-UI", root);
	const equivalent = getScoutRepositoryPath("git@github.com:Org/repo", "feature/New-UI", root);
	assert.equal(explicit, path.join(root, "repos", "github.com", "%4Frg", "repo@feature%2F%4Eew-%55%49"));
	assert.equal(equivalent, explicit);
	assert.equal(
		getScoutRepositoryPath("https://GitHub.com/Org/repo.git", undefined, root),
		path.join(root, "repos", "github.com", "%4Frg", "repo"),
	);
});

test("local URLs, credentials, queries, fragments, traversal, device names, and unsafe branches are rejected", () => {
	const invalidUrls = [
		"/tmp/repository",
		"./repository",
		"C:/repository",
		"file:///tmp/repository",
		"https://user@example.test/org/repo",
		"https://user:token@example.test/org/repo",
		"ssh://alice@example.test/org/repo",
		"https://example.test/org/repo?ref=main",
		"https://example.test/org/repo#main",
		"https://example.test/org/%2e%2e/repo",
		"git@example.test:../repo",
		"example.test/org/repo",
		"https://con/org/repo.git",
		"https://example.test/aux/repo.git",
		"https://example.test/org/con.git",
		"https://example.test/org/trailing./repo.git",
	];
	for (const url of invalidUrls) {
		assert.throws(() => parseScoutRepositoryUrl(url), /Repository|credentials|travers|portable|scheme/iu, url);
	}

	const invalidBranches = [
		"../main",
		"feature//new",
		"-main",
		"main..old",
		"main?ref",
		"main\\old",
		"main @{x}",
		"HEAD",
		".hidden/main",
		"release.lock",
	];
	for (const branch of invalidBranches) {
		assert.throws(() => validateScoutBranch(branch), /Unsafe branch|whitespace|between/iu, branch);
	}
	assert.equal(validateScoutBranch("feature/new-ui"), "feature/new-ui");
	assert.equal(validateScoutBranch("release/v1.0"), "release/v1.0");
});
