# web リファクタ計画（2026-09-16 設計レビュー反映）— takt 委譲用の指示書

2026-09-16 の web 設計レビュー（`docs/research-reports/2026-09-16-code-design-review.md`）と user 承認済みの Implementation Spec（`docs/design/2026-09-16-implementation-spec-domain-model.md`）、および 2026-09-23 の主体離脱の決定（親 docs [ADR-104](../../../../docs/adr/104-subject-departure-and-subject-scoped-assets.md)）を、takt の `sdd-governed` ワークフローへ slice 単位で委譲するための指示書（order）一式。slice ID は親 docs の [実行計画](../../../../docs/plan/2026-09-16-design-review-refactor.md)（2026-09-23 再スライス版）の接頭辞付き ID `W-*` を正本とする。正本は Spec であり、本フォルダの各 order は Spec の該当 slice を takt の 1 タスクに切り出したもの。実装完了後、本フォルダは削除し、確定内容は親 docs の `design/web-design.md`（§12 target 節を現状記述へ書き換え）へ移す（`agent-rules/30` の plan ライフサイクル）。

## slice と投入順

| 順 | order | 内容 | 依存 | 検証する行 ID（web-design §12.5） | 切替方式 |
|---|---|---|---|---|---|
| 完了 | [S0-constraint.md](S0-constraint.md)（W-S0） | BFF fail-closed・失効時 cleanup・admin gate | なし | SL-03・SL-05（骨格）。SL-01 / 02 / 04 は骨格のみ | 小ステップ |
| 独立 | [W-0-push-reregistration.md](W-0-push-reregistration.md) | Web Push の再登録と logout 時の購読解除（ADR-104 決定 18〜24）。**backend B-S5 の着手条件** | なし（他の web slice と対象ファイルが重ならない） | — | 特性テスト → RED → 実装 |
| 1 | [W-S1-gateway.md](W-S1-gateway.md) | `ApiGateway`（`Result` / `ApiFailure`・deadline）と最小注入点（再生系 4 箇所） | S0 | — | 旧 `ApiError` 互換 adapter（TP1）を暫定保持（削除は W-S4） |
| 2 | [W-S1b-api-split.md](W-S1b-api-split.md) | `lib/api.ts` を backend リソース単位の 10 ファイルへ分割（横断関数 0 件・呼出側不変） | W-S1 | — | 挙動不変（型・関数名不変） |
| 3 | [W-S2a-playback-domain.md](W-S2a-playback-domain.md) | `lib/playback/*` ドメイン層の新設（Session・Queue gate・ResumeRule・OfflineLibrary・Coordinator・PositionReporter）。既存コードから呼ばない | W-S1b | RS-01〜RS-07（純関数・表駆動）。Q-01〜Q-32 を新モジュールでも | ① 新規コードのみ |
| 4 | [W-S2b-playback-entry.md](W-S2b-playback-entry.md) | `PlaybackProvider` へ入口を差し替え。§2・Q-* は挙動不変。変わるのは列挙した行のみ | W-S2a | PS-01〜PS-06・PS-08（port double で全行）。§6.4 送信条件（PS-05 / 05b）。SG-X1 / X2 / X4 | ② 特性テスト 12＋e2e 3（不変）＋準拠テスト（変更行） |
| 5 | [W-S2c-playback-cleanup.md](W-S2c-playback-cleanup.md) | 旧再生実装 7 ファイル・`AppContext.currentPodcast`・`reorderUpNext` の削除、依存方向 eslint | W-S2b | — | ③ 削除のみ（参照 0 件を grep で判定） |
| 6a | [W-S3-gates.md](W-S3-gates.md) | CI に `typecheck:ts7`・独立 build・依存方向 eslint の実行 | W-S2c | — | — |
| 6b | [W-S4-catalog-prefs.md](W-S4-catalog-prefs.md) | `Episode` の UI 展開・`PreferencesRegistry`・`rate_limited.scope`・`PasswordPolicy`（12〜20）・`error_message` 4 値の文言写像・`lib/api` の context 別取り込み・`AppContext` 解体の完了・TP1 削除 | W-S2c ＋ **backend B-S0b / S0c（完了）の merge**（契約値） | PS-07（`PlayableEpisode` の fail-closed） | inline theme script の key 複製を pin テストで暫定保持（TP3） |
| B-S5 後 | [W-S5-subject-cache.md](W-S5-subject-cache.md) | 主体別音声キャッシュ `audio-v1-{user_id}`・起動時の回収・旧 `audio-v1` の初回全削除・主体依存 3 key の削除・主体離脱時の再生停止 `stopForSubjectLeave`（ADR-104 決定 27・SG-A1 / A2 / A6） | **backend B-S5**（`/auth/me`・login 応答の `user_id` 公開）＋ **W-S2c**（`PlaybackSession` の存在。SL-01 / SL-07 の再生停止を担う）。W-S4 とは順序不定（order 内に両方の状態を記載） | SL-01・SL-02・SL-04・SL-06・SL-07（再生停止・音声キャッシュ・端末設定の全事後条件） | 不可逆点（Cache 名前空間の変更） |
| 保留 | （learning） | `lib/learning/` の 3 ルール・StreakContext の副作用移動 | 学習機能サイクル | — | order 未作成 |

依存の直列: **W-S1 → W-S1b → W-S2a → W-S2b → W-S2c → {W-S3, W-S4, W-S5}**。W-0 は独立。W-S5 はさらに B-S5 の後（B-S5 は W-0 の後）。
- 2026-09-23 の受入検査で返した未決 6 件は同日 user 判断で確定し各 order に反映済み（resume の入力合成 Q12=A、`user_id` 欠落時は android 同型 Q13=A、回収は主体確定時に 1 回 Q10=A、TP1 本体削除は W-S4、SL-01 / SL-07 の再生停止は W-S5、W-S1b の 10 ファイル束ね方を採用）。親 plan・web-design §12.3 の W-S2c 行（「暫定互換 adapter」）と W-S1b 注記は router が修正する。

- 共有仕様 §6.7 の Selection Gate SG-X1〜X5 は 2026-09-16 に全て確定済み（SG-X3 は 2026-09-23 に ADR-104 で「待たない＋主体識別」へ改訂）。web に効くのは SG-X1（完聴時に `duration`）・SG-X2（末尾 2 秒窓）・SG-X4（一時停止中は送らない。web は現行どおり）で、いずれも W-S2a / W-S2b の準拠テスト行に対応する。
- 2026-09-23 の ADR-104 補足（SG-A1 旧 `audio-v1` の初回全削除・SG-A2 web の logout は cookie 提示・SG-A6 主体依存 key の分類表）は W-S5 が適用する。
- 他モジュールとの契約: backend の新規パスワード規則（12〜20、ADR-101）と `error_message` 識別子 4 値（ADR-102）は backend B-S0b の merge 後に W-S4 で写像する。`user_id` の公開（ADR-104 決定 15）は B-S5 の後に W-S5 が使う。
- 共有仕様 1.1（§2.11・§4.3〜§4.4・§6.4〜§6.6）は news-listen-docs #133 で main 済み。準拠テストは行 ID（`PS-*` / `SL-*` / `RS-*` / `Q-*`）をテスト名に含める。
- 一括切替（旧 S2・SG8）は 2026-09-23 に ①②③ の 3 段へ分割した（親 plan「一括切替を 3 段に割る」）。旧 `S2-playback.md` は削除済み。

## takt への投入手順（親リポ `news-listen` の作業ツリーで）

order はサブモジュール内の docs にあるが、takt のタスク単位は親リポ（`.takt/config.yaml` の `submodules: all`）。order 本文をタスク内容として渡す。

```bash
# 例: W-S1b
takt add -w sdd-governed -b takt/refactor/web-s1b-api-split \
  -t "$(cat web/docs/plan/2026-09-16-design-review-refactor/W-S1b-api-split.md)"
takt run
```

- ブランチ名は `takt/refactor/web-<slice>`。1 slice = 1 タスク = 1 PR（サブモジュール PR → 親 PR。draft は作らない。`.takt/facets/knowledge/project-context.md`）。
- 前 slice の PR が main に merge されてから依存する次 slice を投入する（takt の worktree は main を基点に clone するため）。
- **投入前に、指示書を `analyze_order` の受入検査（全称命題の対象集合の数え上げ／条項どうしの矛盾／未決の選択）へ自分で通す。** 未決が 1 件でも残っていれば投入しない（親 `docs/trial-log/order-acceptance-inspection-finds-design-defects.md`）。
- analyze_order は order を「承認済み指示書」として**検証モード**で受ける。generate_spec の `spec.md` / `plan.md` は Spec の該当 slice の契約（CI-T*）と特性テストの抜粋で足り、新しい契約 ID を作らない。
- 各 order の「特性テスト（baseline）」が green でなければ着手しない（bootstrap_worktree のベースライン verify とは別に、slice 固有の baseline）。

## 完了後
- 各 slice の merge 後、`docs/trial-log/` に棄却・方針転換があれば追記（takt の record_trial_log が行う）。各 order の「記録」節にある親 docs への返却（共有仕様 §4.3 / §4.4 の保留解除・web-design §12 の書き換え）を router が行う。
- 全 slice 完了で本フォルダを削除し、親 docs `design/web-design.md` §3〜§9 を target の内容へ書き換え、§12 を削除する。
