import { useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { useAuth } from '../lib/auth'
import {
  DENOMINACOES, apagar, apagarFicheiro, balanco, contasDoEnvelope, estaCerto, ehNota,
  fetchCaixas, fetchMes, guardarEnvelope, guardarFicheiro, guardarSaida, importarRecebido,
  juntarDeposito, juntarEnvelope, juntarRecebidoManual, juntarSaida, lerColagem,
  instante, lerRelatorioPms, linkDaFatura, recebidoDoTurno, somaDenominacoes, TOLERANCIA,
  type Balanco, type Caixa, type Deposito, type Envelope, type LinhaDoMes,
  type Recebido, type Saida,
} from '../lib/caixa'
import { dmy, lastDayOfMonth, money, todayISO } from '../lib/format'
import { Loading, Modal, NumInput, Spinner, StatCard, useToast } from '../components/ui'
import { ehMes, mesCorrente, useLembrado } from '../lib/lembrar'

type Dados = {
  recebido: Recebido[]; saidas: Saida[]; envelopes: Envelope[]
  depositos: Deposito[]; anterior: Envelope | null
}

/**
 * As horas aqui são horas de relógio de parede, sem fuso — o que o Mews imprime
 * e o que a equipa escreve. Por isso mexem-se como texto: pô-las num Date só
 * serviria para as fazer andar uma hora quando muda a hora legal.
 */

/** "2026-09-01T23:00" — o formato que o input datetime-local fala. */
const paraInput = (t: string) => t.slice(0, 16)

const agora = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
         `T${p(d.getHours())}:${p(d.getMinutes())}`
}

/** "01/09 23:00" */
const quando = (t: string) => `${t.slice(8, 10)}/${t.slice(5, 7)} ${t.slice(11, 16)}`

/** Só a hora: "23:00". */
const horaDe = (t: string) => t.slice(11, 16)

export default function CaixaPage() {
  const { email } = useAuth()
  const toast = useToast()

  const [caixas, setCaixas] = useState<Caixa[]>([])
  const [caixaId, setCaixaId] = useLembrado('caixa.id', '')
  const [mes, setMes] = useLembrado('caixa.mes', mesCorrente, ehMes)
  const [d, setD] = useState<Dados | null>(null)
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const [aEditar, setAEditar] = useState<Envelope | null | 'novo'>(null)
  const [colar, setColar] = useState(false)

  useEffect(() => {
    fetchCaixas()
      .then(cs => {
        setCaixas(cs)
        // a caixa lembrada pode ter sido desactivada entretanto
        setCaixaId(c => (cs.some(x => x.id === c) ? c : cs[0]?.id ?? ''))
      })
      .catch(e => setErro((e as Error).message))
  }, [])

  const carregar = () => {
    if (!caixaId) return
    setLoading(true)
    fetchMes(caixaId, `${mes}-01`, lastDayOfMonth(mes))
      .then(setD)
      .catch(e => setErro((e as Error).message))
      .finally(() => setLoading(false))
  }
  useEffect(carregar, [caixaId, mes])

  const caixa = caixas.find(c => c.id === caixaId)
  const b: Balanco | null = useMemo(
    () => (d ? balanco(d.recebido, d.saidas, d.envelopes, d.depositos, d.anterior) : null),
    [d])

  if (erro) {
    return (
      <div className="card p-6 text-sm">
        <h2 className="mb-2 font-semibold text-red-600">Não foi possível abrir a caixa</h2>
        <p className="text-slate-600">{erro}</p>
      </div>
    )
  }
  if (loading || !d || !b || !caixa) return <Loading />

  const certo = estaCerto(b)
  const ultimo = d.envelopes.length
    ? [...d.envelopes].sort((a, x) => x.fim.localeCompare(a.fim))[0]
    : d.anterior

  return (
    <div className="space-y-4">
      {/* --------------------------------------------------------- cabeçalho */}
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label className="label">Caixa</label>
          <select className="input w-auto" value={caixaId} onChange={e => setCaixaId(e.target.value)}>
            {caixas.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Mês</label>
          <input type="month" className="input w-auto" value={mes}
                 onChange={e => setMes(e.target.value)} />
        </div>
        <p className="flex-1 text-xs text-slate-500">
          {caixa.fonte === 'pms'
            ? 'O recebido vem do relatório de pagamentos do Mews — arrasta-o para a caixa lá em baixo. Cada turno vai lá buscar o que foi cobrado entre a hora a que começou e a hora a que fechou.'
            : 'Aqui o recebido escreve-se ao fecho do dia; não há relatório de onde o ir buscar.'}
        </p>
        <button className="btn-primary shrink-0" onClick={() => setAEditar('novo')}>
          + Fechar turno
        </button>
      </div>

      {/* ---------------------------------------------------------- balanço */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Recebido em dinheiro" value={money(b.recebido)}
                  hint={`${d.recebido.length} ${d.recebido.length === 1 ? 'registo' : 'registos'}`} />
        <StatCard label="Pago em faturas" value={money(b.saidas)}
                  hint={`${b.faturas} ${b.faturas === 1 ? 'fatura' : 'faturas'}`} />
        <StatCard label="Contado nos envelopes" value={money(b.contado)}
                  hint={`${b.envelopes} ${b.envelopes === 1 ? 'turno fechado' : 'turnos fechados'}`} />
        <StatCard label="Por depositar" value={money(b.emCofre)}
                  hint={`${money(b.depositado)} já depositados`} />
        <div className={`card p-4 ${certo ? 'border-[#0ca30c]/40 bg-[#0ca30c]/5'
                                          : 'border-[#d03b3b]/40 bg-[#d03b3b]/5'}`}>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Diferença acumulada
          </div>
          <div className={`mt-1 text-2xl font-semibold tabular-nums ${
            certo ? 'text-[#0a7d0a]' : 'text-[#b32d2d]'}`}>
            {b.diferenca > 0 ? '+' : ''}{money(b.diferenca)}
          </div>
          <div className="mt-0.5 text-xs text-slate-600">
            {certo ? 'os turnos fecham certos'
              : b.diferenca > 0 ? 'contámos a mais do que o esperado'
              : 'falta dinheiro ou faltam faturas por lançar'}
          </div>
        </div>
      </div>

      <Avisos b={b} />

      {/* ----------------------------------------------------------- turnos */}
      <div className="card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-700">Turnos fechados</h3>
          <span className="text-xs text-slate-400">
            cada turno leva o dinheiro cobrado no Mews entre a hora de abertura e a de fecho
          </span>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="th">Turno</th>
                <th className="th">Quem fechou</th>
                <th className="th text-right" title="deixado pelo turno anterior">Abertura</th>
                <th className="th text-right">Recebido</th>
                <th className="th text-right">Faturas</th>
                <th className="th text-right" title="fica na caixa para o turno seguinte">Fica</th>
                <th className="th text-right">Devia ter</th>
                <th className="th text-right">Contado</th>
                <th className="th text-right">Difer.</th>
                <th className="th text-right" title="soma das diferenças até aqui">Acum.</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {b.linhas.map(l => (
                <LinhaTurno key={l.envelope.id} l={l}
                            onAbrir={() => setAEditar(l.envelope)}
                            onApagar={async () => {
                              if (!confirm(`Apagar o turno de ${quando(l.envelope.inicio)}? As faturas que lá vinham ficam soltas, não se perdem.`)) return
                              await apagar('cx_envelopes', l.envelope.id); carregar()
                            }} />
              ))}
            </tbody>
          </table>
        </div>
        {b.linhas.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-400">
            Nenhum turno fechado neste mês.
          </p>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* -------------------------------------------------------- faturas */}
        <div className="card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold text-slate-700">
              Faturas pagas em dinheiro
            </h3>
            <button className="btn-ghost text-sm" onClick={() => setColar(true)}>
              Colar várias
            </button>
          </div>
          <p className="text-xs text-slate-400">
            Lança-as aqui e depois diz, no fecho do turno, quais vinham dentro do envelope.
          </p>

          <div className="mt-3 max-h-[320px] space-y-1.5 overflow-y-auto">
            {d.saidas.map(s => (
              <LinhaSaida key={s.id} s={s} caixaId={caixaId}
                          envelope={d.envelopes.find(e => e.id === s.envelope_id) ?? null}
                          onMudou={carregar}
                          onApagar={async () => {
                            if (!confirm(`Apagar a fatura de ${s.fornecedor ?? dmy(s.dia)}?`)) return
                            if (s.ficheiro) await apagarFicheiro(s.ficheiro)
                            await apagar('cx_saidas', s.id); carregar()
                          }} />
            ))}
            {d.saidas.length === 0 && (
              <p className="py-3 text-sm text-slate-400">Nenhuma fatura paga por caixa.</p>
            )}
          </div>

          <NovaSaida onJuntar={async s => {
            await juntarSaida(caixaId, { ...s, ficheiro: null, envelope_id: null }, email)
            carregar()
          }} />
        </div>

        {/* ------------------------------------------------------ depósitos */}
        <div className="card p-4">
          <Depositos
            depositos={d.depositos} emCofre={b.emCofre}
            onJuntar={async dep => { await juntarDeposito(caixaId, dep); carregar() }}
            onApagar={async id => { await apagar('cx_depositos', id); carregar() }}
          />
        </div>
      </div>

      {/* ------------------------------------------------------- recebido */}
      <Recebimentos
        caixa={caixa} recebido={d.recebido} total={b.recebido}
        onImportado={carregar}
        onJuntarManual={async (dia, valor, nota) => {
          await juntarRecebidoManual(caixaId, dia, valor, nota); carregar()
        }}
        onApagar={async id => { await apagar('cx_recebido', id); carregar() }}
      />

      {aEditar && (
        <ContarEnvelope
          caixaId={caixaId}
          existente={aEditar === 'novo' ? null : aEditar}
          recebido={d.recebido}
          saidas={d.saidas}
          /* o turno novo começa onde o anterior acabou: sem buracos nem sobreposições */
          inicioSugerido={aEditar === 'novo' ? (ultimo ? paraInput(ultimo.fim) : `${mes}-01T00:00`) : null}
          abertura={aEditar === 'novo'
            ? (ultimo?.transporte ?? 0)
            : aberturaDe(b, aEditar.id, d.anterior)}
          onFechar={() => setAEditar(null)}
          onGravado={() => { setAEditar(null); carregar() }}
        />
      )}

      {colar && (
        <ColarFaturas
          onFechar={() => setColar(false)}
          onGravar={async linhas => {
            for (const l of linhas)
              await juntarSaida(caixaId, { ...l, ficheiro: null, envelope_id: null }, email)
            setColar(false); carregar(); toast(`${linhas.length} faturas lançadas`)
          }}
        />
      )}
    </div>
  )
}

/** O que o turno anterior a este deixou na caixa. */
function aberturaDe(b: Balanco, id: string, anterior: Envelope | null) {
  const i = b.linhas.findIndex(l => l.envelope.id === id)
  if (i < 0) return 0
  return i === 0 ? (anterior?.transporte ?? 0) : b.linhas[i - 1].envelope.transporte
}

/* ------------------------------------------------------------------ avisos */

function Avisos({ b }: { b: Balanco }) {
  const avisos: string[] = []
  if (b.faturasSoltas.length) {
    const t = b.faturasSoltas.reduce((s, x) => s + x.valor, 0)
    avisos.push(`${b.faturasSoltas.length} ${b.faturasSoltas.length === 1
      ? 'fatura não está atribuída a nenhum turno' : 'faturas não estão atribuídas a nenhum turno'}` +
      ` (${money(t)}). Enquanto assim for, não são descontadas a nenhum envelope.`)
  }
  if (b.foraDeTurno.length) {
    const t = b.foraDeTurno.reduce((s, x) => s + x.valor, 0)
    avisos.push(`${money(t)} cobrados em ${b.foraDeTurno.length} pagamentos que não caem dentro` +
      ` de nenhum turno fechado — falta fechar esse turno, ou as horas não cobrem tudo.`)
  }
  for (const [a, c] of b.sobrepostos)
    avisos.push(`Os turnos de ${quando(a.inicio)} e ${quando(c.inicio)} sobrepõem-se:` +
      ` o dinheiro cobrado nesse intervalo está a ser contado nos dois.`)

  if (!avisos.length) return null
  return (
    <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
      <ul className="space-y-1">
        {avisos.map((a, i) => <li key={i}>• {a}</li>)}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------ turnos */

function LinhaTurno({
  l, onAbrir, onApagar,
}: {
  l: LinhaDoMes
  onAbrir: () => void
  onApagar: () => void
}) {
  const c = l.contas
  const zero = (n: number) => (n ? money(n) : <span className="text-slate-300">—</span>)
  return (
    <tr className="border-b border-slate-100 hover:bg-slate-50/60">
      <td className="td whitespace-nowrap">
        <button className="text-left font-medium text-slate-700 hover:text-brand-700 hover:underline"
                onClick={onAbrir}>
          {quando(l.envelope.inicio)} → {quando(l.envelope.fim)}
        </button>
        {l.envelope.nota && (
          <div className="text-[11px] text-slate-400">{l.envelope.nota}</div>
        )}
      </td>
      <td className="td text-slate-600">{l.envelope.responsavel || '—'}</td>
      <td className="td text-right tabular-nums text-slate-500">{zero(c.abertura)}</td>
      <td className="td text-right tabular-nums text-slate-700">
        {money(c.recebido)}
        <span className="ml-1 text-[11px] text-slate-400">{c.nPagamentos}</span>
      </td>
      <td className="td text-right tabular-nums text-slate-500">
        {c.faturas ? `−${money(c.faturas)}` : <span className="text-slate-300">—</span>}
        {c.nFaturas > 0 && <span className="ml-1 text-[11px] text-slate-400">{c.nFaturas}</span>}
      </td>
      <td className="td text-right tabular-nums text-slate-500">
        {c.transporte ? `−${money(c.transporte)}` : <span className="text-slate-300">—</span>}
      </td>
      <td className="td text-right font-medium tabular-nums text-slate-700">{money(c.esperado)}</td>
      <td className="td text-right font-semibold tabular-nums text-slate-900">{money(c.contado)}</td>
      <td className={`td text-right font-semibold tabular-nums ${
        c.certo ? 'text-slate-300' : c.diferenca > 0 ? 'text-[#0a7d0a]' : 'text-[#b32d2d]'}`}>
        {c.certo ? '—' : `${c.diferenca > 0 ? '+' : ''}${money(c.diferenca)}`}
      </td>
      <td className={`td text-right tabular-nums ${
        Math.abs(l.acumulado) <= TOLERANCIA ? 'text-slate-300' : 'text-slate-600'}`}>
        {Math.abs(l.acumulado) <= TOLERANCIA ? '—'
          : `${l.acumulado > 0 ? '+' : ''}${money(l.acumulado)}`}
      </td>
      <td className="td text-right">
        <button className="rounded px-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                onClick={onApagar}>✕</button>
      </td>
    </tr>
  )
}

/* ------------------------------------------------------------------ saídas */

function LinhaSaida({
  s, caixaId, envelope, onMudou, onApagar,
}: {
  s: Saida
  caixaId: string
  envelope: Envelope | null
  onMudou: () => void
  onApagar: () => void
}) {
  const toast = useToast()
  const [aEnviar, setAEnviar] = useState(false)
  const ficheiro = useRef<HTMLInputElement>(null)

  const anexar = async (f: File) => {
    setAEnviar(true)
    try {
      const caminho = await guardarFicheiro(caixaId, s, f)
      await guardarSaida(s.id, { ficheiro: caminho })
      onMudou()
    } catch (e) { toast((e as Error).message, 'erro') }
    finally { setAEnviar(false) }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5">
      <span className="w-20 shrink-0 text-sm tabular-nums text-slate-500">{dmy(s.dia)}</span>
      <div className="min-w-[120px] flex-1">
        <div className="truncate text-sm text-slate-700">{s.fornecedor || '—'}</div>
        <div className="truncate text-[11px] text-slate-400">
          {[s.descricao, s.documento].filter(Boolean).join(' · ') || 'sem descrição'}
        </div>
      </div>
      <span className={`chip shrink-0 ${envelope ? 'bg-slate-100 text-slate-600'
                                                 : 'bg-amber-100 text-amber-800'}`}>
        {envelope ? quando(envelope.fim) : 'sem turno'}
      </span>
      <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-800">
        {money(s.valor)}
      </span>
      {s.ficheiro ? (
        <button
          className="shrink-0 text-xs text-brand-600 hover:underline"
          onClick={async () => {
            const url = await linkDaFatura(s.ficheiro!)
            if (url) window.open(url, '_blank'); else toast('Não consegui abrir a fatura', 'erro')
          }}
        >ver fatura</button>
      ) : (
        <>
          <button className="shrink-0 text-xs text-slate-500 hover:underline"
                  disabled={aEnviar}
                  onClick={() => ficheiro.current?.click()}>
            {aEnviar ? '…' : 'anexar'}
          </button>
          <input ref={ficheiro} type="file" className="hidden"
                 accept=".pdf,.jpg,.jpeg,.png,.heic"
                 onChange={e => { const f = e.target.files?.[0]; if (f) anexar(f) }} />
        </>
      )}
      <button className="shrink-0 rounded px-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
              onClick={onApagar}>✕</button>
    </div>
  )
}

function NovaSaida({
  onJuntar,
}: {
  onJuntar: (s: Omit<Saida, 'id' | 'ficheiro' | 'envelope_id'>) => Promise<void>
}) {
  const [s, setS] = useState({
    dia: todayISO(), fornecedor: '', descricao: '', documento: '', valor: 0,
  })
  return (
    <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3 sm:grid-cols-6">
      <div className="sm:col-span-2">
        <label className="label">Data</label>
        <input type="date" className="input h-9 text-sm" value={s.dia}
               onChange={e => setS({ ...s, dia: e.target.value })} />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Fornecedor</label>
        <input className="input h-9 text-sm" value={s.fornecedor}
               onChange={e => setS({ ...s, fornecedor: e.target.value })} />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Descrição</label>
        <input className="input h-9 text-sm" value={s.descricao}
               onChange={e => setS({ ...s, descricao: e.target.value })} />
      </div>
      <div className="sm:col-span-3">
        <label className="label">Nº do documento</label>
        <input className="input h-9 text-sm" value={s.documento}
               onChange={e => setS({ ...s, documento: e.target.value })} />
      </div>
      <div className="sm:col-span-2">
        <label className="label">Valor</label>
        <NumInput className="h-9 text-sm" value={s.valor}
                  onChange={n => setS({ ...s, valor: n })} />
      </div>
      <div className="flex items-end">
        <button
          className="btn-primary h-9 w-full text-sm"
          disabled={s.valor <= 0}
          onClick={async () => {
            await onJuntar({
              dia: s.dia,
              fornecedor: s.fornecedor.trim() || null,
              descricao: s.descricao.trim() || null,
              documento: s.documento.trim() || null,
              valor: s.valor,
            })
            setS({ ...s, fornecedor: '', descricao: '', documento: '', valor: 0 })
          }}
        >Juntar</button>
      </div>
    </div>
  )
}

function ColarFaturas({
  onFechar, onGravar,
}: {
  onFechar: () => void
  onGravar: (l: Omit<Saida, 'id' | 'ficheiro' | 'envelope_id'>[]) => Promise<void>
}) {
  const [texto, setTexto] = useState('')
  const linhas = useMemo(() => lerColagem(texto), [texto])
  const total = linhas.reduce((s, l) => s + l.valor, 0)

  return (
    <Modal open onClose={onFechar} title="Colar várias faturas" wide>
      <p className="text-sm text-slate-600">
        Cola aqui uma tabela — do Excel, ou a que te devolvo no chat depois de ler as
        faturas. Uma linha por fatura:
      </p>
      <p className="mt-1 rounded bg-slate-50 px-3 py-2 font-mono text-xs text-slate-600">
        data · fornecedor · descrição · nº documento · valor
      </p>
      <p className="mt-1 text-xs text-slate-500">
        Se trouxeres a linha de cabeçalho, a ordem das colunas deixa de importar —
        podes colar as Saídas de Caixa tal como estão no Excel.
      </p>
      <textarea
        className="input mt-3 min-h-[180px] font-mono text-xs"
        placeholder={'15/08/2026\tAuchan Cedofeita\tMaterial manutenção\t1161032026080001/001\t7,69'}
        value={texto}
        onChange={e => setTexto(e.target.value)}
      />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span className="text-sm text-slate-600">
          {linhas.length
            ? <><strong>{linhas.length} faturas</strong> reconhecidas · {money(total)}</>
            : 'ainda nada reconhecido'}
        </span>
        <button className="btn-primary ml-auto" disabled={!linhas.length}
                onClick={() => onGravar(linhas)}>
          Lançar {linhas.length || ''}
        </button>
      </div>
      {linhas.length > 0 && (
        <div className="mt-3 max-h-[200px] overflow-y-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <tbody>
              {linhas.map((l, i) => (
                <tr key={i} className="border-b border-slate-100">
                  <td className="td w-24 tabular-nums text-slate-500">{dmy(l.dia)}</td>
                  <td className="td">{l.fornecedor}</td>
                  <td className="td text-slate-400">{l.documento}</td>
                  <td className="td text-right tabular-nums">{money(l.valor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}

/* ------------------------------------------------------------- fecho do turno */

function ContarEnvelope({
  caixaId, existente, recebido, saidas, inicioSugerido, abertura, onFechar, onGravado,
}: {
  caixaId: string
  existente: Envelope | null
  recebido: Recebido[]
  saidas: Saida[]
  inicioSugerido: string | null
  abertura: number
  onFechar: () => void
  onGravado: () => void
}) {
  const { email } = useAuth()
  const toast = useToast()

  const [inicio, setInicio] = useState(
    existente ? paraInput(existente.inicio) : (inicioSugerido ?? agora()))
  const [fim, setFim] = useState(existente ? paraInput(existente.fim) : agora())
  const [responsavel, setResponsavel] = useState(existente?.responsavel ?? '')
  const [nota, setNota] = useState(existente?.nota ?? '')
  const [transporte, setTransporte] = useState(existente?.transporte ?? 0)
  const [qtd, setQtd] = useState<Record<string, number>>(existente?.denominacoes ?? {})
  const [escolhidas, setEscolhidas] = useState<string[]>(
    saidas.filter(s => existente && s.envelope_id === existente.id).map(s => s.id))
  const [aGravar, setAGravar] = useState(false)

  const valido = instante(fim) > instante(inicio)

  // o que o Mews registou dentro deste intervalo — muda enquanto se mexe nas horas
  const doTurno = useMemo(
    () => (valido ? recebidoDoTurno(recebido, inicio, fim) : []),
    [recebido, inicio, fim, valido])

  // faturas à escolha: as que ainda estão soltas, mais as que já são deste envelope
  const candidatas = useMemo(
    () => saidas.filter(s => !s.envelope_id || (existente && s.envelope_id === existente.id)),
    [saidas, existente])

  const faturas = candidatas.filter(s => escolhidas.includes(s.id))
  const contado = somaDenominacoes(qtd)
  const pecas = Object.values(qtd).reduce((s, n) => s + (n || 0), 0)

  const c = contasDoEnvelope(
    { inicio, fim, valor: contado, transporte }, abertura, doTurno, faturas)

  const gravar = async () => {
    setAGravar(true)
    try {
      const env = {
        dia: fim.slice(0, 10),
        inicio, fim,
        responsavel: responsavel.trim() || null,
        valor: contado,
        denominacoes: Object.fromEntries(Object.entries(qtd).filter(([, n]) => n > 0)),
        transporte,
        nota: nota.trim() || null,
      }
      if (existente) await guardarEnvelope(existente.id, caixaId, env, escolhidas, email)
      else await juntarEnvelope(caixaId, env, escolhidas, email)
      toast(existente ? 'Turno actualizado' : 'Turno fechado')
      onGravado()
    } catch (e) {
      toast((e as Error).message, 'erro'); setAGravar(false)
    }
  }

  return (
    <Modal open onClose={onFechar} title={existente ? 'Turno' : 'Fechar turno'} wide>
      {/* ------------------------------------------------- o intervalo */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="label">O turno começou</label>
          <input type="datetime-local" className="input" value={inicio}
                 onChange={e => setInicio(e.target.value)} />
        </div>
        <div>
          <label className="label">e fechou</label>
          <input type="datetime-local" className="input" value={fim}
                 onChange={e => setFim(e.target.value)} />
        </div>
        <div>
          <label className="label">Quem fechou</label>
          <input className="input" value={responsavel}
                 onChange={e => setResponsavel(e.target.value)} />
        </div>
        <div>
          <label className="label">Nota</label>
          <input className="input" value={nota} onChange={e => setNota(e.target.value)}
                 placeholder="ex.: sem trocos de 5" />
        </div>
      </div>

      {!valido && (
        <p className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          O fecho tem de vir depois da abertura.
        </p>
      )}

      {/* ------------------------------------------------- o que devia ter */}
      <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/60 p-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <dl className="space-y-1 text-sm">
            <Conta rotulo="Ficou do turno anterior" valor={c.abertura} apagado={!c.abertura} />
            <Conta rotulo={`Recebido no turno · ${c.nPagamentos} pagamentos`} valor={c.recebido} />
            <Conta rotulo={`Faturas neste envelope · ${c.nFaturas}`} valor={-c.faturas}
                   apagado={!c.faturas} />
            <Conta rotulo="Fica na caixa para o turno seguinte" valor={-c.transporte}
                   apagado={!c.transporte} />
          </dl>
          <div className="flex flex-col justify-center rounded-lg bg-white px-4 py-3">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Devia estar no envelope
            </div>
            <div className="text-3xl font-semibold tabular-nums text-slate-900">
              {money(c.esperado)}
            </div>
            {contado > 0 && (
              <div className={`mt-1 text-sm font-medium tabular-nums ${
                c.certo ? 'text-[#0a7d0a]' : 'text-[#b32d2d]'}`}>
                contado {money(contado)}
                {c.certo ? ' · bate certo'
                  : ` · ${c.diferenca > 0 ? 'sobram' : 'faltam'} ${money(Math.abs(c.diferenca))}`}
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 border-t border-slate-200 pt-3">
          <label className="label">Troco que fica na caixa para o turno seguinte</label>
          <div className="flex flex-wrap items-center gap-2">
            <NumInput className="h-9 w-28 text-sm" value={transporte} onChange={setTransporte} />
            <p className="min-w-[220px] flex-1 text-xs text-slate-500">
              Só se não houver trocos para pôr o valor certo no envelope. Fica a abrir o
              turno seguinte, por isso este envelope continua a fechar exacto.
            </p>
          </div>
          {c.esperado < 0 && (
            <p className="mt-2 rounded bg-amber-50 px-3 py-2 text-xs text-amber-800">
              Assim o envelope teria de levar {money(c.esperado)} — a caixa não chega para
              deixar tanto troco. Confirma as horas do turno, as faturas, ou este valor.
            </p>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------- as faturas */}
      <div className="mt-4">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          Que faturas vinham neste envelope?
        </h4>
        {candidatas.length === 0 ? (
          <p className="mt-1.5 text-sm text-slate-400">
            Não há faturas por atribuir. Lança-as na página e voltam a aparecer aqui.
          </p>
        ) : (
          <div className="mt-1.5 max-h-[160px] space-y-1 overflow-y-auto rounded-lg border border-slate-200 p-1.5">
            {candidatas.map(s => {
              const sel = escolhidas.includes(s.id)
              // as do intervalo aparecem em destaque; as outras ficam mais apagadas
              const perto = s.dia >= inicio.slice(0, 10) && s.dia <= fim.slice(0, 10)
              return (
                <label key={s.id}
                       className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-sm ${
                         sel ? 'bg-brand-50' : 'hover:bg-slate-50'}`}>
                  <input type="checkbox" checked={sel}
                         onChange={e => setEscolhidas(x =>
                           e.target.checked ? [...x, s.id] : x.filter(i => i !== s.id))} />
                  <span className={`w-16 shrink-0 tabular-nums ${
                    perto ? 'text-slate-500' : 'text-slate-300'}`}>{dmy(s.dia)}</span>
                  <span className={`min-w-0 flex-1 truncate ${
                    perto ? 'text-slate-700' : 'text-slate-400'}`}>
                    {s.fornecedor || '—'}
                    <span className="ml-1.5 text-[11px] text-slate-400">{s.documento}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-slate-700">{money(s.valor)}</span>
                </label>
              )
            })}
          </div>
        )}
      </div>

      {/* ------------------------------------------------------- a contagem */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {[DENOMINACOES.filter(ehNota), DENOMINACOES.filter(v => !ehNota(v))].map((grupo, g) => (
          <div key={g}>
            <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
              {g === 0 ? 'Notas' : 'Moedas'}
            </h4>
            <div className="space-y-1">
              {grupo.map(v => {
                const n = qtd[String(v)] || 0
                return (
                  <div key={v} className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-right text-sm tabular-nums text-slate-600">
                      {v >= 1 ? `${v} €` : `${(v * 100).toFixed(0)} c`}
                    </span>
                    <NumInput
                      className="h-8 w-20 text-sm"
                      value={n}
                      onChange={x => setQtd(q => ({ ...q, [String(v)]: Math.max(0, Math.round(x)) }))}
                    />
                    <span className={`text-sm tabular-nums ${n ? 'text-slate-700' : 'text-slate-300'}`}>
                      {money(v * n)}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-slate-500">Contado no envelope</div>
          <div className="text-2xl font-semibold tabular-nums text-brand-700">{money(contado)}</div>
          <div className="text-xs text-slate-400">{pecas} notas e moedas</div>
        </div>
        <button
          className="btn-primary ml-auto"
          disabled={!valido || contado <= 0 || aGravar}
          onClick={gravar}
        >{aGravar ? 'A gravar…' : existente ? 'Gravar alterações' : 'Fechar turno'}</button>
      </div>
    </Modal>
  )
}

function Conta({ rotulo, valor, apagado }: { rotulo: string; valor: number; apagado?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-2 ${apagado ? 'text-slate-400' : ''}`}>
      <dt className="min-w-0 truncate">{rotulo}</dt>
      <dd className="shrink-0 tabular-nums">
        {valor < 0 ? `−${money(-valor)}` : money(valor)}
      </dd>
    </div>
  )
}

/* --------------------------------------------------------------- depósitos */

function Depositos({
  depositos, emCofre, onJuntar, onApagar,
}: {
  depositos: Deposito[]
  emCofre: number
  onJuntar: (d: Omit<Deposito, 'id'>) => Promise<void>
  onApagar: (id: string) => Promise<void>
}) {
  const [dia, setDia] = useState(todayISO())
  const [valor, setValor] = useState(0)
  const [ref, setRef] = useState('')

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">Depósitos</h3>
        <span className="text-xs tabular-nums text-slate-500">
          por depositar: <strong className="text-slate-700">{money(emCofre)}</strong>
        </span>
      </div>

      <div className="mt-3 space-y-1">
        {depositos.map(d => (
          <div key={d.id} className="flex items-center gap-2 text-sm">
            <span className="w-20 shrink-0 tabular-nums text-slate-500">{dmy(d.dia)}</span>
            <span className="min-w-0 flex-1 truncate text-slate-500">{d.referencia || '—'}</span>
            <span className="tabular-nums text-slate-700">{money(d.valor)}</span>
            <button className="rounded px-1.5 text-slate-400 hover:text-red-600"
                    onClick={() => onApagar(d.id)}>✕</button>
          </div>
        ))}
        {depositos.length === 0 && (
          <p className="py-3 text-sm text-slate-400">Nenhum depósito neste mês.</p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
        <input type="date" className="input h-9 w-auto text-sm" value={dia}
               onChange={e => setDia(e.target.value)} />
        <NumInput className="h-9 w-24 text-sm" value={valor} onChange={setValor} />
        <input className="input h-9 w-32 text-sm" placeholder="referência" value={ref}
               onChange={e => setRef(e.target.value)} />
        <button className="btn-ghost shrink-0" disabled={valor <= 0}
                onClick={async () => {
                  await onJuntar({ dia, valor, referencia: ref.trim() || null })
                  setValor(0); setRef('')
                }}>Depositar</button>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- recebido */

function Recebimentos({
  caixa, recebido, total, onImportado, onJuntarManual, onApagar,
}: {
  caixa: Caixa
  recebido: Recebido[]
  total: number
  onImportado: () => void
  onJuntarManual: (dia: string, valor: number, nota: string | null) => Promise<void>
  onApagar: (id: string) => Promise<void>
}) {
  const toast = useToast()
  const [aLer, setALer] = useState(false)
  const [sobre, setSobre] = useState(false)
  const [aberto, setAberto] = useState(false)
  const [dia, setDia] = useState(todayISO())
  const [valor, setValor] = useState(0)
  const [nota, setNota] = useState('')
  const ficheiro = useRef<HTMLInputElement>(null)

  const porDia = useMemo(() => {
    const m: Record<string, number> = {}
    for (const r of recebido) m[r.dia] = (m[r.dia] ?? 0) + r.valor
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b))
  }, [recebido])

  const ler = async (f: File) => {
    setALer(true)
    try {
      const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true })
      const folha = wb.SheetNames.find(n => /cash/i.test(n)) ?? wb.SheetNames[0]
      const linhas = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[folha])
      const pms = lerRelatorioPms(linhas)
      if (!pms.length) {
        toast('Não encontrei pagamentos em dinheiro nesse ficheiro', 'erro')
        return
      }
      const { novas, repetidas } = await importarRecebido(caixa.id, pms)
      toast(repetidas
        ? `${novas} pagamentos novos · ${repetidas} já estavam`
        : `${novas} pagamentos importados`)
      onImportado()
    } catch (e) {
      toast((e as Error).message, 'erro')
    } finally { setALer(false) }
  }

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-700">
          Recebido em dinheiro · {money(total)}
        </h3>
        <button className="text-sm text-brand-700 hover:underline"
                onClick={() => setAberto(a => !a)}>
          {aberto ? 'esconder detalhe' : `ver os ${recebido.length} registos`}
        </button>
      </div>

      {caixa.fonte === 'pms' ? (
        <div
          onDragOver={e => { e.preventDefault(); setSobre(true) }}
          onDragLeave={() => setSobre(false)}
          onDrop={e => {
            e.preventDefault(); setSobre(false)
            const f = e.dataTransfer.files?.[0]; if (f) ler(f)
          }}
          onClick={() => ficheiro.current?.click()}
          className={`mt-3 cursor-pointer rounded-xl border-2 border-dashed p-6 text-center ${
            sobre ? 'border-brand-500 bg-brand-50' : 'border-slate-300 bg-slate-50/60'}`}
        >
          {aLer ? (
            <span className="flex items-center justify-center gap-2 text-sm text-slate-600">
              <Spinner /> a ler o relatório…
            </span>
          ) : (
            <>
              <div className="text-sm font-medium text-slate-700">
                Arrasta para aqui o relatório de pagamentos do Mews
              </div>
              <div className="mt-0.5 text-xs text-slate-500">
                Leio a folha «Cash payments». Podes voltar a largar o mesmo ficheiro —
                os pagamentos que já cá estiverem não se repetem.
              </div>
            </>
          )}
          <input ref={ficheiro} type="file" className="hidden" accept=".xlsx,.xls"
                 onChange={e => { const f = e.target.files?.[0]; if (f) ler(f) }} />
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className="label">Dia</label>
            <input type="date" className="input h-9 w-auto text-sm" value={dia}
                   onChange={e => setDia(e.target.value)} />
          </div>
          <div>
            <label className="label">Dinheiro do dia</label>
            <NumInput className="h-9 w-28 text-sm" value={valor} onChange={setValor} />
          </div>
          <div className="min-w-[140px] flex-1">
            <label className="label">Nota</label>
            <input className="input h-9 text-sm" value={nota}
                   onChange={e => setNota(e.target.value)} />
          </div>
          <button className="btn-primary shrink-0" disabled={valor <= 0}
                  onClick={async () => {
                    await onJuntarManual(dia, valor, nota.trim() || null)
                    setValor(0); setNota('')
                  }}>Juntar</button>
        </div>
      )}

      {porDia.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {porDia.map(([d, v]) => (
            <span key={d} className="rounded-lg border border-slate-200 px-2 py-1 text-xs">
              <span className="text-slate-500">{d.slice(8)}</span>{' '}
              <span className="tabular-nums text-slate-700">{money(v)}</span>
            </span>
          ))}
        </div>
      )}

      {aberto && (
        <div className="mt-3 max-h-[280px] overflow-y-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="text-left text-[11px] uppercase tracking-wide text-slate-500">
                <th className="th">Quando</th>
                <th className="th">Cliente</th>
                <th className="th">Quem recebeu</th>
                <th className="th">Conta</th>
                <th className="th text-right">Valor</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {recebido.map(r => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="td whitespace-nowrap tabular-nums text-slate-500">
                    {dmy(r.dia)}{r.momento && ` ${horaDe(r.momento)}`}
                  </td>
                  <td className="td">{r.cliente || '—'}</td>
                  <td className="td text-slate-500">{r.criador || '—'}</td>
                  <td className="td text-slate-400">{r.documento || '—'}</td>
                  <td className="td text-right tabular-nums">{money(r.valor)}</td>
                  <td className="td text-right">
                    <button className="text-slate-400 hover:text-red-600"
                            onClick={() => onApagar(r.id)}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-2 text-xs text-slate-400">
        Uma diferença até {money(TOLERANCIA)} conta como troco e não levanta bandeira.
      </p>
    </div>
  )
}
