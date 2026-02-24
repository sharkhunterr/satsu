import React, { useContext, useState, useEffect, useCallback } from 'react'

import { ThemeContext, WebSocketContext } from '../App'
import { useToast } from '../components/shared/Toast'
import ConfirmDialog from '../components/shared/ConfirmDialog'
import Spinner from '../components/shared/Spinner'

/* ==========================================================================
   Constants
   ========================================================================== */

const TABS = [
  { key: 'general', label: 'General' },
  { key: 'capture', label: 'Capture' },
  { key: 'processing', label: 'Processing' },
  { key: 'storage', label: 'Storage' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'logs', label: 'Logs' },
  { key: 'system', label: 'System' },
]

const DEFAULT_CONFIG = {
  general: {
    server_name: 'ESPScanCam',
    language: 'en',
    timezone: 'UTC',
    theme: 'auto',
    auto_process: true,
    auto_export: false,
    default_profile: 'default',
    api_key_enabled: false,
    api_key: '',
  },
  capture: {
    resolution: '1920x1080',
    timer: 0,
    capture_sound: true,
    burst_mode: false,
    grid_overlay: false,
    max_file_size_mb: 20,
    allowed_formats: ['jpeg', 'png'],
    client_compression: false,
    compression_quality: 85,
  },
  processing: {},
  storage: {
    backends: [],
    filename_template: '{date}_{batch_id}',
    retention_days: 0,
  },
  notifications: {
    toast_duration: 5000,
    sound_enabled: true,
  },
  logs: {
    retention_days: 30,
    min_level: 'INFO',
    auto_cleanup: true,
  },
  system: {
    port: 8000,
    version: '0.1.0',
  },
}

const PIPELINE_STEPS = [
  { key: 'auto_crop', label: 'Auto-crop', description: 'Detects document edges and applies perspective correction to produce a flat, rectangular image.' },
  { key: 'deskew', label: 'Deskew', description: 'Straightens tilted scans by detecting dominant text/edge angles using Hough lines.' },
  { key: 'denoise', label: 'Denoise', description: 'Reduces image noise with a light Gaussian blur. Useful for noisy phone cameras.' },
  { key: 'clahe', label: 'CLAHE', description: 'Contrast Limited Adaptive Histogram Equalization — enhances local contrast to make faded text more readable.' },
  { key: 'sharpen', label: 'Sharpen', description: 'Applies unsharp mask sharpening to make text edges crisper.' },
  { key: 'white_balance', label: 'White Balance', description: 'Normalizes paper illumination so the background becomes uniformly white, removing shadows and lighting gradients.' },
  { key: 'bw_mode', label: 'Color Mode', description: 'Controls the output color space: keep original colors, convert to grayscale, or pure black & white for text documents.' },
  { key: 'output', label: 'Output', description: 'Controls the final output format, compression quality, and resolution.' },
]

const STORAGE_TYPES = [
  { value: 'local', label: 'Local' },
  { value: 'paperless', label: 'Paperless' },
  { value: 'webdav', label: 'WebDAV' },
  { value: 'gdrive', label: 'Google Drive' },
  { value: 'smb', label: 'SMB' },
]

/* ==========================================================================
   Helpers
   ========================================================================== */

function deepMerge(target, source) {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object' &&
      !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(target[key], source[key])
    } else {
      result[key] = source[key]
    }
  }
  return result
}

function makeDefaultProfile() {
  return {
    name: '',
    is_default: false,
    steps: {
      auto_crop: { enabled: false, sensitivity: 50 },
      deskew: { enabled: false, max_angle: 15 },
      denoise: { enabled: false, strength: 10 },
      clahe: { enabled: false, clip_limit: 2.0, grid_size: 8 },
      sharpen: { enabled: false, amount: 1.0 },
      white_balance: { enabled: false, strength: 75 },
      bw_mode: { enabled: true, mode: 'color', method: 'adaptive', block_size: 21, constant: 10 },
      output: { enabled: true, format: 'pdf', quality: 85, dpi: 300 },
    },
    storage: { enabled: false, backends: [] },
  }
}

function makeDefaultBackend(type) {
  const base = { type, enabled: true }
  switch (type) {
    case 'local':
      return { ...base, path: '' }
    case 'paperless':
      return { ...base, url: '', token: '' }
    case 'webdav':
      return { ...base, url: '', username: '', password: '', path: '/' }
    case 'gdrive':
      return { ...base, service_account_json: '', folder_id: '' }
    case 'smb':
      return { ...base, share: '', path: '/', username: '', password: '' }
    default:
      return base
  }
}

/* ==========================================================================
   Settings Page
   ========================================================================== */

export default function Settings() {
  const themeCtx = useContext(ThemeContext)
  const ws = useContext(WebSocketContext)
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [settings, setSettings] = useState(DEFAULT_CONFIG)
  const [profiles, setProfiles] = useState([])
  const [activeTab, setActiveTab] = useState('general')

  // Profile editing modal
  const [editingProfile, setEditingProfile] = useState(null)
  const [profileDraft, setProfileDraft] = useState(null)

  // Storage backend modal
  const [editingBackend, setEditingBackend] = useState(null) // index or 'new'
  const [backendDraft, setBackendDraft] = useState(null)
  const [testingConnection, setTestingConnection] = useState(false)
  const [testResult, setTestResult] = useState(null)

  // Reset confirm dialog
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  /* ------------------------------------------------------------------
     Fetch settings on mount
     ------------------------------------------------------------------ */

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSettings(deepMerge(DEFAULT_CONFIG, data))
    } catch (err) {
      toast.error('Failed to load settings: ' + err.message)
    } finally {
      setLoading(false)
    }
  }, [toast])

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/profiles')
      if (!res.ok) return
      const data = await res.json()
      setProfiles(data)
    } catch {
      // Non-critical
    }
  }, [])

  useEffect(() => {
    fetchSettings()
    fetchProfiles()
  }, [fetchSettings, fetchProfiles])

  /* ------------------------------------------------------------------
     WebSocket: config_changed
     ------------------------------------------------------------------ */

  useEffect(() => {
    if (!ws?.subscribe) return

    const unsub = ws.subscribe('config_changed', (data) => {
      if (data.section) {
        fetchSettings()
      }
    })

    return () => unsub()
  }, [ws, fetchSettings])

  /* ------------------------------------------------------------------
     Save helpers
     ------------------------------------------------------------------ */

  const patchSection = useCallback(
    async (section, values) => {
      try {
        const res = await fetch(`/api/settings/${section}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(values),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        toast.success('Settings saved')
      } catch (err) {
        toast.error('Failed to save: ' + err.message)
      }
    },
    [toast],
  )

  const updateField = useCallback(
    (section, field, value) => {
      setSettings((prev) => ({
        ...prev,
        [section]: {
          ...prev[section],
          [field]: value,
        },
      }))
      patchSection(section, { [field]: value })
    },
    [patchSection],
  )

  /* ------------------------------------------------------------------
     Theme integration
     ------------------------------------------------------------------ */

  const handleThemeChange = useCallback(
    (value) => {
      updateField('general', 'theme', value)
      if (value === 'light' || value === 'dark') {
        // Directly apply via ThemeContext
        if (themeCtx?.theme !== value) {
          themeCtx?.toggleTheme()
        }
      } else if (value === 'auto') {
        // Remove manual override, let OS preference drive it
        localStorage.removeItem('espscancam-theme')
        const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
        const desired = prefersDark ? 'dark' : 'light'
        if (themeCtx?.theme !== desired) {
          themeCtx?.toggleTheme()
        }
      }
    },
    [updateField, themeCtx],
  )

  /* ------------------------------------------------------------------
     Profile CRUD
     ------------------------------------------------------------------ */

  const handleEditProfile = useCallback((profile) => {
    setEditingProfile(profile.id || profile.name)
    // Normalize: API returns `options`, frontend draft uses `steps`
    const copy = JSON.parse(JSON.stringify(profile))
    if (copy.options && !copy.steps) {
      const { storage, ...pipelineSteps } = copy.options
      copy.steps = pipelineSteps
      copy.storage = storage || { enabled: false, backends: [] }
      delete copy.options
    }
    if (!copy.storage) {
      copy.storage = { enabled: false, backends: [] }
    }
    setProfileDraft(copy)
  }, [])

  const handleCreateProfile = useCallback(() => {
    const newProfile = makeDefaultProfile()
    newProfile.name = 'New Profile'
    setEditingProfile('__new__')
    setProfileDraft(newProfile)
  }, [])

  const handleSaveProfile = useCallback(async () => {
    if (!profileDraft) return
    try {
      const method = editingProfile === '__new__' ? 'POST' : 'PUT'
      const url =
        editingProfile === '__new__'
          ? '/api/settings/profiles'
          : `/api/settings/profiles/${encodeURIComponent(editingProfile)}`
      // Convert steps → options for the API
      const { steps, storage, ...rest } = profileDraft
      const options = { ...steps }
      if (storage && storage.enabled && storage.backends?.length > 0) {
        options.storage = storage
      }
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...rest, options }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      toast.success('Profile saved')
      setEditingProfile(null)
      setProfileDraft(null)
      fetchProfiles()
    } catch (err) {
      toast.error('Failed to save profile: ' + err.message)
    }
  }, [editingProfile, profileDraft, toast, fetchProfiles])

  const handleDeleteProfile = useCallback(
    async (name) => {
      try {
        const res = await fetch(`/api/settings/profiles/${encodeURIComponent(name)}`, {
          method: 'DELETE',
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        toast.success('Profile deleted')
        fetchProfiles()
      } catch (err) {
        toast.error('Failed to delete profile: ' + err.message)
      }
    },
    [toast, fetchProfiles],
  )

  const handleDuplicateProfile = useCallback(
    async (profile) => {
      try {
        const copy = {
          name: profile.name + ' (copy)',
          is_default: false,
          options: profile.options || profile.steps || {},
        }
        const res = await fetch('/api/settings/profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(copy),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        toast.success('Profile duplicated')
        fetchProfiles()
      } catch (err) {
        toast.error('Failed to duplicate: ' + err.message)
      }
    },
    [toast, fetchProfiles],
  )

  const handleSetDefault = useCallback(
    async (name) => {
      try {
        const res = await fetch(`/api/settings/profiles/${encodeURIComponent(name)}/default`, {
          method: 'PUT',
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        toast.success(`"${name}" set as default profile`)
        fetchProfiles()
      } catch (err) {
        toast.error('Failed to set default: ' + err.message)
      }
    },
    [toast, fetchProfiles],
  )

  /* ------------------------------------------------------------------
     Storage backend CRUD
     ------------------------------------------------------------------ */

  const handleAddBackend = useCallback(() => {
    setEditingBackend('new')
    setBackendDraft(makeDefaultBackend('local'))
    setTestResult(null)
  }, [])

  const handleEditBackend = useCallback((index) => {
    setEditingBackend(index)
    setBackendDraft(JSON.parse(JSON.stringify(settings.storage.backends[index])))
    setTestResult(null)
  }, [settings.storage.backends])

  const handleSaveBackend = useCallback(() => {
    if (!backendDraft) return
    setSettings((prev) => {
      const backends = [...(prev.storage.backends || [])]
      if (editingBackend === 'new') {
        backends.push(backendDraft)
      } else {
        backends[editingBackend] = backendDraft
      }
      const newStorage = { ...prev.storage, backends }
      patchSection('storage', { backends })
      return { ...prev, storage: newStorage }
    })
    setEditingBackend(null)
    setBackendDraft(null)
    setTestResult(null)
  }, [editingBackend, backendDraft, patchSection])

  const handleRemoveBackend = useCallback(() => {
    if (editingBackend === 'new') {
      setEditingBackend(null)
      setBackendDraft(null)
      return
    }
    setSettings((prev) => {
      const backends = prev.storage.backends.filter((_, i) => i !== editingBackend)
      const newStorage = { ...prev.storage, backends }
      patchSection('storage', { backends })
      return { ...prev, storage: newStorage }
    })
    setEditingBackend(null)
    setBackendDraft(null)
    setTestResult(null)
  }, [editingBackend, patchSection])

  const handleTestConnection = useCallback(async () => {
    if (!backendDraft) return
    setTestingConnection(true)
    setTestResult(null)
    try {
      const res = await fetch('/api/settings/test-storage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backendDraft),
      })
      const data = await res.json()
      setTestResult(data)
    } catch (err) {
      setTestResult({ success: false, message: err.message })
    } finally {
      setTestingConnection(false)
    }
  }, [backendDraft])

  /* ------------------------------------------------------------------
     System actions
     ------------------------------------------------------------------ */

  const handleBackup = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/backup', { method: 'POST' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `espscancam-config-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('Configuration backup downloaded')
    } catch (err) {
      toast.error('Backup failed: ' + err.message)
    }
  }, [toast])

  const handleRestore = useCallback(
    async (e) => {
      const file = e.target.files?.[0]
      if (!file) return
      try {
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch('/api/settings/restore', {
          method: 'POST',
          body: formData,
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        toast.success('Configuration restored. Reloading settings...')
        fetchSettings()
        fetchProfiles()
      } catch (err) {
        toast.error('Restore failed: ' + err.message)
      }
      e.target.value = ''
    },
    [toast, fetchSettings, fetchProfiles],
  )

  const handleResetDefaults = useCallback(async () => {
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(DEFAULT_CONFIG),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSettings(DEFAULT_CONFIG)
      toast.success('Settings reset to defaults')
    } catch (err) {
      toast.error('Reset failed: ' + err.message)
    }
    setShowResetConfirm(false)
  }, [toast])

  /* ------------------------------------------------------------------
     Profile step updater
     ------------------------------------------------------------------ */

  const updateProfileStep = useCallback((stepKey, field, value) => {
    setProfileDraft((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        steps: {
          ...prev.steps,
          [stepKey]: {
            ...prev.steps[stepKey],
            [field]: value,
          },
        },
      }
    })
  }, [])

  /* ------------------------------------------------------------------
     Render: Loading
     ------------------------------------------------------------------ */

  if (loading) {
    return (
      <div className="main-content__inner">
        <Spinner fullPage label="Loading settings" />
      </div>
    )
  }

  /* ------------------------------------------------------------------
     Render: Tab Content
     ------------------------------------------------------------------ */

  function renderTabContent() {
    switch (activeTab) {
      case 'general':
        return renderGeneral()
      case 'capture':
        return renderCapture()
      case 'processing':
        return renderProcessing()
      case 'storage':
        return renderStorage()
      case 'notifications':
        return renderNotifications()
      case 'logs':
        return renderLogs()
      case 'system':
        return renderSystem()
      default:
        return null
    }
  }

  /* ---- General Tab ---- */

  function renderGeneral() {
    const g = settings.general
    return (
      <div>
        <div className="form-group">
          <label className="form-label">Server Name</label>
          <input
            type="text"
            className="form-input"
            value={g.server_name}
            onChange={(e) => updateField('general', 'server_name', e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Language</label>
          <select
            className="form-select"
            value={g.language}
            onChange={(e) => updateField('general', 'language', e.target.value)}
          >
            <option value="en">English</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Timezone</label>
          <input
            type="text"
            className="form-input"
            placeholder="UTC"
            value={g.timezone}
            onChange={(e) => updateField('general', 'timezone', e.target.value)}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Theme</label>
          <select
            className="form-select"
            value={g.theme}
            onChange={(e) => handleThemeChange(e.target.value)}
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="auto">Auto (System)</option>
          </select>
        </div>

        <div className="form-group">
          <label style={styles.toggleRow}>
            <span className="form-label" style={{ marginBottom: 0 }}>Auto-process</span>
            <input
              type="checkbox"
              checked={g.auto_process}
              onChange={(e) => updateField('general', 'auto_process', e.target.checked)}
            />
          </label>
        </div>

        <div className="form-group">
          <label style={styles.toggleRow}>
            <span className="form-label" style={{ marginBottom: 0 }}>Auto-export</span>
            <input
              type="checkbox"
              checked={g.auto_export}
              onChange={(e) => updateField('general', 'auto_export', e.target.checked)}
            />
          </label>
        </div>

        <div className="form-group">
          <label className="form-label">Default Profile</label>
          <select
            className="form-select"
            value={g.default_profile}
            onChange={(e) => updateField('general', 'default_profile', e.target.value)}
          >
            {profiles.length === 0 && <option value="default">Default</option>}
            {profiles.map((p) => (
              <option key={p.name} value={p.name}>
                {p.name}
                {p.is_default ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label style={styles.toggleRow}>
            <span className="form-label" style={{ marginBottom: 0 }}>API Key Enabled</span>
            <input
              type="checkbox"
              checked={g.api_key_enabled}
              onChange={(e) => updateField('general', 'api_key_enabled', e.target.checked)}
            />
          </label>
        </div>

        {g.api_key_enabled && (
          <div className="form-group">
            <label className="form-label">API Key</label>
            <input
              type="text"
              className="form-input"
              style={{ fontFamily: 'var(--font-mono)' }}
              value={g.api_key}
              onChange={(e) => updateField('general', 'api_key', e.target.value)}
              placeholder="Enter API key..."
            />
          </div>
        )}
      </div>
    )
  }

  /* ---- Capture Tab ---- */

  function renderCapture() {
    const c = settings.capture
    return (
      <div>
        <div className="form-group">
          <label className="form-label">Camera Resolution</label>
          <select
            className="form-select"
            value={c.resolution}
            onChange={(e) => updateField('capture', 'resolution', e.target.value)}
          >
            <option value="1920x1080">1920 x 1080</option>
            <option value="1280x720">1280 x 720</option>
            <option value="640x480">640 x 480</option>
          </select>
        </div>

        <div className="form-group">
          <label className="form-label">Timer (seconds)</label>
          <select
            className="form-select"
            value={c.timer}
            onChange={(e) => updateField('capture', 'timer', Number(e.target.value))}
          >
            <option value={0}>Off</option>
            <option value={3}>3s</option>
            <option value={5}>5s</option>
            <option value={10}>10s</option>
          </select>
        </div>

        <div className="form-group">
          <label style={styles.toggleRow}>
            <span className="form-label" style={{ marginBottom: 0 }}>Capture Sound</span>
            <input
              type="checkbox"
              checked={c.capture_sound}
              onChange={(e) => updateField('capture', 'capture_sound', e.target.checked)}
            />
          </label>
        </div>

        <div className="form-group">
          <label style={styles.toggleRow}>
            <span className="form-label" style={{ marginBottom: 0 }}>Burst Mode</span>
            <input
              type="checkbox"
              checked={c.burst_mode}
              onChange={(e) => updateField('capture', 'burst_mode', e.target.checked)}
            />
          </label>
        </div>

        <div className="form-group">
          <label style={styles.toggleRow}>
            <span className="form-label" style={{ marginBottom: 0 }}>Grid Overlay</span>
            <input
              type="checkbox"
              checked={c.grid_overlay}
              onChange={(e) => updateField('capture', 'grid_overlay', e.target.checked)}
            />
          </label>
        </div>

        <div className="form-group">
          <label className="form-label">Max File Size (MB)</label>
          <input
            type="number"
            className="form-input"
            min={1}
            max={100}
            value={c.max_file_size_mb}
            onChange={(e) => updateField('capture', 'max_file_size_mb', Number(e.target.value))}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Allowed Formats</label>
          <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
            {['jpeg', 'png', 'webp', 'heic'].map((fmt) => (
              <label key={fmt} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={(c.allowed_formats || []).includes(fmt)}
                  onChange={(e) => {
                    const current = c.allowed_formats || []
                    const next = e.target.checked
                      ? [...current, fmt]
                      : current.filter((f) => f !== fmt)
                    updateField('capture', 'allowed_formats', next)
                  }}
                />
                <span style={{ fontSize: 'var(--text-sm)', textTransform: 'uppercase' }}>{fmt}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="form-group">
          <label style={styles.toggleRow}>
            <span className="form-label" style={{ marginBottom: 0 }}>Client Compression</span>
            <input
              type="checkbox"
              checked={c.client_compression}
              onChange={(e) => updateField('capture', 'client_compression', e.target.checked)}
            />
          </label>
        </div>

        {c.client_compression && (
          <div className="form-group">
            <label className="form-label">
              Compression Quality: {c.compression_quality}%
            </label>
            <input
              type="range"
              min={60}
              max={95}
              step={1}
              value={c.compression_quality}
              onChange={(e) => updateField('capture', 'compression_quality', Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <div style={styles.rangeLabels}>
              <span>60%</span>
              <span>95%</span>
            </div>
          </div>
        )}
      </div>
    )
  }

  /* ---- Processing Tab ---- */

  function renderProcessing() {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <h3 style={styles.sectionTitle}>Processing Profiles</h3>
          <button className="btn btn-primary btn--sm" onClick={handleCreateProfile}>
            Create Profile
          </button>
        </div>

        {profiles.length === 0 ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
            No profiles configured. Create one to get started.
          </div>
        ) : (
          <div className="list-stack">
            {profiles.map((profile) => (
              <div key={profile.name} className="card" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span style={{ fontWeight: 'var(--font-weight-semibold)', fontSize: 'var(--text-sm)' }}>
                      {profile.name}
                    </span>
                    {profile.is_default && (
                      <span className="badge badge-completed">Default</span>
                    )}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  <button className="btn btn-secondary btn--sm" onClick={() => handleEditProfile(profile)}>
                    Edit
                  </button>
                  <button className="btn btn-secondary btn--sm" onClick={() => handleDuplicateProfile(profile)}>
                    Duplicate
                  </button>
                  {!profile.is_default && (
                    <button className="btn btn-secondary btn--sm" onClick={() => handleSetDefault(profile.id)}>
                      Set Default
                    </button>
                  )}
                  <button className="btn btn-danger btn--sm" onClick={() => handleDeleteProfile(profile.id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ---- Profile Edit Modal ---- */}
        {editingProfile !== null && profileDraft && (
          <div className="dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setEditingProfile(null); setProfileDraft(null) } }} role="presentation">
            <div className="dialog" style={{ maxWidth: '600px', maxHeight: '90vh', overflowY: 'auto' }}>
              <h2 className="dialog__title">
                {editingProfile === '__new__' ? 'Create Profile' : `Edit: ${profileDraft?.name || editingProfile}`}
              </h2>

              <div className="form-group">
                <label className="form-label">Profile Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={profileDraft.name}
                  onChange={(e) => setProfileDraft((prev) => ({ ...prev, name: e.target.value }))}
                />
              </div>

              <h3 style={{ ...styles.sectionTitle, marginTop: 'var(--space-4)' }}>Pipeline Steps</h3>

              {PIPELINE_STEPS.map((step) => {
                const stepData = profileDraft.steps?.[step.key] || {}
                const isColorMode = step.key === 'bw_mode'
                const enabled = isColorMode ? true : (stepData.enabled ?? false)
                return (
                  <div key={step.key} style={styles.pipelineStep}>
                    {isColorMode ? (
                      <div style={{ fontWeight: 'var(--font-weight-semibold)', fontSize: 'var(--text-sm)' }}>
                        {step.label}
                      </div>
                    ) : (
                      <label style={styles.toggleRow}>
                        <span style={{ fontWeight: 'var(--font-weight-semibold)', fontSize: 'var(--text-sm)' }}>
                          {step.label}
                        </span>
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={(e) => updateProfileStep(step.key, 'enabled', e.target.checked)}
                        />
                      </label>
                    )}
                    {step.description && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
                        {step.description}
                      </div>
                    )}

                    {enabled && renderStepParams(step.key, stepData)}
                  </div>
                )
              })}

              {/* Storage backends section */}
              {(() => {
                const enabledBackends = (settings.storage?.backends || []).filter((b) => b.enabled)
                if (enabledBackends.length === 0) return null
                const draftStorage = profileDraft.storage || { enabled: false, backends: [] }
                const selectedBackends = draftStorage.backends || []
                return (
                  <>
                    <h3 style={{ ...styles.sectionTitle, marginTop: 'var(--space-4)' }}>Storage</h3>
                    <div style={styles.pipelineStep}>
                      <label style={styles.toggleRow}>
                        <span style={{ fontWeight: 'var(--font-weight-semibold)', fontSize: 'var(--text-sm)' }}>
                          Enable auto-storage
                        </span>
                        <input
                          type="checkbox"
                          checked={draftStorage.enabled ?? false}
                          onChange={(e) => setProfileDraft((prev) => ({
                            ...prev,
                            storage: { ...prev.storage, enabled: e.target.checked },
                          }))}
                        />
                      </label>
                      {draftStorage.enabled && (
                        <div style={{ marginTop: 'var(--space-3)' }}>
                          {enabledBackends.map((backend) => {
                            const typeLabel = STORAGE_TYPES.find((t) => t.value === backend.type)?.label || backend.type
                            const detail = backend.url || backend.path || backend.share || ''
                            const isSelected = selectedBackends.includes(backend.type)
                            return (
                              <label key={backend.type} style={{
                                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                                padding: 'var(--space-2) 0', cursor: 'pointer',
                              }}>
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => {
                                    setProfileDraft((prev) => {
                                      const current = prev.storage?.backends || []
                                      const next = e.target.checked
                                        ? [...current, backend.type]
                                        : current.filter((b) => b !== backend.type)
                                      return { ...prev, storage: { ...prev.storage, backends: next } }
                                    })
                                  }}
                                />
                                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-weight-medium)' }}>
                                  {typeLabel}
                                </span>
                                {detail && (
                                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)' }}>
                                    ({detail})
                                  </span>
                                )}
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  </>
                )
              })()}

              <div className="dialog__actions" style={{ marginTop: 'var(--space-5)' }}>
                <button className="btn btn-secondary" onClick={() => { setEditingProfile(null); setProfileDraft(null) }}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={handleSaveProfile}>
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  function renderStepParams(stepKey, stepData) {
    switch (stepKey) {
      case 'auto_crop':
        return (
          <div className="form-group" style={{ marginTop: 'var(--space-2)', marginBottom: 0 }}>
            <label className="form-label">Sensitivity: {stepData.sensitivity ?? 50}</label>
            <span className="form-hint">How aggressively the algorithm searches for document edges. Higher values detect fainter edges but may produce false positives.</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={stepData.sensitivity ?? 50}
              onChange={(e) => updateProfileStep(stepKey, 'sensitivity', Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <div style={styles.rangeLabels}><span>0 (conservative)</span><span>100 (aggressive)</span></div>
          </div>
        )
      case 'deskew':
        return (
          <div className="form-group" style={{ marginTop: 'var(--space-2)', marginBottom: 0 }}>
            <label className="form-label">Max Angle: {stepData.max_angle ?? 15}&deg;</label>
            <span className="form-hint">Maximum rotation angle allowed for straightening. Skew beyond this limit is ignored to avoid over-correction.</span>
            <input
              type="range"
              min={0}
              max={45}
              step={1}
              value={stepData.max_angle ?? 15}
              onChange={(e) => updateProfileStep(stepKey, 'max_angle', Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <div style={styles.rangeLabels}><span>0&deg;</span><span>45&deg;</span></div>
          </div>
        )
      case 'denoise':
        return (
          <div className="form-group" style={{ marginTop: 'var(--space-2)', marginBottom: 0 }}>
            <label className="form-label">Strength: {stepData.strength ?? 10}</label>
            <span className="form-hint">Blur kernel size. Higher values remove more noise but also reduce fine detail and text sharpness.</span>
            <input
              type="range"
              min={0}
              max={30}
              step={1}
              value={stepData.strength ?? 10}
              onChange={(e) => updateProfileStep(stepKey, 'strength', Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <div style={styles.rangeLabels}><span>0 (off)</span><span>30 (heavy)</span></div>
          </div>
        )
      case 'clahe':
        return (
          <div style={{ marginTop: 'var(--space-2)' }}>
            <div className="form-group" style={{ marginBottom: 'var(--space-2)' }}>
              <label className="form-label">Clip Limit: {stepData.clip_limit ?? 2.0}</label>
              <span className="form-hint">Controls the contrast amplification limit. Higher values produce stronger contrast but can amplify noise.</span>
              <input
                type="range"
                min={0.5}
                max={10}
                step={0.5}
                value={stepData.clip_limit ?? 2.0}
                onChange={(e) => updateProfileStep(stepKey, 'clip_limit', Number(e.target.value))}
                style={{ width: '100%' }}
              />
              <div style={styles.rangeLabels}><span>0.5 (subtle)</span><span>10 (strong)</span></div>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Grid Size: {stepData.grid_size ?? 8}</label>
              <span className="form-hint">Number of tiles for local contrast computation. Smaller grids adapt to finer regions, larger grids give smoother results.</span>
              <input
                type="range"
                min={2}
                max={16}
                step={1}
                value={stepData.grid_size ?? 8}
                onChange={(e) => updateProfileStep(stepKey, 'grid_size', Number(e.target.value))}
                style={{ width: '100%' }}
              />
              <div style={styles.rangeLabels}><span>2 (fine)</span><span>16 (coarse)</span></div>
            </div>
          </div>
        )
      case 'sharpen':
        return (
          <div className="form-group" style={{ marginTop: 'var(--space-2)', marginBottom: 0 }}>
            <label className="form-label">Amount: {stepData.amount ?? 1.0}</label>
            <span className="form-hint">Sharpening intensity (unsharp mask). Values above 2.0 can create visible halos around text edges.</span>
            <input
              type="range"
              min={0}
              max={5}
              step={0.1}
              value={stepData.amount ?? 1.0}
              onChange={(e) => updateProfileStep(stepKey, 'amount', Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <div style={styles.rangeLabels}><span>0 (off)</span><span>5 (extreme)</span></div>
          </div>
        )
      case 'white_balance':
        return (
          <div className="form-group" style={{ marginTop: 'var(--space-2)', marginBottom: 0 }}>
            <label className="form-label">Strength: {stepData.strength ?? 75}%</label>
            <span className="form-hint">Blend between original image and fully normalized paper. Lower values preserve light-colored text and images; higher values produce whiter, more uniform paper.</span>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={stepData.strength ?? 75}
              onChange={(e) => updateProfileStep(stepKey, 'strength', Number(e.target.value))}
              style={{ width: '100%' }}
            />
            <div style={styles.rangeLabels}><span>0% (original)</span><span>100% (full whitening)</span></div>
          </div>
        )
      case 'bw_mode':
        return (
          <div style={{ marginTop: 'var(--space-2)' }}>
            <div className="form-group" style={{ marginBottom: 'var(--space-2)' }}>
              <label className="form-label">Mode</label>
              <select
                className="form-select"
                value={stepData.mode ?? (stepData.enabled === false ? 'color' : 'bw')}
                onChange={(e) => {
                  updateProfileStep(stepKey, 'mode', e.target.value)
                  updateProfileStep(stepKey, 'enabled', true)
                }}
              >
                <option value="color">Color (original)</option>
                <option value="grayscale">Grayscale</option>
                <option value="bw">Black & White</option>
              </select>
            </div>
            {(stepData.mode ?? (stepData.enabled === false ? 'color' : 'bw')) === 'bw' && (
              <>
                <div className="form-group" style={{ marginBottom: 'var(--space-2)' }}>
                  <label className="form-label">Method</label>
                  <span className="form-hint">Adaptive works best for most documents. Otsu is simpler but struggles with uneven lighting. Simple uses a fixed threshold.</span>
                  <select
                    className="form-select"
                    value={stepData.method ?? 'adaptive'}
                    onChange={(e) => updateProfileStep(stepKey, 'method', e.target.value)}
                  >
                    <option value="adaptive">Adaptive</option>
                    <option value="otsu">Otsu</option>
                    <option value="simple">Simple</option>
                  </select>
                </div>
                {(stepData.method ?? 'adaptive') === 'adaptive' && (
                  <>
                    <div className="form-group" style={{ marginBottom: 'var(--space-2)' }}>
                      <label className="form-label">Block Size: {stepData.block_size ?? 21}</label>
                      <span className="form-hint">Size of the local neighborhood used for threshold calculation. Larger blocks handle gradients better but can lose fine detail.</span>
                      <input
                        type="range"
                        min={3}
                        max={51}
                        step={2}
                        value={stepData.block_size ?? 21}
                        onChange={(e) => updateProfileStep(stepKey, 'block_size', Number(e.target.value))}
                        style={{ width: '100%' }}
                      />
                      <div style={styles.rangeLabels}><span>3</span><span>51</span></div>
                    </div>
                    <div className="form-group" style={{ marginBottom: 0 }}>
                      <label className="form-label">Constant: {stepData.constant ?? 10}</label>
                      <span className="form-hint">Value subtracted from the local mean. Higher values make more pixels white, useful for faded text. Lower values keep more detail but may add noise.</span>
                      <input
                        type="range"
                        min={0}
                        max={20}
                        step={1}
                        value={stepData.constant ?? 10}
                        onChange={(e) => updateProfileStep(stepKey, 'constant', Number(e.target.value))}
                        style={{ width: '100%' }}
                      />
                      <div style={styles.rangeLabels}><span>0 (more detail)</span><span>20 (cleaner)</span></div>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )
      case 'output':
        return (
          <div style={{ marginTop: 'var(--space-2)' }}>
            <div className="form-group" style={{ marginBottom: 'var(--space-2)' }}>
              <label className="form-label">Format</label>
              <span className="form-hint">PDF is recommended for multi-page documents. JPEG for photos, PNG for lossless quality.</span>
              <select
                className="form-select"
                value={stepData.format ?? 'pdf'}
                onChange={(e) => updateProfileStep(stepKey, 'format', e.target.value)}
              >
                <option value="pdf">PDF</option>
                <option value="jpeg">JPEG</option>
                <option value="png">PNG</option>
              </select>
            </div>
            <div className="form-group" style={{ marginBottom: 'var(--space-2)' }}>
              <label className="form-label">Quality: {stepData.quality ?? 85}</label>
              <span className="form-hint">Compression quality for JPEG/PDF. Lower values reduce file size but may introduce artifacts.</span>
              <input
                type="range"
                min={1}
                max={100}
                step={1}
                value={stepData.quality ?? 85}
                onChange={(e) => updateProfileStep(stepKey, 'quality', Number(e.target.value))}
                style={{ width: '100%' }}
              />
              <div style={styles.rangeLabels}><span>1 (smallest)</span><span>100 (best)</span></div>
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">DPI: {stepData.dpi ?? 300}</label>
              <span className="form-hint">Output resolution in dots per inch. 300 DPI is standard for printing, 150 DPI is sufficient for screen viewing.</span>
              <input
                type="number"
                className="form-input"
                min={72}
                max={1200}
                value={stepData.dpi ?? 300}
                onChange={(e) => updateProfileStep(stepKey, 'dpi', Number(e.target.value))}
              />
            </div>
          </div>
        )
      default:
        return null
    }
  }

  /* ---- Storage Tab ---- */

  function renderStorage() {
    const s = settings.storage
    const backends = s.backends || []
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
          <h3 style={styles.sectionTitle}>Storage Backends</h3>
          <button className="btn btn-primary btn--sm" onClick={handleAddBackend}>
            Add Backend
          </button>
        </div>

        {backends.length === 0 ? (
          <div style={{ color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)', marginBottom: 'var(--space-4)' }}>
            No storage backends configured.
          </div>
        ) : (
          <div className="list-stack" style={{ marginBottom: 'var(--space-4)' }}>
            {backends.map((backend, idx) => (
              <div key={idx} className="card" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span style={{ fontWeight: 'var(--font-weight-semibold)', fontSize: 'var(--text-sm)', textTransform: 'capitalize' }}>
                      {backend.type}
                    </span>
                    <span className={`badge ${backend.enabled ? 'badge-completed' : ''}`}>
                      {backend.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-muted)', marginTop: 'var(--space-1)' }}>
                    {backend.url || backend.path || backend.share || '-'}
                  </div>
                </div>
                <button className="btn btn-secondary btn--sm" onClick={() => handleEditBackend(idx)}>
                  Edit
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="form-group">
          <label className="form-label">Filename Template</label>
          <input
            type="text"
            className="form-input"
            style={{ fontFamily: 'var(--font-mono)' }}
            value={s.filename_template}
            onChange={(e) => updateField('storage', 'filename_template', e.target.value)}
          />
          <span className="form-hint">
            Variables: {'{date}'}, {'{batch_id}'}, {'{page_num}'}, {'{profile}'}, {'{format}'}
          </span>
        </div>

        <div className="form-group">
          <label className="form-label">Retention (days)</label>
          <input
            type="number"
            className="form-input"
            min={0}
            value={s.retention_days}
            onChange={(e) => updateField('storage', 'retention_days', Number(e.target.value))}
          />
          <span className="form-hint">0 = no automatic retention / keep forever</span>
        </div>

        {/* ---- Backend Edit Modal ---- */}
        {editingBackend !== null && backendDraft && (
          <div className="dialog-overlay" onClick={(e) => { if (e.target === e.currentTarget) { setEditingBackend(null); setBackendDraft(null); setTestResult(null) } }} role="presentation">
            <div className="dialog" style={{ maxWidth: '520px', maxHeight: '90vh', overflowY: 'auto' }}>
              <h2 className="dialog__title">
                {editingBackend === 'new' ? 'Add Storage Backend' : 'Edit Storage Backend'}
              </h2>

              <div className="form-group">
                <label className="form-label">Type</label>
                <select
                  className="form-select"
                  value={backendDraft.type}
                  onChange={(e) => setBackendDraft(makeDefaultBackend(e.target.value))}
                >
                  {STORAGE_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              {renderBackendFields()}

              <div className="form-group">
                <label style={styles.toggleRow}>
                  <span className="form-label" style={{ marginBottom: 0 }}>Enabled</span>
                  <input
                    type="checkbox"
                    checked={backendDraft.enabled}
                    onChange={(e) => setBackendDraft((prev) => ({ ...prev, enabled: e.target.checked }))}
                  />
                </label>
              </div>

              {/* Test connection */}
              <div style={{ marginBottom: 'var(--space-4)' }}>
                <button
                  className="btn btn-secondary btn--sm"
                  onClick={handleTestConnection}
                  disabled={testingConnection}
                >
                  {testingConnection ? 'Testing...' : 'Test Connection'}
                </button>
                {testResult && (
                  <div
                    style={{
                      marginTop: 'var(--space-2)',
                      padding: 'var(--space-2) var(--space-3)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 'var(--text-sm)',
                      backgroundColor: testResult.success ? 'var(--color-success-light)' : 'var(--color-error-light)',
                      color: testResult.success ? 'var(--color-success-text)' : 'var(--color-error-text)',
                    }}
                  >
                    {testResult.success ? 'Connection successful' : `Connection failed: ${testResult.message || 'Unknown error'}`}
                  </div>
                )}
              </div>

              <div className="dialog__actions">
                <button className="btn btn-danger btn--sm" onClick={handleRemoveBackend}>
                  Remove
                </button>
                <div style={{ flex: 1 }} />
                <button className="btn btn-secondary" onClick={() => { setEditingBackend(null); setBackendDraft(null); setTestResult(null) }}>
                  Cancel
                </button>
                <button className="btn btn-primary" onClick={handleSaveBackend}>
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  function renderBackendFields() {
    if (!backendDraft) return null

    switch (backendDraft.type) {
      case 'local':
        return (
          <div className="form-group">
            <label className="form-label">Path</label>
            <input
              type="text"
              className="form-input"
              placeholder="/data/scans"
              value={backendDraft.path}
              onChange={(e) => setBackendDraft((prev) => ({ ...prev, path: e.target.value }))}
            />
          </div>
        )

      case 'paperless':
        return (
          <>
            <div className="form-group">
              <label className="form-label">URL</label>
              <input
                type="text"
                className="form-input"
                placeholder="https://paperless.example.com"
                value={backendDraft.url}
                onChange={(e) => setBackendDraft((prev) => ({ ...prev, url: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Token</label>
              <input
                type="text"
                className="form-input"
                style={{ fontFamily: 'var(--font-mono)' }}
                placeholder="API token"
                value={backendDraft.token}
                onChange={(e) => setBackendDraft((prev) => ({ ...prev, token: e.target.value }))}
              />
            </div>
          </>
        )

      case 'webdav':
        return (
          <>
            <div className="form-group">
              <label className="form-label">URL</label>
              <input
                type="text"
                className="form-input"
                placeholder="https://webdav.example.com"
                value={backendDraft.url}
                onChange={(e) => setBackendDraft((prev) => ({ ...prev, url: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                type="text"
                className="form-input"
                value={backendDraft.username}
                onChange={(e) => setBackendDraft((prev) => ({ ...prev, username: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                type="password"
                className="form-input"
                value={backendDraft.password}
                onChange={(e) => setBackendDraft((prev) => ({ ...prev, password: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Path</label>
              <input
                type="text"
                className="form-input"
                placeholder="/remote.php/dav/files/"
                value={backendDraft.path}
                onChange={(e) => setBackendDraft((prev) => ({ ...prev, path: e.target.value }))}
              />
            </div>
          </>
        )

      case 'gdrive':
        return (
          <>
            <div className="form-group">
              <label className="form-label">Service Account JSON</label>
              <textarea
                className="form-input"
                style={{ fontFamily: 'var(--font-mono)', minHeight: '120px', resize: 'vertical' }}
                placeholder='{"type": "service_account", ...}'
                value={backendDraft.service_account_json}
                onChange={(e) => setBackendDraft((prev) => ({ ...prev, service_account_json: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Folder ID</label>
              <input
                type="text"
                className="form-input"
                placeholder="Google Drive folder ID"
                value={backendDraft.folder_id}
                onChange={(e) => setBackendDraft((prev) => ({ ...prev, folder_id: e.target.value }))}
              />
            </div>
          </>
        )

      case 'smb':
        return (
          <>
            <div className="form-group">
              <label className="form-label">Share</label>
              <input
                type="text"
                className="form-input"
                placeholder="//server/share"
                value={backendDraft.share}
                onChange={(e) => setBackendDraft((prev) => ({ ...prev, share: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Path</label>
              <input
                type="text"
                className="form-input"
                placeholder="/scans"
                value={backendDraft.path}
                onChange={(e) => setBackendDraft((prev) => ({ ...prev, path: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Username</label>
              <input
                type="text"
                className="form-input"
                value={backendDraft.username}
                onChange={(e) => setBackendDraft((prev) => ({ ...prev, username: e.target.value }))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                type="password"
                className="form-input"
                value={backendDraft.password}
                onChange={(e) => setBackendDraft((prev) => ({ ...prev, password: e.target.value }))}
              />
            </div>
          </>
        )

      default:
        return null
    }
  }

  /* ---- Notifications Tab ---- */

  function renderNotifications() {
    const n = settings.notifications
    return (
      <div>
        <div className="form-group">
          <label className="form-label">Toast Duration: {n.toast_duration}ms</label>
          <input
            type="range"
            min={1000}
            max={10000}
            step={500}
            value={n.toast_duration}
            onChange={(e) => updateField('notifications', 'toast_duration', Number(e.target.value))}
            style={{ width: '100%' }}
          />
          <div style={styles.rangeLabels}>
            <span>1s</span>
            <span>10s</span>
          </div>
        </div>

        <div className="form-group">
          <label style={styles.toggleRow}>
            <span className="form-label" style={{ marginBottom: 0 }}>Sound Enabled</span>
            <input
              type="checkbox"
              checked={n.sound_enabled}
              onChange={(e) => updateField('notifications', 'sound_enabled', e.target.checked)}
            />
          </label>
        </div>
      </div>
    )
  }

  /* ---- Logs Tab ---- */

  function renderLogs() {
    const l = settings.logs
    return (
      <div>
        <div className="form-group">
          <label className="form-label">Retention (days)</label>
          <input
            type="number"
            className="form-input"
            min={0}
            value={l.retention_days}
            onChange={(e) => updateField('logs', 'retention_days', Number(e.target.value))}
          />
        </div>

        <div className="form-group">
          <label className="form-label">Minimum Level</label>
          <select
            className="form-select"
            value={l.min_level}
            onChange={(e) => updateField('logs', 'min_level', e.target.value)}
          >
            <option value="DEBUG">DEBUG</option>
            <option value="INFO">INFO</option>
            <option value="WARNING">WARNING</option>
            <option value="ERROR">ERROR</option>
          </select>
        </div>

        <div className="form-group">
          <label style={styles.toggleRow}>
            <span className="form-label" style={{ marginBottom: 0 }}>Auto-cleanup</span>
            <input
              type="checkbox"
              checked={l.auto_cleanup}
              onChange={(e) => updateField('logs', 'auto_cleanup', e.target.checked)}
            />
          </label>
        </div>
      </div>
    )
  }

  /* ---- System Tab ---- */

  function renderSystem() {
    const sys = settings.system
    return (
      <div>
        <div className="form-group">
          <label className="form-label">Port</label>
          <input
            type="number"
            className="form-input"
            value={sys.port}
            readOnly
            style={{ opacity: 0.7, cursor: 'not-allowed' }}
          />
          <span className="form-hint">
            Changing the port requires a server restart. Edit the config file directly.
          </span>
        </div>

        <div className="form-group">
          <label className="form-label">Version</label>
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }}>
            {sys.version || '0.1.0'}
          </div>
        </div>

        <h3 style={{ ...styles.sectionTitle, marginTop: 'var(--space-5)' }}>Backup &amp; Restore</h3>

        <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-4)' }}>
          <button className="btn btn-secondary" onClick={handleBackup}>
            Backup Config
          </button>

          <label className="btn btn-secondary" style={{ cursor: 'pointer' }}>
            Restore Config
            <input
              type="file"
              accept=".json"
              onChange={handleRestore}
              style={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0,0,0,0)' }}
            />
          </label>
        </div>

        <h3 style={{ ...styles.sectionTitle, marginTop: 'var(--space-5)' }}>Danger Zone</h3>

        <button className="btn btn-danger" onClick={() => setShowResetConfirm(true)}>
          Reset to Defaults
        </button>
      </div>
    )
  }

  /* ------------------------------------------------------------------
     Render: Main layout
     ------------------------------------------------------------------ */

  return (
    <div className="main-content__inner">
      {/* Page header */}
      <div className="page-header">
        <h1 className="page-header__title">Settings</h1>
        <p className="page-header__description">
          Configure your ESPScanCam server, capture, processing, and storage options.
        </p>
      </div>

      {/* Settings layout: sidebar tabs (desktop) / scrollable tabs (mobile) */}
      <div style={styles.settingsLayout}>
        {/* Tab navigation */}
        <nav style={styles.tabNav} className="scrollable" role="tablist" aria-label="Settings sections">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              role="tab"
              aria-selected={activeTab === tab.key}
              className={`btn btn--sm ${activeTab === tab.key ? 'btn-primary' : 'btn-secondary'}`}
              style={styles.tabButton}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        {/* Tab content */}
        <div style={styles.tabContent}>
          {renderTabContent()}
        </div>
      </div>

      {/* Reset confirm dialog */}
      <ConfirmDialog
        open={showResetConfirm}
        title="Reset to Defaults"
        message="This will reset ALL settings to their default values. This action cannot be undone. Are you sure?"
        confirmText="Reset"
        cancelText="Cancel"
        variant="danger"
        onConfirm={handleResetDefaults}
        onCancel={() => setShowResetConfirm(false)}
      />
    </div>
  )
}

/* ==========================================================================
   Inline Styles
   ========================================================================== */

const styles = {
  settingsLayout: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-4)',
  },

  tabNav: {
    display: 'flex',
    gap: 'var(--space-2)',
    overflowX: 'auto',
    overflowY: 'hidden',
    paddingBottom: 'var(--space-2)',
    flexShrink: 0,
    WebkitOverflowScrolling: 'touch',
  },

  tabButton: {
    flexShrink: 0,
    whiteSpace: 'nowrap',
  },

  tabContent: {
    flex: 1,
    minWidth: 0,
  },

  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    cursor: 'pointer',
    gap: 'var(--space-3)',
  },

  rangeLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 'var(--text-xs)',
    color: 'var(--color-text-muted)',
    marginTop: 'var(--space-1)',
  },

  sectionTitle: {
    fontSize: 'var(--text-lg)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-text)',
    margin: 0,
  },

  pipelineStep: {
    padding: 'var(--space-3)',
    marginBottom: 'var(--space-2)',
    backgroundColor: 'var(--color-surface)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--color-border)',
  },
}

/* ==========================================================================
   Inject responsive styles for settings layout
   ========================================================================== */

if (typeof document !== 'undefined') {
  const STYLE_ID = 'settings-responsive-styles'
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
      @media (min-width: 768px) {
        .main-content__inner .settings-layout-desktop {
          flex-direction: row;
        }
      }
    `
    document.head.appendChild(style)
  }
}
