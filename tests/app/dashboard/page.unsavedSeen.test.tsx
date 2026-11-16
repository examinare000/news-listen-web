// verifies: CI-LD24・CI-LD13（保存できない環境での実績の通知。現行は同じ session では一度通知した実績を再通知しない）
// 端末に保存できない（localStorage.setItem が例外）環境で、ダッシュボードの再試行・page の再マウントをしても、同じ実績の効果音・toast は 1 回だけ。
// 保存に失敗した既読は session の間だけ持つ共有の記憶に置かれる（モジュールの状態）ので、ほかの dashboard のテストと別のファイルに置く（vitest はファイルごとにモジュールを分ける）。
// 特性テスト: 現行（mock 先 `@/lib/sfx`）で同じ形が通る。slice の後は mock 先だけを `@/contexts/SfxProvider` に替える。
//
// RED 理由（実装前）: page が useSfx() ではなく `@/lib/sfx` を直接呼ぶので、`@/contexts/SfxProvider` の mock の play が呼ばれない（効果音 0 回）。
import React, { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import DashboardPage from '@/app/(app)/dashboard/page'
import { ApiClientProvider } from '@/contexts/ApiClientProvider'
import { PreferencesProvider } from '@/contexts/PreferencesProvider'
import { createBrowserSeenAchievementsStore } from '@/contexts/seenAchievementsSession'
import { createGatewayDouble } from '../../helpers/gatewayDouble'
import type { GatewayDouble } from '../../helpers/gatewayDouble'

const { playSfx, showToast } = vi.hoisted(() => ({ playSfx: vi.fn(), showToast: vi.fn() }))

vi.mock('@/contexts/SfxProvider', () => ({ useSfx: () => ({ play: playSfx, prepare: vi.fn() }) }))
vi.mock('@/components/ui/Toast', () => ({ useToast: () => ({ showToast }) }))

const holder = vi.hoisted(() => ({ gw: undefined as GatewayDouble | undefined }))
vi.mock('@/lib/api/gateway', () => ({ createGateway: () => holder.gw }))

const DASHBOARD_PATH = '/api/backend/users/me/learning-dashboard'

const DASHBOARD = {
  streak: { current_streak_days: 7, today_listened: true, last_listened_day: '2026-07-12' },
  total_episodes: 1,
  vocabulary_acquired: 0,
  quiz: { quizzed_episodes: 0, average_correct_rate: null, trend: [] },
  monthly_activity: [],
  current_difficulty: 'toeic_600',
  weekly_goal: { goal_episodes: 3, week: '2026-W31', completed_this_week: 0, history: [] },
  achievements: [{ id: 'streak_7', unlocked_at: '2026-07-12' }],
}

// page を外して戻せる harness。ApiClientProvider・PreferencesProvider は mount したまま。
function Harness() {
  const [shown, setShown] = useState(true)
  return (
    <>
      <button onClick={() => setShown((value) => !value)}>表示の切り替え</button>
      {shown ? <DashboardPage /> : null}
    </>
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  localStorage.clear()
  createBrowserSeenAchievementsStore().clear()
  const gw = createGatewayDouble()
  gw.respond('GET', DASHBOARD_PATH, { ok: true, value: DASHBOARD })
  holder.gw = gw
})

describe('保存できない環境での実績の通知 (product-learn-04)', () => {
  test('verifies: CI-LD24・CI-LD13 — 表示 → 再試行 → page を外して戻す、のどれでも、同じ実績の効果音・toast は 1 回だけで、localStorage に既読は無い', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })

    render(
      <ApiClientProvider>
        <PreferencesProvider>
          <Harness />
        </PreferencesProvider>
      </ApiClientProvider>,
    )

    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1))
    expect(showToast).toHaveBeenCalledWith('実績を解錠しました：7 日連続聴取', 'success')
    expect(playSfx).toHaveBeenCalledTimes(1)
    expect(playSfx).toHaveBeenCalledWith('achievement')

    await userEvent.click(screen.getByRole('button', { name: 'ダッシュボードを再読み込み' }))
    await waitFor(() => expect(holder.gw!.calls.filter((c) => c.path === DASHBOARD_PATH)).toHaveLength(2))
    // 再試行の描画が済むのを待つ
    await screen.findByText(/7日連続/)

    await userEvent.click(screen.getByRole('button', { name: '表示の切り替え' }))
    await userEvent.click(screen.getByRole('button', { name: '表示の切り替え' }))
    await waitFor(() => expect(holder.gw!.calls.filter((c) => c.path === DASHBOARD_PATH)).toHaveLength(3))
    await screen.findByText(/7日連続/)

    expect(showToast).toHaveBeenCalledTimes(1)
    expect(playSfx).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem('seen_achievement_ids')).toBeNull()
  })
})
