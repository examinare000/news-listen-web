## W-0 web: Web Push の再登録と主体離脱時の購読解除

## 概要
共有端末で利用者が交代したとき、前の利用者宛の通知が次の利用者のブラウザに届き続けないようにする。あわせて、サーバ側の購読行が失われても利用者が気づかないうちに回復する経路を作る。

本 slice は [ADR-104](../../../../docs/adr/104-subject-departure-and-subject-scoped-assets.md) の**決定 18〜24 を適用する slice** であり、新たな設計判断を含まない。2026-09-23 の takt `analyze_order` が `blocked` にした 3 件（下記「受入検査への回答」）は同日夜の user 決定 **SG-C5・SG-C6** で閉じた。未決の選択は 1 つも無い。

**後続への影響**: 本 slice の merge が backend B-S5（`pushSubscriptions` への連鎖削除と既存行の一括削除）の着手条件である（決定 13）。完了報告にそのことを書くこと。

## 2026-09-23 受入検査（takt `analyze_order`）への回答
| 指摘 | 内容 | 閉じた決定 | 本 order での反映 |
|---|---|---|---|
| C1（条項間の矛盾） | 完了条件 5「logout は必ず完了」と、`logout` が呼ぶ `detachFromSubject()` → `port.getExistingSubscription()` が `navigator.serviceWorker.ready` を待つ実装（SW 未登録のブラウザでは `ready` が永遠に解決しない）は両立しない | **SG-C5** | `lib/pushBrowserPort.ts` を対象に加え、`getExistingSubscription` を `navigator.serviceWorker.getRegistration()` 系へ変える（設計 §0）。logout は待ち時間上限を**持たない**（上限で逃げるのではなく、待たない取得にする） |
| SG-W0-1（未決: 既存購読の取得方法） | `ready` 待ち／timeout 付き `ready`／`getRegistration()` のいずれか | **SG-C5** | `getRegistration()`（引数なし＝現在のスコープ）。`undefined` なら **即座に `null`（未購読扱い）** |
| SG-W0-2（未決: logout の pin テストの置き場と port の差し替え方法） | `AuthProvider` に port を渡す prop を足すか、module mock で差し替えるか | **SG-C6** | 新規 `tests/contexts/AuthContext.push.test.tsx`。`vi.mock('@/lib/pushBrowserPort')` で `createRealPushBrowserPort` を fake に差し替える。**`AuthProvider` に props は足さない** |

## 前提・着手条件
- wave 1。依存 slice は無い。着手時に親リポ `news-listen` で `git submodule status` を実行し、`web` 行に `+` が無い（親のポインタと submodule main が一致している）こと。
- `docs/trial-log/` と親 `docs/trial-log/order-acceptance-inspection-finds-design-defects.md` を最初に読み、棄却済み案を再試行しない。
- baseline: 着手前に `npm run lint`・`npx tsc --noEmit`・`npm test` を実行し、**テスト件数を記録**する。完了時は「着手前の件数＋新規追加分」が green であること。

## 確認済みの事実（コードで検証済み。行番号は 2026-09-23 夜に web main `dba69c8` で再確認。再調査は不要）
- `useWebPushSubscription`（113 行）の利用箇所は `components/PushNotificationSection.tsx:19` の 1 か所のみ。それを使うのは `app/(app)/settings/page.tsx:507` だけ。
- `app/(app)/layout.tsx`（21 行）に認証ガードは無い。設定ページを直接開くと、hook の初期化時点で認証状態は `'unknown'`。`AuthProvider` は `app/layout.tsx:84`（root layout）にあり、`(app)` 配下の部品から `useAuth()` が使える。
- hook の初期化 effect の依存は `[port]` だけ（`hooks/useWebPushSubscription.ts:62`）＝ mount 時 1 回しか走らない。
- `contexts/AuthContext.tsx` の `logout`（105-123 行）は購読解除を呼んでいない。`client().logout()` → `deleteAllAudio()` / `clearManagedServiceWorkerCaches()` → `setUser(null)` / `setStatus('unauthenticated')` の順。
- `useAuth` は Provider の外で例外を投げる（`AuthContext.tsx:151-157`）。既存テスト 2 ファイルは Provider 無しで `renderHook` / `render` している。`AuthProvider` の既存 props は `children` / `initialUser` / `initialStatus`（`:42-49`）。`initialStatus` を渡すと起動時の `refreshMe` は走らない（`:139`）。
- `lib/pushBrowserPort.ts` の実 port は `getExistingSubscription`（57-70 行）・`subscribe`（73 行）・`unsubscribe`（92 行）の 3 メソッドで `await navigator.serviceWorker.ready` を使う。`ready` は **active な SW が無い間は解決しない** ため、SW 未登録のブラウザで `getExistingSubscription()` を呼ぶと永遠に待つ。SW の登録は root layout の `components/PushRegistrar.tsx`（`app/layout.tsx:90`）が `/sw.js` に対してベストエフォートで行うだけで、登録済みの保証は無い。
- `tests/lib/pushBrowserPort.test.ts` は **fake port だけ**を検証しており、実 port（`createRealPushBrowserPort`）のテストは無い。
- API: `lib/api.ts:463` `subscribePush(subscription: PushSubscriptionJSON)`、`:470` `unsubscribePush(endpoint: string)`、`:456` `getVapidPublicKey()`（`request<...>` を返す。失敗時は reject）。
- backend は endpoint 単位の upsert（`notifications.py:91-106` ＋ `firestore_client.py:1856-1863` の `set(merge=True)`）で冪等。
- 公開状態集合 `PushSubscriptionState` は **6 値**（`types/index.ts:413-419`。直前 `:412` はコメント行）: `unsupported` / `denied` / `unsubscribed` / `subscribing` / `subscribed` / `error`。

## 設計（mino-design: ドメイン層の導入・カプセル化・ファットクラス回避）

現在の hook は「状態機械」「API クライアントの生成」「VAPID 鍵の変換」「ブラウザ port の操作」を 1 つに抱えている。再送を layout からも呼ぶ必要が出たため、**React に依存しない協調オブジェクトへ切り出す**。

### 0. `lib/pushBrowserPort.ts` の `getExistingSubscription`（改修・SG-C5）

- 実 port の `getExistingSubscription()` を `await navigator.serviceWorker.ready` から **`await navigator.serviceWorker.getRegistration()`**（引数なし＝現在のスコープ。待ち続けない取得）へ変える。戻り値が `undefined`（SW 未登録）なら **待たずに `null`（未購読扱い）** を返す。登録があれば従来どおり `registration.pushManager.getSubscription()` を読み、`endpoint` / `p256dh` / `auth` のいずれかが欠ければ `null`。
- 変更行はこの 1 メソッドだけ。**`subscribe()` と `unsubscribe()` の `ready` 待ちは変えない**（どちらも設定画面のボタン経路で、`subscribe()` は直前に `registerServiceWorker()` を済ませている。`unsubscribe()` は購読中＝SW 登録済みのときしかボタンが出ない）。
- `PushBrowserPort` インターフェースのメソッド集合（7 つ）と fake port（`createFakePushBrowserPort`）は変えない。
- これにより `logout` → `detachFromSubject()` → `getExistingSubscription()` は SW 未登録でも即座に返り、logout は**待ち時間上限を持たずに**必ず完了する（timeout で逃げる案は採らない。SG-C5）。

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
- 認証状態が `'authenticated'` に**変わるたび**に `reregister()` を呼ぶ（決定 19）。「変わるたび」は **mount 時点で既に `'authenticated'` である場合を含む**（SG-C6。effect の依存に認証状態を入れ、値が `'authenticated'` になった render ごとに 1 回走らせる。直接設定ページを開いて `'unknown'` → `'authenticated'` と解決する経路と、認証済みで画面遷移して mount する経路の両方が対象）。`'unknown'` / `'unauthenticated'` の間は何もしない。
- `pushRegistration` は hook の中で `createApiClient()` を使って組み立てる（既存テストの `vi.mock('@/lib/api')` がそのまま効くようにするため）。

### 3. `components/PushReregistration.tsx`（新設）

- `app/(app)/layout.tsx` に置く、**何も描画しない**部品（`return null`）。
- `useAuth()` で認証状態を取り、`useWebPushSubscription` に渡す。これだけを行う。

### 4. `contexts/AuthContext.tsx` の `logout`（改修）

- `client().logout()` を呼ぶ**前に** `detachFromSubject()` を試みる（サーバ行の削除には認証が要るため）。`pushRegistration` は `createRealPushBrowserPort()` と `client()` から `AuthContext.tsx` 内で組み立てる（`AuthProvider` に port を渡す props は**足さない**。SG-C6。テストは `vi.mock('@/lib/pushBrowserPort')` で `createRealPushBrowserPort` を差し替える）。
- 失敗してもログアウトは続行する（決定 23）。既存の `deleteAllAudio()` / `clearManagedServiceWorkerCaches()` と同じベストエフォート方針に揃える。`detachFromSubject()` が reject し得る経路は **2 つ**（`port.getExistingSubscription()` と `client.unsubscribePush()`）で、どちらも `try/catch` で飲む。SW 未登録で既存購読が無ければ `unsubscribePush` は呼ばずに進む（設計 §0）。

### 5. テスト `tests/contexts/AuthContext.push.test.tsx`（新設・SG-C6）

- `render(<AuthProvider initialStatus="authenticated" initialUser={...}>...)` で `logout` を呼び、完了条件 4・5・11 を pin する。
- `vi.mock('@/lib/api')` で `createApiClient` を `{ logout, unsubscribePush, subscribePush, getMe, ... }` の `vi.fn()` に、`vi.mock('@/lib/pushBrowserPort', async (importOriginal) => ({ ...(await importOriginal()), createRealPushBrowserPort: () => fakePort }))` で実 port を `createFakePushBrowserPort({...})` に差し替える。既存 `tests/contexts/AuthContext.test.tsx` と同様に `@/lib/audioCache`・`@/lib/swCacheCleanup` も mock する。
- 検証する場面: (i) 既存購読あり → `unsubscribePush(endpoint)` が `client().logout()` より先に 1 回呼ばれ、`port.unsubscribe` は呼ばれない。(ii) `unsubscribePush` が reject → `status` が `'unauthenticated'` になる。(iii) `getExistingSubscription` が reject → 同上、`unsubscribePush` は呼ばれない。(iv) 既存購読なし（`null`）→ `unsubscribePush` は呼ばれず logout 完了。

## 対象ファイル
| ファイル | 変更 |
|---|---|
| `lib/pushBrowserPort.ts` | 改修（SG-C5）。変更行: `getExistingSubscription` の `navigator.serviceWorker.ready` → `getRegistration()`、**SW 未登録時に待たず `null`（未購読扱い）**。他のメソッド・fake port は不変 |
| `lib/push/pushRegistration.ts` | 新設 |
| `hooks/useWebPushSubscription.ts` | 改修（委譲・認証状態の引数・再送。mount 時 `'authenticated'` も再送） |
| `components/PushReregistration.tsx` | 新設 |
| `app/(app)/layout.tsx` | `PushReregistration` を 1 行追加 |
| `contexts/AuthContext.tsx` | `logout` に `detachFromSubject()` を追加（props は足さない） |
| `tests/lib/pushBrowserPort.real.test.ts` | 新設（実 port の `getExistingSubscription`。`navigator.serviceWorker.getRegistration` を stub し、`undefined` で即 `null`、`ready` を参照しないことを pin。完了条件 11） |
| `tests/lib/push/pushRegistration.test.ts` | 新設 |
| `tests/components/PushReregistration.test.tsx` | 新設（完了条件 2・3・6。mount 時 `'authenticated'` の再送を含む） |
| `tests/contexts/AuthContext.push.test.tsx` | 新設（SG-C6。完了条件 4・5・11 を pin。設計 §5） |

## 完了条件
1. `lib/push/pushRegistration.ts` が存在し、公開する操作が `resolve` / `subscribe` / `unsubscribe` / `reregister` / `detachFromSubject` の **5 つだけ**である。React・DOM・`navigator` を直接参照しない。
2. 認証状態が `'authenticated'` へ変わると（mount 時点で既に `'authenticated'` の場合を含む）、**ブラウザに既存購読があるときだけ** `subscribePush` が 1 回呼ばれる。既存購読が無いときは `subscribePush` も `requestPermission` も呼ばれない。`tests/components/PushReregistration.test.tsx` で「`'unknown'` → `'authenticated'`」と「mount 時 `'authenticated'`」の両方を pin する。
3. 認証状態が `'unknown'` の間は `subscribePush` が呼ばれない。
4. `logout` を呼ぶと、`client().logout()` より**先に** `unsubscribePush(endpoint)` が呼ばれる。ブラウザ側の `port.unsubscribe()` は**呼ばれない**（`tests/contexts/AuthContext.push.test.tsx` で pin）。
5. `detachFromSubject()` が reject し得る **2 経路**（`port.getExistingSubscription()` / `client.unsubscribePush()`）のどちらが reject しても、また既存購読が無くても、`logout` は完了し `status` が `'unauthenticated'` になる。logout に待ち時間上限（timeout）は**無い**（`tests/contexts/AuthContext.push.test.tsx` で pin）。
6. layout 側の再送 `reregister()` が reject し得る経路は **2 つ**（`port.getExistingSubscription()` / `client.subscribePush()`）で、どちらが reject しても例外が外へ漏れず、再試行のための状態（回数・タイマー）を持たない。`getVapidPublicKey` / `requestPermission` / `registerServiceWorker` は再送経路では**呼ばれない**（既存購読を再送するだけ）。
7. `PushSubscriptionState` の **6 値**（`unsupported` / `denied` / `unsubscribed` / `subscribing` / `subscribed` / `error`）が変わっていない。値の追加・削除・改名をしない。
8. 既存テスト **2 ファイル**（`tests/hooks/useWebPushSubscription.test.ts`・`tests/components/PushNotificationSection.test.tsx`）が **1 行も変更せずに** green である。変更が必要になった場合は設計（決定 22）の適用が誤っているので、テストではなく実装側を直す。
9. `npm run lint`・`npx tsc --noEmit`・`npm test` が green で、テスト件数が「着手前の件数＋新規追加分」である。
10. 設定画面の購読ボタンの見え方が変わっていない（ボタンが出るのは `unsubscribed` / `subscribed` / `subscribing` のときだけ、という現行の条件を変えない）。
11. `lib/pushBrowserPort.ts` の実 port `getExistingSubscription()` が `navigator.serviceWorker.ready` を参照せず、`navigator.serviceWorker.getRegistration()` が `undefined` を返すと**待たずに `null`** を返す（`tests/lib/pushBrowserPort.real.test.ts` で pin）。`grep -n "serviceWorker.ready" lib/pushBrowserPort.ts` の出現は `subscribe` / `unsubscribe` の **2 箇所だけ**（着手前は 3 箇所）。`PushBrowserPort` のメソッド集合（`isSupported` / `getPermission` / `requestPermission` / `registerServiceWorker` / `getExistingSubscription` / `subscribe` / `unsubscribe` の 7 つ）は不変。

## 禁止事項 / scope 外
- **`contexts/AuthContext.tsx` の `logout` 以外の既存経路を変えない。** `login` / `register` / `refreshMe` / `loginWithPasskey` には触らない。
- **ブラウザ側の購読オブジェクトを主体離脱で解除しない**（決定 21）。`port.unsubscribe()` を呼ぶのは設定画面のボタン経路（`unsubscribe()`）だけ。
- **再試行の状態を新たに持たない**（決定 24）。回数・間隔・「もう送ったか」のフラグを作らない。
- **通知許可を自動で要求しない。** ログイン時に `requestPermission()` を呼ばない。
- **logout に timeout / `Promise.race` を足さない**（SG-C5。待たない取得にするのであって、待ちを打ち切るのではない）。`lib/pushBrowserPort.ts` の `subscribe` / `unsubscribe` の `ready` 待ちは変えない。
- **`AuthProvider` に props を足さない**（SG-C6）。テストは module mock で port を差し替える。
- backend・ios・android のコードを変更しない。
- `pushSubscriptions` の一括削除・連鎖削除は本 slice の対象外（backend B-S5）。
- 既存テスト 2 ファイルを変更しない（完了条件 8）。`tests/lib/pushBrowserPort.test.ts`（fake port のテスト）も変更しない。

## 参照
- [ADR-104](../../../../docs/adr/104-subject-departure-and-subject-scoped-assets.md) 決定 18〜24（本 slice の根拠）・決定 13（B-S5 との順序）
- 2026-09-23 夜の user 決定 SG-C5（`getRegistration()` 系・待ち時間上限なし）・SG-C6（`tests/contexts/AuthContext.push.test.tsx`・props を足さない・mount 時も再送）。親 plan `docs/plan/2026-09-16-design-review-refactor.md` W-0 行の「blocked」は本改訂で解除
- [ADR-020](../../../../docs/adr/020-push-notification-web-push.md)（Web Push の採用）
- 投入計画: [docs/plan/2026-09-16-design-review-refactor.md](../../../../docs/plan/2026-09-16-design-review-refactor.md)
