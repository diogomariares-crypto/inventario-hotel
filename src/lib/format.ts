const eur = new Intl.NumberFormat('pt-PT', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const num3 = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 3 })
const num2 = new Intl.NumberFormat('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const money = (v: number | null | undefined) =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : eur.format(v)

export const qty = (v: number | null | undefined) =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : num3.format(v)

export const dec2 = (v: number | null | undefined) =>
  v === null || v === undefined || Number.isNaN(v) ? '—' : num2.format(v)

export const MESES = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

/** '2026-06' -> 'Junho 2026' */
export const monthLabel = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return `${MESES[mo - 1]} ${y}`
}

/** '2026-06-29' -> '29/06/2026' */
export const dmy = (iso: string) => {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

/** '2026-06-29' -> '29/06' */
export const dm = (iso: string) => {
  if (!iso) return '—'
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

export const weekLabel = (start: string, end: string) => `${dm(start)} – ${dm(end)}`

/** Segunda-feira da semana de uma data (ISO) */
export const mondayOf = (d: Date) => {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dow = (x.getUTCDay() + 6) % 7 // 0 = segunda
  x.setUTCDate(x.getUTCDate() - dow)
  return x.toISOString().slice(0, 10)
}

export const addDays = (iso: string, n: number) => {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const todayISO = () => new Date().toISOString().slice(0, 10)

export const monthKey = (iso: string) => iso.slice(0, 7)

export const lastDayOfMonth = (m: string) => {
  const [y, mo] = m.split('-').map(Number)
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10)
}

/** Lista de meses à volta do atual: n para trás, f para a frente */
export const monthRange = (back = 12, fwd = 1) => {
  const now = new Date()
  const out: string[] = []
  for (let i = -back; i <= fwd; i++) {
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() + i, 1))
    out.push(d.toISOString().slice(0, 7))
  }
  return out
}

export const DIAS_SEMANA = [
  'Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira',
  'Quinta-feira', 'Sexta-feira', 'Sábado',
]
export const DIAS_CURTOS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

/** '2026-08-24' -> 'Segunda-feira, 24 de agosto de 2026' */
export const dataExtenso = (iso: string) => {
  const d = new Date(iso + 'T12:00:00')
  return `${DIAS_SEMANA[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()].toLowerCase()} de ${d.getFullYear()}`
}

export const diaSemanaCurto = (iso: string) => DIAS_CURTOS[new Date(iso + 'T12:00:00').getDay()]
export const diaSemanaLongo = (iso: string) =>
  DIAS_SEMANA[new Date(iso + 'T12:00:00').getDay()].toLowerCase()

/** Segunda-feira da semana de uma data ISO. */
export const segundaDe = (iso: string) => {
  const d = new Date(iso + 'T12:00:00')
  const dow = (d.getDay() + 6) % 7
  return addDays(iso, -dow)
}

/** Data de hoje no fuso local (não em UTC). */
export const hojeLocal = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export const diffDias = (de: string, ate: string) =>
  Math.round((Date.parse(ate + 'T00:00:00Z') - Date.parse(de + 'T00:00:00Z')) / 86400000)

export const csvEscape = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export const downloadCSV = (filename: string, rows: (string | number | null)[][]) => {
  const csv = '﻿' + rows.map(r => r.map(csvEscape).join(';')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}
