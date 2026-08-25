import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-llm'
import type { GitModelCatalogResult } from './types.ts'

export async function readModelCatalog(ctx: Context): Promise<GitModelCatalogResult> {
  const current = ctx.agentDefaultModel.currentSelection()
  const providers = ctx.llm.listProviders()
  const settled = await Promise.all(providers.map(async provider => {
    try {
      const models = await ctx.llm.listModels(provider.id)
      return {
        provider: {
          id: provider.id,
          name: provider.name,
          models: models.map(model => ({
            id: model.id,
            name: model.name,
            ...(model.description === undefined ? {} : { description: model.description }),
          })),
        },
      }
    } catch {
      return { failure: { provider: provider.id, message: 'Model catalog is unavailable for this provider.' } }
    }
  }))
  return {
    defaultSelection: { provider: current.provider, model: current.model },
    providers: settled.flatMap(item => item.provider === undefined ? [] : [item.provider]),
    failures: settled.flatMap(item => item.failure === undefined ? [] : [item.failure]),
  }
}
