// architecture テストの共通部品（走査集合・層の判定・import の収集・コメント除去・許可リストの読込）。
// テストファイルではない。検出器の本体は architectureDetectors.ts にある。
// 検査の正本: docs/design/modules/web/2026-09-30-implementation-spec-target-architecture.md §4・§7。
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import ts from 'typescript'

export const WEB_ROOT = path.resolve(__dirname, '../..')
const ALLOWLIST_RELATIVE_PATH = 'architecture/boundaries.allowlist.json'
const ALLOWLIST_PATH = path.join(WEB_ROOT, ALLOWLIST_RELATIVE_PATH)

/** 走査するディレクトリ（新 Spec §7 TA-V2 の量化集合）。 */
const SCAN_DIRS = ['lib', 'app', 'components', 'hooks', 'contexts', 'types'] as const

// ---------------------------------------------------------------------------
// 走査集合 F
// ---------------------------------------------------------------------------

/**
 * `git ls-files --cached --others --exclude-standard` の `.ts`/`.tsx`（`.d.ts` を含む）のうち、実在するもの。
 * git が使えない・結果が空なら throw する（黙って 0 件で通らない）。
 */
export function listScanFiles(): string[] {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...SCAN_DIRS],
    { cwd: WEB_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  )
  const files = out
    .split('\n')
    .filter((f) => /\.tsx?$/.test(f))
    .filter((f) => existsSync(path.join(WEB_ROOT, f)))
  if (files.length === 0) throw new Error('走査集合 F が空: git ls-files の出力が 0 件')
  return [...new Set(files)].sort()
}

const sourceCache = new Map<string, string>()
export function readSource(relativePath: string): string {
  let source = sourceCache.get(relativePath)
  if (source === undefined) {
    source = readFileSync(path.join(WEB_ROOT, relativePath), 'utf8')
    sourceCache.set(relativePath, source)
  }
  return source
}

// ---------------------------------------------------------------------------
// 層の判定（新 Spec §4）
// ---------------------------------------------------------------------------

export type Layer = 'DOMAIN' | 'APP' | 'SHARED' | 'INFRA' | 'PRES' | 'ROOT' | 'OUTSIDE'

/**
 * 層の glob（`lib/*\/application/**`）がまだ 0 ファイルのため、APP とみなす現状の 2 ファイルと、
 * その移動先の context（新 Spec §3.2）。
 */
const LEGACY_APP_FILES: Readonly<Record<string, string>> = {
  'lib/passkey.ts': 'account',
  'lib/push/pushRegistration.ts': 'notifications',
}

const stripExtension = (p: string): string => p.replace(/\.d\.ts$|\.tsx?$/, '')

const LEGACY_APP_MODULES = new Set(Object.keys(LEGACY_APP_FILES).map(stripExtension))

/** web root 起点の path（拡張子はあってもなくてもよい）の層。 */
export function layerOf(p: string): Layer {
  const m = stripExtension(p)
  if (LEGACY_APP_MODULES.has(m)) return 'APP'
  if (/^lib\/[^/]+\/domain(\/|$)/.test(m)) return 'DOMAIN'
  if (/^lib\/[^/]+\/application(\/|$)/.test(m)) return 'APP'
  if (m === 'lib/shared' || m.startsWith('lib/shared/')) return 'SHARED'
  if (
    /^lib\/[^/]+\/infrastructure(\/|$)/.test(m) ||
    m.startsWith('lib/api/') ||
    m.startsWith('lib/platform/') ||
    m === 'types' ||
    m.startsWith('types/') ||
    m === 'lib/config'
  ) {
    return 'INFRA'
  }
  if (m === 'app/layout' || m === 'app/(app)/layout') return 'ROOT'
  if (m === 'contexts' || m.startsWith('contexts/')) return 'ROOT'
  if (m.startsWith('app/api/')) return 'OUTSIDE'
  if (
    m.startsWith('app/') ||
    m.startsWith('components/') ||
    m.startsWith('hooks/') ||
    /^lib\/[^/]+\/presentation(\/|$)/.test(m) ||
    m.startsWith('lib/presentation/')
  ) {
    return 'PRES'
  }
  return 'OUTSIDE'
}

/** DOMAIN・APP のファイル（または解いた先）の context。該当しなければ null。 */
export function contextOf(p: string): string | null {
  const m = stripExtension(p)
  const legacy = LEGACY_APP_FILES[`${m}.ts`]
  if (legacy !== undefined) return legacy
  const hit = /^lib\/([^/]+)\/(domain|application)(\/|$)/.exec(m)
  return hit ? hit[1] : null
}

/** eslint の境界の規則（@typescript-eslint/no-restricted-imports）が有効であるべきファイルか。 */
export function expectsBoundaryRule(p: string): boolean {
  const layer = layerOf(p)
  if (layer === 'DOMAIN' || layer === 'APP' || layer === 'PRES') return true
  return p.startsWith('contexts/') || p.startsWith('lib/api/') || p.startsWith('lib/platform/')
}

// ---------------------------------------------------------------------------
// 構文木・コメント
// ---------------------------------------------------------------------------

export function parseSource(fileName: string, source: string): ts.SourceFile {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind)
}

const isJsDocNode = (node: ts.Node): boolean =>
  node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode

/** コメントを同じ長さの空白（改行は残す）に置き換えた本文。文字列・正規表現・テンプレートの中は触らない。 */
export function stripComments(fileName: string, source: string): string {
  const sf = parseSource(fileName, source)
  const ranges = new Map<number, number>()
  const addAll = (found: ts.CommentRange[] | undefined): void => {
    for (const r of found ?? []) ranges.set(r.pos, r.end)
  }
  const visit = (node: ts.Node): void => {
    if (isJsDocNode(node)) return
    const children = node.getChildren(sf)
    if (children.length > 0) {
      children.forEach(visit)
      return
    }
    if (node.kind === ts.SyntaxKind.JsxText) return
    addAll(ts.getLeadingCommentRanges(source, node.pos))
    addAll(ts.getTrailingCommentRanges(source, node.end))
  }
  visit(sf)
  let out = ''
  let cursor = 0
  for (const [pos, end] of [...ranges.entries()].sort((a, b) => a[0] - b[0])) {
    out += source.slice(cursor, pos) + source.slice(pos, end).replace(/[^\n]/g, ' ')
    cursor = end
  }
  return out + source.slice(cursor)
}

// ---------------------------------------------------------------------------
// import の収集（新 Spec §7 TA-V2 の定義）
// ---------------------------------------------------------------------------

export interface ImportRecord {
  readonly specifier: string
  readonly kind: 'import' | 'export' | 'dynamic' | 'require'
  /** 構文で決める「型だけの import」: import type・export type … from・指定子がすべて type 修飾子つき。 */
  readonly typeOnly: boolean
  readonly hasDefault: boolean
  readonly hasNamespace: boolean
  readonly hasStarExport: boolean
  /** `type` 修飾子の無い名前つきの指定子の名前。 */
  readonly valueNames: readonly string[]
  readonly typeNames: readonly string[]
  /** web root 起点で解いた path（拡張子なし）。パッケージは null。 */
  readonly resolved: string | null
}

function resolveModule(fromFile: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) return specifier.slice(2)
  if (specifier.startsWith('.')) {
    return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier))
  }
  return null
}

/** `import { A as B }` の A（相手の module が export している名前）。 */
const importedName = (e: ts.ImportSpecifier | ts.ExportSpecifier): string => (e.propertyName ?? e.name).text

const stringOf = (node: ts.Node | undefined): string | null =>
  node !== undefined && ts.isStringLiteralLike(node) ? node.text : null

export function collectImports(fileName: string, source: string): ImportRecord[] {
  const sf = parseSource(fileName, source)
  const records: ImportRecord[] = []
  const push = (
    specifier: string,
    kind: ImportRecord['kind'],
    parts: Partial<Omit<ImportRecord, 'specifier' | 'kind' | 'resolved'>>,
  ): void => {
    records.push({
      specifier,
      kind,
      typeOnly: false,
      hasDefault: false,
      hasNamespace: false,
      hasStarExport: false,
      valueNames: [],
      typeNames: [],
      ...parts,
      resolved: resolveModule(fileName, specifier),
    })
  }

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      const specifier = stringOf(node.moduleSpecifier)
      if (specifier !== null) {
        const clause = node.importClause
        if (clause === undefined) {
          push(specifier, 'import', {})
        } else if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) {
          push(specifier, 'import', { typeOnly: true })
        } else {
          const hasDefault = clause.name !== undefined
          const bindings = clause.namedBindings
          const hasNamespace = bindings !== undefined && ts.isNamespaceImport(bindings)
          const elements = bindings !== undefined && ts.isNamedImports(bindings) ? bindings.elements : []
          const valueNames = elements.filter((e) => !e.isTypeOnly).map(importedName)
          const typeNames = elements.filter((e) => e.isTypeOnly).map(importedName)
          const typeOnly = !hasDefault && !hasNamespace && elements.length > 0 && valueNames.length === 0
          push(specifier, 'import', { typeOnly, hasDefault, hasNamespace, valueNames, typeNames })
        }
      }
    } else if (ts.isExportDeclaration(node)) {
      const specifier = stringOf(node.moduleSpecifier)
      if (specifier !== null) {
        const clause = node.exportClause
        if (node.isTypeOnly) {
          push(specifier, 'export', { typeOnly: true })
        } else if (clause === undefined) {
          push(specifier, 'export', { hasStarExport: true })
        } else if (ts.isNamespaceExport(clause)) {
          push(specifier, 'export', { hasNamespace: true })
        } else {
          const valueNames = clause.elements.filter((e) => !e.isTypeOnly).map(importedName)
          const typeNames = clause.elements.filter((e) => e.isTypeOnly).map(importedName)
          push(specifier, 'export', {
            typeOnly: clause.elements.length > 0 && valueNames.length === 0,
            valueNames,
            typeNames,
          })
        }
      }
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = stringOf(node.arguments[0])
      if (specifier !== null) push(specifier, 'dynamic', {})
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const specifier = stringOf(node.moduleReference.expression)
      if (specifier !== null) push(specifier, 'require', {})
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      const specifier = stringOf(node.argument.literal)
      if (specifier !== null) push(specifier, 'dynamic', { typeOnly: true })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return records
}

// ---------------------------------------------------------------------------
// 許可リスト（TP-A1）
// ---------------------------------------------------------------------------

export interface Row {
  readonly rule: string
  readonly file: string
  readonly specifier: string
}

const rowKey = (r: Row): string => `${r.rule} | ${r.file} | ${r.specifier}`

/** 行の集合を、重複を除いた辞書順の文字列配列にする（toEqual の比較用）。 */
export function rowKeys(rows: readonly Row[]): string[] {
  return [...new Set(rows.map(rowKey))].sort()
}

export interface AllowlistRow extends Row {
  readonly introducedBy: string
  readonly removeBy: string
}

/** 厳格な読込（許可リストの検査用）。ファイルが無くても落ちる。 */
export function readAllowlistText(): string {
  return readFileSync(ALLOWLIST_PATH, 'utf8')
}

export function readAllowlistRowsStrict(): AllowlistRow[] {
  const parsed: unknown = JSON.parse(readAllowlistText())
  if (!Array.isArray(parsed)) throw new Error('許可リストの最上位が配列でない')
  return parsed as AllowlistRow[]
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

/**
 * eslint の禁止項目の検査で、許可リストの precondition 用に使う `(file, specifier)` の読込。
 * ファイルが無い（ENOENT）ときだけ空の集合を返す（許可リストをまだ作っていない状態）。
 * ほかの読込エラー・JSON の破損・要素に文字列の file / specifier が無いときは throw する。
 * `existsSync` で先に見ない（読込との間に差を作らない）。
 */
export function readAllowlistFileSpecifierPairs(): ReadonlyArray<{ readonly file: string; readonly specifier: string }> {
  let text: string
  try {
    text = readFileSync(ALLOWLIST_PATH, 'utf8')
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return []
    throw error
  }
  const parsed: unknown = JSON.parse(text)
  if (!Array.isArray(parsed)) throw new Error('許可リストの最上位が配列でない')
  return parsed.map((row: unknown, index) => {
    const candidate = row as { file?: unknown; specifier?: unknown } | null
    if (typeof candidate?.file !== 'string' || typeof candidate.specifier !== 'string') {
      throw new Error(`許可リストの ${index} 行目に文字列の file / specifier が無い`)
    }
    return { file: candidate.file, specifier: candidate.specifier }
  })
}
