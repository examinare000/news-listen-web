// 型の readonly の検査（web-check-05 (a)）。外へ渡した値から内部を書き換えられないことを型で固定する。
// `npm run typecheck` / `npm run typecheck:ts7` が検査する（使われない `@ts-expect-error` は TS2578 で落ちる）。
// 宣言は `QueueState` を名前で書かず、変更の前後どちらでも解決できる形（Parameters<typeof …>）にする。
//
// RED 理由（実装前）: `@/lib/playback/domain/*` が無く typecheck が module not found で落ちる。
// 移動の後・generic 化の前の typecheck では、変更を確かめる 6 行の `@ts-expect-error` が使われず TS2578 になる。
import { describe, expect, test } from 'vitest'
import { add, advance, current, jump, upNext } from '@/lib/playback/domain/queue'
import type { PlaybackState } from '@/lib/playback/domain/session'
import type { PlayableEpisode, QueuedEpisode } from '@/lib/catalog/domain/episode'

declare const q: Parameters<typeof upNext>[0]
declare const x: Parameters<typeof add>[1]
declare const s: PlaybackState
declare const ep: PlayableEpisode
declare const qe: QueuedEpisode

/** 呼ばない。型検査だけが読む。 */
function typeProbes(): void {
  // 宣言の型を確かめる正の行（@ts-expect-error なし。q・x が unknown や any に解けたら typecheck が落ちる）
  const probeId: string = current(q)!.id
  const probeX: string = x.id
  add(q, x)
  void probeId
  void probeX

  // 変更を確かめる行（web-check-05 (a)。変更前は型エラーでない）
  // @ts-expect-error web-check-05(a) 変更前は型エラーでない: items は可変配列
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- 型エラーの行を lint が any と解釈する（変更後は push が無い）
  q.items.push(x)
  // @ts-expect-error web-check-05(a) 変更前は型エラーでない: upNext の戻り値は可変配列
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- 型エラーの行を lint が any と解釈する（変更後は push が無い）
  upNext(q).push(x)
  // @ts-expect-error web-check-05(a) 変更前は型エラーでない: upNext の戻り値は可変配列
  upNext(q)[0] = x
  // @ts-expect-error web-check-05(a) 変更前は型エラーでない: 要素の id は可変
  current(q)!.id = 'x'
  // @ts-expect-error web-check-05(a) 変更前は型エラーでない: jump の戻り値の field は可変
  jump(q, 'a').found = true
  // @ts-expect-error web-check-05(a) 変更前は型エラーでない: advance の戻り値の field は可変
  advance(q).next = null

  // 回帰を固定する行（web-check-05 (a)。変更前から型エラー。PlayableEpisode.title は既に readonly）
  // @ts-expect-error web-check-05(a) 変更前から型エラー: title は readonly
  if (s.status !== 'idle') s.episode.title = 'x'

  // Catalog の値の readonly（web-check-05 (a)。入れ子の配列・要素・label も書き込めない）
  // @ts-expect-error web-check-05(a) transcript は ReadonlyArray: push が無い
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- 型エラーの行を lint が any と解釈する（push が無い）
  ep.transcript!.push({ speaker: 'a', text: 'b' })
  // @ts-expect-error web-check-05(a) quiz の options は ReadonlyArray: push が無い
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call -- 型エラーの行を lint が any と解釈する（push が無い）
  ep.quiz![0].options.push('x')
  // @ts-expect-error web-check-05(a) sources の要素の field は readonly
  ep.sources![0].showsShareAlikeNotice = true
  // @ts-expect-error web-check-05(a) label の field は readonly
  qe.label.title = 'x'
}

describe('web-check-05 (a) 外へ渡した値は型で書き換えられない', () => {
  test('Queue の items・upNext・current・jump・advance の戻り値と Session の episode は書き込みが型エラー（検査は npm run typecheck）', () => {
    expect(typeof typeProbes).toBe('function')
  })
})
