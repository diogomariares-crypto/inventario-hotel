import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useApp } from '../lib/appState'
import type { ReactNode } from 'react'
import { useState } from 'react'

const links = (isAdmin: boolean) => [
  { to: '/', label: 'Painel', icon: '▤' },
  { to: '/contagem', label: 'Contagem', icon: '☑' },
  { to: '/historico', label: 'Histórico', icon: '↺' },
  ...(isAdmin
    ? [
        { to: '/itens', label: 'Itens', icon: '⛭' },
        { to: '/utilizadores', label: 'Utilizadores', icon: '☺' },
        { to: '/dados', label: 'Importar/Exportar', icon: '⇅' },
      ]
    : []),
]

export default function Shell({ children }: { children: ReactNode }) {
  const { isAdmin, email, fullName, roles, signOut } = useAuth()
  const { hotels, hotelId, setHotelId } = useApp()
  const nav = useNavigate()
  const [menu, setMenu] = useState(false)
  const items = links(isAdmin)

  return (
    <div className="min-h-full">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-3 py-2.5 sm:px-5">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand-500 text-sm font-bold text-white">I</div>
            <span className="hidden text-sm font-semibold sm:block">Inventário Hotel</span>
          </div>

          <select
            className="input h-9 w-auto max-w-[46vw] py-1 text-sm"
            value={hotelId ?? ''}
            onChange={e => setHotelId(e.target.value)}
          >
            {hotels.map(h => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>

          <nav className="ml-auto hidden items-center gap-1 md:flex">
            {items.map(l => (
              <NavLink
                key={l.to}
                to={l.to}
                end={l.to === '/'}
                className={({ isActive }) =>
                  `rounded-lg px-3 py-1.5 text-sm font-medium ${
                    isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100'
                  }`
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="relative ml-auto md:ml-0">
            <button
              onClick={() => setMenu(m => !m)}
              className="grid h-9 w-9 place-items-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700"
              title={email ?? ''}
            >
              {(fullName ?? email ?? '?').slice(0, 1).toUpperCase()}
            </button>
            {menu && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenu(false)} />
                <div className="absolute right-0 z-20 mt-2 w-60 rounded-xl border border-slate-200 bg-white p-2 shadow-lg">
                  <div className="px-2 py-1.5">
                    <div className="truncate text-sm font-medium">{fullName ?? email}</div>
                    <div className="truncate text-xs text-slate-500">{email}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {roles.length === 0 && (
                        <span className="chip bg-amber-100 text-amber-800">sem permissões</span>
                      )}
                      {roles.map(r => (
                        <span key={r} className="chip bg-slate-100 text-slate-700">{r.toUpperCase()}</span>
                      ))}
                    </div>
                  </div>
                  <div className="my-1 border-t border-slate-100 md:hidden" />
                  <div className="md:hidden">
                    {items.map(l => (
                      <button
                        key={l.to}
                        onClick={() => { setMenu(false); nav(l.to) }}
                        className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100"
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                  <div className="my-1 border-t border-slate-100" />
                  <button
                    onClick={signOut}
                    className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-red-600 hover:bg-red-50"
                  >
                    Terminar sessão
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-3 py-4 pb-24 sm:px-5 sm:py-6">{children}</main>

      <nav className="fixed bottom-0 z-30 flex w-full border-t border-slate-200 bg-white md:hidden">
        {items.slice(0, 3).map(l => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.to === '/'}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium ${
                isActive ? 'text-brand-600' : 'text-slate-500'
              }`
            }
          >
            <span className="text-base leading-none">{l.icon}</span>
            {l.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
