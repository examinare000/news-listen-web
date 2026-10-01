## web リファクタ W-T7b: Preferences — 既定の再生速度をサーバーを正本にして同期する（適用 slice。決定 SG-D4）

> **決定（2026-10-01 user 採用）: SG-D4**（新 Spec §10.3 J-W1 の (a)。台帳 = 親 docs `research-reports/2026-09-23-design-docs-mino-audit.md` §5）。web の既定の再生速度はサーバーを正本にし、ログイン時にサーバーの値を端末へ写す。現行（localStorage だけに書き、主体離脱で消えて次のログインで 1.0 に戻る）は ADR-022・共有仕様 §6.6「既定速度はサーバー同期」の実装の欠落として直す。
>
> **着手前に決める項目（1 件。決まるまで投入しない）**: 新 Spec §8.2 の W-T7b 行は「J-W1 の結果による」で、保存の失敗の扱いを決めていない。
> - D-W7b-1 設定画面で既定速度を変えたとき、サーバーへの保存が失敗したらどうするか。**推奨 (a)** 難易度と同じ規則（TA-R-PF-3: 最新の要求だけ反映し、最新の要求が失敗したら変更前の値へ戻して toast「既定再生速度の保存に失敗しました」）。(b) 端末の値は残し、通知しない（次のログインでサーバーの値に戻る）。どちらも利用者に見える。決まったら本節を「確定」に書き換え、決定 ID を台帳へ登録する。

## 概要
SG-D4 を web に適用する。(1) 設定画面での既定速度の変更を、端末（registry の `defaultPlaybackSpeed`）とサーバー（`UserPreferences.default_playback_speed`）の両方へ書く。(2) 主体が `authenticated` に確定したとき（起動時の `getMe` 成功・login・register・passkey の成功）に、サーバーの値を読んで端末の registry へ写す。TA-R-PF-4（「現行の契約: 端末だけ」）を外す。正本は新 Spec §5.4（TA-R-PF-1・4・TA-C-PF-1・TA-Q-PF-2）・§8.2 W-T7b 行・§10.3 J-W1、親 docs [ADR-022](../../../../docs/adr/022-server-side-playback-position-and-preferences.md)、共有仕様 §6.5（分類表: 既定速度は主体依存 = 離脱で端末から消す。SG-A6 は変えない）・§6.6（速度 2 概念）、web-design §8。**検証モード: 再設計しない**。

応える ID: F-SET-04（PRD §5）、UC-A3、CI-T17（値域の外は既定へ正規化）、CI-T4・PS-08（開始ごとに既定速度で初期化。変えない）、SG-D4・SG-A6・ADR-022、TA-R-PF-1・4、TA-V7・TA-V9。

## 種別
適用 slice（SG-D4 で確定）。ただし上の D-W7b-1 が決まるまで投入しない。

## 規模（見込み。根拠 = 2026-10-01 実測: `settings/page.tsx:36,343-356`（既定速度の select）、`types/index.ts:211`、backend `api/schemas.py:776,786`（`default_playback_speed: float`・patch は `gt=0`））
- production ≈ 120 行: `lib/preferences/application/commands.ts` へ `setDefaultPlaybackSpeed` ≈ 30、`readModels.ts`・`preferencesGateway.ts` へ `defaultPlaybackSpeed` ≈ 15、`lib/preferences/domain/settings.ts` の保存先の宣言 ≈ 5、認証 Provider の配線（authenticated で写す）≈ 20、`settings/page.tsx` ≈ 20。
- test ≈ 200 行: `commands.test.ts` ≈ 60、`preferencesGateway.test.ts` ≈ 20、認証 Provider のテスト（4 契機で写す・`unavailable` では写さない）≈ 80、`settings/page.test.tsx` ≈ 40。
- 合計 ≈ 320 行。

## 前提・着手条件
- 依存 slice: **W-T7a**（`PreferencesGateway`・`getServerPreferences`・`setDefaultDifficulty`）の web PR が main に merge 済み、**かつ親リポの submodule ポインタが進んでいる**こと。W-S4b（registry・`PreferencesProvider`）・W-S5（`SubjectCleanup` の手順 (c) が既定速度を消す）・W-T6（`AuthProvider` が配線だけ）はその前提。
- backend の契約: `GET /settings/preferences` の応答に `default_playback_speed: float`、更新の patch が `default_playback_speed`（`gt=0`）を受ける（backend `api/schemas.py:776,786`。親 main の backend submodule で着手時に確かめる）。backend は変えない。
- D-W7b-1 が確定していること。
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build`、e2e `main-flow`。
- コマンドはすべて `web/` で実行する。`docs/trial-log/`（web・親）を最初に読む。

## 着手前の前提点検（2026-10-01 実測。W-S4b・W-T7a で形が変わる。投入の直前に数え直す）
| 項目 | 実測 | 数え直す手順 |
|---|---|---|
| 既定速度の書込 | `settings/page.tsx:36`（`useLocalStorage(KEY_DEFAULT_PLAYBACK_SPEED, 1.0)`）・`:349-352`（select の `onChange` で local と `SET_SPEED`）。W-S4b の後は registry の `set(defaultPlaybackSpeed, …)` 1 回 | `grep -rn "defaultPlaybackSpeed\|KEY_DEFAULT_PLAYBACK_SPEED" app components hooks contexts lib` |
| サーバーへ送っていない | `updatePreferences` の引数は `default_difficulty`（`:159`）と `weekly_goal_episodes`（`:181`）だけ。W-T7a の後は `lib/preferences/application/commands.ts` | `grep -rn "default_playback_speed" app components hooks contexts lib` |
| 主体の確定の契機 | W-S5 の 5 契機のうち `authenticated` になる 4 つ（`getMe` 成功・未確定後と通常の login / register / passkey 成功）。W-S5 order の表 | `grep -n "reclaimAudioCaches\|authenticated" contexts/AuthProvider.tsx` |
| 離脱時の消去 | `SubjectCleanup` の手順 (c) が `default_playback_speed` を消し、メモリ上の既定速度を 1.0 に戻す（W-S5）。本 slice は変えない | `grep -n "default_playback_speed\|subjectScoped" lib/preferences/domain/settings.ts lib/account/application/subjectCleanup.ts` |

## 対象（web サブモジュールのみ）
1. `lib/preferences/domain/settings.ts`: `defaultPlaybackSpeed` の保存先の宣言を「local（即時反映の写し）＋ server（正本）」にする（TA-R-PF-4 を外す）。値域（`PLAYBACK_SPEEDS` の 8 段）と `subjectScoped: true` は変えない。
2. `lib/preferences/application/readModels.ts`・`preferencesGateway.ts`: `ServerPreferencesView` に `defaultPlaybackSpeed: PlaybackSpeed` を足す（値域の外のサーバー値は domain の正規化で 1.0。CI-T17）。gateway の patch に `default_playback_speed` を足す。
3. `lib/preferences/application/commands.ts`: `setDefaultPlaybackSpeed(speed)` を足す。手順 = registry の `set`（端末へ即時）→ サーバーへ patch（body は `{ default_playback_speed }` の 1 field）。失敗の扱いは D-W7b-1 の確定どおり。新 Spec §5.4 の command の表に無い入口なので、新 Spec へ TA-C-PF-4 として返す（本 order は名前だけを置き、新しい契約 ID は作らない）。
4. 認証の配線（`contexts/AuthProvider.tsx`。composition root）: `AuthSession` が `authenticated` に入ったとき（上の 4 契機。`unavailable` と `anonymous` では行わない）、`getServerPreferences()` を 1 回呼び、成功したら registry へ `set(defaultPlaybackSpeed, view.defaultPlaybackSpeed)`。失敗は握る（端末の値のまま。次の契機で再び写す）。後始末（`SubjectCleanup`）と順序を競わない: 遷移④では `subjectCleanup(A)` の手順 (c) が先に走り得るので、写しは `authenticated(B)` の確立の後に始め、await しない。
5. `app/(app)/settings/page.tsx`: 既定速度の select の `onChange` を `setDefaultPlaybackSpeed` へ。表示は registry の `get(defaultPlaybackSpeed)`。
**テスト**: `tests/lib/preferences/application/commands.test.ts`（`setDefaultPlaybackSpeed`）・`preferencesGateway.test.ts`（patch の body）、`tests/contexts/AuthProvider.*.test.tsx`（4 契機で写す・`unavailable` と 401 では写さない・写す取得の失敗で端末の値が残る・遷移④で B の値が A の後始末の後に残る）、`tests/app/settings/page.test.tsx`（`fake.calls` に `default_playback_speed` の patch）。

## 変更の責務（層ごと）
| 層 | 置くもの |
|---|---|
| domain `settings.ts` | 保存先の宣言（local ＋ server） |
| application | `setDefaultPlaybackSpeed`・`ServerPreferencesView.defaultPlaybackSpeed` |
| infrastructure `preferencesGateway.ts` | DTO の `default_playback_speed` の読み書き |
| composition root `AuthProvider.tsx` | 確定の契機で query → command を呼ぶ配線だけ（判断を持たない） |
| presentation `settings/page.tsx` | select と文言 |

## 移行の中間状態
- TA-R-PF-4（現行の契約）を外す。新しい一時経路は無い。

## 変わる挙動（SG-D4。これ以外の挙動変更は禁止）
| 決定 ID | 変わる挙動 | 現行 | 判定 |
|---|---|---|---|
| SG-D4 | 設定画面で既定速度を変えると、サーバーにも保存される（`default_playback_speed` の patch） | 端末にだけ保存 | `settings/page.test.tsx` の `fake.calls` |
| SG-D4 | ログイン（起動時の認証の確定・login・register・passkey）の後、既定速度がサーバーの値になる。主体離脱で端末から消えた値が、次のログインで戻る | 次のログインでは 1.0 | `AuthProvider.*.test.tsx` |
| SG-D4・D-W7b-1 | 保存の失敗時の扱い（D-W7b-1 の確定どおり） | 失敗が起きない（送らない） | `commands.test.ts`・`settings/page.test.tsx` |

不変として固定する: PS-08（開始ごとに既定速度でセッション速度を初期化し、再生バーの変更は既定速度を書き換えない）、値域 8 段、主体離脱で端末の値を消すこと（SG-A6）、難易度・週の目標の保存。

## 契約と検査
CI-T17（値域の外のサーバー値 → 1.0）、CI-T4・PS-08（不変）、TA-V7（`setDefaultPlaybackSpeed` を command の入口の集合に足す。query の `getServerPreferences` が書き込む port を呼ばない）、TA-V9。テスト名に `SG-D4` を含める。

## 受入とテストのコマンド
`npm test`・`npm run lint`・`npm run typecheck`・`npm run typecheck:ts7`・`npm run build`・`npm run test:e2e -- main-flow`。

## 完了条件
- 上のコマンドが成功。
- **サーバーへ送る**: `grep -rn "default_playback_speed" lib/preferences` の出現が `preferencesGateway.ts` だけ。`settings/page.tsx` に `default_playback_speed`・`useLocalStorage`・`KEY_DEFAULT_PLAYBACK_SPEED` が 0 件。
- **写す契機**（集合 = `authenticated` に入る 4 契機 ＋ 入らない 3 状態 `resolving`・`anonymous`・`unavailable`）: 4 契機で `getServerPreferences` が 1 回ずつ呼ばれ、3 状態では 0 回（テストで pin）。
- `contexts/AuthProvider.tsx` に速度の値域・既定値の式が無い（`grep -n "1\.0\|PLAYBACK_SPEEDS" contexts/AuthProvider.tsx` が 0 件）。
- 「変わる挙動」の表以外の既存テストの期待値に diff が無い。

## 禁止事項 / scope 外
- backend・共有仕様の分類（SG-A6）・`SubjectCleanup` の手順を変えない。セッション速度（Playback）を変えない。
- 写しの取得を await して `authenticated` の確立を遅らせない（ADR-104 決定 1 と同じ扱い）。
- 仕様にない業務条件を足さない。

## 特性テスト（baseline）
`tests/app/settings/page.test.tsx`・`tests/contexts/AuthProvider.*.test.tsx`・`tests/contexts/PlaybackProvider.*.test.tsx`（PS-08）・`tests/lib/preferences/**`、e2e `main-flow`。

## 規模・返却事項
規模は上。返却: (1) 新 Spec §5.4 の command 表に `setDefaultPlaybackSpeed`（TA-C-PF-4 の案）を、TA-R-PF-4 を「SG-D4 で解除」に直す。(2) 新 Spec §8.1・§8.2・§9 の W-T7b を「判断待ち」から適用 slice へ（契約: CI-T17・PS-08・SG-D4）。(3) D-W7b-1 の決定を台帳へ。(4) web-design §8 の「web では未実装」を現状記述へ。

## 参照
- 新 Spec §5.4・§8.2・§10.3（J-W1 と 2026-10-01 の採用）
- 親 docs: ADR-022、共有仕様 §6.5・§6.6、web-design §8、台帳 §5 SG-D4
