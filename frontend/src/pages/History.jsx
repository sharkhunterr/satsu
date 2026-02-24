import React, { useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'

import { WebSocketContext } from '../App'
import Spinner from '../components/shared/Spinner'
import EmptyState from '../components/shared/EmptyState'
import ConfirmDialog from '../components/shared/ConfirmDialog'
import { useToast } from '../components/shared/Toast'

/* ==========================================================================
   Helpers
   ========================================================================== */

const STORAGE_LABELS = {
  paperless: 'Paperless',
  local: 'Local',
  webdav: 'WebDAV',
  gdrive: 'GDrive',
  smb: 'SMB',
}

function ScanThumbnail({ batchId, fallback }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <>{fallback}</>
  return (
    <img
      src={`/api/image/processed/${batchId}/0`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

function StorageBadges({ exportInfo }) {
  if (!exportInfo || typeof exportInfo !== 'object') return null
  const entries = Object.entries(exportInfo).filter(([, v]) => v && v.success)
  if (entries.length === 0) return null
  return entries.map(([name]) => (
    <span key={name} className="badge badge-storage">
      {STORAGE_LABELS[name] || name}
    </span>
  ))
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function timeAgo(dateStr) {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago'
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago'
  return Math.floor(seconds / 86400) + 'd ago'
}

/** Map status to badge CSS class. */
function statusBadgeClass(status) {
  const map = {
    pending: 'badge-pending',
    processing: 'badge-processing',
    completed: 'badge-completed',
    error: 'badge-error',
    export_failed: 'badge-export-failed',
  }
  return map[status] || ''
}

/** Human-readable source type label. */
function sourceLabel(sourceType) {
  const map = {
    esp32cam: 'ESP32-CAM',
    web_camera: 'Smartphone',
    file_upload: 'File Upload',
  }
  return map[sourceType] || sourceType || 'Unknown'
}

/** All possible status values for filtering. */
const STATUS_OPTIONS = [
  { value: 'pending', label: 'Pending' },
  { value: 'processing', label: 'Processing' },
  { value: 'completed', label: 'Completed' },
  { value: 'error', label: 'Error' },
  { value: 'export_failed', label: 'Export Failed' },
]

const SORT_OPTIONS = [
  { value: 'created_at', label: 'Date' },
  { value: 'status', label: 'Status' },
  { value: 'page_count', label: 'Pages' },
  { value: 'file_size', label: 'Size' },
]

const PAGE_LIMIT = 25

/* ==========================================================================
   History Page
   ========================================================================== */

export default function History() {
  const ws = useContext(WebSocketContext)
  const navigate = useNavigate()
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  /* ------------------------------------------------------------------
     State
     ------------------------------------------------------------------ */

  // Scan list + pagination
  const [scans, setScans] = useState([])
  const [cursor, setCursor] = useState(null)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)

  // Inline stats from API
  const [inlineStats, setInlineStats] = useState({
    total_scans: 0,
    total_pages: 0,
    total_size: 0,
  })

  // Search
  const [searchInput, setSearchInput] = useState(searchParams.get('search') || '')
  const [searchQuery, setSearchQuery] = useState(searchParams.get('search') || '')

  // Filters
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filterStatus, setFilterStatus] = useState(() => {
    const s = searchParams.getAll('status')
    return s.length > 0 ? s : []
  })
  const [filterDeviceMac, setFilterDeviceMac] = useState(
    searchParams.get('device_mac') || '',
  )
  const [filterDateFrom, setFilterDateFrom] = useState(
    searchParams.get('date_from') || '',
  )
  const [filterDateTo, setFilterDateTo] = useState(
    searchParams.get('date_to') || '',
  )
  const [filterPageMin, setFilterPageMin] = useState(
    searchParams.get('page_min') || '',
  )
  const [filterPageMax, setFilterPageMax] = useState(
    searchParams.get('page_max') || '',
  )

  // Sort
  const [sortField, setSortField] = useState(
    searchParams.get('sort') || 'created_at',
  )
  const [sortOrder, setSortOrder] = useState(
    searchParams.get('order') || 'desc',
  )

  // Devices list for filter dropdown
  const [devices, setDevices] = useState([])

  // Sentinel ref for infinite scroll
  const sentinelRef = useRef(null)

  // Bulk selection (T094)
  const [selected, setSelected] = useState(new Set())
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false)
  const [bulkActionLoading, setBulkActionLoading] = useState(false)

  // Export dropdown (T095)
  const [exportDropdownOpen, setExportDropdownOpen] = useState(false)
  const exportDropdownRef = useRef(null)

  /* ------------------------------------------------------------------
     Build query params object
     ------------------------------------------------------------------ */

  const buildQueryParams = useCallback(
    (cursorOverride) => {
      const params = new URLSearchParams()
      params.set('limit', String(PAGE_LIMIT))
      if (cursorOverride) params.set('cursor', cursorOverride)
      if (searchQuery) params.set('search', searchQuery)
      filterStatus.forEach((s) => params.append('status', s))
      if (filterDeviceMac) params.set('device_mac', filterDeviceMac)
      if (filterDateFrom) params.set('date_from', filterDateFrom)
      if (filterDateTo) params.set('date_to', filterDateTo)
      if (filterPageMin) params.set('page_min', filterPageMin)
      if (filterPageMax) params.set('page_max', filterPageMax)
      params.set('sort', sortField)
      params.set('order', sortOrder)
      return params.toString()
    },
    [
      searchQuery,
      filterStatus,
      filterDeviceMac,
      filterDateFrom,
      filterDateTo,
      filterPageMin,
      filterPageMax,
      sortField,
      sortOrder,
    ],
  )

  /* ------------------------------------------------------------------
     Fetch scans (initial or next page)
     ------------------------------------------------------------------ */

  const fetchScans = useCallback(
    async (nextCursor, append = false) => {
      if (append) {
        setLoadingMore(true)
      } else {
        setLoading(true)
      }

      try {
        const qs = buildQueryParams(nextCursor)
        const res = await fetch(`/api/scans?${qs}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()

        const items = data.items ?? data.scans ?? []
        const newCursor = data.cursor ?? null

        if (append) {
          setScans((prev) => [...prev, ...items])
        } else {
          setScans(items)
        }

        setCursor(newCursor)
        setHasMore(!!newCursor && items.length >= PAGE_LIMIT)

        // Update inline stats if provided
        if (data.stats) {
          setInlineStats({
            total_scans: data.stats.total_scans ?? 0,
            total_pages: data.stats.total_pages ?? 0,
            total_size: data.stats.total_size ?? 0,
          })
        }
      } catch (err) {
        toast.error('Failed to load scan history', { title: 'History Error' })
      } finally {
        setLoading(false)
        setLoadingMore(false)
      }
    },
    [buildQueryParams],
  )

  /* ------------------------------------------------------------------
     Initial fetch + refetch when filters/sort/search change
     ------------------------------------------------------------------ */

  useEffect(() => {
    setCursor(null)
    setHasMore(true)
    fetchScans(null, false)
  }, [fetchScans])

  /* ------------------------------------------------------------------
     Fetch devices list for filter dropdown
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
        // Non-critical; filter dropdown stays empty
      }
    }

    loadDevices()
    return () => {
      cancelled = true
    }
  }, [])

  /* ------------------------------------------------------------------
     Infinite scroll with IntersectionObserver
     ------------------------------------------------------------------ */

  useEffect(() => {
    if (!sentinelRef.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry.isIntersecting && hasMore && !loadingMore && !loading && cursor) {
          fetchScans(cursor, true)
        }
      },
      { rootMargin: '200px' },
    )

    observer.observe(sentinelRef.current)

    return () => observer.disconnect()
  }, [hasMore, loadingMore, loading, cursor, fetchScans])

  /* ------------------------------------------------------------------
     Sync filters into URL search params
     ------------------------------------------------------------------ */

  useEffect(() => {
    const params = new URLSearchParams()
    if (searchQuery) params.set('search', searchQuery)
    filterStatus.forEach((s) => params.append('status', s))
    if (filterDeviceMac) params.set('device_mac', filterDeviceMac)
    if (filterDateFrom) params.set('date_from', filterDateFrom)
    if (filterDateTo) params.set('date_to', filterDateTo)
    if (filterPageMin) params.set('page_min', filterPageMin)
    if (filterPageMax) params.set('page_max', filterPageMax)
    if (sortField !== 'created_at') params.set('sort', sortField)
    if (sortOrder !== 'desc') params.set('order', sortOrder)
    setSearchParams(params, { replace: true })
  }, [
    searchQuery,
    filterStatus,
    filterDeviceMac,
    filterDateFrom,
    filterDateTo,
    filterPageMin,
    filterPageMax,
    sortField,
    sortOrder,
    setSearchParams,
  ])

  /* ------------------------------------------------------------------
     WebSocket subscriptions
     ------------------------------------------------------------------ */

  const handleBatchCreated = useCallback((data) => {
    setScans((prev) => [data, ...prev])
    setInlineStats((prev) => ({
      ...prev,
      total_scans: prev.total_scans + 1,
      total_pages: prev.total_pages + (data.page_count ?? 0),
      total_size: prev.total_size + (data.file_size ?? 0),
    }))
  }, [])

  const handleProcessingComplete = useCallback((data) => {
    setScans((prev) =>
      prev.map((s) =>
        s.id === data.batch_id
          ? { ...s, status: 'completed', page_count: data.page_count ?? s.page_count }
          : s,
      ),
    )
  }, [])

  const handleExportComplete = useCallback((data) => {
    setScans((prev) =>
      prev.map((s) =>
        s.id === data.batch_id
          ? { ...s, export_info: { ...(s.export_info || {}), ...data.results } }
          : s,
      ),
    )
  }, [])

  useEffect(() => {
    if (!ws?.subscribe) return

    const unsubs = [
      ws.subscribe('batch_created', handleBatchCreated),
      ws.subscribe('processing_complete', handleProcessingComplete),
      ws.subscribe('export_complete', handleExportComplete),
      ws.subscribe('export_error', handleExportComplete),
    ]

    return () => unsubs.forEach((unsub) => unsub())
  }, [ws, handleBatchCreated, handleProcessingComplete, handleExportComplete])

  /* ------------------------------------------------------------------
     Event handlers
     ------------------------------------------------------------------ */

  /** Debounced search: commit on Enter or blur. */
  const commitSearch = useCallback(() => {
    setSearchQuery(searchInput.trim())
  }, [searchInput])

  const handleSearchKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter') {
        commitSearch()
      }
    },
    [commitSearch],
  )

  const handleStatusToggle = useCallback((value) => {
    setFilterStatus((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
    )
  }, [])

  const handleClearFilters = useCallback(() => {
    setFilterStatus([])
    setFilterDeviceMac('')
    setFilterDateFrom('')
    setFilterDateTo('')
    setFilterPageMin('')
    setFilterPageMax('')
  }, [])

  const toggleSortOrder = useCallback(() => {
    setSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'))
  }, [])

  /* ------------------------------------------------------------------
     Bulk selection handlers (T094)
     ------------------------------------------------------------------ */

  const toggleSelectItem = useCallback((id, e) => {
    e.stopPropagation()
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }, [])

  const toggleSelectAll = useCallback(() => {
    setSelected((prev) => {
      const visibleIds = scans.map((s) => s.id)
      const allSelected = visibleIds.length > 0 && visibleIds.every((id) => prev.has(id))
      if (allSelected) {
        return new Set()
      } else {
        return new Set(visibleIds)
      }
    })
  }, [scans])

  // Clear selection when scans change (new fetch / filter change)
  useEffect(() => {
    setSelected(new Set())
  }, [searchQuery, filterStatus, filterDeviceMac, filterDateFrom, filterDateTo, filterPageMin, filterPageMax, sortField, sortOrder])

  const handleBulkAction = useCallback(
    async (action) => {
      if (selected.size === 0) return
      setBulkActionLoading(true)
      try {
        const res = await fetch('/api/scans/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action, ids: [...selected] }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        if (action === 'delete') {
          setScans((prev) => prev.filter((s) => !selected.has(s.id)))
          setSelected(new Set())
        } else if (action === 'reprocess') {
          setScans((prev) =>
            prev.map((s) => (selected.has(s.id) ? { ...s, status: 'pending' } : s)),
          )
          setSelected(new Set())
        } else if (action === 'export') {
          // The API may return a download URL or blob
          const data = await res.clone().json().catch(() => null)
          if (data?.url) {
            window.open(data.url, '_blank')
          }
          setSelected(new Set())
        }
      } catch (err) {
        toast.error('Bulk action failed. Please try again.', { title: 'Action Error' })
      } finally {
        setBulkActionLoading(false)
        setConfirmBulkDelete(false)
      }
    },
    [selected, toast],
  )

  /* ------------------------------------------------------------------
     Export handlers (T095)
     ------------------------------------------------------------------ */

  // Close export dropdown on outside click
  useEffect(() => {
    if (!exportDropdownOpen) return
    const handleClick = (e) => {
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(e.target)) {
        setExportDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [exportDropdownOpen])

  const handleExportCSV = useCallback(() => {
    const qs = buildQueryParams()
    window.open(`/api/scans?format=csv&${qs}`, '_blank')
    setExportDropdownOpen(false)
  }, [buildQueryParams])

  const handleExportJSON = useCallback(async () => {
    setExportDropdownOpen(false)
    try {
      const qs = buildQueryParams()
      const res = await fetch(`/api/scans?format=json&limit=10000&${qs}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const items = data.items ?? data.scans ?? []
      const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `scans-export-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error('Failed to export scan data', { title: 'Export Error' })
    }
  }, [buildQueryParams, toast])

  /* ------------------------------------------------------------------
     Derived: are all visible selected?
     ------------------------------------------------------------------ */

  const allVisibleSelected = useMemo(() => {
    return scans.length > 0 && scans.every((s) => selected.has(s.id))
  }, [scans, selected])

  /* ------------------------------------------------------------------
     Count of active filters (for badge)
     ------------------------------------------------------------------ */

  const activeFilterCount = useMemo(() => {
    let count = 0
    if (filterStatus.length > 0) count++
    if (filterDeviceMac) count++
    if (filterDateFrom || filterDateTo) count++
    if (filterPageMin || filterPageMax) count++
    return count
  }, [filterStatus, filterDeviceMac, filterDateFrom, filterDateTo, filterPageMin, filterPageMax])

  /* ------------------------------------------------------------------
     Render
     ------------------------------------------------------------------ */

  return (
    <div className="main-content__inner">
      {/* Page header */}
      <div className="page-header">
        <h1 className="page-header__title">History</h1>
        <p className="page-header__description">
          Browse and search all scanned documents.
        </p>
      </div>

      {/* ---- Search bar ---- */}
      <div style={{ marginBottom: 'var(--space-4)' }}>
        <input
          type="text"
          className="form-input"
          placeholder="Search by ID, device name, or error text..."
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          onBlur={commitSearch}
        />
      </div>

      {/* ---- Inline stats bar ---- */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
          marginBottom: 'var(--space-4)',
          fontSize: 'var(--text-sm)',
          color: 'var(--color-text-secondary)',
          flexWrap: 'wrap',
        }}
      >
        <span>{inlineStats.total_scans} scans</span>
        <span>{inlineStats.total_pages} pages</span>
        <span>{formatBytes(inlineStats.total_size)}</span>
      </div>

      {/* ---- Filter + Sort controls ---- */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-4)',
          flexWrap: 'wrap',
        }}
      >
        {/* Select All toggle (T094) */}
        {scans.length > 0 && !loading && (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-2)',
              fontSize: 'var(--text-sm)',
              cursor: 'pointer',
              userSelect: 'none',
            }}
          >
            <input
              type="checkbox"
              checked={allVisibleSelected}
              onChange={toggleSelectAll}
              style={{ width: 16, height: 16, cursor: 'pointer' }}
            />
            Select all
          </label>
        )}

        {/* Filter toggle */}
        <button
          className="btn btn-secondary btn--sm"
          onClick={() => setFiltersOpen((prev) => !prev)}
        >
          Filters
          {activeFilterCount > 0 && (
            <span className="badge badge-processing" style={{ marginLeft: 'var(--space-1)' }}>
              {activeFilterCount}
            </span>
          )}
        </button>

        {/* Sort field */}
        <select
          className="form-select"
          style={{ width: 'auto', minHeight: '36px', fontSize: 'var(--text-xs)' }}
          value={sortField}
          onChange={(e) => setSortField(e.target.value)}
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              Sort: {opt.label}
            </option>
          ))}
        </select>

        {/* Sort order toggle */}
        <button className="btn btn-secondary btn--sm" onClick={toggleSortOrder}>
          {sortOrder === 'asc' ? '\u2191 Asc' : '\u2193 Desc'}
        </button>

        {/* Export dropdown (T095) */}
        <div ref={exportDropdownRef} style={{ position: 'relative', marginLeft: 'auto' }}>
          <button
            className="btn btn-secondary btn--sm"
            onClick={() => setExportDropdownOpen((prev) => !prev)}
          >
            Export
          </button>
          {exportDropdownOpen && (
            <div
              style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 'var(--space-1)',
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-lg, 0 4px 12px rgba(0,0,0,0.15))',
                zIndex: 50,
                minWidth: 160,
                overflow: 'hidden',
              }}
            >
              <button
                style={{
                  display: 'block',
                  width: '100%',
                  padding: 'var(--space-2) var(--space-3)',
                  background: 'none',
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--color-text-primary)',
                }}
                onClick={handleExportCSV}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-surface-hover, var(--color-bg-secondary, #f3f4f6))')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              >
                Export CSV
              </button>
              <button
                style={{
                  display: 'block',
                  width: '100%',
                  padding: 'var(--space-2) var(--space-3)',
                  background: 'none',
                  border: 'none',
                  textAlign: 'left',
                  cursor: 'pointer',
                  fontSize: 'var(--text-sm)',
                  color: 'var(--color-text-primary)',
                }}
                onClick={handleExportJSON}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-surface-hover, var(--color-bg-secondary, #f3f4f6))')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
              >
                Export JSON
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ---- Filter panel ---- */}
      {filtersOpen && (
        <div
          className="card"
          style={{
            marginBottom: 'var(--space-4)',
            display: 'grid',
            gap: 'var(--space-4)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          }}
        >
          {/* Status multi-select */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Status</label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              {STATUS_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-2)',
                    fontSize: 'var(--text-sm)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={filterStatus.includes(opt.value)}
                    onChange={() => handleStatusToggle(opt.value)}
                  />
                  <span className={`badge ${statusBadgeClass(opt.value)}`}>
                    {opt.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Device dropdown */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Device</label>
            <select
              className="form-select"
              value={filterDeviceMac}
              onChange={(e) => setFilterDeviceMac(e.target.value)}
            >
              <option value="">All devices</option>
              {devices.map((d) => (
                <option key={d.mac} value={d.mac}>
                  {d.name || d.mac}
                </option>
              ))}
            </select>
          </div>

          {/* Date range */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Date Range</label>
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <input
                type="date"
                className="form-input"
                value={filterDateFrom}
                onChange={(e) => setFilterDateFrom(e.target.value)}
                style={{ flex: 1 }}
              />
              <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>to</span>
              <input
                type="date"
                className="form-input"
                value={filterDateTo}
                onChange={(e) => setFilterDateTo(e.target.value)}
                style={{ flex: 1 }}
              />
            </div>
          </div>

          {/* Page count range */}
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Page Count</label>
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
              <input
                type="number"
                className="form-input"
                placeholder="Min"
                min="0"
                value={filterPageMin}
                onChange={(e) => setFilterPageMin(e.target.value)}
                style={{ flex: 1 }}
              />
              <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-xs)' }}>to</span>
              <input
                type="number"
                className="form-input"
                placeholder="Max"
                min="0"
                value={filterPageMax}
                onChange={(e) => setFilterPageMax(e.target.value)}
                style={{ flex: 1 }}
              />
            </div>
          </div>

          {/* Apply + Clear buttons */}
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-3)',
              alignItems: 'flex-end',
              gridColumn: '1 / -1',
            }}
          >
            <button
              className="btn btn-primary btn--sm"
              onClick={() => setFiltersOpen(false)}
            >
              Apply
            </button>
            <button
              className="btn btn-secondary btn--sm"
              onClick={handleClearFilters}
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* ---- Scan items list ---- */}
      {loading ? (
        <Spinner fullPage label="Loading scans" />
      ) : scans.length === 0 ? (
        <EmptyState
          title="No scans found"
          description={
            searchQuery || activeFilterCount > 0
              ? 'Try adjusting your search or filters.'
              : 'Start a new scan to see your history here.'
          }
          action={
            <Link to="/scanner" className="btn btn-primary">
              Start Scanning
            </Link>
          }
        />
      ) : (
        <div className="list-stack">
          {scans.map((scan) => (
            <div
              key={scan.id}
              className="scan-item"
              style={selected.has(scan.id) ? { outline: '2px solid var(--color-primary, #3b82f6)', outlineOffset: -2 } : undefined}
              onClick={() => navigate(`/history/${scan.id}`)}
              role="link"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  navigate(`/history/${scan.id}`)
                }
              }}
            >
              {/* Selection checkbox (T094) */}
              <div
                style={{ display: 'flex', alignItems: 'center', paddingRight: 'var(--space-2)' }}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={selected.has(scan.id)}
                  onChange={(e) => toggleSelectItem(scan.id, e)}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                  aria-label={`Select scan ${scan.id}`}
                />
              </div>

              {/* Preview / thumbnail */}
              <div className="scan-item__preview">
                <ScanThumbnail
                  batchId={scan.id}
                  fallback={
                    scan.source_type === 'esp32cam'
                      ? '\uD83D\uDCF7'
                      : scan.source_type === 'web_camera'
                        ? '\uD83D\uDCF1'
                        : '\uD83D\uDCC1'
                  }
                />
              </div>

              {/* Body */}
              <div className="scan-item__body">
                <div className="scan-item__title">
                  {scan.id
                    ? scan.id.length > 12
                      ? scan.id.slice(0, 12) + '...'
                      : scan.id
                    : 'Untitled'}
                </div>
                <div className="scan-item__meta">
                  <span>{sourceLabel(scan.source_type)}</span>
                  {(scan.device_name || scan.device_info) && <span>{scan.device_name || scan.device_info}</span>}
                  <span>{scan.page_count ?? 0} pg</span>
                  {scan.file_size != null && <span>{formatBytes(scan.file_size)}</span>}
                  <span>{timeAgo(scan.created_at)}</span>
                  <StorageBadges exportInfo={scan.export_info} />
                </div>
              </div>

              {/* Status badge (right side) */}
              <div className="scan-item__status">
                <span className={`badge ${statusBadgeClass(scan.status)}`}>
                  {scan.status}
                </span>
              </div>
            </div>
          ))}

          {/* Infinite scroll sentinel */}
          <div ref={sentinelRef} style={{ height: 1 }} />

          {loadingMore && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: 'var(--space-4)' }}>
              <Spinner size="sm" label="Loading more scans" />
            </div>
          )}

          {!hasMore && scans.length > 0 && (
            <div
              style={{
                textAlign: 'center',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-muted)',
                padding: 'var(--space-4)',
              }}
            >
              All scans loaded.
            </div>
          )}
        </div>
      )}

      {/* ---- Floating bulk action bar (T094) ---- */}
      {selected.size > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: 'var(--space-4)',
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-3)',
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg, var(--radius-md))',
            boxShadow: 'var(--shadow-xl, 0 8px 24px rgba(0,0,0,0.2))',
            zIndex: 100,
            fontSize: 'var(--text-sm)',
          }}
        >
          <span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
            {selected.size} selected
          </span>

          <button
            className="btn btn-danger btn--sm"
            disabled={bulkActionLoading}
            onClick={() => setConfirmBulkDelete(true)}
          >
            Delete
          </button>

          <button
            className="btn btn-secondary btn--sm"
            disabled={bulkActionLoading}
            onClick={() => handleBulkAction('reprocess')}
          >
            Reprocess
          </button>

          <button
            className="btn btn-secondary btn--sm"
            disabled={bulkActionLoading}
            onClick={() => handleBulkAction('export')}
          >
            Export
          </button>

          <button
            className="btn btn-secondary btn--sm"
            onClick={() => setSelected(new Set())}
            style={{ marginLeft: 'var(--space-2)' }}
          >
            Clear
          </button>
        </div>
      )}

      {/* ---- Confirm bulk delete dialog (T094) ---- */}
      <ConfirmDialog
        open={confirmBulkDelete}
        title="Delete selected scans"
        message={`Are you sure you want to delete ${selected.size} selected scan(s)? This action cannot be undone.`}
        confirmText="Delete"
        variant="danger"
        onConfirm={() => handleBulkAction('delete')}
        onCancel={() => setConfirmBulkDelete(false)}
      />
    </div>
  )
}
