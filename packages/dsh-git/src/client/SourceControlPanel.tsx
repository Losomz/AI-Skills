import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import type { CSSProperties } from 'react'
import {
  IconBranchOutline16,
  IconCheckOutline16,
  IconCloseOutline16,
  IconPlusOutline16,
  IconRefreshOutline16,
  Tooltip,
  useDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { GitDiffResult, GitFileChange, GitStatusSnapshot } from '../types.ts'
import type { SourceControlPanelProps } from './types.ts'

interface Selection {
  path: string
  staged: boolean
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function statusLetter(change: GitFileChange): string {
  if (change.kind === 'untracked') return 'U'
  if (change.kind === 'conflicted') return '!'
  return change.kind[0]?.toUpperCase() ?? 'M'
}

/** Source Control trigger and fixed work panel mounted in the sidebar footer. */
export function SourceControlPanel({
  useSessions,
  useWorkspaces,
  status,
  diff,
  stage,
  unstage,
  commit,
}: SourceControlPanelProps) {
  const currentSession = useSessions(state => state.current)
  const workspace = useWorkspaces(state => currentSession === undefined
    ? undefined
    : state.items.find(item => item.sessionIds.includes(currentSession)))
  const workspaceId = workspace === undefined ? undefined : String(workspace.workspaceId)
  const [open, setOpen] = useState(false)
  const [snapshot, setSnapshot] = useState<GitStatusSnapshot>()
  const [selection, setSelection] = useState<Selection>()
  const [diffResult, setDiffResult] = useState<GitDiffResult>()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [left, setLeft] = useState(72)
  const rootRef = useRef<HTMLDivElement>(null)
  useDismissOnOutsidePointer(rootRef, open, setOpen)

  const refresh = useCallback(async (): Promise<void> => {
    if (workspaceId === undefined) {
      setSnapshot(undefined)
      setError(undefined)
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      setSnapshot(await status(workspaceId))
    } catch (cause) {
      setSnapshot(undefined)
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }, [status, workspaceId])

  useEffect(() => {
    setSelection(undefined)
    setDiffResult(undefined)
    if (open) void refresh()
  }, [open, refresh, workspaceId])

  useLayoutEffect(() => {
    if (!open) return
    const place = (): void => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (rect !== undefined) setLeft(Math.max(16, rect.right + 8))
    }
    place()
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('resize', place) }
  }, [open])

  const selectFile = async (change: GitFileChange, staged: boolean): Promise<void> => {
    if (workspaceId === undefined) return
    const next = { path: change.path, staged }
    setSelection(next)
    setDiffResult(undefined)
    setError(undefined)
    try {
      setDiffResult(await diff({ workspaceId, ...next }))
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  const changeStage = async (change: GitFileChange, staged: boolean): Promise<void> => {
    if (workspaceId === undefined) return
    setBusy(true)
    setError(undefined)
    try {
      const next = staged
        ? await unstage({ workspaceId, paths: [change.path] })
        : await stage({ workspaceId, paths: [change.path] })
      setSnapshot(next)
      setSelection(undefined)
      setDiffResult(undefined)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  const createCommit = async (): Promise<void> => {
    if (workspaceId === undefined) return
    setBusy(true)
    setError(undefined)
    try {
      await commit({ workspaceId, message })
      setMessage('')
      setSelection(undefined)
      setDiffResult(undefined)
      setSnapshot(await status(workspaceId))
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  const staged = snapshot?.files.filter(file => file.staged) ?? []
  const changes = snapshot?.files.filter(file => file.unstaged) ?? []
  const branch = snapshot?.detached
    ? 'Detached HEAD'
    : snapshot?.branch ?? (snapshot?.unborn ? 'New repository' : '')
  const panelStyle = { '--dsh-git-left': `${left}px` } as CSSProperties

  return (
    <div className="dshGitRoot" ref={rootRef}>
      <Tooltip label="Source Control" side="right" delayMs={500}>
        <button
          type="button"
          className="dshGitTrigger"
          aria-label="Source Control"
          aria-expanded={open}
          onClick={() => { setOpen(value => !value) }}
        >
          <IconBranchOutline16 />
        </button>
      </Tooltip>
      {open && (
        <section className="dshGitPanel" style={panelStyle} aria-label="Source Control panel">
          <header className="dshGitHeader">
            <div className="dshGitTitle">
              <IconBranchOutline16 />
              <span>Source Control</span>
              {branch && <span className="dshGitBranch">{branch}</span>}
            </div>
            <div>
              <Tooltip label="Refresh" side="bottom">
                <button type="button" className="dshGitIconButton" disabled={busy} onClick={() => void refresh()} aria-label="Refresh">
                  <IconRefreshOutline16 />
                </button>
              </Tooltip>
              <Tooltip label="Close" side="bottom">
                <button type="button" className="dshGitIconButton" onClick={() => { setOpen(false) }} aria-label="Close">
                  <IconCloseOutline16 />
                </button>
              </Tooltip>
            </div>
          </header>
          <div className="dshGitBody">
            <div className="dshGitChanges">
              {error && <div className="dshGitError" role="alert">{error}</div>}
              {workspaceId === undefined && <div className="dshGitState">Select a workspace session to use Git.</div>}
              {workspaceId !== undefined && busy && snapshot === undefined && <div className="dshGitState">Loading repository...</div>}
              {snapshot !== undefined && (
                <>
                  <ChangeSection title="Staged Changes" files={staged} staged selection={selection} disabled={busy} onSelect={selectFile} onStageChange={changeStage} />
                  <ChangeSection title="Changes" files={changes} staged={false} selection={selection} disabled={busy} onSelect={selectFile} onStageChange={changeStage} />
                  {snapshot.files.length === 0 && <div className="dshGitState">Working tree is clean.</div>}
                </>
              )}
            </div>
            <div className="dshGitDiff">
              {selection === undefined && <div className="dshGitState">Select a changed file to view its diff.</div>}
              {selection !== undefined && diffResult === undefined && <div className="dshGitState">Loading diff...</div>}
              {diffResult !== undefined && (
                <>
                  <div className="dshGitDiffHeader">{diffResult.staged ? 'Staged' : 'Working tree'}: {diffResult.path}</div>
                  <pre>{diffResult.text || 'No textual diff is available for this file.'}</pre>
                </>
              )}
            </div>
          </div>
          <footer className="dshGitCommit">
            <textarea value={message} onChange={event => { setMessage(event.currentTarget.value) }} placeholder="Commit message" aria-label="Commit message" />
            <button
              type="button"
              disabled={busy || staged.length === 0 || message.trim().length === 0 || snapshot?.hasConflicts === true}
              onClick={() => void createCommit()}
            >
              <IconCheckOutline16 /> Commit
            </button>
          </footer>
        </section>
      )}
    </div>
  )
}

function ChangeSection({
  title,
  files,
  staged,
  selection,
  disabled,
  onSelect,
  onStageChange,
}: {
  title: string
  files: GitFileChange[]
  staged: boolean
  selection: Selection | undefined
  disabled: boolean
  onSelect(change: GitFileChange, staged: boolean): Promise<void>
  onStageChange(change: GitFileChange, staged: boolean): Promise<void>
}) {
  if (files.length === 0) return null
  return (
    <section>
      <div className="dshGitSectionTitle">{title} ({files.length})</div>
      {files.map(file => (
        <button
          type="button"
          className="dshGitFile"
          key={`${staged ? 's' : 'u'}:${file.path}`}
          data-selected={selection?.path === file.path && selection.staged === staged}
          onClick={() => void onSelect(file, staged)}
        >
          <span className="dshGitStatus" data-conflict={file.kind === 'conflicted'}>{statusLetter(file)}</span>
          <span className="dshGitPath" title={file.path}>{file.path}</span>
          <Tooltip label={staged ? 'Unstage file' : 'Stage file'} side="left">
            <span
              className="dshGitIconButton"
              role="button"
              aria-label={staged ? 'Unstage file' : 'Stage file'}
              aria-disabled={disabled}
              onClick={(event) => {
                event.stopPropagation()
                if (!disabled) void onStageChange(file, staged)
              }}
            >
              {staged ? <IconCloseOutline16 /> : <IconPlusOutline16 />}
            </span>
          </Tooltip>
        </button>
      ))}
    </section>
  )
}
