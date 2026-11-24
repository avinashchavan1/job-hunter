import { app, BrowserWindow, Menu, nativeImage, nativeTheme, Notification, shell, Tray } from 'electron'
import { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import trayIcon from '../../resources/trayTemplate.png?asset'
import { broadcast, registerIpc, runAllActive } from './ipc'
import { startScheduler } from './scheduler'
import { getSettings, saveSettings } from './settings'
import { ipcMain } from 'electron'

// One stable data folder regardless of display name (keeps profiles, matches and keys across renames)
app.setName('job-hunter') // keychain entry (safeStorage) is keyed on this name — keep it stable
app.setPath('userData', join(app.getPath('appData'), 'job-hunter'))

// dev-only: lets automated UI tests attach over CDP
if (!app.isPackaged && process.env.JH_DEBUG_PORT) app.commandLine.appendSwitch('remote-debugging-port', process.env.JH_DEBUG_PORT)

let win: BrowserWindow | null = null
let tray: Tray | null = null
let quitting = false

function createWindow(): void {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'Job Hunter',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 16, y: 18 },
    // native translucent sidebar on macOS; renderer paints the content area opaque
    ...(process.platform === 'darwin' ? { vibrancy: 'sidebar' as const, visualEffectState: 'followWindow' as const, backgroundColor: '#00000000' } : { backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f6f6f8' }),
    autoHideMenuBar: true,
    ...(process.platform !== 'darwin' ? { icon } : {}),
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  if (process.platform !== 'darwin') {
    win.setMenuBarVisibility(false) // Alt shows it; keeps the Windows look clean
    nativeTheme.on('updated', () => win?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1c1c1e' : '#f6f6f8'))
  }
  win.on('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) win?.show()
  })
  win.on('close', (e) => {
    // keep running in the menu bar so the daily schedule still fires
    if (!quitting) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

function showWindow(): void {
  if (!win || win.isDestroyed()) createWindow()
  win!.show()
  win!.focus()
}

async function runAllAndNotify(): Promise<void> {
  broadcast('run:all', { running: true })
  const res = await runAllActive()
  broadcast('run:all', { running: false })
  if (!getSettings().notify || !Notification.isSupported()) return
  const strong = res.reduce((a, r) => a + r.strong, 0)
  const alerts = res.reduce((a, r) => a + r.alerts, 0)
  const body = res.length
    ? res.map((r) => `${r.name}: ${r.strong} strong match${r.strong === 1 ? '' : 'es'}`).join('\n') + (alerts ? `\n${alerts} source alert(s) — check the app` : '')
    : 'No profiles with a resume yet.'
  const n = new Notification({ title: `Job Hunter — ${strong} new strong match${strong === 1 ? '' : 'es'}`, body })
  n.on('click', showWindow)
  n.show()
}

function createTray(): void {
  const img = process.platform === 'darwin' ? nativeImage.createFromPath(trayIcon) : nativeImage.createFromPath(icon).resize({ width: 18, height: 18 })
  if (process.platform === 'darwin') img.setTemplateImage(true)
  tray = new Tray(img)
  tray.setToolTip('Job Hunter')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Job Hunter', click: showWindow },
      { label: 'Run all profiles now', click: () => void runAllAndNotify() },
      { type: 'separator' },
      { label: 'Quit', click: () => { quitting = true; app.quit() } }
    ])
  )
  tray.on('click', showWindow)
}

export function applyLoginItem(open: boolean): void {
  if (!app.isPackaged) return // only meaningful for the installed app
  app.setLoginItemSettings({ openAtLogin: open, args: ['--hidden'] })
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', showWindow)
  app.whenReady().then(() => {
    electronApp.setAppUserModelId('app.jobhunter.desktop')
    app.on('browser-window-created', (_, w) => optimizer.watchWindowShortcuts(w))
    // Standard menu so Cmd+C / Cmd+V / Cmd+A work in text fields on macOS
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
        { role: 'editMenu' as const },
        { role: 'viewMenu' as const },
        { role: 'windowMenu' as const }
      ])
    )
    registerIpc()
    ipcMain.handle('run:all', () => {
      void runAllAndNotify()
      return true
    })
    ipcMain.handle('app:setOpenAtLogin', (_e, open: boolean) => {
      saveSettings({ openAtLogin: open })
      applyLoginItem(open)
      return getSettings()
    })
    createWindow()
    createTray()
    startScheduler(runAllAndNotify)
    app.on('activate', showWindow)
  })
  app.on('before-quit', () => (quitting = true))
  app.on('window-all-closed', () => {
    // stay alive in tray on every platform
  })
}
