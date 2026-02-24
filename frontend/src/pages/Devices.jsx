import React, { useContext, useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'

import { WebSocketContext } from '../App'
import ConfirmDialog from '../components/shared/ConfirmDialog'
import Spinner from '../components/shared/Spinner'
import EmptyState from '../components/shared/EmptyState'
import FlashModal from '../components/devices/FlashModal'
import { IconFlash } from '../components/shared/Icons'

/* ==========================================================================
   Helpers
   ========================================================================== */

function timeAgo(dateStr) {
  if (!dateStr) return 'never'
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago'
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago'
  return Math.floor(seconds / 86400) + 'd ago'
}

/** Resolution options for the config modal. */
const RESOLUTION_OPTIONS = [
  { value: 'UXGA', label: 'UXGA (1600x1200)' },
  { value: 'SVGA', label: 'SVGA (800x600)' },
  { value: 'VGA', label: 'VGA (640x480)' },
  { value: 'CIF', label: 'CIF (400x296)' },
]

/* ==========================================================================
   Configure Modal
   ========================================================================== */

function ConfigureModal({ device, open, onClose, onSaved }) {
  const [resolution, setResolution] = useState(device?.resolution || 'SVGA')
  const [jpegQuality, setJpegQuality] = useState(device?.jpeg_quality ?? 80)
  const [flashEnabled, setFlashEnabled] = useState(device?.flash_enabled ?? false)
  const [flashDuration, setFlashDuration] = useState(device?.flash_duration ?? 200)
  const [autoSend, setAutoSend] = useState(device?.auto_send ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  // Reset fields when a different device is opened
  useEffect(() => {
    if (device && open) {
      setResolution(device.resolution || 'SVGA')
      setJpegQuality(device.jpeg_quality ?? 80)
      setFlashEnabled(device.flash_enabled ?? false)
      setFlashDuration(device.flash_duration ?? 200)
      setAutoSend(device.auto_send ?? true)
      setError(null)
    }
  }, [device, open])

  if (!open || !device) return null

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(device.mac)}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resolution,
          jpeg_quality: jpegQuality,
          flash_enabled: flashEnabled,
          flash_duration: flashDuration,
          auto_send: autoSend,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      onSaved?.({
        ...device,
        resolution,
        jpeg_quality: jpegQuality,
        flash_enabled: flashEnabled,
        flash_duration: flashDuration,
        auto_send: autoSend,
      })
      onClose()
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="dialog-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
      role="presentation"
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="config-dialog-title"
        style={{ maxWidth: 500 }}
      >
        <h2 id="config-dialog-title" className="dialog__title">
          Configure {device.name || device.mac}
        </h2>

        {error && (
          <div
            style={{
              padding: 'var(--space-2) var(--space-3)',
              marginBottom: 'var(--space-4)',
              borderRadius: 'var(--radius-sm)',
              backgroundColor: 'var(--color-error-light)',
              color: 'var(--color-error-text)',
              fontSize: 'var(--text-sm)',
            }}
          >
            {error}
          </div>
        )}

        {/* Resolution */}
        <div className="form-group">
          <label className="form-label">Resolution</label>
          <select
            className="form-select"
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
          >
            {RESOLUTION_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {/* JPEG Quality */}
        <div className="form-group">
          <label className="form-label">JPEG Quality: {jpegQuality}</label>
          <input
            type="range"
            min="1"
            max="100"
            value={jpegQuality}
            onChange={(e) => setJpegQuality(Number(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--color-primary)' }}
          />
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 'var(--text-xs)',
              color: 'var(--color-text-muted)',
            }}
          >
            <span>1 (low)</span>
            <span>100 (high)</span>
          </div>
        </div>

        {/* Flash toggle */}
        <div className="form-group">
          <label
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
              checked={flashEnabled}
              onChange={(e) => setFlashEnabled(e.target.checked)}
            />
            Flash enabled
          </label>
        </div>

        {/* Flash Duration */}
        {flashEnabled && (
          <div className="form-group">
            <label className="form-label">Flash Duration: {flashDuration}ms</label>
            <input
              type="range"
              min="0"
              max="5000"
              step="50"
              value={flashDuration}
              onChange={(e) => setFlashDuration(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--color-primary)' }}
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-muted)',
              }}
            >
              <span>0ms</span>
              <span>5000ms</span>
            </div>
          </div>
        )}

        {/* Auto-send toggle */}
        <div className="form-group" style={{ marginBottom: 'var(--space-5)' }}>
          <label
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
              checked={autoSend}
              onChange={(e) => setAutoSend(e.target.checked)}
            />
            Auto-send captures
          </label>
        </div>

        {/* Actions */}
        <div className="dialog__actions">
          <button className="btn btn-secondary" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
            type="button"
          >
            {saving ? 'Saving...' : 'Save Configuration'}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ==========================================================================
   Device Card
   ========================================================================== */

function DeviceCard({ device, onUpdate, onDelete }) {
  const [renaming, setRenaming] = useState(false)
  const [nameInput, setNameInput] = useState(device.name || '')
  const [renameSaving, setRenameSaving] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // Animate status transitions
  const [statusAnimating, setStatusAnimating] = useState(false)

  useEffect(() => {
    setStatusAnimating(true)
    const timer = setTimeout(() => setStatusAnimating(false), 600)
    return () => clearTimeout(timer)
  }, [device.is_online])

  /* -- Rename -- */

  const handleRenameSubmit = async () => {
    const trimmed = nameInput.trim()
    if (trimmed === (device.name || '')) {
      setRenaming(false)
      return
    }
    setRenameSaving(true)
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(device.mac)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      onUpdate({ ...device, name: trimmed })
      setRenaming(false)
    } catch {
      // Keep the edit open so user can retry
    } finally {
      setRenameSaving(false)
    }
  }

  const handleRenameKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleRenameSubmit()
    } else if (e.key === 'Escape') {
      setRenaming(false)
      setNameInput(device.name || '')
    }
  }

  /* -- Delete -- */

  const handleDeleteConfirm = async () => {
    try {
      const res = await fetch(`/api/devices/${encodeURIComponent(device.mac)}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      onDelete(device.mac)
    } catch {
      // Silently handle; user can retry
    } finally {
      setDeleteOpen(false)
    }
  }

  /* -- Config saved -- */

  const handleConfigSaved = (updatedDevice) => {
    onUpdate(updatedDevice)
  }

  /* -- Render -- */

  const isOnline = device.is_online ?? false
  const displayName = device.name || device.mac

  return (
    <>
      <div
        className="card"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
        }}
      >
        {/* Header: status dot + name */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
          }}
        >
          {/* Status indicator */}
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 'var(--radius-full)',
              backgroundColor: isOnline ? 'var(--color-success)' : 'var(--color-text-muted)',
              flexShrink: 0,
              transition: 'background-color var(--transition-normal)',
              boxShadow: statusAnimating && isOnline
                ? '0 0 8px var(--color-success)'
                : 'none',
            }}
            title={isOnline ? 'Online' : 'Offline'}
          />

          {/* Device name (or inline rename field) */}
          {renaming ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flex: 1 }}>
              <input
                className="form-input"
                style={{
                  minHeight: 32,
                  padding: 'var(--space-1) var(--space-2)',
                  fontSize: 'var(--text-sm)',
                  flex: 1,
                }}
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={handleRenameKeyDown}
                autoFocus
                disabled={renameSaving}
                placeholder="Device name"
              />
              <button
                className="btn btn-primary btn--sm"
                onClick={handleRenameSubmit}
                disabled={renameSaving}
                type="button"
                style={{ minHeight: 32 }}
              >
                {renameSaving ? '...' : 'OK'}
              </button>
              <button
                className="btn btn-secondary btn--sm"
                onClick={() => {
                  setRenaming(false)
                  setNameInput(device.name || '')
                }}
                type="button"
                style={{ minHeight: 32 }}
              >
                X
              </button>
            </div>
          ) : (
            <span
              style={{
                fontWeight: 'var(--font-weight-semibold)',
                fontSize: 'var(--text-sm)',
                color: 'var(--color-text)',
                flex: 1,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={displayName}
            >
              {displayName}
            </span>
          )}
        </div>

        {/* Device details */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-1)',
            fontSize: 'var(--text-xs)',
            color: 'var(--color-text-secondary)',
          }}
        >
          <div style={{ fontFamily: 'var(--font-mono)', color: 'var(--color-text-muted)' }}>
            MAC: {device.mac}
          </div>
          {device.ip && (
            <div>IP: {device.ip}</div>
          )}
          {device.firmware_version && (
            <div>Firmware: {device.firmware_version}</div>
          )}
          {device.resolution && (
            <div>Resolution: {device.resolution}</div>
          )}
          <div>
            Scans: {device.scan_count ?? 0}
          </div>
          <div className="device-card__last-seen" data-last-seen={device.last_seen}>
            Last seen: {timeAgo(device.last_seen)}
          </div>
        </div>

        {/* Actions */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'var(--space-2)',
            flexWrap: 'wrap',
            marginTop: 'auto',
          }}
        >
          <button
            className="btn btn-secondary btn--sm"
            onClick={() => {
              setNameInput(device.name || '')
              setRenaming(true)
            }}
            type="button"
          >
            Rename
          </button>
          <button
            className="btn btn-secondary btn--sm"
            onClick={() => setConfigOpen(true)}
            type="button"
          >
            Configure
          </button>
          <Link
            to={`/history?device_mac=${encodeURIComponent(device.mac)}`}
            className="btn btn-secondary btn--sm"
          >
            History
          </Link>
          <button
            className="btn btn-danger btn--sm"
            onClick={() => setDeleteOpen(true)}
            type="button"
            style={{ marginLeft: 'auto' }}
          >
            Delete
          </button>
        </div>
      </div>

      {/* Configure modal */}
      <ConfigureModal
        device={device}
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        onSaved={handleConfigSaved}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={deleteOpen}
        title="Delete Device"
        message={`Are you sure you want to remove "${displayName}" from the system? This will not delete scan history associated with this device.`}
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteOpen(false)}
      />
    </>
  )
}

/* ==========================================================================
   Devices Page
   ========================================================================== */

export default function Devices() {
  const ws = useContext(WebSocketContext)

  const [devices, setDevices] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [flashOpen, setFlashOpen] = useState(false)

  /* ------------------------------------------------------------------
     Fetch devices
     ------------------------------------------------------------------ */

  useEffect(() => {
    let cancelled = false

    async function fetchDevices() {
      try {
        const res = await fetch('/api/devices')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()

        if (cancelled) return

        setDevices(data.devices ?? data ?? [])
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchDevices()

    return () => {
      cancelled = true
    }
  }, [])

  /* ------------------------------------------------------------------
     Auto-update "last seen" every 30 seconds
     ------------------------------------------------------------------ */

  const [, setTick] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setTick((t) => t + 1)
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  /* ------------------------------------------------------------------
     WebSocket subscriptions
     ------------------------------------------------------------------ */

  const handleDeviceOnline = useCallback((data) => {
    setDevices((prev) => {
      const existing = prev.find((d) => d.mac === data.mac)
      if (existing) {
        return prev.map((d) =>
          d.mac === data.mac
            ? { ...d, ...data, is_online: true, last_seen: new Date().toISOString() }
            : d,
        )
      }
      // New device appeared
      return [...prev, { ...data, is_online: true, last_seen: new Date().toISOString() }]
    })
  }, [])

  const handleDeviceOffline = useCallback((data) => {
    setDevices((prev) =>
      prev.map((d) =>
        d.mac === data.mac
          ? { ...d, is_online: false, last_seen: new Date().toISOString() }
          : d,
      ),
    )
  }, [])

  useEffect(() => {
    if (!ws?.subscribe) return

    const unsubs = [
      ws.subscribe('device_online', handleDeviceOnline),
      ws.subscribe('device_offline', handleDeviceOffline),
    ]

    return () => unsubs.forEach((unsub) => unsub())
  }, [ws, handleDeviceOnline, handleDeviceOffline])

  /* ------------------------------------------------------------------
     Card callbacks
     ------------------------------------------------------------------ */

  const handleUpdate = useCallback((updatedDevice) => {
    setDevices((prev) =>
      prev.map((d) => (d.mac === updatedDevice.mac ? updatedDevice : d)),
    )
  }, [])

  const handleDelete = useCallback((mac) => {
    setDevices((prev) => prev.filter((d) => d.mac !== mac))
  }, [])

  /* ------------------------------------------------------------------
     Render
     ------------------------------------------------------------------ */

  if (loading) {
    return (
      <div className="main-content__inner">
        <Spinner fullPage label="Loading devices" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="main-content__inner">
        <EmptyState
          title="Failed to load devices"
          description={error}
          action={
            <button
              className="btn btn-primary"
              onClick={() => window.location.reload()}
            >
              Retry
            </button>
          }
        />
      </div>
    )
  }

  return (
    <div className="main-content__inner">
      {/* Page header */}
      <div className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          <h1 className="page-header__title" style={{ margin: 0 }}>Devices</h1>
          <button
            className="btn btn-primary btn--sm"
            onClick={() => setFlashOpen(true)}
            type="button"
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-1)' }}
          >
            <IconFlash style={{ fontSize: '1em' }} />
            Flash ESP32-CAM
          </button>
        </div>
        <p className="page-header__description">
          Manage your ESP32-CAM devices, configure settings, and monitor connection status.
        </p>
      </div>

      {/* Flash modal */}
      <FlashModal open={flashOpen} onClose={() => setFlashOpen(false)} />

      {devices.length === 0 ? (
        <EmptyState
          title="No devices registered"
          description="ESP32-CAM devices are automatically registered when they first connect to the server. Make sure your device is powered on and configured to connect to this server's address."
          action={
            <Link to="/" className="btn btn-secondary">
              Back to Dashboard
            </Link>
          }
        />
      ) : (
        <div
          style={{
            display: 'grid',
            gap: 'var(--space-4)',
            gridTemplateColumns: '1fr',
          }}
          className="devices-grid"
        >
          {/* Sort: online devices first, then by name/mac */}
          {[...devices]
            .sort((a, b) => {
              // Online first
              if (a.is_online && !b.is_online) return -1
              if (!a.is_online && b.is_online) return 1
              // Then alphabetically by name or mac
              const nameA = (a.name || a.mac).toLowerCase()
              const nameB = (b.name || b.mac).toLowerCase()
              return nameA.localeCompare(nameB)
            })
            .map((device) => (
              <DeviceCard
                key={device.mac}
                device={device}
                onUpdate={handleUpdate}
                onDelete={handleDelete}
              />
            ))}
        </div>
      )}

      {/* Responsive grid styles */}
      <style>{`
        .devices-grid {
          grid-template-columns: 1fr;
        }
        @media (min-width: 640px) {
          .devices-grid {
            grid-template-columns: repeat(2, 1fr);
          }
        }
        @media (min-width: 1024px) {
          .devices-grid {
            grid-template-columns: repeat(3, 1fr);
          }
        }
      `}</style>
    </div>
  )
}
