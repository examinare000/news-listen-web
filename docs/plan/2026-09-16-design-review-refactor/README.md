# web リファクタ計画（2026-09-16 設計レビュー反映）— takt 委譲用の指示書

2026-09-16 の web 設計レビュー（`docs/research-reports/2026-09-16-code-design-review.md`）と user 承認済みの Implementation Spec（`docs/design/2026-09-16-implementation-spec-domain-model.md`）を、takt の `sdd-governed` ワークフローへ slice 単位で委譲するための指示書（order）一式。正本は Spec であり、本フォルダの各 order は Spec の該当 slice を takt の 1 タスクに切り出したもの。実装完了後、本フォルダは削除し、確定内容は親 docs の `design/web-design.md`（§12 target 節を現状記述へ書き換え）へ移す（`agent-rules/30` の plan ライフサイクル）。

## slice と投入順

| 順 | order | 内容 | 依存 | Selection Gate | 切替方式 |
|---|---|---|---|---|---|
| 1 | [S0-constraint.md](S0-constraint.md) | BFF fail-closed・失効時 cleanup・admin gate | なし | なし | 小ステップ |
| 2 | [S1-gateway.md](S1-gateway.md) | `ApiGateway`（`Result` / `ApiFailure`・deadline）と最小注入点（再生系 4 箇所） | S0 | なし | 旧 `ApiError` 互換 adapter（TP1）を暫定保持 |
| 3 | [S2-playback.md](S2-playback.md) | `lib/playback/*`・`PlaybackProvider`・`currentPodcast` 削除・速度 2 概念・状態 union・失敗時停止・`moveUpNext` rename | S1 | **SG-X1 / SG-X2**（完聴時の送信値・resume 2 秒窓）が pending の間は該当契約を現行値で pin し、gate 確定後に差分 PR | **一括切替**（特性テスト 12 ファイル＋e2e 3 本 green が入口条件） |
| 4 | [S3-gates.md](S3-gates.md) | CI に `typecheck:ts7`・独立 build・依存方向 eslint | S2 | なし | — |
| 5 | [S4-catalog-prefs.md](S4-catalog-prefs.md) | `Episode` の UI 展開・`PreferencesRegistry`・`rate_limited.scope`・`PasswordPolicy`（12〜20）・`error_message` 4 値の文言写像・`lib/api` の context 別分割 | S2、**backend S0b / S0c の merge**（契約値） | なし | inline theme script の key 複製を pin テストで暫定保持（TP3） |
| 保留 | （S5 learning） | `lib/learning/` の 3 ルール・StreakContext の副作用移動 | 学習機能サイクル | — | order 未作成 |

- Selection Gate の正本は親 docs `design/shared-playback-spec.md` §6.7（SG-X1〜X5、owner: user）。pending を選択済みとして扱わない。
- 他モジュールとの契約: backend の新規パスワード規則（12〜20、ADR-101）と `error_message` 識別子 4 値（ADR-102）は backend 側 slice（S0b / S0c）の merge 後に web S4 で写像する。それまで web は現行値のまま。
- 共有仕様 1.1（§2.11・§4.3〜§4.4・§6.4〜§6.6）は news-listen-docs #133 で main 済み。S2 の準拠テストは行 ID（PS-* / SL-* / RS-*）をテスト名に含める。

## takt への投入手順（親リポ `news-listen` の作業ツリーで）

order はサブモジュール内の docs にあるが、takt のタスク単位は親リポ（`.takt/config.yaml` の `submodules: all`）。order 本文をタスク内容として渡す。

```bash
# 例: S0
takt add -w sdd-governed -b takt/refactor/web-s0-constraint \
  -t "$(cat web/docs/plan/2026-09-16-design-review-refactor/S0-constraint.md)"
takt run
```

- ブランチ名は `takt/refactor/web-<slice>`。1 slice = 1 タスク = 1 PR（サブモジュール PR → 親の draft PR の順。`.takt/facets/knowledge/project-context.md`）。
- 前 slice の PR が main に merge されてから次を投入する（takt の worktree は main を基点に clone するため）。
- analyze_order は order を「承認済み指示書」として**検証モード**で受ける。generate_spec の `spec.md` / `plan.md` は Spec の該当 slice の契約（CI-T*）と特性テストの抜粋で足り、新しい契約 ID を作らない。
- 各 order の「特性テスト（baseline）」が green でなければ着手しない（bootstrap_worktree のベースライン verify とは別に、slice 固有の baseline）。

## 完了後
- 各 slice の merge 後、`docs/trial-log/` に棄却・方針転換があれば追記（takt の record_trial_log が行う）。
- 全 slice 完了で本フォルダを削除し、親 docs `design/web-design.md` §3〜§8 を target の内容へ書き換え、§12 を削除する。
