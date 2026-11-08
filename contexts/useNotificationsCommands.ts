'use client'

import { useMemo } from 'react'
import { useApiClient } from '@/contexts/ApiClientProvider'
import { createNotificationsCommands, type NotificationsCommands } from '@/lib/notifications/application/commands'
import { createNotificationsGateway } from '@/lib/notifications/infrastructure/notificationsGateway'
import { createRealPushBrowserPort } from '@/lib/platform/pushBrowser'

/** composition root: useApiClient() の gateway から NotificationsCommands を組み立てる（gateway が同じ間は同じ object）。 */
export function useNotificationsCommands(): NotificationsCommands {
  const gateway = useApiClient()
  return useMemo(
    () => createNotificationsCommands({ gateway: createNotificationsGateway(gateway), browser: createRealPushBrowserPort() }),
    [gateway],
  )
}
