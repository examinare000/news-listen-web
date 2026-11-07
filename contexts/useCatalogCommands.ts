'use client'

import { useMemo } from 'react'
import { useApiClient } from '@/contexts/ApiClientProvider'
import { createCatalogCommands, type CatalogCommands } from '@/lib/catalog/application/commands'
import { createCatalogGateway } from '@/lib/catalog/infrastructure/catalogGateway'

/** composition root: useApiClient() の gateway から CatalogCommands を組み立てる（gateway が同じ間は同じ object）。 */
export function useCatalogCommands(): CatalogCommands {
  const gateway = useApiClient()
  return useMemo(() => createCatalogCommands({ gateway: createCatalogGateway(gateway) }), [gateway])
}
