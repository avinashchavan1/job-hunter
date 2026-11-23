import { ReactNode, useEffect, useRef, useState } from 'react'
import { Terminal } from 'lucide-react'
import { Spinner, cx } from '../ui'

export function RunLog({ profileId, running }: { profileId: number; running: boolean }): ReactNode {
  const [lines, setLines] = useState<string[]>([])
  const [show, setShow] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLines([])
    return window.api.run.onProgress((e) => {
      if (e.profileId !== profileId || !e.line) return
      setShow(true)
      setLines((l) => [...l.slice(-300), e.line])
    })
  }, [profileId])
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight })
  }, [lines])

  if (!show && !running) return null
  const last = lines[lines.length - 1]
  return (
    <div className="card overflow-hidden">
      <button className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-xs text-ink-300" onClick={() => setShow(!show)}>
        {running ? <Spinner size={14} /> : <Terminal size={14} />}
        <span className="font-medium">{running ? 'Searching…' : 'Last run'}</span>
        <span className="truncate text-ink-400">{last}</span>
      </button>
      <div ref={box} className={cx('selectable max-h-48 overflow-auto border-t border-line bg-ink-950/60 px-4 py-2 font-mono text-[11px] leading-5 text-ink-300', !show && 'hidden')}>
        {lines.map((l, i) => (
          <div key={i} className={cx(l.includes('[stop]') && 'text-rose-700 dark:text-rose-300', l.includes('[warn]') && 'text-amber-700 dark:text-amber-300', l.startsWith('scored') && 'text-ink-100')}>
            {l}
          </div>
        ))}
      </div>
    </div>
  )
}
