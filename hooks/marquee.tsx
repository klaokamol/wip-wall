import type { ClientModule } from 'claude-code'

type Part = { text: string; color?: string }
type Props = { parts: Part[]; room: number; step: number }
type Ref = { at: number }
type State = { ref: Ref }

const GAP = [{ ch: ' ' }, { ch: ' ' }, { ch: ' ' }]

const Marquee: ClientModule<Props, State> = (props, surface) => {
  const { Text } = surface.elements
  const ref = surface.state?.ref ?? { at: 0 }
  const loop: { ch: string; color?: string }[] = [
    ...props.parts.flatMap(part => Array.from(part.text).map(ch => ({ ch, color: part.color }))),
    ...GAP,
  ]
  if (surface.state === undefined) {
    surface.setState({ ref })
    const stop = surface.every(props.step, () => {
      ref.at += 1
      if (ref.at >= loop.length) {
        ref.at = 0
        stop()
      }
      surface.setState({ ref })
    })
  }

  const shown = Array.from({ length: props.room }, (_, i) => loop[(ref.at + i) % loop.length] ?? { ch: ' ' })
  const runs: { text: string; color?: string }[] = []
  for (const cell of shown) {
    const last = runs[runs.length - 1]
    if (last !== undefined && last.color === cell.color) last.text += cell.ch
    else runs.push({ text: cell.ch, color: cell.color })
  }

  return (
    <Text wrap="truncate-end">
      {runs.map((run, i) => (
        <Text key={String(i)} color={run.color}>
          {run.text}
        </Text>
      ))}
    </Text>
  )
}

export default Marquee
