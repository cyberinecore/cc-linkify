import { describe, expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const FILES: Record<string, 'file' | 'dir'> = {
  '/Users/me/work/project/README.md': 'file',
  '/Users/me/work/project/src/x.ts': 'file',
  '/tmp/shots/2026-10-02-v4-b-dock.m3max.png': 'file',
  '/tmp/g/linked.ts': 'file',
}

const LISTINGS: Record<string, { name: string; kind: 'file' | 'dir' | 'other' }[]> = {
  '/tmp/shots': [
    { name: '2026-10-02-v4-a-dock.m3max.png', kind: 'file' },
    { name: '2026-10-02-v4-b-dock.m3max.png', kind: 'file' },
  ],
  '/tmp/g': [
    { name: 'linked.ts', kind: 'other' },
    { name: 'dangling.ts', kind: 'other' },
  ],
}

const world = (on: On, options: { cwd?: string } = {}) => {
  on('fs.stat', ($, e) => {
    const kind = FILES[e.path]
    if (kind === undefined) return { deny: 'ENOENT: ' + e.path }
    return { value: { kind, size: 1, mtimeMs: 0, isLink: false } }
  })
  on('fs.exists', ($, e) => ({ value: FILES[e.path] !== undefined || LISTINGS[e.path] !== undefined }))
  on('fs.list', ($, e) => {
    const entries = LISTINGS[e.path]
    if (entries === undefined) return { deny: 'ENOENT: ' + e.path }
    return { value: entries.map(entry => ({ ...entry, size: 1, mtimeMs: 0, isLink: entry.kind === 'other' })) }
  })
  on('session.cwd', () => ({ value: options.cwd ?? '/Users/me/work/project' }))
  const drawn: { text: string; onScreen: unknown }[] = []
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    drawn.push({ text: e.props.text, onScreen: e.props.onScreen })
    return { type: 'Text', props: {}, children: [e.props.text] }
  })
  return drawn
}

const message = (text: string, onScreen: unknown = null) => ({
  surface: 'terminal' as const,
  component: 'AssistantMessage' as const,
  requestId: 'msg-1',
  props: { text, isFirstOfReply: true, onScreen: onScreen as null },
})

describe('linkify hook', () => {
  test('rewrites an AssistantMessage through the engine and keeps onScreen', async ($, on) => {
    mock.env(on, { HOME: '/Users/me' })
    const drawn = world(on)
    const onScreen = { first: 0, last: 3, of: 4 }
    await $.ui.render(message('See `~/work/project/README.md`, src/x.ts:4 and /tmp/shots/*-v4-b-*.png', onScreen))
    expect(drawn).toEqual([
      {
        text:
          'See [README.md](file:///Users/me/work/project/README.md), ' +
          '[x.ts:4](file:///Users/me/work/project/src/x.ts) and ' +
          '[2026-10-02-v4-b-dock.m3max.png](file:///tmp/shots/2026-10-02-v4-b-dock.m3max.png)',
        onScreen,
      },
    ])
  })

  test('a failing HOME read still links absolute paths and leaves ~ alone', async ($, on) => {
    on('env.get', () => ({ deny: 'no environment' }))
    const drawn = world(on)
    await $.ui.render(message('~/work/project/README.md and /tmp/g/linked.ts'))
    expect(drawn[0]?.text).toBe('~/work/project/README.md and [linked.ts](file:///tmp/g/linked.ts)')
  })

  test('symlink entries in a glob are stat-checked and dangling ones dropped', async ($, on) => {
    mock.env(on, { HOME: '/Users/me' })
    const drawn = world(on)
    await $.ui.render(message('/tmp/g/*.ts'))
    expect(drawn[0]?.text).toBe('[linked.ts](file:///tmp/g/linked.ts)')
  })

  test('text with nothing to link is passed through untouched', async ($, on) => {
    mock.env(on, { HOME: '/Users/me' })
    const drawn = world(on)
    await $.ui.render(message('Nothing here, and/or /nope/missing.ts.'))
    expect(drawn[0]?.text).toBe('Nothing here, and/or /nope/missing.ts.')
  })
})
