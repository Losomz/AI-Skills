import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export default {
	value: "branch",
	label: "branch",
	description: "切换或创建分支",

	async handle(pi: ExtensionAPI, ctx: ExtensionContext): Promise<void> {
		// Check if it's a git repository
		const { code: statusCode } = await pi.exec("git", ["status"]);
		if (statusCode !== 0) {
			ctx.ui.notify("Not a git repository", "error");
			return;
		}

		// Get current branch
		const { stdout: currentBranch } = await pi.exec("git", ["branch", "--show-current"]);
		const current = currentBranch.trim();

		// Get local branches
		const { stdout: branchOutput } = await pi.exec("git", ["branch", "--format", "%(refname:short)"]);
		const localBranches = branchOutput.trim().split("\n").map((b) => b.trim()).filter(Boolean);

		// Get remote branches (excluding already tracked locally)
		const { stdout: remoteOutput } = await pi.exec("git", ["branch", "-r", "--format", "%(refname:short)"]);
		const remoteBranches = remoteOutput
			.trim()
			.split("\n")
			.map((b) => b.trim())
			.filter(Boolean)
			.filter((b) => !b.endsWith("/HEAD"))
			.filter((b) => {
				const name = b.replace(/^[^/]+\//, "");
				return !localBranches.includes(name);
			});

		// Build options
		const options: string[] = [];
		for (const b of localBranches) {
			options.push(b === current ? `${b} (current)` : b);
		}
		for (const b of remoteBranches) {
			options.push(`${b} (remote)`);
		}
		options.push("+ Create new branch");

		const choice = await ctx.ui.select(`当前分支: ${current}`, options);
		if (!choice) {
			ctx.ui.notify("Branch switch cancelled", "info");
			return;
		}

		// Create new branch
		if (choice === "+ Create new branch") {
			const name = await ctx.ui.input("新分支名称", "");
			if (!name || !name.trim()) {
				ctx.ui.notify("Branch creation cancelled", "info");
				return;
			}

			const { code: createCode, stderr: createError } = await pi.exec("git", ["checkout", "-b", name.trim()]);
			if (createCode === 0) {
				ctx.ui.notify(`已创建并切换到分支: ${name.trim()}`, "info");
			} else {
				ctx.ui.notify(`创建分支失败: ${createError}`, "error");
			}
			return;
		}

		// Switch to existing branch
		let target = choice.replace(" (current)", "").replace(" (remote)", "").trim();

		// If it's a remote branch, create local tracking branch
		if (choice.includes("(remote)")) {
			const remoteName = target;
			const localName = target.replace(/^[^/]+\//, "");
			const { code: trackCode, stderr: trackError } = await pi.exec("git", ["checkout", "-b", localName, remoteName]);
			if (trackCode === 0) {
				ctx.ui.notify(`已从 ${remoteName} 创建本地分支并切换到: ${localName}`, "info");
			} else {
				ctx.ui.notify(`切换到远程分支失败: ${trackError}`, "error");
			}
			return;
		}

		// Check for dirty tree before switching
		const { stdout: status } = await pi.exec("git", ["status", "--porcelain"]);
		if (status.trim().length > 0) {
			const dirtyChoice = await ctx.ui.select("工作区有未提交改动，如何处理？", [
				"Stash 并切换",
				"丢弃改动并切换",
				"取消切换",
			]);

			if (!dirtyChoice || dirtyChoice === "取消切换") {
				ctx.ui.notify("Branch switch cancelled", "info");
				return;
			}

			if (dirtyChoice === "Stash 并切换") {
				const { code: stashCode } = await pi.exec("git", ["stash", "push", "-m", `Auto-stash before switching to ${target}`]);
				if (stashCode !== 0) {
					ctx.ui.notify("Stash failed", "error");
					return;
				}
			}

			if (dirtyChoice === "丢弃改动并切换") {
				await pi.exec("git", ["reset", "--hard", "HEAD"]);
				await pi.exec("git", ["clean", "-fd"]);
			}
		}

		const { code: checkoutCode, stderr: checkoutError } = await pi.exec("git", ["checkout", target]);
		if (checkoutCode === 0) {
			ctx.ui.notify(`已切换到分支: ${target}`, "info");
		} else {
			ctx.ui.notify(`切换分支失败: ${checkoutError}`, "error");
		}
	},
};
