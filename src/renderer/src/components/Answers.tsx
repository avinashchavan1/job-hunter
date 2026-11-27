import { ReactNode } from 'react'
import { Plus, X } from 'lucide-react'
import type { Prefs, Profile } from '@shared/types'
import { CopyButton } from '../ui'

/** Fill obvious blanks from the parsed resume / preferences. */
export function withDefaults(answers: Prefs['answers'], p: Profile): Prefs['answers'] {
  const guess: Record<string, string> = {
    'Total experience': p.profile ? `${p.profile.years_experience} years` : '',
    'Preferred locations': [...p.prefs.locations, p.prefs.remote_ok ? 'Remote' : ''].filter(Boolean).join(', '),
    'Expected CTC': p.prefs.min_salary_lpa ? `${p.prefs.min_salary_lpa} LPA` : ''
  }
  return answers.map((a) => (a.value ? a : { ...a, value: guess[a.label] ?? '' }))
}

export function AnswersEditor({ value, onChange }: { value: Prefs['answers']; onChange: (v: Prefs['answers']) => void }): ReactNode {
  const set = (i: number, patch: Partial<Prefs['answers'][number]>): void => onChange(value.map((a, j) => (j === i ? { ...a, ...patch } : a)))
  return (
    <div className="space-y-2.5">
      {value.map((a, i) => (
        <div key={i} className="grid grid-cols-1 sm:grid-cols-[220px_1fr_auto] items-start gap-2">
          <input className="field !py-1.5 text-xs font-medium" value={a.label} onChange={(e) => set(i, { label: e.target.value })} />
          <textarea className="field !py-1.5 text-sm" rows={a.value.length > 80 ? 3 : 1} value={a.value} placeholder="Your answer" onChange={(e) => set(i, { value: e.target.value })} />
          <button className="mt-1.5 rounded p-1 text-ink-400 hover:bg-hover hover:text-rose-700 dark:hover:text-rose-300" title="Remove" onClick={() => onChange(value.filter((_, j) => j !== i))}><X size={14} /></button>
        </div>
      ))}
      <button className="btn btn-ghost !px-2 !py-1 text-xs" onClick={() => onChange([...value, { label: 'New question', value: '' }])}><Plus size={14} /> Add answer</button>
    </div>
  )
}

/** Compact copy row shown on each job. */
export function QuickAnswers({ answers }: { answers: Prefs['answers'] }): ReactNode {
  const filled = answers.filter((a) => a.value.trim())
  if (!filled.length) return null
  return (
    <div>
      <h4 className="label">Quick answers</h4>
      <div className="flex flex-wrap gap-1.5">
        {filled.map((a) => (
          <span key={a.label} className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-ink-850 py-0.5 pl-2 pr-0.5 text-xs text-ink-300" title={a.value}>
            {a.label}
            <CopyButton text={a.value} label="" />
          </span>
        ))}
      </div>
    </div>
  )
}
