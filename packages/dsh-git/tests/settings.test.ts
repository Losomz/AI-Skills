import { describe, expect, it } from 'vitest'
import {
  configuredModel,
  GitSettingsSchema,
  languageRequirement,
} from '../src/settings.ts'

describe('Git settings', () => {
  it('defaults to automatic language and follows the DSH model selection', () => {
    const settings = GitSettingsSchema({})
    const fallback = { provider: 'global', model: 'default', reasoningEffort: 'high' as never }
    expect(settings).toEqual({ language: 'auto' })
    expect(configuredModel(settings, fallback)).toEqual(fallback)
  })

  it('uses an independent Git model without inheriting global reasoning effort', () => {
    const settings = GitSettingsSchema({
      language: 'zh-CN',
      modelSelection: { provider: 'git-provider', model: 'git-model' },
    })
    expect(configuredModel(settings, {
      provider: 'global',
      model: 'default',
      reasoningEffort: 'high',
    })).toEqual({ provider: 'git-provider', model: 'git-model' })
    expect(languageRequirement(settings.language)).toContain('Simplified Chinese')
  })

  it('rejects unsupported languages and incomplete model selections', () => {
    expect(() => GitSettingsSchema({ language: 'fr' as never })).toThrow()
    expect(() => GitSettingsSchema({
      language: 'en',
      modelSelection: { provider: '', model: undefined as never },
    })).toThrow()
  })
})
