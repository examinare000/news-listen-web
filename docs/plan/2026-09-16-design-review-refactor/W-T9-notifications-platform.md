## web リファクタ W-T9: Notifications と、ブラウザの adapter の置き場を揃える（適用 slice。置き場だけ）

## 概要
Notifications の application（`lib/push/pushRegistration.ts`）を `lib/notifications/application/` へ、port の型と実装が同じファイルにある `lib/pushBrowserPort.ts`・`lib/webauthnBrowserPort.ts` を「型 = application の `ports.ts`」「実装 = `lib/platform/`」に分け、adapter の小道具（`lib/swCacheCleanup.ts`・`lib/cookie.ts`・`lib/webpush.ts`）を `lib/platform/` へ移す。`PushSubscriptionState` を DTO のファイルから `lib/notifications/domain/` へ移す。`NotificationsGateway`（`Result` を返す）を `lib/notifications/infrastructure/notificationsGateway.ts` に置く。**置き場だけで、挙動・request は変えない**。正本は新 Spec §3.2（該当 5 行）・§5.5（TA-C-NT-1〜4・TA-Q-NT-1・TA-R-NT-1）・§8.2 W-T9 行。**検証モード: 再設計しない**。新しい契約 ID は作らない。

応える ID: NFR-09 (4)、AQ-5、ADR-104 決定 18〜24（挙動は不変）、TA-R-NT-1、TA-D2・TA-D4・TA-D5、TA-V1〜V3。

## 種別
適用 slice。判断待ちに依存しない。W-T6 と `lib/webauthnBrowserPort.ts` の移動が重なる（先に main に入った側が移し、後の側は path を合わせる。両方の order に同じ行がある）。

## 規模（見込み。根拠 = 2026-10-01 実測: `lib/push/pushRegistration.ts` 105 行超、`lib/pushBrowserPort.ts` 130 行超、`lib/webauthnBrowserPort.ts` 100 行超）
- production ≈ 120 行（移動を除く）: port の型の分離 ≈ 40、`notificationsGateway.ts` ≈ 40、import の付け替え ≈ 40。
- test: 既存テストの import の付け替え（`tests/lib/push/pushRegistration.test.ts` 40 件・`tests/lib/{cookie,webpush,swCacheCleanup}.test.ts`・`tests/hooks/useWebPushSubscription.test.ts`・`tests/components/PushNotificationSection.test.tsx` ほか）≈ 60、`notificationsGateway.test.ts` ≈ 40。
- 合計 ≈ 220 行（10¹〜10² 行）。

## 前提・着手条件
- 依存 slice: **W-S4d3** の web PR が main に merge 済み（W-S4d1 で `pushRegistration` の client の port が `Result` を返す形になっている = W-25）、**かつ親リポの submodule ポインタが進んでいる**こと。
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build`。
- コマンドはすべて `web/` で実行する。`docs/trial-log/`（web・親）を最初に読む。

## 着手前の前提点検（2026-10-01 実測。投入の直前に数え直す）
| 項目 | 実測 | 数え直す手順 |
|---|---|---|
| 移すファイル | `lib/push/pushRegistration.ts`・`lib/pushBrowserPort.ts`（`:11` 型・`:39` 実装・`:119` fake）・`lib/webauthnBrowserPort.ts`（`:18` 型・`:29` 実装・`:84` fake。W-T6 が先なら移動済み）・`lib/swCacheCleanup.ts`・`lib/cookie.ts`・`lib/webpush.ts` | `ls lib/push lib/*.ts` |
| 各ファイルの import 元 | `grep -rln "@/lib/push/pushRegistration\|@/lib/pushBrowserPort\|@/lib/webauthnBrowserPort\|@/lib/swCacheCleanup\|@/lib/cookie\|@/lib/webpush" app components hooks contexts lib tests` の全行（2026-10-01: production 10 行前後・tests 10 本前後。着手時の値を PR 説明に貼る） | 左の grep |
| `PushSubscriptionState` | `types/index.ts:413` | `grep -rn "PushSubscriptionState" app components hooks contexts lib types` |
| 許可リストの `removeBy: W-T9` | TA-D2 3 行（`pushRegistration.ts`）・TA-D4 (a)（`hooks/useWebPushSubscription.ts`）・TA-D5（`@/lib/pushBrowserPort` 2 行・TP-A6 の `useWebPushSubscription.ts`） | `grep -B4 '"removeBy": "W-T9"' architecture/boundaries.allowlist.json` |

## 対象（web サブモジュールのみ）
1. `lib/push/pushRegistration.ts` → `lib/notifications/application/pushRegistration.ts`（`git mv`）。中身は import の付け替えだけ（TA-R-NT-1 は既に application の位置にある）。
2. `lib/notifications/application/ports.ts`: `PushBrowserPort`（`lib/pushBrowserPort.ts:11` から）と `NotificationsGateway`（`getVapidPublicKey`・`subscribePush`・`unsubscribePush` が `Result` を返す。引数と戻り値は application の型）。`lib/account/application/ports.ts`: `WebAuthnPort`（`lib/webauthnBrowserPort.ts:18` から。W-T6 が先なら済み）。
3. `lib/platform/pushBrowser.ts`・`lib/platform/webauthn.ts`: 実装と fake（`createReal*`・`createFake*`）。`lib/platform/{swCacheCleanup,cookie,webpush}.ts`: `git mv`。`lib/api/gateway.ts` の `@/lib/cookie` は `@/lib/platform/cookie`（TA-D7 の許可）。`urlBase64ToUint8Array` を application が使うなら、application は `lib/platform` を import できないので、変換は `pushBrowser.ts` の中で行い port の引数を文字列にする（挙動は不変）。
4. `lib/notifications/domain/pushSubscriptionState.ts`: `PushSubscriptionState` を移し、`types/index.ts` は再 export する（TP-A2 と同じ扱い。W-T15 で外す）。
5. `lib/notifications/infrastructure/notificationsGateway.ts`: `lib/api/notifications.ts` の 3 関数を呼び、DTO（`PushSubscriptionJSON`・`VapidPublicKeyResponse`）を application の型へ。`hooks/useWebPushSubscription.ts`・`contexts/AuthProvider.tsx`（`detachFromSubject` の組立て）・`components/PushReregistration.tsx` はこれを使う。
6. 呼出側の import の付け替え（量化する集合 = 上の点検の grep の全行）。`architecture/boundaries.allowlist.json` の `removeBy: "W-T9"` の行を消す。
**削除**: `lib/push/`・`lib/pushBrowserPort.ts`・`lib/webauthnBrowserPort.ts`・`lib/{swCacheCleanup,cookie,webpush}.ts`（移動元）。

## 変更の責務（層ごと）
domain = `PushSubscriptionState`。application = `pushRegistration`・2 つの port。infrastructure = `notificationsGateway`。adapter `lib/platform/` = ブラウザの実装と小道具。

## 移行の中間状態
`types/index.ts` の `PushSubscriptionState` の再 export を足す（TP-A2 に含めて W-T15 で外す）。

## 変わる挙動
無い。

## 契約と検査
既存の push・passkey のテスト（期待値は不変。新 Spec §8.2）。TA-V1〜V3（`lib/notifications/application/**` に `@/types`・`@/lib/platform`・`@/lib/api` が 0 件）。`notificationsGateway.test.ts`（path と method が `lib/api/notifications.ts` と同じ）。

## 受入とテストのコマンド
`npm test`・`npm run lint`・`npm run typecheck`・`npm run typecheck:ts7`・`npm run build`。

## 完了条件
- 上のコマンドが成功。既存テストの件数とテスト名・期待値が不変（変えたのは import path だけ。PR 説明に列挙）。
- 移動元 6 ファイル（`lib/push/pushRegistration.ts`・`lib/pushBrowserPort.ts`・`lib/webauthnBrowserPort.ts`・`lib/swCacheCleanup.ts`・`lib/cookie.ts`・`lib/webpush.ts`）が存在しない。`grep -rn "@/lib/push/\|@/lib/pushBrowserPort\|@/lib/webauthnBrowserPort\|@/lib/swCacheCleanup\|@/lib/cookie'\|@/lib/webpush" app components hooks contexts lib tests` が 0 件。
- `grep -rn "from '@/types\|from '@/lib/platform\|from '@/lib/api" lib/notifications/application lib/notifications/domain` が 0 件。
- **許可リスト**: `grep -c '"removeBy": "W-T9"' architecture/boundaries.allowlist.json` が 0。TA-V2・V3 が green。
- **公開面**（NFR-10・AQ-6。2026-10-01 追加: 新しい domain の型を作る slice は、公開面の検査の対象にその型を足す。Spec §7 TA-V5・TA-V6）: `lib/notifications/domain/pushSubscriptionState.ts` の `PushSubscriptionState`（置き場を移した型）を、TA-V5（静的。`tests/architecture/publicTypes.test.ts` の対象で、export する型の property と配列が `readonly`。違反は 0）と TA-V6（実行時。`tests/architecture/immutability.<context>.test.ts` に「渡した入力・返した値（入れ子を含む）を後から書き換えても、次の読みと不変条件が変わらない」の場合を 1 つ以上）に足す。

## 禁止事項 / scope 外
- 再送・解除の条件（ADR-104 決定 18〜24）・戻り値の種類を変えない。SW（`public/sw.js`）と TP2 を変えない。
- `lib/sfx.ts`（W-T13）・`lib/reportClientError.ts`（W-T10a）を動かさない。仕様にない業務条件を足さない。

## 特性テスト（baseline）
`tests/lib/push/pushRegistration.test.ts`・`tests/lib/{cookie,webpush,swCacheCleanup}.test.ts`・`tests/hooks/useWebPushSubscription.test.ts`・`tests/components/{PushNotificationSection,PushReregistration}.test.tsx`・`tests/contexts/AuthProvider.push.test.tsx`・`tests/public/sw.prefix.test.ts`。

## 規模・返却事項
規模は上。返却: 既存 Spec §2 の Notifications の置き場の行を `lib/notifications/` に直す依頼を親 docs へ。棄却・方針転換は `docs/trial-log/` へ。

## 参照
新 Spec §3.2・§5.5・§8.2（W-T9 行）、既存 Spec §2（Notifications）、ADR-104 決定 18〜24、導出 W-25。
