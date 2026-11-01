// web-check-08 の対象台帳。vitest が集める全テストの分類、DOMAIN・APP の subject とそれを検証するテストの対応、
// 既知の未移行違反の許可を 1 か所に持つ。対象の集合そのものは導出値で、ここには保存しない。
// 検査は testIsolation.test.ts の `evaluateTestIsolation` が行う。
// 正本: docs/design/modules/web/2026-09-30-implementation-spec-target-architecture.md §7 web-check-08。
//
// 分類の規則:
// - unit: I/O を持たない production module（domain・application・shared・純粋な旧 module）を検証するテスト
// - adapter: API・platform・infrastructure・旧ブラウザ adapter・route handler を検証するテスト。adapter への依存が検証の対象そのもの
// - integration: component・context・page・hook、ファイル・git・eslint を読む architecture テストなど、複数の層を結合して検証するテスト
// adapter と integration は理由が必須。禁止依存が見つかった後に分類を変えて逃げない（閉じた集合と subject の対応が差分を検出する）。
import type { MigrationAllowance, TestInventoryEntry } from '../helpers/architectureDetectors'

const UNIT_TESTS: readonly string[] = [
  'tests/architecture/cqrs.playback.test.ts',
  'tests/architecture/immutability.account.test.ts',
  'tests/architecture/immutability.playback.test.ts',
  'tests/architecture/readonly.types.test.ts',
  'tests/lib/account/adminAccess.test.ts',
  'tests/lib/account/application/subjectCleanup.test.ts',
  'tests/lib/account/domain/authSession.test.ts',
  'tests/lib/account/domain/password.test.ts',
  'tests/lib/account/domain/subject.test.ts',
  'tests/lib/catalog/domain/episode.test.ts',
  'tests/lib/catalog/domain/generationLimit.test.ts',
  'tests/lib/catalog/presentation/failureMessage.test.ts',
  'tests/lib/featuredCategories.test.ts',
  'tests/lib/format.test.ts',
  'tests/lib/highlightTerms.test.ts',
  'tests/lib/passkey.test.ts',
  'tests/lib/playback/application/coordinator.test.ts',
  'tests/lib/playback/application/positionReporter.test.ts',
  'tests/lib/playback/application/readModels.test.ts',
  'tests/lib/playback/domain/queueEntry.test.ts',
  'tests/lib/playback/ports.test.ts',
  'tests/lib/playback/queue.conformance.test.ts',
  'tests/lib/playback/queue.test.ts',
  'tests/lib/playback/resume.test.ts',
  'tests/lib/playback/session.generation.test.ts',
  'tests/lib/playback/session.test.ts',
  'tests/lib/playback/source.test.ts',
  'tests/lib/playback/transition.test.ts',
  'tests/lib/podcastPolling.test.ts',
  'tests/lib/podcastTitle.test.ts',
  'tests/lib/preferences/domain/settings.test.ts',
  'tests/lib/push/pushRegistration.test.ts',
  'tests/lib/relativeTime.conformance.test.ts',
  'tests/lib/webpush.test.ts',
  'tests/next.config.test.ts',
  'tests/types/index.test.ts',
  'tests/types/jest-dom-matchers.test.ts',
]

interface ReasonedGroup {
  readonly reason: string
  readonly files: readonly string[]
}

const ADAPTER_GROUPS: readonly ReasonedGroup[] = [
  {
    reason: 'API クライアント（lib/api）と gateway の HTTP 契約を検証する。技術 adapter への依存が検証の対象そのもの',
    files: [
      'tests/lib/api.auth.test.ts',
      'tests/lib/api.invites.test.ts',
      'tests/lib/api.passkey.test.ts',
      'tests/lib/api.sessions.test.ts',
      'tests/lib/api.starred.test.ts',
      'tests/lib/api.test.ts',
      'tests/lib/api.webTemp01.fake.test.tsx',
      'tests/lib/api.webTemp01.test.ts',
      'tests/lib/api/gateway.test.ts',
    ],
  },
  {
    reason: 'ブラウザ API（cache・storage・cookie・service worker・音声・WebAuthn・Push）を包む adapter の挙動を検証する',
    files: [
      'tests/lib/cookie.test.ts',
      'tests/lib/platform/adapters.test.ts',
      'tests/lib/platform/playbackBrowserAdapters.test.ts',
      'tests/lib/pushBrowserPort.real.test.ts',
      'tests/lib/pushBrowserPort.test.ts',
      'tests/lib/reportClientError.test.ts',
      'tests/lib/sfx.test.ts',
      'tests/lib/swCacheCleanup.test.ts',
      'tests/lib/webauthnBrowserPort.test.ts',
    ],
  },
  {
    reason: 'infrastructure の gateway と mapper が backend の応答を domain の型へ変換する挙動を検証する',
    files: [
      'tests/lib/catalog/infrastructure/episodeGateway.test.ts',
      'tests/lib/catalog/infrastructure/episodeMapper.test.ts',
    ],
  },
  {
    reason:
      'infrastructure の保存庫・端末の位置・gateway の関数が、技術 seam（Cache・KeyValueStore・ApiGateway の double）と結んで record と request の形を検証する',
    files: [
      'tests/lib/playback/infrastructure/gatewayFns.test.ts',
      'tests/lib/playback/infrastructure/localPositionStore.test.ts',
      'tests/lib/playback/infrastructure/offlineLibrary.test.ts',
    ],
  },
  {
    reason: 'infrastructure の設定の key と codec を、`KeyValueStore` の double と結んで検証する',
    files: ['tests/lib/preferences/infrastructure/localSettingsStore.test.ts'],
  },
  {
    reason: 'route handler（app/api）が backend へ中継する挙動を検証する',
    files: ['tests/app/api/proxy.test.ts'],
  },
  {
    reason:
      'infrastructure の mapper（decodeEpisode）の不変性そのものを検証の対象とする。禁止依存を避けるための分類ではない。' +
      'DOMAIN の episode にも到達するので、閉じた集合 domainImportingNonUnit で固定される',
    files: ['tests/architecture/immutability.catalog.test.ts'],
  },
  {
    reason:
      'infrastructure の codec（localSettingsStore）の不変性そのものを検証の対象とする。禁止依存を避けるための分類ではない。' +
      'DOMAIN の settings にも到達するので、閉じた集合 domainImportingNonUnit で固定される',
    files: ['tests/architecture/immutability.preferences.test.ts'],
  },
]

const INTEGRATION_GROUPS: readonly ReasonedGroup[] = [
  {
    reason: 'ページを描画し、API・context・component を結合して画面の挙動を検証する',
    files: [
      'tests/app/admin/featured-sites/page.test.tsx',
      'tests/app/admin/invites/page.test.tsx',
      'tests/app/admin/metrics/page.test.tsx',
      'tests/app/admin/users/page.test.tsx',
      'tests/app/app-group-error.test.tsx',
      'tests/app/app-group-layout.test.tsx',
      'tests/app/dashboard/page.test.tsx',
      'tests/app/error.test.tsx',
      'tests/app/feed/page.test.tsx',
      'tests/app/layout.test.tsx',
      'tests/app/page.test.tsx',
      'tests/app/podcast/id/page.test.tsx',
      'tests/app/podcast/page.test.tsx',
      'tests/app/privacy/page.test.tsx',
      'tests/app/settings/page.test.tsx',
      'tests/app/signup/page.test.tsx',
      'tests/app/subscriptions/page.test.tsx',
      'tests/app/terms/page.test.tsx',
      'tests/app/vocabulary-test/page.test.tsx',
    ],
  },
  {
    reason: 'component を描画し、利用者の操作と context・API の結合を検証する',
    files: [
      'tests/components/AdminGate.test.tsx',
      'tests/components/ArticleCard.test.tsx',
      'tests/components/AudioPlayerBar.test.tsx',
      'tests/components/BrandLogo.test.tsx',
      'tests/components/ClientErrorReporter.test.tsx',
      'tests/components/lp/LandingPage.test.tsx',
      'tests/components/NavigationBar.test.tsx',
      'tests/components/PlaybackToasts.test.tsx',
      'tests/components/PodcastCard.test.tsx',
      'tests/components/PushNotificationSection.test.tsx',
      'tests/components/PushRegistrar.test.tsx',
      'tests/components/PushReregistration.test.tsx',
      'tests/components/ui/AccountSection.test.tsx',
      'tests/components/ui/ConfirmDialog.test.tsx',
      'tests/components/ui/DifficultyBadge.test.tsx',
      'tests/components/ui/LoginModal.passkey.test.tsx',
      'tests/components/ui/LoginModal.test.tsx',
      'tests/components/ui/LogoutButton.test.tsx',
      'tests/components/ui/Menu.test.tsx',
      'tests/components/ui/OnboardingSourcesModal.test.tsx',
      'tests/components/ui/SidebarAccount.test.tsx',
      'tests/components/ui/StatusBadge.test.tsx',
      'tests/components/ui/ThemeToggle.test.tsx',
      'tests/components/ui/Toast.test.tsx',
    ],
  },
  {
    reason: 'React context を provider ごと描画し、状態遷移と外部ポートの結合を検証する',
    files: [
      'tests/contexts/ApiClientProvider.test.tsx',
      'tests/contexts/AuthProvider.expiry.test.tsx',
      'tests/contexts/AuthProvider.passkey.test.tsx',
      'tests/contexts/AuthProvider.push.test.tsx',
      'tests/contexts/AuthProvider.test.tsx',
      'tests/contexts/PlaybackProvider.completion.test.tsx',
      'tests/contexts/PlaybackProvider.offline.test.tsx',
      'tests/contexts/PlaybackProvider.queue.test.tsx',
      'tests/contexts/PlaybackProvider.server.test.tsx',
      'tests/contexts/PreferencesProvider.test.tsx',
      'tests/contexts/StreakContext.test.tsx',
    ],
  },
  {
    reason: 'hook を描画環境で動かし、DOM・storage・タイマーとの結合を検証する',
    files: [
      'tests/hooks/focusableElements.test.ts',
      'tests/hooks/useFocusTrap.test.tsx',
      'tests/hooks/usePodcastListPolling.test.ts',
      'tests/hooks/useWebPushSubscription.test.ts',
    ],
  },
  {
    reason: '複数の component と API の結合を、利用者の操作の流れで検証する',
    files: ['tests/integration/AccountSection-password-422.test.tsx'],
  },
  {
    reason: '配布する静的ファイル（manifest・service worker）を、ファイルとして読み込み実行して検証する',
    files: ['tests/public/manifest.test.ts', 'tests/public/sw.prefix.test.ts', 'tests/public/sw.test.ts'],
  },
  {
    reason: 'ファイル・git・eslint を読み、リポジトリ全体の構造規約を検証する',
    files: [
      'tests/architecture/boundaries.test.ts',
      'tests/architecture/dataModels.test.ts',
      'tests/architecture/publicTypes.test.ts',
      'tests/architecture/rules.test.ts',
      'tests/architecture/testIsolation.test.ts',
    ],
  },
]

const asEntries = (cls: 'adapter' | 'integration', groups: readonly ReasonedGroup[]): Array<[string, TestInventoryEntry]> =>
  groups.flatMap((g) => g.files.map((f): [string, TestInventoryEntry] => [f, { class: cls, reason: g.reason }]))

/** 全テストの分類。キーは web root 起点の path。 */
export const TEST_INVENTORY: Readonly<Record<string, TestInventoryEntry>> = Object.fromEntries([
  ...UNIT_TESTS.map((f): [string, TestInventoryEntry] => [f, { class: 'unit' }]),
  ...asEntries('adapter', ADAPTER_GROUPS),
  ...asEntries('integration', INTEGRATION_GROUPS),
])

/**
 * production の DOMAIN・APP ファイルと、それを検証する unit テスト（到達で求める）の対応。
 * 型だけの module（role・application/ports）は対応が空でよい。
 */
export const SUBJECT_INVENTORY: Readonly<Record<string, readonly string[]>> = {
  'lib/account/domain/adminAccess.ts': ['tests/lib/account/adminAccess.test.ts'],
  'lib/account/domain/authSession.ts': [
    'tests/architecture/immutability.account.test.ts',
    'tests/lib/account/domain/authSession.test.ts',
  ],
  'lib/account/domain/password.ts': [
    'tests/architecture/immutability.account.test.ts',
    'tests/lib/account/domain/password.test.ts',
  ],
  'lib/account/application/subjectCleanup.ts': ['tests/lib/account/application/subjectCleanup.test.ts'],
  'lib/account/domain/role.ts': [],
  'lib/account/domain/subject.ts': ['tests/lib/account/domain/subject.test.ts'],
  'lib/catalog/domain/episode.ts': ['tests/lib/catalog/domain/episode.test.ts', 'tests/lib/playback/domain/queueEntry.test.ts'],
  'lib/catalog/domain/generationLimit.ts': ['tests/lib/catalog/domain/generationLimit.test.ts'],
  'lib/passkey.ts': ['tests/lib/passkey.test.ts'],
  'lib/playback/application/coordinator.ts': [
    'tests/architecture/cqrs.playback.test.ts',
    'tests/architecture/immutability.playback.test.ts',
    'tests/lib/playback/application/coordinator.test.ts',
  ],
  'lib/playback/application/ports.ts': ['tests/lib/playback/ports.test.ts'],
  'lib/playback/application/positionReporter.ts': [
    'tests/lib/playback/application/coordinator.test.ts',
    'tests/lib/playback/application/positionReporter.test.ts',
  ],
  'lib/playback/application/readModels.ts': ['tests/lib/playback/application/readModels.test.ts'],
  'lib/playback/application/session.ts': [
    'tests/architecture/cqrs.playback.test.ts',
    'tests/architecture/immutability.playback.test.ts',
    'tests/lib/playback/application/coordinator.test.ts',
    'tests/lib/playback/session.generation.test.ts',
    'tests/lib/playback/session.test.ts',
  ],
  'lib/playback/domain/queue.ts': [
    'tests/architecture/immutability.playback.test.ts',
    'tests/architecture/readonly.types.test.ts',
    'tests/lib/playback/queue.conformance.test.ts',
    'tests/lib/playback/queue.test.ts',
  ],
  'lib/playback/domain/queueEntry.ts': ['tests/lib/playback/domain/queueEntry.test.ts'],
  'lib/playback/domain/resume.ts': ['tests/lib/playback/resume.test.ts', 'tests/lib/playback/session.test.ts'],
  'lib/playback/domain/session.ts': [
    'tests/architecture/immutability.playback.test.ts',
    'tests/lib/playback/session.test.ts',
    'tests/lib/playback/transition.test.ts',
  ],
  'lib/playback/domain/source.ts': ['tests/lib/playback/source.test.ts'],
  'lib/preferences/domain/settings.ts': ['tests/lib/preferences/domain/settings.test.ts'],
  'lib/push/pushRegistration.ts': ['tests/lib/push/pushRegistration.test.ts'],
}

/**
 * 既知の未移行違反。各行は担当 task の受入に接続されており、担当 task が依存を消すときに行を削除する。
 * 増やしてよいのは、新しく検出した違反を既存の責務 task に接続するときだけ。違反を避けるために足さない。
 * 最終 task（web-slice-closure-01）で 0 件にする。
 */
export const MIGRATION_ALLOWANCES: readonly MigrationAllowance[] = [
  {
    file: 'tests/lib/passkey.test.ts',
    specifier: '@/lib/webauthnBrowserPort',
    owner: 'user',
    reason:
      'passkey が port の型と実装を同じ module から受け取る旧構成。この module の移動は account と notify の 2 つの slice で重なり、' +
      '先に移した slice が fake を tests/helpers/ に置いてこの行を削除する',
    removeBy: 'web-slice-account-01',
    task: 'web-slice-account-01',
  },
  {
    file: 'tests/lib/passkey.test.ts',
    specifier: '@/lib/api',
    owner: 'user',
    reason: 'ApiError を旧 API module から取っている。application の passkey が Result を返すので、テストは shared の失敗型を使う',
    removeBy: 'web-slice-account-01',
    task: 'web-slice-account-01',
  },
  {
    file: 'tests/lib/push/pushRegistration.test.ts',
    specifier: '@/lib/pushBrowserPort',
    owner: 'user',
    reason: 'fake が adapter の module に同居している。fake は tests/helpers/ に置き、port の型を import type で実装する',
    removeBy: 'web-slice-notify-01',
    task: 'web-slice-notify-01',
  },
  {
    file: 'tests/lib/push/pushRegistration.test.ts',
    specifier: '@/lib/webpush',
    owner: 'user',
    reason: '鍵の変換を旧 module から取っている。変換は adapter の内側に移し、port の引数を文字列にする',
    removeBy: 'web-slice-notify-01',
    task: 'web-slice-notify-01',
  },
]
