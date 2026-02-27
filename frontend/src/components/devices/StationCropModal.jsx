import React, { useState, useEffect, useRef, useCallback } from 'react'

const DEFAULT_POINTS = [
  { x: 0.05, y: 0.05 },
  { x: 0.95, y: 0.05 },
  { x: 0.95, y: 0.95 },
  { x: 0.05, y: 0.95 },
]

const HANDLE_RADIUS = 14
const HIT_RADIUS = 30
const CANVAS_PADDING = HANDLE_RADIUS + 4
const ACCENT = '#3b82f6'
const ACCENT_ACTIVE = '#2563eb'

/**
 * Simplified crop editor for station crop zone calibration.
 * Shows a frozen preview frame with 4 draggable corners.
 * No rotation, no queue, no auto-detect.
 */
export default function StationCropModal({
  open,
  frameDataUrl,
  initialPoints,
  onConfirm,
  onCancel,
}) {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const imgRef = useRef(null)
  const [imgLoaded, setImgLoaded] = useState(false)
  const [points, setPoints] = useState(DEFAULT_POINTS)
  const [dragging, setDragging] = useState(-1)
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 })
  const [imgRect, setImgRect] = useState({ x: 0, y: 0, w: 0, h: 0 })

  // ---- Load image when frame changes ----
  useEffect(() => {
    if (!open || !frameDataUrl) return
    setImgLoaded(false)
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      setImgLoaded(true)
    }
    img.onerror = () => setImgLoaded(true)
    img.src = frameDataUrl
  }, [open, frameDataUrl])

  // ---- Sync points from initial crop zone ----
  useEffect(() => {
    if (!open) return
    if (initialPoints && initialPoints.length === 4) {
      const MIN = 0.03
      const MAX = 0.97
      setPoints(initialPoints.map((p) => ({
        x: Math.max(MIN, Math.min(MAX, p.x)),
        y: Math.max(MIN, Math.min(MAX, p.y)),
      })))
    } else {
      setPoints(DEFAULT_POINTS)
    }
  }, [open, initialPoints])

  // ---- Observe canvas wrapper size ----
  useEffect(() => {
    if (!open || !wrapRef.current) return
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect
      if (width > 0 && height > 0) {
        const dpr = window.devicePixelRatio || 1
        setCanvasSize({ w: Math.round(width * dpr), h: Math.round(height * dpr) })
      }
    })
    observer.observe(wrapRef.current)
    return () => observer.disconnect()
  }, [open])

  // ---- Compute image rect within canvas ----
  useEffect(() => {
    if (!imgRef.current || !imgLoaded || canvasSize.w === 0) return
    const img = imgRef.current
    const cw = canvasSize.w
    const ch = canvasSize.h
    const dpr = window.devicePixelRatio || 1
    const pad = CANVAS_PADDING * dpr
    const aw = cw - pad * 2
    const ah = ch - pad * 2
    if (aw <= 0 || ah <= 0) return
    const imgAspect = img.naturalWidth / img.naturalHeight
    const areaAspect = aw / ah
    let dw, dh
    if (imgAspect > areaAspect) {
      dw = aw
      dh = aw / imgAspect
    } else {
      dh = ah
      dw = ah * imgAspect
    }
    setImgRect({
      x: (cw - dw) / 2,
      y: (ch - dh) / 2,
      w: dw,
      h: dh,
    })
  }, [imgLoaded, canvasSize])

  // ---- Canvas draw ----
  const draw = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas || !imgRef.current || !imgLoaded) return
    const ctx = canvas.getContext('2d')
    const { x, y, w, h } = imgRect
    const cw = canvasSize.w
    const ch = canvasSize.h

    canvas.width = cw
    canvas.height = ch
    ctx.clearRect(0, 0, cw, ch)

    // Draw image
    ctx.drawImage(imgRef.current, x, y, w, h)

    if (!points || points.length !== 4) return

    // Convert normalized points to canvas pixels
    const pts = points.map((p) => ({
      cx: x + p.x * w,
      cy: y + p.y * h,
    }))

    // Dim overlay outside quad
    ctx.save()
    ctx.fillStyle = 'rgba(0, 0, 0, 0.45)'
    ctx.fillRect(0, 0, cw, ch)
    ctx.globalCompositeOperation = 'destination-out'
    ctx.beginPath()
    ctx.moveTo(pts[0].cx, pts[0].cy)
    for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].cx, pts[i].cy)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    // Redraw image inside quad (bright)
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(pts[0].cx, pts[0].cy)
    for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].cx, pts[i].cy)
    ctx.closePath()
    ctx.clip()
    ctx.drawImage(imgRef.current, x, y, w, h)
    ctx.restore()

    // Quad outline
    ctx.strokeStyle = ACCENT
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(pts[0].cx, pts[0].cy)
    for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].cx, pts[i].cy)
    ctx.closePath()
    ctx.stroke()

    // Edge midpoints
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.3)'
    ctx.lineWidth = 1
    for (let i = 0; i < 4; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % 4]
      const mx = (a.cx + b.cx) / 2
      const my = (a.cy + b.cy) / 2
      ctx.beginPath()
      ctx.arc(mx, my, 4, 0, Math.PI * 2)
      ctx.stroke()
    }

    // Corner handles
    pts.forEach((pt, i) => {
      ctx.beginPath()
      ctx.arc(pt.cx, pt.cy, HANDLE_RADIUS, 0, Math.PI * 2)
      ctx.fillStyle = dragging === i ? ACCENT_ACTIVE : ACCENT
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2.5
      ctx.stroke()

      ctx.fillStyle = '#fff'
      ctx.font = `bold ${HANDLE_RADIUS}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(i + 1), pt.cx, pt.cy)
    })
  }, [imgLoaded, imgRect, canvasSize, points, dragging])

  useEffect(() => {
    draw()
  }, [draw])

  // ---- Pointer event helpers ----
  const getPos = useCallback(
    (e) => {
      const canvas = canvasRef.current
      if (!canvas) return { x: 0, y: 0 }
      const rect = canvas.getBoundingClientRect()
      const clientX = e.touches ? e.touches[0].clientX : e.clientX
      const clientY = e.touches ? e.touches[0].clientY : e.clientY
      return {
        x: (clientX - rect.left) * (canvasSize.w / rect.width),
        y: (clientY - rect.top) * (canvasSize.h / rect.height),
      }
    },
    [canvasSize],
  )

  const handleDown = useCallback(
    (e) => {
      e.preventDefault()
      if (!points) return
      const pos = getPos(e)
      const { x, y, w, h } = imgRect
      let closest = -1
      let closestDist = Infinity
      points.forEach((p, i) => {
        const cx = x + p.x * w
        const cy = y + p.y * h
        const dist = Math.hypot(pos.x - cx, pos.y - cy)
        if (dist < closestDist && dist < HIT_RADIUS * (window.devicePixelRatio || 1)) {
          closest = i
          closestDist = dist
        }
      })
      setDragging(closest)
    },
    [points, imgRect, getPos],
  )

  const handleMove = useCallback(
    (e) => {
      if (dragging === -1) return
      e.preventDefault()
      const pos = getPos(e)
      const { x, y, w, h } = imgRect
      const nx = Math.max(0, Math.min(1, (pos.x - x) / w))
      const ny = Math.max(0, Math.min(1, (pos.y - y) / h))
      setPoints((prev) => {
        const next = [...prev]
        next[dragging] = { x: nx, y: ny }
        return next
      })
    },
    [dragging, imgRect, getPos],
  )

  const handleUp = useCallback(() => {
    setDragging(-1)
  }, [])

  // ---- Prevent body scroll ----
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (!open) return null

  return (
    <div className="crop-modal-overlay">
      <div className="crop-modal-canvas-wrap" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="crop-modal-canvas"
          onMouseDown={handleDown}
          onMouseMove={handleMove}
          onMouseUp={handleUp}
          onMouseLeave={handleUp}
          onTouchStart={handleDown}
          onTouchMove={handleMove}
          onTouchEnd={handleUp}
          onTouchCancel={handleUp}
        />
      </div>

      <div className="crop-modal-toolbar">
        <button className="btn btn-secondary btn--sm" onClick={onCancel}>
          Cancel
        </button>
        <button
          className="btn btn-secondary btn--sm"
          onClick={() => setPoints(DEFAULT_POINTS)}
        >
          Reset
        </button>
        <button
          className="btn btn-primary btn--sm"
          onClick={() => onConfirm(points)}
          disabled={!points}
        >
          Confirm
        </button>
      </div>
    </div>
  )
}
