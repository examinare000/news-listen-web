# web リファクタ計画（2026-09-16 設計レビュー反映）— takt 委譲用の指示書

2026-09-16 の web 設計レビュー（`docs/research-reports/2026-09-16-code-design-review.md`）と user 承認済みの Implementation Spec（`docs/design/2026-09-16-implementation-spec-domain-model.md`）、および 2026-09-23 の主体離脱の決定（親 docs [ADR-104](../../../../docs/adr/104-subject-departure-and-subject-scoped-assets.md)）と、2026-09-30 の目標アーキテクチャ（親 docs [ADR-110](../../../../docs/adr/110-refactor-target-domain-centered-onion-cqrs.md)・新 Spec [`2026-09-30-implementation-spec-target-architecture.md`](../../design/2026-09-30-implementation-spec-target-architecture.md)。以下「新 Spec」）を、takt の `sdd-governed` ワークフローへ slice 単位で委譲するための指示書（order）一式。slice ID は親 docs の [実行計画](../../../../docs/plan/2026-09-16-design-review-refactor.md)（2026-09-23 再スライス版）の接頭辞付き ID `W-*` を正本とする。正本は Spec であり（構造・層・slice の全体は新 Spec §8、状態遷移と契約の詳細は 2026-09-16 の Spec）、本フォルダの各 order は Spec の該当 slice を takt の 1 タスクに切り出したもの。実装完了後、本フォルダは削除し、確定内容は親 docs の `design/web-design.md`（§12 target 節を現状記述へ書き換え）へ移す（`agent-rules/30` の plan ライフサイクル）。


> **投入前の前提点検が必須（2026-10-01）。** どの order も、投入の直前に「着手前の前提点検」（order の中の表。無い order は「対象」「完了条件」が引用する実測値・行番号・件数・型名）を実コードで数え直し、値が違えば order を直してから投入する。order は書いた時点の実コードを引用しており、前の slice が入るたびに値が動く。点検をせずに投入しない。あわせて、親 docs [refactor plan](../../../../docs/plan/2026-09-16-design-review-refactor.md)「実装の停止と再開ゲート」が満たされるまで、どの slice も投入しない。
>
> **2026-10-01 の更新**: 新 Spec §8.2 の補完 slice W-T1〜W-T15 の order を作り、§8.3 の補正を未着手の order（W-S2a1・W-S2a2・W-S2b・W-S2c・W-S3・W-S4a・W-S4b・W-S4c・W-S4d1・W-S4d2a・W-S4d3・W-S5）へ反映した（各 order 冒頭の「2026-10-01 目標アーキテクチャ（ADR-110・Spec §8.3）による補正」節）。W-S4d2b は §8.3 で補正なし。user が 2026-10-01 に採用した決定: SG-D3（「習得」の語。J-W2 の (a)）・SG-D4（既定速度はサーバーを正本。J-W1 の (a)）・SG-D5（BFF が `Retry-After` を中継。J-W3 の (a)）・SG-D9（W-T7b の保存の失敗・切り替え直後・読めなかったときの扱い。D-W7b-1）。

## slice と実行する順（新 Spec §8.1 の順。同じ submodule では 1 本ずつ投入する）

| 順 | order | 内容 | 依存 | 状態 |
|---|---|---|---|---|
| — | [S0-constraint.md](S0-constraint.md)（W-S0） | BFF fail-closed・失効時 cleanup・admin gate | なし | 完了（PR #124） |
| — | [W-0-push-reregistration.md](W-0-push-reregistration.md) | Web Push の再登録と logout 時の購読解除（ADR-104 決定 18〜24） | なし | 完了（PR #136） |
| — | [W-S1-gateway.md](W-S1-gateway.md) | `ApiGateway`（`Result` / `ApiFailure`・deadline）と最小注入点 | W-S0 | 完了（PR #137・#138） |
| — | [W-S1b-api-split.md](W-S1b-api-split.md) | `lib/api.ts` を資源別の 10 ファイルへ | W-S1 | 完了（PR #149） |
| — | [W-S2a-playback-domain.md](W-S2a-playback-domain.md) | 再生の domain（port・Session・Queue・source・resume） | W-S1 | 完了（PR #146） |
| 1 | [W-T1-layer-skeleton.md](W-T1-layer-skeleton.md) | 層の骨格・依存の向きの検査（許可リスト TP-A1）・Queue と Session の不変性 | W-S2a | 未着手（ready） |
| 2 | [W-S2a1-session-fail-entry.md](W-S2a1-session-fail-entry.md) | Session に `fail` を足す・Q-33・PS-09・PS-10 | W-T1 | 未着手（ready。2026-10-01 補正） |
| 3 | [W-T2-catalog-episode.md](W-T2-catalog-episode.md) | Catalog の `Episode`・`QueuedEpisode`・`displayTitle`・DTO からの変換（CI-T11・PS-07・PS-07b） | W-S2a1 | 未着手（ready） |
| 4 | [W-S2a2-playback-coordination.md](W-S2a2-playback-coordination.md) | 再生の use case と adapter・リードモデル 6・command と query の分離（≈ 1,550 行。1 本のまま） | W-T2 | 未着手（ready。2026-10-01 補正） |
| 5 | [W-S2b-playback-entry.md](W-S2b-playback-entry.md) | 入口を `PlaybackProvider` へ差し替え（変わる挙動は表の行だけ） | W-S2a2・W-S1b・W-0 | 未着手（ready。2026-10-01 補正） |
| 6 | [W-S2c-playback-cleanup.md](W-S2c-playback-cleanup.md) | 旧再生実装の削除 | W-S2b | 未着手（ready。2026-10-01 補正） |
| 7 | [W-S3-gates.md](W-S3-gates.md) | CI に `typecheck:ts7`・独立 build・境界の検査の実行確認 | W-S2c | 未着手（ready。2026-10-01 補正） |
| 8 | [W-S4a-catalog.md](W-S4a-catalog.md) | `Episode` を画面へ・失敗の文言（3 値）・上限の種別・「一部失敗」を消す | W-S2c・W-T2・**B-S0b**（完了） | 未着手（ready。2026-10-01 補正） |
| 9 | [W-S4b-prefs.md](W-S4b-prefs.md) | 設定の registry（domain ＋ infrastructure）と `AppContext` の解体・TP-A5 の削除 | W-S2c | 未着手（ready。2026-10-01 補正） |
| 10 | [W-S4c-account.md](W-S4c-account.md) | パスワードの規則の一本化と `AuthSession` の 4 状態（純関数） | W-S2c | 未着手（ready。2026-10-01 補正） |
| 11 | [W-S5-subject-cache.md](W-S5-subject-cache.md) | 主体別の音声キャッシュ・起動時の回収・離脱時の再生停止（SL-01・02・04・06〜10） | W-S2c・**B-S5a**（完了） | 未着手（ready。2026-10-01 補正） |
| 12 | [W-S4d2a-tests-catalog.md](W-S4d2a-tests-catalog.md) | Catalog 系 page テストを gateway の double（`tests/helpers/gatewayDouble.ts`）へ | W-S4a | 未着手（ready。2026-10-01 補正） |
| 13 | [W-S4d2b-tests-others.md](W-S4d2b-tests-others.md) | 残りの page テストを移す | W-S4d2a・W-S4b・W-S4c | 未着手（ready。補正なし。`fakeGateway` の名前は W-S4d2a の読み替えに従う） |
| 14 | [W-S4d1-context-gateway.md](W-S4d1-context-gateway.md) | `lib/api/<resource>` の `Result` 化・`lib/<context>/infrastructure/api.ts`・page の gateway 化（TP-A6） | W-S4d2b | 未着手（ready。2026-10-01 補正） |
| 15 | [W-S4d3-tp1-removal.md](W-S4d3-tp1-removal.md) | TP1 の削除・TA-D8 の eslint・失効の検知（事象 `expired`） | W-S4d1 | 未着手（ready。2026-10-01 補正） |
| 16 | [W-T3-catalog-episodes-readmodels.md](W-T3-catalog-episodes-readmodels.md) | 一覧・詳細をリードモデルに・生成の完了の検知とポーリングの停止を 1 箇所に（UC-S1） | W-S4d3 | 未着手（ready） |
| 17 | [W-T4-catalog-feed.md](W-T4-catalog-feed.md) | Feed の command と `FeedView` | W-S4d3 | 未着手（ready） |
| 18 | [W-T5-catalog-sources-entry-gate.md](W-T5-catalog-sources-entry-gate.md) | 購読・onboarding・入口の判定 | W-S4d3 | 未着手（ready） |
| 19 | [W-T6-account-management.md](W-T6-account-management.md) | account 管理の use case・`Subject`・`AuthView`（TP-A8 の削除） | W-S4d3・W-S5 | 未着手（ready） |
| 20 | [W-T7a-preferences-server.md](W-T7a-preferences-server.md) | サーバー設定（難易度・週の目標）の command と query | W-S4d3・W-S4b | 未着手（ready） |
| 21 | [W-T7b-default-speed-server.md](W-T7b-default-speed-server.md) | 既定の再生速度をサーバーを正本にして同期する（SG-D4） | W-T7a | 未着手（ready。保存の失敗・切り替え直後・読めなかったときの扱いは SG-D9） |
| 22 | [W-T8-admin.md](W-T8-admin.md) | admin の 4 画面を command・query・リードモデルに | W-S4d3 | 未着手（ready） |
| 23 | [W-T9-notifications-platform.md](W-T9-notifications-platform.md) | Notifications と、ブラウザの adapter の置き場 | W-S4d3 | 未着手（ready） |
| 24 | [W-T10a-error-reporter.md](W-T10a-error-reporter.md) | エラー通報を gateway 経由に（UC-S3） | W-S4d3 | 未着手（ready） |
| 25 | [W-T10b-bff-retry-after.md](W-T10b-bff-retry-after.md) | BFF が `Retry-After` を中継する（SG-D5。上限到達の文言に目安が付く） | — | 未着手（ready） |
| 26 | [W-T11-learning-quiz-vocabulary.md](W-T11-learning-quiz-vocabulary.md) | クイズと語彙の登録を Learning へ | W-T3 | 未着手（ready） |
| 27 | [W-T12-learning-vocabulary-test.md](W-T12-learning-vocabulary-test.md) | 単語テストの状態機械を domain へ | W-S4d3 | 未着手（ready） |
| 28 | [W-T13-learning-dashboard-streak-sfx.md](W-T13-learning-dashboard-streak-sfx.md) | ダッシュボード・ストリーク・実績・効果音を Learning へ | W-S4d3・W-S4b | 未着手（ready） |
| 29 | [W-T14-position-sync.md](W-T14-position-sync.md) | 位置同期のクライアント側（ADR-109 決定 7〜14） | W-S2c・**B-S7** | **B-S7 待ち（枠だけ。B-S7 の契約が main に入ってから本文を確定して投入）** |
| 30 | [W-T15-allowlist-zero.md](W-T15-allowlist-zero.md) | 許可リストを 0 件に・一時経路（TP-A1・A2・A7）を外す | 全部 | 未着手（ready。最後。全部に依存する） |

順序を問わない組（新 Spec §8.1）: W-T3〜W-T10a（page が重ならない。`settings/page.tsx` を触る W-T6・W-T7a・W-T7b・W-T13 は続けて置き、後から入る側が rebase）。W-T11〜W-T13。W-T10b は依存が無く、どこにでも置ける。W-T14 は依存が揃えば W-S2c の後のどこにでも置ける。W-S4b・W-S4c・W-S5 は認証 Provider・`settings/page.tsx`・`PlaybackProvider.tsx` が重なるので直列（順序不定）。

**許可リスト（TP-A1）の持ち主**: 行ごとの `removeBy`（消す slice）は W-T1 の order の表が割り当てる。各 slice は自分の `removeBy` の行を 0 件にし、ほかの行を増やさない。例外として行を足す（または specifier を書き替える）のは、新 Spec §8.4 が一時経路として登録した W-S4a（TP-A4 の 2 行）と W-S4d1（TP-A6: `@/lib/api` の行を `@/lib/<context>/infrastructure/api` に書き替える）だけ。

## 経緯（2026-09-23〜2026-09-30 の記録。現在の状態は上の表）

依存の直列: **W-S1 → {W-S1b ∥ (W-S2a → W-S2a1 → W-S2a2)} → W-S2b → W-S2c → {W-S3 ∥ W-S4a ∥ (W-S4b・W-S4c・W-S5 は順序不定の直列)} → W-S4d2a → W-S4d2b → W-S4d1 → W-S4d3**。W-0 は独立（W-S2b の前に merge）。W-S5 はさらに backend B-S5a の後（B-S5a は依存なし。W-0 を待つのは B-S5b）。W-S4d2a は W-S4a の後なら W-S4b / W-S4c / W-S5 を待たずに投入できる。
- 2026-09-23 の受入検査で返した未決 6 件は同日 user 判断で確定し各 order に反映済み（resume の入力合成 Q12=A（SG-B5）、`user_id` 欠落時は android 同型 Q13=A（SG-B6）、回収は主体確定時に 1 回 Q10=A（SG-B3）、TP1 本体削除は W-S4d3、SL-01 / SL-07 の再生停止は W-S5、W-S1b の 10 ファイル束ね方を採用）。親 plan・web-design §12.3 の W-S2c 行（「暫定互換 adapter」）と W-S1b 注記は router が修正する。
- **2026-09-23 夜の点検（wave 2 投入前）**: 旧 W-S4 を context 境界で W-S4a〜d に分割（1 PR で読める規模を超えるため。分割の理由は各 order 冒頭）。W-S4 order が落としていた `AuthSession` 判別共用体（web-design §12.1・§12.2・§12.4 が W-S4 と定める）を W-S4c に入れた。W-S5 の「停止前に位置同期 1 回」は共有仕様 §6.5 web 列に無い（Android 列の写し）ため削除し、遷移④で B の cookie が A の位置を書く交差を pin する条件に替えた。W-S2b の特性テストは 13 ファイル（Spec §6 S2 行の「7 + 5」は数え違い）。各 order の着手条件に「submodule PR の merge ＋ 親ポインタ」を明記した。親 plan・web-design §12.3 / §12.5 の W-S4 行の分割は router が反映する。
- **2026-09-30 の前提点検（wave 1 完了後）**: W-0・W-S1 は完了（web PR #136〜#138）。W-S1b の実測値（特性テスト 8 ファイル・mock 23 ファイル・import 19 ファイル）を直し、`ApiError` を `legacyRequest.ts` へ移して再 export する手順を明記した。W-S2a は `PlaybackSession` に `stop`（13 遷移の外のリセット。契約 CI-T1b）を足した（親 docs 監査レポート §5 の SG-C24・SG-C25）。W-S1 が作った gateway の test double は `tests/helpers/gatewayDouble.ts`。W-S4d2a / W-S4d2b の order が書く `tests/helpers/fakeGateway.ts` と mock 25 ファイルの列挙は、各 slice の投入前に同じ点検で直す。
- **2026-09-30 の前提点検（wave 3。W-S2a 完了後）**: W-S2a2 と W-S2b を W-S2a の実装済みの公開面と照合した。どちらも Blocker があり、user が決定を確定した（親 docs 監査レポート §5 の SG-C50・C52〜C57・C61〜C63。設計の正本は親 docs `adr/105-…` と `design/web-design.md` §12.6）。反映の状況: **W-S2a1**（新規。Session に「失敗にする」入口 `fail` を足し、準拠テストに Q-33 を足す。W-S2a2 の前に入れる）を起票、**W-S2a2** を書き直した（依存の形・戻り値・位置同期の規則は監査レポート §5 の導出 W-1〜W-8）。**W-S2b** も同日に書き直した（B1〜B15 を反映: 特性テストの集合 13 → 19、`usePlayback()` の公開面 5 群、toast を出す部品 `components/PlaybackToasts.tsx`、音量、再生ボタンの状態ごとの動作、`save(id)`。導出 W-10〜W-14）。W-S2a2 には W-10〜W-12（`clearOfflineAudio`・`addToQueue` / `playNext` の戻り値・`title` の作り方）を足した。W-S2c の削除表に `AudioPlayerContext.gateway.test.tsx` を足した。**2026-09-30 夜の一問一答**（親 docs 監査レポート §5 の SG-C64〜C79）: 巻き戻した位置も保存する（SG-C67。W-S2a2・W-S2b）、オフラインで未保存のときの toast を足す（SG-C69。W-S2b）、利用者の開始を自動より優先する（SG-C73・導出 W-15。W-S2a2）。`partial_failed` は再生不可で、backend も生成側で失敗にする（SG-C64。W-S4a の PS-07 は定義どおり。「一部失敗」バッジは backend の B-S6 の後は出なくなる）。位置同期の新しい規則（記録時刻の比較・オフライン分の同期・再開時の確認。SG-C74〜C79・親 docs ADR-109）は、backend の B-S7 を先に入れ、web は W-S2c の後に別の slice を起こす。依存の直列は **W-S1 → W-S1b ∥ (W-S2a → W-S2a1 → W-S2a2) → W-S2b → …**。W-S1 が作った gateway の test double は `tests/helpers/gatewayDouble.ts`。点検の記録は親 docs `research-reports/2026-09-30-wave3-order-premise-check.md`。
- 共有仕様 §6.7 の Selection Gate SG-X1〜X5 は 2026-09-16 に全て確定済み（SG-X3 は 2026-09-23 に ADR-104 で「待たない＋主体識別」へ改訂）。web に効くのは SG-X1（完聴時に `duration`）・SG-X2（末尾 2 秒窓）・SG-X4（一時停止中は送らない。web は現行どおり）で、いずれも W-S2a / W-S2b の準拠テスト行に対応する。
- 2026-09-23 の ADR-104 補足（SG-A1 旧 `audio-v1` の初回全削除・SG-A2 web の logout は cookie 提示・SG-A6 主体依存 key の分類表）は W-S5 が適用する。
- 他モジュールとの契約: backend の新規パスワード規則（12〜20、ADR-101）は W-S4c、`error_message` 識別子 4 値（ADR-102）は backend B-S0b の merge 後に W-S4a で写像する（値域は ADR-108 / SG-C64 で 3 値になる。backend の B-S6 までは 4 値。W-S4a の order は投入前に 3 値へ直すかを決める = 親 docs 還流監査 2026-09-30 の §6）。`user_id` の公開（ADR-104 決定 15）は B-S5a の後に W-S5 が使う。他 module への依存は PR 番号ではなく「契約が main にあること」で判定する（各 order の着手条件）。
- 共有仕様 1.1（§2.11・§4.3〜§4.4・§6.4〜§6.6）は news-listen-docs #133 で main 済み。準拠テストは行 ID（`PS-*` / `SL-*` / `RS-*` / `Q-*`）をテスト名に含める。
- 一括切替（旧 S2・SG8）は 2026-09-23 に ①②③ の 3 段へ分割した（親 plan「一括切替を 3 段に割る」）。旧 `S2-playback.md`・`W-S4-catalog-prefs.md` は削除済み。

## release トリガ（2026-09-24 版。W-S 系の組合せの記録。補完 slice を含む順と依存は上の表が正本）

release の単位は「依存先の submodule PR ＋ 親リポのポインタ PR が両方 main に入った slice」（親 plan「wave の進め方」）。親で `git submodule status` を実行し `web` / `backend` 行に `+` が無いことを確認してから release する。

| 投入 | slice | release トリガ（この PR が main に入り親ポインタが進んだら） | 並行できる相手 |
|---|---|---|---|
| 1 | W-S1b | W-S1（wave 1）の web PR ＋ 親ポインタ | W-S2a、backend B-S4a、iOS / android の各 slice |
| 1 | W-S2a | 同上（W-S1b を待たない） | W-S1b |
| 1' | W-S2a1 | W-S2a の PR ＋ 親ポインタ | W-S1b |
| 1'' | W-S2a2 | W-S2a・W-S2a1 の PR ＋ 親ポインタ | W-S1b |
| 2 | W-S2b | W-S1b・W-S2a・W-S2a1・W-S2a2 の PR ＋ 親ポインタ、かつ W-0（wave 1）の PR ＋ 親ポインタ | backend B-S4b / B-S5b / B-S5c（対象 module が違う） |
| 3 | W-S2c | W-S2b の PR ＋ 親ポインタ | 同上 |
| 4 | W-S3 | W-S2c の PR ＋ 親ポインタ | W-S4a / W-S4b / W-S4c / W-S5 / W-S4d2a〜d3（`.github/workflows/ci.yml` だけを触る） |
| 4（学習サイクル） | W-S4a | W-S2c の PR ＋ 親ポインタ、かつ backend B-S0b の PR ＋ 親ポインタ | W-S3 / W-S4b / W-S4c / W-S5 |
| 4（学習サイクル） | W-S4b | W-S2c の PR ＋ 親ポインタ | W-S3 / W-S4a / W-S4d2a。**W-S4c・W-S5 とは直列**（認証 Provider のファイル・`settings/page.tsx`・`PlaybackProvider.tsx` が重なる。順序不定、後から merge する側が rebase） |
| 4（学習サイクル） | W-S4c | W-S2c の PR ＋ 親ポインタ | W-S3 / W-S4a / W-S4d2a。**W-S4b・W-S5 とは直列**（認証 Provider のファイルが重なる） |
| 4 | W-S5 | W-S2c の PR ＋ 親ポインタ、かつ backend B-S5a の PR ＋ 親ポインタ | W-S3 / W-S4a / W-S4d2a。**W-S4b・W-S4c・W-S4d2b・W-S4d1・W-S4d3 とは直列**（認証 Provider・`settings/page.tsx`・`PlaybackProvider.tsx`・`AuthProvider.*.test.tsx` が重なる） |
| 5（学習サイクル） | W-S4d2a | W-S1b・W-S2c・W-S4a の PR ＋ 親ポインタ | W-S3 / W-S4b / W-S4c / W-S5（テスト 5 本と `tests/helpers/gatewayDouble.ts` だけを触る） |
| 6（学習サイクル） | W-S4d2b | W-S4d2a・W-S4b・W-S4c の PR ＋ 親ポインタ | W-S3 / W-S4a。W-S5 とは直列 |
| 7（学習サイクル） | W-S4d1 | W-S4d2a・W-S4d2b の PR ＋ 親ポインタ（W-S1b・W-S4a〜c はその前提） | W-S3。W-S5 とは直列 |
| 8（学習サイクル） | W-S4d3 | W-S4d1 の PR ＋ 親ポインタ | W-S3。W-S5 とは直列 |

同じ web module 内で並行投入した slice は、後から merge する側が rebase する（並行を許した組は対象ファイルが重ならないことを 2026-09-24 に実測で確認した。W-S4b ∥ W-S4c・W-S4b ∥ W-S5・W-S4c ∥ W-S5 は起票時に並行可と書いていたが、認証 Provider のファイルと `app/(app)/settings/page.tsx` が重なるため直列に改めた）。

- **2026-09-24 の order 修正（独立評価 REJECT への対応）**: (1) W-S4d を 4 PR（W-S4d2a / 2b = テストの gateway double 移植、W-S4d1 = production の gateway 化、W-S4d3 = TP1 削除・eslint・失効配線）に分けた。テストを先に移すのは、page が Provider の gateway を使い始めた時点で `vi.mock('@/lib/api')` が効かなくなるため（production と同じ PR に入れると context ごとでも 1,000 行を超える）。fake は `lib/api/gateway.ts` の module にあり、TP1 経由の `createApiClient()` と Provider の両経路で効く。(2) eslint は `no-restricted-properties` でなく `no-restricted-syntax`（数値 Literal との `.status` 比較と `switch` だけを縛る。`podcast.status === 'completed'` は許可）。(3) 失効検知: `ApiClientProvider` が `onUnauthorized` prop を受け、`AuthProvider` が内包して渡す（`AuthProvider` ⊃ `ApiClientProvider`。layout の Provider 順序は W-S4d3 に明記）。(4) W-S2b: logout の `OfflineLibrary` は `AuthContext` が `cacheStore` adapter から直接生成、download は `usePlayback().offline.save(podcast)`、`getSavedPosition` は `usePlayback().savedPosition(id)`、特性テスト 13 本を不変 8 / 書換 5 / 新設 4 に分類。(5) W-S2a を規模で W-S2a / W-S2a2 に分けた。各 order に「規模」節（見込み行数。1,000 行超で分割しないもの = W-S1（T-T12 の 1:1 置換）・W-S2c（削除のみ）・W-S4d1（2 経路を併存させない）はその理由を節内に記載）を加え、完了条件の grep に除外範囲を明記した（W-S2a の `import type` from gateway、W-S4b の `localStorage` コメント行と `ThemeToggle.tsx:32`、W-S4c の `[pP]assword.length` と `AuthContext` コメント、W-S2b の旧ファイル除外）。

## unresolved

- **W-T14** は backend B-S7 待ち（order は枠だけ。B-S7 の契約から request・応答・期待値を写して確定させる。SG-C79）。
- 上記以外の order に未決の選択は無い（2026-09-23 夜の user 決定 SG-C5・C6・C13、2026-09-30 の SG-C50〜C79、2026-10-01 の SG-D3〜D5 と、order の起票で出た W-T7b の D-W7b-1 を決めた SG-D9 で閉じた）。

## takt への投入手順（親リポ `news-listen` の作業ツリーで）

order はサブモジュール内の docs にあるが、takt のタスク単位は親リポ（`.takt/config.yaml` の `submodules: all`）。order 本文をタスク内容として渡す（親 plan「投入の型」の `.takt/enqueue-orders.mjs` を使う。`takt add` は対話式で `-b` / `-t` を受け付けない）。

- ブランチ名は `takt/refactor/web-<slice>`。1 slice = 1 タスク = 1 PR（サブモジュール PR → 親 PR。draft は作らない。`.takt/facets/knowledge/project-context.md`）。
- 前 slice の submodule PR が main に merge され、**親リポのポインタ PR も merge されてから**依存する次 slice を release する（takt の worktree は親 main から clone し submodule が親の記録と一致することを検査するため）。指示書本文は投入時にコピーされるので、order を直したら再投入する。
- **投入前に、指示書を `analyze_order` の受入検査（全称命題の対象集合の数え上げ／条項どうしの矛盾／未決の選択）へ自分で通す。** 未決が 1 件でも残っていれば投入しない（親 `docs/trial-log/order-acceptance-inspection-finds-design-defects.md`）。
- analyze_order は order を「承認済み指示書」として**検証モード**で受ける。generate_spec の `spec.md` / `plan.md` は Spec の該当 slice の契約（CI-T*）と特性テストの抜粋で足り、新しい契約 ID を作らない。
- 各 order の「特性テスト（baseline）」が green でなければ着手しない（bootstrap_worktree のベースライン verify とは別に、slice 固有の baseline）。

## 完了後
- 各 slice の merge 後、`docs/trial-log/` に棄却・方針転換があれば追記（takt の record_trial_log が行う）。各 order の「記録」節にある親 docs への返却（共有仕様 §4.3 / §4.4 の保留解除・web-design §12 の書き換え）を router が行う。
- W-T15 の完了（許可リスト 0 件）を含む全 slice 完了で本フォルダを削除し、親 docs `design/web-design.md` §3〜§9 を target の内容へ書き換え、§12 を削除する。
