# web リファクタ計画（2026-09-16 設計レビュー反映）— takt 委譲用の指示書

2026-09-16 の web 設計レビュー（`docs/research-reports/2026-09-16-code-design-review.md`）と user 承認済みの Implementation Spec（`docs/design/2026-09-16-implementation-spec-domain-model.md`）、および 2026-09-23 の主体離脱の決定（親 docs [ADR-104](../../../../docs/adr/104-subject-departure-and-subject-scoped-assets.md)）を、takt の `sdd-governed` ワークフローへ slice 単位で委譲するための指示書（order）一式。slice ID は親 docs の [実行計画](../../../../docs/plan/2026-09-16-design-review-refactor.md)（2026-09-23 再スライス版）の接頭辞付き ID `W-*` を正本とする。正本は Spec であり、本フォルダの各 order は Spec の該当 slice を takt の 1 タスクに切り出したもの。実装完了後、本フォルダは削除し、確定内容は親 docs の `design/web-design.md`（§12 target 節を現状記述へ書き換え）へ移す（`agent-rules/30` の plan ライフサイクル）。

## slice と投入順

| 順 | order | 内容 | 依存 | 検証する行 ID（web-design §12.5） | 切替方式 |
|---|---|---|---|---|---|
| 完了 | [S0-constraint.md](S0-constraint.md)（W-S0） | BFF fail-closed・失効時 cleanup・admin gate | なし | SL-03・SL-05（骨格）。SL-01 / 02 / 04 は骨格のみ | 小ステップ |
| wave 1 | [W-0-push-reregistration.md](W-0-push-reregistration.md) | Web Push の再登録と logout 時の購読解除（ADR-104 決定 18〜24）。**backend B-S5 の着手条件** | なし（他の web slice と対象ファイルが重ならない）。ただし W-S2b は W-0 の merge を待つ（同じ `AuthContext.logout` を編集） | — | 特性テスト → RED → 実装 |
| wave 1 | [W-S1-gateway.md](W-S1-gateway.md) | `ApiGateway`（`Result` / `ApiFailure`・deadline）と最小注入点（再生系 4 箇所） | S0 | CI-T12 / T13 | 旧 `ApiError` 互換 adapter（TP1）を暫定保持（削除は W-S4d） |
| 2 | [W-S1b-api-split.md](W-S1b-api-split.md) | `lib/api.ts` を backend リソース単位の 10 ファイルへ分割（横断関数 0 件・呼出側不変） | W-S1 | —（特性テストのみ） | 挙動不変（型・関数名不変） |
| 2' | [W-S2a-playback-domain.md](W-S2a-playback-domain.md) | `lib/playback/*` ドメイン層の新設（Session・Queue gate・ResumeRule・OfflineLibrary・Coordinator・PositionReporter）。既存コードから呼ばない | W-S1（W-S1b とは対象ファイルが重ならず並行可） | RS-01〜RS-07（純関数・表駆動）。Q-01〜Q-32 を新モジュールでも。CI-T1〜T11 | ① 新規コードのみ |
| 3 | [W-S2b-playback-entry.md](W-S2b-playback-entry.md) | `PlaybackProvider` へ入口を差し替え。§2・Q-* は挙動不変。変わるのは列挙した行のみ | W-S2a ＋ W-S1b ＋ W-0 | PS-01〜PS-06・PS-08（port double で全行）。§6.4 送信条件（PS-05 / 05b）。SG-X1 / X2 / X4。T-T18（TP2） | ② 特性テスト 13＋e2e 3（不変）＋準拠テスト（変更行） |
| 4 | [W-S2c-playback-cleanup.md](W-S2c-playback-cleanup.md) | 旧再生実装 7 ファイル・`AppContext.currentPodcast`・`reorderUpNext` の削除、依存方向 eslint | W-S2b | CI-T7b（ルール本体） | ③ 削除のみ（参照 0 件を grep で判定） |
| 5 | [W-S3-gates.md](W-S3-gates.md) | CI に `typecheck:ts7`・独立 build・依存方向 eslint の実行 | W-S2c | CI-T7b（CI 実行） | — |
| 5（学習サイクル） | [W-S4a-catalog.md](W-S4a-catalog.md) | Catalog: `Episode` の UI 展開・`error_message` 4 値の文言写像・`rate_limited.scope` の集約 | W-S2c ＋ **backend B-S0b の契約が main にあること**（`error_message` 4 値） | PS-07（`PlayableEpisode` の fail-closed）。CI-T11（UI 側） | 特性テスト → RED → 実装 |
| 5（学習サイクル） | [W-S4b-prefs.md](W-S4b-prefs.md) | Preferences: `PreferencesRegistry`（主体依存の宣言 SG-A6）・`AppContext` 解体の完了・TP3 | W-S2c | CI-T17 | inline theme script の key 複製を pin テストで暫定保持（TP3） |
| 5（学習サイクル） | [W-S4c-account.md](W-S4c-account.md) | Account: `PasswordPolicy` 12〜20 の単一化・`AuthSession` 判別共用体・`AuthProvider.tsx` | W-S2c ＋ backend S0c（完了）の契約 | CI-T15（全体）・CI-T16。SL-03 | 特性テスト → RED → 実装 |
| 6（学習サイクル） | [W-S4d-api-injection.md](W-S4d-api-injection.md) | `lib/api` の context 別取り込み・page 側 15 ファイルの注入点移行・失効検知の一般化・TP1 削除 | W-S1b ＋ W-S4a ＋ W-S4b ＋ W-S4c | CI-T12（呼出側）・CI-T15（検知点）。SL-05 | 機械的移行（context ごとにコミット分割） |
| B-S5 後 | [W-S5-subject-cache.md](W-S5-subject-cache.md) | 主体別音声キャッシュ `audio-v1-{user_id}`・起動時の回収・旧 `audio-v1` の初回全削除・主体依存 3 key の削除・主体離脱時の再生停止 `stopForSubjectLeave`（ADR-104 決定 27・SG-A1 / A2 / A6・SG-B3 / B6） | **backend B-S5 の契約が main にあること**（5 経路の応答に `user_id`）＋ **W-S2c**。W-S4b / c / d とは順序不定（order 内に両方の状態を記載）。**着手前に決める項目 U-W5-1 が 1 件**（下記 unresolved） | SL-01・SL-02・SL-04・SL-06・SL-07（再生停止・音声キャッシュ・端末設定の全事後条件） | 不可逆点（Cache 名前空間の変更） |
| 保留 | （learning） | `lib/learning/` の 3 ルール・StreakContext の副作用移動 | 学習機能サイクル | — | order 未作成 |

依存の直列: **W-S1 → {W-S1b ∥ W-S2a} → W-S2b → W-S2c → {W-S3 ∥ W-S4a ∥ W-S4b ∥ W-S4c ∥ W-S5} → W-S4d**。W-0 は独立（W-S2b の前に merge）。W-S5 はさらに B-S5 の後（B-S5 は W-0 の後）。
- 2026-09-23 の受入検査で返した未決 6 件は同日 user 判断で確定し各 order に反映済み（resume の入力合成 Q12=A（SG-B5）、`user_id` 欠落時は android 同型 Q13=A（SG-B6）、回収は主体確定時に 1 回 Q10=A（SG-B3）、TP1 本体削除は W-S4d、SL-01 / SL-07 の再生停止は W-S5、W-S1b の 10 ファイル束ね方を採用）。親 plan・web-design §12.3 の W-S2c 行（「暫定互換 adapter」）と W-S1b 注記は router が修正する。
- **2026-09-23 夜の点検（wave 2 投入前）**: 旧 W-S4 を context 境界で W-S4a〜d に分割（1 PR で読める規模を超えるため。分割の理由は各 order 冒頭）。W-S4 order が落としていた `AuthSession` 判別共用体（web-design §12.1・§12.2・§12.4 が W-S4 と定める）を W-S4c に入れた。W-S5 の「停止前に位置同期 1 回」は共有仕様 §6.5 web 列に無い（Android 列の写し）ため削除し、遷移④で B の cookie が A の位置を書く交差を pin する条件に替えた。W-S2b の特性テストは 13 ファイル（Spec §6 S2 行の「7 + 5」は数え違い）。各 order の着手条件に「submodule PR の merge ＋ 親ポインタ」を明記した。親 plan・web-design §12.3 / §12.5 の W-S4 行の分割は router が反映する。
- 共有仕様 §6.7 の Selection Gate SG-X1〜X5 は 2026-09-16 に全て確定済み（SG-X3 は 2026-09-23 に ADR-104 で「待たない＋主体識別」へ改訂）。web に効くのは SG-X1（完聴時に `duration`）・SG-X2（末尾 2 秒窓）・SG-X4（一時停止中は送らない。web は現行どおり）で、いずれも W-S2a / W-S2b の準拠テスト行に対応する。
- 2026-09-23 の ADR-104 補足（SG-A1 旧 `audio-v1` の初回全削除・SG-A2 web の logout は cookie 提示・SG-A6 主体依存 key の分類表）は W-S5 が適用する。
- 他モジュールとの契約: backend の新規パスワード規則（12〜20、ADR-101）は W-S4c、`error_message` 識別子 4 値（ADR-102）は backend B-S0b の merge 後に W-S4a で写像する。`user_id` の公開（ADR-104 決定 15）は B-S5 の後に W-S5 が使う。他 module への依存は PR 番号ではなく「契約が main にあること」で判定する（各 order の着手条件）。
- 共有仕様 1.1（§2.11・§4.3〜§4.4・§6.4〜§6.6）は news-listen-docs #133 で main 済み。準拠テストは行 ID（`PS-*` / `SL-*` / `RS-*` / `Q-*`）をテスト名に含める。
- 一括切替（旧 S2・SG8）は 2026-09-23 に ①②③ の 3 段へ分割した（親 plan「一括切替を 3 段に割る」）。旧 `S2-playback.md`・`W-S4-catalog-prefs.md` は削除済み。

## 投入順と release トリガ（wave 2 以降）

release の単位は「依存先の submodule PR ＋ 親リポのポインタ PR が両方 main に入った slice」（親 plan「wave の進め方」）。親で `git submodule status` を実行し `web` / `backend` 行に `+` が無いことを確認してから release する。

| 投入 | slice | release トリガ（この PR が main に入り親ポインタが進んだら） | 並行できる相手 |
|---|---|---|---|
| 1 | W-S1b | W-S1（wave 1）の web PR ＋ 親ポインタ | W-S2a、backend B-S4、iOS / android の各 slice |
| 1 | W-S2a | 同上（W-S1b を待たない） | W-S1b |
| 2 | W-S2b | W-S1b と W-S2a の両 PR ＋ 親ポインタ、かつ W-0（wave 1）の PR ＋ 親ポインタ | backend B-S4 / B-S5（対象 module が違う） |
| 3 | W-S2c | W-S2b の PR ＋ 親ポインタ | 同上 |
| 4 | W-S3 | W-S2c の PR ＋ 親ポインタ | W-S4a / W-S4b / W-S4c / W-S5（対象ファイルが重ならない） |
| 4（学習サイクル） | W-S4a | W-S2c の PR ＋ 親ポインタ、かつ backend B-S0b の PR ＋ 親ポインタ | W-S3 / W-S4b / W-S4c / W-S5 |
| 4（学習サイクル） | W-S4b | W-S2c の PR ＋ 親ポインタ | W-S3 / W-S4a / W-S4c / W-S5 |
| 4（学習サイクル） | W-S4c | W-S2c の PR ＋ 親ポインタ | W-S3 / W-S4a / W-S4b / W-S5 |
| 4 | W-S5 | W-S2c の PR ＋ 親ポインタ、かつ backend B-S5 の PR ＋ 親ポインタ、かつ U-W5-1 の決定 | W-S3 / W-S4a〜c |
| 5（学習サイクル） | W-S4d | W-S1b・W-S4a・W-S4b・W-S4c の全 PR ＋ 親ポインタ（W-S5 は順序不定） | W-S5 |

同じ web module 内で並行投入した slice は、後から merge する側が rebase する（並行を許した組は対象ファイルが重ならないことを order で確認済み）。

## unresolved（投入前に user が決める）

| # | order | 内容 |
|---|---|---|
| U-W5-1 | W-S5 | 起動時の認証解決が未確定に終わった後の login / register / passkey 成功を「主体の確定」に含めて回収を 1 回走らせるか（推奨 (A) 含める。詳細は W-S5 冒頭の表） |

W-S1b / W-S2a / W-S2b / W-S2c / W-S3 / W-S4a〜d には未決の選択は無い（2026-09-23 夜の受入検査）。

## takt への投入手順（親リポ `news-listen` の作業ツリーで）

order はサブモジュール内の docs にあるが、takt のタスク単位は親リポ（`.takt/config.yaml` の `submodules: all`）。order 本文をタスク内容として渡す（親 plan「投入の型」の `.takt/enqueue-orders.mjs` を使う。`takt add` は対話式で `-b` / `-t` を受け付けない）。

- ブランチ名は `takt/refactor/web-<slice>`。1 slice = 1 タスク = 1 PR（サブモジュール PR → 親 PR。draft は作らない。`.takt/facets/knowledge/project-context.md`）。
- 前 slice の submodule PR が main に merge され、**親リポのポインタ PR も merge されてから**依存する次 slice を release する（takt の worktree は親 main から clone し submodule が親の記録と一致することを検査するため）。指示書本文は投入時にコピーされるので、order を直したら再投入する。
- **投入前に、指示書を `analyze_order` の受入検査（全称命題の対象集合の数え上げ／条項どうしの矛盾／未決の選択）へ自分で通す。** 未決が 1 件でも残っていれば投入しない（親 `docs/trial-log/order-acceptance-inspection-finds-design-defects.md`）。
- analyze_order は order を「承認済み指示書」として**検証モード**で受ける。generate_spec の `spec.md` / `plan.md` は Spec の該当 slice の契約（CI-T*）と特性テストの抜粋で足り、新しい契約 ID を作らない。
- 各 order の「特性テスト（baseline）」が green でなければ着手しない（bootstrap_worktree のベースライン verify とは別に、slice 固有の baseline）。

## 完了後
- 各 slice の merge 後、`docs/trial-log/` に棄却・方針転換があれば追記（takt の record_trial_log が行う）。各 order の「記録」節にある親 docs への返却（共有仕様 §4.3 / §4.4 の保留解除・web-design §12 の書き換え）を router が行う。
- 全 slice 完了で本フォルダを削除し、親 docs `design/web-design.md` §3〜§9 を target の内容へ書き換え、§12 を削除する。
