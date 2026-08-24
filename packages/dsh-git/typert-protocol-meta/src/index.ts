import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'

export interface TypertGatewayBinding<ServiceType extends object = object> {
  readonly service: ServiceType
  readonly serviceKey: string
  readonly namespace: string
}

export abstract class TypertRemoteService<out T = never> extends Service<T> {
  readonly typertRemote!: TypertGatewayBinding<this>
  protected constructor(ctx: Context, serviceKey: string) {
    super(ctx, serviceKey)
  }
}

type RemoteMethodDecorator = <This extends object, Args extends unknown[], Result>(
  method: (this: This, ...args: Args) => Result,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
) => void

export declare function Remote<This extends object, Args extends unknown[], Result>(
  method: (this: This, ...args: Args) => Result,
  context: ClassMethodDecoratorContext<This, (this: This, ...args: Args) => Result>,
): void
export declare function Remote(exportName: string): RemoteMethodDecorator
