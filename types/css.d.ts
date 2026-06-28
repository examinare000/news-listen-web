// TypeScript 6 では CSS の副作用 import（`import './globals.css'`）に型宣言が必須となり、
// 宣言が無いと TS2882 で落ちる。Next.js が CSS バンドルを処理するため型情報は不要なので、
// 空のアンビエントモジュール宣言で副作用 import を許可する。
declare module '*.css';
declare module '*.scss';
declare module '*.sass';
