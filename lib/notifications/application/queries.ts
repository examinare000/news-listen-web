// Notifications の query（読み取りだけ）: web-query-notify-01。購読・再送・解除はしない。
import { createPushRegistration } from '@/lib/notifications/application/pushRegistration'
import type { NotificationsGateway, PushBrowserPort } from '@/lib/notifications/application/ports'
import { toPushSubscriptionView } from '@/lib/notifications/application/readModels'
import type { PushResolveResult, PushSubscriptionView } from '@/lib/notifications/application/readModels'

export interface NotificationsQueries {
  resolve(): Promise<PushResolveResult>
  subscription(): Promise<PushSubscriptionView>
}

export function createNotificationsQueries({
  gateway,
  browser,
}: {
  readonly gateway: NotificationsGateway
  readonly browser: PushBrowserPort
}): NotificationsQueries {
  const registration = createPushRegistration({ port: browser, client: gateway })
  return {
    resolve: () => registration.resolve(),
    subscription: async () => toPushSubscriptionView(await registration.resolve()),
  }
}
