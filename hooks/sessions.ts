import type { Card } from '../types'
import { clean, tabTitleOf } from './board'
import { settingsOf } from './gitlab'
import type { Dollar } from './gitlab'

export type Place = 'window' | 'tab' | 'split' | 'here'

type Session = { sid: string; tab: string; in?: Place; at?: number; prev?: string; by?: 'branch' }

export type CardStatus = { open: string[]; resumable: string[]; mine: string }

const LAUNCH_GRACE_MS = 60 * 1000

const NEW_TERMINAL = `on run argv
tell application "Ghostty"
set cfg to new surface configuration from {initial working directory:(item 1 of argv), initial input:(item 2 of argv)}
if (item 4 of argv) is "split" and (count of windows) > 0 then
set t to selected tab of front window
split (focused terminal of t) direction right with configuration cfg
return id of t
else if (item 4 of argv) is "tab" and (count of windows) > 0 then
set t to new tab in front window with configuration cfg
else
set t to selected tab of (new window with configuration cfg)
end if
try
perform action ("set_tab_title:" & (item 3 of argv)) on (focused terminal of t)
end try
return id of t
end tell
end run`

const SELECT_TAB = `on run argv
tell application "Ghostty"
repeat with wid in (get id of windows)
set w to first window whose id is (contents of wid)
if (get id of tabs of w) contains (item 1 of argv) then
select tab (first tab of w whose id is (item 1 of argv))
activate window w
return "ok"
end if
end repeat
return "gone"
end tell
end run`

const FOCUS_CWD = `on run argv
tell application "Ghostty"
set hits to every terminal whose working directory is (item 1 of argv)
if (count of hits) is 1 then
focus (item 1 of hits)
return "ok"
end if
if (count of hits) is 0 then return "gone"
return "many"
end tell
end run`

async function savedSessions($: Dollar): Promise<Map<string, number>> {
  const { sessions } = await settingsOf($)
  const found = await $.process.run(['find', sessions, '-maxdepth', '2', '-name', '*.jsonl', '-exec', 'stat', '-f', '%m %N', '{}', '+'])
  if (found.exitCode !== 0) throw new Error(`find exit ${found.exitCode}`)

  return new Map(
    found.stdout
      .split('\n')
      .map(line => /^(\d+) .*\/([^/]+)\.jsonl$/.exec(line))
      .filter(hit => hit !== null)
      .map(hit => [hit[2] ?? '', Number(hit[1])] as const),
  )
}

const resumeOf = (session: Session, saved: Map<string, number>): string | undefined =>
  [session.sid, session.prev ?? '']
    .filter(sid => saved.has(sid))
    .sort((a, b) => (saved.get(b) ?? 0) - (saved.get(a) ?? 0))[0]

const LIVE_SESSIONS = `d="\${CLAUDE_CONFIG_DIR:-$HOME/.claude}/sessions"
for f in "$d"/*.json; do
p=\${f##*/}; p=\${p%.json}
case $p in ''|*[!0-9]*) continue;; esac
s=$(TZ=UTC ps -o lstart= -p "$p") || continue
printf '%s\\t' "$s"; tr -d '\\n' < "$f"; echo
done`

const squeeze = (text: unknown): string => String(text).trim().replace(/\s+/g, ' ')

type Live = { sid: string; pid: number; cwd: string }

async function liveSessions($: Dollar): Promise<Live[]> {
  const ran = await $.process.run(['sh', '-c', LIVE_SESSIONS])

  return ran.stdout.split('\n').flatMap(line => {
    const [started = '', ...rest] = line.split('\t')
    try {
      const file = JSON.parse(rest.join('\t')) as { sessionId?: unknown; procStart?: unknown; pid?: unknown; cwd?: unknown }
      return typeof file.sessionId === 'string' && squeeze(file.procStart) === squeeze(started) ? [{ sid: file.sessionId, pid: Number(file.pid) || 0, cwd: typeof file.cwd === 'string' ? file.cwd : '' }] : []
    } catch {
      return []
    }
  })
}

async function runningSids($: Dollar): Promise<Set<string>> {
  const [ran, live] = await Promise.all([$.process.run(['ps', '-axww', '-o', 'command=']), liveSessions($).catch(() => [])])
  if (ran.exitCode !== 0) throw new Error(`ps exit ${ran.exitCode}`)

  return new Set([...ran.stdout.split(/\s+/).filter(Boolean), ...live.map(l => l.sid)])
}

const isFresh = (session: Session | undefined): boolean => Date.now() - (session?.at ?? 0) <= LAUNCH_GRACE_MS

export async function cardStatus($: Dollar, canWrite: () => boolean): Promise<CardStatus> {
  const [running, saved, sid] = await Promise.all([runningSids($), savedSessions($), $.session.id()])
  const open: string[] = []
  const resumable: string[] = []
  let mine = ''
  for (const key of (await $.store.keys()).filter(k => k.startsWith('card:'))) {
    const session = (await $.store.get(key)) as Session | undefined
    if (!session) continue
    const card = key.slice('card:'.length)
    if (session.sid === sid || session.prev === sid) mine = card
    if (running.has(session.sid)) open.push(card)
    else if (resumeOf(session, saved)) resumable.push(card)
    else if (!isFresh(session) && session.sid !== sid && canWrite()) await $.store.delete(key)
  }

  return { open, resumable, mine }
}

export async function claimCard($: Dollar, card: Card): Promise<void> {
  const sid = await $.session.id()
  const running = await runningSids($).catch(() => new Set<string>())
  const saved = await savedSessions($).catch(() => new Map<string, number>())
  let kept: string | undefined
  const stale: string[] = []
  for (const key of (await $.store.keys()).filter(k => k.startsWith('card:'))) {
    const session = (await $.store.get(key)) as Session | undefined
    if (!session) continue
    if (key === `card:${card.key}`) {
      if (session.sid === sid || session.prev === sid || running.has(session.sid) || (isFresh(session) && !resumeOf(session, saved))) return
      kept = resumeOf(session, saved)
    } else if (session.in === 'here' && session.sid === sid) {
      if (session.by !== 'branch') return
      stale.push(key)
    }
  }
  for (const key of stale) await $.store.delete(key)
  await $.store.set(`card:${card.key}`, { sid, tab: '', in: 'here', at: Date.now(), prev: kept, by: 'branch' } satisfies Session)
}

export async function releaseBranchCard($: Dollar): Promise<void> {
  const sid = await $.session.id()
  for (const key of (await $.store.keys()).filter(k => k.startsWith('card:'))) {
    const session = (await $.store.get(key)) as Session | undefined
    if (session?.by === 'branch' && session.sid === sid) await $.store.delete(key)
  }
}

export async function pruneCardSessions($: Dollar, canWrite: () => boolean, onBoard: Set<string>) {
  const running = await runningSids($)
  for (const key of (await $.store.keys()).filter(k => k.startsWith('card:') && !onBoard.has(k.slice('card:'.length)))) {
    const session = (await $.store.get(key)) as Session | undefined
    if (!canWrite() || (session && (running.has(session.sid) || isFresh(session)))) continue
    await $.store.delete(key)
  }
}

export async function isCardWindow($: Dollar): Promise<boolean> {
  const sid = await $.session.id()
  for (const key of (await $.store.keys()).filter(k => k.startsWith('card:'))) {
    const session = (await $.store.get(key)) as Session | undefined
    if (session?.sid === sid) return session.in === 'window' || session.in === undefined
  }

  return false
}

export async function focusRunning($: Dollar, card: Card): Promise<boolean> {
  const known = (await $.store.get(`card:${card.key}`)) as Session | undefined
  if (!known) return false
  const running = await runningSids($).catch(() => undefined)
  if (!running) {
    $.ui.toast('Cannot check which Claude sessions run: press the card again')

    return true
  }
  if (!running.has(known.sid)) return false
  const picked = known.tab === '' ? undefined : await $.process.run(['osascript', '-e', SELECT_TAB, known.tab], { timeoutMs: 5000 }).catch(() => undefined)
  if (known.tab !== '' && !picked) {
    $.ui.toast('Ghostty did not answer: allow it in System Settings, Privacy and Security, Automation')

    return true
  }
  if (picked?.stdout.trim() === 'ok') return true
  const live = (await liveSessions($).catch(() => [])).find(l => l.sid === known.sid)
  const byCwd = live && live.cwd !== '' ? await $.process.run(['osascript', '-e', FOCUS_CWD, live.cwd], { timeoutMs: 5000 }).catch(() => undefined) : undefined
  if (byCwd?.stdout.trim() === 'ok') return true
  const tty = live ? (await $.process.run(['ps', '-o', 'tty=', '-p', String(live.pid)]).catch(() => undefined))?.stdout.trim() : ''
  const where = live ? ` (pid ${live.pid}${tty ? `, ${clean(tty)}` : ''})` : ''
  $.ui.toast(
    byCwd?.stdout.trim() === 'many'
      ? `This card's Claude runs${where} in a folder with several Ghostty terminals: switch to it there`
      : `This card's Claude runs${where} in a terminal Ghostty does not list (a quick terminal, another app or a hidden window): switch to it there`,
  )

  return true
}

export async function openCardSession($: Dollar, card: Card, cwd: string, place: Place): Promise<boolean> {
  const known = (await $.store.get(`card:${card.key}`)) as Session | undefined
  const prev = known && resumeOf(known, await savedSessions($).catch(() => new Map<string, number>()))
  if (place === 'here') {
    const resume = prev !== undefined && prev !== (await $.session.id())
    const done = await $.prompt.fill(resume ? { text: `/resume ${prev}`, mode: 'replace' } : { text: card.url, mode: 'append' })
    if (!done.isFilled) {
      $.ui.toast('The prompt box is busy: close the dialog and press the card again')
      return false
    }
    if (resume) return false
    const sid = await $.session.id()
    for (const key of (await $.store.keys()).filter(k => k.startsWith('card:'))) {
      const other = (await $.store.get(key)) as Session | undefined
      if (other?.in === 'here' && other.sid === sid) await $.store.delete(key)
    }
    await $.store.set(`card:${card.key}`, { sid, tab: '', in: 'here', at: Date.now() } satisfies Session)

    return true
  }
  const sid = (!prev && known?.sid) || (await $.process.run(['uuidgen'])).stdout.trim().toLowerCase()
  const input = `claude --session-id ${sid}\n${prev ? `/resume ${prev}` : card.url}`
  await $.store.set(`card:${card.key}`, { sid, tab: known?.tab ?? '', in: place, at: Date.now(), prev } satisfies Session)
  const made = await $.process.run(['osascript', '-e', NEW_TERMINAL, cwd, input, tabTitleOf(card), place])
  if (made.exitCode !== 0) {
    if (known) await $.store.set(`card:${card.key}`, known)
    else await $.store.delete(`card:${card.key}`)
    $.ui.toast(clean(made.stderr).trim() || 'Ghostty refused the new terminal')

    return false
  }
  await $.store.set(`card:${card.key}`, { sid, tab: made.stdout.trim(), in: place, at: Date.now(), prev } satisfies Session)

  return true
}
