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
		/** Source Control trigger and fixed work panel mounted in the sidebar footer. */
		function SourceControlPanel({ useSessions, useWorkspaces, status, diff, stage, unstage, commit }) {
			const currentSession = useSessions((state) => state.current);
			const workspace = useWorkspaces((state) => currentSession === void 0 ? void 0 : state.items.find((item) => item.sessionIds.includes(currentSession)));
			const workspaceId = workspace === void 0 ? void 0 : String(workspace.workspaceId);
			const [open, setOpen] = (0, react.useState)(false);
			const [snapshot, setSnapshot] = (0, react.useState)();
			const [selection, setSelection] = (0, react.useState)();
			const [diffResult, setDiffResult] = (0, react.useState)();
			const [message, setMessage] = (0, react.useState)("");
			const [busy, setBusy] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)();
			const [left, setLeft] = (0, react.useState)(72);
			const rootRef = (0, react.useRef)(null);
			(0, _deepseek_ai_dsh_client_ui_primitives.useDismissOnOutsidePointer)(rootRef, open, setOpen);
			const refresh = (0, react.useCallback)(async () => {
				if (workspaceId === void 0) {
					setSnapshot(void 0);
					setError(void 0);
					return;
				}
				setBusy(true);
				setError(void 0);
				try {
					setSnapshot(await status(workspaceId));
				} catch (cause) {
					setSnapshot(void 0);
					setError(messageOf(cause));
				} finally {
					setBusy(false);
				}
			}, [status, workspaceId]);
			(0, react.useEffect)(() => {
				setSelection(void 0);
				setDiffResult(void 0);
				if (open) refresh();
			}, [
				open,
				refresh,
				workspaceId
			]);
			(0, react.useLayoutEffect)(() => {
				if (!open) return;
				const place = () => {
					const rect = rootRef.current?.getBoundingClientRect();
					if (rect !== void 0) setLeft(Math.max(16, rect.right + 8));
				};
				place();
				window.addEventListener("resize", place);
				return () => {
					window.removeEventListener("resize", place);
				};
			}, [open]);
			const selectFile = async (change, staged) => {
				if (workspaceId === void 0) return;
				const next = {
					path: change.path,
					staged
				};
				setSelection(next);
				setDiffResult(void 0);
				setError(void 0);
				try {
					setDiffResult(await diff({
						workspaceId,
						...next
					}));
				} catch (cause) {
					setError(messageOf(cause));
				}
			};
			const changeStage = async (change, staged) => {
				if (workspaceId === void 0) return;
				setBusy(true);
				setError(void 0);
				try {
					const next = staged ? await unstage({
						workspaceId,
						paths: [change.path]
					}) : await stage({
						workspaceId,
						paths: [change.path]
					});
					setSnapshot(next);
					setSelection(void 0);
					setDiffResult(void 0);
				} catch (cause) {
					setError(messageOf(cause));
				} finally {
					setBusy(false);
				}
			};
			const createCommit = async () => {
				if (workspaceId === void 0) return;
				setBusy(true);
				setError(void 0);
				try {
					await commit({
						workspaceId,
						message
					});
					setMessage("");
					setSelection(void 0);
					setDiffResult(void 0);
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
			const panelStyle = { "--dsh-git-left": `${left}px` };
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
					style: panelStyle,
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
							className: "dshGitBody",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshGitChanges",
								children: [
									error && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dshGitError",
										role: "alert",
										children: error
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
											onSelect: selectFile,
											onStageChange: changeStage
										}),
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChangeSection, {
											title: "Changes",
											files: changes,
											staged: false,
											selection,
											disabled: busy,
											onSelect: selectFile,
											onStageChange: changeStage
										}),
										snapshot.files.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: "dshGitState",
											children: "Working tree is clean."
										})
									] })
								]
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dshGitDiff",
								children: [
									selection === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dshGitState",
										children: "Select a changed file to view its diff."
									}),
									selection !== void 0 && diffResult === void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
										className: "dshGitState",
										children: "Loading diff..."
									}),
									diffResult !== void 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: "dshGitDiffHeader",
										children: [
											diffResult.staged ? "Staged" : "Working tree",
											": ",
											diffResult.path
										]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("pre", { children: diffResult.text || "No textual diff is available for this file." })] })
								]
							})]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("footer", {
							className: "dshGitCommit",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("textarea", {
								value: message,
								onChange: (event) => {
									setMessage(event.currentTarget.value);
								},
								placeholder: "Commit message",
								"aria-label": "Commit message"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
								type: "button",
								disabled: busy || staged.length === 0 || message.trim().length === 0 || snapshot?.hasConflicts === true,
								onClick: () => void createCommit(),
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCheckOutline16, {}), " Commit"]
							})]
						})
					]
				})]
			});
		}
		function ChangeSection({ title, files, staged, selection, disabled, onSelect, onStageChange }) {
			if (files.length === 0) return null;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dshGitSectionTitle",
				children: [
					title,
					" (",
					files.length,
					")"
				]
			}), files.map((file) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: "dshGitFile",
				"data-selected": selection?.path === file.path && selection.staged === staged,
				onClick: () => void onSelect(file, staged),
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dshGitStatus",
						"data-conflict": file.kind === "conflicted",
						children: statusLetter(file)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dshGitPath",
						title: file.path,
						children: file.path
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Tooltip, {
						label: staged ? "Unstage file" : "Stage file",
						side: "left",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dshGitIconButton",
							role: "button",
							"aria-label": staged ? "Unstage file" : "Stage file",
							"aria-disabled": disabled,
							onClick: (event) => {
								event.stopPropagation();
								if (!disabled) onStageChange(file, staged);
							},
							children: staged ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutline16, {}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, {})
						})
					})
				]
			}, `${staged ? "s" : "u"}:${file.path}`))] });
		}
		//#endregion
		//#region src/client/styles.ts
		const STYLE_ID = "dsh-agentframework-git-styles";
		const CSS = `
.dshGitRoot { position: relative; display: flex; min-width: 0; }
.dshGitTrigger { width: 30px; height: 30px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); display: inline-flex; align-items: center; justify-content: center; padding: 0; cursor: pointer; font: inherit; }
.dshGitTrigger:hover, .dshGitTrigger[aria-expanded="true"] { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.dshGitTriggerLabel { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshGitPanel { position: fixed; z-index: 80; pointer-events: auto; width: min(880px, calc(100vw - 32px)); height: min(720px, calc(100vh - 32px)); left: max(16px, var(--dsh-git-left, 72px)); bottom: 16px; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; box-shadow: var(--dsw-shadow-lv1); overflow: hidden; }
.dshGitHeader { min-height: 48px; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dshGitTitle { min-width: 0; display: flex; align-items: center; gap: 8px; font-weight: 600; }
.dshGitBranch { color: var(--dsw-alias-label-secondary); font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshGitIconButton { width: 30px; height: 30px; border: 0; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dshGitIconButton:hover:not(:disabled) { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.dshGitIconButton:disabled { opacity: .45; cursor: default; }
.dshGitBody { min-height: 0; display: grid; grid-template-columns: minmax(240px, 34%) minmax(0, 1fr); }
.dshGitChanges { min-height: 0; overflow: auto; border-right: 1px solid var(--dsw-alias-border-l1); padding: 8px 0; }
.dshGitSectionTitle { padding: 8px 12px 5px; color: var(--dsw-alias-label-secondary); font-size: 12px; font-weight: 600; text-transform: uppercase; }
.dshGitFile { width: 100%; min-height: 34px; display: grid; grid-template-columns: 22px minmax(0, 1fr) 30px; align-items: center; gap: 6px; padding: 3px 8px 3px 12px; border: 0; background: transparent; color: var(--dsw-alias-label-primary); text-align: left; font: inherit; cursor: pointer; }
.dshGitFile:hover, .dshGitFile[data-selected="true"] { background: var(--dsw-alias-interactive-bg-hover); }
.dshGitStatus { font-size: 11px; font-weight: 700; color: var(--dsw-alias-brand-primary); }
.dshGitStatus[data-conflict="true"] { color: var(--dsw-alias-state-error-primary); }
.dshGitPath { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshGitDiff { min-width: 0; min-height: 0; overflow: auto; background: var(--dsw-alias-bg-base); }
.dshGitDiffHeader { position: sticky; top: 0; padding: 8px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dshGitDiff pre { margin: 0; padding: 12px; min-width: max-content; white-space: pre; font: 12px/1.55 ui-monospace, SFMono-Regular, Consolas, monospace; }
.dshGitState { padding: 24px 16px; color: var(--dsw-alias-label-secondary); text-align: center; }
.dshGitError { margin: 8px 12px; padding: 8px 10px; color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-bg-layer-2); border-radius: 6px; font-size: 12px; }
.dshGitCommit { padding: 10px 12px; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; border-top: 1px solid var(--dsw-alias-border-l1); }
.dshGitCommit textarea { min-width: 0; min-height: 38px; max-height: 100px; resize: vertical; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 8px 10px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); font: inherit; }
.dshGitCommit button { min-width: 92px; border: 0; border-radius: 6px; padding: 0 14px; color: var(--dsw-alias-label-onbrand); background: var(--dsw-alias-brand-primary); font: inherit; font-weight: 600; cursor: pointer; }
.dshGitCommit button:disabled { opacity: .5; cursor: default; }
@media (max-width: 720px) { .dshGitPanel { left: 8px; right: 8px; bottom: 8px; width: auto; height: calc(100vh - 16px); } .dshGitBody { grid-template-columns: 1fr; grid-template-rows: minmax(180px, 42%) minmax(0, 1fr); } .dshGitChanges { border-right: 0; border-bottom: 1px solid var(--dsw-alias-border-l1); } }
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
		const inject = ["slots"];
		const EMPTY_STATUS = {
			repositoryRoot: "",
			branch: "main",
			detached: false,
			unborn: false,
			ahead: 0,
			behind: 0,
			hasConflicts: false,
			files: []
		};
		const panelPreview = {
			status: async () => EMPTY_STATUS,
			diff: async (request) => ({
				path: request.path,
				staged: request.staged,
				text: ""
			}),
			stage: async () => EMPTY_STATUS,
			unstage: async () => EMPTY_STATUS,
			commit: async () => {
				throw new Error("Git Host connection is not enabled yet.");
			}
		};
		/** Register the Source Control panel before Host Git wiring is added. */
		function apply(ctx) {
			ctx.effect(() => installStyles(), "dsh-git: styles");
			ctx.slots.inject("conversation.session.header.utilities", () => ctx.slots.register({
				name: "conversation.session.header.utilities",
				id: "source-control",
				order: -10,
				inject: () => panelPreview
			}, SourceControlPanel));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map