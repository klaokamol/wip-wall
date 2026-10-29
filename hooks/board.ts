import type { Card, Mention, MrRef } from '../types'

export type Raw = {
  references: { full: string }
  title: string
  web_url: string
  labels: string[]
  updated_at: string
  source_branch?: string
  due_date?: string | null
  draft?: boolean
  has_conflicts?: boolean
  blocking_discussions_resolved?: boolean
  head_pipeline?: { status: string } | null
  detailed_merge_status?: string
  reviewers?: unknown[]
  approved?: boolean
  reply?: boolean
  author?: { username: string }
}

const CONTROL = '\\u0000-\\u001f\\u007f-\\u009f\\u200b\\u200e\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\ufeff'

const CONTROL_RE = new RegExp(`[${CONTROL}]`, 'g')
const URL_RE = new RegExp(`^https?://[^\\s${CONTROL}]+$`, 'i')

export const clean = (text: string): string => text.replace(CONTROL_RE, ' ')

export const isWebUrl = (url: string): boolean => URL_RE.test(url)

const STATUS = /^status\s*:+\s*(.+)$/i

const FALLBACK: Record<string, string> = {
  'deployed to development': 'Deployed to Dev',
  'deployed to staging': 'Deployed to Staging',
  'to do': 'To Do',
  'in-progress training': 'Doing',
}

export const statusOf = (labels: string[]): string => {
  for (const label of labels) {
    const hit = STATUS.exec(label)
    if (hit) return clean(hit[1] ?? '').trim()
  }
  for (const label of labels) {
    const hit = FALLBACK[label.trim().toLowerCase()]
    if (hit) return hit
  }

  return ''
}

const split = (full: string) => {
  const [project = '', num] = full.split(/[#!]/)

  const parts = project.split('/')

  return { project, num: Number(num), repo: parts.at(-1) ?? '', group: parts.at(-2) ?? parts[0] ?? '' }
}

const mrRefOf = (mr: Raw, num: number, status: string): MrRef => ({
  num,
  status,
  url: mr.web_url,
  pipeline: mr.head_pipeline?.status ?? '',
  conflict: mr.has_conflicts === true,
  draft: mr.draft === true,
  threads: mr.blocking_discussions_resolved === false,
  merge: mr.detailed_merge_status ?? '',
  approved: mr.approved === true,
  unreviewed: Array.isArray(mr.reviewers) && mr.reviewers.length === 0,
  reply: mr.reply === true,
  updated: mr.updated_at,
})

export const reviewsOf = (raws: Raw[], assigned: Set<string>): Card[] =>
  raws
    .filter(mr => !assigned.has(mr.references.full))
    .map(mr => {
      const { project, num, repo, group } = split(mr.references.full)
      const status = statusOf(mr.labels) || 'review'

      return { key: mr.references.full, kind: 'mr', project, group, repo, num, title: clean(mr.title), url: mr.web_url, status, updated: mr.updated_at, due: '', mrs: [mrRefOf(mr, num, status)], by: clean(mr.author?.username ?? '') }
    })

export const toCards = (issues: Raw[], mrs: Raw[]): Card[] => {
  const cards: Card[] = issues.map(i => {
    const { project, num, repo, group } = split(i.references.full)

    return {
      key: i.references.full,
      kind: 'issue',
      project,
      group,
      repo,
      num,
      title: clean(i.title),
      url: i.web_url,
      status: statusOf(i.labels),
      updated: i.updated_at,
      due: clean(i.due_date ?? ''),
      mrs: [],
    }
  })

  for (const mr of mrs) {
    const { project, num, repo, group } = split(mr.references.full)
    const status = statusOf(mr.labels) || 'review'
    const issueNum = Number(/^(\d+)-/.exec(mr.source_branch ?? '')?.[1])
    const parent = cards.find(c => c.kind === 'issue' && c.project === project && c.num === issueNum && c.status !== '')

    if (parent) parent.mrs.push(mrRefOf(mr, num, status))
    else
      cards.push({
        key: mr.references.full,
        kind: 'mr',
        project,
        group,
        repo,
        num,
        title: clean(mr.title),
        url: mr.web_url,
        status,
        updated: mr.updated_at,
        due: '',
        mrs: [],
      })
  }

  return cards.filter(c => c.status !== '')
}

export type RawTodo = {
  action_name: string
  target_type: string
  target_url: string
  body: string
  created_at: string
  author: { username: string }
  project: { path_with_namespace: string }
  target: { iid: number; title: string; web_url: string }
}

export const MENTION_ACTIONS = ['mentioned', 'directly_addressed']

export const cardOfMention = (m: Mention): Card => ({
  key: m.ref,
  kind: m.kind,
  project: m.project,
  group: m.group,
  repo: m.repo,
  num: m.num,
  title: m.title,
  url: m.noteUrl,
  status: '',
  updated: m.updated,
  due: '',
  mrs: [],
})

export const mentionsOf = (todos: RawTodo[]): Mention[] => {
  const latest = new Map<string, Mention>()
  for (const t of todos) {
    if (!t.project?.path_with_namespace) continue
    const kind = t.target_type === 'Issue' ? 'issue' : t.target_type === 'MergeRequest' ? 'mr' : undefined
    if (kind === undefined || !MENTION_ACTIONS.includes(t.action_name)) continue
    const ref = `${t.project.path_with_namespace}${kind === 'issue' ? '#' : '!'}${t.target.iid}`
    const prev = latest.get(ref)
    if (prev && Date.parse(prev.updated) >= Date.parse(t.created_at)) continue
    latest.set(ref, {
      key: `@${ref}`,
      ref,
      kind,
      ...split(ref),
      title: clean(t.target.title),
      url: t.target.web_url,
      noteUrl: t.target_url,
      updated: t.created_at,
      by: clean(t.author?.username ?? ''),
      body: clean(t.body).replace(/\s+/g, ' ').trim(),
    })
  }

  return [...latest.values()].sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated))
}

export const PIPELINE: Record<string, { text: string; tone: 'good' | 'warn' | 'bad' }> = {
  success: { text: 'ci-ok', tone: 'good' },
  failed: { text: 'ci-fail', tone: 'bad' },
  running: { text: 'ci-run', tone: 'warn' },
  pending: { text: 'ci-wait', tone: 'warn' },
  created: { text: 'ci-wait', tone: 'warn' },
}

export const MERGE: Record<string, { text: string; tone: 'good' | 'warn' | 'bad' | 'muted' }> = {
  need_rebase: { text: 'rebase', tone: 'warn' },
  not_approved: { text: 'review', tone: 'warn' },
  mergeable: { text: 'ready', tone: 'good' },
  ci_must_pass: { text: 'ci-req', tone: 'warn' },
  checking: { text: 'checking', tone: 'muted' },
  blocked_status: { text: 'blocked', tone: 'bad' },
}

const LATE = ['not_approved', 'mergeable']

const spanOf = (days: number): string => {
  if (days < 14) return `${days}d`
  if (days < 60) return `${Math.floor(days / 7)}w`
  if (days < 300) return `${Math.floor(days / 30)}mo`

  return `${Math.min(99, Math.max(1, Math.floor(days / 365)))}y`
}

export const dueOf = (due: string, now: number): { text: string; tone: 'bad' | 'warn' | 'muted' } => {
  if (!due) return { text: '', tone: 'muted' }
  const days = Math.floor((Date.parse(`${due}T23:59:59`) - now) / 86400000)

  if (days < 0) return { text: `←${spanOf(-days)}`, tone: 'bad' }
  if (days === 0) return { text: '→0d', tone: 'warn' }

  return { text: `→${spanOf(days)}`, tone: 'muted' }
}

export const ageOf = (iso: string, now: number): string => {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const mins = Math.floor(Math.max(0, now - at) / 60000)
  const days = Math.floor(mins / 1440)
  if (mins < 1) return 'now'
  if (mins < 60) return `${mins}m`
  if (mins < 1440) return `${Math.floor(mins / 60)}h`

  return spanOf(days)
}

export const DATES = [
  { id: 'all', label: 'all', days: 0 },
  { id: 'week', label: 'Week', days: 7 },
  { id: 'month', label: 'Month', days: 30 },
  { id: 'half', label: '6 Months', days: 182 },
  { id: 'year', label: 'Year', days: 365 },
] as const

export const withinDays = (iso: string, days: number, now: number): boolean => {
  const at = Date.parse(iso)

  return days === 0 || Number.isNaN(at) || now - at <= days * 86400000
}

const RANK = [
  'doing',
  'to do',
  'ready to merge',
  'deployed to dev',
  'test',
  'testing',
  'dev testing pass',
  'testing passed',
  'deployed to staging',
  'deployed to uat',
  'ready for staging',
  'ready to release',
  'monitoring',
  'backlog',
]

export const rankOf = (status: string): number => {
  if (status === '') return RANK.length
  const at = RANK.indexOf(status.toLowerCase())

  return /^done$/i.test(status) ? RANK.length + 1 : at === -1 ? RANK.length - 1 : at
}

const byLatest = (cards: Card[], nameOf: (c: Card) => string): string[] => {
  const seen = new Map<string, { count: number; latest: number }>()
  for (const c of cards) {
    const at = Date.parse(c.updated)
    const prev = seen.get(nameOf(c)) ?? { count: 0, latest: 0 }
    seen.set(nameOf(c), { count: prev.count + 1, latest: Math.max(prev.latest, Number.isNaN(at) ? 0 : at) })
  }

  return [...seen].sort((a, b) => b[1].latest - a[1].latest || b[1].count - a[1].count || a[0].localeCompare(b[0])).map(([n]) => n)
}

export const groupsOf = (cards: Card[]): string[] => ['all', ...byLatest(cards, c => c.group)]

export const reposOf = (cards: Card[], group: string): string[] => [
  'all',
  ...byLatest(cards.filter(c => group === 'all' || c.group === group), c => c.repo),
]

export const projectOf = (remote: string, host: string): string | undefined => {
  const text = remote.trim()
  const url = /^[a-z+]+:\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/(.+)$/i.exec(text) ?? /^(?:[^@/]+@)?([^:/]+):(.+)$/.exec(text)
  if (!url) return undefined
  const [, site = '', path = ''] = url
  if (site.toLowerCase() !== host.toLowerCase()) return undefined
  const project = path.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '')

  return project === '' ? undefined : project
}

export type Clone = { path: string; remote: string }

const folderKey = (name: string): string => `:${name}`

export const dirsOf = (clones: Clone[], host: string): Record<string, string> => {
  const map: Record<string, string> = {}
  const bare = new Map<string, string[]>()
  for (const { path, remote } of clones) {
    const project = projectOf(remote, host)
    const name = path.split('/').pop() as string
    if (project) map[project.toLowerCase()] ??= path
    else if (remote.trim() === '') bare.set(name, [...(bare.get(name) ?? []), path])
  }
  for (const [name, paths] of bare) {
    const [only] = paths
    if (paths.length === 1 && only !== undefined) map[folderKey(name)] = only
  }

  return map
}

export const dirOf = (dirs: Record<string, string>, card: Pick<Card, 'project' | 'repo'>): string | undefined => dirs[card.project.toLowerCase()] ?? dirs[folderKey(card.repo)]

export const isDone = (status: string): boolean => /^done$/i.test(status.trim())

export const statusesOf = (cards: Card[], rank: (status: string) => number = rankOf): string[] => {
  const seen = new Map<string, string>()
  for (const c of cards) if (!seen.has(c.status.toLowerCase())) seen.set(c.status.toLowerCase(), c.status)

  return [...seen.values()].sort((a, b) => rank(a) - rank(b))
}

export type RawBoard = { name: string; lists: { position: number; label: { name: string } | null }[] }

export type Orders = Record<string, string[]>

export const boardOrder = (boards: RawBoard[]): string[] => {
  const board = boards.find(b => b.name === 'Development') ?? boards[0]
  const seen = new Set<string>()
  const names: string[] = []
  for (const list of [...(board?.lists ?? [])].sort((a, b) => a.position - b.position)) {
    const status = statusOf(list.label ? [list.label.name] : [])
    if (status !== '' && !seen.has(status.toLowerCase())) {
      seen.add(status.toLowerCase())
      names.push(status)
    }
  }

  return names
}

export const rankIn = (cards: Card[], orders: Orders): ((status: string) => number) => {
  const sums = new Map<string, { sum: number; n: number }>()
  for (const project of new Set(cards.map(c => c.project))) {
    const list = orders[project] ?? []
    list.forEach((status, i) => {
      const key = status.toLowerCase()
      const cur = sums.get(key) ?? { sum: 0, n: 0 }
      sums.set(key, { sum: cur.sum + (list.length > 1 ? i / (list.length - 1) : 0), n: cur.n + 1 })
    })
  }

  return status => {
    const hit = sums.get(status.toLowerCase())

    return hit && !isDone(status) ? hit.sum / hit.n : 2 + rankOf(status)
  }
}

export type View = {
  active: string
  shown: Card[]
  doneCount: number
}

export const viewOf = (scoped: Card[], picked: string): View => {
  const open = scoped.filter(c => !isDone(c.status))
  const done = scoped.filter(c => isDone(c.status))
  const active =
    picked === 'done' && done.length > 0
      ? 'done'
      : statusesOf(open).some(st => st.toLowerCase() === picked)
        ? picked
        : 'all'
  const shown = active === 'done' ? done : active === 'all' ? open : open.filter(c => c.status.toLowerCase() === active)

  return { active, shown, doneCount: done.length }
}

export const isHidden = (hide: Record<string, string>, card: Pick<Card, 'key' | 'updated'>): boolean => hide[card.key] === card.updated

export const staleHides = (hidden: Record<string, string>, cards: Card[], mentions: Mention[], fetched: { mrs: boolean; mentions: boolean }): string[] => {
  const now = new Map([...cards, ...mentions].map(c => [c.key, c.updated]))

  return Object.keys(hidden).filter(key => {
    const trusted = key.startsWith('@') ? fetched.mentions : key.includes('!') ? fetched.mrs : true

    return trusted && now.get(key) !== hidden[key]
  })
}

export type PaneInput = {
  cards: Card[]
  reviews: Card[]
  mentions: Mention[]
  hidden: Record<string, string>
  group: string
  tab: string
  date: string
  status: string
  boards: Orders
  working: string[]
  here?: string
  latest?: boolean
}

type Picks = { group: string; repo: string; date: string; status: string }

const DAYS = new Map<string, number>(DATES.map(d => [d.id, d.days]))

const daysOf = (id: string): number => DAYS.get(id) ?? 0

const statusMatches = (status: string, picked: string): boolean =>
  picked === 'done' ? isDone(status) : !isDone(status) && (picked === 'all' || status.toLowerCase() === picked)

export type Choice = { id: string; label: string; count: number }

export type Section = { name: string; label: string; list: Card[] }

export type Pane = {
  total: number
  date: string
  group: string
  groups: Choice[]
  dates: Choice[]
  repo: string
  repos?: Choice[]
  status: string
  statuses: Choice[]
  working: Card[]
  shown: Card[]
  doneLeft: boolean
  unmatched: boolean
  sections: Section[]
  reviews: Card[]
  heard: Mention[]
  pinged: Set<string>
  hiddenCards: Card[]
  hiddenMentions: Mention[]
}

export const paneOf = (input: PaneInput, now: number): Pane => {
  const all = input.cards.filter(c => !isHidden(input.hidden, c))
  const cardKeys = new Set([...input.cards, ...input.reviews].map(c => c.key))
  const reviews = input.reviews.filter(c => !isHidden(input.hidden, c))
  const newMentions = input.mentions.filter(m => !cardKeys.has(m.ref))
  const groups = groupsOf(all)
  const group = groups.includes(input.group) ? input.group : 'all'
  const repos = reposOf(all, group)
  const only = group !== 'all' && repos.length === 2 ? repos[1] : undefined
  const repo = only ?? (repos.includes(input.tab) ? input.tab : 'all')
  const date = DAYS.has(input.date) ? input.date : 'all'
  const inScope = (c: Pick<Card, 'group' | 'repo' | 'updated'>, p: Omit<Picks, 'status'>) =>
    (p.group === 'all' || c.group === p.group) && (p.repo === 'all' || c.repo === p.repo) && withinDays(c.updated, daysOf(p.date), now)
  const passes = (c: Card, p: Picks) => inScope(c, p) && statusMatches(c.status, p.status)
  const shortRepo = (name: string): string => {
    const rest = name.slice(group.length + 1)

    return name.startsWith(`${group}-`) && rest !== '' && !repos.includes(rest) ? rest : name
  }
  const scoped = all.filter(c => inScope(c, { group, repo, date }))
  const { active: status, doneCount } = viewOf(scoped, input.status)
  const pick: Picks = { group, repo, date, status }
  const count = (change: Partial<Picks>) => all.filter(c => passes(c, { ...pick, ...change })).length
  const openScoped = scoped.filter(c => !isDone(c.status))
  const ownRank = new Map<string, (status: string) => number>()
  const rankOwn = (c: Card) => {
    if (!ownRank.has(c.project)) ownRank.set(c.project, rankIn([c], input.boards))

    return (ownRank.get(c.project) as (status: string) => number)(c.status)
  }
  const busy = new Set(input.working)
  const byOwn = (a: Card, b: Card) => (input.latest ? 0 : rankOwn(a) - rankOwn(b)) || Date.parse(b.updated) - Date.parse(a.updated) || a.repo.localeCompare(b.repo) || b.num - a.num
  const shown = all.filter(c => passes(c, pick) && !busy.has(c.key)).sort(byOwn)
  const finished = status === 'all' ? all.filter(c => passes(c, { ...pick, status: 'done' }) && !busy.has(c.key)) : []
  const unmatched = shown.length === 0 && all.some(c => !isDone(c.status) && !busy.has(c.key))
  const sectionOf = (c: Card) => (group === 'all' ? c.group : repo === 'all' ? c.repo : '')
  const sections = (group === 'all' ? groups : repos)
    .map(name => ({ name, list: shown.filter(c => sectionOf(c) === name) }))
    .filter(sec => sec.list.length > 0)
  if (sections.length === 0 && shown.length > 0) sections.push({ name: '', list: shown })

  return {
    total: all.length,
    date,
    group,
    groups: groups.map(name => ({ id: name, label: name, count: count({ group: name, repo: 'all' }) })),
    dates: DATES.map(d => ({ id: d.id, label: d.label, count: count({ date: d.id }) })),
    repo,
    repos: group === 'all' ? undefined : repos.filter(name => !(only && name === 'all')).map(name => ({ id: name, label: shortRepo(name), count: count({ repo: name }) })),
    status,
    statuses: [
      { id: 'all', label: 'all', count: count({ status: 'all' }) },
      ...statusesOf(openScoped, rankIn(scoped, input.boards)).map(st => ({ id: st, label: st, count: count({ status: st.toLowerCase() }) })),
      ...(doneCount > 0 ? [{ id: 'done', label: 'Done', count: count({ status: 'done' }) }] : []),
    ],
    working: [...all, ...reviews].filter(c => busy.has(c.key)).sort((a, b) => Number(b.key === input.here) - Number(a.key === input.here) || Date.parse(b.updated) - Date.parse(a.updated)),
    shown,
    unmatched,
    doneLeft: shown.length === 0 && !unmatched && finished.length > 0,
    sections: sections.map(sec => ({ ...sec, label: `${sec.name === '' ? 'Cards' : sec.name.trim()} · ${sec.list.length}` })),
    reviews: reviews.filter(c => !busy.has(c.key) && inScope(c, pick)).sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated)),
    heard: newMentions.filter(m => !isHidden(input.hidden, m) && inScope(m, pick)),
    pinged: new Set(input.mentions.filter(m => !isHidden(input.hidden, m)).map(m => m.ref)),
    hiddenCards: [...input.cards, ...input.reviews].filter(c => isHidden(input.hidden, c)),
    hiddenMentions: newMentions.filter(m => isHidden(input.hidden, m)),
  }
}

export const tabTitleOf = (card: Card): string => {
  return `${card.repo} ${card.kind === 'issue' ? '#' : '!'}${card.num}`
}

const pad = (n: number): string => String(n).padStart(2, '0')

export const NAME = 'WIP-WALL'

export const titleOf = (at: number): string => {
  if (at === 0) return NAME
  const when = new Date(at)

  return `${NAME} · ${pad(when.getHours())}:${pad(when.getMinutes())}`
}

export type Flag = { text: string; tone: 'good' | 'warn' | 'bad' | 'muted' }

const WIDE: [number, number][] = [[0x1100, 0x115f], [0x2e80, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6], [0x20000, 0x3fffd]]
const MARKS: [number, number][] = [[0x0300, 0x036f], [0x200d, 0x200d], [0xfe00, 0xfe0e], [0x0e31, 0x0e31], [0x0e34, 0x0e3a], [0x0e47, 0x0e4e]]
const within = (ranges: [number, number][], cp: number) => ranges.some(([from, to]) => cp >= from && cp <= to)

const MODIFIER = /\p{Emoji_Modifier}/u
const FLAG = /\p{Regional_Indicator}/u
const PICTOGRAPH = /\p{Emoji_Presentation}/u
const EMOJI = /\p{Emoji}/u

const isTextEmoji = (ch: string): boolean => EMOJI.test(ch) && !FLAG.test(ch)

// ponytail: a ZWJ family counts every emoji (drawn as 2, counted 4) and VS16 only widens a one-cell symbol; swap in a grapheme-aware wcwidth table if card borders drift
const cellsOf = (cp: number, prev?: number): number => {
  if (cp === 0xfe0f) return prev !== undefined && prev > 0x7f && isTextEmoji(String.fromCodePoint(prev)) && cellsOf(prev) === 1 ? 1 : 0
  if (within(MARKS, cp)) return 0
  const ch = String.fromCodePoint(cp)

  return MODIFIER.test(ch) ? 0 : FLAG.test(ch) ? 1 : PICTOGRAPH.test(ch) || within(WIDE, cp) ? 2 : 1
}

const cellsIn = (text: string): number[] => {
  let prev: number | undefined

  return [...text].map(ch => {
    const cp = ch.codePointAt(0) as number
    const cells = cellsOf(cp, prev)
    prev = cp

    return cells
  })
}

export const widthOf = (text: string): number => cellsIn(text).reduce((n, cells) => n + cells, 0)

const take = (text: string, room: number): string => {
  const chars = [...text]
  const cells = cellsIn(text)
  let used = 0
  let out = ''
  for (let at = 0; at < chars.length; at++) {
    used += cells[at] ?? 0
    if (used > room) break
    out += chars[at]
  }

  return out
}

export const clip = (text: string, room: number): string => (widthOf(text) > room ? `${take(text, room - 1)}…` : text)

const BREAK = /[ \u3000]/

export const titleLines = (text: string, room: number): string[] => {
  if (widthOf(text) <= room) return [text]
  const head = take(text, room)
  const space = Math.max(head.lastIndexOf(' '), head.lastIndexOf('\u3000'))
  const at = BREAK.test(text[head.length] ?? '') || space <= 0 ? head.length : space

  return [text.slice(0, at), clip(text.slice(at).trimStart(), room)]
}

const severity = (mr: MrRef): number => (mr.conflict ? 2 : 0) + (mr.pipeline === 'failed' ? 2 : 0) + (mr.threads ? 1 : 0) + (mr.merge === 'need_rebase' ? 1 : 0) + (mr.reply ? 1 : 0)

const STALE_DAYS = 7

export const mrSummary = (card: Card, room: number, now: number = Date.now()) => {
  if (card.mrs.length === 0) return undefined
  const mr = card.mrs.reduce((best, next) => (severity(next) > severity(best) ? next : best))
  const late = LATE.includes(mr.merge ?? '')
  const ci = PIPELINE[mr.pipeline]
  const all = [
    ci && { text: ci.text, tone: ci.tone },
    mr.conflict && { text: 'conflict', tone: 'bad' },
    mr.reply && { text: 'reply', tone: 'warn' },
    !late && MERGE[mr.merge ?? ''],
    mr.draft && { text: 'draft', tone: 'muted' },
    mr.threads && { text: 'threads', tone: 'warn' },
    late ? MERGE[mr.merge ?? ''] : mr.approved && { text: 'approved', tone: 'good' },
    mr.unreviewed && !mr.draft && { text: 'no rev', tone: 'warn' },
    !withinDays(mr.updated ?? '', STALE_DAYS, now) && { text: 'stale', tone: 'muted' },
  ].filter(Boolean) as Flag[]
  const same = mr.status !== '' && mr.status.toLowerCase() === card.status.toLowerCase()
  const status = same ? '' : mr.status || 'no status'
  const more = card.mrs.length - 1
  const lengthOf = (kept: Flag[]) =>
    [`MR !${mr.num}`, status, ...kept.map(f => f.text), kept.length < all.length ? '…' : '', more > 0 ? `+${more} MR` : '']
      .filter(Boolean)
      .join(' · ').length
  const flags = all.slice()
  while (flags.length > 0 && lengthOf(flags) > room) flags.pop()

  return { num: mr.num, url: mr.url, status, flags, cut: flags.length < all.length, more }
}

export type GqlMr = {
  reference: string
  author?: { username: string } | null
  title: string
  webUrl: string
  updatedAt: string
  sourceBranch: string | null
  draft: boolean
  conflicts: boolean
  approved: boolean
  detailedMergeStatus: string | null
  mergeableDiscussionsState: boolean | null
  labels: { nodes: { title: string }[] }
  headPipeline: { status: string } | null
  reviewers: { nodes: unknown[] }
  notes: { nodes: { system: boolean; author: { id: string } | null }[] }
}

export const mrOfGraphql = (n: GqlMr, me: string): Raw => {
  const last = [...n.notes.nodes].reverse().find(note => !note.system)

  return {
    references: { full: n.reference },
    title: n.title,
    web_url: n.webUrl,
    labels: n.labels.nodes.map(l => l.title),
    updated_at: n.updatedAt,
    source_branch: n.sourceBranch ?? undefined,
    draft: n.draft,
    has_conflicts: n.conflicts,
    blocking_discussions_resolved: n.mergeableDiscussionsState ?? undefined,
    head_pipeline: n.headPipeline === null ? null : { status: n.headPipeline.status.toLowerCase() },
    detailed_merge_status: n.detailedMergeStatus?.toLowerCase(),
    reviewers: n.reviewers.nodes,
    approved: n.approved,
    reply: me !== '' && last !== undefined && last.author?.id !== me,
    author: n.author ?? undefined,
  }
}

export const fromNdjson = <T = Raw>(text: string): T[] =>
  text
    .split('\n')
    .filter(line => line.trim() !== '')
    .map(line => JSON.parse(line) as T)
