// 自分自身の行へのロール変更・削除を許さない UI の guard（web-rule-admin-01）。正本は backend（product-feat-35）。
// 判定は username の完全一致だけで、ロールは見ない。

type Named = { readonly username: string }

function isOtherUser(actor: Named | null, target: Named): boolean {
  return actor === null || actor.username !== target.username
}

export function canChangeRole(actor: Named | null, target: Named): boolean {
  return isOtherUser(actor, target)
}

export function canDelete(actor: Named | null, target: Named): boolean {
  return isOtherUser(actor, target)
}
