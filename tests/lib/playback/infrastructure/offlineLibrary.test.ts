// オフライン保存庫の契約テスト（web-contract-13・web-spec/capsule-03・web-rule-playback-10）。
// Cache は MockCacheStorage、gateway は gatewayDouble、blob URL と見積もりは関数 double。
// Cache 名は主体別 audio-v1-{user_id}（ADR-104 決定 2・9 / web-dec-74）。旧名 audio-v1 は読まない。key 3 種と旧 meta（size_bytes・saved_at 無し）は主体別の Cache の中でも読める。
//
// RED 理由: audioCacheName・deleteSubjectAudio・reclaimAudioCaches が未実装で、OfflineLibraryDeps に currentUserId が無い。
import { describe, test, expect, vi, afterEach } from 'vitest'
import {
  audioCacheName,
  createOfflineLibrary,
  deleteSubjectAudio,
  reclaimAudioCaches,
} from '@/lib/playback/infrastructure/offlineLibrary'
import type { CacheBucket } from '@/lib/platform/cacheStore'
import type { Podcast } from '@/types'
import { createGatewayDouble } from '../../../helpers/gatewayDouble'
import { MockCacheStorage } from '../../../helpers/mockCaches'

const USER = 'u-a'
const CACHE = `audio-v1-${USER}`
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

function setup(options: { usage?: { usage: number; quota: number } | null; currentUserId?: () => string | null } = {}) {
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
    currentUserId: options.currentUserId ?? (() => USER),
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

describe('verifies: CI-T46 remove・clear・deleteSubjectAudio（web-deriv-10）', () => {
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

  test('web-dec-74: clear は cacheStore.delete(audio-v1-{user_id}) を 1 回呼ぶ', async () => {
    const t = setup()
    await t.library.save('p1')
    const del = vi.spyOn(t.caches, 'delete')
    await t.library.clear()
    expect(del.mock.calls).toEqual([[CACHE]])
    expect(await t.caches.has(CACHE)).toBe(false)
  })

  test('web-dec-74: deleteSubjectAudio は delete(audio-v1-{user_id}) を 1 回。null の cacheStore なら何もしない', async () => {
    const t = setup()
    await t.library.save('p1')
    const del = vi.spyOn(t.caches, 'delete')
    await deleteSubjectAudio(t.caches, USER)
    expect(del.mock.calls).toEqual([[CACHE]])
    await expect(deleteSubjectAudio(null, USER)).resolves.toBeUndefined()
  })

  test('web-dec-74: deleteSubjectAudio は delete の reject をそのまま伝える', async () => {
    const t = setup()
    vi.spyOn(t.caches, 'delete').mockRejectedValue(new Error('delete failed'))
    await expect(deleteSubjectAudio(t.caches, USER)).rejects.toThrow('delete failed')
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
      currentUserId: () => USER,
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

describe('web-dec-74 audioCacheName（ADR-104 決定 2）', () => {
  test('audio-v1-{user_id} を返す', () => {
    expect(audioCacheName('u-a')).toBe('audio-v1-u-a')
  })
})

describe('web-dec-74 主体別 Cache（ADR-104 決定 2・9）', () => {
  test('save・has・get・list・remove の entry はすべて audio-v1-{user_id} にあり、固定名 audio-v1 は作られない', async () => {
    const t = setup()
    expect(await t.library.save('p1')).toEqual({ ok: true, value: undefined })
    expect(await t.caches.keys()).toEqual(['audio-v1-u-a'])
    expect(await t.library.has('p1')).toBe(true)
    expect((await t.library.get('p1'))?.id).toBe('p1')
    expect((await t.library.list()).map((v) => v.episodeId)).toEqual(['p1'])
    await t.library.remove('p1')
    expect(await t.library.has('p1')).toBe(false)
    expect(await t.caches.has('audio-v1')).toBe(false)
  })

  test('別の主体の Cache の entry は見えない（主体の交差 0）', async () => {
    const t = setup({ currentUserId: () => 'u-b' })
    const bucketOfA = await t.caches.open('audio-v1-u-a')
    await writeLegacyEntries(bucketOfA, 'a-only')
    expect(await t.library.has('a-only')).toBe(false)
    expect(await t.library.get('a-only')).toBeNull()
    expect(await t.library.list()).toEqual([])
  })

  test('旧名 audio-v1 の entry は読まない', async () => {
    const t = setup()
    await writeLegacyEntries(await t.caches.open('audio-v1'), 'old1')
    expect(await t.library.has('old1')).toBe(false)
    expect(await t.library.get('old1')).toBeNull()
    expect(await t.library.list()).toEqual([])
  })
})

describe('shared-leave-06 離脱後に完了した save は開始時の主体の Cache に入る', () => {
  test('保存の途中で currentUserId が替わっても 3 entry は audio-v1-u-a に入り、次回の回収の後に audio-v1-u-a は存在しない', async () => {
    let current: string | null = 'u-a'
    const t = setup({ currentUserId: () => current })
    const bucketA = await t.caches.open('audio-v1-u-a')
    bucketA.deferPuts()

    const saving = t.library.save('p1')
    await settle()
    current = 'u-b'
    bucketA.flushPuts()
    expect(await saving).toEqual({ ok: true, value: undefined })

    expect(await keysOf(bucketA)).toEqual([AUDIO_KEY, EPISODE_KEY, META_KEY].sort())
    expect(await t.caches.has('audio-v1-u-b')).toBe(false)

    await reclaimAudioCaches(t.caches, () => current)
    expect(await t.caches.has('audio-v1-u-a')).toBe(false)
  })
})

describe('shared-leave-10 currentUserId が null のとき保存庫は無効', () => {
  test('save は unsupported、get は null、has は false、list は空、remove・clear は Cache の集合を変えず、usage は主体に依らない', async () => {
    let current: string | null = 'u-a'
    const t = setup({ usage: { usage: 3, quota: 9 }, currentUserId: () => current })
    await t.library.save('p1')
    const namesBefore = await t.caches.keys()
    const entriesBefore = await keysOf(await t.caches.open('audio-v1-u-a'))
    current = null

    expect(await t.library.save('p2')).toEqual({ ok: false, failure: { kind: 'unsupported' } })
    expect(await t.library.get('p1')).toBeNull()
    expect(await t.library.has('p1')).toBe(false)
    expect(await t.library.list()).toEqual([])
    await t.library.remove('p1')
    await t.library.clear()
    expect(await t.library.usage()).toEqual({ usage: 3, quota: 9 })

    expect(await t.caches.keys()).toEqual(namesBefore)
    expect(await keysOf(await t.caches.open('audio-v1-u-a'))).toEqual(entriesBefore)
    expect(t.gateway.calls).toHaveLength(1)
  })
})

describe('shared-leave-08 reclaimAudioCaches（ADR-104 決定 7・8）', () => {
  async function seed() {
    const caches = new MockCacheStorage()
    for (const name of ['audio-v1', 'audio-v1-u-a', 'audio-v1-u-b', 'audio-v10', 'shell-pages-v1', 'api-v1']) {
      await caches.open(name)
    }
    return caches
  }

  test('keep が u-a を返すと、audio-v1（旧名）と他の主体の Cache だけが消える', async () => {
    const caches = await seed()
    await reclaimAudioCaches(caches, () => 'u-a')
    expect((await caches.keys()).sort()).toEqual(['api-v1', 'audio-v1-u-a', 'audio-v10', 'shell-pages-v1'])
  })

  test('keep が null（未認証・形式不正）なら audio-v1 と audio-v1-* がすべて消え、audio-v10・shell-*・api-* は残る。2 回目は削除 0 回', async () => {
    const caches = await seed()
    await reclaimAudioCaches(caches, () => null)
    expect((await caches.keys()).sort()).toEqual(['api-v1', 'audio-v10', 'shell-pages-v1'])
    const del = vi.spyOn(caches, 'delete')
    await reclaimAudioCaches(caches, () => null)
    expect(del).not.toHaveBeenCalled()
  })

  test('cacheStore が null なら resolve し、keep は呼ばれない', async () => {
    const keep = vi.fn(() => 'u-a')
    await expect(reclaimAudioCaches(null, keep)).resolves.toBeUndefined()
    expect(keep).not.toHaveBeenCalled()
  })

  test('web-dec-85: 掃除の途中で keep が u-b に替わると audio-v1-u-b は残る。keep は各削除の直前に 1 回ずつ、keys は 1 回だけ列挙する', async () => {
    const caches = new MockCacheStorage()
    await caches.open('audio-v1')
    await caches.open('audio-v1-u-b')
    let keepValue: string | null = null
    const keep = vi.fn(() => keepValue)
    const keys = vi.spyOn(caches, 'keys').mockResolvedValue(['audio-v1', 'audio-v1-u-b'])
    const realDelete = caches.delete.bind(caches)
    let deleteCalls = 0
    vi.spyOn(caches, 'delete').mockImplementation(async (name) => {
      deleteCalls += 1
      // 1 回目の削除の最中に B がログインして保存した状態を再現する
      if (deleteCalls === 1) keepValue = 'u-b'
      return realDelete(name)
    })

    await reclaimAudioCaches(caches, keep)

    expect(await caches.has('audio-v1')).toBe(false)
    expect(await caches.has('audio-v1-u-b')).toBe(true)
    expect(keep).toHaveBeenCalledTimes(2)
    expect(keys).toHaveBeenCalledTimes(1)
  })
})
