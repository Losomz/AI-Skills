import type { Context } from '@deepseek-ai/cordis'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'

import type { GitCommitLanguage, GitSettingsValue } from './types.ts'

export type GitSettings = GitSettingsValue

export const GIT_SETTINGS_NAMESPACE = settingsNamespace('dsh-git')

export const DEFAULT_GIT_SETTINGS: GitSettings = { language: 'auto', modelSelection: null }

const LanguageSchema = z.union([
  z.const('auto'),
  z.const('zh-CN'),
  z.const('en'),
]).default('auto')

const ModelSelectionSchema = z.object({
  provider: z.string().min(1).max(512).required(),
  model: z.string().min(1).max(512).required(),
})

export const GitSettingsSchema: z<GitSettings> = z.object({
  language: LanguageSchema,
  modelSelection: z.union([z.const(null), ModelSelectionSchema]).default(null),
})

export function installGitSettings(ctx: Context, entry: GitSettings): () => GitSettings {
  let source = (): GitSettings => entry
  installSettingsSection(ctx, GIT_SETTINGS_NAMESPACE, GitSettingsSchema, entry, {
    setSource: current => { source = current },
    onChange: () => undefined,
  })
  return () => source()
}

export function configuredModel<T extends { provider: string; model: string }>(
  settings: GitSettings,
  fallback: T,
): T | { provider: string; model: string } {
  return settings.modelSelection === null
    ? { ...fallback }
    : { provider: settings.modelSelection.provider, model: settings.modelSelection.model }
}

export function languageRequirement(language: GitCommitLanguage): string {
  if (language === 'zh-CN') {
    return 'Default language: Simplified Chinese. Keep code identifiers, file paths, and Conventional Commit types unchanged.'
  }
  if (language === 'en') return 'Default language: English.'
  return 'Default language: infer naturally; use an explicitly requested language when provided.'
}
