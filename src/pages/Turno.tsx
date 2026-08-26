import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import * as XLSX from 'xlsx'
import { useApp } from '../lib/appState'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import {
  addDays, dataExtenso, diaSemanaLongo, diffDias, dm, dmy, hojeLocal, lastDayOfMonth, money, segundaDe,
  DIAS_CURTOS,
} from '../lib/format'
import * as T from '../lib/turno'
import {
  Badge, CaixaCell, CORES, DataCell, DataHoraCell, EscolhaCell, HoraCell, Lixo,
  NumeroCell, Seccao, Tabela, Td, TextoCell, Th, Vazio,
} from '../components/turno-parts'
import { Loading, Modal, useToast } from '../components/ui'

/* ========================================================================== */

const ABAS = [
  { id: 'resumo', label: 'Ocupação & Feedback', contador: '' },
  { id: 'hospedes', label: 'Hóspedes', contador: 'hospedes' },
  { id: 'pendentes', label: 'Pendentes', contador: 'pendentes' },
  { id: 'fb', label: 'F&B', contador: '' },
  { id: 'chegadas', label: 'Chegadas', contador: 'chegadas' },
] as const

const ABA_GUARDADA = 'turno.aba'

export default function Turno() {
  const { date } = useParams()
  const nav = useNavigate()
  const { hotelId, hotels } = useApp()
  const { roles, email } = useAuth()
  const toast = useToast()

  const dia = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : hojeLocal()
  const podeEditar = roles.length > 0

  const [dados, setDados] = useState<{
    ocupacao: T.Occupancy[]; feedback: Awaited<ReturnType<typeof T.fetchFeedback>>
    imagens: T.FeedbackImage[]; vips: T.Vip[]; pendentes: T.PendingIssue[]
    transfers: T.Transfer[]; breakfast: T.BreakfastBox[]; hsk: T.HskReport[]
    perdidos: T.LostItem[]; emprestados: T.BorrowedItem[]; manutencao: T.Maintenance[]
    reclamacoes: T.Complaint[]; fbNum: T.FbNumber[]; fbPrev: T.FbForecast[]
    chegadasHoje: T.Arrival[]; chegadasAmanha: T.Arrival[]
    fbNotas: T.FbNotas | null
  } | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [aCarregar, setACarregar] = useState(true)
  const [aba, setAbaEstado] = useState<string>(
    () => localStorage.getItem(ABA_GUARDADA) ?? 'resumo',
  )
  const setAba = (id: string) => { localStorage.setItem(ABA_GUARDADA, id); setAbaEstado(id) }

  const carregar = useCallback(async () => {
    if (!hotelId) return
    try {
      const [
        ocupacao, feedback, imagens, vips, pendentes, transfers, breakfast,
        hsk, perdidos, emprestados, manutencao, reclamacoes, fbNum, fbPrev,
        chegadasHoje, chegadasAmanha, fbNotas,
      ] = await Promise.all([
        T.fetchOcupacao(hotelId, dia),
        T.fetchFeedback(hotelId, dia),
        T.fetchDoDia<T.FeedbackImage>('feedback_images', hotelId, dia),
        T.fetchDoDia<T.Vip>('vips', hotelId, dia),
        T.fetchPendentes(hotelId, dia),
        T.fetchTransfers(hotelId, dia),
        T.fetchBreakfast(hotelId, dia),
        T.fetchHsk(hotelId, dia),
        T.fetchPerdidos(hotelId, dia),
        T.fetchEmprestados(hotelId, dia),
        T.fetchManutencao(hotelId, dia),
        T.fetchReclamacoes(hotelId),
        T.fetchDoDia<T.FbNumber>('fb_numbers', hotelId, dia),
        T.fetchDoDia<T.FbForecast>('fb_forecast', hotelId, dia),
        T.fetchChegadas(hotelId, dia),
        T.fetchChegadas(hotelId, addDays(dia, 1)),
        T.fetchFbNotas(hotelId, dia),
      ])
      setDados({
        ocupacao, feedback, imagens, vips, pendentes, transfers, breakfast, hsk,
        perdidos, emprestados, manutencao, reclamacoes, fbNum, fbPrev,
        chegadasHoje, chegadasAmanha, fbNotas,
      })
      setErro(null)
    } catch (e) {
      setErro((e as Error).message)
    } finally { setACarregar(false) }
  }, [hotelId, dia])

  useEffect(() => { setACarregar(true); carregar() }, [carregar])

  const contagens = useMemo(() => {
    if (!dados) return null
    return {
      hospedes: dados.vips.length
        + dados.breakfast.filter(b => !b.pedida).length
        + dados.transfers.filter(t => !t.concluido).length,
      pendentes: dados.pendentes.filter(p => !p.resolvido).length
        + dados.hsk.filter(h => !h.resolvido).length
        + dados.perdidos.filter(p => !p.resolvido).length
        + dados.emprestados.filter(b => !b.resolvido).length
        + dados.manutencao.filter(m => m.status !== 'resolvido').length
        + dados.reclamacoes.filter(c => c.status !== 'fechada').length,
      chegadas: dados.chegadasHoje.length,
    }
  }, [dados])

  const ctx = useMemo(() => ({
    hotelId: hotelId!, dia, podeEditar, quem: email,
    recarregar: carregar,
    erro: (e: unknown) => toast((e as Error).message, 'erro'),
  }), [hotelId, dia, podeEditar, email, carregar, toast])

  if (!hotelId) return <Loading />

  const hotel = hotels.find(h => h.id === hotelId)

  return (
    <div className="space-y-4">
      {/* ---------- barra fixa: dia em que se está + separadores ---------- */}
      <div
        className="sticky z-20 -mx-3 border-b border-slate-200 bg-[#f6f7f8]/95 px-3 pt-2 backdrop-blur sm:-mx-5 sm:px-5"
        style={{ top: 'var(--cab-h, 57px)' }}
      >
        <div className="flex flex-wrap items-center gap-2 pb-2">
          <button className="btn-ghost px-2.5" title="Dia anterior"
                  onClick={() => nav(`/turno/${addDays(dia, -1)}`)}>‹</button>
          <input
            type="date" className="input w-auto" value={dia}
            onChange={e => e.target.value && nav(`/turno/${e.target.value}`)}
          />
          <button className="btn-ghost px-2.5" title="Dia seguinte"
                  onClick={() => nav(`/turno/${addDays(dia, 1)}`)}>›</button>
          <button className="btn-ghost" onClick={() => nav(`/turno/${hojeLocal()}`)}>Hoje</button>
          <div className="ml-auto text-right">
            <div className="text-sm font-semibold text-slate-800">{hotel?.name}</div>
            <div className="text-xs text-slate-500">{dataExtenso(dia)}</div>
          </div>
        </div>

        <nav className="flex gap-1 overflow-x-auto">
          {ABAS.map(a => {
            const n = contagens?.[a.contador as keyof typeof contagens]
            const sel = aba === a.id
            return (
              <button
                key={a.id}
                onClick={() => setAba(a.id)}
                className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${
                  sel ? 'border-brand-500 text-brand-700'
                      : 'border-transparent text-slate-500 hover:text-slate-800'}`}
              >
                {a.label}
                {!!n && (
                  <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                    sel ? 'bg-brand-100 text-brand-700' : 'bg-slate-200 text-slate-600'}`}>
                    {n}
                  </span>
                )}
              </button>
            )
          })}
        </nav>
      </div>

      {!podeEditar && (
        <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          A tua conta ainda não tem permissões, por isso podes ver mas não alterar.
        </div>
      )}
      {erro && (
        <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</div>
      )}

      {aCarregar || !dados ? <Loading /> : (
        <div className="space-y-4">
          {aba === 'resumo' && (
            <>
              <Ocupacao ctx={ctx} linhas={dados.ocupacao} />
              <Feedback ctx={ctx} feedback={dados.feedback} imagens={dados.imagens} />
            </>
          )}
          {aba === 'hospedes' && (
            <>
              <Vips ctx={ctx} linhas={dados.vips} />
              <Transfers ctx={ctx} linhas={dados.transfers} />
              <Breakfast ctx={ctx} linhas={dados.breakfast} />
            </>
          )}
          {aba === 'pendentes' && (
            <>
              <Pendentes ctx={ctx} linhas={dados.pendentes} />
              <Relevantes ctx={ctx} hsk={dados.hsk} perdidos={dados.perdidos} emprestados={dados.emprestados} />
              <Manutencao ctx={ctx} linhas={dados.manutencao} />
              <Reclamacoes ctx={ctx} linhas={dados.reclamacoes} />
            </>
          )}
          {aba === 'fb' && (
            <>
              <FeB ctx={ctx} numeros={dados.fbNum} previsao={dados.fbPrev} />
              <NotasFb notas={dados.fbNotas} />
            </>
          )}
          {aba === 'chegadas' && (
            <Chegadas ctx={ctx} hoje={dados.chegadasHoje} amanha={dados.chegadasAmanha} />
          )}
        </div>
      )}
    </div>
  )
}

/* ============================== tipo do contexto =========================== */

interface Ctx {
  hotelId: string; dia: string; podeEditar: boolean; quem: string | null
  recarregar: () => Promise<void>
  erro: (e: unknown) => void
}

/** Executa uma escrita e recarrega, com erro tratado. */
function usarAcao(ctx: Ctx) {
  return async (fn: () => Promise<unknown>) => {
    try { await fn(); await ctx.recarregar() } catch (e) { ctx.erro(e) }
  }
}

const btnAdd = (onClick: () => void, disabled: boolean, texto = 'Adicionar') => (
  <button className="btn-ghost py-1 text-xs" onClick={onClick} disabled={disabled}>+ {texto}</button>
)

/* ================================ Ocupação ================================= */

function Ocupacao({ ctx, linhas }: { ctx: Ctx; linhas: T.Occupancy[] }) {
  const agir = usarAcao(ctx)
  const porOffset = new Map(linhas.map(l => [l.day_offset, l]))

  const guardar = (offset: number, campo: string, v: number | null) =>
    agir(() => T.guardarCelula('occupancy',
      { hotel_id: ctx.hotelId, report_date: ctx.dia, day_offset: offset },
      { [campo]: v, updated_by: ctx.quem },
      'hotel_id,report_date,day_offset'))

  const grafico = T.OFFSETS_OCUPACAO.map(o => ({
    dia: T.rotuloOffset(o),
    ocupacao: Number(porOffset.get(o)?.occ_pct ?? 0),
  }))

  const colunas: { campo: keyof T.Occupancy; titulo: string; passo: number }[] = [
    { campo: 'occ_pct', titulo: 'Ocup. %', passo: 0.1 },
    { campo: 'occ_rooms', titulo: 'Ocup. #', passo: 1 },
    { campo: 'adr', titulo: 'ADR (€)', passo: 0.1 },
    { campo: 'no_shows', titulo: 'No Shows', passo: 1 },
    { campo: 'arrivals', titulo: 'Chegadas', passo: 1 },
    { campo: 'departures', titulo: 'Saídas', passo: 1 },
  ]

  return (
    <Seccao cor={CORES.ocupacao} titulo="Resumo / Ocupação">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Tabela min={560}>
          <thead>
            <tr className="border-b border-slate-100">
              <Th>Dia</Th>
              {colunas.map(c => <Th key={String(c.campo)} right>{c.titulo}</Th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {T.OFFSETS_OCUPACAO.map(o => {
              const l = porOffset.get(o)
              return (
                <tr key={o} className={o === 0 ? 'bg-blue-50/40' : ''}>
                  <Td className="whitespace-nowrap py-2 text-sm font-medium text-slate-700">
                    {T.rotuloOffset(o)}
                  </Td>
                  {colunas.map(c => (
                    <Td key={String(c.campo)} className="w-24">
                      <NumeroCell
                        valor={l ? (l[c.campo] as number | null) : null}
                        passo={c.passo}
                        disabled={!ctx.podeEditar}
                        onGuardar={v => guardar(o, String(c.campo), v)}
                      />
                    </Td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </Tabela>

        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={grafico} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="dia" tick={{ fontSize: 11 }} stroke="#94a3b8" />
              <YAxis tick={{ fontSize: 11 }} stroke="#94a3b8" tickFormatter={v => `${v}%`} />
              <Tooltip formatter={((v: unknown) => [`${Number(v)}%`, 'Ocupação']) as never} />
              <Bar dataKey="ocupacao" fill={CORES.ocupacao} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </Seccao>
  )
}

/* ================================ Feedback ================================= */

function Feedback({
  ctx, feedback, imagens,
}: { ctx: Ctx; feedback: Awaited<ReturnType<typeof T.fetchFeedback>>; imagens: T.FeedbackImage[] }) {
  const agir = usarAcao(ctx)
  const [dia, d1, d2, d3] = feedback.dias
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [lightbox, setLightbox] = useState<string | null>(null)
  const [aSubir, setASubir] = useState(false)
  const zona = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let vivo = true
    Promise.all(imagens.map(async i => [i.id, await T.urlAssinado(i.storage_path)] as const))
      .then(pares => {
        if (!vivo) return
        setUrls(Object.fromEntries(pares.filter(p => p[1]) as [string, string][]))
      })
    return () => { vivo = false }
  }, [imagens.map(i => i.id).join(',')])

  const subir = async (ficheiros: File[]) => {
    if (!ficheiros.length || !ctx.podeEditar) return
    setASubir(true)
    try {
      for (const f of ficheiros) await T.carregarImagem(f, ctx.hotelId, ctx.dia, ctx.quem)
      await ctx.recarregar()
    } catch (e) { ctx.erro(e) } finally { setASubir(false) }
  }

  useEffect(() => {
    const el = zona.current
    if (!el) return
    const onPaste = (ev: ClipboardEvent) => {
      const fics = Array.from(ev.clipboardData?.items ?? [])
        .filter(i => i.type.startsWith('image/'))
        .map(i => i.getAsFile())
        .filter((f): f is File => !!f)
      if (fics.length) { ev.preventDefault(); subir(fics) }
    }
    el.addEventListener('paste', onPaste)
    return () => el.removeEventListener('paste', onPaste)
  }, [ctx.hotelId, ctx.dia, ctx.podeEditar])

  const delta = (a: number | null | undefined, b: number | null | undefined) => {
    if (a === null || a === undefined || b === null || b === undefined) return null
    const d = Math.round((a - b) * 100) / 100
    return d === 0 ? null : d
  }
  const Delta = ({ v }: { v: number | null }) =>
    v === null ? null : (
      <div className={`text-[10px] font-medium ${v > 0 ? 'text-brand-600' : 'text-red-600'}`}>
        {v > 0 ? '+' : ''}{v}
      </div>
    )

  return (
    <Seccao cor={CORES.feedback} titulo="Feedback dos hóspedes">
      {/* largura contida: sem isto as notas afastam-se demais das categorias */}
      <div className="max-w-2xl overflow-x-auto">
      <table className="w-full" style={{ minWidth: 520 }}>
        <thead>
          <tr className="border-b border-slate-100">
            <Th>Categoria</Th>
            <Th right>Hoje</Th>
            {[d1, d2, d3].map(d => <Th key={d} right>{dm(d)}</Th>)}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {T.CATEGORIAS_FEEDBACK.map(cat => {
            const linha = feedback.mapa[cat] ?? {}
            const geral = cat === 'NOTA GERAL'
            return (
              <tr key={cat} className={geral ? 'bg-slate-50 font-semibold' : ''}>
                <Td className="py-2 text-sm text-slate-700">{cat}</Td>
                <Td className="w-24">
                  <NumeroCell
                    valor={linha[dia] ?? null} passo={0.1} disabled={!ctx.podeEditar}
                    onGuardar={v => agir(() => T.guardarCelula('feedback_scores',
                      { hotel_id: ctx.hotelId, report_date: dia, category: cat },
                      { score: v, updated_by: ctx.quem },
                      'hotel_id,report_date,category'))}
                  />
                </Td>
                {[[d1, dia], [d2, d1], [d3, d2]].map(([d, anterior]) => (
                  <Td key={d} className="w-20 py-2 text-right">
                    <div className="text-sm tabular-nums text-slate-600">{linha[d] ?? '—'}</div>
                    <Delta v={delta(linha[anterior], linha[d])} />
                  </Td>
                ))}
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>

      <div ref={zona} tabIndex={-1} className="mt-4 border-t border-slate-100 pt-3 outline-none">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Comentários de hoje
          </h3>
          <label className={`btn-ghost cursor-pointer py-1 text-xs ${!ctx.podeEditar ? 'pointer-events-none opacity-50' : ''}`}>
            {aSubir ? 'A carregar…' : '+ Adicionar imagem'}
            <input type="file" accept="image/*" multiple className="hidden"
                   onChange={e => { subir(Array.from(e.target.files ?? [])); e.target.value = '' }} />
          </label>
          <span className="text-xs text-slate-400">
            ou clica aqui e cola (Ctrl+V) um screenshot
          </span>
        </div>

        {imagens.length === 0 ? (
          <Vazio>Sem imagens neste dia.</Vazio>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {imagens.map(img => (
              <div key={img.id} className="group relative aspect-square overflow-hidden rounded-lg border border-slate-200">
                {urls[img.id]
                  ? <img src={urls[img.id]} alt="" className="h-full w-full cursor-zoom-in object-cover"
                         onClick={() => setLightbox(urls[img.id])} />
                  : <div className="h-full w-full animate-pulse bg-slate-100" />}
                {ctx.podeEditar && (
                  <button
                    className="absolute right-1 top-1 hidden rounded bg-black/60 px-1.5 text-xs text-white group-hover:block"
                    onClick={() => {
                      if (confirm('Remover esta imagem?')) agir(() => T.removerImagem(img))
                    }}
                  >✕</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {lightbox && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
             onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </Seccao>
  )
}

/* ================================== VIPs =================================== */

function Vips({ ctx, linhas }: { ctx: Ctx; linhas: T.Vip[] }) {
  const agir = usarAcao(ctx)
  const set = (id: string, patch: Record<string, unknown>) =>
    agir(() => T.atualizar('vips', id, patch))

  return (
    <Seccao
      cor={CORES.vips} titulo="VIPs / E Especiais"
      acoes={btnAdd(() => agir(() => T.inserir('vips', {
        hotel_id: ctx.hotelId, report_date: ctx.dia, created_by: ctx.quem,
      })), !ctx.podeEditar)}
    >
      {linhas.length === 0 ? <Vazio>Sem VIPs registados.</Vazio> : (
        <Tabela min={860}>
          <thead>
            <tr className="border-b border-slate-100">
              <Th>Nome</Th><Th>Quarto</Th><Th>Motivo</Th><Th right>PAX</Th>
              <Th>Chegada</Th><Th>Saída</Th><Th></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {linhas.map(v => (
              <tr key={v.id}>
                <Td className="min-w-[180px]">
                  <TextoCell valor={v.nome} disabled={!ctx.podeEditar}
                             onGuardar={x => set(v.id, { nome: x })} />
                </Td>
                <Td className="w-24">
                  <TextoCell uma valor={v.quarto} disabled={!ctx.podeEditar}
                             onGuardar={x => set(v.id, { quarto: x })} />
                </Td>
                <Td className="w-52">
                  <EscolhaCell valor={v.motivo} opcoes={T.MOTIVOS_VIP} permitirLivre
                               disabled={!ctx.podeEditar}
                               onGuardar={x => set(v.id, { motivo: x })} />
                </Td>
                <Td className="w-20">
                  <NumeroCell valor={v.pax} disabled={!ctx.podeEditar}
                              onGuardar={x => set(v.id, { pax: x })} />
                </Td>
                <Td className="w-36">
                  <DataCell valor={v.chegada} disabled={!ctx.podeEditar}
                            onGuardar={x => set(v.id, { chegada: x })} />
                </Td>
                <Td className="w-36">
                  <DataCell valor={v.saida} disabled={!ctx.podeEditar}
                            onGuardar={x => set(v.id, { saida: x })} />
                </Td>
                <Td className="w-10">
                  {ctx.podeEditar && (
                    <Lixo onClick={() => {
                      if (confirm('Apagar este VIP?')) agir(() => T.apagar('vips', v.id))
                    }} />
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Tabela>
      )}
    </Seccao>
  )
}

/* ============================ Assuntos pendentes =========================== */

function Pendentes({ ctx, linhas }: { ctx: Ctx; linhas: T.PendingIssue[] }) {
  const agir = usarAcao(ctx)
  const set = (id: string, patch: Record<string, unknown>) =>
    agir(() => T.atualizar('pending_issues', id, patch))

  return (
    <Seccao
      cor={CORES.pendentes} titulo="Assuntos Pendentes"
      sub={<Badge>{linhas.filter(l => !l.resolvido).length} em aberto</Badge>}
      acoes={btnAdd(() => agir(() => T.inserir('pending_issues', {
        hotel_id: ctx.hotelId, data: ctx.dia, created_by: ctx.quem,
      })), !ctx.podeEditar)}
    >
      {linhas.length === 0 ? <Vazio>Sem assuntos pendentes.</Vazio> : (
        <Tabela min={880}>
          <thead>
            <tr className="border-b border-slate-100">
              <Th>Data</Th><Th>Depto</Th><Th>Local / Quarto</Th><Th>Assunto</Th>
              <Th right>Dias</Th><Th right>Resolvido</Th><Th></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {linhas.map(p => {
              const dias = Math.max(0, diffDias(p.data, ctx.dia))
              const alerta = dias > 7 && !p.resolvido
              return (
                <tr key={p.id} className={p.resolvido ? 'opacity-60' : ''}>
                  <Td className="w-36">
                    <DataCell valor={p.data} disabled={!ctx.podeEditar}
                              onGuardar={x => x && set(p.id, { data: x })} />
                  </Td>
                  <Td className="w-32">
                    <TextoCell uma valor={p.depto} disabled={!ctx.podeEditar}
                               onGuardar={x => set(p.id, { depto: x })} />
                  </Td>
                  <Td className="w-32">
                    <TextoCell uma valor={p.local} disabled={!ctx.podeEditar}
                               onGuardar={x => set(p.id, { local: x })} />
                  </Td>
                  <Td className="min-w-[220px]">
                    <TextoCell valor={p.assunto} disabled={!ctx.podeEditar}
                               onGuardar={x => set(p.id, { assunto: x })} />
                  </Td>
                  <Td className="w-20 py-2 text-right">
                    <Badge tom={alerta ? 'vermelho' : 'cinza'}>{dias} {dias === 1 ? 'dia' : 'dias'}</Badge>
                  </Td>
                  <Td className="w-24 py-2 text-right">
                    <CaixaCell valor={p.resolvido} disabled={!ctx.podeEditar}
                               onGuardar={v => set(p.id, {
                                 resolvido: v,
                                 resolved_date: v ? ctx.dia : null,
                                 resolved_by: v ? ctx.quem : null,
                               })} />
                  </Td>
                  <Td className="w-10">
                    {ctx.podeEditar && (
                      <Lixo onClick={() => {
                        if (confirm('Apagar este assunto?')) agir(() => T.apagar('pending_issues', p.id))
                      }} />
                    )}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Tabela>
      )}
      <p className="mt-2 text-xs text-slate-400">
        Um assunto por resolver reaparece todos os dias até ser fechado. Ao consultar um dia
        passado vês o que estava em aberto nesse dia.
      </p>
    </Seccao>
  )
}

/* ================================ Transfers ================================ */

function Transfers({ ctx, linhas }: { ctx: Ctx; linhas: T.Transfer[] }) {
  const agir = usarAcao(ctx)
  const set = (id: string, patch: Record<string, unknown>) =>
    agir(() => T.atualizar('transfers', id, { ...patch, updated_at: new Date().toISOString() }))

  const ordenadas = [...linhas].sort((a, b) => {
    if (!a.pickup_at && !b.pickup_at) return a.created_at.localeCompare(b.created_at)
    if (!a.pickup_at) return 1
    if (!b.pickup_at) return -1
    return a.pickup_at.localeCompare(b.pickup_at)
  })
  const noDia = (t: T.Transfer) =>
    !!t.pickup_at && new Date(t.pickup_at).toLocaleDateString('sv-SE') === ctx.dia

  return (
    <Seccao
      cor={CORES.transfers} titulo="Transfers / Tours"
      sub={<Badge>{ordenadas.filter(t => !t.concluido).length} por fazer</Badge>}
      acoes={btnAdd(() => agir(() => T.inserir('transfers', {
        hotel_id: ctx.hotelId, report_date: ctx.dia, created_by: ctx.quem,
      })), !ctx.podeEditar)}
    >
      {ordenadas.length === 0 ? <Vazio>Sem transfers registados.</Vazio> : (
        <Tabela min={960}>
          <thead>
            <tr className="border-b border-slate-100">
              <Th>Concluído</Th><Th>Quarto</Th><Th>Dia do Pick Up</Th><Th>Empresa</Th>
              <Th right>PAX</Th><Th>Tipo de Carro</Th><Th>Destino / Local</Th><Th></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {ordenadas.map(t => (
              <tr key={t.id} className={
                t.concluido ? 'opacity-60' : noDia(t) ? 'bg-teal-50/50' : ''}>
                <Td className="w-24 py-2">
                  <CaixaCell valor={t.concluido} disabled={!ctx.podeEditar}
                             onGuardar={v => set(t.id, {
                               concluido: v,
                               concluded_date: v ? ctx.dia : null,
                               concluded_by: v ? ctx.quem : null,
                             })} />
                </Td>
                <Td className="w-24">
                  <TextoCell uma valor={t.quarto} disabled={!ctx.podeEditar}
                             onGuardar={x => set(t.id, { quarto: x })} />
                </Td>
                <Td className="w-52">
                  <DataHoraCell valor={t.pickup_at} destaque={noDia(t)} disabled={!ctx.podeEditar}
                                onGuardar={x => set(t.id, { pickup_at: x })} />
                </Td>
                <Td className="min-w-[140px]">
                  <TextoCell valor={t.empresa} disabled={!ctx.podeEditar}
                             onGuardar={x => set(t.id, { empresa: x })} />
                </Td>
                <Td className="w-20">
                  <NumeroCell valor={t.pax} disabled={!ctx.podeEditar}
                              onGuardar={x => set(t.id, { pax: x })} />
                </Td>
                <Td className="min-w-[130px]">
                  <TextoCell valor={t.tipo_carro} disabled={!ctx.podeEditar}
                             onGuardar={x => set(t.id, { tipo_carro: x })} />
                </Td>
                <Td className="min-w-[160px]">
                  <TextoCell valor={t.destino} disabled={!ctx.podeEditar}
                             onGuardar={x => set(t.id, { destino: x })} />
                </Td>
                <Td className="w-10">
                  {ctx.podeEditar && (
                    <Lixo onClick={() => {
                      if (confirm('Apagar este transfer?')) agir(() => T.apagar('transfers', t.id))
                    }} />
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Tabela>
      )}
    </Seccao>
  )
}

/* =============================== Breakfast box ============================= */

function Breakfast({ ctx, linhas }: { ctx: Ctx; linhas: T.BreakfastBox[] }) {
  const agir = usarAcao(ctx)
  const set = (id: string, patch: Record<string, unknown>) =>
    agir(() => T.atualizar('breakfast_boxes', id, { ...patch, updated_at: new Date().toISOString() }))

  const ordenadas = [...linhas].sort((a, b) => {
    const d = (a.para_dia ?? '9999').localeCompare(b.para_dia ?? '9999')
    if (d) return d
    const h = (a.para_horas ?? '99').localeCompare(b.para_horas ?? '99')
    return h || a.created_at.localeCompare(b.created_at)
  })

  return (
    <Seccao
      cor={CORES.breakfast} titulo="Breakfast Box"
      sub={<Badge tom={ordenadas.some(b => !b.pedida) ? 'vermelho' : 'cinza'}>
        {ordenadas.filter(b => !b.pedida).length} por pedir
      </Badge>}
      acoes={btnAdd(() => agir(() => T.inserir('breakfast_boxes', {
        hotel_id: ctx.hotelId, report_date: ctx.dia, para_dia: ctx.dia,
        pedida: false, created_by: ctx.quem,
      })), !ctx.podeEditar)}
    >
      {ordenadas.length === 0 ? <Vazio>Sem breakfast boxes registados.</Vazio> : (
        <Tabela min={940}>
          <thead>
            <tr className="border-b border-slate-100">
              <Th>Quarto</Th><Th>Nome do Hóspede</Th><Th right>Nº BB's</Th>
              <Th>Para que dia</Th><Th>Horas</Th><Th>Pedida à cozinha</Th>
              <Th>Restrições / Notas</Th><Th></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {ordenadas.map(b => (
              <tr key={b.id} className={`${b.para_dia === ctx.dia ? 'bg-amber-50/50' : ''} ${
                !b.pedida ? 'border-l-4 border-l-red-500' : ''}`}>
                <Td className="w-24">
                  <TextoCell uma valor={b.quarto} disabled={!ctx.podeEditar}
                             onGuardar={x => set(b.id, { quarto: x })} />
                </Td>
                <Td className="min-w-[160px]">
                  <TextoCell valor={b.nome} disabled={!ctx.podeEditar}
                             onGuardar={x => set(b.id, { nome: x })} />
                </Td>
                <Td className="w-20">
                  <NumeroCell valor={b.num_bb} disabled={!ctx.podeEditar}
                              onGuardar={x => set(b.id, { num_bb: x })} />
                </Td>
                <Td className="w-36">
                  <DataCell valor={b.para_dia} disabled={!ctx.podeEditar}
                            onGuardar={x => set(b.id, { para_dia: x })} />
                </Td>
                <Td className="w-28">
                  <HoraCell valor={b.para_horas} disabled={!ctx.podeEditar}
                            onGuardar={x => set(b.id, { para_horas: x })} />
                </Td>
                <Td className="w-36 py-2">
                  <div className="flex items-center gap-2">
                    <CaixaCell valor={b.pedida} disabled={!ctx.podeEditar}
                               onGuardar={v => set(b.id, { pedida: v })} />
                    <Badge tom={b.pedida ? 'cinza' : 'vermelho'}>
                      {b.pedida ? 'Pedida' : 'Por pedir'}
                    </Badge>
                  </div>
                </Td>
                <Td className="min-w-[160px]">
                  <TextoCell valor={b.notas} disabled={!ctx.podeEditar}
                             onGuardar={x => set(b.id, { notas: x })} />
                </Td>
                <Td className="w-10">
                  {ctx.podeEditar && (
                    <Lixo onClick={() => {
                      if (confirm('Apagar esta breakfast box?')) agir(() => T.apagar('breakfast_boxes', b.id))
                    }} />
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </Tabela>
      )}
    </Seccao>
  )
}

/* ============================ Relevantes de hoje =========================== */

function Relevantes({
  ctx, hsk, perdidos, emprestados,
}: { ctx: Ctx; hsk: T.HskReport[]; perdidos: T.LostItem[]; emprestados: T.BorrowedItem[] }) {
  const agir = usarAcao(ctx)

  const resolver = (tabela: string, id: string, v: boolean) =>
    agir(() => T.atualizar(tabela, id, {
      resolvido: v, resolved_date: v ? ctx.dia : null, resolved_by: v ? ctx.quem : null,
    }))

  const Sub = ({ titulo, onAdd, children, vazio }: {
    titulo: string; onAdd: () => void; children: React.ReactNode; vazio: boolean
  }) => (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{titulo}</h3>
        {btnAdd(onAdd, !ctx.podeEditar)}
      </div>
      {vazio ? <Vazio>Sem entradas.</Vazio> : children}
    </div>
  )

  return (
    <Seccao cor={CORES.relevantes} titulo="Relevantes de Hoje">
      <div className="space-y-6">
        <Sub
          titulo="Relatório HSK" vazio={hsk.length === 0}
          onAdd={() => agir(() => T.inserir('hsk_reports', {
            hotel_id: ctx.hotelId, report_date: ctx.dia, data: ctx.dia,
            tipo: 'NI', created_by: ctx.quem,
          }))}
        >
          <Tabela min={760}>
            <thead>
              <tr className="border-b border-slate-100">
                <Th>Data</Th><Th>Depto</Th><Th>Tipo</Th><Th>Texto</Th>
                <Th right>Resolvido</Th><Th></Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {hsk.map(h => (
                <tr key={h.id} className={h.resolvido ? 'opacity-60' : ''}>
                  <Td className="w-36">
                    <DataCell valor={h.data} disabled={!ctx.podeEditar}
                              onGuardar={x => x && agir(() => T.atualizar('hsk_reports', h.id, { data: x }))} />
                  </Td>
                  <Td className="w-28">
                    <TextoCell uma valor={h.depto} disabled={!ctx.podeEditar}
                               onGuardar={x => agir(() => T.atualizar('hsk_reports', h.id, { depto: x }))} />
                  </Td>
                  <Td className="w-28">
                    <EscolhaCell valor={h.tipo} opcoes={T.TIPOS_HSK} disabled={!ctx.podeEditar}
                                 onGuardar={x => agir(() => T.atualizar('hsk_reports', h.id, { tipo: x }))} />
                  </Td>
                  <Td className="min-w-[220px]">
                    <TextoCell valor={h.texto} disabled={!ctx.podeEditar}
                               onGuardar={x => agir(() => T.atualizar('hsk_reports', h.id, { texto: x }))} />
                  </Td>
                  <Td className="w-24 py-2 text-right">
                    <CaixaCell valor={h.resolvido} disabled={!ctx.podeEditar}
                               onGuardar={v => resolver('hsk_reports', h.id, v)} />
                  </Td>
                  <Td className="w-10">
                    {ctx.podeEditar && <Lixo onClick={() => {
                      if (confirm('Apagar este registo?')) agir(() => T.apagar('hsk_reports', h.id))
                    }} />}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        </Sub>

        <Sub
          titulo="Objetos Perdidos" vazio={perdidos.length === 0}
          onAdd={() => agir(() => T.inserir('lost_items', {
            hotel_id: ctx.hotelId, report_date: ctx.dia, data: ctx.dia, created_by: ctx.quem,
          }))}
        >
          <Tabela min={760}>
            <thead>
              <tr className="border-b border-slate-100">
                <Th>Data</Th><Th>Depto</Th><Th>Local</Th><Th>Descrição</Th>
                <Th right>Resolvido</Th><Th></Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {perdidos.map(p => (
                <tr key={p.id} className={p.resolvido ? 'opacity-60' : ''}>
                  <Td className="w-36">
                    <DataCell valor={p.data} disabled={!ctx.podeEditar}
                              onGuardar={x => x && agir(() => T.atualizar('lost_items', p.id, { data: x }))} />
                  </Td>
                  <Td className="w-28">
                    <TextoCell uma valor={p.depto} disabled={!ctx.podeEditar}
                               onGuardar={x => agir(() => T.atualizar('lost_items', p.id, { depto: x }))} />
                  </Td>
                  <Td className="w-32">
                    <TextoCell uma valor={p.local} disabled={!ctx.podeEditar}
                               onGuardar={x => agir(() => T.atualizar('lost_items', p.id, { local: x }))} />
                  </Td>
                  <Td className="min-w-[220px]">
                    <TextoCell valor={p.descricao} disabled={!ctx.podeEditar}
                               onGuardar={x => agir(() => T.atualizar('lost_items', p.id, { descricao: x }))} />
                  </Td>
                  <Td className="w-24 py-2 text-right">
                    <CaixaCell valor={p.resolvido} disabled={!ctx.podeEditar}
                               onGuardar={v => resolver('lost_items', p.id, v)} />
                  </Td>
                  <Td className="w-10">
                    {ctx.podeEditar && <Lixo onClick={() => {
                      if (confirm('Apagar este registo?')) agir(() => T.apagar('lost_items', p.id))
                    }} />}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        </Sub>

        <Sub
          titulo="Objetos Emprestados" vazio={emprestados.length === 0}
          onAdd={() => agir(() => T.inserir('borrowed_items', {
            hotel_id: ctx.hotelId, report_date: ctx.dia, data: ctx.dia, created_by: ctx.quem,
          }))}
        >
          <Tabela min={760}>
            <thead>
              <tr className="border-b border-slate-100">
                <Th>Data</Th><Th>Quarto</Th><Th>Data CO</Th><Th>Objeto</Th>
                <Th right>Resolvido</Th><Th></Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {emprestados.map(b => (
                <tr key={b.id} className={b.resolvido ? 'opacity-60' : ''}>
                  <Td className="w-36">
                    <DataCell valor={b.data} disabled={!ctx.podeEditar}
                              onGuardar={x => x && agir(() => T.atualizar('borrowed_items', b.id, { data: x }))} />
                  </Td>
                  <Td className="w-24">
                    <TextoCell uma valor={b.quarto} disabled={!ctx.podeEditar}
                               onGuardar={x => agir(() => T.atualizar('borrowed_items', b.id, { quarto: x }))} />
                  </Td>
                  <Td className="w-36">
                    <DataCell valor={b.data_co} disabled={!ctx.podeEditar}
                              onGuardar={x => agir(() => T.atualizar('borrowed_items', b.id, { data_co: x }))} />
                  </Td>
                  <Td className="min-w-[220px]">
                    <TextoCell valor={b.objeto} disabled={!ctx.podeEditar}
                               onGuardar={x => agir(() => T.atualizar('borrowed_items', b.id, { objeto: x }))} />
                  </Td>
                  <Td className="w-24 py-2 text-right">
                    <CaixaCell valor={b.resolvido} disabled={!ctx.podeEditar}
                               onGuardar={v => resolver('borrowed_items', b.id, v)} />
                  </Td>
                  <Td className="w-10">
                    {ctx.podeEditar && <Lixo onClick={() => {
                      if (confirm('Apagar este registo?')) agir(() => T.apagar('borrowed_items', b.id))
                    }} />}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        </Sub>
      </div>
    </Seccao>
  )
}

/* ================================== F&B ==================================== */

function FeB({
  ctx, numeros, previsao,
}: { ctx: Ctx; numeros: T.FbNumber[]; previsao: T.FbForecast[] }) {
  const agir = usarAcao(ctx)
  const [aba, setAba] = useState<'dia' | 'semana'>('dia')
  const porColuna = new Map(numeros.map(n => [n.coluna, n]))
  const porOffset = new Map(previsao.map(p => [p.day_offset, p]))

  const guardarNum = (coluna: string, valores: Record<string, number>) => {
    const atual = porColuna.get(coluna)
    const ins = valores.ins ?? atual?.ins ?? 0
    const outs = valores.outs ?? atual?.outs ?? 0
    return agir(() => T.guardarCelula('fb_numbers',
      { hotel_id: ctx.hotelId, report_date: ctx.dia, coluna },
      { ...valores, total_pax: ins + outs, updated_by: ctx.quem },
      'hotel_id,report_date,coluna'))
  }

  const totalEur = T.SERVICOS_FB.reduce((acc, s) => acc + Number(porColuna.get(s.id)?.total_eur ?? 0), 0)

  const linhasPrev: { campo: keyof T.FbForecast; titulo: string }[] = [
    { campo: 'hospedes', titulo: 'Hóspedes' },
    { campo: 'pa_incluidos', titulo: 'PA Incluídos' },
    { campo: 'meia_pensao', titulo: 'Meia Pensão' },
    { campo: 'pensao_completa', titulo: 'Pensão Completa' },
  ]

  return (
    <Seccao
      cor={CORES.fb} titulo="Números de Restaurante (F&B)"
      sub={<Badge tom="cinza">{diaSemanaLongo(ctx.dia)} · {dm(ctx.dia)}</Badge>}
      acoes={
        <div className="flex gap-1">
          {(['dia', 'semana'] as const).map(a => (
            <button key={a} onClick={() => setAba(a)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                aba === a ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}>
              {a === 'dia' ? 'Dia' : 'Resumo da Semana'}
            </button>
          ))}
        </div>
      }
    >
      {aba === 'dia' ? (
        <>
          <Tabela min={880}>
            <thead>
              <tr className="border-b border-slate-100">
                <Th></Th>
                {T.SERVICOS_FB.map(s => <Th key={s.id} right>{s.label}</Th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {(['ins', 'outs'] as const).map(campo => (
                <tr key={campo}>
                  <Td className="py-2 text-sm font-medium text-slate-700">
                    {campo === 'ins' ? "IN's" : "OUT's"}
                  </Td>
                  {T.SERVICOS_FB.map(s => (
                    <Td key={s.id} className="w-24">
                      <NumeroCell
                        valor={porColuna.get(s.id)?.[campo] ?? 0} vazioComoZero
                        disabled={!ctx.podeEditar}
                        onGuardar={v => guardarNum(s.id, { [campo]: v ?? 0 })}
                      />
                    </Td>
                  ))}
                </tr>
              ))}
              <tr className="bg-purple-50 font-semibold">
                <Td className="py-2 text-sm text-slate-700">Total (PAX)</Td>
                {T.SERVICOS_FB.map(s => {
                  const n = porColuna.get(s.id)
                  return (
                    <Td key={s.id} className="py-2 text-right text-sm tabular-nums">
                      {(n?.ins ?? 0) + (n?.outs ?? 0)}
                    </Td>
                  )
                })}
              </tr>
              <tr className="bg-purple-50/60 font-semibold">
                <Td className="py-2 text-sm text-slate-700">Total (€)</Td>
                {T.SERVICOS_FB.map(s => (
                  <Td key={s.id} className="w-28">
                    <NumeroCell
                      valor={porColuna.get(s.id)?.total_eur ?? 0} passo={0.01} vazioComoZero
                      disabled={!ctx.podeEditar}
                      onGuardar={v => guardarNum(s.id, { total_eur: v ?? 0 })}
                    />
                  </Td>
                ))}
              </tr>
              <tr>
                <Td className="py-2 text-sm font-medium text-slate-700">Média (€/PAX)</Td>
                {T.SERVICOS_FB.map(s => {
                  const n = porColuna.get(s.id)
                  const pax = (n?.ins ?? 0) + (n?.outs ?? 0)
                  return (
                    <Td key={s.id} className="py-2 text-right text-sm tabular-nums text-slate-500">
                      {pax ? (Number(n?.total_eur ?? 0) / pax).toFixed(2) : '—'}
                    </Td>
                  )
                })}
              </tr>
            </tbody>
          </Tabela>
          <div className="mt-2 text-right text-sm font-semibold text-slate-800">
            TOTAL: {money(totalEur)}
          </div>
        </>
      ) : (
        <ResumoSemana ctx={ctx} />
      )}

      {/* previsão */}
      <div className="mt-6 border-t border-slate-100 pt-4">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Previsão de PAs + MP + PC (7 dias)
        </h3>
        <Tabela min={720}>
          <thead>
            <tr className="border-b border-slate-100">
              <Th></Th>
              {[0, 1, 2, 3, 4, 5, 6].map(o => (
                <Th key={o} right>{o === 0 ? 'Hoje' : `+${o}`}</Th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {linhasPrev.map(l => (
              <tr key={String(l.campo)}>
                <Td className="py-2 text-sm font-medium text-slate-700">{l.titulo}</Td>
                {[0, 1, 2, 3, 4, 5, 6].map(o => {
                  const p = porOffset.get(o)
                  const valor = (p?.[l.campo] as number | undefined) ?? 0
                  const realce = (l.campo === 'meia_pensao' || l.campo === 'pensao_completa') && valor > 0
                  const pct = l.campo === 'pa_incluidos' && valor > 0 && (p?.hospedes ?? 0) > 0
                    ? Math.round((valor / p!.hospedes) * 100) : null
                  return (
                    <Td key={o} className="w-24">
                      <NumeroCell
                        valor={valor} vazioComoZero disabled={!ctx.podeEditar}
                        className={realce ? 'bg-purple-50 font-semibold text-purple-800' : ''}
                        onGuardar={v => agir(() => T.guardarCelula('fb_forecast',
                          { hotel_id: ctx.hotelId, report_date: ctx.dia, day_offset: o },
                          { [l.campo]: v ?? 0, updated_by: ctx.quem },
                          'hotel_id,report_date,day_offset'))}
                      />
                      {pct !== null && (
                        <div className="pr-2 text-right text-[10px] text-slate-400">{pct}%</div>
                      )}
                    </Td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </Tabela>
      </div>
    </Seccao>
  )
}

function ResumoSemana({ ctx }: { ctx: Ctx }) {
  const [inicio, setInicio] = useState(() => segundaDe(ctx.dia))
  const [linhas, setLinhas] = useState<T.FbNumber[] | null>(null)
  const [mes, setMes] = useState<T.FbNumber[]>([])
  const fim = addDays(inicio, 6)

  useEffect(() => {
    setLinhas(null)
    const mesInicio = `${ctx.dia.slice(0, 7)}-01`
    const mesFim = lastDayOfMonth(ctx.dia.slice(0, 7))
    Promise.all([
      T.fetchFbSemana(ctx.hotelId, inicio, fim),
      T.fetchFbSemana(ctx.hotelId, mesInicio, mesFim),
    ]).then(([sem, m]) => { setLinhas(sem); setMes(m) })
  }, [ctx.hotelId, inicio, ctx.dia])

  if (!linhas) return <p className="py-6 text-center text-sm text-slate-400">A carregar…</p>

  const dias = Array.from({ length: 7 }, (_, i) => addDays(inicio, i))
  const cel = (servico: string, d: string) =>
    linhas.filter(l => l.coluna === servico && l.report_date === d)
      .reduce((a, l) => ({ pax: a.pax + l.total_pax, eur: a.eur + Number(l.total_eur) }), { pax: 0, eur: 0 })

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setInicio(addDays(inicio, -7))}>‹</button>
        <span className="text-sm font-medium text-slate-700">
          Semana de {dm(inicio)} a {dm(fim)}
        </span>
        <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setInicio(addDays(inicio, 7))}>›</button>
        <button className="btn-ghost py-1 text-xs" onClick={() => setInicio(segundaDe(ctx.dia))}>
          Semana atual
        </button>
      </div>
      <Tabela min={980}>
        <thead>
          <tr className="border-b border-slate-100">
            <Th>Serviço</Th>
            {dias.map(d => (
              <Th key={d} right>
                {DIAS_CURTOS[new Date(d + 'T12:00:00').getDay()]}<br />
                <span className="font-normal">{dm(d)}</span>
              </Th>
            ))}
            <Th right>Semana</Th>
            <Th right>Mês</Th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {T.SERVICOS_FB.map(s => {
            const sem = dias.map(d => cel(s.id, d))
            const totSem = sem.reduce((a, c) => ({ pax: a.pax + c.pax, eur: a.eur + c.eur }), { pax: 0, eur: 0 })
            const totMes = mes.filter(l => l.coluna === s.id)
              .reduce((a, l) => ({ pax: a.pax + l.total_pax, eur: a.eur + Number(l.total_eur) }), { pax: 0, eur: 0 })
            return (
              <tr key={s.id}>
                <Td className="py-2 text-sm text-slate-700">{s.label}</Td>
                {sem.map((c, i) => (
                  <Td key={i} className="py-2 text-right text-xs tabular-nums">
                    {c.pax || c.eur ? (
                      <><div>{c.pax} pax</div><div className="text-slate-500">{money(c.eur)}</div></>
                    ) : <span className="text-slate-300">—</span>}
                  </Td>
                ))}
                <Td className="py-2 text-right text-xs font-medium tabular-nums">
                  <div>{totSem.pax} pax</div><div className="text-slate-500">{money(totSem.eur)}</div>
                </Td>
                <Td className="py-2 text-right text-xs font-medium tabular-nums">
                  <div>{totMes.pax} pax</div><div className="text-slate-500">{money(totMes.eur)}</div>
                </Td>
              </tr>
            )
          })}
          <tr className="bg-slate-50 font-semibold">
            <Td className="py-2 text-sm">Total dia</Td>
            {dias.map(d => {
              const t = T.SERVICOS_FB.reduce((a, s) => {
                const c = cel(s.id, d); return { pax: a.pax + c.pax, eur: a.eur + c.eur }
              }, { pax: 0, eur: 0 })
              return (
                <Td key={d} className="py-2 text-right text-xs tabular-nums">
                  <div>{t.pax} pax</div><div>{money(t.eur)}</div>
                </Td>
              )
            })}
            <Td className="py-2 text-right text-xs tabular-nums">
              {(() => {
                const t = linhas.reduce((a, l) => ({ pax: a.pax + l.total_pax, eur: a.eur + Number(l.total_eur) }), { pax: 0, eur: 0 })
                return <><div>{t.pax} pax</div><div>{money(t.eur)}</div></>
              })()}
            </Td>
            <Td className="py-2 text-right text-xs tabular-nums">
              {(() => {
                const t = mes.reduce((a, l) => ({ pax: a.pax + l.total_pax, eur: a.eur + Number(l.total_eur) }), { pax: 0, eur: 0 })
                return <><div>{t.pax} pax</div><div>{money(t.eur)}</div></>
              })()}
            </Td>
          </tr>
        </tbody>
      </Tabela>
    </div>
  )
}

/* ============================== Notas do F&B =============================== */
/**
 * Escritas pela equipa de F&B no fecho diário deles. Aparecem aqui para quem
 * lê o turno não ter de ir a dois sítios — mas só de leitura: corrigem-se em
 * Faturação F&B → Dia.
 */
function NotasFb({ notas }: { notas: T.FbNotas | null }) {
  const porServico = notas?.por_servico ?? {}
  const linhas = T.SERVICOS_FB
    .map(s => ({ label: s.label, texto: (porServico[s.id] ?? '').trim() }))
    .filter(l => l.texto)
  const equipa = (notas?.equipa ?? '').trim()

  return (
    <Seccao cor={CORES.fb} titulo="Notas do F&B">
      {!linhas.length && !equipa ? (
        <p className="px-4 py-3 text-sm text-slate-500">
          A equipa de F&amp;B ainda não deixou notas deste dia.
        </p>
      ) : (
        <div className="space-y-3 px-4 py-3">
          {linhas.map(l => (
            <div key={l.label}>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {l.label}
              </div>
              <p className="whitespace-pre-line text-sm text-slate-700">{l.texto}</p>
            </div>
          ))}
          {equipa && (
            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Assuntos da equipa
              </div>
              <p className="whitespace-pre-line text-sm text-slate-700">{equipa}</p>
            </div>
          )}
          <p className="text-xs text-slate-400">
            Escrito pela equipa de F&amp;B. A manutenção que reportarem aparece no
            Controlo de Manutenção, no separador Pendentes.
          </p>
        </div>
      )}
    </Seccao>
  )
}

/* ================================ Manutenção =============================== */

function Manutencao({ ctx, linhas }: { ctx: Ctx; linhas: T.Maintenance[] }) {
  const agir = usarAcao(ctx)
  const set = (id: string, patch: Record<string, unknown>) =>
    agir(() => T.atualizar('maintenance', id, patch))

  return (
    <Seccao
      cor={CORES.manutencao} titulo="Controlo de Manutenção"
      sub={<Badge tom={linhas.some(l => l.status !== 'resolvido' && diffDias(l.data, ctx.dia) > 7) ? 'vermelho' : 'cinza'}>
        {linhas.filter(l => l.status !== 'resolvido').length} por resolver
      </Badge>}
      acoes={btnAdd(() => agir(() => T.inserir('maintenance', {
        hotel_id: ctx.hotelId, data: ctx.dia, status: 'por_resolver', created_by: ctx.quem,
      })), !ctx.podeEditar)}
    >
      {linhas.length === 0 ? <Vazio>Sem registos.</Vazio> : (
        <Tabela min={900}>
          <thead>
            <tr className="border-b border-slate-100">
              <Th>Data</Th><Th>Local</Th><Th>Informante</Th><Th>Intervenção</Th>
              <Th>Status</Th><Th right>Reportado há</Th><Th></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {linhas.map(m => {
              const dias = diffDias(m.data, ctx.dia)
              const alerta = dias > 7 && m.status !== 'resolvido'
              return (
                <tr key={m.id} className={m.status === 'resolvido' ? 'opacity-60' : ''}>
                  <Td className="w-36">
                    <DataCell valor={m.data} disabled={!ctx.podeEditar}
                              onGuardar={x => x && set(m.id, { data: x })} />
                  </Td>
                  <Td className="min-w-[140px]">
                    <TextoCell valor={m.local} disabled={!ctx.podeEditar}
                               onGuardar={x => set(m.id, { local: x })} />
                  </Td>
                  <Td className="w-32">
                    <TextoCell valor={m.informante} disabled={!ctx.podeEditar}
                               onGuardar={x => set(m.id, { informante: x })} />
                  </Td>
                  <Td className="min-w-[200px]">
                    <TextoCell valor={m.intervencao} disabled={!ctx.podeEditar}
                               onGuardar={x => set(m.id, { intervencao: x })} />
                  </Td>
                  <Td className="w-36">
                    <EscolhaCell
                      valor={m.status} opcoes={T.ESTADOS_MANUTENCAO} placeholder="Por resolver"
                      disabled={!ctx.podeEditar}
                      onGuardar={x => set(m.id, {
                        status: x ?? 'por_resolver',
                        resolved_date: x === 'resolvido' ? ctx.dia : null,
                        resolved_by: x === 'resolvido' ? ctx.quem : null,
                      })}
                    />
                  </Td>
                  <Td className="w-28 py-2 text-right">
                    <Badge tom={alerta ? 'vermelho' : 'cinza'}>{dias} {dias === 1 ? 'dia' : 'dias'}</Badge>
                  </Td>
                  <Td className="w-10">
                    {ctx.podeEditar && <Lixo onClick={() => {
                      if (confirm('Apagar este registo?')) agir(() => T.apagar('maintenance', m.id))
                    }} />}
                  </Td>
                </tr>
              )
            })}
          </tbody>
        </Tabela>
      )}
    </Seccao>
  )
}

/* =============================== Reclamações =============================== */

function Reclamacoes({ ctx, linhas }: { ctx: Ctx; linhas: T.Complaint[] }) {
  const agir = usarAcao(ctx)
  const [verFechadas, setVerFechadas] = useState(false)
  const set = (id: string, patch: Record<string, unknown>) =>
    agir(() => T.atualizar('complaints', id, patch))

  const visiveis = verFechadas ? linhas : linhas.filter(c => c.status !== 'fechada')

  return (
    <Seccao
      cor={CORES.reclamacoes} titulo="Gestão de Reclamações"
      sub={<Badge tom={linhas.some(c => c.status !== 'fechada') ? 'ambar' : 'cinza'}>
        {linhas.filter(c => c.status !== 'fechada').length} abertas
      </Badge>}
      acoes={
        <>
          <label className="flex items-center gap-1.5 text-xs text-slate-500">
            <input type="checkbox" checked={verFechadas}
                   onChange={e => setVerFechadas(e.target.checked)} />
            mostrar fechadas
          </label>
          {btnAdd(() => agir(() => T.inserir('complaints', {
            hotel_id: ctx.hotelId, status: 'aberta', created_date: ctx.dia, created_by: ctx.quem,
          })), !ctx.podeEditar)}
        </>
      }
    >
      {visiveis.length === 0 ? <Vazio>Sem reclamações registadas.</Vazio> : (
        <Tabela min={860}>
          <thead>
            <tr className="border-b border-slate-100">
              <Th>Registada</Th><Th>Quarto</Th><Th>Check-in</Th><Th>Check-out</Th>
              <Th>Comentário / Reclamação</Th><Th>Status</Th><Th></Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {visiveis.map(c => (
              <tr key={c.id} className={c.status === 'fechada' ? 'opacity-60' : ''}>
                <Td className="w-28 py-2 text-sm text-slate-500">{dmy(c.created_date)}</Td>
                <Td className="w-24">
                  <TextoCell uma valor={c.quarto} disabled={!ctx.podeEditar}
                             onGuardar={x => set(c.id, { quarto: x })} />
                </Td>
                <Td className="w-36">
                  <DataCell valor={c.checkin} disabled={!ctx.podeEditar}
                            onGuardar={x => set(c.id, { checkin: x })} />
                </Td>
                <Td className="w-36">
                  <DataCell valor={c.checkout} disabled={!ctx.podeEditar}
                            onGuardar={x => set(c.id, { checkout: x })} />
                </Td>
                <Td className="min-w-[240px]">
                  <TextoCell valor={c.comentario} disabled={!ctx.podeEditar}
                             onGuardar={x => set(c.id, { comentario: x })} />
                </Td>
                <Td className="w-32">
                  <EscolhaCell valor={c.status} opcoes={T.ESTADOS_RECLAMACAO} placeholder="Aberta"
                               disabled={!ctx.podeEditar}
                               onGuardar={x => set(c.id, { status: x ?? 'aberta' })} />
                </Td>
                <Td className="w-10">
                  {ctx.podeEditar && <Lixo onClick={() => {
                    if (confirm('Apagar esta reclamação?')) agir(() => T.apagar('complaints', c.id))
                  }} />}
                </Td>
              </tr>
            ))}
          </tbody>
        </Tabela>
      )}
    </Seccao>
  )
}

/* ================================ Chegadas ================================= */

const CABECALHOS: Record<string, string[]> = {
  number: ['number', 'nº', 'no', 'n.'],
  last_name: ['lastname', 'apelido', 'surname'],
  first_name: ['firstname', 'nome'],
  nights: ['count(nights)', 'nights', 'noites'],
  pax: ['personcount', 'pax'],
  room_requested: ['requestedcategory', 'roomrequested', 'tipologia'],
  room_number: ['spacenumber', 'room#', 'room', 'quarto'],
  products: ['products', 'produtos'],
  travel_agency: ['travelagency', 'agência', 'agencia'],
  adr: ['averagerate(nightly)', 'adr'],
  total_amount: ['totalamount', 'total', 'valortotal'],
  notes: ['notes', 'notas'],
  customer_notes: ['customernotes', 'notasdocliente'],
}

function Chegadas({ ctx, hoje, amanha }: { ctx: Ctx; hoje: T.Arrival[]; amanha: T.Arrival[] }) {
  const agir = usarAcao(ctx)
  const toast = useToast()
  const [aba, setAba] = useState<'hoje' | 'amanha'>('hoje')
  const [busca, setBusca] = useState('')
  const [ordem, setOrdem] = useState<{ campo: keyof T.Arrival; asc: boolean } | null>(null)
  const [aImportar, setAImportar] = useState(false)
  const [resumo, setResumo] = useState<string | null>(null)

  const diaAba = aba === 'hoje' ? ctx.dia : addDays(ctx.dia, 1)
  const linhas = aba === 'hoje' ? hoje : amanha

  const importar = async (f: File) => {
    setAImportar(true)
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' })
      const norm = (s: string) => String(s).toLowerCase().replace(/\s+/g, '')
      let nome = wb.SheetNames.find(n => norm(n) === 'reservations')
      if (!nome) {
        nome = wb.SheetNames.find(n => {
          const linha = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[n], { header: 1 })[0] ?? []
          const cab = linha.map(norm)
          return cab.includes('number') && cab.includes('lastname')
        })
      }
      const folha = wb.Sheets[nome ?? wb.SheetNames[0]]
      const cruas = XLSX.utils.sheet_to_json<Record<string, unknown>>(folha, { defval: null })

      const acha = (linha: Record<string, unknown>, alvos: string[]) => {
        for (const chave of Object.keys(linha)) {
          if (alvos.includes(norm(chave))) return linha[chave]
        }
        return null
      }
      const numero = (v: unknown) => {
        if (v === null || v === undefined || v === '') return null
        const n = Number(String(v).replace(/[^\d.,-]/g, '').replace(',', '.'))
        return Number.isFinite(n) ? n : null
      }
      const texto = (v: unknown) => (v === null || v === undefined || v === '' ? null : String(v).trim())

      let canceladas = 0
      const novas: Record<string, unknown>[] = []
      for (const linha of cruas) {
        const estado = norm(String(acha(linha, ['status']) ?? ''))
        if (['canceled', 'cancelled', 'cancelado', 'cancelada'].includes(estado)) { canceladas++; continue }
        const num = texto(acha(linha, CABECALHOS.number))
        const apelido = texto(acha(linha, CABECALHOS.last_name))
        if (!num && !apelido) continue
        novas.push({
          hotel_id: ctx.hotelId, arrival_date: diaAba,
          number: num, last_name: apelido,
          first_name: texto(acha(linha, CABECALHOS.first_name)),
          nights: numero(acha(linha, CABECALHOS.nights)),
          pax: numero(acha(linha, CABECALHOS.pax)),
          room_requested: texto(acha(linha, CABECALHOS.room_requested)),
          room_number: texto(acha(linha, CABECALHOS.room_number)),
          products: texto(acha(linha, CABECALHOS.products)),
          travel_agency: texto(acha(linha, CABECALHOS.travel_agency)),
          adr: numero(acha(linha, CABECALHOS.adr)),
          total_amount: numero(acha(linha, CABECALHOS.total_amount)),
          notes: texto(acha(linha, CABECALHOS.notes)),
          customer_notes: texto(acha(linha, CABECALHOS.customer_notes)),
          created_by: ctx.quem,
        })
      }
      if (!novas.length) throw new Error('Não encontrei reservas neste ficheiro.')

      const anteriores = linhas.length
      await supabase.from('arrivals').delete()
        .eq('hotel_id', ctx.hotelId).eq('arrival_date', diaAba)
      const { error } = await supabase.from('arrivals').insert(novas)
      if (error) throw new Error(error.message)

      await ctx.recarregar()
      setResumo(
        `${novas.length} reservas importadas` +
        (canceladas ? `, ${canceladas} ignoradas (canceladas)` : '') +
        (anteriores ? `. Substituíram as ${anteriores} chegadas anteriores deste dia.` : '.'),
      )
    } catch (e) {
      toast((e as Error).message, 'erro')
    } finally { setAImportar(false) }
  }

  const colunas: { campo: keyof T.Arrival; titulo: string; num?: boolean; ordenavel?: boolean }[] = [
    { campo: 'number', titulo: 'Nº', num: true },
    { campo: 'last_name', titulo: 'Apelido' },
    { campo: 'first_name', titulo: 'Nome' },
    { campo: 'nights', titulo: 'Noites', num: true },
    { campo: 'pax', titulo: 'PAX', num: true },
    { campo: 'room_requested', titulo: 'Tipologia' },
    { campo: 'room_number', titulo: 'Quarto', num: true },
    { campo: 'products', titulo: 'Produtos', ordenavel: false },
    { campo: 'travel_agency', titulo: 'Agência' },
    { campo: 'adr', titulo: 'ADR', num: true },
    { campo: 'total_amount', titulo: 'Total', num: true },
    { campo: 'notes', titulo: 'Notas' },
    { campo: 'customer_notes', titulo: 'Notas do Cliente' },
  ]

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase()
    let r = linhas
    if (q) {
      r = r.filter(a => [a.last_name, a.first_name, a.room_number, a.number, a.travel_agency]
        .some(v => (v ?? '').toLowerCase().includes(q)))
    }
    if (ordem) {
      const col = colunas.find(c => c.campo === ordem.campo)
      r = [...r].sort((x, y) => {
        const a = x[ordem.campo], b = y[ordem.campo]
        const va = a === null || a === undefined || a === '' , vb = b === null || b === undefined || b === ''
        if (va && vb) return 0
        if (va) return 1          // vazios sempre no fim
        if (vb) return -1
        let cmp: number
        if (col?.num) {
          const na = Number(String(a).replace(',', '.')), nb = Number(String(b).replace(',', '.'))
          const oka = Number.isFinite(na), okb = Number.isFinite(nb)
          if (oka && okb) cmp = na - nb
          else if (oka) cmp = -1
          else if (okb) cmp = 1
          else cmp = String(a).localeCompare(String(b), 'pt', { sensitivity: 'base' })
        } else {
          cmp = String(a).localeCompare(String(b), 'pt', { sensitivity: 'base' })
        }
        return ordem.asc ? cmp : -cmp
      })
    }
    return r
  }, [linhas, busca, ordem])

  return (
    <Seccao
      cor={CORES.chegadas} titulo="Chegadas"
      acoes={
        <div className="flex flex-wrap items-center gap-2">
          {(['hoje', 'amanha'] as const).map(a => (
            <button key={a} onClick={() => setAba(a)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium ${
                aba === a ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}>
              {a === 'hoje' ? `Hoje (${hoje.length})` : `Amanhã (${amanha.length})`}
            </button>
          ))}
          <label className={`btn-ghost cursor-pointer py-1 text-xs ${!ctx.podeEditar ? 'pointer-events-none opacity-50' : ''}`}>
            {aImportar ? 'A carregar…' : 'Carregar Excel'}
            <input type="file" accept=".xlsx,.xls" className="hidden"
                   onChange={e => { const f = e.target.files?.[0]; if (f) importar(f); e.target.value = '' }} />
          </label>
          {linhas.length > 0 && ctx.podeEditar && (
            <button
              className="btn-ghost py-1 text-xs text-red-600"
              onClick={() => {
                if (confirm(`Tem a certeza que quer apagar as ${linhas.length} chegadas deste dia? Esta ação não pode ser anulada.`)) {
                  agir(async () => {
                    await supabase.from('arrivals').delete()
                      .eq('hotel_id', ctx.hotelId).eq('arrival_date', diaAba)
                  })
                }
              }}
            >Limpar chegadas</button>
          )}
        </div>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input className="input max-w-xs" placeholder="Pesquisar…" value={busca}
               onChange={e => setBusca(e.target.value)} />
        <span className="text-xs text-slate-500">
          {visiveis.length} / {linhas.length} chegadas · {dmy(diaAba)}
        </span>
      </div>

      {linhas.length === 0 ? (
        <Vazio>Sem chegadas — carregue um ficheiro Excel.</Vazio>
      ) : (
        <div className="-mx-4 max-h-[500px] overflow-auto px-4">
          <table className="w-full" style={{ minWidth: 1200 }}>
            <thead className="sticky top-0 z-10 bg-white">
              <tr className="border-b border-slate-200">
                {colunas.map(c => (
                  <th key={String(c.campo)}
                      className={`whitespace-nowrap px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 ${
                        c.ordenavel === false ? '' : 'cursor-pointer hover:text-slate-800'}`}
                      onClick={() => {
                        if (c.ordenavel === false) return
                        setOrdem(o => o?.campo === c.campo ? { campo: c.campo, asc: !o.asc } : { campo: c.campo, asc: true })
                      }}>
                    {c.titulo}
                    {ordem?.campo === c.campo && (ordem.asc ? ' ↑' : ' ↓')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {visiveis.map(a => (
                <tr key={a.id} className="hover:bg-slate-50">
                  {colunas.map(c => {
                    const v = a[c.campo]
                    const dinheiro = c.campo === 'adr' || c.campo === 'total_amount'
                    return (
                      <td key={String(c.campo)} className="px-2 py-1.5 text-sm text-slate-700">
                        {v === null || v === undefined || v === ''
                          ? <span className="text-slate-300">—</span>
                          : dinheiro ? money(Number(v)) : String(v)}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!resumo} onClose={() => setResumo(null)} title="Importação concluída">
        <p className="text-sm text-slate-700">{resumo}</p>
        <div className="mt-4 flex justify-end">
          <button className="btn-primary" onClick={() => setResumo(null)}>Fechar</button>
        </div>
      </Modal>
    </Seccao>
  )
}
