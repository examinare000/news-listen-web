// @vitest-environment node
// export する型の可変性の検査（web-check-05 (b)）。DOMAIN・APP・shared の export する型に、readonly でない property・配列が 0 件。
// 判定は構文だけ（型の解決はしない）。正本: docs/design/modules/web/2026-09-30-implementation-spec-target-architecture.md §4 web-dep-09・§7 web-check-05。
//
// RED 理由（実装前）: lib/shared/** と lib/playback/domain/** が無い（走査した型名が揃わない）。
// lib/passkey.ts・lib/push/pushRegistration.ts の Promise<{ status: string }> 等・QueueState.items 等が readonly でない。
import { beforeAll, describe, expect, test } from 'vitest'
import { layerOf, listScanFiles, readSource } from '../helpers/architecture'
import { scanPublicTypes } from '../helpers/architectureDetectors'

/** 空振りの防止: 走査した export の名前に含まれるべき 10 個。 */
const MUST_BE_SCANNED = [
  'QueueState',
  'PlayableEpisode',
  'PlaybackState',
  'ApiFailure',
  'Result',
  'AdminAccessSession',
  'ResolvePlaybackInput',
  'PasskeyClient',
  'PushRegistrationApiClient',
  'GenerationLimit',
]

let targetFiles: string[]

beforeAll(() => {
  targetFiles = listScanFiles().filter((f) => {
    const layer = layerOf(f)
    return layer === 'DOMAIN' || layer === 'APP' || layer === 'SHARED'
  })
})

describe('web-check-05 (b) DOMAIN・APP・shared の export する型は readonly（構文で判定）', () => {
  test('readonly でない property と配列型（T[]・Array<T>）が 0 件。名前の除外は無く、APP の AudioElement も走査される', () => {
    const scans = targetFiles.map((f) => ({ file: f, scan: scanPublicTypes(f, readSource(f), []) }))
    expect(scans.flatMap((s) => s.scan.violations)).toEqual([])
    const appExports = scans.filter((s) => layerOf(s.file) === 'APP').flatMap((s) => s.scan.exportedNames)
    expect(appExports, 'AudioElement が APP の走査集合に無い').toContain('AudioElement')
  })

  test('走査した export の名前が 10 個（QueueState・PlayableEpisode・PlaybackState・ApiFailure・Result・AdminAccessSession・ResolvePlaybackInput・PasskeyClient・PushRegistrationApiClient・GenerationLimit）を含む', () => {
    const scanned = new Set(targetFiles.flatMap((f) => scanPublicTypes(f, readSource(f), []).exportedNames))
    expect(MUST_BE_SCANNED.filter((n) => !scanned.has(n))).toEqual([])
  })

  test('反例: 操作だけの AudioElement は違反 0 件、書き込める property（src）を足すと違反 1 件', () => {
    const ports = 'lib/playback/application/ports.ts'
    expect(scanPublicTypes(ports, readSource(ports), []).violations).toEqual([])
    const writable = readSource(ports).replace('export interface AudioElement {', 'export interface AudioElement {\n  src: string')
    expect(scanPublicTypes(ports, writable, []).violations).toEqual([`${ports}: AudioElement: readonly の無い property src`])
  })
})

describe('web-check-05 (b) 検出器の自己点検: 正例を拾い、負例を拾わない', () => {
  const scan = (source: string, excluded: readonly string[] = []): string[] =>
    scanPublicTypes('lib/playback/domain/x.ts', source, excluded).violations.map((v) => v.replace('lib/playback/domain/x.ts: ', ''))

  test('正例: readonly の無い property・T[]・Array<T>・関数の署名の中の object 型', () => {
    expect(scan('export interface A { name: string }')).toEqual(['A: readonly の無い property name'])
    expect(scan('export interface A { readonly tags: string[] }')).toEqual(['A: 配列型 string[]'])
    expect(scan('export type B = { readonly tags: Array<string> }')).toEqual(['B: 配列型 Array<string>'])
    expect(scan('export function f(): Promise<{ status: string }> { return Promise.resolve({ status: "" }) }')).toEqual([
      'f: readonly の無い property status',
    ])
    expect(scan('export function g(xs: number[]): void {}')).toEqual(['g: 配列型 number[]'])
    expect(scan('export interface C { m(arg: { v: string }): void }')).toEqual(['C: readonly の無い property v'])
  })

  test('負例: readonly の property・ReadonlyArray・readonly T[]・メソッド宣言そのもの・除外した型・export しない宣言', () => {
    expect(scan('export interface A { readonly name: string; readonly tags: ReadonlyArray<string>; readonly ids: readonly number[] }')).toEqual([])
    expect(scan('export interface A { release(): void; load(): Promise<void> }')).toEqual([])
    expect(scan('export type B = { readonly kind: "a" } | { readonly kind: "b"; readonly n: number }')).toEqual([])
    expect(scan('export interface AudioElement { src: string; currentTime: number }', ['AudioElement'])).toEqual([])
    expect(scan('interface Local { name: string; tags: string[] }')).toEqual([])
    expect(scan('export function h(): Promise<{ readonly status: string }> { return Promise.resolve({ status: "" }) }')).toEqual([])
  })

  test('export した名前を集める（interface・type・function・const）', () => {
    const { exportedNames } = scanPublicTypes(
      'lib/playback/domain/x.ts',
      'export interface A {}\nexport type B = number\nexport function f() {}\nexport const C = 1\nconst hidden = 2',
      [],
    )
    expect(exportedNames).toEqual(['A', 'B', 'f', 'C'])
  })
})
