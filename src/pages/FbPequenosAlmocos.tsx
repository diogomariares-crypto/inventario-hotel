import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/appState'
import { useAuth } from '../lib/auth'
import { Loading, Modal, NumInput, useToast } from '../components/ui'
import BarrasAno, { Legenda, type Ponto } from '../components/BarrasAno'
import { eur, num, pct, seta, corDelta, variacao, MESES, MESES3 } from '../lib/fbDash'

/**
 * Controlo dos pequenos-almoços vendidos ao balcão.
 *
 * A pergunta é uma só: dos hóspedes que chegaram sem PA incluído, a quantos
 * conseguimos vender um.
 *
 * O único número que não está em lado nenhum é o total de hóspedes na casa,
 * que vem do PMS. Tudo o resto — incluídos, vendidos, preço e receita — sai
 * dos escalões do registo diário do F&B. Os campos manuais existem só para
 * corrigir meses em que o registo diário está incompleto.
 */

interface MesPa {
  ano: number; mes: number
  hospedes: number
  incluidosManual: number | null
  vendidosManual: number | null
  precoManual: number | null
  notas: string | null; porQuem: string | null
}
interface MesDiario {
  ano: number; mes: number
  incluidos: number; balcao: number; externos: number; reduzidos: number
  receita: number | null; preco: number | null
  dias: number; diasComRegisto: number
}
interface Dados {
  meses: MesPa[]
  diario: MesDiario[]
  escaloes: { preco: number; tipo: string }[]
}

interface Rascunho {
  ano: number; mes: number; hospedes: number
  incluidos: number | null; vendidos: number | null; preco: number | null
  notas: string
}

export default function FbPequenosAlmocos() {
  const toast = useToast()
  const { hotels, hotelId, setHotelId } = useApp()
  const { email, canWrite } = useAuth()
  const podeEscrever = canWrite('FO') || canWrite('FB')

  const [d, setD] = useState<Dados | null>(null)
  const [loading, setLoading] = useState(true)
  const [ano, setAno] = useState<number | null>(null)
  const [form, setForm] = useState<Rascunho | null>(null)
  const [aGravar, setAGravar] = useState(false)

  const carregar = async () => {
    if (!hotelId) return
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('fb_pa_dados', { p_hotel: hotelId })
      if (error) throw error
      const dd = data as Dados
      setD(dd)
      if (dd.meses.length) setAno(a => a ?? dd.meses[dd.meses.length - 1].ano)
    } catch (e) { toast((e as Error).message, 'erro') } finally { setLoading(false) }
  }
  useEffect(() => { carregar() }, [hotelId])

  const diarioPor = useMemo(() => {
    const m = new Map<string, MesDiario>()
    for (const x of d?.diario ?? []) m.set(`${x.ano}-${x.mes}`, x)
    return m
  }, [d])

  /** Junta o que veio do PMS com o que saiu do registo diário. */
  const resolver = (m: MesPa) => {
    const dia = diarioPor.get(`${m.ano}-${m.mes}`)
    const incluidos = m.incluidosManual ?? dia?.incluidos ?? 0
    const vendidos = m.vendidosManual ?? dia?.balcao ?? 0
    const preco = m.precoManual ?? dia?.preco ?? null
    const receita = m.vendidosManual != null || m.precoManual != null
      ? vendidos * (preco ?? 0)
      : dia?.receita ?? vendidos * (preco ?? 0)
    const sem = Math.max(m.hospedes - incluidos, 0)
    return {
      ...m, dia, incluidos, vendidos, preco, receita, sem,
      auto: m.incluidosManual == null && m.vendidosManual == null,
      adesao: sem ? vendidos / sem * 100 : null,
      semPct: m.hospedes ? sem / m.hospedes * 100 : null,
      diasEmFalta: dia ? dia.dias - dia.diasComRegisto : null,
    }
  }
  type Linha = ReturnType<typeof resolver>

  const anos = useMemo(
    () => [...new Set((d?.meses ?? []).map(m => m.ano))].sort((a, b) => b - a),
    [d],
  )
  const anoSel = ano ?? anos[0] ?? new Date().getFullYear()

  const doAno = useMemo(() => (d?.meses ?? []).filter(m => m.ano === anoSel).map(resolver), [d, anoSel])
  const doAnt = useMemo(() => (d?.meses ?? []).filter(m => m.ano === anoSel - 1).map(resolver), [d, anoSel])

  const mesesComuns = useMemo(() => {
    const a = new Set(doAno.map(x => x.mes))
    return doAnt.filter(x => a.has(x.mes)).map(x => x.mes)
  }, [doAno, doAnt])

  const soma = (ls: Linha[], meses?: number[]) => {
    const f = meses?.length ? ls.filter(x => meses.includes(x.mes)) : ls
    const hospedes = f.reduce((s, x) => s + x.hospedes, 0)
    const incluidos = f.reduce((s, x) => s + x.incluidos, 0)
    const vendidos = f.reduce((s, x) => s + x.vendidos, 0)
    const receita = f.reduce((s, x) => s + x.receita, 0)
    const sem = Math.max(hospedes - incluidos, 0)
    return { hospedes, incluidos, vendidos, receita, sem,
             adesao: sem ? vendidos / sem * 100 : null,
             semPct: hospedes ? sem / hospedes * 100 : null }
  }

  const A = soma(doAno, mesesComuns)
  const B = soma(doAnt, mesesComuns)
  const rotPeriodo = mesesComuns.length && mesesComuns.length < 12
    ? `${anoSel} · ${MESES3[Math.min(...mesesComuns) - 1]}–${MESES3[Math.max(...mesesComuns) - 1]}`
    : String(anoSel)

  const pontos = (campo: (l: Linha) => number | null): Ponto[] =>
    MESES3.map((rot, i) => ({
      rot, tit: MESES[i],
      a: doAno.find(x => x.mes === i + 1) ? campo(doAno.find(x => x.mes === i + 1)!) : null,
      b: doAnt.find(x => x.mes === i + 1) ? campo(doAnt.find(x => x.mes === i + 1)!) : null,
    }))

  const porPreco = useMemo(() => {
    const m = new Map<number, { meses: number; sem: number; vendidos: number; receita: number }>()
    for (const x of (d?.meses ?? []).map(resolver)) {
      if (x.preco == null) continue
      const p = Math.round(x.preco * 100) / 100
      const e = m.get(p) ?? { meses: 0, sem: 0, vendidos: 0, receita: 0 }
      e.meses++; e.sem += x.sem; e.vendidos += x.vendidos; e.receita += x.receita
      m.set(p, e)
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0])
      .map(([preco, e]) => ({ preco, ...e, adesao: e.sem ? e.vendidos / e.sem * 100 : 0 }))
  }, [d, diarioPor])

  const abrirNovo = () => {
    const ult = d?.meses[d.meses.length - 1]
    const prox = !ult ? { ano: new Date().getFullYear(), mes: new Date().getMonth() + 1 }
      : ult.mes === 12 ? { ano: ult.ano + 1, mes: 1 } : { ano: ult.ano, mes: ult.mes + 1 }
    setForm({ ...prox, hospedes: 0, incluidos: null, vendidos: null, preco: null, notas: '' })
  }

  const gravar = async () => {
    if (!form || !hotelId) return
    if (!form.hospedes) { toast('Falta o número de hóspedes', 'erro'); return }
    if (form.incluidos != null && form.incluidos > form.hospedes) {
      toast('Os incluídos não podem ser mais do que os hóspedes', 'erro'); return
    }
    setAGravar(true)
    try {
      const { error } = await supabase.from('fb_pa_mensal').upsert({
        hotel_id: hotelId, ano: form.ano, mes: form.mes,
        hospedes: Math.round(form.hospedes),
        incluidos: form.incluidos == null ? null : Math.round(form.incluidos),
        vendidos: form.vendidos == null ? null : Math.round(form.vendidos),
        preco: form.preco,
        notas: form.notas.trim() || null, updated_by: email,
      }, { onConflict: 'hotel_id,ano,mes' })
      if (error) throw error
      setForm(null); toast('Mês guardado'); carregar()
    } catch (e) { toast((e as Error).message, 'erro') } finally { setAGravar(false) }
  }

  if (!hotelId || !d) return <Loading />

  const cabecalho = (
    <div className="sticky z-20 -mx-4 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-xl sm:border"
         style={{ top: 'var(--cab-h, 57px)' }}>
      <h1 className="mr-2 text-base font-semibold">Pequenos-almoços</h1>
      {anos.length > 0 && (
        <select className="input w-auto" value={anoSel} onChange={e => setAno(Number(e.target.value))}>
          {anos.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
      )}
      {hotels.length > 1 && (
        <select className="input w-auto" value={hotelId} onChange={e => setHotelId(e.target.value)}>
          {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
      )}
      {podeEscrever && <button className="btn-primary ml-auto" onClick={abrirNovo}>+ Novo mês</button>}
      {loading && <span className="text-xs text-slate-500">a atualizar…</span>}
    </div>
  )

  if (!d.meses.length) {
    return (
      <div className="space-y-4">
        {cabecalho}
        <div className="card p-6 text-sm text-slate-600">
          Ainda não há meses registados neste hotel. Acrescenta o primeiro — só precisas
          do número de hóspedes que esteve na casa. Os pequenos-almoços já estão contados
          no registo diário.
        </div>
        <Formulario form={form} setForm={setForm} gravar={gravar} aGravar={aGravar}
                    diario={form ? diarioPor.get(`${form.ano}-${form.mes}`) : undefined} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {cabecalho}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi rot={`Hóspedes sem PA · ${rotPeriodo}`} valor={num(A.sem)} a={A.sem} b={B.sem}
             fmt={num} ant={String(anoSel - 1)}
             nota={A.semPct == null ? undefined : `${A.semPct.toFixed(1).replace('.', ',')}% dos hóspedes`} />
        <Kpi rot={`Vendidos ao balcão · ${rotPeriodo}`} valor={num(A.vendidos)}
             a={A.vendidos} b={B.vendidos} fmt={num} ant={String(anoSel - 1)} />
        <Kpi rot={`Adesão · ${rotPeriodo}`}
             valor={A.adesao == null ? '—' : `${A.adesao.toFixed(1).replace('.', ',')}%`}
             a={A.adesao} b={B.adesao} fmt={v => `${v.toFixed(1).replace('.', ',')}%`}
             ant={String(anoSel - 1)} />
        <Kpi rot={`Receita · ${rotPeriodo}`} valor={eur(A.receita)} a={A.receita} b={B.receita}
             fmt={v => eur(v)} ant={String(anoSel - 1)} />
      </div>

      <div className="card p-4">
        <h2 className="text-sm font-semibold">Adesão mensal</h2>
        <p className="mb-2 text-sm text-slate-500">
          Dos hóspedes sem PA incluído, quantos compraram um ao balcão.
        </p>
        <Legenda ano={String(anoSel)} ant={String(anoSel - 1)} />
        <BarrasAno dados={pontos(l => l.adesao)} ano={String(anoSel)} ant={String(anoSel - 1)}
                   fmt={v => `${v.toFixed(1).replace('.', ',')}%`} altura={220} />
      </div>

      <div className="card p-4">
        <h2 className="text-sm font-semibold">Quantos podíamos ter vendido</h2>
        <p className="mb-2 text-sm text-slate-500">
          Hóspedes que chegaram sem pequeno-almoço incluído. Se este universo cresce,
          vender o mesmo número já é perder terreno.
        </p>
        <Legenda ano={String(anoSel)} ant={String(anoSel - 1)} />
        <BarrasAno dados={pontos(l => l.sem)} ano={String(anoSel)} ant={String(anoSel - 1)}
                   fmt={num} altura={200} />
      </div>

      <div className="card p-4">
        <h2 className="text-sm font-semibold">Efeito do preço</h2>
        <p className="mb-3 text-sm text-slate-500">
          Toda a série, agrupada pelo preço praticado ao balcão. Os períodos não se
          sobrepõem no tempo, por isso a diferença pode ser do preço ou da época — é
          um indício, não uma prova.
        </p>
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50">
            <tr>
              <th className="th">Preço</th>
              <th className="th text-right">Meses</th>
              <th className="th text-right">Hóspedes sem PA</th>
              <th className="th text-right">Vendidos</th>
              <th className="th text-right">Adesão</th>
              <th className="th text-right">Receita</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {porPreco.map(p => (
              <tr key={p.preco}>
                <td className="td">{eur(p.preco, 2)}</td>
                <td className="td text-right tabular-nums">{p.meses}</td>
                <td className="td text-right tabular-nums">{num(p.sem)}</td>
                <td className="td text-right tabular-nums">{num(p.vendidos)}</td>
                <td className="td text-right font-medium tabular-nums">
                  {p.adesao.toFixed(1).replace('.', ',')}%
                </td>
                <td className="td text-right tabular-nums">{eur(p.receita)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card p-4">
        <h2 className="text-sm font-semibold">Mês a mês</h2>
        <p className="mb-3 text-sm text-slate-500">
          Os hóspedes vêm do PMS; o resto sai do registo diário. A coluna <em>dias</em> diz
          quantos dias do mês estão preenchidos — quando falta algum, os incluídos e os
          vendidos ficam curtos e a adesão sai errada.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="th">Mês</th>
                <th className="th text-right">Hóspedes</th>
                <th className="th text-right">Com PA</th>
                <th className="th text-right">Sem PA</th>
                <th className="th text-right">Vendidos</th>
                <th className="th text-right">Adesão</th>
                <th className="th text-right">Preço</th>
                <th className="th text-right">Receita</th>
                <th className="th text-right">Dias</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {doAno.map(m => (
                <tr key={m.mes}>
                  <td className="td">
                    {MESES[m.mes - 1]}
                    {!m.auto && (
                      <span className="chip ml-1.5 bg-slate-100 text-slate-600"
                            title="Este mês tem valores corrigidos à mão">corrigido</span>
                    )}
                  </td>
                  <td className="td text-right tabular-nums">{num(m.hospedes)}</td>
                  <td className="td text-right tabular-nums">{num(m.incluidos)}</td>
                  <td className="td text-right tabular-nums">{num(m.sem)}</td>
                  <td className="td text-right tabular-nums">{num(m.vendidos)}</td>
                  <td className="td text-right font-medium tabular-nums">
                    {m.adesao == null ? '—' : `${m.adesao.toFixed(1).replace('.', ',')}%`}
                  </td>
                  <td className="td text-right tabular-nums">{m.preco == null ? '—' : eur(m.preco, 2)}</td>
                  <td className="td text-right tabular-nums">{eur(m.receita)}</td>
                  <td className={`td text-right tabular-nums ${m.diasEmFalta ? 'font-medium text-amber-700' : ''}`}>
                    {m.dia ? `${m.dia.diasComRegisto}/${m.dia.dias}` : '—'}
                  </td>
                  <td className="td text-right">
                    {podeEscrever && (
                      <button className="text-sm text-brand-600 hover:underline"
                              onClick={() => setForm({
                                ano: m.ano, mes: m.mes, hospedes: m.hospedes,
                                incluidos: m.incluidosManual, vendidos: m.vendidosManual,
                                preco: m.precoManual, notas: m.notas ?? '',
                              })}>
                        editar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Preços lidos como venda ao balcão: {
            d.escaloes.filter(e => e.tipo === 'balcao').map(e => eur(e.preco, 2)).join(', ')
          }. Como PA incluído: {
            d.escaloes.filter(e => e.tipo === 'incluido').map(e => eur(e.preco, 2)).join(', ')
          }.
        </p>
      </div>

      <Formulario form={form} setForm={setForm} gravar={gravar} aGravar={aGravar}
                  diario={form ? diarioPor.get(`${form.ano}-${form.mes}`) : undefined} />
    </div>
  )
}

/* ------------------------------ formulário ------------------------------- */
function Formulario({ form, setForm, gravar, aGravar, diario }: {
  form: Rascunho | null
  setForm: (f: Rascunho | null) => void
  gravar: () => void; aGravar: boolean
  diario?: MesDiario
}) {
  if (!form) return null
  const incluidos = form.incluidos ?? diario?.incluidos ?? 0
  const vendidos = form.vendidos ?? diario?.balcao ?? 0
  const preco = form.preco ?? diario?.preco ?? null
  const sem = Math.max(form.hospedes - incluidos, 0)
  const adesao = sem ? vendidos / sem * 100 : null
  const receita = form.vendidos != null || form.preco != null
    ? vendidos * (preco ?? 0) : diario?.receita ?? 0

  return (
    <Modal open onClose={() => setForm(null)} title={`${MESES[form.mes - 1]} de ${form.ano}`}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Ano</label>
            <NumInput value={form.ano} onChange={v => setForm({ ...form, ano: v })} />
          </div>
          <div>
            <label className="label">Mês</label>
            <select className="input" value={form.mes}
                    onChange={e => setForm({ ...form, mes: Number(e.target.value) })}>
              {MESES.map((m, i) => (
                <option key={m} value={i + 1}>{m[0].toUpperCase() + m.slice(1)}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="label">Hóspedes na casa (PMS) *</label>
          <NumInput value={form.hospedes} onChange={v => setForm({ ...form, hospedes: v })} />
          <p className="mt-1 text-xs text-slate-500">
            É o único número que a app não tem. Todo o resto vem do registo diário.
          </p>
        </div>

        <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">
          {diario ? (
            <>
              O registo diário deste mês tem <strong>{num(diario.incluidos)}</strong> PA incluídos
              e <strong>{num(diario.balcao)}</strong> vendidos ao balcão
              {diario.preco != null && <> a {eur(diario.preco, 2)}</>},
              em <strong>{diario.diasComRegisto} de {diario.dias}</strong> dias preenchidos.
            </>
          ) : 'Ainda não há registo diário do F&B para este mês.'}
        </div>

        <details className="text-sm">
          <summary className="cursor-pointer text-slate-500">
            Corrigir à mão (só se o registo diário estiver incompleto)
          </summary>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Opcional rot="Incluídos" valor={form.incluidos} auto={diario?.incluidos}
                      onChange={v => setForm({ ...form, incluidos: v })} />
            <Opcional rot="Vendidos" valor={form.vendidos} auto={diario?.balcao}
                      onChange={v => setForm({ ...form, vendidos: v })} />
            <Opcional rot="Preço €" valor={form.preco} auto={diario?.preco ?? undefined}
                      onChange={v => setForm({ ...form, preco: v })} />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Em branco significa "usar o registo diário". Só preenche quando souberes que
            faltam dias por registar e não os vais preencher.
          </p>
        </details>

        <div>
          <label className="label">Notas</label>
          <input className="input" value={form.notas}
                 onChange={e => setForm({ ...form, notas: e.target.value })} />
        </div>

        <div className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-900">
          {num(sem)} sem PA incluído · <strong>{adesao == null ? '—' : `${adesao.toFixed(1).replace('.', ',')}%`}</strong> de adesão · {eur(receita)}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button className="btn-ghost" onClick={() => setForm(null)}>Cancelar</button>
          <button className="btn-primary" onClick={gravar} disabled={aGravar}>
            {aGravar ? 'A guardar…' : 'Guardar'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/** Campo que pode ficar vazio — vazio quer dizer "vem do registo diário". */
function Opcional({ rot, valor, auto, onChange }: {
  rot: string; valor: number | null; auto?: number | null
  onChange: (v: number | null) => void
}) {
  return (
    <div>
      <label className="label">{rot}</label>
      <input
        className="input text-right tabular-nums"
        inputMode="decimal"
        placeholder={auto == null ? 'auto' : String(auto)}
        value={valor == null ? '' : String(valor).replace('.', ',')}
        onChange={e => {
          const t = e.target.value.trim()
          if (t === '') return onChange(null)
          const n = Number(t.replace(',', '.'))
          if (!Number.isNaN(n)) onChange(n)
        }}
      />
    </div>
  )
}

function Kpi({ rot, valor, a, b, fmt, ant, nota }: {
  rot: string; valor: string; a: number | null; b: number | null
  fmt: (n: number) => string; ant: string; nota?: string
}) {
  const dp = variacao(a, b)
  return (
    <div className="card p-4">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{rot}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{valor}</div>
      <div className="mt-0.5 text-xs text-slate-500">
        {dp == null ? '—' : (
          <>
            <span className={`font-semibold ${corDelta(dp)}`}>{seta(dp)} {pct(dp)}</span>
            {' '}vs {fmt(b as number)} em {ant}
          </>
        )}
      </div>
      {nota && <div className="mt-0.5 text-xs text-slate-400">{nota}</div>}
    </div>
  )
}
