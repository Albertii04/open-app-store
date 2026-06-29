import { BrowserWindow, app, ipcMain, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import windowStateKeeper from 'electron-window-state'
import { installBroker } from './broker.js'
import { stopAuthoring, restoreUserDecks, backupUserDecks } from './authoring.js'
import { migrateUserData } from './migrate.js'
import { ToolManager } from './tools.js'
import {
  currentPlatformArch,
  installNative,
  listInstalled,
  uninstallNative,
} from './installer.js'
import { getCatalog } from './catalog.js'
import { initAutoUpdater, quitAndInstallUpdate, checkForUpdatesNow } from './updater.js'
import { getAiSettings, setAiSettings } from './ai/settings.js'
import { detectBinary } from './ai/detect.js'
import { getAdapter } from './ai/registry.js'
import type { ToolManifest } from '@openappstore/sdk'
import type { ProviderId } from '../shared/ai-types.js'

const manager = new ToolManager()
let mainWindow: BrowserWindow | null = null

function shellPreloadPath(): string {
  return join(app.getAppPath(), 'out/preload/shell.js')
}

// Only one instance of the app; focus the existing window if launched again.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
}

async function createWindow(): Promise<void> {
  // Remember window size/position across launches.
  const state = windowStateKeeper({ defaultWidth: 1280, defaultHeight: 800 })

  const win = new BrowserWindow({
    x: state.x,
    y: state.y,
    width: state.width,
    height: state.height,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#fafafa',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    show: false,
    webPreferences: {
      preload: shellPreloadPath(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  state.manage(win)
  mainWindow = win
  win.removeMenu() // drop the default File/Edit/View menu bar on Windows/Linux (no-op on macOS)
  manager.attach(win)
  win.once('ready-to-show', () => win.show())

  // The shell UI never opens windows or navigates away; route any attempt
  // (e.g. an external link) to the OS browser and block in-app navigation.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl && url.startsWith(devUrl)) return
    e.preventDefault()
  })

  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl && !app.isPackaged) {
    await win.loadURL(devUrl)
  } else {
    await win.loadFile(join(app.getAppPath(), 'out/renderer/index.html'))
  }
}

// ---- shell control IPC (exposed to the shell renderer only, via window.shellApi)
function installShellIpc(): void {
  ipcMain.handle('shell:listTools', () => manager.summaries())
  ipcMain.handle('shell:openTool', (_e, id: string) => manager.open(id))
  ipcMain.handle('shell:activateTool', (_e, id: string) => manager.activate(id))
  ipcMain.handle('shell:closeTool', (_e, id: string) => manager.closeTab(id))
  ipcMain.handle('shell:showHome', () => manager.showHome())
  ipcMain.handle('shell:reloadActiveTool', () => manager.reloadActive())
  ipcMain.handle('shell:getTabs', () => manager.tabs())

  // ---- catalog + native app installer ----
  ipcMain.handle('shell:catalog', () => getCatalog())
  ipcMain.handle('shell:installer:platform', () => currentPlatformArch())
  ipcMain.handle('shell:installer:list', () => listInstalled())
  ipcMain.handle('shell:installer:install', (_e, manifest: ToolManifest) =>
    installNative(manifest, (p) => mainWindow?.webContents.send('shell:installerProgress', p)),
  )
  ipcMain.handle('shell:installer:uninstall', (_e, id: string) => uninstallNative(id))

  // ---- app auto-update ----
  ipcMain.handle('shell:update:install', () => quitAndInstallUpdate())
  ipcMain.handle('shell:update:check', () => checkForUpdatesNow())
  ipcMain.handle('shell:appVersion', () => app.getVersion())

  // AI provider settings (shell-owned).
  ipcMain.handle('shell:aiGet', () => getAiSettings())
  ipcMain.handle('shell:aiSet', (_e, patch) => setAiSettings(patch))
  ipcMain.handle('shell:aiDetect', (_e, provider: ProviderId) =>
    detectBinary(getAdapter(provider).binaryNames, getAiSettings().providers[provider]?.binPath),
  )
  ipcMain.handle('shell:aiTest', (_e, provider: ProviderId) => {
    const adapter = getAdapter(provider)
    const bin = detectBinary(adapter.binaryNames, getAiSettings().providers[provider]?.binPath)
    if (!bin) return { ok: false, error: `${adapter.label} no encontrado` }
    try {
      const version = execFileSync(bin, adapter.versionArgs, { encoding: 'utf8', timeout: 5000 }).trim()
      return { ok: true, version }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })
}

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.whenReady().then(async () => {
  migrateUserData() // restore tool-storage from a prior app name (rename-safe)
  restoreUserDecks() // ensure userData/presentations directory exists
  backupUserDecks() // no-op: decks already live in userData directly
  installBroker()
  installShellIpc()
  await manager.load()
  await createWindow()
  initAutoUpdater(() => mainWindow)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('will-quit', () => stopAuthoring())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
