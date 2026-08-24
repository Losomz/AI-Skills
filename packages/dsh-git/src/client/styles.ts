const STYLE_ID = 'dsh-agentframework-git-styles'

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
`

export function installStyles(): () => void {
  if (typeof document === 'undefined') return () => undefined
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) return () => undefined
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}
