/**
 * review指摘2: ログアウト時、SW（public/sw.js）が管理する shell-pages / api キャッシュも
 * 消さないと、共有端末でユーザー A のキャッシュ（ユーザー固有の Podcast 一覧や閲覧済み
 * ページ HTML）がユーザー B に残留してしまう。
 *
 * WHY prefix match rather than importing public/sw.js's cache name constants: sw.js は
 * `navigator.serviceWorker.register('/sw.js')` で登録されるクラシックスクリプトであり
 * import/export を持てない（public/sw.js のコメント参照）。そのため 'shell-' / 'api-' という
 * prefix 文字列をこちらに複製している。sw.js 側の isManagedBySW() と対になっているので、
 * 命名規則を変える場合は両方を揃えて更新すること。
 *
 * WHY prefix match rather than a fixed cache name: SW_VERSION を上げるとキャッシュ名が
 * 変わる（例: shell-pages-v1 → shell-pages-v2）。ログアウト処理側に SW_VERSION の値を
 * 持たせずに追随できるよう、バージョン非依存の prefix マッチにしている。
 */
export async function clearManagedServiceWorkerCaches(): Promise<void> {
  if (typeof caches === 'undefined') return
  const names = await caches.keys()
  await Promise.all(
    names
      .filter((name) => name.startsWith('shell-') || name.startsWith('api-'))
      .map((name) => caches.delete(name)),
  )
}
