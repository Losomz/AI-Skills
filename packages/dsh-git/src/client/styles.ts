const STYLE_ID = 'dsh-agentframework-git-styles'

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
