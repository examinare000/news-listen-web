## web リファクタ W-T7b: Preferences — 既定の再生速度をサーバーを正本にして同期する（適用 slice。決定 SG-D4）

> **決定（2026-10-01 user 採用）: SG-D4**（新 Spec §10.3 J-W1 の (a)。台帳 = 親 docs `research-reports/2026-09-23-design-docs-mino-audit.md` §5）。web の既定の再生速度はサーバーを正本にし、ログイン時にサーバーの値を端末へ写す。現行（localStorage だけに書き、主体離脱で消えて次のログインで 1.0 に戻る）は ADR-022・共有仕様 §6.6「既定速度はサーバー同期」の実装の欠落として直す。
>
> **決定（2026-10-01 user 判断）: SG-D9**（新 Spec §10.3 の D-W7b-1。台帳 §5）。order の起票で出た未決（保存の失敗の扱い）を、次の 3 点で決めた。
> 1. 設定画面でサーバーへの保存に失敗したら、元の値に戻して toast「再生速度の保存に失敗しました」（error）を出す。連続で変えたときは、最後の要求の結果だけを反映する（難易度の `handleDifficultyChange`・TA-R-PF-3 と同じ規則。先に画面の値を変え、失敗したら戻す）。
> 2. 本 slice を入れた直後は、サーバーの値を正とし、端末（localStorage）に残っている値は捨てる。web だけで速度を選んでいた人が 1.0 に戻り得ることは受け入れる（移行の処理を足さない）。
> 3. サーバーから設定を読めなかったときは、端末に残っている最後の値を使う（無ければ 1.0）。読めなかったことを設定画面に出し、再試行できるようにする（iOS の `AppState.preferencesSyncFailed` と同じ）。難易度の取得の失敗に同じ表示を付けることは含めない。
>
> **補正（2026-10-01）**: SG-D9 の確定に合わせ、「着手前に決める項目」を消し、種別・前提・対象・責務・変わる挙動・契約・完了条件を SG-D9 で書き直した。表示の文言は、web の既存の文言（`settings/page.tsx` の「設定の読み込みに失敗しました。」と「再試行」）を使う（新しい文言を作らない）。

## 概要
SG-D4 を web に適用する。(1) 設定画面での既定速度の変更を、端末（registry の `defaultPlaybackSpeed`）とサーバー（`UserPreferences.default_playback_speed`）の両方へ書く。(2) 主体が `authenticated` に確定したとき（起動時の `getMe` 成功・login・register・passkey の成功）に、サーバーの値を読んで端末の registry へ写す。TA-R-PF-4（「現行の契約: 端末だけ」）を外す。正本は新 Spec §5.4（TA-R-PF-1・4・TA-C-PF-1・TA-Q-PF-2）・§8.2 W-T7b 行・§10.3 J-W1、親 docs [ADR-022](../../../../docs/adr/022-server-side-playback-position-and-preferences.md)、共有仕様 §6.5（分類表: 既定速度は主体依存 = 離脱で端末から消す。SG-A6 は変えない）・§6.6（速度 2 概念）、web-design §8。**検証モード: 再設計しない**。

応える ID: F-SET-04（PRD §5）、UC-A3、CI-T17（値域の外は既定へ正規化）、CI-T4・PS-08（開始ごとに既定速度で初期化。変えない）、SG-D4・SG-D9・SG-A6・ADR-022、TA-C-PF-4、TA-R-PF-1・3・4、TA-V7・TA-V9。

## 種別
適用 slice（SG-D4・SG-D9 で確定。判断待ちは無い）。

## 規模（見込み。根拠 = 2026-10-01 実測: `settings/page.tsx:36,343-356`（既定速度の select）、`types/index.ts:211`、backend `api/schemas.py:776,786`（`default_playback_speed: float`・patch は `gt=0`））
- production ≈ 140 行: `lib/preferences/application/commands.ts` へ `setDefaultPlaybackSpeed` ≈ 30、`readModels.ts`・`preferencesGateway.ts` へ `defaultPlaybackSpeed` ≈ 15、`lib/preferences/domain/settings.ts` の保存先の宣言 ≈ 5、認証 Provider の配線（authenticated で写す）≈ 20、`settings/page.tsx` ≈ 40（SG-D9 の toast・読めなかったときの表示と再試行を含む）。
- test ≈ 260 行: `commands.test.ts` ≈ 70、`preferencesGateway.test.ts` ≈ 20、認証 Provider のテスト（4 契機で写す・`unavailable` では写さない・端末の値を捨てる）≈ 90、`settings/page.test.tsx` ≈ 80。
- 合計 ≈ 400 行。

## 前提・着手条件
- 依存 slice: **W-T7a**（`PreferencesGateway`・`getServerPreferences`・`setDefaultDifficulty`）の web PR が main に merge 済み、**かつ親リポの submodule ポインタが進んでいる**こと。W-S4b（registry・`PreferencesProvider`）・W-S5（`SubjectCleanup` の手順 (c) が既定速度を消す）・W-T6（`AuthProvider` が配線だけ）はその前提。
- backend の契約: `GET /settings/preferences` の応答に `default_playback_speed: float`、更新の patch が `default_playback_speed`（`gt=0`）を受ける（backend `api/schemas.py:776,786`。親 main の backend submodule で着手時に確かめる）。backend は変えない。
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
3. `lib/preferences/application/commands.ts`: `setDefaultPlaybackSpeed(speed)` を足す。手順 = registry の `set`（端末へ即時）→ サーバーへ patch（body は `{ default_playback_speed }` の 1 field）。失敗の扱いは SG-D9 の 1: 要求に連番を付け、最新の要求の結果だけを反映する。最新の要求が失敗したら、registry を変更前の値へ戻し、`Result` の失敗を返す（stale な成功・失敗は無視）。返り値は `Result<void, ApiFailure>`（新 Spec §5.4 の TA-C-PF-4）。
4. 認証の配線（`contexts/AuthProvider.tsx`。composition root）: `AuthSession` が `authenticated` に入ったとき（上の 4 契機。`unavailable` と `anonymous` では行わない）、`getServerPreferences()` を 1 回呼び、成功したら registry へ `set(defaultPlaybackSpeed, view.defaultPlaybackSpeed)`。成功したら、端末に残っている値は確かめずに上書きする（SG-D9 の 2。端末の値をサーバーへ上げる移行の処理は足さない）。失敗は握る（端末に残っている最後の値のまま。無ければ registry の既定 1.0。SG-D9 の 3。次の契機で再び写す）。後始末（`SubjectCleanup`）と順序を競わない: 遷移④では `subjectCleanup(A)` の手順 (c) が先に走り得るので、写しは `authenticated(B)` の確立の後に始め、await しない。
5. `app/(app)/settings/page.tsx`: 既定速度の select の `onChange` を `setDefaultPlaybackSpeed` へ。表示は registry の `get(defaultPlaybackSpeed)`。結果が失敗なら toast「再生速度の保存に失敗しました」（`showToast(…, 'error')`。SG-D9 の 1。表示は command が戻した registry の値）。画面を開いたときの設定の取得（W-T7a の `getServerPreferences`）が成功したら、`view.defaultPlaybackSpeed` を registry へ写す（SG-D9 の 2）。失敗したら registry の値（端末に残る最後の値。無ければ 1.0）のまま表示し、既定速度の行に「設定の読み込みに失敗しました。」と「再試行」のボタンを出す（SG-D9 の 3。再試行は同じ取得をもう一度呼び、成功したら表示を消して写す）。難易度の行の既存の表示（`preferencesLoadError`）は変えない。
**テスト**: `tests/lib/preferences/application/commands.test.ts`（`setDefaultPlaybackSpeed`）・`preferencesGateway.test.ts`（patch の body）、`tests/contexts/AuthProvider.*.test.tsx`（4 契機で写す・`unavailable` と 401 では写さない・写す取得の失敗で端末の値が残る・遷移④で B の値が A の後始末の後に残る）、`tests/app/settings/page.test.tsx`（`fake.calls` に `default_playback_speed` の patch・保存の失敗で元の値と toast・連続の変更で最後の要求だけ・取得の失敗で端末の値と再試行の表示・再試行の成功で表示が消える）。

## 変更の責務（層ごと）
| 層 | 置くもの |
|---|---|
| domain `settings.ts` | 保存先の宣言（local ＋ server） |
| application | `setDefaultPlaybackSpeed`（最新の要求だけを反映し、失敗したら registry を戻す。SG-D9 の 1）・`ServerPreferencesView.defaultPlaybackSpeed` |
| infrastructure `preferencesGateway.ts` | DTO の `default_playback_speed` の読み書き |
| composition root `AuthProvider.tsx` | 確定の契機で query → registry の `set` を呼ぶ配線だけ（判断を持たない。失敗は握る） |
| presentation `settings/page.tsx` | select・保存の失敗の toast・読めなかったときの表示と再試行（SG-D9 の 1・3） |

## 移行の中間状態
- TA-R-PF-4（現行の契約）を外す。新しい一時経路は無い。

## 変わる挙動（SG-D4・SG-D9。これ以外の挙動変更は禁止）
| 決定 ID | 変わる挙動 | 現行 | 判定 |
|---|---|---|---|
| SG-D4 | 設定画面で既定速度を変えると、サーバーにも保存される（`default_playback_speed` の patch） | 端末にだけ保存 | `settings/page.test.tsx` の `fake.calls` |
| SG-D4 | ログイン（起動時の認証の確定・login・register・passkey）の後、既定速度がサーバーの値になる。主体離脱で端末から消えた値が、次のログインで戻る | 次のログインでは 1.0 | `AuthProvider.*.test.tsx` |
| SG-D9 の 1 | サーバーへの保存が失敗したら、選択が元の値に戻り、toast「再生速度の保存に失敗しました」（error）が出る。連続で変えたときは最後の要求の結果だけが反映される | 失敗が起きない（送らない） | `commands.test.ts`・`settings/page.test.tsx` |
| SG-D9 の 2 | 本 slice を入れた後の最初のログイン（認証の確定）で、端末に残っていた既定速度は捨てられ、サーバーの値になる（web だけで選んだ値は 1.0 に戻り得る） | 端末の値を使い続ける | `AuthProvider.*.test.tsx`（端末 1.5・サーバー 1.0 → 1.0） |
| SG-D9 の 3 | 設定画面でサーバーの設定を読めなかったら、既定速度は端末に残る最後の値（無ければ 1.0）で表示され、その行に「設定の読み込みに失敗しました。」と「再試行」が出る | 既定速度はサーバーを読まない（表示は端末の値だけ） | `settings/page.test.tsx` |

不変として固定する: PS-08（開始ごとに既定速度でセッション速度を初期化し、再生バーの変更は既定速度を書き換えない）、値域 8 段、主体離脱で端末の値を消すこと（SG-A6）、難易度・週の目標の保存。

## 契約と検査
CI-T17（値域の外のサーバー値 → 1.0）、CI-T4・PS-08（不変）、TA-C-PF-4（`Result<void, ApiFailure>`。最新の要求だけを反映し、失敗したら元の値に戻す。SG-D9 の 1）、TA-R-PF-3 と同じ規則（連番）、TA-V7（`setDefaultPlaybackSpeed` を command の入口の集合に足す。query の `getServerPreferences` が書き込む port を呼ばない）、TA-V9。テスト名に `SG-D4` か `SG-D9` を含める。

## 受入とテストのコマンド
`npm test`・`npm run lint`・`npm run typecheck`・`npm run typecheck:ts7`・`npm run build`・`npm run test:e2e -- main-flow`。

## 完了条件
- 上のコマンドが成功。
- **サーバーへ送る**: `grep -rn "default_playback_speed" lib/preferences` の出現が `preferencesGateway.ts` だけ。`settings/page.tsx` に `default_playback_speed`・`useLocalStorage`・`KEY_DEFAULT_PLAYBACK_SPEED` が 0 件。
- **写す契機**（集合 = `authenticated` に入る 4 契機 ＋ 入らない 3 状態 `resolving`・`anonymous`・`unavailable`）: 4 契機で `getServerPreferences` が 1 回ずつ呼ばれ、3 状態では 0 回（テストで pin）。
- `contexts/AuthProvider.tsx` に速度の値域・既定値の式が無い（`grep -n "1\.0\|PLAYBACK_SPEEDS" contexts/AuthProvider.tsx` が 0 件）。
- **保存の失敗**（SG-D9 の 1）: 最新の要求の失敗で registry と画面が変更前の値に戻り、toast「再生速度の保存に失敗しました」が `error` で 1 回出る。先の要求の失敗が後の要求の成功の後に届いても、値は戻らず toast も出ない（テストで pin）。
- **切り替え直後**（SG-D9 の 2）: 端末の値をサーバーへ送る処理が無い（`default_playback_speed` の patch は `setDefaultPlaybackSpeed` の 1 経路だけ。`grep -n "default_playback_speed\|setDefaultPlaybackSpeed\|updatePreferences" contexts/AuthProvider.tsx` が 0 件）。
- **読めなかったとき**（SG-D9 の 3）: 取得の失敗で既定速度が端末の値のまま（1.0 に書き換えない）。既定速度の行に「設定の読み込みに失敗しました。」と「再試行」が出て、再試行の成功で消える。難易度の行の表示の期待値は変わらない。
- 「変わる挙動」の表以外の既存テストの期待値に diff が無い。

## 禁止事項 / scope 外
- backend・共有仕様の分類（SG-A6）・`SubjectCleanup` の手順を変えない。セッション速度（Playback）を変えない。
- 写しの取得を await して `authenticated` の確立を遅らせない（ADR-104 決定 1 と同じ扱い）。
- 仕様にない業務条件を足さない。

## 特性テスト（baseline）
`tests/app/settings/page.test.tsx`・`tests/contexts/AuthProvider.*.test.tsx`・`tests/contexts/PlaybackProvider.*.test.tsx`（PS-08）・`tests/lib/preferences/**`、e2e `main-flow`。

## 規模・返却事項
規模は上。返却: (1) 新 Spec §5.4 の command 表に `setDefaultPlaybackSpeed`（TA-C-PF-4 の案）を、TA-R-PF-4 を「SG-D4 で解除」に直す。(2) 新 Spec §8.2・§9 の W-T7b の契約に SG-D9 を足す（§8.1 の状態は 2026-10-01 に ready 済み）。(3) D-W7b-1 は台帳 SG-D9 に登録済み（返却は無い）。(4) web-design §8 の「web では未実装」を現状記述へ。

## 参照
- 新 Spec §5.4・§8.2・§10.3（J-W1 と 2026-10-01 の採用・D-W7b-1 = SG-D9）
- 親 docs: ADR-022、共有仕様 §6.5・§6.6、web-design §8、台帳 §5 SG-D4・SG-D9
