import { describe, expect, test } from 'claude-code/testing'
import { fileHref, linkify, MAX_GLOB_LINKS, type Entry, type Kind, type Lookup } from '../src/linkify'

const HOME = '/Users/me'
const CWD = '/Users/me/work/project'
const LONG = '/Users/me/work/project/src/server/handlers/very-long-handler-name.ts'

const FILES: Record<string, Kind> = {
  [LONG]: 'file',
  '/Users/me/work/project/README.md': 'file',
  '/Users/me/work/project/package.json': 'file',
  '/Users/me/work/project/src/x.ts': 'file',
  '/Users/me/work/project/src': 'dir',
  '/Users/me/work/other/README.md': 'file',
  '/Users/me/work/shared/types.ts': 'file',
  '/Users/me/notes/my file.md': 'file',
  '/Users/me/notes/tiếng việt.md': 'file',
  '/Users/me/work/project': 'dir',
  '/tmp/x.ts': 'file',
  '/tmp/x.ts.': 'file',
  '/tmp/a|b.ts': 'file',
  '/tmp/my': 'file',
  '/tmp/my file.ts': 'file',
  '/tmp/report': 'file',
  '/tmp/report:10:30': 'file',
  '/tmp/x.py': 'file',
  '/one/src/x.ts': 'file',
  '/two/src/x.ts': 'file',
  '/tmp/shots/2026-10-02-v4-a-dock.m3max.png': 'file',
  '/tmp/shots/2026-10-02-v4-a-final.m3max.png': 'file',
  '/tmp/shots/2026-10-02-v4-b-dock.m3max.png': 'file',
  '/tmp/shots/.hidden-v4-a-x.m3max.png': 'file',
  '/tmp/g/a.ts': 'file',
  '/tmp/g/b.ts': 'file',
  '/tmp/g/c.ts': 'file',
  '/tmp/g/linked.ts': 'file',
  '/tmp/g/sub': 'dir',
  '/tmp/g/sub/deep': 'dir',
  '/tmp/g/sub/d.ts': 'file',
  '/tmp/g/sub/deep/e.ts': 'file',
}

const LISTINGS: Record<string, Entry[]> = {
  '/tmp/shots': [
    { name: '2026-10-02-v4-a-final.m3max.png', kind: 'file' },
    { name: '2026-10-02-v4-a-dock.m3max.png', kind: 'file' },
    { name: '2026-10-02-v4-b-dock.m3max.png', kind: 'file' },
    { name: '.hidden-v4-a-x.m3max.png', kind: 'file' },
  ],
  '/tmp/many': Array.from({ length: MAX_GLOB_LINKS + 3 }, (_, i) => ({
    name: 'f' + String(i).padStart(2, '0') + '.log',
    kind: 'file' as const,
  })),
  '/tmp': [
    { name: 'x.ts', kind: 'file' },
    { name: 'z.ts', kind: 'file' },
  ],
  '/tmp/g': [
    { name: 'a.ts', kind: 'file' },
    { name: 'b.ts', kind: 'file' },
    { name: 'c.ts', kind: 'file' },
    { name: 'linked.ts', kind: 'other' },
    { name: 'dangling.ts', kind: 'other' },
    { name: 'sub', kind: 'dir' },
  ],
  '/tmp/g/sub': [
    { name: 'd.ts', kind: 'file' },
    { name: 'deep', kind: 'dir' },
  ],
  '/tmp/g/sub/deep': [{ name: 'e.ts', kind: 'file' }],
}

const known: Lookup = {
  home: HOME,
  cwd: CWD,
  kind: path => FILES[path] ?? 'none',
  list: dir => LISTINGS[dir] ?? [],
}

const run = (text: string): string => linkify(text, known).text

const link = (label: string, path: string): string => '[' + label + '](' + fileHref(path) + ')'

const unchanged = (text: string): void => {
  expect(run(text)).toBe(text)
}

describe('absolute and home paths', () => {
  test('a raw absolute path becomes a short-label link', () => {
    expect(run('See ' + LONG + ' now.')).toBe('See ' + link('very-long-handler-name.ts', LONG) + ' now.')
  })

  test('a path in inline code becomes a link and loses the backticks', () => {
    expect(run('Open `' + LONG + '` please')).toBe('Open ' + link('very-long-handler-name.ts', LONG) + ' please')
  })

  test('a home-relative path expands against HOME', () => {
    expect(run('Edit ~/work/project/README.md')).toBe('Edit ' + link('README.md', CWD + '/README.md'))
  })

  test('trailing punctuation stays outside the link', () => {
    expect(run('Done: /tmp/x.py.')).toBe('Done: ' + link('x.py', '/tmp/x.py') + '.')
    expect(run('(' + LONG + ')')).toBe('(' + link('very-long-handler-name.ts', LONG) + ')')
  })

  test('a space or non-ASCII name is percent-encoded in the href', () => {
    expect(run('`/Users/me/notes/my file.md`')).toBe('[my file.md](file:///Users/me/notes/my%20file.md)')
    expect(run('`/Users/me/notes/tiếng việt.md`')).toBe(link('tiếng việt.md', '/Users/me/notes/tiếng việt.md'))
    expect(fileHref('/a/b (1)#x?.md')).toBe('file:///a/b%20%281%29%23x%3F.md')
  })

  test('a missing path stays as written', () => {
    unchanged('and /nope/missing.ts here')
  })

  test('a folder gets a trailing slash in its label', () => {
    expect(run('in /Users/me/work/project/')).toBe('in ' + link('project/', CWD))
  })
})

describe('locations', () => {
  test('file:line and file:line:col stay in the label, out of the href', () => {
    expect(run('At ' + LONG + ':42:7, the bug')).toBe('At ' + link('very-long-handler-name.ts:42:7', LONG) + ', the bug')
  })

  test('a GitHub-style line anchor and range become a label location', () => {
    expect(run('/tmp/x.py#L10-L20')).toBe(link('x.py:10-20', '/tmp/x.py'))
    expect(run('/tmp/x.py#L7')).toBe(link('x.py:7', '/tmp/x.py'))
  })

  test('a compiler-style (line,col) suffix joins the label', () => {
    expect(run('src/x.ts(10,5): error TS2322')).toBe(link('x.ts:10:5', CWD + '/src/x.ts') + ': error TS2322')
  })

  test('grep output keeps its content after the link', () => {
    expect(run('/tmp/x.py:12:import os')).toBe(link('x.py:12', '/tmp/x.py') + ':import os')
    expect(run('/tmp/x.py:12:5:7')).toBe(link('x.py:12:5', '/tmp/x.py') + ':7')
  })

  test('a stack frame and a Python traceback link their file', () => {
    expect(run('at run (/tmp/x.ts:10:5)')).toBe('at run (' + link('x.ts:10:5', '/tmp/x.ts') + ')')
    expect(run('File "/tmp/x.py", line 3')).toBe('File "' + link('x.py', '/tmp/x.py') + '", line 3')
  })

  test('an existing literal name wins over a location reading', () => {
    expect(run('`/tmp/report:10:30`')).toBe(link('report:10:30', '/tmp/report:10:30'))
    expect(run('`/tmp/x.ts.`')).toBe(link('x.ts.', '/tmp/x.ts.'))
  })
})

describe('relative paths and bare names', () => {
  test('cwd-relative, dot and dot-dot paths resolve against the session cwd', () => {
    expect(run('Edit src/x.ts now')).toBe('Edit ' + link('x.ts', CWD + '/src/x.ts') + ' now')
    expect(run('Edit ./src/x.ts')).toBe('Edit ' + link('x.ts', CWD + '/src/x.ts'))
    expect(run('See ../shared/types.ts')).toBe('See ' + link('types.ts', '/Users/me/work/shared/types.ts'))
  })

  test('a bare filename links only when it sits in the cwd', () => {
    expect(run('Update package.json and README.md.')).toBe(
      'Update ' + link('package.json', CWD + '/package.json') + ' and ' + link('README.md', CWD + '/README.md') + '.',
    )
    unchanged('e.g. version 1.2 calls console.log and Node.js')
  })

  test('words with slashes, URLs and glued paths are not linked', () => {
    unchanged('and/or, 1/2, km/h, run /clear')
    unchanged('me@host:/tmp/x.ts pre-/tmp/x.ts é/tmp/x.ts key:/tmp/x.ts')
    unchanged('visit https://example.com/tmp/x.ts and example.com/src/x.ts')
  })

  test('a raw file URL becomes a short-label link', () => {
    expect(run('Open file:///tmp/my%20file.ts.')).toBe('Open ' + link('my file.ts', '/tmp/my file.ts') + '.')
    expect(run('<file:///tmp/x.ts>')).toBe(link('x.ts', '/tmp/x.ts'))
    unchanged('file:///tmp/missing.ts and file://otherhost/tmp/x.ts')
  })
})

describe('globs', () => {
  test('a glob expands into one link per visible match, sorted', () => {
    expect(run('Shots: `/tmp/shots/2026-10-02-v4-a-*.m3max.png`')).toBe(
      'Shots: ' +
        link('2026-10-02-v4-a-dock.m3max.png', '/tmp/shots/2026-10-02-v4-a-dock.m3max.png') +
        ', ' +
        link('2026-10-02-v4-a-final.m3max.png', '/tmp/shots/2026-10-02-v4-a-final.m3max.png'),
    )
  })

  test('a glob past the cap links the first ones and counts the rest', () => {
    const out = run('/tmp/many/*.log')
    expect(out.split('](file://').length - 1).toBe(MAX_GLOB_LINKS)
    expect(out.endsWith(' (+3 more)')).toBe(true)
  })

  test('a glob with no match stays as written', () => {
    unchanged('`/tmp/shots/*.jpg`')
  })

  test('a trailing ? stays part of the glob', () => {
    unchanged('/tmp/*.?')
  })

  test('braces, classes and recursive globs expand', () => {
    expect(run('/tmp/g/{a,c}.ts')).toBe(link('a.ts', '/tmp/g/a.ts') + ', ' + link('c.ts', '/tmp/g/c.ts'))
    expect(run('/tmp/g/[ab].ts')).toBe(link('a.ts', '/tmp/g/a.ts') + ', ' + link('b.ts', '/tmp/g/b.ts'))
    expect(run('/tmp/g/**/*.ts')).toBe(
      ['a.ts', 'b.ts', 'c.ts', 'linked.ts', 'sub/d.ts', 'sub/deep/e.ts']
        .map(name => link(name.slice(name.lastIndexOf('/') + 1), '/tmp/g/' + name))
        .join(', '),
    )
  })

  test('symlink entries are checked through stat', () => {
    expect(run('/tmp/g/*ed.ts')).toBe(link('linked.ts', '/tmp/g/linked.ts'))
  })
})

describe('markdown protection', () => {
  test('existing links, reference links and definitions are left alone', () => {
    unchanged('[keep](file://' + LONG + ') and [keep](https://example.com/(x)/tmp/x.ts)')
    unchanged('[/tmp/x.ts][ref] and [ref]\n\n[ref]: /tmp/x.ts')
    unchanged('[a\\]b](https://example.com) /tmp/missing')
  })

  test('HTML tags and comments are left alone', () => {
    unchanged('<a href="/tmp/x.ts">open</a> <!-- /tmp/x.ts --> <img src=/tmp/x.ts>')
  })

  test('fenced, quoted, listed and indented code is left alone', () => {
    unchanged('```sh\ncat /tmp/x.ts\n```')
    unchanged('> ```ts\n> /tmp/x.ts\n> ```')
    unchanged('> ~~~\n> /tmp/x.ts\n> ~~~')
    unchanged('- item\n  ```ts\n  /tmp/x.ts\n  ```')
    unchanged('text\n\n    /tmp/x.ts')
    unchanged('~~~\n/tmp/x.ts\n~~~')
  })

  test('a list continuation indented four spaces is prose, not code', () => {
    expect(run('1. step\n\n    /tmp/x.ts')).toBe('1. step\n\n    ' + link('x.ts', '/tmp/x.ts'))
  })

  test('an invalid backtick fence opener does not swallow prose', () => {
    expect(run('```text`not-a-fence\n\n/tmp/x.ts')).toBe('```text`not-a-fence\n\n' + link('x.ts', '/tmp/x.ts'))
  })

  test('multiline code spans and unclosed spans at the stream tail are left alone', () => {
    unchanged('`cat\n/tmp/x.ts`')
    unchanged('still typing `/tmp/x.ts')
  })

  test('inline code holding more than a path is left alone', () => {
    unchanged('`cat ' + LONG + '`')
  })

  test('emphasis markers stay around the link', () => {
    expect(run('**/tmp/x.ts**')).toBe('**' + link('x.ts', '/tmp/x.ts') + '**')
    expect(run('*/tmp/x.ts*.')).toBe('*' + link('x.ts', '/tmp/x.ts') + '*.')
  })

  test('a pipe in a label is escaped so tables keep their columns', () => {
    expect(run('| `/tmp/a|b.ts` | note |')).toBe('| [a\\|b.ts](file:///tmp/a%7Cb.ts) | note |')
  })

  test('a quoted path with a space links whole, never its prefix', () => {
    expect(run('"/tmp/my file.ts"')).toBe('"' + link('my file.ts', '/tmp/my file.ts') + '"')
    expect(run('/tmp/my\\ file.ts')).toBe(link('my file.ts', '/tmp/my file.ts'))
  })
})

describe('labels and idempotence', () => {
  test('clashing basenames grow until every label is unique', () => {
    expect(run('/Users/me/work/project/README.md vs /Users/me/work/other/README.md')).toBe(
      link('project/README.md', CWD + '/README.md') + ' vs ' + link('other/README.md', '/Users/me/work/other/README.md'),
    )
    expect(run('/one/src/x.ts /two/src/x.ts')).toBe(link('one/src/x.ts', '/one/src/x.ts') + ' ' + link('two/src/x.ts', '/two/src/x.ts'))
  })

  test('the transform is idempotent', () => {
    const text = [
      'A ' + LONG + ':3, `~/work/project/README.md`, /tmp/shots/*-dock.m3max.png',
      '**/tmp/x.ts** src/x.ts(1,2) "/tmp/my file.ts" | `/tmp/a|b.ts` |',
      '/one/src/x.ts /two/src/x.ts file:///tmp/x.ts /tmp/g/**/*.ts',
    ].join('\n')
    const once = run(text)
    expect(once).not.toBe(text)
    expect(run(once)).toBe(once)
  })

  test('unknown lookups are reported as pending and leave the text', () => {
    const result = linkify('x ' + LONG + ' /tmp/shots/*.png ~/a src/b.ts', {
      home: undefined,
      cwd: undefined,
      kind: () => undefined,
      list: () => undefined,
    })
    expect(result.text).toBe('x ' + LONG + ' /tmp/shots/*.png ~/a src/b.ts')
    expect(result.pending).toEqual({ kinds: [LONG, '/tmp/shots/*.png'], lists: [], home: true, cwd: true })
  })
})
