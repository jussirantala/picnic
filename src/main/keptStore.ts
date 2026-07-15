import { app } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'

interface KeptFile {
  version: 1
  /** Kept photo paths, grouped by the scanned root directory */
  roots: Record<string, string[]>
}

/** In-memory mirror of kept.json with Set semantics for O(1) add/remove. */
let cache: Map<string, Set<string>> | null = null

function storePath(): string {
  return path.join(app.getPath('userData'), 'kept.json')
}

async function load(): Promise<Map<string, Set<string>>> {
  if (cache) return cache
  cache = new Map()
  try {
    const raw = await fs.readFile(storePath(), 'utf8')
    const parsed = JSON.parse(raw) as KeptFile
    if (parsed && parsed.version === 1 && typeof parsed.roots === 'object') {
      for (const [root, list] of Object.entries(parsed.roots)) {
        if (Array.isArray(list)) cache.set(root, new Set(list))
      }
    }
  } catch {
    // Missing or corrupt store — start empty.
  }
  return cache
}

async function persist(): Promise<void> {
  if (!cache) return
  const data: KeptFile = { version: 1, roots: {} }
  for (const [root, set] of cache) {
    if (set.size > 0) data.roots[root] = Array.from(set)
  }
  const file = storePath()
  const tmp = `${file}.tmp`
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(tmp, file)
}

export async function getKeptSet(root: string): Promise<Set<string>> {
  const data = await load()
  return data.get(root) ?? new Set()
}

export async function addKept(root: string, photoPath: string): Promise<void> {
  const data = await load()
  let set = data.get(root)
  if (!set) {
    set = new Set()
    data.set(root, set)
  }
  if (!set.has(photoPath)) {
    set.add(photoPath)
    await persist()
  }
}

export async function removeKept(root: string, photoPath: string): Promise<void> {
  const data = await load()
  const set = data.get(root)
  if (set?.delete(photoPath)) {
    await persist()
  }
}

/**
 * Drop kept entries whose files no longer exist under `root`, so kept.json
 * doesn't grow forever as photos get renamed or deleted outside the app.
 * `existing` must be the complete set of paths found by the current scan.
 */
export async function pruneKept(root: string, existing: ReadonlySet<string>): Promise<void> {
  const data = await load()
  const set = data.get(root)
  if (!set) return
  let changed = false
  for (const kept of set) {
    if (!existing.has(kept)) {
      set.delete(kept)
      changed = true
    }
  }
  if (changed) await persist()
}
