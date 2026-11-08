// Notifications の command: web-cmd-notify-01〜04。再送・解除の条件は pushRegistration.ts が持つ（web-rule-notify-01）。
import { createPushRegistration } from '@/lib/notifications/application/pushRegistration'
import type { PushSubscribeResult, PushUnsubscribeResult } from '@/lib/notifications/application/pushRegistration'
import type { NotificationsGateway, PushBrowserPort } from '@/lib/notifications/application/ports'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

export interface NotificationsCommands {
  subscribe(): Promise<PushSubscribeResult>
  unsubscribe(): Promise<PushUnsubscribeResult>
  reregister(): Promise<void>
  detachFromSubject(): Promise<Result<void, ApiFailure>>
}

export function createNotificationsCommands({
  gateway,
  browser,
}: {
  readonly gateway: NotificationsGateway
  readonly browser: PushBrowserPort
}): NotificationsCommands {
  const registration = createPushRegistration({ port: browser, client: gateway })
  return {
    subscribe: () => registration.subscribe(),
    unsubscribe: () => registration.unsubscribe(),
    reregister: () => registration.reregister(),
    detachFromSubject: () => registration.detachFromSubject(),
  }
}
