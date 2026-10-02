import type { EngineInterface, Register } from 'claude-code'
import { linkify, type Entry, type Kind, type Lookup } from '../src/linkify'

const TTL_MS = 30_000
const RETRY_MS = 2_000
const MAX_KINDS = 4000
const MAX_LISTS = 200
const MAX_ROUNDS = 6
const MAX_PARALLEL = 16

type Cached<T> = { value: T; until: number }

type Fetched<T> = { value: T; ttl: number }

const kinds = new Map<string, Cached<Kind>>()
const lists = new Map<string, Cached<readonly Entry[]>>()
const kindJobs = new Map<string, Promise<Kind>>()
const listJobs = new Map<string, Promise<readonly Entry[]>>()

const cached = <T>(cache: Map<string, Cached<T>>, key: string): T | undefined => {
  const hit = cache.get(key)
  if (hit === undefined) return undefined
  cache.delete(key)
  if (Date.now() >= hit.until) return undefined
  cache.set(key, hit)
  return hit.value
}

const remember = <T>(cache: Map<string, Cached<T>>, key: string, fetched: Fetched<T>, limit: number): T => {
  cache.delete(key)
  while (cache.size >= limit) {
    const oldest = cache.keys().next()
    if (oldest.done === true) break
    cache.delete(oldest.value)
  }
  cache.set(key, { value: fetched.value, until: Date.now() + fetched.ttl })
  return fetched.value
}

async function statKind($: EngineInterface, path: string): Promise<Fetched<Kind>> {
  const stat = await $.fs.stat(path).catch(() => undefined)
  if (stat !== undefined) {
    const kind: Kind = stat.kind === 'dir' ? 'dir' : stat.kind === 'file' ? 'file' : 'none'
    return { value: kind, ttl: TTL_MS }
  }
  const exists = await $.fs.exists(path).catch(() => undefined)
  return { value: 'none', ttl: exists === false ? TTL_MS : RETRY_MS }
}

async function listDir($: EngineInterface, dir: string): Promise<Fetched<readonly Entry[]>> {
  const entries = await $.fs.list(dir).catch(() => undefined)
  if (entries !== undefined) {
    return { value: entries.map(entry => ({ name: entry.name, kind: entry.kind })), ttl: TTL_MS }
  }
  const exists = await $.fs.exists(dir).catch(() => undefined)
  return { value: [], ttl: exists === false ? TTL_MS : RETRY_MS }
}

async function fetchKind($: EngineInterface, path: string): Promise<Kind> {
  const hit = cached(kinds, path)
  if (hit !== undefined) return hit
  const running = kindJobs.get(path)
  if (running !== undefined) return running
  const job = statKind($, path)
    .then(fetched => remember(kinds, path, fetched, MAX_KINDS))
    .finally(() => kindJobs.delete(path))
  kindJobs.set(path, job)
  return job
}

async function fetchList($: EngineInterface, dir: string): Promise<readonly Entry[]> {
  const hit = cached(lists, dir)
  if (hit !== undefined) return hit
  const running = listJobs.get(dir)
  if (running !== undefined) return running
  const job = listDir($, dir)
    .then(fetched => remember(lists, dir, fetched, MAX_LISTS))
    .finally(() => listJobs.delete(dir))
  listJobs.set(dir, job)
  return job
}

async function readHome($: EngineInterface): Promise<string | undefined> {
  const home = await $.env.get('HOME').catch(() => undefined)
  return home === undefined || home === '' ? undefined : home
}

async function readCwd($: EngineInterface): Promise<string | undefined> {
  return $.session.cwd().catch(() => undefined)
}

async function fetchKinds($: EngineInterface, paths: readonly string[], into: Map<string, Kind>): Promise<void> {
  for (let start = 0; start < paths.length; start += MAX_PARALLEL) {
    const batch = paths.slice(start, start + MAX_PARALLEL)
    const found = await Promise.all(batch.map(path => fetchKind($, path)))
    batch.forEach((path, index) => into.set(path, found[index] ?? 'none'))
  }
}

async function fetchLists($: EngineInterface, dirs: readonly string[], into: Map<string, readonly Entry[]>): Promise<void> {
  for (let start = 0; start < dirs.length; start += MAX_PARALLEL) {
    const batch = dirs.slice(start, start + MAX_PARALLEL)
    const found = await Promise.all(batch.map(dir => fetchList($, dir)))
    batch.forEach((dir, index) => into.set(dir, found[index] ?? []))
  }
}

async function linkText($: EngineInterface, text: string): Promise<string> {
  const localKinds = new Map<string, Kind>()
  const localLists = new Map<string, readonly Entry[]>()
  let home: string | undefined
  let cwd: string | undefined
  let askedHome = false
  let askedCwd = false
  for (let round = 0; ; round++) {
    const lookup: Lookup = {
      home,
      cwd,
      kind: path => {
        const value = localKinds.get(path) ?? cached(kinds, path)
        if (value !== undefined) localKinds.set(path, value)
        return value
      },
      list: dir => {
        const value = localLists.get(dir) ?? cached(lists, dir)
        if (value !== undefined) localLists.set(dir, value)
        return value
      },
    }
    const { text: linked, pending } = linkify(text, lookup)
    const needsHome = pending.home && !askedHome
    const needsCwd = pending.cwd && !askedCwd
    const hasWork = needsHome || needsCwd || pending.kinds.length > 0 || pending.lists.length > 0
    if (!hasWork || round >= MAX_ROUNDS) return linked
    if (needsHome) {
      askedHome = true
      home = await readHome($)
    }
    if (needsCwd) {
      askedCwd = true
      cwd = await readCwd($)
    }
    await fetchKinds($, pending.kinds, localKinds)
    await fetchLists($, pending.lists, localLists)
  }
}

export const register: Register = on => {
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const text = e.props.text
    const linked = await linkText($, text).catch(() => text)
    if (linked === text) return next(e)
    return next({ ...e, props: { ...e.props, text: linked } })
  })
}
