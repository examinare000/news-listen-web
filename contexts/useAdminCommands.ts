'use client'

import { useMemo } from 'react'
import { useApiClient } from '@/contexts/ApiClientProvider'
import { createAdminCommands, type AdminCommands } from '@/lib/admin/application/commands'
import { createAdminGateway } from '@/lib/admin/infrastructure/adminGateway'

/** composition root: useApiClient() の gateway から AdminCommands を組み立てる（gateway が同じ間は同じ object）。 */
export function useAdminCommands(): AdminCommands {
  const gateway = useApiClient()
  return useMemo(() => createAdminCommands({ gateway: createAdminGateway(gateway) }), [gateway])
}
