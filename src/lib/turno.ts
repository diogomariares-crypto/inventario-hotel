import { supabase } from './supabase'
import { addDays } from './format'

/* ========================= Listas fixas da operação ========================= */

export const CATEGORIAS_FEEDBACK = [
  'Conforto', 'Comodidades', 'Limpeza', 'Funcionários', 'Relação preço qualidade',
  'Localização', 'Pequeno Almoço', 'Restaurante', 'Café', 'Pontuação da cama',
  'Wi-Fi', 'Serviço de quartos', 'Vista quarto', 'NOTA GERAL',
] as const

export const MOTIVOS_VIP = [
  'Vip 3º Dia', 'Vip 5º Dia', 'Vip 7º Dia', 'Vip 9º Dia',
  'Vip Aniversário', 'Vip Aniversário de Casamento', 'Vip Lua de Mel',
  'Vip Suite', 'Vip Welcome', 'Vip Welcome Back',
  'Vip Pack Romântico', 'Vip Ocasião Especial',
] as const

export const TIPOS_HSK = ['NI', 'NQ', 'N feito'] as const

/**
 * Serviços de F&B.
 *
 * O `id` é o que está guardado na base de dados desde a app antiga — não pode
 * mudar, senão os registos deixam de casar. O `label` é só o que se mostra.
 */
export const SERVICOS_FB = [
  { id: 'pequeno_almoco', label: 'Pequeno-almoço' },
  { id: 'pensoes',        label: 'Pensões' },
  { id: 'delivery',       label: 'Delivery (Bolt/UBER)' },
  { id: 'room_service',   label: 'Room Service' },
  { id: 'almoco',         label: 'Almoço' },
  { id: 'jantar',         label: 'Jantar' },
  { id: 'bar',            label: 'Bar' },
  { id: 'vips_lanche',    label: 'VIPS + Lanche' },
] as const

export const rotuloServico = (id: string) =>
  SERVICOS_FB.find(s => s.id === id)?.label ?? id

export const OFFSETS_OCUPACAO = [-1, 0, 1, 2, 3, 4, 5, 6] as const
export const rotuloOffset = (o: number) => (o === -1 ? 'Ontem' : o === 0 ? 'Hoje' : `+${o}`)

export const ESTADOS_MANUTENCAO = [
  { valor: 'por_resolver', rotulo: 'Por resolver' },
  { valor: 'resolvido', rotulo: 'Resolvido' },
] as const

export const ESTADOS_RECLAMACAO = [
  { valor: 'aberta', rotulo: 'Aberta' },
  { valor: 'fechada', rotulo: 'Fechada' },
] as const

/* ================================== Tipos ================================== */

export interface Occupancy {
  id: string; hotel_id: string; report_date: string; day_offset: number
  occ_pct: number | null; occ_rooms: number | null; adr: number | null
  no_shows: number | null; arrivals: number | null; departures: number | null
}
export interface FeedbackScore {
  id: string; hotel_id: string; report_date: string; category: string; score: number | null
}
export interface FeedbackImage {
  id: string; hotel_id: string; report_date: string; storage_path: string; created_at: string
}
export interface Vip {
  id: string; hotel_id: string; report_date: string
  nome: string | null; quarto: string | null; motivo: string | null
  pax: number | null; chegada: string | null; saida: string | null; created_at: string
}
export interface PendingIssue {
  id: string; hotel_id: string; data: string
  depto: string | null; local: string | null; assunto: string | null
  resolvido: boolean; resolved_date: string | null; created_at: string
}
export interface Maintenance {
  id: string; hotel_id: string; data: string
  local: string | null; informante: string | null; intervencao: string | null
  status: string; resolved_date: string | null; created_at: string
}
export interface HskReport {
  id: string; hotel_id: string; report_date: string | null; data: string
  depto: string | null; tipo: string | null; texto: string | null
  resolvido: boolean; resolved_date: string | null; created_at: string
}
export interface LostItem {
  id: string; hotel_id: string; report_date: string | null; data: string
  depto: string | null; local: string | null; descricao: string | null
  resolvido: boolean; resolved_date: string | null; created_at: string
}
export interface BorrowedItem {
  id: string; hotel_id: string; report_date: string | null; data: string
  quarto: string | null; data_co: string | null; objeto: string | null
  resolvido: boolean; resolved_date: string | null; created_at: string
}
export interface Transfer {
  id: string; hotel_id: string; report_date: string
  quarto: string | null; pickup_at: string | null; empresa: string | null
  pax: number | null; tipo_carro: string | null; destino: string | null
  concluido: boolean; concluded_date: string | null; created_at: string
}
export interface BreakfastBox {
  id: string; hotel_id: string; report_date: string
  quarto: string | null; nome: string | null; num_bb: number | null
  para_dia: string | null; para_horas: string | null
  pedida: boolean; notas: string | null; created_at: string
}
export interface Complaint {
  id: string; hotel_id: string; quarto: string | null
  checkin: string | null; checkout: string | null; comentario: string | null
  status: string; created_date: string; created_at: string
}
export interface FbNumber {
  id: string; hotel_id: string; report_date: string; coluna: string
  ins: number; outs: number; total_pax: number; total_eur: number
}
export interface FbForecast {
  id: string; hotel_id: string; report_date: string; day_offset: number
  hospedes: number; pa_incluidos: number; meia_pensao: number; pensao_completa: number
}
export interface Arrival {
  id: string; hotel_id: string; arrival_date: string
  number: string | null; last_name: string | null; first_name: string | null
  nights: number | null; pax: number | null; room_requested: string | null
  room_number: string | null; products: string | null; travel_agency: string | null
  adr: number | null; total_amount: number | null
  notes: string | null; customer_notes: string | null
}

/* ============================== Acesso a dados ============================= */

const err = <T,>(r: { data: T | null; error: { message: string } | null }): T => {
  if (r.error) throw new Error(r.error.message)
  return (r.data ?? []) as T
}

/**
 * Registos que se arrastam de dia para dia: aparecem em qualquer dia D desde a
 * sua data até serem fechados. Ao consultar um dia passado vê-se o que estava
 * efetivamente em aberto nesse dia.
 */
async function comArrasto<T>(
  tabela: string, hotelId: string, dia: string,
  campoData: string, campoFechado: string, campoFechadoEm: string,
  fechadoValor?: string,
): Promise<T[]> {
  const cond = fechadoValor
    ? `${campoFechado}.neq.${fechadoValor},${campoFechadoEm}.gt.${dia}`
    : `${campoFechado}.is.false,${campoFechadoEm}.gt.${dia}`
  const r = await supabase
    .from(tabela).select('*')
    .eq('hotel_id', hotelId)
    .lte(campoData, dia)
    .or(cond)
    .order(campoData, { ascending: true })
    .order('created_at', { ascending: true })
    .limit(5000)
  return err<T[]>(r)
}

export const fetchPendentes = (h: string, d: string) =>
  comArrasto<PendingIssue>('pending_issues', h, d, 'data', 'resolvido', 'resolved_date')

export const fetchManutencao = (h: string, d: string) =>
  comArrasto<Maintenance>('maintenance', h, d, 'data', 'status', 'resolved_date', 'resolvido')

export const fetchHsk = (h: string, d: string) =>
  comArrasto<HskReport>('hsk_reports', h, d, 'data', 'resolvido', 'resolved_date')

export const fetchPerdidos = (h: string, d: string) =>
  comArrasto<LostItem>('lost_items', h, d, 'data', 'resolvido', 'resolved_date')

export const fetchEmprestados = (h: string, d: string) =>
  comArrasto<BorrowedItem>('borrowed_items', h, d, 'data', 'resolvido', 'resolved_date')

export const fetchTransfers = (h: string, d: string) =>
  comArrasto<Transfer>('transfers', h, d, 'report_date', 'concluido', 'concluded_date')

/** Breakfast boxes: visíveis desde o registo até ao dia da entrega. */
export async function fetchBreakfast(hotelId: string, dia: string): Promise<BreakfastBox[]> {
  const r = await supabase
    .from('breakfast_boxes').select('*')
    .eq('hotel_id', hotelId)
    .lte('report_date', dia)
    .or(`para_dia.is.null,para_dia.gte.${dia}`)
    .order('created_at', { ascending: true })
  return err<BreakfastBox[]>(r)
}

export async function fetchDoDia<T>(tabela: string, hotelId: string, dia: string, campo = 'report_date') {
  const r = await supabase.from(tabela).select('*')
    .eq('hotel_id', hotelId).eq(campo, dia)
    .order('created_at', { ascending: true })
  return err<T[]>(r)
}

export async function fetchOcupacao(hotelId: string, dia: string) {
  const r = await supabase.from('occupancy').select('*')
    .eq('hotel_id', hotelId).eq('report_date', dia).order('day_offset')
  return err<Occupancy[]>(r)
}

/** Notas de feedback do dia e dos 3 dias anteriores. */
export async function fetchFeedback(hotelId: string, dia: string) {
  const dias = [dia, addDays(dia, -1), addDays(dia, -2), addDays(dia, -3)]
  const r = await supabase.from('feedback_scores').select('*')
    .eq('hotel_id', hotelId).in('report_date', dias)
  const linhas = err<FeedbackScore[]>(r)
  const mapa: Record<string, Record<string, number | null>> = {}
  for (const l of linhas) {
    mapa[l.category] ??= {}
    // Um zero guardado significa "sem nota", não nota zero.
    mapa[l.category][l.report_date] = l.score === null || Number(l.score) === 0 ? null : Number(l.score)
  }
  return { dias, mapa }
}

export async function fetchReclamacoes(hotelId: string) {
  const r = await supabase.from('complaints').select('*')
    .eq('hotel_id', hotelId).order('created_at', { ascending: false })
  return err<Complaint[]>(r)
}

export async function fetchChegadas(hotelId: string, dia: string) {
  const r = await supabase.from('arrivals').select('*')
    .eq('hotel_id', hotelId).eq('arrival_date', dia)
  return err<Arrival[]>(r)
}

export async function fetchFbSemana(hotelId: string, de: string, ate: string) {
  const r = await supabase.from('fb_numbers').select('*')
    .eq('hotel_id', hotelId).gte('report_date', de).lte('report_date', ate)
  return err<FbNumber[]>(r)
}

/* ------------------------------- escritas -------------------------------- */

export async function inserir<T>(tabela: string, linha: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.from(tabela).insert(linha).select().single()
  if (error) throw new Error(error.message)
  return data as T
}

export async function atualizar(tabela: string, id: string, patch: Record<string, unknown>) {
  const { error } = await supabase.from(tabela).update(patch).eq('id', id)
  if (error) throw new Error(error.message)
}

export async function apagar(tabela: string, id: string) {
  const { error } = await supabase.from(tabela).delete().eq('id', id)
  if (error) throw new Error(error.message)
}

export async function guardarCelula(
  tabela: string, chave: Record<string, unknown>, valores: Record<string, unknown>,
  onConflict: string,
) {
  const { error } = await supabase.from(tabela)
    .upsert({ ...chave, ...valores }, { onConflict })
  if (error) throw new Error(error.message)
}

/* ------------------------------- imagens --------------------------------- */

export const BUCKET_FEEDBACK = 'feedback-images'

export async function urlAssinado(path: string, segundos = 21600) {
  const { data } = await supabase.storage.from(BUCKET_FEEDBACK).createSignedUrl(path, segundos)
  return data?.signedUrl ?? null
}

export async function carregarImagem(
  ficheiro: File, hotelId: string, dia: string, quem: string | null,
) {
  const ext = (ficheiro.name.split('.').pop() || 'png').toLowerCase()
  const path = `${hotelId}/${dia}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(BUCKET_FEEDBACK)
    .upload(path, ficheiro, { contentType: ficheiro.type || 'image/png' })
  if (error) throw new Error(error.message)
  return inserir<FeedbackImage>('feedback_images', {
    hotel_id: hotelId, report_date: dia, storage_path: path, created_by: quem,
  })
}

export async function removerImagem(img: FeedbackImage) {
  await supabase.storage.from(BUCKET_FEEDBACK).remove([img.storage_path])
  await apagar('feedback_images', img.id)
}

/* ----------------------------- notas do F&B ------------------------------ */
export interface FbNotas {
  hotel_id: string
  report_date: string
  por_servico: Record<string, string> | null
  equipa: string | null
}

/** Notas escritas pela equipa de F&B no fecho diário. Só de leitura aqui. */
export async function fetchFbNotas(hotelId: string, dia: string): Promise<FbNotas | null> {
  const { data, error } = await supabase
    .from('fb_notas').select('*')
    .eq('hotel_id', hotelId).eq('report_date', dia).maybeSingle()
  if (error) throw error
  return (data as FbNotas) ?? null
}
