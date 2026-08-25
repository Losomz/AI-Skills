window.__ModuleLoader__.load({
	id: "dsh-agentframework-git",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region src/client/SourceControlPanel.tsx
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}
		function statusLetter(change) {
			if (change.kind === "untracked") return "U";
			if (change.kind === "conflicted") return "!";
			return change.kind[0]?.toUpperCase() ?? "M";
		}
		/** Source Control header trigger with a viewport-fixed work panel. */
		function SourceControlPanel({ useSessions, useWorkspaces, status, diff, stage, unstage, generateCommitMessage, commit }) {
			const currentSession = useSessions((state) => state.current);
			const workspace = useWorkspaces((state) => currentSession === void 0 ? void 0 : state.items.find((item) => item.sessionIds.includes(currentSession)));
			const workspaceId = workspace === void 0 ? void 0 : String(workspace.workspaceId);
			const [open, setOpen] = (0, react.useState)(false);
			const [snapshot, setSnapshot] = (0, react.useState)();
			const [selection, setSelection] = (0, react.useState)();
			const [diffResult, setDiffResult] = (0, react.useState)();
			const [message, setMessage] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [diffBusy, setDiffBusy] = (0, react.useState)(false);
			const [generating, setGenerating] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)();
			const [diffError, setDiffError] = (0, react.useState)();
			const [notice, setNotice] = (0, react.useState)();
			const rootRef = (0, react.useRef)(null);
			const selectionRef = (0, react.useRef)();
			const diffRequestRef = (0, react.useRef)(0);
			(0, _deepseek_ai_dsh_client_ui_primitives.useDismissOnOutsidePointer)(rootRef, open, setOpen);
			const clearSelection = (0, react.useCallback)(() => {
				diffRequestRef.current += 1;
				selectionRef.current = void 0;
				setSelection(void 0);
				setDiffResult(void 0);
				setDiffError(void 0);
				setDiffBusy(false);
			}, []);
			const loadDiff = (0, react.useCallback)(async (next) => {
				if (workspaceId === void 0) return;
				const requestId = ++diffRequestRef.current;
				selectionRef.current = next;
				setSelection(next);
				setDiffResult(void 0);
				setDiffError(void 0);
				setDiffBusy(true);
				try {
					const result = await diff({
						workspaceId,
						...next
					});
					if (diffRequestRef.current === requestId) setDiffResult(result);
				} catch (cause) {
					if (diffRequestRef.current === requestId) setDiffError(messageOf(cause));
				} finally {
					if (diffRequestRef.current === requestId) setDiffBusy(false);
				}
			}, [diff, workspaceId]);
			const refresh = (0, react.useCallback)(async () => {
				if (workspaceId === void 0) {
					setSnapshot(void 0);
					setError(void 0);
					clearSelection();
					return;
				}
				setBusy(true);
				setError(void 0);
				try {
					const nextSnapshot = await status(workspaceId);
					setSnapshot(nextSnapshot);
					const current = selectionRef.current;
					if (current !== void 0) {
						const file = nextSnapshot.files.find((item) => item.path === current.path);
						const stillPresent = file !== void 0 && (current.staged ? file.staged : file.unstaged);
						if (file === void 0 || !stillPresent) clearSelection();
						else await loadDiff({
							path: file.path,
							staged: current.staged,
							...file.originalPath === void 0 ? {} : { originalPath: file.originalPath }
						});
					}
				} catch (cause) {
					setSnapshot(void 0);
					setError(messageOf(cause));
					clearSelection();
				} finally {
					setBusy(false);
				}
			}, [
				clearSelection,
				loadDiff,
				status,
				workspaceId
			]);
			(0, react.useEffect)(() => {
				clearSelection();
				if (open) refresh();
			}, [
				clearSelection,
				open,
				refresh,
				workspaceId
			]);
			const selectFile = async (change, staged) => {
				if (selectionRef.current?.path === change.path && selectionRef.current.staged === staged) {
					clearSelection();
					return;
				}
				await loadDiff({
					path: change.path,
					staged,
					...change.originalPath === void 0 ? {} : { originalPath: change.originalPath }
				});
			};
			const changeStage = async (change, staged) => {
				if (workspaceId === void 0) return;
				setBusy(true);
				setError(void 0);
				try {
					const paths = change.originalPath === void 0 ? [change.path] : [change.originalPath, change.path];
					const next = staged ? await unstage({
						workspaceId,
						paths
					}) : await stage({
						workspaceId,
						paths
					});
					setSnapshot(next);
					const updated = next.files.find((file) => file.path === change.path);
					const targetStaged = !staged;
					if (updated !== void 0 && (targetStaged ? updated.staged : updated.unstaged)) await loadDiff({
						path: updated.path,
						staged: targetStaged,
						...updated.originalPath === void 0 ? {} : { originalPath: updated.originalPath }
					});
					else clearSelection();
				} catch (cause) {
					setError(messageOf(cause));
				} finally {
					setBusy(false);
				}
			};
			const generateMessage = async () => {
				if (workspaceId === void 0) return;
				setGenerating(true);
				setError(void 0);
				setNotice(void 0);
				try {
					const instruction = message.trim();
					const result = await generateCommitMessage({
						workspaceId,
						...instruction === "" ? {} : { instruction }
					});
					setMessage(result.message);
				} catch (cause) {
					setError(messageOf(cause));
				} finally {
					setGenerating(false);
				}
			};
			const createCommit = async () => {
				if (workspaceId === void 0) return;
				setBusy(true);
				setError(void 0);
				setNotice(void 0);
				try {
					const result = await commit({
						workspaceId,
						message
					});
					setNotice(`Committed ${result.hash.slice(0, 7)}: ${result.summary}`);
					setMessage("");
					clearSelection();
					setSnapshot(await status(workspaceId));
				} catch (cause) {
					setError(messageOf(cause));
				} finally {
					setBusy(false);
				}
			};
			const staged = snapshot?.files.filter((file) => file.staged) ?? [];
			const changes = snapshot?.files.filter((file) => file.unstaged) ?? [];
			const branch = snapshot?.detached ? "Detached HEAD" : snapshot?.branch ?? (snapshot?.unborn ? "New repository" : "");
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshGitRoot",
				ref: rootRef,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
					label: "Source Control",
					side: "right",
					delayMs: 500,
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dshGitTrigger",
						"aria-label": "Source Control",
						"aria-expanded": open,
						onClick: () => {
							setOpen((value) => !value);
						},
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutline16, {})
					})
				}), open && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					className: "dshGitPanel",
					"aria-label": "Source Control panel",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
							className: "dshGitHeader",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshGitTitle",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconBranchOutline16, {}),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Source Control" }),
									branch && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dshGitBranch",
										children: branch
									})
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
								label: "Refresh",
								side: "bottom",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dshGitIconButton",
									disabled: busy,
									onClick: () => void refresh(),
									"aria-label": "Refresh",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconRefreshOutline16, {})
								})
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
								label: "Close",
								side: "bottom",
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: "dshGitIconButton",
									onClick: () => {
										setOpen(false);
									},
									"aria-label": "Close",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutline16, {})
								})
							})] })]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dshGitCommit",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshGitMessageField",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
									value: message,
									onChange: (event) => {
										setMessage(event.currentTarget.value);
									},
									placeholder: "输入提交说明，或输入要求后使用 AI 生成",
									"aria-label": "提交说明",
									"aria-busy": generating,
									readOnly: generating
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
									label: generating ? "正在生成提交说明" : "AI 生成提交说明",
									side: "right",
									children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: "dshGitGenerate",
										disabled: busy || generating || workspaceId === void 0,
										"aria-label": "AI 生成提交说明",
										"aria-busy": generating,
										onClick: () => void generateMessage(),
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconSparkle16, {})
									})
								})]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								className: "dshGitSubmit",
								disabled: busy || generating || message.trim().length === 0,
								onClick: () => void createCommit(),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, {}), " 提交"]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dshGitBody",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshGitChanges",
								children: [
									error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dshGitError",
										role: "alert",
										children: error
									}),
									notice && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dshGitSuccess",
										role: "status",
										children: notice
									}),
									workspaceId === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dshGitState",
										children: "Select a workspace session to use Git."
									}),
									workspaceId !== void 0 && busy && snapshot === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dshGitState",
										children: "Loading repository..."
									}),
									snapshot !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChangeSection, {
											title: "Staged Changes",
											files: staged,
											staged: true,
											selection,
											disabled: busy,
											diffBusy,
											diffError,
											diffResult,
											onSelect: selectFile,
											onStageChange: changeStage
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChangeSection, {
											title: "Changes",
											files: changes,
											staged: false,
											selection,
											disabled: busy,
											diffBusy,
											diffError,
											diffResult,
											onSelect: selectFile,
											onStageChange: changeStage
										}),
										snapshot.files.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "dshGitState",
											children: "Working tree is clean."
										})
									] })
								]
							})
						})
					]
				})]
			});
		}
		function DiffResultView({ result }) {
			if (result.kind === "text") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dshGitDiffContent",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.DiffBlock, {
					className: "dshGitDiffBlock",
					maxLines: 24,
					diffs: result.hunks.map((hunk) => ({
						path: result.path,
						...hunk
					}))
				})
			});
			if (result.kind === "binary") return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dshGitState",
				children: "二进制文件无法显示文本差异。"
			});
			if (result.kind === "too-large") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshGitState",
				children: [
					"差异超过 ",
					Math.round(result.limitBytes / 1024),
					" KiB 显示上限。"
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dshGitState",
				children: "当前层级没有可显示的文本差异。"
			});
		}
		function ChangeSection({ title, files, staged, selection, disabled, diffBusy, diffError, diffResult, onSelect, onStageChange }) {
			if (files.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshGitSectionTitle",
				children: [
					title,
					" (",
					files.length,
					")"
				]
			}), files.map((file, index) => {
				const selected = selection?.path === file.path && selection.staged === staged;
				const panelId = `dsh-git-diff-${staged ? "staged" : "working"}-${index}`;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dshGitFileEntry",
					"data-selected": selected,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshGitFileRow",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "dshGitFile",
							"aria-expanded": selected,
							"aria-controls": panelId,
							onClick: () => void onSelect(file, staged),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshGitStatus",
								"data-conflict": file.kind === "conflicted",
								children: statusLetter(file)
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dshGitPath",
								title: file.path,
								children: file.path
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
							label: staged ? "取消暂存" : "暂存文件",
							side: "right",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dshGitIconButton dshGitStageButton",
								"aria-label": staged ? "取消暂存" : "暂存文件",
								disabled,
								onClick: () => void onStageChange(file, staged),
								children: staged ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutline16, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, {})
							})
						})]
					}), selected && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dshGitInlineDiff",
						id: panelId,
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshGitDiffHeader",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: staged ? "Staged" : "Working tree" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									title: file.path,
									children: file.path
								})]
							}),
							diffBusy && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dshGitState",
								children: "正在加载差异..."
							}),
							diffError && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								className: "dshGitError",
								role: "alert",
								children: diffError
							}),
							!diffBusy && diffResult !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(DiffResultView, { result: diffResult })
						]
					})]
				}, `${staged ? "s" : "u"}:${file.path}`);
			})] });
		}
		//#endregion
		//#region src/client/parse.ts
		const CHANGE_KINDS = /* @__PURE__ */ new Set([
			"added",
			"modified",
			"deleted",
			"renamed",
			"copied",
			"untracked",
			"conflicted"
		]);
		function recordOf(value, label) {
			if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(`Git Host returned an invalid ${label}`);
			return value;
		}
		function parseFile(value) {
			const file = recordOf(value, "status file");
			if (typeof file.path !== "string" || typeof file.kind !== "string" || !CHANGE_KINDS.has(file.kind) || typeof file.staged !== "boolean" || typeof file.unstaged !== "boolean" || file.originalPath !== void 0 && typeof file.originalPath !== "string") throw new Error("Git Host returned an invalid status file");
			return {
				path: file.path,
				kind: file.kind,
				staged: file.staged,
				unstaged: file.unstaged,
				...file.originalPath === void 0 ? {} : { originalPath: file.originalPath }
			};
		}
		function parseStatus(value) {
			const status = recordOf(value, "status");
			if (typeof status.root !== "string" || status.branch !== null && typeof status.branch !== "string" || typeof status.detached !== "boolean" || typeof status.unborn !== "boolean" || !Number.isSafeInteger(status.ahead) || !Number.isSafeInteger(status.behind) || status.ahead < 0 || status.behind < 0 || typeof status.hasConflicts !== "boolean" || !Array.isArray(status.files)) throw new Error("Git Host returned an invalid status");
			return {
				root: status.root,
				branch: status.branch,
				detached: status.detached,
				unborn: status.unborn,
				ahead: status.ahead,
				behind: status.behind,
				hasConflicts: status.hasConflicts,
				files: status.files.map(parseFile)
			};
		}
		function parseHunk(value) {
			const hunk = recordOf(value, "diff hunk");
			if (hunk.oldText !== null && typeof hunk.oldText !== "string" || typeof hunk.newText !== "string") throw new Error("Git Host returned an invalid diff hunk");
			return {
				oldText: hunk.oldText,
				newText: hunk.newText
			};
		}
		function parseDiff(value) {
			const diff = recordOf(value, "diff");
			if (typeof diff.path !== "string" || typeof diff.staged !== "boolean" || typeof diff.kind !== "string") throw new Error("Git Host returned an invalid diff");
			const base = {
				path: diff.path,
				staged: diff.staged
			};
			if (diff.kind === "text" && Array.isArray(diff.hunks)) return {
				...base,
				kind: "text",
				hunks: diff.hunks.map(parseHunk)
			};
			if (diff.kind === "binary") return {
				...base,
				kind: "binary"
			};
			if (diff.kind === "empty") return {
				...base,
				kind: "empty"
			};
			if (diff.kind === "too-large" && Number.isSafeInteger(diff.limitBytes) && diff.limitBytes > 0) return {
				...base,
				kind: "too-large",
				limitBytes: diff.limitBytes
			};
			throw new Error("Git Host returned an invalid diff");
		}
		function parseGenerateResult(value) {
			const result = recordOf(value, "generated commit message");
			if (typeof result.message !== "string") throw new Error("Git Host returned an invalid generated commit message");
			return { message: result.message };
		}
		function parseCommitResult(value) {
			const result = recordOf(value, "commit result");
			if (typeof result.hash !== "string" || typeof result.summary !== "string") throw new Error("Git Host returned an invalid commit result");
			return {
				hash: result.hash,
				summary: result.summary
			};
		}
		//#endregion
		//#region src/client/styles.ts
		const STYLE_ID = "dsh-agentframework-git-styles";
		const CSS = `
.dshGitRoot { position: relative; display: flex; min-width: 0; }
.dshGitTrigger { width: 30px; height: 30px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); display: inline-flex; align-items: center; justify-content: center; padding: 0; cursor: pointer; font: inherit; }
.dshGitTrigger:hover, .dshGitTrigger[aria-expanded="true"] { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.dshGitTriggerLabel { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshGitPanel { position: fixed; z-index: 80; pointer-events: auto; width: min(520px, calc(100vw - 32px)); height: min(640px, calc(100vh - 72px)); top: 56px; right: 16px; display: grid; grid-template-rows: auto auto minmax(0, 1fr); color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; box-shadow: var(--dsw-shadow-lv1); overflow: hidden; }
.dshGitHeader { min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dshGitTitle { min-width: 0; display: flex; align-items: center; gap: 8px; font-weight: 600; }
.dshGitBranch { color: var(--dsw-alias-label-secondary); font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshGitIconButton { width: 30px; height: 30px; border: 0; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dshGitIconButton:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.dshGitIconButton:disabled { opacity: .45; cursor: default; }
.dshGitBody { min-height: 0; overflow: hidden; }
.dshGitChanges { height: 100%; min-height: 0; overflow: auto; padding: 8px 0; }
.dshGitSectionTitle { padding: 8px 12px 5px; color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 600; text-transform: uppercase; }
.dshGitFileEntry { border-bottom: 1px solid transparent; }
.dshGitFileEntry[data-selected="true"] { border-bottom-color: var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); }
.dshGitFileRow { width: 100%; display: grid; grid-template-columns: minmax(0, 1fr) 38px; align-items: center; }
.dshGitFile { width: 100%; min-width: 0; min-height: 38px; display: grid; grid-template-columns: 22px minmax(0, 1fr); align-items: center; gap: 6px; padding: 3px 4px 3px 12px; border: 0; background: transparent; color: var(--dsw-alias-label-primary); text-align: left; font: inherit; cursor: pointer; }
.dshGitFile:hover, .dshGitFile[aria-expanded="true"] { background: var(--dsw-alias-interactive-bg-hover); }
.dshGitStageButton { width: 30px; justify-self: center; }
.dshGitInlineDiff { min-width: 0; border-top: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base); }
.dshGitStatus { font-size: 11px; font-weight: 700; color: var(--dsw-alias-brand-primary); }
.dshGitStatus[data-conflict="true"] { color: var(--dsw-alias-state-error-primary); }
.dshGitPath { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshGitDiff { min-width: 0; min-height: 0; overflow: auto; background: var(--dsw-alias-bg-base); }
.dshGitDiffHeader { position: sticky; z-index: 1; top: 0; padding: 8px 12px; display: grid; gap: 2px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dshGitDiffHeader span:last-child { overflow: hidden; color: var(--dsw-alias-label-primary); text-overflow: ellipsis; white-space: nowrap; }
.dshGitDiffContent { min-width: 0; padding: 10px; }
.dshGitDiffBlock { width: 100%; min-width: 0; }
.dshGitState { padding: 24px 16px; color: var(--dsw-alias-label-secondary); text-align: center; }
.dshGitError { margin: 8px 12px; padding: 8px 10px; color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-bg-layer-2); border-radius: 6px; font-size: 12px; }
.dshGitSuccess { margin: 8px 12px; padding: 8px 10px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); border-radius: 6px; font-size: 12px; }
.dshGitCommit { padding: 10px 12px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dshGitMessageField { position: relative; min-width: 0; }
.dshGitCommit textarea { width: 100%; box-sizing: border-box; min-width: 0; min-height: 58px; max-height: 100px; resize: vertical; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 8px 42px 8px 10px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); font: inherit; }
.dshGitCommit textarea:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color); outline-offset: 1px; }
.dshGitGenerate { position: absolute; top: 6px; right: 6px; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; border: 0; border-radius: 6px; padding: 0; color: var(--dsw-alias-button-info-fill); background: transparent; cursor: pointer; }
.dshGitGenerate:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dshGitGenerate:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color); outline-offset: 1px; }
.dshGitGenerate:disabled { opacity: .4; cursor: not-allowed; }
.dshGitGenerate[aria-busy="true"] svg { animation: dshGitGeneratePulse 900ms ease-in-out infinite alternate; }
.dshGitSubmit { width: 100%; min-width: 0; height: 38px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; border: 0; border-radius: 6px; padding: 0 14px; color: var(--dsw-static-neutral-bluish-00); background: var(--dsw-alias-button-info-fill); font: inherit; font-weight: 600; cursor: pointer; transition: background-color 100ms ease, opacity 100ms ease; }
.dshGitSubmit:hover:not(:disabled) { background: var(--dsw-alias-button-info-hover); }
.dshGitSubmit:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary-new-colorprimary-new-color); outline-offset: 2px; }
.dshGitSubmit:disabled { opacity: .4; cursor: not-allowed; }
@keyframes dshGitGeneratePulse { from { opacity: .45; transform: scale(.9); } to { opacity: 1; transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .dshGitGenerate[aria-busy="true"] svg { animation: none; } }
@media (max-width: 720px) { .dshGitPanel { top: 48px; right: 8px; bottom: 8px; left: 8px; width: auto; height: auto; } }
`;
		function installStyles() {
			if (typeof document === "undefined") return () => void 0;
			if (document.getElementById(STYLE_ID) !== null) return () => void 0;
			const style = document.createElement("style");
			style.id = STYLE_ID;
			style.textContent = CSS;
			document.head.appendChild(style);
			return () => {
				style.remove();
			};
		}
		//#endregion
		//#region src/client/index.ts
		const inject = ["slots", "connection"];
		/** Register the Source Control panel and its workspace-confined Host callers. */
		function apply(ctx) {
			const connection = ctx.connection;
			const call = async (endpoint, payload) => {
				const result = await connection.rpc.call("/dsh-git", endpoint, payload);
				if (!result.ok) throw new Error(result.error.message);
				return result.value;
			};
			const panelFace = {
				status: async (workspaceId) => parseStatus(await call("status", { workspaceId })),
				diff: async (request) => parseDiff(await call("diff", request)),
				stage: async (request) => parseStatus(await call("stage", request)),
				unstage: async (request) => parseStatus(await call("unstage", request)),
				generateCommitMessage: async (request) => parseGenerateResult(await call("generate-commit-message", request)),
				commit: async (request) => parseCommitResult(await call("commit", request))
			};
			ctx.effect(() => installStyles(), "dsh-git: styles");
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "source-control",
				order: -10,
				inject: () => panelFace
			}, SourceControlPanel));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map