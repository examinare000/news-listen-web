'use client'

// composition root（web-dec-100）: ApiClientProvider の gateway から Catalog の queries を組み立てる。Provider は作らない。
import { useMemo } from 'react'
import { useApiClient } from '@/contexts/ApiClientProvider'
import { usePositionIntake } from '@/contexts/PositionIntakeContext'
import { createCatalogQueries, type CatalogQueries } from '@/lib/catalog/application/queries'
import { createCatalogGateway } from '@/lib/catalog/infrastructure/catalogGateway'

export function useCatalogQueries(): CatalogQueries {
  const gateway = useApiClient()
  const intake = usePositionIntake()
  return useMemo(
    () => createCatalogQueries({ gateway: createCatalogGateway(gateway, { observePositions: () => intake.capture() }) }),
    [gateway, intake],
  )
}
