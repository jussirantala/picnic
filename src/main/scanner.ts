import { promises as fs } from 'node:fs'
import path from 'node:path'
import exifr from 'exifr'
import type { PhotoEntry, ScanProgress } from '../shared/types'

const IMAGE_EXTS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.heic',
  '.heif',
  '.webp',
  '.gif',
  '.bmp'
])

const VIDEO_EXTS = new Set(['.mp4', '.m4v', '.mov', '.webm', '.avi', '.mkv', '.3gp', '.mts'])

// exifr 7.x has no WebP parser — .webp goes straight to the mtime fallback.
const EXIF_CAPABLE_EXTS = new Set(['.jpg', '.jpeg', '.heic', '.heif', '.png'])

const DATE_CONCURRENCY = 8
const PROGRESS_EVERY = 100

export type ProgressFn = (progress: ScanProgress) => void

async function walk(dir: string, out: string[], onProgress: ProgressFn): Promise<void> {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    // Unreadable directory (permissions, junction loops) — skip it.
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(full, out, onProgress)
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase()
      if (IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext)) {
        out.push(full)
        if (out.length % PROGRESS_EVERY === 0) {
          onProgress({ phase: 'walking', count: out.length, total: 0 })
        }
      }
    }
  }
}

/** Returns epoch ms, or null when the file is gone/unreadable. */
async function photoDate(filePath: string): Promise<number | null> {
  const ext = path.extname(filePath).toLowerCase()
  if (EXIF_CAPABLE_EXTS.has(ext)) {
    try {
      const exif = await exifr.parse(filePath, {
        pick: ['DateTimeOriginal', 'CreateDate']
      })
      const date: unknown = exif?.DateTimeOriginal ?? exif?.CreateDate
      if (date instanceof Date && !Number.isNaN(date.getTime())) {
        return date.getTime()
      }
    } catch {
      // Corrupt or unsupported EXIF — fall through to mtime.
    }
  }
  try {
    const stat = await fs.stat(filePath)
    return stat.mtimeMs
  } catch {
    // Vanished between walk and stat — drop it rather than showing a
    // 1/1/1970 card that can't render.
    return null
  }
}

/**
 * Recursively find all images under `root`, resolve each one's capture date
 * (EXIF first, file mtime fallback) and return them sorted oldest-first.
 */
export async function scanDirectory(root: string, onProgress: ProgressFn): Promise<PhotoEntry[]> {
  const files: string[] = []
  await walk(root, files, onProgress)
  onProgress({ phase: 'walking', count: files.length, total: 0 })

  const photos: (PhotoEntry | null)[] = new Array(files.length).fill(null)
  let done = 0
  let next = 0

  async function worker(): Promise<void> {
    while (next < files.length) {
      const i = next++
      const filePath = files[i]
      const kind = VIDEO_EXTS.has(path.extname(filePath).toLowerCase()) ? 'video' : 'image'
      const date = await photoDate(filePath)
      if (date !== null) {
        photos[i] = { path: filePath, date, kind }
      }
      done++
      if (done % PROGRESS_EVERY === 0 || done === files.length) {
        onProgress({ phase: 'dating', count: done, total: files.length })
      }
    }
  }

  const workers = Array.from({ length: Math.min(DATE_CONCURRENCY, files.length) }, () => worker())
  await Promise.all(workers)

  const result = photos.filter((p): p is PhotoEntry => p !== null)
  result.sort((a, b) => a.date - b.date)
  return result
}
