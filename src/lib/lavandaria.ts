/**
 * Lavandaria — custo da rouparia por quarto ocupado.
 *
 * Guarda-se o que vem na fatura (período, quartos e linhas) e calcula-se tudo
 * o resto. Na ferramenta antiga os totais estavam gravados e já tinham
 * divergido — havia faturas com 3164 peças a mostrar "0 peças por quarto".
 */
import { supabase } from './supabase'

export type Seccao = 'alojamento' | 'restauracao' | 'outros'

export const SECCOES: { v: Seccao; rot: string; cor: string }[] = [
  { v: 'alojamento', rot: 'Alojamento', cor: '#2a78d6' },
  { v: 'restauracao', rot: 'Restauração', cor: '#eb6834' },
  { v: 'outros', rot: 'Outros', cor: '#1baf7a' },
]
export const corSeccao = (s: Seccao) => SECCOES.find(x => x.v === s)?.cor ?? '#8a8a8a'
export const rotSeccao = (s: Seccao) => SECCOES.find(x => x.v === s)?.rot ?? s

export interface Artigo {
  nome: string
  seccao: Seccao
  conta_para_quarto: boolean
}

export interface Linha {
  id: string
  fatura_id: string
  artigo: string
  quantidade: number
  valor: number
}

/** Um período de faturação, já com as contas feitas pela vista. */
export interface Periodo {
  id: string
  numero: string | null
  periodo_inicio: string
  periodo_fim: string
  quartos: number
  total_com_iva: number | null
  nota: string | null
  dias: number
  sub_alojamento: number
  pecas_alojamento: number
  sub_restauracao: number
  total_sem_iva: number
  custo_quarto: number | null
  pecas_quarto: number | null
}

/* ------------------------------------------------------------------- datas */

export const anoDe = (iso: string) => Number(iso.slice(0, 4))
export const mesDe = (iso: string) => Number(iso.slice(5, 7))

export const MESES_CURTOS = [
  'Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez',
]

/**
 * A semana do ano a que o período pertence, para alinhar anos diferentes.
 * Usa-se a semana ISO do fim do período, que é quando a fatura fecha.
 */
export function semanaISO(iso: string): number {
  const d = new Date(iso + 'T12:00:00')
  const alvo = new Date(d.valueOf())
  alvo.setDate(alvo.getDate() + 3 - ((d.getDay() + 6) % 7))
  const primeira = new Date(alvo.getFullYear(), 0, 4)
  return 1 + Math.round(
    ((alvo.valueOf() - primeira.valueOf()) / 86400000
      - 3 + ((primeira.getDay() + 6) % 7)) / 7)
}

/* ------------------------------------------------------------------ totais */

export interface Totais {
  periodos: number
  quartos: number
  alojamento: number
  restauracao: number
  outros: number
  pecas: number
  custoQuarto: number | null
  pecasQuarto: number | null
  restauracaoQuarto: number | null
  de: string | null
  ate: string | null
}

export function somar(ps: Periodo[]): Totais {
  const t: Totais = {
    periodos: ps.length, quartos: 0, alojamento: 0, restauracao: 0, outros: 0,
    pecas: 0, custoQuarto: null, pecasQuarto: null, restauracaoQuarto: null,
    de: null, ate: null,
  }
  for (const p of ps) {
    t.quartos += p.quartos
    t.alojamento += p.sub_alojamento
    t.restauracao += p.sub_restauracao
    t.outros += p.total_sem_iva - p.sub_alojamento - p.sub_restauracao
    t.pecas += p.pecas_alojamento
    if (!t.de || p.periodo_inicio < t.de) t.de = p.periodo_inicio
    if (!t.ate || p.periodo_fim > t.ate) t.ate = p.periodo_fim
  }
  if (t.quartos > 0) {
    t.custoQuarto = t.alojamento / t.quartos
    t.pecasQuarto = t.pecas / t.quartos
    t.restauracaoQuarto = t.restauracao / t.quartos
  }
  return t
}

/** Variação relativa entre dois valores; null quando não há com que comparar. */
export const variacao = (atual: number | null, antes: number | null) =>
  atual == null || antes == null || antes === 0 ? null : (atual - antes) / antes

/* -------------------------------------------------------------------- dados */

export async function fetchPeriodos(hotelId: string): Promise<Periodo[]> {
  const { data, error } = await supabase
    .from('v_lav_periodos').select('*')
    .eq('hotel_id', hotelId)
    .order('periodo_inicio')
  if (error) throw error
  return (data ?? []).map(r => ({
    id: r.id,
    numero: r.numero,
    periodo_inicio: r.periodo_inicio,
    periodo_fim: r.periodo_fim,
    quartos: Number(r.quartos ?? 0),
    total_com_iva: r.total_com_iva == null ? null : Number(r.total_com_iva),
    nota: r.nota,
    dias: Number(r.dias ?? 0),
    sub_alojamento: Number(r.sub_alojamento ?? 0),
    pecas_alojamento: Number(r.pecas_alojamento ?? 0),
    sub_restauracao: Number(r.sub_restauracao ?? 0),
    total_sem_iva: Number(r.total_sem_iva ?? 0),
    custo_quarto: r.custo_quarto == null ? null : Number(r.custo_quarto),
    pecas_quarto: r.pecas_quarto == null ? null : Number(r.pecas_quarto),
  }))
}

export async function fetchArtigos(): Promise<Artigo[]> {
  const { data, error } = await supabase.from('lav_artigos').select('*').order('nome')
  if (error) throw error
  return (data ?? []) as Artigo[]
}

export async function fetchLinhas(faturaIds: string[]): Promise<Linha[]> {
  if (!faturaIds.length) return []
  const { data, error } = await supabase
    .from('lav_linhas').select('*').in('fatura_id', faturaIds)
  if (error) throw error
  return (data ?? []).map(r => ({
    ...r, quantidade: Number(r.quantidade), valor: Number(r.valor),
  })) as Linha[]
}

export async function criarFatura(f: {
  hotel_id: string
  numero: string | null
  periodo_inicio: string
  periodo_fim: string
  quartos: number
  total_com_iva: number | null
  atualizado_por: string | null
}) {
  const { data, error } = await supabase.from('lav_faturas').insert(f).select('id').single()
  if (error) {
    if (error.code === '23505') throw new Error('Já existe uma fatura para esse período.')
    throw error
  }
  return data.id as string
}

export async function guardarFatura(id: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from('lav_faturas').update(patch).eq('id', id)
  if (error) throw error
}

export async function apagarFatura(id: string) {
  const { error } = await supabase.from('lav_faturas').delete().eq('id', id)
  if (error) throw error
}

export async function gravarLinhas(
  faturaId: string, linhas: { artigo: string; quantidade: number; valor: number }[],
) {
  await supabase.from('lav_linhas').delete().eq('fatura_id', faturaId)
  if (!linhas.length) return
  const { error } = await supabase.from('lav_linhas')
    .insert(linhas.map(l => ({ ...l, fatura_id: faturaId })))
  if (error) throw error
}

/** Artigos que ainda não estão no catálogo entram como alojamento. */
export async function garantirArtigos(nomes: string[]) {
  if (!nomes.length) return
  const { error } = await supabase.from('lav_artigos')
    .upsert(nomes.map(nome => ({ nome })), { onConflict: 'nome', ignoreDuplicates: true })
  if (error) throw error
}
