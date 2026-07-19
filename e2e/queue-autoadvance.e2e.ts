import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Queue auto-advance E2E test (issue #86): エピソード再生完了 → キューの次エピソードが
 * 自動再生される（AudioPlayerContext.handleEnded の複合結線）。
 *
 * WHY this needs a real browser (unlike tests/contexts/AudioPlayerContext.queue.test.tsx,
 * which already covers the same handleEnded → Q.advance → fetchAndPlay wiring at the unit
 * level with a MockAudio double): that test drives the queue's *pure state model* and a
 * mocked audio element, never a genuine `ended` DOM event fired by an actual decoded audio
 * file. This test proves the thing only a real browser can: that the <audio> element's
 * native 'ended' event — reachable solely by letting a real, decodable file play to
 * completion — actually triggers the provider's auto-advance in the deployed app, not just
 * in a mocked harness.
 *
 * WHY a dedicated 2-second fixture (fixtures/silence-2s.wav) for the FIRST episode instead
 * of reusing the existing 0.4s fixtures/silence.wav for it: main-flow.e2e.ts and
 * offline-playback.e2e.ts only ever have one episode playing, so silence.wav's very short
 * duration is fine (offline-playback.e2e.ts even documents accepting the resulting race on
 * the pause-button assertion). Here a second episode must be added to the queue via a UI
 * click AFTER the first starts playing but BEFORE it naturally ends — with the 0.4s clip,
 * that window is too tight to reliably win against Playwright's own click/network latency,
 * which would make the test flip a coin on whether the queue is non-empty when the audio
 * ends. Two seconds gives ample headroom for that click while still keeping the test fast.
 * The second (final) episode keeps the short silence.wav since nothing needs to happen
 * after it finishes.
 *
 * Route stubs follow the same pattern as e2e/main-flow.e2e.ts (catch-all first, since
 * Playwright matches the last-registered route first).
 */
test('再生完了→キューの次エピソードが自動再生される', async ({ page }) => {
  let loggedIn = false

  await page.route('**/api/backend/**', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({}) })
  })

  await page.route('**/api/backend/auth/me', (route) => {
    if (loggedIn) {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ username: 'e2e', role: 'user', display_name: 'E2E' }),
      })
    } else {
      route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ detail: 'unauthorized' }) })
    }
  })

  await page.route('**/api/backend/auth/login', (route) => {
    loggedIn = true
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ token: 't', user: { username: 'e2e', role: 'user', display_name: 'E2E' } }),
    })
  })

  await page.route('**/api/backend/settings/onboarding', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ onboarding_completed: true }) })
  })

  await page.route('**/api/backend/settings/featured-sources', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sites: [] }) })
  })

  await page.route('**/api/backend/notifications/vapid-public-key', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ public_key: 'test-vapid-key' }) })
  })

  await page.route('**/api/backend/users/me/preferences', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        default_difficulty: 'toeic_600',
        default_playback_speed: 1.0,
        digest_enabled: false,
        digest_article_count: 5,
      }),
    })
  })

  const POD_1 = {
    id: 'p1',
    type: 'single',
    article_ids: ['a1'],
    difficulty: 'toeic_600',
    audio_url: 'https://audio.e2e.test/p1.mp3',
    japanese_intro_text: 'キュー自動送りテスト1本目のイントロです',
    duration_seconds: 2,
    created_at: '2026-06-25T00:00:00Z',
    status: 'completed',
    error_message: null,
    playback_position_seconds: 0,
  }
  const POD_2 = {
    id: 'p2',
    type: 'single',
    article_ids: ['a2'],
    difficulty: 'toeic_600',
    audio_url: 'https://audio.e2e.test/p2.mp3',
    japanese_intro_text: 'キュー自動送りテスト2本目のイントロです',
    duration_seconds: 1,
    created_at: '2026-06-25T00:05:00Z',
    status: 'completed',
    error_message: null,
    playback_position_seconds: 0,
  }

  // GET /podcasts — 一覧。両エピソードを返す。
  await page.route('**/api/backend/podcasts', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ podcasts: [POD_1, POD_2] }),
    })
  })

  // GET /podcasts/:id — playById / fetchAndPlay（自動送り時の再取得）が叩く詳細取得
  await page.route('**/api/backend/podcasts/p1', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(POD_1) })
  })
  await page.route('**/api/backend/podcasts/p2', (route) => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(POD_2) })
  })

  // 音声ファイル本体。main-flow.e2e.ts と同じ理由で実在する無音 WAV を返す（<audio> 要素
  // 経由の再生には CORS 不要 — offline-playback.e2e.ts の fetch() 経由の場合と異なる）。
  const shortAudio = fs.readFileSync(path.join(__dirname, 'fixtures', 'silence.wav'))
  const longAudio = fs.readFileSync(path.join(__dirname, 'fixtures', 'silence-2s.wav'))
  await page.route('https://audio.e2e.test/p1.mp3', (route) => {
    route.fulfill({ status: 200, contentType: 'audio/wav', body: longAudio })
  })
  await page.route('https://audio.e2e.test/p2.mp3', (route) => {
    route.fulfill({ status: 200, contentType: 'audio/wav', body: shortAudio })
  })

  // 1. ログイン（/ は LandingPage。「ログイン」ボタンでオーバーレイの LoginModal を開く）
  await page.goto('/')
  await expect(page.getByTestId('lp-hero')).toBeVisible()
  await page.getByRole('button', { name: 'ログイン', exact: true }).first().click()
  await expect(page.getByRole('heading', { name: 'ログイン' })).toBeVisible()
  await page.locator('#login-username').fill('e2e')
  await page.locator('#login-password').fill('e2e-password')
  await page.getByRole('dialog', { name: 'ログイン' }).getByRole('button', { name: 'ログイン', exact: true }).click()
  await expect(page).toHaveURL(/\/feed$/)

  // 2. /podcast へ遷移し、両カードが表示されるのを待つ
  await page.getByRole('link', { name: 'ポッドキャスト' }).click()
  await expect(page).toHaveURL('/podcast')
  const card1 = page.getByTestId('podcast-card-p1')
  const card2 = page.getByTestId('podcast-card-p2')
  await expect(card1).toBeVisible()
  await expect(card2).toBeVisible()

  // 3. 1本目を再生開始
  await card1.getByRole('button', { name: '再生', exact: true }).click()
  await expect(page.locator('footer[aria-label="プレイヤー"]')).toBeVisible()
  await expect(card1.getByText('再生中')).toBeVisible()

  // 4. 再生中に2本目をキューへ追加（1本目の2秒の再生時間内に間に合わせる）
  await card2.getByRole('button', { name: 'キューに追加' }).click()

  // 5. 1本目が自然に再生終了 → handleEnded → Q.advance → fetchAndPlay(p2) の自動送りを待つ。
  //    ネットワーク往復も含むため、2秒の再生時間に十分な余裕（15秒）を持たせる。
  await expect(card2.getByText('再生中')).toBeVisible({ timeout: 15_000 })

  // 6. 1本目はもう再生中表示ではない（キュー送り先が切り替わった証跡）
  await expect(card1.getByText('再生中')).not.toBeVisible()

  // 7. プレイヤーバーが2本目のイントロを表示している
  await expect(
    page.locator('footer[aria-label="プレイヤー"]').getByText('キュー自動送りテスト2本目のイントロです'),
  ).toBeVisible()

  // 8. ネガティブガード: エラートーストが出ていないこと
  await expect(page.getByRole('alert').filter({ hasText: /再生できませんでした/ })).not.toBeVisible()
})
