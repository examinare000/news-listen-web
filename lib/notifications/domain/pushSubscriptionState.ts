/** Web Push 購読状態機械 */
export type PushSubscriptionState =
  | 'unsupported' // serviceWorker/PushManager 非対応
  | 'denied' // Notification.permission === 'denied'
  | 'unsubscribed' // 購読なし
  | 'subscribing' // 購読処理中
  | 'subscribed' // 購読済み
  | 'error' // エラー発生
