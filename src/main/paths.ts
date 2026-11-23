import { app } from 'electron'
import { mkdirSync } from 'fs'
import { join } from 'path'

export function dataDir(): string {
  const d = join(app.getPath('userData'), 'data')
  mkdirSync(d, { recursive: true })
  return d
}

export function profileDir(slug: string): string {
  const d = join(dataDir(), 'profiles', slug)
  mkdirSync(d, { recursive: true })
  return d
}

export const dbPath = (): string => join(dataDir(), 'jobs.db')

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'profile'
  )
}
