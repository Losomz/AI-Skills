import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export default {
	value: "pull",
	order: 2,
	label: "pull",
	description: "拉取远端变更并处理未提交改动",

	async handle(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
		// Check if it's a git repository
		const { code: statusCode } = await pi.exec("git", ["status"]);
		if (statusCode !== 0) {
			ctx.ui.notify("Not a git repository", "error");
			return;
		}

		// Check for uncommitted changes
		const { stdout: status } = await pi.exec("git", ["status", "--porcelain"]);
		if (status.trim().length > 0) {
			const choice = await ctx.ui.select("You have uncommitted changes. What do you want to do?", [
				"Stash changes and pull",
				"Discard local changes and pull",
				"Commit changes first",
				"Cancel pull",
			]);

			if (!choice || choice === "Cancel pull") {
				ctx.ui.notify("Pull cancelled", "info");
				return;
			}

			if (choice === "Stash changes and pull") {
				ctx.ui.notify("Stashing changes...", "info");
				const { code: stashCode } = await pi.exec("git", ["stash", "push", "-m", "Auto-stash before pull"]);
				if (stashCode !== 0) {
					ctx.ui.notify("Failed to stash changes", "error");
					return;
				}
			}

			if (choice === "Discard local changes and pull") {
				ctx.ui.notify("Discarding local changes...", "info");
				const { code: resetCode } = await pi.exec("git", ["reset", "--hard", "HEAD"]);
				const { code: cleanCode } = await pi.exec("git", ["clean", "-fd"]);
				if (resetCode !== 0 || cleanCode !== 0) {
					ctx.ui.notify("Failed to discard local changes", "error");
					return;
				}
			}

			if (choice === "Commit changes first") {
				ctx.ui.notify("Please commit your changes first using /git commit", "info");
				return;
			}
		}

		// Get current branch
		const { stdout: branch } = await pi.exec("git", ["branch", "--show-current"]);
		const currentBranch = branch.trim();

		ctx.ui.notify(`Pulling from ${currentBranch}...`, "info");

		// Execute git pull
		const { stdout: pullOutput, stderr: pullError, code: pullCode } = await pi.exec("git", ["pull"]);

		if (pullCode === 0) {
			ctx.ui.notify("Pull successful!", "info");

			// Show pull result
			if (pullOutput.includes("Already up to date")) {
				ctx.ui.notify("Already up to date", "info");
			} else {
				ctx.ui.notify(`Pull result:\n${pullOutput}`, "info");
			}

			// If we stashed, ask to restore
			const { stdout: stashList } = await pi.exec("git", ["stash", "list"]);
			if (stashList.includes("Auto-stash before pull")) {
				const restore = await ctx.ui.confirm("Restore stashed changes?", "Do you want to restore your stashed changes?");

				if (restore) {
					const { code: popCode, stderr: popError } = await pi.exec("git", ["stash", "pop"]);
					if (popCode === 0) {
						ctx.ui.notify("Stashed changes restored", "info");
					} else {
						ctx.ui.notify(`Failed to restore stash:\n${popError}`, "error");
					}
				}
			}
		} else {
			// Pull failed
			if (pullError.includes("CONFLICT") || pullOutput.includes("CONFLICT")) {
				ctx.ui.notify("Pull failed: Merge conflicts detected", "error");
				ctx.ui.notify(
					"Please resolve conflicts manually:\n1. Check conflicted files with: git status\n2. Edit files to resolve conflicts\n3. Stage resolved files: git add <file>\n4. Complete merge: git commit",
					"info",
				);
			} else {
				ctx.ui.notify(`Pull failed:\n${pullError || pullOutput}`, "error");
			}
		}
	},
};
