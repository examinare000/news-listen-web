# 70. TypeScript バージョンポリシー（暫定併用構成）

## 概要
web モジュールは、TypeScript v6 と v7 の併用構成を採用しています。これは typescript-eslint の v7 対応待機期間の暫定措置です。

## 構成の理由

### root `typescript` は v6.0.3 で固定
- **root の `typescript`** は `^6.0.3` に固定しており、v7 にアップグレードしていません。
- これは typescript-eslint@8.65 系の peerDependencies が `>=4.8.4 <6.1.0` までしか許容しないためです。
- TypeScript v7 をロードさせると `ts-api-utils` が TS 内部 API の形状差異で実行時クラッシュします。
- npm `overrides` によるサブツリー限定固定は、peerDependency のみの関係では物理的なネストインストールを作れないため不可能です（確認済み）。

### TypeScript v7 試験用エイリアス
- TS7 を試すための別名依存 `typescript7`（`npm:typescript@7.0.2`）を `package.json` に並置しています。
- `npm run typecheck:ts7` スクリプトで直接パス呼び出し（`node node_modules/typescript7/bin/tsc`）して動作確認します。
- `node_modules/.bin/tsc` は TS6 側にのみリンクされます。

## 撤去条件
typescript-eslint が TypeScript v7 に対応した時点で、次の手順で撤去します：
1. root の `typescript` を `^7.x` へアップグレード
2. `typescript7` エイリアスと `typecheck:ts7` スクリプトを削除
3. このルール文書も廃止予定（Issue #92 参照）

## 禁止事項
- **root `typescript` を v7 系にアップグレードしない** — typescript-eslint 対応待機中
- **`--legacy-peer-deps` / `--force` での ERESOLVE 回避禁止** — 回避は依存関係の実質的ミスマッチを隠蔽し、後で不具合を誘発
- **Dependabot の TypeScript メジャーバンプ PR はマージしない** — Issue #92 追跡中。このポリシーが撤去されるまでは自動スキップが望ましい

## 参考資料
- 経緯の詳細: [`docs/trial-log/typescript7-eslint-coexistence.md`](../docs/trial-log/typescript7-eslint-coexistence.md)

---
**適用優先度**: 🟠 高
