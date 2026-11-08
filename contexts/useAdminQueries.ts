'use client'

import { useMemo } from 'react'
import { useApiClient } from '@/contexts/ApiClientProvider'
import { createAdminQueries, type AdminQueries } from '@/lib/admin/application/queries'
import { createAdminGateway } from '@/lib/admin/infrastructure/adminGateway'

/** composition root: useApiClient() の gateway から AdminQueries を組み立てる（gateway が同じ間は同じ object）。 */
export function useAdminQueries(): AdminQueries {
  const gateway = useApiClient()
  return useMemo(() => createAdminQueries({ gateway: createAdminGateway(gateway) }), [gateway])
}
