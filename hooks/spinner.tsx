import type { ClientModule } from 'claude-code'

type Props = { color: string }
type Ref = { frame: number }
type State = { ref: Ref }

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const STEP_MS = 80

const Spinner: ClientModule<Props, State> = (props, surface) => {
  const { Text } = surface.elements
  const ref = surface.state?.ref ?? { frame: 0 }
  if (surface.state === undefined) {
    surface.setState({ ref })
    surface.every(STEP_MS, () => {
      ref.frame = (ref.frame + 1) % FRAMES.length
      surface.setState({ ref })
    })
  }

  return <Text color={props.color}>{FRAMES[ref.frame]}</Text>
}

export default Spinner
