import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { IconRefreshOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  GitCommitLanguage,
  GitModelCatalogResult,
  GitModelSelection,
  GitSettingsValue,
} from '../types.ts'

interface GitSettingsCardProps {
  scope: SettingsScope<GitSettingsValue>
  loadCatalog(): Promise<GitModelCatalogResult>
}

function selectionKey(selection: GitModelSelection): string {
  return JSON.stringify([selection.provider, selection.model])
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function GitSettingsCard({ scope, loadCatalog }: GitSettingsCardProps) {
  const snapshot = useSyncExternalStore(
    useCallback(listener => scope.subscribe(listener), [scope]),
    useCallback(() => scope.getSnapshot(), [scope]),
  )
  const [catalog, setCatalog] = useState<GitModelCatalogResult>()
  const [loadingCatalog, setLoadingCatalog] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()

  const refreshCatalog = useCallback(async (): Promise<void> => {
    setLoadingCatalog(true)
    setError(undefined)
    try {
      setCatalog(await loadCatalog())
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setLoadingCatalog(false)
    }
  }, [loadCatalog])

  useEffect(() => { void refreshCatalog() }, [refreshCatalog])

  const write = useCallback(async (operation: () => Promise<void>): Promise<void> => {
    setSaving(true)
    setError(undefined)
    try {
      await operation()
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setSaving(false)
    }
  }, [])

  const value = snapshot.value
  const options = useMemo(() => catalog?.providers.flatMap(provider => provider.models.map(model => ({
    key: selectionKey({ provider: provider.id, model: model.id }),
    provider: provider.name,
    selection: { provider: provider.id, model: model.id },
    label: model.name === model.id ? model.id : `${model.name} (${model.id})`,
  }))) ?? [], [catalog])
  const configuredKey = value?.modelSelection === undefined ? '' : selectionKey(value.modelSelection)
  const configuredAvailable = configuredKey === '' || options.some(option => option.key === configuredKey)
  const customDisabled = saving || !snapshot.writable || catalog === undefined

  return (
    <li className="dshGitSettingsCard">
      <div className="dshGitSettingsHead">
        <div>
          <h3>Git</h3>
          <p>AI 提交说明的默认语言和模型</p>
        </div>
        <Tooltip label="刷新模型目录" side="right">
          <button
            type="button"
            className="dshGitIconButton"
            aria-label="刷新模型目录"
            disabled={loadingCatalog}
            onClick={() => void refreshCatalog()}
          >
            <IconRefreshOutline16 />
          </button>
        </Tooltip>
      </div>

      {snapshot.status === 'loading' && <p className="dshGitSettingsNote">正在加载设置...</p>}
      {snapshot.status === 'unavailable' && <p className="dshGitSettingsError">当前连接无法修改 Host 设置。</p>}
      {value !== undefined && (
        <div className="dshGitSettingsFields">
          <label className="dshGitSettingsField">
            <span>默认语言</span>
            <select
              value={value.language}
              disabled={saving || !snapshot.writable}
              onChange={(event) => void write(async () => await scope.set('language', event.currentTarget.value as GitCommitLanguage))}
            >
              <option value="auto">自动</option>
              <option value="zh-CN">简体中文</option>
              <option value="en">English</option>
            </select>
          </label>

          <div className="dshGitSettingsField">
            <span>生成模型</span>
            <div className="dshGitSettingsSegments" role="group" aria-label="生成模型来源">
              <button
                type="button"
                data-active={value.modelSelection === undefined}
                disabled={saving || !snapshot.writable}
                onClick={() => void write(async () => await scope.unset('modelSelection'))}
              >跟随 DSH 默认</button>
              <button
                type="button"
                data-active={value.modelSelection !== undefined}
                disabled={customDisabled}
                onClick={() => {
                  const next = value.modelSelection ?? catalog?.defaultSelection
                  if (next !== undefined) void write(async () => await scope.set('modelSelection', next))
                }}
              >Git 专用</button>
            </div>
          </div>

          {value.modelSelection === undefined ? (
            <p className="dshGitSettingsNote">
              当前默认：{catalog === undefined ? '正在读取...' : `${catalog.defaultSelection.provider} / ${catalog.defaultSelection.model}`}
            </p>
          ) : (
            <label className="dshGitSettingsField">
              <span>Git 专用模型</span>
              <select
                value={configuredKey}
                disabled={customDisabled}
                onChange={(event) => {
                  const option = options.find(candidate => candidate.key === event.currentTarget.value)
                  if (option !== undefined) void write(async () => await scope.set('modelSelection', option.selection))
                }}
              >
                {!configuredAvailable && (
                  <option value={configuredKey}>{value.modelSelection.provider} / {value.modelSelection.model}（当前不可用）</option>
                )}
                {catalog?.providers.map(provider => (
                  <optgroup label={provider.name} key={provider.id}>
                    {options.filter(option => option.selection.provider === provider.id).map(option => (
                      <option value={option.key} key={option.key}>{option.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {catalog !== undefined && catalog.failures.length > 0 && (
        <p className="dshGitSettingsNote">{catalog.failures.length} 个模型供应商目录暂时不可用。</p>
      )}
      {error && <p className="dshGitSettingsError" role="alert">{error}</p>}
    </li>
  )
}
