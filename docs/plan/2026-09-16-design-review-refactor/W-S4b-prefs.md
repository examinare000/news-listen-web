## web リファクタ W-S4b: Preferences — `PreferencesRegistry` と `AppContext` の解体（学習機能サイクルで着手）

> **2026-10-01 目標アーキテクチャ（ADR-110・Spec §8.3）による補正**（新 Spec = `docs/design/2026-09-30-implementation-spec-target-architecture.md`。§8.3 W-S4b の 7 項目を本文へ反映した）
> - (1) 値域・既定値・主体依存の宣言は `lib/preferences/domain/settings.ts`、key と codec は `lib/preferences/infrastructure/localSettingsStore.ts`。registry は 2 つを合成した公開物（W-32。旧 `lib/preferences/registry.ts` 1 ファイルを分けた）。
> - (2) `KeyValueStore` の型は `lib/platform/keyValueStore.ts` から import する（W-T1 が移した）。
> - (3) `defaultPlaybackSpeed` の保存先は local だけ（現行の契約 = TA-R-PF-4。表の「local ＋ server」を直した）。サーバーとの同期は SG-D4 で確定し、W-T7b が行う（本 slice は現行の契約のまま）。
> - (4) `WEEKLY_GOALS` と難易度の一覧を domain に置く（値域だけ。use case は W-T7a）。
> - (5) `podcastPosition` は分類だけを宣言する（codec は `LocalPositionStore`。W-S2a2）。
> - (6) 音量を registry の設定にし、`PlaybackProvider` の音量の codec（**TP-A5**）を外す。
> - (7) `lib/sfx.ts` は、有効かどうかを関数で受ける（registry を import しない。`lib/platform/sfx.ts` への移動は W-T13）。
> - あわせて、完了条件の `localStorage` の grep を TA-V3 (c) と許可リストの `removeBy: W-S4b` の行が 0 件に替えた。

## 概要
旧 W-S4 を context 境界で分けた 2 つ目。設定レジストリ `PreferencesRegistry`（CP8）を新設し、`AppContext` に残る 3 state（`isRestoring` / `playbackSpeed` / `timeFormat`）の行き先を確定させて `AppProvider` / `useApp` を削除する。正本は Implementation Spec §3.4（Preferences）・§4 CI-T17・§5 CP8・§6 S4 行（TP3）、親 docs web-design §12.1 Preferences 行・§12.2「`AppContext` の解体」「主体依存の端末設定」、共有仕様 §6.5 分類表（SG-A6）。**検証モード: 再設計しない**。新しい契約 ID は作らない。

## 規模（見込み。根拠 = 2026-09-24 実測: `contexts/AppContext.tsx` 143 行、`hooks/useLocalStorage.ts` 38 行、`useApp()` の production 呼出 8 箇所、`app/(app)/settings/page.tsx` 511 行、`app/(app)/dashboard/page.tsx` 387 行、`lib/sfx.ts` 131 行、`components/ui/ThemeToggle.tsx` 59 行）
- production ≈ 470 行: `lib/preferences/registry.ts` ≈ 120、`contexts/PreferencesProvider.tsx` ≈ 80、`AppContext.tsx` 削除 143、`useLocalStorage.ts` 削除 38、`useApp()` 8 箇所の置換 ≈ 16、`settings/page.tsx` ≈ 30、`dashboard/page.tsx` ≈ 10、`sfx.ts` ≈ 10、`ThemeToggle.tsx` ≈ 5、`PlaybackProvider.tsx` ≈ 5、認証 Provider 1、`app/layout.tsx` ≈ 5。
- test ≈ 500 行: `registry.test.ts` ≈ 120、`PreferencesProvider.test.tsx` ≈ 60、`AppContext.test.tsx` 削除 238、`layout.test.tsx` の TP3 pin ≈ 20、settings / dashboard / sfx / AudioPlayerBar テストの `useApp` mock 置換 ≈ 60。
- 合計 ≈ 970 行（うち削除 ≈ 380）。

## 前提・着手条件
- 依存 slice: **W-S2c** の web PR が main に merge 済み（`AppContext.currentPodcast` / `SET_PODCAST` が削除済みで、`AppContext` に残るのが `isRestoring` / `playbackSpeed` / `timeFormat` / `SET_SPEED` / `SET_TIME_FORMAT` / `AppProvider` / `useApp` だけであること）、**かつ親リポ `news-listen` の submodule ポインタが進んでいる**（親で `git submodule status` の `web` 行に `+` が無い）こと。
- **W-S4c・W-S5 とは並行投入しない**（順序は不定。後から merge する側が rebase）。理由（2026-09-24 実測）: W-S4c とは認証 Provider のファイル（`useApp()` → `usePreferences()` の 1 行を本 slice が替える。W-S4c 前なら `contexts/AuthContext.tsx`、後なら `contexts/AuthProvider.tsx`）、W-S5 とは `app/(app)/settings/page.tsx`・`contexts/PlaybackProvider.tsx`・主体依存 key の宣言元が重なる。W-S3・W-S4a・W-S4d2a とは重ならず並行可。W-S5 が先に merge 済みなら `lib/account/application/subjectCleanup.ts` の主体依存 3 key 定数を registry の宣言（下の対象 1）へ置き換え、定数を削除する。W-S5 が後なら registry が宣言だけ持ち、W-S5 がそれを読む（W-S5 order の表）。
- Selection Gate 依存なし（SG-A6 は確定済み）。
- 棄却済み案（再提案しない。Spec §5）: 汎用 Storage port（RO3。registry で代替）、`CP8.subscribe`、raw `dispatch` の公開。
- `docs/trial-log/` を最初に読む。

## 対象（web サブモジュールのみ）
1. **registry（新規・CP8。W-32 で 2 層に分ける）**: `lib/preferences/domain/settings.ts` が各設定の `{ id, scope: 'local' | 'server', 値域の検査, default, subjectScoped: boolean }` を宣言し（TA-R-PF-1・2。`WEEKLY_GOALS = [3, 5, 7, 10]` と難易度の一覧（`lib/shared/difficulty.ts` の `DIFFICULTY_LEVELS`）と既定難易度 `DEFAULT_DIFFICULTY` もここ。`settings/page.tsx:21-29` の 2 つの配列を消す）、`lib/preferences/infrastructure/localSettingsStore.ts` が local の設定の `key` と codec（encode / decode）を持つ（`KeyValueStore` は `lib/platform/keyValueStore.ts` から import）。`lib/preferences/application/registry.ts`（または `index.ts`）が 2 つを合成した公開物を export する。`lib/preferences/domain/` は `localStorage`・`JSON.*`・`@/lib/platform` を使わない。宣言する設定と分類（共有仕様 §6.5 の web 列。表に無い key を増やすときは共有仕様を先に更新する）:
   | 設定 | key | scope | 値域 | subjectScoped |
   |---|---|---|---|---|
   | defaultPlaybackSpeed | `default_playback_speed`（`KEY_DEFAULT_PLAYBACK_SPEED`） | **local だけ**（現行の契約 = TA-R-PF-4。サーバーへ送らず読まない。SG-D4 による同期は W-T7b） | `PLAYBACK_SPEEDS`（`lib/playback/domain/session.ts`） | true |
   | seenAchievementIds | `seen_achievement_ids` | local | `string[]` | true |
   | podcastPosition（prefix） | `podcast_position:{id}`（`KEY_PODCAST_POSITION_PREFIX`） | local | 秒（非負） | true（**分類だけ**を宣言する。key と codec は `lib/playback/infrastructure/localPositionStore.ts`（W-S2a2）が持ち、registry は codec を持たない） |
   | timeFormat | `time_format`（`KEY_TIME_FORMAT`） | local | `'absolute' \| 'relative'` | false |
   | theme | `theme`（`KEY_THEME`） | local | `'dark' \| 'light'` | false |
   | sfxEnabled | `sfx_enabled`（`KEY_SFX_ENABLED`） | local | boolean | false |
   | volume | `player_volume`（`KEY_PLAYER_VOLUME`） | local | `[0, 1]` | false（`PlaybackProvider` の音量の codec（TP-A5）をこの設定の `get` / `set` に替えて外す。初期値の規則（不正なら 1.0）は値域の正規化と同じ） |
   | default_difficulty / digest_* / weekly_goal_episodes | server（`UserPreferences`） | server | 型どおり | true（server 正本。local コピー無し） |
2. **`contexts/PreferencesProvider.tsx`（新規）**: registry から `get(setting)` / `set(setting, value)`（validate 済みのみ受理。列挙外は既定へ正規化）と `ready`（旧 `isRestoring` の否定。localStorage 復元完了）だけを公開する。raw dispatch を公開しない（CI-T17）。`KeyValueStore` adapter（`lib/platform/keyValueStore.ts`）経由で読み書きし、`lib/preferences/` は `localStorage` を直接使わない（TA-D11）。
3. **`AppContext` の解体の完了**（web-design §12.2）: `isRestoring` → `PreferencesProvider.ready`、`timeFormat` → registry（local）、`playbackSpeed`（既定速度）→ registry。`app/(app)/settings/page.tsx` の既定速度の二重書込（`useLocalStorage(KEY_DEFAULT_PLAYBACK_SPEED)` ＋ `SET_SPEED` dispatch。Spec §3.4）を registry の `set` 1 回へ。`app/(app)/dashboard/page.tsx:48,65` の生 key `seen_achievement_ids` を registry 経由へ。`lib/sfx.ts` は `sfx_enabled` を自分で読み書きせず、有効かどうかを関数（`() => boolean`）で受ける（registry を import しない。§8.3 W-S4b (7)。呼ぶ側 = settings の切替・効果音を鳴らす箇所は registry の `get(sfxEnabled)` を渡す）。`components/ui/ThemeToggle.tsx:32` の `localStorage.setItem(KEY_THEME, next)` を registry の `set` へ（2026-09-24 実測で起票時の列挙から漏れていた 1 箇所）。`contexts/PlaybackProvider.tsx` が既定速度を `useApp().state.playbackSpeed` から読んでいる箇所（W-S2b）を registry の `get(defaultPlaybackSpeed)` へ、音量の codec（`JSON.parse` / `JSON.stringify`。TP-A5）を registry の `get(volume)` / `set(volume, v)` へ替える（TP-A5 の削除）。認証 Provider の `state.isRestoring`（起動時 `getMe` の待ち条件）を `usePreferences().ready` へ。残る責務が無くなるため `AppProvider` / `useApp` と `contexts/AppContext.tsx`・`tests/contexts/AppContext.test.tsx` を削除する（`app/layout.tsx` の Provider 配線を `PreferencesProvider` に替える）。`useApp()` を使う production の箇所を着手時に `grep -rn "useApp()" app components hooks contexts` で数え上げ、全てを `usePreferences()` へ替える。
4. **TP3（temporary path）**: `app/layout.tsx:44-49` の inline theme script は import 不可のため key 文字列 `'theme'` と列挙 `'dark' | 'light'` を複製したまま残し、`tests/app/layout.test.tsx`（既存）に registry の `theme` 宣言との一致を pin するテストを加える。owner: user。導入: W-S4b。削除条件: `beforeInteractive` script を module から生成できた時（web-design §12.3: registry が theme key の唯一の定義元になった時）。

## 契約（RED テストの対応）
| CI | 内容 | RED テスト |
|---|---|---|
| CI-T17 | registry 外の key・列挙外の値は拒否／既定へ正規化。raw dispatch なし | T-T17: `tests/lib/preferences/domain/settings.test.ts`（値域と既定値。I/O なし = TA-V8）＋ `tests/lib/preferences/infrastructure/localSettingsStore.test.ts`（key と codec・private browsing の read 失敗 → 既定）＋ `tests/lib/preferences/registry.test.ts`（各設定の validate: 列挙外・型不正・private browsing の read 失敗 → 既定）＋ `tests/contexts/PreferencesProvider.test.tsx`（`get` / `set` / `ready` 以外を公開しない） |
| — | TP3 の pin | `tests/app/layout.test.tsx` に inline script と registry の一致 1 件 |

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` 成功。e2e 3 本 green（変更なし）。
- T-T17 が `verifies: CI-T17` をテスト名またはコメントに持つ。
- `contexts/AppContext.tsx`・`tests/contexts/AppContext.test.tsx` が存在せず、`grep -rn "useApp\b\|AppProvider\|SET_SPEED\|SET_TIME_FORMAT\|isRestoring" app components hooks contexts lib tests e2e` が 0 件。
- **TA-V3 (c)・許可リスト**: 許可リストの `removeBy: "W-S4b"` の行（TA-D11: `dashboard/page.tsx`・`ThemeToggle.tsx`・`hooks/useLocalStorage.ts`・`contexts/AppContext.tsx`・`lib/sfx.ts`、TA-D5: `@/lib/config`（`settings`・`ThemeToggle`）、TA-D4 (a): `contexts/AppContext.tsx`、TA-V4 の TA-R-PF-1）が 0 件。`tests/architecture/{boundaries,dataModels,rules}.test.ts` が green。ほかの行は増えない。
- `contexts/PlaybackProvider.tsx` に `JSON.` が 0 件（TP-A5 の削除）。
- **`localStorage` の直接参照 0 件**（量化する集合 = `app/` `components/` `hooks/` `contexts/` `lib/` の `.ts` / `.tsx`。除外は次の 3 種だけ: `lib/platform/keyValueStore.ts`（adapter）、`app/layout.tsx:46` の inline theme script（TP3）、コメント行（行頭が `//` または `*`。2026-09-24 実測: `app/(app)/settings/page.tsx:38`・`lib/config.ts:1`・`components/ui/ThemeToggle.tsx:31`）。判定 grep: `grep -rn "localStorage" app components hooks contexts lib | grep -v '^lib/platform/keyValueStore\.ts:\|^app/layout\.tsx:46:' | grep -v ':[0-9]*: *\(//\|\*\)'` が 0 件。`hooks/useLocalStorage.ts` は registry へ吸収する（削除。利用箇所は `usePreferences()` へ）。残る出現を PR 説明に列挙）。
- registry の `subjectScoped: true` の集合が共有仕様 §6.5 web 列の「主体依存」（`default_playback_speed`・`seen_achievement_ids`・`podcast_position:*`）と一致し、`false` の集合が `theme` / `time_format` / `sfx_enabled` / `player_volume` と一致する（テストで pin）。
- 設定画面の見え方・保存先（localStorage key 名・server の `PATCH /users/me/preferences`）が変わっていない（既存 `tests/app/settings/page.test.tsx` が key 名の assertion を変えずに green）。
- **公開面**（NFR-10・AQ-6。2026-10-01 追加: 新しい domain の型を作る slice は、公開面の検査の対象にその型を足す。Spec §7 TA-V5・TA-V6）: `lib/preferences/domain/settings.ts` の設定の宣言（registry の各項目と値域の一覧。`WEEKLY_GOALS` など）を、TA-V5（静的。`tests/architecture/publicTypes.test.ts` の対象で、export する型の property と配列が `readonly`。違反は 0）と TA-V6（実行時。`tests/architecture/immutability.<context>.test.ts` に「渡した入力・返した値（入れ子を含む）を後から書き換えても、次の読みと不変条件が変わらない」の場合を 1 つ以上）に足す。

## 禁止事項 / scope 外
- localStorage key 名・server 設定のフィールド名を変えない。key を増やさない。
- `Episode` の UI 展開・`error_message` 写像（W-S4a）、`PasswordPolicy`・`AuthSession`（W-S4c）、`lib/api` の context 別取り込み・page 側注入点の移行（W-S4d1）・TP1 削除（W-S4d3）は行わない。`createApiClient()` の呼出箇所を変えない（`app/(app)/settings/page.tsx` の `getPreferences` / `updatePreferences` 呼出は本 slice でも `createApiClient()` のまま。`lib/preferences/api.ts` への置換は W-S4d1）。
- 主体離脱時の key 削除の**発火**（W-S5 の `subjectCleanup`）を本 slice で変えない。registry は分類を宣言するだけ。
- `Clock` port・汎用 Storage port を作らない。既定速度をサーバーへ送らない・読まない（W-T7b。SG-D4）。サーバー設定の command と query（`setDefaultDifficulty` ほか）を作らない（W-T7a）。`lib/sfx.ts` を `lib/platform/` へ移さない（W-T13）。仕様にない業務条件を足さない。

## 特性テスト（baseline）
`tests/contexts/AppContext.test.tsx`（削除前の pin）、`tests/app/settings/page.test.tsx`、`tests/app/dashboard/`、`tests/app/layout.test.tsx`、`tests/lib/sfx.test.ts`、`tests/components/AudioPlayerBar.test.tsx`（既定速度の初期化 PS-08）、`tests/hooks/`（`useLocalStorage` を使うもの）、e2e 3 本。

## 検証
`npm test`、上記 grep 2 種、`npm run build`、`npm run test:e2e`。

## 記録
- 完了後、親 docs web-design §6（AppContext）・§7（設定）を現状記述へ書き換える対象として README に印を付ける。共有仕様 §6.5 末尾「各 platform の設定レジストリはこの表の分類を宣言」の web 行を実装済みへ。
- 棄却・方針転換は `docs/trial-log/` へ。

## 参照
- Spec: `docs/design/2026-09-16-implementation-spec-domain-model.md` §3.4・§4（CI-T17）・§5（CP8・rejected_overdesign）・§6（S4 行・TP3）
- 親 docs: web-design §12.1（Preferences）・§12.2（`AppContext` の解体・主体依存の端末設定）・§12.3（W-S4 行の TP3）、共有仕様 §6.5 分類表（SG-A6）
