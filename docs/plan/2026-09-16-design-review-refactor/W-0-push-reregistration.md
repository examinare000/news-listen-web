## W-0 web: Web Push の再登録と主体離脱時の購読解除

## 概要
共有端末で利用者が交代したとき、前の利用者宛の通知が次の利用者のブラウザに届き続けないようにする。あわせて、サーバ側の購読行が失われても利用者が気づかないうちに回復する経路を作る。

本 slice は [ADR-104](../../../../docs/adr/104-subject-departure-and-subject-scoped-assets.md) の**決定 18〜24 を適用する slice** であり、新たな設計判断を含まない。未決の選択は 1 つも無い。

**後続への影響**: 本 slice の merge が backend B-S5（`pushSubscriptions` への連鎖削除と既存行の一括削除）の着手条件である（決定 13）。完了報告にそのことを書くこと。

## 前提・着手条件
- `docs/trial-log/` を最初に読み、棄却済み案を再試行しない。
- baseline: 着手前に `npm run lint`・`npx tsc --noEmit`・`npm test` を実行し、**テスト件数を記録**する。完了時は「着手前の件数＋新規追加分」が green であること。

## 確認済みの事実（コードで検証済み。再調査は不要）
- `useWebPushSubscription`（113 行）の利用箇所は `components/PushNotificationSection.tsx:19` の 1 か所のみ。それを使うのは `app/(app)/settings/page.tsx:507` だけ。
- `app/(app)/layout.tsx`（21 行）に認証ガードは無い。設定ページを直接開くと、hook の初期化時点で認証状態は `'unknown'`。
- hook の初期化 effect の依存は `[port]` だけ（`hooks/useWebPushSubscription.ts:62`）＝ mount 時 1 回しか走らない。
- `contexts/AuthContext.tsx` の `logout`（105-122 行）は購読解除を呼んでいない。`client().logout()` → `deleteAllAudio()` / `clearManagedServiceWorkerCaches()` → `setUser(null)` / `setStatus('unauthenticated')` の順。
- `useAuth` は Provider の外で例外を投げる（`AuthContext.tsx:146-152`）。既存テスト 2 ファイルは Provider 無しで `renderHook` / `render` している。
- API: `lib/api.ts:463` `subscribePush(subscription: PushSubscriptionJSON)`、`:470` `unsubscribePush(endpoint: string)`、`:456` `getVapidPublicKey()`。
- backend は endpoint 単位の upsert（`notifications.py:91-106` ＋ `firestore_client.py:1856-1863` の `set(merge=True)`）で冪等。
- 公開状態集合 `PushSubscriptionState` は **6 値**（`types/index.ts:412-419`）: `unsupported` / `denied` / `unsubscribed` / `subscribing` / `subscribed` / `error`。

## 設計（mino-design: ドメイン層の導入・カプセル化・ファットクラス回避）

現在の hook は「状態機械」「API クライアントの生成」「VAPID 鍵の変換」「ブラウザ port の操作」を 1 つに抱えている。再送を layout からも呼ぶ必要が出たため、**React に依存しない協調オブジェクトへ切り出す**。

### 1. `lib/push/pushRegistration.ts`（新設・React 非依存）

端末の購読とサーバ登録の整合を所有する。注入されるのは `PushBrowserPort` と API クライアントだけで、React・DOM・グローバルを直接参照しない。

公開する操作は次の **5 つに限る**（これ以外を公開しない）。

| 操作 | 責務 |
|---|---|
| `resolve()` | 機能検出 → 許可確認 → 既存購読の確認を行い、6 値のいずれかを返す |
| `subscribe()` | 許可要求 → SW 登録 → VAPID 取得 → 購読作成 → サーバ登録 |
| `unsubscribe()` | ブラウザ側の購読解除 → サーバ行の削除（設定画面のボタン用。従来どおり両方消す） |
| `reregister()` | **既存購読があるときだけ**サーバへ再送する。無ければ何もしない |
| `detachFromSubject()` | **サーバ行だけ**削除する。ブラウザ側の購読は残す（主体離脱用） |

- `reregister()` と `detachFromSubject()` が本 slice の新規。`unsubscribe()` と `detachFromSubject()` を別の操作にするのは、消す対象が違うためである（決定 21）。
- 状態は持たない。状態を持つのは hook 側。

### 2. `hooks/useWebPushSubscription.ts`（改修）

- 6 値の状態保持と、`pushRegistration` への委譲だけを行う薄い React アダプタにする。
- **認証状態を引数で受け取る**（決定 22）。hook は `useAuth()` を呼ばない。引数の型は `'unknown' | 'authenticated' | 'unauthenticated'`。省略時は `'unknown'` 相当（＝再送しない）とし、既存の呼び出しが壊れないようにする。
- 認証状態が `'authenticated'` に**変わるたび**に `reregister()` を呼ぶ（決定 19）。`'unknown'` の間は何もしない。
- `pushRegistration` は hook の中で `createApiClient()` を使って組み立てる（既存テストの `vi.mock('@/lib/api')` がそのまま効くようにするため）。

### 3. `components/PushReregistration.tsx`（新設）

- `app/(app)/layout.tsx` に置く、**何も描画しない**部品（`return null`）。
- `useAuth()` で認証状態を取り、`useWebPushSubscription` に渡す。これだけを行う。

### 4. `contexts/AuthContext.tsx` の `logout`（改修）

- `client().logout()` を呼ぶ**前に** `detachFromSubject()` を試みる（サーバ行の削除には認証が要るため）。
- 失敗してもログアウトは続行する（決定 23）。既存の `deleteAllAudio()` / `clearManagedServiceWorkerCaches()` と同じベストエフォート方針に揃える。

## 対象ファイル
| ファイル | 変更 |
|---|---|
| `lib/push/pushRegistration.ts` | 新設 |
| `hooks/useWebPushSubscription.ts` | 改修（委譲・認証状態の引数・再送） |
| `components/PushReregistration.tsx` | 新設 |
| `app/(app)/layout.tsx` | `PushReregistration` を 1 行追加 |
| `contexts/AuthContext.tsx` | `logout` に `detachFromSubject()` を追加 |
| `tests/lib/push/pushRegistration.test.ts` | 新設 |
| `tests/components/PushReregistration.test.tsx` | 新設 |

## 完了条件
1. `lib/push/pushRegistration.ts` が存在し、公開する操作が `resolve` / `subscribe` / `unsubscribe` / `reregister` / `detachFromSubject` の **5 つだけ**である。React・DOM・`navigator` を直接参照しない。
2. 認証状態が `'authenticated'` へ変わると、**ブラウザに既存購読があるときだけ** `subscribePush` が 1 回呼ばれる。既存購読が無いときは `subscribePush` も `requestPermission` も呼ばれない。
3. 認証状態が `'unknown'` の間は `subscribePush` が呼ばれない。
4. `logout` を呼ぶと、`client().logout()` より**先に** `unsubscribePush(endpoint)` が呼ばれる。ブラウザ側の `port.unsubscribe()` は**呼ばれない**。
5. `unsubscribePush` が reject しても `logout` は完了し、`status` が `'unauthenticated'` になる。
6. layout 側の再送で `subscribePush` が reject しても例外が外へ漏れず、再試行のための状態（回数・タイマー）を持たない。
7. `PushSubscriptionState` の **6 値**（`unsupported` / `denied` / `unsubscribed` / `subscribing` / `subscribed` / `error`）が変わっていない。値の追加・削除・改名をしない。
8. 既存テスト **2 ファイル**（`tests/hooks/useWebPushSubscription.test.ts`・`tests/components/PushNotificationSection.test.tsx`）が **1 行も変更せずに** green である。変更が必要になった場合は設計（決定 22）の適用が誤っているので、テストではなく実装側を直す。
9. `npm run lint`・`npx tsc --noEmit`・`npm test` が green で、テスト件数が「着手前の件数＋新規追加分」である。
10. 設定画面の購読ボタンの見え方が変わっていない（ボタンが出るのは `unsubscribed` / `subscribed` / `subscribing` のときだけ、という現行の条件を変えない）。

## 禁止事項 / scope 外
- **`contexts/AuthContext.tsx` の `logout` 以外の既存経路を変えない。** `login` / `register` / `refreshMe` / `loginWithPasskey` には触らない。
- **ブラウザ側の購読オブジェクトを主体離脱で解除しない**（決定 21）。`port.unsubscribe()` を呼ぶのは設定画面のボタン経路（`unsubscribe()`）だけ。
- **再試行の状態を新たに持たない**（決定 24）。回数・間隔・「もう送ったか」のフラグを作らない。
- **通知許可を自動で要求しない。** ログイン時に `requestPermission()` を呼ばない。
- backend・ios・android のコードを変更しない。
- `pushSubscriptions` の一括削除・連鎖削除は本 slice の対象外（backend B-S5）。
- 既存テスト 2 ファイルを変更しない（完了条件 8）。

## 参照
- [ADR-104](../../../../docs/adr/104-subject-departure-and-subject-scoped-assets.md) 決定 18〜24（本 slice の根拠）・決定 13（B-S5 との順序）
- [ADR-020](../../../../docs/adr/020-push-notification-web-push.md)（Web Push の採用）
- 投入計画: [docs/plan/2026-09-16-design-review-refactor.md](../../../../docs/plan/2026-09-16-design-review-refactor.md)
