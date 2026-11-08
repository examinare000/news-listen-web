// Admin の command（web-cmd-admin-01〜09）。gateway の書込 method を同じ引数で 1 回呼び、結果の Result をそのまま返す。
// 並べ替え（web-cmd-admin-09・web-dec-134）は reorderDiff が返した行を、順に 1 行ずつ await して全 field の body で送り、最初の失敗で止める。
// password は command で検査しない（web-dec-137: 検査は page の validatePassword が担う）。
// fake の gateway は各テストの中で手書きし、呼出を引数つきで順に記録する。category は値域内の文字列リテラルで書く。
//
// RED 理由（実装前）: `@/lib/admin/application/commands` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createAdminCommands } from '@/lib/admin/application/commands'
import type { AdminGateway } from '@/lib/admin/application/ports'
import type { FeaturedSiteRow } from '@/lib/admin/application/readModels'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

type Call = { readonly name: string; readonly args: ReadonlyArray<unknown> }
type Responder = (call: Call, index: number) => Promise<Result<unknown, ApiFailure>>

const OK: Result<unknown, ApiFailure> = { ok: true, value: undefined }
const RECEIPT_RECORD = { id: 'i1', code: 'CODE', inviteUrl: 'https://example.com/invite/CODE' }

function harness(responder?: Responder) {
  const calls: Call[] = []
  const NAMES = [
    'listUsers',
    'createUser',
    'updateUser',
    'deleteUser',
    'listInvites',
    'createInvite',
    'revokeInvite',
    'listFeaturedSites',
    'createFeaturedSite',
    'updateFeaturedSite',
    'deleteFeaturedSite',
    'getMetrics',
  ] as const
  const gateway = Object.fromEntries(
    NAMES.map((name) => [
      name,
      (...args: unknown[]) => {
        const call: Call = { name, args }
        calls.push(call)
        if (responder) return responder(call, calls.length - 1)
        return Promise.resolve(name === 'createInvite' ? { ok: true, value: RECEIPT_RECORD } : OK)
      },
    ]),
  ) as unknown as AdminGateway
  return { commands: createAdminCommands({ gateway }), calls }
}

const site = (id: string, order: number): FeaturedSiteRow => ({
  id,
  name: `name-${id}`,
  url: `https://example.com/${id}`,
  thumbnailUrl: `https://example.com/${id}.png`,
  description: `desc-${id}`,
  category: 'sports',
  order,
})
const INPUT = { name: 'N', url: 'https://example.com', thumbnailUrl: undefined, description: undefined, category: 'culture' } as const
const CONFLICT = { ok: false, failure: { kind: 'conflict' } } as const

describe('web-cmd-admin-01 createUser', () => {
  test('gateway.createUser を同じ値で 1 回呼び、成功は { ok: true, value: undefined }', async () => {
    const { commands, calls } = harness()
    const input = { username: 'bob', password: 'longenough1', displayName: 'Bob', role: 'user' } as const

    const result = await commands.createUser(input)

    expect(calls).toEqual([{ name: 'createUser', args: [input] }])
    expect(result).toEqual({ ok: true, value: undefined })
  })

  test('web-dec-137 — password が短くても検査せず gateway を 1 回呼ぶ（検査は page の責務）', async () => {
    const { commands, calls } = harness()

    await commands.createUser({ username: 'bob', password: 'short', displayName: undefined, role: 'user' })

    expect(calls.map((c) => c.name)).toEqual(['createUser'])
  })
})

describe('web-cmd-admin-02 updateUser', () => {
  test('gateway.updateUser を同じ引数で 1 回呼ぶ', async () => {
    const { commands, calls } = harness()

    await commands.updateUser('bob', { role: 'admin' })

    expect(calls).toEqual([{ name: 'updateUser', args: ['bob', { role: 'admin' }] }])
  })
})

describe('web-cmd-admin-03 / web-cmd-admin-05 / web-cmd-admin-08 deleteUser・revokeInvite・deleteFeaturedSite', () => {
  test('deleteUser・revokeInvite・deleteFeaturedSite は、それぞれ同名の gateway method を同じ引数で 1 回呼ぶ', async () => {
    const { commands, calls } = harness()

    await commands.deleteUser('bob')
    await commands.revokeInvite('i1')
    await commands.deleteFeaturedSite('s1')

    expect(calls).toEqual([
      { name: 'deleteUser', args: ['bob'] },
      { name: 'revokeInvite', args: ['i1'] },
      { name: 'deleteFeaturedSite', args: ['s1'] },
    ])
  })
})

describe('web-cmd-admin-04 createInvite', () => {
  test('gateway.createInvite を入力のまま 1 回呼び、receipt は id・code・inviteUrl の 3 key だけで凍結して返す', async () => {
    const polluted = { ...RECEIPT_RECORD, note: 'leak', maxUses: 9 }
    const { commands, calls } = harness((call) => Promise.resolve({ ok: true, value: call.name === 'createInvite' ? polluted : undefined }))
    const input = { note: 'memo', maxUses: 3, expiresInDays: undefined }

    const result = await commands.createInvite(input)

    expect(calls).toEqual([{ name: 'createInvite', args: [input] }])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(Object.keys(result.value).sort()).toEqual(['code', 'id', 'inviteUrl'])
    expect(result.value).toEqual(RECEIPT_RECORD)
    expect(Object.isFrozen(result.value)).toBe(true)
  })
})

describe('web-cmd-admin-06 createFeaturedSite', () => {
  test('既存が空なら order は 0', async () => {
    const { commands, calls } = harness()

    await commands.createFeaturedSite([], INPUT)

    expect(calls).toEqual([{ name: 'createFeaturedSite', args: [{ ...INPUT, order: 0 }] }])
  })

  test('既存の最大 order + 1（[0,3] なら 4）', async () => {
    const { commands, calls } = harness()

    await commands.createFeaturedSite([site('a', 0), site('b', 3)], INPUT)

    expect(calls[0].args).toEqual([{ ...INPUT, order: 4 }])
  })
})

describe('web-cmd-admin-07 updateFeaturedSite', () => {
  test('既存の order を引き継いで gateway.updateFeaturedSite を 1 回呼ぶ', async () => {
    const { commands, calls } = harness()

    await commands.updateFeaturedSite([site('x', 5)], 'x', INPUT)

    expect(calls).toEqual([{ name: 'updateFeaturedSite', args: ['x', { ...INPUT, order: 5 }] }])
  })

  test('sites に無い id なら order は 0', async () => {
    const { commands, calls } = harness()

    await commands.updateFeaturedSite([site('x', 5)], 'zzz', INPUT)

    expect(calls[0].args).toEqual(['zzz', { ...INPUT, order: 0 }])
  })
})

describe('web-cmd-admin-09 / web-dec-134 reorderFeaturedSites', () => {
  const dup = [site('a', 0), site('b', 1), site('c', 1), site('d', 3)]

  test('重複 [a:0,b:1,c:1,d:3] の a を down: b・a・c の順に 3 回、全 field の body（order = index）で送り、{ moved: true }', async () => {
    const { commands, calls } = harness()

    const result = await commands.reorderFeaturedSites(dup, 'a', 'down')

    expect(result).toEqual({ ok: true, value: { moved: true } })
    expect(calls.map((c) => c.name)).toEqual(['updateFeaturedSite', 'updateFeaturedSite', 'updateFeaturedSite'])
    expect(calls.map((c) => c.args[0])).toEqual(['b', 'a', 'c'])
    expect(calls.map((c) => c.args[1])).toEqual([
      { name: 'name-b', url: 'https://example.com/b', thumbnailUrl: 'https://example.com/b.png', description: 'desc-b', category: 'sports', order: 0 },
      { name: 'name-a', url: 'https://example.com/a', thumbnailUrl: 'https://example.com/a.png', description: 'desc-a', category: 'sports', order: 1 },
      { name: 'name-c', url: 'https://example.com/c', thumbnailUrl: 'https://example.com/c.png', description: 'desc-c', category: 'sports', order: 2 },
    ])
  })

  test('row の thumbnailUrl・description が空文字なら body では undefined、category は row のまま', async () => {
    const { commands, calls } = harness()
    const sites = [{ ...site('a', 0), thumbnailUrl: '', description: '', category: 'culture' as const }, site('b', 1)]

    await commands.reorderFeaturedSites(sites, 'a', 'down')

    const bodyOfA = calls.find((c) => c.args[0] === 'a')?.args[1]
    expect(bodyOfA).toEqual({ name: 'name-a', url: 'https://example.com/a', thumbnailUrl: undefined, description: undefined, category: 'culture', order: 1 })
    expect(bodyOfA).toHaveProperty('thumbnailUrl', undefined)
  })

  test('2 回目が ok:false なら 3 回目を送らず、その失敗を同じ参照で返す', async () => {
    const { commands, calls } = harness((_call, index) => Promise.resolve(index === 1 ? CONFLICT : OK))

    const result = await commands.reorderFeaturedSites(dup, 'a', 'down')

    expect(calls).toHaveLength(2)
    expect(result).toBe(CONFLICT)
  })

  test('2 回目が reject なら 3 回目を送らず、同じ理由で reject する', async () => {
    const error = new Error('boom')
    const { commands, calls } = harness((_call, index) => (index === 1 ? Promise.reject(error) : Promise.resolve(OK)))

    await expect(commands.reorderFeaturedSites(dup, 'a', 'down')).rejects.toBe(error)
    expect(calls).toHaveLength(2)
  })

  test('先頭で up・末尾で down・無い id は、gateway を呼ばず { moved: false }', async () => {
    const { commands, calls } = harness()
    const sites = [site('a', 0), site('b', 1)]

    expect(await commands.reorderFeaturedSites(sites, 'a', 'up')).toEqual({ ok: true, value: { moved: false } })
    expect(await commands.reorderFeaturedSites(sites, 'b', 'down')).toEqual({ ok: true, value: { moved: false } })
    expect(await commands.reorderFeaturedSites(sites, 'zzz', 'up')).toEqual({ ok: true, value: { moved: false } })
    expect(calls).toEqual([])
  })

  test('入れ替えても全行が order = index なら、gateway を呼ばず { moved: true }', async () => {
    const { commands, calls } = harness()

    const result = await commands.reorderFeaturedSites([site('a', 1), site('b', 0)], 'a', 'down')

    expect(calls).toEqual([])
    expect(result).toEqual({ ok: true, value: { moved: true } })
  })

  test('逐次: 1 回目の PUT が決着するまで 2 回目を送らない（並列に送らない）', async () => {
    let release: (value: Result<unknown, ApiFailure>) => void = () => undefined
    const first = new Promise<Result<unknown, ApiFailure>>((resolve) => {
      release = resolve
    })
    const { commands, calls } = harness((_call, index) => (index === 0 ? first : Promise.resolve(OK)))

    const pending = commands.reorderFeaturedSites(dup, 'a', 'down')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(calls).toHaveLength(1)

    release(OK)
    await pending
    expect(calls).toHaveLength(3)
  })
})

describe('web-cmd-admin-01 〜 web-cmd-admin-09 失敗と reject の共通契約', () => {
  test('gateway が ok:false を返す command は、その失敗を同じ参照で返す（void・createInvite・featured 3 種・reorder）', async () => {
    const { commands } = harness(() => Promise.resolve(CONFLICT))
    const sites = [site('a', 0), site('b', 1)]

    expect(await commands.createUser({ username: 'u', password: 'p', displayName: undefined, role: 'user' })).toBe(CONFLICT)
    expect(await commands.updateUser('u', { role: 'admin' })).toBe(CONFLICT)
    expect(await commands.deleteUser('u')).toBe(CONFLICT)
    expect(await commands.revokeInvite('i')).toBe(CONFLICT)
    expect(await commands.deleteFeaturedSite('s')).toBe(CONFLICT)
    expect(await commands.createInvite({ note: undefined, maxUses: undefined, expiresInDays: undefined })).toBe(CONFLICT)
    expect(await commands.createFeaturedSite(sites, INPUT)).toBe(CONFLICT)
    expect(await commands.updateFeaturedSite(sites, 'a', INPUT)).toBe(CONFLICT)
    expect(await commands.reorderFeaturedSites(sites, 'a', 'down')).toBe(CONFLICT)
  })

  test('gateway が reject したら、握りつぶさず（ok:false にも変えず）同じ理由で reject する', async () => {
    const error = new Error('boom')
    const { commands } = harness(() => Promise.reject(error))
    const sites = [site('a', 0), site('b', 1)]

    await expect(commands.createUser({ username: 'u', password: 'p', displayName: undefined, role: 'user' })).rejects.toBe(error)
    await expect(commands.updateUser('u', { role: 'admin' })).rejects.toBe(error)
    await expect(commands.deleteUser('u')).rejects.toBe(error)
    await expect(commands.revokeInvite('i')).rejects.toBe(error)
    await expect(commands.deleteFeaturedSite('s')).rejects.toBe(error)
    await expect(commands.createInvite({ note: undefined, maxUses: undefined, expiresInDays: undefined })).rejects.toBe(error)
    await expect(commands.createFeaturedSite(sites, INPUT)).rejects.toBe(error)
    await expect(commands.updateFeaturedSite(sites, 'a', INPUT)).rejects.toBe(error)
    await expect(commands.reorderFeaturedSites(sites, 'a', 'down')).rejects.toBe(error)
  })
})
