import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

/* ---------------------------------- Toasts --------------------------------- */
type Toast = { id: number; msg: string; kind: 'ok' | 'erro' | 'info' }
const ToastCtx = createContext<(msg: string, kind?: Toast['kind']) => void>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([])
  const seq = useRef(0)
  const push = useCallback((msg: string, kind: Toast['kind'] = 'ok') => {
    const id = ++seq.current
    setList(l => [...l, { id, msg, kind }])
    setTimeout(() => setList(l => l.filter(t => t.id !== id)), 3200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 space-y-2 px-4">
        {list.map(t => (
          <div
            key={t.id}
            className={`rounded-lg px-4 py-2 text-sm text-white shadow-lg ${
              t.kind === 'ok' ? 'bg-brand-600' : t.kind === 'erro' ? 'bg-red-600' : 'bg-slate-800'
            }`}
          >
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

/* --------------------------------- Diversos -------------------------------- */
export const Spinner = ({ className = '' }: { className?: string }) => (
  <span
    className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
  />
)

export const Loading = ({ label = 'A carregar…' }: { label?: string }) => (
  <div className="flex items-center justify-center gap-3 py-16 text-slate-500">
    <Spinner /> {label}
  </div>
)

export const Empty = ({ children }: { children: ReactNode }) => (
  <div className="rounded-xl border border-dashed border-slate-300 bg-white/60 px-6 py-12 text-center text-sm text-slate-500">
    {children}
  </div>
)

export function StatCard({
  label, value, hint, tone = 'default',
}: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'default' | 'brand' | 'warn' }) {
  const tones = {
    default: 'bg-white',
    brand: 'bg-brand-50 border-brand-200',
    warn: 'bg-amber-50 border-amber-200',
  }
  return (
    <div className={`card p-4 ${tones[tone]}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  )
}

export function Modal({
  open, onClose, title, children, wide,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
         onClick={onClose}>
      <div
        className={`w-full ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'} max-h-[92vh] overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl`}
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold">{title}</h3>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

/** Input numérico tolerante a vírgula decimal (pt-PT). */
export function NumInput({
  value, onChange, className = '', ...rest
}: {
  value: number
  onChange: (n: number) => void
  className?: string
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [txt, setTxt] = useState<string | null>(null)
  const shown = txt ?? (value === 0 ? '' : String(value).replace('.', ','))
  return (
    <input
      {...rest}
      inputMode="decimal"
      className={`input text-right tabular-nums ${className}`}
      value={shown}
      onFocus={e => e.currentTarget.select()}
      onChange={e => {
        const raw = e.target.value.replace(/[^0-9,.\-]/g, '')
        setTxt(raw)
        const n = Number(raw.replace(',', '.'))
        if (raw === '' || raw === '-') onChange(0)
        else if (!Number.isNaN(n)) onChange(n)
      }}
      onBlur={() => setTxt(null)}
    />
  )
}
