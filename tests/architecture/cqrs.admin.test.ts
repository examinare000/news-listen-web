// @vitest-environment node
// Admin の query と command の分離（web-check-07）。本 slice の分: web-query-admin-01〜04、web-cmd-admin-01〜09。
// (a) AdminQueries の入口の名前の集合 = 4（listUsers・listInvites・listFeaturedSites・getMetrics）と、AdminCommands の入口 = 9
//     （createUser・updateUser・deleteUser・createInvite・revokeInvite・createFeaturedSite・updateFeaturedSite・deleteFeaturedSite・reorderFeaturedSites）。
//     型の等価と実行時の両方で過不足なく一致する。
// (b) 呼出を記録する手書きの AdminGateway の fake を渡し、query を全部呼んでも書込系 8 method は 1 回も呼ばれない。command を全部呼んでも読込系 4 method は呼ばれない。
// (c) command の戻り値の型: createInvite は receipt、reorderFeaturedSites は { moved }、他は void。
// 型の等価は `npm run typecheck` が検査する。実行時の検査は vitest が行う。
// createAdminGateway・createGatewayDouble は import しない（unit が infrastructure を値で import すると forbiddenDependency になる）。
// readModels・ports は `import type` に限る。
//
// RED 理由（実装前）: `@/lib/admin/application/commands`・`queries` が無い（module not found）。
import { describe, expect, test } from 'vitest'
import { createAdminCommands } from '@/lib/admin/application/commands'
import type { AdminCommands } from '@/lib/admin/application/commands'
import { createAdminQueries } from '@/lib/admin/application/queries'
import type { AdminQueries } from '@/lib/admin/application/queries'
import type { AdminGateway } from '@/lib/admin/application/ports'
import type { InviteReceipt } from '@/lib/admin/application/readModels'
import type { ApiFailure } from '@/lib/shared/apiFailure'
import type { Result } from '@/lib/shared/result'

// ---------------------------------------------------------------------------
// 型の等価（実行しない。typecheck だけが読む）
// ---------------------------------------------------------------------------
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

type QueryNames = 'listUsers' | 'listInvites' | 'listFeaturedSites' | 'getMetrics'
type CommandNames =
  | 'createUser'
  | 'updateUser'
  | 'deleteUser'
  | 'createInvite'
  | 'revokeInvite'
  | 'createFeaturedSite'
  | 'updateFeaturedSite'
  | 'deleteFeaturedSite'
  | 'reorderFeaturedSites'

function typeProbes(queries: AdminQueries, commands: AdminCommands): void {
  const queryKeys: Equals<keyof AdminQueries, QueryNames> = true
  const queryDepKeys: Equals<keyof Parameters<typeof createAdminQueries>[0], 'gateway'> = true
  const commandKeys: Equals<keyof AdminCommands, CommandNames> = true
  const commandDepKeys: Equals<keyof Parameters<typeof createAdminCommands>[0], 'gateway'> = true
  const invite: Equals<ReturnType<AdminCommands['createInvite']>, Promise<Result<InviteReceipt, ApiFailure>>> = true
  const reorder: Equals<
    ReturnType<AdminCommands['reorderFeaturedSites']>,
    Promise<Result<{ readonly moved: boolean }, ApiFailure>>
  > = true
  const create: Equals<ReturnType<AdminCommands['createUser']>, Promise<Result<void, ApiFailure>>> = true
  void [queries, commands, queryKeys, queryDepKeys, commandKeys, commandDepKeys, invite, reorder, create]
}
void typeProbes

// ---------------------------------------------------------------------------
// 呼出を記録する fake（書込系も記録してから返す。記録しなければ (b) に識別力が無い）
// ---------------------------------------------------------------------------
const READ_CALLS: ReadonlySet<string> = new Set(['listUsers', 'listInvites', 'listFeaturedSites', 'getMetrics'])
const WRITE_CALLS = [
  'createUser',
  'updateUser',
  'deleteUser',
  'createInvite',
  'revokeInvite',
  'createFeaturedSite',
  'updateFeaturedSite',
  'deleteFeaturedSite',
]
const ALL_METHODS = [...READ_CALLS, ...WRITE_CALLS].sort()

const OK_VOID = { ok: true, value: undefined } as const
const METRICS = {
  date: '2026-11-01',
  d7: { rate: null, retained: null, eligible: null },
  d30: { rate: null, retained: null, eligible: null },
  completion: { rateStarted: null, rateDelivered: null },
  weeklyStar: { avgPerActiveUser: null },
}

function harness() {
  const calls: string[] = []
  const record = <T>(name: string, value: T) => () => {
    calls.push(name)
    return Promise.resolve(value)
  }
  const gateway: AdminGateway = {
    listUsers: record('listUsers', { ok: true, value: [] }),
    createUser: record('createUser', OK_VOID),
    updateUser: record('updateUser', OK_VOID),
    deleteUser: record('deleteUser', OK_VOID),
    listInvites: record('listInvites', { ok: true, value: [] }),
    createInvite: record('createInvite', { ok: true, value: { id: 'i1', code: 'CODE', inviteUrl: 'https://example.com/i' } }),
    revokeInvite: record('revokeInvite', OK_VOID),
    listFeaturedSites: record('listFeaturedSites', { ok: true, value: [] }),
    createFeaturedSite: record('createFeaturedSite', OK_VOID),
    updateFeaturedSite: record('updateFeaturedSite', OK_VOID),
    deleteFeaturedSite: record('deleteFeaturedSite', OK_VOID),
    getMetrics: record('getMetrics', { ok: true, value: METRICS }),
  }
  return { queries: createAdminQueries({ gateway }), commands: createAdminCommands({ gateway }), calls, gateway }
}

// ---------------------------------------------------------------------------
// (a) 名前の集合
// ---------------------------------------------------------------------------
describe('web-check-07 (a) query 4 つは過不足なく公開される', () => {
  test('web-check-07, web-query-admin-01 — 戻り値の key は listUsers・listInvites・listFeaturedSites・getMetrics の 4 つだけで、すべて関数', () => {
    const { queries } = harness()
    const names: readonly QueryNames[] = ['listUsers', 'listInvites', 'listFeaturedSites', 'getMetrics']

    expect(names).toHaveLength(4)
    expect(Object.keys(queries).sort()).toEqual([...names].sort())
    for (const name of names) expect(typeof queries[name], name).toBe('function')
  })
})

describe('web-check-07 (a) command 9 つは過不足なく公開される', () => {
  test('web-check-07, web-cmd-admin-01 — 戻り値の key は 9 つの command だけで、すべて関数', () => {
    const { commands } = harness()
    const names: readonly CommandNames[] = [
      'createUser',
      'updateUser',
      'deleteUser',
      'createInvite',
      'revokeInvite',
      'createFeaturedSite',
      'updateFeaturedSite',
      'deleteFeaturedSite',
      'reorderFeaturedSites',
    ]

    expect(names).toHaveLength(9)
    expect(Object.keys(commands).sort()).toEqual([...names].sort())
    for (const name of names) expect(typeof commands[name], name).toBe('function')
  })
})

// ---------------------------------------------------------------------------
// (b) query は読むだけ、command は読まない
// ---------------------------------------------------------------------------
describe('web-check-07 (b) 読み書きの分離', () => {
  test('web-cmd-admin-04 — 正方向対照: createInvite を呼べば fake に createInvite が 1 回だけ記録され、receipt の key は 3 つ', async () => {
    const { commands, calls } = harness()

    const result = await commands.createInvite({ note: undefined, maxUses: undefined, expiresInDays: undefined })

    expect(calls).toEqual(['createInvite'])
    expect(result.ok && Object.keys(result.value).sort()).toEqual(['code', 'id', 'inviteUrl'])
  })

  test('web-check-07 — query 4 つを全部呼んでも、書込系 8 method の記録は 0 件で、記録は読込系 4 件だけ', async () => {
    const { queries, calls, gateway } = harness()

    await queries.listUsers()
    await queries.listInvites()
    await queries.listFeaturedSites()
    await queries.getMetrics()

    expect([...calls].sort()).toEqual([...READ_CALLS].sort())
    for (const name of WRITE_CALLS) expect(calls).not.toContain(name)
    // fake は 12 method を持ち（書込系も記録する形で用意している）、query が呼べば記録に残る
    expect(Object.keys(gateway).sort()).toEqual(ALL_METHODS)
  })

  test('web-check-07 — command 9 つを全部呼んでも、読込系 4 method の記録は 0 件（並べ替えは送る行が 1 行以上ある入力）', async () => {
    const { commands, calls } = harness()
    const site = (id: string, order: number) => ({
      id,
      name: id,
      url: `https://example.com/${id}`,
      thumbnailUrl: '',
      description: '',
      category: 'tech' as const,
      order,
    })
    const sites = [site('a', 0), site('b', 1)]
    const input = { name: 'n', url: 'https://example.com', thumbnailUrl: undefined, description: undefined, category: 'tech' } as const

    await commands.createUser({ username: 'u', password: 'p', displayName: undefined, role: 'user' })
    await commands.updateUser('u', { role: 'admin' })
    await commands.deleteUser('u')
    await commands.createInvite({ note: undefined, maxUses: undefined, expiresInDays: undefined })
    await commands.revokeInvite('i')
    await commands.createFeaturedSite(sites, input)
    await commands.updateFeaturedSite(sites, 'a', input)
    await commands.deleteFeaturedSite('a')
    await commands.reorderFeaturedSites(sites, 'a', 'down')

    for (const name of READ_CALLS) expect(calls, name).not.toContain(name)
    expect(calls.filter((name) => name === 'updateFeaturedSite').length).toBeGreaterThan(1)
    expect(new Set(calls)).toEqual(new Set(WRITE_CALLS))
  })
})
