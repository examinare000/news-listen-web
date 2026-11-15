// port LearningGateway の実装。lib/api の vocabulary・podcasts を呼び、DTO を application の型に写す。
import type { LearningGateway } from '@/lib/learning/application/ports'
import type { QuizReceipt } from '@/lib/learning/application/commands'
import type { ApiGateway } from '@/lib/api/gateway'
import { getVocabulary, saveVocabulary } from '@/lib/api/vocabulary'
import { submitQuizAnswers } from '@/lib/api/podcasts'
import type { QuizAnswerResponse } from '@/types'

// correct_rate は application が持たないので捨てる。
function toReceipt(dto: QuizAnswerResponse): QuizReceipt {
  return Object.freeze({
    correct: dto.correct_count,
    total: dto.total,
    results: Object.freeze(
      dto.results.map((r) =>
        Object.freeze({
          questionIndex: r.question_index,
          selectedIndex: r.selected_index,
          correctIndex: r.correct_index,
          isCorrect: r.is_correct,
        }),
      ),
    ),
  })
}

export function createLearningGateway(gateway: ApiGateway): LearningGateway {
  return {
    async registerTerm(episodeId, term) {
      const result = await saveVocabulary(gateway, episodeId, term)
      return result.ok ? { ok: true, value: undefined } : result
    },
    async submitQuiz(episodeId, answers) {
      // lib/api は可変の number[] を受けるので、複製して渡す。
      const result = await submitQuizAnswers(gateway, episodeId, [...answers])
      return result.ok ? { ok: true, value: toReceipt(result.value) } : result
    },
    async listRegisteredTerms() {
      const result = await getVocabulary(gateway)
      return result.ok ? { ok: true, value: result.value.vocabulary.map((v) => v.term) } : result
    },
  }
}
