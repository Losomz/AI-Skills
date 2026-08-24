import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  IconBranchOutline16,
  IconCheckOutline16,
  IconCloseOutline16,
  IconPlusOutline16,
  IconRefreshOutline16,
  IconSparkle16,
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

/** Source Control header trigger with a viewport-fixed work panel. */
export function SourceControlPanel({
  useSessions,
  useWorkspaces,
  status,
  diff,
  stage,
  unstage,
  generateCommitMessage,
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
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
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

  const generateMessage = async (): Promise<void> => {
    if (workspaceId === undefined) return
    setGenerating(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const instruction = message.trim()
      const result = await generateCommitMessage({
        workspaceId,
        ...instruction === '' ? {} : { instruction },
      })
      setMessage(result.message)
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setGenerating(false)
    }
  }

  const createCommit = async (): Promise<void> => {
    if (workspaceId === undefined) return
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const result = await commit({ workspaceId, message })
      setNotice(`Committed ${result.hash.slice(0, 7)}: ${result.summary}`)
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
        <section className="dshGitPanel" aria-label="Source Control panel">
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
          <div className="dshGitCommit">
            <div className="dshGitMessageField">
              <textarea
                value={message}
                onChange={event => { setMessage(event.currentTarget.value) }}
                placeholder="输入提交说明，或输入要求后使用 AI 生成"
                aria-label="提交说明"
                aria-busy={generating}
                readOnly={generating}
              />
              <Tooltip label={generating ? '正在生成提交说明' : 'AI 生成提交说明'} side="right">
                <button
                  type="button"
                  className="dshGitGenerate"
                  disabled={busy || generating || workspaceId === undefined}
                  aria-label="AI 生成提交说明"
                  aria-busy={generating}
                  onClick={() => void generateMessage()}
                >
                  <IconSparkle16 />
                </button>
              </Tooltip>
            </div>
            <button
              type="button"
              className="dshGitSubmit"
              disabled={busy || generating || message.trim().length === 0}
              onClick={() => void createCommit()}
            >
              <IconCheckOutline16 /> 提交
            </button>
          </div>
          <div className="dshGitBody">
            <div className="dshGitChanges">
              {error && <div className="dshGitError" role="alert">{error}</div>}
              {notice && <div className="dshGitSuccess" role="status">{notice}</div>}
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
          <Tooltip label={staged ? 'Unstage file' : 'Stage file'} side="right">
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
