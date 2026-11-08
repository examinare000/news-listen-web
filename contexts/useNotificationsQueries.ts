'use client'

import { useMemo } from 'react'
import { useApiClient } from '@/contexts/ApiClientProvider'
import { createNotificationsQueries, type NotificationsQueries } from '@/lib/notifications/application/queries'
import { createNotificationsGateway } from '@/lib/notifications/infrastructure/notificationsGateway'
import { createRealPushBrowserPort } from '@/lib/platform/pushBrowser'

/** composition root: useApiClient() の gateway から NotificationsQueries を組み立てる（gateway が同じ間は同じ object）。 */
export function useNotificationsQueries(): NotificationsQueries {
  const gateway = useApiClient()
  return useMemo(
    () => createNotificationsQueries({ gateway: createNotificationsGateway(gateway), browser: createRealPushBrowserPort() }),
    [gateway],
  )
}
