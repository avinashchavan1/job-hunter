import { ReactNode, useState, KeyboardEvent } from 'react'
import { Check, Copy, Loader2, X } from 'lucide-react'

export const cx = (...c: (string | false | null | undefined)[]): string => c.filter(Boolean).join(' ')

export function scoreTone(s: number | null): { text: string; bar: string } {
  if (s == null) return { text: 'text-ink-400', bar: 'bg-ink-600' }
  if (s >= 75) return { text: 'text-emerald-700 dark:text-emerald-400', bar: 'bg-emerald-600 dark:bg-emerald-400' }
  if (s >= 50) return { text: 'text-ink-100', bar: 'bg-ink-300' }
  return { text: 'text-ink-400', bar: 'bg-ink-600' }
}

/** Plain score: the number plus a thin bar. (Name kept for older call sites.) */
export function ScoreRing({ score, size = 44 }: { score: number | null; size?: number }): ReactNode {
  const t = scoreTone(score)
  return (
    <div className="shrink-0 text-center" style={{ width: size }} title={score == null ? 'Not scored yet' : `Fit score ${score}/100`}>
      <div className={cx('text-[15px] font-semibold tabular-nums leading-none', t.text)}>{score ?? '–'}</div>
      <div className="mx-auto mt-1.5 h-[3px] w-7 overflow-hidden rounded-full bg-ink-700">
        <div className={cx('h-full rounded-full', t.bar)} style={{ width: `${score ?? 0}%` }} />
      </div>
    </div>
  )
}

export function Chip({ children, tone = 'default', onRemove }: { children: ReactNode; tone?: 'default' | 'brand' | 'warn' | 'good' | 'bad'; onRemove?: () => void }): ReactNode {
  const tones = {
    default: 'text-ink-300 border-line-strong',
    brand: 'text-ink-100 border-line-strong',
    warn: 'text-amber-800 dark:text-amber-300 border-amber-500/40',
    good: 'text-emerald-800 dark:text-emerald-300 border-emerald-600/35',
    bad: 'text-rose-800 dark:text-rose-300 border-rose-500/40'
  }
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-md border px-1.5 py-px text-[11.5px]', tones[tone])}>
      {children}
      {onRemove && (
        <button onClick={onRemove} className="-mr-0.5 rounded hover:text-ink-100">
          <X size={12} />
        </button>
      )}
    </span>
  )
}

export function ChipInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }): ReactNode {
  const [text, setText] = useState('')
  const add = (): void => {
    const parts = text.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length) onChange([...value, ...parts.filter((p) => !value.includes(p))])
    setText('')
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      add()
    } else if (e.key === 'Backspace' && !text && value.length) onChange(value.slice(0, -1))
  }
  return (
    <div className="field flex min-h-[42px] flex-wrap items-center gap-1.5 !py-1.5">
      {value.map((v) => (
        <Chip key={v} tone="brand" onRemove={() => onChange(value.filter((x) => x !== v))}>
          {v}
        </Chip>
      ))}
      <input
        className="min-w-[120px] flex-1 bg-transparent py-0.5 text-sm outline-none placeholder:text-ink-400"
        value={text}
        placeholder={value.length ? '' : placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKey}
        onBlur={add}
      />
    </div>
  )
}

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; hint?: ReactNode }): ReactNode {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition', checked ? 'bg-emerald-600' : 'bg-ink-600')}
      >
        <span className={cx('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
      {(label || hint) && (
        <span>
          {label && <span className="block text-sm text-ink-100">{label}</span>}
          {hint && <span className="block text-xs text-ink-400">{hint}</span>}
        </span>
      )}
    </label>
  )
}

export function Spinner({ size = 16 }: { size?: number }): ReactNode {
  return <Loader2 size={size} className="animate-spin" />
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }): ReactNode {
  const [done, setDone] = useState(false)
  return (
    <button
      className="btn btn-outline !px-2.5 !py-1.5 text-xs"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        setDone(true)
        setTimeout(() => setDone(false), 1500)
      }}
    >
      {done ? <Check size={14} className="text-emerald-700 dark:text-emerald-300" /> : <Copy size={14} />}
      {label ? (done ? 'Copied' : label) : null}
    </button>
  )
}

export function Stat({ label, value, sub, icon }: { label: string; value: ReactNode; sub?: ReactNode; icon?: ReactNode }): ReactNode {
  return (
    <div className="card px-4 py-3.5">
      <div className="flex items-center justify-between text-xs text-ink-400">
        {label}
        {icon}
      </div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-400">{sub}</div>}
    </div>
  )
}

export function Section({ title, desc, children, right }: { title: string; desc?: ReactNode; children: ReactNode; right?: ReactNode }): ReactNode {
  return (
    <section className="border-t border-line py-6 first:border-t-0 first:pt-0">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="max-w-xl">
          <h3 className="text-[13px] font-semibold">{title}</h3>
          {desc && <p className="mt-0.5 text-xs leading-relaxed text-ink-400">{desc}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return ''
  const t = new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso).getTime()
  const d = (Date.now() - t) / 1000
  if (d < 60) return 'just now'
  if (d < 3600) return `${Math.floor(d / 60)}m ago`
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`
  const days = Math.floor(d / 86400)
  return days === 1 ? 'yesterday' : `${days}d ago`
}
