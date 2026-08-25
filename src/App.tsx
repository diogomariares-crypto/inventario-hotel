import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import { AppProvider, useApp } from './lib/appState'
import { ToastProvider, Loading } from './components/ui'
import Shell from './components/Shell'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Contagem from './pages/Contagem'
import Encomendas from './pages/Encomendas'
import Historico from './pages/Historico'
import Turno from './pages/Turno'
import TurnoHistorico from './pages/TurnoHistorico'
import Parque from './pages/Parque'
import MigrarImagens from './pages/MigrarImagens'
import Conta from './pages/Conta'
import DesafioMfa from './pages/Mfa'
import DefinirSenha from './pages/DefinirSenha'
import Itens from './pages/Itens'
import Utilizadores from './pages/Utilizadores'
import Dados from './pages/Dados'

function SoAdmin({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useAuth()
  return isAdmin ? <>{children}</> : <Navigate to="/" replace />
}

function Interior() {
  const { ready, error, hotels } = useApp()
  if (!ready) return <Loading />
  if (error) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <div className="card p-6 text-sm">
          <h2 className="mb-2 font-semibold text-red-600">Não foi possível ligar à base de dados</h2>
          <p className="text-slate-600">{error}</p>
        </div>
      </div>
    )
  }
  if (hotels.length === 0) {
    return (
      <div className="mx-auto max-w-lg p-6">
        <div className="card p-6 text-sm text-slate-600">
          Não há hotéis configurados nesta conta.
        </div>
      </div>
    )
  }
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/contagem" element={<Contagem />} />
        <Route path="/encomendas" element={<Encomendas />} />
        <Route path="/turno" element={<Turno />} />
        <Route path="/turno/:date" element={<Turno />} />
        <Route path="/turno-historico" element={<TurnoHistorico />} />
        <Route path="/parque" element={<Parque />} />
        <Route path="/conta" element={<Conta />} />
        <Route path="/historico" element={<Historico />} />
        <Route path="/itens" element={<SoAdmin><Itens /></SoAdmin>} />
        <Route path="/utilizadores" element={<SoAdmin><Utilizadores /></SoAdmin>} />
        <Route path="/dados" element={<SoAdmin><Dados /></SoAdmin>} />
        <Route path="/migrar-imagens" element={<SoAdmin><MigrarImagens /></SoAdmin>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  )
}

function Raiz() {
  const { session, loading, precisaCodigo, senhaTemporaria } = useAuth()
  if (loading) return <Loading label="A iniciar…" />
  if (!session) return <Login />
  if (precisaCodigo) return <DesafioMfa />
  if (senhaTemporaria) return <DefinirSenha />
  return (
    <AppProvider>
      <Interior />
    </AppProvider>
  )
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <HashRouter>
          <Raiz />
        </HashRouter>
      </AuthProvider>
    </ToastProvider>
  )
}
