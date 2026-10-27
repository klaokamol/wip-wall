import type { Card, Mention, Setup } from '../types'
import { ageOf, cardOfMention, clip, dueOf, isDone, mrSummary, titleLines, widthOf } from './board'
import type { Flag } from './board'
import type { Dollar } from './gitlab'
import type { Place } from './sessions'
import type { Theme } from './themes'

type Els = ReturnType<Dollar['ui']['resolve']>

export const MARQUEE_STEP_MS = 250

const PLACES: Place[] = ['window', 'tab', 'split', 'here']

export type Act = {
  open: (card: Card) => unknown
  openAt: (card: Card, place: Place) => unknown
  cancel: () => unknown
  hide: (item: Pick<Card, 'key' | 'updated'>) => unknown
  restore: (key: string) => unknown
  web: (url: string) => unknown
  noHere: (card: Card) => unknown
  play: (key: string, chars: number) => unknown
}

export type Look = {
  els: Els
  theme: Theme
  width: number
  lineWidth: number
  now: number
  hereKey: string
  openKeys: string[]
  backKeys: string[]
  branched: string[]
  pinged: Set<string>
  chosen: string
  lastPlace: Place
  canHere: (card: Card) => boolean
  scrolling: string
  act: Act
}

type Item = { id: string; label: string; count?: number; color: string; on: boolean; press: () => unknown }

export const colorOf = (theme: Theme, status: string): string => (theme.colors as Record<string, string>)[status.toLowerCase()] ?? theme.faint

export function rowsOf<T>(list: T[], per: number): [T, ...T[]][] {
  const step = Math.max(1, Math.floor(per))

  return Array.from({ length: Math.ceil(list.length / step) }, (_, at) => list.slice(at * step, (at + 1) * step) as [T, ...T[]])
}

export function rule(look: Look, label: string, gap = true) {
  const { Box, Text } = look.els

  return (
    <Box marginTop={gap ? 1 : 0}>
      <Text color={look.theme.faint} wrap="truncate-end">
        {`── ${label} ${'─'.repeat(Math.max(0, look.lineWidth - widthOf(label) - 4))}`}
      </Text>
    </Box>
  )
}

export function foldRule(look: Look, label: string, key: string, isOpen: boolean, press: () => unknown) {
  const { Box, Text, Button } = look.els

  return (
    <Box columnGap={1} marginTop={1}>
      <Box flexShrink={1}>
        <Text color={look.theme.faint} wrap="truncate-end">{`── ${label} ${'─'.repeat(Math.max(0, look.lineWidth - widthOf(label) - 11))}`}</Text>
      </Box>
      <Button key={key} plain onPress={press}>
        <Text color={look.theme.muted}>{isOpen ? '[hide]' : '[show]'}</Text>
      </Button>
    </Box>
  )
}

const chipText = (label: string, count?: number) => (count === undefined ? `[${label}]` : `[${label}·${count}]`)

function chip(look: Look, c: { key: string; label: string; count?: number; color: string; isOn: boolean; keep: boolean; press: () => unknown }) {
  const { Text, Button } = look.els

  return c.count === 0 && !c.keep && !c.isOn && c.label !== 'all' ? null : c.isOn ? (
    <Text key={c.key} bold color={look.theme.ink} backgroundColor={c.color}>{chipText(c.label, c.count)}</Text>
  ) : (
    <Button key={c.key} plain onPress={c.press}>
      <Text color={c.color}>{chipText(c.label, c.count)}</Text>
    </Button>
  )
}

export function picker(look: Look, label: string, id: string, isOpen: boolean, setOpen: (open: boolean) => unknown, items: Item[], keep = false) {
  const { Box, Text, Button } = look.els
  const current = items.find(i => i.on) ?? items[0]
  const drawn = items.filter(i => keep || (i.count ?? 1) > 0 || i.on || i.label === 'all')
  const toggle = (i: Item) => (
    <Button key={`${id}:menu`} plain onPress={() => setOpen(!isOpen)}>
      <Text bold color={look.theme.ink} backgroundColor={i.color}>{chipText(i.label, i.count)}</Text>
    </Button>
  )

  return (
    <Box>
      <Box width={10} flexShrink={0}>
        <Text color={look.theme.muted}>{`${label.padEnd(7)} :`}</Text>
      </Box>
      <Box flexWrap="wrap" columnGap={1} flexShrink={1}>
        {current === undefined
          ? null
          : drawn.length === 1
            ? chip(look, { key: `${id}:${current.id}`, label: current.label, count: current.count, color: current.color, isOn: true, keep, press: current.press })
            : (isOpen ? drawn : [current]).flatMap(i => [
                i === current
                  ? toggle(i)
                  : chip(look, {
                      key: `${id}:${i.id}`,
                      label: i.label,
                      count: i.count,
                      color: i.color,
                      isOn: false,
                      keep,
                      press: async () => {
                        await i.press()
                        await setOpen(false)
                      },
                    }),
              ])}
        {!isOpen && drawn.length > 1 && <Text color={look.theme.faint}>{`+${drawn.length - 1} more`}</Text>}
      </Box>
    </Box>
  )
}

function chooser(look: Look, card: Card) {
  const { Box, Text, Button } = look.els
  const { muted: MUTED, faint: FAINT, text: TEXT } = look.theme
  const places = [look.lastPlace, ...PLACES.filter(p => p !== look.lastPlace)]

  return (
    <Box key={`choose:${card.key}`} columnGap={1}>
      <Text color={MUTED}>open:</Text>
      {places.map(place =>
        place === 'here' && !look.canHere(card) ? (
          <Button key={`choose:${card.key}:${place}`} plain onPress={() => look.act.noHere(card)}>
            <Text color={FAINT}>{`[${place}]`}</Text>
          </Button>
        ) : (
          <Button key={`choose:${card.key}:${place}`} plain onPress={() => look.act.openAt(card, place)}>
            <Text bold color={TEXT}>{`[${place}]`}</Text>
          </Button>
        ),
      )}
      <Button key={`choose:${card.key}:cancel`} plain onPress={() => look.act.cancel()}>
        <Text color={MUTED}>[×]</Text>
      </Button>
    </Box>
  )
}

function mrLine(look: Look, card: Card, tint: (color: string | undefined) => string | undefined) {
  const { Box, Text, Button } = look.els
  const { theme, width, now } = look
  const TONE = { good: theme.good, warn: theme.warn, bad: theme.bad, muted: theme.muted }
  const sum = mrSummary(card, width - 4, now)
  if (sum === undefined) return <Text> </Text>
  const more = sum.more > 0 && <Text key="more"><Text> · </Text><Text color={theme.muted}>{`+${sum.more} MR`}</Text></Text>
  const head = [
    sum.status !== '' && <Text key="status"> · </Text>,
    sum.status !== '' && <Text key="statusname" color={tint(colorOf(theme, sum.status))}>{sum.status}</Text>,
    ...sum.flags.flatMap(flag => [<Text key={`dot:${flag.text}`}> · </Text>, <Text key={flag.text} color={tint(TONE[flag.tone])}>{flag.text}</Text>]),
  ]
  const num = (
    <Button key={`mrweb:${card.key}`} plain hover={{ scope: `mrweb:${card.key}`, inverse: true }} onPress={() => look.act.web(sum.url)}>
      <Text bold color={tint(theme.text)}>{`MR !${sum.num}`}</Text>
    </Button>
  )
  if (!sum.cut) return (
    <Box key={`mrline:${card.key}`}>
      {num}
      <Text wrap="truncate-end">{head}{more}</Text>
    </Box>
  )
  const full = mrSummary(card, Infinity, now)
  const parts =
    full === undefined
      ? []
      : [
          { text: `MR !${full.num}`, color: tint(theme.text) },
          ...(full.status !== '' ? [{ text: ' · ' }, { text: full.status, color: tint(colorOf(theme, full.status)) }] : []),
          ...full.flags.flatMap(flag => [{ text: ' · ' }, { text: flag.text, color: tint(TONE[flag.tone]) }]),
          ...(full.more > 0 ? [{ text: ' · ' }, { text: `+${full.more} MR`, color: theme.muted }] : []),
        ]
  const chars = parts.reduce((n, part) => n + Array.from(part.text).length, 0)

  return look.scrolling === card.key && 'Client' in look.els ? (
    <look.els.Client key="marquee" module="./marquee.tsx" width={width - 4} height={1} props={{ parts, room: width - 4, step: MARQUEE_STEP_MS }} />
  ) : (
    <Box key={`cut:${card.key}`}>
      {num}
      <Text>{head}<Text key="sep"> · </Text></Text>
      <Button key={`mr:${card.key}`} plain onPress={() => look.act.play(card.key, chars)}>
        <Text color={theme.muted}>…</Text>
      </Button>
      {more}
    </Box>
  )
}

const markOf = (look: Look, card: Card): string =>
  card.key === look.hereKey ? '●' : look.openKeys.includes(card.key) ? '◉' : look.backKeys.includes(card.key) ? '◎' : '○'

type Part = { text: string; color: string | undefined }

const worstFlag = (card: Card, now: number): Flag | undefined => {
  const flags = mrSummary(card, Infinity, now)?.flags ?? []

  return flags.find(f => f.tone === 'bad') ?? flags.find(f => f.tone === 'warn') ?? flags.find(f => f.tone === 'good')
}

function tailOf(parts: Part[], els: Look['els']) {
  const { Text } = els

  return parts.flatMap((part, at) => [<Text key={`dot:${at}`}>{at === 0 ? '' : ' '}</Text>, <Text key={`part:${at}`} color={part.color}>{part.text}</Text>])
}

const widthOfParts = (parts: Part[]): number => parts.reduce((n, part) => n + 1 + widthOf(part.text), 0)

export function cardRow(look: Look, card: Card) {
  const { Box, Text, Button } = look.els
  const { theme, now } = look
  const color = colorOf(theme, card.status)
  const label = card.status
  const TONE = { good: theme.good, warn: theme.warn, bad: theme.bad, muted: theme.muted }
  const flag = worstFlag(card, now)
  const mrUrl = mrSummary(card, Infinity, now)?.url
  const due = card.due !== '' && !isDone(card.status) ? dueOf(card.due, now) : undefined
  const parts: Part[] = [
    ...(card.by ? [{ text: card.by, color: theme.text }] : []),
    ...(look.pinged.has(card.key) ? [{ text: '@', color: theme.warn }] : []),
    ...(due ? [{ text: due.text, color: TONE[due.tone] }] : []),
    ...(look.branched.includes(card.key) ? [{ text: '↓', color: theme.muted }] : []),
  ]
  const title = clip(`${card.kind === 'issue' ? '#' : '!'}${card.num} ${card.title}`, Math.max(8, look.lineWidth - 9 - widthOf(label) - (mrUrl === undefined ? 0 : 3) - widthOfParts(parts) - 2))

  return (
    <Box key={`row:${card.key}`} flexDirection="column">
      <Box>
        {card.key === look.hereKey && 'Client' in look.els ? (
          <look.els.Client key="pulse" module="./pulse.tsx" width={2} height={1} props={{ color }} />
        ) : (
          <Text color={color}>{`${markOf(look, card)} `}</Text>
        )}
        <Box flexGrow={1}>
          <Button key={`open:${card.key}:0`} plain hover={{ scope: `title:${card.key}`, inverse: true }} onPress={() => look.act.open(card)}>
            <Text bold>{title}</Text>
          </Button>
        </Box>
        <Text> </Text>
        {mrUrl !== undefined && (
          <Button key={`mrweb:${card.key}`} plain hover={{ scope: `mrweb:${card.key}`, inverse: true }} onPress={() => look.act.web(mrUrl)}>
            <Text color={flag ? TONE[flag.tone] : theme.muted}>MR</Text>
          </Button>
        )}
        {mrUrl !== undefined && <Text> </Text>}
        {parts.length > 0 && <Text>{tailOf(parts, look.els)}</Text>}
        {parts.length > 0 && <Text> </Text>}
        {label !== '' && (
          <Button key={`web:${card.key}`} plain onPress={() => look.act.web(card.url)}>
            <Text color={color}>{label}</Text>
          </Button>
        )}
        {label !== '' && <Text> </Text>}
        <Text color={theme.muted}>{`${ageOf(card.updated, now).padStart(3)} `}</Text>
        <Button key={`hide:${card.key}`} plain onPress={() => look.act.hide(card)}>
          <Text color={theme.muted}>✕</Text>
        </Button>
      </Box>
      {look.chosen === card.key && chooser(look, card)}
    </Box>
  )
}

export function cardView(look: Look, card: Card, restored = false) {
  const { Box, Text, Button } = look.els
  const { theme, width, now } = look
  const { muted: MUTED, warn: WARN, bad: BAD } = theme
  const tint = (color: string | undefined) => (restored ? MUTED : color)

  return (
    <Box
      key={card.key}
      flexDirection="column"
      width={width}
      borderStyle="round"
      borderColor={tint(colorOf(theme, card.status))}
      paddingX={1}
    >
      <Box columnGap={1}>
        <Box flexDirection="column" flexGrow={1}>
          {titleLines(`${card.kind === 'issue' ? '#' : '!'}${card.num} ${card.title}`, width - 8).map((line, at) => (
            <Button key={`open:${card.key}:${at}`} plain hover={{ scope: `title:${card.key}`, inverse: true }} onPress={() => look.act.open(card)}>
              <Text bold color={tint(undefined)}>{line + ' '.repeat(Math.max(0, width - 8 - widthOf(line)))}</Text>
            </Button>
          ))}
        </Box>
        <Box columnGap={1} alignSelf="flex-start">
          <Button key={`${restored ? 'restore' : 'hide'}:${card.key}`} plain onPress={() => (restored ? look.act.restore(card.key) : look.act.hide(card))}>
            <Text color={MUTED}>{restored ? '↩' : '✕'}</Text>
          </Button>
        </Box>
      </Box>
      <Box>
        {card.key === look.hereKey && 'Client' in look.els ? (
          <look.els.Client key="pulse" module="./pulse.tsx" width={2} height={1} props={{ color: tint(colorOf(theme, card.status)) }} />
        ) : (
          <Text color={tint(colorOf(theme, card.status))}>{markOf(look, card)} </Text>
        )}
        <Button key={`web:${card.key}`} plain onPress={() => look.act.web(card.url)}>
          <Text color={tint(colorOf(theme, card.status))}>{card.status}</Text>
        </Button>
        <Text wrap="truncate-end">
          <Text> · </Text>
          {card.by ? <Text key="by" color={tint(theme.text)}>{`${card.by} · `}</Text> : null}
          <Text color={MUTED}>{ageOf(card.updated, now)}</Text>
          {look.branched.includes(card.key) && <Text key="branch:dot"> · </Text>}
          {look.branched.includes(card.key) && <Text key="branch" color={MUTED}>↓</Text>}
          {look.pinged.has(card.key) && <Text key="mention:dot"> · </Text>}
          {look.pinged.has(card.key) && <Text key="mention" color={tint(WARN)}>@</Text>}
          {card.due !== '' && !isDone(card.status) && <Text key="due:dot"> · </Text>}
          {card.due !== '' && !isDone(card.status) && <Text key="due" color={tint({ bad: BAD, warn: WARN, muted: MUTED }[dueOf(card.due, now).tone])}>{dueOf(card.due, now).text}</Text>}
        </Text>
      </Box>
      {look.chosen === card.key && !restored ? chooser(look, card) : mrLine(look, card, tint)}
    </Box>
  )
}

export function mentionRow(look: Look, m: Mention) {
  const { Box, Text, Button } = look.els
  const { theme, now } = look
  const by = `@ ${m.by}`
  const age = ` ${ageOf(m.updated, now)} `
  const title = clip(`${m.kind === 'issue' ? '#' : '!'}${m.num} ${m.title}`, Math.max(8, look.lineWidth - widthOf(by) - widthOf(age) - 4))

  return (
    <Box key={`row:${m.key}`} flexDirection="column">
      <Box>
        <Button key={`note:${m.key}`} plain onPress={() => look.act.web(m.noteUrl)}>
          <Text color={theme.warn}>{by}</Text>
        </Button>
        <Text> </Text>
        <Box flexGrow={1}>
          <Button key={`open:${m.key}:0`} plain hover={{ scope: `title:${m.key}`, inverse: true }} onPress={() => look.act.open(cardOfMention(m))}>
            <Text bold>{title}</Text>
          </Button>
        </Box>
        <Text color={theme.muted}>{age}</Text>
        <Button key={`hide:${m.key}`} plain onPress={() => look.act.hide(m)}>
          <Text color={theme.muted}>✕</Text>
        </Button>
      </Box>
      {look.chosen === m.ref && chooser(look, cardOfMention(m))}
    </Box>
  )
}

export function mentionView(look: Look, m: Mention, restored = false) {
  const { Box, Text, Button } = look.els
  const { muted: MUTED, faint: FAINT, warn: WARN } = look.theme
  const { width, now } = look

  return (
    <Box key={m.key} flexDirection="column" width={width} borderStyle="round" borderColor={restored ? MUTED : FAINT} paddingX={1}>
      <Box columnGap={1}>
        <Box flexDirection="column" flexGrow={1}>
          {titleLines(`${m.kind === 'issue' ? '#' : '!'}${m.num} ${m.title}`, width - 8).map((line, at) => (
            <Button key={`open:${m.key}:${at}`} plain hover={{ scope: `title:${m.key}`, inverse: true }} onPress={() => look.act.open(cardOfMention(m))}>
              <Text bold color={restored ? MUTED : undefined}>{line + ' '.repeat(Math.max(0, width - 8 - widthOf(line)))}</Text>
            </Button>
          ))}
        </Box>
        <Box alignSelf="flex-start">
          <Button key={`${restored ? 'restore' : 'hide'}:${m.key}`} plain onPress={() => (restored ? look.act.restore(m.key) : look.act.hide(m))}>
            <Text color={MUTED}>{restored ? '↩' : '✕'}</Text>
          </Button>
        </Box>
      </Box>
      <Box>
        <Button key={`note:${m.key}`} plain onPress={() => look.act.web(m.noteUrl)}>
          <Text color={restored ? MUTED : WARN}>{`@ ${m.by}`}</Text>
        </Button>
        <Text color={MUTED}>{` · ${ageOf(m.updated, now)}`}</Text>
      </Box>
      {look.chosen === m.ref && !restored ? chooser(look, cardOfMention(m)) : <Text color={MUTED} wrap="truncate-end">{m.body === '' ? ' ' : m.body}</Text>}
    </Box>
  )
}

export function setupView(look: Look, setup: Setup, clones: number, act: { root: (path: string) => unknown; close: () => unknown }) {
  const { Box, Text, Button } = look.els
  const { theme } = look

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box columnGap={1}>
        <Box flexShrink={1}>
          <Text color={theme.faint} wrap="truncate-end">{`── Setup ${'─'.repeat(Math.max(0, look.lineWidth - 16))}`}</Text>
        </Box>
        <Button key="setup:close" plain onPress={act.close}>
          <Text color={theme.muted}>[done]</Text>
        </Button>
      </Box>
      {setup.checks.map(check => (
        <Box key={`setup:${check.label}`} columnGap={1}>
          <Text bold color={check.ok ? theme.good : theme.bad}>{check.ok ? '✓' : '✗'}</Text>
          <Box flexShrink={1}>
            <Text color={theme.text}>{`${check.label}  `}</Text>
            <Text color={theme.muted}>{check.clones && check.ok ? `${check.note} · ${clones} ${clones === 1 ? 'clone' : 'clones'} matched` : check.note}</Text>
          </Box>
        </Box>
      ))}
      {setup.roots.length > 0 && <Text color={theme.faint}>{'clone folder: press one, or run /wip-wall setup <folder>'}</Text>}
      {setup.roots.map((path, n) => (
        <Button key={`setup:root:${n}`} plain onPress={() => act.root(path)}>
          <Text color={path === setup.root ? theme.text : theme.muted} bold={path === setup.root}>{`${path === setup.root ? '◉' : '○'} ${path}`}</Text>
        </Button>
      ))}
    </Box>
  )
}
