import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../lib/appState'
import { useAuth } from '../lib/auth'
import { supabase } from '../lib/supabase'
import { addDays, dmy, downloadCSV, hojeLocal, money } from '../lib/format'
import { Badge } from '../components/turno-parts'
import { rotuloServico } from '../lib/turno'
import { Loading, useToast } from '../components/ui'

/* ------------------------------- Secções --------------------------------- */

interface Fecho {
  campo: string
  campoData: string
  /** valor que marca fechado; para booleanos é true */
  fechado: boolean | string
  aberto: boolean | string
  verbo: string        // "Marcar resolvido" / "Marcar concluído"
  particípio: string   // "Resolvido" / "Concluído"
}

interface Seccao {
  id: string
  label: string
  tabela: string
  campoData: string
  colunas: string
  resumo: (r: Record<string, unknown>) => string
  fecho?: Fecho
}

const t = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v))

const RESOLVIDO: Omit<Fecho, 'campo' | 'campoData'> = {
  fechado: true, aberto: false, verbo: 'Marcar resolvido', particípio: 'Resolvido',
}

export const SECCOES: Seccao[] = [
  {
    id: 'pending_issues', label: 'Assuntos Pendentes', tabela: 'pending_issues',
    campoData: 'data', colunas: '*',
    resumo: r => `[${t(r.depto)}] ${t(r.local)} · ${t(r.assunto)}`,
    fecho: { ...RESOLVIDO, campo: 'resolvido', campoData: 'resolved_date' },
  },
  {
    id: 'maintenance', label: 'Manutenção', tabela: 'maintenance',
    campoData: 'data', colunas: '*',
    resumo: r => `[${r.status === 'resolvido' ? 'resolvido' : 'por resolver'}] ${t(r.local)} — ${t(r.intervencao)}`,
    fecho: {
      campo: 'status', campoData: 'resolved_date', fechado: 'resolvido', aberto: 'por_resolver',
      verbo: 'Marcar resolvido', particípio: 'Resolvido',
    },
  },
  {
    id: 'hsk_reports', label: 'Relatório HSK', tabela: 'hsk_reports',
    campoData: 'data', colunas: '*',
    resumo: r => `[${t(r.tipo)}] ${t(r.texto)}`,
    fecho: { ...RESOLVIDO, campo: 'resolvido', campoData: 'resolved_date' },
  },
  {
    id: 'lost_items', label: 'Objetos Perdidos', tabela: 'lost_items',
    campoData: 'data', colunas: '*',
    resumo: r => `${t(r.local)} · ${t(r.descricao)}`,
    fecho: { ...RESOLVIDO, campo: 'resolvido', campoData: 'resolved_date' },
  },
  {
    id: 'borrowed_items', label: 'Objetos Emprestados', tabela: 'borrowed_items',
    campoData: 'data', colunas: '*',
    resumo: r => `Quarto ${t(r.quarto)} · ${t(r.objeto)} (CO ${r.data_co ? dmy(String(r.data_co)) : '—'})`,
    fecho: { ...RESOLVIDO, campo: 'resolvido', campoData: 'resolved_date' },
  },
  {
    id: 'transfers', label: 'Transfers / Tours', tabela: 'transfers',
    campoData: 'report_date', colunas: '*',
    resumo: r => {
      const h = r.pickup_at ? new Date(String(r.pickup_at)).toLocaleString('pt-PT',
        { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
      return `Quarto ${t(r.quarto)} · ${h} · ${t(r.empresa)} · ${t(r.pax)} pax · ${t(r.tipo_carro)} · ${t(r.destino)}`
    },
    fecho: {
      campo: 'concluido', campoData: 'concluded_date', fechado: true, aberto: false,
      verbo: 'Marcar concluído', particípio: 'Concluído',
    },
  },
  {
    id: 'vips', label: 'VIPs', tabela: 'vips', campoData: 'report_date', colunas: '*',
    resumo: r => `${t(r.nome)} · Quarto ${t(r.quarto)} · ${t(r.motivo)}`,
  },
  {
    id: 'breakfast_boxes', label: 'Breakfast Box', tabela: 'breakfast_boxes',
    campoData: 'report_date', colunas: '*',
    resumo: r => `Quarto ${t(r.quarto)} · ${t(r.nome)} · ${t(r.num_bb)} BB · ` +
      `${r.para_dia ? dmy(String(r.para_dia)) : '—'} ${String(r.para_horas ?? '').slice(0, 5)} · ` +
      `${r.pedida ? 'Pedida' : 'Por pedir'}${r.notas ? ` · ${r.notas}` : ''}`,
  },
  {
    id: 'complaints', label: 'Reclamações', tabela: 'complaints',
    campoData: 'created_date', colunas: '*',
    resumo: r => `Quarto ${t(r.quarto)} [${t(r.status)}] — ${t(r.comentario)}`,
  },
  {
    id: 'fb_numbers', label: 'F&B', tabela: 'fb_numbers',
    campoData: 'report_date', colunas: '*',
    resumo: r => `${rotuloServico(String(r.coluna))}: ${t(r.total_pax)} pax / ${money(Number(r.total_eur ?? 0))}`,
  },
]

const INTERVALOS = [7, 15, 30, 60, 90, 180]

/* ------------------------------- Página ---------------------------------- */

export default function TurnoHistorico() {
  const { hotelId, hotels } = useApp()
  const { roles } = useAuth()
  const toast = useToast()
  const podeEditar = roles.length > 0

  const [seccaoId, setSeccaoId] = useState('pending_issues')
  const [dias, setDias] = useState(30)
  const [busca, setBusca] = useState('')
  const [linhas, setLinhas] = useState<Record<string, unknown>[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const seccao = SECCOES.find(s => s.id === seccaoId)!
  const desde = addDays(hojeLocal(), -dias)

  const carregar = async () => {
    if (!hotelId) return
    setLinhas(null); setErro(null)
    const { data, error } = await supabase
      .from(seccao.tabela).select(seccao.colunas)
      .eq('hotel_id', hotelId)
      .gte(seccao.campoData, desde)
      .order(seccao.campoData, { ascending: false })
      .limit(500)
    if (error) { setErro(error.message); setLinhas([]); return }
    setLinhas((data ?? []) as unknown as Record<string, unknown>[])
  }
  useEffect(() => { carregar() }, [hotelId, seccaoId, dias])

  const estaFechado = (r: Record<string, unknown>) =>
    !!seccao.fecho && r[seccao.fecho.campo] === seccao.fecho.fechado

  const alternar = async (r: Record<string, unknown>) => {
    const f = seccao.fecho
    if (!f || !podeEditar) return
    const fechar = !estaFechado(r)
    const { error } = await supabase.from(seccao.tabela).update({
      [f.campo]: fechar ? f.fechado : f.aberto,
      [f.campoData]: fechar ? hojeLocal() : null,
    }).eq('id', String(r.id))
    if (error) return toast(error.message, 'erro')
    toast(fechar ? `${f.particípio} hoje` : 'Reaberto')
    carregar()
  }

  const visiveis = useMemo(() => {
    if (!linhas) return []
    const q = busca.trim().toLowerCase()
    if (!q) return linhas
    return linhas.filter(r => seccao.resumo(r).toLowerCase().includes(q))
  }, [linhas, busca, seccao])

  const exportar = () => {
    const hotel = hotels.find(h => h.id === hotelId)?.slug ?? 'hotel'
    downloadCSV(`historico_${seccao.id}_${hotel}.csv`, [
      ['data', 'resumo', 'estado'],
      ...visiveis.map(r => [
        String(r[seccao.campoData] ?? ''),
        seccao.resumo(r),
        seccao.fecho ? (estaFechado(r) ? seccao.fecho.particípio : 'Em aberto') : '',
      ]),
    ])
  }

  const abertos = seccao.fecho ? visiveis.filter(r => !estaFechado(r)).length : null

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div className="min-w-[190px]">
          <label className="label">Secção</label>
          <select className="input" value={seccaoId} onChange={e => setSeccaoId(e.target.value)}>
            {SECCOES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Período</label>
          <select className="input w-auto" value={dias} onChange={e => setDias(Number(e.target.value))}>
            {INTERVALOS.map(d => <option key={d} value={d}>Últimos {d} dias</option>)}
          </select>
        </div>
        <div className="min-w-[180px] flex-1">
          <label className="label">Procurar</label>
          <input className="input" value={busca} onChange={e => setBusca(e.target.value)}
                 placeholder="quarto, texto, empresa…" />
        </div>
        <button className="btn-ghost" onClick={exportar} disabled={!visiveis.length}>Exportar CSV</button>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm text-slate-500">
        <span>{visiveis.length} registos desde {dmy(desde)}</span>
        {abertos !== null && abertos > 0 && <Badge tom="ambar">{abertos} em aberto</Badge>}
        {linhas && linhas.length === 500 && (
          <Badge tom="cinza">mostro no máximo 500 — encurta o período para ver tudo</Badge>
        )}
      </div>

      {erro && <div className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{erro}</div>}

      {linhas === null ? <Loading /> : visiveis.length === 0 ? (
        <div className="card p-8 text-center text-sm text-slate-500">
          Sem registos nesta secção e período.
        </div>
      ) : (
        <div className="card divide-y divide-slate-100">
          {visiveis.map(r => {
            const fechado = estaFechado(r)
            const data = String(r[seccao.campoData] ?? '')
            const fechadoEm = seccao.fecho ? r[seccao.fecho.campoData] : null
            return (
              <div key={String(r.id)} className="flex flex-wrap items-start gap-3 px-4 py-3">
                <Link
                  to={`/turno/${data}`}
                  title="Abrir este dia"
                  className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-xs font-medium tabular-nums text-slate-600 hover:bg-brand-50 hover:text-brand-700"
                >
                  {dmy(data)}
                </Link>
                <p className={`min-w-[220px] flex-1 text-sm ${
                  fechado ? 'text-slate-400 line-through' : 'text-slate-700'}`}>
                  {seccao.resumo(r)}
                </p>
                {seccao.fecho && (
                  <div className="flex shrink-0 items-center gap-2">
                    {fechado && (
                      <Badge tom="verde">
                        {seccao.fecho.particípio}{fechadoEm ? ` · ${dmy(String(fechadoEm))}` : ''}
                      </Badge>
                    )}
                    {podeEditar && (
                      <button
                        className="text-sm text-brand-600 hover:underline"
                        onClick={() => alternar(r)}
                      >
                        {fechado ? 'Anular' : seccao.fecho.verbo}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <p className="text-xs text-slate-400">
        Clica na data para abrir o relatório desse dia. Ao fechar aqui um registo, fica com a
        data de hoje — no relatório diário fica com a data do dia que estiveres a ver.
      </p>
    </div>
  )
}
