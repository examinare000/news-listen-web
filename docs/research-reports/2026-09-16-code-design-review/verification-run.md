# Web Module Verification Report

## 1. npm test (vitest run)
**Command:** `npm test`  
**Exit Code:** 0  
**Summary:**
- Test Files: 85 passed (85)
- Tests: 1165 passed (1165)
- Duration: 12.03s
- jsdom warnings: 3 × "Not implemented: HTMLMediaElement's pause() method"

## 2. npm run lint (eslint)
**Command:** `npm run lint`  
**Exit Code:** 0  
**Summary:**
- Total: ✖ 177 problems (0 errors, 177 warnings)

**Top Rules by Count:**
- @typescript-eslint/no-floating-promises: 65
- @typescript-eslint/require-await: 39
- @typescript-eslint/no-unsafe-assignment: 20
- @eslint-react/use-state: 6
- @eslint-react/set-state-in-effect: 6
- @eslint-react/no-array-index-key: 5
- @eslint-react/no-use-context: 4
- @eslint-react/no-context-provider: 4
- @typescript-eslint/no-unsafe-argument: 2
- @typescript-eslint/no-unsafe-member-access: 1
- @eslint-react/web-api-no-leaked-fetch: 1
- @eslint-react/purity: 1
- @eslint-react/dom-no-dangerously-set-innerhtml: 1

**By Directory:**
- Source files with issues: 52
- Test files with issues: 17

## 3. npm run typecheck (TypeScript 6)
**Command:** `npm run typecheck`  
**Exit Code:** 0  
**Result:** No errors

## 4. npm run typecheck:ts7 (TypeScript 7)
**Command:** `npm run typecheck:ts7`  
**Exit Code:** 0  
**Result:** No errors

## 5. npm run build
**Command:** `npm run build`  
**Exit Code:** 0  
**Route Table:**
- ○ (Static): 11 routes
  - /, /_not-found, /admin/featured-sites, /admin/invites, /admin/metrics, /admin/users, /dashboard, /feed, /privacy, /settings, /signup, /subscriptions, /terms, /vocabulary-test
- ƒ (Dynamic): 2 routes
  - /api/backend/[...path], /podcast/[id]

## 6. .github/workflows/ci.yml run: steps

**CI job: lint-test**
- npm ci
- npm run lint
- npm run typecheck
- npm run test

**CI job: e2e**
- npm ci
- npx playwright install --with-deps chromium
- CI=true npm run test:e2e
- (upload artifact on failure)

**CI job: secret-scan**
- gitleaks/gitleaks-action@v3

## 7. Source Code Metrics


### a. createApiClient() call sites in source
> **Erratum（router 再計測 2026-09-16）**: 正しくは **呼出 37 箇所 / 19 ファイル**（定義行 `lib/api.ts:124` を除く）。本表は `app/(app)/vocabulary-test/page.tsx` の 4 箇所（:55,102,407,440）を欠落し、`lib/api.ts` の定義行を算入している。独立評価（t5-adversarial.md）で検出。

**Total:** 34 call sites（誤り。上記 erratum 参照）  
**By file:**
- app/(app)/feed/page.tsx: 5
- app/(app)/podcast/[id]/page.tsx: 4
- contexts/AudioPlayerContext.tsx: 4
- app/(app)/settings/page.tsx: 5
- app/(app)/admin/featured-sites/page.tsx: 1
- app/(app)/admin/invites/page.tsx: 1
- app/(app)/admin/metrics/page.tsx: 1
- app/(app)/admin/users/page.tsx: 1
- app/(app)/dashboard/page.tsx: 1
- app/(app)/podcast/page.tsx: 1
- app/(app)/subscriptions/page.tsx: 1
- app/page.tsx: 1
- components/ui/AccountSection.tsx: 1
- components/ui/OnboardingSourcesModal.tsx: 1
- contexts/AuthContext.tsx: 1
- contexts/StreakContext.tsx: 1
- hooks/useWebPushSubscription.ts: 2
- lib/api.ts: 1
- lib/audioCache.ts: 1

### b. Silent catch blocks in source
**Total:** 53 silent catch blocks  
**Top files:**
- components/ui/AccountSection.tsx: 6
- app/(app)/admin/featured-sites/page.tsx: 5
- app/(app)/admin/invites/page.tsx: 4
- app/(app)/admin/users/page.tsx: 4
- lib/sfx.ts: 4
- hooks/useAudioPlayer.ts: 4
- contexts/AppContext.tsx: 3
- contexts/AuthContext.tsx: 3
- app/(app)/podcast/[id]/page.tsx: 3
- hooks/useWebPushSubscription.ts: 3
- app/(app)/settings/page.tsx: 3
- app/(app)/podcast/page.tsx: 1
- app/(app)/subscriptions/page.tsx: 1
- app/api/backend/[...path]/route.ts: 1
- components/ui/OnboardingSourcesModal.tsx: 1
- contexts/StreakContext.tsx: 1
- hooks/useLocalStorage.ts: 2
- hooks/usePodcastListPolling.ts: 1
- lib/api.ts: 2
- lib/reportClientError.ts: 1

### c. eslint-disable occurrences in source
**Total:** 10 occurrences  
**Breakdown:** eslint-disable (various rules)

### d. localStorage direct access in source
**Total:** 16 direct accesses  
**By file:**
- hooks/useAudioPlayer.ts: 5
- contexts/AppContext.tsx: 3
- app/(app)/dashboard/page.tsx: 2
- hooks/useLocalStorage.ts: 2
- lib/sfx.ts: 2
- app/layout.tsx: 1
- components/ui/ThemeToggle.tsx: 1

### e. useState hook count
- app/(app)/feed/page.tsx: 14
- app/(app)/settings/page.tsx: 9
- components/ui/AccountSection.tsx: 24
- app/(app)/admin/featured-sites/page.tsx: 19
- app/(app)/vocabulary-test/page.tsx: 13

### f. Top 25 largest source files (lines)
1. components/ui/AccountSection.tsx: 722
2. app/(app)/feed/page.tsx: 615
3. lib/api.ts: 554
4. app/(app)/settings/page.tsx: 511
5. app/(app)/vocabulary-test/page.tsx: 480
6. types/index.ts: 456
7. app/(app)/podcast/[id]/page.tsx: 455
8. app/(app)/admin/featured-sites/page.tsx: 447
9. app/(app)/subscriptions/page.tsx: 433
10. app/(app)/dashboard/page.tsx: 387
11. app/(app)/admin/invites/page.tsx: 275
12. hooks/useAudioPlayer.ts: 267
13. app/signup/page.tsx: 265
14. components/AudioPlayerBar.tsx: 251
15. app/(app)/podcast/page.tsx: 235
16. contexts/AudioPlayerContext.tsx: 218
17. components/NavigationBar.tsx: 216
18. app/(app)/admin/users/page.tsx: 197
19. components/ArticleCard.tsx: 196
20. app/(app)/admin/metrics/page.tsx: 182
21. components/ui/LoginModal.tsx: 180
22. components/ui/OnboardingSourcesModal.tsx: 176
23. components/PodcastCard.tsx: 173
24. app/api/backend/[...path]/route.ts: 151
25. (Total for measured directories: 11,377 lines)

### g. Test infrastructure metrics
- Files with vi.mock('@/lib/api'): 24
- Files with vi.mock('@/contexts/AuthContext'): 15
- Total vi.mock() occurrences: 78
- Total toHaveBeenCalled occurrences: 273
- Files importing msw: 0

---

## Summary

**Exit Codes:**
- npm test: 0 ✓
- npm run lint: 0 ✓ (177 warnings)
- npm run typecheck (TS6): 0 ✓
- npm run typecheck:ts7 (TS7): 0 ✓
- npm run build: 0 ✓

**All checks PASSED**
