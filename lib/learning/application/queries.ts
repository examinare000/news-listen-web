// Learning の query（web-query-learning-04）: 登録済みの語の集合。失敗は Result で返す。
import type { LearningGateway } from '@/lib/learning/application/ports'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

export interface LearningQueries {
  getRegisteredTerms(): Promise<Result<ReadonlySet<string>, ApiFailure>>
}

export function createLearningQueries({ gateway }: { readonly gateway: LearningGateway }): LearningQueries {
  return {
    async getRegisteredTerms() {
      const result = await gateway.listRegisteredTerms()
      // Set は凍結しても add が throw しないが、呼ぶたびに新しい凍結済みの値を返して共有を避ける。
      return result.ok ? { ok: true, value: Object.freeze(new Set(result.value)) } : result
    },
  }
}
