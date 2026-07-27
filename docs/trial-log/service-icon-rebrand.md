# service-icon-rebrand: サービスアイコン刷新（Web側）

## 目的
仮アイコン（ティール波形）とAudioNews表記を、新デザイン（新聞＋音声波形）とNewsListen表記に統一する。親タスク: iOS/Web/docs 3リポジトリ横断のアイコン刷新。

## 試行と判断の記録

### 2026-07-27 資産の色調整
- 元デザイン（背景 #0F2549）をWebトーンに馴染ませるため、背景のみ #0B0A0E へ色距離ソフトマスクで再着色。波形グラデは無変更（橙系が既存アンバーアクセントと調和するため）
- maskable はフルブリードだとセーフ円（r=0.4S）を6.1%逸脱 → コンテンツ0.73倍縮小＋パディングに変更し逸脱0%を実測確認
- favicon 16px はアートワークが判読不能 → **16pxのみ波形バー簡略版**にフォールバック（32/48pxはアートワーク維持）。ICO は Pillow の append_images で3サイズ混載

### 2026-07-27 PWAアイコン更新の発火
- ファイル名を変えず manifest の icons.src に `?v=2` を付与（既インストールWebAPKは manifest 内容差分でのみアイコン更新されるため）
- `metadata.icons` はクエリなしのまま → 同一ファイルに2つのURL表現が併存するのは**意図的**（キャッシュ二重化は許容）
- 既存テスト tests/public/manifest.test.ts は src をそのまま existsSync するためクエリで確実に落ちる → `split('?')[0]` でクエリ除去してから検査するよう追随

### 2026-07-27 metadataBase
- 未設定だと Vercel 上の og:image がデプロイ固有URLになるため `https://www.news-listen.com`（docs/operations の canonical 記載に一致）を明示。**ローカル curl では localhost 基底で偽合格になる**ため、OG検証は Vercel プレビュー/本番URLで行うこと

### 棄却した案
- ページ内ロゴを新アイコンのラスター画像埋め込みにする案 → 既存 `.logo-icon`（アンバー角丸＋currentColorグリフ）の意匠を保ちテーマ追従できるインラインSVG簡略グリフを採用
- icon-192/512 への角丸焼き込み → `purpose:any` でプラットフォームマスクと二重角丸になるため不透明フルブリード維持

## 残タスク / 注意
- OG画像の絶対URL検証は Vercel プレビューで実施予定だったが、**プレビューは認証保護(302)のため本番デプロイ後の確認に変更**（ローカル実測では metadataBase により絶対URL解決を確認済み）
- **インストール表示（PWAスプラッシュ等）の目視は本番デプロイ後の実インストールで実施**（計画からの逸脱として記録。any アイコンはユーザー承認済みのフルブリード原画そのものであり、マスク適用面は maskable がセーフ円逸脱0%で担保）
- Android ネイティブのランチャーアイコンは別issue（本ブランチのスコープ外）

---

## 2026-07-27 実装完了（implementation-coder）

### 実装内容
以下の指示書に完全に従い、サービスアイコン刷新とサービス名統一（"AudioNews" → "NewsListen"）を実装しました。

#### A. 資産配置（public/）
スクラッチパッド /private/tmp/...scratchpad/assets/ から以下6ファイルを配置:
- icon-192.png, icon-512.png, icon-512-maskable.png（上書き）
- apple-touch-icon.png, favicon.ico, og-image.png（新規追加）

#### B. manifest.json
- `name`: "News Listen" → "NewsListen"
- icons[*].src: `/icon-192.png` → `/icon-192.png?v=2` など（クエリ付与で既インストール PWA キャッシュ更新発火）

#### C. public/sw.js
- L93 既定通知タイトル: 'News Listen' → 'NewsListen'
- 他は変更なし（L111-112 の icon/badge はファイル名不変）

#### D. app/layout.tsx metadata 拡張
```ts
export const metadata: Metadata = {
  metadataBase: new URL('https://www.news-listen.com'),
  title: 'NewsListen',
  description: 'English learning podcast app',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: '48x48' },
      { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
    ],
    apple: '/apple-touch-icon.png',
  },
  openGraph: {
    title: 'NewsListen',
    siteName: 'NewsListen',
    type: 'website',
    url: '/',
    images: [{ url: '/og-image.png', width: 1200, height: 630 }],
  },
  twitter: { card: 'summary_large_image' },
}
```
（metadata.icons は ?v=2 なし、manifest 側は付与 — 意図的差）

#### E. 共通ロゴコンポーネント BrandLogo.tsx（新規）
- Props: `wrapperClassName?: string`（既定 'logo-mark', モーダルは 'modal-logo'）
- グリフ: 新聞＋波形バー SVG（stroke="currentColor" で .logo-icon svg { color: var(--bg-base) } が効く）
- ワードマーク: `News<span>Listen</span>`（スペースなし、span がアンバー着色）

#### F. ロゴ4箇所を BrandLogo に置換
- NavigationBar.tsx L124-146: `.sidebar-logo` 内 `.logo-mark` ブロック → `<BrandLogo />`
- LandingPage.tsx L48-68: `.logo-mark` ブロック → `<BrandLogo />`
- LoginModal.tsx L118-138: `.modal-logo` ブロック → `<BrandLogo wrapperClassName="modal-logo" />`
- signup/page.tsx L144-164: `.modal-logo` ブロック → `<BrandLogo wrapperClassName="modal-logo" />`

#### G. ブランド文字列統一（grep 全体確認済み）
- LandingPage.tsx L80 aria-label: "AudioNews の紹介" → "NewsListen の紹介"
- LandingPage.tsx L108 sr-only: "AudioNews の特徴" → "NewsListen の特徴"
- **AudioNews/Audio News 残存: 0件**

#### H. テスト追随（必須）
1. **tests/public/manifest.test.ts L58-59**
   - icon.src にクエリ ?v=2 が付くことで existsSync が失敗 → `.split('?')[0]` で除去してから検査
   ```ts
   const iconPath = join(publicDir, icon.src.replace(/^\//, '').split('?')[0])
   ```

2. **tests/public/sw.test.ts L251, L270**
   - デフォルト通知タイトル: 'News Listen' → 'NewsListen'

3. **tests/components/NavigationBar.test.tsx L165-170**
   - 旧テスト: `getByText('Audio')` / `getByText('News')` の部分一致（脆弱）
   - 新テスト: `.logo-text` textContent === 'NewsListen' + span === 'Listen' を確認
   ```ts
   const logoText = screen.getByRole('complementary').querySelector('.logo-text')
   expect(logoText?.textContent).toBe('NewsListen')
   const listenSpan = logoText?.querySelector('span')
   expect(listenSpan?.textContent).toBe('Listen')
   ```

### 検証結果

```
✅ npm test (vitest)
   Test Files: 76 passed (76)
   Tests: 1048 passed (1048)
   Duration: 34.58s

✅ npx tsc --noEmit
   (TS エラーなし)

✅ npm run lint
   - BrandLogo.tsx, NavigationBar.tsx, LandingPage.tsx: 新規 error なし
   - LoginModal.tsx, signup/page.tsx: 既存 warning（指定範囲外、修正不要）

✅ AudioNews 残存
   grep 結果: 0件
```

### 変更ファイル一覧（17ファイル）

**修正（13ファイル）**
- app/layout.tsx
- app/signup/page.tsx
- components/NavigationBar.tsx
- components/lp/LandingPage.tsx
- components/ui/LoginModal.tsx
- public/icon-192.png（上書き）
- public/icon-512.png（上書き）
- public/icon-512-maskable.png（上書き）
- public/manifest.json
- public/sw.js
- tests/components/NavigationBar.test.tsx
- tests/public/manifest.test.ts
- tests/public/sw.test.ts

**新規（4ファイル）**
- components/ui/BrandLogo.tsx
- public/apple-touch-icon.png
- public/favicon.ico
- public/og-image.png

### 試行と棄却
**なし**。指示書に完全に従い直線的に実装。設計判断は行わず、指示に忠実に実施。

### 不確実な点
- なし。全検証（テスト・型・lint）で要件を満たしていることを確認済み。

## 2026-07-27 コードレビュー対応（implementation-coder）

### 対応内容
1. **BrandLogo.tsx の単体テスト追加**: tests/components/BrandLogo.test.tsx を新規作成。デフォルトレンダリング・カスタムクラス指定・aria-hidden 属性を検証（5件パス）
2. **BrandLogo.tsx から 'use client' 削除**: hooks/イベント/ブラウザAPIなし＝純表示コンポーネントのためサーバーコンポーネント化可能
3. **NavigationBar.tsx コメント更新**: L11 の docs 参照行番号を L1388-1414 → L1392-1418 へ修正（docs 側の4行増加に追従）

### 検証
- npx vitest BrandLogo.test.tsx / NavigationBar.test.tsx: 30 passed
- npm test: 1053 passed (77 files)
- npx tsc --noEmit: clean
- npm run lint: 対象ファイルに新規エラーなし
