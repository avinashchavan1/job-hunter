import { ReactNode, useEffect, useState } from 'react'
import type { AppSettings, SecretKey } from '@shared/types'
import { Section, Toggle } from '../ui'
import { ExtLink, KeyField } from '../components/KeyField'
import { AiEngine } from '../components/AiEngine'
import { GmailSetup } from '../components/Gmail'

export function SettingsPage({ secrets, setSecrets }: { secrets: Record<SecretKey, boolean>; setSecrets: (s: Record<SecretKey, boolean>) => void }): ReactNode {
  const [s, setS] = useState<AppSettings | null>(null)
  const [next, setNext] = useState<string | null>(null)

  useEffect(() => {
    void window.api.settings.get().then(setS)
    void window.api.run.status().then((r) => setNext(r.nextRunAt))
  }, [])
  if (!s) return null

  const save = async (patch: Partial<AppSettings>): Promise<void> => {
    setS(await window.api.settings.save(patch))
    setNext((await window.api.run.status()).nextRunAt)
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-8 py-6">
      <header>
        <p className="text-xs font-medium uppercase tracking-wider text-brand-600 dark:text-brand-400">Settings</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">App settings</h1>
        <p className="mt-1 text-sm text-ink-400">Shared by every profile on this computer. Keys are encrypted with your system keychain and never leave this machine except to the service they belong to.</p>
      </header>

      <Section title="AI engine" desc="Reads resumes, scores jobs and writes cover notes.">
        <AiEngine settings={s} setSettings={setS} secrets={secrets} setSecrets={setSecrets} />
        <div className="mt-4 w-1/2 pr-2">
          <label className="label">Max jobs scored per profile per run</label>
          <input type="number" className="field" value={s.scoring.maxJobsPerRun} onChange={(e) => save({ scoring: { maxJobsPerRun: Number(e.target.value) } })} />
        </div>
      </Section>

      <Section title="Job search API">
        <div className="mb-4 flex gap-1 rounded-xl bg-ink-850 p-1 w-fit">
          {(['jsearch', 'adzuna'] as const).map((p) => (
            <button key={p} onClick={() => save({ jobApi: { ...s.jobApi, provider: p } })}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${s.jobApi.provider === p ? 'bg-ink-900 text-ink-100 shadow-sm' : 'text-ink-400'}`}>
              {p === 'jsearch' ? 'JSearch (RapidAPI)' : 'Adzuna'}
            </button>
          ))}
        </div>
        {s.jobApi.provider === 'jsearch' ? (
          <KeyField k="RAPIDAPI_KEY" label="RapidAPI key" isSet={secrets.RAPIDAPI_KEY} onSaved={setSecrets} test="job_api"
            help={<>Sign up at <ExtLink href="https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch">RapidAPI → JSearch</ExtLink>, subscribe to the free Basic plan, copy “X-RapidAPI-Key”.</>} />
        ) : (
          <div className="space-y-4">
            <KeyField k="ADZUNA_APP_ID" label="Adzuna app id" isSet={secrets.ADZUNA_APP_ID} onSaved={setSecrets}
              help={<>Register at <ExtLink href="https://developer.adzuna.com/signup">developer.adzuna.com</ExtLink>.</>} />
            <KeyField k="ADZUNA_APP_KEY" label="Adzuna app key" isSet={secrets.ADZUNA_APP_KEY} onSaved={setSecrets} test="job_api" />
          </div>
        )}
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div>
            <label className="label">Searches per profile per run</label>
            <input type="number" className="field" value={s.jobApi.maxQueriesPerRun} onChange={(e) => save({ jobApi: { ...s.jobApi, maxQueriesPerRun: Number(e.target.value) } })} />
            <p className="mt-1 text-xs text-ink-400">titles × cities, capped to stay inside free quotas</p>
          </div>
          <div>
            <label className="label">Posted within</label>
            <select className="field" value={s.jobApi.datePosted} onChange={(e) => save({ jobApi: { ...s.jobApi, datePosted: e.target.value as any } })}>
              <option value="today">Today</option><option value="3days">3 days</option><option value="week">Week</option><option value="month">Month</option>
            </select>
          </div>
        </div>
      </Section>

      <Section title="Gmail (job-alert emails)" desc="One-time setup so each profile can connect its own inbox, read-only.">
        <GmailSetup secrets={secrets} setSecrets={setSecrets} />
      </Section>

      <Section title="Daily schedule" desc={next ? `Next run: ${new Date(next).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}` : 'Off'}>
        <div className="grid grid-cols-2 gap-5">
          <div className="space-y-3">
            <Toggle checked={s.schedule.enabled} onChange={(v) => save({ schedule: { ...s.schedule, enabled: v } })} label="Run automatically every day" hint="Runs while Job Hunter is open (it lives in the menu bar). If the Mac was asleep, it catches up when it wakes." />
            <Toggle checked={s.schedule.weekdaysOnly} onChange={(v) => save({ schedule: { ...s.schedule, weekdaysOnly: v } })} label="Weekdays only" />
            <Toggle checked={s.notify} onChange={(v) => save({ notify: v })} label="Notify me when a run finishes" />
            <Toggle checked={s.openAtLogin} onChange={async (v) => setS(await window.api.settings.setOpenAtLogin(v))} label="Open at login (hidden, menu bar)" hint="Adds Job Hunter to your login items so the schedule never misses a day." />
          </div>
          <div>
            <label className="label">Time</label>
            <input type="time" className="field w-40" value={s.schedule.time} onChange={(e) => save({ schedule: { ...s.schedule, time: e.target.value } })} />
          </div>
        </div>
      </Section>

      <Section title="Browser sources (LinkedIn, Naukri)" desc="Read-only, human-paced. Stops and alerts on any CAPTCHA, login wall or unusual-activity page.">
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">Pages per site per day</label>
            <input type="number" className="field" value={s.browser.pagesPerSitePerDay} onChange={(e) => save({ browser: { ...s.browser, pagesPerSitePerDay: Number(e.target.value) } })} />
          </div>
          <div>
            <label className="label">Min delay (s)</label>
            <input type="number" className="field" value={s.browser.minDelayS} onChange={(e) => save({ browser: { ...s.browser, minDelayS: Math.max(5, Number(e.target.value)) } })} />
          </div>
          <div>
            <label className="label">Max delay (s)</label>
            <input type="number" className="field" value={s.browser.maxDelayS} onChange={(e) => save({ browser: { ...s.browser, maxDelayS: Number(e.target.value) } })} />
          </div>
        </div>
        <div className="mt-4">
          <Toggle checked={s.browser.showWindow} onChange={(v) => save({ browser: { ...s.browser, showWindow: v } })} label="Show the Chrome window while reading" hint="Off = runs in the background. Turn on to watch what it does." />
        </div>
      </Section>
    </div>
  )
}
