import React, { createContext, useContext, useState, useEffect, useMemo } from 'react'
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom'

import { useWebSocket } from './hooks/useWebSocket'
import { ToastProvider } from './components/shared/Toast'
import Sidebar from './components/layout/Sidebar'
import BottomTabBar from './components/layout/BottomTabBar'
import TopBar from './components/layout/TopBar'
import ReconnectBanner from './components/shared/ReconnectBanner'
import Home from './pages/Home'
import History from './pages/History'
import Detail from './pages/Detail'
import Devices from './pages/Devices'
import Logs from './pages/Logs'
import Settings from './pages/Settings'
import Station from './pages/Station'

import './styles/variables.css'
import './styles/layout.css'
import './styles/components.css'

/* ==========================================================================
   Contexts
   ========================================================================== */

/** WebSocket context – provides { connected, lastEvent, subscribe } */
export const WebSocketContext = createContext(null)
export const useWS = () => useContext(WebSocketContext)

/** Theme context – provides { theme, toggleTheme } */
export const ThemeContext = createContext(null)
export const useTheme = () => useContext(ThemeContext)

/* ==========================================================================
   Theme Provider
   ========================================================================== */

function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(() => {
    // 1. Check localStorage
    const stored = localStorage.getItem('satsu-theme')
    if (stored === 'light' || stored === 'dark') return stored
    // 2. Check system preference
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark'
    // 3. Default to light
    return 'light'
  })

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('satsu-theme', theme)
  }, [theme])

  // Listen for OS-level theme changes
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e) => {
      // Only auto-switch if user hasn't explicitly chosen
      const stored = localStorage.getItem('satsu-theme')
      if (!stored) {
        setTheme(e.matches ? 'dark' : 'light')
      }
    }
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const toggleTheme = () => setTheme((t) => (t === 'light' ? 'dark' : 'light'))

  const value = useMemo(() => ({ theme, toggleTheme }), [theme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/* ==========================================================================
   WebSocket Provider
   ========================================================================== */

function WebSocketProvider({ children }) {
  const ws = useWebSocket()
  return <WebSocketContext.Provider value={ws}>{children}</WebSocketContext.Provider>
}

/* ==========================================================================
   Placeholder Page Components
   (will be replaced in later phases)
   ========================================================================== */

function PagePlaceholder({ name }) {
  return (
    <div className="main-content__inner">
      <div className="page-header">
        <h1 className="page-header__title">{name}</h1>
        <p className="page-header__description">This page is under construction.</p>
      </div>
      <div className="empty-state">
        <div className="empty-state__icon">&#128679;</div>
        <div className="empty-state__title">{name}</div>
        <div className="empty-state__description">
          This section will be implemented in a future phase.
        </div>
      </div>
    </div>
  )
}

function HomePage() {
  return <Home />
}
function HistoryPage() {
  return <History />
}
function HistoryDetailPage() {
  return <Detail />
}
function DevicesPage() {
  return <Devices />
}
function LogsPage() {
  return <Logs />
}
function SettingsPage() {
  return <Settings />
}
function StationPage() {
  return <Station />
}

/* ==========================================================================
   Route-to-title map (used by TopBar)
   ========================================================================== */

export const ROUTE_TITLES = {
  '/': 'Home',
  '/history': 'History',
  '/devices': 'Devices',
  '/logs': 'Logs',
  '/settings': 'Settings',
}

/* ==========================================================================
   App Layout (responsive shell)
   ========================================================================== */

function AppLayout() {
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()
  const ws = useWS()
  const isKiosk = location.pathname === '/station'

  /* Keyboard shortcuts (T111) */
  useEffect(() => {
    const handler = (e) => {
      // Ctrl+N / Cmd+N → go home (scan mode)
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault()
        navigate('/')
        return
      }
      // Escape → dispatch close-modals event
      if (e.key === 'Escape') {
        window.dispatchEvent(new CustomEvent('close-modals'))
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [navigate])

  // Determine the page title for TopBar
  const pageTitle = useMemo(() => {
    // Exact match first
    if (ROUTE_TITLES[location.pathname]) return ROUTE_TITLES[location.pathname]
    // Check for /history/:id pattern
    if (location.pathname.startsWith('/history/')) return 'Scan Detail'
    return 'Satsu'
  }, [location.pathname])

  // Station page is a kiosk — no sidebar, topbar, or bottom nav
  if (isKiosk) {
    return (
      <Routes>
        <Route path="/station" element={<StationPage />} />
      </Routes>
    )
  }

  return (
    <div className={`app-layout${sidebarExpanded ? ' app-layout--sidebar-expanded' : ''}`}>
      <ReconnectBanner />

      {/* Top bar (mobile only, hidden on tablet/desktop via CSS) */}
      <TopBar
        title={pageTitle}
        connected={ws?.connected ?? false}
      />

      {/* Sidebar (tablet & desktop, hidden on mobile via CSS) */}
      <Sidebar
        expanded={sidebarExpanded}
        onToggle={() => setSidebarExpanded((prev) => !prev)}
      />

      {/* Main content area */}
      <main className="main-content scrollable">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/history/:id" element={<HistoryDetailPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>

      {/* Bottom tab bar (mobile only, hidden on tablet/desktop via CSS) */}
      <BottomTabBar />
    </div>
  )
}

/* ==========================================================================
   Root App Component
   ========================================================================== */

export default function App() {
  return (
    <ThemeProvider>
      <WebSocketProvider>
        <ToastProvider>
          <BrowserRouter>
            <AppLayout />
          </BrowserRouter>
        </ToastProvider>
      </WebSocketProvider>
    </ThemeProvider>
  )
}
