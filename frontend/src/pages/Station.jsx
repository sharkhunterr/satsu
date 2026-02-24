import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useStation } from '../hooks/useStation'
import { IconCamera, IconFlash, IconFlashOff, IconSwitchCamera } from '../components/shared/Icons'

/* ==========================================================================
   Scanning Station — Kiosk Mode
   ==========================================================================
   This page turns a phone/tablet into a dedicated scanning station.
   It shows a full-screen camera viewfinder and can be controlled remotely
   from the Devices page on another device.
   ========================================================================== */

export default function Station() {
  const station = useStation()
  const {
    camera, stationName, setStationName, registered, capturing,
    captureCount, pendingCaptures, sending, lastError, wakeLockActive,
    doCapture, doSend, doClear,
    profiles, selectedProfile, setSelectedProfile,
  } = station

  const [started, setStarted] = useState(false)
  const [nameInput, setNameInput] = useState(stationName || '')
  const [editingName, setEditingName] = useState(false)
  const cameraStartedRef = useRef(false)

  // Start camera via useEffect AFTER the video element is rendered
  useEffect(() => {
    if (started && !cameraStartedRef.current && !camera.isActive && !camera.error) {
      cameraStartedRef.current = true
      camera.start()
    }
  }, [started, camera.isActive, camera.error, camera.start])

  const handleStart = useCallback(() => {
    const name = nameInput.trim() || 'Web Station'
    setStationName(name)
    setNameInput(name)
    setStarted(true)
    // camera.start() will be called by the useEffect above once the <video> is mounted
  }, [nameInput, setStationName])

  const handleRetry = useCallback(() => {
    cameraStartedRef.current = false
    camera.start()
  }, [camera])

  /* ---- Setup screen (overlay before camera started) ---- */

  if (!started) {
    return (
      <div className="station-page">
        <div className="station-setup">
          <div className="station-setup__icon">
            <IconCamera style={{ fontSize: 48 }} />
          </div>
          <h1 className="station-setup__title">ESPScanCam Station</h1>
          <p className="station-setup__desc">
            This device will act as a dedicated scanning station.
            It can be controlled remotely from the Devices page.
          </p>

          <div className="form-group" style={{ width: '100%', maxWidth: 320 }}>
            <label className="form-label">Station Name</label>
            <input
              className="form-input"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              placeholder="e.g. Desk Scanner"
              onKeyDown={(e) => { if (e.key === 'Enter') handleStart() }}
            />
          </div>

          {profiles.length > 0 && (
            <div className="form-group" style={{ width: '100%', maxWidth: 320 }}>
              <label className="form-label">Default Profile</label>
              <select
                className="form-select"
                value={selectedProfile}
                onChange={(e) => setSelectedProfile(e.target.value)}
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.is_default ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <button className="btn btn-primary btn--lg" onClick={handleStart}>
            Start Station
          </button>

          <p className="station-setup__hint">
            Camera access will be requested. Keep this page open on the scanner device.
          </p>
        </div>
      </div>
    )
  }

  /* ---- Camera error states (shown after start attempt) ---- */

  if (camera.error === 'permission_denied') {
    return (
      <div className="station-page">
        <div className="station-setup">
          <h1 className="station-setup__title">Camera Access Denied</h1>
          <p className="station-setup__desc">
            Please allow camera access in your browser settings, then tap Retry.
          </p>
          <button className="btn btn-primary" onClick={handleRetry}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (camera.error === 'no_camera' || camera.error === 'camera_error') {
    return (
      <div className="station-page">
        <div className="station-setup">
          <h1 className="station-setup__title">
            {camera.error === 'no_camera' ? 'No Camera Found' : 'Camera Error'}
          </h1>
          <p className="station-setup__desc">
            {camera.error === 'no_camera'
              ? "This device doesn't have a camera or it's not available."
              : 'Could not access the camera. It may be in use by another application.'}
          </p>
          <button className="btn btn-primary" onClick={handleRetry}>
            Retry
          </button>
        </div>
      </div>
    )
  }

  /* ---- Kiosk viewfinder ---- */

  const displayName = stationName || 'Web Station'
  const pendingCount = pendingCaptures.length

  return (
    <div className="station-page">
      {/* Top status bar */}
      <div className="station-topbar">
        <div className="station-topbar__left">
          {editingName ? (
            <input
              className="form-input station-topbar__name-input"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={() => {
                const name = nameInput.trim() || displayName
                setStationName(name)
                setNameInput(name)
                setEditingName(false)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const name = nameInput.trim() || displayName
                  setStationName(name)
                  setNameInput(name)
                  setEditingName(false)
                }
                if (e.key === 'Escape') {
                  setNameInput(displayName)
                  setEditingName(false)
                }
              }}
              autoFocus
            />
          ) : (
            <span
              className="station-topbar__name"
              onClick={() => {
                setNameInput(displayName)
                setEditingName(true)
              }}
              title="Click to rename"
            >
              {displayName}
            </span>
          )}
        </div>
        <div className="station-topbar__right">
          <span className={`station-status-dot${registered ? ' station-status-dot--online' : ''}`} />
          {wakeLockActive && <span className="station-topbar__badge">Awake</span>}
          {pendingCount > 0 && (
            <span className="station-topbar__badge station-topbar__badge--count">
              {pendingCount} pending
            </span>
          )}
          {captureCount > 0 && (
            <span className="station-topbar__badge">
              {captureCount} total
            </span>
          )}
        </div>
      </div>

      {/* Camera viewfinder */}
      <div className="station-viewfinder">
        <video
          ref={camera.videoRef}
          autoPlay
          playsInline
          muted
          className="station-video"
        />
        {capturing && <div className="station-flash" />}
        {/* Loading state while camera is starting */}
        {!camera.isActive && !camera.error && (
          <div className="station-viewfinder__loading">Starting camera...</div>
        )}
      </div>

      {/* Pending captures strip */}
      {pendingCount > 0 && (
        <div className="station-pending-strip">
          <div className="station-pending-strip__thumbs">
            {pendingCaptures.slice(-6).map((cap, i) => (
              <img key={cap.ts} src={cap.thumbUrl} alt={`Capture ${i + 1}`} className="station-pending-strip__thumb" />
            ))}
            {pendingCount > 6 && (
              <span className="station-pending-strip__more">+{pendingCount - 6}</span>
            )}
          </div>
          <div className="station-pending-strip__actions">
            <button
              className="btn btn-primary btn--sm"
              onClick={doSend}
              disabled={sending}
              type="button"
            >
              {sending ? 'Sending...' : `Send ${pendingCount}`}
            </button>
            <button
              className="btn btn-secondary btn--sm"
              onClick={doClear}
              disabled={sending}
              type="button"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Bottom controls */}
      <div className="station-controls">
        <div className="station-controls__side">
          {camera.torchSupported && (
            <button
              className="btn btn-icon station-ctrl-btn"
              onClick={camera.toggleTorch}
              title={camera.torchOn ? 'Turn off torch' : 'Turn on torch'}
            >
              {camera.torchOn ? <IconFlash /> : <IconFlashOff />}
            </button>
          )}
          {camera.hasMultipleCameras && (
            <button
              className="btn btn-icon station-ctrl-btn"
              onClick={camera.switchCamera}
              title="Switch camera"
            >
              <IconSwitchCamera />
            </button>
          )}
        </div>

        <button
          className="station-capture-btn"
          onClick={doCapture}
          disabled={capturing || !camera.isActive}
          aria-label="Capture"
          title="Capture"
        >
          <span className={`station-capture-btn__inner${capturing ? ' station-capture-btn__inner--busy' : ''}`} />
        </button>

        <div className="station-controls__side station-controls__side--right">
          <select
            className="form-select station-profile-select"
            value={selectedProfile}
            onChange={(e) => setSelectedProfile(e.target.value)}
          >
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Error toast */}
      {lastError && (
        <div className="station-error">{lastError}</div>
      )}
    </div>
  )
}
