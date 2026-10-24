// オフライン保存庫の契約テスト（web-contract-13・web-spec/capsule-03・web-rule-playback-10）。
// Cache は MockCacheStorage、gateway は gatewayDouble、blob URL と見積もりは関数 double。
// 旧実装（lib/audioCache.ts）が書いた entry との互換（Cache 名 audio-v1・key 3 種・旧 meta）も固定する。
//
// RED 理由: `@/lib/playback/infrastructure/offlineLibrary` がまだ存在しない。
import { describe, test, expect, vi, afterEach } from 'vitest'
import { clearOfflineAudio, createOfflineLibrary } from '@/lib/playback/infrastructure/offlineLibrary'
import type { CacheBucket } from '@/lib/platform/cacheStore'
import type { Podcast } from '@/types'
import { createGatewayDouble } from '../../../helpers/gatewayDouble'
import { MockCacheStorage } from '../../../helpers/mockCaches'

const CACHE = 'audio-v1'
const AUDIO_URL = 'https://storage.example.com/p1.mp3'
const AUDIO_KEY = '/_audio/p1'
const META_KEY = '/_audio-meta/p1'
const EPISODE_KEY = '/_audio-podcast/p1'
const GET_PATH = '/api/backend/podcasts/p1'

const dto: Podcast = {
  id: 'p1',
  type: 'daily',
  article_ids: ['art-1'],
  difficulty: 'toeic_600',
  audio_url: AUDIO_URL,
  title: '題名',
  japanese_intro_text: '導入文',
  duration_seconds: 120,
  created_at: '2026-10-01T00:00:00Z',
  status: 'completed',
  error_message: null,
  playback_position_seconds: 30,
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})

function setup(options: { usage?: { usage: number; quota: number } | null } = {}) {
  const caches = new MockCacheStorage()
  const gateway = createGatewayDouble()
  gateway.respond('GET', GET_PATH, { ok: true, value: dto })
  caches.respondTo(AUDIO_URL, 'audio-bytes')
  const created: Blob[] = []
  const revoked: string[] = []
  const objectUrl = {
    create: (blob: Blob): string => {
      created.push(blob)
      return `blob:test/${created.length}`
    },
    revoke: (url: string): void => {
      revoked.push(url)
    },
  }
  const library = createOfflineLibrary({
    cacheStore: caches,
    gateway,
    objectUrl,
    estimate: () => Promise.resolve(options.usage ?? null),
  })
  return { caches, gateway, library, created, revoked }
}

async function bucketOf(caches: MockCacheStorage) {
  return caches.open(CACHE)
}

async function keysOf(bucket: CacheBucket): Promise<string[]> {
  return (await bucket.keys()).map((k) => k.url).sort()
}

/** 旧実装が書く 3 entry（meta に size_bytes・saved_at が無い）。 */
async function writeLegacyEntries(bucket: CacheBucket, id: string, overrides: Partial<Podcast> = {}) {
  const podcast: Podcast = { ...dto, id, ...overrides, audio_url: '' }
  await bucket.put(`/_audio/${id}`, new Response('legacy-audio'))
  await bucket.put(
    `/_audio-meta/${id}`,
    new Response(JSON.stringify({ id, title: podcast.japanese_intro_text, duration_seconds: podcast.duration_seconds })),
  )
  await bucket.put(`/_audio-podcast/${id}`, new Response(JSON.stringify(podcast)))
}

/** 指定 key の put だけ reject し、ほかは本物の put に委譲する。 */
function rejectPutFor(bucket: CacheBucket, rejectedKey: string): void {
  const original = bucket.put.bind(bucket)
  vi.spyOn(bucket, 'put').mockImplementation(async (key, response) => {
    if (key === rejectedKey) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' })
    await original(key, response)
  })
}

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

describe('verifies: CI-T43 save の成功（web-contract-13・web-dec-30・web-dec-27）', () => {
  test('gateway に GET を 1 回、3 entry を 音声 → meta → episode の順に書く', async () => {
    const t = setup()
    const bucket = await bucketOf(t.caches)
    const put = vi.spyOn(bucket, 'put')
    const result = await t.library.save('p1')
    expect(result).toEqual({ ok: true, value: undefined })
    expect(t.gateway.calls).toEqual([{ method: 'GET', path: GET_PATH, body: undefined }])
    expect(put.mock.calls.map((c) => c[0])).toEqual([AUDIO_KEY, META_KEY, EPISODE_KEY])
    expect(await keysOf(bucket)).toEqual([AUDIO_KEY, EPISODE_KEY, META_KEY].sort())
  })

  test('verifies: CI-T42 meta は title = japanese_intro_text・size_bytes・ISO の saved_at、episode は audio_url が空の DTO', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-24T01:02:03.000Z'))
    const t = setup()
    await t.library.save('p1')
    const bucket = await bucketOf(t.caches)
    const meta: unknown = await (await bucket.match(META_KEY))?.json()
    expect(meta).toEqual({
      id: 'p1',
      title: '導入文',
      duration_seconds: 120,
      size_bytes: 'audio-bytes'.length,
      saved_at: '2026-10-24T01:02:03.000Z',
    })
    const stored: unknown = await (await bucket.match(EPISODE_KEY))?.json()
    expect(stored).toEqual({ ...dto, audio_url: '' })
    expect(await (await bucket.match(AUDIO_KEY))?.text()).toBe('audio-bytes')
  })
})

describe('verifies: CI-T44 has は episode entry の有無だけ（web-contract-13・web-deriv-03）', () => {
  test('書込みの途中は false、flush 後に true', async () => {
    const t = setup()
    const bucket = await bucketOf(t.caches)
    bucket.deferPuts()
    const saving = t.library.save('p1')
    await settle()
    expect(await t.library.has('p1')).toBe(false)
    bucket.flushPuts()
    expect(await saving).toEqual({ ok: true, value: undefined })
    expect(await t.library.has('p1')).toBe(true)
  })

  test('meta と音声があっても episode が無ければ false', async () => {
    const t = setup()
    const bucket = await bucketOf(t.caches)
    await bucket.put(AUDIO_KEY, new Response('a'))
    await bucket.put(META_KEY, new Response('{}'))
    expect(await t.library.has('p1')).toBe(false)
    await bucket.put(EPISODE_KEY, new Response(JSON.stringify({ ...dto, audio_url: '' })))
    expect(await t.library.has('p1')).toBe(true)
  })
})

describe('verifies: CI-T43 save の失敗（web-dec-28・web-contract-13）', () => {
  test('再生可能でない Episode は not_playable で何も書かない', async () => {
    const t = setup()
    t.gateway.respond('GET', GET_PATH, { ok: true, value: { ...dto, status: 'processing', audio_url: '' } })
    const result = await t.library.save('p1')
    expect(result).toEqual({ ok: false, failure: { kind: 'not_playable' } })
    expect(await keysOf(await bucketOf(t.caches))).toEqual([])
    expect(await t.library.has('p1')).toBe(false)
  })

  test('gateway の失敗は download_failed（何も書かない）', async () => {
    const t = setup()
    t.gateway.respond('GET', GET_PATH, { ok: false, failure: { kind: 'server', status: 500 } })
    expect(await t.library.save('p1')).toEqual({
      ok: false,
      failure: { kind: 'download_failed', failure: { kind: 'server', status: 500 } },
    })
    expect(await keysOf(await bucketOf(t.caches))).toEqual([])
  })

  test('音声の download_failed はそのまま download_failed', async () => {
    const t = setup()
    t.caches.failUrl(AUDIO_URL, { kind: 'download_failed', failure: { kind: 'not_found' } })
    expect(await t.library.save('p1')).toEqual({
      ok: false,
      failure: { kind: 'download_failed', failure: { kind: 'not_found' } },
    })
    expect(await keysOf(await bucketOf(t.caches))).toEqual([])
  })

  test('音声の storage_full は storage_full', async () => {
    const t = setup()
    t.caches.failUrl(AUDIO_URL, { kind: 'storage_full' })
    expect(await t.library.save('p1')).toEqual({ ok: false, failure: { kind: 'storage_full' } })
  })

  test('meta の put が reject → storage_full、has は false', async () => {
    const t = setup()
    rejectPutFor(await bucketOf(t.caches), META_KEY)
    expect(await t.library.save('p1')).toEqual({ ok: false, failure: { kind: 'storage_full' } })
    expect(await t.library.has('p1')).toBe(false)
  })

  test('verifies: CI-T44 episode の put だけ reject → storage_full、has は false、音声と meta は残る', async () => {
    const t = setup()
    const bucket = await bucketOf(t.caches)
    rejectPutFor(bucket, EPISODE_KEY)
    expect(await t.library.save('p1')).toEqual({ ok: false, failure: { kind: 'storage_full' } })
    expect(await t.library.has('p1')).toBe(false)
    expect(await keysOf(bucket)).toEqual([AUDIO_KEY, META_KEY].sort())
  })
})

describe('verifies: CI-T43 size_bytes（web-dec-27）', () => {
  test('match が音声を返さなければ size_bytes は null', async () => {
    const t = setup()
    const bucket = await bucketOf(t.caches)
    vi.spyOn(bucket, 'match').mockResolvedValue(undefined)
    expect(await t.library.save('p1')).toEqual({ ok: true, value: undefined })
    vi.restoreAllMocks()
    const meta = (await (await bucket.match(META_KEY))?.json()) as { size_bytes: unknown }
    expect(meta.size_bytes).toBeNull()
  })

  test('blob() が reject しても save は成功し size_bytes は null', async () => {
    const t = setup()
    const bucket = await bucketOf(t.caches)
    const broken = new Response('x')
    vi.spyOn(broken, 'blob').mockRejectedValue(new Error('blob failed'))
    vi.spyOn(bucket, 'match').mockResolvedValue(broken)
    expect(await t.library.save('p1')).toEqual({ ok: true, value: undefined })
    vi.restoreAllMocks()
    const meta = (await (await bucket.match(META_KEY))?.json()) as { size_bytes: unknown }
    expect(meta.size_bytes).toBeNull()
  })
})

describe('verifies: CI-T43 重複 save（web-dec-08）', () => {
  test('同じ id の save を 2 回呼んでも 3 entry に収束し、どちらも ok', async () => {
    const t = setup()
    expect(await t.library.save('p1')).toEqual({ ok: true, value: undefined })
    expect(await t.library.save('p1')).toEqual({ ok: true, value: undefined })
    expect(await keysOf(await bucketOf(t.caches))).toHaveLength(3)
    expect(t.gateway.calls).toHaveLength(2)
    expect(await t.library.has('p1')).toBe(true)
  })
})

describe('verifies: CI-T45 get（web-deriv-19）', () => {
  test('保存済みなら blob URL の PlayableEpisode を返し、release で revoke する', async () => {
    const t = setup()
    await t.library.save('p1')
    const episode = await t.library.get('p1')
    expect(episode).not.toBeNull()
    if (episode === null) return
    expect(t.created).toHaveLength(1)
    expect(await t.created[0].text()).toBe('audio-bytes')
    expect(episode.kind).toBe('playable')
    expect(episode.id).toBe('p1')
    expect(episode.audioUrl).toBe('blob:test/1')
    expect(episode.label).toEqual({ title: '題名', intro: '導入文' })
    expect(episode.durationSeconds).toBe(120)
    expect(episode.serverPositionSeconds).toBe(30)
    expect(t.revoked).toEqual([])
    episode.audioHandle?.release()
    expect(t.revoked).toEqual(['blob:test/1'])
  })

  test('未保存は null で URL を作らない。episode か音声のどちらかが欠けても null', async () => {
    const t = setup()
    expect(await t.library.get('p1')).toBeNull()
    const bucket = await bucketOf(t.caches)
    await bucket.put(AUDIO_KEY, new Response('a'))
    expect(await t.library.get('p1')).toBeNull()
    await bucket.delete(AUDIO_KEY)
    await bucket.put(EPISODE_KEY, new Response(JSON.stringify({ ...dto, audio_url: '' })))
    expect(await t.library.get('p1')).toBeNull()
    expect(t.created).toHaveLength(0)
  })

  test('旧実装が書いた entry（meta に size_bytes・saved_at が無い）を読める', async () => {
    const t = setup()
    await writeLegacyEntries(await bucketOf(t.caches), 'old1')
    expect(await t.library.has('old1')).toBe(true)
    const episode = await t.library.get('old1')
    expect(episode?.kind).toBe('playable')
    expect(episode?.id).toBe('old1')
    expect(episode?.audioUrl).toBe('blob:test/1')
    expect(episode?.label).toEqual({ title: '題名', intro: '導入文' })
  })

  test('再生可能でなければ作った blob URL を revoke して null', async () => {
    const t = setup()
    await writeLegacyEntries(await bucketOf(t.caches), 'bad1', { status: 'processing' })
    expect(await t.library.get('bad1')).toBeNull()
    expect(t.created).toHaveLength(1)
    expect(t.revoked).toEqual(['blob:test/1'])
  })
})

describe('verifies: CI-T46 remove・clear・clearOfflineAudio（web-deriv-10）', () => {
  test('remove は 3 key を delete し、未保存でも例外を投げない', async () => {
    const t = setup()
    await t.library.save('p1')
    const bucket = await bucketOf(t.caches)
    const del = vi.spyOn(bucket, 'delete')
    await t.library.remove('p1')
    expect(del.mock.calls.map((c) => c[0]).sort()).toEqual([AUDIO_KEY, EPISODE_KEY, META_KEY].sort())
    expect(await keysOf(bucket)).toEqual([])
    await expect(t.library.remove('p1')).resolves.toBeUndefined()
  })

  test('clear は cacheStore.delete(audio-v1) を 1 回呼ぶ', async () => {
    const t = setup()
    await t.library.save('p1')
    const del = vi.spyOn(t.caches, 'delete')
    await t.library.clear()
    expect(del.mock.calls).toEqual([[CACHE]])
    expect(await t.caches.has(CACHE)).toBe(false)
  })

  test('clearOfflineAudio も delete(audio-v1) を 1 回。null なら何もしない', async () => {
    const t = setup()
    await t.library.save('p1')
    const del = vi.spyOn(t.caches, 'delete')
    await clearOfflineAudio(t.caches)
    expect(del.mock.calls).toEqual([[CACHE]])
    await expect(clearOfflineAudio(null)).resolves.toBeUndefined()
  })
})

describe('verifies: CI-T47 list（web-dec-27）', () => {
  test('新旧の meta を OfflineEpisodeView に写す（旧は sizeBytes・savedAt が null）', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-24T01:02:03.000Z'))
    const t = setup()
    await t.library.save('p1')
    await writeLegacyEntries(await bucketOf(t.caches), 'old1')
    const views = [...(await t.library.list())].sort((a, b) => a.episodeId.localeCompare(b.episodeId))
    expect(views).toEqual([
      { episodeId: 'old1', title: '導入文', durationSeconds: 120, sizeBytes: null, savedAt: null },
      {
        episodeId: 'p1',
        title: '導入文',
        durationSeconds: 120,
        sizeBytes: 'audio-bytes'.length,
        savedAt: '2026-10-24T01:02:03.000Z',
      },
    ])
  })

  test('列挙後に消えた entry・parse できない entry は飛ばし、例外を投げない', async () => {
    const t = setup()
    await t.library.save('p1')
    const bucket = await bucketOf(t.caches)
    await bucket.put('/_audio-meta/broken', new Response('not json'))
    const realKeys = await bucket.keys()
    vi.spyOn(bucket, 'keys').mockResolvedValue([...realKeys, { url: '/_audio-meta/ghost' }])
    const views = await t.library.list()
    expect(views.map((v) => v.episodeId)).toEqual(['p1'])
  })
})

describe('verifies: CI-T48 usage（web-contract-13）', () => {
  test('estimate の値を StorageUsageView にして返す。null は null', async () => {
    const withUsage = setup({ usage: { usage: 10, quota: 100 } })
    expect(await withUsage.library.usage()).toEqual({ usage: 10, quota: 100 })
    const without = setup({ usage: null })
    expect(await without.library.usage()).toBeNull()
  })
})

describe('verifies: CI-T49 cacheStore が null のときの 7 操作（web-deriv-07）', () => {
  test('既定値を返し、例外を投げない', async () => {
    const gateway = createGatewayDouble()
    gateway.respond('GET', GET_PATH, { ok: true, value: dto })
    const created: Blob[] = []
    const library = createOfflineLibrary({
      cacheStore: null,
      gateway,
      objectUrl: {
        create: (blob) => {
          created.push(blob)
          return 'blob:never'
        },
        revoke: () => undefined,
      },
      estimate: () => Promise.resolve({ usage: 1, quota: 2 }),
    })
    expect(await library.save('p1')).toEqual({ ok: false, failure: { kind: 'unsupported' } })
    expect(await library.has('p1')).toBe(false)
    expect(await library.get('p1')).toBeNull()
    expect(await library.list()).toEqual([])
    await expect(library.remove('p1')).resolves.toBeUndefined()
    await expect(library.clear()).resolves.toBeUndefined()
    expect(await library.usage()).toEqual({ usage: 1, quota: 2 })
    expect(created).toHaveLength(0)
  })
})
