/**
 * Reposição de stock — quanto dura o que temos, e quanto devíamos ter.
 *
 * Duas coisas diferentes, com exigências diferentes de dados:
 *
 *  · **Dias de cobertura** — quanto tempo o stock actual aguenta ao ritmo a
 *    que se gasta. Precisa só do consumo médio, resiste bem a ruído, e é o
 *    que evita a ruptura: se o stock dura 2 dias e o fornecedor demora 3,
 *    já se sabe o que vai acontecer.
 *
 *  · **Par calculado** — o nível até onde encomendar. Precisa também da
 *    *variabilidade* do consumo, e é aí que os dados de contagem falham.
 *    Só se propõe quando o histórico o aguenta; nos outros casos diz-se
 *    porque não, que é informação útil sobre a contagem.
 */
import { supabase } from './supabase'
import type { PeriodKind } from './types'

/** Cobertura de ~95% das semanas: valor tabelado da normal para essa cauda. */
export const Z_95 = 1.65

/** Dias entre contagens — é o tempo que o stock tem de aguentar sozinho. */
export const INTERVALO: Record<PeriodKind, number> = { semanal: 7, mensal: 30 }

/** Abaixo disto não há observações que cheguem para falar de variabilidade. */
const MIN_PERIODOS = 12
/** Acima disto, metade do histórico são linhas por contar ou impossíveis. */
const MAX_SUJIDADE = 0.25
/** Desvio maior do que isto face à mediana é ruído, não sazonalidade. */
const MAX_VARIACAO = 1.5

export interface Consumo {
  item_id: string
  periodos: number
  negativos: number
  vazios: number
  usado_dia: number | null
  mediana_semana: number | null
  desvio_semana: number | null
  usado_por_quarto: number | null
  ultimo_fim: string | null
}

export interface Fornecedor {
  nome: string
  prazo_dias: number
  dias_entrega: number[]
  nota: string | null
}

export type Confianca = 'boa' | 'poucas' | 'irregular' | 'sem-dados'

export interface Analise {
  usadoDia: number | null
  /** Dias que o stock actual aguenta. */
  cobertura: number | null
  /** Prazo do fornecedor, já com a espera pelos dias de entrega. */
  prazo: number
  /** O stock acaba antes de uma encomenda feita hoje chegar. */
  ruptura: boolean
  par: number | null
  ciclo: number | null
  seguranca: number | null
  confianca: Confianca
  porque: string
}

/**
 * Se o fornecedor só entrega em certos dias, o prazo real é o trânsito mais a
 * espera pela próxima janela. Usa-se o pior caso, que é o intervalo maior
 * entre entregas — encomendar não escolhe o dia da semana em que faz falta.
 */
export function prazoEfectivo(f: Fornecedor | undefined): number {
  const transito = f?.prazo_dias ?? 3
  const dias = [...(f?.dias_entrega ?? [])].sort((a, b) => a - b)
  if (dias.length === 0) return transito
  let maiorEspera = 0
  for (let i = 0; i < dias.length; i++) {
    const seguinte = dias[(i + 1) % dias.length]
    const salto = i === dias.length - 1 ? seguinte + 7 - dias[i] : seguinte - dias[i]
    maiorEspera = Math.max(maiorEspera, salto - 1)
  }
  return transito + maiorEspera
}

export function analisar(opcoes: {
  stock: number | null
  consumo: Consumo | undefined
  fornecedor: Fornecedor | undefined
  frequencia: PeriodKind
}): Analise {
  const { stock, consumo: c, fornecedor, frequencia } = opcoes
  const prazo = prazoEfectivo(fornecedor)
  const intervalo = INTERVALO[frequencia] ?? 7
  const horizonte = intervalo + prazo

  const d = c?.usado_dia ?? null
  const cobertura = d && d > 0 && stock != null ? stock / d : null
  const ruptura = cobertura != null && cobertura < prazo

  const vazio: Analise = {
    usadoDia: d, cobertura, prazo, ruptura,
    par: null, ciclo: null, seguranca: null,
    confianca: 'sem-dados',
    porque: 'ainda não há contagens fechadas que cheguem para calcular o consumo',
  }
  if (!c || !d || d <= 0) return vazio

  const observacoes = c.periodos + c.vazios + c.negativos
  const sujidade = observacoes ? (c.vazios + c.negativos) / observacoes : 1
  const variacao = c.mediana_semana && c.mediana_semana > 0
    ? (c.desvio_semana ?? 0) / c.mediana_semana
    : Infinity

  if (c.periodos < MIN_PERIODOS) {
    return { ...vazio, confianca: 'poucas',
      porque: `só ${c.periodos} ${c.periodos === 1 ? 'contagem fechada' : 'contagens fechadas'} — a partir de ${MIN_PERIODOS} passa a haver par` }
  }
  if (sujidade >= MAX_SUJIDADE) {
    return { ...vazio, confianca: 'irregular',
      porque: `${c.vazios} contagens por preencher e ${c.negativos} com consumo negativo em ${observacoes} — o histórico não é de fiar` }
  }
  if (variacao > MAX_VARIACAO) {
    return { ...vazio, confianca: 'irregular',
      porque: 'o consumo varia mais de semana para semana do que o próprio consumo médio — não dá para dimensionar segurança' }
  }

  const ciclo = d * horizonte
  // A segurança nunca passa o próprio ciclo: com dados ruidosos seria ela a
  // mandar no par e encheria o armazém.
  const seguranca = Math.min(
    Z_95 * (c.desvio_semana ?? 0) * Math.sqrt(horizonte / 7),
    ciclo,
  )
  return {
    usadoDia: d, cobertura, prazo, ruptura,
    ciclo, seguranca,
    par: Math.ceil(ciclo + seguranca),
    confianca: 'boa',
    porque: `${c.periodos} contagens fechadas · ${arred(d)}/dia · cobre ${intervalo} dias até à próxima contagem + ${arred(prazo)} de entrega`,
  }
}

const arred = (n: number) => Math.round(n * 10) / 10

/* -------------------------------------------------------------------- dados */

export async function fetchConsumo(
  hotelId: string, dept: string, desdeDias = 365,
): Promise<Record<string, Consumo>> {
  const desde = new Date(Date.now() - desdeDias * 86400000).toISOString().slice(0, 10)
  const { data, error } = await supabase.rpc('stock_consumo', {
    _hotel: hotelId, _dept: dept, _desde: desde,
  })
  if (error) throw error
  const fora: Record<string, Consumo> = {}
  for (const r of data ?? []) {
    fora[r.item_id] = {
      item_id: r.item_id,
      periodos: Number(r.periodos ?? 0),
      negativos: Number(r.negativos ?? 0),
      vazios: Number(r.vazios ?? 0),
      usado_dia: r.usado_dia == null ? null : Number(r.usado_dia),
      mediana_semana: r.mediana_semana == null ? null : Number(r.mediana_semana),
      desvio_semana: r.desvio_semana == null ? null : Number(r.desvio_semana),
      usado_por_quarto: r.usado_por_quarto == null ? null : Number(r.usado_por_quarto),
      ultimo_fim: r.ultimo_fim ?? null,
    }
  }
  return fora
}

export async function fetchFornecedores(): Promise<Record<string, Fornecedor>> {
  const { data, error } = await supabase.from('stock_fornecedores').select('*').order('nome')
  if (error) throw error
  const fora: Record<string, Fornecedor> = {}
  for (const r of data ?? []) {
    fora[r.nome] = {
      nome: r.nome,
      prazo_dias: Number(r.prazo_dias),
      dias_entrega: (r.dias_entrega ?? []).map(Number),
      nota: r.nota,
    }
  }
  return fora
}

export async function guardarFornecedor(nome: string, patch: Partial<Fornecedor>) {
  const { error } = await supabase.from('stock_fornecedores')
    .update({ ...patch, atualizado_em: new Date().toISOString() }).eq('nome', nome)
  if (error) throw error
}

export async function guardarPar(itemId: string, par: number) {
  const { error } = await supabase.from('items').update({ par_qty: par }).eq('id', itemId)
  if (error) throw error
}

export const DIAS_SEMANA_CURTOS = ['seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'dom']

/** "2 dias" / "meio dia" / "3 semanas" — cobertura em linguagem de gente. */
export function cobertura(dias: number | null): string {
  if (dias == null) return '—'
  if (dias < 1) return 'menos de um dia'
  if (dias < 14) return `${Math.round(dias)} ${Math.round(dias) === 1 ? 'dia' : 'dias'}`
  const semanas = Math.round(dias / 7)
  if (semanas < 9) return `${semanas} semanas`
  return `${Math.round(dias / 30)} meses`
}
