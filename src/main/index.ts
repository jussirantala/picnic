import { app, BrowserWindow, dialog, ipcMain, net, protocol, shell } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { scanDirectory } from './scanner'
import { addKept, getKeptSet, pruneKept, removeKept } from './keptStore'
import type { ScanResult } from '../shared/types'

/** Root directory of the current scan; photo:// requests outside it are refused. */
let allowedRoot: string | null = null

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'photo',
    privileges: { standard: false, secure: true, supportFetchAPI: true, stream: true }
  }
])

function isInsideRoot(filePath: string, root: string): boolean {
  const rel = path.relative(root, filePath)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

function registerPhotoProtocol(): void {
  protocol.handle('photo', (request) => {
    const filePath = decodeURIComponent(request.url.slice('photo://'.length))
    if (!allowedRoot || !isInsideRoot(filePath, allowedRoot)) {
      return new Response('Forbidden', { status: 403 })
    }
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 640,
    minHeight: 480,
    backgroundColor: '#111318',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('dialog:chooseDir', async (event) => {
    const parent = BrowserWindow.fromWebContents(event.sender)
    const options = {
      title: 'Choose folder to sort',
      properties: ['openDirectory' as const]
    }
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('scan:start', async (event, root: string): Promise<ScanResult> => {
    allowedRoot = root
    const kept = await getKeptSet(root)
    const all = await scanDirectory(root, (progress) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('scan:progress', progress)
      }
    })
    await pruneKept(root, new Set(all.map((p) => p.path)))
    const photos = all.filter((p) => !kept.has(p.path))
    return { root, photos, skippedKept: all.length - photos.length }
  })

  ipcMain.handle('photo:keep', (_event, root: string, photoPath: string) =>
    addKept(root, photoPath)
  )

  ipcMain.handle('photo:unkeep', (_event, root: string, photoPath: string) =>
    removeKept(root, photoPath)
  )

  ipcMain.handle('photo:trash', async (_event, photoPath: string) => {
    if (!allowedRoot || !isInsideRoot(photoPath, allowedRoot)) {
      throw new Error('Refusing to trash file outside the scanned folder')
    }
    await shell.trashItem(photoPath)
  })
}

app.whenReady().then(() => {
  registerPhotoProtocol()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
