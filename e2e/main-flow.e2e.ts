import { test, expect } from '@playwright/test'
import * as fs from 'fs'
import * as path from 'path'
import { KEY_API_BASE_URL, KEY_API_KEY } from '@/lib/config'

/**
 * Main flow E2E test: ログイン → フィード(一覧表示) → Star(トースト/スター状態) → /podcast へ遷移 → 再生
 *
 * NOTE: Drives the real root-page gate (SetupModal は localStorage シードで通過、LoginModal で
 * ログイン) then the feed → star → podcast → play core flow.
 *
 * Stubs the backend API at /api/backend/** to isolate the flow from network dependencies.
 * The catch-all stub is registered FIRST because Playwright matches the last-registered
 * route first; specific stubs registered afterwards take precedence.
 */
test('ログイン→フィード→Star→再生', async ({ page }) => {
  // ═══════════════════════════════════════════════════════════════════════════════
  // Route stubs: MUST be registered BEFORE navigate (before page.goto)
  // ═══════════════════════════════════════════════════════════════════════════════

  let loggedIn = false  // Start unauthenticated to exercise the login step

  // Catch-all fallback for unstubbed routes (prevents hangs).
  // WHY first: Playwright matches the LAST-registered route first, so the
  // catch-all must be registered BEFORE the specific stubs or it shadows them.
  await page.route('**/api/backend/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    })
  })

  // GET /auth/me — returns authenticated user
  await page.route('**/api/backend/auth/me', (route) => {
    if (loggedIn) {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          username: 'e2e',
          role: 'user',
          display_name: 'E2E',
        }),
      })
    } else {
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'unauthorized' }),
      })
    }
  })

  // POST /auth/login — sets loggedIn flag
  await page.route('**/api/backend/auth/login', (route) => {
    loggedIn = true
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        token: 't',
        user: {
          username: 'e2e',
          role: 'user',
          display_name: 'E2E',
        },
      }),
    })
  })

  // GET /settings/onboarding — returns completed
  await page.route('**/api/backend/settings/onboarding', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ onboarding_completed: true }),
    })
  })

  // GET /settings/featured-sources
  await page.route('**/api/backend/settings/featured-sources', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sites: [] }),
    })
  })

  // GET /notifications/vapid-public-key
  await page.route('**/api/backend/notifications/vapid-public-key', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ public_key: 'test-vapid-key' }),
    })
  })

  // GET /users/me/preferences
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

  // GET /feed — returns one test article
  await page.route('**/api/backend/feed', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        date: '2026-06-25',
        articles: [
          {
            id: 'a1',
            title: 'E2Eテスト記事',
            url: 'https://example.com',
            source: 'src',
            score: 0.9,
            published_at: '2026-06-25T00:00:00Z',
          },
        ],
      }),
    })
  })

  // POST /articles/:id/star — acknowledges star
  await page.route('**/api/backend/articles/a1/star', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ status: 'ok', article_id: 'a1' }),
    })
  })

  // GET /podcasts — returns one ready podcast
  await page.route('**/api/backend/podcasts', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        podcasts: [
          {
            id: 'p1',
            type: 'single',
            article_ids: ['a1'],
            difficulty: 'toeic_600',
            audio_url: 'https://audio.e2e.test/p1.mp3',
            japanese_intro_text: 'これはE2Eテスト用のイントロです',
            duration_seconds: 120,
            created_at: '2026-06-25T00:00:00Z',
            status: 'completed',
            error_message: null,
            playback_position_seconds: 0,
          },
        ],
      }),
    })
  })

  // GET /podcasts/:id — returns podcast details
  await page.route('**/api/backend/podcasts/p1', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        id: 'p1',
        type: 'single',
        article_ids: ['a1'],
        difficulty: 'toeic_600',
        audio_url: 'https://audio.e2e.test/p1.mp3',
        japanese_intro_text: 'これはE2Eテスト用のイントロです',
        duration_seconds: 120,
        created_at: '2026-06-25T00:00:00Z',
        status: 'completed',
        error_message: null,
        playback_position_seconds: 0,
      }),
    })
  })

  // Stub the audio file itself. WHY a real, valid silent WAV (not an empty/garbage
  // body): useStartPodcast awaits player.play() BEFORE dispatching SET_PODCAST; an
  // undecodable body makes play() reject → error toast → the player bar never mounts.
  // Chromium decodes PCM WAV natively; served as audio/wav regardless of the .mp3 URL.
  const audioFilePath = path.join(__dirname, 'fixtures', 'silence.wav')
  const audioBuffer = fs.readFileSync(audioFilePath)
  await page.route('https://audio.e2e.test/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'audio/wav',
      body: audioBuffer,
    })
  })

  // Pre-seed config localStorage to enable API calls
  await page.addInitScript(
    ({ baseUrl, apiKey, keyApiBaseUrl, keyApiKey }) => {
      const config = {
        [keyApiBaseUrl]: baseUrl,
        [keyApiKey]: apiKey,
      }
      Object.entries(config).forEach(([key, value]) => {
        localStorage.setItem(key, JSON.stringify(value))
      })
    },
    {
      baseUrl: 'http://e2e.test',
      apiKey: 'e2e-key',
      keyApiBaseUrl: KEY_API_BASE_URL,
      keyApiKey: KEY_API_KEY,
    },
  )

  // ═══════════════════════════════════════════════════════════════════════════════
  // Test flow steps: フィード → Star → /podcast → 再生
  // ═══════════════════════════════════════════════════════════════════════════════

  // 1. Navigate to root → config seeded, unauthenticated → LoginModal
  await page.goto('/')

  // 2. Login screen visible (config gate passed)
  await expect(page.getByRole('heading', { name: 'ログイン' })).toBeVisible()

  // 3. Log in
  await page.locator('#login-username').fill('e2e')
  await page.locator('#login-password').fill('e2e-password')
  await page.getByRole('button', { name: 'ログイン' }).click()

  // 4. Lands on feed with the article (root replaces to /feed after auth+onboarding)
  await expect(page).toHaveURL(/\/feed$/)
  await expect(page.getByText('E2Eテスト記事')).toBeVisible()

  // 3. Star button exists and is clickable
  const starButton = page.getByTestId('star-button-a1')
  await expect(starButton).toBeVisible()

  // 4. Click star → assert success toast
  await starButton.click()
  await expect(
    page.getByRole('status').filter({ hasText: /Star\sしました/ }),
  ).toBeVisible()

  // 5. Navigate to podcast page via nav link
  await page.getByRole('link', { name: 'ポッドキャスト' }).click()
  await expect(page).toHaveURL('/podcast')

  // 6. Podcast card visible with intro text
  await expect(
    page.getByText('これはE2Eテスト用のイントロです'),
  ).toBeVisible()

  // 7. Click play button on PodcastCard
  const playButton = page
    .getByTestId('podcast-card-p1')
    .getByRole('button', { name: '再生' })
  await playButton.click()

  // 8. AudioPlayerBar reflects playing state
  // 8a. Player bar is now mounted
  await expect(
    page.locator('footer[aria-label="プレイヤー"]'),
  ).toBeVisible()

  // 8b. Pause button visible (only when isPlaying === true)
  await expect(
    page.getByRole('button', { name: '一時停止' }),
  ).toBeVisible()

  // 8c. PodcastCard shows 再生中 badge
  const podcastCard = page.getByTestId('podcast-card-p1')
  await expect(
    podcastCard.getByText('再生中'),
  ).toBeVisible()

  // 9. Negative guard: error toast should NOT be present
  await expect(
    page.getByRole('alert').filter({ hasText: /再生できませんでした/ }),
  ).not.toBeVisible()
})
