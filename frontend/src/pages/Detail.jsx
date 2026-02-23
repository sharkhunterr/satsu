import React, { useContext, useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { WebSocketContext } from '../App'
import ConfirmDialog from '../components/shared/ConfirmDialog'
import Spinner from '../components/shared/Spinner'

/* ==========================================================================
   Helpers
   ========================================================================== */

function formatBytes(bytes) {
  if (!bytes) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function formatDuration(ms) {
  if (ms == null) return '--'
  if (ms < 1000) return ms + 'ms'
  return (ms / 1000).toFixed(1) + 's'
}

function formatDate(dateStr) {
  if (!dateStr) return '--'
  const d = new Date(dateStr)
  return d.toLocaleString()
}

/** Map status to badge CSS class */
function statusBadgeClass(status) {
  const map = {
    pending: 'badge badge-pending',
    processing: 'badge badge-processing',
    completed: 'badge badge-completed',
    error: 'badge badge-error',
    export_failed: 'badge badge-export-failed',
  }
  return map[status] || 'badge'
}

/* ==========================================================================
   Styles (inline for Detail-specific layouts)
   ========================================================================== */

const styles = {
  /* ---------- Page wrapper ---------- */
  page: {
    maxWidth: 1200,
    margin: '0 auto',
    width: '100%',
  },

  /* ---------- Back link ---------- */
  backLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    color: 'var(--color-text-secondary)',
    textDecoration: 'none',
    fontSize: 'var(--text-sm)',
    fontWeight: 'var(--font-weight-medium)',
    marginBottom: 'var(--space-4)',
    cursor: 'pointer',
    border: 'none',
    background: 'none',
    padding: 0,
    transition: 'color var(--transition-fast)',
  },

  /* ---------- Metadata header ---------- */
  metaHeader: {
    background: 'var(--color-surface-raised)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: 'var(--space-4)',
    marginBottom: 'var(--space-4)',
  },
  metaTitleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    flexWrap: 'wrap',
    marginBottom: 'var(--space-3)',
  },
  metaTitle: {
    fontSize: 'var(--text-xl)',
    fontWeight: 'var(--font-weight-bold)',
    color: 'var(--color-text)',
  },
  metaGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: 'var(--space-3)',
  },
  metaItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  metaLabel: {
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-muted)',
    fontWeight: 'var(--font-weight-medium)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
  },
  metaValue: {
    fontSize: 'var(--text-sm)',
    color: 'var(--color-text)',
    fontWeight: 'var(--font-weight-medium)',
    fontFamily: 'var(--font-mono)',
  },

  /* ---------- Page navigator ---------- */
  pageNav: {
    display: 'flex',
    gap: 'var(--space-2)',
    overflowX: 'auto',
    WebkitOverflowScrolling: 'touch',
    paddingBottom: 'var(--space-2)',
    marginBottom: 'var(--space-4)',
  },
  pageTab: {
    minWidth: 48,
    minHeight: 48,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: '2px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--color-surface-raised)',
    color: 'var(--color-text-secondary)',
    fontWeight: 'var(--font-weight-semibold)',
    fontSize: 'var(--text-sm)',
    cursor: 'pointer',
    transition: 'border-color var(--transition-fast), color var(--transition-fast), background var(--transition-fast)',
    flexShrink: 0,
    padding: '0 var(--space-3)',
    userSelect: 'none',
  },
  pageTabActive: {
    borderColor: 'var(--color-primary)',
    color: 'var(--color-primary)',
    background: 'var(--color-primary-light)',
  },

  /* ---------- Comparison view ---------- */
  comparisonDesktop: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 'var(--space-4)',
    marginBottom: 'var(--space-4)',
  },
  comparisonPane: {
    background: 'var(--color-surface-raised)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  comparisonLabel: {
    padding: 'var(--space-2) var(--space-3)',
    fontSize: 'var(--text-xs)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    borderBottom: '1px solid var(--color-border)',
    background: 'var(--color-surface)',
  },
  imageContainer: {
    position: 'relative',
    overflow: 'hidden',
    cursor: 'grab',
    touchAction: 'none',
    minHeight: 200,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--color-surface)',
  },
  image: {
    maxWidth: '100%',
    maxHeight: '70vh',
    objectFit: 'contain',
    transformOrigin: '0 0',
    userSelect: 'none',
    pointerEvents: 'none',
  },
  processingOverlay: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-3)',
    padding: 'var(--space-7)',
    color: 'var(--color-text-secondary)',
    fontSize: 'var(--text-sm)',
  },
  errorOverlay: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 'var(--space-2)',
    padding: 'var(--space-7)',
    color: 'var(--color-error)',
    fontSize: 'var(--text-sm)',
    textAlign: 'center',
  },

  /* ---------- Mobile toggle ---------- */
  mobileToggleRow: {
    display: 'flex',
    gap: 0,
    marginBottom: 'var(--space-4)',
    borderRadius: 'var(--radius-md)',
    overflow: 'hidden',
    border: '1px solid var(--color-border)',
  },
  mobileToggleBtn: {
    flex: 1,
    minHeight: 44,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    background: 'var(--color-surface-raised)',
    color: 'var(--color-text-secondary)',
    fontSize: 'var(--text-sm)',
    fontWeight: 'var(--font-weight-medium)',
    cursor: 'pointer',
    transition: 'background var(--transition-fast), color var(--transition-fast)',
  },
  mobileToggleBtnActive: {
    background: 'var(--color-primary)',
    color: 'var(--color-primary-text)',
  },
  mobileImageWrapper: {
    background: 'var(--color-surface-raised)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    overflow: 'hidden',
    marginBottom: 'var(--space-4)',
  },

  /* ---------- Accordion ---------- */
  accordion: {
    background: 'var(--color-surface-raised)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    marginBottom: 'var(--space-4)',
    overflow: 'hidden',
  },
  accordionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 'var(--space-3) var(--space-4)',
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    width: '100%',
    textAlign: 'left',
    color: 'var(--color-text)',
    fontSize: 'var(--text-sm)',
    fontWeight: 'var(--font-weight-semibold)',
    fontFamily: 'var(--font-family)',
    transition: 'background var(--transition-fast)',
    minHeight: 44,
  },
  accordionArrow: {
    transition: 'transform var(--transition-fast)',
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-muted)',
  },
  accordionBody: {
    padding: '0 var(--space-4) var(--space-4)',
  },
  pipelineStep: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 'var(--space-2) 0',
    borderBottom: '1px solid var(--color-border)',
    fontSize: 'var(--text-sm)',
  },
  pipelineStepName: {
    fontFamily: 'var(--font-mono)',
    color: 'var(--color-text)',
  },
  pipelineStepValue: {
    fontFamily: 'var(--font-mono)',
    color: 'var(--color-text-secondary)',
    fontSize: 'var(--text-xs)',
  },
  dimRow: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: 'var(--space-2) 0',
    fontSize: 'var(--text-sm)',
    color: 'var(--color-text-secondary)',
  },

  /* ---------- Actions ---------- */
  actionsRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-3)',
    marginBottom: 'var(--space-4)',
  },
  profileSelect: {
    minHeight: 44,
    padding: 'var(--space-2) var(--space-3)',
    fontFamily: 'var(--font-family)',
    fontSize: 'var(--text-sm)',
    color: 'var(--color-text)',
    background: 'var(--color-surface-raised)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    cursor: 'pointer',
  },

  /* ---------- Error / 404 ---------- */
  errorContainer: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 'var(--space-7) var(--space-4)',
    textAlign: 'center',
    minHeight: 300,
  },
  errorTitle: {
    fontSize: 'var(--text-xl)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-text)',
    marginBottom: 'var(--space-2)',
  },
  errorMessage: {
    fontSize: 'var(--text-sm)',
    color: 'var(--color-text-secondary)',
    marginBottom: 'var(--space-5)',
  },

  /* ---------- Zoom hint ---------- */
  zoomHint: {
    position: 'absolute',
    bottom: 'var(--space-2)',
    right: 'var(--space-2)',
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-muted)',
    background: 'var(--color-surface-overlay)',
    padding: '2px var(--space-2)',
    borderRadius: 'var(--radius-sm)',
    pointerEvents: 'none',
    opacity: 0.8,
  },
}

/* ==========================================================================
   ZoomableImage – handles zoom + pan for both desktop and mobile
   ========================================================================== */

function ZoomableImage({ src, alt }) {
  const containerRef = useRef(null)
  const [transform, setTransform] = useState({ scale: 1, x: 0, y: 0 })
  const dragRef = useRef({ dragging: false, startX: 0, startY: 0, startTx: 0, startTy: 0 })
  const pinchRef = useRef({ initialDist: 0, initialScale: 1 })

  const clampTransform = useCallback((scale, x, y) => {
    const el = containerRef.current
    if (!el) return { scale, x, y }
    const minScale = 1
    const maxScale = 5
    const s = Math.min(Math.max(scale, minScale), maxScale)
    // When scale is 1, center (no pan). Otherwise allow panning
    if (s <= 1) return { scale: 1, x: 0, y: 0 }
    const rect = el.getBoundingClientRect()
    const maxX = rect.width * (s - 1) / 2
    const maxY = rect.height * (s - 1) / 2
    return {
      scale: s,
      x: Math.min(Math.max(x, -maxX), maxX),
      y: Math.min(Math.max(y, -maxY), maxY),
    }
  }, [])

  /* Desktop: scroll wheel zoom */
  const handleWheel = useCallback((e) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.15 : 0.15
    setTransform((prev) => {
      const newScale = prev.scale + delta
      return clampTransform(newScale, prev.x, prev.y)
    })
  }, [clampTransform])

  /* Desktop: mouse drag to pan */
  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return
    e.preventDefault()
    dragRef.current = {
      dragging: true,
      startX: e.clientX,
      startY: e.clientY,
      startTx: transform.x,
      startTy: transform.y,
    }
  }, [transform])

  const handleMouseMove = useCallback((e) => {
    if (!dragRef.current.dragging) return
    const dx = e.clientX - dragRef.current.startX
    const dy = e.clientY - dragRef.current.startY
    setTransform((prev) => clampTransform(prev.scale, dragRef.current.startTx + dx, dragRef.current.startTy + dy))
  }, [clampTransform])

  const handleMouseUp = useCallback(() => {
    dragRef.current.dragging = false
  }, [])

  /* Mobile: pinch-to-zoom + drag */
  const handleTouchStart = useCallback((e) => {
    if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      )
      pinchRef.current = { initialDist: dist, initialScale: transform.scale }
    } else if (e.touches.length === 1 && transform.scale > 1) {
      dragRef.current = {
        dragging: true,
        startX: e.touches[0].clientX,
        startY: e.touches[0].clientY,
        startTx: transform.x,
        startTy: transform.y,
      }
    }
  }, [transform])

  const handleTouchMove = useCallback((e) => {
    if (e.touches.length === 2) {
      e.preventDefault()
      const dist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      )
      const scale = pinchRef.current.initialScale * (dist / pinchRef.current.initialDist)
      setTransform((prev) => clampTransform(scale, prev.x, prev.y))
    } else if (e.touches.length === 1 && dragRef.current.dragging) {
      const dx = e.touches[0].clientX - dragRef.current.startX
      const dy = e.touches[0].clientY - dragRef.current.startY
      setTransform((prev) => clampTransform(prev.scale, dragRef.current.startTx + dx, dragRef.current.startTy + dy))
    }
  }, [clampTransform])

  const handleTouchEnd = useCallback(() => {
    dragRef.current.dragging = false
  }, [])

  /* Double-click/tap to reset zoom */
  const handleDoubleClick = useCallback(() => {
    setTransform({ scale: 1, x: 0, y: 0 })
  }, [])

  /* Attach wheel listener (non-passive) */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
  }, [handleWheel])

  /* Global mouse move/up for desktop drag */
  useEffect(() => {
    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [handleMouseMove, handleMouseUp])

  /* Reset zoom when image source changes */
  useEffect(() => {
    setTransform({ scale: 1, x: 0, y: 0 })
  }, [src])

  const imageTransform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`

  return (
    <div
      ref={containerRef}
      style={{
        ...styles.imageContainer,
        cursor: transform.scale > 1 ? 'grabbing' : 'grab',
      }}
      onMouseDown={handleMouseDown}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onDoubleClick={handleDoubleClick}
    >
      <img
        src={src}
        alt={alt}
        style={{
          ...styles.image,
          transform: imageTransform,
        }}
        draggable={false}
      />
      {transform.scale > 1 && (
        <span style={styles.zoomHint}>{Math.round(transform.scale * 100)}%</span>
      )}
    </div>
  )
}

/* ==========================================================================
   SwipeCompare – touch-draggable before/after comparison for mobile (T110)
   ========================================================================== */

function SwipeCompare({ originalSrc, processedSrc, alt }) {
  const containerRef = useRef(null)
  const [position, setPosition] = useState(50) // percentage 0-100

  const updatePosition = useCallback((clientX) => {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = clientX - rect.left
    const pct = Math.min(100, Math.max(0, (x / rect.width) * 100))
    setPosition(pct)
  }, [])

  const handleTouchStart = useCallback((e) => {
    if (e.touches.length === 1) {
      updatePosition(e.touches[0].clientX)
    }
  }, [updatePosition])

  const handleTouchMove = useCallback((e) => {
    if (e.touches.length === 1) {
      e.preventDefault()
      updatePosition(e.touches[0].clientX)
    }
  }, [updatePosition])

  const handleMouseDown = useCallback((e) => {
    e.preventDefault()
    updatePosition(e.clientX)

    const onMove = (ev) => updatePosition(ev.clientX)
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [updatePosition])

  return (
    <div
      ref={containerRef}
      className="swipe-compare"
      style={{ height: 400 }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onMouseDown={handleMouseDown}
    >
      {/* Processed (full background) */}
      <div className="swipe-compare__layer">
        {processedSrc ? (
          <img src={processedSrc} alt={`${alt} processed`} />
        ) : (
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
            No processed image
          </span>
        )}
      </div>

      {/* Original (clipped from left) */}
      <div
        className="swipe-compare__layer"
        style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
      >
        {originalSrc ? (
          <img src={originalSrc} alt={`${alt} original`} />
        ) : (
          <span style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
            No original image
          </span>
        )}
      </div>

      {/* Labels */}
      <span className="swipe-compare__label swipe-compare__label--left">Original</span>
      <span className="swipe-compare__label swipe-compare__label--right">Processed</span>

      {/* Divider + handle */}
      <div className="swipe-compare__divider" style={{ left: `${position}%` }}>
        <div className="swipe-compare__handle">&#8596;</div>
      </div>
    </div>
  )
}

/* ==========================================================================
   Processing Details Accordion
   ========================================================================== */

function ProcessingAccordion({ page, index }) {
  const [open, setOpen] = useState(false)

  // Backend stores everything in processing_details JSON
  const details = page.processing_details || {}
  const pipelineSteps = details.steps || []
  // original_size / processed_size are [width, height] arrays
  const origDims = details.original_size
  const procDims = details.processed_size
  const totalMs = details.total_ms
  // File sizes are at page level
  const origSize = page.file_size_original
  const procSize = page.file_size_processed

  const sizeReduction = origSize && procSize && origSize > 0
    ? Math.round((1 - procSize / origSize) * 100)
    : null

  return (
    <div style={styles.accordion}>
      <button
        style={styles.accordionHeader}
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        type="button"
      >
        <span>Page {index + 1} Processing Details</span>
        <span style={{
          ...styles.accordionArrow,
          transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
        }}>
          &#9660;
        </span>
      </button>
      {open && (
        <div style={styles.accordionBody}>
          {/* Total processing time */}
          {totalMs != null && (
            <div style={{ ...styles.dimRow, marginBottom: 'var(--space-3)' }}>
              <span>Total processing time</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                {formatDuration(totalMs)}
              </span>
            </div>
          )}

          {/* Pipeline steps */}
          {pipelineSteps.length > 0 && (
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <div style={{ ...styles.metaLabel, marginBottom: 'var(--space-2)' }}>
                Pipeline Steps
              </div>
              {pipelineSteps.map((step, i) => (
                <div key={i} style={{
                  ...styles.pipelineStep,
                  borderBottom: i < pipelineSteps.length - 1 ? '1px solid var(--color-border)' : 'none',
                }}>
                  <span style={styles.pipelineStepName}>
                    {step.name}
                  </span>
                  <span style={styles.pipelineStepValue}>
                    {step.skipped
                      ? 'skipped'
                      : formatDuration(step.duration_ms)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Dimensions */}
          {(origDims || procDims) && (
            <div style={styles.dimRow}>
              <span>Dimensions</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                {origDims
                  ? `${origDims[0]}x${origDims[1]}`
                  : '--'
                }
                {' \u2192 '}
                {procDims
                  ? `${procDims[0]}x${procDims[1]}`
                  : '--'
                }
              </span>
            </div>
          )}

          {/* File sizes */}
          {(origSize || procSize) && (
            <div style={styles.dimRow}>
              <span>File size</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>
                {formatBytes(origSize)} {' \u2192 '} {formatBytes(procSize)}
                {sizeReduction !== null && (
                  <span style={{
                    marginLeft: 'var(--space-2)',
                    color: sizeReduction > 0 ? 'var(--color-success)' : 'var(--color-warning)',
                  }}>
                    ({sizeReduction > 0 ? '-' : '+'}{Math.abs(sizeReduction)}%)
                  </span>
                )}
              </span>
            </div>
          )}

          {pipelineSteps.length === 0 && !origDims && !procDims && !origSize && !procSize && (
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>
              No processing details available.
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* ==========================================================================
   Export Status Section
   ========================================================================== */

function ExportSection({ batch, exporting, exportStatus, onExport }) {
  const exportInfo = batch.export_info || batch.exportInfo
  const batchStatus = batch.status

  // Don't show if batch isn't completed and there's no export info
  if (batchStatus !== 'completed' && batchStatus !== 'export_failed' && !exportInfo) {
    return null
  }

  const exports = Array.isArray(exportInfo) ? exportInfo : exportInfo ? [exportInfo] : []

  return (
    <div className="export-section">
      <div className="export-section__title">Export</div>

      {exports.length > 0 ? (
        exports.map((exp, i) => (
          <div key={i} className="export-section__item">
            <div>
              <span style={{ fontWeight: 'var(--font-weight-medium)', color: 'var(--color-text)' }}>
                {exp.backend || exp.type || 'Storage'}
              </span>
              {exp.path && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)', marginTop: 2 }}>
                  {exp.path}
                </div>
              )}
            </div>
            <span className={`badge ${exp.status === 'completed' || exp.status === 'success' ? 'badge-completed' : exp.status === 'error' || exp.status === 'failed' ? 'badge-error' : 'badge-processing'}`}>
              {exp.status || 'unknown'}
            </span>
          </div>
        ))
      ) : batchStatus === 'export_failed' ? (
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-error)', marginBottom: 'var(--space-3)' }}>
          Export failed. You can retry the export below.
        </div>
      ) : (
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--space-3)' }}>
          No export data yet.
        </div>
      )}

      {(batchStatus === 'completed' || batchStatus === 'export_failed') && (
        <button
          className="btn btn-secondary btn--sm"
          onClick={onExport}
          disabled={exporting}
          type="button"
          style={{ marginTop: 'var(--space-2)' }}
        >
          {exporting ? (
            <><Spinner size="sm" /> Exporting...</>
          ) : exportStatus === 'success' ? (
            'Re-Export'
          ) : batchStatus === 'export_failed' ? (
            'Retry Export'
          ) : (
            'Export'
          )}
        </button>
      )}
    </div>
  )
}

/* ==========================================================================
   Detail Page Component
   ========================================================================== */

export default function Detail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const ws = useContext(WebSocketContext)

  /* ---------- State ---------- */
  const [batch, setBatch] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [activePage, setActivePage] = useState(0)
  const [mobileView, setMobileView] = useState('compare') // 'original' | 'processed' | 'compare'
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [reprocessProfile, setReprocessProfile] = useState('')
  const [reprocessing, setReprocessing] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportStatus, setExportStatus] = useState(null) // null | 'success' | 'error'
  const [profiles, setProfiles] = useState([])

  /* ---------- Fetch batch data ---------- */
  const fetchBatch = useCallback(async () => {
    try {
      const res = await fetch(`/api/scans/${id}`)
      if (!res.ok) {
        if (res.status === 404) {
          setError('Batch not found.')
        } else {
          setError(`Failed to load batch (HTTP ${res.status}).`)
        }
        setLoading(false)
        return
      }
      const data = await res.json()
      setBatch(data)
      setError(null)
    } catch (err) {
      setError('Network error. Could not load batch data.')
    } finally {
      setLoading(false)
    }
  }, [id])

  /* ---------- Fetch processing profiles ---------- */
  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/profiles')
      if (res.ok) {
        const data = await res.json()
        setProfiles(Array.isArray(data) ? data : data.profiles || [])
      }
    } catch {
      // Non-critical, ignore silently
    }
  }, [])

  /* ---------- Mount: fetch data ---------- */
  useEffect(() => {
    setLoading(true)
    setError(null)
    fetchBatch()
    fetchProfiles()
  }, [fetchBatch, fetchProfiles])

  /* ---------- WebSocket subscriptions ---------- */
  useEffect(() => {
    if (!ws?.subscribe) return

    const unsubs = []

    unsubs.push(ws.subscribe('processing_page', (data) => {
      if (data.batch_id !== id && data.batchId !== id) return
      // Update the page status in our local state
      setBatch((prev) => {
        if (!prev) return prev
        const pages = (prev.pages || []).map((p) => {
          if ((p.id === data.page_id || p.id === data.pageId) ||
              (p.page_number === data.page_number || p.pageNumber === data.pageNumber)) {
            return { ...p, status: 'processing', progress: data.progress }
          }
          return p
        })
        return { ...prev, pages, status: 'processing' }
      })
    }))

    unsubs.push(ws.subscribe('page_processed', (data) => {
      if (data.batch_id !== id && data.batchId !== id) return
      // Update the page with new image URLs
      setBatch((prev) => {
        if (!prev) return prev
        const pages = (prev.pages || []).map((p) => {
          if ((p.id === data.page_id || p.id === data.pageId) ||
              (p.page_number === data.page_number || p.pageNumber === data.pageNumber)) {
            return {
              ...p,
              ...data.page,
              status: 'completed',
              // Append cache-bust to force image reload
              _cacheBust: Date.now(),
            }
          }
          return p
        })
        return { ...prev, pages }
      })
    }))

    unsubs.push(ws.subscribe('processing_complete', (data) => {
      if (data.batch_id !== id && data.batchId !== id) return
      // Refresh the entire batch
      fetchBatch()
    }))

    unsubs.push(ws.subscribe('export_complete', (data) => {
      if (data.batch_id !== id && data.batchId !== id) return
      setExportStatus('success')
      setExporting(false)
    }))

    unsubs.push(ws.subscribe('export_error', (data) => {
      if (data.batch_id !== id && data.batchId !== id) return
      setExportStatus('error')
      setExporting(false)
    }))

    return () => unsubs.forEach((unsub) => unsub())
  }, [ws, id, fetchBatch])

  /* ---------- Actions ---------- */

  const handleReprocess = async () => {
    if (reprocessing) return
    setReprocessing(true)
    try {
      const body = reprocessProfile ? { profile: reprocessProfile } : {}
      const res = await fetch(`/api/scans/${id}/reprocess`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        // The batch will update via WebSocket events
        setBatch((prev) => prev ? { ...prev, status: 'processing' } : prev)
      }
    } catch {
      // Silently ignore
    } finally {
      setReprocessing(false)
    }
  }

  const handleExport = async () => {
    if (exporting) return
    setExporting(true)
    setExportStatus(null)
    try {
      const res = await fetch(`/api/scans/${id}/export`, {
        method: 'POST',
      })
      if (!res.ok) {
        setExportStatus('error')
        setExporting(false)
      }
      // Success will come via WebSocket or we interpret the immediate response
      if (res.ok) {
        const data = await res.json().catch(() => null)
        if (data?.status === 'completed' || data?.url) {
          setExportStatus('success')
          setExporting(false)
        }
        // Otherwise wait for WS event
      }
    } catch {
      setExportStatus('error')
      setExporting(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/scans/${id}`, { method: 'DELETE' })
      if (res.ok || res.status === 204) {
        navigate('/history', { replace: true })
      } else {
        setDeleting(false)
        setDeleteOpen(false)
      }
    } catch {
      setDeleting(false)
      setDeleteOpen(false)
    }
  }

  /* ---------- Detect desktop vs mobile for layout ---------- */
  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth >= 768 : true
  )

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)')
    const handler = (e) => setIsDesktop(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  /* ---------- Loading state ---------- */
  if (loading) {
    return (
      <div className="main-content__inner">
        <Spinner fullPage size="lg" label="Loading batch details" />
      </div>
    )
  }

  /* ---------- Error / 404 state ---------- */
  if (error) {
    return (
      <div className="main-content__inner">
        <div style={styles.errorContainer}>
          <div style={{ fontSize: 48, marginBottom: 'var(--space-4)', opacity: 0.5 }}>
            &#128269;
          </div>
          <div style={styles.errorTitle}>Batch Not Found</div>
          <div style={styles.errorMessage}>{error}</div>
          <button
            className="btn btn-primary"
            onClick={() => navigate('/history')}
            type="button"
          >
            Back to History
          </button>
        </div>
      </div>
    )
  }

  if (!batch) return null

  /* ---------- Derived values ---------- */
  const pages = batch.pages || []
  const currentPage = pages[activePage] || null
  const batchId = batch.id || batch.batch_id || id
  const deviceLabel = batch.device_name || batch.deviceName || batch.device_mac || batch.deviceMac || '--'
  const totalSize = batch.total_size || batch.totalSize || batch.file_size || batch.fileSize
  const duration = batch.processing_duration || batch.processingDuration || batch.duration_ms || batch.durationMs
  const profile = batch.profile || batch.processing_profile || batch.processingProfile
  const createdAt = batch.created_at || batch.createdAt
  const updatedAt = batch.updated_at || batch.updatedAt
  const sourceType = batch.source_type || batch.sourceType || batch.source

  /* Build image URLs from batch ID + page index */
  const cacheBust = currentPage?._cacheBust ? `?t=${currentPage._cacheBust}` : ''
  const originalUrl = currentPage
    ? `/api/image/original/${batchId}/${currentPage.page_index}${cacheBust}`
    : null
  const processedUrl = currentPage
    ? `/api/image/processed/${batchId}/${currentPage.page_index}${cacheBust}`
    : null

  const pageStatus = currentPage?.status

  /* ==========================================================================
     Render
     ========================================================================== */

  return (
    <div style={styles.page}>
      {/* Back link */}
      <button
        style={styles.backLink}
        onClick={() => navigate('/history')}
        type="button"
      >
        &#8592; Back to History
      </button>

      {/* ---- Batch metadata header ---- */}
      <div style={styles.metaHeader}>
        <div style={styles.metaTitleRow}>
          <span style={styles.metaTitle}>Batch {batchId}</span>
          <span className={statusBadgeClass(batch.status)}>
            {batch.status}
          </span>
        </div>
        <div style={styles.metaGrid}>
          {sourceType && (
            <div style={styles.metaItem}>
              <span style={styles.metaLabel}>Source</span>
              <span style={styles.metaValue}>{sourceType}</span>
            </div>
          )}
          <div style={styles.metaItem}>
            <span style={styles.metaLabel}>Device</span>
            <span style={styles.metaValue}>{deviceLabel}</span>
          </div>
          <div style={styles.metaItem}>
            <span style={styles.metaLabel}>Pages</span>
            <span style={styles.metaValue}>{pages.length}</span>
          </div>
          {totalSize != null && (
            <div style={styles.metaItem}>
              <span style={styles.metaLabel}>Total Size</span>
              <span style={styles.metaValue}>{formatBytes(totalSize)}</span>
            </div>
          )}
          {duration != null && (
            <div style={styles.metaItem}>
              <span style={styles.metaLabel}>Duration</span>
              <span style={styles.metaValue}>{formatDuration(duration)}</span>
            </div>
          )}
          {profile && (
            <div style={styles.metaItem}>
              <span style={styles.metaLabel}>Profile</span>
              <span style={styles.metaValue}>{profile}</span>
            </div>
          )}
          {createdAt && (
            <div style={styles.metaItem}>
              <span style={styles.metaLabel}>Created</span>
              <span style={styles.metaValue}>{formatDate(createdAt)}</span>
            </div>
          )}
          {updatedAt && (
            <div style={styles.metaItem}>
              <span style={styles.metaLabel}>Updated</span>
              <span style={styles.metaValue}>{formatDate(updatedAt)}</span>
            </div>
          )}
        </div>
      </div>

      {/* ---- Action buttons ---- */}
      <div style={styles.actionsRow}>
        {/* Reprocess */}
        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
          {profiles.length > 0 && (
            <select
              style={styles.profileSelect}
              value={reprocessProfile}
              onChange={(e) => setReprocessProfile(e.target.value)}
              aria-label="Select processing profile"
            >
              <option value="">Default profile</option>
              {profiles.map((p) => (
                <option key={p.id || p.name || p} value={p.name || p.id || p}>
                  {p.name || p.label || p.id || p}
                </option>
              ))}
            </select>
          )}
          <button
            className="btn btn-secondary"
            onClick={handleReprocess}
            disabled={reprocessing || batch.status === 'processing'}
            type="button"
          >
            {reprocessing ? (
              <><Spinner size="sm" /> Reprocessing...</>
            ) : (
              'Reprocess'
            )}
          </button>
        </div>

        {/* Export */}
        <button
          className="btn btn-secondary"
          onClick={handleExport}
          disabled={exporting}
          type="button"
        >
          {exporting ? (
            <><Spinner size="sm" /> Exporting...</>
          ) : exportStatus === 'success' ? (
            'Exported'
          ) : exportStatus === 'error' ? (
            'Export Failed'
          ) : (
            'Export'
          )}
        </button>

        {/* Download PDF */}
        <a
          className="btn btn-primary"
          href={`/api/export/${batchId}`}
          download
        >
          Download PDF
        </a>

        {/* Delete */}
        <button
          className="btn btn-danger"
          onClick={() => setDeleteOpen(true)}
          disabled={deleting}
          type="button"
        >
          {deleting ? (
            <><Spinner size="sm" /> Deleting...</>
          ) : (
            'Delete'
          )}
        </button>
      </div>

      {/* ---- Page navigator (tabs) ---- */}
      {pages.length > 1 && (
        <div style={styles.pageNav} role="tablist" aria-label="Page navigator">
          {pages.map((page, i) => (
            <button
              key={page.id || i}
              style={{
                ...styles.pageTab,
                ...(activePage === i ? styles.pageTabActive : {}),
              }}
              onClick={() => setActivePage(i)}
              role="tab"
              aria-selected={activePage === i}
              aria-label={`Page ${i + 1}`}
              type="button"
            >
              {i + 1}
            </button>
          ))}
        </div>
      )}

      {/* ---- Image comparison view ---- */}
      {currentPage && (
        <>
          {/* Page status: processing or error */}
          {pageStatus === 'processing' && (
            <div style={{ ...styles.accordion, marginBottom: 'var(--space-4)' }}>
              <div style={styles.processingOverlay}>
                <Spinner size="lg" />
                <span>Processing page {activePage + 1}...</span>
                {currentPage.progress != null && (
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                    {Math.round(currentPage.progress * 100)}%
                  </span>
                )}
              </div>
            </div>
          )}

          {pageStatus === 'error' && (
            <div style={{ ...styles.accordion, marginBottom: 'var(--space-4)' }}>
              <div style={styles.errorOverlay}>
                <span style={{ fontSize: 24 }}>&#10007;</span>
                <span>Error processing page {activePage + 1}</span>
                {currentPage.error && (
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                    {currentPage.error}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Desktop: side-by-side */}
          {isDesktop && (
            <div style={styles.comparisonDesktop}>
              {/* Original */}
              <div style={styles.comparisonPane}>
                <div style={styles.comparisonLabel}>Original</div>
                {originalUrl ? (
                  <ZoomableImage
                    src={originalUrl}
                    alt={`Page ${activePage + 1} original`}
                  />
                ) : (
                  <div style={styles.processingOverlay}>
                    <span style={{ color: 'var(--color-text-muted)' }}>No original image</span>
                  </div>
                )}
              </div>

              {/* Processed */}
              <div style={styles.comparisonPane}>
                <div style={styles.comparisonLabel}>Processed</div>
                {pageStatus === 'processing' ? (
                  <div style={styles.processingOverlay}>
                    <Spinner size="md" />
                    <span>Processing...</span>
                  </div>
                ) : processedUrl ? (
                  <ZoomableImage
                    src={processedUrl}
                    alt={`Page ${activePage + 1} processed`}
                  />
                ) : (
                  <div style={styles.processingOverlay}>
                    <span style={{ color: 'var(--color-text-muted)' }}>No processed image</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Mobile: toggle between compare / original / processed */}
          {!isDesktop && (
            <>
              <div style={styles.mobileToggleRow}>
                <button
                  style={{
                    ...styles.mobileToggleBtn,
                    ...(mobileView === 'compare' ? styles.mobileToggleBtnActive : {}),
                  }}
                  onClick={() => setMobileView('compare')}
                  type="button"
                >
                  Compare
                </button>
                <button
                  style={{
                    ...styles.mobileToggleBtn,
                    ...(mobileView === 'original' ? styles.mobileToggleBtnActive : {}),
                  }}
                  onClick={() => setMobileView('original')}
                  type="button"
                >
                  Original
                </button>
                <button
                  style={{
                    ...styles.mobileToggleBtn,
                    ...(mobileView === 'processed' ? styles.mobileToggleBtnActive : {}),
                  }}
                  onClick={() => setMobileView('processed')}
                  type="button"
                >
                  Processed
                </button>
              </div>

              {mobileView === 'compare' ? (
                <div style={{ marginBottom: 'var(--space-4)' }}>
                  <SwipeCompare
                    originalSrc={originalUrl}
                    processedSrc={processedUrl}
                    alt={`Page ${activePage + 1}`}
                  />
                </div>
              ) : (
                <div style={styles.mobileImageWrapper}>
                  {mobileView === 'original' ? (
                    originalUrl ? (
                      <ZoomableImage
                        src={originalUrl}
                        alt={`Page ${activePage + 1} original`}
                      />
                    ) : (
                      <div style={styles.processingOverlay}>
                        <span style={{ color: 'var(--color-text-muted)' }}>No original image</span>
                      </div>
                    )
                  ) : pageStatus === 'processing' ? (
                    <div style={styles.processingOverlay}>
                      <Spinner size="md" />
                      <span>Processing...</span>
                    </div>
                  ) : processedUrl ? (
                    <ZoomableImage
                      src={processedUrl}
                      alt={`Page ${activePage + 1} processed`}
                    />
                  ) : (
                    <div style={styles.processingOverlay}>
                      <span style={{ color: 'var(--color-text-muted)' }}>No processed image</span>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* ---- Processing details accordion ---- */}
          <ProcessingAccordion page={currentPage} index={activePage} />

          {/* ---- Export status section ---- */}
          <ExportSection
            batch={batch}
            exporting={exporting}
            exportStatus={exportStatus}
            onExport={handleExport}
          />
        </>
      )}

      {/* No pages at all */}
      {pages.length === 0 && (
        <div style={styles.errorContainer}>
          <div style={{ fontSize: 48, marginBottom: 'var(--space-4)', opacity: 0.5 }}>
            &#128196;
          </div>
          <div style={styles.errorTitle}>No Pages</div>
          <div style={styles.errorMessage}>This batch has no scanned pages yet.</div>
        </div>
      )}

      {/* ---- Delete confirmation dialog ---- */}
      <ConfirmDialog
        open={deleteOpen}
        title="Delete Batch"
        message={`Are you sure you want to permanently delete batch ${batchId}? This action cannot be undone.`}
        confirmText={deleting ? 'Deleting...' : 'Delete'}
        cancelText="Cancel"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteOpen(false)}
      />
    </div>
  )
}
