import React, { useState, useEffect, useRef, useCallback } from 'react'
import Spinner from '../shared/Spinner'

const DEFAULT_POINTS = [
  { x: 0.05, y: 0.05 },
  { x: 0.95, y: 0.05 },
  { x: 0.95, y: 0.95 },
  { x: 0.05, y: 0.95 },
]

const HANDLE_RADIUS = 14
const HIT_RADIUS = 30
// Padding inside canvas so handles at image edges remain grabbable
const CANVAS_PADDING = HANDLE_RADIUS + 4
const ACCENT = '#3b82f6'
const ACCENT_ACTIVE = '#2563eb'

export default function CropModal({
  open,
  imageUrl,
  initialPoints,
  detecting,
  queueLength,
  onConfirm,
  onSkip,
  onRedetect,
  onCancel,
}) {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const imgRef = useRef(null)
  const [imgLoaded, setImgLoaded] = useState(false)
  const [points, setPoints] = useState(null)
  const [dragging, setDragging] = useState(-1)
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 })
  const [imgRect, setImgRect] = useState({ x: 0, y: 0, w: 0, h: 0 })
  const [rotation, setRotation] = useState(0)

  // ---- Load image when url changes ----
  useEffect(() => {
    if (!open || !imageUrl) return
    setImgLoaded(false)
    setRotation(0)
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      setImgLoaded(true)
    }
    img.onerror = () => setImgLoaded(true) // still show modal
    img.src = imageUrl
  }, [open, imageUrl])

  // ---- Sync points from detection result ----
  useEffect(() => {
    if (initialPoints && initialPoints.length === 4) {
      // Clamp initial points so handles stay at least 3% from edges —
      // makes them easy to grab on mobile. User can still drag to 0/1.
      const MIN = 0.03
      const MAX = 0.97
      const clamped = initialPoints.map((p) => ({
        x: Math.max(MIN, Math.min(MAX, p.x)),
        y: Math.max(MIN, Math.min(MAX, p.y)),
      }))
      setPoints(clamped)
    } else if (!detecting) {
      setPoints(DEFAULT_POINTS)
    }
  }, [initialPoints, detecting])

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

  // ---- Compute image rect within canvas (accounts for rotation + padding) ----
  useEffect(() => {
    if (!imgRef.current || !imgLoaded || canvasSize.w === 0) return
    const img = imgRef.current
    const cw = canvasSize.w
    const ch = canvasSize.h
    const dpr = window.devicePixelRatio || 1
    const pad = CANVAS_PADDING * dpr
    // Available area after padding
    const aw = cw - pad * 2
    const ah = ch - pad * 2
    if (aw <= 0 || ah <= 0) return
    const isRotated = rotation === 90 || rotation === 270
    const natW = isRotated ? img.naturalHeight : img.naturalWidth
    const natH = isRotated ? img.naturalWidth : img.naturalHeight
    const imgAspect = natW / natH
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
  }, [imgLoaded, canvasSize, rotation])

  // ---- Draw rotated image helper ----
  const drawRotatedImage = useCallback((ctx, img, x, y, w, h, rot) => {
    ctx.save()
    ctx.translate(x + w / 2, y + h / 2)
    ctx.rotate((rot * Math.PI) / 180)
    const isRot = rot === 90 || rot === 270
    if (isRot) {
      ctx.drawImage(img, -h / 2, -w / 2, h, w)
    } else {
      ctx.drawImage(img, -w / 2, -h / 2, w, h)
    }
    ctx.restore()
  }, [])

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

    // Draw image (with rotation)
    drawRotatedImage(ctx, imgRef.current, x, y, w, h, rotation)

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
    // Cut out quad
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
    drawRotatedImage(ctx, imgRef.current, x, y, w, h, rotation)
    ctx.restore()

    // Quad outline
    ctx.strokeStyle = ACCENT
    ctx.lineWidth = 2.5
    ctx.beginPath()
    ctx.moveTo(pts[0].cx, pts[0].cy)
    for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].cx, pts[i].cy)
    ctx.closePath()
    ctx.stroke()

    // Edge midpoint lines (subtle)
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

      // Corner label
      ctx.fillStyle = '#fff'
      ctx.font = `bold ${HANDLE_RADIUS}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(i + 1), pt.cx, pt.cy)
    })
  }, [imgLoaded, imgRect, canvasSize, points, dragging, rotation, drawRotatedImage])

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

  // ---- Rotate 90° clockwise ----
  const handleRotate = useCallback(() => {
    setRotation((prev) => (prev + 90) % 360)
    setPoints(DEFAULT_POINTS)
  }, [])

  // ---- Prevent body scroll when modal is open ----
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
        {(!imgLoaded || detecting) && (
          <div className="crop-modal-detecting">
            <Spinner label={detecting ? 'Detecting document...' : 'Loading...'} />
          </div>
        )}
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
        <button className="btn btn-secondary btn--sm" onClick={handleRotate}>
          Rotate
        </button>
        <button
          className="btn btn-secondary btn--sm"
          onClick={onRedetect}
          disabled={detecting}
        >
          Auto
        </button>
        <button className="btn btn-secondary btn--sm" onClick={onSkip}>
          No Crop
        </button>
        <button
          className="btn btn-primary btn--sm"
          onClick={() => onConfirm({ points, rotation })}
          disabled={!points}
        >
          Confirm
        </button>
        {queueLength > 1 && (
          <span className="crop-modal-queue-badge">{queueLength - 1} left</span>
        )}
      </div>
    </div>
  )
}
