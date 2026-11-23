// In-app daily scheduler. Runs while the app is open (menu-bar); catches up after sleep or a late start.
import { powerMonitor } from 'electron'
import * as db from './db'
import { getSettings } from './settings'

let timer: NodeJS.Timeout | null = null

export function nextRunAt(): string | null {
  const s = getSettings().schedule
  if (!s.enabled) return null
  const [h, m] = s.time.split(':').map(Number)
  const d = new Date()
  d.setSeconds(0, 0)
  const doneToday = db.kvGet('last_scheduled_run') === db.today()
  d.setHours(h, m)
  if (doneToday || d.getTime() < Date.now() - 60000) {
    if (doneToday) d.setDate(d.getDate() + 1)
  }
  while (s.weekdaysOnly && (d.getDay() === 0 || d.getDay() === 6)) d.setDate(d.getDate() + 1)
  return d.toISOString()
}

function due(): boolean {
  const s = getSettings().schedule
  if (!s.enabled) return false
  const d = new Date()
  if (s.weekdaysOnly && (d.getDay() === 0 || d.getDay() === 6)) return false
  if (db.kvGet('last_scheduled_run') === db.today()) return false
  const [h, m] = s.time.split(':').map(Number)
  return d.getHours() * 60 + d.getMinutes() >= h * 60 + m
}

export function startScheduler(runAll: () => Promise<void>): void {
  const tick = async (): Promise<void> => {
    if (!due()) return
    db.kvSet('last_scheduled_run', db.today())
    try {
      await runAll()
    } catch (e) {
      console.error('scheduled run failed', e)
    }
  }
  timer = setInterval(tick, 60_000)
  powerMonitor.on('resume', () => setTimeout(tick, 30_000))
  setTimeout(tick, 15_000)
}

export function stopScheduler(): void {
  if (timer) clearInterval(timer)
}
