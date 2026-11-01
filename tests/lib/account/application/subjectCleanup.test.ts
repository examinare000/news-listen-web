import { describe, test, expect, vi } from 'vitest'
import { createSubjectCleanup } from '@/lib/account/application/subjectCleanup'

// 主体離脱の後始末（共有仕様 §6.8 SubjectCleanup / web-dec-84）。
// 4 手順は関数の double で注入する。Subject はリテラルで作る。
// RED 理由（実装前）: `@/lib/account/application/subjectCleanup` が無い（module not found）。

type Order = string[]

function setup(overrides: Partial<Parameters<typeof createSubjectCleanup>[0]> = {}) {
  const order: Order = []
  const steps = {
    deleteAudio: vi.fn<(id: string) => Promise<void>>(async () => {
      order.push('deleteAudio')
    }),
    stopPlayback: vi.fn((): void | Promise<void> => {
      order.push('stopPlayback')
    }),
    clearServiceWorkerCaches: vi.fn(async () => {
      order.push('clearServiceWorkerCaches')
    }),
    clearSubjectSettings: vi.fn((): void | Promise<void> => {
      order.push('clearSubjectSettings')
    }),
    ...overrides,
  }
  return { order, steps, cleanup: createSubjectCleanup(steps) }
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve()
}

describe('subjectCleanup: 4 手順の順序 (verifies: shared-leave-01, web-dec-84)', () => {
  test('shared-leave-01 web-dec-84: 再生停止が最初で、続く 3 手順は返す関数を呼んだ同期区間のうちに呼ばれる', async () => {
    const { order, steps, cleanup } = setup()

    const pending = cleanup({ userId: 'u-a' }, { audio: true })

    // await を挟まずに 4 件とも呼ばれている（同期の (d) は同じ同期区間のまま進む）
    expect(order[0]).toBe('stopPlayback')
    expect(order.slice(1).sort()).toEqual(['clearServiceWorkerCaches', 'clearSubjectSettings', 'deleteAudio'])
    expect(steps.deleteAudio).toHaveBeenCalledWith('u-a')
    expect(await pending).toEqual({ ok: true })
  })

  test('shared-leave-02: audio: false では deleteAudio を呼ばず、他の 3 手順は 1 回ずつ', async () => {
    const { steps, cleanup } = setup()

    const result = await cleanup({ userId: 'u-a' }, { audio: false })

    expect(steps.deleteAudio).toHaveBeenCalledTimes(0)
    expect(steps.stopPlayback).toHaveBeenCalledTimes(1)
    expect(steps.clearServiceWorkerCaches).toHaveBeenCalledTimes(1)
    expect(steps.clearSubjectSettings).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: true })
  })

  test('web-dec-77: userId が null なら audio: true でも deleteAudio は呼ばず、他の 3 手順は実行する', async () => {
    const { steps, cleanup } = setup()

    const result = await cleanup({ userId: null }, { audio: true })

    expect(steps.deleteAudio).toHaveBeenCalledTimes(0)
    expect(steps.stopPlayback).toHaveBeenCalledTimes(1)
    expect(steps.clearServiceWorkerCaches).toHaveBeenCalledTimes(1)
    expect(steps.clearSubjectSettings).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: true })
  })
})

describe('subjectCleanup: 失敗の独立性 (verifies: shared-leave-04, web-dec-84)', () => {
  test('shared-leave-04: deleteAudio の reject と stopPlayback の同期 throw でも全手順が呼ばれ、失敗した手順が全部 incomplete に並ぶ', async () => {
    const { steps, cleanup } = setup({
      deleteAudio: vi.fn(async () => {
        throw new Error('delete failed')
      }),
      stopPlayback: vi.fn(() => {
        throw new Error('stop failed')
      }),
    })

    const result = await cleanup({ userId: 'u-a' }, { audio: true })

    expect(steps.deleteAudio).toHaveBeenCalledTimes(1)
    expect(steps.stopPlayback).toHaveBeenCalledTimes(1)
    expect(steps.clearServiceWorkerCaches).toHaveBeenCalledTimes(1)
    expect(steps.clearSubjectSettings).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: false, incomplete: ['audio', 'playback'] })
    expect(Object.isFrozen(result)).toBe(true)
    if (!result.ok) expect(Object.isFrozen(result.incomplete)).toBe(true)
  })

  test('shared-leave-04: 4 手順すべて失敗すると 4 名が audio・playback・serviceWorkerCaches・subjectSettings の順に並ぶ', async () => {
    const fail = () => {
      throw new Error('boom')
    }
    const { cleanup } = setup({
      deleteAudio: vi.fn(async () => fail()),
      stopPlayback: vi.fn(fail),
      clearServiceWorkerCaches: vi.fn(async () => fail()),
      clearSubjectSettings: vi.fn(fail),
    })

    const result = await cleanup({ userId: 'u-a' }, { audio: true })

    expect(result).toEqual({
      ok: false,
      incomplete: ['audio', 'playback', 'serviceWorkerCaches', 'subjectSettings'],
    })
  })

  test('shared-leave-04: 失敗の後に手順が成功へ替わった再実行で { ok: true } に収束する', async () => {
    let healthy = false
    const { cleanup } = setup({
      deleteAudio: vi.fn(async () => {
        if (!healthy) throw new Error('delete failed')
      }),
      clearSubjectSettings: vi.fn(() => {
        if (!healthy) throw new Error('settings failed')
      }),
    })

    const first = await cleanup({ userId: 'u-a' }, { audio: true })
    expect(first).toEqual({ ok: false, incomplete: ['audio', 'subjectSettings'] })

    healthy = true
    const second = await cleanup({ userId: 'u-a' }, { audio: true })
    expect(second).toEqual({ ok: true })
  })
})

describe('subjectCleanup: web-dec-84 の呼出順と同時開始', () => {
  test('web-dec-84: 再生停止が未解決の間は deleteAudio・clearServiceWorkerCaches・clearSubjectSettings は 0 回で、解決すると 3 件とも呼ばれる', async () => {
    let releaseStop: () => void = () => {}
    const { steps, cleanup } = setup({
      stopPlayback: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            releaseStop = resolve
          }),
      ),
    })

    const pending = cleanup({ userId: 'u-a' }, { audio: true })
    await flush()

    expect(steps.stopPlayback).toHaveBeenCalledTimes(1)
    expect(steps.deleteAudio).toHaveBeenCalledTimes(0)
    expect(steps.clearServiceWorkerCaches).toHaveBeenCalledTimes(0)
    expect(steps.clearSubjectSettings).toHaveBeenCalledTimes(0)

    releaseStop()
    expect(await pending).toEqual({ ok: true })
    expect(steps.deleteAudio).toHaveBeenCalledTimes(1)
    expect(steps.clearServiceWorkerCaches).toHaveBeenCalledTimes(1)
    expect(steps.clearSubjectSettings).toHaveBeenCalledTimes(1)
  })

  test('web-dec-84: deleteAudio が settle しなくても clearServiceWorkerCaches・clearSubjectSettings は呼ばれている（互いを待たない）', async () => {
    const { steps, cleanup } = setup({
      deleteAudio: vi.fn(() => new Promise<void>(() => {})),
    })

    void cleanup({ userId: 'u-a' }, { audio: true })
    await flush()

    expect(steps.deleteAudio).toHaveBeenCalledTimes(1)
    expect(steps.clearServiceWorkerCaches).toHaveBeenCalledTimes(1)
    expect(steps.clearSubjectSettings).toHaveBeenCalledTimes(1)
  })

  test('shared-leave-07 shared-leave-04: 再生停止が reject しても (a)(b)(c) は実行され、incomplete に playback が出る', async () => {
    const { steps, cleanup } = setup({
      stopPlayback: vi.fn(() => Promise.reject(new Error('stop rejected'))),
    })

    const result = await cleanup({ userId: 'u-a' }, { audio: true })

    expect(steps.deleteAudio).toHaveBeenCalledTimes(1)
    expect(steps.clearServiceWorkerCaches).toHaveBeenCalledTimes(1)
    expect(steps.clearSubjectSettings).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ ok: false, incomplete: ['playback'] })
  })
})
