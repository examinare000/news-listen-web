import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import PodcastDetailPage from '@/app/(app)/podcast/[id]/page'
import { AppProvider } from '@/contexts/AppContext'
import { ToastProvider } from '@/components/ui/Toast'

const { playSfx, prepareSfx } = vi.hoisted(() => ({ playSfx: vi.fn(), prepareSfx: vi.fn() }))

vi.mock('@/lib/sfx', () => ({ playSfx, prepareSfx }))

vi.mock('@/lib/api', () => ({
  createApiClient: vi.fn(() => ({
    getPodcast: vi.fn(),
    getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
  })),
  ApiError: class ApiError extends Error {
    constructor(public status: number, public detail: string) {
      super(detail)
    }
  },
}))

// ページは usePlayback() / usePlaybackActions() の公開面だけを使う。再生の振る舞いは PlaybackProvider.*.test.tsx が持つので、
// ここでは「どの操作がどの引数で委譲されるか」と「保存の表示」を double で固定する。
const double = vi.hoisted(() => ({
  pb: {},
  actions: {},
}))

vi.mock('@/contexts/PlaybackProvider', () => ({ usePlayback: () => double.pb }))
vi.mock('@/components/PlaybackToasts', () => ({ usePlaybackActions: () => double.actions }))

const has = vi.fn<(id: string) => Promise<boolean>>()
const save = vi.fn<(id: string) => Promise<unknown>>()
const startEpisode = vi.fn()

const SAMPLE_PODCAST = {
  id: 'p1',
  type: 'single',
  article_ids: ['a1', 'a2'],
  difficulty: 'ielts_7',
  audio_url: 'https://storage.example.com/audio.mp3',
  japanese_intro_text: 'これは日本語のイントロ全文です。詳細ページではすべてのテキストが表示されます。追加のテキストも含まれています。',
  duration_seconds: 1820,
  created_at: '2026-06-10T09:00:00+09:00',
  status: 'completed' as const,
  error_message: null,
  playback_position_seconds: 0,
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  // 既定は「未保存」に倒す。
  has.mockResolvedValue(false)
  save.mockResolvedValue({ ok: true, value: undefined })
  startEpisode.mockResolvedValue({ ok: true })
  double.pb = { offline: { has, save } }
  double.actions = { startEpisode }
})

function renderDetailPage(params = { id: 'p1' }) {
  return render(
    <AppProvider>
      <ToastProvider>
        <PodcastDetailPage params={Promise.resolve(params)} />
      </ToastProvider>
    </AppProvider>
  )
}

// ==========================================================
// Podcast 詳細 — 正常系
// ==========================================================
describe('PodcastDetailPage — normal', () => {
  test('Displays full japanese_intro_text (not truncated)', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockResolvedValue(SAMPLE_PODCAST),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      // 全文が表示されていること（詳細ページでは80文字制限なし）
      expect(screen.getByText(/追加のテキストも含まれています/)).toBeInTheDocument()
    })
  })

  test('Displays difficulty badge', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockResolvedValue(SAMPLE_PODCAST),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByText(/IELTS 7/)).toBeInTheDocument()
    })
  })

  test('Displays formatted duration', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockResolvedValue(SAMPLE_PODCAST),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      // 1820秒 → 30:20
      expect(screen.getByText(/30:20/)).toBeInTheDocument()
    })
  })

  test('Does not expose raw article IDs to the reader', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockResolvedValue(SAMPLE_PODCAST),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => screen.getByText(/これは日本語のイントロ全文です/))
    expect(screen.queryByText(/^a1$/)).not.toBeInTheDocument()
  })

  test('Has a back link to the podcast list (/podcast)', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockResolvedValue(SAMPLE_PODCAST),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByRole('link', { name: /一覧へ戻る/ })).toHaveAttribute('href', '/podcast')
    })
  })

  test('Has a play button', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockResolvedValue(SAMPLE_PODCAST),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /再生|play/i })).toBeInTheDocument()
    })
  })
})

// ==========================================================
// Podcast 詳細 — 再生（取り直し・位置の復元は usePlaybackActions().startEpisode と Coordinator の責務）
// ==========================================================
describe('PodcastDetailPage — play', () => {
  test('再生ボタンは usePlaybackActions().startEpisode(id) を呼ぶ (verifies: CI-P4-31)', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getPodcast: vi.fn().mockResolvedValue(SAMPLE_PODCAST),
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /再生|play/i })).toBeInTheDocument()
    })

    await userEvent.click(screen.getByRole('button', { name: /再生|play/i }))

    expect(startEpisode).toHaveBeenCalledTimes(1)
    expect(startEpisode).toHaveBeenCalledWith('p1')
  })
})

// ==========================================================
// Podcast 詳細 — トランスクリプト表示 (issue #162)
// ==========================================================
describe('PodcastDetailPage — transcript', () => {
  test('Given segments, displays each speaker label and text', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockResolvedValue({
        ...SAMPLE_PODCAST,
        segments: [
          { speaker: 'A', text: 'Good morning, everyone.' },
          { speaker: 'B', text: 'Thanks for joining us today.' },
        ],
      }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByText('Good morning, everyone.')).toBeInTheDocument()
      expect(screen.getByText('Thanks for joining us today.')).toBeInTheDocument()
    })
    // 話者ラベルはA/Bそれぞれ1件ずつ表示される
    expect(screen.getAllByText('A')).toHaveLength(1)
    expect(screen.getAllByText('B')).toHaveLength(1)
  })

  test('Given segments is null, shows fallback message without crashing and keeps existing content', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockResolvedValue({ ...SAMPLE_PODCAST, segments: null }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByText(/トランスクリプトはありません/)).toBeInTheDocument()
    })
    // 既存表示（イントロ・再生ボタン）が壊れていないこと（回帰なし）
    expect(screen.getByText(/追加のテキストも含まれています/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /再生|play/i })).toBeInTheDocument()
  })

  test('Given segments field is entirely missing (legacy episode), shows fallback without crashing', async () => {
    const { createApiClient } = await import('@/lib/api')
    // segments フィールド自体が欠落した旧データを模擬
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockResolvedValue({ ...SAMPLE_PODCAST }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByText(/トランスクリプトはありません/)).toBeInTheDocument()
    })
  })
})

// ==========================================================
// Podcast 詳細 — 語彙グロッサリ (vocabulary)
// ==========================================================
describe('PodcastDetailPage — vocabulary glossary', () => {
  test('registers a glossary term with podcast_id + term and changes to the subdued registered state', async () => {
    const saveVocabulary = vi.fn().mockResolvedValue({
      vocabulary_id: 'p1__accelerate',
      podcast_id: 'p1',
      term: 'accelerate',
      meaning: '加速する',
      example: 'The car began to accelerate quickly.',
      registered_at: '2026-07-29T00:00:00Z',
    })
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockResolvedValue({
        ...SAMPLE_PODCAST,
        vocabulary: [
          { term: 'accelerate', meaning_ja: '加速する', example: 'The car began to accelerate quickly.' },
        ],
      }),
      saveVocabulary,
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()
    await userEvent.click(await screen.findByRole('button', { name: 'accelerate を習得' }))

    expect(saveVocabulary).toHaveBeenCalledWith('p1', 'accelerate')
    const registered = await screen.findByText('登録済み')
    expect(registered).toHaveClass('vocabulary-registered')
    expect(screen.queryByRole('button', { name: 'accelerate を習得' })).not.toBeInTheDocument()
  })

  test('Given vocabulary entries, displays term / meaning_ja / example for each entry', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockResolvedValue({
        ...SAMPLE_PODCAST,
        vocabulary: [
          { term: 'accelerate', meaning_ja: '加速する', example: 'The car began to accelerate quickly.' },
          { term: 'quarter', meaning_ja: '四半期', example: 'Profits rose in the third quarter.' },
        ],
      }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /語彙/ })).toBeInTheDocument()
    })
    expect(screen.getByText('accelerate')).toBeInTheDocument()
    expect(screen.getByText('加速する')).toBeInTheDocument()
    expect(screen.getByText(/The car began to accelerate quickly\./)).toBeInTheDocument()
    expect(screen.getByText('quarter')).toBeInTheDocument()
    expect(screen.getByText('四半期')).toBeInTheDocument()
  })

  test('Given vocabulary is null (legacy episode), hides the section and keeps existing content', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockResolvedValue({ ...SAMPLE_PODCAST, vocabulary: null }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      // 既存表示（イントロ）が壊れていないこと（回帰なし）
      expect(screen.getByText(/追加のテキストも含まれています/)).toBeInTheDocument()
    })
    expect(screen.queryByRole('heading', { name: /語彙/ })).not.toBeInTheDocument()
  })

  test('Given vocabulary field is entirely missing (legacy episode), hides the section without crashing', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockResolvedValue({ ...SAMPLE_PODCAST }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /再生|play/i })).toBeInTheDocument()
    })
    expect(screen.queryByRole('heading', { name: /語彙/ })).not.toBeInTheDocument()
  })

  test('Given vocabulary is an empty array, hides the section', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockResolvedValue({ ...SAMPLE_PODCAST, vocabulary: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /再生|play/i })).toBeInTheDocument()
    })
    expect(screen.queryByRole('heading', { name: /語彙/ })).not.toBeInTheDocument()
  })

  test('Given a vocabulary term appears in the transcript, highlights it with a <mark>', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockResolvedValue({
        ...SAMPLE_PODCAST,
        segments: [{ speaker: 'A', text: 'The economy will accelerate next quarter.' }],
        vocabulary: [
          { term: 'accelerate', meaning_ja: '加速する', example: 'Sales accelerated fast.' },
        ],
      }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByText('accelerate', { selector: 'mark' })).toBeInTheDocument()
    })
  })
})

// ==========================================================
// Podcast 詳細 — 理解度チェッククイズ (ADR-070・F2)
// 正解キー（answer_index）はサーバのみが保持する。クライアントは Submit まで正解を持たず、
// 採点レスポンス（results[].correct_index）到着後にのみ正解を表示する。
// ==========================================================
describe('PodcastDetailPage — comprehension quiz (ADR-070)', () => {
  const SAMPLE_QUIZ = [
    {
      question: 'What does the article say about containerization?',
      options: [
        'It slows down deployment',
        'It has revolutionized application deployment',
        'It is only for large enterprises',
        'It replaces all networking',
      ],
    },
    {
      question: 'Where was the technology first adopted?',
      options: [
        'In small startups only',
        'In the cloud industry',
        'In government agencies',
        'In academic research labs',
      ],
    },
  ]

  const SAMPLE_GRADE_RESULT = {
    correct_count: 1,
    total: 2,
    correct_rate: 0.5,
    results: [
      { question_index: 0, selected_index: 1, correct_index: 1, is_correct: true },
      { question_index: 1, selected_index: 0, correct_index: 1, is_correct: false },
    ],
  }

  test('Given quiz questions, displays each question and its options', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockResolvedValue({ ...SAMPLE_PODCAST, quiz: SAMPLE_QUIZ }),
      submitQuizAnswers: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /理解度チェック/ })).toBeInTheDocument()
    })
    expect(
      screen.getByText(/What does the article say about containerization\?/)
    ).toBeInTheDocument()
    expect(screen.getByText(/Where was the technology first adopted\?/)).toBeInTheDocument()
    expect(
      screen.getByRole('radio', { name: 'It has revolutionized application deployment' })
    ).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'In the cloud industry' })).toBeInTheDocument()
  })

  test('Given quiz is null (legacy episode), hides the section and keeps existing content', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockResolvedValue({ ...SAMPLE_PODCAST, quiz: null }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByText(/追加のテキストも含まれています/)).toBeInTheDocument()
    })
    expect(screen.queryByRole('heading', { name: /理解度チェック/ })).not.toBeInTheDocument()
  })

  test('Given quiz field is entirely missing (legacy episode), hides the section without crashing', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockResolvedValue({ ...SAMPLE_PODCAST }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /再生|play/i })).toBeInTheDocument()
    })
    expect(screen.queryByRole('heading', { name: /理解度チェック/ })).not.toBeInTheDocument()
  })

  test('Given quiz is an empty array, hides the section', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockResolvedValue({ ...SAMPLE_PODCAST, quiz: [] }),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /再生|play/i })).toBeInTheDocument()
    })
    expect(screen.queryByRole('heading', { name: /理解度チェック/ })).not.toBeInTheDocument()
  })

  test('Submit button is disabled until every question has a selected answer', async () => {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockResolvedValue({ ...SAMPLE_PODCAST, quiz: SAMPLE_QUIZ }),
      submitQuizAnswers: vi.fn(),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()
    await waitFor(() => screen.getByRole('heading', { name: /理解度チェック/ }))

    const submitButton = screen.getByRole('button', { name: '採点する' })
    expect(submitButton).toBeDisabled()

    await userEvent.click(
      screen.getByRole('radio', { name: 'It has revolutionized application deployment' })
    )
    expect(submitButton).toBeDisabled()

    await userEvent.click(screen.getByRole('radio', { name: 'In the cloud industry' }))
    expect(submitButton).toBeEnabled()
  })

  test('Submitting sends the selected answer indices in question order', async () => {
    const submitQuizAnswers = vi.fn().mockResolvedValue(SAMPLE_GRADE_RESULT)
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockResolvedValue({ ...SAMPLE_PODCAST, quiz: SAMPLE_QUIZ }),
      submitQuizAnswers,
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()
    await waitFor(() => screen.getByRole('heading', { name: /理解度チェック/ }))

    await userEvent.click(
      screen.getByRole('radio', { name: 'It has revolutionized application deployment' })
    ) // question 0 → index 1
    await userEvent.click(screen.getByRole('radio', { name: 'In small startups only' })) // question 1 → index 0
    await userEvent.click(screen.getByRole('button', { name: '採点する' }))

    expect(prepareSfx).toHaveBeenCalled()
    await waitFor(() => {
      expect(submitQuizAnswers).toHaveBeenCalledWith('p1', [1, 0])
    })
  })

  test('Shows the score and per-question correct/incorrect feedback from the graded response', async () => {
    const submitQuizAnswers = vi.fn().mockResolvedValue(SAMPLE_GRADE_RESULT)
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockResolvedValue({ ...SAMPLE_PODCAST, quiz: SAMPLE_QUIZ }),
      submitQuizAnswers,
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()
    await waitFor(() => screen.getByRole('heading', { name: /理解度チェック/ }))

    await userEvent.click(
      screen.getByRole('radio', { name: 'It has revolutionized application deployment' })
    )
    await userEvent.click(screen.getByRole('radio', { name: 'In small startups only' }))
    await userEvent.click(screen.getByRole('button', { name: '採点する' }))

    await waitFor(() => {
      expect(screen.getByText(/1 \/ 2/)).toBeInTheDocument()
    })
    // 正解の選択肢（correct_index）にマークが表示される（2問分）
    expect(screen.getAllByText('正解').length).toBeGreaterThan(0)
    // 不正解だった設問では、選択したものにマークが付く
    expect(screen.getByText('あなたの回答')).toBeInTheDocument()
    // WHY: 修正 5。正答率 50% (1/2) >= 0.5 のため 'correct' 音を再生
    expect(playSfx).toHaveBeenCalledWith('correct')
  })

  test('Given every answer is correct, shows a restrained Perfect stamp and correct feedback', async () => {
    const perfectResult = {
      correct_count: 2,
      total: 2,
      correct_rate: 1,
      results: [
        { question_index: 0, selected_index: 1, correct_index: 1, is_correct: true },
        { question_index: 1, selected_index: 1, correct_index: 1, is_correct: true },
      ],
    }
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockResolvedValue({ ...SAMPLE_PODCAST, quiz: SAMPLE_QUIZ }),
      submitQuizAnswers: vi.fn().mockResolvedValue(perfectResult),
    } as unknown as ReturnType<typeof createApiClient>)

    const { container } = renderDetailPage()
    await waitFor(() => screen.getByRole('heading', { name: /理解度チェック/ }))

    await userEvent.click(
      screen.getByRole('radio', { name: 'It has revolutionized application deployment' })
    )
    await userEvent.click(screen.getByRole('radio', { name: 'In the cloud industry' }))
    await userEvent.click(screen.getByRole('button', { name: '採点する' }))

    await waitFor(() => {
      expect(screen.getByText('Perfect')).toBeInTheDocument()
    })
    expect(container.querySelectorAll('.quiz-correct-mark')).toHaveLength(2)
    expect(playSfx).toHaveBeenCalledWith('correct')
  })

  test('Given the submission fails, shows an error message and keeps the quiz retryable', async () => {
    const submitQuizAnswers = vi.fn().mockRejectedValue(new Error('network error'))
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockResolvedValue({ ...SAMPLE_PODCAST, quiz: SAMPLE_QUIZ }),
      submitQuizAnswers,
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage()
    await waitFor(() => screen.getByRole('heading', { name: /理解度チェック/ }))

    await userEvent.click(
      screen.getByRole('radio', { name: 'It has revolutionized application deployment' })
    )
    await userEvent.click(screen.getByRole('radio', { name: 'In small startups only' }))
    await userEvent.click(screen.getByRole('button', { name: '採点する' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/採点に失敗しました/)
    })
    // クラッシュせず、再送信できる状態を維持する（未確定のまま留まり再試行可能）
    expect(screen.getByRole('button', { name: '採点する' })).toBeEnabled()
  })
})

// ==========================================================
// Podcast 詳細 — 404
// ==========================================================
describe('PodcastDetailPage — 404', () => {
  test('Given 404, shows "エピソードが見つかりません" and link to list', async () => {
    const { createApiClient, ApiError } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockRejectedValue(new ApiError(404, 'Podcast not found')),
    } as unknown as ReturnType<typeof createApiClient>)

    renderDetailPage({ id: 'missing' })

    await waitFor(() => {
      expect(screen.getByText(/エピソードが見つかりません/)).toBeInTheDocument()
    })

    // 一覧へ戻るリンクが存在する
    expect(screen.getByRole('link', { name: /一覧|戻る/i })).toHaveAttribute('href', '/podcast')
  })
})

// ==========================================================
// Podcast 詳細 — オフライン保存（issue #167）
// ==========================================================
describe('PodcastDetailPage — offline download (issue #167)', () => {
  async function loadSample() {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockResolvedValue(SAMPLE_PODCAST),
    } as unknown as ReturnType<typeof createApiClient>)
  }

  test('shows an オフライン保存 button once the episode is loaded (not yet saved)', async () => {
    await loadSample()

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'オフライン保存' })).toBeInTheDocument()
    })
    // offline.has は podcast 確定後の passive effect で呼ばれるため、ボタンの出現より遅れうる
    await waitFor(() => expect(has).toHaveBeenCalledWith('p1'))
  })

  test('保存に成功すると offline.save(id) を呼び、「保存済み」に切り替える (verifies: CI-P4-31)', async () => {
    await loadSample()
    renderDetailPage()
    await waitFor(() => screen.getByRole('button', { name: 'オフライン保存' }))

    await userEvent.click(screen.getByRole('button', { name: 'オフライン保存' }))

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('p1')
    await waitFor(() => {
      expect(screen.getByText('保存済み')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'オフライン保存' })).not.toBeInTheDocument()
    })
  })

  test('offline.has が true なら最初から「保存済み」で、再保存しない (verifies: CI-P4-31)', async () => {
    has.mockResolvedValue(true)
    await loadSample()

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByText('保存済み')).toBeInTheDocument()
    })
    expect(save).not.toHaveBeenCalled()
  })

  test.each([
    ['{ ok: false } を返す', () => save.mockResolvedValue({ ok: false, failure: { kind: 'storage_full' } })],
    ['reject する', () => save.mockRejectedValue(new Error('network error'))],
  ])('保存が %s と、エラー toast を出し、再試行できるまま (verifies: CI-P4-31)', async (_name, arrange) => {
    arrange()
    await loadSample()
    renderDetailPage()
    await waitFor(() => screen.getByRole('button', { name: 'オフライン保存' }))

    await userEvent.click(screen.getByRole('button', { name: 'オフライン保存' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/オフライン保存に失敗しました/)
    })
    // 失敗時は保存済みにならず、再試行できる
    expect(screen.queryByText('保存済み')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'オフライン保存' })).toBeInTheDocument()
  })

  test('offline.has が reject しても、保存ボタンは表示され続ける (verifies: CI-P4-31)', async () => {
    has.mockRejectedValue(new Error('cache open failed'))
    await loadSample()

    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'オフライン保存' })).toBeInTheDocument()
    })
  })
})

// ==========================================================
// 出典表示とライセンス表記（法務P0: CC BY/BY-SA 帰属義務、ADR-090）。
// ライセンス段落は featured 由来（source_kind === 'featured'）のときだけ表示する
// fail-closed 条件分岐（ADR-095, issue #240）。出典表示は source_kind に関わらず維持する。
// ==========================================================
describe('PodcastDetailPage — attribution', () => {
  const withSources = {
    ...SAMPLE_PODCAST,
    source_articles: [
      {
        article_id: 'a1',
        title: 'Understanding Rust Ownership',
        url: 'https://example.com/rust',
        source: 'EFF Deeplinks',
      },
      {
        article_id: 'a2',
        title: 'NASA Discovers Water',
        url: 'https://example.com/nasa',
        source: 'NASA News',
      },
    ],
  }

  function mockPodcast(podcast: unknown) {
    return import('@/lib/api').then(({ createApiClient }) => {
      vi.mocked(createApiClient).mockReturnValue({
        getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
        getPodcast: vi.fn().mockResolvedValue(podcast),
      } as unknown as ReturnType<typeof createApiClient>)
    })
  }

  test('Shows source name and original article link for each source', async () => {
    await mockPodcast(withSources)

    renderDetailPage()

    await waitFor(() => screen.getByText('EFF Deeplinks'))
    expect(screen.getByText('NASA News')).toBeInTheDocument()

    const link = screen.getByRole('link', { name: 'Understanding Rust Ownership' })
    expect(link).toHaveAttribute('href', 'https://example.com/rust')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'))
  })

  test('Shows CC BY-SA 4.0 license notice when source_kind is featured', async () => {
    await mockPodcast({ ...withSources, source_kind: 'featured' })

    renderDetailPage()

    await waitFor(() => screen.getByText(/CC BY-SA 4\.0/))
    const licenseLink = screen.getByRole('link', { name: /CC BY-SA 4\.0/ })
    expect(licenseLink).toHaveAttribute(
      'href',
      'https://creativecommons.org/licenses/by-sa/4.0/deed.ja'
    )
  })

  test.each([
    ['user', 'user'],
    ['unknown', 'unknown'],
    ['null', null],
    ['missing', undefined],
  ])(
    'Does not show CC BY-SA 4.0 license notice when source_kind is %s (fail-closed, ADR-095)',
    async (_label, sourceKind) => {
      const podcast =
        sourceKind === undefined ? withSources : { ...withSources, source_kind: sourceKind }
      await mockPodcast(podcast)

      renderDetailPage()

      // 出典を先に待ってから否定アサーションに移る。非同期描画完了前に判定すると
      // ライセンス段落が未描画なだけの偽陽性になる（trial-log feed-exclusion-web.md L66）。
      await waitFor(() => screen.getByText('EFF Deeplinks'))
      expect(screen.queryByText(/CC BY-SA 4\.0/)).not.toBeInTheDocument()
    }
  )

  test('Does not render raw article IDs', async () => {
    await mockPodcast(withSources)

    renderDetailPage()

    await waitFor(() => screen.getByText('EFF Deeplinks'))
    expect(screen.queryByText('記事ID:')).not.toBeInTheDocument()
  })

  test('Omits the attribution block when the podcast has no sources', async () => {
    await mockPodcast({ ...SAMPLE_PODCAST, source_articles: null })

    renderDetailPage()

    await waitFor(() => screen.getByText(/これは日本語のイントロ全文です/))
    expect(screen.queryByText('出典')).not.toBeInTheDocument()
    expect(screen.queryByText(/CC BY-SA 4\.0/)).not.toBeInTheDocument()
  })
})

// ==========================================================
// Podcast 詳細 — Episode 種別の描き分け（verifies: web-contract-14; web-test-15）
// 再生ボタン・オフライン保存は PlayableEpisode のときだけ。Failed は同じ位置に失敗の理由の文言を描く。
// 導入文・文字起こし・語彙・クイズ・出典は種別に関係なく、DTO に値があるかで決まる（現行のまま）。
// ==========================================================
describe('PodcastDetailPage — Episode kinds (web-contract-14)', () => {
  async function loadPodcast(podcast: unknown) {
    const { createApiClient } = await import('@/lib/api')
    vi.mocked(createApiClient).mockReturnValue({
      getVocabulary: vi.fn().mockResolvedValue({ vocabulary: [], count: 0 }),
      getPodcast: vi.fn().mockResolvedValue(podcast),
    } as unknown as ReturnType<typeof createApiClient>)
    renderDetailPage()
    await waitFor(() => screen.getByText(/これは日本語のイントロ全文です/))
  }

  const NOT_PLAYABLE: Array<[string, unknown, string | null]> = [
    ['shared-session-08: processing', { ...SAMPLE_PODCAST, status: 'processing', audio_url: '' }, null],
    [
      'shared-session-08: failed（quota_exhausted）',
      { ...SAMPLE_PODCAST, status: 'failed', error_message: 'quota_exhausted' },
      '生成の上限に達したため、生成できませんでした',
    ],
    [
      'shared-session-08: failed（自由文・generation_failed に畳む）',
      { ...SAMPLE_PODCAST, status: 'failed', error_message: 'something went wrong' },
      '生成に失敗しました',
    ],
    ['shared-session-09: partial_failed', { ...SAMPLE_PODCAST, status: 'partial_failed' }, '生成に失敗しました'],
    ['shared-session-08: 矛盾 DTO（completed なのに audio_url が空）', { ...SAMPLE_PODCAST, audio_url: '' }, '生成に失敗しました'],
    [
      'shared-session-08: 矛盾 DTO（completed なのに error_message が識別子）',
      { ...SAMPLE_PODCAST, error_message: 'quota_exhausted' },
      '生成の上限に達したため、生成できませんでした',
    ],
  ]

  test.each(NOT_PLAYABLE)('%s は再生ボタンとオフライン保存（保存済み）を描かない', async (_label, podcast) => {
    await loadPodcast(podcast)

    expect(screen.queryByRole('button', { name: '再生' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'オフライン保存' })).not.toBeInTheDocument()
    expect(screen.queryByText('保存済み')).not.toBeInTheDocument()
  })

  test.each(NOT_PLAYABLE)('%s の失敗の文言は、Failed のときだけ podcast-failure-message に描く', async (_label, podcast, message) => {
    await loadPodcast(podcast)

    if (message === null) {
      expect(screen.queryByTestId('podcast-failure-message')).not.toBeInTheDocument()
    } else {
      expect(screen.getByTestId('podcast-failure-message')).toHaveTextContent(message)
    }
  })

  test('正方向対照: 完成した DTO は再生ボタンとオフライン保存を描き、失敗の文言は描かない', async () => {
    await loadPodcast(SAMPLE_PODCAST)

    expect(screen.getByRole('button', { name: '再生' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'オフライン保存' })).toBeInTheDocument()
    expect(screen.queryByTestId('podcast-failure-message')).not.toBeInTheDocument()
  })

  test('導入文・難易度・長さは種別に関係なく描く（失敗のエピソードでも）', async () => {
    await loadPodcast({ ...SAMPLE_PODCAST, status: 'failed', error_message: 'quota_exhausted' })

    expect(screen.getByText(/追加のテキストも含まれています/)).toBeInTheDocument()
    expect(screen.getByText(/IELTS 7/)).toBeInTheDocument()
    expect(screen.getByText(/30:20/)).toBeInTheDocument()
  })
})
