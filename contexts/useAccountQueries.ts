'use client'

import { useMemo } from 'react'
import { useApiClient } from '@/contexts/ApiClientProvider'
import { createAccountQueries, type AccountQueries } from '@/lib/account/application/queries'
import { createAccountGateway } from '@/lib/account/infrastructure/accountGateway'

/** composition root: useApiClient() の gateway から AccountQueries を組み立てる（gateway が同じ間は同じ object）。 */
export function useAccountQueries(): AccountQueries {
  const gateway = useApiClient()
  return useMemo(() => createAccountQueries({ gateway: createAccountGateway(gateway) }), [gateway])
}
