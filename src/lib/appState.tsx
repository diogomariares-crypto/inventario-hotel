import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { fetchHotels } from './data'
import type { Department, Hotel } from './types'
import { useAuth } from './auth'

interface AppState {
  hotels: Hotel[]
  hotelId: string | null
  setHotelId: (id: string) => void
  dept: Department
  setDept: (d: Department) => void
  ready: boolean
  error: string | null
}

const Ctx = createContext<AppState>(null as unknown as AppState)
export const useApp = () => useContext(Ctx)

const LS_HOTEL = 'inv.hotel'
const LS_DEPT = 'inv.dept'

export function AppProvider({ children }: { children: ReactNode }) {
  const { session, allowedDepartments, isAdmin } = useAuth()
  const [hotels, setHotels] = useState<Hotel[]>([])
  const [hotelId, setHotelIdState] = useState<string | null>(null)
  const [dept, setDeptState] = useState<Department>(
    (localStorage.getItem(LS_DEPT) as Department) || 'HSK',
  )
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!session) return
    fetchHotels()
      .then(hs => {
        const active = hs.filter(h => h.active)
        setHotels(active)
        const saved = localStorage.getItem(LS_HOTEL)
        setHotelIdState(active.find(h => h.id === saved)?.id ?? active[0]?.id ?? null)
        setError(null)
      })
      .catch(e => setError(e.message ?? String(e)))
      .finally(() => setReady(true))
  }, [session])

  // se o utilizador não pode escrever no departamento guardado, escolhe um que possa
  useEffect(() => {
    if (isAdmin) return
    if (allowedDepartments.length && !allowedDepartments.includes(dept)) {
      setDeptState(allowedDepartments[0])
    }
  }, [allowedDepartments.join(','), isAdmin])

  const setHotelId = (id: string) => { localStorage.setItem(LS_HOTEL, id); setHotelIdState(id) }
  const setDept = (d: Department) => { localStorage.setItem(LS_DEPT, d); setDeptState(d) }

  return (
    <Ctx.Provider value={{ hotels, hotelId, setHotelId, dept, setDept, ready, error }}>
      {children}
    </Ctx.Provider>
  )
}
