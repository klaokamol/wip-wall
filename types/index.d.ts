export type MrRef = { num: number; status: string; url: string; pipeline: string; conflict: boolean; draft: boolean; threads: boolean; merge?: string; approved?: boolean; unreviewed?: boolean; reply?: boolean; updated?: string }

export type Card = {
  key: string
  kind: 'issue' | 'mr'
  project: string
  group: string
  repo: string
  num: number
  title: string
  url: string
  status: string
  updated: string
  due: string
  mrs: MrRef[]
  by?: string
}

export type Mention = {
  key: string
  ref: string
  kind: 'issue' | 'mr'
  project: string
  group: string
  repo: string
  num: number
  title: string
  url: string
  noteUrl: string
  updated: string
  by: string
  body: string
}

export type SetupCheck = { label: string; ok: boolean; note: string; clones?: true }

export type Setup = { checks: SetupCheck[]; roots: string[]; root: string }

declare module 'claude-code' {
  interface PluginState {
    'wip-wall': {
      cards: Card[]
      mentions: Mention[]
      mentionsOpen: boolean
      reviews: Card[]
      reviewsOpen: boolean
      legendOpen: boolean
      compact: boolean
      latest: boolean
      dismissedOpen: boolean
      folded: string[]
      tab: string
      group: string
      groupMenu: boolean
      repoMenu: boolean
      statusMenu: boolean
      dateMenu: boolean
      sortMenu: boolean
      boards: Record<string, string[]>
      status: string
      date: string
      theme: string
      dirs: Record<string, string>
      local: string[]
      error: string
      loadedAt: number
      live: string[]
      resumable: string[]
      hidden: Record<string, string>
      marquee: string
      openIn: string
      here: string
      choosing: string
      cwd: string
      setup: Setup
    }
  }
}
