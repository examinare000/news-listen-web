// verifies: CI-LD20（主体離脱時の既読の消去。logout・401（失効）のどちらでも、seen_achievement_ids・default_playback_speed・
// 当該主体の playback_position_record:<userId>:* が消え、theme は残る。web-dec-170・shared-leave-01）
// 実物の AuthProvider・PreferencesProvider を描画し、既読は localStorage（既読の store の保存先）に seed して localStorage.getItem で観測する。
// 音声キャッシュと SW キャッシュの消去は本テストの対象外なので mock する。
//
// 実装前の状態: PreferencesProvider が既定の（localStorage の）KeyValueStore を使うので、registry の clearSubjectScoped が既読の key も消し、本テストは通る
// （既存契約の特性テスト）。既読の消去が registry から Learning の既読の store へ移った後は、AuthProvider の clearSubjectSettings に足す
// `clear()` の 1 行が欠けるとここが落ちる（消去の移し先を固定する）。
import { describe, test, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import { PreferencesProvider } from '@/contexts/PreferencesProvider'
import { AuthProvider, useAuth } from '@/contexts/AuthProvider'
import { claimUnnotifiedAchievements } from '@/contexts/seenAchievementsSession'
import { positionRecordKey } from '@/lib/playback/infrastructure/localPositionStore'
import { createGatewayDouble } from '../helpers/gatewayDouble'
import type { GatewayDouble } from '../helpers/gatewayDouble'

const holder = vi.hoisted(() => ({ gw: undefined as GatewayDouble | undefined }))
vi.mock('@/lib/api/gateway', () => ({ createGateway: () => holder.gw }))

vi.mock('@/lib/playback/infrastructure/offlineLibrary', () => ({
  reclaimAudioCaches: vi.fn().mockResolvedValue(undefined),
  deleteSubjectAudio: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/lib/platform/swCacheCleanup', () => ({
  clearManagedServiceWorkerCaches: vi.fn().mockResolvedValue(undefined),
}))

const ME_PATH = '/api/backend/auth/me'
const LOGOUT_PATH = '/api/backend/auth/logout'
const ME_A = { user_id: 'u-a', username: 'alice', role: 'user', display_name: 'Alice' }

let gw: GatewayDouble

function Consumer() {
  const { view, logout, refreshMe } = useAuth()
  return (
    <div>
      <span data-testid="status">{view.kind}</span>
      <button onClick={() => void logout()}>logout</button>
      <button onClick={() => void refreshMe()}>refresh</button>
    </div>
  )
}

function seedSubjectData() {
  localStorage.setItem('seen_achievement_ids', '["a","b"]')
  localStorage.setItem('default_playback_speed', '1.5')
  localStorage.setItem(positionRecordKey('u-a', 'p1'), JSON.stringify({ position: 12, synced: false }))
  localStorage.setItem('theme', 'light')
}

async function renderAuthenticated() {
  render(
    <PreferencesProvider>
      <AuthProvider>
        <Consumer />
      </AuthProvider>
    </PreferencesProvider>,
  )
  await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'))
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  gw = createGatewayDouble()
  holder.gw = gw
  gw.respond('GET', ME_PATH, { ok: true, value: ME_A })
})

describe('主体離脱時の後始末 (shared-leave-01・web-dec-170)', () => {
  test('verifies: CI-LD20 — logout の後、既読・既定速度・当該主体の位置の記録が消え、theme は残る', async () => {
    gw.respond('POST', LOGOUT_PATH, { ok: true, value: { status: 'ok' } })
    await renderAuthenticated()
    seedSubjectData()

    await userEvent.click(screen.getByText('logout'))

    await waitFor(() => expect(localStorage.getItem('seen_achievement_ids')).toBeNull())
    await waitFor(() => expect(localStorage.getItem('default_playback_speed')).toBeNull())
    expect(localStorage.getItem(positionRecordKey('u-a', 'p1'))).toBeNull()
    expect(localStorage.getItem('theme')).toBe('light')
  })

  test('verifies: CI-LD20 — 401（失効）の後も、既読・既定速度・当該主体の位置の記録が消え、theme は残る', async () => {
    await renderAuthenticated()
    seedSubjectData()
    gw.respond('GET', ME_PATH, { ok: false, failure: { kind: 'unauthorized' } })

    await userEvent.click(screen.getByText('refresh'))

    await waitFor(() => expect(screen.getByTestId('status')).not.toHaveTextContent('authenticated'))
    await waitFor(() => expect(localStorage.getItem('seen_achievement_ids')).toBeNull())
    await waitFor(() => expect(localStorage.getItem('default_playback_speed')).toBeNull())
    expect(localStorage.getItem(positionRecordKey('u-a', 'p1'))).toBeNull()
    expect(localStorage.getItem('theme')).toBe('light')
  })

  test('verifies: CI-LD20 — logout の後は通知済みの記憶が空で、別の主体の同じ実績の id が再び通知の対象になる', async () => {
    gw.respond('POST', LOGOUT_PATH, { ok: true, value: { status: 'ok' } })
    await renderAuthenticated()
    expect(claimUnnotifiedAchievements(['streak_7'])).toEqual(['streak_7'])
    expect(claimUnnotifiedAchievements(['streak_7'])).toEqual([])

    await userEvent.click(screen.getByText('logout'))

    await waitFor(() => expect(claimUnnotifiedAchievements(['streak_7'])).toEqual(['streak_7']))
  })
})
