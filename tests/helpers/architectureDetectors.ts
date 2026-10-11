// architecture テストの検出器（純関数。ファイルの path とソース文字列を受け取る）。
// テストファイルではない。各検出器の正例・負例は呼び出す側の architecture テストが自己点検する。
import ts from 'typescript'
import {
  contextOf,
  collectImports,
  layerOf,
  parseSource,
  stripComments,
  type ImportRecord,
  type Row,
} from './architecture'

// ---------------------------------------------------------------------------
// TA-D1・D2・D5・D6・D7・D12（import の向き）
// ---------------------------------------------------------------------------

/** 新 Spec §4 TA-D12 が許す context 間の向き（from → to）。 */
const ALLOWED_CROSS_CONTEXT: ReadonlyArray<readonly [string, string]> = [
  ['playback', 'catalog'],
  ['learning', 'catalog'],
  ['admin', 'catalog'],
  ['admin', 'account'],
]

const FORBIDDEN_FRAMEWORK_PACKAGES = (specifier: string): boolean =>
  specifier === 'react' || specifier === 'react-dom' || specifier === 'next' || specifier.startsWith('next/')

const PRES_FORBIDDEN_EXACT = new Set([
  'lib/api',
  'lib/audioCache',
  'lib/sfx',
  'lib/reportClientError',
  'lib/pushBrowserPort',
  'lib/webauthnBrowserPort',
  'lib/swCacheCleanup',
  'lib/config',
])

const isUnder = (resolved: string, dir: string): boolean => resolved === dir || resolved.startsWith(`${dir}/`)

function isPresForbiddenInfrastructure(resolved: string): boolean {
  return (
    PRES_FORBIDDEN_EXACT.has(resolved) ||
    isUnder(resolved, 'lib/api') ||
    isUnder(resolved, 'lib/platform') ||
    /^lib\/[^/]+\/infrastructure(\/|$)/.test(resolved)
  )
}

/** PRES が `lib/playback/domain/{session,queue}` から値を import する違反か。 */
function isPresPlaybackValueImport(imp: ImportRecord): boolean {
  if (imp.resolved === null || imp.typeOnly) return false
  if (imp.resolved === 'lib/playback/domain/queue') return true
  if (imp.resolved !== 'lib/playback/domain/session') return false
  const onlySpeeds =
    !imp.hasDefault &&
    !imp.hasNamespace &&
    !imp.hasStarExport &&
    imp.valueNames.length > 0 &&
    imp.valueNames.every((n) => n === 'PLAYBACK_SPEEDS')
  return !onlySpeeds
}

const isDomainOrAppModule = (resolved: string): boolean => {
  const layer = layerOf(resolved)
  return layer === 'DOMAIN' || layer === 'APP'
}

const isLibApiAllowedImport = (resolved: string): boolean =>
  resolved === 'types' ||
  resolved.startsWith('types/') ||
  resolved.startsWith('lib/shared/') ||
  resolved === 'lib/platform/cookie' ||
  resolved.startsWith('lib/api/')

/** TA-D1・D2・D5・D6・D7・D12 の違反の行（同じ組は呼出側で 1 行にまとめる）。 */
export function detectImportRows(file: string, source: string): Row[] {
  const layer = layerOf(file)
  const rows: Row[] = []
  const add = (rule: string, specifier: string): void => void rows.push({ rule, file, specifier })

  for (const imp of collectImports(file, source)) {
    const { specifier, resolved } = imp

    if (layer === 'DOMAIN') {
      if (resolved === null) {
        if (FORBIDDEN_FRAMEWORK_PACKAGES(specifier)) add('TA-D1', specifier)
        continue
      }
      const ownContext = contextOf(file)
      const targetLayer = layerOf(resolved)
      if (targetLayer === 'SHARED') continue
      if (targetLayer === 'DOMAIN') {
        const targetContext = contextOf(resolved)
        if (targetContext === ownContext) continue
        const allowed = ALLOWED_CROSS_CONTEXT.some(([from, to]) => from === ownContext && to === targetContext)
        if (!allowed) add('TA-D12', specifier)
        continue
      }
      add('TA-D1', specifier)
    } else if (layer === 'APP') {
      if (resolved === null) continue
      const ownContext = contextOf(file)
      const targetLayer = layerOf(resolved)
      if (targetLayer === 'SHARED') continue
      if (targetLayer === 'DOMAIN' || targetLayer === 'APP') {
        if (contextOf(resolved) === ownContext) continue
        if (imp.typeOnly) continue
      }
      add('TA-D2', specifier)
    } else if (layer === 'PRES') {
      if (resolved === null) continue
      if (isPresForbiddenInfrastructure(resolved) || isPresPlaybackValueImport(imp)) add('TA-D5', specifier)
    } else if (file.startsWith('contexts/')) {
      if (resolved !== null && (resolved === 'components' || resolved.startsWith('components/'))) {
        add('TA-D6', specifier)
      }
    } else if (file.startsWith('lib/platform/')) {
      if (resolved !== null && !imp.typeOnly && isDomainOrAppModule(resolved)) add('TA-D7', specifier)
    } else if (file.startsWith('lib/api/')) {
      if (resolved !== null && !isLibApiAllowedImport(resolved)) add('TA-D7', specifier)
    }
  }
  return rows
}

// ---------------------------------------------------------------------------
// TA-D3（DOMAIN・APP の外界の識別子）
// ---------------------------------------------------------------------------

const TA_D3_GLOBALS: ReadonlySet<string> = new Set([
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'caches',
  'fetch',
  'Audio',
  'Response',
  'Request',
  'Headers',
])

/** 識別子が「参照」か。property 名・object の key・宣言名は参照ではない。 */
function isReferencePosition(node: ts.Identifier): boolean {
  const parent = node.parent
  if (ts.isPropertyAccessExpression(parent)) return parent.name !== node
  if (ts.isQualifiedName(parent)) return parent.right !== node
  if (ts.isPropertyAssignment(parent)) return parent.name !== node
  if (ts.isBindingElement(parent)) return parent.name !== node && parent.propertyName !== node
  if (
    ts.isPropertySignature(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isMethodSignature(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isGetAccessorDeclaration(parent) ||
    ts.isSetAccessorDeclaration(parent) ||
    ts.isEnumMember(parent) ||
    ts.isVariableDeclaration(parent) ||
    ts.isParameter(parent) ||
    ts.isFunctionDeclaration(parent) ||
    ts.isFunctionExpression(parent) ||
    ts.isClassDeclaration(parent) ||
    ts.isInterfaceDeclaration(parent) ||
    ts.isTypeAliasDeclaration(parent) ||
    ts.isEnumDeclaration(parent) ||
    ts.isTypeParameterDeclaration(parent) ||
    ts.isImportSpecifier(parent) ||
    ts.isExportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isJsxAttribute(parent) ||
    ts.isLabeledStatement(parent)
  ) {
    return (parent as { name?: ts.Node }).name !== node
  }
  return true
}

/** TA-D3: `window` 等のグローバルの参照（型の位置を含む）・`URL.createObjectURL`・`JSON.parse`/`JSON.stringify` の呼出。 */
export function detectGlobalRows(file: string, source: string): Row[] {
  const sf = parseSource(file, source)
  const rows: Row[] = []
  const add = (specifier: string): void => void rows.push({ rule: 'TA-D3', file, specifier })
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && TA_D3_GLOBALS.has(node.text) && isReferencePosition(node)) add(node.text)
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const callee = node.expression
      if (ts.isIdentifier(callee.expression) && callee.expression.text === 'JSON') {
        if (callee.name.text === 'parse' || callee.name.text === 'stringify') add(`JSON.${callee.name.text}`)
      }
    }
    if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'URL' &&
      node.name.text === 'createObjectURL'
    ) {
      add('URL.createObjectURL')
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return rows
}

// ---------------------------------------------------------------------------
// TA-D4（データモデルの漏れ）・TA-D11（localStorage）
// ---------------------------------------------------------------------------

/** TA-D4 (a): INFRA・DOMAIN・APP 以外のファイルが `@/types`（`types/**`）を import する。 */
export function detectTypesImportRows(file: string, source: string): Row[] {
  const layer = layerOf(file)
  if (layer === 'INFRA' || layer === 'DOMAIN' || layer === 'APP') return []
  return collectImports(file, source)
    .filter((imp) => imp.resolved !== null && (imp.resolved === 'types' || imp.resolved.startsWith('types/')))
    .map((imp) => ({ rule: 'TA-D4', file, specifier: imp.specifier }))
}

/** `types/index.ts` が自分で宣言して export する型の名前（再 export を除く）。 */
export function collectOwnDeclaredTypeNames(typesIndexSource: string): Set<string> {
  const sf = parseSource('types/index.ts', typesIndexSource)
  const names = new Set<string>()
  for (const statement of sf.statements) {
    const exported = ts.canHaveModifiers(statement)
      ? (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      : false
    if (!exported) continue
    if (
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      ts.isEnumDeclaration(statement) ||
      ts.isClassDeclaration(statement)
    ) {
      if (statement.name !== undefined) names.add(statement.name.text)
    }
  }
  return names
}

function exportedDeclarations(sf: ts.SourceFile): ts.Node[] {
  const out: ts.Node[] = []
  for (const statement of sf.statements) {
    const exported = ts.canHaveModifiers(statement)
      ? (ts.getModifiers(statement) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
      : false
    if (!exported) continue
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        const init = decl.initializer
        if (init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) out.push(init)
        if (decl.type !== undefined) out.push(decl.type)
      }
    } else {
      out.push(statement)
    }
  }
  return out
}

/** TA-D4 (b): DOMAIN・APP の export する宣言の中に、`types/index.ts` が自分で宣言した型名が型参照として現れる。 */
export function detectDomainTypeReferenceRows(file: string, source: string, dtoTypeNames: ReadonlySet<string>): Row[] {
  const layer = layerOf(file)
  if (layer !== 'DOMAIN' && layer !== 'APP') return []
  const sf = parseSource(file, source)
  const rows: Row[] = []
  const add = (name: string): void => void rows.push({ rule: 'TA-D4', file, specifier: name })
  const visit = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && dtoTypeNames.has(node.typeName.text)) {
      add(node.typeName.text)
    }
    if (ts.isExpressionWithTypeArguments(node) && ts.isIdentifier(node.expression) && dtoTypeNames.has(node.expression.text)) {
      add(node.expression.text)
    }
    ts.forEachChild(node, visit)
  }
  for (const declaration of exportedDeclarations(sf)) {
    // 関数は署名（引数と戻り値の型）だけを見る。本体の中の型参照は export する宣言の一部ではない。
    if (ts.isFunctionDeclaration(declaration) || ts.isArrowFunction(declaration) || ts.isFunctionExpression(declaration)) {
      declaration.parameters.forEach(visit)
      if (declaration.type !== undefined) visit(declaration.type)
    } else {
      visit(declaration)
    }
  }
  return rows
}

export interface LocalStorageOccurrence {
  readonly kind: 'identifier' | 'string'
}

/** TA-D11: 識別子・property 名の `localStorage`、または文字列・テンプレートの中の `localStorage`（コメントは数えない）。 */
export function findLocalStorageOccurrences(file: string, source: string): LocalStorageOccurrence[] {
  const sf = parseSource(file, source)
  const found: LocalStorageOccurrence[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === 'localStorage') found.push({ kind: 'identifier' })
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateHead(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)) &&
      node.text.includes('localStorage')
    ) {
      found.push({ kind: 'string' })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

// ---------------------------------------------------------------------------
// TA-V4（規則の置き場）
// ---------------------------------------------------------------------------

const DIFFICULTY_LEVEL_VALUES: readonly string[] = [
  'toeic_600',
  'toeic_900',
  'ielts_55',
  'ielts_7',
  'eiken_2',
  'eiken_p1',
]

interface MatchContext {
  readonly file: string
  readonly source: string
  readonly body: string
}

interface LabelledPattern {
  readonly label: string
  /** 一致の開始位置（body 上）。配列リテラルを見る式は source の AST から作る。 */
  readonly find: (ctx: MatchContext) => number[]
  readonly excludeFile?: (file: string) => boolean
}

export interface RuleDefinition {
  readonly rule: string
  readonly allowed: (file: string) => boolean
  readonly patterns: readonly LabelledPattern[]
}

function regexStarts(body: string, pattern: RegExp): number[] {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`
  return [...body.matchAll(new RegExp(pattern.source, flags))].map((m) => m.index)
}

const lineOf = (body: string, index: number): number => body.slice(0, index).split('\n').length

function arrayLiteralStarts(
  ctx: MatchContext,
  matches: (elements: ReadonlyArray<ts.Expression>) => boolean,
): number[] {
  const sf = parseSource(ctx.file, ctx.source)
  const starts: number[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isArrayLiteralExpression(node) && matches(node.elements)) starts.push(node.getStart(sf))
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return starts
}

const numericValues = (elements: ReadonlyArray<ts.Expression>): number[] =>
  elements.filter(ts.isNumericLiteral).map((e) => Number(e.text))

const stringValues = (elements: ReadonlyArray<ts.Expression>): string[] =>
  elements.filter(ts.isStringLiteralLike).map((e) => e.text)

// TA-R-CT-6 の式（TA-R-CT-1 と同じ行に当たる出現は TA-R-CT-6 だけに数える）
const CT6_TRANSITION = /!==\s*'completed'\s*&&[^\n]*===\s*'completed'/

function ct1Starts(ctx: MatchContext): number[] {
  const hits = [
    ...regexStarts(ctx.body, /\.status\s*[!=]==?\s*'(completed|processing|failed|partial_failed)'/),
    ...regexStarts(ctx.body, /'(completed|processing|failed|partial_failed)'\s*[!=]==?\s*[\w.?]*\.status\b/),
  ]
  const ct6Lines = new Set(regexStarts(ctx.body, CT6_TRANSITION).map((i) => lineOf(ctx.body, i)))
  return hits.filter((i) => !ct6Lines.has(lineOf(ctx.body, i)))
}

/** `slice(0, 10)` の直前の識別子が `_at` で終わるもの（ISO 日付の切り出し）を除く（lookbehind は使わない）。 */
function ln3Slice10Starts(ctx: MatchContext): number[] {
  return regexStarts(ctx.body, /\.slice\(0,\s*10\)/).filter((index) => {
    let start = index
    while (start > 0 && /[A-Za-z0-9_$]/.test(ctx.body[start - 1])) start -= 1
    return !ctx.body.slice(start, index).endsWith('_at')
  })
}

const only =
  (...files: string[]) =>
  (file: string): boolean =>
    files.includes(file)

export const RULE_DEFINITIONS: readonly RuleDefinition[] = [
  {
    rule: 'TA-R-CT-1',
    allowed: only('lib/catalog/domain/episode.ts', 'lib/catalog/infrastructure/episodeMapper.ts'),
    patterns: [
      { label: '.status と生成状態の比較', find: ct1Starts },
      {
        label: 'audio_url/error_message の空・null 判定',
        find: (ctx) => [
          ...regexStarts(ctx.body, /\.(audio_url|error_message)\s*[!=]==?\s*(''|""|null|undefined)/),
          ...regexStarts(ctx.body, /!\s*[\w.?]*\.(audio_url|error_message)\b/),
        ],
      },
    ],
  },
  {
    rule: 'TA-R-CT-2',
    allowed: only('lib/catalog/domain/episode.ts'),
    patterns: [
      { label: 'intro_text.slice(', find: (ctx) => regexStarts(ctx.body, /intro_text\.slice\(/) },
      { label: 'intro.slice(', find: (ctx) => regexStarts(ctx.body, /\bintro\.slice\(/) },
    ],
  },
  {
    rule: 'TA-R-CT-3',
    allowed: only('lib/catalog/domain/generationLimit.ts'),
    patterns: [
      { label: '/monthly/i', find: (ctx) => regexStarts(ctx.body, /\/monthly\/i/) },
      {
        label: '86400',
        find: (ctx) => regexStarts(ctx.body, /\b86400\b/),
        // 新 Spec §7: lib/format.ts の 86400 は除外
        excludeFile: only('lib/format.ts'),
      },
    ],
  },
  {
    rule: 'TA-R-CT-6',
    allowed: only('lib/catalog/domain/generationWatch.ts'),
    patterns: [
      { label: 'POLL_TIMEOUT_MS', find: (ctx) => regexStarts(ctx.body, /\bPOLL_TIMEOUT_MS\b/) },
      { label: "!== 'completed' && … === 'completed'", find: (ctx) => regexStarts(ctx.body, CT6_TRANSITION) },
    ],
  },
  {
    rule: 'TA-R-AC-3',
    allowed: only('lib/account/domain/password.ts'),
    patterns: [
      { label: 'password.length', find: (ctx) => regexStarts(ctx.body, /password\.length/i) },
      { label: 'PASSWORD_MIN_LENGTH', find: (ctx) => regexStarts(ctx.body, /\bPASSWORD_MIN_LENGTH\b/) },
      {
        label: 'countPasswordCharacterClasses',
        find: (ctx) => regexStarts(ctx.body, /\bcountPasswordCharacterClasses\b/),
      },
    ],
  },
  {
    rule: 'TA-R-AC-6',
    allowed: only('lib/account/domain/adminAccess.ts'),
    patterns: [{ label: "role === 'admin'", find: (ctx) => regexStarts(ctx.body, /role\s*===\s*'admin'/) }],
  },
  {
    rule: 'TA-R-PB-2',
    allowed: only('lib/playback/domain/session.ts'),
    patterns: [
      {
        label: '速度の配列',
        find: (ctx) =>
          arrayLiteralStarts(ctx, (elements) => {
            const values = numericValues(elements)
            return [0.75, 1.25, 1.75].every((v) => values.includes(v))
          }),
      },
    ],
  },
  {
    rule: 'TA-R-PF-1',
    allowed: only('lib/preferences/domain/settings.ts', 'lib/shared/difficulty.ts'),
    patterns: [
      { label: '[3, 5, 7, 10]', find: (ctx) => regexStarts(ctx.body, /\[\s*3\s*,\s*5\s*,\s*7\s*,\s*10\s*\]/) },
      {
        label: '難易度の値の配列',
        find: (ctx) =>
          arrayLiteralStarts(
            ctx,
            (elements) => stringValues(elements).filter((v) => DIFFICULTY_LEVEL_VALUES.includes(v)).length >= 2,
          ),
      },
    ],
  },
  {
    rule: 'TA-R-LN-1',
    allowed: only('lib/learning/domain/streak.ts'),
    patterns: [{ label: '5 * 60 * 1000', find: (ctx) => regexStarts(ctx.body, /\b5\s*\*\s*60\s*\*\s*1000\b/) }],
  },
  {
    rule: 'TA-R-LN-2',
    allowed: only('lib/learning/domain/quiz.ts'),
    patterns: [{ label: '>= 0.5', find: (ctx) => regexStarts(ctx.body, />=\s*0\.5\b/) }],
  },
  {
    rule: 'TA-R-LN-3',
    allowed: only('lib/learning/domain/vocabularyTest.ts', 'lib/learning/infrastructure/learningGateway.ts'),
    patterns: [
      { label: 'slice(0, 10)', find: ln3Slice10Starts },
      { label: 'slice(0, 3)', find: (ctx) => regexStarts(ctx.body, /\.slice\(0,\s*3\)/) },
      { label: 'retest_correct', find: (ctx) => regexStarts(ctx.body, /\bretest_correct\b/) },
    ],
  },
  {
    rule: 'TA-D8',
    allowed: (file) =>
      file === 'lib/api/gateway.ts' || file === 'lib/platform/cacheStore.ts' || file.startsWith('app/api/'),
    patterns: [
      {
        label: '.status と数値の比較',
        find: (ctx) => [
          ...regexStarts(ctx.body, /\.status\s*(===|!==|==|!=|<=|>=|<|>)\s*\d/),
          ...regexStarts(ctx.body, /\d\s*(===|!==|==|!=|<=|>=|<|>)\s*[\w.?]*\.status\b/),
        ],
      },
    ],
  },
]

/** TA-V4: 規則ごとの「出てよいファイル以外の出現」の行。 */
export function detectRuleRows(file: string, source: string): Row[] {
  const ctx: MatchContext = { file, source, body: stripComments(file, source) }
  const rows: Row[] = []
  for (const def of RULE_DEFINITIONS) {
    if (def.allowed(file)) continue
    for (const pattern of def.patterns) {
      if (pattern.excludeFile?.(file) === true) continue
      if (pattern.find(ctx).length > 0) rows.push({ rule: def.rule, file, specifier: pattern.label })
    }
  }
  return rows
}

// ---------------------------------------------------------------------------
// TA-V5 (b)（export する型の readonly）
// ---------------------------------------------------------------------------

export interface PublicTypeScan {
  readonly exportedNames: string[]
  readonly violations: string[]
}

const hasModifier = (node: ts.Node, kind: ts.SyntaxKind): boolean =>
  ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind)

/**
 * DOMAIN・APP・shared の export する interface・type alias の本体、export する関数の署名の中の object 型で、
 * `readonly` の無い property 宣言と、配列型（`T[]`・`Array<T>`）を数える。メソッド宣言そのものは数えない。構文だけで判定する。
 */
export function scanPublicTypes(file: string, source: string, excludedTypeNames: readonly string[]): PublicTypeScan {
  const sf = parseSource(file, source)
  const exportedNames: string[] = []
  const violations: string[] = []

  const report = (owner: string, what: string): void => void violations.push(`${file}: ${owner}: ${what}`)

  const visitType = (node: ts.Node, owner: string): void => {
    if (ts.isArrayTypeNode(node)) {
      report(owner, `配列型 ${node.getText(sf)}`)
      visitType(node.elementType, owner)
      return
    }
    if (ts.isTypeOperatorNode(node) && node.operator === ts.SyntaxKind.ReadonlyKeyword) {
      if (ts.isArrayTypeNode(node.type)) visitType(node.type.elementType, owner)
      else visitType(node.type, owner)
      return
    }
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && node.typeName.text === 'Array') {
      report(owner, `配列型 ${node.getText(sf)}`)
    }
    if (ts.isPropertySignature(node) && !hasModifier(node, ts.SyntaxKind.ReadonlyKeyword)) {
      report(owner, `readonly の無い property ${node.name.getText(sf)}`)
    }
    ts.forEachChild(node, (child) => visitType(child, owner))
  }

  const visitSignature = (
    node: ts.SignatureDeclarationBase,
    owner: string,
  ): void => {
    node.parameters.forEach((p) => visitType(p, owner))
    if (node.type !== undefined) visitType(node.type, owner)
  }

  for (const statement of sf.statements) {
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue
    if (ts.isInterfaceDeclaration(statement)) {
      const name = statement.name.text
      exportedNames.push(name)
      if (excludedTypeNames.includes(name)) continue
      statement.members.forEach((m) => visitType(m, name))
    } else if (ts.isTypeAliasDeclaration(statement)) {
      exportedNames.push(statement.name.text)
      visitType(statement.type, statement.name.text)
    } else if (ts.isFunctionDeclaration(statement)) {
      const name = statement.name?.text ?? 'default'
      exportedNames.push(name)
      visitSignature(statement, name)
    } else if (ts.isClassDeclaration(statement)) {
      const name = statement.name?.text ?? 'default'
      exportedNames.push(name)
      statement.members.forEach((m) => visitType(m, name))
    } else if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue
        exportedNames.push(decl.name.text)
        const init = decl.initializer
        if (init !== undefined && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) {
          visitSignature(init, decl.name.text)
        }
      }
    }
  }
  return { exportedNames, violations }
}

// ---------------------------------------------------------------------------
// TA-V8（テストの隔離）
// ---------------------------------------------------------------------------

/** テストの `@/` で始まる import（静的・export from・import()・`vi.mock` の第 1 引数）の文字列。 */
function collectTestAliasSpecifiers(file: string, source: string): string[] {
  const specifiers = collectImports(file, source).map((i) => i.specifier)
  const sf = parseSource(file, source)
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'vi' &&
      node.expression.name.text === 'mock'
    ) {
      const first = node.arguments[0]
      if (first !== undefined && ts.isStringLiteralLike(first)) specifiers.push(first.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return specifiers.filter((s) => s.startsWith('@/'))
}

const isDomainApplicationOrShared = (specifier: string): { domainOrApp: boolean; ok: boolean } => {
  const resolved = specifier.slice(2)
  const layer = layerOf(resolved)
  return { domainOrApp: layer === 'DOMAIN' || layer === 'APP', ok: layer === 'DOMAIN' || layer === 'APP' || layer === 'SHARED' }
}

/** `@/` の import がすべて domain・application・shared で、domain か application を 1 つ以上含むテスト。 */
export function isDomainIsolationTarget(file: string, source: string): boolean {
  const specifiers = collectTestAliasSpecifiers(file, source)
  if (specifiers.length === 0) return false
  const judged = specifiers.map(isDomainApplicationOrShared)
  return judged.every((j) => j.ok) && judged.some((j) => j.domainOrApp)
}

/** 対象のテストが `@/lib/api`・`@/lib/platform` を import（または `vi.mock`）している箇所。 */
export function findIsolationViolations(file: string, source: string): string[] {
  return collectTestAliasSpecifiers(file, source).filter((s) => {
    const resolved = s.slice(2)
    return resolved === 'lib/api' || resolved.startsWith('lib/api/') || resolved.startsWith('lib/platform/')
  })
}
