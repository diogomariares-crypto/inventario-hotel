import { useEffect, useRef, useState, type ReactNode } from 'react'

/* ------------------------------ Cartão de secção --------------------------- */

export const CORES: Record<string, string> = {
  ocupacao: '#2563eb', feedback: '#0891b2', vips: '#b8860b', pendentes: '#16a34a',
  transfers: '#0d9488', breakfast: '#d97706', relevantes: '#ca8a04', fb: '#7c3aed',
  manutencao: '#ea580c', reclamacoes: '#db2777', chegadas: '#2563eb',
}

export function Seccao({
  cor, titulo, sub, acoes, children,
}: { cor: string; titulo: string; sub?: ReactNode; acoes?: ReactNode; children: ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <div style={{ background: cor }} className="h-1" />
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-3">
        <span style={{ background: cor }} className="h-2.5 w-2.5 shrink-0 rounded-full" />
        <h2 className="text-sm font-semibold text-slate-800">{titulo}</h2>
        {sub}
        {acoes && <div className="ml-auto flex flex-wrap items-center gap-2">{acoes}</div>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  )
}

export const Vazio = ({ children }: { children: ReactNode }) => (
  <p className="py-6 text-center text-sm text-slate-400">{children}</p>
)

export const Lixo = ({ onClick, titulo = 'Apagar' }: { onClick: () => void; titulo?: string }) => (
  <button
    onClick={onClick}
    title={titulo}
    className="rounded p-1.5 text-slate-300 transition hover:bg-red-50 hover:text-red-600"
  >
    ✕
  </button>
)

export const Badge = ({
  tom = 'cinza', children,
}: { tom?: 'cinza' | 'vermelho' | 'verde' | 'ambar'; children: ReactNode }) => {
  const tons = {
    cinza: 'bg-slate-100 text-slate-600',
    vermelho: 'bg-red-100 text-red-700',
    verde: 'bg-brand-100 text-brand-700',
    ambar: 'bg-amber-100 text-amber-800',
  }
  return <span className={`chip ${tons[tom]}`}>{children}</span>
}

/* --------------------------------- Células -------------------------------- */

const base =
  'w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm outline-none ' +
  'hover:border-slate-200 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-500/15 ' +
  'disabled:cursor-not-allowed disabled:opacity-60'

/** Textarea que cresce com o conteúdo — nunca esconde texto. */
export function TextoCell({
  valor, onGuardar, disabled, placeholder, uma = false,
}: {
  valor: string | null; onGuardar: (v: string | null) => void
  disabled?: boolean; placeholder?: string; uma?: boolean
}) {
  const [v, setV] = useState(valor ?? '')
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { setV(valor ?? '') }, [valor])
  useEffect(() => {
    const el = ref.current
    if (!el || uma) return
    el.style.height = 'auto'
    el.style.height = el.scrollHeight + 'px'
  }, [v, uma])

  if (uma) {
    return (
      <input
        className={base} value={v} disabled={disabled} placeholder={placeholder}
        onChange={e => setV(e.target.value)}
        onBlur={() => { if ((valor ?? '') !== v) onGuardar(v.trim() === '' ? null : v) }}
      />
    )
  }
  return (
    <textarea
      ref={ref} rows={1} className={`${base} resize-none`} value={v}
      disabled={disabled} placeholder={placeholder}
      onChange={e => setV(e.target.value)}
      onBlur={() => { if ((valor ?? '') !== v) onGuardar(v.trim() === '' ? null : v) }}
    />
  )
}

export function NumeroCell({
  valor, onGuardar, disabled, passo = 1, vazioComoZero = false, className = '',
}: {
  valor: number | null; onGuardar: (v: number | null) => void
  disabled?: boolean; passo?: number; vazioComoZero?: boolean; className?: string
}) {
  const [v, setV] = useState(valor === null ? '' : String(valor))
  useEffect(() => { setV(valor === null ? '' : String(valor)) }, [valor])
  return (
    <input
      type="number" step={passo} inputMode="decimal"
      className={`${base} text-right tabular-nums ${className}`}
      value={v} disabled={disabled}
      onFocus={e => e.currentTarget.select()}
      onChange={e => setV(e.target.value)}
      onBlur={() => {
        const n = v.trim() === '' ? (vazioComoZero ? 0 : null) : Number(v.replace(',', '.'))
        const limpo = n === null || Number.isNaN(n) ? (vazioComoZero ? 0 : null) : n
        if (limpo !== valor) onGuardar(limpo)
      }}
    />
  )
}

export function DataCell({
  valor, onGuardar, disabled,
}: { valor: string | null; onGuardar: (v: string | null) => void; disabled?: boolean }) {
  return (
    <input
      type="date" className={base} value={valor ?? ''} disabled={disabled}
      onChange={e => onGuardar(e.target.value || null)}
    />
  )
}

export function HoraCell({
  valor, onGuardar, disabled,
}: { valor: string | null; onGuardar: (v: string | null) => void; disabled?: boolean }) {
  return (
    <input
      type="time" className={base} value={(valor ?? '').slice(0, 5)} disabled={disabled}
      onChange={e => onGuardar(e.target.value || null)}
    />
  )
}

/** datetime-local: mostra hora local, guarda em UTC. */
export function DataHoraCell({
  valor, onGuardar, disabled, destaque,
}: {
  valor: string | null; onGuardar: (v: string | null) => void
  disabled?: boolean; destaque?: boolean
}) {
  const local = valor
    ? (() => {
        const d = new Date(valor)
        const p = (n: number) => String(n).padStart(2, '0')
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
      })()
    : ''
  return (
    <input
      type="datetime-local" disabled={disabled}
      className={`${base} ${destaque ? 'font-semibold' : ''}`}
      value={local}
      onChange={e => onGuardar(e.target.value ? new Date(e.target.value).toISOString() : null)}
    />
  )
}

export function EscolhaCell({
  valor, opcoes, onGuardar, disabled, permitirLivre = false, placeholder = '—',
}: {
  valor: string | null
  opcoes: readonly string[] | readonly { valor: string; rotulo: string }[]
  onGuardar: (v: string | null) => void
  disabled?: boolean; permitirLivre?: boolean; placeholder?: string
}) {
  const norm = (opcoes as readonly unknown[]).map(o =>
    typeof o === 'string' ? { valor: o, rotulo: o } : (o as { valor: string; rotulo: string }))
  const naLista = valor === null || norm.some(o => o.valor === valor)
  const [livre, setLivre] = useState(permitirLivre && !naLista)

  useEffect(() => { if (!permitirLivre) setLivre(false) }, [permitirLivre])

  if (livre) {
    return (
      <div className="flex items-center gap-1">
        <TextoCell uma valor={valor} onGuardar={onGuardar} disabled={disabled} placeholder="Escrever…" />
        <button
          className="shrink-0 rounded px-1.5 text-slate-400 hover:text-slate-700"
          title="Voltar à lista"
          onClick={() => { setLivre(false); onGuardar(null) }}
        >✕</button>
      </div>
    )
  }
  return (
    <select
      className={base} value={valor ?? ''} disabled={disabled}
      onChange={e => {
        if (e.target.value === '__livre__') { setLivre(true); return }
        onGuardar(e.target.value || null)
      }}
    >
      <option value="">{placeholder}</option>
      {norm.map(o => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}
      {permitirLivre && <option value="__livre__">Outro… (escrever)</option>}
    </select>
  )
}

export function CaixaCell({
  valor, onGuardar, disabled,
}: { valor: boolean; onGuardar: (v: boolean) => void; disabled?: boolean }) {
  return (
    <input
      type="checkbox" checked={valor} disabled={disabled}
      className="h-4 w-4 accent-[#1a6b4a]"
      onChange={e => onGuardar(e.target.checked)}
    />
  )
}

/* ------------------------------- Tabela base ------------------------------- */

export const Tabela = ({ min = 720, children }: { min?: number; children: ReactNode }) => (
  <div className="-mx-4 overflow-x-auto px-4">
    <table className="w-full" style={{ minWidth: min }}>{children}</table>
  </div>
)

export const Th = ({ children, right }: { children?: ReactNode; right?: boolean }) => (
  <th className={`px-2 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500 ${
    right ? 'text-right' : 'text-left'}`}>{children}</th>
)

export const Td = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <td className={`px-2 py-1 align-top ${className}`}>{children}</td>
)
