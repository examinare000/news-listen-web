// @vitest-environment node
// 規則の置き場の検査（web-check-04）。規則の表（12 行）の式に当たる出現（出てよいファイル以外）の実測 ＝ 許可リスト。
// 正本: docs/design/modules/web/2026-09-30-implementation-spec-target-architecture.md §7 web-check-04 の規則の表。
//
// RED 理由（実装前）: architecture/boundaries.allowlist.json が無い。検出器の正例・負例は helper だけで決まるので green。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, test } from 'vitest'
import { WEB_ROOT, listScanFiles, readAllowlistRowsStrict, readSource, rowKeys, type Row } from '../helpers/architecture'
import { RULE_DEFINITIONS, detectRuleRows } from '../helpers/architectureDetectors'

const EXPECTED_RULES = [
  'web-rule-catalog-01',
  'web-rule-catalog-02',
  'web-rule-catalog-03',
  'web-rule-catalog-06',
  'web-rule-account-03',
  'web-rule-account-06',
  'web-rule-playback-02',
  'web-rule-prefs-01',
  'web-rule-learning-01',
  'web-rule-learning-02',
  'web-rule-learning-03',
  'web-dep-08',
]

let scanFiles: string[]

beforeAll(() => {
  scanFiles = listScanFiles()
})

describe('web-check-04 規則の表', () => {
  test('規則の表は 12 行で、rule の集合が正本の表と一致する', () => {
    expect(RULE_DEFINITIONS.map((d) => d.rule)).toEqual(EXPECTED_RULES)
  })

  test('式に正規表現の lookbehind を使わない（TS の target 検査の危険。_at の除外は一致位置の直前の識別子をコードで調べる）', () => {
    const text = readFileSync(path.join(WEB_ROOT, 'tests/helpers/architectureDetectors.ts'), 'utf8')
    expect(text).not.toMatch(/\(\?<[=!]/)
  })

  test('規則ごとの「出てよいファイル以外の出現」の集合 ＝ 許可リストの同じ rule の行（走査集合は types/** を除く）', () => {
    const measured: Row[] = scanFiles
      .filter((f) => !f.startsWith('types/'))
      .flatMap((f) => detectRuleRows(f, readSource(f)))
    const expected = readAllowlistRowsStrict().filter((r) => EXPECTED_RULES.includes(r.rule))
    expect(rowKeys(measured)).toEqual(rowKeys(expected))
  })
})

describe('web-check-04 検出器の自己点検: 正例を拾い、負例を拾わない', () => {
  const rows = (file: string, source: string): string[] => rowKeys(detectRuleRows(file, source))
  const F = 'components/X.tsx'

  test('web-rule-learning-03: session.items.slice(0, 10) は拾い、created_at.slice(0, 10)・item.registered_at.slice(0, 10) は拾わない', () => {
    expect(rows(F, 'const a = session.items.slice(0, 10)')).toEqual([`web-rule-learning-03 | ${F} | slice(0, 10)`])
    expect(rows(F, 'const a = created_at.slice(0, 10)')).toEqual([])
    expect(rows(F, 'const a = item.registered_at.slice(0, 10)')).toEqual([])
    expect(rows(F, 'const a = items.slice(0, 3)')).toEqual([`web-rule-learning-03 | ${F} | slice(0, 3)`])
    expect(rows(F, 'const a = r.retest_correct')).toEqual([`web-rule-learning-03 | ${F} | retest_correct`])
  })

  test('web-rule-account-03: password.length と deleteAccountPassword.length は同じファイルで (rule, file, password.length) の 1 行にまとまる', () => {
    const source = ['if (password.length < 8) {}', 'if (deleteAccountPassword.length === 0) {}'].join('\n')
    expect(rows(F, source)).toEqual([`web-rule-account-03 | ${F} | password.length`])
    expect(rows(F, 'const m = PASSWORD_MIN_LENGTH + countPasswordCharacterClasses(p)')).toEqual([
      `web-rule-account-03 | ${F} | PASSWORD_MIN_LENGTH`,
      `web-rule-account-03 | ${F} | countPasswordCharacterClasses`,
    ])
  })

  test('web-rule-catalog-01 と web-rule-catalog-06: 同じ行が両方に当たるときは web-rule-catalog-06 だけに数える。web-rule-catalog-01 は別の行・左右反転・空判定を拾う', () => {
    expect(rows(F, "if (prevStatus !== 'completed' && p.status === 'completed') {}")).toEqual([
      `web-rule-catalog-06 | ${F} | !== 'completed' && … === 'completed'`,
    ])
    expect(rows(F, "const done = p.status === 'completed'")).toEqual([`web-rule-catalog-01 | ${F} | .status と生成状態の比較`])
    expect(rows(F, "const failed = 'failed' === p.status")).toEqual([`web-rule-catalog-01 | ${F} | .status と生成状態の比較`])
    expect(rows(F, 'if (p.audio_url === null) {}')).toEqual([`web-rule-catalog-01 | ${F} | audio_url/error_message の空・null 判定`])
    expect(rows(F, 'if (!p.error_message) {}')).toEqual([`web-rule-catalog-01 | ${F} | audio_url/error_message の空・null 判定`])
    expect(rows(F, "const ok = p.title === 'completed'")).toEqual([])
  })

  test('web-rule-catalog-02・CT-3・CT-6・AC-6・LN-1・LN-2 の式', () => {
    expect(rows(F, 'const t = p.intro_text.slice(0, 20)')).toEqual([`web-rule-catalog-02 | ${F} | intro_text.slice(`])
    expect(rows(F, 'const t = intro.slice(0, 20)')).toEqual([`web-rule-catalog-02 | ${F} | intro.slice(`])
    expect(rows(F, 'const r = /monthly/i.test(x); const s = 86400')).toEqual([
      `web-rule-catalog-03 | ${F} | /monthly/i`,
      `web-rule-catalog-03 | ${F} | 86400`,
    ])
    expect(rows(F, 'const t = POLL_TIMEOUT_MS')).toEqual([`web-rule-catalog-06 | ${F} | POLL_TIMEOUT_MS`])
    expect(rows(F, "if (user.role === 'admin') {}")).toEqual([`web-rule-account-06 | ${F} | role === 'admin'`])
    expect(rows(F, 'const g = 5 * 60 * 1000')).toEqual([`web-rule-learning-01 | ${F} | 5 * 60 * 1000`])
    expect(rows(F, 'if (score >= 0.5) {}')).toEqual([`web-rule-learning-02 | ${F} | >= 0.5`])
  })

  test('web-rule-playback-02・web-rule-prefs-01: 配列リテラル（速度 3 値すべて・難易度の値 2 つ以上）と [3, 5, 7, 10]', () => {
    expect(rows(F, 'const s = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0]')).toEqual([`web-rule-playback-02 | ${F} | 速度の配列`])
    expect(rows(F, 'const s = [0.75, 1.25]')).toEqual([])
    expect(rows(F, "const d = ['toeic_600', 'ielts_7']")).toEqual([`web-rule-prefs-01 | ${F} | 難易度の値の配列`])
    expect(rows(F, "const d = ['toeic_600']")).toEqual([])
    expect(rows(F, 'const n = [3, 5, 7, 10]')).toEqual([`web-rule-prefs-01 | ${F} | [3, 5, 7, 10]`])
    expect(rows(F, 'const n = [3, 5, 7, 11]')).toEqual([])
  })

  test('web-dep-08: .status と数値の比較（左右反転を含む）。status と文字列の比較は拾わない', () => {
    expect(rows(F, 'if (res.status >= 500) {}')).toEqual([`web-dep-08 | ${F} | .status と数値の比較`])
    expect(rows(F, 'if (404 === err.status) {}')).toEqual([`web-dep-08 | ${F} | .status と数値の比較`])
    expect(rows(F, "if (res.status === 'ok') {}")).toEqual([])
  })

  test('コメントの中の出現は数えない。文字列・正規表現の中は数える', () => {
    expect(rows(F, '// password.length と POLL_TIMEOUT_MS は書かない\n/** 5 * 60 * 1000 */\nconst a = 1')).toEqual([])
    expect(rows(F, "const url = 'https://example.com//x'; const n = POLL_TIMEOUT_MS")).toEqual([`web-rule-catalog-06 | ${F} | POLL_TIMEOUT_MS`])
  })

  test('出てよいファイルは数えない。86400 は lib/format.ts を除外する', () => {
    expect(rows('lib/learning/domain/streak.ts', 'const g = 5 * 60 * 1000')).toEqual([])
    expect(rows('lib/shared/difficulty.ts', "export const D = ['toeic_600', 'ielts_7']")).toEqual([])
    expect(rows('lib/api/gateway.ts', 'if (res.status === 401) {}')).toEqual([])
    expect(rows('app/api/x/route.ts', 'if (res.status === 401) {}')).toEqual([])
    expect(rows('lib/format.ts', 'const day = 86400')).toEqual([])
    expect(rows('lib/format.ts', 'const r = /monthly/i')).toEqual([`web-rule-catalog-03 | lib/format.ts | /monthly/i`])
  })
})
