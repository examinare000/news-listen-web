'use client'

import { ErrorFallback } from '@/components/ErrorFallback'

// WHY this file exists (a segment-scoped boundary, not just relying on the root app/error.tsx):
// Next.js の error.tsx は自セグメントの children だけを覆い、同セグメントの layout.tsx 自身は
// バウンダリの外側に残る（エラー時もマウントされ続ける）。リファクタ前は NavigationBar /
// AudioPlayerBar をルート layout 自身が描画していた（children ではない）ため、配下ページの
// 描画エラーはルートの error.tsx に捕まってもシェルを巻き込まなかった。シェルを
// app/(app)/layout.tsx へ移した今、この error.tsx が無いと (app) 配下ページの描画エラーは
// この layout を素通りしてルートの error.tsx まで伝播し、(app)/layout.tsx ごと（＝シェルごと）
// アンマウントされてしまう。ここで捕まえることでシェルの継続描画という既存挙動を保つ
// （e2e/offline-playback.e2e.ts で実ブラウザ挙動として検証済み）。
export default function AppGroupError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorFallback error={error} reset={reset} />
}
