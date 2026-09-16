# Spec gate — 2026-09-16 Implementation Spec（architecture ロール・read-only）

対象: `/Users/rio/git/news-listen/web/docs/design/2026-09-16-implementation-spec-domain-model.md`
結論: 設計の骨格（context 分割・port 4 つ・状態 union・失敗方針）は妥当。**revise**。最大の問題は「現在再生中」の正本が Queue(`Podcast` DTO) と PlaybackSession(Episode) に二重化し、位置保存の owner も CP1/CP4 に割れていること、次いで S1/S2 が §8 の決定より広いこと。

## A. Design gate — WEAK
- requirement catalog + trace: §7 に R1〜R8 × UC × capsule × CI × test。分母 8 は review §3 由来。**欠落**: UC 側の分母（UC-L2〜L5, UC-M1〜M4, UC-S1/S3 に CI なし）と「未 coverage の UC/finding 一覧」が無い。→ §7 に「CI 対象外 UC とその理由」行を追加。
- 概念/状態/失敗/owner: **FAIL 1 件**。`Queue.items` は共有仕様 §2.1 のまま `Podcast` DTO（`lib/playbackQueue.ts:18,30,35`）、一方 §3.1/CP1 は Episode を持つ。CI-T7「現在再生中の唯一の reader は `Queue.current`」と `PlaybackSession(episodeId, duration, ...)` の共存で、payload の source of truth が未定義。→ 「Queue は順序と現在位置の正本、再生中 payload は Session が decode 済み Episode を保持し、両者の episodeId 一致を不変条件にする」と明記し CI-T7 を「順序・現在位置の正本」に限定。
- 正本一意の二人 owner: CP1 が「保存 throttle（local 位置）」、CP4 が「server 位置の単調性」を持つ（§5 CP1/CP4, §3.1）。位置の writer が 2 capsule に割れ R3 に反する。→ `PositionReporter`（local+server 書込・throttle・単調性を 1 owner）を CP1 から切り出すか、CP4 に寄せる。
- 不正状態の公開経路: **WEAK**。`Queue.create` は導入するが `QueueState` は構造型のまま（`lib/playbackQueue.ts:15` の `emptyQueue` も export）。「任意 importer が構築可能」(RF18) は型を branded/opaque にしない限り閉じない。→ create 以外の構築禁止を型で表すか、CI-T9 の statement を「公開操作の出力は常に不変条件を満たす」に弱める。
- 失敗後状態・禁止遷移・retry/duplicate: PASS（§3.1 表、CI-T6、CI-T8）。ただし T-T1 の分母「遷移表 12 行」は §3.1 の行数と一致せず（6 状態・記載遷移 13）。→ 分母を列挙で固定。
- 技術型の非露出: PASS（§5 leakage guard）。ただし CP6 の `Result<T, ApiFailure>` の定義（throw するか値で返すか）が未定義で T-T12/T-T9 の oracle が書けない。→ Result 型と失敗の返し方を §4 に定義。
- 品質 scenario: PASS（CS1/CS4 に evidence、CS2/CS3 は not_applicable + 理由）。
- risky change / temporary path: WEAK。owner・導入日・削除条件を持つのは TP1 のみ、TP2/TP3 に owner が無い（§6）。→ 3 つとも owner/導入日/削除条件を揃える。
- 各判断の Evidence: PASS（port 表の根拠、RO1〜RO3 の reject 理由）。

## B. Code design — PASS（2 点 WEAK）
- capsule は目的中心、branch_decisions 5 件の分類（business decision table / short input guard / policy / lifecycle state）は妥当。
- abstraction gate: 4 port すべてに品質根拠（`tests/helpers/mockAudio.ts` / `mockCaches.ts` の seam 昇格は既存事実）。factory/Strategy/汎用 Storage/Clock を明示 reject。**PASS**。
- WEAK1: CP4 の owns が 5 項目 + public 7 操作。上記「位置 writer」を外せば目的が 1 つ（UC-P1/P3 の orchestration）に収束する。
- WEAK2: `code_design` から `public_operations` と `rejected_overdesign` キーが欠落（reject は abstraction_decisions に混在）。schema どおりに分けると RO1〜RO6 の追跡が効く。

## C. §8 Q1〜Q9 との整合 — WEAK（超過 2・前提先走り 1）
- 一致: Q4/SG3（`AppContext.currentPodcast` 削除）、Q5（速度 2 概念・CI-T4）、Q6（停止 + 手動再試行・CI-T6）、Q7（4 値 gate・CI-T16）、SG4（失効時は SW キャッシュのみ、`audio-v1` は明示 logout。`contexts/AuthContext.tsx:94-98,103` の現状と整合）、Q8（ts7+build、audit 除外）。
- **超過 1（S1）**: SG5 は「Provider が 1 つの API client を保持する最小注入点、まず再生系 4 箇所」。спец S1 はそれに加えて `createApiClient()` を `lib/api/{playback,catalog,...}.ts` 6 ファイルへ分割する（§6 S1）。378 件の特性テストを抱えた大規模再配置で、SG5 の「最小」を超える。→ ファイル分割を S1 から外し、必要になった context から S2/S4 で分ける。
- **超過 2（RF16〜RF20）**: §8.3 は RF4/RF16〜RF20/RF22 を「記録のみ・変更しない」と決めた。spec は RF16→CI-T8、RF17→CI-T3/UV3、RF18→`Queue.create`、RF19→依存禁止、RF20→CI-T18/TP2 として作業化している。書き換えに伴い自然に入るものもあるが、**決定からの逸脱として明記が無い**。→ §8 相当の節に「§8 で記録のみとされたが S2 の書き換えで同時に閉じる finding」とその追加コスト（TP2 の pin テスト・単調性実装）を明示し、user の再確認対象にする。
- 前提先走り: §3.3 が「`admin/users` の 8 文字は不具合として 12 に統一する前提」と書きつつ SG7 は pending。→ pending の gate を前提として本文に書かない（「SG7 未決。既定 = 現状維持」に統一）。
- RF14（modal/focus trap 3 重実装・empty-state 7 箇所）は §8 で保留だが spec 本文に一切現れない。→ 「本 spec で扱わない finding: RF4, RF14, RF22」を明記。

## D. 共有再生仕様 §2 との両立 — WEAK（1 つは実害あり）
- 命名 `moveUpNext(=reorderUpNext)`: 実体は `lib/playbackQueue.ts:95 reorderUpNext`（同 :93 が既に `@see §2.7 moveUpNext`）。改名は観測挙動を変えず spec 名に寄せる改善。ただし影響は lib + `contexts/AudioPlayerContext.tsx:188` + `tests/lib/playbackQueue.{test,conformance.test}.ts` + `tests/components/AudioPlayerBar.test.tsx` に及ぶ。→ **純粋 rename を独立コミット**にし、conformance 行 ID と引数の意味（upNext 基準・削除前オフセット）は触らないことを spec に明記。
- **`Queue.create` と §2.4/§2.5 の衝突（要修正）**: CI-T9 は「違反入力を拒否する」。しかし §2.4 `setQueue` は範囲外 `startAt` を**クランプ**（現実装 `lib/playbackQueue.ts:36-38`）、§2.5/§2.6 は重複を**排除**する設計で、`setQueue` は重複排除しない。create を公開操作の内部に置いて「拒否」にすると Q-spec の clamp 行が落ちる。→ 「公開操作は §2 どおり正規化（clamp / dedupe / no-op）し、`create` は正規化後の不変条件 gate（違反は開発時エラー）」と役割を分ける。CI-T9 の statement をその二層に書き換える。
- `start`/`setQueue` の SG6: conformance 32 行が両操作を検証している以上、削除は Q-spec 準拠を壊す。default「残す」は妥当。→ SG6 の default 理由に「conformance 行が存在する」を evidence として追記。
- それ以外（Q-01〜Q-32・iOS/Android 共有契約）を壊す変更は spec に見当たらない。**PASS**。

## E. 過剰 / 不足
- 根拠の薄い要素（削る候補）: `CP8.subscribe`（要件・finding なし）、`lib/api` 6 分割（上記 C）、`OB-N1`（Notifications の error→unsubscribed 回復遷移。RF に対応が無く §8 の対象外）。
- 触れていない finding: RF14（記載なし）、RF13 は R7「各 slice 1 本以上の integration」のみで、E2E が `page.route` stub である問題（review RF13）への回答になっていない。→ どちらも「今回扱わない」と書くか、R7 の受入条件を具体化する。

## F. Testability — WEAK（3 件）
- 公開 API で観測できる: T-T1〜T-T6, T-T8, T-T9, T-T11〜T-T17。ports（AudioElement / CacheStore / KeyValueStore / gateway spy）経由で内部に触らず書ける。
- T-T7: 「型レベル + grep 0 件」は実行可能なテストではない。→ eslint `no-restricted-syntax` / `no-restricted-imports` ルール化して CI（S3）に載せる。そうでなければ oracle として数えない。
- T-T10: 「最後の書込まで `has()` は false」は途中状態の観測であり、素の `MockCaches` では privates を覗くことになる。→ `put()` の解決を試験側が制御できる CacheStore double（deferred promise）を test-double 戦略として明記する。
- T-T18: `public/sw.js` をファイル読みして比較する pin テスト。capsule API ではないが TP2 の削除条件として許容。→ 「fs 参照はこの pin テストに限る」と限定する。
- T-T9: create の失敗の返し方（throw / Result）が未定義のため oracle が書けない（A の Result 未定義と同根）。

## G. 移行の現実性 — FAIL（S2 の保護が不足）
S2 の特性テスト一覧（`AudioPlayerContext.{queue,offline,completion}`・`useAudioPlayer`・`audioCache`・conformance・e2e 2 本）は**消費者を取りこぼしている**。grep で確認した未記載の消費者:
- production: `app/(app)/podcast/page.tsx:199`（`state.currentPodcast?.id`）、`components/AudioPlayerBar.tsx:16,28,30,65,66,139,160`（`currentPodcast.duration_seconds/difficulty/created_at` を直接読む）、`hooks/useStartPodcast.ts:19`、`contexts/AppContext.tsx:14,24,44`（reducer action）、`app/layout.tsx`、`lib/audioCache.ts:20`（`createApiClient` import＝RF19 の依存違反。S1 と S2 の両方に跨る）。
- tests: `tests/components/AudioPlayerBar.test.tsx`、`tests/app/podcast/page.test.tsx`、`tests/app/podcast/id/page.test.tsx`、`tests/app/app-group-layout.test.tsx`、`tests/contexts/AppContext.test.tsx`、`tests/app/settings/page.test.tsx`（既定速度）、`e2e/main-flow.e2e.ts`。
- 併せて矛盾 1 件: spec は「Episode の page 展開は S4」としつつ、`AudioPlayerBar` は DTO field を直読みしているため S2 で必ず型が変わる（§8 residual_risks に気づきはあるが slice 定義に反映されていない）。→ S2 に「NowPlaying view model（Session が出す表示用 Episode 派生値）」を定義して UI の DTO 直読みを切る、または `AudioPlayerBar` の Episode 化を S2 の scope に入れる。
- 一括切替（SG8 default）自体は、上記の特性テストを**追加した上でなら**現実的。追加前の一括切替は revert 以外の回復手段が無い。

## 必要な修正（重要度順）
1. S2 の特性テスト集合に上記 G の 7 テストファイルを追加し、`AudioPlayerBar` の Episode 化（または NowPlaying view model 定義）を S2 の scope に明記する。これが無い限り SG8 の一括切替は承認できない。
2. 「現在再生中」の二重表現を解消: Queue=順序と現在位置の正本、Session=decode 済み Episode 保持、episodeId 一致を不変条件、CI-T7 の statement をその通りに限定する。
3. 位置保存の owner を 1 つにする（`PositionReporter` を CP1 から切り出す or CP4 に統合）。CP1 の owns から「保存 throttle」を外す。
4. `Queue.create` の役割を「公開操作は §2 どおり正規化、create は正規化後の不変条件 gate」に書き分け、CI-T9 の「拒否」表現と §2.4 clamp / §2.5 dedupe の衝突を解消する。失敗の返し方（throw / Result）も定義。
5. S1 の scope を SG5 どおり「gateway + Provider 注入 + 再生系 4 箇所」に戻し、`lib/api` の 6 ファイル分割を S2/S4 以降へ送る。
6. §8 で「記録のみ」とされた RF16〜RF20 を S2 で閉じることを、逸脱として明示し追加コストを user 確認に回す。RF14/RF4/RF22 は「本 spec で扱わない」と明記。
7. T-T7 を eslint ルール + CI（S3）へ、T-T10 を deferred-put な CacheStore double へ、T-T18 の fs 参照を限定と書き換える。T-T1 の分母を遷移の列挙で固定する。
8. `moveUpNext` への rename を純粋 rename の独立コミットとして切り出し、conformance 行 ID・引数意味の不変を明記する。SG6 の default 理由に conformance 行の存在を evidence として追記。
9. TP2/TP3 に owner と導入日を付ける。`Result<T, ApiFailure>` 型を §4 に定義する。
10. §7 に「CI 対象外の UC（UC-L2〜L5, UC-M1〜M4, UC-S1/S3）とその理由」を追加し、coverage の分母を明示する。
11. §3.3 の「12 に統一する前提」を削り、SG7 pending / default 現状維持に統一する。`CP8.subscribe`・`OB-N1`・`lib/api` 分割は根拠が無ければ削る。

gate_verdict: revise
