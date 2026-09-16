# trial-log: mino 設計 Skill 群による設計レビューの委譲運用
範囲: review mode で 4 Function（architecture / completeness / contract / boundary）を read-only サブエージェントへ委譲する際の運用上の試行と失敗を扱う。レビュー内容そのもの（finding・package）は `docs/research-reports/2026-09-16-code-design-review.md` が正本で、ここでは扱わない。

## 2026-09-16 初回実行（`docs/research-reports/2026-09-16-code-design-review.md`）

### 起きたこと
- 目的: 4 Function package を並列委譲で作り、router（メイン）が統合する。
- 前提: `testability-architect`（Skill 呼出可・read-only）に各 Function を 1 体ずつ。turn 上限 20。
- やったこと: 共通ブリーフ（routing_context・R1-R8・既知観測・出力契約）をファイルにして各体に読ませ、成果物は scratchpad に heredoc で書かせた。
- 結果:
  1. **3 体とも初回は turn 上限で成果物ゼロ**（package を書く前に読み込みで使い切る）。`SendMessage` で「読むのをやめて今あるものを書け」と再開指示したら全員が完走。→ ブリーフに「N ターン以内に書き始める」「読みは 1 回の sed -n に束ねる」を最初から入れるべき。
  2. **Boundary 担当が複数ファイルを連結して `sed -n` し、その persisted-output を `cat -n` で読み戻したため、transcript の累積行番号をファイル行番号として引用**（138 行の AuthContext.tsx を `:318-319` 等、54 参照が範囲外）。`wc -l` 超過の機械検査で発覚。再開指示で「1 ファイル 1 `grep -Hn`」により全 200 参照を訂正、内容差分ゼロを確認。→ path:line を要求するブリーフには「連結読みの行番号を引用しない」「提出前に `wc -l` 超過検査」を明記する。
  3. Contract 担当は Architecture package を読もうとした時点でまだ存在せず（並列起動のため）、owner 2 件を obligation で返した。router 側で解決。→ 依存順を守るなら wave 分け、並列にするなら「無ければ obligation」を最初から書く（今回は後者で問題なし）。
- 残課題: なし（運用知見は agentDevTemplate 側のブリーフ雛形へ昇格候補）。

### 棄却した案
- 4 Function を 1 体に統合して委譲する案: 1 package で 1,300〜1,700 行になり、turn 上限と context の両面で破綻するため不採用。

### 独立評価（adversarial-verifier）で見つかった router 側の誤り
- 目的: §4 finding の反証。前提: 評価者は他 package を判定材料にしない。
- 結果: 34 引用中 3 件が誤り。いずれも**件数主張と自己矛盾**（行番号の誤りは 0）。(1) 「404=未蓄積 5 ファイル」は 4 ファイルで意味も 3 種＝同一ルール重複ではない、(2) `createApiClient` の T1 内訳表が 1 ファイル 4 箇所を欠落し定義行を算入（34 → 正 37）、(3) RF7 の「位置の reconciliation 規則なし」が自身の引用 `lib/playbackPosition.ts` と矛盾。
- 教訓: **件数主張は per-file 内訳を必ず出し、定義行・import 行の扱いを明示する**。「同一ルールの重複」と言う前に各出現の意味が同じか確認する。finding 本文と自身の引用先を突き合わせる。
- 残課題: 評価者も turn 上限で RF16/17/19/21/22 に未到達。次回は上位 8 件に絞ったブリーフにする。

### 2026-09-16 Implementation Spec の事前実装ゲート（architecture ロール 1 回）
- 目的: `docs/design/2026-09-16-implementation-spec-domain-model.md` を mino Design gate / code-design / §8 整合 / 共有再生仕様 §2 互換 / 移行現実性で監査。
- 結果: **revise**（11 件）。主要指摘: (1) 「現在再生中」が Queue(DTO) と Session(Episode) で二重化 → INV-P1 と `nowPlaying()` で解消、(2) 位置 writer が 2 capsule → `PositionReporter`(CP9) に集約、(3) `Queue.create` の「拒否」が §2.4 clamp / §2.5 dedupe と衝突 → 公開操作は正規化・create は内部 gate（throw）、(4) S2 の特性テストが消費者 7 ファイルを取りこぼし → 12 ファイル＋e2e 3 本に拡張し `AudioPlayerBar` を S2 scope へ、(5) S1 の `lib/api` 6 分割が SG5「最小」を超過 → S4 へ、(6) §8「記録のみ」の RF16/18/19/20 を無断で作業化 → SG9 として user 判断へ。全文: `docs/research-reports/2026-09-16-code-design-review/spec-gate.md`。
- 棄却した案（ゲートの検討より）: 旧/新 Provider 併存移行（SG3 と二重 owner が両立しない）、`QueueState` の branded type 化（iOS/Android と共有する型表現の乖離）。
- 残課題: SG8（一括切替）・SG9（逸脱採否）の user 判断。
