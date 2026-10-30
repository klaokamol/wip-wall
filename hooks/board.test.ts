import { expect, test } from 'claude-code/testing'

import { THEMES } from './themes'
import { titleOf, ageOf, groupsOf, isDone, rankOf, reposOf, statusOf, statusesOf, tabTitleOf, toCards, viewOf, boardOrder, rankIn, withinDays, dueOf, clip, mrSummary, titleLines, widthOf, mrOfGraphql, fromNdjson, mentionsOf, dirsOf, dirOf, projectOf, isWebUrl, clean, paneOf, reviewsOf, staleHides } from './board'
import type { Card } from '../types'

const first = <T,>(list: T[]): T => {
  const [head] = list
  if (head === undefined) throw new Error('expected at least one item')

  return head
}

const COLORS: Record<string, string> = THEMES.catppuccin.colors
const colorOf = (status: string): string => COLORS[status.toLowerCase()] ?? THEMES.catppuccin.faint

const raw = (full: string, labels: string[], extra = {}) => ({
  references: { full },
  title: 't',
  web_url: `https://x/${full}`,
  labels,
  updated_at: '2026-10-05T08:30:00.000Z',
  ...extra,
})

test('status labels in every spelling normalise', async () => {
  expect(statusOf(['Bug', 'Status::Done'])).toBe('Done')
  expect(statusOf(['Status: Done'])).toBe('Done')
  expect(statusOf(['Status:: Ready to Release'])).toBe('Ready to Release')
  expect(statusOf(['Bug'])).toBe('')
  expect(statusOf(['Bug', 'Deployed to Development'])).toBe('Deployed to Dev')
  expect(statusOf(['Deployed to Staging', 'Request (Free)'])).toBe('Deployed to Staging')
  expect(statusOf(['Request (Free)', 'To do'])).toBe('To Do')
  expect(statusOf(['In-progress Training', 'Model Training'])).toBe('Doing')
  expect(statusOf(['Deployed to Staging', 'Status::Test'])).toBe('Test')
  expect(new Set(Object.values(COLORS)).size).toBe(Object.keys(COLORS).length)
  expect(colorOf('Deployed to Dev')).not.toBe(colorOf('Ready to Merge'))
  expect(colorOf('Doing')).toBe('#89b4fa')
  expect(colorOf('')).toBe('#72768b')
  expect(rankOf('Doing')).toBeLessThan(rankOf(''))
  expect(rankOf('')).toBeLessThan(rankOf('Done'))
})

test('an mr joins the issue its branch number names, else stands alone', async () => {
  const issues = [raw('g/core/lib#218', ['Status::Doing']), raw('g/other#218', ['Status::To Do'])]
  const mrs = [
    raw('g/core/lib!588', ['Status::Doing'], { source_branch: '218-fix' }),
    raw('g/core/lib!9', ['Status::Doing'], { source_branch: 'hotfix' }),
  ]
  const cards = toCards(issues, mrs)

  expect(cards.find(c => c.key === 'g/core/lib#218')?.mrs.map(m => m.num)).toEqual([588])
  expect(cards.find(c => c.key === 'g/other#218')?.mrs).toEqual([])
  expect(cards.some(c => c.kind === 'mr' && c.num === 9)).toBe(true)
  expect(cards.find(c => c.key === 'g/core/lib#218')?.group).toBe('core')
  expect(groupsOf(cards)).toEqual(['all', 'core', 'g'])
  expect(reposOf(cards, 'core')).toEqual(['all', 'lib'])
  expect(reposOf(cards, 'all')).toEqual(['all', 'lib', 'other'])
  expect(statusesOf(toCards([raw('a/b#1', ['Status::Done']), raw('a/b#2', ['Status: done']), raw('a/b#3', []), raw('a/b#4', ['Status::Doing'])], []))).toEqual(['Doing', 'Done'])
  expect(isDone('Done')).toBe(true)
  expect(isDone('Doing')).toBe(false)
})

test('done stays out of the default view and shows alone when picked', async () => {
  const cards = toCards(
    [raw('a/b#1', ['Status::Done']), raw('a/b#2', ['Status::Doing']), raw('a/b#3', ['Status::To Do']), raw('a/b#4', ['Status: Done'])],
    [],
  )
  const all = viewOf(cards, 'all')
  expect(all.shown.map(c => c.num).sort()).toEqual([2, 3])
  expect(all.doneCount).toBe(2)
  expect(viewOf(cards, 'done').shown.map(c => c.num).sort()).toEqual([1, 4])
  expect(viewOf(cards, 'doing').shown.map(c => c.num)).toEqual([2])
  expect(viewOf(cards, 'nonsense').active).toBe('all')
  expect(viewOf(cards.filter(c => c.status !== 'Done'), 'done').active).toBe('all')
})

test('an issue with no status label is not drawn, but its assigned merge request is', async () => {
  const cards = toCards([raw('a/b#1', ['Bug']), raw('a/b#2', ['Status::Doing'])], [raw('a/b!5', [], { source_branch: '1-x' })])

  expect(cards.map(c => `${c.kind}${c.num}:${c.status}`)).toEqual(['issue2:Doing', 'mr5:review'])
})

test('an open MR whose issue is not on the board is drawn as review, whatever its label', async () => {
  const cards = toCards([], [raw('a/b!5', ['Status: Done'], { source_branch: '9-x' }), raw('a/b!6', [], { source_branch: '8-y' })])

  expect(cards.map(c => [c.num, c.status])).toEqual([[5, 'review'], [6, 'review']])
})

test('an MR joins the issue its description relates to when its branch names none on the board', async () => {
  const issues = [raw('a/b#13', ['Status::Doing'])]
  const cards = toCards(issues, [raw('a/b!35', [], { source_branch: '19-x', description: 'related: [#13](https://x/issues/13#note_1)' }), raw('a/b!36', [], { source_branch: 'feat-y', description: 'Closes #13' }), raw('a/b!37', [], { source_branch: '99-z', description: 'Related to #77' })])

  expect(cards.map(c => [c.num, c.kind, c.mrs.map(m => m.num)])).toEqual([[13, 'issue', [35, 36]], [37, 'mr', [37]]])
})

test('a tab opened for a card is named after the card', async () => {
  const issue = first(toCards([raw('a/tablet-app#33', ['Status::Doing'])], []))
  expect(tabTitleOf(issue)).toBe('tablet-app #33')
  expect(tabTitleOf({ ...issue, kind: 'mr', num: 7 })).toBe('tablet-app !7')
})

test('statuses sort in the order the team labels describe, unknown ones last', async () => {
  const order = [
    'Doing',
    'To Do',
    'Ready to Merge',
    'Deployed to Dev',
    'Test',
    'Testing',
    'Dev Testing Pass',
    'Testing Passed',
    'Deployed to Staging',
    'Deployed to UAT',
    'Ready for Staging',
    'Ready to Release',
    'Monitoring',
    'Backlog',
  ]
  expect([...order].reverse().sort((a, b) => rankOf(a) - rankOf(b))).toEqual(order)
  expect(rankOf('Something New')).toBeGreaterThanOrEqual(rankOf('Monitoring'))
  expect(colorOf('Testing')).not.toBe(colorOf('Test'))
  expect(colorOf('Testing Passed')).not.toBe(colorOf('Testing'))
})

test('the card shows how long ago it was last updated', async () => {
  const now = Date.parse('2026-10-21T12:00:00.000Z')
  expect(ageOf('2026-10-21T11:59:30.000Z', now)).toBe('now')
  expect(ageOf('2026-10-21T11:15:00.000Z', now)).toBe('45m')
  expect(ageOf('2026-10-21T07:00:00.000Z', now)).toBe('5h')
  expect(ageOf('2026-10-19T12:00:00.000Z', now)).toBe('2d')
  expect(ageOf('2026-09-30T12:00:00.000Z', now)).toBe('3w')
  expect(ageOf('2026-06-01T12:00:00.000Z', now)).toBe('4mo')
  expect(ageOf('2024-10-21T12:00:00.000Z', now)).toBe('2y')
  expect(ageOf('2026-01-01T12:00:00.000Z', now)).toBe('9mo')
  expect(ageOf('2025-12-01T12:00:00.000Z', now)).toBe('1y')
  expect(ageOf('1800-01-01T12:00:00.000Z', now)).toBe('99y')
  for (let mins = 0; mins < 200 * 525600; mins += 997) expect(ageOf(new Date(Date.parse('2026-10-21T12:00:00.000Z') - mins * 60000).toISOString(), now).length).toBeLessThanOrEqual(3)
  expect(ageOf('', now)).toBe('')
  expect(first(toCards([raw('a/b#1', ['Status::Doing'])], [])).updated).toBe('2026-10-05T08:30:00.000Z')
})

test('the pane title carries the time of the last load', async () => {
  expect(titleOf(new Date(2026, 9, 21, 17, 5).getTime())).toBe('WIP-WALL · 17:05')
  expect(titleOf(0)).toBe('WIP-WALL')
})

test('statuses follow the Development board of each repo, averaged when several repos are shown', async () => {
  const board = (...names: string[]) => [
    { name: 'Other', lists: [] },
    { name: 'Development', lists: names.map((name, position) => ({ position, label: { name } })).reverse() },
  ]
  expect(boardOrder(board('Needs::Info', 'Status::To Do', 'Status::Doing', 'Deployed to Development', 'Status: Done'))).toEqual([
    'To Do',
    'Doing',
    'Deployed to Dev',
    'Done',
  ])

  const cards = toCards([raw('a/x#1', ['Status::Doing']), raw('a/y#2', ['Status::Doing'])], [])
  const one = rankIn(cards.slice(0, 1), { 'a/x': ['Test', 'Doing'] })
  expect(one('Test')).toBeLessThan(one('Doing'))
  const both = rankIn(cards, { 'a/x': ['Doing', 'Test'], 'a/y': ['Test', 'Doing'] })
  expect(both('Doing')).toBe(both('Test'))
  expect(rankIn(cards, {})('Doing')).toBeLessThan(rankIn(cards, {})('Monitoring'))
})

test('the date filter keeps cards updated within the span and every card when off', async () => {
  const now = Date.parse('2026-10-22T00:00:00Z')

  expect(withinDays('2026-10-20T00:00:00Z', 7, now)).toBe(true)
  expect(withinDays('2026-10-10T00:00:00Z', 7, now)).toBe(false)
  expect(withinDays('2026-10-10T00:00:00Z', 30, now)).toBe(true)
  expect(withinDays('2020-01-01T00:00:00Z', 0, now)).toBe(true)
  expect(withinDays('garbage', 7, now)).toBe(true)
})

test('an mr carries pipeline, conflict, draft and open threads; an issue carries its due date', async () => {
  const issue = raw('g/p#7', ['Status::Doing'], { due_date: '2026-10-25' })
  const mr = raw('g/p!9', ['Status::Doing'], {
    source_branch: '7-x',
    draft: true,
    has_conflicts: true,
    blocking_discussions_resolved: false,
    head_pipeline: { status: 'failed' },
  })
  const card = first(toCards([issue], [mr]))

  expect(card.due).toBe('2026-10-25')
  expect(card.mrs[0]).toMatchObject({ pipeline: 'failed', conflict: true, draft: true, threads: true })
})

test('due text points ahead or back with an arrow, fits four columns, and tones late red, today yellow', async () => {
  const now = Date.parse('2026-10-22T10:00:00')

  expect(dueOf('', now)).toEqual({ text: '', tone: 'muted' })
  expect(dueOf('2026-10-22', now)).toEqual({ text: '→0d', tone: 'warn' })
  expect(dueOf('2026-10-25', now)).toEqual({ text: '→3d', tone: 'muted' })
  expect(dueOf('2026-10-20', now)).toEqual({ text: '←2d', tone: 'bad' })
  expect(dueOf('2026-12-01', now).text).toBe('→5w')
  expect(dueOf('2025-10-01', now).text).toBe('←1y')
  for (let days = -40000; days < 40000; days += 7) expect(widthOf(dueOf(new Date(now + days * 86400000).toLocaleDateString('sv'), now).text)).toBeLessThanOrEqual(4)
})

const card = (num: number, mrs: object[] = [], title = 't') =>
  ({ key: `p/r#${num}`, kind: 'issue', project: 'p/r', group: 'p', repo: 'r', num, title, url: '', status: 'Doing', updated: '', due: '', mrs }) as never
const mr = (extra = {}) => ({ num: 1, status: 'Doing', url: 'u', pipeline: '', conflict: false, draft: false, threads: false, ...extra })

test('clip keeps short text and ends long text with an ellipsis inside the room', () => {
  expect(clip('abc', 3)).toBe('abc')
  expect(clip('abcd', 3)).toBe('ab…')
})

test('the mr summary is empty without an mr and counts the others', () => {
  expect(mrSummary(card(1), 40)).toBeUndefined()
  expect(mrSummary(card(1, [mr({ num: 5 }), mr({ num: 6 }), mr({ num: 7 })]), 40)).toMatchObject({ num: 5, more: 2 })
})

test('the mr summary picks the mr with the worst problem and hides a status equal to the card', () => {
  const sum = mrSummary(card(1, [mr({ num: 5 }), mr({ num: 6, pipeline: 'failed', status: 'Testing' })]), 40)

  expect(sum).toMatchObject({ num: 6, status: 'Testing', more: 1 })
  expect(mrSummary(card(1, [mr({ num: 5 })]), 40)?.status).toBe('')
})

test('the mr summary drops flags from the end until the line fits and marks the cut', () => {
  const full = mr({ num: 138, pipeline: 'failed', conflict: true, draft: true, threads: true })

  expect(mrSummary(card(1, [full]), 60)).toMatchObject({ cut: false })
  expect(mrSummary(card(1, [full]), 40)?.flags.map(f => f.text)).toEqual(['ci-fail', 'conflict', 'draft'])
  expect(mrSummary(card(1, [full]), 40)?.cut).toBe(true)
  expect(mrSummary(card(1, [full]), 22)?.flags.map(f => f.text)).toEqual(['ci-fail'])
})

test('title lines break at a space, and only text past the second line is clipped', () => {
  expect(titleLines('short', 10)).toEqual(['short'])
  expect(titleLines('aaaa bbbb cccc', 9)).toEqual(['aaaa bbbb', 'cccc'])
  expect(titleLines('aaaa bbbb cccc dddd eeee', 9)).toEqual(['aaaa bbbb', 'cccc ddd…'])
})

test('wide characters count two cells, so a japanese title breaks before it overflows', () => {
  expect(widthOf('abc')).toBe(3)
  expect(widthOf('日本語')).toBe(6)
  expect(widthOf('ก็')).toBe(1)
  expect(titleLines('日本語日本語', 8)).toEqual(['日本語日', '本語'])
  expect(titleLines('日本 abc def', 8)).toEqual(['日本 abc', 'def'])
  expect(clip('日本語日本語', 7)).toBe('日本語…')
})

test('a running pipeline reads ci-run and a pending or created one reads ci-wait', () => {
  const texts = (pipeline: string) => mrSummary(card(1, [mr({ pipeline })]), 60)?.flags.map(f => f.text)

  expect(texts('running')).toEqual(['ci-run'])
  expect(texts('pending')).toEqual(['ci-wait'])
  expect(texts('created')).toEqual(['ci-wait'])
})

test('detailed merge status adds rebase, review, ready, ci-req, checking and blocked flags', () => {
  const texts = (merge: string) => mrSummary(card(1, [mr({ merge })]), 60)?.flags.map(f => f.text)

  expect(texts('need_rebase')).toEqual(['rebase'])
  expect(texts('not_approved')).toEqual(['review'])
  expect(texts('mergeable')).toEqual(['ready'])
  expect(texts('ci_must_pass')).toEqual(['ci-req'])
  expect(texts('checking')).toEqual(['checking'])
  expect(texts('blocked_status')).toEqual(['blocked'])
  expect(texts('discussions_not_resolved')).toEqual([])
  expect(mrSummary(card(1, [mr({ draft: true, merge: 'not_approved' })]), 60)?.flags.map(f => f.text)).toEqual(['draft', 'review'])
})

test('reply, approved, no reviewer and stale flags; no reviewer is skipped on a draft; approved yields to ready', () => {
  const now = Date.parse('2026-10-22T00:00:00Z')
  const texts = (extra: object) => mrSummary(card(1, [mr(extra)]), 120, now)?.flags.map(f => f.text)

  expect(texts({ reply: true })).toEqual(['reply'])
  expect(texts({ approved: true })).toEqual(['approved'])
  expect(texts({ unreviewed: true })).toEqual(['no rev'])
  expect(texts({ unreviewed: true, draft: true })).toEqual(['draft'])
  expect(texts({ updated: '2026-10-10T00:00:00Z' })).toEqual(['stale'])
  expect(texts({ updated: '2026-10-20T00:00:00Z' })).toEqual([])
  expect(texts({ approved: true, merge: 'mergeable' })).toEqual(['ready'])
})

test('the longest mr line carries eight flags', () => {
  const most = mr({ pipeline: 'failed', conflict: true, reply: true, merge: 'need_rebase', threads: true, approved: true, unreviewed: true, updated: '2026-10-01T00:00:00Z' })
  const sum = mrSummary(card(1, [most]), 200, Date.parse('2026-10-22T00:00:00Z'))

  expect(sum?.flags.map(f => f.text)).toEqual(['ci-fail', 'conflict', 'reply', 'rebase', 'threads', 'approved', 'no rev', 'stale'])
})

const node = (extra = {}) => ({
  reference: 'acme/core/lib!7',
  title: 'feat: x',
  webUrl: 'https://x/mr/7',
  updatedAt: '2026-10-05T08:30:00Z',
  sourceBranch: '12-x',
  draft: false,
  conflicts: true,
  approved: true,
  detailedMergeStatus: 'NOT_APPROVED',
  mergeableDiscussionsState: false,
  labels: { nodes: [{ title: 'Status::Doing' }] },
  headPipeline: { status: 'FAILED' },
  reviewers: { nodes: [] },
  notes: { nodes: [] },
  ...extra,
})

test('a graphql merge request becomes the same raw shape the rest api gave, lowercased', () => {
  expect(mrOfGraphql(node(), 'gid://1')).toEqual({
    references: { full: 'acme/core/lib!7' },
    title: 'feat: x',
    web_url: 'https://x/mr/7',
    labels: ['Status::Doing'],
    updated_at: '2026-10-05T08:30:00Z',
    source_branch: '12-x',
    draft: false,
    has_conflicts: true,
    blocking_discussions_resolved: false,
    head_pipeline: { status: 'failed' },
    detailed_merge_status: 'not_approved',
    reviewers: [],
    approved: true,
    reply: false,
  })
  expect(mrOfGraphql(node({ headPipeline: null, sourceBranch: null, detailedMergeStatus: null, mergeableDiscussionsState: null }), 'gid://1')).toMatchObject({
    head_pipeline: null,
    source_branch: undefined,
    detailed_merge_status: undefined,
    blocking_discussions_resolved: undefined,
  })
})

test('reply means the newest human note is not mine; system notes and unknown me never count', () => {
  const note = (author: string | null, system = false) => ({ system, author: author === null ? null : { id: author } })
  const reply = (nodes: object[], me = 'gid://1') => mrOfGraphql(node({ notes: { nodes } }), me).reply

  expect(reply([note('gid://2'), note('gid://1')])).toBe(false)
  expect(reply([note('gid://1'), note('gid://2')])).toBe(true)
  expect(reply([note('gid://2'), note('gid://1', true)])).toBe(true)
  expect(reply([note('gid://2', true)])).toBe(false)
  expect(reply([note(null)])).toBe(true)
  expect(reply([note('gid://2')], '')).toBe(false)
})

test('ndjson lines become one raw each, blank lines skipped', () => {
  expect(fromNdjson('{"a":1}\n\n{"a":2}\n')).toEqual([{ a: 1 }, { a: 2 }])
  expect(fromNdjson('')).toEqual([])
})

test('projects and repos list the one with the most recently updated card first', async () => {
  const cards = toCards(
    [
      raw('g/old/a#1', ['Status::Doing'], { updated_at: '2026-01-01T00:00:00Z' }),
      raw('g/old/a#2', ['Status::Doing'], { updated_at: '2026-01-02T00:00:00Z' }),
      raw('g/new/b#1', ['Status::Doing'], { updated_at: '2026-09-01T00:00:00Z' }),
      raw('g/new/c#1', ['Status::Doing'], { updated_at: '2026-10-01T00:00:00Z' }),
    ],
    [],
  )

  expect(groupsOf(cards)).toEqual(['all', 'new', 'old'])
  expect(reposOf(cards, 'all')).toEqual(['all', 'c', 'b', 'a'])
})

const todo = (action: string, ref: string, at: string, extra = {}) => ({
  action_name: action,
  target_type: ref.includes('!') ? 'MergeRequest' : 'Issue',
  target_url: `https://x/${ref}#note_1`,
  body: 'hi\n  @me   there',
  created_at: at,
  author: { username: 'pat' },
  project: { path_with_namespace: ref.split(/[#!]/)[0] ?? '' },
  target: { iid: Number(ref.split(/[#!]/)[1]), title: 'title', web_url: `https://x/${ref}` },
  ...extra,
})

test('mentions keep mentioned and directly addressed todos, newest note per target, newest target first', async () => {
  const found = mentionsOf([
    todo('assigned', 'g/a/b#1', '2026-10-01T00:00:00Z'),
    todo('mentioned', 'g/a/b#2', '2026-10-02T00:00:00Z'),
    todo('directly_addressed', 'g/a/b#2', '2026-10-03T00:00:00Z', { author: { username: 'sam' } }),
    todo('mentioned', 'g/a/c!7', '2026-10-04T00:00:00Z'),
    todo('mentioned', 'g/a/b#3', '2026-10-01T00:00:00Z', { target_type: 'Epic' }),
  ])

  expect(found.map(m => m.key)).toEqual(['@g/a/c!7', '@g/a/b#2'])
  expect(found[1]).toMatchObject({ ref: 'g/a/b#2', kind: 'issue', group: 'a', repo: 'b', num: 2, by: 'sam', noteUrl: 'https://x/g/a/b#2#note_1' })
  expect(found[0]).toMatchObject({ kind: 'mr', repo: 'c', body: 'hi @me there' })
})

const HOST = 'gitlab.x'

test('a remote url names its project only on the gitlab host', async () => {
  expect(projectOf('git@gitlab.x:g/sub/web.git', HOST)).toBe('g/sub/web')
  expect(projectOf('https://gitlab.x/g/web.git', HOST)).toBe('g/web')
  expect(projectOf('https://user@gitlab.x:8443/g/web', HOST)).toBe('g/web')
  expect(projectOf('ssh://git@gitlab.x:2222/G/Web.git/', HOST)).toBe('G/Web')
  expect(projectOf('git@github.com:g/web.git', HOST)).toBeUndefined()
  expect(projectOf('', HOST)).toBeUndefined()
  expect(projectOf('gitlab.x:/g/web.git', HOST)).toBe('g/web')
})

test('a clone is found by its remote project, never by a folder name that only looks alike', async () => {
  const dirs = dirsOf(
    [
      { path: '/r/PROJ-X/web', remote: 'git@gitlab.x:acme-team/web.git' },
      { path: '/r/other/web', remote: 'git@gitlab.x:other/web.git' },
      { path: '/r/x/a/web', remote: 'git@gitlab.x:x/a/web.git' },
      { path: '/r/y/a/web', remote: 'git@gitlab.x:y/a/web.git' },
    ],
    HOST,
  )

  expect(dirOf(dirs, { project: 'acme-team/web', repo: 'web' })).toBe('/r/PROJ-X/web')
  expect(dirOf(dirs, { project: 'OTHER/web', repo: 'web' })).toBe('/r/other/web')
  expect(dirOf(dirs, { project: 'y/a/web', repo: 'web' })).toBe('/r/y/a/web')
  expect(dirOf(dirs, { project: 'nobody/web', repo: 'web' })).toBeUndefined()
})

test('a clone without a usable remote is found by its folder name only when that name is unique', async () => {
  const dirs = dirsOf(
    [
      { path: '/r/lib', remote: '' },
      { path: '/r/a/web', remote: '' },
      { path: '/r/b/web', remote: 'git@github.com:b/web.git' },
      { path: '/r/c/api', remote: 'git@gitlab.x:c/api.git' },
    ],
    HOST,
  )

  expect(dirOf(dirs, { project: 'g/lib', repo: 'lib' })).toBe('/r/lib')
  expect(dirOf(dirs, { project: 'g/web', repo: 'web' })).toBe('/r/a/web')
  expect(dirOf(dirs, { project: 'g/api', repo: 'api' })).toBeUndefined()
})

test('a clone whose remote could not be read is never found by its folder name', async () => {
  const dirs = dirsOf([{ path: '/r/lib', remote: '!' }], HOST)

  expect(dirOf(dirs, { project: 'g/lib', repo: 'lib' })).toBeUndefined()
})

test('a todo without a project or author is skipped instead of failing every mention', async () => {
  const todo = (extra: object) => ({ action_name: 'mentioned', target_type: 'Issue', target_url: 'https://x/n', body: 'hi', created_at: '2026-10-05T08:30:00.000Z', author: { username: 'bob' }, project: { path_with_namespace: 'g/r' }, target: { iid: 1, title: 'T', web_url: 'https://x/1' }, ...extra })

  expect(mentionsOf([todo({ project: null }), todo({ author: null })]).map(m => m.by)).toEqual([''])
})

test('control characters from other people never reach a title, status or note body', async () => {
  const esc = String.fromCharCode(27)
  const card = first(toCards([raw('g/r#1', ['Status::Doing'], { title: `a${esc}]52;c;x${esc}\\b` })], []))

  expect(card.title).not.toContain(esc)
  expect(statusOf([`Status::Do${esc}ing`])).toBe('Do ing')
  const m = first(mentionsOf([{ action_name: 'mentioned', target_type: 'Issue', target_url: 'https://x/n', body: `x${esc}[2Jy`, created_at: '2026-10-05T08:30:00.000Z', author: { username: `b${esc}` }, project: { path_with_namespace: 'g/r' }, target: { iid: 1, title: `t${esc}`, web_url: 'https://x/1' } }]))
  expect(`${m.body}${m.by}${m.title}`).not.toContain(esc)
})

test('bidi and line separators are stripped like control characters', async () => {
  expect(statusOf(['Status::a\u202eb\u2066c'])).toBe('a b c')
  expect(first(toCards([raw('g/r#1', ['Status::Doing'], { title: 'x\u2028y' })], [])).title).toBe('x y')
})

test('zero-width characters are replaced so the drawn width matches widthOf, but the emoji joiner stays', async () => {
  for (const ch of ['\u200b', '\u200e', '\u200f', '\u2060', '\u2063', '\ufeff']) expect(widthOf(clean(`a${ch}b`))).toBe(3)
  expect(isWebUrl('https://x/a\u200bb')).toBe(false)
  expect(clean('\ud83d\udc69\u200d\ud83d\udcbb')).toBe('\ud83d\udc69\u200d\ud83d\udcbb')
})

test('emoji take two cells, text symbols one, flags two together, modifiers and joiners none', async () => {
  expect(widthOf('😀')).toBe(2)
  expect(widthOf('✅❌⭐')).toBe(6)
  expect(widthOf('✓✗★✕✦✧')).toBe(6)
  expect(widthOf('🇹🇭')).toBe(2)
  expect(widthOf('👍\u{1f3fd}')).toBe(2)
  expect(widthOf('❤\ufe0f')).toBe(2)
  expect(widthOf('1\ufe0f')).toBe(1)
  expect(widthOf('é\ufe0f')).toBe(1)
  expect(widthOf('🇹\ufe0f')).toBe(1)
  expect(widthOf('⭐\ufe0f')).toBe(2)
  expect(titleLines('❤\ufe0f'.repeat(30), 20)[0]).toBe('❤\ufe0f'.repeat(10))
  expect(widthOf('1\ufe0f\u20e3')).toBe(2)
  expect(widthOf('🩷')).toBe(2)
  expect(widthOf('e\u0301')).toBe(1)
  expect(widthOf('สวัสดี')).toBe(4)
})

test('only http and https urls are opened', async () => {
  expect(isWebUrl('https://gitlab.x/g/r/-/issues/1')).toBe(true)
  expect(isWebUrl('http://gitlab.x/a')).toBe(true)
  expect(isWebUrl('file:///etc/passwd')).toBe(false)
  expect(isWebUrl('-a Calculator')).toBe(false)
  expect(isWebUrl('https://x/a\nrm -rf ~')).toBe(false)
  expect(isWebUrl('https://x/a b')).toBe(false)
  expect(isWebUrl('https://x/a\u0085b')).toBe(false)
  expect(isWebUrl('https://x/a\u202eb')).toBe(false)
})

test('the pane view hides dismissed cards, scopes by project and repo, and counts what is open', async () => {
  const now = Date.parse('2026-10-06T00:00:00.000Z')
  const cards = toCards(
    [
      raw('g/core/lib#1', ['Status::Doing']),
      raw('g/core/lib#2', ['Status::To Do']),
      raw('g/core/app#3', ['Status::Done']),
      raw('g/tablet/ipad#4', ['Status::Doing'], { updated_at: '2026-01-01T00:00:00.000Z' }),
      raw('g/tablet/ipad#5', ['Status::Doing']),
    ],
    [],
  )
  const mention = mentionsOf([
    { action_name: 'mentioned', target_type: 'Issue', target_url: 'https://x/n1', body: 'b', created_at: '2026-10-05T09:00:00.000Z', author: { username: 'a' }, project: { path_with_namespace: 'g/core/lib' }, target: { iid: 1, title: 't', web_url: 'https://x/1' } },
    { action_name: 'mentioned', target_type: 'Issue', target_url: 'https://x/n9', body: 'b', created_at: '2026-10-05T09:00:00.000Z', author: { username: 'a' }, project: { path_with_namespace: 'g/core/lib' }, target: { iid: 9, title: 't', web_url: 'https://x/9' } },
  ])
  const base = { cards, reviews: [] as Card[], mentions: mention, hidden: { 'g/tablet/ipad#5': '2026-10-05T08:30:00.000Z' }, group: 'all', tab: 'all', date: 'all', status: 'all', boards: {}, working: [] }

  const all = paneOf(base, now)
  expect(all.total).toBe(4)
  expect(all.groups.map(g => [g.id, g.count])).toEqual([['all', 3], ['core', 2], ['tablet', 1]])
  expect(all.repos).toBeUndefined()
  expect(all.sections.map(s => [s.name, s.label, s.list.map(c => c.num)])).toEqual([['core', 'core · 2', [1, 2]], ['tablet', 'tablet · 1', [4]]])
  expect(all.heard.map(m => m.num)).toEqual([9])
  expect([...all.pinged]).toEqual(['g/core/lib#1', 'g/core/lib#9'])
  expect(all.hiddenCards.map(c => c.num)).toEqual([5])
  expect(all.doneLeft).toBe(false)
  expect(paneOf({ ...base, cards: cards.filter(c => c.num === 3) }, now).doneLeft).toBe(true)
  expect(paneOf({ ...base, cards: cards.filter(c => c.num === 3), working: ['g/core/app#3'] }, now).doneLeft).toBe(false)
  expect(paneOf({ ...base, cards: cards.filter(c => c.num === 3), status: 'done' }, now).doneLeft).toBe(false)
  expect(paneOf({ ...base, status: 'done' }, now).shown.map(c => c.num)).toEqual([3])
  expect(all.unmatched).toBe(false)
  expect(paneOf({ ...base, cards: cards.filter(c => c.num === 3) }, now).unmatched).toBe(false)
  expect(paneOf({ ...base, tab: 'app', group: 'core' }, now).unmatched).toBe(true)
  expect(all.statuses.map(s => [s.id, s.label, s.count])).toEqual([['all', 'all', 3], ['Doing', 'Doing', 2], ['To Do', 'To Do', 1], ['done', 'Done', 1]])

  const core = paneOf({ ...base, group: 'core', tab: 'lib' }, now)
  expect(core.repos?.map(r => [r.id, r.count])).toEqual([['all', 2], ['lib', 2], ['app', 0]])
  expect(core.repo).toBe('lib')
  expect(core.sections.map(s => [s.name, s.label])).toEqual([['', 'Cards · 2']])

  const one = paneOf({ ...base, group: 'tablet', tab: 'nope' }, now)
  expect(one.repos?.map(r => r.id)).toEqual(['ipad'])
  expect(one.repo).toBe('ipad')

  const week = paneOf({ ...base, date: 'week', status: 'done' }, now)
  expect(week.status).toBe('done')
  expect(week.shown.map(c => c.num)).toEqual([3])
  expect(week.groups.find(g => g.id === 'tablet')?.count).toBe(0)
})

test('a dismissal goes stale once its card changes or leaves, but only when that source was fetched', async () => {
  const cards = toCards([raw('g/r#1', ['Status::Doing']), raw('g/r#2', ['Status::Doing'])], [raw('g/r!7', ['Status::Doing'])])
  const at = '2026-10-05T08:30:00.000Z'
  const m = first(mentionsOf([{ action_name: 'mentioned', target_type: 'Issue', target_url: 'https://x/n', body: 'b', created_at: at, author: { username: 'a' }, project: { path_with_namespace: 'g/r' }, target: { iid: 9, title: 't', web_url: 'https://x/9' } }]))
  const hidden = {
    'g/r#1': at,
    'g/r#2': '2026-01-01T00:00:00.000Z',
    'g/r#3': at,
    'g/r!7': at,
    'g/r!8': at,
    '@g/r#9': at,
    '@g/r#10': at,
  }

  expect(staleHides(hidden, cards, [m], { mrs: true, mentions: true }).sort()).toEqual(['@g/r#10', 'g/r!8', 'g/r#2', 'g/r#3'])
  expect(staleHides(hidden, cards, [], { mrs: false, mentions: false }).sort()).toEqual(['g/r#2', 'g/r#3'])
})

test('the pane orders cards by their own board, then newest, then repo, then highest number, and leaves the view untouched', async () => {
  const now = Date.parse('2026-10-06T00:00:00.000Z')
  const cards = toCards(
    [
      raw('g/s/lib#1', ['Status::Doing']),
      raw('g/s/lib#2', ['Status::To Do']),
      raw('g/s/lib#3', ['Status::Doing'], { updated_at: '2026-10-05T09:00:00.000Z' }),
      raw('g/s/app#4', ['Status::Doing']),
      raw('g/s/lib#5', ['Status::Doing']),
    ],
    [],
  )
  const before = cards.map(c => c.num)
  const pane = paneOf({ cards, reviews: [], mentions: [], hidden: {}, group: 'all', tab: 'all', date: 'all', status: 'all', boards: { 'g/s/lib': ['To Do', 'Doing'], 'g/s/app': ['To Do', 'Doing'] }, working: [] }, now)

  expect(pane.shown.map(c => c.num)).toEqual([2, 3, 4, 5, 1])
  expect(paneOf({ cards, reviews: [], mentions: [], hidden: {}, group: 'all', tab: 'all', date: 'all', status: 'all', boards: {}, working: [] }, now).shown.map(c => c.num)).toEqual([3, 4, 5, 1, 2])
  expect(cards.map(c => c.num)).toEqual(before)
})

test('cards with a live session sit in Working, outside every filter and section', async () => {
  const now = Date.parse('2026-10-06T00:00:00.000Z')
  const cards = toCards(
    [
      raw('g/core/lib#1', ['Status::Doing']),
      raw('g/core/lib#2', ['Status::Done'], { updated_at: '2026-10-05T09:00:00.000Z' }),
      raw('g/tablet/ipad#3', ['Status::Doing'], { updated_at: '2026-01-01T00:00:00.000Z' }),
      raw('g/tablet/ipad#4', ['Status::Doing']),
    ],
    [],
  )
  const pane = paneOf(
    { cards, reviews: [], mentions: [], hidden: { 'g/tablet/ipad#4': '2026-10-05T08:30:00.000Z' }, group: 'core', tab: 'all', date: 'week', status: 'all', boards: {}, working: ['g/core/lib#2', 'g/tablet/ipad#3', 'g/tablet/ipad#4', 'gone/x#9'] },
    now,
  )

  expect(pane.working.map(c => c.num)).toEqual([2, 3])
  expect(pane.shown.map(c => c.num)).toEqual([1])
  expect(pane.sections.map(s => [s.label, s.list.map(c => c.num)])).toEqual([['Cards · 1', [1]]])
  expect(pane.groups.find(g => g.id === 'core')?.count).toBe(1)
})

test('the card of this session leads Working even when another card changed more recently', () => {
  const now = Date.parse('2026-10-06T00:00:00.000Z')
  const cards = toCards(
    [
      raw('g/s/lib#1', ['Status::Doing'], { updated_at: '2026-10-05T09:00:00.000Z' }),
      raw('g/s/lib#2', ['Status::Doing'], { updated_at: '2026-01-01T00:00:00.000Z' }),
    ],
    [],
  )
  const input = { cards, reviews: [] as Card[], mentions: [], hidden: {}, group: 'all', tab: 'all', date: 'all', status: 'all', boards: {}, working: ['g/s/lib#1', 'g/s/lib#2'] }

  expect(paneOf(input, now).working.map(c => c.num)).toEqual([1, 2])
  expect(paneOf({ ...input, here: 'g/s/lib#2' }, now).working.map(c => c.num)).toEqual([2, 1])
})

test('picker counts follow every other filter that is on', () => {
  const now = Date.parse('2026-10-06T00:00:00.000Z')
  const cards = toCards(
    [
      raw('g/core/lib#1', ['Status::Doing']),
      raw('g/core/lib#2', ['Status::To Do']),
      raw('g/tablet/ipad#4', ['Status::Doing']),
      raw('g/tablet/ipad#5', ['Status::Doing'], { updated_at: '2026-01-01T00:00:00.000Z' }),
    ],
    [],
  )
  const base = { cards, reviews: [] as Card[], mentions: [], hidden: {}, group: 'all', tab: 'all', date: 'all', status: 'all', boards: {}, working: [] }

  const doing = paneOf({ ...base, status: 'doing' }, now)
  expect(doing.groups.map(g => [g.id, g.count])).toEqual([['all', 3], ['core', 1], ['tablet', 2]])
  expect(doing.dates.find(d => d.id === 'week')?.count).toBe(2)
  expect(paneOf({ ...base, group: 'tablet', status: 'doing' }, now).dates.find(d => d.id === 'week')?.count).toBe(1)

  const mention = mentionsOf([
    { action_name: 'mentioned', target_type: 'Issue', target_url: 'https://x/n9', body: 'b', created_at: '2026-10-05T09:00:00.000Z', author: { username: 'a' }, project: { path_with_namespace: 'g/core/lib' }, target: { iid: 9, title: 't', web_url: 'https://x/9' } },
  ])
  expect(paneOf({ ...base, mentions: mention, status: 'to do' }, now).heard.map(m => m.num)).toEqual([9])
  expect(paneOf({ ...base, mentions: mention, group: 'tablet' }, now).heard).toEqual([])
})

test('latest sorts every section by its last update instead of the board status', () => {
  const now = Date.parse('2026-10-06T00:00:00.000Z')
  const cards = toCards(
    [
      raw('g/core/lib#1', ['Status::To Do'], { updated_at: '2026-10-05T00:00:00.000Z' }),
      raw('g/core/lib#2', ['Status::Doing'], { updated_at: '2026-10-01T00:00:00.000Z' }),
      raw('g/core/lib#3', ['Status::To Do'], { updated_at: '2026-10-03T00:00:00.000Z' }),
    ],
    [],
  )
  const base = { cards, reviews: [] as Card[], mentions: [], hidden: {}, group: 'all', tab: 'all', date: 'all', status: 'all', boards: {}, working: [] }

  expect(paneOf(base, now).shown.map(c => c.num)).toEqual([2, 1, 3])
  expect(paneOf({ ...base, latest: true }, now).shown.map(c => c.num)).toEqual([1, 3, 2])
})

test('review requests become mr cards of their own, drop what is assigned, and stay out of every count', async () => {
  const now = Date.parse('2026-10-06T00:00:00.000Z')
  const asked = reviewsOf(
    [raw('g/core/lib!12', [], { title: 'look\u001b[2Jhere', head_pipeline: { status: 'failed' } }), raw('g/tablet/ipad!3', ['Status::Doing']), raw('g/core/lib!7', [])],
    new Set(['g/core/lib!7']),
  )
  expect(asked.map(c => [c.key, c.kind, c.status, c.title])).toEqual([
    ['g/core/lib!12', 'mr', 'review', 'look [2Jhere'],
    ['g/tablet/ipad!3', 'mr', 'Doing', 't'],
  ])
  expect(asked.map(c => c.mrs.map(m => m.pipeline))).toEqual([['failed'], ['']])

  const cards = toCards([raw('g/core/lib#1', ['Status::Doing'])], [])
  const mention = mentionsOf([
    { action_name: 'mentioned', target_type: 'MergeRequest', target_url: 'https://x/n', body: 'b', created_at: '2026-10-05T09:00:00.000Z', author: { username: 'a' }, project: { path_with_namespace: 'g/core/lib' }, target: { iid: 12, title: 't', web_url: 'https://x/12' } },
  ])
  const base = { cards, reviews: asked, mentions: mention, hidden: {}, group: 'all', tab: 'all', date: 'all', status: 'all', boards: {}, working: [] as string[] }
  const all = paneOf(base, now)
  expect(all.reviews.map(c => c.num)).toEqual([12, 3])
  expect(all.heard).toEqual([])
  expect([...all.pinged]).toEqual(['g/core/lib!12'])
  expect(all.total).toBe(1)
  expect(all.statuses.map(s => [s.id, s.count])).toEqual([['all', 1], ['Doing', 1]])
  expect(paneOf({ ...base, group: 'core' }, now).reviews.map(c => c.num)).toEqual([12])
  const hid = paneOf({ ...base, hidden: { 'g/core/lib!12': '2026-10-05T08:30:00.000Z' } }, now)
  expect([hid.reviews.map(c => c.num), hid.hiddenCards.map(c => c.num)]).toEqual([[3], [12]])
  const busy = paneOf({ ...base, working: ['g/tablet/ipad!3'] }, now)
  expect([busy.reviews.map(c => c.num), busy.working.map(c => c.num)]).toEqual([[12], [3]])
})

test('the latte theme keeps every status and text colour readable on a white terminal', async () => {
  const lum = (hex: string) => {
    const [r = 0, g = 0, b = 0] = [1, 3, 5].map(i => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255

      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    })

    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const ratio = (hex: string) => 1.05 / (lum(hex) + 0.05)
  const { colors, muted, faint, text, good, warn, bad } = THEMES.latte
  for (const hex of [...Object.values(colors), muted, text, good, warn, bad]) expect(ratio(hex)).toBeGreaterThanOrEqual(4.5)
  expect(ratio(faint)).toBeGreaterThanOrEqual(3.5)
})
