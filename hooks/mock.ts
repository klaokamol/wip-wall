import type { Card, Mention, MrRef } from '../types'

const hours = (n: number) => new Date(Date.now() - n * 3600000).toISOString()
const day = (offset: number) => new Date(Date.now() + offset * 86400000).toLocaleDateString('sv')
const base = { group: 'qa', repo: 'test-card', project: 'qa/test-card', url: 'https://example.invalid' }
const mr = (num: number, status: string, extra: Partial<MrRef> = {}): MrRef => ({
  num,
  status,
  url: `https://example.invalid/mr/${num}`,
  pipeline: '',
  conflict: false,
  draft: false,
  threads: false,
  ...extra,
})
const issue = (num: number, title: string, status: string, extra: Partial<Card> = {}): Card => ({
  ...base,
  key: `qa/test-card#${num}`,
  kind: 'issue',
  num,
  title,
  status,
  updated: hours(2),
  due: '',
  mrs: [],
  ...extra,
})

const STATUSES = [
  'Backlog',
  'To Do',
  'Doing',
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
  'Done',
]

const elsewhere = (repo: string, num: number, title: string, status: string, extra: Partial<Card> = {}): Card => ({
  ...base,
  group: 'acme-team',
  repo,
  project: `acme-team/${repo}`,
  key: `acme-team/${repo}#${num}`,
  kind: 'issue',
  num,
  title,
  status,
  updated: hours(3),
  due: '',
  mrs: [],
  ...extra,
})

const OTHER_GROUP: Card[] = [
  elsewhere('web', 51, 'Another project, first repo', 'Doing'),
  elsewhere('web', 52, 'Same repo, other status', 'Testing', { mrs: [mr(152, 'Testing', { pipeline: 'success' })] }),
  elsewhere('acme-team-api-gateway', 53, 'Repo name that repeats its project', 'To Do'),
  elsewhere('acme-team-api-gateway', 54, 'Waiting on release', 'Ready to Release', { due: day(5) }),
]

export const MOCK: Card[] = [
  ...STATUSES.map((status, i) => issue(i + 1, `Status sample: ${status}`, status, { updated: hours(i * 30) })),
  issue(21, 'Local branch exists', 'Doing', { updated: hours(1) }),
  issue(22, 'Session open in a tab', 'Doing', { updated: hours(1) }),
  issue(23, 'Session can be resumed', 'Doing', { updated: hours(1) }),
  issue(28, 'Claude here runs on this card', 'Doing', { updated: hours(1), mrs: [mr(128, 'Doing', { pipeline: 'running' })] }),
  issue(49, 'Session open in a tab and a local branch', 'Doing', { updated: hours(1) }),
  issue(50, 'Session can be resumed and a local branch', 'Doing', { updated: hours(1) }),
  issue(24, 'Due in 3 days', 'Doing', { due: day(3) }),
  issue(25, 'Due today', 'Doing', { due: day(0) }),
  issue(26, 'Two days late', 'Doing', { due: day(-2) }),
  issue(27, 'Very long title that cannot fit on one line of a forty column card and must be cut', 'Doing'),
  issue(31, 'MR pipeline passed', 'Doing', { mrs: [mr(131, 'Doing', { pipeline: 'success' })] }),
  issue(32, 'MR pipeline failed', 'Doing', { mrs: [mr(132, 'Doing', { pipeline: 'failed' })] }),
  issue(33, 'MR pipeline running', 'Doing', { mrs: [mr(133, 'Doing', { pipeline: 'running' })] }),
  issue(34, 'MR pipeline pending', 'Doing', { mrs: [mr(134, 'Doing', { pipeline: 'pending' })] }),
  issue(35, 'MR draft', 'Doing', { mrs: [mr(135, 'Doing', { draft: true })] }),
  issue(36, 'MR conflict', 'Doing', { mrs: [mr(136, 'Doing', { conflict: true })] }),
  issue(37, 'MR open threads', 'Doing', { mrs: [mr(137, 'Doing', { threads: true })] }),
  issue(38, 'MR with every flag', 'Doing', { due: day(-1), mrs: [mr(138, 'Doing', { draft: true, pipeline: 'failed', conflict: true, threads: true })] }),
  issue(43, 'MR needs rebase', 'Doing', { mrs: [mr(143, 'Doing', { merge: 'need_rebase' })] }),
  issue(44, 'MR waiting review', 'Testing', { mrs: [mr(144, 'Testing', { pipeline: 'success', merge: 'not_approved', unreviewed: true })] }),
  issue(45, 'MR ready to merge', 'Ready to Merge', { mrs: [mr(145, 'Ready to Merge', { pipeline: 'success', merge: 'mergeable', approved: true })] }),
  issue(46, 'MR has a reply', 'Doing', { mrs: [mr(146, 'Doing', { reply: true, pipeline: 'running' })] }),
  issue(47, 'MR stale and blocked', 'Doing', { mrs: [mr(147, 'Doing', { merge: 'blocked_status', updated: hours(24 * 10) })] }),
  issue(48, 'MR with the longest flag line', 'Doing', {
    mrs: [mr(148, 'Testing', { pipeline: 'failed', conflict: true, reply: true, merge: 'need_rebase', draft: true, threads: true, approved: true, unreviewed: true, updated: hours(24 * 10) })],
  }),
  issue(29, 'MR needs the pipeline to pass', 'Doing', { mrs: [mr(129, 'Doing', { pipeline: 'running', merge: 'ci_must_pass' })] }),
  issue(30, 'MR checking its merge status', 'Doing', { mrs: [mr(130, 'Doing', { pipeline: 'success', merge: 'checking' })] }),
  issue(41, 'MR pipeline created', 'Doing', { mrs: [mr(149, 'Doing', { pipeline: 'created' })] }),
  issue(39, 'MR without status label', 'Doing', { mrs: [mr(139, '')] }),
  issue(40, 'Three MRs on one issue', 'Testing', {
    mrs: [mr(140, 'Testing', { pipeline: 'success' }), mr(141, 'Ready to Merge', { pipeline: 'running' }), mr(142, 'Doing', { draft: true })],
  }),
  ...OTHER_GROUP,
  { ...base, key: 'qa/test-card!150', kind: 'mr', num: 150, title: 'MR with no issue', status: 'Testing', updated: hours(4), due: '', mrs: [] },
]

const mention = (kind: 'issue' | 'mr', num: number, title: string, by: string, body: string, ago: number, repo = 'mentioned'): Mention => {
  const ref = `qa/${repo}${kind === 'issue' ? '#' : '!'}${num}`

  return {
    key: `@${ref}`,
    ref,
    kind,
    project: `qa/${repo}`,
    group: 'qa',
    repo,
    num,
    title,
    url: `https://example.invalid/${ref}`,
    noteUrl: `https://example.invalid/${ref}#note_1`,
    updated: hours(ago),
    by,
    body,
  }
}

export const MOCK_MENTIONS: Mention[] = [
  mention('issue', 24, 'Due in 3 days', 'alex.m', 'is this still on track', 1, 'test-card'),
  mention('issue', 901, 'Question on an issue nobody assigned you', 'jamie.r', 'can you check the rollout order before friday', 3),
  mention('mr', 902, 'Review wanted on a merge request from another team with a very long title that must wrap', 'a-very-long-username.with.dots', 'please look at the migration', 30),
]

export const MOCK_LOCAL = ['qa/test-card#21', 'qa/test-card#28', 'qa/test-card#38', 'qa/test-card#49', 'qa/test-card#50']
export const MOCK_LIVE = ['qa/test-card#22', 'qa/test-card#49']
export const MOCK_RESUMABLE = ['qa/test-card#23', 'qa/test-card#50']
export const MOCK_HERE = 'qa/test-card#28'
export const MOCK_REVIEWS: Card[] = [
  { ...base, key: 'qa/test-card!61', kind: 'mr', num: 61, title: 'Review: retry the upload when the token expires', status: 'review', updated: hours(1), due: '', mrs: [mr(61, 'review', { pipeline: 'success' })] },
  { ...base, key: 'qa/test-card!62', kind: 'mr', num: 62, title: 'Review: cache the board between sessions', status: 'review', updated: hours(3), due: '', by: 'alex', mrs: [mr(62, 'review', { pipeline: 'failed' })] },
  { ...base, key: 'qa/test-card!63', kind: 'mr', num: 63, title: 'Review: move the legend into the header', status: 'Testing', updated: hours(30), due: '', by: 'jamie.r', mrs: [mr(63, 'Testing', { pipeline: 'success', threads: true })] },
  { ...base, key: 'qa/test-card!64', kind: 'mr', num: 64, title: 'Review: draw cards as one row each', status: 'review', updated: hours(200), due: '', by: 'sam.k', mrs: [mr(64, 'review', { draft: true })] },
]
