import next from "@next/eslint-plugin-next";
import eslintReact from "@eslint-react/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: [".next/**", "next-env.d.ts"] },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      ...tseslint.configs.recommendedTypeChecked,
      eslintReact.configs["recommended-type-checked"],
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: { "@next/next": next, "react-hooks": reactHooks },
    rules: {
      ...next.configs.recommended.rules,
      ...next.configs["core-web-vitals"].rules,
      ...reactHooks.configs.flat.recommended.rules,

      // --- 型認識ルールの severity 調整 ---
      // 旧 config (next/typescript) は型認識ルールを一切含まなかったため、
      // recommendedTypeChecked 導入で既存コード全体に対する指摘が大量に発生する。
      // 本 PR は「ESLint 10 移行で lint を green に戻す」ことが目的のため、
      // 既存パターンに広く該当するノイズの大きいルールは warn に下げて可視化のみ残し、
      // 個別のコード修正は follow-up とする（blanket disable はしない）。

      // React の onClick/onChange 等へ async ハンドラを渡す慣用パターンが多数該当する。
      // JSX 属性チェックのみ無効化し、条件式など実害ある誤用はエラーのまま維持する。
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],

      // useEffect / イベントハンドラ / e2e での意図的な fire-and-forget が多数。
      // 挙動を変えずに `void` を明示する作業は本マイグレーション範囲外。
      "@typescript-eslint/no-floating-promises": "warn",

      // 非同期インターフェース/ポート実装・テストモックは await を持たないのが正当。
      "@typescript-eslint/require-await": "warn",

      // response.json() / JSON.parse() 等の外部由来 any・テストモックに広く該当する。
      // レスポンス型付けは follow-up。
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",

      // react-hooks 7 で新規追加されたルール。既存の effect 駆動 state 同期が多数該当する。
      "react-hooks/set-state-in-effect": "warn",

      // JSX style 内の IIFE 等を静的解析できないことによる制約。挙動上の問題はない。
      "@eslint-react/unsupported-syntax": "warn",

      // 依存配列チェックは react-hooks/exhaustive-deps を正本とし、
      // 既存の `// eslint-disable react-hooks/exhaustive-deps` コメントと整合させる。
      // eslint-react 側の重複ルールは二重報告になるため無効化する。
      "@eslint-react/exhaustive-deps": "off",
    },
  },
  // JS/設定ファイルは tsconfig の型情報対象外のため型認識ルールを無効化する。
  {
    files: ["**/*.{js,mjs,cjs}"],
    extends: [tseslint.configs.disableTypeChecked],
  },
);
