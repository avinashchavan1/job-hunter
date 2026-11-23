import { ReactNode, useState, KeyboardEvent } from 'react'
import { Check, Copy, Loader2, X } from 'lucide-react'

export const cx = (...c: (string | false | null | undefined)[]): string => c.filter(Boolean).join(' ')

export function scoreTone(s: number | null): { ring: string; text: string; bg: string } {
  if (s == null) return { ring: '#343b4d', text: 'text-ink-400', bg: 'bg-ink-700/40' }
  if (s >= 80) return { ring: '#34d399', text: 'text-emerald-300', bg: 'bg-emerald-400/10' }
  if (s >= 65) return { ring: '#8b9dff', text: 'text-brand-400', bg: 'bg-brand-500/10' }
  if (s >= 50) return { ring: '#fbbf24', text: 'text-amber-300', bg: 'bg-amber-400/10' }
  return { ring: '#f87171', text: 'text-rose-300', bg: 'bg-rose-400/10' }
}

export function ScoreRing({ score, size = 52 }: { score: number | null; size?: number }): ReactNode {
  const r = size / 2 - 4
  const c = 2 * Math.PI * r
  const t = scoreTone(score)
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="#232938" strokeWidth={4} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={t.ring}
          strokeWidth={4}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (c * (score ?? 0)) / 100}
          style={{ transition: 'stroke-dashoffset .6s ease' }}
        />
      </svg>
      <div className={cx('absolute inset-0 grid place-items-center text-sm font-semibold tabular-nums', t.text)}>{score ?? '–'}</div>
    </div>
  )
}

export function Chip({ children, tone = 'default', onRemove }: { children: ReactNode; tone?: 'default' | 'brand' | 'warn' | 'good' | 'bad'; onRemove?: () => void }): ReactNode {
  const tones = {
    default: 'bg-white/[0.05] text-ink-300 border-white/[0.06]',
    brand: 'bg-brand-500/10 text-brand-400 border-brand-500/20',
    warn: 'bg-amber-400/10 text-amber-300 border-amber-400/20',
    good: 'bg-emerald-400/10 text-emerald-300 border-emerald-400/20',
    bad: 'bg-rose-400/10 text-rose-300 border-rose-400/20'
  }
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-xs', tones[tone])}>
      {children}
      {onRemove && (
        <button onClick={onRemove} className="-mr-0.5 rounded hover:text-white">
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
        className={cx('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition', checked ? 'bg-brand-600' : 'bg-ink-600')}
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
      {done ? <Check size={14} className="text-emerald-300" /> : <Copy size={14} />}
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
    <section className="card p-5">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {desc && <p className="mt-0.5 text-xs text-ink-400">{desc}</p>}
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
