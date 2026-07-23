# typescript 7 と typescript-eslint の共存方式

日付: 2026-07-23（更新: 2026-07-23）

## 目的
Dependabot の typescript 7.0.2 バンプ（PR #68）を取り込みたいが、typescript-eslint@8.6x の
peerDependencies が `typescript >=4.8.4 <6.1.0` のため `npm ci` が ERESOLVE で失敗する。
lint を壊さずに TS7 への移行検証を進められる依存構成を確立する。

## 現在地
逆併用構成（root は `typescript@^6.0.3` 維持、`typescript7` エイリアスで TS7 を並置し
`typecheck:ts7` で検証）を採用し、PR #93 として提出。CI 全 green、マージは人間の判断待ち。
撤去条件は typescript-eslint の TS7 対応（agent-rules/70-typescript-version-policy.md 参照）。

## 試したことと結果
| 試したこと | 結果 |
|---|---|
| npm overrides で typescript-eslint サブツリーのみ typescript@6.0.3 に固定（`{"typescript-eslint": {"typescript": "6.0.3"}}` の1キー） | 棄却: install は warning で通るが `npm ls typescript` で @eslint-react 経由の別サブツリーが 7.0.2 のまま invalid |
| overrides に `@typescript-eslint/utils`・`typescript-estree`・`project-service`・`tsconfig-utils`・`type-utils` の個別5キーを追加 | 棄却: lockfile 上の物理 typescript コピーは 7.0.2 の1個のみ。ネストされた 6.0.3 は一度も生成されず |
| lockfile 削除して完全新規解決で再現性確認 | 棄却: キー構成により hard ERESOLVE か「warning のみで実体 7.0.2」に分岐するが、6.0.3 の物理ネストはどのパターンでも生成されず |
| overrides 構成のまま `npm run lint` を実行して実害確認 | 棄却確定: 警告ではなく `ts-api-utils` 内で TypeError クラッシュ（下記） |
| 逆併用構成（root TS6 維持 + `typescript7: npm:typescript@7.0.2` エイリアス + `typecheck:ts7` 直接パス呼び出し） | 採用: npm ci クリーン / lint・typecheck・test 1048件・build 全 green / TS7 型エラー0件（正本は PR #93 とコミットログ） |

## 棄却済み（再試行しないこと）
- **npm overrides による typescript のサブツリー限定固定**: `typescript` は typescript-eslint 系
  全パッケージで peerDependencies としてのみ宣言され、dependencies としての実体エッジが存在しない。
  npm の overrides は実体依存エッジのリダイレクト機構であり、peer 専用の関係には物理的なネストイン
  ストールを作らない（要求バージョン表記が書き換わり ERESOLVE 判定が変わるだけ）。再挑戦しうる条件:
  typescript-eslint 側が typescript を optional dependencies 等の実体エッジで持つようになった場合のみ。
- **typescript@7 を typescript-eslint にロードさせる回避全般**: peer 制約を黙らせても
  `ts-api-utils/lib/index.cjs:787` で `TypeError: Cannot read properties of undefined (reading 'Intrinsic')`
  により即クラッシュ（TS 内部 API の形状差異）。バージョン警告レベルではなく実行不能。

## 判明した事実
- typescript-eslint@8.63〜8.65 の peer 上限は `<6.1.0`（PR #68 の CI 失敗ログで確認）。
- `.bin/tsc` は real の `typescript`（6.0.3）側にのみリンクされ、`npm:` エイリアス側には bin リンクが
  作られなかった。ただし npm バージョン依存の可能性を排除できないため（推測）、`typecheck:ts7` は
  `.bin` に依存しない直接パス呼び出し（`node node_modules/typescript7/bin/tsc`）とした。
- 現行コードベースは TS7 の型チェック（1041ファイル）でエラー0件。移行自体の障壁は typescript-eslint のみ。

## 残タスク
- typescript-eslint の TS7 対応リリースを追跡し、対応後に root を `^7.x` へ上げてエイリアスと
  `typecheck:ts7` を撤去する（追跡: news-listen-web Issue #92）。
