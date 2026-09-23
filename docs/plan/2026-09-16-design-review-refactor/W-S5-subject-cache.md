## web リファクタ W-S5: 主体別音声キャッシュ `audio-v1-{user_id}` と起動時の回収（SL-06 / SL-07 の web 保留解除）

## 概要
音声キャッシュを主体（backend の `user_id`）ごとの Cache 名 `audio-v1-{user_id}` に分け、起動時に現在の主体以外を回収し、主体離脱時に主体依存の端末設定 3 key を消す。[ADR-104](../../../../docs/adr/104-subject-departure-and-subject-scoped-assets.md) 決定 2・3・6・7・8・9・15・27 と 2026-09-23 補足（SG-A1・SG-A2・SG-A6）を web に**適用する slice**で、新たな設計判断を含まない。正本は共有仕様 `docs/design/shared-playback-spec.md` §4.4（SL-01〜SL-07）・§6.3（性質 1〜5・Web 行）・§6.5（遷移①②④・分類表）、親 docs web-design §3 target・§12.2「離脱時の消去」「主体依存の端末設定」「logout の提示」・§12.5 W-S5 行。Implementation Spec §3.3 の「`audio-v1` は明示 logout のみ消す（失効時は残す）」は ADR-104 決定 27 で撤回済みであり**採らない**。**検証モード: 再設計しない**。新しい契約 ID は作らない（準拠テストは共有仕様の行 ID）。

## 着手前に決める項目
**無し。** 起票時の U-W5-1（起動時の認証解決が未確定に終わった後の login / register / passkey 成功を「主体の確定」に含めるか）は 2026-09-23 夜の user 決定 **SG-C13 = (A) 含める** で確定した（共有仕様 §6.3 性質 2「`authenticated` / 未認証に確定した時点で同じ回収を 1 回走らせる」の文言どおり。3 platform 共通）。

**主体の確定の契機（全数 5 つ。これ以外に無い）**
| # | 契機 | 回収 `reclaimAudioCaches` の引数 | 備考 |
|---|---|---|---|
| 1 | 起動時 `getMe` 成功 | `user.user_id`（欠落・形式不正なら `null`） | 通常経路 |
| 2 | 起動時 `getMe` の 401 | `null` | 未認証に確定 |
| 3 | 起動時未確定（通信断・5xx・decode 失敗）の後の `login` 成功 | `res.user.user_id` | SG-C13 |
| 4 | 同、`register` 成功 | 同上 | SG-C13 |
| 5 | 同、`loginWithPasskey` 成功 | 同上 | SG-C13 |

起動時回収は **起動（`AuthProvider` の mount）につき、最初に到達した契機で 1 回だけ** 走る。契機 1 / 2 で確定済みの後の login / register / passkey 成功は起動時回収を再度走らせない（そのとき走るのは遷移④の `subjectCleanup(A)` だけで、直前の主体 A が無ければ何もしない）。通信断・5xx・decode 失敗は未確定であり、契機 3〜5 のいずれかが来るまで回収は走らない。

## 前提・着手条件
- **backend 契約が main にあること**（PR 番号ではなく契約で判定）: backend B-S5 の PR が merge 済みで親リポの `backend` ポインタが進んでおり、`GET /auth/me`・`PATCH /auth/me`・`POST /auth/login`・`POST /auth/register`・`POST /auth/passkey/login/verify` の 5 経路の応答 JSON に `user_id`（`^[A-Za-z0-9_-]+$`）がある（backend `api/schemas.py` の `AuthenticatedUserResponse` と `tests/test_api_auth_user_id.py` を親 main の backend submodule で確認。B-S5 order 完了条件 5）。`GET /admin/users` には無い（決定 15）。**未 merge なら着手しない。** フィールド名は `user_id`（ADR-104 決定 6・15、親 docs backend-design §14.2）で、これ以外の名前・形式を推測で決めない。応答の型は着手時に backend の schema から写す。
- **依存 slice: W-S2c の web PR が main に merge 済み、かつ親リポ `news-listen` の submodule ポインタが進んでいる**（親で `git submodule status` の `web` 行に `+` が無い）こと（`lib/playback/{session,coordinator,offlineLibrary}.ts`・`contexts/PlaybackProvider.tsx` が存在し旧再生実装が無いこと。SL-01 / SL-07 の「再生停止・Queue 空・`nowPlaying` なし」を本 slice が担うため。user 判断 2026-09-23）。
- W-S4b（`PreferencesRegistry`）・W-S4c（`AuthSession` / `AuthProvider.tsx`）・W-S4d（gateway 化）との順序は不定。着手時点の状態で対象ファイルが変わる（下表）。両方の状態を order に書いてあり、どちらでも完了条件は同じ。音声キャッシュ実装は `lib/playback/offlineLibrary.ts`（W-S2c 後で確定）。W-S3 とは対象ファイルが重ならず並行可。
  | 条件 | 認証 Provider | 主体依存 key の宣言元 | 既定速度のメモリ上の置き場 |
  |---|---|---|---|
  | W-S4c 前 / 後 | `contexts/AuthContext.tsx`（`AuthStatus` 3 値。`refreshMe` 内で 401 とそれ以外を分ける）/ `contexts/AuthProvider.tsx`（`AuthSession` 4 状態。`unavailable` が「未確定」） | — | — |
  | W-S4b 前 / 後 | — | `lib/account/subjectCleanup.ts` 内の定数 3 key / `PreferencesRegistry` の `subjectScoped: true` 宣言（SG-A6） | `AppContext` の `SET_SPEED` で 1.0 へ / registry の `default` へ |
- baseline green: `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build`、e2e `offline-playback`。
- 確定値（Selection Gate・ADR-104 補足）: **SG-C13** 主体確定の契機は冒頭の 5 つ（未確定後の login / register / passkey 成功を含む）。**SG-A1** 旧 `audio-v1` は初回起動で全削除・移行なし。**SG-A2** logout の提示は httpOnly cookie（決定 14 の明示ヘッダは web に適用しない）。**SG-A6** 主体離脱で消す key は分類表の「主体依存」だけ。**SG-X3（ADR-104 改訂）** 後始末の完了を待たない。
- 棄却済み案（再提案しない）: 離脱時の音声キャッシュ全削除（ADR-104「採らなかった案」）、cleanup 完了を待ってから未認証へ遷移（SG-X3 (b)）、SW への削除一元化（web-design §12.2）、主体付き key 不採用（2026-09-16 の決定は撤回済み）。
- `docs/trial-log/` と親 `docs/trial-log/order-acceptance-inspection-finds-design-defects.md` を最初に読む。

## 対象（web サブモジュールのみ）
**変更（型・契約）**
1. `types/index.ts`: `AuthUser`（`:152`。`/auth/me`・login 応答）に `user_id` を加える。admin 一覧（`UserListResponse.users`）は `user_id` を持たない別型に分ける（決定 15「型を分ける」）。
**新規**
2. `lib/account/subjectCleanup.ts`（共有仕様 §6.8 の `SubjectCleanup`）: 離脱主体 `user_id` を受け、次を**独立に試み**（1 つが失敗しても残りを実行）、失敗した手順名を `CleanupIncomplete` として返す（§6.3 性質 5・SL-04）。4 手順はいずれも**関数注入**で受け（`lib/account` は `lib/playback`・`lib/swCacheCleanup`・`caches`・`localStorage` を import しない。組み立ては認証 Provider）、手順 = (a) `audio-v1-{user_id}` の削除、(d) 再生停止（対象 4b の `stopForSubjectLeave()`）、(b) `shell-*` / `api-*` の削除（既存 `clearManagedServiceWorkerCaches`）、(c) 主体依存 key の削除: `seen_achievement_ids`・`default_playback_speed`（`KEY_DEFAULT_PLAYBACK_SPEED`）・prefix `podcast_position:`（`KEY_PODCAST_POSITION_PREFIX`。共有仕様の `podcast_position_*` 表記はこの prefix を指す）の全 key。`theme` / `time_format` / `sfx_enabled` / `player_volume` は消さない。(c) の後、メモリ上の既定速度も既定値 1.0 へ戻す（分類表の理由「次の主体の再生が前主体の速度で始まる」を満たすため。W-S4b 前は `AppContext` の `SET_SPEED`、後は registry の `default`）。
3. 音声キャッシュ実装（上表）に (i) Cache 名の導出 `audio-v1-{user_id}`（`user_id` は引数で受ける。`lib/playback` は認証 context を import しない）、(ii) **回収** `reclaimAudioCaches(currentUserId | null)`: `caches.keys()` のうち名前が `audio-v1` と完全一致、または `audio-v1-` で始まり `currentUserId` に一致しないものを削除（`null` なら `audio-v1*` を全削除。決定 7・8。完全一致 `audio-v1` の削除は「初回起動での旧キャッシュ全削除」に相当し、2 回目以降は存在しないので冪等）、(iii) ダウンロード（`save` / `downloadAudio`）は**開始時に Cache 名を固定**し、離脱後に完了した書き込みも開始時の主体の Cache に入る（決定 9・SL-06）。`user_id` が無い（未認証・解決前）、または **認証済みでも `user_id` が欠落・形式 `[A-Za-z0-9_-]+` を満たさない**とき（user 判断 Q13=A、2026-09-23。ADR-104 決定 16 と同型）、キャッシュを無効にする: 読み出しは「未キャッシュ」、書き込みは行わず、回収は未認証と同じ `reclaimAudioCaches(null)`（全削除）。
**変更（配線）**
4. 認証 Provider（上表）: 回収 `reclaimAudioCaches` の発火は **主体が確定した時点で 1 回**に限る（user 判断 Q10=A、2026-09-23）。確定の契機は冒頭の表の **5 つ**（`getMe` 成功 / `getMe` 401 / 起動時未確定後の `login` 成功 / `register` 成功 / `loginWithPasskey` 成功。SG-C13）で、引数は表のとおり。起動につき最初の契機で 1 回だけ走らせ、確定済み後の契機 3〜5 では走らせない。通信断・5xx・decode 失敗は主体未確定とし回収を呼ばない（現行 `AuthContext` はこれらも `unauthenticated` へ落とすため、`refreshMe` 内で 401 とそれ以外を分けて判定する。W-S4c の `AuthSession.unavailable` 導入後はその状態が「未確定」に対応する）。未確定のまま再試行して後で確定したときにその 1 回を走らせる。SL-03・§6.5 除外⑤。e2e `offline-playback` で pin。`tests/contexts/AuthContext*.test.tsx` で pin する場面: (i) `getMe` 成功 → 1 回、(ii) 401 → 1 回、(iii) 通信断 → 0 回、その後 `login` 成功 → 1 回（`register` / passkey も同型で各 1 場面）、(iv) 401 → `login` 成功 → 合計 1 回。遷移① `logout` で `subjectCleanup(A)` を (a)(b)(c)(d) すべて呼ぶ。遷移② `refreshMe` の 401 では (b)(c)(d) だけ呼び、(a) は行わない（SL-02・決定 27「失効時は残してよい」の確定値。音声は同じ 401 で走る `reclaimAudioCaches(null)` が消す）。遷移④ `login` / `register` / `loginWithPasskey` の成功時に直前の主体 A が存在し `user_id` が異なれば `subjectCleanup(A)` を呼ぶ（SL-07）。**いずれも await せず**、B の確立（状態遷移）を先に行う（決定 1）。logout の backend 呼出は現行どおり cookie 提示のみ（SG-A2）。
4b. `contexts/PlaybackProvider.tsx` / `lib/playback/coordinator.ts`: 主体離脱時の再生停止 `stopForSubjectLeave()` を Coordinator の公開操作に加える（共有仕様 §6.8 web 行「再生停止（離脱時）＝セッション停止」の translation。Spec の語で: session を `idle` へ、Queue を `emptyQueue`、`nowPlaying()` は `null`。§6.5 web 列「セッション停止・Queue 空」）。**位置同期は送らない**: 離脱時の停止は §6.5 の順序（トークン破棄 → 次の主体の確立 → 後始末）の後始末で走るため、ここで `updatePosition` を送ると A のトークンは既に無く（①②）、④では B の cookie で A の位置を書く交差になる。`PositionReporter` を先に detach してから session を `idle` へ遷移し、`stateChanged` による即時送信も起きないようにする（2026-09-23 点検: 起票時の「停止前に位置同期を 1 回送る」は Android 列 `stopForSubjectLeave()（位置同期 1 回 → 停止）` の写し間違いで、web 列には無い）。`subjectCleanup(A)` の手順 (d) としてこれを遷移①②④の全てで呼ぶ（SL-01 / SL-07 の「再生停止・キュー空・`nowPlaying` なし」。user 判断 2026-09-23）。`lib/playback` は認証 context を import しない（呼ぶのは認証 Provider）。
5. `contexts/AuthContext.tsx` の logout にある `deleteAllAudio()` / `OfflineLibrary.clear()` 呼出を 2 の (a) へ置き換える（`lib/audioCache.ts` は W-S2c で削除済みのため `OfflineLibrary.clear()` のみが対象）（端末単位の全削除を残さない: §6.3 性質 1）。
6. `app/(app)/settings/page.tsx` のオフライン一覧・削除・使用量は現在主体の Cache を対象にする（引数で `user_id` を渡す）。
**テスト（新規／変更）**: `tests/lib/account/subjectCleanup.test.ts`（SL-01・SL-02・SL-04・SL-06・SL-07。再生停止は Coordinator double で `nowPlaying()` null を観測）、`tests/lib/playback/coordinator.test.ts`（`stopForSubjectLeave` の事後条件）、音声キャッシュ実装のテスト（Cache 名・回収・開始時固定）、`tests/contexts/AuthContext*.test.tsx`（起動時回収の 401 / 通信断の分岐・遷移④）。テスト名に行 ID を含める（共有仕様 §5）。

## 完了条件
- `npm test` / `npm run lint` / `npm run typecheck` / `npm run typecheck:ts7` / `npm run build` 成功。e2e `offline-playback` green（変更してよいのは `e2e/offline-playback.e2e.ts` 内の `page.route('**/api/backend/auth/me')`・`auth/login` の stub 応答に `user_id` を加える箇所だけ。他の e2e 3 本の同じ stub にも `user_id` を加えてよいが assertion は変えない。`e2e/fixtures/` は音声ファイルだけで stub は無い）。
- SL-01・SL-02・SL-04・SL-06・SL-07 が行 ID 付きで green（SL-01 / SL-07 は音声キャッシュ・端末設定・再生停止の全事後条件）。回収が起動につき最初の確定契機（5 つのいずれか）で 1 回だけ走り、通信断では走らず、未確定後の `login` / `register` / passkey 成功で 1 回走ることをテストで pin（対象 4 の場面 (i)〜(iv)）。SL-06: 離脱後に完了した書き込みが A の Cache に入り、次回起動の回収後に `audio-v1-A` が存在しない。SL-07: B の確立が A の後始末を待たず、`audio-v1-B` は触られない。**遷移④で B の確立後に A のエピソードの `updatePosition` / `markCompleted` が gateway double に 1 回も来ない**（交差の pin。対象 4b）。
- **`audio-v1` 固定名の参照 0 件**: `grep -rn "'audio-v1'" app components hooks contexts lib` が 0 件（除外: 回収関数内の完全一致判定 1 箇所と `public/sw.js` のコメント）。
- **端末単位の全削除 0 件**: `grep -rn "deleteAllAudio\|\.clear()" app components hooks contexts lib` の全出現を PR 説明に列挙し、各出現が主体付き（`user_id` を引数に取るか、主体で開いた保存庫のメソッド）であること。例外は回収関数の `null` 経路 1 箇所のみ。
- 主体依存 key の削除対象が上の 3 種と一致し、`theme` / `time_format` / `sfx_enabled` / `player_volume` が logout 後も残る（テストで pin）。
- `public/sw.js` と `lib/swCacheCleanup.ts` は無変更（T-T18 が green のまま）。`AuthUser` 以外の backend 契約を変えない。

## 禁止事項 / scope 外
- `user_id` のフィールド名・形式を web で決めない（形式検査は決定 6 の `[A-Za-z0-9_-]+` に限る）。`username` を Cache 名のキーに使わない。
- logout に明示ヘッダを足さない（SG-A2）。cleanup 完了を await してから未認証へ遷移しない（SG-X3）。
- 主体未確定（通信断・5xx・decode 失敗）で回収・cleanup を走らせない（SL-03・Q10=A）。起動時回収を起動につき 2 回以上走らせない。確定の契機を冒頭の 5 つ以外に足さない（SG-C13）。
- `AuthSession` union（W-S4c）・任意 API の 401 検知点の一般化（W-S4d）・`PreferencesRegistry`（W-S4b）は本 slice で作らない（本 slice は既存の検知点 `refreshMe` だけを使う）。
- backend・ios・android のコードを変更しない。仕様にない業務条件を足さない。

## 特性テスト（baseline）
`tests/contexts/AuthContext.{test,expiry,passkey}.test.tsx`、`tests/contexts/PlaybackProvider.{queue,offline,completion}.test.tsx`、`tests/lib/playback/*.test.ts`、`tests/lib/swCacheCleanup.test.ts`、`tests/public/sw.test.ts`、`tests/app/settings/page.test.tsx`、e2e `offline-playback`。

## 検証
`npm test`（行 ID 付きテスト 5 行が green・回収 1 回の pin）、上記 grep 2 種、`npm run test:e2e -- offline-playback`、`npm run build`。

## 記録
- 完了時、共有仕様 §4.4 SL-01 / SL-02 の web 注記と SL-06 / SL-07 の web 保留を解除できる旨、§6.3 Web 行を「実装済み」へ更新する旨を親 docs へ返す（解除条件 = W-S5 完了。web-design §12.5）。
- Cache 名前空間の変更は不可逆点（web-design §12.5 末尾）。デプロイ日と旧 `audio-v1` の削除が動いたことを PR 説明に残す。棄却・方針転換は `docs/trial-log/` へ。
