import { useState, useEffect, useRef, useCallback } from 'react'
import { useWS } from '../App'
import { useCamera } from './useCamera'

const PREVIEW_INTERVAL = 500 // ms between preview frames
const PREVIEW_WIDTH = 320    // px width for preview thumbnails

/**
 * Hook for the scanning station page.
 * Manages camera, Wake Lock, WebSocket registration, preview streaming,
 * local capture accumulation, send/clear, and remote command handling.
 */
export function useStation() {
  const ws = useWS()
  const camera = useCamera()

  const [stationId] = useState(() => {
    let id = localStorage.getItem('satsu-station-id')
    if (!id) {
      id = crypto.randomUUID?.() || (Date.now().toString(36) + Math.random().toString(36).slice(2, 8))
      localStorage.setItem('satsu-station-id', id)
    }
    return id
  })

  const [stationName, setStationNameState] = useState(() => {
    return localStorage.getItem('satsu-station-name') || ''
  })

  const [registered, setRegistered] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [captureCount, setCaptureCount] = useState(0)
  const [sending, setSending] = useState(false)
  const [lastError, setLastError] = useState(null)
  const [wakeLockActive, setWakeLockActive] = useState(false)
  const [selectedProfile, setSelectedProfile] = useState('default')
  const [profiles, setProfiles] = useState([])

  // Accumulated capture blobs (not yet sent)
  const [pendingCaptures, setPendingCaptures] = useState([])

  // Crop zone calibration (set remotely from Devices page)
  const [cropZone, setCropZone] = useState(null) // null | Array<{x,y}>

  const cameraRef = useRef(camera)
  cameraRef.current = camera
  const doCaptureRef = useRef(null)
  const doSendRef = useRef(null)
  const doClearRef = useRef(null)
  const selectedProfileRef = useRef(selectedProfile)
  selectedProfileRef.current = selectedProfile
  const wsRef = useRef(ws)
  wsRef.current = ws
  const stationIdRef = useRef(stationId)
  stationIdRef.current = stationId
  const pendingCapturesRef = useRef(pendingCaptures)
  pendingCapturesRef.current = pendingCaptures
  const cropZoneRef = useRef(cropZone)
  cropZoneRef.current = cropZone

  // ---- Broadcast station status to viewers ----
  const broadcastStatus = useCallback((overrides = {}) => {
    const w = wsRef.current
    if (!w?.send) return
    w.send({
      type: 'station_status',
      station_id: stationIdRef.current,
      captureCount: overrides.captureCount ?? pendingCapturesRef.current.length,
      torchOn: overrides.torchOn ?? cameraRef.current.torchOn ?? false,
      sending: overrides.sending ?? false,
      cropZone: cropZoneRef.current,
    })
  }, [])

  // Broadcast status whenever pendingCaptures or torch changes
  useEffect(() => {
    if (!registered) return
    broadcastStatus()
  }, [registered, pendingCaptures.length, camera.torchOn, cropZone, broadcastStatus])

  // ---- Fetch profiles ----
  useEffect(() => {
    let cancelled = false
    async function fetchProfiles() {
      try {
        const res = await fetch('/api/settings/profiles')
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        setProfiles(data)
        const def = data.find((p) => p.is_default)
        if (def) setSelectedProfile(def.id || def.name)
      } catch { /* ignore */ }
    }
    fetchProfiles()
    return () => { cancelled = true }
  }, [])

  // ---- Register station when WS connects ----
  useEffect(() => {
    if (!ws?.connected || !ws?.send) return

    const name = stationName || 'Web Station'
    ws.send({
      type: 'station_register',
      station_id: stationId,
      name,
    })
    setRegistered(true)

    return () => setRegistered(false)
  }, [ws?.connected, ws?.send, stationId, stationName])

  // ---- Send low-res preview frames periodically ----
  useEffect(() => {
    if (!registered || !camera.isActive || !ws?.send) return

    const canvas = document.createElement('canvas')

    const sendPreview = () => {
      const video = cameraRef.current.videoRef.current
      if (!video || !video.videoWidth) return

      const scale = PREVIEW_WIDTH / video.videoWidth
      canvas.width = PREVIEW_WIDTH
      canvas.height = Math.round(video.videoHeight * scale)

      const ctx = canvas.getContext('2d')
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

      const dataUrl = canvas.toDataURL('image/jpeg', 0.3)
      ws.send({
        type: 'station_preview',
        station_id: stationId,
        frame: dataUrl,
      })
    }

    const interval = setInterval(sendPreview, PREVIEW_INTERVAL)
    return () => clearInterval(interval)
  }, [registered, camera.isActive, ws?.send, stationId])

  // ---- Capture: take full-res frame and accumulate locally ----
  const doCapture = useCallback(async () => {
    if (capturing) return
    setCapturing(true)
    setLastError(null)

    try {
      const blob = await cameraRef.current.capture(0.92)
      if (!blob) {
        setLastError('Failed to capture frame')
        return
      }

      // Create a thumbnail for display
      const thumbUrl = URL.createObjectURL(blob)
      setPendingCaptures((prev) => [...prev, { blob, thumbUrl, ts: Date.now() }])
      setCaptureCount((c) => c + 1)
    } catch (err) {
      setLastError(err.message || 'Capture failed')
    } finally {
      setCapturing(false)
    }
  }, [capturing])

  doCaptureRef.current = doCapture

  // ---- Send: upload all accumulated captures ----
  const doSend = useCallback(async () => {
    const captures = pendingCapturesRef.current
    if (captures.length === 0 || sending) return
    setSending(true)
    setLastError(null)
    broadcastStatus({ sending: true, captureCount: captures.length })

    try {
      const formData = new FormData()
      captures.forEach((cap, i) => {
        formData.append('files', cap.blob, `station-${cap.ts}-${i}.jpg`)
      })
      formData.append('source_type', 'web_station')
      formData.append('profile', selectedProfileRef.current)

      // Include crop zone for all pages if calibration is set
      const currentCropZone = cropZoneRef.current
      if (currentCropZone) {
        const cropMap = {}
        captures.forEach((_, i) => {
          cropMap[String(i)] = { points: currentCropZone }
        })
        formData.append('crop_data', JSON.stringify(cropMap))
      }

      const res = await fetch('/api/scan/web-upload', {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) {
        setLastError(`Upload failed (HTTP ${res.status})`)
        return
      }

      // Clear pending captures on success
      captures.forEach((cap) => URL.revokeObjectURL(cap.thumbUrl))
      setPendingCaptures([])
    } catch (err) {
      setLastError(err.message || 'Send failed')
    } finally {
      setSending(false)
      broadcastStatus({ sending: false, captureCount: pendingCapturesRef.current.length })
    }
  }, [sending, broadcastStatus])

  doSendRef.current = doSend

  // ---- Clear: discard accumulated captures ----
  const doClear = useCallback(() => {
    pendingCapturesRef.current.forEach((cap) => URL.revokeObjectURL(cap.thumbUrl))
    setPendingCaptures([])
    setLastError(null)
  }, [])

  doClearRef.current = doClear

  // ---- Listen for remote commands ----
  useEffect(() => {
    if (!ws?.subscribe) return

    return ws.subscribe('station_command', (data) => {
      const cam = cameraRef.current
      const cmd = data.command
      if (cmd === 'capture') {
        doCaptureRef.current?.()
      } else if (cmd === 'torch_on') {
        if (cam.torchSupported && !cam.torchOn) cam.toggleTorch()
      } else if (cmd === 'torch_off') {
        if (cam.torchSupported && cam.torchOn) cam.toggleTorch()
      } else if (cmd === 'switch_camera') {
        cam.switchCamera()
      } else if (cmd === 'send') {
        doSendRef.current?.()
      } else if (cmd === 'clear') {
        doClearRef.current?.()
      } else if (cmd === 'set_crop_zone') {
        const points = data.payload?.points
        if (points && Array.isArray(points) && points.length === 4) {
          setCropZone(points)
        }
      } else if (cmd === 'clear_crop_zone') {
        setCropZone(null)
      }
    })
  }, [ws?.subscribe])

  // ---- Wake Lock: prevent phone from sleeping ----
  useEffect(() => {
    let lock = null
    let released = false

    async function requestWakeLock() {
      if (released) return
      try {
        if ('wakeLock' in navigator) {
          lock = await navigator.wakeLock.request('screen')
          setWakeLockActive(true)
          lock.addEventListener('release', () => {
            if (!released) setWakeLockActive(false)
          })
        }
      } catch {
        setWakeLockActive(false)
      }
    }

    requestWakeLock()

    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && !released) {
        requestWakeLock()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      released = true
      document.removeEventListener('visibilitychange', handleVisibility)
      if (lock) lock.release().catch(() => {})
    }
  }, [])

  // ---- Update station name ----
  const setStationName = useCallback((name) => {
    setStationNameState(name)
    localStorage.setItem('satsu-station-name', name)
  }, [])

  return {
    stationId,
    stationName,
    setStationName,
    registered,
    camera,
    capturing,
    captureCount,
    pendingCaptures,
    sending,
    lastError,
    wakeLockActive,
    doCapture,
    doSend,
    doClear,
    cropZone,
    profiles,
    selectedProfile,
    setSelectedProfile,
  }
}
