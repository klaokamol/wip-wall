import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { Card, Mention, Setup } from '../types'
import { MOCK, MOCK_HERE, MOCK_LIVE, MOCK_LOCAL, MOCK_MENTIONS, MOCK_RESUMABLE, MOCK_REVIEWS } from './mock'
import { ageOf, dirOf, dirsOf, isWebUrl, paneOf, reviewsOf, staleHides, titleOf, toCards } from './board'
import type { Orders } from './board'
import { boardOf, fetchBoard, gateOf, messageOf, saveHost, saveRoot, saveTerminal, settingsOf, setupOf } from './gitlab'
import { cardStatus, claimCard, focusRunning, isCardWindow, openCardSession, pruneCardSessions, releaseBranchCard } from './sessions'
import type { Place } from './sessions'
import { THEMES } from './themes'
import { MARQUEE_STEP_MS, cardRow, cardView, colorOf as colorIn, foldRule, mentionRow, mentionView, picker, rowsOf, rule, setupView } from './view'
import type { Look } from './view'

type Dollar = Parameters<Hook<'session.start'>>[0]

const PANE = 'wip-wall'
const REMOTES = `for d in "$@"; do r=$(git -C "$d" config --get remote.origin.url 2>/dev/null); case $? in 0) printf '%s\\t%s\\n' "$d" "$r";; 1) printf '%s\\t\\n' "$d";; *) printf '%s\\t!\\n' "$d";; esac; done`
const REFRESH_MS = 5 * 60 * 1000
const LIVE_MS = 30 * 1000
const CARD_WIDTH = 40

const cards = atom({ plugin: 'wip-wall', key: 'cards' } as const, [])
const mentions = atom({ plugin: 'wip-wall', key: 'mentions' } as const, [])
const mentionsOpen = atom({ plugin: 'wip-wall', key: 'mentionsOpen' } as const, true)
const reviews = atom({ plugin: 'wip-wall', key: 'reviews' } as const, [])
const reviewsOpen = atom({ plugin: 'wip-wall', key: 'reviewsOpen' } as const, true)
const legendOpen = atom({ plugin: 'wip-wall', key: 'legendOpen' } as const, false)
const compact = atom({ plugin: 'wip-wall', key: 'compact' } as const, false)
const latest = atom({ plugin: 'wip-wall', key: 'latest' } as const, false)
const dismissedOpen = atom({ plugin: 'wip-wall', key: 'dismissedOpen' } as const, false)
const folded = atom({ plugin: 'wip-wall', key: 'folded' } as const, [])
const tab = atom({ plugin: 'wip-wall', key: 'tab' } as const, 'all')
const themeName = atom({ plugin: 'wip-wall', key: 'theme' } as const, 'catppuccin')
const group = atom({ plugin: 'wip-wall', key: 'group' } as const, 'all')
const groupMenu = atom({ plugin: 'wip-wall', key: 'groupMenu' } as const, false)
const repoMenu = atom({ plugin: 'wip-wall', key: 'repoMenu' } as const, false)
const statusMenu = atom({ plugin: 'wip-wall', key: 'statusMenu' } as const, false)
const dateMenu = atom({ plugin: 'wip-wall', key: 'dateMenu' } as const, false)
const sortMenu = atom({ plugin: 'wip-wall', key: 'sortMenu' } as const, false)
const boards = atom({ plugin: 'wip-wall', key: 'boards' } as const, {})
const datePick = atom({ plugin: 'wip-wall', key: 'date' } as const, 'month')
const statusPick = atom({ plugin: 'wip-wall', key: 'status' } as const, 'all')
const dirs = atom({ plugin: 'wip-wall', key: 'dirs' } as const, {})
const local = atom({ plugin: 'wip-wall', key: 'local' } as const, [])
const error = atom({ plugin: 'wip-wall', key: 'error' } as const, '')
const loadedAt = atom({ plugin: 'wip-wall', key: 'loadedAt' } as const, 0)
const live = atom({ plugin: 'wip-wall', key: 'live' } as const, [])
const marquee = atom({ plugin: 'wip-wall', key: 'marquee' } as const, '')
const hidden = atom({ plugin: 'wip-wall', key: 'hidden' } as const, {})
const resumable = atom({ plugin: 'wip-wall', key: 'resumable' } as const, [])
const openIn = atom({ plugin: 'wip-wall', key: 'openIn' } as const, 'window')
const here = atom({ plugin: 'wip-wall', key: 'here' } as const, '')
const choosing = atom({ plugin: 'wip-wall', key: 'choosing' } as const, '')
const sessionCwd = atom({ plugin: 'wip-wall', key: 'cwd' } as const, '')
const NO_SETUP: Setup = { checks: [] }
const setup = atom({ plugin: 'wip-wall', key: 'setup' } as const, NO_SETUP)
const gate = atom({ plugin: 'wip-wall', key: 'gate' } as const, 'checking' as 'checking' | 'blocked' | 'ready')

// ponytail: find stops at depth 4, so a clone nested deeper than root/group/sub/repo is not found; raise -maxdepth if subgroups go deeper
const scanDirs = async ($: Dollar) => {
  const { root, host } = await settingsOf($)
  const found = await $.process.run(['find', root, '-maxdepth', '4', '-name', 'node_modules', '-prune', '-o', '-name', '.git', '-type', 'd', '-print'])
  const paths = found.stdout
    .split('\n')
    .map(line => line.replace(/\/\.git$/, ''))
    .filter(path => path !== '' && !path.includes('\t'))
    .sort()
  if (paths.length === 0) return {}
  const ran = await $.process.run(['sh', '-c', REMOTES, 'sh', ...paths])
  const remotes = new Map<string, string>()
  for (const line of ran.stdout.split('\n')) {
    const [path = '', remote = ''] = line.split('\t')
    remotes.set(path, remote)
  }

  return dirsOf(paths.map(path => ({ path, remote: remotes.get(path) ?? '!' })), host)
}

const withBranch = async ($: Dollar, clones: Record<string, string>, list: Card[]): Promise<string[]> => {
  const heads = new Map<string, string[]>()
  for (const dir of new Set(list.map(c => dirOf(clones, c)))) {
    if (!dir) continue
    const ran = await $.process.run(['git', '-C', dir, 'for-each-ref', '--format=%(refname:short)', 'refs/heads'])
    heads.set(dir, ran.stdout.split('\n'))
  }

  return list.filter(c => c.kind === 'issue' && (heads.get(dirOf(clones, c) ?? '') ?? []).some(b => b.startsWith(`${c.num}-`))).map(c => c.key)
}

const paneTitle = async ($: Dollar): Promise<string> => titleOf(await read($, loadedAt))

const retitle = async ($: Dollar) => {
  if (await paneOpen($)) await $.ui.open({ id: PANE, title: await paneTitle($) })
}

let mocking = false
let ready = false

const MOCK_NOTE = 'Mock cards are not real: run /wip-wall to restore'

type BoardSource = 'real' | 'cache' | 'mock' | 'reset'

type BoardPart = {
  cards?: Card[]
  reviews?: Card[]
  mentions?: Mention[]
  boards?: Orders
  dirs?: Record<string, string>
  local?: string[]
  live?: string[]
  resumable?: string[]
  here?: string
  error?: string
  loadedAt?: number
}

const mayApply = async ($: Dollar, source: BoardSource): Promise<boolean> => {
  if (source === 'mock' || source === 'reset') return true
  if (mocking) return false

  return source === 'real' || (await read($, loadedAt)) === 0
}

const differs = (a: unknown, b: unknown): boolean => JSON.stringify(a) !== JSON.stringify(b)

const applyBoard = async ($: Dollar, source: BoardSource, part: BoardPart): Promise<boolean> => {
  let applied = true
  const when = async (has: boolean, changed: () => Promise<boolean>, write: () => Promise<unknown>) => {
    if (!applied || !has) return
    if (!(await mayApply($, source))) {
      applied = false

      return
    }
    if (await changed()) await write()
  }
  await when(part.cards !== undefined, async () => differs(await read($, cards), part.cards), () => update($, cards, () => part.cards ?? []))
  await when(part.reviews !== undefined, async () => differs(await read($, reviews), part.reviews), () => update($, reviews, () => part.reviews ?? []))
  await when(part.mentions !== undefined, async () => differs(await read($, mentions), part.mentions), () => update($, mentions, () => part.mentions ?? []))
  await when(part.boards !== undefined, async () => differs(await read($, boards), part.boards), () => update($, boards, () => part.boards ?? {}))
  await when(part.dirs !== undefined, async () => differs(await read($, dirs), part.dirs), () => update($, dirs, () => part.dirs ?? {}))
  await when(part.local !== undefined, async () => differs(await read($, local), part.local), () => update($, local, () => part.local ?? []))
  await when(part.live !== undefined, async () => differs(await read($, live), part.live), () => update($, live, () => part.live ?? []))
  await when(part.resumable !== undefined, async () => differs(await read($, resumable), part.resumable), () => update($, resumable, () => part.resumable ?? []))
  await when(part.here !== undefined, async () => differs(await read($, here), part.here), () => update($, here, () => part.here ?? ''))
  await when(part.error !== undefined, async () => differs(await read($, error), part.error), () => update($, error, () => part.error ?? ''))
  await when(part.loadedAt !== undefined, async () => differs(await read($, loadedAt), part.loadedAt), () => update($, loadedAt, () => part.loadedAt ?? 0))

  return applied
}

let refreshing: Promise<void> | undefined
let fetched = ''
let unchanged = 0
let skip = 0
const MAX_BACKOFF = 2

const refresh = ($: Dollar): Promise<void> => (refreshing ??= reload($).finally(() => {
  refreshing = undefined
}))

const reload = async ($: Dollar) => {
  if (mocking || !ready) return
  try {
    const { issues, mrs, reviews: asked, mentions: pinged, failures } = await fetchBoard($)
    const list = toCards(issues, mrs)
    const toReview = reviewsOf(asked, new Set(mrs.map(r => r.references.full)))
    const seen = JSON.stringify([list, toReview, pinged])
    unchanged = seen === fetched ? unchanged + 1 : 0
    fetched = seen
    if (!(await applyBoard($, 'real', { cards: list, reviews: toReview, mentions: pinged, loadedAt: Date.now() }))) return
    await pruneHidden($, [...list, ...toReview], pinged, { mrs: failures.mrs === '' && failures.reviews === '', mentions: failures.mentions === '' })
    if (failures.mrs === '' && failures.reviews === '' && failures.mentions === '') await pruneCardSessions($, () => !mocking, new Set([...issues, ...mrs, ...asked].map(r => r.references.full).concat(pinged.map(m => m.ref)))).catch(() => undefined)
    const projects = [...new Set(list.map(c => c.project))]
    const orders: Orders = Object.fromEntries(await Promise.all(projects.map(async project => [project, await boardOf($, project)] as const)))
    if (!(await applyBoard($, 'real', { boards: orders }))) return
    const found = await scanDirs($)
    if (!(await applyBoard($, 'real', { dirs: found }))) return
    const branched = await withBranch($, found, list)
    const at = Date.now()
    if (!(await applyBoard($, 'real', { local: branched, error: [failures.mrs, failures.reviews, failures.mentions].filter(Boolean).join(' · '), loadedAt: at }))) return
    await $.store.set(CACHE, { v: CACHE_VERSION, at, cards: list, reviews: toReview, mentions: pinged, local: branched, dirs: found, boards: orders } satisfies Cached).catch(() => undefined)
    await retitle($)
  } catch (cause) {
    await applyBoard($, 'real', { error: messageOf(cause) })
  }
}

type Cached = { v: number; at: number; cards: Card[]; reviews: Card[]; mentions: Mention[]; local: string[]; dirs: Record<string, string>; boards: Orders }

const CACHE = 'cache:board'
const CACHE_VERSION = 1

const savedBoard = async ($: Dollar): Promise<Cached | undefined> => {
  const saved = (await $.store.get(CACHE)) as Cached | undefined
  if (!saved || saved.v !== CACHE_VERSION || !Array.isArray(saved.cards) || typeof saved.at !== 'number') return undefined

  return {
    ...saved,
    reviews: Array.isArray(saved.reviews) ? saved.reviews : [],
    mentions: Array.isArray(saved.mentions) ? saved.mentions : [],
    local: Array.isArray(saved.local) ? saved.local : [],
    dirs: saved.dirs ?? {},
    boards: saved.boards ?? {},
  }
}

const loadCache = async ($: Dollar, pick: boolean): Promise<boolean> => {
  const saved = await savedBoard($)
  if (!saved) return false
  const mine = pick ? await cwdCard($, saved.dirs, saved.cards) : undefined
  if (!(await mayApply($, 'cache'))) return false
  if (mine) await selectCard($, mine)
  const applied = await applyBoard($, 'cache', {
    cards: saved.cards,
    reviews: saved.reviews,
    mentions: saved.mentions,
    local: saved.local,
    dirs: saved.dirs,
    boards: saved.boards,
    loadedAt: saved.at,
  })

  return applied && mine !== undefined
}

const syncLive = async ($: Dollar) => {
  if (mocking) return
  try {
    await liveSessions($)
  } catch {}
}

const liveSessions = async ($: Dollar) => {
  const status = await cardStatus($, () => !mocking)
  const guess = status.mine ? '' : ((await branchCard($, await read($, dirs), await read($, cards)).catch(() => undefined))?.key ?? '')
  const inferred = status.mine || (status.open.includes(guess) ? '' : guess)
  await applyBoard($, 'real', { live: status.open, resumable: status.resumable, here: inferred })
}

const branchCard = async ($: Dollar, clones: Record<string, string>, list: Card[]): Promise<Card | undefined> => {
  const cwd = await $.session.cwd()
  const dir = Object.values(clones)
    .filter(path => cwd === path || cwd.startsWith(`${path}/`))
    .sort((a, b) => b.length - a.length)[0]
  if (dir === undefined) return undefined
  const ran = await $.process.run(['git', '-C', cwd, 'branch', '--show-current'])
  const num = Number(/^(\d+)-/.exec(ran.stdout.trim())?.[1])

  return list.find(c => c.kind === 'issue' && c.num === num && dirOf(clones, c) === dir)
}

const cwdCard = async ($: Dollar, clones: Record<string, string>, list: Card[]): Promise<Card | undefined> => {
  const cwd = await $.session.cwd()
  const dir = Object.values(clones)
    .filter(path => cwd === path || cwd.startsWith(`${path}/`))
    .sort((a, b) => b.length - a.length)[0]

  return dir === undefined ? undefined : list.find(c => dirOf(clones, c) === dir)
}

const selectCard = async ($: Dollar, card: Card) => {
  await update($, group, () => card.group)
  await update($, tab, () => card.repo)
}

const selectByCwd = async ($: Dollar) => {
  const card = await cwdCard($, await read($, dirs), await read($, cards))
  if (card) await selectCard($, card)
}

const opening = new Set<string>()

const openWeb = async ($: Dollar, url: string) => {
  if (mocking) return $.ui.toast(MOCK_NOTE)
  if (!isWebUrl(url)) return $.ui.toast('Refusing to open a link that is not http or https')
  await $.process.run(['open', url])
}

const open = async ($: Dollar, card: Card) => {
  if (mocking) return $.ui.toast(MOCK_NOTE)
  if (opening.has(card.key)) return
  opening.add(card.key)
  try {
    const { root } = await settingsOf($)
    if (card.key === (await read($, here))) return $.ui.toast('This card is open in this session')
    if (await focusRunning($, card)) return
    if (!dirOf(await read($, dirs), card)) return $.ui.toast(`No local clone of ${card.repo} under ${root}`)
    if (!isWebUrl(card.url)) return $.ui.toast('Refusing to open a link that is not http or https')
    await update($, choosing, () => card.key)
  } finally {
    opening.delete(card.key)
  }
}

const openAt = async ($: Dollar, card: Card, place: Place) => {
  if (mocking) return $.ui.toast(MOCK_NOTE)
  await update($, choosing, () => '')
  if (opening.has(card.key)) return
  opening.add(card.key)
  try {
    await update($, openIn, () => place)
    await $.store.set('ui:openIn', place)
    const cwd = dirOf(await read($, dirs), card)
    const note = (await read($, mentions)).find(m => m.ref === card.key)?.noteUrl
    const target = note !== undefined && isWebUrl(note) ? { ...card, url: note } : card
    if (!cwd || !isWebUrl(target.url)) return
    if (await openCardSession($, target, cwd, place)) await syncLive($)
  } finally {
    opening.delete(card.key)
  }
}

const savedHides = async ($: Dollar): Promise<Record<string, string>> => {
  const found: Record<string, string> = {}
  for (const key of (await $.store.keys()).filter(k => k.startsWith('hide:'))) {
    const updated = (await $.store.get(key)) as string | undefined
    if (typeof updated === 'string') found[key.slice('hide:'.length)] = updated
  }

  return found
}

const syncHidden = async ($: Dollar) => {
  const found = await savedHides($)
  await update($, hidden, () => found)
}

const pruneHidden = async ($: Dollar, list: Card[], pinged: Mention[], fetched: { mrs: boolean; mentions: boolean }) => {
  const saved = await savedHides($)
  const stale = staleHides(saved, list, pinged, fetched)
  if (stale.length === 0 || mocking) return
  const gone = new Set<string>()
  // ponytail: a dismiss landing between this store.get and store.delete is still lost; needs a compare-and-delete store call to close
  for (const key of stale) {
    if ((await $.store.get(`hide:${key}`)) !== saved[key]) continue
    await $.store.delete(`hide:${key}`)
    gone.add(key)
  }
  await update($, hidden, prev => Object.fromEntries(Object.entries(prev).filter(([k, v]) => !(gone.has(k) && v === saved[k]))))
}

const dismiss = async ($: Dollar, card: Pick<Card, 'key' | 'updated'>) => {
  if (mocking) return $.ui.toast(MOCK_NOTE)
  await $.store.set(`hide:${card.key}`, card.updated)
  await update($, hidden, prev => ({ ...prev, [card.key]: card.updated }))
  await retitle($)
}

const toggleMentions = async ($: Dollar) => {
  const next = !(await read($, mentionsOpen))
  await update($, mentionsOpen, () => next)
  await $.store.set('ui:mentions', next)
}

const toggleReviews = async ($: Dollar) => {
  const next = !(await read($, reviewsOpen))
  await update($, reviewsOpen, () => next)
  await $.store.set('ui:reviews', next)
}

const toggleFold = async ($: Dollar, id: string) => {
  const prev = await read($, folded)
  const next = prev.includes(id) ? prev.filter(f => f !== id) : [...prev, id]
  await update($, folded, () => next)
  await $.store.set('ui:folded', next)
}

const toggleCompact = async ($: Dollar) => {
  const next = !(await read($, compact))
  await update($, compact, () => next)
  await $.store.set('ui:compact', next)
}

const pickLatest = async ($: Dollar, next: boolean) => {
  await update($, latest, () => next)
  await $.store.set('ui:latest', next)
}

const toggleLegend = async ($: Dollar) => {
  const next = !(await read($, legendOpen))
  await update($, legendOpen, () => next)
  await $.store.set('ui:legend', next)
}

const loadPrefs = async ($: Dollar) => {
  const [mentionsSaved, openSaved, themeSaved, legendSaved, reviewsSaved, compactSaved] = await Promise.all([$.store.get('ui:mentions'), $.store.get('ui:openIn'), $.store.get('ui:theme'), $.store.get('ui:legend'), $.store.get('ui:reviews'), $.store.get('ui:compact')])
  const [foldedSaved, latestSaved] = await Promise.all([$.store.get('ui:folded'), $.store.get('ui:latest')])
  await update($, folded, () => (Array.isArray(foldedSaved) ? foldedSaved.filter((f): f is string => typeof f === 'string') : []))
  await update($, mentionsOpen, () => mentionsSaved !== false)
  await update($, reviewsOpen, () => reviewsSaved !== false)
  await update($, legendOpen, () => legendSaved === true)
  await update($, compact, () => compactSaved === true)
  await update($, latest, () => latestSaved === true)
  await update($, openIn, () => (openSaved === 'tab' || openSaved === 'split' || openSaved === 'here' ? openSaved : 'window'))
  if (typeof themeSaved === 'string' && themeSaved in THEMES) await update($, themeName, () => themeSaved)
}

let setupRun = 0

const checkGate = async ($: Dollar, show = false): Promise<boolean> => {
  ready = false
  const checked = await gateOf($)
  ready = checked.ready
  await update($, gate, () => (checked.ready ? 'ready' : 'blocked'))
  if (!checked.ready || show) await update($, setup, () => checked.setup)

  return checked.ready
}

const fillSetup = ($: Dollar, run: number) =>
  void setupOf($)
    .catch(() => NO_SETUP)
    .then(async checked => {
      if (run === setupRun && !mocking && checked.checks.length > 0) await update($, setup, () => checked)
    })
    .catch(() => undefined)

const refreshFresh = async ($: Dollar) => {
  await refreshing
  await refresh($)
}

const cycleTheme = async ($: Dollar) => {
  const names = Object.keys(THEMES)
  const next = names[(names.indexOf(await read($, themeName)) + 1) % names.length]
  await update($, themeName, () => next)
  await $.store.set('ui:theme', next)
}

const restoreOne = async ($: Dollar, key: string) => {
  if (mocking) return $.ui.toast(MOCK_NOTE)
  await $.store.delete(`hide:${key}`)
  await update($, hidden, prev => Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key)))
  await retitle($)
}

let polling = false
let carried:
  | {
      group: string
      tab: string
      date: string
      status: string
      mentions: boolean
      reviews: boolean
      legend: boolean
      compact: boolean
      latest: boolean
      folded: string[]
      theme: string
      place: string
      dismissed: boolean
      hidden: Record<string, string>
      live: string[]
      resumable: string[]
      here: string
    }
  | undefined
let timers: { cancel: () => void }[] = []

// ponytail: fixed wait for the new session to settle after /clear or /resume; listen for a ready event if 500 ms proves too short
const CLEAR_RESTART_MS = 500
const CLEAR_RESTART_TRIES = 4
const OWNER_STALE_MS = 3 * LIVE_MS

const paneOpen = async ($: Dollar): Promise<boolean> => (await $.ui.panes()).some(pane => pane.id === PANE)

const poll = ($: Dollar) => {
  if (polling) return
  polling = true
  unchanged = 0
  skip = 0
  timers = [
    $.clock.every(REFRESH_MS, async () => {
      if (skip > 0) {
        skip -= 1

        return
      }
      if (!ready || !(await paneOpen($).catch(() => false))) return
      await refresh($)
      skip = Math.min(unchanged, MAX_BACKOFF)
    }),
    $.clock.every(LIVE_MS, async () => {
      if (!ready || !(await paneOpen($).catch(() => false))) return
      await claimPane($)
      await syncLive($)
    }),
  ]
}

const insideRoot = async ($: Dollar): Promise<boolean> => {
  const root = (await settingsOf($)).root.replace(/\/+$/, '')
  const cwd = await $.session.cwd()

  return cwd === root || cwd.startsWith(`${root}/`)
}

const claimPane = async ($: Dollar) => {
  await $.store.set('pane:owner', { sid: await $.session.id(), at: Date.now() })
}

const otherPane = async ($: Dollar): Promise<boolean> => {
  const owner = (await $.store.get('pane:owner')) as { sid?: string; at?: number } | undefined
  // ponytail: heartbeat lock, a closed owner pane blocks new sessions for up to OWNER_STALE_MS; needs a cross-session pane list to close
  return !!owner && owner.sid !== (await $.session.id()) && Date.now() - (owner.at ?? 0) < OWNER_STALE_MS
}

const claimBranchCard = async ($: Dollar) => {
  const saved = await savedBoard($)
  if (!saved) return
  const card = await branchCard($, saved.dirs, saved.cards)
  await (card ? claimCard($, card) : releaseBranchCard($))
}

const start = async ($: Dollar, paneShown = false) => {
  await $.command.register({ name: 'wip-wall', description: 'Open the WIP-WALL pane and refresh it' })
  void claimBranchCard($).catch(() => undefined)
  const shown = paneShown || (await paneOpen($).catch(() => false))
  if (!shown && (await isCardWindow($).catch(() => false))) return
  if (!shown && !(await insideRoot($).catch(() => false))) return
  if (!shown && (await otherPane($).catch(() => false))) return
  void claimPane($).catch(() => undefined)
  const kept = carried
  try {
    if (kept) {
      await update($, group, () => kept.group)
      await update($, tab, () => kept.tab)
      await update($, datePick, () => kept.date)
      await update($, statusPick, () => kept.status)
      await update($, mentionsOpen, () => kept.mentions)
      await update($, reviewsOpen, () => kept.reviews)
      await update($, legendOpen, () => kept.legend)
      await update($, compact, () => kept.compact)
      await update($, latest, () => kept.latest)
      await update($, folded, () => kept.folded)
      await update($, themeName, () => kept.theme)
      await update($, openIn, () => kept.place)
      await update($, dismissedOpen, () => kept.dismissed)
      await update($, hidden, () => kept.hidden)
      await update($, live, () => kept.live)
      await update($, resumable, () => kept.resumable)
      await update($, here, () => kept.here)
    }
  } finally {
    carried = undefined
  }
  const before = `${await read($, group)}/${await read($, tab)}`
  void $.ui.open({ id: PANE, title: await paneTitle($) })
  void Promise.all([syncHidden($), loadCache($, !kept).catch(() => false)])
    .then(async ([, picked]) => {
      await retitle($)

      return picked
    })
    .catch(() => false)
    .then(async picked => {
      if (!(await checkGate($))) {
        fillSetup($, setupRun)

        return
      }
      await refresh($)
      await syncLive($)
      if (!kept && !picked && before === `${await read($, group)}/${await read($, tab)}`) await selectByCwd($)
    })
    .catch(() => undefined)
  void syncLive($)
  void loadPrefs($).catch(() => undefined)
  void $.session.cwd().then(cwd => update($, sessionCwd, () => cwd)).catch(() => undefined)
  poll($)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await start($)

    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    void claimBranchCard($).catch(() => undefined)

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason !== 'clear' && e.reason !== 'resume') {
      const owner = (await $.store.get('pane:owner').catch(() => undefined)) as { sid?: string } | undefined
      if (owner?.sid === (await $.session.id().catch(() => ''))) await $.store.delete('pane:owner').catch(() => undefined)
    }
    if (e.reason === 'clear' || e.reason === 'resume') {
      const filters = {
        group: await read($, group),
        tab: await read($, tab),
        date: await read($, datePick),
        status: await read($, statusPick),
        mentions: await read($, mentionsOpen),
        reviews: await read($, reviewsOpen),
        legend: await read($, legendOpen),
        compact: await read($, compact),
        latest: await read($, latest),
        folded: await read($, folded),
        theme: await read($, themeName),
        place: await read($, openIn),
        dismissed: await read($, dismissedOpen),
        hidden: await read($, hidden),
        live: await read($, live),
        resumable: await read($, resumable),
        here: await read($, here),
      }
      const restart = (left: number) => $.clock.after(CLEAR_RESTART_MS, async () => {
        if (!(await paneOpen($).catch(() => false))) {
          if (left > 0) restart(left - 1)
          else carried = undefined

          return
        }
        mocking = false
        refreshing = undefined
        for (const timer of timers) timer.cancel()
        timers = []
        polling = false
        await start($, true)
      })
      carried = carried ?? filters
      restart(CLEAR_RESTART_TRIES)
    }

    return next(e)
  })

  on('command.run', { command: 'wip-wall' }, async ($, e) => {
    const leaving = mocking
    const typed = e.args.trim()
    mocking = typed === 'mock'
    const setting = /^setup(\s|$)/.test(typed)
    const run = (setupRun += 1)
    if (!setting) await update($, setup, () => NO_SETUP)
    if (leaving && !mocking) {
      await applyBoard($, 'reset', { cards: [], reviews: [], local: [], live: [], resumable: [], here: '', loadedAt: 0 })
      await loadCache($, true).catch(() => false)
    }
    if (mocking) {
      await applyBoard($, 'mock', { cards: MOCK, reviews: MOCK_REVIEWS, mentions: MOCK_MENTIONS, local: MOCK_LOCAL, live: MOCK_LIVE, resumable: MOCK_RESUMABLE, here: MOCK_HERE, error: '', loadedAt: Date.now() })
      await $.ui.open({ id: PANE, title: await paneTitle($) })

      return { text: 'WIP-WALL showing mock cards: run /wip-wall to restore' }
    }
    let rejected = ''
    let saved = false
    if (setting) {
      const folder = typed.slice('setup'.length).trim()
      if (/^host(\s|$)/.test(folder)) {
        rejected = await saveHost($, folder.slice('host'.length))
        saved = rejected === ''
      } else if (/^terminal(\s|$)/.test(folder)) {
        rejected = await saveTerminal($, folder.slice('terminal'.length))
        saved = rejected === ''
      } else if (folder !== '') {
        rejected = await saveRoot($, folder)
        saved = rejected === ''
      }
    }
    const passed = await checkGate($, setting)
    if (setting || !passed) fillSetup($, run)
    if (!passed) {
      await $.ui.open({ id: PANE, title: await paneTitle($) })
      await claimPane($)

      return { text: rejected !== '' ? `Not saved: ${rejected}` : 'WIP-WALL needs setup: see the pane' }
    }
    if (!polling) await Promise.all([syncHidden($), loadPrefs($), $.session.cwd().then(cwd => update($, sessionCwd, () => cwd))])
    await (saved ? refreshFresh($) : refresh($))
    await $.ui.open({ id: PANE, title: await paneTitle($) })
    await claimPane($)
    await syncLive($)
    poll($)

    return { text: rejected !== '' ? `Not saved: ${rejected}` : setting ? 'WIP-WALL setup checked: see the pane' : 'WIP-WALL refreshed' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const themeNames = Object.keys(THEMES)
    const pickedTheme = carried?.theme ?? (await read($, themeName))
    const themeKey = themeNames.includes(pickedTheme) ? pickedTheme : themeNames[0]
    const theme = THEMES[themeKey as keyof typeof THEMES]
    const { muted: MUTED, faint: FAINT, text: TEXT, bad: BAD } = theme
    const colorOf = (status: string): string => colorIn(theme, status)
    const mentionsOn = carried?.mentions ?? (await read($, mentionsOpen))
    const reviewsOn = carried?.reviews ?? (await read($, reviewsOpen))
    const legendOn = carried?.legend ?? (await read($, legendOpen))
    const compactOn = carried?.compact ?? (await read($, compact))
    const latestOn = carried?.latest ?? (await read($, latest))
    const dismissedOn = carried?.dismissed ?? (await read($, dismissedOpen))
    const foldedNow = carried?.folded ?? (await read($, folded))
    const problem = await read($, error)
    const atMs = await read($, loadedAt)
    const cardsNow = await read($, cards)
    const saved = atMs === 0 && cardsNow.length === 0 && !mocking ? await savedBoard($).catch(() => undefined) : undefined
    const loadedMs = saved?.at ?? atMs
    const loaded = loadedMs > 0
    const now = Date.now()
    const menuOpen = await read($, groupMenu)
    const repoOpen = await read($, repoMenu)
    const scrolling = await read($, marquee)
    const hereKey = carried?.here ?? (await read($, here))
    const chosen = await read($, choosing)
    const lastPlace = carried?.place ?? (await read($, openIn))
    const clones = saved?.dirs ?? (await read($, dirs))
    const cwdNow = await read($, sessionCwd)
    const cwdDir = Object.values(clones)
      .filter(path => cwdNow === path || cwdNow.startsWith(`${path}/`))
      .sort((a, b) => b.length - a.length)[0]
    const statusOpen = await read($, statusMenu)
    const dateOpen = await read($, dateMenu)
    const sortOpen = await read($, sortMenu)
    const setupNow = await read($, setup)
    const gateNow = await read($, gate)
    const view = paneOf(
      {
        cards: saved?.cards ?? cardsNow,
        reviews: saved?.reviews ?? (await read($, reviews)),
        mentions: saved?.mentions ?? (await read($, mentions)),
        hidden: carried?.hidden ?? (await read($, hidden)),
        group: carried?.group ?? (await read($, group)),
        tab: carried?.tab ?? (await read($, tab)),
        date: carried?.date ?? (await read($, datePick)),
        status: carried?.status ?? (await read($, statusPick)),
        boards: saved?.boards ?? (await read($, boards)),
        working: [...(carried?.live ?? (await read($, live))), hereKey],
        here: hereKey,
        latest: latestOn,
      },
      now,
    )
    const { working, shown, unmatched, doneLeft, sections, heard, pinged, reviews: toReview } = view
    const cols = e.props.bodyColumns ?? 80
    const perRow = Math.max(1, Math.floor(cols / (CARD_WIDTH + 1)))
    const lineWidth = e.props.bodyColumns ?? 80
    const branched = saved?.local ?? (await read($, local))
    const openKeys = carried?.live ?? (await read($, live))
    const backKeys = carried?.resumable ?? (await read($, resumable))
    const width = Math.min(cols, Math.max(CARD_WIDTH, Math.floor((cols - (perRow - 1)) / perRow)))
    const age = ageOf(new Date(loadedMs).toISOString(), now)
    const agoText = age === 'now' ? 'Just now' : `${age} ago`
    const updatedText = `[${agoText}]`

    const look: Look = {
      els,
      theme,
      width,
      lineWidth,
      now,
      hereKey,
      openKeys,
      backKeys,
      branched,
      pinged,
      chosen,
      lastPlace: lastPlace as Place,
      canHere: card => cwdDir !== undefined && dirOf(clones, card) === cwdDir,
      scrolling,
      act: {
        open: card => open($, card),
        openAt: (card, place) => openAt($, card, place),
        cancel: () => update($, choosing, () => ''),
        hide: item => dismiss($, item),
        restore: key => restoreOne($, key),
        web: url => openWeb($, url),
        noHere: card => $.ui.toast(`Claude here runs in ${cwdNow.split('/').pop() || cwdNow}: start it in ${card.repo} to open the card here`),
        play: async (key, chars) => {
          await update($, marquee, () => key)
          await $.clock.after(MARQUEE_STEP_MS * (chars + 4), async () => {
            if ((await read($, marquee)) === key) await update($, marquee, () => '')
          })
        },
      },
    }
    if (gateNow === 'blocked' && !mocking)
      return (
        <Box flexDirection="column" minHeight={e.props.placement === 'dock' ? e.props.scroll?.bodyRows : undefined}>
          <Box justifyContent="center" marginBottom={1}>
            <Text bold color={TEXT}><Text color={colorOf('doing')}>WIP</Text>-WALL</Text>
          </Box>
          {setupView(look, setupNow, 0, {})}
        </Box>
      )
    const grid = (list: Card[], prefix: string) =>
      compactOn
        ? list.map(card => cardRow(look, card))
        : rowsOf(list, perRow).map(row => (
            <Box key={`${prefix}${row[0].key}`} columnGap={1}>
              {row.map(card => cardView(look, card))}
            </Box>
          ))
    const dismissed = [
      ...view.hiddenCards.map(c => ({ key: c.key, node: cardView(look, c, true) })),
      ...view.hiddenMentions.map(m => ({ key: m.key, node: mentionView(look, m, true) })),
    ]
    const dismissedRows = rowsOf(dismissed, perRow)

    return (
      <Box flexDirection="column" minHeight={e.props.placement === 'dock' ? e.props.scroll?.bodyRows : undefined}>
        <Box flexDirection="column" flexGrow={1}>
        <Box justifyContent="space-between" marginBottom={1}>
          <Box width={9} />
          <Text bold color={TEXT}><Text color={colorOf('doing')}>WIP</Text>-WALL</Text>
          <Box>
            <Button key="legend:toggle" plain onPress={() => toggleLegend($)}>
              <Text color={legendOn ? TEXT : MUTED}>[i]</Text>
            </Button>
            <Button key="compact:toggle" plain onPress={() => toggleCompact($)}>
              <Text color={compactOn ? TEXT : MUTED}>[c]</Text>
            </Button>
            <Button key="theme" plain onPress={() => cycleTheme($)}>
              <Text color={MUTED}>[t]</Text>
            </Button>
          </Box>
        </Box>
        {legendOn && (
          <Box flexDirection="column" alignItems="center" marginBottom={1}>
            <Text color={FAINT} wrap="truncate-end">● here  ◉ open  ◎ resumable  ○ none  ↓ branch  @ mentioned  ✕ hide</Text>
            <Text color={FAINT} wrap="truncate-end">{`title: claude  status: web  c: compact  t: ${themeKey}  time: refresh`}</Text>
          </Box>
        )}
        {setupNow.checks.length > 0 &&
          setupView(look, setupNow, new Set(Object.values(clones)).size, {
            close: () => {
              setupRun += 1

              return update($, setup, () => NO_SETUP)
            },
          })}
        {loaded ? (
          <Box columnGap={1}>
            <Box flexShrink={1}>
              <Text color={FAINT} wrap="truncate-end">{`── Filters ${'─'.repeat(Math.max(0, lineWidth - updatedText.length - 12))}`}</Text>
            </Box>
            <Button key="refresh" plain onPress={() => refresh($)}>
              <Text color={MUTED}>{updatedText}</Text>
            </Button>
          </Box>
        ) : (
          rule(look, 'Filters', false)
        )}
        {picker(
          look,
          'Project',
          'group',
          menuOpen,
          v => update($, groupMenu, () => v),
          view.groups.map(g => ({
            ...g,
            color: MUTED,
            on: g.id === view.group,
            press: async () => {
              await update($, group, () => g.id)
              await update($, tab, () => 'all')
            },
          })),
        )}
        {view.repos &&
          picker(
            look,
            'Repo',
            'repo',
            repoOpen,
            v => update($, repoMenu, () => v),
            view.repos.map(r => ({
              ...r,
              color: MUTED,
              on: r.id === view.repo,
              press: () => update($, tab, () => r.id),
            })),
          )}
        {picker(
          look,
          'Updated',
          'date',
          dateOpen,
          v => update($, dateMenu, () => v),
          view.dates.map(d => ({
            id: d.id,
            label: d.label,
            count: d.count,
            color: MUTED,
            on: d.id === view.date,
            press: () => update($, datePick, () => d.id),
          })),
          true,
        )}
        {picker(
          look,
          'Status',
          'status',
          statusOpen,
          v => update($, statusMenu, () => v),
          view.statuses.map(st => ({
            ...st,
            color: st.id === 'all' ? MUTED : colorOf(st.label),
            on: st.id.toLowerCase() === view.status,
            press: () => update($, statusPick, () => st.id.toLowerCase()),
          })),
        )}
        {picker(
          look,
          'Sort',
          'sort',
          sortOpen,
          v => update($, sortMenu, () => v),
          [
            { id: 'status', label: 'default', color: MUTED, on: !latestOn, press: () => pickLatest($, false) },
            { id: 'latest', label: 'latest', color: MUTED, on: latestOn, press: () => pickLatest($, true) },
          ],
          true,
        )}
        {sections.length === 0 && heard.length === 0 && working.length === 0 && rule(look, 'Cards')}
        {problem !== '' && (
          <Box columnGap={1}>
            <Box flexShrink={1} flexDirection="column">
              {problem.split(' · ').map((part, n) => (
                <Text key={`problem:${n}`} color={BAD}>{part}</Text>
              ))}
            </Box>
            <Button key="retry" plain onPress={() => refresh($)}>
              <Text bold color={TEXT}>[retry]</Text>
            </Button>
          </Box>
        )}
        {unmatched && (
          <Box justifyContent="center" paddingY={1}>
            <Text color={MUTED}>No cards match these filters. Pick all to clear them.</Text>
          </Box>
        )}
        {doneLeft && (
          <Box justifyContent="center" paddingY={1}>
            <Text color={MUTED}>Only done cards left. Pick Done under Status to see them.</Text>
          </Box>
        )}
        {view.total === 0 && problem === '' && loaded && (
          <Box justifyContent="center" paddingY={1}>
            <Text color={MUTED}>Nothing assigned to you</Text>
          </Box>
        )}
        {view.total === 0 && problem === '' && !loaded && (
          <Box flexDirection="column" alignItems="center" paddingY={1}>
            <Box columnGap={1}>
              {'Client' in els ? (
                <els.Client key="spinner" module="./spinner.tsx" props={{ color: colorOf('doing') }} />
              ) : (
                <Text color={colorOf('doing')}>◌</Text>
              )}
              <Text bold color={colorOf('doing')}>Loading board</Text>
            </Box>
            <Text color={FAINT}>fetching your issues and merge requests</Text>
          </Box>
        )}
        {working.length > 0 && (
          <Box flexDirection="column">
            {foldRule(look, `Working · ${working.length}`, 'working:toggle', !foldedNow.includes('working'), () => toggleFold($, 'working'))}
            {!foldedNow.includes('working') && grid(working, 'working:')}
          </Box>
        )}
        {heard.length > 0 && (
          <Box flexDirection="column">
            {foldRule(look, `Mentions · ${heard.length}`, 'mentions:toggle', mentionsOn, () => toggleMentions($))}
            {mentionsOn &&
              (compactOn
                ? heard.map(m => mentionRow(look, m))
                : rowsOf(heard, perRow).map(row => (
                    <Box key={row[0].key} columnGap={1}>
                      {row.map(m => mentionView(look, m))}
                    </Box>
                  )))}
          </Box>
        )}
        {toReview.length > 0 && (
          <Box flexDirection="column">
            {foldRule(look, `Requests · ${toReview.length}`, 'reviews:toggle', reviewsOn, () => toggleReviews($))}
            {reviewsOn && grid(toReview, 'review:')}
          </Box>
        )}
        {sections.map(sec => (
          <Box key={`sec:${sec.name}`} flexDirection="column">
            {foldRule(look, sec.label, `sec:${sec.name}:toggle`, !foldedNow.includes(`sec:${sec.name}`), () => toggleFold($, `sec:${sec.name}`))}
            {!foldedNow.includes(`sec:${sec.name}`) && grid(sec.list, '')}
          </Box>
        ))}
        {loaded && dismissed.length > 0 && (
          <Box flexDirection="column">
            {foldRule(look, `Dismissed · ${dismissed.length}`, 'dismissed:toggle', dismissedOn, () => update($, dismissedOpen, () => !dismissedOn))}
            {dismissedOn &&
              dismissedRows.map(row => (
                <Box key={row[0].key} columnGap={1}>
                  {row.map(d => d.node)}
                </Box>
              ))}
          </Box>
        )}
        </Box>
      </Box>
    )
  })
}
