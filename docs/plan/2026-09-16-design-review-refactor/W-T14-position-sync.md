## web リファクタ W-T14: Playback — 位置同期のクライアント側（ADR-109 決定 7〜14。backend B-S7 待ち）

> **状態: backend B-S7 待ち。B-S7 の契約が backend main に入り、親ポインタが進むまで投入しない。** 新 Spec §8.1 は「B-S7 が main に入ってから order を書く（SG-C79）」とする。本ファイルは置き場と、決まっている事柄だけを固定する枠であり、**request の形・応答の field 名・テストの期待値は B-S7 の実装から写して確定させる**。確定させるまで「対象」「契約と検査」「完了条件」は未完成として扱う（受入検査に通さない）。
>
> **B-S7 の後に確定させる項目（全件）**: (1) 位置の書込の body に足す記録時刻の field 名と形式。(2) 位置の取得の応答に足す記録時刻の field 名。(3) backend が「古い書込」を受けたときの応答（status と body）。(4) 「聴いた日」の扱いが web の表示に及ぶか（B-S7 の SG-C78・C80）。いずれも backend の契約で、web は決めない。

## 概要
SG-C74（記録時刻の新しい方を正とする）・SG-C76（端末の記録の永続保存と後送り・主体離脱で送らずに消す）・SG-C77（サーバーの記録の方が新しく位置の差が 15 秒以上なら、前面の画面の再生ボタンで再開するときにどちらから続けるかを尋ねる）を web に適用する。目標の置き場は新 Spec §5.1 のとおり: 端末の記録 = `lib/playback/infrastructure/localPositionStore.ts`（位置と記録時刻）、送信 = port `PositionSync`（引数に記録時刻）、再開位置の候補の決め方 = `lib/playback/application/coordinator.ts` の 1 箇所（TA-R-PB-5。`server > 0 ? server : local` を置き換える）。正本は新 Spec §5.1（TA-R-PB-5・6・port の表）・§8.2 W-T14 行・§9、既存 Spec §3.1「target: 位置同期のクライアント側」、親 docs [ADR-109](../../../../docs/adr/109-playback-position-last-write-wins-and-offline-sync.md) 決定 7〜14、共有仕様 §6.2・§6.4。

応える ID: F-POD-08（PRD §5）、UC-P6、AQ-2（TA-V10 の問い 2: 端末の記録の形の変更が `localPositionStore.ts` と `LocalPositionStore` の型に収まる）、SG-C74・C76・C77・C79、ADR-109 決定 7〜14、共有仕様 §6.2・§6.4 の保留を外す行。

## 種別
適用 slice（決定は SG-C74〜C79・ADR-109 で確定済み）。投入の条件は B-S7 の契約だけ。

## 規模
B-S7 の契約が main に入ってから見積もる（新 Spec §8.2）。

## 前提・着手条件
- 依存: **W-S2c** の web PR ＋ 親ポインタ、**backend B-S7 の契約が backend main にあること**（PR 番号でなく契約で判定。B-S7 order の完了条件を親 main の backend submodule で確かめる）。W-S5（`LocalPositionStore.clearAll()` を主体離脱で呼ぶ）が先に入っていること。
- 再開ゲートと、上の「B-S7 の後に確定させる項目」4 件が本ファイルに書き込まれていること。

## 着手前の前提点検（B-S7 の後に行う）
`lib/playback/infrastructure/{localPositionStore,gatewayFns}.ts`・`lib/playback/application/{coordinator,positionReporter,ports}.ts` の現行の形、`podcast_position:{id}` の保存形式（JSON の数値）、backend B-S7 の request・応答の schema（backend `api/schemas.py` と `tests/contract/test_persistence_playback.py`）を読み、行番号と field 名を本ファイルに写す。

## 対象（枠。B-S7 の後に確定）
- `lib/playback/infrastructure/localPositionStore.ts`: record を「位置と記録時刻」に。旧形式（数値だけ）を読めるようにする（AQ-2。読み替えは adapter）。
- `LocalPositionStore`・`PositionSync` の型（`lib/playback/application/ports.ts`）: 記録時刻を足す。
- `lib/playback/application/positionReporter.ts`: 送れなかった記録の後送り（接続が戻ったとき・起動時・次に位置を送るとき）。
- `lib/playback/application/coordinator.ts`: 再開位置の候補（時刻の新しい方）と、SG-C77 の確認（問いの提示は presentation。application は「確認が要る」を結果として返す）。
- `lib/playback/infrastructure/gatewayFns.ts`: body と応答の記録時刻。
- 対象外: 主体離脱での消去の手順（W-S5 の `clearAll()` を使う）・タブを閉じる時の送信（共有仕様 §6.4 の web の保留）。

## 移行の中間状態
TA-R-PB-5 の「現行の合成」を置き換える。新しい一時経路は B-S7 の後に判断する（無い見込み）。

## 変わる挙動（決定 ID つき。B-S7 の後に文言と期待値を確定）
SG-C74（記録時刻の新しい方を正とする）、SG-C76（オフラインで記録した位置を後で送る）、SG-C77（15 秒以上の差で再開時に尋ねる。文言は ADR-109 と共有仕様 §6.4 の正本から写す）。

## 契約と検査
共有仕様 §6.2・§6.4 の保留を外す行（行 ID をテスト名に含める）、TA-V6・TA-V7（Playback）、TA-V10 の問い 2。

## 受入とテストのコマンド
`npm test`・`npm run lint`・`npm run typecheck`・`npm run typecheck:ts7`・`npm run build`・`npm run test:e2e`（`offline-playback`・`queue-autoadvance`・`main-flow`）。

## 完了条件
B-S7 の後に、量化する集合（端末の記録の読み手・書き手の全ファイル、送信の全経路）を列挙して書く。

## 禁止事項 / scope 外
- B-S7 の契約より先に web の request の形を決めない。backend を変えない。主体離脱の後始末の手順（W-S5）を変えない。仕様にない業務条件を足さない。

## 規模・返却事項
返却: 共有仕様 §6.2・§6.4 の web の保留の解除、既存 Spec §3.1 の target 節を現状記述へ。

## 参照
新 Spec §5.1・§8.2（W-T14 行）・§9、既存 Spec §3.1、ADR-109 決定 7〜14、共有仕様 §6.2・§6.4、backend `docs/plan/2026-09-16-design-review-refactor/B-S7-position-recorded-at.md`。
