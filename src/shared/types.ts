export interface PhotoEntry {
  /** Absolute file path */
  path: string
  /** Best-known capture time (EXIF DateTimeOriginal, else file mtime), epoch ms */
  date: number
  kind: 'image' | 'video'
}

export interface ScanProgress {
  phase: 'walking' | 'dating'
  /** Files discovered so far (walking) or files dated so far (dating) */
  count: number
  /** Total files to date (only meaningful in 'dating' phase) */
  total: number
}

export interface ScanResult {
  root: string
  photos: PhotoEntry[]
  /** Number of images skipped because they were already kept */
  skippedKept: number
}
