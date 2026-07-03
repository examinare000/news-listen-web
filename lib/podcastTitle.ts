// title フィールドが追加された Podcast のタイトル表示ロジック。
// title があればそれを、なければ japanese_intro_text の先頭 maxLen 文字を返す。
// WHY: タイトル表示箇所が複数あるため、重複ロジックをここに集約する。

/** podcastTitle が受け取る最小構造 */
export interface PodcastForTitle {
  title?: string
  japanese_intro_text: string
}

/**
 * ポッドキャストの表示タイトルを返す。
 * - p.title が truthy（空白除去後に非空）ならそれを返す。
 * - それ以外は p.japanese_intro_text の先頭 maxLen 文字を返す。
 */
export function podcastTitle(p: PodcastForTitle, maxLen: number): string {
  const trimmed = p.title?.trim()
  if (trimmed) return trimmed
  // Math.max(0, maxLen): 負値を渡すと slice が末尾からのスライスになるため 0 以上に固定する
  return p.japanese_intro_text.slice(0, Math.max(0, maxLen))
}
