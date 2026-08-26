import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuth } from '../lib/auth'
import { useApp } from '../lib/appState'
import { Loading, NumInput, useToast } from '../components/ui'
import {
  type Registo, type Escaloes, type LinhaManut, type NotasServico,
  GRUPOS, TODAS_AS_CHAVES, SERVICOS_NOTA,
  fetchRegisto, fetchUltimosEscaloes, gravarRegisto,
  recalcular, espelhoDoTurno, escaloesDe, eur,
} from '../lib/fb'
import { somaDias, hojeIso, dataLonga } from '../lib/parque'

const vazio = (): Registo => {
  const r: Registo = {}
  for (const k of TODAS_AS_CHAVES) r[k] = null
  r.bf_tiers = {}
  r.notas_servico = {}
  r.notas_equipa = ''
  r.manutencao = []
  return r
}

export default function FbFaturacao() {
  const toast = useToast()
  const { email, canWrite } = useAuth()
  const { hotels, hotelId, setHotelId } = useApp()
  const podeEscrever = canWrite('FB')

  const [dia, setDia] = useState(hojeIso())
  const [reg, setReg] = useState<Registo>(vazio())
  const [loading, setLoading] = useState(true)
  const [aGravar, setAGravar] = useState(false)
  const [sujo, setSujo] = useState(false)
  const [aberto, setAberto] = useState<string>('bf')
  const regRef = useRef(reg)
  regRef.current = reg

  const carregar = async () => {
    if (!hotelId) return
    setLoading(true)
    try {
      const r = await fetchRegisto(hotelId, dia)
      if (r) {
        setReg({ ...vazio(), ...r })
      } else {
        const esc = await fetchUltimosEscaloes(hotelId, dia)
        setReg({ ...vazio(), bf_tiers: esc ?? {} })
      }
      setSujo(false)
    } catch (e) { toast((e as Error).message, 'erro') } finally { setLoading(false) }
  }

  useEffect(() => { carregar() }, [hotelId, dia])

  const calc = useMemo(() => recalcular(reg), [reg])
  const espelho = useMemo(() => espelhoDoTurno(reg), [reg])

  const por = (k: string, v: number | string | null) => {
    setReg(r => ({ ...r, [k]: v }))
    setSujo(true)
  }

  const escaloes = escaloesDe(reg)
  const listaEscaloes = Object.entries(escaloes)

  const mudarEscalao = (nome: string, campo: 'pax' | 'price', v: number) => {
    const novo: Escaloes = { ...escaloes, [nome]: { ...escaloes[nome], [campo]: v } }
    setReg(r => ({ ...r, bf_tiers: novo })); setSujo(true)
  }
  const renomearEscalao = (antigo: string, novo: string) => {
    if (!novo.trim() || novo === antigo) return
    const out: Escaloes = {}
    for (const [k, v] of Object.entries(escaloes)) out[k === antigo ? novo : k] = v
    setReg(r => ({ ...r, bf_tiers: out })); setSujo(true)
  }
  const juntarEscalao = () => {
    const nome = prompt('Nome do escalão (ex: PAX A 10,17€)')
    if (!nome?.trim()) return
    setReg(r => ({ ...r, bf_tiers: { ...escaloesDe(r), [nome.trim()]: { pax: 0, price: 0 } } }))
    setSujo(true)
  }
  const tirarEscalao = (nome: string) => {
    const out = { ...escaloes }; delete out[nome]
    setReg(r => ({ ...r, bf_tiers: out })); setSujo(true)
  }

  const gravar = async () => {
    if (!hotelId) return
    setAGravar(true)
    try {
      await gravarRegisto(hotelId, dia, regRef.current, email)
      toast('Guardado — a secção F&B do turno já reflete estes números')
      setSujo(false)
    } catch (e) { toast((e as Error).message, 'erro') } finally { setAGravar(false) }
  }

  if (!hotelId) return <Loading />

  return (
    <div className="space-y-4">
      {/* barra do dia */}
      <div className="sticky z-20 -mx-4 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-xl sm:border"
           style={{ top: 'var(--cab-h, 57px)' }}>
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn-ghost" onClick={() => setDia(somaDias(dia, -1))}>‹</button>
          <input className="input w-auto" type="date" value={dia}
                 onChange={e => setDia(e.target.value)} />
          <button className="btn-ghost" onClick={() => setDia(somaDias(dia, 1))}>›</button>
          <button className="btn-ghost" onClick={() => setDia(hojeIso())}>Hoje</button>
          <select className="input w-auto" value={hotelId} onChange={e => setHotelId(e.target.value)}>
            {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-slate-500">Total do dia</span>
            <span className="text-lg font-semibold tabular-nums">{eur(calc.day_total)}</span>
            {podeEscrever && (
              <button className="btn-primary" onClick={gravar} disabled={aGravar || !sujo}>
                {aGravar ? 'A guardar…' : sujo ? 'Guardar' : 'Guardado'}
              </button>
            )}
          </div>
        </div>
        <p className="mt-1 text-xs text-slate-500">{dataLonga(dia)}</p>
      </div>

      {loading ? <Loading /> : (
        <>
          {!podeEscrever && (
            <div className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Só o F&amp;B e os administradores podem alterar estes números.
            </div>
          )}

          {GRUPOS.map(g => {
            const ab = aberto === g.key
            return (
              <div key={g.key} className="card overflow-hidden">
                <button className="flex w-full items-center justify-between px-4 py-3 text-left"
                        onClick={() => setAberto(ab ? '' : g.key)}>
                  <span className="font-semibold">{g.titulo}</span>
                  <span className="text-slate-400">{ab ? '−' : '+'}</span>
                </button>

                {ab && (
                  <div className="space-y-4 border-t border-slate-100 p-4">
                    {g.escaloes && (
                      <div className="space-y-2">
                        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                          Escalões de preço
                        </div>
                        {listaEscaloes.length === 0 && (
                          <p className="text-sm text-slate-500">
                            Ainda não há escalões. Junta o primeiro para poder contar PAX.
                          </p>
                        )}
                        {listaEscaloes.map(([nome, t]) => (
                          <div key={nome} className="flex flex-wrap items-end gap-2">
                            <div className="min-w-[10rem] flex-1">
                              <label className="label">Escalão</label>
                              <input className="input" defaultValue={nome} disabled={!podeEscrever}
                                     onBlur={e => renomearEscalao(nome, e.target.value)} />
                            </div>
                            <div className="w-24">
                              <label className="label">PAX</label>
                              <NumInput value={t.pax ?? 0} disabled={!podeEscrever}
                                        onChange={v => mudarEscalao(nome, 'pax', v)} />
                            </div>
                            <div className="w-28">
                              <label className="label">Preço €</label>
                              <NumInput value={t.price ?? 0} disabled={!podeEscrever}
                                        onChange={v => mudarEscalao(nome, 'price', v)} />
                            </div>
                            <div className="w-28 pb-2 text-right text-sm tabular-nums text-slate-500">
                              {eur((t.pax ?? 0) * (t.price ?? 0))}
                            </div>
                            {podeEscrever && (
                              <button className="pb-2 text-sm text-slate-400 hover:text-red-600"
                                      onClick={() => tirarEscalao(nome)}>remover</button>
                            )}
                          </div>
                        ))}
                        {podeEscrever && (
                          <button className="btn-ghost" onClick={juntarEscalao}>+ escalão</button>
                        )}
                      </div>
                    )}

                    {g.blocos.map((b, i) => (
                      <div key={i} className="space-y-2">
                        {b.head && (
                          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            {b.head}
                          </div>
                        )}
                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                          {b.campos.map(c => (
                            <div key={c.k}>
                              <label className="label">{c.rot}</label>
                              {c.t === 'c' ? (
                                <div className="input bg-slate-50 text-right tabular-nums text-slate-600">
                                  {c.k.endsWith('revenue') || c.k.endsWith('total')
                                    ? eur(calc[c.k]) : String(calc[c.k] ?? 0)}
                                </div>
                              ) : c.t === 't' ? (
                                <input className="input" disabled={!podeEscrever}
                                       value={(reg[c.k] as string) ?? ''}
                                       onChange={e => por(c.k, e.target.value)} />
                              ) : (
                                <NumInput value={Number(reg[c.k] ?? 0)} disabled={!podeEscrever}
                                          onChange={v => por(c.k, v)} />
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )
          })}

          <NotasDoDia reg={reg} setReg={setReg} setSujo={setSujo} podeEscrever={podeEscrever} />

          {/* o que vai para o turno */}
          <div className="card p-4">
            <h2 className="text-sm font-semibold">O que vai para o relatório de turno</h2>
            <p className="mb-3 text-xs text-slate-500">
              Ao guardar, a secção F&amp;B do turno deste hotel e deste dia passa a ter
              exatamente estes valores. A receção deixa de os copiar.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="th">Serviço</th>
                    <th className="th text-right">IN</th>
                    <th className="th text-right">OUT</th>
                    <th className="th text-right">PAX</th>
                    <th className="th text-right">€</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {espelho.map(l => (
                    <tr key={l.coluna}>
                      <td className="td">{l.coluna}</td>
                      <td className="td text-right tabular-nums">{l.ins}</td>
                      <td className="td text-right tabular-nums">{l.outs}</td>
                      <td className="td text-right tabular-nums">{l.pax}</td>
                      <td className="td text-right tabular-nums">{eur(l.eur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card grid gap-3 p-4 sm:grid-cols-3">
            <Resumo rot="Total com IVA" valor={eur(calc.day_total)} />
            <Resumo rot="Total sem IVA" valor={eur(calc.day_total_net)} />
            <Resumo rot="PAX almoço + jantar" valor={String(calc.pax_lunch_dinner ?? 0)} />
          </div>
        </>
      )}
    </div>
  )
}

/* ------------------------------ notas do dia ----------------------------- */
/**
 * O que a equipa escrevia no corpo do email. As notas por serviço e o assunto
 * da equipa aparecem na secção F&B do turno; cada linha de manutenção vai para
 * o Controlo de Manutenção — e volta a ser corrigida se aqui mudar, desde que
 * ninguém do outro lado lhe tenha mexido no estado.
 */
function NotasDoDia({ reg, setReg, setSujo, podeEscrever }: {
  reg: Registo
  setReg: React.Dispatch<React.SetStateAction<Registo>>
  setSujo: (v: boolean) => void
  podeEscrever: boolean
}) {
  const notas = (reg.notas_servico as NotasServico) ?? {}
  const manut = (reg.manutencao as LinhaManut[]) ?? []

  const porNota = (k: string, v: string) => {
    setReg(r => ({ ...r, notas_servico: { ...((r.notas_servico as NotasServico) ?? {}), [k]: v } }))
    setSujo(true)
  }
  const porManut = (id: string, campo: 'local' | 'descricao', v: string) => {
    setReg(r => ({
      ...r,
      manutencao: ((r.manutencao as LinhaManut[]) ?? []).map(l => l.id === id ? { ...l, [campo]: v } : l),
    }))
    setSujo(true)
  }
  const juntarManut = () => {
    setReg(r => ({
      ...r,
      manutencao: [...((r.manutencao as LinhaManut[]) ?? []),
                   { id: crypto.randomUUID(), local: '', descricao: '' }],
    }))
    setSujo(true)
  }
  const tirarManut = (id: string) => {
    if (!confirm('Tirar esta linha?\n\nSe já tiver ido para o Controlo de Manutenção, fica lá — quem trata disso é que a fecha.')) return
    setReg(r => ({
      ...r,
      manutencao: ((r.manutencao as LinhaManut[]) ?? []).filter(l => l.id !== id),
    }))
    setSujo(true)
  }

  return (
    <div className="card space-y-4 p-4">
      <div>
        <h2 className="text-sm font-semibold">Notas do dia</h2>
        <p className="text-xs text-slate-500">
          É o que ia no corpo do email. Aparece na secção F&amp;B do relatório de turno,
          para a receção não ter de procurar em dois sítios.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {SERVICOS_NOTA.map(s => (
          <div key={s.k}>
            <label className="label">{s.rot}</label>
            <textarea
              className="input min-h-[62px] resize-y"
              disabled={!podeEscrever}
              placeholder="Sem ocorrências"
              value={notas[s.k] ?? ''}
              onChange={e => porNota(s.k, e.target.value)}
            />
          </div>
        ))}
      </div>

      <div>
        <label className="label">Assuntos da equipa</label>
        <textarea
          className="input min-h-[62px] resize-y"
          disabled={!podeEscrever}
          placeholder="Tudo dentro da normalidade"
          value={(reg.notas_equipa as string) ?? ''}
          onChange={e => { setReg(r => ({ ...r, notas_equipa: e.target.value })); setSujo(true) }}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-end justify-between gap-3">
          <div>
            <label className="label">Equipamentos / manutenção</label>
            <p className="text-xs text-slate-500">
              Uma linha por equipamento. Vai direta para o Controlo de Manutenção
              nos Turnos, com a data de hoje.
            </p>
          </div>
          {podeEscrever && (
            <button className="btn-ghost shrink-0" onClick={juntarManut}>+ linha</button>
          )}
        </div>

        {manut.length === 0 && (
          <p className="text-sm text-slate-500">Nada a reportar.</p>
        )}
        {manut.map(l => (
          <div key={l.id} className="flex flex-wrap items-end gap-2">
            <div className="w-48">
              <label className="label">Equipamento / local</label>
              <input className="input" disabled={!podeEscrever}
                     placeholder="Ex: Arca de gelo"
                     value={l.local}
                     onChange={e => porManut(l.id, 'local', e.target.value)} />
            </div>
            <div className="min-w-[14rem] flex-1">
              <label className="label">O que se passa</label>
              <input className="input" disabled={!podeEscrever}
                     placeholder="Ex: a mola está partida, bem como a pega para abrir"
                     value={l.descricao}
                     onChange={e => porManut(l.id, 'descricao', e.target.value)} />
            </div>
            {podeEscrever && (
              <button className="pb-2 text-sm text-slate-400 hover:text-red-600"
                      onClick={() => tirarManut(l.id)}>remover</button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

function Resumo({ rot, valor }: { rot: string; valor: string }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{rot}</div>
      <div className="mt-0.5 text-xl font-semibold tabular-nums">{valor}</div>
    </div>
  )
}
