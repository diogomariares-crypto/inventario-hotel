/**
 * Escolher várias linhas de uma lista para lhes mexer de uma vez.
 *
 * O shift-clique escolhe o intervalo desde a última linha em que se tocou, que
 * é como se escolhe um fim-de-semana inteiro ou a primeira quinzena sem clicar
 * quinze vezes.
 */
import { useEffect, useRef, useState } from 'react'

export function useSeleccao(ordem: string[]) {
  const [sel, setSel] = useState<Set<string>>(new Set())
  const ultimo = useRef<string | null>(null)

  // ao mudar de mês, ou de filtro, o que já não está na lista deixa de contar
  const chave = ordem.join(',')
  useEffect(() => {
    setSel(s => {
      const vivos = new Set(ordem)
      const fora = new Set([...s].filter(id => vivos.has(id)))
      return fora.size === s.size ? s : fora
    })
  }, [chave])

  const alternar = (id: string, comShift = false) => {
    setSel(s => {
      const novo = new Set(s)
      const de = ultimo.current
      if (comShift && de && de !== id) {
        const i = ordem.indexOf(de), j = ordem.indexOf(id)
        if (i >= 0 && j >= 0) {
          // o intervalo herda o estado da linha em que se clicou agora
          const ligar = !s.has(id)
          for (const x of ordem.slice(Math.min(i, j), Math.max(i, j) + 1)) {
            if (ligar) novo.add(x); else novo.delete(x)
          }
          ultimo.current = id
          return novo
        }
      }
      if (novo.has(id)) novo.delete(id); else novo.add(id)
      ultimo.current = id
      return novo
    })
  }

  return {
    sel,
    n: sel.size,
    tem: (id: string) => sel.has(id),
    alternar,
    todos: () => { setSel(new Set(ordem)); ultimo.current = null },
    nenhum: () => { setSel(new Set()); ultimo.current = null },
    /** Só os ids escolhidos, pela ordem em que aparecem na lista. */
    escolhidos: () => ordem.filter(id => sel.has(id)),
  }
}

export type Seleccao = ReturnType<typeof useSeleccao>
