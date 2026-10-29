import { expect, test } from 'claude-code/testing'
import type { Mounted } from 'claude-code/testing'

declare const setTimeout: (run: (value?: unknown) => void, ms: number) => unknown

const TYPED_RUN = { origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as const

const DAY = 86400000
const RECENT = new Date(Date.now() - 10 * DAY).toISOString()
const NOTED = new Date(Date.now() - 2 * DAY).toISOString()

const ISSUES = [
  { references: { full: 'acme/core/lib#1' }, title: 'open one', web_url: 'https://x/u1', updated_at: RECENT, labels: ['Status::Doing'] },
  { references: { full: 'acme/core/lib#2' }, title: 'finished one', web_url: 'https://x/u2', updated_at: RECENT, labels: ['Status: Done'] },
  { references: { full: 'acme-team/web#3' }, title: 'other group', web_url: 'https://x/u3', updated_at: RECENT, labels: ['Status::To Do'] },
  { references: { full: 'acme-team/web#4' }, title: 'unlabelled', web_url: 'https://x/u4', updated_at: RECENT, labels: ['Bug'] },
]

const PANE = {
  plugin: 'wip-wall',
  component: 'Pane',
  requestId: 'wip-wall',
  surface: 'terminal',
  props: { title: 'WIP-WALL', isFocused: false, bodyColumns: 90, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const ran: string[][] = []
const deleted: string[] = []
const stored: string[] = []
const storedValues: { key: string; value: unknown }[] = []
let todos: readonly object[] = []
let todosFail = false
let hides: Record<string, string> = {}
let sessionId = 'main'
let alive = ''
let branchName = ''
let liveFiles = ''
let selected = 'gone\n'
let focused = 'gone\n'
let terminalName = ''
let panes: { id: string }[] = []
const openCard = async ($: any, key: string, place = 'window') => {
  await $.ui.press({ plugin: 'wip-wall', key: `open:${key}:0` })
  await $.ui.press({ plugin: 'wip-wall', key: `choose:${key}:${place}` })
}
const places = async (ui: any) => (await ui.findAll({ type: 'Text', text: /^\[(window|tab|split|here)\]$/ })).map((t: any) => String(t.text ?? t.props.children))
const launches = () => ran.filter(a => a[0] === 'osascript' && a[2]?.includes('new window'))
const filled: { text: string; mode?: string }[] = []
const toasts: string[] = []
let ticks: (() => void)[] = []
const tick = async () => {
  const due = ticks
  ticks = []
  for (const fire of due) fire()
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0))
}
let launchFails = false
let issuesFail = false
let psFail = false
let noRoot = false
let authFail = false
const opened: string[] = []
let registered = 0
const REMOTE_OF: Record<string, string> = {
  '/Users/dev/Developer/Project-Work/core/lib': 'git@gitlab.example.com:acme/core/lib.git',
  '/Users/dev/Developer/Project-Work/PROJ-X/web': 'https://gitlab.example.com/acme-team/web.git',
}
let remotes = REMOTE_OF
let clones = '/Users/dev/Developer/Project-Work/core/lib/.git\n/Users/dev/Developer/Project-Work/PROJ-X/web/.git\n'

let reviewNodes: readonly object[] = []
let reviewsFail = false

const graphqlPage = (argv: readonly string[], pages: readonly (readonly object[])[] | 'no-user') => {
  if (pages === 'no-user') return JSON.stringify({ data: { currentUser: null } })
  const reviewing = argv.some(a => a.includes('reviewRequestedMergeRequests'))
  if (reviewing && reviewsFail) return JSON.stringify({ data: { currentUser: null } })
  const field = reviewing ? 'reviewRequestedMergeRequests' : 'assignedMergeRequests'
  const list = reviewing ? [reviewNodes] : pages
  const cursor = argv.find(a => a.startsWith('after='))?.slice('after='.length) ?? 'c0'
  const at = Number(cursor.slice(1))
  const nodes = list[at] ?? []

  return JSON.stringify({
    data: { currentUser: { id: 'gid://gitlab/User/1', [field]: { pageInfo: { hasNextPage: at + 1 < list.length, endCursor: `c${at + 1}` }, nodes } } },
  })
}

const FIXTURE_ROOT = '/Users/dev/Developer/Project-Work'

const boot = async ($: any, on: any, cwd = FIXTURE_ROOT, issues: readonly object[] = ISSUES, args: string | null = '', pages: readonly (readonly object[])[] | 'no-user' = [[]]): Promise<Mounted> => {
  on('command.register', () => {
    registered += 1

    return { value: { command: 'wip-wall' } }
  })
  on('session.end', () => ({ sessionId: 'main' }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('ui.open', (_: unknown, e: { id: string }) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: panes }))
  on('ui.toast', (_: unknown, e: { text?: string; message?: string }) => {
    toasts.push(String(e.text ?? e.message ?? ''))

    return { value: undefined }
  })
  on('prompt.fill', (_: unknown, e: { text: string; mode?: string }) => {
    filled.push({ text: e.text, mode: e.mode })

    return { isFilled: true }
  })
  on('clock.every', () => new Promise(resolve => ticks.push(() => resolve({ value: undefined }))))
  on('clock.after', () => new Promise(resolve => ticks.push(() => resolve({ value: undefined }))))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: cwd }))
  on('session.id', () => ({ value: sessionId }))
  on('store.keys', () => ({ value: ['card:acme/core/lib#1', 'card:acme/core/lib#2', 'card:acme-team/web#3', ...Object.keys(hides)] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    stored.push(e.key)
    storedValues.push({ key: e.key, value: e.value })

    return { value: undefined }
  })
  on('store.delete', (_: unknown, e: { key: string }) => {
    deleted.push(e.key)

    return { value: undefined }
  })
  on('store.get', (_: unknown, e: { key: string }) => ({
    value: e.key === 'ui:root' || e.key === 'ui:host' || e.key === 'ui:terminal' || ((e.key.startsWith('card:') || e.key === 'pane:owner') && storedValues.some(v => v.key === e.key))
      ? storedValues.findLast(v => v.key === e.key)?.value
      : e.key in hides
      ? hides[e.key]
      : e.key === 'pane:owner'
      ? undefined
      : e.key.endsWith('#1')
      ? { sid: 's1', tab: 'tab-1', at: Date.now() }
      : e.key.endsWith('#2')
        ? { sid: 's2', tab: 'tab-gone', at: Date.now() }
        : { sid: 's3-never-started', tab: 'tab-gone', at: Date.now() },
  }))
  ran.length = 0
  deleted.length = 0
  stored.length = 0
  storedValues.length = 0
  ticks = []
  filled.length = 0
  toasts.length = 0
  opened.length = 0
  on('process.run', (_: unknown, e: { argv: readonly string[]; init?: { env?: Record<string, string> } }) => {
    ran.push([...e.argv])
    const [cmd, arg] = e.argv
    const stdout =
      cmd === 'sh' && e.argv[2]?.includes('/sessions"')
        ? liveFiles
        : cmd === 'sh' && e.argv[2]?.includes('d=$HOME')
        ? (e.argv[4] ?? '')
        : cmd === 'sh' && e.argv[3] === 'sh'
        ? e.argv.slice(4).map(path => `${path}\t${remotes[path] ?? ''}`).join('\n')
        : cmd === 'sh'
          ? `/opt/homebrew/bin/glab\n${e.init?.env?.WIP_WALL_SAVED_HOST || 'gitlab.example.com'}\n${e.init?.env?.WIP_WALL_SAVED_ROOT || (noRoot ? '' : '/Users/dev/Developer/Project-Work')}\n/Users/dev/.claude/projects\n${e.init?.env?.WIP_WALL_SAVED_TERMINAL || terminalName}\n`
        : cmd === 'ps'
        ? alive.replace(/^(?!\d+ )(?=.)/gm, '999 ')
        : cmd === 'uuidgen'
        ? 'NEW-SID\n'
        : cmd === 'osascript'
        ? (e.argv[2]?.includes('select tab') ? selected : e.argv[2]?.includes('working directory is') ? focused : 'tab-1\n')
        : cmd === 'git'
          ? (branchName !== '' ? `${branchName}\n` : arg === '-C' && e.argv[2]?.endsWith('/core/lib') ? '1-open-one\nmain\n' : 'main\n')
        : cmd === 'find' && arg === '/Users/dev/.claude/projects'
          ? '200 /Users/dev/.claude/projects/p/s1.jsonl\n100 /Users/dev/.claude/projects/p/s2.jsonl\n'
          : cmd === 'find'
            ? clones
            : e.argv[2] === 'graphql'
              ? graphqlPage(e.argv, pages)
              : e.argv.at(-1)?.startsWith('issues')
                ? issues.map(issue => JSON.stringify(issue)).join('\n')
                : e.argv.at(-1)?.startsWith('todos')
                  ? todos.map(t => JSON.stringify(t)).join('\n')
                  : '[]'
    const failing = (todosFail && e.argv[e.argv.length - 1]?.startsWith('todos')) || (launchFails && cmd === 'osascript' && e.argv[2]?.includes('new window')) || (issuesFail && e.argv[e.argv.length - 1]?.startsWith('issues')) || (psFail && cmd === 'ps') || (authFail && e.argv[1] === 'auth')

    return { value: { exitCode: failing ? 1 : 0, stdout, stderr: failing ? (issuesFail ? 'boom\u001b[2J\u0007' : 'todos boom') : '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  await $.session.start({ cwd, surface: 'terminal', isInteractive: true })
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0))
  if (args !== null) await $.command.run({ command: 'wip-wall', args, ...TYPED_RUN })

  return $.ui.mount(PANE)
}

test('done is a status chip: hidden by default, shown alone when pressed', async ($, on) => {
  const ui = await boot($, on)

  expect(await ui.find({ type: 'Text', text: /open one/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^(now|\d+(m|h|d|w|mo|y))$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /finished one/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /unlabelled/ })).toBeUndefined()

  await $.ui.press({ plugin: 'wip-wall', key: 'status:menu' })
  expect((await ui.find({ key: 'status:done' }))?.props.label ?? '').toContain('Done·1')

  await $.ui.press({ plugin: 'wip-wall', key: 'status:done' })
  expect(await ui.find({ type: 'Text', text: /finished one/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /open one/ })).toBeUndefined()

  await $.ui.press({ plugin: 'wip-wall', key: 'status:menu' })
  await $.ui.press({ plugin: 'wip-wall', key: 'status:all' })
  expect(await ui.find({ type: 'Text', text: /open one/ })).toBeDefined()
  await ui.unmount()
})

test('a board of only done cards points at the Done chip instead of saying no cards match', async ($, on) => {
  const ui = await boot($, on, FIXTURE_ROOT, ISSUES.slice(1, 2))

  expect(await ui.find({ type: 'Text', text: /^Only done cards left/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /No cards match/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /finished one/ })).toBeUndefined()
  await ui.unmount()
})

test('a date filter that hides every open card still says so while done cards stay in range', async ($, on) => {
  const old = new Date(Date.now() - 20 * DAY).toISOString()
  const ui = await boot($, on, FIXTURE_ROOT, [{ ...ISSUES[0], updated_at: old }, { ...ISSUES[1], updated_at: NOTED }])

  await $.ui.press({ plugin: 'wip-wall', key: 'date:menu' })
  await $.ui.press({ plugin: 'wip-wall', key: 'date:week' })
  expect(await ui.find({ type: 'Text', text: /No cards match/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Only done cards left/ })).toBeUndefined()
  await ui.unmount()
})

test('a status chip filters the cards to that status and all clears it', async ($, on) => {
  const ui = await boot($, on)

  await $.ui.press({ plugin: 'wip-wall', key: 'status:menu' })
  expect(await ui.find({ type: 'Text', text: /^\[Doing·1\]$/ })).toBeDefined()

  await $.ui.press({ plugin: 'wip-wall', key: 'status:Doing' })
  expect(await ui.find({ type: 'Text', text: /open one/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /other group/ })).toBeUndefined()

  await $.ui.press({ plugin: 'wip-wall', key: 'status:menu' })
  await $.ui.press({ plugin: 'wip-wall', key: 'status:all' })
  expect(await ui.find({ type: 'Text', text: /other group/ })).toBeDefined()
  await ui.unmount()
})

test('the date chips narrow the cards by last update and all brings them back', async ($, on) => {
  const fresh = { references: { full: 'acme/core/lib#5' }, title: 'fresh one', web_url: 'https://x/u5', updated_at: new Date().toISOString(), labels: ['Status::Doing'] }
  const ui = await boot($, on, FIXTURE_ROOT, [...ISSUES, fresh])

  expect(await ui.find({ type: 'Text', text: /open one/ })).toBeDefined()
  await $.ui.press({ plugin: 'wip-wall', key: 'date:menu' })
  await $.ui.press({ plugin: 'wip-wall', key: 'date:week' })
  expect(await ui.find({ type: 'Text', text: /fresh one/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /open one/ })).toBeUndefined()
  expect(await ui.findAll({ type: 'Text', text: /\[all·1\]/ })).toHaveLength(2)
  expect(await ui.findAll({ type: 'Text', text: /^\+1 more$/ })).toHaveLength(3)
  expect(await ui.findAll({ type: 'Text', text: /^\+4 more$/ })).toHaveLength(1)

  await $.ui.press({ plugin: 'wip-wall', key: 'date:menu' })
  await $.ui.press({ plugin: 'wip-wall', key: 'date:all' })
  expect(await ui.find({ type: 'Text', text: /open one/ })).toBeDefined()
  await ui.unmount()
})

test('a project chip narrows the cards and the repo row follows it', async ($, on) => {
  const ui = await boot($, on)

  expect(await ui.find({ type: 'Text', text: /\[web·1\]/ })).toBeUndefined()
  await $.ui.press({ plugin: 'wip-wall', key: 'group:menu' })
  await $.ui.press({ plugin: 'wip-wall', key: 'group:acme-team' })
  expect(await ui.find({ type: 'Text', text: /other group/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /open one/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /\[web·1\]/ })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: /\[all·/ })).toHaveLength(1)
  await ui.unmount()
})

test('repo chips drop the project prefix unless that would clash with another repo', async ($, on) => {
  const issue = (repo: string, num: number) => ({ references: { full: `acme-team/${repo}#${num}` }, title: `t${num}`, web_url: `u${num}`, updated_at: RECENT, labels: ['Status::Doing'] })
  const ui = await boot($, on, FIXTURE_ROOT, [issue('acme-team-api', 10), issue('acme-team-web', 11), issue('web', 12)])

  await $.ui.press({ plugin: 'wip-wall', key: 'group:menu' })
  await $.ui.press({ plugin: 'wip-wall', key: 'group:acme-team' })
  await $.ui.press({ plugin: 'wip-wall', key: 'repo:menu' })
  expect(await ui.find({ type: 'Text', text: /\[api·1\]/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\[acme-team-web·1\]/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\[web·1\]/ })).toBeDefined()
  await ui.unmount()
})

test('an open window shows a bullseye, a saved session with no window a ringed circle, nothing else an empty ring', async ($, on) => {
  alive = 'node /usr/local/bin/claude --resume s1\n'
  try {
    const ui = await boot($, on)

    expect(await ui.findAll({ type: 'Text', text: /^◉ $/ })).toHaveLength(1)
    expect(await ui.findAll({ type: 'Text', text: /^○ $/ })).toHaveLength(1)
    expect(await ui.findAll({ type: 'Text', text: /^◎ $/ })).toHaveLength(0)

    await $.ui.press({ plugin: 'wip-wall', key: 'status:menu' })
    await $.ui.press({ plugin: 'wip-wall', key: 'status:done' })
    expect(await ui.findAll({ type: 'Text', text: /^◎ $/ })).toHaveLength(1)
    expect(await ui.findAll({ type: 'Text', text: /^◉ $/ })).toHaveLength(1)
    expect(await ui.findAll({ type: 'Text', text: /^○ $/ })).toHaveLength(0)
    await ui.unmount()
  } finally {
    alive = ''
  }
})

test('cards with an open window or this session sit in Working above the filtered cards, whatever the filters say', async ($, on) => {
  alive = 'node /usr/local/bin/claude --resume s1\n'
  sessionId = 's2'
  try {
    const ui = await boot($, on)

    expect(await ui.find({ type: 'Text', text: /^── Working · 2 ─+$/ })).toBeDefined()
    expect((await ui.findAll({ type: 'Client' })).filter(c => String(c.props.module).endsWith('pulse.tsx'))).toHaveLength(1)
    await $.ui.press({ plugin: 'wip-wall', key: 'working:toggle' })
    expect(await ui.find({ type: 'Text', text: /^── Working · 2 ─+$/ })).toBeDefined()
    expect((await ui.findAll({ type: 'Client' })).filter(c => String(c.props.module).endsWith('pulse.tsx'))).toHaveLength(0)
    await $.ui.press({ plugin: 'wip-wall', key: 'working:toggle' })
    expect(await ui.findAll({ type: 'Text', text: /^◉ $/ })).toHaveLength(1)
    await $.ui.press({ plugin: 'wip-wall', key: 'group:menu' })
    await $.ui.press({ plugin: 'wip-wall', key: 'group:acme-team' })
    expect(await ui.find({ type: 'Text', text: /open one/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /finished one/ })).toBeDefined()
    expect(await ui.findAll({ type: 'Text', text: /other group/ })).toHaveLength(1)
    await ui.unmount()
  } finally {
    alive = ''
    sessionId = 'main'
  }
})

test('a session started by hand in a clone on an issue branch puts that card in Working', async ($, on) => {
  const ui = await boot($, on, '/Users/dev/Developer/Project-Work/core/lib')

  expect(await ui.find({ type: 'Text', text: /^── Working · 1 ─+$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /open one/ })).toBeDefined()
  await ui.unmount()
})

test('a card another window runs is not also taken as this session by its branch', async ($, on) => {
  alive = 'node /usr/local/bin/claude --resume s1\n'
  try {
    const ui = await boot($, on, '/Users/dev/Developer/Project-Work/core/lib')

    expect(await ui.find({ type: 'Text', text: /^── Working · 1 ─+$/ })).toBeDefined()
    expect(await ui.findAll({ type: 'Text', text: /^◉ $/ })).toHaveLength(1)
    expect((await ui.findAll({ type: 'Client' })).filter(c => String(c.props.module).endsWith('pulse.tsx'))).toHaveLength(0)
    await ui.unmount()
  } finally {
    alive = ''
  }
})

test('the branch card is found at startup without waiting for the next liveness tick', async ($, on) => {
  const ui = await boot($, on, '/Users/dev/Developer/Project-Work/core/lib', ISSUES, null)
  for (let i = 0; i < 40; i++) await new Promise(resolve => setTimeout(resolve, 0))

  expect(await ui.find({ type: 'Text', text: /^── Working · 1 ─+$/ })).toBeDefined()
  await ui.unmount()
})

test('a session started by hand on an issue branch claims that card for the other panes, once at startup', async ($, on) => {
  const card = { key: 'acme/core/lib#1', kind: 'issue', project: 'acme/core/lib', group: 'core', repo: 'lib', num: 1, title: 'cached one', url: 'https://x/u1', status: 'Doing', updated: RECENT, due: '', mrs: [] }
  hides = { 'cache:board': { v: 1, at: Date.now(), cards: [card], mentions: [], local: [], dirs: { 'acme/core/lib': '/Users/dev/Developer/Project-Work/core/lib' }, boards: {} } as unknown as string }
  sessionId = 'hand'
  try {
    const ui = await boot($, on, '/Users/dev/Developer/Project-Work/core/lib', ISSUES, null)
    for (let i = 0; i < 40; i++) await new Promise(resolve => setTimeout(resolve, 0))
    expect(storedValues.filter(e => e.key.startsWith('card:')).map(e => [e.key, (e.value as { sid: string; in: string }).sid, (e.value as { in: string }).in])).toEqual([['card:acme/core/lib#1', 'hand', 'here']])
    await ui.unmount()
  } finally {
    hides = {}
    sessionId = 'main'
  }
})

test('a prompt re-reads the branch, so the claimed card follows a branch switch', async ($, on) => {
  const one = { key: 'acme/core/lib#1', kind: 'issue', project: 'acme/core/lib', group: 'core', repo: 'lib', num: 1, title: 'one', url: 'https://x/u1', status: 'Doing', updated: RECENT, due: '', mrs: [] }
  const two = { ...one, key: 'acme/core/lib#2', num: 2, title: 'two', url: 'https://x/u2' }
  hides = { 'cache:board': { v: 1, at: Date.now(), cards: [one, two], mentions: [], local: [], dirs: { 'acme/core/lib': '/Users/dev/Developer/Project-Work/core/lib' }, boards: {} } as unknown as string }
  sessionId = 'hand'
  try {
    const ui = await boot($, on, '/Users/dev/Developer/Project-Work/core/lib', ISSUES, null)
    for (let i = 0; i < 40; i++) await new Promise(resolve => setTimeout(resolve, 0))
    branchName = '2-other'
    await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } } as any)
    for (let i = 0; i < 40; i++) await new Promise(resolve => setTimeout(resolve, 0))
    expect(storedValues.filter(e => e.key.startsWith('card:')).map(e => e.key)).toEqual(['card:acme/core/lib#1', 'card:acme/core/lib#2'])
    expect(deleted).toContain('card:acme/core/lib#1')
    deleted.length = 0
    branchName = 'main'
    await $.prompt.submit({ text: 'hi', wait: false, origin: { kind: 'composer' } } as any)
    for (let i = 0; i < 40; i++) await new Promise(resolve => setTimeout(resolve, 0))
    expect(deleted).toContain('card:acme/core/lib#2')
    await ui.unmount()
  } finally {
    hides = {}
    sessionId = 'main'
    branchName = ''
  }
})

test('a card pressed here is not taken back by the branch claim', async ($, on) => {
  const one = { key: 'acme/core/lib#1', kind: 'issue', project: 'acme/core/lib', group: 'core', repo: 'lib', num: 1, title: 'one', url: 'https://x/u1', status: 'Doing', updated: RECENT, due: '', mrs: [] }
  hides = {
    'cache:board': { v: 1, at: Date.now(), cards: [one], mentions: [], local: [], dirs: { 'acme/core/lib': '/Users/dev/Developer/Project-Work/core/lib' }, boards: {} } as unknown as string,
    'card:acme-team/web#3': { sid: 'hand', tab: '', in: 'here', at: Date.now() } as unknown as string,
  }
  sessionId = 'hand'
  try {
    const ui = await boot($, on, '/Users/dev/Developer/Project-Work/core/lib', ISSUES, null)
    for (let i = 0; i < 40; i++) await new Promise(resolve => setTimeout(resolve, 0))
    expect(storedValues.filter(e => e.key.startsWith('card:'))).toEqual([])
    expect(deleted.filter(k => k.startsWith('card:'))).toEqual([])
    await ui.unmount()
  } finally {
    hides = {}
    sessionId = 'main'
  }
})

test('the session showing the pane gives the pane back when it ends, but not on /clear', async ($, on) => {
  const ui = await boot($, on)
  await $.session.end({ reason: 'clear' } as any)
  expect(deleted).not.toContain('pane:owner')
  await $.session.end({ reason: 'other' } as any)
  expect(deleted).toContain('pane:owner')
  await ui.unmount()
})

test('the Sort filter row switches between status and latest and is remembered', async ($, on) => {
  const ui = await boot($, on)
  expect(await ui.find({ type: 'Text', text: /^Sort +:$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '[default]' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '+1 more' })).toBeDefined()
  expect(await ui.find({ key: 'sort:latest' })).toBeUndefined()
  await $.ui.press({ plugin: 'wip-wall', key: 'sort:menu' })
  expect(await ui.find({ type: 'Text', text: '+1 more' })).toBeUndefined()
  await $.ui.press({ plugin: 'wip-wall', key: 'sort:latest' })
  await $.ui.press({ plugin: 'wip-wall', key: 'sort:menu' })
  await $.ui.press({ plugin: 'wip-wall', key: 'sort:status' })
  expect(storedValues.filter(e => e.key === 'ui:latest').map(e => e.value)).toEqual([true, false])
  expect(await ui.find({ type: 'Text', text: '[s]' })).toBeUndefined()
  await ui.unmount()
})

test('[c] pulses the card of this session like the box view and leaves the others still', async ($, on) => {
  alive = 'node /usr/local/bin/claude --resume s1\n'
  sessionId = 's2'
  try {
    const ui = await boot($, on)
    const pulses = async () => (await ui.findAll({ type: 'Client' })).filter(c => String(c.props.module).endsWith('pulse.tsx'))
    expect(await pulses()).toHaveLength(1)

    await $.ui.press({ plugin: 'wip-wall', key: 'compact:toggle' })
    expect(await pulses()).toHaveLength(1)
    expect(await ui.findAll({ type: 'Text', text: /^◉ $/ })).toHaveLength(1)
    await ui.unmount()
  } finally {
    alive = ''
    sessionId = 'main'
  }
})

test('opening claude inside a clone selects that project and repo', async ($, on) => {
  const ui = await boot($, on, '/Users/dev/Developer/Project-Work/PROJ-X/web/src')

  expect(await ui.find({ type: 'Text', text: /other group/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /open one/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^\[acme-team·/ })).toBeDefined()
  await ui.unmount()
})

test('opening claude outside any clone leaves the board on everything', async ($, on) => {
  const ui = await boot($, on, '/Users/dev/Developer')

  expect(await ui.find({ type: 'Text', text: /open one/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /other group/ })).toBeDefined()
  await ui.unmount()
})

test('an open Updated menu counts every range', async ($, on) => {
  const ui = await boot($, on)
  await $.ui.press({ plugin: 'wip-wall', key: 'date:menu' })

  for (const label of ['Week', 'Month', '6 Months', 'Year', 'all']) expect(await ui.find({ type: 'Text', text: new RegExp(`\\[${label}·\\d+\\]`) })).toBeDefined()
  await ui.unmount()
})

test('the pane draws its name alone in the header and the open count on the Updated chip', async ($, on) => {
  const ui = await boot($, on)

  expect(await ui.find({ type: 'Text', text: /^WIP-WALL$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /OPEN/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '[Month·2]' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '[Just now]' })).toBeDefined()
  await ui.unmount()
})

test('a chip with nothing open in it is hidden unless it is the selected one', async ($, on) => {
  const ui = await boot($, on, FIXTURE_ROOT, [
    ...ISSUES,
    { references: { full: 'acme-team/done-only#9' }, title: 'old', web_url: 'https://x/u9', updated_at: RECENT, labels: ['Status: Done'] },
  ])

  await $.ui.press({ plugin: 'wip-wall', key: 'group:menu' })
  expect(await ui.find({ type: 'Text', text: /\[acme-team·1\]/ })).toBeDefined()
  await $.ui.press({ plugin: 'wip-wall', key: 'group:acme-team' })
  expect(await ui.find({ type: 'Text', text: /\[done-only·/ })).toBeUndefined()
  await ui.unmount()
})

test('a loaded board with nothing assigned says so instead of loading forever', async ($, on) => {
  const ui = await boot($, on, FIXTURE_ROOT, [])

  expect(await ui.find({ type: 'Text', text: /Nothing assigned to you/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Loading board/ })).toBeUndefined()
  await ui.unmount()
})

test('pressing the header cycles the theme and recolours the pane', async ($, on) => {
  const ui = await boot($, on)
  const headerColor = async () => (await ui.find({ type: 'Text', text: /^WIP-WALL$/ }))?.props.color
  const doingColor = async () => (await ui.find({ type: 'Text', text: /^Doing$/ }))?.props.color

  expect(await headerColor()).toBe('#cdd6f4')
  expect(await doingColor()).toBe('#89b4fa')
  expect((await ui.find({ type: 'Text', text: /^WIP$/ }))?.props.color).toBe('#89b4fa')

  await $.ui.press({ plugin: 'wip-wall', key: 'theme' })
  expect(await headerColor()).toBe('#f3f2ee')
  expect(await doingColor()).toBe('#4cc3ff')


  for (const name of ['tokyo-night', 'rose-pine', 'gruvbox', 'cyberpunk']) {
    await $.ui.press({ plugin: 'wip-wall', key: 'theme' })
    await $.ui.press({ plugin: 'wip-wall', key: 'legend:toggle' })
    expect(await ui.find({ type: 'Text', text: new RegExp(`t: ${name} `) })).toBeDefined()
    await $.ui.press({ plugin: 'wip-wall', key: 'legend:toggle' })
  }
  expect(await headerColor()).toBe('#d1f7ff')
  expect(await doingColor()).toBe('#00f0ff')

  await $.ui.press({ plugin: 'wip-wall', key: 'theme' })
  expect(await headerColor()).toBe('#4c4f69')

  await $.ui.press({ plugin: 'wip-wall', key: 'theme' })
  expect(await headerColor()).toBe('#cdd6f4')
  await ui.unmount()
})

test('branch icon marks only issues with a local branch, not every card of a cloned repo', async ($, on) => {
  const ui = await boot($, on)

  expect(await ui.findAll({ type: 'Text', text: /^↓$/ })).toHaveLength(1)
  await ui.unmount()
})

test('a filter that matches nothing says so instead of drawing an empty pane', async ($, on) => {
  const ui = await boot($, on)

  expect(await ui.find({ type: 'Text', text: /No cards match/ })).toBeUndefined()
  await $.ui.press({ plugin: 'wip-wall', key: 'date:menu' })
  await $.ui.press({ plugin: 'wip-wall', key: 'date:week' })
  expect(await ui.find({ type: 'Text', text: /No cards match/ })).toBeDefined()
  await ui.unmount()
})

test('the Filters rule carries an age button that refreshes and shows the update age', async ($, on) => {
  const ui = await boot($, on)

  expect(await ui.find({ key: 'refresh' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '[Just now]' })).toBeDefined()
  await ui.unmount()
})

test('mock cards keep their open, saved and branch markers after startup work finishes', async ($, on) => {
  const ui = await boot($, on, FIXTURE_ROOT, ISSUES, 'mock')
  for (let i = 0; i < 500; i++) await Promise.resolve()

  expect(await ui.findAll({ type: 'Text', text: /^◉ $/ })).toHaveLength(2)
  expect(await ui.findAll({ type: 'Text', text: /^◎ $/ })).toHaveLength(2)
  expect(await ui.findAll({ type: 'Text', text: /^↓$/ })).toHaveLength(5)
  expect(await ui.findAll({ type: 'Text', text: /^@$/ })).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: /^── Mentions · 2 ─+$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Client' })).filter(c => String(c.props.module).endsWith('pulse.tsx'))).toHaveLength(1)
  await ui.unmount()
})

test('[i] in the header shows and hides the legend under it, and the choice is remembered', async ($, on) => {
  const ui = await boot($, on)

  expect(await ui.find({ type: 'Text', text: /^● here/ })).toBeUndefined()
  await $.ui.press({ plugin: 'wip-wall', key: 'legend:toggle' })
  expect(await ui.find({ type: 'Text', text: /^● here  ◉ open  ◎ resumable  ○ none  ↓ branch  @ mentioned  ✕ hide$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^title: claude  status: web  c: compact  t: catppuccin  time: refresh$/ })).toBeDefined()
  expect(storedValues.filter(e => e.key === 'ui:legend').map(e => e.value)).toEqual([true])
  await $.ui.press({ plugin: 'wip-wall', key: 'legend:toggle' })
  expect(await ui.find({ type: 'Text', text: /^● here/ })).toBeUndefined()
  expect((await ui.findAll({ type: 'Box' })).map(b => b.props.minHeight).filter(Boolean)).toEqual([30])
  await ui.unmount()
})

test('every section rule carries its card count and folds with [hide]', async ($, on) => {
  const ui = await boot($, on, FIXTURE_ROOT, [
    ...ISSUES,
    { references: { full: 'acme-team/web#6' }, title: 'second', web_url: 'https://x/u6', updated_at: RECENT, labels: ['Status::Doing'] },
    { references: { full: 'acme-team/api#7' }, title: 'third', web_url: 'https://x/u7', updated_at: RECENT, labels: ['Status::Doing'] },
  ])

  expect(await ui.find({ type: 'Text', text: /^── core · 1 ─/ })).toBeDefined()
  await $.ui.press({ plugin: 'wip-wall', key: 'group:menu' })
  await $.ui.press({ plugin: 'wip-wall', key: 'group:acme-team' })
  expect(await ui.find({ type: 'Text', text: /^── web · 2 ─/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^── api · 1 ─/ })).toBeDefined()
  await $.ui.press({ plugin: 'wip-wall', key: 'repo:menu' })
  await $.ui.press({ plugin: 'wip-wall', key: 'repo:web' })
  expect(await ui.find({ type: 'Text', text: /^── Cards · 2 ─/ })).toBeDefined()
  expect(await ui.find({ key: 'web:acme-team/web#6' })).toBeDefined()
  await $.ui.press({ plugin: 'wip-wall', key: 'sec::toggle' })
  expect(await ui.find({ type: 'Text', text: /^── Cards · 2 ─/ })).toBeDefined()
  expect(await ui.find({ key: 'web:acme-team/web#6' })).toBeUndefined()
  expect(storedValues.filter(e => e.key === 'ui:folded').map(e => e.value)).toEqual([['sec:']])
  await $.ui.press({ plugin: 'wip-wall', key: 'sec::toggle' })
  expect(await ui.find({ key: 'web:acme-team/web#6' })).toBeDefined()
  await ui.unmount()
})

test('a long title takes a second line and only a title past two lines ends in an ellipsis', async ($, on) => {
  const issue = (num: number, title: string) => ({ references: { full: `acme/core/lib#${num}` }, title, web_url: `u${num}`, updated_at: new Date().toISOString(), labels: ['Status::Doing'] })
  const ui = await boot($, on, FIXTURE_ROOT, [
    issue(8, 'alpha beta gamma delta epsilon zeta eta theta iota kappa omega'),
    issue(9, 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon'),
  ])

  expect(await ui.find({ type: 'Text', text: /^#8 alpha/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^zeta.*omega\s*$/ })).toBeDefined()
  expect(await ui.findAll({ key: 'open:acme/core/lib#8:0' })).toHaveLength(1)
  expect(await ui.findAll({ key: 'open:acme/core/lib#8:1' })).toHaveLength(1)
  expect(await ui.find({ type: 'Text', text: /^#9 alpha/ })).toBeDefined()
  const tail = await ui.find({ type: 'Text', text: /…\s*$/ })
  expect(tail).toBeDefined()
  expect((tail?.text ?? '').length).toBeLessThanOrEqual(40)
  await ui.unmount()
})

test('each card carries one mr line: the number, its status when different, flags that fit, and the rest counted', async ($, on) => {
  const ui = await boot($, on, FIXTURE_ROOT, [], 'mock')

  expect(await ui.find({ type: 'Text', text: /^MR !131$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ · ci-ok$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ · no status$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ · ci-ok · \+2 MR$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^MR !138$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ · ci-fail · conflict · draft · ?$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^MR !141/ })).toBeUndefined()
  await ui.unmount()
})

test('pressing the ellipsis of a cut mr line plays the marquee', async ($, on) => {
  const ui = await boot($, on, FIXTURE_ROOT, [], 'mock')
  const playing = async () => (await ui.findAll({ type: 'Client' })).filter(c => String(c.props.module).endsWith('marquee.tsx')).length

  expect(await playing()).toBe(0)
  await $.ui.press({ plugin: 'wip-wall', key: 'mr:qa/test-card#38' })
  expect(await playing()).toBe(1)
  await ui.unmount()
})

const gqlMr = (reference: string, branch: string, extra = {}) => ({
  reference,
  title: 'mr',
  webUrl: `https://x/${reference}`,
  updatedAt: new Date().toISOString(),
  sourceBranch: branch,
  draft: false,
  conflicts: false,
  approved: false,
  detailedMergeStatus: 'MERGEABLE',
  mergeableDiscussionsState: true,
  labels: { nodes: [{ title: 'Status::Doing' }] },
  headPipeline: { status: 'SUCCESS' },
  reviewers: { nodes: [{ id: 'gid://gitlab/User/9' }] },
  notes: { nodes: [] },
  ...extra,
})

test('merge requests come from graphql and every page is followed', async ($, on) => {
  const ui = await boot($, on, FIXTURE_ROOT, ISSUES, '', [
    [gqlMr('acme/core/lib!7', '1-open-one', { conflicts: true, headPipeline: { status: 'FAILED' } })],
    [gqlMr('acme-team/web!9', '3-other-group')],
  ])

  expect(await ui.find({ type: 'Text', text: /^MR !7$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ · ci-fail · conflict/ })).toBeDefined()
  await $.ui.press({ plugin: 'wip-wall', key: 'group:menu' })
  await $.ui.press({ plugin: 'wip-wall', key: 'group:acme-team' })
  expect(await ui.find({ type: 'Text', text: /^MR !9/ })).toBeDefined()
  await ui.unmount()
})

test('merge requests waiting for my review sit in a Requests fold, unless they are also assigned to me', async ($, on) => {
  reviewNodes = [gqlMr('acme-team/web!12', 'feature', { title: 'please look', labels: { nodes: [] } }), gqlMr('acme/core/lib!7', '1-open-one')]
  try {
    const ui = await boot($, on, FIXTURE_ROOT, ISSUES, '', [[gqlMr('acme/core/lib!7', '1-open-one')]])
    expect(ran.some(a => a.some(x => x.includes('reviewStates: [UNREVIEWED, REVIEW_STARTED, UNAPPROVED]')))).toBe(true)
    expect(await ui.find({ type: 'Text', text: /^── Requests · 1 ─+$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^!12 please look/ })).toBeDefined()
    await $.ui.press({ plugin: 'wip-wall', key: 'reviews:toggle' })
    expect(await ui.find({ type: 'Text', text: /^!12 please look/ })).toBeUndefined()
    expect(storedValues.filter(e => e.key === 'ui:reviews').map(e => e.value)).toEqual([false])
    await ui.unmount()
  } finally {
    reviewNodes = []
  }
})

test('a failed review query keeps the board and says why', async ($, on) => {
  reviewsFail = true
  try {
    const ui = await boot($, on)
    expect(await ui.find({ type: 'Text', text: /review requests: GitLab returned no current user/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /open one/ })).toBeDefined()
    await ui.unmount()
  } finally {
    reviewsFail = false
  }
})

test('[c] draws each card as one row that still opens, links and hides, and is remembered', async ($, on) => {
  const ui = await boot($, on)
  expect(await ui.find({ type: 'Text', text: /^#1 open one$/ })).toBeUndefined()

  await $.ui.press({ plugin: 'wip-wall', key: 'compact:toggle' })
  expect(storedValues.filter(e => e.key === 'ui:compact').map(e => e.value)).toEqual([true])
  expect(await ui.find({ type: 'Text', text: /^#1 open one$/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Box' })).some(b => b.props.borderStyle !== undefined)).toBe(false)
  expect(await ui.find({ key: 'web:acme/core/lib#1' })).toBeDefined()
  expect(await ui.find({ key: 'hide:acme/core/lib#1' })).toBeDefined()

  await $.ui.press({ plugin: 'wip-wall', key: 'open:acme/core/lib#1:0' })
  expect(await places(ui)).toEqual(['[here]', '[split]', '[tab]', '[window]'])
  await ui.unmount()
})

test('[c] puts the status and then the age, padded to one width, at the end of the row, with no dots between the parts', async ($, on) => {
  const ui = await boot($, on)
  await $.ui.press({ plugin: 'wip-wall', key: 'compact:toggle' })
  const keys = (await ui.findAll({ type: 'Button' })).map((b: any) => String(b.key)).filter(k => k.endsWith('acme/core/lib#1') || k.endsWith('acme/core/lib#1:0'))
  expect(keys).toEqual(['open:acme/core/lib#1:0', 'web:acme/core/lib#1', 'hide:acme/core/lib#1'])
  expect(await ui.findAll({ type: 'Text', text: /^ · $/ })).toHaveLength(0)
  const ages = (await ui.findAll({ type: 'Text', text: /^ *(now|\d+(m|h|d|w|mo|y)) $/ })).map((t: any) => String(t.text ?? t.props.children))
  expect(ages.length).toBeGreaterThan(0)
  expect(ages.every(age => age.length === 4)).toBe(true)
  await ui.unmount()
})

test('[c] tints the MR link green when its pipeline passed', async ($, on) => {
  const ui = await boot($, on, FIXTURE_ROOT, ISSUES, '', [[gqlMr('acme/core/lib!7', '1-open-one', { headPipeline: { status: 'SUCCESS' } })]])
  await $.ui.press({ plugin: 'wip-wall', key: 'compact:toggle' })
  expect((await ui.find({ type: 'Text', text: /^MR$/ }))?.props.color).toBe('#a6e3a1')
  await ui.unmount()
})

test('compact rows keep who asked for a review, keep its review status, tint the MR link by its worst flag, and draw mentions as rows', async ($, on) => {
  reviewNodes = [gqlMr('acme-team/web!12', 'feature', { title: 'please look', labels: { nodes: [] }, author: { username: 'alex' }, headPipeline: { status: 'FAILED' } })]
  todos = [todo('mentioned', 'acme-team/web#50', 'sam.k', 'look here')]
  try {
    const ui = await boot($, on)
    expect(await ui.find({ type: 'Text', text: /^alex · / })).toBeDefined()
    await $.ui.press({ plugin: 'wip-wall', key: 'compact:toggle' })
    expect(await ui.find({ type: 'Text', text: /^!12 please look$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^alex$/ })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /^MR$/ }))?.props.color).toBe('#f38ba8')
    expect(await ui.find({ type: 'Text', text: /^ci-fail$/ })).toBeUndefined()
    expect(await ui.find({ key: 'web:acme-team/web!12' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^review$/ })).toBeDefined()
    await $.ui.press({ plugin: 'wip-wall', key: 'mrweb:acme-team/web!12' })
    expect(ran).toContainEqual(['open', 'https://x/acme-team/web!12'])
    expect(await ui.find({ type: 'Text', text: /^#50 / })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /look here/ })).toBeUndefined()
    await $.ui.press({ plugin: 'wip-wall', key: 'open:@acme-team/web#50:0' })
    expect(await places(ui)).toEqual(['[here]', '[split]', '[tab]', '[window]'])
    await ui.unmount()
  } finally {
    reviewNodes = []
    todos = []
  }
})

test('the web icon opens the card url in the browser', async ($, on) => {
  const ui = await boot($, on)

  expect(await ui.find({ key: 'web:acme/core/lib#1' })).toBeDefined()
  await $.ui.press({ plugin: 'wip-wall', key: 'web:acme/core/lib#1' })
  expect(ran).toContainEqual(['open', 'https://x/u1'])
  await ui.unmount()
})

test('pressing MR !N on the mr line opens the merge request in the browser', async ($, on) => {
  const ui = await boot($, on, FIXTURE_ROOT, ISSUES, '', [[gqlMr('acme/core/lib!7', '1-open-one')]])

  await $.ui.press({ plugin: 'wip-wall', key: 'mrweb:acme/core/lib#1' })
  expect(ran).toContainEqual(['open', 'https://x/acme/core/lib!7'])
  await ui.unmount()
})

test('when the merge request query fails the issues still draw and the pane says why', async ($, on) => {
  const ui = await boot($, on, FIXTURE_ROOT, ISSUES, '', 'no-user')

  expect(await ui.find({ type: 'Text', text: /merge requests: GitLab returned no current user/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /open one/ })).toBeDefined()
  await ui.unmount()
})

test('the hide icon drops a card from the board, its row under Dismissed brings it back', async ($, on) => {
  const ui = await boot($, on)

  expect(await ui.find({ type: 'Text', text: /open one/ })).toBeDefined()
  await $.ui.press({ plugin: 'wip-wall', key: 'hide:acme/core/lib#1' })
  expect(await ui.find({ type: 'Text', text: /open one/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^── Dismissed · 1 ─+$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /open one/ })).toBeUndefined()
  await $.ui.press({ plugin: 'wip-wall', key: 'dismissed:toggle' })
  expect(await ui.find({ type: 'Text', text: /open one/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '↩' })).toBeDefined()
  await $.ui.press({ plugin: 'wip-wall', key: 'restore:acme/core/lib#1' })
  expect(deleted).toEqual(['hide:acme/core/lib#1'])
  expect(await ui.find({ type: 'Text', text: /^── Dismissed/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /open one/ })).toBeDefined()
  await ui.unmount()
})

const todo = (action: string, ref: string, by: string, body: string) => ({
  action_name: action,
  target_type: 'Issue',
  target_url: `https://x/${ref}#note_9`,
  body,
  created_at: NOTED,
  author: { username: by },
  project: { path_with_namespace: ref.split('#')[0] },
  target: { iid: Number(ref.split('#')[1]), title: 'popup cases', web_url: `https://x/${ref}` },
})

test('a mention of an issue not assigned to you draws a card under Mentions, one assigned to you gets an @ instead', async ($, on) => {
  todos = [todo('directly_addressed', 'acme-team/site-web#349', 'jamie.r', '@me ipad part'), todo('mentioned', 'acme/core/lib#1', 'sam.k', 'look')]
  const ui = await boot($, on)

  expect(await ui.find({ type: 'Text', text: /^── Mentions · 1 ─+$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /popup cases/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '@ jamie.r' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '@me ipad part' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '@' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '@ sam.k' })).toBeUndefined()
  await ui.unmount()
  todos = []
})

test('hiding a mention drops it and its row under Dismissed brings it back', async ($, on) => {
  todos = [todo('mentioned', 'acme-team/site-web#349', 'jamie.r', 'hi')]
  const ui = await boot($, on)

  await $.ui.press({ plugin: 'wip-wall', key: 'hide:@acme-team/site-web#349' })
  expect(await ui.find({ type: 'Text', text: /popup cases/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^── Dismissed · 1 ─+$/ })).toBeDefined()
  await $.ui.press({ plugin: 'wip-wall', key: 'dismissed:toggle' })
  expect(await ui.find({ type: 'Text', text: /popup cases/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '@ jamie.r' })).toBeDefined()
  await $.ui.press({ plugin: 'wip-wall', key: 'restore:@acme-team/site-web#349' })
  expect(await ui.find({ type: 'Text', text: /popup cases/ })).toBeDefined()
  await ui.unmount()
  todos = []
})

test('when the todos query fails the cards still draw and the pane says why', async ($, on) => {
  todosFail = true
  const ui = await boot($, on)

  expect(await ui.find({ type: 'Text', text: /mentions: todos boom/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /open one/ })).toBeDefined()
  await ui.unmount()
  todosFail = false
})

test('the date chips narrow the mentions by the time of the note', async ($, on) => {
  todos = [{ ...todo('mentioned', 'acme-team/site-web#349', 'jamie.r', 'hi'), created_at: new Date().toISOString() }, { ...todo('mentioned', 'acme-team/site-web#350', 'sam.k', 'old'), created_at: '2026-01-01T00:00:00Z' }]
  const ui = await boot($, on)

  expect(await ui.find({ type: 'Text', text: /^── Mentions · 1 ─+$/ })).toBeDefined()
  await $.ui.press({ plugin: 'wip-wall', key: 'date:menu' })
  await $.ui.press({ plugin: 'wip-wall', key: 'date:all' })
  expect(await ui.find({ type: 'Text', text: /^── Mentions · 2 ─+$/ })).toBeDefined()
  await $.ui.press({ plugin: 'wip-wall', key: 'date:menu' })
  await $.ui.press({ plugin: 'wip-wall', key: 'date:week' })
  expect(await ui.find({ type: 'Text', text: /^── Mentions · 1 ─+$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '@ sam.k' })).toBeUndefined()
  await ui.unmount()
  todos = []
})

test('the Mentions header folds the cards away and brings them back, and remembers the choice', async ($, on) => {
  todos = [todo('mentioned', 'acme-team/site-web#349', 'jamie.r', 'hi')]
  const ui = await boot($, on)

  const hideCount = (await ui.findAll({ type: 'Text', text: '[hide]' })).length
  await $.ui.press({ plugin: 'wip-wall', key: 'mentions:toggle' })
  expect(await ui.find({ type: 'Text', text: '[show]' })).toBeDefined()
  expect(await ui.findAll({ type: 'Text', text: '[hide]' })).toHaveLength(hideCount - 1)
  expect(await ui.find({ type: 'Text', text: /popup cases/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /open one/ })).toBeDefined()
  await $.ui.press({ plugin: 'wip-wall', key: 'mentions:toggle' })
  expect(await ui.find({ type: 'Text', text: /popup cases/ })).toBeDefined()
  await ui.unmount()
  todos = []
})

const newTabs = () => ran.filter(a => a[0] === 'osascript' && a[2]?.includes('new window'))

test('two presses on one title open one window', async ($, on) => {
  const ui = await boot($, on)

  await $.ui.press({ plugin: 'wip-wall', key: 'open:acme-team/web#3:0' })
  await Promise.all([$.ui.press({ plugin: 'wip-wall', key: 'choose:acme-team/web#3:window' }), $.ui.press({ plugin: 'wip-wall', key: 'choose:acme-team/web#3:window' })])
  expect(newTabs()).toHaveLength(1)
  await ui.unmount()
})

test('with WIP_WALL_TERMINAL iterm2 a card opens through iTerm2 and its session id is stored', async ($, on) => {
  terminalName = 'iterm2'
  try {
    const ui = await boot($, on)

    await openCard($, 'acme-team/web#3', 'tab')
    const scripts = ran.filter(a => a[0] === 'osascript').map(a => a[2] ?? '')
    expect(scripts.some(text => text.includes('tell application "iTerm2"') && text.includes('create tab'))).toBe(true)
    expect(scripts.some(text => text.includes('Ghostty') && text.includes('surface configuration'))).toBe(false)
    expect(storedValues.findLast(e => e.key === 'card:acme-team/web#3')?.value).toMatchObject({ in: 'tab', tab: 'tab-1' })
    await ui.unmount()
  } finally {
    terminalName = ''
  }
})

test('two clones with one repo name open the one whose remote is the card project', async ($, on) => {
  clones = '/Users/dev/Developer/Project-Work/zzz/web/.git\n/Users/dev/Developer/Project-Work/acme-team/web/.git\n'
  remotes = {
    '/Users/dev/Developer/Project-Work/zzz/web': 'git@gitlab.example.com:acme-team/web.git',
    '/Users/dev/Developer/Project-Work/acme-team/web': 'git@gitlab.example.com:other/web.git',
  }
  const ui = await boot($, on)

  await openCard($, 'acme-team/web#3')
  expect(newTabs()[0]?.[3]).toBe('/Users/dev/Developer/Project-Work/zzz/web')
  clones = '/Users/dev/Developer/Project-Work/core/lib/.git\n/Users/dev/Developer/Project-Work/PROJ-X/web/.git\n'
  remotes = REMOTE_OF
  await ui.unmount()
})

const checkouts = async ($: any, on: any, order: 'ab' | 'ba') => {
  const root = '/Users/dev/Developer/Project-Work'
  remotes = { [`${root}/a/web`]: 'git@gitlab.example.com:acme-team/web.git', [`${root}/b/web`]: 'git@gitlab.example.com:acme-team/web.git' }
  clones = order === 'ab' ? `${root}/a/web/.git\n${root}/b/web/.git\n` : `${root}/b/web/.git\n${root}/a/web/.git\n`
  const ui = await boot($, on)

  await openCard($, 'acme-team/web#3')
  const opened = newTabs()[0]?.[3]
  clones = '/Users/dev/Developer/Project-Work/core/lib/.git\n/Users/dev/Developer/Project-Work/PROJ-X/web/.git\n'
  remotes = REMOTE_OF
  await ui.unmount()

  return opened
}

test('two checkouts of one project open the first by path when find lists them in order', async ($, on) => {
  expect(await checkouts($, on, 'ab')).toBe('/Users/dev/Developer/Project-Work/a/web')
})

test('two checkouts of one project open the first by path when find lists them reversed', async ($, on) => {
  expect(await checkouts($, on, 'ba')).toBe('/Users/dev/Developer/Project-Work/a/web')
})

test('a clone whose remote could not be read has no clone', async ($, on) => {
  const root = '/Users/dev/Developer/Project-Work'
  clones = `${root}/web/.git\n`
  remotes = { [`${root}/web`]: '!' }
  const ui = await boot($, on)

  await $.ui.press({ plugin: 'wip-wall', key: 'open:acme-team/web#3:0' })
  expect(newTabs()).toHaveLength(0)
  clones = '/Users/dev/Developer/Project-Work/core/lib/.git\n/Users/dev/Developer/Project-Work/PROJ-X/web/.git\n'
  remotes = REMOTE_OF
  await ui.unmount()
})

test('a card whose only same-named clone belongs to another project has no clone', async ($, on) => {
  clones = '/Users/dev/Developer/Project-Work/other/web/.git\n'
  remotes = { '/Users/dev/Developer/Project-Work/other/web': 'git@gitlab.example.com:other/web.git' }
  const ui = await boot($, on)

  await $.ui.press({ plugin: 'wip-wall', key: 'open:acme-team/web#3:0' })
  expect(newTabs()).toHaveLength(0)
  clones = '/Users/dev/Developer/Project-Work/core/lib/.git\n/Users/dev/Developer/Project-Work/PROJ-X/web/.git\n'
  remotes = REMOTE_OF
  await ui.unmount()
})

test('a card whose url is not http opens neither a browser nor a session', async ($, on) => {
  const bad = ISSUES.map(i => ({ ...i, web_url: 'file:///etc/passwd' }))
  const ui = await boot($, on, FIXTURE_ROOT, bad)

  await $.ui.press({ plugin: 'wip-wall', key: 'web:acme/core/lib#1' })
  await $.ui.press({ plugin: 'wip-wall', key: 'open:acme/core/lib#1:0' })
  expect(ran.filter(a => a[0] === 'open')).toHaveLength(0)
  expect(newTabs()).toHaveLength(0)
  await ui.unmount()
})

test('a refresh pressed while one runs joins it', async ($, on) => {
  const ui = await boot($, on)
  const issueCalls = () => ran.filter(a => a[a.length - 1]?.startsWith('issues')).length
  const start = issueCalls()

  await $.ui.press({ plugin: 'wip-wall', key: 'refresh' })
  const once = issueCalls() - start
  await Promise.all([$.ui.press({ plugin: 'wip-wall', key: 'refresh' }), $.ui.press({ plugin: 'wip-wall', key: 'refresh' })])
  expect(once).toBeGreaterThan(0)
  expect(issueCalls() - start - once).toBe(once)
  await ui.unmount()
})

test('mock cards open nothing, hide nothing for good and show no real mentions', async ($, on) => {
  todos = [todo('mentioned', 'acme-team/site-web#349', 'jamie.r', 'hi')]
  const ui = await boot($, on, FIXTURE_ROOT, ISSUES, 'mock')

  expect(await ui.find({ type: 'Text', text: /popup cases/ })).toBeUndefined()
  await $.ui.press({ plugin: 'wip-wall', key: 'open:qa/test-card!150:0' })
  await $.ui.press({ plugin: 'wip-wall', key: 'web:qa/test-card!150' })
  await $.ui.press({ plugin: 'wip-wall', key: 'hide:qa/test-card!150' })
  expect(newTabs()).toHaveLength(0)
  expect(ran.filter(a => a[0] === 'open')).toHaveLength(0)
  expect(stored.filter(key => key.startsWith('hide:'))).toHaveLength(0)
  await ui.unmount()
})

test('a refresh forgets dismissals whose card changed or left, and keeps mention ones when todos failed', async ($, on) => {
  hides = {
    'hide:acme/core/lib#1': RECENT,
    'hide:acme-team/web#3': '2026-01-01T00:00:00.000Z',
    'hide:gone/repo#9': RECENT,
    'hide:@acme-team/site-web#349': NOTED,
  }
  todosFail = true
  try {
    const ui = await boot($, on)

    expect([...new Set(deleted)].sort()).toEqual(['hide:acme-team/web#3', 'hide:gone/repo#9'])
    expect(await ui.find({ type: 'Text', text: /open one/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /other group/ })).toBeDefined()
    await ui.unmount()
  } finally {
    hides = {}
    todosFail = false
  }
})

test('a session a card opened does not open the pane or poll GitLab, but /wip-wall still does', async ($, on) => {
  sessionId = 's1'
  try {
    const ui = await boot($, on, FIXTURE_ROOT, ISSUES, null)
    expect(opened).toEqual([])
    expect(ran.some(argv => argv[1] === 'api')).toBe(false)
    await $.command.run({ command: 'wip-wall', args: '', ...TYPED_RUN })
    expect(opened).toContain('wip-wall')
    expect(ran.some(argv => argv[1] === 'api')).toBe(true)
    await ui.unmount()
  } finally {
    sessionId = 'main'
  }
})

test('a session outside the clone root does not open the pane or poll GitLab, but /wip-wall still does', async ($, on) => {
  const ui = await boot($, on, '/Users/dev/Downloads', ISSUES, null)
  expect(opened).toEqual([])
  expect(ran.some(argv => argv[1] === 'api')).toBe(false)
  await $.command.run({ command: 'wip-wall', args: '', ...TYPED_RUN })
  expect(opened).toContain('wip-wall')
  await ui.unmount()
})

const filtersShown = async (ui: any) => (await ui.find({ type: 'Text', text: /Filters/ })) !== undefined
const reachedGitlab = () => ran.some(argv => argv[1] === 'api' || (argv[0] === 'find' && argv[1] === FIXTURE_ROOT))

test('with no clone root set the pane stays closed, then /wip-wall draws only the checklist: no filters, no done, no fetch', async ($, on) => {
  noRoot = true
  try {
    const ui = await boot($, on, FIXTURE_ROOT, ISSUES, null)
    expect(opened).toEqual([])
    expect(reachedGitlab()).toBe(false)
    await $.command.run({ command: 'wip-wall', args: '', ...TYPED_RUN })
    await settle()
    expect(opened).toContain('wip-wall')
    expect(await ui.find({ type: 'Text', text: /not set: run \/wip-wall setup <folder>/ })).toBeDefined()
    expect(await filtersShown(ui)).toBe(false)
    expect(await ui.find({ key: 'setup:close' })).toBeUndefined()
    expect(await ui.find({ key: 'compact:toggle' })).toBeUndefined()
    expect(reachedGitlab()).toBe(false)
    await ui.unmount()
  } finally {
    noRoot = false
  }
})

test('a failed GitLab login blocks the pane the same way', async ($, on) => {
  authFail = true
  try {
    const ui = await boot($, on, FIXTURE_ROOT, ISSUES, '')
    await settle()
    expect(await filtersShown(ui)).toBe(false)
    expect(await ui.find({ type: 'Text', text: /run glab auth login --hostname/ })).toBeDefined()
    expect(reachedGitlab()).toBe(false)
    await ui.unmount()
  } finally {
    authFail = false
  }
})

test('the refresh and liveness timers do nothing while the gate is blocked', async ($, on) => {
  noRoot = true
  try {
    panes = [{ id: 'wip-wall' }]
    const ui = await boot($, on, FIXTURE_ROOT, ISSUES, '')
    await settle()
    ran.length = 0
    await tick()
    await tick()
    expect(reachedGitlab()).toBe(false)
    await ui.unmount()
  } finally {
    noRoot = false
    panes = []
  }
})

test('/wip-wall setup <folder> from a blocked pane saves it, passes the gate and loads the board', async ($, on) => {
  noRoot = true
  try {
    const ui = await boot($, on, FIXTURE_ROOT, ISSUES, '')
    await settle()
    expect(await filtersShown(ui)).toBe(false)
    await $.command.run({ command: 'wip-wall', args: `setup ${FIXTURE_ROOT}`, ...TYPED_RUN })
    await settle()
    expect(storedValues.filter(e => e.key === 'ui:root').map(e => e.value)).toEqual([FIXTURE_ROOT])
    expect(await filtersShown(ui)).toBe(true)
    expect(await ui.find({ key: 'setup:close' })).toBeDefined()
    expect(ran.some(argv => argv[1] === 'api')).toBe(true)
    await ui.unmount()
  } finally {
    noRoot = false
  }
})

test('/wip-wall mock still shows cards while the gate is blocked', async ($, on) => {
  noRoot = true
  try {
    const ui = await boot($, on, FIXTURE_ROOT, ISSUES, 'mock')
    await settle()
    expect(await filtersShown(ui)).toBe(true)
    expect(reachedGitlab()).toBe(false)
    await ui.unmount()
  } finally {
    noRoot = false
  }
})

test('after /clear a pane opened by /wip-wall outside the clone root comes back and polls again', async ($, on) => {
  panes = [{ id: 'wip-wall' }]
  try {
    const ui = await boot($, on, '/Users/dev/Downloads')
    registered = 0
    await $.session.end({ reason: 'clear', sessionId: 'main', resume: { id: 'next' } })
    await tick()
    expect(registered).toBe(1)
    expect(ticks.length).toBeGreaterThan(0)
    await ui.unmount()
  } finally {
    registered = 0
    panes = []
  }
})

test('a reload outside the clone root keeps an open pane refreshing', async ($, on) => {
  panes = [{ id: 'wip-wall' }]
  try {
    const ui = await boot($, on, '/Users/dev/Downloads', ISSUES, null)
    expect(opened).toContain('wip-wall')
    expect(ran.some(argv => argv[1] === 'api')).toBe(true)
    expect(ticks.length).toBeGreaterThan(0)
    await ui.unmount()
  } finally {
    panes = []
  }
})

test('a second session in the clone root leaves the pane to the session that shows it, but /wip-wall still opens one', async ($, on) => {
  hides = { 'pane:owner': { sid: 'other', at: Date.now() } as unknown as string }
  try {
    const ui = await boot($, on, `${FIXTURE_ROOT}/PROJ-X/web/src`, ISSUES, null)
    expect(opened).toEqual([])
    expect(ran.some(argv => argv[1] === 'api')).toBe(false)
    await $.command.run({ command: 'wip-wall', args: '', ...TYPED_RUN })
    expect(opened).toContain('wip-wall')
    expect(storedValues.findLast(v => v.key === 'pane:owner')?.value).toMatchObject({ sid: 'main' })
    await ui.unmount()
  } finally {
    hides = {}
  }
})

test('a pane owner that stopped beating no longer blocks a new session', async ($, on) => {
  hides = { 'pane:owner': { sid: 'other', at: Date.now() - 2 * 60 * 1000 } as unknown as string }
  try {
    const ui = await boot($, on, `${FIXTURE_ROOT}/PROJ-X/web/src`, ISSUES, null)
    expect(opened).toContain('wip-wall')
    await ui.unmount()
  } finally {
    hides = {}
  }
})

test('a session inside the clone root opens the pane by itself', async ($, on) => {
  const ui = await boot($, on, `${FIXTURE_ROOT}/PROJ-X/web/src`, ISSUES, null)
  expect(opened).toContain('wip-wall')
  await ui.unmount()
})

test('pressing a card offers where to open it on the card, and the script gets the choice', async ($, on) => {
  const ui = await boot($, on)
  await $.ui.press({ plugin: 'wip-wall', key: 'open:acme-team/web#3:0' })

  expect(await places(ui)).toEqual(['[here]', '[split]', '[tab]', '[window]'])
  expect((await ui.find({ type: 'Text', text: '[here]' }))?.props.bold).toBeUndefined()
  await $.ui.press({ plugin: 'wip-wall', key: 'choose:acme-team/web#3:here' })
  expect(filled).toEqual([])
  expect(toasts.some(t => /start it in web/.test(t))).toBe(true)
  expect(launches()).toHaveLength(0)
  await $.ui.press({ plugin: 'wip-wall', key: 'choose:acme-team/web#3:tab' })
  const made = launches()[0]
  expect(made?.[made.length - 1]).toBe('tab')
  expect(storedValues.filter(e => e.key === 'ui:openIn').map(e => e.value)).toEqual(['tab'])
  expect(await places(ui)).toEqual([])
  await ui.unmount()
})

test('here on a card with a saved session puts /resume in this prompt instead of its url', async ($, on) => {
  hides = { 'card:acme-team/web#3': { sid: 's2', tab: 'tab-1', in: 'tab', at: 0 } as unknown as string }
  try {
    const ui = await boot($, on, '/Users/dev/Developer/Project-Work/PROJ-X/web/src')
    await openCard($, 'acme-team/web#3', 'here')
    expect(filled).toEqual([{ text: '/resume s2', mode: 'replace' }])
    expect(launches()).toHaveLength(0)
    await ui.unmount()
  } finally {
    hides = {}
  }
})

test('a card whose new session left no transcript stays resumable through its previous one, newest transcript first', async ($, on) => {
  hides = {
    'card:acme-team/web#3': { sid: 'unsaved', prev: 's2', tab: '', in: 'tab', at: 0 } as unknown as string,
    'card:acme/core/lib#1': { sid: 's2', prev: 's1', tab: '', in: 'tab', at: 0 } as unknown as string,
  }
  try {
    const ui = await boot($, on)
    expect(deleted.filter(k => k.startsWith('card:'))).toEqual([])
    await openCard($, 'acme-team/web#3', 'tab')
    await openCard($, 'acme/core/lib#1', 'tab')
    expect(launches().map(a => a[4])).toEqual(['claude --session-id new-sid\n/resume s2', 'claude --session-id new-sid\n/resume s1'])
    await ui.unmount()
  } finally {
    hides = {}
  }
})

test('a card is not open when its process now runs another session than the one in its argv', async ($, on) => {
  alive = '5 claude --session-id s1\n'
  liveFiles = `Mon Oct  5 09:15:08 2026\t${JSON.stringify({ pid: 5, sessionId: 'moved-on', procStart: 'Mon Oct 5 09:15:08 2026' })}`
  try {
    const ui = await boot($, on)
    expect(await ui.find({ type: 'Text', text: /^── Working/ })).toBeUndefined()
    await ui.unmount()
  } finally {
    alive = ''
    liveFiles = ''
  }
})

test('a card is open while Claude lists its session as running, even when its argv holds no session id', async ($, on) => {
  liveFiles = [
    `Mon Oct  5 09:15:08 2026\t${JSON.stringify({ pid: 1, sessionId: 's3-never-started', procStart: 'Mon Oct 5 09:15:08 2026' })}`,
    `Mon Oct  5 09:15:08 2026\t${JSON.stringify({ pid: 2, sessionId: 's1', procStart: 'Tue Oct 6 01:00:00 2026' })}`,
    'not json',
  ].join('\n')
  try {
    const ui = await boot($, on)
    expect(await ui.find({ type: 'Text', text: /^── Working · 1 ─+$/ })).toBeDefined()
    expect(await ui.findAll({ type: 'Text', text: /^◉ $/ })).toHaveLength(1)
    await $.ui.press({ plugin: 'wip-wall', key: 'open:acme-team/web#3:0' })
    expect(await places(ui)).toEqual([])
    expect(launches()).toHaveLength(0)
    await ui.unmount()
  } finally {
    liveFiles = ''
  }
})

test('a card resumed here through its previous session is this session: drawn in Working, and pressing it opens nothing', async ($, on) => {
  sessionId = 's1'
  hides = { 'card:acme/core/lib#1': { sid: 'exited', prev: 's1', tab: '', in: 'tab', at: 0 } as unknown as string }
  try {
    const ui = await boot($, on)
    expect(await ui.find({ type: 'Text', text: /^── Working · 1 ─+$/ })).toBeDefined()
    await $.ui.press({ plugin: 'wip-wall', key: 'open:acme/core/lib#1:0' })
    expect(await places(ui)).toEqual([])
    expect(launches()).toHaveLength(0)
    await ui.unmount()
  } finally {
    sessionId = 'main'
    hides = {}
  }
})

test('split opens the card beside this terminal in the front tab and remembers the choice', async ($, on) => {
  const ui = await boot($, on)
  await openCard($, 'acme-team/web#3', 'split')
  const made = launches()[0]
  expect(made?.[made.length - 1]).toBe('split')
  expect(made?.[2]).toContain('split (focused terminal of t) direction right')
  expect(storedValues.findLast(e => e.key === 'card:acme-team/web#3')?.value).toMatchObject({ in: 'split', tab: 'tab-1' })
  expect(storedValues.filter(e => e.key === 'ui:openIn').map(e => e.value)).toEqual(['split'])
  await ui.unmount()
})

test('the last choice is bold and the order never changes', async ($, on) => {
  hides = { 'ui:openIn': 'tab' as string }
  try {
    const ui = await boot($, on)
    await $.ui.press({ plugin: 'wip-wall', key: 'open:acme-team/web#3:0' })

    expect(await places(ui)).toEqual(['[here]', '[split]', '[tab]', '[window]'])
    expect((await ui.find({ type: 'Text', text: '[tab]' }))?.props.bold).toBe(true)
    expect((await ui.find({ type: 'Text', text: '[window]' }))?.props.bold).toBe(false)
    await ui.unmount()
  } finally {
    hides = {}
  }
})

test('inside the card\'s clone, here puts the card url in this prompt and opens no terminal', async ($, on) => {
  const ui = await boot($, on, '/Users/dev/Developer/Project-Work/PROJ-X/web/src')
  await $.ui.press({ plugin: 'wip-wall', key: 'open:acme-team/web#3:0' })

  expect(await places(ui)).toEqual(['[here]', '[split]', '[tab]', '[window]'])
  await $.ui.press({ plugin: 'wip-wall', key: 'choose:acme-team/web#3:here' })
  expect(filled).toEqual([{ text: 'https://x/u3', mode: 'append' }])
  expect(launches()).toHaveLength(0)
  expect(storedValues.filter(e => e.key.startsWith('card:')).map(e => [e.key, (e.value as { sid: string; in: string }).sid, (e.value as { in: string }).in])).toEqual([['card:acme-team/web#3', 'main', 'here']])
  expect(await ui.find({ type: 'Text', text: /^── Working · 1 ─+$/ })).toBeDefined()
  await $.ui.press({ plugin: 'wip-wall', key: 'open:acme-team/web#3:0' })
  expect(await places(ui)).toEqual([])
  expect(toasts).toContain('This card is open in this session')
  await ui.unmount()
})

test('the cross closes the choice and opens nothing', async ($, on) => {
  const ui = await boot($, on)
  await $.ui.press({ plugin: 'wip-wall', key: 'open:acme-team/web#3:0' })
  await $.ui.press({ plugin: 'wip-wall', key: 'choose:acme-team/web#3:cancel' })

  expect(await places(ui)).toEqual([])
  expect(launches()).toHaveLength(0)
  await ui.unmount()
})

test('a card whose first launch fails forgets the session id it reserved', async ($, on) => {
  hides = { 'card:acme-team/web#3': undefined as unknown as string }
  launchFails = true
  try {
    const ui = await boot($, on)
    await openCard($, 'acme-team/web#3')
    expect(stored).toContain('card:acme-team/web#3')
    expect(deleted).toContain('card:acme-team/web#3')
    await ui.unmount()
  } finally {
    hides = {}
    launchFails = false
  }
})

test('a filter that empties the board still says so while Working has cards', async ($, on) => {
  alive = 'node /usr/local/bin/claude --resume s1\n'
  try {
    const ui = await boot($, on)
    await $.ui.press({ plugin: 'wip-wall', key: 'date:menu' })
    await $.ui.press({ plugin: 'wip-wall', key: 'date:week' })
    expect(await ui.find({ type: 'Text', text: /^── Working · 1/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /No cards match these filters/ })).toBeDefined()
    await ui.unmount()
  } finally {
    alive = ''
  }
})

for (const reason of ['clear', 'resume'] as const) {
test(`after /${reason}, which raises no session.start, an open pane loads the board again`, async ($, on) => {
  panes = [{ id: 'wip-wall' }]
  try {
    const ui = await boot($, on, FIXTURE_ROOT, ISSUES, null)
    registered = 0
    await $.session.end({ reason, sessionId: 'main', resume: { id: 'next' } })
    await tick()
    expect(registered).toBe(1)
    await ui.unmount()
  } finally {
    registered = 0
    panes = []
  }
})
}

test('the filters picked before /clear are kept after it', async ($, on) => {
  panes = [{ id: 'wip-wall' }]
  try {
    const ui = await boot($, on)
    await $.ui.press({ plugin: 'wip-wall', key: 'status:menu' })
    await $.ui.press({ plugin: 'wip-wall', key: 'status:Doing' })
    await $.session.end({ reason: 'clear', sessionId: 'main', resume: { id: 'next' } })
    await tick()
    expect(await ui.find({ type: 'Text', text: /open one/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /other group/ })).toBeUndefined()
    await ui.unmount()
  } finally {
    registered = 0
    panes = []
  }
})

test('a pane that is not listed yet when /clear settles is waited for', async ($, on) => {
  panes = [{ id: 'wip-wall' }]
  try {
    const ui = await boot($, on, FIXTURE_ROOT, ISSUES, null)
    registered = 0
    panes = []
    await $.session.end({ reason: 'clear', sessionId: 'main', resume: { id: 'next' } })
    await tick()
    expect(registered).toBe(0)
    panes = [{ id: 'wip-wall' }]
    await tick()
    expect(registered).toBe(1)
    await ui.unmount()
  } finally {
    registered = 0
    panes = []
  }
})

test('a session a card opened in a tab still opens the pane, and opening records how', async ($, on) => {
  sessionId = 's1'
  hides = { 'card:acme/core/lib#1': { sid: 's1', tab: 'tab-1', in: 'tab' } as unknown as string }
  try {
    const ui = await boot($, on, FIXTURE_ROOT, ISSUES, null)
    expect(opened).toContain('wip-wall')
    await ui.unmount()
  } finally {
    sessionId = 'main'
    hides = {}
  }
})

test('opening a card stores whether it went to a window or a tab', async ($, on) => {
  const ui = await boot($, on)
  try {
    await openCard($, 'acme-team/web#3', 'tab')
    expect(storedValues.filter(e => e.key === 'card:acme-team/web#3').map(e => (e.value as { in: string }).in)).toEqual(['tab', 'tab'])
    await ui.unmount()
  } finally {
  }
})

test('a refresh saves the board for the next session', async ($, on) => {
  const ui = await boot($, on)
  const saved = storedValues.find(e => e.key === 'cache:board')?.value as { at: number; cards: { title: string }[]; local: string[] } | undefined

  expect(saved?.cards.map(c => c.title).sort()).toEqual(['finished one', 'open one', 'other group'])
  expect(saved?.local).toEqual(['acme/core/lib#1'])
  expect(typeof saved?.at).toBe('number')
  expect((saved as { v?: number } | undefined)?.v).toBe(1)
  await ui.unmount()
})

test('a new session draws the saved board at once, even when GitLab fails', async ($, on) => {
  const card = { key: 'acme/core/lib#1', kind: 'issue', project: 'acme/core/lib', group: 'core', repo: 'lib', num: 1, title: 'cached one', url: 'https://x/u1', status: 'Doing', updated: RECENT, due: '', mrs: [] }
  hides = { 'cache:board': { v: 1, at: Date.now() - 3 * 60000, cards: [card], mentions: [], local: [], dirs: {}, boards: {} } as unknown as string }
  issuesFail = true
  try {
    const ui = await boot($, on, FIXTURE_ROOT, ISSUES, null)

    expect(await ui.find({ type: 'Text', text: /cached one/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Updated :' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Loading board/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: '[3m ago]' })).toBeDefined()
    await ui.unmount()
  } finally {
    hides = {}
    issuesFail = false
  }
})

test('a pane with nothing loaded yet draws the saved board instead of the spinner', async ($, on) => {
  const card = { key: 'acme/core/lib#1', kind: 'issue', project: 'acme/core/lib', group: 'core', repo: 'lib', num: 1, title: 'cached one', url: 'https://x/u1', status: 'Doing', updated: RECENT, due: '', mrs: [] }
  issuesFail = true
  try {
    const ui = await boot($, on, FIXTURE_ROOT, ISSUES, null)
    hides = { 'cache:board': { v: 1, at: Date.now() - 3 * 60000, cards: [card], mentions: [], local: [], dirs: {}, boards: {} } as unknown as string }
    await $.ui.press({ plugin: 'wip-wall', key: 'theme' })

    expect(await ui.find({ type: 'Text', text: /cached one/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Loading board/ })).toBeUndefined()
    await ui.unmount()
  } finally {
    hides = {}
    issuesFail = false
  }
})

test('the saved board opens on the project of the folder Claude started in, before any refresh', async ($, on) => {
  const card = (num: number, group: string, repo: string, title: string) => ({ key: `${group}/${repo}#${num}`, kind: 'issue', project: `${group}/${repo}`, group, repo, num, title, url: `https://x/${num}`, status: 'Doing', updated: RECENT, due: '', mrs: [] })
  hides = {
    'cache:board': {
      v: 1,
      at: Date.now(),
      cards: [card(1, 'acme', 'lib', 'cached lib'), card(3, 'acme-team', 'web', 'cached web')],
      mentions: [],
      local: [],
      dirs: { 'acme-team/web': '/Users/dev/Developer/Project-Work/PROJ-X/web' },
      boards: {},
    } as unknown as string,
  }
  issuesFail = true
  try {
    const ui = await boot($, on, '/Users/dev/Developer/Project-Work/PROJ-X/web/src', ISSUES, null)

    expect(await ui.find({ type: 'Text', text: /cached web/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /cached lib/ })).toBeUndefined()
    await ui.unmount()
  } finally {
    hides = {}
    issuesFail = false
  }
})


test('a card is open while a process carries its session id, and Ghostty is not asked on startup', async ($, on) => {
  alive = 'node /usr/local/bin/claude --resume s1\n'
  try {
    const ui = await boot($, on)

    expect(await ui.find({ type: 'Text', text: /^── Working · 1/ })).toBeDefined()
    expect(ran.filter(a => a[0] === 'osascript')).toHaveLength(0)
    await ui.unmount()
  } finally {
    alive = ''
  }
})

test('pressing a card whose Claude still runs brings its tab forward and opens nothing new', async ($, on) => {
  alive = 'claude --resume s1\n'
  selected = 'ok\n'
  try {
    const ui = await boot($, on)
    await $.ui.press({ plugin: 'wip-wall', key: 'open:acme/core/lib#1:0' })

    expect(ran.some(a => a[0] === 'osascript' && a[2]?.includes('select tab') && a[a.length - 1] === 'tab-1')).toBe(true)
    expect(launches()).toHaveLength(0)
    await ui.unmount()
  } finally {
    alive = ''
    selected = 'gone\n'
  }
})

const liveCard = `Mon Oct  5 09:15:08 2026\t${JSON.stringify({ pid: 4242, sessionId: 's1', cwd: '/Users/dev/Developer/Project-Work/core/lib', procStart: 'Mon Oct 5 09:15:08 2026' })}`

test('a running card whose tab is gone is found by its folder and focused', async ($, on) => {
  liveFiles = liveCard
  focused = 'ok\n'
  try {
    const ui = await boot($, on)
    await $.ui.press({ plugin: 'wip-wall', key: 'open:acme/core/lib#1:0' })

    expect(ran.some(a => a[0] === 'osascript' && a[2]?.includes('working directory is') && a[a.length - 1] === '/Users/dev/Developer/Project-Work/core/lib')).toBe(true)
    expect(toasts.some(t => /Claude runs/.test(t))).toBe(false)
    expect(launches()).toHaveLength(0)
    await ui.unmount()
  } finally {
    liveFiles = ''
    focused = 'gone\n'
  }
})

test('a running card that Ghostty cannot find says which pid runs it, and several matches are not guessed', async ($, on) => {
  liveFiles = liveCard
  try {
    const ui = await boot($, on)
    await $.ui.press({ plugin: 'wip-wall', key: 'open:acme/core/lib#1:0' })
    expect(toasts.some(t => /pid 4242.*does not list/.test(t))).toBe(true)
    toasts.length = 0
    focused = 'many\n'
    await $.ui.press({ plugin: 'wip-wall', key: 'open:acme/core/lib#1:0' })
    expect(toasts.some(t => /pid 4242.*several Ghostty terminals/.test(t))).toBe(true)
    expect(launches()).toHaveLength(0)
    await ui.unmount()
  } finally {
    liveFiles = ''
    focused = 'gone\n'
  }
})

test('a running card without a local clone still brings its tab forward', async ($, on) => {
  alive = 'claude --resume s1\n'
  selected = 'ok\n'
  remotes = {}
  try {
    const ui = await boot($, on)
    await $.ui.press({ plugin: 'wip-wall', key: 'open:acme/core/lib#1:0' })

    expect(ran.some(a => a[0] === 'osascript' && a[2]?.includes('select tab'))).toBe(true)
    expect(toasts.some(t => /No local clone/.test(t))).toBe(false)
    await ui.unmount()
  } finally {
    alive = ''
    selected = 'gone\n'
    remotes = REMOTE_OF
  }
})

test('pressing a card with a saved session while ps fails toasts and opens nothing', async ($, on) => {
  psFail = true
  try {
    const ui = await boot($, on)
    await $.ui.press({ plugin: 'wip-wall', key: 'open:acme/core/lib#1:0' })

    expect(toasts.some(t => /Cannot check which Claude sessions run/.test(t))).toBe(true)
    expect(launches()).toHaveLength(0)
    expect(await ui.find({ key: 'choose:acme/core/lib#1:window' })).toBeUndefined()
    await ui.unmount()
  } finally {
    psFail = false
  }
})

test('pressing a card whose Claude exited opens a new session with /resume of the old one waiting, even if its tab is still there', async ($, on) => {
  selected = 'ok\n'
  try {
    const ui = await boot($, on)
    await openCard($, 'acme/core/lib#1')

    expect(launches().map(a => a[4])).toEqual(['claude --session-id new-sid\n/resume s1'])
    expect(storedValues.filter(e => e.key === 'card:acme/core/lib#1').map(e => e.value)).toMatchObject([{ sid: 'new-sid', prev: 's1' }, { sid: 'new-sid', prev: 's1' }])
    expect(ran.some(a => a[0] === 'osascript' && a[2]?.includes('select tab'))).toBe(false)
    await ui.unmount()
  } finally {
    selected = 'gone\n'
  }
})

test('a session that never started is forgotten after a minute, a resumable one is kept', async ($, on) => {
  hides = {
    'card:acme-team/web#3': { sid: 's3-never-started', tab: '', at: Date.now() - 2 * 60000 } as unknown as string,
    'card:acme-team/web#8': { sid: 's8-just-launched', tab: '', at: Date.now() } as unknown as string,
  }
  try {
    const ui = await boot($, on)

    expect([...new Set(deleted)]).toEqual(['card:acme-team/web#3'])
    await ui.unmount()
  } finally {
    hides = {}
  }
})

test('a full refresh forgets the session of a card that left the board unless its Claude still runs', async ($, on) => {
  hides = {
    'card:gone/repo#9': { sid: 's2', tab: '', at: Date.now() - 2 * 60000 } as unknown as string,
    'card:gone/repo#10': { sid: 's10', tab: '', at: Date.now() - 2 * 60000 } as unknown as string,
  }
  alive = 'claude --session-id s10\n'
  try {
    const ui = await boot($, on)

    expect([...new Set(deleted)]).toEqual(['card:gone/repo#9'])
    await ui.unmount()
  } finally {
    hides = {}
    alive = ''
  }
})

test('the timers do nothing while the pane is closed, and refresh once it is open', async ($, on) => {
  try {
    const ui = await boot($, on)
    ran.length = 0
    await tick()

    expect(ran.filter(a => a[1] === 'api' || a[0] === 'ps')).toHaveLength(0)
    panes = [{ id: 'wip-wall' }]
    await tick()
    expect(ran.some(a => a[1] === 'api')).toBe(true)
    expect(ran.some(a => a[0] === 'ps')).toBe(true)
    await ui.unmount()
  } finally {
    panes = []
  }
})

test('refresh waits longer while the board stays the same', async ($, on) => {
  try {
    const ui = await boot($, on)
    panes = [{ id: 'wip-wall' }]
    ran.length = 0
    for (let i = 0; i < 6; i++) await tick()

    expect(ran.filter(a => a.join(' ').includes('issues?'))).toHaveLength(2)
    await ui.unmount()
  } finally {
    panes = []
  }
})

test('a saved board from another version is ignored', async ($, on) => {
  const card = { key: 'acme/core/lib#1', kind: 'issue', project: 'acme/core/lib', group: 'core', repo: 'lib', num: 1, title: 'cached one', url: 'https://x/u1', status: 'Doing', updated: RECENT, due: '' }
  hides = { 'cache:board': { at: Date.now(), cards: [card], mentions: [], local: [], dirs: {}, boards: {} } as unknown as string }
  issuesFail = true
  try {
    const ui = await boot($, on, FIXTURE_ROOT, ISSUES, null)

    expect(await ui.find({ type: 'Text', text: /cached one/ })).toBeUndefined()
    await ui.unmount()
  } finally {
    hides = {}
    issuesFail = false
  }
})

test('leaving mock mode clears the mock cards even when the refresh fails', async ($, on) => {
  issuesFail = true
  try {
    const ui = await boot($, on, FIXTURE_ROOT, ISSUES, 'mock')
    expect(await ui.find({ type: 'Text', text: /Local branch exists/ })).toBeDefined()
    await $.command.run({ command: 'wip-wall', args: '', ...TYPED_RUN })

    expect(await ui.find({ type: 'Text', text: /Local branch exists/ })).toBeUndefined()
    expect((await ui.findAll({ type: 'Client' })).filter(c => String(c.props.module).endsWith('pulse.tsx'))).toHaveLength(0)
    await ui.unmount()
  } finally {
    issuesFail = false
  }
})

test('error text from glab is cleaned before it is drawn', async ($, on) => {
  issuesFail = true
  try {
    const ui = await boot($, on)
    const shown = (await ui.findAll({ type: 'Text', text: /boom/ })).map((t: any) => String(t.text ?? t.props.children))

    expect(shown.length).toBeGreaterThan(0)
    expect(shown.join('')).not.toMatch(/[\u0000-\u001f]/)
    await ui.unmount()
  } finally {
    issuesFail = false
  }
})

test('the theme picked by pressing the header is remembered', async ($, on) => {
  hides = { 'ui:theme': 'neon' as string }
  try {
    const ui = await boot($, on)

    expect((await ui.find({ type: 'Text', text: /^WIP-WALL$/ }))?.props.color).toBe('#f3f2ee')
    await $.ui.press({ plugin: 'wip-wall', key: 'theme' })
    expect(storedValues.filter(e => e.key === 'ui:theme').map(e => e.value)).toEqual(['tokyo-night'])
    await ui.unmount()
  } finally {
    hides = {}
  }
})

test('when ps fails no card session is forgotten', async ($, on) => {
  hides = {
    'card:acme-team/web#3': { sid: 's3-never-started', tab: '', at: Date.now() - 2 * 60000 } as unknown as string,
    'card:gone/repo#9': { sid: 's9', tab: '', at: Date.now() - 2 * 60000 } as unknown as string,
  }
  psFail = true
  try {
    const ui = await boot($, on)

    expect(deleted.filter(k => k.startsWith('card:'))).toEqual([])
    expect(await ui.find({ type: 'Text', text: /open one/ })).toBeDefined()
    await ui.unmount()
  } finally {
    hides = {}
    psFail = false
  }
})

test('a card session is kept while its issue is still assigned, even when the issue lost its status label', async ($, on) => {
  hides = { 'card:acme-team/web#4': { sid: 's2', tab: '', at: Date.now() - 2 * 60000 } as unknown as string }
  try {
    const ui = await boot($, on)

    expect(deleted.filter(k => k.startsWith('card:acme-team/web#4'))).toEqual([])
    await ui.unmount()
  } finally {
    hides = {}
  }
})

const settle = async () => {
  for (let i = 0; i < 30; i++) await new Promise(resolve => setTimeout(resolve, 0))
}
const setupRows = async (ui: any) => (await ui.findAll({ type: 'Text', text: /^(glab|GitLab login|Ghostty|Ghostty control|Clone folder) {2}$/ })).length

test('/wip-wall setup draws the checklist and names the folder command; done and a plain /wip-wall close it', async ($, on) => {
  const ui = await boot($, on, FIXTURE_ROOT, ISSUES, 'setup')
  await settle()

  expect(await setupRows(ui)).toBe(5)
  expect(await ui.find({ type: 'Text', text: /2 clones matched/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /clone folder: \/wip-wall setup <folder>/ })).toBeDefined()

  await $.ui.press({ plugin: 'wip-wall', key: 'setup:close' })
  expect(await setupRows(ui)).toBe(0)

  await $.command.run({ command: 'wip-wall', args: 'setup', ...TYPED_RUN })
  await settle()
  expect(await setupRows(ui)).toBe(5)
  await $.command.run({ command: 'wip-wall', args: '', ...TYPED_RUN })
  await settle()
  expect(await setupRows(ui)).toBe(0)
  await ui.unmount()
})

test('/wip-wall setup <folder> saves an absolute folder, scans it, and refuses a relative one', async ($, on) => {
  const ui = await boot($, on, FIXTURE_ROOT, ISSUES, 'setup /Users/dev/work/')
  try {
    await settle()

    expect(storedValues.filter(e => e.key === 'ui:root').map(e => e.value)).toEqual(['/Users/dev/work'])
    expect(ran.some(a => a[0] === 'find' && a[1] === '/Users/dev/work')).toBe(true)

    await $.command.run({ command: 'wip-wall', args: 'setup work', ...TYPED_RUN })
    expect(storedValues.filter(e => e.key === 'ui:root').map(e => e.value)).toEqual(['/Users/dev/work'])
  } finally {
    await $.command.run({ command: 'wip-wall', args: `setup ${FIXTURE_ROOT}`, ...TYPED_RUN })
    await settle()
    await ui.unmount()
  }
})

test('/wip-wall setup host saves a bare host, strips a url, refuses a path, and the checklist names the command', async ($, on) => {
  const ui = await boot($, on, FIXTURE_ROOT, ISSUES, 'setup')
  try {
    await settle()
    expect(await ui.find({ type: 'Text', text: /setup host <host>/ })).toBeDefined()

    await $.command.run({ command: 'wip-wall', args: 'setup host https://git.corp.dev/', ...TYPED_RUN })
    await settle()
    expect(storedValues.filter(e => e.key === 'ui:host').map(e => e.value)).toEqual(['git.corp.dev'])

    await $.command.run({ command: 'wip-wall', args: 'setup host git.corp.dev/group', ...TYPED_RUN })
    expect(storedValues.filter(e => e.key === 'ui:host').map(e => e.value)).toEqual(['git.corp.dev'])
  } finally {
    await ui.unmount()
  }
})


test('/wip-wall setup terminal saves ghostty or iterm2, refuses others, and a saved iterm2 opens cards through iTerm2', async ($, on) => {
  const ui = await boot($, on, FIXTURE_ROOT, ISSUES, 'setup')
  try {
    await settle()
    await $.command.run({ command: 'wip-wall', args: 'setup terminal ITerm2', ...TYPED_RUN })
    await settle()
    expect(storedValues.filter(e => e.key === 'ui:terminal').map(e => e.value)).toEqual(['iterm2'])

    await $.command.run({ command: 'wip-wall', args: 'setup terminal kitty', ...TYPED_RUN })
    expect(storedValues.filter(e => e.key === 'ui:terminal').map(e => e.value)).toEqual(['iterm2'])

    await openCard($, 'acme-team/web#3', 'tab')
    const scripts = ran.filter(a => a[0] === 'osascript').map(a => a[2] ?? '')
    expect(scripts.some(text => text.includes('tell application "iTerm2"') && text.includes('create tab'))).toBe(true)
  } finally {
    await ui.unmount()
  }
})
