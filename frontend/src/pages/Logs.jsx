import React, { useContext, useState, useEffect, useRef, useCallback } from 'react'

import { WebSocketContext } from '../App'
import Spinner from '../components/shared/Spinner'
import ConfirmDialog from '../components/shared/ConfirmDialog'

/* ==========================================================================
   Constants
   ========================================================================== */

const MAX_BUFFER_SIZE = 1000

const LOG_LEVELS = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL']

const LEVEL_COLORS = {
  DEBUG: '#6b7280',
  INFO: '#e2e8f0',
  WARNING: '#f59e0b',
  ERROR: '#ef4444',
  CRITICAL: '#ef4444',
}

const CATEGORY_OPTIONS = [
  { value: '', label: 'All categories' },
  { value: 'device', label: 'Device' },
  { value: 'capture', label: 'Capture' },
  { value: 'processing', label: 'Processing' },
  { value: 'storage', label: 'Storage' },
  { value: 'system', label: 'System' },
]

/** Pad a string to a fixed width with trailing spaces. */
function padRight(str, len) {
  if (str.length >= len) return str.slice(0, len)
  return str + ' '.repeat(len - str.length)
}

/** Format an ISO timestamp to HH:MM:SS.mmm */
function formatTimestamp(ts) {
  if (!ts) return '00:00:00.000'
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  const ms = String(d.getMilliseconds()).padStart(3, '0')
  return `${hh}:${mm}:${ss}.${ms}`
}

/* ==========================================================================
   Log Line Component
   ========================================================================== */

function LogLine({ log }) {
  const [expanded, setExpanded] = useState(false)

  const level = (log.level || 'INFO').toUpperCase()
  const color = LEVEL_COLORS[level] || LEVEL_COLORS.INFO
  const isCritical = level === 'CRITICAL'
  const category = log.category || 'system'
  const timestamp = formatTimestamp(log.timestamp || log.created_at)
  const message = log.message || ''

  const formattedLine = `[${timestamp}] [${padRight(level, 8)}] [${padRight(category, 12)}] ${message}`

  // Build details object for expanded view
  const details = log.details || log.data || null

  return (
    <div
      onClick={() => setExpanded((prev) => !prev)}
      style={{
        padding: '2px 8px',
        cursor: details ? 'pointer' : 'default',
        color,
        fontWeight: isCritical ? 'bold' : 'normal',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
        lineHeight: 1.5,
        borderLeft: expanded ? '2px solid ' + color : '2px solid transparent',
        transition: 'border-color 150ms ease',
      }}
      role={details ? 'button' : undefined}
      tabIndex={details ? 0 : undefined}
      onKeyDown={
        details
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setExpanded((prev) => !prev)
              }
            }
          : undefined
      }
    >
      <span>{formattedLine}</span>
      {expanded && details && (
        <pre
          style={{
            margin: '4px 0 4px 24px',
            padding: '8px',
            backgroundColor: 'rgba(255,255,255,0.05)',
            borderRadius: 4,
            fontSize: '0.75rem',
            color: '#94a3b8',
            overflow: 'auto',
            maxHeight: 300,
          }}
        >
          {typeof details === 'string' ? details : JSON.stringify(details, null, 2)}
        </pre>
      )}
    </div>
  )
}

/* ==========================================================================
   Logs Page
   ========================================================================== */

export default function Logs() {
  const ws = useContext(WebSocketContext)

  /* ------------------------------------------------------------------
     State
     ------------------------------------------------------------------ */

  // Mode: 'realtime' or 'historical'
  const [mode, setMode] = useState('historical')

  // Log buffers
  const [realtimeLogs, setRealtimeLogs] = useState([])
  const [historicalLogs, setHistoricalLogs] = useState([])

  // Historical pagination
  const [historicalCursor, setHistoricalCursor] = useState(null)
  const [historicalHasMore, setHistoricalHasMore] = useState(true)
  const [historicalLoading, setHistoricalLoading] = useState(false)
  const [historicalInitialLoading, setHistoricalInitialLoading] = useState(false)

  // Filters
  const [levelFilters, setLevelFilters] = useState(() => new Set(LOG_LEVELS))
  const [categoryFilter, setCategoryFilter] = useState('')
  const [deviceFilter, setDeviceFilter] = useState('')
  const [textSearch, setTextSearch] = useState('')

  // Devices list
  const [devices, setDevices] = useState([])

  // Pause (realtime mode)
  const [paused, setPaused] = useState(false)
  const [newLogCount, setNewLogCount] = useState(0)

  // Dialogs
  const [purgeOpen, setPurgeOpen] = useState(false)

  // Scroll refs
  const terminalRef = useRef(null)
  const isAtBottomRef = useRef(true)
  const topSentinelRef = useRef(null)
  const needsScrollToBottomRef = useRef(false)

  /* ------------------------------------------------------------------
     Fetch devices for filter dropdown
     ------------------------------------------------------------------ */

  useEffect(() => {
    let cancelled = false

    async function loadDevices() {
      try {
        const res = await fetch('/api/devices')
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setDevices(data.devices ?? data ?? [])
      } catch {
        // Non-critical
      }
    }

    loadDevices()
    return () => {
      cancelled = true
    }
  }, [])

  /* ------------------------------------------------------------------
     Auto-scroll management
     ------------------------------------------------------------------ */

  const scrollToBottom = useCallback(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight
    }
  }, [])

  const handleTerminalScroll = useCallback(() => {
    if (!terminalRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = terminalRef.current
    // Consider "at bottom" if within 40px of bottom
    isAtBottomRef.current = scrollHeight - scrollTop - clientHeight < 40
  }, [])

  // Auto-scroll to bottom when new realtime logs arrive (if not paused and at bottom)
  useEffect(() => {
    if (mode === 'realtime' && !paused && isAtBottomRef.current) {
      scrollToBottom()
    }
  }, [realtimeLogs, mode, paused, scrollToBottom])

  /* ------------------------------------------------------------------
     WebSocket subscription (realtime mode)
     ------------------------------------------------------------------ */

  const handleLogEvent = useCallback(
    (data) => {
      if (paused) {
        setNewLogCount((prev) => prev + 1)
        // Still buffer the log, just don't auto-scroll
      }

      setRealtimeLogs((prev) => {
        const updated = [...prev, data]
        // Trim oldest if over buffer limit
        if (updated.length > MAX_BUFFER_SIZE) {
          return updated.slice(updated.length - MAX_BUFFER_SIZE)
        }
        return updated
      })
    },
    [paused],
  )

  useEffect(() => {
    if (mode !== 'realtime') return
    if (!ws?.subscribe) return

    const unsub = ws.subscribe('log', handleLogEvent)
    return () => unsub()
  }, [ws, mode, handleLogEvent])

  /* ------------------------------------------------------------------
     Historical mode: fetch logs
     ------------------------------------------------------------------ */

  const buildHistoricalParams = useCallback(
    (cursor) => {
      const params = new URLSearchParams()
      params.set('limit', '50')
      if (cursor) params.set('cursor', cursor)
      if (categoryFilter) params.set('category', categoryFilter)
      if (deviceFilter) params.set('device_mac', deviceFilter)
      if (textSearch) params.set('search', textSearch)
      // Level filters: send the selected levels
      const selectedLevels = Array.from(levelFilters)
      if (selectedLevels.length < LOG_LEVELS.length) {
        selectedLevels.forEach((lvl) => params.append('level', lvl))
      }
      return params.toString()
    },
    [categoryFilter, deviceFilter, textSearch, levelFilters],
  )

  const fetchHistoricalLogs = useCallback(
    async (cursor, append = false) => {
      if (append) {
        setHistoricalLoading(true)
      } else {
        setHistoricalInitialLoading(true)
      }

      try {
        const qs = buildHistoricalParams(cursor)
        const res = await fetch(`/api/logs?${qs}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()

        // API returns DESC (newest first) — reverse to ASC for terminal display
        const items = (data.items ?? data.logs ?? []).reverse()
        const newCursor = data.cursor ?? null

        if (append) {
          // Prepend older logs at top (infinite scroll up)
          setHistoricalLogs((prev) => [...items, ...prev])
        } else {
          setHistoricalLogs(items)
          // Flag to scroll to bottom after initial render
          needsScrollToBottomRef.current = true
        }

        setHistoricalCursor(newCursor)
        setHistoricalHasMore(!!newCursor && items.length >= 50)
      } catch {
        // Silently handle
      } finally {
        setHistoricalLoading(false)
        setHistoricalInitialLoading(false)
      }
    },
    [buildHistoricalParams],
  )

  // Scroll to bottom after initial historical load renders
  useEffect(() => {
    if (needsScrollToBottomRef.current && historicalLogs.length > 0 && !historicalInitialLoading) {
      needsScrollToBottomRef.current = false
      requestAnimationFrame(() => scrollToBottom())
    }
  }, [historicalLogs, historicalInitialLoading, scrollToBottom])

  // Fetch historical logs when switching to historical mode or filters change
  useEffect(() => {
    if (mode !== 'historical') return
    setHistoricalCursor(null)
    setHistoricalHasMore(true)
    fetchHistoricalLogs(null, false)
  }, [mode, fetchHistoricalLogs])

  // Infinite scroll up: load older logs in historical mode
  useEffect(() => {
    if (mode !== 'historical') return
    if (!topSentinelRef.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (
          entry.isIntersecting &&
          historicalHasMore &&
          !historicalLoading &&
          !historicalInitialLoading &&
          historicalCursor
        ) {
          fetchHistoricalLogs(historicalCursor, true)
        }
      },
      { rootMargin: '100px', root: terminalRef.current },
    )

    observer.observe(topSentinelRef.current)
    return () => observer.disconnect()
  }, [
    mode,
    historicalHasMore,
    historicalLoading,
    historicalInitialLoading,
    historicalCursor,
    fetchHistoricalLogs,
  ])

  /* ------------------------------------------------------------------
     Filter logic
     ------------------------------------------------------------------ */

  const filterLog = useCallback(
    (log) => {
      // Level filter
      const level = (log.level || 'INFO').toUpperCase()
      if (!levelFilters.has(level)) return false

      // Category filter
      if (categoryFilter && (log.category || '') !== categoryFilter) return false

      // Device filter
      if (deviceFilter && (log.device_mac || '') !== deviceFilter) return false

      // Text search
      if (textSearch) {
        const searchLower = textSearch.toLowerCase()
        const message = (log.message || '').toLowerCase()
        const category = (log.category || '').toLowerCase()
        if (!message.includes(searchLower) && !category.includes(searchLower)) {
          return false
        }
      }

      return true
    },
    [levelFilters, categoryFilter, deviceFilter, textSearch],
  )

  const activeLogs = mode === 'realtime' ? realtimeLogs : historicalLogs
  const filteredLogs = activeLogs.filter(filterLog)

  /* ------------------------------------------------------------------
     Level filter toggle
     ------------------------------------------------------------------ */

  const handleLevelToggle = useCallback((level) => {
    setLevelFilters((prev) => {
      const next = new Set(prev)
      if (next.has(level)) {
        next.delete(level)
      } else {
        next.add(level)
      }
      return next
    })
  }, [])

  const handleClearFilters = useCallback(() => {
    setLevelFilters(new Set(LOG_LEVELS))
    setCategoryFilter('')
    setDeviceFilter('')
    setTextSearch('')
  }, [])

  /* ------------------------------------------------------------------
     Actions
     ------------------------------------------------------------------ */

  const handleClearDisplay = useCallback(() => {
    if (mode === 'realtime') {
      setRealtimeLogs([])
    } else {
      setHistoricalLogs([])
    }
  }, [mode])

  const handleExport = useCallback(
    (format) => {
      const params = new URLSearchParams()
      params.set('format', format)
      if (categoryFilter) params.set('category', categoryFilter)
      if (deviceFilter) params.set('device_mac', deviceFilter)
      if (textSearch) params.set('search', textSearch)
      const selectedLevels = Array.from(levelFilters)
      if (selectedLevels.length < LOG_LEVELS.length) {
        selectedLevels.forEach((lvl) => params.append('level', lvl))
      }
      window.open(`/api/logs/export?${params.toString()}`, '_blank')
    },
    [categoryFilter, deviceFilter, textSearch, levelFilters],
  )

  const handlePurgeConfirm = useCallback(async () => {
    try {
      const res = await fetch('/api/logs', { method: 'DELETE' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setRealtimeLogs([])
      setHistoricalLogs([])
    } catch {
      // Silently handle
    } finally {
      setPurgeOpen(false)
    }
  }, [])

  const handleResume = useCallback(() => {
    setPaused(false)
    setNewLogCount(0)
    // Scroll to bottom on resume
    requestAnimationFrame(() => {
      scrollToBottom()
    })
  }, [scrollToBottom])

  /* ------------------------------------------------------------------
     Render
     ------------------------------------------------------------------ */

  const hasActiveFilters =
    levelFilters.size < LOG_LEVELS.length ||
    categoryFilter !== '' ||
    deviceFilter !== '' ||
    textSearch !== ''

  return (
    <div
      className="main-content__inner"
      style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
    >
      {/* Page header */}
      <div className="page-header" style={{ flexShrink: 0 }}>
        <h1 className="page-header__title">Logs</h1>
        <p className="page-header__description">
          Real-time and historical system logs.
        </p>
      </div>

      {/* Filter bar */}
      <div
        style={{
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)',
        }}
      >
        {/* Top row: mode toggle + actions */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            flexWrap: 'wrap',
          }}
        >
          {/* Mode toggle */}
          <div
            style={{
              display: 'flex',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--color-border)',
              overflow: 'hidden',
            }}
          >
            <button
              onClick={() => setMode('realtime')}
              style={{
                padding: 'var(--space-1) var(--space-3)',
                fontSize: 'var(--text-xs)',
                fontWeight: 'var(--font-weight-medium)',
                border: 'none',
                cursor: 'pointer',
                backgroundColor:
                  mode === 'realtime' ? 'var(--color-primary)' : 'var(--color-surface-raised)',
                color: mode === 'realtime' ? 'var(--color-primary-text)' : 'var(--color-text)',
                transition: 'background-color var(--transition-fast)',
              }}
              type="button"
            >
              Real-time
            </button>
            <button
              onClick={() => setMode('historical')}
              style={{
                padding: 'var(--space-1) var(--space-3)',
                fontSize: 'var(--text-xs)',
                fontWeight: 'var(--font-weight-medium)',
                border: 'none',
                borderLeft: '1px solid var(--color-border)',
                cursor: 'pointer',
                backgroundColor:
                  mode === 'historical' ? 'var(--color-primary)' : 'var(--color-surface-raised)',
                color: mode === 'historical' ? 'var(--color-primary-text)' : 'var(--color-text)',
                transition: 'background-color var(--transition-fast)',
              }}
              type="button"
            >
              Historical
            </button>
          </div>

          {/* Pause/Resume (realtime only) */}
          {mode === 'realtime' && (
            <button
              className={`btn btn--sm ${paused ? 'btn-primary' : 'btn-secondary'}`}
              onClick={paused ? handleResume : () => setPaused(true)}
              type="button"
            >
              {paused ? `Resume (${newLogCount} new)` : 'Pause'}
            </button>
          )}

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Action buttons */}
          <button
            className="btn btn-secondary btn--sm"
            onClick={handleClearDisplay}
            type="button"
          >
            Clear
          </button>
          <button
            className="btn btn-secondary btn--sm"
            onClick={() => handleExport('log')}
            type="button"
          >
            Export .log
          </button>
          <button
            className="btn btn-secondary btn--sm"
            onClick={() => handleExport('json')}
            type="button"
          >
            Export .json
          </button>
          <button
            className="btn btn-danger btn--sm"
            onClick={() => setPurgeOpen(true)}
            type="button"
          >
            Purge
          </button>
        </div>

        {/* Filter row: level checkboxes, category, device, search */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            flexWrap: 'wrap',
          }}
        >
          {/* Level checkboxes */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            {LOG_LEVELS.map((level) => (
              <label
                key={level}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-1)',
                  fontSize: 'var(--text-xs)',
                  cursor: 'pointer',
                  color: LEVEL_COLORS[level],
                  fontWeight: levelFilters.has(level) ? 'var(--font-weight-semibold)' : 'normal',
                  opacity: levelFilters.has(level) ? 1 : 0.5,
                }}
              >
                <input
                  type="checkbox"
                  checked={levelFilters.has(level)}
                  onChange={() => handleLevelToggle(level)}
                  style={{ accentColor: LEVEL_COLORS[level] }}
                />
                {level}
              </label>
            ))}
          </div>

          {/* Category dropdown */}
          <select
            className="form-select"
            style={{ width: 'auto', minHeight: 32, fontSize: 'var(--text-xs)' }}
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Device dropdown */}
          <select
            className="form-select"
            style={{ width: 'auto', minHeight: 32, fontSize: 'var(--text-xs)' }}
            value={deviceFilter}
            onChange={(e) => setDeviceFilter(e.target.value)}
          >
            <option value="">All devices</option>
            {devices.map((d) => (
              <option key={d.mac} value={d.mac}>
                {d.name || d.mac}
              </option>
            ))}
          </select>

          {/* Text search */}
          <input
            type="text"
            className="form-input"
            style={{
              minHeight: 32,
              padding: 'var(--space-1) var(--space-2)',
              fontSize: 'var(--text-xs)',
              width: 200,
              flex: '0 1 200px',
            }}
            placeholder="Search logs..."
            value={textSearch}
            onChange={(e) => setTextSearch(e.target.value)}
          />

          {/* Clear filters */}
          {hasActiveFilters && (
            <button
              className="btn btn-secondary btn--sm"
              onClick={handleClearFilters}
              type="button"
              style={{ minHeight: 32 }}
            >
              Clear filters
            </button>
          )}
        </div>
      </div>

      {/* Terminal display */}
      <div
        ref={terminalRef}
        onScroll={handleTerminalScroll}
        style={{
          flex: 1,
          minHeight: 0,
          backgroundColor: '#1a1a2e',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--color-border)',
          overflow: 'auto',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.8125rem',
          lineHeight: 1.5,
          padding: 'var(--space-2) 0',
          position: 'relative',
        }}
        className="scrollable"
      >
        {/* Historical mode: loading older (top sentinel) */}
        {mode === 'historical' && (
          <div ref={topSentinelRef} style={{ height: 1 }} />
        )}

        {mode === 'historical' && historicalLoading && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              padding: 'var(--space-3)',
            }}
          >
            <Spinner size="sm" label="Loading older logs" />
          </div>
        )}

        {/* Initial loading state */}
        {mode === 'historical' && historicalInitialLoading ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 200,
            }}
          >
            <Spinner label="Loading logs" />
          </div>
        ) : filteredLogs.length === 0 ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 200,
              color: '#64748b',
              fontSize: '0.875rem',
            }}
          >
            {mode === 'realtime'
              ? 'Waiting for log events...'
              : 'No logs found matching the current filters.'}
          </div>
        ) : (
          filteredLogs.map((log, index) => (
            <LogLine key={log.id || `${log.timestamp}-${index}`} log={log} />
          ))
        )}

        {/* Historical: end marker */}
        {mode === 'historical' && !historicalHasMore && historicalLogs.length > 0 && (
          <div
            style={{
              textAlign: 'center',
              fontSize: '0.75rem',
              color: '#64748b',
              padding: 'var(--space-3)',
            }}
          >
            -- End of logs --
          </div>
        )}
      </div>

      {/* Paused indicator bar */}
      {mode === 'realtime' && paused && newLogCount > 0 && (
        <div
          style={{
            flexShrink: 0,
            padding: 'var(--space-2) var(--space-4)',
            backgroundColor: 'var(--color-warning-light)',
            color: 'var(--color-warning-text)',
            fontSize: 'var(--text-xs)',
            fontWeight: 'var(--font-weight-semibold)',
            textAlign: 'center',
            borderRadius: '0 0 var(--radius-md) var(--radius-md)',
            cursor: 'pointer',
          }}
          onClick={handleResume}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              handleResume()
            }
          }}
        >
          {newLogCount} new log{newLogCount !== 1 ? 's' : ''} -- Click to resume auto-scroll
        </div>
      )}

      {/* Buffer info */}
      {mode === 'realtime' && realtimeLogs.length > 0 && (
        <div
          style={{
            flexShrink: 0,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: 'var(--space-1) var(--space-2)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-muted)',
          }}
        >
          <span>
            {filteredLogs.length} / {realtimeLogs.length} logs (buffer: {MAX_BUFFER_SIZE} max)
          </span>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 'var(--radius-full)',
              backgroundColor: ws?.connected ? 'var(--color-success)' : 'var(--color-text-muted)',
            }}
            title={ws?.connected ? 'WebSocket connected' : 'WebSocket disconnected'}
          />
        </div>
      )}

      {/* Purge confirmation */}
      <ConfirmDialog
        open={purgeOpen}
        title="Purge All Logs"
        message="This will permanently delete all log entries from the database. This action cannot be undone."
        confirmText="Purge"
        cancelText="Cancel"
        variant="danger"
        onConfirm={handlePurgeConfirm}
        onCancel={() => setPurgeOpen(false)}
      />
    </div>
  )
}
