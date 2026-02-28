import React, { useState, useRef, useCallback, useEffect } from 'react'
import { IconFlash } from '../shared/Icons'

/**
 * ESP32-CAM Web Flasher — Simple 2-phase flow:
 *   1. Configure: WiFi + GPIO pins + server URL
 *   2. Flash: Select USB port → flash bundled firmware → send config via Serial
 *
 * The firmware binary is pre-compiled and bundled in the repo.
 * After flashing, device config (WiFi, GPIO, server URL) is sent via Serial
 * and saved to NVS Preferences on the ESP32.
 *
 * Requirements: Chrome or Edge, HTTPS or localhost (Web Serial API).
 */

const WEB_SERIAL_SUPPORTED = typeof navigator !== 'undefined' && 'serial' in navigator

const DEFAULT_GPIO = {
  btn_scan: 12,
  btn_send: 13,
  btn_reset: 15,
  led_pin: 33,
  flash_pin: 4,
}

const GPIO_OPTIONS = [0, 2, 4, 5, 12, 13, 14, 15, 16, 33]

export default function FlashModal({ open, onClose }) {
  const [wifiSsid, setWifiSsid] = useState('')
  const [wifiPass, setWifiPass] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [customServerUrl, setCustomServerUrl] = useState('')
  const [gpios, setGpios] = useState({ ...DEFAULT_GPIO })
  const [maxPages, setMaxPages] = useState(10)

  const [firmwareReady, setFirmwareReady] = useState(null) // null=checking, true, false
  const [firmwareSize, setFirmwareSize] = useState(0)

  const [phase, setPhase] = useState('config') // config | flashing | done
  const [progress, setProgress] = useState(0)
  const [log, setLog] = useState([])
  const [error, setError] = useState(null)

  const portRef = useRef(null)
  const abortRef = useRef(false)
  const logEndRef = useRef(null)

  const addLog = useCallback((msg, type = 'info') => {
    setLog(prev => [...prev, { msg, type, time: Date.now() }])
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [])

  const setGpio = (key, val) => setGpios(prev => ({ ...prev, [key]: Number(val) }))

  const autoServerUrl = `${window.location.protocol}//${window.location.hostname}:8400`

  // Check firmware on open
  useEffect(() => {
    if (!open) return
    setPhase('config')
    setProgress(0)
    setLog([])
    setError(null)
    setFirmwareReady(null)

    fetch('/api/firmware/info')
      .then(r => r.json())
      .then(info => {
        setFirmwareReady(info.available)
        if (info.available) setFirmwareSize(info.size)
      })
      .catch(() => setFirmwareReady(false))
  }, [open])

  // Main flash flow
  const handleFlash = async () => {
    setError(null)
    abortRef.current = false
    setPhase('flashing')
    setProgress(0)
    setLog([])

    try {
      // 1. Select serial port
      addLog('Select the ESP32-CAM USB port...')
      const port = await navigator.serial.requestPort()
      await port.open({ baudRate: 115200 })
      portRef.current = port
      addLog('Serial port connected', 'success')
      setProgress(5)

      // 2. Download bundled firmware
      addLog('Downloading firmware...')
      const fwRes = await fetch('/api/firmware/download')
      if (!fwRes.ok) throw new Error('Firmware not available on server')
      const firmwareData = await fwRes.arrayBuffer()
      addLog(`Firmware: ${(firmwareData.byteLength / 1024).toFixed(0)} KB`)
      setProgress(10)

      // 3. Flash
      addLog('Loading esptool...')
      const { ESPLoader, Transport } = await import('esptool-js')

      const transport = new Transport(port, true)
      const loader = new ESPLoader({
        transport,
        baudrate: 115200,
        romBaudrate: 115200,
        terminal: {
          clean() {},
          writeLine(text) { addLog(text, 'serial') },
          write() {},
        },
      })

      addLog('Connecting to ESP32 (hold BOOT if needed)...')
      const chip = await loader.main()
      addLog(`Connected: ${chip}`, 'success')
      setProgress(15)

      addLog('Flashing firmware...')
      await loader.writeFlash({
        fileArray: [{ data: new Uint8Array(firmwareData), address: 0x10000 }],
        flashSize: 'keep',
        flashMode: 'keep',
        flashFreq: 'keep',
        eraseAll: false,
        compress: true,
        reportProgress: (_fi, written, total) => {
          setProgress(15 + Math.round((written / total) * 70))
        },
      })
      setProgress(85)
      addLog('Flash complete!', 'success')

      // 4. Reset and reconnect
      addLog('Resetting device...')
      await loader.hardReset()
      transport.disconnect()
      await port.close()

      addLog('Waiting for reboot...')
      await new Promise(r => setTimeout(r, 2500))

      await port.open({ baudRate: 115200 })
      setProgress(90)

      // 5. Send config
      await sendConfig(port)

    } catch (err) {
      if (err.name === 'NotFoundError') {
        setPhase('config')
        return
      }
      if (!abortRef.current) {
        setError(err.message)
        addLog(`Error: ${err.message}`, 'error')
      }
    }
  }

  const sendConfig = async (port) => {
    if (!port?.readable || !port?.writable) {
      addLog('Port not available — configure device manually via Serial', 'warn')
      setProgress(100)
      setPhase('done')
      return
    }

    const config = {
      wifi_ssid: wifiSsid,
      wifi_pass: wifiPass,
      server_url: customServerUrl || autoServerUrl,
      btn_scan: gpios.btn_scan,
      btn_send: gpios.btn_send,
      btn_reset: gpios.btn_reset,
      led_pin: gpios.led_pin,
      flash_pin: gpios.flash_pin,
      max_pages: maxPages,
    }

    addLog(`WiFi: "${wifiSsid}" | Server: ${config.server_url}`)
    addLog(`GPIO: SCAN=${gpios.btn_scan} SEND=${gpios.btn_send} RESET=${gpios.btn_reset} LED=${gpios.led_pin} Flash=${gpios.flash_pin}`)

    const reader = port.readable.getReader()
    const writer = port.writable.getWriter()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      // Wait for SATSU_READY
      const deadline = Date.now() + 10000
      let gotReady = false
      while (Date.now() < deadline && !gotReady) {
        const { value, done } = await Promise.race([
          reader.read(),
          new Promise(r => setTimeout(() => r({ value: null, done: true }), 1000)),
        ])
        if (value) {
          buffer += decoder.decode(value, { stream: true })
          if (buffer.includes('SATSU_READY') || buffer.includes('SATSU_TIMEOUT')) {
            gotReady = true
            addLog('Device ready for config')
          }
        }
        if (done && !value) break
      }

      setProgress(93)

      // Send config JSON
      await writer.write(new TextEncoder().encode(JSON.stringify(config) + '\n'))
      addLog('Configuration sent...')

      // Wait for confirmation
      buffer = ''
      const okDeadline = Date.now() + 5000
      let confirmed = false
      while (Date.now() < okDeadline && !confirmed) {
        const { value, done } = await Promise.race([
          reader.read(),
          new Promise(r => setTimeout(() => r({ value: null, done: true }), 1000)),
        ])
        if (value) {
          buffer += decoder.decode(value, { stream: true })
          if (buffer.includes('SATSU_OK')) {
            confirmed = true
            addLog('Config saved! Device rebooting...', 'success')
          }
          if (buffer.includes('SATSU_ERROR')) {
            addLog('Device reported config error', 'error')
            break
          }
        }
        if (done && !value) break
      }

      if (!confirmed && !buffer.includes('SATSU_ERROR')) {
        addLog('Config sent (no confirmation). Device should apply it on reboot.', 'warn')
      }

      reader.releaseLock()
      writer.releaseLock()
    } catch (err) {
      try { reader.releaseLock() } catch {}
      try { writer.releaseLock() } catch {}
      addLog(`Config: ${err.message}`, 'warn')
    }

    setProgress(100)
    setPhase('done')
  }

  const handleClose = async () => {
    abortRef.current = true
    try {
      if (portRef.current) {
        await portRef.current.close().catch(() => {})
        portRef.current = null
      }
    } catch {}
    onClose()
  }

  if (!open) return null

  const canFlash = WEB_SERIAL_SUPPORTED && wifiSsid && wifiPass && firmwareReady === true

  return (
    <div className="dialog-overlay" onClick={e => { if (e.target === e.currentTarget) handleClose() }} role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" style={{ maxWidth: 520, maxHeight: '90vh', overflow: 'auto' }}>
        <h2 className="dialog__title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <IconFlash style={{ fontSize: '1.2em' }} />
          Flash ESP32-CAM
        </h2>

        {/* Web Serial warning */}
        {!WEB_SERIAL_SUPPORTED && (
          <div className="flash-alert flash-alert--error">
            {window.isSecureContext
              ? 'Web Serial is not supported. Use Chrome or Edge.'
              : <>
                  Web Serial requires <strong>HTTPS</strong>.
                  {window.location.protocol === 'http:' && (
                    <div style={{ marginTop: 'var(--space-1)' }}>
                      <code style={{ fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }}>
                        VITE_HTTPS=true npm run dev
                      </code>
                      {' '}&rarr;{' '}
                      <a href={`https://${window.location.hostname}:${window.location.port}/devices`}
                        style={{ color: 'inherit', textDecoration: 'underline' }}>
                        https://{window.location.hostname}:{window.location.port}
                      </a>
                    </div>
                  )}
                </>
            }
          </div>
        )}

        {error && <div className="flash-alert flash-alert--error">{error}</div>}

        {/* ===== CONFIG ===== */}
        {phase === 'config' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

            {/* Firmware status */}
            {firmwareReady === null && (
              <div className="flash-badge flash-badge--muted">Checking firmware...</div>
            )}
            {firmwareReady === true && (
              <div className="flash-badge flash-badge--ok">
                Firmware ready ({(firmwareSize / 1024).toFixed(0)} KB)
              </div>
            )}
            {firmwareReady === false && (
              <div className="flash-badge flash-badge--warn">
                Firmware not found on server. Recompile with PlatformIO.
              </div>
            )}

            {/* WiFi */}
            <fieldset className="flash-fieldset">
              <legend className="flash-legend">WiFi</legend>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: 'var(--text-xs)' }}>SSID *</label>
                  <input className="form-input" value={wifiSsid} onChange={e => setWifiSsid(e.target.value)}
                    placeholder="Network name" />
                </div>
                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label" style={{ fontSize: 'var(--text-xs)' }}>Password *</label>
                  <div style={{ position: 'relative' }}>
                    <input className="form-input" type={showPass ? 'text' : 'password'}
                      value={wifiPass} onChange={e => setWifiPass(e.target.value)}
                      placeholder="Password" style={{ paddingRight: 40 }} />
                    <button type="button" onClick={() => setShowPass(!showPass)}
                      className="flash-toggle-pass">
                      {showPass ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
              </div>
            </fieldset>

            {/* Server URL */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ fontSize: 'var(--text-xs)' }}>
                Server URL
              </label>
              <input className="form-input" value={customServerUrl}
                onChange={e => setCustomServerUrl(e.target.value)}
                placeholder={autoServerUrl} style={{ fontSize: 'var(--text-sm)' }} />
            </div>

            {/* Buttons */}
            <fieldset className="flash-fieldset">
              <legend className="flash-legend">Buttons (GPIO)</legend>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-2)' }}>
                {[
                  { key: 'btn_scan', label: 'SCAN' },
                  { key: 'btn_send', label: 'SEND' },
                  { key: 'btn_reset', label: 'RESET' },
                ].map(({ key, label }) => (
                  <div key={key} className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: 'var(--text-xs)' }}>{label}</label>
                    <select className="form-select" value={gpios[key]} onChange={e => setGpio(key, e.target.value)}>
                      {GPIO_OPTIONS.map(g => <option key={g} value={g}>GPIO {g}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </fieldset>

            {/* LEDs */}
            <fieldset className="flash-fieldset">
              <legend className="flash-legend">LEDs (GPIO)</legend>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                {[
                  { key: 'led_pin', label: 'Status LED' },
                  { key: 'flash_pin', label: 'Camera Flash' },
                ].map(({ key, label }) => (
                  <div key={key} className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label" style={{ fontSize: 'var(--text-xs)' }}>{label}</label>
                    <select className="form-select" value={gpios[key]} onChange={e => setGpio(key, e.target.value)}>
                      {GPIO_OPTIONS.map(g => <option key={g} value={g}>GPIO {g}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </fieldset>

            {/* Max pages */}
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" style={{ fontSize: 'var(--text-xs)' }}>Max pages: {maxPages}</label>
              <input type="range" min="1" max="20" value={maxPages}
                onChange={e => setMaxPages(Number(e.target.value))}
                style={{ width: '100%', accentColor: 'var(--color-primary)' }} />
            </div>

            <div className="dialog__actions">
              <button className="btn btn-secondary" onClick={handleClose} type="button">Cancel</button>
              <button className="btn btn-primary" onClick={handleFlash} disabled={!canFlash} type="button">
                Flash ESP32-CAM
              </button>
            </div>
          </div>
        )}

        {/* ===== FLASHING / DONE ===== */}
        {(phase === 'flashing' || phase === 'done') && (
          <div>
            <div style={{
              height: 6, borderRadius: 3, backgroundColor: 'var(--color-bg-elevated)',
              marginBottom: 'var(--space-3)', overflow: 'hidden',
            }}>
              <div style={{
                height: '100%', borderRadius: 3, transition: 'width 0.3s',
                backgroundColor: phase === 'done' ? 'var(--color-success)' : error ? 'var(--color-error)' : 'var(--color-primary)',
                width: `${progress}%`,
              }} />
            </div>

            <div style={{
              fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-semibold)',
              marginBottom: 'var(--space-2)',
              color: phase === 'done' ? 'var(--color-success)' : error ? 'var(--color-error)' : 'var(--color-text)',
            }}>
              {phase === 'done' ? 'Done! Device is rebooting and connecting to WiFi.' :
               error ? 'Flash failed' :
               progress < 15 ? 'Connecting...' :
               progress < 85 ? `Flashing... ${progress}%` :
               progress < 90 ? 'Resetting...' :
               'Sending configuration...'}
            </div>

            <div style={{
              maxHeight: 200, overflow: 'auto', fontFamily: 'var(--font-mono)',
              fontSize: 'var(--text-xs)', backgroundColor: 'var(--color-bg-elevated)',
              borderRadius: 'var(--radius-sm)', padding: 'var(--space-2)', lineHeight: 1.6,
            }}>
              {log.map((entry, i) => (
                <div key={i} style={{
                  color: entry.type === 'error' ? 'var(--color-error)'
                    : entry.type === 'success' ? 'var(--color-success)'
                    : entry.type === 'warn' ? 'var(--color-warning)'
                    : entry.type === 'serial' ? 'var(--color-text-muted)'
                    : 'var(--color-text-secondary)',
                }}>
                  {entry.msg}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>

            <div className="dialog__actions" style={{ marginTop: 'var(--space-3)' }}>
              {phase === 'done' ? (
                <button className="btn btn-primary" onClick={handleClose} type="button">Close</button>
              ) : error ? (
                <>
                  <button className="btn btn-secondary" onClick={handleClose} type="button">Close</button>
                  <button className="btn btn-primary" onClick={() => { setPhase('config'); setError(null) }} type="button">Retry</button>
                </>
              ) : (
                <button className="btn btn-secondary" onClick={handleClose} type="button">Cancel</button>
              )}
            </div>
          </div>
        )}

        <style>{`
          .flash-alert { padding: var(--space-2) var(--space-3); margin-bottom: var(--space-3); border-radius: var(--radius-sm); font-size: var(--text-sm); }
          .flash-alert--error { background: var(--color-error-light); color: var(--color-error-text); }
          .flash-badge { padding: var(--space-1) var(--space-2); border-radius: var(--radius-sm); font-size: var(--text-xs); }
          .flash-badge--ok { background: rgba(16,185,129,0.1); color: var(--color-success); }
          .flash-badge--warn { background: rgba(245,158,11,0.1); color: var(--color-warning); }
          .flash-badge--muted { background: var(--color-bg-elevated); color: var(--color-text-muted); }
          .flash-fieldset { border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: var(--space-3); }
          .flash-legend { font-size: var(--text-sm); font-weight: var(--font-weight-semibold); padding: 0 var(--space-1); }
          .flash-toggle-pass { position: absolute; right: 4px; top: 50%; transform: translateY(-50%); background: none; border: none; cursor: pointer; font-size: var(--text-xs); color: var(--color-text-muted); padding: 4px 6px; }
        `}</style>
      </div>
    </div>
  )
}
