import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import { useApp } from '../lib/appState'
import { Loading, Modal, useToast } from '../components/ui'
import { useLembrado } from '../lib/lembrar'
import {
  type Lugar, type Reserva,
  HOTEIS_PARQUE, corDoHotel,
  fetchLugares, fetchReservas, procurarReservas, guardarReserva, apagarReserva,
  mensagemDeErro, somaDias, diffDias, hojeIso, diaSemana, diaMes, dataCurta, dataLonga,
  ocupaNoite,
} from '../lib/parque'

const DIAS = 14
const ALT_LINHA = 44
const ALT_SECCAO = 26
const LARG_ROTULO = 72

type Rascunho = {
  id?: string
  hotel_id: string
  space_id: string
  reservation_number: string
  guest_name: string
  room: string
  plate: string
  start_date: string
  end_date: string
  notes: string
}

type Linha =
  | { tipo: 'seccao'; titulo: string }
  | { tipo: 'lugar'; lugar: Lugar }

export default function Parque() {
  const toast = useToast()
  const { email, canWrite } = useAuth()
  const { hotels } = useApp()
  const podeEscrever = canWrite('FO')

  const [inicio, setInicio] = useState(() => somaDias(hojeIso(), -1))
  const [lugares, setLugares] = useState<Lugar[]>([])
  const [reservas, setReservas] = useState<Reserva[]>([])
  const [loading, setLoading] = useState(true)
  const [filtro, setFiltro] = useLembrado('parque.filtro', 'todos')

  const [ativa, setAtiva] = useState<Reserva | null>(null)
  const [rascunho, setRascunho] = useState<Rascunho | null>(null)
  const [aGuardar, setAGuardar] = useState(false)

  const [busca, setBusca] = useState('')
  const [resultados, setResultados] = useState<Reserva[]>([])

  const corpoRef = useRef<HTMLDivElement>(null)

  /* ------------------------------- hotéis ------------------------------- */
  const hoteisParque = useMemo(
    () => hotels.filter(h => (HOTEIS_PARQUE as readonly string[]).includes(h.slug)),
    [hotels],
  )
  const hotelPorId = useMemo(() => {
    const m: Record<string, { slug: string; name: string }> = {}
    for (const h of hotels) m[h.id] = { slug: h.slug, name: h.name }
    return m
  }, [hotels])

  /* -------------------------------- dados ------------------------------- */
  const fim = somaDias(inicio, DIAS)
  const dias = useMemo(
    () => Array.from({ length: DIAS }, (_, i) => somaDias(inicio, i)),
    [inicio],
  )

  const carregarReservas = async () => {
    try {
      setReservas(await fetchReservas(inicio, fim))
    } catch (e) { toast(mensagemDeErro(e), 'erro') }
  }

  useEffect(() => {
    fetchLugares()
      .then(setLugares)
      .catch(e => toast(mensagemDeErro(e), 'erro'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { carregarReservas() }, [inicio])

  useEffect(() => {
    if (busca.trim().length < 2) { setResultados([]); return }
    const t = setTimeout(() => {
      procurarReservas(busca).then(setResultados).catch(() => setResultados([]))
    }, 250)
    return () => clearTimeout(t)
  }, [busca])

  /* ------------------------------- layout ------------------------------- */
  const linhas: Linha[] = useMemo(() => {
    const out: Linha[] = []
    const carros = lugares.filter(l => l.tipo === 'carro' && l.ativo)
    const motas = lugares.filter(l => l.tipo === 'mota' && l.ativo)
    if (carros.length) {
      out.push({ tipo: 'seccao', titulo: `Carros · ${carros.length} lugares` })
      carros.forEach(lugar => out.push({ tipo: 'lugar', lugar }))
    }
    if (motas.length) {
      out.push({ tipo: 'seccao', titulo: `Motas · ${motas.length} lugares` })
      motas.forEach(lugar => out.push({ tipo: 'lugar', lugar }))
    }
    return out
  }, [lugares])

  const topos = useMemo(() => {
    const t: number[] = []
    let y = 0
    for (const l of linhas) { t.push(y); y += l.tipo === 'seccao' ? ALT_SECCAO : ALT_LINHA }
    return { tops: t, altura: y }
  }, [linhas])

  const topoDoLugar = (id: string) => {
    const i = linhas.findIndex(l => l.tipo === 'lugar' && l.lugar.id === id)
    return i < 0 ? 0 : topos.tops[i]
  }

  const totalCarros = lugares.filter(l => l.tipo === 'carro' && l.ativo).length

  const ocupacaoPorDia = useMemo(() => {
    const m: Record<string, number> = {}
    for (const d of dias) {
      m[d] = new Set(
        reservas.filter(r => r.space_id.startsWith('C') && ocupaNoite(r, d)).map(r => r.space_id),
      ).size
    }
    return m
  }, [reservas, dias])

  const visiveis = useMemo(
    () => reservas.filter(r => filtro === 'todos' || hotelPorId[r.hotel_id]?.slug === filtro),
    [reservas, filtro, hotelPorId],
  )

  /* ------------------------------- ações -------------------------------- */
  const novaReserva = (spaceId: string, dia: string) => {
    if (!podeEscrever) return
    setRascunho({
      hotel_id: hoteisParque[0]?.id ?? '',
      space_id: spaceId,
      reservation_number: '',
      guest_name: '',
      room: '',
      plate: '',
      start_date: dia,
      end_date: somaDias(dia, 1),
      notes: '',
    })
  }

  const editar = (r: Reserva) => {
    setAtiva(null)
    setRascunho({
      id: r.id,
      hotel_id: r.hotel_id,
      space_id: r.space_id,
      reservation_number: r.reservation_number ?? '',
      guest_name: r.guest_name,
      room: r.room ?? '',
      plate: r.plate ?? '',
      start_date: r.start_date,
      end_date: r.end_date,
      notes: r.notes ?? '',
    })
  }

  const gravar = async () => {
    if (!rascunho) return
    if (!rascunho.guest_name.trim()) { toast('Falta o nome do hóspede', 'erro'); return }
    if (rascunho.end_date <= rascunho.start_date) {
      toast('A saída tem de ser depois da entrada', 'erro'); return
    }
    setAGuardar(true)
    try {
      await guardarReserva({
        id: rascunho.id,
        hotel_id: rascunho.hotel_id,
        space_id: rascunho.space_id,
        reservation_number: rascunho.reservation_number.trim() || null,
        guest_name: rascunho.guest_name.trim(),
        room: rascunho.room.trim() || null,
        plate: rascunho.plate.trim().toUpperCase() || null,
        start_date: rascunho.start_date,
        end_date: rascunho.end_date,
        notes: rascunho.notes.trim() || null,
      }, email)
      setRascunho(null)
      toast(rascunho.id ? 'Reserva atualizada' : 'Reserva criada')
      carregarReservas()
    } catch (e) { toast(mensagemDeErro(e), 'erro') } finally { setAGuardar(false) }
  }

  const apagar = async (r: Reserva) => {
    if (!confirm(`Apagar a reserva de ${r.guest_name || 'sem nome'} no lugar ${r.space_id}?`)) return
    try {
      await apagarReserva(r.id)
      setAtiva(null)
      toast('Reserva apagada')
      carregarReservas()
    } catch (e) { toast(mensagemDeErro(e), 'erro') }
  }

  const saltarPara = (r: Reserva) => {
    setInicio(somaDias(r.start_date, -1))
    setBusca(''); setResultados([])
    setAtiva(r)
  }

  /* ------------------------- arrastar para mover ------------------------ */
  const [arrasto, setArrasto] = useState<{
    id: string; ponteiro: number; x0: number
    lugarOriginal: string; lugarAtual: string
    dias: number; mexeu: boolean
  } | null>(null)
  const [porConfirmar, setPorConfirmar] = useState<{ r: Reserva; space_id: string; dias: number } | null>(null)

  const larguraDia = () => {
    const el = corpoRef.current
    if (!el) return 0
    return (el.clientWidth - LARG_ROTULO) / DIAS
  }

  const lugarEmY = (clientY: number) => {
    const el = corpoRef.current
    if (!el) return null
    const y = clientY - el.getBoundingClientRect().top
    let melhor: string | null = null
    let dist = Infinity
    linhas.forEach((l, i) => {
      if (l.tipo !== 'lugar') return
      const centro = topos.tops[i] + ALT_LINHA / 2
      const d = Math.abs(centro - y)
      if (d < dist) { dist = d; melhor = l.lugar.id }
    })
    return melhor
  }

  const aoDescer = (e: React.PointerEvent, r: Reserva) => {
    if (!podeEscrever || e.button !== 0) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    setArrasto({
      id: r.id, ponteiro: e.pointerId, x0: e.clientX,
      lugarOriginal: r.space_id, lugarAtual: r.space_id,
      dias: 0, mexeu: false,
    })
  }

  const aoMover = (e: React.PointerEvent) => {
    if (!arrasto || e.pointerId !== arrasto.ponteiro) return
    const lw = larguraDia()
    const dx = e.clientX - arrasto.x0
    const nDias = lw > 0 ? Math.round(dx / lw) : 0
    const lugar = lugarEmY(e.clientY) ?? arrasto.lugarOriginal
    const mexeu = arrasto.mexeu || Math.abs(dx) > 4 || lugar !== arrasto.lugarOriginal
    if (nDias !== arrasto.dias || lugar !== arrasto.lugarAtual || mexeu !== arrasto.mexeu) {
      setArrasto({ ...arrasto, dias: nDias, lugarAtual: lugar, mexeu })
    }
  }

  const aoSubir = (e: React.PointerEvent, r: Reserva) => {
    if (!arrasto || e.pointerId !== arrasto.ponteiro) return
    const { mexeu, dias: nDias, lugarAtual } = arrasto
    setArrasto(null)
    if (!mexeu || (nDias === 0 && lugarAtual === r.space_id)) { setAtiva(r); return }
    setPorConfirmar({ r, space_id: lugarAtual, dias: nDias })
  }

  const confirmarMovimento = async () => {
    if (!porConfirmar) return
    const { r, space_id, dias: n } = porConfirmar
    try {
      await guardarReserva({
        id: r.id,
        hotel_id: r.hotel_id,
        space_id,
        reservation_number: r.reservation_number,
        guest_name: r.guest_name,
        room: r.room,
        plate: r.plate,
        start_date: somaDias(r.start_date, n),
        end_date: somaDias(r.end_date, n),
        notes: r.notes,
      }, email)
      toast('Reserva movida')
      setPorConfirmar(null)
      carregarReservas()
    } catch (e) { toast(mensagemDeErro(e), 'erro'); setPorConfirmar(null) }
  }

  if (loading) return <Loading />

  const hoje = hojeIso()

  return (
    <div className="space-y-4" onPointerMove={aoMover}>
      {/* cabeçalho */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Parque</h1>
          <p className="text-sm text-slate-500">
            {dataCurta(inicio)} – {dataCurta(somaDias(inicio, DIAS - 1))} · sem horas:
            quem sai de manhã liberta o lugar para quem chega à tarde.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost" onClick={() => setInicio(somaDias(inicio, -7))}>‹ semana</button>
          <button className="btn-ghost" onClick={() => setInicio(somaDias(hoje, -1))}>Hoje</button>
          <button className="btn-ghost" onClick={() => setInicio(somaDias(inicio, 7))}>semana ›</button>
          <select className="input w-auto" value={filtro} onChange={e => setFiltro(e.target.value)}>
            <option value="todos">Todos os hotéis</option>
            {hoteisParque.map(h => <option key={h.id} value={h.slug}>{h.name}</option>)}
          </select>
        </div>
      </div>

      {/* procura */}
      <div className="relative max-w-xl">
        <input
          className="input"
          placeholder="Procurar por nome, quarto, nº de reserva ou matrícula…"
          value={busca}
          onChange={e => setBusca(e.target.value)}
        />
        {resultados.length > 0 && (
          <div className="absolute z-30 mt-1 w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
            {resultados.map(r => (
              <button key={r.id} onClick={() => saltarPara(r)}
                      className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-slate-50">
                <span className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ background: corDoHotel(hotelPorId[r.hotel_id]?.slug) }} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {r.guest_name || 'sem nome'} <span className="font-normal text-slate-400">· {r.space_id}</span>
                  </span>
                  <span className="block truncate text-xs text-slate-500">
                    {[r.reservation_number && `#${r.reservation_number}`, r.room && `quarto ${r.room}`, r.plate]
                      .filter(Boolean).join(' · ')} · {dataCurta(r.start_date)} → {dataCurta(r.end_date)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
        {busca.trim().length >= 2 && resultados.length === 0 && (
          <div className="absolute z-30 mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500 shadow-lg">
            Sem resultados
          </div>
        )}
      </div>

      {/* legenda */}
      <div className="flex flex-wrap items-center gap-4 text-sm">
        {hoteisParque.map(h => (
          <span key={h.id} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm" style={{ background: corDoHotel(h.slug) }} />
            {h.name}
          </span>
        ))}
      </div>

      {/* grelha */}
      <div className="card overflow-x-auto">
        <div className="min-w-[880px]">
          {/* dias */}
          <div className="grid border-b border-slate-200 bg-slate-50"
               style={{ gridTemplateColumns: `${LARG_ROTULO}px repeat(${DIAS}, minmax(0,1fr))` }}>
            <div className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-500">
              Lugar
            </div>
            {dias.map(d => {
              const n = ocupacaoPorDia[d] ?? 0
              const cheio = n >= totalCarros
              return (
                <div key={d} className={`border-l border-slate-200 px-1 py-1 text-center ${
                  d === hoje ? 'bg-brand-50' : ''}`}>
                  <div className="text-[10px] uppercase tracking-wide text-slate-400">{diaSemana(d)}</div>
                  <div className={`text-sm ${d === hoje ? 'font-semibold text-brand-700' : ''}`}>{diaMes(d)}</div>
                  <div className={`text-[10px] tabular-nums ${
                    cheio ? 'font-semibold text-red-600'
                          : n >= totalCarros - 2 ? 'font-medium text-amber-600' : 'text-slate-400'}`}>
                    {n}/{totalCarros}
                  </div>
                </div>
              )
            })}
          </div>

          {/* linhas */}
          <div ref={corpoRef} className="relative" style={{ height: topos.altura }}>
            {linhas.map((l, i) => {
              const top = topos.tops[i]
              if (l.tipo === 'seccao') {
                return (
                  <div key={`s${i}`}
                       className="absolute inset-x-0 flex items-center border-b border-slate-200 bg-slate-100/70 px-3 text-[11px] font-medium uppercase tracking-wide text-slate-500"
                       style={{ top, height: ALT_SECCAO }}>
                    {l.titulo}
                  </div>
                )
              }
              return (
                <div key={l.lugar.id}
                     className="absolute inset-x-0 grid border-b border-slate-100"
                     style={{
                       top, height: ALT_LINHA,
                       gridTemplateColumns: `${LARG_ROTULO}px repeat(${DIAS}, minmax(0,1fr))`,
                     }}>
                  <div className="flex items-center border-r border-slate-200 px-2 text-sm font-medium">
                    {l.lugar.id}
                  </div>
                  {dias.map(d => (
                    <button key={d}
                            onClick={() => novaReserva(l.lugar.id, d)}
                            disabled={!podeEscrever}
                            className={`border-l border-slate-100 transition-colors ${
                              podeEscrever ? 'hover:bg-brand-50/60' : 'cursor-default'} ${
                              d === hoje ? 'bg-brand-50/40' : ''}`}
                            title={podeEscrever ? `Reservar ${l.lugar.id} · ${dataLonga(d)}` : undefined} />
                  ))}
                </div>
              )
            })}

            {/* reservas */}
            <div className="pointer-events-none absolute inset-y-0"
                 style={{ left: LARG_ROTULO, right: 0 }}>
              {visiveis.map(r => {
                const aArrastar = arrasto?.id === r.id
                const desloc = aArrastar ? arrasto!.dias : 0
                const i0 = Math.max(0, diffDias(inicio, r.start_date) + desloc)
                const i1 = Math.min(DIAS, diffDias(inicio, r.end_date) + desloc)
                if (i1 <= 0 || i0 >= DIAS) return null
                const topo = topoDoLugar(aArrastar ? arrasto!.lugarAtual : r.space_id)
                const slug = hotelPorId[r.hotel_id]?.slug
                return (
                  <button key={r.id}
                          onPointerDown={e => aoDescer(e, r)}
                          onPointerUp={e => aoSubir(e, r)}
                          className={`pointer-events-auto absolute truncate rounded-md px-2 text-left text-[11px] font-medium text-white shadow-sm ring-1 ring-black/10 ${
                            podeEscrever ? 'cursor-grab active:cursor-grabbing' : ''} ${
                            aArrastar ? 'z-20 opacity-90 ring-2 ring-amber-400' : ''}`}
                          style={{
                            top: topo + 5, height: ALT_LINHA - 10,
                            left: `${(i0 / DIAS) * 100}%`,
                            width: `calc(${((i1 - i0) / DIAS) * 100}% - 3px)`,
                            background: corDoHotel(slug),
                            touchAction: 'none',
                            transition: aArrastar ? 'none' : 'top 120ms, left 120ms',
                          }}
                          title={`${r.guest_name} · ${hotelPorId[r.hotel_id]?.name ?? ''} · ${dataCurta(r.start_date)} → ${dataCurta(r.end_date)}`}>
                    <span className="flex items-center gap-1.5 truncate">
                      {r.reservation_number && <span className="font-semibold">#{r.reservation_number}</span>}
                      {r.room && <span className="opacity-90">· {r.room}</span>}
                      {r.plate && <span className="truncate opacity-75">· {r.plate}</span>}
                      {!r.reservation_number && !r.room && !r.plate && (
                        <span className="truncate">{r.guest_name || 'sem nome'}</span>
                      )}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        {podeEscrever
          ? 'Clica num dia vazio para reservar. Clica numa reserva para ver os detalhes, ou arrasta-a para outro lugar ou outras datas.'
          : 'Só a receção e os administradores podem alterar reservas.'}
      </p>

      {/* detalhe */}
      <Modal open={!!ativa} onClose={() => setAtiva(null)} title="Reserva">
        {ativa && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded-sm"
                    style={{ background: corDoHotel(hotelPorId[ativa.hotel_id]?.slug) }} />
              <span className="font-medium">{ativa.guest_name || 'sem nome'}</span>
              <span className="text-sm text-slate-500">
                {hotelPorId[ativa.hotel_id]?.name} · lugar {ativa.space_id}
              </span>
            </div>
            <dl className="divide-y divide-slate-100 text-sm">
              <Campo rotulo="Entrada" valor={dataLonga(ativa.start_date)} />
              <Campo rotulo="Saída" valor={dataLonga(ativa.end_date)} />
              <Campo rotulo="Noites" valor={String(diffDias(ativa.start_date, ativa.end_date))} />
              {ativa.reservation_number && <Campo rotulo="Nº de reserva" valor={ativa.reservation_number} />}
              {ativa.room && <Campo rotulo="Quarto" valor={ativa.room} />}
              {ativa.plate && <Campo rotulo="Matrícula" valor={ativa.plate} />}
            </dl>
            {ativa.notes && (
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{ativa.notes}</p>
            )}
            {podeEscrever && (
              <div className="flex justify-end gap-2 pt-1">
                <button className="btn-danger" onClick={() => apagar(ativa)}>Apagar</button>
                <button className="btn-primary" onClick={() => editar(ativa)}>Editar</button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* criar / editar */}
      <Modal open={!!rascunho} onClose={() => setRascunho(null)}
             title={rascunho?.id ? 'Editar reserva' : 'Nova reserva'}>
        {rascunho && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Hotel</label>
                <select className="input" value={rascunho.hotel_id}
                        onChange={e => setRascunho({ ...rascunho, hotel_id: e.target.value })}>
                  {hoteisParque.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Lugar</label>
                <select className="input" value={rascunho.space_id}
                        onChange={e => setRascunho({ ...rascunho, space_id: e.target.value })}>
                  {lugares.filter(l => l.ativo).map(l => (
                    <option key={l.id} value={l.id}>
                      {l.id} · {l.tipo === 'carro' ? 'carro' : 'mota'}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Entrada</label>
                <input className="input" type="date" value={rascunho.start_date}
                       onChange={e => {
                         const d = e.target.value
                         setRascunho({
                           ...rascunho, start_date: d,
                           end_date: rascunho.end_date <= d ? somaDias(d, 1) : rascunho.end_date,
                         })
                       }} />
              </div>
              <div>
                <label className="label">Saída</label>
                <input className="input" type="date" value={rascunho.end_date}
                       min={somaDias(rascunho.start_date, 1)}
                       onChange={e => setRascunho({ ...rascunho, end_date: e.target.value })} />
              </div>
            </div>
            <p className="text-xs text-slate-500">
              {Math.max(0, diffDias(rascunho.start_date, rascunho.end_date))} noite(s). O lugar
              volta a ficar livre no dia da saída.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Nome do hóspede *</label>
                <input className="input" value={rascunho.guest_name}
                       onChange={e => setRascunho({ ...rascunho, guest_name: e.target.value })} />
              </div>
              <div>
                <label className="label">Quarto</label>
                <input className="input" value={rascunho.room}
                       onChange={e => setRascunho({ ...rascunho, room: e.target.value })} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Nº de reserva</label>
                <input className="input" value={rascunho.reservation_number}
                       onChange={e => setRascunho({ ...rascunho, reservation_number: e.target.value })} />
              </div>
              <div>
                <label className="label">Matrícula</label>
                <input className="input uppercase" value={rascunho.plate}
                       onChange={e => setRascunho({ ...rascunho, plate: e.target.value })} />
              </div>
            </div>

            <div>
              <label className="label">Notas</label>
              <input className="input" value={rascunho.notes}
                     onChange={e => setRascunho({ ...rascunho, notes: e.target.value })} />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button className="btn-ghost" onClick={() => setRascunho(null)}>Cancelar</button>
              <button className="btn-primary" onClick={gravar} disabled={aGuardar}>
                {aGuardar ? 'A guardar…' : rascunho.id ? 'Guardar' : 'Reservar'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* confirmar movimento */}
      <Modal open={!!porConfirmar} onClose={() => setPorConfirmar(null)} title="Mover reserva?">
        {porConfirmar && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {porConfirmar.r.guest_name || 'A reserva'} passa para o lugar{' '}
              <strong>{porConfirmar.space_id}</strong>,{' '}
              {dataCurta(somaDias(porConfirmar.r.start_date, porConfirmar.dias))} →{' '}
              {dataCurta(somaDias(porConfirmar.r.end_date, porConfirmar.dias))}.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setPorConfirmar(null)}>Cancelar</button>
              <button className="btn-primary" onClick={confirmarMovimento}>Mover</button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex justify-between py-1.5">
      <dt className="text-slate-500">{rotulo}</dt>
      <dd className="font-medium">{valor}</dd>
    </div>
  )
}
