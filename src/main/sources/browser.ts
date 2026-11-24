// Read-only browsing of Naukri and LinkedIn job search pages with a persistent, app-owned Chrome profile.
// Rules (enforced here, not configurable away):
//  - never clicks Apply, never submits forms, never types credentials — the person logs in by hand once
//  - human pace: random delay between every page load (settings.browser.min/maxDelayS, min 5s)
//  - hard daily page cap per site per profile
//  - stops the site immediately on CAPTCHA, login wall or "unusual activity" pages
import { BrowserContext, chromium, Page } from 'playwright-core'
import { existsSync } from 'fs'
import { join } from 'path'
import { Job, Profile } from '../../shared/types'
import * as db from '../db'
import { profileDir } from '../paths'
import { getSettings } from '../settings'
import { SourceNotConfigured, StopSource } from './errors'

export type Site = 'naukri' | 'linkedin'

const LOGIN_URL: Record<Site, string> = {
  naukri: 'https://www.naukri.com/nlogin/login',
  linkedin: 'https://www.linkedin.com/login'
}
const AUTH_COOKIE: Record<Site, RegExp> = { naukri: /^(nauk_at|NKWAP|MYNAUKRI)/i, linkedin: /^li_at$/ }

const BLOCK_TEXT = /unusual activity|verify (that )?you('| a)re (a )?human|security check|are you a robot|captcha|access denied|let's do a quick security check|temporarily restricted/i

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
const userDataDir = (p: Profile): string => join(profileDir(p.slug), 'browser')
// One Chrome per person: the persistent profile folder can only be opened by one browser at a time.
const open = new Map<number, { ctx: BrowserContext; headless: boolean }>()

export class BrowserBusy extends Error {}

function chromePath(): string | undefined {
  const mac = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  return existsSync(mac) ? mac : undefined
}

async function context(p: Profile, headless: boolean): Promise<BrowserContext> {
  const existing = open.get(p.id)
  if (existing) {
    if (existing.headless === headless) return existing.ctx
    throw new BrowserBusy(
      existing.headless
        ? 'A search is reading Naukri/LinkedIn for this person right now. Try signing in again when it finishes.'
        : 'A sign-in window is open for this person. Finish signing in (or close that window), then run again.'
    )
  }
  let ctx: BrowserContext
  try {
    ctx = await chromium.launchPersistentContext(userDataDir(p), {
      headless,
      executablePath: chromePath(),
      channel: chromePath() ? undefined : 'chrome',
      viewport: { width: 1280, height: 860 },
      locale: 'en-IN',
      timezoneId: 'Asia/Kolkata'
    })
  } catch (e: any) {
    const msg = String(e?.message ?? e)
    if (/executable|not found|chrome.*(install|exist)|ENOENT/i.test(msg))
      throw new SourceNotConfigured('Google Chrome is needed for Naukri / LinkedIn. Install it from google.com/chrome, then try again.')
    if (/ProcessSingleton|profile.*(in use|locked)|SingletonLock/i.test(msg))
      throw new BrowserBusy('This person\'s Job Hunter Chrome window is already open. Close it, then try again.')
    throw e
  }
  ctx.on('close', () => open.delete(p.id))
  open.set(p.id, { ctx, headless })
  return ctx
}

async function hasAuthCookie(ctx: BrowserContext, site: Site): Promise<boolean> {
  const cookies = await ctx.cookies(site === 'naukri' ? 'https://www.naukri.com' : 'https://www.linkedin.com')
  return cookies.some((c) => AUTH_COOKIE[site].test(c.name) && c.value.length > 0)
}

const ON_LOGIN_PAGE = /\/n?login|checkpoint|authwall|uas\/|challenge|otp|verify/i

/** Signed in = auth cookie present AND the tab has left the login / verification pages. */
async function signedIn(ctx: BrowserContext, page: Page, site: Site): Promise<boolean> {
  if (page.isClosed()) return false
  const host = site === 'naukri' ? /naukri\.com/ : /linkedin\.com/
  const url = page.url()
  if (!host.test(url) || ON_LOGIN_PAGE.test(new URL(url).pathname)) return false
  return hasAuthCookie(ctx, site)
}

export async function loginStatus(p: Profile): Promise<Record<Site, boolean>> {
  return {
    naukri: db.kvGet(`browser_login:${p.id}:naukri`) === '1',
    linkedin: db.kvGet(`browser_login:${p.id}:linkedin`) === '1'
  }
}

/** Opens a visible Chrome tab on the site's login page; the person signs in by hand. Resolves when signed in, timed out, or the tab/window closes. */
export async function openLogin(p: Profile, site: Site): Promise<boolean> {
  const ctx = await context(p, false)
  // own tab per site, so signing into LinkedIn never navigates away from a half-finished Naukri login
  const blank = ctx.pages().find((pg) => pg.url() === 'about:blank')
  const page = blank ?? (await ctx.newPage())
  await page.goto(LOGIN_URL[site], { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.bringToFront().catch(() => {})
  const ok = await new Promise<boolean>((resolve) => {
    const t0 = Date.now()
    let done = false
    const finish = (v: boolean): void => {
      if (done) return
      done = true
      clearInterval(tick)
      resolve(v)
    }
    const tick = setInterval(async () => {
      try {
        if (await signedIn(ctx, page, site)) finish(true)
        else if (Date.now() - t0 > 10 * 60_000) finish(false)
      } catch {
        if (page.isClosed()) finish(false)
      }
    }, 2000)
    page.on('close', () => finish(false))
    ctx.on('close', () => finish(false))
  })
  db.kvSet(`browser_login:${p.id}:${site}`, ok ? '1' : '0')
  if (ok) await sleep(1500) // let the site finish writing its cookies
  await page.close().catch(() => {})
  // close the window once no other sign-in tab is still in use
  if (!ctx.pages().some((pg) => !pg.isClosed() && pg.url() !== 'about:blank')) await ctx.close().catch(() => {})
  return ok
}

export async function logout(p: Profile, site: Site): Promise<void> {
  const reuse = open.get(p.id)?.ctx
  const ctx = reuse ?? (await context(p, true))
  const domain = site === 'naukri' ? 'naukri.com' : 'linkedin.com'
  const keep = (await ctx.cookies()).filter((c) => !c.domain.includes(domain))
  await ctx.clearCookies()
  await ctx.addCookies(keep)
  if (!reuse) await ctx.close()
  db.kvSet(`browser_login:${p.id}:${site}`, '0')
}

// ---------- reading ----------

function humanDelay(): Promise<void> {
  const b = getSettings().browser
  const min = Math.max(5, b.minDelayS)
  const max = Math.max(min, b.maxDelayS)
  return sleep((min + Math.random() * (max - min)) * 1000)
}

async function guard(page: Page, site: Site, pid: number): Promise<void> {
  const url = page.url()
  if (/checkpoint|authwall|captcha|challenge|uas\/login|\/login|nlogin/i.test(url)) {
    db.kvSet(`browser_login:${pid}:${site}`, '0')
    throw new StopSource(`${site}: hit a login wall or checkpoint (${new URL(url).pathname}). Sign in again from the profile, then retry tomorrow.`)
  }
  const text = (await page.evaluate(() => document.body?.innerText?.slice(0, 4000) ?? '').catch(() => '')) as string
  if (BLOCK_TEXT.test(text)) throw new StopSource(`${site}: CAPTCHA / unusual-activity page shown. Stopped for today — open the site yourself to clear it.`)
}

async function visit(page: Page, p: Profile, site: Site, url: string): Promise<boolean> {
  const cap = getSettings().browser.pagesPerSitePerDay
  if (db.pagesUsed(p.id, site) >= cap) return false
  await humanDelay()
  db.addPage(p.id, site)
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 })
  await sleep(1500 + Math.random() * 1500)
  await guard(page, site, p.id)
  // gentle scroll so lazy cards render
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 600 + Math.random() * 400)
    await sleep(500 + Math.random() * 700)
  }
  return true
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

async function readNaukri(page: Page): Promise<Partial<Job>[]> {
  return page.evaluate(() => {
    const out: any[] = []
    const cards = document.querySelectorAll('.srp-jobtuple-wrapper, article.jobTuple, div.cust-job-tuple')
    cards.forEach((c) => {
      const a = c.querySelector('a.title, a[title].title, h2 a') as HTMLAnchorElement | null
      if (!a) return
      const txt = (sel: string): string => (c.querySelector(sel)?.textContent || '').trim()
      out.push({
        title: a.textContent?.trim() || a.title,
        url: a.href,
        company: txt('a.comp-name, .comp-name, .subTitle'),
        location: txt('.locWdth, .loc-wrap, .location'),
        salary: txt('.sal-wrap span, .salary, .sal'),
        description: [txt('.expwdth, .exp-wrap, .experience') && `Experience: ${txt('.expwdth, .exp-wrap, .experience')}`, txt('.job-desc, .job-description'), txt('.tags-gt, ul.tags')]
          .filter(Boolean)
          .join('\n'),
        posted_at: txt('.job-post-day, .postedDate')
      })
    })
    return out
  })
}

async function readLinkedIn(page: Page): Promise<Partial<Job>[]> {
  return page.evaluate(() => {
    const out: any[] = []
    const seen = new Set<string>()
    document.querySelectorAll('li[data-occludable-job-id], div.job-card-container, li.jobs-search-results__list-item').forEach((c) => {
      const a = c.querySelector('a[href*="/jobs/view/"]') as HTMLAnchorElement | null
      if (!a) return
      const id = (a.href.match(/jobs\/view\/(\d+)/) || [])[1]
      if (!id || seen.has(id)) return
      seen.add(id)
      const txt = (sel: string): string => (c.querySelector(sel)?.textContent || '').replace(/\s+/g, ' ').trim()
      out.push({
        title: (a.getAttribute('aria-label') || a.textContent || '').replace(/\s+/g, ' ').replace(/ with verification$/i, '').trim(),
        url: `https://www.linkedin.com/jobs/view/${id}/`,
        external_id: id,
        company: txt('.artdeco-entity-lockup__subtitle, .job-card-container__primary-description, .job-card-container__company-name'),
        location: txt('.job-card-container__metadata-item, .artdeco-entity-lockup__caption, .job-card-container__metadata-wrapper li'),
        description: txt('.job-card-list__insight, .job-card-container__job-insight-text')
      })
    })
    return out
  })
}

async function readDetail(page: Page, site: Site): Promise<string> {
  return page.evaluate((s) => {
    const sel = s === 'naukri' ? 'section.styles_job-desc-container__txpYf, .job-desc, section[class*="job-desc"], .dang-inner-html' : '.jobs-description__content, .jobs-box__html-content, #job-details, .description__text'
    const el = document.querySelector(sel)
    return (el?.textContent || '').replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, 8000)
  }, site)
}

export async function fetchSite(p: Profile, site: Site, log: (s: string) => void): Promise<Job[]> {
  if (!(await loginStatus(p))[site]) throw new SourceNotConfigured(`${site}: not signed in yet (Profile → Sources → Sign in to ${site === 'naukri' ? 'Naukri' : 'LinkedIn'}).`)
  const cfg = getSettings().browser
  const cap = cfg.pagesPerSitePerDay
  if (db.pagesUsed(p.id, site) >= cap) {
    log(`${site}: daily cap of ${cap} pages already used`)
    return []
  }
  let ctx: BrowserContext
  try {
    ctx = await context(p, !cfg.showWindow)
  } catch (e) {
    if (e instanceof BrowserBusy) throw new SourceNotConfigured(`${site}: skipped — ${e.message}`)
    throw e
  }
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  const titles = p.prefs.target_titles.slice(0, 3)
  const cities = p.prefs.locations.length ? p.prefs.locations : ['India']
  const yrs = Math.round(p.prefs.years_experience || 0)
  const found = new Map<string, Job>()
  try {
    search: for (const t of titles) {
      for (const city of cities) {
        const url =
          site === 'naukri'
            ? `https://www.naukri.com/${slug(t)}-jobs-in-${slug(city)}?experience=${yrs}&jobAge=3`
            : `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(t)}&location=${encodeURIComponent(city + ', India')}&f_TPR=r86400`
        if (!(await visit(page, p, site, url))) {
          log(`${site}: daily page cap reached (${cap})`)
          break search
        }
        const rows = site === 'naukri' ? await readNaukri(page) : await readLinkedIn(page)
        log(`${site}: "${t}" / ${city} → ${rows.length} cards`)
        for (const r of rows) {
          if (!r.title || !r.company) continue
          const j = db.makeJob({ ...r, title: r.title, company: r.company, source: site })
          if (!found.has(j.id)) found.set(j.id, j)
        }
      }
    }
    // spend up to a third of the remaining budget on descriptions for jobs we have not seen before
    const fresh = [...found.values()].filter((j) => !db.getJob(j.id) && j.url)
    const budget = Math.floor((cap - db.pagesUsed(p.id, site)) / 3)
    for (const j of fresh.slice(0, Math.min(budget, 10))) {
      if (!(await visit(page, p, site, j.url))) break
      const d = await readDetail(page, site)
      if (d) j.description = [j.description, d].filter(Boolean).join('\n\n')
    }
  } finally {
    await ctx.close().catch(() => {})
  }
  log(`${site}: ${found.size} jobs · ${db.pagesUsed(p.id, site)}/${cap} pages used today`)
  return [...found.values()]
}
