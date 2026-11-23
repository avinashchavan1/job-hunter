import { ReactNode, useEffect, useState } from 'react'
import { FileText, RefreshCw, Save, Trash2, Upload } from 'lucide-react'
import { GmailConnect } from '../components/Gmail'
import { SiteLogin } from '../components/SiteLogin'
import { AnswersEditor, withDefaults } from '../components/Answers'
import type { Prefs, Profile, SourceKey } from '@shared/types'
import { Chip, ChipInput, Section, Spinner, Toggle } from '../ui'

const SOURCES: { key: SourceKey; label: string; hint: string }[] = [
  { key: 'job_api', label: 'Job search API', hint: 'JSearch / Adzuna — aggregates LinkedIn, Naukri, Indeed and company sites' },
  { key: 'gmail', label: 'Gmail job alerts', hint: 'Reads LinkedIn & Naukri alert emails (connect Gmail first)' },
  { key: 'linkedin', label: 'LinkedIn (browser)', hint: 'Read-only, 5–20 s between pages, max 40 pages/day. Stops on any CAPTCHA.' },
  { key: 'naukri', label: 'Naukri (browser)', hint: 'Read-only, 5–20 s between pages, max 40 pages/day. Stops on any CAPTCHA.' }
]

export function ProfilePage({ profile, onChange, onDeleted }: { profile: Profile; onChange: (p: Profile) => void; onDeleted: () => void }): ReactNode {
  const [prefs, setPrefs] = useState<Prefs>(profile.prefs)
  const [name, setName] = useState(profile.name)
  const [resume, setResume] = useState<string | null>(null)
  const [busy, setBusy] = useState<'' | 'save' | 'resume'>('')
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)
  const [oauthReady, setOauthReady] = useState(false)
  useEffect(() => {
    void window.api.secrets.status().then((st) => setOauthReady(st.GOOGLE_CLIENT_ID && st.GOOGLE_CLIENT_SECRET))
  }, [])

  useEffect(() => {
    setPrefs(profile.prefs)
    setName(profile.name)
    void window.api.profiles.resumeName(profile.id).then(setResume)
  }, [profile.id, profile.prefs, profile.name])

  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]): void => setPrefs((p) => ({ ...p, [k]: v }))
  const dirty = JSON.stringify(prefs) !== JSON.stringify(profile.prefs) || name !== profile.name

  const save = async (): Promise<void> => {
    setBusy('save')
    onChange(await window.api.profiles.update(profile.id, { prefs, name }))
    setBusy('')
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const upload = async (): Promise<void> => {
    setErr('')
    setBusy('resume')
    try {
      const p = await window.api.profiles.importResume(profile.id)
      onChange(p)
      setResume(await window.api.profiles.resumeName(profile.id))
    } catch (e: any) {
      setErr(String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    }
    setBusy('')
  }

  const pr = profile.profile
  return (
    <div className="mx-auto max-w-5xl space-y-5 px-8 py-6">
      <header className="flex items-end justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-brand-600 dark:text-brand-400">Profile</p>
          <input className="mt-1 bg-transparent text-2xl font-semibold tracking-tight outline-none" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <button className="btn btn-primary" disabled={!dirty || busy === 'save'} onClick={save}>
          {busy === 'save' ? <Spinner /> : <Save size={16} />} {saved ? 'Saved' : 'Save changes'}
        </button>
      </header>

      <Section
        title="Resume"
        desc="The AI reads it once and builds the profile used for scoring. Re-upload any time."
        right={
          <button className="btn btn-outline" onClick={upload} disabled={busy === 'resume'}>
            {busy === 'resume' ? <Spinner /> : resume ? <RefreshCw size={15} /> : <Upload size={15} />}
            {busy === 'resume' ? 'Reading resume…' : resume ? 'Replace resume' : 'Upload resume'}
          </button>
        }
      >
        {err && <p className="mb-3 rounded-xl bg-rose-400/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">{err}</p>}
        {pr ? (
          <div className="grid grid-cols-3 gap-5 text-sm">
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-ink-300"><FileText size={15} /> {resume}</div>
              <Info k="Current title" v={pr.current_title} />
              <Info k="Experience" v={`${pr.years_experience} years · ${pr.seniority}`} />
              <Info k="Location" v={pr.current_location} />
              <Info k="Education" v={pr.education} />
            </div>
            <div className="col-span-2 space-y-3">
              <p className="text-ink-300">{pr.summary}</p>
              <div>
                <h4 className="label">Skills</h4>
                <div className="flex flex-wrap gap-1.5">{[...pr.skills, ...pr.tools_and_modules].slice(0, 30).map((s) => <Chip key={s}>{s}</Chip>)}</div>
              </div>
              <div>
                <h4 className="label">Domains</h4>
                <div className="flex flex-wrap gap-1.5">{pr.domains.map((s) => <Chip key={s} tone="brand">{s}</Chip>)}</div>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-400">No resume yet. Upload a PDF or DOCX to get started.</p>
        )}
      </Section>

      <Section title="What to look for" desc="Used to build searches and as hard filters before anything is sent to the AI.">
        <div className="grid grid-cols-2 gap-5">
          <div className="col-span-2">
            <label className="label">Target job titles</label>
            <ChipInput value={prefs.target_titles} onChange={(v) => set('target_titles', v)} placeholder="e.g. SAP EWM Consultant — press Enter" />
            {pr && pr.suggested_search_titles.some((t) => !prefs.target_titles.includes(t)) && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-ink-400">
                Suggestions:
                {pr.suggested_search_titles.filter((t) => !prefs.target_titles.includes(t)).map((t) => (
                  <button key={t} className="rounded-lg border border-dashed border-line-strong px-2 py-0.5 hover:border-brand-500/50 hover:text-brand-600 dark:hover:text-brand-400" onClick={() => set('target_titles', [...prefs.target_titles, t])}>
                    + {t}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="label">Cities</label>
            <ChipInput value={prefs.locations} onChange={(v) => set('locations', v)} placeholder="Bangalore, Hyderabad…" />
            <div className="mt-3"><Toggle checked={prefs.remote_ok} onChange={(v) => set('remote_ok', v)} label="Include remote jobs" /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">My years</label>
              <input type="number" className="field" value={prefs.years_experience} onChange={(e) => set('years_experience', Number(e.target.value))} />
            </div>
            <div>
              <label className="label">Min asked</label>
              <input type="number" className="field" value={prefs.years_min} onChange={(e) => set('years_min', Number(e.target.value))} />
            </div>
            <div>
              <label className="label">Max asked</label>
              <input type="number" className="field" value={prefs.years_max} onChange={(e) => set('years_max', Number(e.target.value))} />
            </div>
            <p className="col-span-3 -mt-1 text-xs text-ink-400">Postings that require more than “Max asked” years are dropped.</p>
          </div>
          <div>
            <label className="label">Expected salary (LPA)</label>
            <input type="number" className="field" value={prefs.min_salary_lpa} onChange={(e) => set('min_salary_lpa', Number(e.target.value))} />
            <div className="mt-3 space-y-2.5">
              <Toggle checked={prefs.drop_below_min_salary} onChange={(v) => set('drop_below_min_salary', v)} label="Drop jobs that list a lower salary" hint="Off = keep everything; low pay shows as a red flag instead." />
              <Toggle checked={prefs.keep_unknown_salary} onChange={(v) => set('keep_unknown_salary', v)} label="Keep jobs with no salary listed" />
            </div>
          </div>
          <div>
            <label className="label">Minimum match score · {prefs.min_score}</label>
            <input type="range" min={0} max={100} step={5} value={prefs.min_score} onChange={(e) => set('min_score', Number(e.target.value))} className="w-full accent-brand-500" />
            <p className="mt-1 text-xs text-ink-400">Jobs at or above this show under “Strong”.</p>
          </div>
          <div>
            <label className="label">Exclude keywords</label>
            <ChipInput value={prefs.exclude_keywords} onChange={(v) => set('exclude_keywords', v)} placeholder="night shift, unpaid…" />
          </div>
          <div>
            <label className="label">Exclude companies</label>
            <ChipInput value={prefs.exclude_companies} onChange={(v) => set('exclude_companies', v)} placeholder="Current employer, agencies…" />
          </div>
        </div>
      </Section>

      <Section title="Saved answers" desc="Common application questions. Copy them with one click from any job.">
        <AnswersEditor value={withDefaults(prefs.answers ?? [], { ...profile, prefs })} onChange={(v) => set('answers', v)} />
      </Section>

      <Section title="Sources" desc="Where to look. The app never applies, never creates accounts, never asks for passwords.">
        <div className="grid grid-cols-2 gap-4">
          {SOURCES.map((s) => (
            <div key={s.key} className="rounded-xl border border-line bg-ink-850/60 p-3.5">
              <Toggle checked={prefs.sources[s.key]} onChange={(v) => set('sources', { ...prefs.sources, [s.key]: v })} label={s.label} hint={s.hint} />
              {(s.key === 'naukri' || s.key === 'linkedin') && (
                <SiteLogin profile={profile} site={s.key} onChange={async () => { const p = await window.api.profiles.get(profile.id); if (p) onChange(p) }} />
              )}
              {s.key === 'gmail' && (
                <GmailConnect
                  profile={profile}
                  oauthReady={oauthReady}
                  onChange={async () => {
                    const p = await window.api.profiles.get(profile.id)
                    if (p) onChange(p)
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </Section>

      <div className="flex items-center justify-between pb-4">
        <Toggle checked={profile.active} onChange={async (v) => onChange(await window.api.profiles.update(profile.id, { active: v }))} label="Include in the daily run" />
        <button
          className="btn btn-ghost text-rose-700 dark:text-rose-300 hover:!bg-rose-400/10 hover:!text-rose-700"
          onClick={async () => {
            if (confirm(`Delete profile “${profile.name}” and all its matches? This cannot be undone.`)) {
              await window.api.profiles.remove(profile.id)
              onDeleted()
            }
          }}
        >
          <Trash2 size={15} /> Delete profile
        </button>
      </div>
    </div>
  )
}

function Info({ k, v }: { k: string; v: string }): ReactNode {
  return (
    <div>
      <div className="text-xs text-ink-400">{k}</div>
      <div className="text-ink-100">{v || '–'}</div>
    </div>
  )
}
