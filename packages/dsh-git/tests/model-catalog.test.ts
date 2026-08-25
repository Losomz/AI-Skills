import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { readModelCatalog } from '../src/model-catalog.ts'

describe('Git model catalog', () => {
  it('returns available groups, the DSH default, and isolated provider failures', async () => {
    const ctx = {
      agentDefaultModel: {
        currentSelection: () => ({ provider: 'provider-a', model: 'model-a' }),
      },
      llm: {
        listProviders: () => [
          { id: 'provider-a', name: 'Provider A' },
          { id: 'provider-b', name: 'Provider B' },
        ],
        listModels: async (provider: string) => {
          if (provider === 'provider-b') throw new Error('credential and endpoint details must not cross the wire')
          return [{ provider, id: 'model-a', name: 'Model A', description: 'Fast model' }]
        },
      },
    } as unknown as Context

    await expect(readModelCatalog(ctx)).resolves.toEqual({
      defaultSelection: { provider: 'provider-a', model: 'model-a' },
      providers: [{
        id: 'provider-a',
        name: 'Provider A',
        models: [{ id: 'model-a', name: 'Model A', description: 'Fast model' }],
      }],
      failures: [{ provider: 'provider-b', message: 'Model catalog is unavailable for this provider.' }],
    })
  })
})
