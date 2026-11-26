import { ReactNode, useEffect, useState } from 'react'
import type { AppSettings, Profile, SecretKey } from '@shared/types'
import { Section, Toggle, cx } from '../ui'
import { ExtLink, KeyField } from '../components/KeyField'
import { AiEngine } from '../components/AiEngine'
import { GmailSetup } from '../components/Gmail'
import { RunsPage } from './RunsPage'
import { HealthPage } from './HealthPage'

type Tab = 'general' | 'sources' | 'advanced' | 'activity' | 'health'

export function SettingsPage({ secrets, setSecrets, profile, running }: { secrets: Record<SecretKey, boolean>; setSecrets: (s: Record<SecretKey, boolean>) => void; profile: Profile; running: boolean }): ReactNode {
  const [s, setS] = useState<AppSettings | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('general')

  useEffect(() => {
    void window.api.settings.get().then(setS)
    void window.api.run.status().then((r) => setNext(r.nextRunAt))
  }, [])
  if (!s) return null

  const save = async (patch: Partial<AppSettings>): Promise<void> => {
    setS(await window.api.settings.save(patch))
    setNext((await window.api.run.status()).nextRunAt)
  }
  const tabs: { key: Tab; label: string }[] = [
    { key: 'general', label: 'General' },
    { key: 'sources', label: 'Job sources' },
    { key: 'advanced', label: 'Advanced' },
    { key: 'activity', label: 'Activity' },
    { key: 'health', label: 'Health' }
  ]
  const nextLabel = next ? new Date(next).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }) : null

  return (
    <div className="mx-auto max-w-4xl px-8 pb-10 pt-4">
      <h1 className="h-page">Settings</h1>
      <nav className="mb-6 mt-4 flex gap-5 border-b border-line">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cx('-mb-px border-b-2 pb-2 text-[13px] transition', tab === t.key ? 'border-ink-100 font-medium text-ink-100' : 'border-transparent text-ink-400 hover:text-ink-100')}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'general' && (
        <div>
          <Section title="Daily check" desc={s.schedule.enabled && nextLabel ? `Next: ${nextLabel}` : 'Off — use Check for jobs on the Today screen.'}>
            <div className="flex items-start gap-6">
              <div className="flex-1 space-y-3">
                <Toggle checked={s.schedule.enabled} onChange={(v) => save({ schedule: { ...s.schedule, enabled: v } })} label="Look for new jobs every day" hint="Runs while Job Hunter is open in the menu bar / system tray. Catches up if the computer was asleep." />
                <Toggle checked={s.notify} onChange={(v) => save({ notify: v })} label="Notify me when new matches are found" />
                <Toggle checked={s.openAtLogin} onChange={async (v) => setS(await window.api.settings.setOpenAtLogin(v))} label="Start Job Hunter when I log in" />
              </div>
              <div>
                <label className="label">Time</label>
                <input type="time" className="field w-32" value={s.schedule.time} onChange={(e) => save({ schedule: { ...s.schedule, time: e.target.value } })} />
              </div>
            </div>
          </Section>

          <Section title="Applying" desc="Apply opens the job in Job Hunter's own Chrome window with a Fill form button. It fills what it knows, you check and press Submit yourself. It never submits, and never touches sign-in or sign-up pages.">
            <div className="space-y-3">
              <Toggle checked={s.autofill.aiAnswers} onChange={(v) => save({ autofill: { ...s.autofill, aiAnswers: v } })} label="Draft answers to other questions" hint="Questions with no saved answer get a draft written from the resume, outlined with a dashed border so you read it. Never used for gender, age, caste, disability or similar." />
              <Toggle checked={s.autofill.linkedin} onChange={(v) => save({ autofill: { ...s.autofill, linkedin: v } })} label="Allow Fill form on LinkedIn" hint="Off by default. LinkedIn’s terms forbid automation and accounts can be restricted." />
            </div>
          </Section>

          <Section title="AI engine" desc="Reads resumes, scores jobs, writes cover notes, tailored resumes and interview prep.">
            <AiEngine settings={s} setSettings={setS} secrets={secrets} setSecrets={setSecrets} />
          </Section>
        </div>
      )}

      {tab === 'sources' && (
        <div>
          <Section title="Job search API" desc="The main source. Pulls postings from LinkedIn, Naukri, Indeed and company sites through an API that allows it. Free plan is enough.">
            {s.jobApi.provider === 'jsearch' ? (
              <KeyField k="RAPIDAPI_KEY" label="RapidAPI key (JSearch)" isSet={secrets.RAPIDAPI_KEY} onSaved={setSecrets} test="job_api"
                help={<>Sign up at <ExtLink href="https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch">RapidAPI → JSearch</ExtLink>, subscribe to the free Basic plan, copy “X-RapidAPI-Key”.</>} />
            ) : (
              <div className="space-y-4">
                <KeyField k="ADZUNA_APP_ID" label="Adzuna app id" isSet={secrets.ADZUNA_APP_ID} onSaved={setSecrets} help={<>Register at <ExtLink href="https://developer.adzuna.com/signup">developer.adzuna.com</ExtLink>.</>} />
                <KeyField k="ADZUNA_APP_KEY" label="Adzuna app key" isSet={secrets.ADZUNA_APP_KEY} onSaved={setSecrets} test="job_api" />
              </div>
            )}
          </Section>
          <Section title="Gmail job alerts" desc="One-time setup. Then each person connects their own inbox (read-only) from their Profile.">
            <GmailSetup secrets={secrets} setSecrets={setSecrets} />
          </Section>
          <p className="text-xs text-ink-400">Naukri and LinkedIn sign-in is per person: Profile → Sources.</p>
        </div>
      )}

      {tab === 'advanced' && (
        <div>
          <Section title="Search">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="label">Job API</label>
                <select className="field" value={s.jobApi.provider} onChange={(e) => save({ jobApi: { ...s.jobApi, provider: e.target.value as any } })}>
                  <option value="jsearch">JSearch (RapidAPI)</option><option value="adzuna">Adzuna</option>
                </select>
              </div>
              <div>
                <label className="label">Searches per person per run</label>
                <input type="number" className="field" value={s.jobApi.maxQueriesPerRun} onChange={(e) => save({ jobApi: { ...s.jobApi, maxQueriesPerRun: Number(e.target.value) } })} />
              </div>
              <div>
                <label className="label">Posted within</label>
                <select className="field" value={s.jobApi.datePosted} onChange={(e) => save({ jobApi: { ...s.jobApi, datePosted: e.target.value as any } })}>
                  <option value="today">Today</option><option value="3days">3 days</option><option value="week">Week</option><option value="month">Month</option>
                </select>
              </div>
              <div>
                <label className="label">Max jobs scored per run</label>
                <input type="number" className="field" value={s.scoring.maxJobsPerRun} onChange={(e) => save({ scoring: { maxJobsPerRun: Number(e.target.value) } })} />
              </div>
            </div>
            <div className="mt-4"><Toggle checked={s.schedule.weekdaysOnly} onChange={(v) => save({ schedule: { ...s.schedule, weekdaysOnly: v } })} label="Daily check on weekdays only" /></div>
          </Section>
          <Section title="Naukri / LinkedIn reading" desc="Read-only and slow on purpose. Stops on any CAPTCHA, login wall or unusual-activity page.">
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
            <div className="mt-4"><Toggle checked={s.browser.showWindow} onChange={(v) => save({ browser: { ...s.browser, showWindow: v } })} label="Show the Chrome window while reading" /></div>
          </Section>
        </div>
      )}

      {tab === 'activity' && <RunsPage profile={profile} running={running} embedded />}
      {tab === 'health' && <HealthPage running={running} embedded />}
    </div>
  )
}
