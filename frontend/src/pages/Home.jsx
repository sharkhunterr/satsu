import React, { useState, useEffect, useCallback, useContext } from 'react'
import { Link } from 'react-router-dom'

import { WebSocketContext } from '../App'
import { useScanSession, ACCEPTED_EXTENSIONS } from '../hooks/useScanSession'
import EmptyState from '../components/shared/EmptyState'
import Spinner from '../components/shared/Spinner'
import {
  IconDevices, IconPages, IconStorage, IconCamera, IconUpload,
  IconGrid, IconFlash, IconFlashOff, IconSwitchCamera, IconCloudUpload,
} from '../components/shared/Icons'

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

function sourceLabel(sourceType) {
  const map = {
    esp32cam: 'ESP32-CAM',
    web_camera: 'Smartphone',
    file_upload: 'File Upload',
  }
  return map[sourceType] || sourceType || 'Unknown'
}

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 1024 : false
  )
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const handler = (e) => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return isDesktop
}

/* ==========================================================================
   Home Page
   ========================================================================== */

export default function Home() {
  const ws = useContext(WebSocketContext)
  const scan = useScanSession()
  const isDesktop = useIsDesktop()

  // ---- Stats ----
  const [loading, setLoading] = useState(true)
  const [devicesOnline, setDevicesOnline] = useState(0)
  const [totalPages, setTotalPages] = useState(0)
  const [storageUsed, setStorageUsed] = useState(0)
  const [recentBatches, setRecentBatches] = useState([])

  /* ------------------------------------------------------------------
     Initial data fetch
     ------------------------------------------------------------------ */

  useEffect(() => {
    let cancelled = false
    async function fetchStats() {
      try {
        const res = await fetch('/api/stats')
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        setDevicesOnline(data.devices_online ?? 0)
        setTotalPages(data.total_pages ?? 0)
        setStorageUsed(data.total_size_bytes ?? 0)
        setRecentBatches(data.recent_batches ?? [])
      } catch {
        // Non-critical
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchStats()
    return () => { cancelled = true }
  }, [])

  /* ------------------------------------------------------------------
     WebSocket subscriptions for dashboard data
     ------------------------------------------------------------------ */

  const handleBatchCreated = useCallback((data) => {
    setRecentBatches((prev) => [data, ...prev].slice(0, 5))
    setTotalPages((prev) => prev + (data.page_count ?? 0))
  }, [])

  const handleProcessingComplete = useCallback((data) => {
    setRecentBatches((prev) =>
      prev.map((b) =>
        b.id === data.batch_id
          ? { ...b, status: 'completed', page_count: data.page_count ?? b.page_count }
          : b,
      ),
    )
  }, [])

  const handleProcessingError = useCallback((data) => {
    setRecentBatches((prev) =>
      prev.map((b) =>
        b.id === data.batch_id ? { ...b, status: 'error' } : b,
      ),
    )
  }, [])

  const handleDeviceOnline = useCallback(() => {
    setDevicesOnline((prev) => prev + 1)
  }, [])

  const handleDeviceOffline = useCallback(() => {
    setDevicesOnline((prev) => Math.max(0, prev - 1))
  }, [])

  const handleExportComplete = useCallback((data) => {
    setRecentBatches((prev) =>
      prev.map((b) =>
        b.id === data.batch_id
          ? { ...b, export_info: { ...(b.export_info || {}), ...data.results } }
          : b,
      ),
    )
  }, [])

  useEffect(() => {
    if (!ws?.subscribe) return
    const unsubs = [
      ws.subscribe('batch_created', handleBatchCreated),
      ws.subscribe('processing_complete', handleProcessingComplete),
      ws.subscribe('processing_error', handleProcessingError),
      ws.subscribe('device_online', handleDeviceOnline),
      ws.subscribe('device_offline', handleDeviceOffline),
      ws.subscribe('export_complete', handleExportComplete),
      ws.subscribe('export_error', handleExportComplete),
    ]
    return () => unsubs.forEach((fn) => fn())
  }, [ws, handleBatchCreated, handleProcessingComplete, handleProcessingError, handleDeviceOnline, handleDeviceOffline, handleExportComplete])

  /* ------------------------------------------------------------------
     Sending overlay
     ------------------------------------------------------------------ */

  const sendingOverlay = scan.isSending && (
    <div className="home-sending-overlay">
      <div className="home-sending-card">
        {scan.processingState ? (
          <>
            <div className="home-sending-title">Processing...</div>
            <div className="home-sending-step">{scan.processingState.step}</div>
            <div className="home-sending-progress">
              Page {scan.processingState.pageIndex} / {scan.processingState.pageCount}
            </div>
            {scan.processingState.totalSteps > 0 && (
              <div className="home-progress-bar">
                <div
                  className="home-progress-bar__inner"
                  style={{ width: `${((scan.processingState.stepIndex + 1) / scan.processingState.totalSteps) * 100}%` }}
                />
              </div>
            )}
          </>
        ) : (
          <>
            <div className="home-sending-title">Uploading...</div>
            <div className="home-progress-bar">
              <div
                className="home-progress-bar__inner"
                style={{ width: `${scan.uploadProgress}%` }}
              />
            </div>
            <div className="home-sending-progress">{scan.uploadProgress}%</div>
          </>
        )}
      </div>
    </div>
  )

  /* ------------------------------------------------------------------
     Render
     ------------------------------------------------------------------ */

  return (
    <div className="main-content__inner">
      {sendingOverlay}

      {/* ---- Stat badges ---- */}
      <div className="home-stats">
        <div className="home-stat-badge">
          <span className="home-stat-badge__icon"><IconDevices /></span>
          <span className="home-stat-badge__value">{loading ? '-' : devicesOnline}</span>
          <span className="home-stat-badge__label">Devices</span>
        </div>
        <div className="home-stat-badge">
          <span className="home-stat-badge__icon"><IconPages /></span>
          <span className="home-stat-badge__value">{loading ? '-' : totalPages}</span>
          <span className="home-stat-badge__label">Pages</span>
        </div>
        <div className="home-stat-badge">
          <span className="home-stat-badge__icon"><IconStorage /></span>
          <span className="home-stat-badge__value">{loading ? '-' : formatBytes(storageUsed)}</span>
          <span className="home-stat-badge__label">Storage</span>
        </div>
      </div>

      {/* ---- Action buttons ---- */}
      <div className="home-actions">
        {/* Take Photo / Photo button */}
        {isDesktop ? (
          /* Desktop: toggle camera viewfinder */
          <button
            className={`home-action-btn${scan.mode === 'camera' ? ' home-action-btn--active' : ''}`}
            onClick={() => scan.handleModeSwitch('camera')}
            disabled={scan.isSending || !scan.cameraSupported}
          >
            <span className="home-action-btn__icon"><IconCamera /></span>
            <span className="home-action-btn__label">Photo</span>
          </button>
        ) : (
          /* Mobile: directly open native camera */
          <button
            className="home-action-btn"
            onClick={() => scan.nativeCameraInputRef.current?.click()}
            disabled={scan.isSending}
          >
            <span className="home-action-btn__icon"><IconCamera /></span>
            <span className="home-action-btn__label">Take Photo</span>
            <input
              ref={scan.nativeCameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={scan.handleFileSelect}
              className="sr-only"
              aria-hidden="true"
              tabIndex={-1}
            />
          </button>
        )}

        {/* Upload button: directly opens file picker on all devices */}
        <button
          className="home-action-btn"
          onClick={() => scan.fileInputRef.current?.click()}
          disabled={scan.isSending}
        >
          <span className="home-action-btn__icon"><IconUpload /></span>
          <span className="home-action-btn__label">Upload</span>
          <input
            ref={scan.fileInputRef}
            type="file"
            multiple
            accept={ACCEPTED_EXTENSIONS}
            onChange={scan.handleFileSelect}
            className="sr-only"
            aria-hidden="true"
            tabIndex={-1}
          />
        </button>
      </div>

      {/* ---- Desktop: drag & drop zone (always visible) ---- */}
      {isDesktop && (
        <div
          className={`home-dropzone${scan.isDragOver ? ' home-dropzone--active' : ''}`}
          onDrop={scan.handleDrop}
          onDragOver={scan.handleDragOver}
          onDragLeave={scan.handleDragLeave}
          onClick={() => scan.fileInputRef.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') scan.fileInputRef.current?.click() }}
          aria-label="Drop files here or click to select"
        >
          <span className="home-dropzone__icon"><IconCloudUpload /></span>
          <div className="home-dropzone__title">Drop files here</div>
          <div className="home-dropzone__hint">or click to select images (JPEG, PNG, WebP)</div>
        </div>
      )}

      {/* ---- Desktop camera viewfinder ---- */}
      {scan.mode === 'camera' && isDesktop && (
        <CameraCapture scan={scan} />
      )}

      {/* ---- Page pile ---- */}
      {scan.pages.length > 0 && (
        <PagePile scan={scan} />
      )}

      {/* ---- Recent activity ---- */}
      <section className="home-activity">
        <h2 className="home-section-title">Recent Activity</h2>
        {loading ? (
          <Spinner label="Loading..." />
        ) : recentBatches.length === 0 ? (
          <EmptyState
            title="No scans yet"
            description="Tap Take Photo or Upload above to start scanning."
          />
        ) : (
          <div className="list-stack">
            {recentBatches.map((batch) => (
              <Link
                key={batch.id}
                to={`/history/${batch.id}`}
                className="scan-item"
              >
                <div className="scan-item__preview">
                  <ScanThumbnail
                    batchId={batch.id}
                    fallback={sourceLabel(batch.source_type).charAt(0)}
                  />
                </div>
                <div className="scan-item__body">
                  <div className="scan-item__title">
                    {batch.id
                      ? batch.id.length > 12
                        ? batch.id.slice(0, 12) + '...'
                        : batch.id
                      : 'Untitled'}
                  </div>
                  <div className="scan-item__meta">
                    <span className={`badge ${statusBadgeClass(batch.status)}`}>
                      {batch.status}
                    </span>
                    <span>{sourceLabel(batch.source_type)}</span>
                    <span>{batch.page_count ?? 0} pages</span>
                    <span>{timeAgo(batch.created_at)}</span>
                    <StorageBadges exportInfo={batch.export_info} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/* ==========================================================================
   Camera Capture Sub-Component (desktop only)
   ========================================================================== */

function CameraCapture({ scan }) {
  const { camera, showGrid, setShowGrid, flashAnimation, handleStartCamera, handleCapture, isSending } = scan

  if (camera.error === 'permission_denied') {
    return (
      <div className="home-capture">
        <div className="empty-state">
          <div className="empty-state__icon" aria-hidden="true"><IconCamera style={{ fontSize: 48 }} /></div>
          <div className="empty-state__title">Camera Access Denied</div>
          <div className="empty-state__description">
            Please allow camera access in your browser settings and try again.
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={handleStartCamera}>Retry</button>
            <button className="btn btn-secondary" onClick={() => scan.handleModeSwitch(null)}>Close</button>
          </div>
        </div>
      </div>
    )
  }

  if (camera.error === 'camera_error') {
    return (
      <div className="home-capture">
        <div className="empty-state">
          <div className="empty-state__icon" aria-hidden="true"><IconCamera style={{ fontSize: 48 }} /></div>
          <div className="empty-state__title">Camera Error</div>
          <div className="empty-state__description">
            Could not access the camera. It may be in use by another application.
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={handleStartCamera}>Retry</button>
            <button className="btn btn-secondary" onClick={() => scan.handleModeSwitch(null)}>Close</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="home-capture">
      {/* Video preview */}
      <div className="home-camera-wrapper">
        <video
          ref={camera.videoRef}
          autoPlay
          playsInline
          muted
          className="home-camera-video"
        />

        {/* Grid overlay */}
        {showGrid && camera.isActive && (
          <div className="home-camera-grid">
            <div className="home-camera-grid__line home-camera-grid__line--h1" />
            <div className="home-camera-grid__line home-camera-grid__line--h2" />
            <div className="home-camera-grid__line home-camera-grid__line--v1" />
            <div className="home-camera-grid__line home-camera-grid__line--v2" />
          </div>
        )}

        {/* Flash animation */}
        {flashAnimation && <div className="home-camera-flash" />}

        {/* Camera not started overlay */}
        {!camera.isActive && !camera.error && (
          <div className="home-camera-start">
            <button className="btn btn-primary btn--lg" onClick={handleStartCamera}>
              Start Camera
            </button>
          </div>
        )}

        {/* Top controls */}
        {camera.isActive && (
          <div className="home-camera-top">
            <div className="home-camera-counter">
              {scan.pages.length} page{scan.pages.length !== 1 ? 's' : ''}
            </div>
            <div className="home-camera-top-right">
              <button
                className="btn btn-icon home-camera-ctrl"
                onClick={() => setShowGrid((g) => !g)}
                title={showGrid ? 'Hide grid' : 'Show grid'}
                aria-label={showGrid ? 'Hide alignment grid' : 'Show alignment grid'}
              >
                <IconGrid />
              </button>
              {camera.torchSupported && (
                <button
                  className="btn btn-icon home-camera-ctrl"
                  onClick={camera.toggleTorch}
                  title={camera.torchOn ? 'Turn off flash' : 'Turn on flash'}
                  aria-label={camera.torchOn ? 'Turn off flash' : 'Turn on flash'}
                >
                  {camera.torchOn ? <IconFlash /> : <IconFlashOff />}
                </button>
              )}
              {camera.hasMultipleCameras && (
                <button
                  className="btn btn-icon home-camera-ctrl"
                  onClick={camera.switchCamera}
                  title="Switch camera"
                  aria-label="Switch camera"
                >
                  <IconSwitchCamera />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom controls */}
      {camera.isActive && (
        <div className="home-camera-bottom">
          {scan.pages.length > 0 && (
            <button className="btn btn-secondary btn--sm" onClick={scan.clearPages} disabled={isSending}>
              Clear
            </button>
          )}
          <button
            className="home-capture-btn"
            onClick={handleCapture}
            disabled={isSending}
            aria-label="Capture page"
            title="Capture page"
          >
            <span className="home-capture-btn__inner" />
          </button>
          {scan.validPages.length > 0 && (
            <button
              className="btn btn--sm home-send-btn"
              onClick={scan.handleSend}
              disabled={isSending}
            >
              Send ({scan.validPages.length})
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/* ==========================================================================
   Page Pile Sub-Component
   ========================================================================== */

function PagePile({ scan }) {
  return (
    <div className="home-pile-section">
      {/* Profile selector + action buttons */}
      <div className="home-pile-toolbar">
        <div className="home-pile-profile">
          <label htmlFor="home-profile" className="home-pile-profile__label">Profile:</label>
          <select
            id="home-profile"
            className="form-select home-pile-profile__select"
            value={scan.selectedProfile}
            onChange={(e) => scan.setSelectedProfile(e.target.value)}
            disabled={scan.isSending}
          >
            {scan.profiles.length === 0 && <option value="default">Default</option>}
            {scan.profiles.map((p) => (
              <option key={p.id || p.name} value={p.id || p.name}>
                {p.name}{p.is_default ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="home-pile-actions">
          <button className="btn btn-secondary btn--sm" onClick={scan.clearPages} disabled={scan.isSending}>
            Clear
          </button>
          <button
            className="btn btn--sm home-send-btn"
            onClick={scan.handleSend}
            disabled={scan.isSending || scan.validPages.length === 0}
          >
            {scan.validPages.length === 0
              ? 'No Valid Pages'
              : `Send ${scan.validPages.length} Page${scan.validPages.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>

      {/* Swap hint */}
      {scan.swapSource !== null && (
        <div className="home-pile-swap-hint">
          Tap another thumbnail to swap with page {scan.swapSource + 1}, or tap same to cancel.
        </div>
      )}

      {/* Horizontal thumbnails */}
      <div ref={scan.pagePileRef} className="home-pile scrollable">
        {scan.pages.map((page, idx) => (
          <div
            key={page.id}
            className={`home-pile-thumb${page.error ? ' home-pile-thumb--error' : ''}${scan.swapSource === idx ? ' home-pile-thumb--selected' : ''}`}
            onClick={() => !page.error && scan.handleThumbnailClick(idx)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !page.error) scan.handleThumbnailClick(idx) }}
            aria-label={page.error ? `Page ${idx + 1} has an error` : `Page ${idx + 1}, click to reorder`}
          >
            <div className="home-pile-thumb__img">
              {page.url ? (
                <img src={page.url} alt={`Page ${idx + 1}`} />
              ) : (
                <span className="home-pile-thumb__err">!</span>
              )}
            </div>
            <div className="home-pile-thumb__index">{idx + 1}</div>
            <button
              className="home-pile-thumb__delete"
              onClick={(e) => { e.stopPropagation(); scan.removePage(page.id) }}
              aria-label={`Remove page ${idx + 1}`}
              title={`Remove page ${idx + 1}`}
            >
              &times;
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
