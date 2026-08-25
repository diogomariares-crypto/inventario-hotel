import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useApp } from '../lib/appState'
import { useAuth } from '../lib/auth'
import { useToast } from '../components/ui'

/**
 * Importador do ficheiro do Valentinas.
 *
 * O histórico vive dentro do próprio HTML, num bloco
 * <script id="histdata" type="text/plain"> com um CSV. Aqui lemos esse bloco
 * no browser e gravamos linha a linha — assim os dados vão do teu computador
 * direto para a base de dados, com a tua sessão, sem passar por mais lado
 * nenhum.
 *
 * Pode ser corrido as vezes que forem precisas: cada dia é atualizado, não
 * duplicado.
 */

const TEXTO = new Set([
  'service_date', 'bf_tiers', 'lunch_offcheck_name', 'dinner_offcheck_name',
  'refused_reason', 'notes', 'filled_by',
])

function lerCSV(texto: string): Record<string, unknown>[] {
  const linhas: string[][] = []
  let i = 0, campo = '', linha: string[] = [], aspas = false
  while (i < texto.length) {
    const c = texto[i]
    if (aspas) {
      if (c === '"') { if (texto[i + 1] === '"') { campo += '"'; i++ } else aspas = false }
      else campo += c
    } else if (c === '"') aspas = true
    else if (c === ',') { linha.push(campo); campo = '' }
    else if (c === '\n') { linha.push(campo); linhas.push(linha); linha = []; campo = '' }
    else if (c !== '\r') campo += c
    i++
  }
  if (campo.length || linha.length) { linha.push(campo); linhas.push(linha) }

  const cab = linhas.shift() ?? []
  return linhas
    .filter(l => l.length > 1 && l[0])
    .map(l => {
      const o: Record<string, unknown> = {}
      cab.forEach((h, j) => {
        const v = l[j]
        if (v === undefined || v === '') return
        if (h === 'bf_tiers') {
          try { o[h] = JSON.parse(v) } catch { /* escalões ilegíveis: fica vazio */ }
        } else if (TEXTO.has(h)) {
          o[h] = v
        } else {
          const n = parseFloat(v.replace(',', '.'))
          if (Number.isFinite(n)) o[h] = n
        }
      })
      return o
    })
}

export default function FbImportar() {
  const toast = useToast()
  const { hotels, hotelId, setHotelId } = useApp()
  const { email } = useAuth()
  const [estado, setEstado] = useState<string | null>(null)
  const [feitos, setFeitos] = useState(0)
  const [total, setTotal] = useState(0)
  const [erros, setErros] = useState<string[]>([])
  const [aCorrer, setACorrer] = useState(false)

  const importar = async (ficheiro: File) => {
    if (!hotelId) return
    setACorrer(true); setErros([]); setFeitos(0); setTotal(0)
    setEstado('A ler o ficheiro…')
    try {
      const html = await ficheiro.text()
      const m = html.match(
        /<script id="histdata" type="text\/plain">([\s\S]*?)<\/script>/,
      )
      if (!m) throw new Error('Não encontrei o bloco de dados neste ficheiro. É mesmo o HTML do Valentinas?')

      const registos = lerCSV(m[1].trim())
      if (!registos.length) throw new Error('O bloco de dados está vazio.')
      setTotal(registos.length)
      setEstado(`${registos.length} dias encontrados. A gravar…`)

      const LOTE = 100
      const falhas: string[] = []
      for (let i = 0; i < registos.length; i += LOTE) {
        const lote = registos.slice(i, i + LOTE).map(r => ({
          ...r, hotel_id: hotelId, updated_by: `importado por ${email ?? '?'}`,
        }))
        const { error } = await supabase
          .from('fb_billing').upsert(lote, { onConflict: 'hotel_id,service_date' })
        if (error) {
          falhas.push(`Dias ${i + 1}–${i + lote.length}: ${error.message}`)
        }
        setFeitos(Math.min(i + LOTE, registos.length))
      }
      setErros(falhas)
      setEstado(falhas.length
        ? 'Terminou com erros — vê a lista abaixo.'
        : 'Importação concluída. Os números do turno foram recalculados.')
      if (!falhas.length) toast('Histórico importado')
    } catch (e) {
      setEstado(null)
      toast((e as Error).message, 'erro')
    } finally { setACorrer(false) }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div>
        <h1 className="text-lg font-semibold">Importar histórico do Valentinas</h1>
        <p className="text-sm text-slate-500">
          Uma vez só, para trazer os anos que estão dentro do ficheiro HTML. Podes
          repetir sem medo: cada dia é atualizado, não duplicado.
        </p>
      </div>

      <div className="card space-y-3 p-4">
        <div>
          <label className="label">Hotel de destino</label>
          <select className="input" value={hotelId ?? ''}
                  onChange={e => setHotelId(e.target.value)} disabled={aCorrer}>
            {hotels.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          <p className="mt-1 text-xs text-slate-500">
            O ficheiro do Valentinas é do restaurante do Gravity.
          </p>
        </div>

        <div>
          <label className="label">Ficheiro</label>
          <input className="input" type="file" accept=".html,.htm" disabled={aCorrer}
                 onChange={e => { const f = e.target.files?.[0]; if (f) importar(f) }} />
        </div>

        {estado && (
          <div className="space-y-2">
            <p className="text-sm text-slate-600">{estado}</p>
            {total > 0 && (
              <>
                <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full bg-brand-500 transition-all"
                       style={{ width: `${Math.round((feitos / total) * 100)}%` }} />
                </div>
                <p className="text-xs tabular-nums text-slate-500">{feitos} / {total} dias</p>
              </>
            )}
          </div>
        )}

        {erros.length > 0 && (
          <div className="space-y-1 rounded-lg bg-red-50 p-3 text-xs text-red-700">
            {erros.map((e, i) => <div key={i}>{e}</div>)}
          </div>
        )}
      </div>

      <p className="text-xs text-slate-500">
        Ao gravar cada dia, as oito colunas de F&amp;B do relatório de turno desse dia
        são recalculadas a partir destes números. Isso significa que os valores que a
        receção tinha escrito à mão em julho e agosto passam a ser substituídos pelos
        do F&amp;B.
      </p>
    </div>
  )
}
