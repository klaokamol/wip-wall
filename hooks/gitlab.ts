import type { Hook } from 'claude-code'

import type { Mention, Setup, SetupCheck } from '../types'
import { MENTION_ACTIONS, boardOrder, clean, fromNdjson, mentionsOf, mrOfGraphql } from './board'
import type { GqlMr, Raw, RawBoard, RawTodo } from './board'

export type Dollar = Parameters<Hook<'session.start'>>[0]

const BOARD_TTL_MS = 24 * 60 * 60 * 1000

const ROOT_KEY = 'ui:root'
const HOST_KEY = 'ui:host'
const HOST_NAME = /^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?(:[0-9]{1,5})?$/
const HAS_CONTROL = /[\u0000-\u001f\u007f]/
const RESOLVE = 'case "$1" in "~") d=$HOME;; "~/"*) d=$HOME/${1#"~/"};; *) d=$1;; esac; [ -d "$d" ] && printf %s "$d"'
const PROBE = 'if application "Ghostty" is running then\ntell application "Ghostty" to get name\nreturn "ok"\nend if\nreturn "idle"'

const DETECT = [
  'export PATH="$PATH:/opt/homebrew/bin:/usr/local/bin"',
  'glab="${WIP_WALL_GLAB:-$(command -v glab)}"',
  `printf '%s\\n' "$glab" "\${WIP_WALL_HOST:-\${WIP_WALL_SAVED_HOST:-\${GITLAB_HOST:-$("$glab" config get host 2>/dev/null)}}}" "\${WIP_WALL_ROOT:-\${WIP_WALL_SAVED_ROOT:-}}" "\${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects"`,
].join('\n')

export const messageOf = (cause: unknown): string => clean(String(cause instanceof Error ? cause.message : cause))

type Settings = { glab: string; host: string; root: string; sessions: string }

let detected: Promise<Settings> | undefined

async function savedRoot($: Dollar): Promise<string> {
  const saved = await $.store.get(ROOT_KEY)

  return typeof saved === 'string' && saved.startsWith('/') && !HAS_CONTROL.test(saved) ? saved : ''
}

async function savedHost($: Dollar): Promise<string> {
  const saved = await $.store.get(HOST_KEY)

  return typeof saved === 'string' && HOST_NAME.test(saved) ? saved : ''
}

async function detect($: Dollar): Promise<Settings> {
  const ran = await $.process.run(['sh', '-c', DETECT], { env: { WIP_WALL_SAVED_ROOT: await savedRoot($), WIP_WALL_SAVED_HOST: await savedHost($) } })
  const [glab = '', host = '', root = '', sessions = ''] = ran.stdout.split('\n')

  return { glab, host, root, sessions }
}

export function forgetSettings() {
  detected = undefined
}

export function settingsOf($: Dollar): Promise<Settings> {
  const found = (detected ??= detect($).then(settings => {
    if (!settings.glab) throw new Error('glab not found: install it or set WIP_WALL_GLAB')
    if (!settings.host) throw new Error('GitLab host unknown: run glab auth login or set WIP_WALL_HOST')
    if (!settings.root || !settings.sessions) throw new Error('clone root or sessions folder unknown: run /wip-wall setup or set WIP_WALL_ROOT')

    return settings
  }))
  found.catch(() => {
    detected = undefined
  })

  return found
}

export async function saveRoot($: Dollar, folder: string): Promise<string> {
  const typed = folder.trim()
  if (HAS_CONTROL.test(typed)) return 'the folder holds a control character'
  if (typed !== '~' && !typed.startsWith('~/') && !typed.startsWith('/')) return 'give an absolute folder, or one that starts with ~/'
  const path = (await $.process.run(['sh', '-c', RESOLVE, 'sh', typed])).stdout.trim().replace(/\/+$/, '')
  if (HAS_CONTROL.test(path)) return 'the folder holds a control character'
  if (path === '') return `${typed} is not a folder, or is the filesystem root`
  await $.store.set(ROOT_KEY, path)
  forgetSettings()

  return ''
}

export async function saveHost($: Dollar, typed: string): Promise<string> {
  const host = typed.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  if (!HOST_NAME.test(host)) return 'give a GitLab host such as gitlab.example.com (no path)'
  await $.store.set(HOST_KEY, host)
  forgetSettings()

  return ''
}

async function requiredOf($: Dollar): Promise<{ glab: SetupCheck; login: SetupCheck; clone: SetupCheck }> {
  const raw = await detect($)
  const saved = await savedRoot($)
  const chosenHost = await savedHost($)
  const hasGlab = raw.glab !== ''
  const loggedIn = hasGlab && raw.host !== '' && (await $.process.run([raw.glab, 'auth', 'status', '--hostname', raw.host])).exitCode === 0
  const rootExists = raw.root !== '' && (await $.process.run(['test', '-d', raw.root])).exitCode === 0
  const loginNote = raw.host === '' ? 'no host: run /wip-wall setup host <gitlab host>' : `run glab auth login --hostname ${raw.host}`

  return {
    glab: { label: 'glab', ok: hasGlab, note: hasGlab ? raw.glab : 'brew install glab, or set WIP_WALL_GLAB' },
    login: { label: 'GitLab login', ok: loggedIn, note: loggedIn ? (chosenHost !== '' && chosenHost !== raw.host ? `${raw.host} (WIP_WALL_HOST overrides the host chosen here)` : raw.host) : hasGlab ? loginNote : 'needs glab first' },
    clone: {
      label: 'Clone folder',
      ok: rootExists,
      note: raw.root === '' ? 'not set: run /wip-wall setup <folder>' : !rootExists ? `${raw.root} is not a folder: run /wip-wall setup <folder>` : saved !== '' && saved !== raw.root ? `${raw.root} (WIP_WALL_ROOT overrides the folder chosen here)` : raw.root,
      clones: true,
    },
  }
}

const cleaned = (checks: SetupCheck[]): Setup => ({ checks: checks.map(c => ({ ...c, note: clean(c.note) })) })

export async function gateOf($: Dollar): Promise<{ ready: boolean; setup: Setup }> {
  forgetSettings()
  const { glab, login, clone } = await requiredOf($)

  return { ready: glab.ok && login.ok && clone.ok, setup: cleaned([glab, login, clone]) }
}

export async function setupOf($: Dollar): Promise<Setup> {
  const { glab, login, clone } = await requiredOf($)
  const installed = (await $.process.run(['osascript', '-e', 'id of application "Ghostty"'])).exitCode === 0
  const probe = installed ? await $.process.run(['osascript', '-e', PROBE]) : undefined
  const ghostty: SetupCheck[] = [
    { label: 'Ghostty', ok: installed, note: installed ? 'installed' : 'install it from ghostty.org' },
    {
      label: 'Ghostty control',
      ok: probe !== undefined && probe.exitCode === 0,
      note: probe === undefined ? 'needs Ghostty first' : probe.exitCode !== 0 ? 'allow it in System Settings, Privacy and Security, Automation' : probe.stdout.trim() === 'idle' ? 'Ghostty is not running: macOS asks on the first open' : 'allowed',
    },
  ]

  return cleaned([glab, login, ...ghostty, clone])
}

async function run($: Dollar, argv: string[]): Promise<string> {
  const { glab, host } = await settingsOf($)
  const ran = await $.process.run([glab, 'api', ...argv], { env: { GITLAB_HOST: host } })
  if (ran.exitCode !== 0) throw new Error(ran.stderr.trim() || `glab exit ${ran.exitCode}`)

  return ran.stdout
}

async function listOf<T = Raw>($: Dollar, path: string): Promise<T[]> {
  return fromNdjson<T>(await run($, ['--paginate', '--output', 'ndjson', path]))
}

const REVIEW_STATES = 'reviewStates: [UNREVIEWED, REVIEW_STARTED, UNAPPROVED], '

const mrsQuery = (field: string, filter = '') => `query($after: String) { currentUser { id ${field}(state: opened, ${filter}first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { reference(full: true) author { username } title webUrl updatedAt sourceBranch draft conflicts approved detailedMergeStatus mergeableDiscussionsState labels { nodes { title } } headPipeline { status } reviewers { nodes { id } } notes(last: 10) { nodes { system author { id } } } } } } }`

type MrConnection = { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: GqlMr[] }

type MrPage = { data: { currentUser: ({ id: string } & Record<string, MrConnection | undefined>) | null } }

async function mrsOf($: Dollar, field: string, filter = ''): Promise<Raw[]> {
  const query = mrsQuery(field, filter)
  const found: Raw[] = []
  let after = ''
  for (;;) {
    const page = JSON.parse(await run($, ['graphql', '-f', `query=${query}`, ...(after === '' ? [] : ['-f', `after=${after}`])])) as MrPage
    const user = page.data?.currentUser
    const mrs = user?.[field]
    if (!user || !mrs) throw new Error('GitLab returned no current user for the merge request query')
    const id = user.id
    found.push(...mrs.nodes.map(node => mrOfGraphql(node, id)))
    if (!mrs.pageInfo.hasNextPage || !mrs.pageInfo.endCursor) return found
    after = mrs.pageInfo.endCursor
  }
}

async function pendingMentions($: Dollar): Promise<Mention[]> {
  const pages = await Promise.all(
    MENTION_ACTIONS.map(action => listOf<RawTodo>($, `todos?state=pending&action=${action}&per_page=100`)),
  )

  return mentionsOf(pages.flat())
}

type CachedBoard = { at: number; order: string[] }

export async function boardOf($: Dollar, project: string): Promise<string[]> {
  const key = `board:${project}`
  const saved = (await $.store.get(key)) as CachedBoard | undefined
  const kept = saved !== undefined && Array.isArray(saved.order) ? saved : undefined
  if (kept && Date.now() - kept.at < BOARD_TTL_MS) return kept.order
  try {
    const order = boardOrder(JSON.parse(await run($, [`projects/${encodeURIComponent(project)}/boards`])) as RawBoard[])
    await $.store.set(key, { at: Date.now(), order } satisfies CachedBoard)

    return order
  } catch {
    return kept?.order ?? []
  }
}

export type Fetched = { issues: Raw[]; mrs: Raw[]; reviews: Raw[]; mentions: Mention[]; failures: { mrs: string; reviews: string; mentions: string } }

export async function fetchBoard($: Dollar): Promise<Fetched> {
  const [issues, mrs, reviews, mentions] = await Promise.all([
    listOf($, 'issues?scope=assigned_to_me&state=opened&per_page=100'),
    mrsOf($, 'assignedMergeRequests').then(
      found => ({ found, failure: '' }),
      cause => ({ found: [] as Raw[], failure: `merge requests: ${messageOf(cause)}` }),
    ),
    mrsOf($, 'reviewRequestedMergeRequests', REVIEW_STATES).then(
      found => ({ found, failure: '' }),
      cause => ({ found: [] as Raw[], failure: `review requests: ${messageOf(cause)}` }),
    ),
    pendingMentions($).then(
      found => ({ found, failure: '' }),
      cause => ({ found: [] as Mention[], failure: `mentions: ${messageOf(cause)}` }),
    ),
  ])

  return { issues, mrs: mrs.found, reviews: reviews.found, mentions: mentions.found, failures: { mrs: mrs.failure, reviews: reviews.failure, mentions: mentions.failure } }
}
