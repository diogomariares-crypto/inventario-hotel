import { supabase } from './supabase'

/**
 * Dados do dashboard de F&B.
 *
 * Tudo o que é soma e média acontece na base de dados, numa única função
 * (`fb_dashboard`). O browser recebe já agregado — não puxa cinco anos de
 * registos para fazer contas.
 *
 * Os sete serviços vêm sempre pela mesma ordem, e é essa ordem que os arrays
 * respeitam.
 */
export const SERVICOS = [
  { k: 'bf', rot: 'Pequeno-almoço' },
  { k: 'vip', rot: 'VIPs + Lanche' },
  { k: 'lunch', rot: 'Almoço' },
  { k: 'dinner', rot: 'Jantar' },
  { k: 'bar', rot: 'Bar' },
  { k: 'hh', rot: 'Happy Hour' },
  { k: 'oth', rot: 'Outros' },
] as const

export type Metrica = 'eur' | 'pax' | 'tm'

export const METRICAS: Record<Metrica, { rot: string }> = {
  eur: { rot: 'Faturação' },
  pax: { rot: 'Covers' },
  tm: { rot: 'Preço médio' },
}

export interface Serie { aEur: number[]; aPax: number[]; bEur: number[]; bPax: number[] }
export interface Mes extends Serie { m: number }
export interface Dow extends Serie { dow: number }
export interface Dia {
  d: string; dow: number; bData: string
  aEur: number[] | null; aPax: number[] | null
  bEur: number[] | null; bPax: number[] | null
}
export interface Dash {
  vazio?: boolean
  ate: string
  alinhado: boolean
  mesAtual: number
  anoAtual: number
  periodo: Serie
  acumulado: Serie
  mensal: Mes[]
  semana: Dow[]
  diario: Dia[] | null
  off: { m: string; pa: number; pax: number; v: number }[] | null
  offNomes: { n: string; x: number; v: number }[] | null
}

export async function fetchDash(hotelId: string, ano: number, mes: number | null): Promise<Dash> {
  const { data, error } = await supabase.rpc('fb_dashboard', {
    p_hotel: hotelId, p_ano: ano, p_mes: mes,
  })
  if (error) throw error
  return data as Dash
}

/* ------------------------------ formatação ------------------------------- */
export const eur = (v: number | null, casas = 0) =>
  v == null ? '—' : v.toLocaleString('pt-PT',
    { style: 'currency', currency: 'EUR', minimumFractionDigits: casas, maximumFractionDigits: casas })

export const num = (v: number | null) =>
  v == null ? '—' : Math.round(v).toLocaleString('pt-PT')

export const pct = (v: number | null) =>
  v == null ? '—' : (v > 0 ? '+' : '−') + Math.abs(v).toFixed(1).replace('.', ',') + '%'

export const seta = (v: number | null) => v == null ? '' : v > 0 ? '▲' : v < 0 ? '▼' : '–'
export const corDelta = (v: number | null) =>
  v == null ? 'text-slate-400' : v > 0 ? 'text-emerald-700' : v < 0 ? 'text-red-600' : 'text-slate-500'

export const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
                      'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
export const MESES3 = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const DIAS_SEMANA = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo']

/** O ISO da data sem apanhar com fusos. */
export const diaDoIso = (iso: string) => Number(iso.slice(8, 10))

export function rotuloPeriodo(d: Dash, ano: number, mes: number | null) {
  const dia = diaDoIso(d.ate)
  if (mes == null) {
    return ano === d.anoAtual
      ? `${ano} até ${dia} de ${MESES[d.mesAtual - 1]}`
      : `Ano ${ano}`
  }
  const alinhado = ano === d.anoAtual && mes === d.mesAtual
  return `${MESES[mes - 1]} de ${ano}` + (alinhado ? ` · 1 a ${dia}` : '')
}

/* --------------------------------- contas -------------------------------- */
const somaSe = (arr: number[] | null | undefined, svc: string) => {
  if (!arr) return null
  if (svc === 'all') return arr.reduce((a, b) => a + b, 0)
  const i = SERVICOS.findIndex(s => s.k === svc)
  return i < 0 ? null : arr[i]
}

/** Valor de um par (euros, covers) na métrica escolhida. */
export function valor(met: Metrica, eurArr: number[] | null | undefined,
                     paxArr: number[] | null | undefined, svc: string): number | null {
  const e = somaSe(eurArr, svc), p = somaSe(paxArr, svc)
  if (met === 'eur') return e
  if (met === 'pax') return p
  return p ? (e ?? 0) / p : null
}

export const variacao = (a: number | null, b: number | null) =>
  a == null || b == null || b === 0 ? null : (a - b) / b * 100

export interface LinhaServico {
  k: string; rot: string
  aEur: number; bEur: number | null; dEur: number | null; pEur: number | null
  aPax: number; bPax: number | null; pPax: number | null
  aTm: number | null; bTm: number | null; pTm: number | null
}

export function linhasPorServico(s: Serie): LinhaServico[] {
  return SERVICOS.map((sv, i) => {
    const aEur = s.aEur?.[i] ?? 0, bEur = s.bEur?.[i] ?? null
    const aPax = s.aPax?.[i] ?? 0, bPax = s.bPax?.[i] ?? null
    const aTm = aPax ? aEur / aPax : null
    const bTm = bPax ? (bEur ?? 0) / bPax : null
    return {
      k: sv.k, rot: sv.rot,
      aEur, bEur, dEur: bEur == null ? null : aEur - bEur, pEur: variacao(aEur, bEur),
      aPax, bPax, pPax: variacao(aPax, bPax),
      aTm, bTm, pTm: variacao(aTm, bTm),
    }
  }).sort((x, y) => (x.dEur ?? 0) - (y.dEur ?? 0))
}
