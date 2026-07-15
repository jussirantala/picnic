import { contextBridge, ipcRenderer } from 'electron'
import type { ScanProgress, ScanResult } from '../shared/types'

export interface Api {
  chooseDir(): Promise<string | null>
  scan(root: string): Promise<ScanResult>
  onScanProgress(cb: (progress: ScanProgress) => void): () => void
  keep(root: string, path: string): Promise<void>
  unkeep(root: string, path: string): Promise<void>
  trash(path: string): Promise<void>
  photoUrl(path: string): string
}

const api: Api = {
  chooseDir: () => ipcRenderer.invoke('dialog:chooseDir'),
  scan: (root) => ipcRenderer.invoke('scan:start', root),
  onScanProgress: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, progress: ScanProgress): void => cb(progress)
    ipcRenderer.on('scan:progress', listener)
    return () => ipcRenderer.removeListener('scan:progress', listener)
  },
  keep: (root, path) => ipcRenderer.invoke('photo:keep', root, path),
  unkeep: (root, path) => ipcRenderer.invoke('photo:unkeep', root, path),
  trash: (path) => ipcRenderer.invoke('photo:trash', path),
  photoUrl: (path) => `photo://${encodeURIComponent(path)}`
}

contextBridge.exposeInMainWorld('api', api)
