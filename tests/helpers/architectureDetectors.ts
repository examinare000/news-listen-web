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
// web-dep-01・D2・D5・D6・D7・D12（import の向き）
// ---------------------------------------------------------------------------

/** 新 Spec §4 web-dep-12 が許す context 間の向き（from → to）。 */
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

/** web-dep-01・D2・D5・D6・D7・D12 の違反の行（同じ組は呼出側で 1 行にまとめる）。 */
export function detectImportRows(file: string, source: string): Row[] {
  const layer = layerOf(file)
  const rows: Row[] = []
  const add = (rule: string, specifier: string): void => void rows.push({ rule, file, specifier })

  for (const imp of collectImports(file, source)) {
    const { specifier, resolved } = imp

    if (layer === 'DOMAIN') {
      if (resolved === null) {
        if (FORBIDDEN_FRAMEWORK_PACKAGES(specifier)) add('web-dep-01', specifier)
        continue
      }
      const ownContext = contextOf(file)
      const targetLayer = layerOf(resolved)
      if (targetLayer === 'SHARED') continue
      if (targetLayer === 'DOMAIN') {
        const targetContext = contextOf(resolved)
        if (targetContext === ownContext) continue
        const allowed = ALLOWED_CROSS_CONTEXT.some(([from, to]) => from === ownContext && to === targetContext)
        if (!allowed) add('web-dep-12', specifier)
        continue
      }
      add('web-dep-01', specifier)
    } else if (layer === 'APP') {
      if (resolved === null) continue
      const ownContext = contextOf(file)
      const targetLayer = layerOf(resolved)
      if (targetLayer === 'SHARED') continue
      if (targetLayer === 'DOMAIN' || targetLayer === 'APP') {
        if (contextOf(resolved) === ownContext) continue
        if (imp.typeOnly) continue
      }
      add('web-dep-02', specifier)
    } else if (layer === 'PRES') {
      if (resolved === null) continue
      if (isPresForbiddenInfrastructure(resolved) || isPresPlaybackValueImport(imp)) add('web-dep-05', specifier)
    } else if (file.startsWith('contexts/')) {
      if (resolved !== null && (resolved === 'components' || resolved.startsWith('components/'))) {
        add('web-dep-06', specifier)
      }
    } else if (file.startsWith('lib/platform/')) {
      if (resolved !== null && !imp.typeOnly && isDomainOrAppModule(resolved)) add('web-dep-07', specifier)
    } else if (file.startsWith('lib/api/')) {
      if (resolved !== null && !isLibApiAllowedImport(resolved)) add('web-dep-07', specifier)
    }
  }
  return rows
}

// ---------------------------------------------------------------------------
// web-dep-03（DOMAIN・APP の外界の識別子）
// ---------------------------------------------------------------------------

const WEB_DEP_03_GLOBALS: ReadonlySet<string> = new Set([
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

/** web-dep-03: `window` 等のグローバルの参照（型の位置を含む）・`URL.createObjectURL`・`JSON.parse`/`JSON.stringify` の呼出。 */
export function detectGlobalRows(file: string, source: string): Row[] {
  const sf = parseSource(file, source)
  const rows: Row[] = []
  const add = (specifier: string): void => void rows.push({ rule: 'web-dep-03', file, specifier })
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && WEB_DEP_03_GLOBALS.has(node.text) && isReferencePosition(node)) add(node.text)
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
// web-dep-04（データモデルの漏れ）・web-dep-11（localStorage）
// ---------------------------------------------------------------------------

/** web-dep-04 (a): INFRA・DOMAIN・APP 以外のファイルが `@/types`（`types/**`）を import する。 */
export function detectTypesImportRows(file: string, source: string): Row[] {
  const layer = layerOf(file)
  if (layer === 'INFRA' || layer === 'DOMAIN' || layer === 'APP') return []
  return collectImports(file, source)
    .filter((imp) => imp.resolved !== null && (imp.resolved === 'types' || imp.resolved.startsWith('types/')))
    .map((imp) => ({ rule: 'web-dep-04', file, specifier: imp.specifier }))
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

/** 最上位の文が宣言する interface・type alias・class・enum の名前（export の有無を問わない）。 */
function topLevelTypeDeclarationNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  for (const statement of sf.statements) {
    if (
      (ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name !== undefined
    ) {
      names.add(statement.name.text)
    }
  }
  return names
}

/**
 * web-dep-04 (b): DOMAIN・APP の export する宣言の中に、`types/index.ts` が自分で宣言した型名が型参照として現れる。
 * そのファイル自身が同名の型を宣言しているとき、参照はその型に解決されるので DTO の漏れではなく、数えない。
 */
export function detectDomainTypeReferenceRows(file: string, source: string, dtoTypeNames: ReadonlySet<string>): Row[] {
  const layer = layerOf(file)
  if (layer !== 'DOMAIN' && layer !== 'APP') return []
  const sf = parseSource(file, source)
  const own = topLevelTypeDeclarationNames(sf)
  const isDtoReference = (name: string): boolean => dtoTypeNames.has(name) && !own.has(name)
  const rows: Row[] = []
  const add = (name: string): void => void rows.push({ rule: 'web-dep-04', file, specifier: name })
  const visit = (node: ts.Node): void => {
    if (ts.isTypeReferenceNode(node) && ts.isIdentifier(node.typeName) && isDtoReference(node.typeName.text)) {
      add(node.typeName.text)
    }
    if (ts.isExpressionWithTypeArguments(node) && ts.isIdentifier(node.expression) && isDtoReference(node.expression.text)) {
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

/** web-dep-11: 識別子・property 名の `localStorage`、または文字列・テンプレートの中の `localStorage`（コメントは数えない）。 */
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
// web-check-04（規則の置き場）
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

// web-rule-catalog-06 の式（web-rule-catalog-01 と同じ行に当たる出現は web-rule-catalog-06 だけに数える）
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
    rule: 'web-rule-catalog-01',
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
    rule: 'web-rule-catalog-02',
    allowed: only('lib/catalog/domain/episode.ts'),
    patterns: [
      { label: 'intro_text.slice(', find: (ctx) => regexStarts(ctx.body, /intro_text\.slice\(/) },
      { label: 'intro.slice(', find: (ctx) => regexStarts(ctx.body, /\bintro\.slice\(/) },
    ],
  },
  {
    rule: 'web-rule-catalog-03',
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
    rule: 'web-rule-catalog-06',
    allowed: only('lib/catalog/domain/generationWatch.ts'),
    patterns: [
      { label: 'POLL_TIMEOUT_MS', find: (ctx) => regexStarts(ctx.body, /\bPOLL_TIMEOUT_MS\b/) },
      { label: "!== 'completed' && … === 'completed'", find: (ctx) => regexStarts(ctx.body, CT6_TRANSITION) },
    ],
  },
  {
    rule: 'web-rule-account-03',
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
    rule: 'web-rule-account-06',
    allowed: only('lib/account/domain/adminAccess.ts'),
    patterns: [{ label: "role === 'admin'", find: (ctx) => regexStarts(ctx.body, /role\s*===\s*'admin'/) }],
  },
  {
    rule: 'web-rule-playback-02',
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
    rule: 'web-rule-prefs-01',
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
    rule: 'web-rule-learning-01',
    allowed: only('lib/learning/domain/streak.ts'),
    patterns: [{ label: '5 * 60 * 1000', find: (ctx) => regexStarts(ctx.body, /\b5\s*\*\s*60\s*\*\s*1000\b/) }],
  },
  {
    rule: 'web-rule-learning-02',
    allowed: only('lib/learning/domain/quiz.ts'),
    patterns: [{ label: '>= 0.5', find: (ctx) => regexStarts(ctx.body, />=\s*0\.5\b/) }],
  },
  {
    rule: 'web-rule-learning-03',
    allowed: only('lib/learning/domain/vocabularyTest.ts', 'lib/learning/infrastructure/learningGateway.ts'),
    patterns: [
      { label: 'slice(0, 10)', find: ln3Slice10Starts },
      { label: 'slice(0, 3)', find: (ctx) => regexStarts(ctx.body, /\.slice\(0,\s*3\)/) },
      { label: 'retest_correct', find: (ctx) => regexStarts(ctx.body, /\bretest_correct\b/) },
    ],
  },
  {
    rule: 'web-dep-08',
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

/** web-check-04: 規則ごとの「出てよいファイル以外の出現」の行。 */
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
// web-check-05 (b)（export する型の readonly）
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
// web-check-08（テストの隔離）
// ---------------------------------------------------------------------------
// 対象 = (分類が unit で、到達に DOMAIN・APP を含む) または (path が tests/lib/<context>/{domain,application}/ の下)。
// 到達は test-local の閉包で求め、違反の検出も同じ範囲を走る。禁止依存の有無は対象の選別に使わない。
// このファイル自身も architecture テストの閉包に入るので、読み込み手段の名前（require・Function・eval・__vi 接頭辞など）と
// `vi`・`vitest` の識別子は、コードの Identifier として書かない（名前は文字列で持つ）。

export type TestClass = 'unit' | 'adapter' | 'integration'

export interface TestInventoryEntry {
  readonly class: TestClass
  readonly reason?: string
}

export interface MigrationAllowance {
  readonly file: string
  readonly specifier: string
  readonly owner: string
  readonly reason: string
  /** その行が 0 件になっているべき期限の slice。 */
  readonly removeBy: string
  /** 依存を消す作業を担う slice。 */
  readonly task: string
}

export interface TestIsolationInput {
  /** 列挙したテストファイル（web root 起点）。 */
  readonly testFiles: readonly string[]
  /** vitest の setupFiles（web root 起点）。 */
  readonly setupFiles: readonly string[]
  /** production の走査集合（subject の母集団）。 */
  readonly productionFiles: readonly string[]
  /** 本文を返す。無ければ undefined。 */
  readonly readSource: (file: string) => string | undefined
  readonly tests: Readonly<Record<string, TestInventoryEntry>>
  readonly subjects: Readonly<Record<string, readonly string[]>>
  readonly allowances: readonly MigrationAllowance[]
}

export interface IsolationFinding {
  readonly kind: string
  readonly file: string
  readonly detail: string
}

export interface TestIsolationResult {
  /** 辞書順。 */
  readonly targets: readonly string[]
  /** 分類が unit でなく、到達に DOMAIN・APP を含むテスト。辞書順。 */
  readonly domainImportingNonUnit: readonly string[]
  /** (kind, file, detail) の辞書順。重複なし。 */
  readonly findings: readonly IsolationFinding[]
}

const KIND = {
  forbiddenDependency: 'forbidden-dependency',
  moduleMockOrLoad: 'module-mock-or-load',
  undeterminableModuleLoad: 'undeterminable-module-load',
  unresolvedLocalImport: 'unresolved-local-import',
  unclassifiedTest: 'unclassified-test',
  unknownTest: 'unknown-test',
  invalidClass: 'invalid-class',
  missingReason: 'missing-reason',
  adapterWithoutAdapter: 'adapter-without-adapter-import',
  unregisteredSubject: 'unregistered-subject',
  unknownSubject: 'unknown-subject',
  subjectTestsMismatch: 'subject-tests-mismatch',
  subjectUntested: 'subject-untested',
  staleAllowance: 'stale-allowance',
  setupProductionDependency: 'setup-production-dependency',
  disallowedViCall: 'disallowed-vi-call',
} as const

const TEST_CLASSES: readonly string[] = ['unit', 'adapter', 'integration']

/** module の読み込み・差し替えになる `vi` のメンバー。 */
const VI_LOAD_MEMBERS: ReadonlySet<string> = new Set(['mock', 'doMock', 'unmock', 'doUnmock', 'importActual', 'importMock'])

/** 読み込みも環境変数の変更もしない `vi` のメンバー。増やすときは仕様の改訂として扱う。 */
const VI_ALLOWED: ReadonlySet<string> = new Set([
  'fn',
  'spyOn',
  'stubGlobal',
  'unstubAllGlobals',
  'useFakeTimers',
  'useRealTimers',
  'getTimerCount',
  'advanceTimersByTime',
  'advanceTimersByTimeAsync',
  'setSystemTime',
  'clearAllMocks',
  'resetAllMocks',
  'restoreAllMocks',
])

/** vitest の global API に入る、`VitestUtils` を指す名前（`vi` と `vitest` は同じ値）。 */
const VITEST_GLOBAL_NAMES: readonly string[] = ['vi', 'vitest']

/** import 構文と `vi` を使わずに module を読み込む・文字列を評価する手段の名前。 */
const LOAD_NAME_PREFIX = /^__vi/
const LOAD_NAMES: ReadonlySet<string> = new Set(['require', 'createRequire', 'getBuiltinModule', 'eval'])

const VITEST_SPECIFIER = /^(vitest(\/|$)|@vitest\/)/
const TEST_DOMAIN_PATH = /^tests\/lib\/[^/]+\/(domain|application)\//
const SOURCE_EXTENSION = /\.[cm]?[jt]sx?$/

const isUnderTests = (resolved: string): boolean => resolved.startsWith('tests/')
const withoutExtension = (p: string): string => p.replace(/\.tsx?$/, '')
const isSafeProductionLayer = (resolved: string): boolean => {
  const layer = layerOf(resolved)
  return layer === 'DOMAIN' || layer === 'APP' || layer === 'SHARED'
}

interface Ref {
  readonly specifier: string
  readonly resolved: string | null
}

interface LoadCall {
  /** `vi.<member>(<第 1 引数の原文>)`。`vi` の実際の名前によらず `vi.` に揃える。 */
  readonly detail: string
  readonly resolved: string | null
}

interface FileFacts {
  /** 実行時 import と `<vi>.importActual(<literal>)` の行き先。 */
  readonly refs: readonly Ref[]
  readonly loadCalls: readonly LoadCall[]
  /** 全テストで検出する、行き先を決められない読み込みの `detail`。 */
  readonly undeterminable: readonly string[]
  /** 許可集合の外の `vi` のメンバー。 */
  readonly disallowedVi: readonly string[]
}

/** `architecture.ts` の import の解決と同じ規則で解く（解決の規則を 1 か所に保つため、収集器を通す）。 */
function resolveSpecifier(fromFile: string, specifier: string): string | null {
  return collectImports(fromFile, `import ${JSON.stringify(specifier)}`)[0]?.resolved ?? null
}

/** 許可する形は 1 つだけ: `vitest` からの、名前付き指定子だけの ImportDeclaration。 */
const isAllowedVitestImport = (record: ImportRecord): boolean =>
  record.kind === 'import' &&
  record.specifier === 'vitest' &&
  !record.hasDefault &&
  !record.hasNamespace &&
  record.valueNames.length + record.typeNames.length > 0

/** `vitest` から名前付き import した `vi`・`vitest` の local 名（別名を含む）。 */
function collectVitestLocalNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (!ts.isStringLiteralLike(statement.moduleSpecifier) || statement.moduleSpecifier.text !== 'vitest') continue
    const bindings = statement.importClause?.namedBindings
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue
    for (const element of bindings.elements) {
      if (VITEST_GLOBAL_NAMES.includes((element.propertyName ?? element.name).text)) names.add(element.name.text)
    }
  }
  return names
}

/** import の中、または ExpressionWithTypeArguments 以外の型ノードの中。後者は実行時に消えるが、前者は束縛の宣言でしかない。 */
const isInertContainer = (node: ts.Node): boolean =>
  ts.isImportDeclaration(node) || (ts.isTypeNode(node) && !ts.isExpressionWithTypeArguments(node))

/** 型の位置。インスタンス化式（`vi.importActual<T>`）と heritage clause は実行時に評価されるので型の位置に数えない。 */
const isInTypePosition = (node: ts.Node): boolean =>
  ts.findAncestor(node.parent, (a) => ts.isTypeNode(a) && !ts.isExpressionWithTypeArguments(a)) !== undefined

/** 値の位置: import の中・型の位置・プロパティ名の位置のどれでもない。 */
function isValuePosition(id: ts.Identifier): boolean {
  const parent = id.parent
  const isPropertyName =
    (ts.isPropertyAccessExpression(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isMethodSignature(parent)) &&
    parent.name === id
  return !isPropertyName && ts.findAncestor(parent, isInertContainer) === undefined
}

/** `Function` の識別子のうち、それだけでは文字列を評価できない位置: 直接の引数・`instanceof` の右辺・型の位置。 */
function isInertFunctionPosition(id: ts.Identifier): boolean {
  const parent = id.parent
  const args = ts.isCallExpression(parent) ? parent.arguments : ts.isNewExpression(parent) ? (parent.arguments ?? []) : []
  if (args.some((a) => a === id)) return true
  if (ts.isBinaryExpression(parent) && parent.operatorToken.kind === ts.SyntaxKind.InstanceOfKeyword && parent.right === id) {
    return true
  }
  return isInTypePosition(id)
}

const isCallee = (node: ts.Node): boolean => ts.isCallExpression(node.parent) && node.parent.expression === node

/** 1 つのファイルの構文だけで決まる事実（本文と path だけを入力にする）。 */
function analyzeFile(file: string, source: string): FileFacts {
  const sf = parseSource(file, source)
  const records = collectImports(file, source).filter((r) => !r.typeOnly)
  const refs: Ref[] = records.map(({ specifier, resolved }) => ({ specifier, resolved }))
  const loadCalls: LoadCall[] = []
  const undeterminable: string[] = records
    .filter((r) => VITEST_SPECIFIER.test(r.specifier) && !isAllowedVitestImport(r))
    .map((r) => r.specifier)
  const disallowedVi: string[] = []
  const localNames = collectVitestLocalNames(sf)
  const isVitestUtils = (id: ts.Identifier): boolean => VITEST_GLOBAL_NAMES.includes(id.text) || localNames.has(id.text)

  const visitIdentifier = (id: ts.Identifier): void => {
    const valuePosition = isValuePosition(id)
    if (valuePosition && isVitestUtils(id)) {
      const parent = id.parent
      if (ts.isPropertyAccessExpression(parent) && parent.expression === id) {
        const member = parent.name.text
        if (VI_LOAD_MEMBERS.has(member)) {
          if (!isCallee(parent)) undeterminable.push(`vi.${member}`)
        } else if (!VI_ALLOWED.has(member)) {
          disallowedVi.push(`vi.${member}`)
        }
      } else {
        undeterminable.push(id.text)
      }
    }
    const isLoadName =
      LOAD_NAME_PREFIX.test(id.text) ||
      LOAD_NAMES.has(id.text) ||
      (id.text === 'module' && valuePosition) ||
      (id.text === 'Function' && !isInertFunctionPosition(id))
    if (isLoadName) undeterminable.push(id.text)
  }

  const visitCall = (call: ts.CallExpression): void => {
    const first = call.arguments[0]
    const literal = first !== undefined && ts.isStringLiteralLike(first) ? first.text : null
    const callee = call.expression
    if (callee.kind === ts.SyntaxKind.ImportKeyword) {
      if (literal === null) undeterminable.push(`import(${first?.getText(sf) ?? ''})`)
      return
    }
    if (
      ts.isPropertyAccessExpression(callee) &&
      ts.isIdentifier(callee.expression) &&
      isVitestUtils(callee.expression) &&
      isValuePosition(callee.expression) &&
      VI_LOAD_MEMBERS.has(callee.name.text)
    ) {
      const member = callee.name.text
      const detail = `vi.${member}(${first?.getText(sf) ?? ''})`
      if (literal === null) undeterminable.push(detail)
      const resolved = literal === null ? null : resolveSpecifier(file, literal)
      loadCalls.push({ detail, resolved })
      if (member === 'importActual' && literal !== null) refs.push({ specifier: literal, resolved })
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) visitIdentifier(node)
    else if (ts.isCallExpression(node)) visitCall(node)
    else if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword) undeterminable.push('import.meta')
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return { refs, loadCalls, undeterminable, disallowedVi }
}

/** 最上位の文が、型だけの import・interface・type alias・`export type` だけのファイル。 */
function isTypeOnlyModule(file: string, source: string): boolean {
  const isTypeOnlyImport = (statement: ts.ImportDeclaration): boolean => {
    const clause = statement.importClause
    if (clause === undefined) return false
    if (clause.phaseModifier === ts.SyntaxKind.TypeKeyword) return true
    const bindings = clause.namedBindings
    return (
      clause.name === undefined &&
      bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.length > 0 &&
      bindings.elements.every((e) => e.isTypeOnly)
    )
  }
  return parseSource(file, source).statements.every(
    (statement) =>
      ts.isInterfaceDeclaration(statement) ||
      ts.isTypeAliasDeclaration(statement) ||
      (ts.isExportDeclaration(statement) && statement.isTypeOnly) ||
      (ts.isImportDeclaration(statement) && isTypeOnlyImport(statement)),
  )
}

interface TestAnalysis {
  /** 起点のファイルと、test-local 閉包のファイル。 */
  readonly files: readonly string[]
  readonly unresolved: ReadonlyArray<{ readonly file: string; readonly specifier: string }>
  /** 閉包の実行時 import が指す production module の path（拡張子なし）。 */
  readonly reach: ReadonlySet<string>
}

interface Evaluation {
  readonly input: TestIsolationInput
  /** 重複を除いた辞書順。 */
  readonly testFiles: readonly string[]
  readonly sourceOf: (file: string) => string
  readonly factsOf: (file: string) => FileFacts
  readonly analysisOf: (root: string) => TestAnalysis
  readonly entryOf: (file: string) => TestInventoryEntry | undefined
}

function assertReadable(label: string, files: readonly string[], readSource: TestIsolationInput['readSource']): void {
  const unreadable = files.filter((f) => readSource(f) === undefined)
  if (unreadable.length > 0) {
    throw new Error(`${label}の本文を読み込めません: ${unreadable.join(', ')}。列挙と実ファイルの不整合を解消してください`)
  }
}

function assertPreconditions(input: TestIsolationInput): void {
  if (input.testFiles.length === 0) throw new Error('テストの列挙が空です。git の列挙が失敗していないか確認してください')
  if (input.productionFiles.length === 0) throw new Error('production の列挙が空です。git の列挙が失敗していないか確認してください')
  assertReadable('テスト', input.testFiles, input.readSource)
  assertReadable('setup ファイル', input.setupFiles, input.readSource)
  assertReadable('production', input.productionFiles, input.readSource)
}

function createEvaluation(input: TestIsolationInput): Evaluation {
  const sourceOf = (file: string): string => {
    const source = input.readSource(file)
    if (source === undefined) throw new Error(`${file} の本文を読み込めません。列挙と実ファイルの不整合を解消してください`)
    return source
  }
  const factsCache = new Map<string, FileFacts>()
  const factsOf = (file: string): FileFacts => {
    let facts = factsCache.get(file)
    if (facts === undefined) {
      facts = analyzeFile(file, sourceOf(file))
      factsCache.set(file, facts)
    }
    return facts
  }
  const findLocalModule = (resolved: string): string | undefined => {
    const candidates = SOURCE_EXTENSION.test(resolved)
      ? [resolved]
      : [`${resolved}.ts`, `${resolved}.tsx`, `${resolved}/index.ts`, `${resolved}/index.tsx`]
    return candidates.find((c) => input.readSource(c) !== undefined)
  }
  const analysisCache = new Map<string, TestAnalysis>()
  const analysisOf = (root: string): TestAnalysis => {
    const cached = analysisCache.get(root)
    if (cached !== undefined) return cached
    const queue = [root]
    const visited = new Set(queue)
    const unresolved: Array<{ file: string; specifier: string }> = []
    const reach = new Set<string>()
    for (const file of queue) {
      for (const ref of factsOf(file).refs) {
        if (ref.resolved === null) continue
        if (!isUnderTests(ref.resolved)) {
          reach.add(withoutExtension(ref.resolved))
          continue
        }
        const local = findLocalModule(ref.resolved)
        if (local === undefined) unresolved.push({ file, specifier: ref.specifier })
        else if (!visited.has(local)) {
          visited.add(local)
          queue.push(local)
        }
      }
    }
    const analysis: TestAnalysis = { files: queue, unresolved, reach }
    analysisCache.set(root, analysis)
    return analysis
  }
  const inventoryKeys = new Set(Object.keys(input.tests))
  return {
    input,
    testFiles: [...new Set(input.testFiles)].sort(),
    sourceOf,
    factsOf,
    analysisOf,
    entryOf: (file) => (inventoryKeys.has(file) ? input.tests[file] : undefined),
  }
}

const finding = (kind: string, file: string, detail: string): IsolationFinding => ({ kind, file, detail })

/** helper の中で見つけたものは、見つけた helper の path を前に付ける。 */
const detailIn = (owner: string, file: string, detail: string): string => (file === owner ? detail : `${file} → ${detail}`)

function isForbiddenDependency(ref: Ref): boolean {
  if (ref.resolved === null) return ref.specifier !== 'vitest'
  return !isUnderTests(ref.resolved) && !isSafeProductionLayer(ref.resolved)
}

const isAdapterDependency = (ref: Ref): boolean => ref.resolved !== null && isForbiddenDependency(ref)

const reachesDomainOrApp = (analysis: TestAnalysis): boolean => [...analysis.reach].some(isDomainOrAppModule)

const isTarget = (ev: Evaluation, test: string): boolean =>
  (ev.entryOf(test)?.class === 'unit' && reachesDomainOrApp(ev.analysisOf(test))) || TEST_DOMAIN_PATH.test(test)

/** 行き先を決められない読み込みと解決失敗は全テストで、禁止依存・読み込み・許可外の `vi` は対象だけで検出する。 */
function collectTestFindings(ev: Evaluation, test: string, target: boolean): IsolationFinding[] {
  const out: IsolationFinding[] = []
  const analysis = ev.analysisOf(test)
  for (const file of analysis.files) {
    const facts = ev.factsOf(file)
    const at = (detail: string): string => detailIn(test, file, detail)
    for (const detail of facts.undeterminable) out.push(finding(KIND.undeterminableModuleLoad, test, at(detail)))
    if (!target) continue
    for (const ref of facts.refs.filter(isForbiddenDependency)) out.push(finding(KIND.forbiddenDependency, test, at(ref.specifier)))
    for (const call of facts.loadCalls) out.push(finding(KIND.moduleMockOrLoad, test, at(call.detail)))
    for (const detail of facts.disallowedVi) out.push(finding(KIND.disallowedViCall, test, at(detail)))
  }
  for (const { file, specifier } of analysis.unresolved) {
    out.push(finding(KIND.unresolvedLocalImport, test, detailIn(test, file, specifier)))
  }
  return out
}

function collectInventoryFindings(ev: Evaluation): IsolationFinding[] {
  const out: IsolationFinding[] = []
  const listed = new Set(ev.testFiles)
  for (const test of ev.testFiles) {
    if (ev.entryOf(test) === undefined) out.push(finding(KIND.unclassifiedTest, test, '台帳 TEST_INVENTORY に分類がありません'))
  }
  for (const [test, entry] of Object.entries(ev.input.tests)) {
    if (!listed.has(test)) out.push(finding(KIND.unknownTest, test, '列挙されたテストに存在しません'))
    if (!TEST_CLASSES.includes(entry.class)) {
      out.push(finding(KIND.invalidClass, test, `class が不正です: ${String(entry.class)}`))
      continue
    }
    if (entry.class !== 'unit' && (entry.reason ?? '').trim() === '') out.push(finding(KIND.missingReason, test, `${entry.class} には理由が必須です`))
    if (entry.class === 'adapter' && listed.has(test)) {
      const dependsOnAdapter = ev.analysisOf(test).files.some((f) => ev.factsOf(f).refs.some(isAdapterDependency))
      if (!dependsOnAdapter) out.push(finding(KIND.adapterWithoutAdapter, test, 'adapter への実行時 import がありません'))
    }
  }
  return out
}

function collectSubjectFindings(ev: Evaluation): IsolationFinding[] {
  const out: IsolationFinding[] = []
  const { productionFiles, subjects } = ev.input
  const production = new Set(productionFiles)
  const subjectKeys = Object.keys(subjects)
  const registered = new Set(subjectKeys)
  const knownContexts = new Set(subjectKeys.map(contextOf).filter((c): c is string => c !== null))
  const unitTests = ev.testFiles.filter((t) => ev.entryOf(t)?.class === 'unit')

  for (const file of [...new Set(productionFiles)].sort()) {
    if (!isDomainOrAppModule(file) || registered.has(file)) continue
    const context = contextOf(file)
    const detail =
      context !== null && !knownContexts.has(context)
        ? `新しい context: ${context}。台帳 SUBJECT_INVENTORY に subject とテストの対応を追加してください`
        : '台帳 SUBJECT_INVENTORY に subject とテストの対応を追加してください'
    out.push(finding(KIND.unregisteredSubject, file, detail))
  }

  for (const subject of subjectKeys) {
    if (!production.has(subject) || !isDomainOrAppModule(subject)) {
      out.push(finding(KIND.unknownSubject, subject, 'production の DOMAIN・APP のファイルではありません'))
      continue
    }
    const recorded = subjects[subject]
    const expected = unitTests.filter((t) => ev.analysisOf(t).reach.has(withoutExtension(subject)))
    const excess = recorded.filter((t) => !expected.includes(t))
    const missing = expected.filter((t) => !recorded.includes(t))
    if (excess.length > 0 || missing.length > 0) {
      out.push(finding(KIND.subjectTestsMismatch, subject, `過剰: [${excess.join(', ')}] 不足: [${missing.join(', ')}]`))
    }
    if (recorded.length === 0 && !isTypeOnlyModule(subject, ev.sourceOf(subject))) {
      out.push(finding(KIND.subjectUntested, subject, '型だけの module ではないので、検証する unit テストが 1 本以上必要です'))
    }
  }
  return out
}

/** setup ファイルは全テストの前に走るので、production の import も mock も持ち込ませない（パッケージの mock は許可）。 */
function collectSetupFindings(ev: Evaluation): IsolationFinding[] {
  const out: IsolationFinding[] = []
  for (const setup of ev.input.setupFiles) {
    for (const file of ev.analysisOf(setup).files) {
      const facts = ev.factsOf(file)
      const at = (detail: string): string => detailIn(setup, file, detail)
      for (const ref of facts.refs) {
        if (ref.resolved !== null && !isUnderTests(ref.resolved)) out.push(finding(KIND.setupProductionDependency, setup, at(ref.specifier)))
      }
      for (const call of facts.loadCalls) {
        if (call.resolved !== null && !isUnderTests(call.resolved)) out.push(finding(KIND.setupProductionDependency, setup, at(call.detail)))
      }
    }
  }
  return out
}

/** 一致する許可は違反を消し、どの違反にも使われなかった許可は stale として返す。 */
function applyAllowances(findings: readonly IsolationFinding[], allowances: readonly MigrationAllowance[]): IsolationFinding[] {
  const keyOf = (file: string, detail: string): string => `${file}\u0000${detail}`
  const allowedKeys = new Set(allowances.map((a) => keyOf(a.file, a.specifier)))
  const usedKeys = new Set<string>()
  const remaining = findings.filter((f) => {
    const key = keyOf(f.file, f.detail)
    const allowable = (f.kind === KIND.forbiddenDependency || f.kind === KIND.moduleMockOrLoad) && allowedKeys.has(key)
    if (allowable) usedKeys.add(key)
    return !allowable
  })
  const stale = allowances
    .filter((a) => !usedKeys.has(keyOf(a.file, a.specifier)))
    .map((a) => finding(KIND.staleAllowance, a.file, a.specifier))
  return [...remaining, ...stale]
}

const findingKey = (f: IsolationFinding): string => `${f.kind} | ${f.file} | ${f.detail}`

function sortedUnique(findings: readonly IsolationFinding[]): IsolationFinding[] {
  const byKey = new Map(findings.map((f) => [findingKey(f), f] as const))
  return [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, f]) => f)
}

/**
 * web-check-08: 全テストの分類・全 subject の対応・対象テストの隔離を、注入された入力だけで判定する（fs・git に触れない）。
 * 前提条件（列挙が空、本文を読めない）だけ throw し、それ以外は finding として返す。
 */
export function evaluateTestIsolation(input: TestIsolationInput): TestIsolationResult {
  assertPreconditions(input)
  const ev = createEvaluation(input)
  const targets = ev.testFiles.filter((t) => isTarget(ev, t))
  const targetSet = new Set(targets)
  const findings = [
    ...ev.testFiles.flatMap((t) => collectTestFindings(ev, t, targetSet.has(t))),
    ...collectInventoryFindings(ev),
    ...collectSubjectFindings(ev),
    ...collectSetupFindings(ev),
  ]
  return {
    targets,
    domainImportingNonUnit: ev.testFiles.filter((t) => ev.entryOf(t)?.class !== 'unit' && reachesDomainOrApp(ev.analysisOf(t))),
    findings: sortedUnique(applyAllowances(findings, input.allowances)),
  }
}
