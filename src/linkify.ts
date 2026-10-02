export type Kind = 'file' | 'dir' | 'none'

export type EntryKind = 'file' | 'dir' | 'other'

export type Entry = {
  name: string
  kind: EntryKind
}

export type Lookup = {
  home: string | undefined
  cwd: string | undefined
  kind: (path: string) => Kind | undefined
  list: (dir: string) => readonly Entry[] | undefined
}

export type Pending = {
  kinds: string[]
  lists: string[]
  home: boolean
  cwd: boolean
}

export type LinkifyResult = {
  text: string
  pending: Pending
}

export const MAX_GLOB_LINKS = 10
export const MAX_GLOB_DEPTH = 4
export const MAX_GLOB_DIRS = 64
export const MAX_BRACE_EXPANSIONS = 32

type Target = {
  path: string
  kind: 'file' | 'dir'
}

type Item = {
  targets: Target[]
  more: number
  location: string
  after: string
}

type Piece = string | Item

type Run = {
  lookup: Lookup
  pending: Pending
  defs: ReadonlySet<string>
}

type Unit = {
  raw: string
  dec: string
}

type Found = {
  targets: Target[]
  more: number
}

const UNKNOWN = 'unknown'

type Resolution = Found | typeof UNKNOWN | undefined

const QUOTE_PREFIX = /^(?:[ ]{0,3}>[ ]?)+/
const LIST_ITEM = /^[ \t]*(?:[-+*]|\d{1,9}[.)])(?:[ \t]+|$)/
const FENCE_OPEN = /^(`{3,}|~{3,})(.*)$/
const FENCE_CLOSE = /^(`{3,}|~{3,})[ \t]*$/
const REFERENCE_DEF = /^[ ]{0,3}\[((?:[^\]\\\n]|\\.)+)\]:[ \t]*\S/
const LEADING_SPACE = /^[ \t]*/
const BLANK_LINE = /\n[ \t]*\n/
const NEXT_LINE_BLANK = /^[ \t]*(?:\n|$)/
const SCHEME = /[A-Za-z][A-Za-z0-9+.-]{1,31}:\/\//y
const AUTOLINK = /<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/y
const HTML_COMMENT = /<!--[\s\S]*?-->/y
const HTML_TAG = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/y
const PAREN_LOCATION = /\((\d+)(?:,\s?(\d+))?\)/y
const HASH_LOCATION = /^(.+?)#L(\d+)(?:C(\d+))?(?:-L?(\d+)(?:C\d+)?)?$/
const COLON_LOCATION = /^(.+?)(:\d+(?::\d+)?)(?=:|$)/
const FILE_URL = /^file:\/\/([^/]*)(\/.*)$/i
const BARE_NAME = /^[\p{L}\p{N}_@+-][\p{L}\p{N}_@.+-]*\.[A-Za-z][A-Za-z0-9]{0,9}$/u
const RELATIVE_SHAPE = /^(?:\.{1,2}\/|[\p{L}\p{N}_@.-][^\s]*\/)/u
const TOKEN_START = /[\p{L}\p{N}_@~./]/u
const WHITESPACE = /\s/
const ESCAPABLE = /[ !-/:-@[-`{-~]/
const TRAILING_PUNCT = '.,:;!?'
const BOUNDARY_BEFORE = '([{*_|>,;"\''
const TOKEN_STOP = '`"\'<>|(),;]}'
const GLOB_CHARS = /[*?[{]/
const GLOB_SEGMENT = /[*?[]/
const LABEL_SPECIALS = /[\\`*_[\]<>|]/g

const decOf = (units: readonly Unit[]): string => units.map(u => u.dec).join('')

const rawOf = (units: readonly Unit[]): string => units.map(u => u.raw).join('')

const baseOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

const joinPath = (dir: string, name: string): string => (dir === '/' ? '/' + name : dir + '/' + name)

const normalizePath = (path: string): string => {
  const parts: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return '/' + parts.join('/')
}

const encodeSegment = (segment: string): string =>
  encodeURIComponent(segment).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase())

export const fileHref = (path: string): string => 'file://' + path.split('/').map(encodeSegment).join('/')

const escapeLabel = (label: string): string => label.replace(LABEL_SPECIALS, '\\$&')

const normLabel = (label: string): string => label.trim().replace(/\s+/g, ' ').toLowerCase()

const isBoundary = (prev: string | undefined): boolean =>
  prev === undefined || WHITESPACE.test(prev) || BOUNDARY_BEFORE.includes(prev)

const kindOf = (run: Run, path: string): Kind | undefined => {
  const kind = run.lookup.kind(path)
  if (kind === undefined) run.pending.kinds.push(path)
  return kind
}

const listOf = (run: Run, dir: string): readonly Entry[] | undefined => {
  const entries = run.lookup.list(dir)
  if (entries === undefined) run.pending.lists.push(dir)
  return entries
}

const absolutize = (run: Run, path: string): string | typeof UNKNOWN | undefined => {
  if (path.startsWith('//') || path.includes('://')) return undefined
  if (path.startsWith('/')) return normalizePath(path)
  if (path === '~' || path.startsWith('~/')) {
    if (run.lookup.home === undefined) {
      run.pending.home = true
      return UNKNOWN
    }
    return normalizePath(run.lookup.home + path.slice(1))
  }
  if (path.startsWith('~')) return undefined
  if (!RELATIVE_SHAPE.test(path) && !BARE_NAME.test(path)) return undefined
  if (run.lookup.cwd === undefined) {
    run.pending.cwd = true
    return UNKNOWN
  }
  return normalizePath(run.lookup.cwd + '/' + path)
}

const segmentRegExp = (segment: string): RegExp => {
  let body = '^'
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i] ?? ''
    if (c === '*') {
      body += '[^/]*'
      continue
    }
    if (c === '?') {
      body += '[^/]'
      continue
    }
    if (c === '[') {
      const close = segment.indexOf(']', i + 2)
      if (close > i) {
        let inner = segment.slice(i + 1, close)
        const negated = inner.startsWith('!') || inner.startsWith('^')
        if (negated) inner = inner.slice(1)
        body += '[' + (negated ? '^' : '') + inner.replace(/[\\\]^]/g, '\\$&') + ']'
        i = close
        continue
      }
    }
    body += c.replace(/[\\^$.|+()[\]{}*?]/g, '\\$&')
  }
  try {
    return new RegExp(body + '$', 'u')
  } catch {
    return /(?!)/
  }
}

const expandBraces = (pattern: string): string[] => {
  const open = pattern.indexOf('{')
  if (open < 0) return [pattern]
  let depth = 0
  let close = -1
  const commas: number[] = []
  for (let i = open; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) {
        close = i
        break
      }
    } else if (c === ',' && depth === 1) commas.push(i)
  }
  if (close < 0 || commas.length === 0) return [pattern]
  const head = pattern.slice(0, open)
  const tail = pattern.slice(close + 1)
  const out: string[] = []
  let from = open + 1
  for (const cut of [...commas, close]) {
    for (const expanded of expandBraces(head + pattern.slice(from, cut) + tail)) {
      out.push(expanded)
      if (out.length >= MAX_BRACE_EXPANSIONS) return out
    }
    from = cut + 1
  }
  return out
}

const entryKind = (run: Run, dir: string, entry: Entry): Kind | undefined =>
  entry.kind === 'other' ? kindOf(run, joinPath(dir, entry.name)) : entry.kind

const walkGlob = (run: Run, pattern: string): Target[] | typeof UNKNOWN => {
  const segments = pattern.split('/').filter(Boolean)
  let dirs = ['/']
  let budget = MAX_GLOB_DIRS
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index] ?? ''
    const isLast = index === segments.length - 1
    if (segment === '**') {
      if (isLast) return []
      const reached: string[] = []
      let frontier = dirs
      for (let depth = 0; frontier.length > 0; depth++) {
        reached.push(...frontier)
        if (depth === MAX_GLOB_DEPTH) break
        const next: string[] = []
        for (const dir of frontier) {
          if (budget-- <= 0) break
          const entries = listOf(run, dir)
          if (entries === undefined) return UNKNOWN
          for (const entry of entries) {
            if (entry.name.startsWith('.')) continue
            const kind = entryKind(run, dir, entry)
            if (kind === undefined) return UNKNOWN
            if (kind === 'dir') next.push(joinPath(dir, entry.name))
          }
        }
        frontier = next
      }
      dirs = reached
      continue
    }
    if (!GLOB_SEGMENT.test(segment)) {
      if (!isLast) {
        dirs = dirs.map(dir => joinPath(dir, segment))
        continue
      }
      const out: Target[] = []
      for (const dir of dirs) {
        const full = joinPath(dir, segment)
        const kind = kindOf(run, full)
        if (kind === undefined) return UNKNOWN
        if (kind !== 'none') out.push({ path: full, kind })
      }
      return out
    }
    const matcher = segmentRegExp(segment)
    const showsHidden = segment.startsWith('.')
    const next: string[] = []
    const out: Target[] = []
    for (const dir of dirs) {
      if (budget-- <= 0) break
      const entries = listOf(run, dir)
      if (entries === undefined) return UNKNOWN
      for (const entry of entries) {
        if ((!showsHidden && entry.name.startsWith('.')) || !matcher.test(entry.name)) continue
        const kind = entryKind(run, dir, entry)
        if (kind === undefined) return UNKNOWN
        if (kind === 'none') continue
        if (isLast) out.push({ path: joinPath(dir, entry.name), kind })
        else if (kind === 'dir') next.push(joinPath(dir, entry.name))
      }
    }
    if (isLast) return out
    dirs = next
  }
  return []
}

const expandGlob = (run: Run, pattern: string): Resolution => {
  const found = new Map<string, Target>()
  let isUnknown = false
  for (const expanded of expandBraces(pattern)) {
    const targets = walkGlob(run, expanded)
    if (targets === UNKNOWN) isUnknown = true
    else for (const target of targets) found.set(target.path, target)
  }
  if (isUnknown) return UNKNOWN
  if (found.size === 0) return undefined
  const sorted = [...found.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return { targets: sorted.slice(0, MAX_GLOB_LINKS), more: Math.max(0, sorted.length - MAX_GLOB_LINKS) }
}

const resolvePath = (run: Run, path: string, allowsGlob: boolean): Resolution => {
  const absolute = absolutize(run, path)
  if (absolute === UNKNOWN) return UNKNOWN
  if (absolute === undefined || absolute === '/') return undefined
  const kind = kindOf(run, absolute)
  if (kind === undefined) return UNKNOWN
  if (kind !== 'none') return { targets: [{ path: absolute, kind }], more: 0 }
  if (!allowsGlob || !GLOB_CHARS.test(path)) return undefined
  return expandGlob(run, absolute)
}

type Match = Found & {
  location: string
  used: number
  rest: string
}

const rawSuffix = (units: readonly Unit[], decodedLength: number): string => {
  let seen = 0
  for (let i = 0; i < units.length; i++) {
    if (seen >= decodedLength) return rawOf(units.slice(i))
    seen += units[i]?.dec.length ?? 0
  }
  return ''
}

const stripTrailing = (units: readonly Unit[]): number => {
  let end = units.length
  while (end > 0) {
    const unit = units[end - 1]
    if (unit === undefined || unit.raw.length !== 1 || !TRAILING_PUNCT.includes(unit.dec)) break
    if (unit.dec === '?') {
      const before = decOf(units.slice(0, end - 1))
      if (before.includes('*') || before.endsWith('.') || before.endsWith('/')) break
    }
    end--
  }
  return end
}

const matchUnits = (run: Run, units: readonly Unit[], isCode: boolean): Match | typeof UNKNOWN | undefined => {
  const stripped = stripTrailing(units)
  const lengths = stripped === units.length ? [units.length] : [units.length, stripped]
  for (const length of lengths) {
    if (length === 0) continue
    const variant = units.slice(0, length)
    const text = decOf(variant)
    const literal = resolvePath(run, text, true)
    if (literal === UNKNOWN) return UNKNOWN
    if (literal !== undefined) return { ...literal, location: '', used: length, rest: '' }
    const hash = HASH_LOCATION.exec(text)
    if (hash !== null) {
      const found = resolvePath(run, hash[1] ?? '', false)
      if (found === UNKNOWN) return UNKNOWN
      if (found !== undefined) {
        const location = ':' + hash[2] + (hash[3] === undefined ? '' : ':' + hash[3]) + (hash[4] === undefined ? '' : '-' + hash[4])
        return { ...found, location, used: length, rest: '' }
      }
    }
    const colon = COLON_LOCATION.exec(text)
    if (colon !== null) {
      const head = colon[1] ?? ''
      const location = colon[2] ?? ''
      const restLength = text.length - head.length - location.length
      if (isCode && restLength > 0) continue
      const found = resolvePath(run, head, false)
      if (found === UNKNOWN) return UNKNOWN
      if (found !== undefined) {
        return { ...found, location, used: length, rest: rawSuffix(variant, head.length + location.length) }
      }
    }
  }
  return undefined
}

const readUnits = (s: string, start: number): { units: Unit[]; end: number } => {
  const units: Unit[] = []
  let i = start
  while (i < s.length) {
    const c = s[i] ?? ''
    if (c === '\\') {
      const next = s[i + 1]
      if (next === undefined || !ESCAPABLE.test(next)) break
      units.push({ raw: c + next, dec: next })
      i += 2
      continue
    }
    if (c === '[' || c === '{') {
      const close = c === '[' ? ']' : '}'
      let j = i + 1
      while (j < s.length && j < i + 200) {
        const d = s[j] ?? ''
        if (d === close || d === c || WHITESPACE.test(d) || d === '`') break
        j++
      }
      if (s[j] !== close) break
      for (let k = i; k <= j; k++) units.push({ raw: s[k] ?? '', dec: s[k] ?? '' })
      i = j + 1
      continue
    }
    if (WHITESPACE.test(c) || TOKEN_STOP.includes(c)) break
    units.push({ raw: c, dec: c })
    i++
  }
  return { units, end: i }
}

const looksLinkable = (text: string): boolean =>
  text.includes('/') || BARE_NAME.test(text) || text.startsWith('~')

const resolveFileUrl = (run: Run, url: string): Found | typeof UNKNOWN | undefined => {
  const parts = FILE_URL.exec(url)
  if (parts === null) return undefined
  const host = (parts[1] ?? '').toLowerCase()
  if (host !== '' && host !== 'localhost') return undefined
  let path: string
  try {
    path = decodeURIComponent(parts[2] ?? '')
  } catch {
    return undefined
  }
  return resolvePath(run, path, false)
}

const balancedUrlEnd = (url: string): number => {
  let end = url.length
  while (end > 0) {
    const c = url[end - 1] ?? ''
    if (TRAILING_PUNCT.includes(c)) {
      end--
      continue
    }
    if (c === ')') {
      const head = url.slice(0, end)
      if (head.split('(').length < head.split(')').length) {
        end--
        continue
      }
    }
    break
  }
  return end
}

const matchBracket = (s: string, open: number): number => {
  let depth = 0
  for (let i = open; i < s.length && i < open + 1000; i++) {
    const c = s[i]
    if (c === '\\') {
      i++
      continue
    }
    if (c === '\n' && s[i + 1] === '\n') return -1
    if (c === '[') depth++
    else if (c === ']') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

const matchParen = (s: string, open: number): number => {
  let depth = 0
  let inAngle = false
  for (let i = open; i < s.length && i < open + 2000; i++) {
    const c = s[i]
    if (c === '\\') {
      i++
      continue
    }
    if (c === '\n') return -1
    if (inAngle) {
      if (c === '>') inAngle = false
      continue
    }
    if (c === '<' && i === open + 1) inAngle = true
    else if (c === '(') depth++
    else if (c === ')') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

const findCloser = (s: string, from: number, length: number): number => {
  let i = from
  while (i < s.length) {
    const c = s[i]
    if (c === '\n' && NEXT_LINE_BLANK.test(s.slice(i + 1, i + 65))) return -1
    if (c !== '`') {
      i++
      continue
    }
    let end = i
    while (s[end] === '`') end++
    if (end - i === length) return i
    i = end
  }
  return -1
}

const codeUnits = (inner: string): Unit[] | undefined => {
  if (inner.includes('\n')) return undefined
  const text = inner.trim()
  if (text === '') return undefined
  const isAnchored = text.startsWith('/') || text.startsWith('~')
  if (!isAnchored && WHITESPACE.test(text)) return undefined
  if (!looksLinkable(text)) return undefined
  return [...text].map(c => ({ raw: c, dec: c }))
}

const itemOf = (found: Found, location: string, after: string): Item => ({
  targets: found.targets,
  more: found.more,
  location,
  after,
})

const scanProse = (s: string, run: Run, isStreamTail: boolean): Piece[] => {
  const pieces: Piece[] = []
  let from = 0
  let i = 0
  const replace = (start: number, end: number, item: Item, keepBefore = '') => {
    if (start > from) pieces.push(s.slice(from, start))
    if (keepBefore !== '') pieces.push(keepBefore)
    pieces.push(item)
    from = end
  }
  while (i < s.length) {
    const c = s[i] ?? ''
    const prev = i === 0 ? undefined : s[i - 1]
    if (c === '\\') {
      i += 2
      continue
    }
    if (c === '`') {
      let runEnd = i
      while (s[runEnd] === '`') runEnd++
      const length = runEnd - i
      const close = findCloser(s, runEnd, length)
      if (close < 0) {
        if (isStreamTail && !BLANK_LINE.test(s.slice(i))) {
          i = s.length
          break
        }
        i = runEnd
        continue
      }
      const end = close + length
      const units = codeUnits(s.slice(runEnd, close))
      if (units !== undefined) {
        const url = decOf(units)
        if (url.toLowerCase().startsWith('file://')) {
          const found = resolveFileUrl(run, url)
          if (found !== undefined && found !== UNKNOWN) replace(i, end, itemOf(found, '', ''))
        } else {
          const match = matchUnits(run, units, true)
          if (match !== undefined && match !== UNKNOWN) {
            replace(i, end, itemOf(match, match.location, rawOf(units.slice(match.used))))
          }
        }
      }
      i = end
      continue
    }
    if (c === '<') {
      AUTOLINK.lastIndex = i
      const auto = AUTOLINK.exec(s)
      if (auto !== null) {
        const end = i + auto[0].length
        const target = auto[1] ?? ''
        if (target.toLowerCase().startsWith('file://')) {
          const found = resolveFileUrl(run, target)
          if (found !== undefined && found !== UNKNOWN) replace(i, end, itemOf(found, '', ''))
        }
        i = end
        continue
      }
      HTML_COMMENT.lastIndex = i
      const comment = HTML_COMMENT.exec(s)
      if (comment !== null) {
        i += comment[0].length
        continue
      }
      HTML_TAG.lastIndex = i
      const tag = HTML_TAG.exec(s)
      if (tag !== null) {
        i += tag[0].length
        continue
      }
      i++
      continue
    }
    if (c === '[' || (c === '!' && s[i + 1] === '[')) {
      const open = c === '!' ? i + 1 : i
      const close = matchBracket(s, open)
      if (close > 0) {
        const next = s[close + 1]
        if (next === '(') {
          const end = matchParen(s, close + 1)
          if (end > 0) {
            i = end + 1
            continue
          }
        } else if (next === '[') {
          const end = matchBracket(s, close + 1)
          if (end > 0) {
            i = end + 1
            continue
          }
        } else if (run.defs.has(normLabel(s.slice(open + 1, close)))) {
          i = close + 1
          continue
        }
      }
      i = open + 1
      continue
    }
    if (!isBoundary(prev)) {
      i++
      continue
    }
    if (c === '"' || c === "'") {
      const lineEnd = s.indexOf('\n', i + 1)
      const close = s.indexOf(c, i + 1)
      const inner = close > i ? s.slice(i + 1, close) : ''
      const isPathQuote =
        close > i + 1 &&
        (lineEnd < 0 || close < lineEnd) &&
        (inner.startsWith('/') || inner.startsWith('~/') || inner.startsWith('./') || inner.startsWith('../'))
      if (isPathQuote) {
        const units = [...inner].map(ch => ({ raw: ch, dec: ch }))
        const match = matchUnits(run, units, true)
        if (match !== undefined && match !== UNKNOWN) {
          replace(i + 1, close, itemOf(match, match.location, rawOf(units.slice(match.used))))
        }
        i = close + 1
        continue
      }
      i++
      continue
    }
    SCHEME.lastIndex = i
    if (SCHEME.test(s)) {
      let end = i
      while (end < s.length && !WHITESPACE.test(s[end] ?? '') && !'<>"`'.includes(s[end] ?? '')) end++
      const url = s.slice(i, end)
      if (url.toLowerCase().startsWith('file://')) {
        const urlEnd = balancedUrlEnd(url)
        const found = resolveFileUrl(run, url.slice(0, urlEnd))
        if (found !== undefined && found !== UNKNOWN) replace(i, i + urlEnd, itemOf(found, '', ''))
      }
      i = end
      continue
    }
    if (!TOKEN_START.test(c)) {
      i++
      continue
    }
    const { units, end } = readUnits(s, i)
    if (units.length === 0) {
      i++
      continue
    }
    if (!looksLinkable(decOf(units)) && !looksLinkable(decOf(units.slice(0, stripTrailing(units))))) {
      i = end
      continue
    }
    let opener = 0
    const wrap = prev === '*' || prev === '_' ? prev : ''
    if (wrap !== '') {
      while (i - opener - 1 >= 0 && s[i - opener - 1] === wrap) opener++
    }
    let core = units
    let wrapper = ''
    if (opener > 0) {
      const cut = stripTrailing(units)
      const closing = units.slice(cut - opener, cut)
      if (cut - opener > 0 && closing.length === opener && closing.every(u => u.raw === wrap)) {
        core = units.slice(0, cut - opener)
        wrapper = rawOf(units.slice(cut - opener))
      }
    }
    const match = matchUnits(run, core, false)
    if (match === undefined || match === UNKNOWN) {
      i = end
      continue
    }
    const tail = rawOf(core.slice(match.used))
    let location = match.location
    let consumed = end
    if (location === '' && match.rest === '' && tail === '' && wrapper === '') {
      PAREN_LOCATION.lastIndex = end
      const paren = PAREN_LOCATION.exec(s)
      if (paren !== null) {
        location = ':' + paren[1] + (paren[2] === undefined ? '' : ':' + paren[2])
        consumed = end + paren[0].length
      }
    }
    replace(i, consumed, itemOf(match, location, match.rest + tail + wrapper))
    i = consumed
  }
  if (from < s.length) pieces.push(s.slice(from))
  return pieces
}

type Block = {
  text: string
  isCode: boolean
}

const indentWidth = (line: string): number => {
  let width = 0
  for (const c of line) {
    if (c === ' ') width++
    else if (c === '\t') width += 4 - (width % 4)
    else break
  }
  return width
}

const splitBlocks = (text: string): { blocks: Block[]; defs: Set<string> } => {
  const blocks: Block[] = []
  const defs = new Set<string>()
  let lines: string[] = []
  let isCode = false
  let fence: { char: string; length: number } | undefined
  let isInList = false
  let wasBlank = true
  let wasIndented = false
  const push = (line: string, code: boolean) => {
    if (lines.length > 0 && code !== isCode) {
      blocks.push({ text: lines.join('\n'), isCode })
      lines = []
    }
    isCode = code
    lines.push(line)
  }
  for (const line of text.split('\n')) {
    const quote = QUOTE_PREFIX.exec(line)?.[0] ?? ''
    const rest = line.slice(quote.length)
    if (fence !== undefined) {
      push(line, true)
      const close = FENCE_CLOSE.exec(rest.trimStart())
      if (close !== null && (close[1] ?? '')[0] === fence.char && (close[1] ?? '').length >= fence.length) fence = undefined
      wasBlank = false
      continue
    }
    if (rest.trim() === '') {
      push(line, false)
      wasBlank = true
      wasIndented = false
      continue
    }
    let content = rest
    let isItem = false
    for (let item = LIST_ITEM.exec(content); item !== null && item[0] !== ''; item = LIST_ITEM.exec(content)) {
      content = content.slice(item[0].length)
      isItem = true
    }
    if (isItem) isInList = true
    const body = content.slice((LEADING_SPACE.exec(content)?.[0] ?? '').length)
    const open = FENCE_OPEN.exec(body)
    if (open !== null) {
      const marker = open[1] ?? ''
      if (!(marker.startsWith('`') && (open[2] ?? '').includes('`'))) {
        fence = { char: marker[0] ?? '`', length: marker.length }
        push(line, true)
        wasBlank = false
        continue
      }
    }
    const width = indentWidth(rest)
    if (!isItem && !isInList && width >= 4 && (wasBlank || wasIndented)) {
      push(line, true)
      wasBlank = false
      wasIndented = true
      continue
    }
    if (!isItem && width === 0 && quote === '') isInList = false
    const def = REFERENCE_DEF.exec(rest)
    if (def !== null) {
      defs.add(normLabel(def[1] ?? ''))
      push(line, true)
      wasBlank = false
      wasIndented = false
      continue
    }
    push(line, false)
    wasBlank = false
    wasIndented = false
  }
  if (lines.length > 0) blocks.push({ text: lines.join('\n'), isCode })
  return { blocks, defs }
}

const suffixOf = (path: string, depth: number): string => path.split('/').filter(Boolean).slice(-depth).join('/')

const labelsFor = (paths: Iterable<string>): Map<string, string> => {
  const byBase = new Map<string, Set<string>>()
  for (const path of paths) {
    const group = byBase.get(baseOf(path)) ?? new Set<string>()
    group.add(path)
    byBase.set(baseOf(path), group)
  }
  const labels = new Map<string, string>()
  for (const group of byBase.values()) {
    const members = [...group]
    for (const path of members) {
      const depthLimit = path.split('/').filter(Boolean).length
      let depth = 1
      while (depth < depthLimit && members.some(other => other !== path && suffixOf(other, depth) === suffixOf(path, depth))) depth++
      labels.set(path, suffixOf(path, depth))
    }
  }
  return labels
}

const renderItem = (item: Item, labels: ReadonlyMap<string, string>): string => {
  const links = item.targets.map(target => {
    const label = (labels.get(target.path) ?? baseOf(target.path)) + (target.kind === 'dir' ? '/' : '') + item.location
    return '[' + escapeLabel(label) + '](' + fileHref(target.path) + ')'
  })
  const more = item.more > 0 ? ' (+' + item.more + ' more)' : ''
  return links.join(', ') + more + item.after
}

export const linkify = (text: string, lookup: Lookup): LinkifyResult => {
  const pending: Pending = { kinds: [], lists: [], home: false, cwd: false }
  if (!text.includes('/') && !text.includes('.')) return { text, pending }
  const { blocks, defs } = splitBlocks(text)
  const run: Run = { lookup, pending, defs }
  const scanned = blocks.map((block, index) =>
    block.isCode ? [block.text] : scanProse(block.text, run, index === blocks.length - 1),
  )
  const paths = new Set<string>()
  for (const pieces of scanned) {
    for (const piece of pieces) {
      if (typeof piece !== 'string') for (const target of piece.targets) paths.add(target.path)
    }
  }
  const labels = labelsFor(paths)
  const rewritten = scanned
    .map(pieces => pieces.map(piece => (typeof piece === 'string' ? piece : renderItem(piece, labels))).join(''))
    .join('\n')
  return {
    text: rewritten,
    pending: {
      kinds: [...new Set(pending.kinds)],
      lists: [...new Set(pending.lists)],
      home: pending.home,
      cwd: pending.cwd,
    },
  }
}
