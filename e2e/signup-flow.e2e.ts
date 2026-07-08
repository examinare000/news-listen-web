import { test, expect } from '@playwright/test'

/**
 * Signup flow E2E test（招待コードによる新規登録）: LP → /signup（招待コード事前入力）→
 * 登録 → オンボーディング → フィード。
 *
 * Stub conventions follow e2e/main-flow.e2e.ts EXACTLY: catch-all registered FIRST
 * (Playwright matches the LAST-registered route first, so specific stubs must come after),
 * mutable loggedIn flag flipped by the register stub.
 */
test('LP→招待コードで新規登録→オンボーディング→フィード', async ({ page }) => {
  // ═══════════════════════════════════════════════════════════════════════════════
  // Route stubs: MUST be registered BEFORE navigate (before page.goto)
  // ═══════════════════════════════════════════════════════════════════════════════

  let loggedIn = false

  // Catch-all fallback for unstubbed routes (prevents hangs).
  await page.route('**/api/backend/**', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    })
  })

  // GET /auth/me — register 成功後は認証済みを返す
  await page.route('**/api/backend/auth/me', (route) => {
    if (loggedIn) {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ username: 'newbie', role: 'user', display_name: 'Newbie' }),
      })
    } else {
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'unauthorized' }),
      })
    }
  })

  // POST /auth/register — 招待コードによる新規登録。成功したら loggedIn を立てる。
  await page.route('**/api/backend/auth/register', (route) => {
    loggedIn = true
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        token: 't',
        user: { username: 'newbie', role: 'user', display_name: 'Newbie' },
      }),
    })
  })

  // GET /settings/onboarding — 新規ユーザーなので未完了
  await page.route('**/api/backend/settings/onboarding', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ onboarding_completed: false }),
    })
  })

  // POST /settings/onboarding/complete — 「スキップ」で完了扱いにする
  await page.route('**/api/backend/settings/onboarding/complete', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ onboarding_completed: true }),
    })
  })

  // GET /settings/featured-sources — おすすめサイト（未購読・空でよい）
  await page.route('**/api/backend/settings/featured-sources', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ sites: [] }),
    })
  })

  // GET /feed — オンボーディング後の着地先（フィードは空でよい）
  await page.route('**/api/backend/feed', (route) => {
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ date: '2026-07-08', articles: [] }),
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

  // ═══════════════════════════════════════════════════════════════════════════════
  // Test flow steps: LP → /signup → 登録 → オンボーディング → フィード
  // ═══════════════════════════════════════════════════════════════════════════════

  // 1. LP を確認（未接続/未ログインの入口。shell-less なので NavigationBar は無い）
  await page.goto('/')
  await expect(page.getByTestId('lp-hero')).toBeVisible()
  await expect(page.getByRole('complementary')).toHaveCount(0)

  // 2. 招待コード付きで /signup へ遷移し、事前入力を確認
  await page.goto('/signup?invite=E2ECODE')
  await expect(page.getByLabel('招待コード')).toHaveValue('E2ECODE')

  // 3. フォームに入力して送信
  await page.getByLabel('ユーザーID').fill('newbie')
  await page.getByLabel('パスワード', { exact: true }).fill('SignupE2e#2026ok')
  await page.getByLabel('パスワード（確認）').fill('SignupE2e#2026ok')
  await page.getByRole('button', { name: '登録する' }).click()

  // 4. 登録成功 → root へ戻り、オンボーディングモーダルが表示される
  await expect(page.getByRole('dialog', { name: 'おすすめサイトを購読' })).toBeVisible()

  // 5. スキップしてフィードへ
  await page.getByRole('button', { name: 'スキップ' }).click()
  await expect(page).toHaveURL(/\/feed$/)
})
