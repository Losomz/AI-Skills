import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  DiffBlock,
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
  originalPath?: string
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
  const [diffBusy, setDiffBusy] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string>()
  const [diffError, setDiffError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const rootRef = useRef<HTMLDivElement>(null)
  const selectionRef = useRef<Selection>()
  const diffRequestRef = useRef(0)
  useDismissOnOutsidePointer(rootRef, open, setOpen)

  const clearSelection = useCallback((): void => {
    diffRequestRef.current += 1
    selectionRef.current = undefined
    setSelection(undefined)
    setDiffResult(undefined)
    setDiffError(undefined)
    setDiffBusy(false)
  }, [])

  const loadDiff = useCallback(async (next: Selection): Promise<void> => {
    if (workspaceId === undefined) return
    const requestId = ++diffRequestRef.current
    selectionRef.current = next
    setSelection(next)
    setDiffResult(undefined)
    setDiffError(undefined)
    setDiffBusy(true)
    try {
      const result = await diff({ workspaceId, ...next })
      if (diffRequestRef.current === requestId) setDiffResult(result)
    } catch (cause) {
      if (diffRequestRef.current === requestId) setDiffError(messageOf(cause))
    } finally {
      if (diffRequestRef.current === requestId) setDiffBusy(false)
    }
  }, [diff, workspaceId])

  const refresh = useCallback(async (): Promise<void> => {
    if (workspaceId === undefined) {
      setSnapshot(undefined)
      setError(undefined)
      clearSelection()
      return
    }
    setBusy(true)
    setError(undefined)
    try {
      const nextSnapshot = await status(workspaceId)
      setSnapshot(nextSnapshot)
      const current = selectionRef.current
      if (current !== undefined) {
        const file = nextSnapshot.files.find(item => item.path === current.path)
        const stillPresent = file !== undefined && (current.staged ? file.staged : file.unstaged)
        if (file === undefined || !stillPresent) clearSelection()
        else await loadDiff({
          path: file.path,
          staged: current.staged,
          ...(file.originalPath === undefined ? {} : { originalPath: file.originalPath }),
        })
      }
    } catch (cause) {
      setSnapshot(undefined)
      setError(messageOf(cause))
      clearSelection()
    } finally {
      setBusy(false)
    }
  }, [clearSelection, loadDiff, status, workspaceId])

  useEffect(() => {
    clearSelection()
    if (open) void refresh()
  }, [clearSelection, open, refresh, workspaceId])

  const selectFile = async (change: GitFileChange, staged: boolean): Promise<void> => {
    if (selectionRef.current?.path === change.path && selectionRef.current.staged === staged) {
      clearSelection()
      return
    }
    await loadDiff({
      path: change.path,
      staged,
      ...(change.originalPath === undefined ? {} : { originalPath: change.originalPath }),
    })
  }

  const changeStage = async (change: GitFileChange, staged: boolean): Promise<void> => {
    if (workspaceId === undefined) return
    setBusy(true)
    setError(undefined)
    try {
      const paths = change.originalPath === undefined
        ? [change.path]
        : [change.originalPath, change.path]
      const next = staged
        ? await unstage({ workspaceId, paths })
        : await stage({ workspaceId, paths })
      setSnapshot(next)
      const updated = next.files.find(file => file.path === change.path)
      const targetStaged = !staged
      if (updated !== undefined && (targetStaged ? updated.staged : updated.unstaged)) {
        await loadDiff({
          path: updated.path,
          staged: targetStaged,
          ...(updated.originalPath === undefined ? {} : { originalPath: updated.originalPath }),
        })
      } else clearSelection()
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
      clearSelection()
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
                  <ChangeSection
                    title="Staged Changes"
                    files={staged}
                    staged
                    selection={selection}
                    disabled={busy}
                    diffBusy={diffBusy}
                    diffError={diffError}
                    diffResult={diffResult}
                    onSelect={selectFile}
                    onStageChange={changeStage}
                  />
                  <ChangeSection
                    title="Changes"
                    files={changes}
                    staged={false}
                    selection={selection}
                    disabled={busy}
                    diffBusy={diffBusy}
                    diffError={diffError}
                    diffResult={diffResult}
                    onSelect={selectFile}
                    onStageChange={changeStage}
                  />
                  {snapshot.files.length === 0 && <div className="dshGitState">Working tree is clean.</div>}
                </>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  )
}

function DiffResultView({ result }: { result: GitDiffResult }) {
  if (result.kind === 'text') {
    return (
      <div className="dshGitDiffContent">
        <DiffBlock
          className="dshGitDiffBlock"
          maxLines={24}
          diffs={result.hunks.map(hunk => ({ path: result.path, ...hunk }))}
        />
      </div>
    )
  }
  if (result.kind === 'binary') return <div className="dshGitState">二进制文件无法显示文本差异。</div>
  if (result.kind === 'too-large') {
    return <div className="dshGitState">差异超过 {Math.round(result.limitBytes / 1024)} KiB 显示上限。</div>
  }
  return <div className="dshGitState">当前层级没有可显示的文本差异。</div>
}

function ChangeSection({
  title,
  files,
  staged,
  selection,
  disabled,
  diffBusy,
  diffError,
  diffResult,
  onSelect,
  onStageChange,
}: {
  title: string
  files: GitFileChange[]
  staged: boolean
  selection: Selection | undefined
  disabled: boolean
  diffBusy: boolean
  diffError: string | undefined
  diffResult: GitDiffResult | undefined
  onSelect(change: GitFileChange, staged: boolean): Promise<void>
  onStageChange(change: GitFileChange, staged: boolean): Promise<void>
}) {
  if (files.length === 0) return null
  return (
    <section>
      <div className="dshGitSectionTitle">{title} ({files.length})</div>
      {files.map((file, index) => {
        const selected = selection?.path === file.path && selection.staged === staged
        const panelId = `dsh-git-diff-${staged ? 'staged' : 'working'}-${index}`
        return (
          <div className="dshGitFileEntry" data-selected={selected} key={`${staged ? 's' : 'u'}:${file.path}`}>
            <div className="dshGitFileRow">
              <button
                type="button"
                className="dshGitFile"
                aria-expanded={selected}
                aria-controls={panelId}
                onClick={() => void onSelect(file, staged)}
              >
                <span className="dshGitStatus" data-conflict={file.kind === 'conflicted'}>{statusLetter(file)}</span>
                <span className="dshGitPath" title={file.path}>{file.path}</span>
              </button>
              <Tooltip label={staged ? '取消暂存' : '暂存文件'} side="right">
                <button
                  type="button"
                  className="dshGitIconButton dshGitStageButton"
                  aria-label={staged ? '取消暂存' : '暂存文件'}
                  disabled={disabled}
                  onClick={() => void onStageChange(file, staged)}
                >
                  {staged ? <IconCloseOutline16 /> : <IconPlusOutline16 />}
                </button>
              </Tooltip>
            </div>
            {selected && (
              <div className="dshGitInlineDiff" id={panelId}>
                <div className="dshGitDiffHeader">
                  <span>{staged ? 'Staged' : 'Working tree'}</span>
                  <span title={file.path}>{file.path}</span>
                </div>
                {diffBusy && <div className="dshGitState">正在加载差异...</div>}
                {diffError && <div className="dshGitError" role="alert">{diffError}</div>}
                {!diffBusy && diffResult !== undefined && <DiffResultView result={diffResult} />}
              </div>
            )}
          </div>
        )
      })}
    </section>
  )
}
