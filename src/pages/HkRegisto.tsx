import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useApp } from '../lib/appState'
import { useAuth } from '../lib/auth'
import {
  apagarLimpeza, apagarTurno, balanco, corDoBalanco, custoDoTurno, fetchDias,
  fetchDoTurno, fetchLimpezas, fetchOutsourcing, fetchParametros, guardarDia, horas,
  juntarLimpeza, juntarTurno, minutosDoTurno, pessoasTexto,
  type Dia, type DoTurno, type Limpeza, type Parametros, type Turno,
} from '../lib/housekeeping'
import { addDays, dataExtenso, diaSemanaCurto, dmy, money, qty, todayISO } from '../lib/format'
import { Loading, NumInput, Spinner, StatCard, useToast } from '../components/ui'

export default function HkRegisto() {
  const { hotelId } = useApp()
  const { email, canWrite } = useAuth()
  const toast = useToast()
  const podeEscrever = canWrite('HSK')

  // O Mês inteiro liga para aqui com ?dia=…, para se abrir o dia que se estava a ver.
  const [params, setParams] = useSearchParams()
  const [dia, setDiaCru] = useState(params.get('dia') || todayISO())
  const setDia = (f: string | ((d: string) => string)) => setDiaCru(d => {
    const novo = typeof f === 'function' ? f(d) : f
    setParams(novo === todayISO() ? {} : { dia: novo }, { replace: true })
    return novo
  })
  const [param, setParam] = useState<Parametros | null>(null)
  const [registo, setRegisto] = useState<Dia | null>(null)
  const [limpezas, setLimpezas] = useState<Limpeza[]>([])
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [doTurno, setDoTurno] = useState<DoTurno | null>(null)
  const [ultimos, setUltimos] = useState<{ d: Dia; b: ReturnType<typeof balanco> }[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [gravar, setGravar] = useState(false)

  const carregar = async () => {
    if (!hotelId) return
    setLoading(true)
    try {
      const de14 = addDays(dia, -13)
      const [p, ds, ls, ts, occ, ds14, ls14, ts14] = await Promise.all([
        fetchParametros(hotelId),
        fetchDias(hotelId, dia, dia),
        fetchLimpezas(hotelId, dia, dia),
        fetchOutsourcing(hotelId, dia, dia),
        fetchDoTurno(hotelId, dia, dia),
        fetchDias(hotelId, de14, dia),
        fetchLimpezas(hotelId, de14, dia),
        fetchOutsourcing(hotelId, de14, dia),
      ])
      setParam(p)
      setLimpezas(ls)
      setTurnos(ts)
      setDoTurno(occ[dia] ?? null)

      // Sem linha ainda, arranca-se com o que o turno diz e zero pessoas.
      setRegisto(ds[0] ?? {
        id: '', dia, nota: null,
        quartos_ocupados: occ[dia]?.quartos ?? 0,
        saidas: occ[dia]?.saidas ?? 0,
        staff: 0,
        min_por_quarto: p.min_por_quarto,
        min_por_saida: p.min_por_saida,
        horas_por_turno: p.horas_por_turno,
      })

      const porDia = <T extends { dia: string }>(xs: T[]) => {
        const m: Record<string, T[]> = {}
        for (const x of xs) (m[x.dia] ??= []).push(x)
        return m
      }
      const lm = porDia(ls14), tm = porDia(ts14)
      setUltimos(ds14.map(d => ({
        d,
        b: balanco(d,
          (lm[d.dia] ?? []).reduce((s, x) => s + x.minutos, 0),
          (tm[d.dia] ?? []).reduce((s, x) => s + minutosDoTurno(x), 0)),
      })))
    } catch (e) {
      setErro((e as Error).message)
    } finally { setLoading(false) }
  }
  useEffect(() => { carregar() }, [hotelId, dia])

  const limpezasMin = limpezas.reduce((s, l) => s + l.minutos, 0)
  const outsourcingMin = turnos.reduce((s, t) => s + minutosDoTurno(t), 0)
  const b = useMemo(
    () => (registo ? balanco(registo, limpezasMin, outsourcingMin) : null),
    [registo, limpezasMin, outsourcingMin])

  const mudar = async (patch: Partial<Dia>) => {
    if (!registo || !param || !hotelId || !podeEscrever) return
    setRegisto({ ...registo, ...patch })
    setGravar(true)
    try {
      await guardarDia(hotelId, dia, { ...registo, ...patch, id: undefined } as Partial<Dia>,
                       param, email)
    } catch (e) { toast((e as Error).message, 'erro') }
    finally { setGravar(false) }
  }

  if (loading) return <Loading />
  if (erro) {
    return (
      <div className="card p-6 text-sm">
        <h2 className="mb-2 font-semibold text-red-600">Não foi possível abrir o registo</h2>
        <p className="text-slate-600">{erro}</p>
      </div>
    )
  }
  if (!registo || !param || !b) return null

  const faltaGente = b.pessoas > 0.15
  const sobraGente = b.pessoas < -0.15

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------------- dia */}
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="label">Dia</label>
          <input type="date" className="input w-auto" value={dia}
                 onChange={e => setDia(e.target.value)} />
        </div>
        <div className="flex gap-1">
          <button className="btn-ghost" onClick={() => setDia(d => addDays(d, -1))}>‹ anterior</button>
          <button className="btn-ghost" onClick={() => setDia(todayISO())}>hoje</button>
          <button className="btn-ghost" disabled={dia >= todayISO()}
                  onClick={() => setDia(d => addDays(d, 1))}>seguinte ›</button>
        </div>
        <div className="flex-1 text-sm capitalize text-slate-500">{dataExtenso(dia)}</div>
        {gravar && <span className="flex items-center gap-1 text-sm text-slate-500"><Spinner /> a guardar</span>}
        {!podeEscrever && (
          <span className="chip bg-amber-100 text-amber-800">só consulta</span>
        )}
      </div>

      {/* --------------------------------------------------------- balanço */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Trabalho a fazer" value={horas(b.necessarios)}
                  hint={`${qty(registo.quartos_ocupados)} quartos × ${registo.min_por_quarto}min + ${qty(registo.saidas)} saídas × ${registo.min_por_saida}min`} />
        <StatCard label="Tempo disponível" value={horas(b.disponiveis)}
                  hint={`${qty(registo.staff)} turnos × ${registo.horas_por_turno}h${
                    b.outsourcingMin ? ` + ${horas(b.outsourcingMin)} outsourcing` : ''}${
                    b.limpezasMin ? ` − ${horas(b.limpezasMin)} limpezas` : ''}`} />
        <StatCard label="Diferença" value={horas(b.diferenca)}
                  tone={faltaGente ? 'warn' : 'default'}
                  hint={faltaGente ? 'falta tempo' : sobraGente ? 'sobra tempo' : 'equilibrado'} />
        <div className="card p-4" style={{ backgroundColor: corDoBalanco(b.pessoas) }}>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-600">Pessoas ±</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
            {pessoasTexto(b.pessoas)}
          </div>
          <div className="mt-0.5 text-xs text-slate-700">
            {faltaGente ? 'a menos do que era preciso'
              : sobraGente ? 'a mais do que era preciso'
              : 'o dia fecha certo'}
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ------------------------------------------------------- o dia */}
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-slate-700">O dia</h3>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div>
              <label className="label">Quartos ocupados</label>
              <NumInput value={registo.quartos_ocupados} disabled={!podeEscrever}
                        onChange={n => mudar({ quartos_ocupados: n })} />
            </div>
            <div>
              <label className="label">Saídas</label>
              <NumInput value={registo.saidas} disabled={!podeEscrever}
                        onChange={n => mudar({ saidas: n })} />
            </div>
            <div>
              <label className="label">Turnos de pessoal</label>
              <NumInput value={registo.staff} disabled={!podeEscrever}
                        onChange={n => mudar({ staff: n })} />
              <p className="mt-0.5 text-[11px] text-slate-400">meios turnos valem 0,5</p>
            </div>
          </div>

          <DoRelatorio
            occ={doTurno} registo={registo} podeEscrever={podeEscrever}
            onUsar={() => doTurno && mudar({
              quartos_ocupados: doTurno.quartos, saidas: doTurno.saidas })}
          />

          <div className="mt-3">
            <label className="label">Nota do dia</label>
            <input className="input" value={registo.nota ?? ''} disabled={!podeEscrever}
                   onChange={e => mudar({ nota: e.target.value || null })} />
          </div>

          <p className="mt-3 text-xs text-slate-400">
            Os rácios deste dia — {registo.min_por_quarto}min por quarto e{' '}
            {registo.min_por_saida}min por saída — ficaram gravados quando a linha nasceu.
            Mudar os rácios em Definições não reescreve o que já passou.
          </p>
        </div>

        {/* ------------------------------------------------- limpezas gerais */}
        <div className="card p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-700">Limpezas gerais</h3>
            <span className="text-xs tabular-nums text-slate-500">{horas(limpezasMin)}</span>
          </div>
          <p className="text-xs text-slate-400">
            Trabalho que sai das mesmas horas mas não são quartos — vidros, arrumos, zonas comuns.
          </p>

          <div className="mt-2 space-y-1.5">
            {limpezas.map(l => (
              <div key={l.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{l.descricao}</span>
                <span className="shrink-0 text-sm tabular-nums text-slate-500">{horas(l.minutos)}</span>
                {podeEscrever && (
                  <button
                    className="shrink-0 rounded px-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    onClick={async () => { await apagarLimpeza(l.id); carregar() }}
                  >✕</button>
                )}
              </div>
            ))}
            {limpezas.length === 0 && (
              <p className="py-2 text-sm text-slate-400">Nenhuma neste dia.</p>
            )}
          </div>

          {podeEscrever && hotelId && (
            <NovaLimpeza
              onJuntar={async (descricao, minutos) => {
                await juntarLimpeza(hotelId, { dia, descricao, minutos })
                carregar()
              }}
            />
          )}
        </div>
      </div>

      {/* --------------------------------------------------- outsourcing */}
      <div className="card p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-700">Outsourcing neste dia</h3>
          <span className="text-xs tabular-nums text-slate-500">
            {horas(outsourcingMin)}
            {turnos.length > 0 && ` · ${money(turnos.reduce(
              (s, t) => s + custoDoTurno(t, param).comIva, 0))} c/IVA`}
          </span>
        </div>

        <div className="mt-2 space-y-1.5">
          {turnos.map(t => {
            const c = custoDoTurno(t, param)
            return (
              <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5">
                <span className="min-w-[120px] flex-1 text-sm font-medium text-slate-700">
                  {t.nome}
                  {t.feriado && <span className="ml-1.5 chip bg-amber-100 text-amber-800">feriado</span>}
                </span>
                <span className="text-sm tabular-nums text-slate-500">
                  {t.hora_inicio}–{t.hora_fim} · {t.almoco_min}min almoço
                </span>
                <span className="text-sm tabular-nums text-slate-700">
                  {c.horas.toLocaleString('pt-PT', { maximumFractionDigits: 2 })}h ·{' '}
                  {money(c.comIva)}
                </span>
                {podeEscrever && (
                  <button className="rounded px-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          onClick={async () => { await apagarTurno(t.id); carregar() }}>✕</button>
                )}
              </div>
            )
          })}
          {turnos.length === 0 && <p className="py-2 text-sm text-slate-400">Ninguém de fora neste dia.</p>}
        </div>

        {podeEscrever && hotelId && (
          <NovoTurno onJuntar={async t => { await juntarTurno(hotelId, { ...t, dia }); carregar() }} />
        )}
      </div>

      {/* -------------------------------------------------- últimos 14 dias */}
      {ultimos.length > 0 && (
        <div className="card p-4">
          <h3 className="text-sm font-semibold text-slate-700">Últimos 14 dias</h3>
          <p className="text-xs text-slate-400">
            Vermelho quando faltou gente, azul quando sobrou. Toca para abrir o dia.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {ultimos.map(({ d, b: bb }) => (
              <button
                key={d.dia}
                onClick={() => setDia(d.dia)}
                className="w-[74px] rounded-lg border border-slate-200 px-2 py-1.5 text-left"
                style={{ backgroundColor: corDoBalanco(bb.pessoas) }}
                title={`${dmy(d.dia)} · ${horas(bb.diferenca)}`}
              >
                <div className="text-[10px] uppercase text-slate-500">
                  {diaSemanaCurto(d.dia)} {d.dia.slice(8)}
                </div>
                <div className="text-sm font-semibold tabular-nums text-slate-900">
                  {pessoasTexto(bb.pessoas)}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** O que o relatório de turno diz, e se bate certo com o que está escrito. */
function DoRelatorio({
  occ, registo, podeEscrever, onUsar,
}: {
  occ: DoTurno | null
  registo: Dia
  podeEscrever: boolean
  onUsar: () => void
}) {
  if (!occ) {
    return (
      <p className="mt-2 text-xs text-amber-700">
        Não há relatório de turno para este dia — os quartos e as saídas ficam por tua conta.
      </p>
    )
  }
  const igual = occ.quartos === registo.quartos_ocupados && occ.saidas === registo.saidas
  return (
    <div className={`mt-2 rounded-lg px-3 py-2 text-xs ${
      igual ? 'bg-slate-50 text-slate-600' : 'bg-amber-50 text-amber-800'}`}>
      O turno deste dia diz <strong>{qty(occ.quartos)} quartos</strong> e{' '}
      <strong>{qty(occ.saidas)} saídas</strong>.
      {igual
        ? ' É o que está aqui.'
        : (
          <>
            {' '}O que está escrito é diferente.
            {podeEscrever && (
              <button className="ml-1.5 font-medium text-brand-700 hover:underline" onClick={onUsar}>
                usar os do turno
              </button>
            )}
          </>
        )}
    </div>
  )
}

function NovaLimpeza({ onJuntar }: { onJuntar: (d: string, m: number) => Promise<void> }) {
  const [descricao, setDescricao] = useState('')
  const [minutos, setMinutos] = useState(0)
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <div className="min-w-[140px] flex-1">
        <label className="label">O que foi feito</label>
        <input className="input h-9 text-sm" value={descricao}
               onChange={e => setDescricao(e.target.value)} />
      </div>
      <div className="w-24">
        <label className="label">Minutos</label>
        <NumInput className="h-9 text-sm" value={minutos} onChange={setMinutos} />
      </div>
      <button
        className="btn-ghost shrink-0"
        disabled={!descricao.trim() || minutos <= 0}
        onClick={async () => {
          await onJuntar(descricao.trim(), minutos)
          setDescricao(''); setMinutos(0)
        }}
      >Juntar</button>
    </div>
  )
}

function NovoTurno({
  onJuntar,
}: {
  onJuntar: (t: Omit<Turno, 'id' | 'dia'>) => Promise<void>
}) {
  const [t, setT] = useState({
    nome: '', feriado: false, hora_inicio: '09:00', hora_fim: '17:30', almoco_min: 30,
  })
  const minutos = minutosDoTurno(t)
  return (
    <div className="mt-3 flex flex-wrap items-end gap-2">
      <div className="min-w-[140px] flex-1">
        <label className="label">Nome</label>
        <input className="input h-9 text-sm" value={t.nome}
               onChange={e => setT({ ...t, nome: e.target.value })} />
      </div>
      <div>
        <label className="label">Entrada</label>
        <input type="time" className="input h-9 w-auto text-sm" value={t.hora_inicio}
               onChange={e => setT({ ...t, hora_inicio: e.target.value })} />
      </div>
      <div>
        <label className="label">Saída</label>
        <input type="time" className="input h-9 w-auto text-sm" value={t.hora_fim}
               onChange={e => setT({ ...t, hora_fim: e.target.value })} />
      </div>
      <div className="w-20">
        <label className="label">Almoço</label>
        <NumInput className="h-9 text-sm" value={t.almoco_min}
                  onChange={n => setT({ ...t, almoco_min: n })} />
      </div>
      <label className="flex items-center gap-1.5 pb-2 text-sm text-slate-600">
        <input type="checkbox" checked={t.feriado}
               onChange={e => setT({ ...t, feriado: e.target.checked })} />
        feriado
      </label>
      <span className="pb-2 text-sm text-slate-500">{horas(minutos)}</span>
      <button
        className="btn-ghost shrink-0"
        disabled={!t.nome.trim() || minutos <= 0}
        onClick={async () => {
          await onJuntar({ ...t, nome: t.nome.trim() })
          setT({ ...t, nome: '' })
        }}
      >Juntar</button>
    </div>
  )
}
