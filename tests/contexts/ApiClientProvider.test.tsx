import { describe, test, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import React from 'react'
import { ApiClientProvider, useApiClient } from '@/contexts/ApiClientProvider'
import { createGateway } from '@/lib/api/gateway'
import type { ApiGateway } from '@/lib/api/gateway'

// verifies: CI-W1, CI-W2, CI-W3

function Reader({ onRead }: { onRead: (gw: ApiGateway) => void }) {
  onRead(useApiClient())
  return null
}

describe('ApiClientProvider', () => {
  test('verifies: CI-W1 - returns the gateway passed as a prop, unchanged across re-renders', () => {
    const gateway = createGateway()
    const seen: ApiGateway[] = []
    const { rerender } = render(
      <ApiClientProvider gateway={gateway}>
        <Reader onRead={(gw) => seen.push(gw)} />
      </ApiClientProvider>,
    )
    rerender(
      <ApiClientProvider gateway={gateway}>
        <Reader onRead={(gw) => seen.push(gw)} />
      </ApiClientProvider>,
    )

    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(gateway)
    expect(seen[1]).toBe(gateway)
  })

  test('verifies: CI-W1 - creates a gateway once when the prop is omitted, and keeps the same instance across re-renders', () => {
    const seen: ApiGateway[] = []
    const { rerender } = render(
      <ApiClientProvider>
        <Reader onRead={(gw) => seen.push(gw)} />
      </ApiClientProvider>,
    )
    rerender(
      <ApiClientProvider>
        <Reader onRead={(gw) => seen.push(gw)} />
      </ApiClientProvider>,
    )

    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(seen[1])
  })

  test('verifies: CI-W2 - throws when useApiClient() is called outside ApiClientProvider', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(() => render(<Reader onRead={() => {}} />)).toThrow(
        'useApiClient must be used within ApiClientProvider',
      )
    } finally {
      consoleError.mockRestore()
    }
  })
})
