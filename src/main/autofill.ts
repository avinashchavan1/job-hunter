// Autofill: opens a job in the person's Job Hunter Chrome window and adds a floating "Autofill" button.
// Clicking it fills empty fields from the profile's contact details + saved answers and attaches the resume.
// Hard rules (not configurable):
//  - never clicks Next / Submit / Apply, never submits a form — the person reviews and submits
//  - never fills passwords, and does nothing on sign-in / sign-up pages (no account creation)
//  - only fills fields that are empty; highlights what it filled (green) and what still needs the person (amber)
//  - LinkedIn is off unless the person turns it on in Settings (their terms forbid automation)
import { BrowserContext, Frame } from 'playwright-core'
import type { Match, Profile } from '../shared/types'
import * as db from './db'
import { getSettings } from './settings'
import { visibleContext } from './sources/browser'
import { answerQuestions, FormQuestion, getTailored } from './assist'
import { existsSync } from 'fs'

export interface FillData {
  values: Record<string, string>
  answers: { label: string; value: string }[]
}

const prepared = new WeakSet<BrowserContext>()
const current = new WeakMap<BrowserContext, { data: FillData; resume: string | null; pid: number; jobId: string | null }>()

const ACCOUNT_PAGE = /(sign[-_]?in|sign[-_]?up|log[-_]?in|register|create[-_]?account|nlogin|forgot|password|otp|verify)/i

function answer(p: Profile, ...labels: string[]): string {
  for (const l of labels) {
    const a = p.prefs.answers.find((x) => x.label.toLowerCase() === l.toLowerCase())
    if (a?.value.trim()) return a.value.trim()
  }
  return ''
}

export function buildData(p: Profile, m: Pick<Match, 'cover_note'> | null): FillData {
  const c = p.prefs.contact
  const name = (c.full_name || p.profile?.name || p.name || '').trim()
  const parts = name.split(/\s+/)
  const years = p.prefs.years_experience || p.profile?.years_experience || 0
  const totalExp = answer(p, 'Total experience') || (years ? `${years} years` : '')
  return {
    values: {
      full_name: name,
      first_name: parts[0] || '',
      last_name: parts.length > 1 ? parts[parts.length - 1] : '',
      email: c.email.trim(),
      phone: c.phone.trim(),
      city: (c.city || p.profile?.current_location || '').split(',')[0].trim(),
      linkedin: c.linkedin_url.trim(),
      portfolio: c.portfolio_url.trim(),
      current_company: c.current_company.trim(),
      current_title: (c.current_title || p.profile?.current_title || '').trim(),
      total_exp: totalExp,
      current_ctc: answer(p, 'Current CTC'),
      expected_ctc: answer(p, 'Expected CTC') || (p.prefs.min_salary_lpa ? `${p.prefs.min_salary_lpa} LPA` : ''),
      notice: answer(p, 'Notice period'),
      pref_loc: answer(p, 'Preferred locations') || p.prefs.locations.join(', '),
      cover: m?.cover_note?.trim() || ''
    },
    answers: p.prefs.answers.filter((a) => a.value.trim())
  }
}

function allowed(url: string): 'ok' | 'linkedin' | 'account' | 'other' {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return 'other'
  }
  if (!/^https?:$/.test(u.protocol)) return 'other'
  if (/(^|\.)linkedin\.com$/.test(u.hostname) && !getSettings().autofill.linkedin) return 'linkedin'
  if (ACCOUNT_PAGE.test(u.pathname)) return 'account'
  return 'ok'
}

async function attachResume(frame: Frame, resume: string | null): Promise<number> {
  if (!resume) return 0
  let n = 0
  const frames = [frame.page().mainFrame(), ...frame.page().frames().filter((f) => f !== frame.page().mainFrame())]
  for (const f of frames) {
    if (allowed(f.url()) !== 'ok') continue
    const inputs = await f.$$('input[type=file]').catch(() => [])
    const info = await Promise.all(
      inputs.map((h) =>
        h
          .evaluate((el: HTMLInputElement) => {
            const lab = [el.name, el.id, el.getAttribute('aria-label'), el.accept, el.closest('label')?.textContent, el.parentElement?.parentElement?.textContent?.slice(0, 200)]
              .join(' ')
              .toLowerCase()
            return { empty: !el.files || el.files.length === 0, resumeLike: /resume|cv|curriculum/.test(lab), imageOnly: /image\//.test(el.accept) && !/pdf/.test(el.accept) }
          })
          .catch(() => null)
      )
    )
    const idx = info.map((x, i) => (x?.empty && !x.imageOnly ? i : -1)).filter((i) => i >= 0)
    const resumeIdx = idx.filter((i) => info[i]?.resumeLike)
    const use = (resumeIdx.length ? resumeIdx.slice(0, 1) : idx.length === 1 ? idx : []).map((i) => inputs[i])
    for (const h of use) {
      await h.setInputFiles(resume).then(() => n++).catch(() => {})
    }
  }
  return n
}

async function prepare(ctx: BrowserContext): Promise<void> {
  if (prepared.has(ctx)) return
  prepared.add(ctx)
  await ctx.exposeBinding('__jhAutofill', async ({ frame }, kind: string, payload?: unknown) => {
    const cur = current.get(ctx)
    const why = allowed(frame.url())
    if (kind === 'resume') return why === 'ok' && cur ? attachResume(frame, cur.resume) : 0
    if (kind === 'ask') {
      if (why !== 'ok' || !cur || !getSettings().autofill.aiAnswers) return []
      const p = db.getProfile(cur.pid)
      return p ? answerQuestions(p, cur.jobId, (payload as FormQuestion[]) || []).catch(() => []) : []
    }
    if (!cur) return { blocked: 'other' }
    if (why !== 'ok') return { blocked: why }
    return { data: cur.data, ai: getSettings().autofill.aiAnswers }
  })
  await ctx.addInitScript({ content: `(${pageScript.toString()})()` })
}

/** Debug: list form fields (labels/types only, never values) on every open page of the Job Hunter window. */
export async function inspect(p: Profile): Promise<unknown> {
  const ctx = await visibleContext(p)
  const out: unknown[] = []
  for (const page of ctx.pages()) {
    for (const f of page.frames()) {
      const fields = await f
        .evaluate(() => {
          const res: string[] = []
          const walk = (root: Document | ShadowRoot, depth: number): void => {
            root.querySelectorAll('input, textarea, select, [contenteditable], [role="textbox"], [role="combobox"]').forEach((e) => {
              const el = e as HTMLInputElement
              const r = el.getBoundingClientRect()
              const lab = [el.getAttribute('aria-label'), el.placeholder, el.name, el.id, el.closest('label')?.textContent, el.parentElement?.textContent]
                .filter(Boolean).join(' | ').replace(/\s+/g, ' ').slice(0, 120)
              res.push(`${depth ? 'shadow ' : ''}${el.tagName.toLowerCase()}[${el.type || el.getAttribute('role') || el.getAttribute('contenteditable') || ''}] ${r.width > 0 ? 'vis' : 'hid'} ${lab}`)
            })
            root.querySelectorAll('*').forEach((e) => { if ((e as HTMLElement).shadowRoot) walk((e as HTMLElement).shadowRoot!, depth + 1) })
          }
          walk(document, 0)
          return { loaded: !!(window as any).__jhLoaded, fields: res.slice(0, 80) }
        })
        .catch((e) => ({ error: String(e).slice(0, 200) }))
      let u = ''
      try { const x = new URL(f.url()); u = x.host + x.pathname } catch { u = f.url().slice(0, 80) }
      out.push({ frame: u, ...fields })
    }
  }
  return out
}

/** Open the job's posting in the Job Hunter Chrome window with the Autofill button available. */
export async function openForApply(p: Profile, jobId: string): Promise<void> {
  const m = db.listMatches(p.id, { includeFiltered: true }).find((x) => x.id === jobId)
  if (!m?.url) throw new Error('This job has no link to open.')
  const ctx = await visibleContext(p)
  // a resume tailored to this job wins over the original
  const tailored = getTailored(p.id, jobId)
  const resume = tailored && existsSync(tailored.pdf) ? tailored.pdf : p.resume_path
  current.set(ctx, { data: buildData(p, m), resume, pid: p.id, jobId })
  await prepare(ctx)
  const blank = ctx.pages().find((pg) => pg.url() === 'about:blank')
  const page = blank ?? (await ctx.newPage())
  await page.goto(m.url, { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {})
  await page.bringToFront().catch(() => {})
}

// ---------------------------------------------------------------------------------------------
// Runs inside every page and frame of the Job Hunter Chrome window. Must be self-contained.
// It only sets values and fires input/change events. It never clicks buttons or submits forms.
function pageScript(): void {
  const w = window as any
  if (w.__jhLoaded) return
  w.__jhLoaded = true
  const isTop = window.top === window.self
  const GREEN = '#10b981'
  const AMBER = '#f59e0b'

  const RULES: [string, RegExp][] = [
    ['email', /e-?mail/],
    ['phone', /phone|mobile|contact (no|number)|whatsapp|\btel\b/],
    ['linkedin', /linked\s?in/],
    ['portfolio', /portfolio|website|github|personal (site|url|page)|blog/],
    ['first_name', /first\s*name|given\s*name|\bfname\b|forename/],
    ['last_name', /last\s*name|surname|family\s*name|\blname\b/],
    ['current_ctc', /current\s*(ctc|salary|compensation|annual|package|fixed)|present (ctc|salary)/],
    ['expected_ctc', /expected\s*(ctc|salary|compensation|package)|salary expectation|desired (salary|compensation)/],
    ['notice', /notice\s*period|when can you (join|start)|joining (time|date)|availability to (join|start)|earliest start/],
    ['total_exp', /total\s*(work\s*|relevant\s*)?exp|years of (relevant |work |professional )?experience|experience \(?in years|how many years|overall experience/],
    ['current_company', /current\s*(company|employer|organi[sz]ation)|present (company|employer)|^company( name)?\b|^employer/],
    ['current_title', /current\s*(job\s*)?(title|designation|role|position)|designation|^job title|^title$/],
    ['pref_loc', /preferred\s*(job\s*)?(location|city)/],
    ['city', /current\s*(city|location)|^city\b|^location\b|where are you (based|located)|town/],
    ['full_name', /full\s*name|^name\b|your name|candidate name|legal name/],
    ['cover', /cover\s*letter|why (do you want|are you interested|this (role|company))|additional (info|information)|message to|tell us (about|why)/]
  ]
  const AUTOCOMPLETE: Record<string, string> = {
    'given-name': 'first_name', 'family-name': 'last_name', name: 'full_name', email: 'email', tel: 'phone', 'tel-national': 'phone',
    'address-level2': 'city', organization: 'current_company', 'organization-title': 'current_title', url: 'portfolio'
  }

  const norm = (s: string): string => (s || '').toLowerCase().replace(/[*:]/g, ' ').replace(/\s+/g, ' ').trim()
  const visible = (el: HTMLElement): boolean => {
    const r = el.getBoundingClientRect()
    const st = getComputedStyle(el)
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none'
  }

  function labelOf(el: HTMLElement): string {
    const parts: string[] = []
    if (el.id) {
      try {
        const rn = el.getRootNode() as Document | ShadowRoot
        const l = (rn.querySelector?.(`label[for="${CSS.escape(el.id)}"]`) || document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) as HTMLElement | null
        if (l) parts.push(l.innerText)
      } catch { /* bad id */ }
    }
    const wrap = el.closest('label') as HTMLElement | null
    if (wrap) parts.push(wrap.innerText)
    const by = el.getAttribute('aria-labelledby')
    if (by) by.split(/\s+/).forEach((id) => { const t = document.getElementById(id); if (t) parts.push(t.innerText) })
    parts.push(el.getAttribute('aria-label') || '', (el as HTMLInputElement).placeholder || '')
    if (!parts.join('').trim()) {
      // nearest preceding text in the field's container
      let n: HTMLElement | null = el
      for (let i = 0; i < 4 && n && !parts.join('').trim(); i++) {
        const prev = n.previousElementSibling as HTMLElement | null
        if (prev && prev.innerText && prev.innerText.trim() && prev.innerText.length < 200) { parts.push(prev.innerText); break }
        n = n.parentElement
        if (n && n.innerText && n.innerText.trim() && n.innerText.length < 160 && n !== document.body) parts.push(n.innerText)
      }
    }
    parts.push((el.getAttribute('name') || '').replace(/[_\-\[\].]/g, ' '), (el.id || '').replace(/[_\-]/g, ' '))
    return norm(parts.filter(Boolean).join(' | '))
  }

  function keyFor(el: HTMLElement, label: string): string | null {
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase()
    if (AUTOCOMPLETE[ac]) return AUTOCOMPLETE[ac]
    const primary = label.split(' | ')[0] || label
    for (const text of [primary, label]) for (const [k, re] of RULES) if (re.test(text)) return k
    return null
  }

  function fromAnswers(label: string, answers: { label: string; value: string }[]): string {
    let best = ''
    let bestScore = 0
    for (const a of answers) {
      const words = norm(a.label).split(' ').filter((x) => x.length > 2)
      if (!words.length) continue
      const hit = words.filter((x) => label.includes(x)).length / words.length
      if (hit > bestScore) { bestScore = hit; best = a.value }
    }
    return bestScore >= 0.6 ? best : ''
  }

  function setValue(el: HTMLInputElement | HTMLTextAreaElement, v: string): void {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.dispatchEvent(new Event('blur', { bubbles: true }))
  }

  function pickOption(sel: HTMLSelectElement, v: string): boolean {
    const want = norm(v)
    const num = (want.match(/\d+(\.\d+)?/) || [])[0]
    const opts = Array.from(sel.options).filter((o) => o.value !== '' && !/^(select|choose|--)/i.test(o.text.trim()))
    let o = opts.find((x) => norm(x.text) === want) || opts.find((x) => want && (norm(x.text).includes(want) || want.includes(norm(x.text))))
    if (!o && num) o = opts.find((x) => (norm(x.text).match(/\d+(\.\d+)?/) || [])[0] === num)
    if (!o) return false
    sel.value = o.value
    sel.dispatchEvent(new Event('input', { bubbles: true }))
    sel.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }

  function setEditable(el: HTMLElement, v: string): boolean {
    el.focus()
    const ok = document.execCommand && document.execCommand('insertText', false, v)
    if (!ok || !(el.innerText || '').trim()) el.innerText = v
    el.dispatchEvent(new InputEvent('input', { bubbles: true, data: v, inputType: 'insertText' }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  }

  const mark = (el: HTMLElement, color: string): void => {
    el.style.outline = `2px solid ${color}`
    el.style.outlineOffset = '1px'
  }

  async function fillHere(data: { values: Record<string, string>; answers: { label: string; value: string }[] }, ai: boolean): Promise<{ filled: number; missing: number; seen: number; drafted: number }> {
    const pending: { el: HTMLElement; label: string; required: boolean; options?: string[]; long: boolean }[] = []
    let drafted = 0
    let filled = 0
    let missing = 0
    const els: HTMLElement[] = []
    const walk = (root: Document | ShadowRoot): void => {
      root.querySelectorAll('input, textarea, select, [contenteditable="true"], [contenteditable=""], [role="textbox"]').forEach((e) => els.push(e as HTMLElement))
      root.querySelectorAll('*').forEach((e) => { if ((e as HTMLElement).shadowRoot) walk((e as HTMLElement).shadowRoot!) })
    }
    walk(document)
    let seen = 0
    for (const el of els) {
      if (el.closest('#__jh_host')) continue
      const editable = !/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)
      const input = el as HTMLInputElement
      const type = (input.type || '').toLowerCase()
      if (el.tagName === 'INPUT' && /^(hidden|password|submit|button|reset|checkbox|radio|file|image|search|range|color)$/.test(type)) continue
      if (input.disabled || input.readOnly || !visible(el)) continue
      seen++
      const label = labelOf(el)
      if (/password|captcha|otp|verification code/.test(label)) continue
      const required = input.required || el.getAttribute('aria-required') === 'true' || /\*/.test(label)
      const isSelect = el.tagName === 'SELECT'
      const empty = isSelect ? (el as HTMLSelectElement).selectedIndex <= 0 : editable ? !(el.innerText || '').trim() : !input.value.trim()
      if (!empty) continue
      const key = keyFor(el, label)
      let v = key ? data.values[key] || '' : ''
      if (!v) v = fromAnswers(label, data.answers)
      if (key === 'cover' && el.tagName !== 'TEXTAREA' && !editable) v = '' // long text only goes into big boxes
      if (v && type === 'number') {
        if (key === 'current_ctc' || key === 'expected_ctc') v = '' // unit is ambiguous (LPA vs rupees) — leave for the person
        else v = (v.match(/\d+(\.\d+)?/) || [''])[0]
      }
      if (v && type === 'tel' && input.maxLength === 10) v = v.replace(/\D/g, '').slice(-10)
      if (v && type === 'email' && !v.includes('@')) v = ''
      let ok = false
      if (v) ok = isSelect ? pickOption(el as HTMLSelectElement, v) : editable ? setEditable(el, v) : (setValue(input, v), true)
      if (ok) { mark(el, GREEN); filled++ }
      else if (!/captcha|otp/.test(label)) {
        const options = isSelect ? Array.from((el as HTMLSelectElement).options).map((o) => o.text.trim()).filter((t) => t && !/^(select|choose|--)/i.test(t)).slice(0, 30) : undefined
        pending.push({ el, label: label.split(' | ')[0].slice(0, 200), required, options, long: el.tagName === 'TEXTAREA' || editable })
      }
    }
    // questions we have no saved fact for: ask the AI for a draft, marked dashed amber for the person to check
    let answers: { i: number; value: string }[] = []
    if (ai && pending.length) {
      const qs = pending.map((q, i) => ({ i, label: q.label, options: q.options, long: q.long }))
      answers = await w.__jhAutofill('ask', qs).catch(() => [])
    }
    pending.forEach((q, i) => {
      const a = answers.find((x) => x.i === i)
      let ok = false
      if (a && a.value) {
        const el = q.el as HTMLInputElement
        ok = el.tagName === 'SELECT' ? pickOption(q.el as HTMLSelectElement, a.value) : !/^(INPUT|TEXTAREA)$/.test(el.tagName) ? setEditable(q.el, a.value) : (setValue(el, a.value), true)
      }
      if (ok) {
        q.el.style.outline = `2px dashed ${AMBER}`
        q.el.style.outlineOffset = '1px'
        q.el.title = 'Drafted by Job Hunter from your resume — check before submitting'
        drafted++
      } else if (q.required) { mark(q.el, AMBER); missing++ }
    })
    return { filled, missing, seen, drafted }
  }

  // ---- frame plumbing: the top page asks every frame to fill and adds up the results ----
  const children = (): Window[] => Array.from({ length: window.frames.length }, (_, i) => window.frames[i])
  async function fillTree(): Promise<{ filled: number; missing: number; seen: number; drafted: number; blocked?: string }> {
    const r = await w.__jhAutofill('data').catch(() => ({ blocked: 'other' }))
    const mine = r.data ? await fillHere(r.data, !!r.ai) : { filled: 0, missing: 0, seen: 0, drafted: 0 }
    const kids = children()
    if (!kids.length) return { ...mine, blocked: r.blocked }
    const id = Math.random().toString(36).slice(2)
    const got = await new Promise<{ filled: number; missing: number; seen: number; drafted: number }[]>((resolve) => {
      const out: { filled: number; missing: number; seen: number; drafted: number }[] = []
      const on = (e: MessageEvent): void => {
        if (e.data?.jh === 'filled' && e.data.id === id) out.push(e.data)
      }
      window.addEventListener('message', on)
      kids.forEach((k) => { try { k.postMessage({ jh: 'fill', id }, '*') } catch { /* gone */ } })
      setTimeout(() => { window.removeEventListener('message', on); resolve(out) }, 20000) // frames may be waiting on AI drafts
      const t0 = Date.now()
      const poll = setInterval(() => { if (out.length >= kids.length || Date.now() - t0 > 20000) { clearInterval(poll); window.removeEventListener('message', on); resolve(out) } }, 200)
    })
    const total = got.reduce((a, b) => ({ filled: a.filled + b.filled, missing: a.missing + b.missing, seen: a.seen + (b.seen || 0), drafted: a.drafted + (b.drafted || 0) }), mine)
    return { ...total, blocked: r.blocked }
  }
  window.addEventListener('message', async (e) => {
    if (e.data?.jh !== 'fill' || e.source !== window.parent) return
    const r = await fillTree()
    window.parent.postMessage({ jh: 'filled', id: e.data.id, filled: r.filled, missing: r.missing, seen: r.seen, drafted: r.drafted }, '*')
  })
  if (!isTop) return

  // ---- floating button + result card (shadow DOM so the site's CSS can't touch it) ----
  function mount(): void {
    if (!document.body || document.getElementById('__jh_host')) return
    const host = document.createElement('div')
    host.id = '__jh_host'
    host.style.cssText = 'position:fixed;right:24px;bottom:110px;z-index:2147483647' // above the macOS Dock when the window reaches the bottom of the screen
    const root = host.attachShadow({ mode: 'closed' })
    root.innerHTML = `<style>
      *{box-sizing:border-box;font:13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
      .btn{display:flex;align-items:center;gap:6px;padding:8px 14px;border:1px solid rgba(0,0,0,.12);border-radius:8px;background:#1d1d1f;color:#fff;font-weight:500;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.18)}
      .btn:hover{background:#000}.btn[disabled]{opacity:.7;cursor:default}
      .card{position:absolute;right:0;bottom:46px;width:300px;padding:12px 14px;border-radius:10px;border:1px solid rgba(0,0,0,.08);background:#fff;color:#1f2937;box-shadow:0 10px 30px rgba(0,0,0,.18);display:none}
      .card b{font-weight:600}.x{position:absolute;top:6px;right:8px;border:0;background:none;color:#9ca3af;cursor:pointer;font-size:15px}
      .g{color:#059669}.a{color:#b45309}.m{color:#6b7280;font-size:12px;margin-top:6px}
    </style>
    <div class="card"><button class="x" title="Hide">×</button><div class="body"></div></div>
    <button class="btn">Fill form</button>`
    const btn = root.querySelector('.btn') as HTMLButtonElement
    const card = root.querySelector('.card') as HTMLDivElement
    const body = root.querySelector('.body') as HTMLDivElement
    ;(root.querySelector('.x') as HTMLButtonElement).onclick = () => { card.style.display = 'none' }
    const show = (html: string): void => { body.innerHTML = html; card.style.display = 'block' }
    btn.onclick = async () => {
      btn.disabled = true
      btn.textContent = 'Filling…'
      try {
        const r = await fillTree()
        if (r.blocked === 'linkedin') show('<b>Autofill is off for LinkedIn.</b><div class="m">LinkedIn’s terms forbid automation. You can turn it on in Job Hunter → Settings, at your own risk.</div>')
        else if (r.blocked === 'account') show('<b>This looks like a sign-in or sign-up page.</b><div class="m">Job Hunter never fills these. Sign in yourself, then click Fill form on the application form.</div>')
        else if (r.seen === 0) show('<b>No form fields on this page.</b><div class="m">Open the application form first (click the site’s Apply button), then click Fill form.</div>')
        else {
          const files = await w.__jhAutofill('resume').catch(() => 0)
          show(
            `<b>Filled <span class="g">${r.filled}</span> field${r.filled === 1 ? '' : 's'}</b>` +
              (files ? ' · resume attached' : '') +
              (r.drafted ? `<div class="a">${r.drafted} answer${r.drafted === 1 ? '' : 's'} drafted from your resume (dashed) — read and edit them.</div>` : '') +
              (r.missing ? `<div class="a">${r.missing} required field${r.missing === 1 ? ' still needs' : 's still need'} you (amber).</div>` : '') +
              (r.filled === 0 ? `<div class="m">Saw ${r.seen} field${r.seen === 1 ? '' : 's'} but none matched your details. Tell Job Hunter which site this was.</div>` : '') +
              '<div class="m">Check every field, then submit yourself. On multi-step forms, click Fill form again on each step.</div>'
          )
        }
      } finally {
        btn.disabled = false
        btn.textContent = 'Fill form'
      }
    }
    document.body.appendChild(host)
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount)
  else mount()
  // single-page apps sometimes wipe <body>; put the button back
  setInterval(mount, 2000)
}
