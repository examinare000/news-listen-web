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
  'tests/architecture/cqrs.account.test.ts',
  'tests/architecture/cqrs.admin.test.ts',
  'tests/architecture/cqrs.playback.test.ts',
  'tests/architecture/immutability.account.test.ts',
  'tests/architecture/immutability.admin.test.ts',
  'tests/architecture/immutability.playback.test.ts',
  'tests/architecture/readonly.types.test.ts',
  'tests/lib/account/adminAccess.test.ts',
  'tests/lib/account/application/commands.test.ts',
  'tests/lib/account/application/passkey.test.ts',
  'tests/lib/account/application/queries.test.ts',
  'tests/lib/account/application/readModels.test.ts',
  'tests/lib/account/application/subjectCleanup.test.ts',
  'tests/lib/account/application/entryGate.test.ts',
  'tests/lib/account/domain/authSession.test.ts',
  'tests/lib/account/domain/password.test.ts',
  'tests/lib/account/domain/subject.test.ts',
  'tests/lib/account/domain/username.test.ts',
  'tests/lib/admin/application/commands.test.ts',
  'tests/lib/admin/application/queries.test.ts',
  'tests/lib/admin/application/readModels.test.ts',
  'tests/lib/admin/domain/featuredOrder.test.ts',
  'tests/lib/admin/domain/inviteInput.test.ts',
  'tests/lib/admin/domain/userGuard.test.ts',
  'tests/helpers/fakePushBrowserPort.test.ts',
  'tests/lib/notifications/application/commands.test.ts',
  'tests/lib/notifications/application/queries.test.ts',
  'tests/lib/notifications/application/readModels.test.ts',
  'tests/architecture/cqrs.notifications.test.ts',
  'tests/architecture/immutability.notifications.test.ts',
  'tests/lib/catalog/domain/article.test.ts',
  'tests/lib/catalog/domain/episode.test.ts',
  'tests/lib/catalog/domain/featuredCategory.test.ts',
  'tests/lib/catalog/domain/generationLimit.test.ts',
  'tests/lib/catalog/domain/source.test.ts',
  'tests/lib/catalog/presentation/failureMessage.test.ts',
  'tests/lib/catalog/presentation/featuredCategoryLabels.test.ts',
  'tests/lib/format.test.ts',
  'tests/lib/highlightTerms.test.ts',
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
  'tests/lib/catalog/domain/generationWatch.test.ts',
  'tests/lib/catalog/application/commands.test.ts',
  'tests/lib/catalog/application/queries.test.ts',
  'tests/lib/catalog/application/readModels.test.ts',
  'tests/architecture/cqrs.catalog.test.ts',
  'tests/architecture/cqrs.preferences.test.ts',
  'tests/lib/preferences/application/commands.test.ts',
  'tests/lib/preferences/application/queries.test.ts',
  'tests/lib/preferences/application/readModels.test.ts',
  'tests/lib/preferences/domain/settings.test.ts',
  'tests/lib/shared/difficulty.test.ts',
  'tests/lib/push/pushRegistration.test.ts',
  'tests/lib/relativeTime.conformance.test.ts',
  'tests/helpers/fakeWebAuthnBrowserPort.test.ts',
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
      'tests/lib/api/gateway.test.ts',
      'tests/lib/contextApi.test.ts',
    ],
  },
  {
    reason: 'ブラウザ API（cache・storage・cookie・service worker・音声・WebAuthn・Push）を包む adapter の挙動を検証する',
    files: [
      'tests/lib/cookie.test.ts',
      'tests/lib/platform/adapters.test.ts',
      'tests/lib/platform/playbackBrowserAdapters.test.ts',
      'tests/lib/pushBrowserPort.real.test.ts',
      'tests/lib/reportClientError.test.ts',
      'tests/lib/sfx.test.ts',
      'tests/lib/swCacheCleanup.test.ts',
      'tests/lib/webpush.test.ts',
      'tests/lib/platform/webauthn.test.ts',
    ],
  },
  {
    reason: 'infrastructure の gateway と mapper が backend の応答を domain の型へ変換する挙動を検証する',
    files: [
      'tests/lib/account/infrastructure/accountGateway.test.ts',
      'tests/lib/admin/infrastructure/adminGateway.test.ts',
      'tests/lib/catalog/infrastructure/episodeGateway.test.ts',
      'tests/lib/catalog/infrastructure/catalogGateway.test.ts',
      'tests/lib/catalog/infrastructure/episodeMapper.test.ts',
      'tests/lib/notifications/infrastructure/notificationsGateway.test.ts',
      'tests/lib/preferences/infrastructure/preferencesGateway.test.ts',
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
      'tests/contexts/useAccountCommands.test.tsx',
      'tests/contexts/useAccountQueries.test.tsx',
      'tests/contexts/useAdminCommands.test.tsx',
      'tests/contexts/useAdminQueries.test.tsx',
      'tests/contexts/usePasskeySupport.test.tsx',
      'tests/contexts/useCatalogCommands.test.tsx',
      'tests/contexts/useCatalogQueries.test.tsx',
      'tests/contexts/useNotificationsCommands.test.tsx',
      'tests/contexts/useNotificationsQueries.test.tsx',
      'tests/contexts/usePreferencesCommands.test.tsx',
      'tests/contexts/usePreferencesQueries.test.tsx',
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
  'lib/catalog/domain/episode.ts': [
    'tests/lib/catalog/domain/episode.test.ts',
    'tests/lib/playback/domain/queueEntry.test.ts',
    'tests/lib/catalog/application/queries.test.ts',
    'tests/lib/catalog/application/readModels.test.ts',
  ],
  'lib/catalog/domain/article.ts': ['tests/lib/catalog/domain/article.test.ts'],
  'lib/catalog/domain/generationWatch.ts': ['tests/lib/catalog/domain/generationWatch.test.ts'],
  'lib/catalog/application/commands.ts': ['tests/lib/catalog/application/commands.test.ts', 'tests/architecture/cqrs.catalog.test.ts'],
  'lib/catalog/application/queries.ts': ['tests/lib/catalog/application/queries.test.ts', 'tests/architecture/cqrs.catalog.test.ts'],
  'lib/catalog/application/readModels.ts': ['tests/lib/catalog/application/readModels.test.ts'],
  'lib/catalog/application/ports.ts': [],
  'lib/catalog/domain/generationLimit.ts': ['tests/lib/catalog/domain/generationLimit.test.ts'],
  'lib/catalog/domain/source.ts': ['tests/lib/catalog/domain/source.test.ts'],
  'lib/catalog/domain/featuredCategory.ts': ['tests/lib/catalog/domain/featuredCategory.test.ts'],
  'lib/account/application/entryGate.ts': ['tests/lib/account/application/entryGate.test.ts'],
  'lib/account/application/passkey.ts': ['tests/lib/account/application/passkey.test.ts'],
  'lib/account/application/commands.ts': ['tests/lib/account/application/commands.test.ts', 'tests/architecture/cqrs.account.test.ts'],
  'lib/account/application/queries.ts': [
    'tests/architecture/cqrs.account.test.ts',
    'tests/architecture/immutability.account.test.ts',
    'tests/lib/account/application/queries.test.ts',
  ],
  'lib/account/application/readModels.ts': [
    'tests/architecture/immutability.account.test.ts',
    'tests/lib/account/application/readModels.test.ts',
  ],
  'lib/account/application/ports.ts': [],
  'lib/account/domain/username.ts': ['tests/lib/account/domain/username.test.ts'],
  'lib/admin/domain/userGuard.ts': ['tests/lib/admin/domain/userGuard.test.ts'],
  'lib/admin/domain/featuredOrder.ts': ['tests/lib/admin/domain/featuredOrder.test.ts'],
  'lib/admin/domain/inviteInput.ts': ['tests/lib/admin/domain/inviteInput.test.ts'],
  'lib/admin/application/commands.ts': ['tests/lib/admin/application/commands.test.ts', 'tests/architecture/cqrs.admin.test.ts'],
  'lib/admin/application/queries.ts': [
    'tests/architecture/cqrs.admin.test.ts',
    'tests/architecture/immutability.admin.test.ts',
    'tests/lib/admin/application/queries.test.ts',
  ],
  'lib/admin/application/readModels.ts': ['tests/lib/admin/application/readModels.test.ts'],
  'lib/admin/application/ports.ts': [],
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
  'lib/preferences/application/commands.ts': [
    'tests/architecture/cqrs.preferences.test.ts',
    'tests/lib/preferences/application/commands.test.ts',
  ],
  'lib/preferences/application/ports.ts': [],
  'lib/preferences/application/queries.ts': [
    'tests/architecture/cqrs.preferences.test.ts',
    'tests/lib/preferences/application/queries.test.ts',
  ],
  'lib/preferences/application/readModels.ts': ['tests/lib/preferences/application/readModels.test.ts'],
  'lib/preferences/domain/settings.ts': ['tests/lib/preferences/domain/settings.test.ts'],
  'lib/notifications/application/commands.ts': [
    'tests/architecture/cqrs.notifications.test.ts',
    'tests/lib/notifications/application/commands.test.ts',
  ],
  'lib/notifications/application/ports.ts': [],
  'lib/notifications/application/pushRegistration.ts': ['tests/lib/push/pushRegistration.test.ts'],
  'lib/notifications/application/queries.ts': [
    'tests/architecture/cqrs.notifications.test.ts',
    'tests/architecture/immutability.notifications.test.ts',
    'tests/lib/notifications/application/queries.test.ts',
  ],
  'lib/notifications/application/readModels.ts': ['tests/lib/notifications/application/readModels.test.ts'],
  'lib/notifications/domain/pushSubscriptionState.ts': [],
}

/**
 * 既知の未移行違反。各行は担当 task の受入に接続されており、担当 task が依存を消すときに行を削除する。
 * 増やしてよいのは、新しく検出した違反を既存の責務 task に接続するときだけ。違反を避けるために足さない。
 * 最終 task（web-slice-closure-01）で 0 件にする。
 */
export const MIGRATION_ALLOWANCES: readonly MigrationAllowance[] = []
