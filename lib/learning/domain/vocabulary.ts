// Learning domain の vocabulary: 語が登録済みかの判定（web-rule-learning-04・product-learn-05・product-learn-18）。
// 完全一致で判定し、大文字小文字・空白を変換しない。

export function isRegistered(term: string, registered: ReadonlySet<string>): boolean {
  return registered.has(term)
}
