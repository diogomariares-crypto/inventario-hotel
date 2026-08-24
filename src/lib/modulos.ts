/**
 * Módulos da aplicação.
 *
 * Cada módulo é um separador de topo com as suas próprias páginas por baixo.
 * Para acrescentar uma app nova à operação basta:
 *   1. criar a página em src/pages/
 *   2. registar a rota em src/App.tsx
 *   3. acrescentar uma entrada aqui
 * Não é preciso mexer no menu — ele é construído a partir desta lista.
 */
export interface Pagina {
  to: string
  label: string
  /** Só visível para administradores. */
  soAdmin?: boolean
}

export interface Modulo {
  id: string
  label: string
  icone: string
  /** Só visível para administradores. */
  soAdmin?: boolean
  paginas: Pagina[]
}

export const MODULOS: Modulo[] = [
  {
    id: 'turnos',
    label: 'Turnos',
    icone: '⇄',
    paginas: [
      { to: '/turno', label: 'Relatório diário' },
      { to: '/turno-historico', label: 'Histórico' },
    ],
  },
  {
    id: 'inventario',
    label: 'Inventário',
    icone: '▤',
    paginas: [
      { to: '/', label: 'Painel' },
      { to: '/contagem', label: 'Contagem' },
      { to: '/encomendas', label: 'Encomendas' },
      { to: '/historico', label: 'Histórico' },
      { to: '/itens', label: 'Itens', soAdmin: true },
      { to: '/dados', label: 'Importar/Exportar', soAdmin: true },
    ],
  },
  {
    id: 'gestao',
    label: 'Gestão',
    icone: '⛭',
    soAdmin: true,
    paginas: [
      { to: '/utilizadores', label: 'Utilizadores' },
      { to: '/migrar-imagens', label: 'Migrar imagens' },
    ],
  },
]

/** Módulo a que pertence um caminho — o que tiver a página mais específica. */
export function moduloDoCaminho(caminho: string): Modulo {
  let melhor: { modulo: Modulo; peso: number } | null = null
  for (const m of MODULOS) {
    for (const p of m.paginas) {
      const bate = p.to === '/' ? caminho === '/' : caminho === p.to || caminho.startsWith(p.to + '/')
      if (bate && (!melhor || p.to.length > melhor.peso)) {
        melhor = { modulo: m, peso: p.to.length }
      }
    }
  }
  return melhor?.modulo ?? MODULOS[1]
}
