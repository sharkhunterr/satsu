import React, { useState, useEffect } from 'react'

import Spinner from '../components/shared/Spinner'

/* ==========================================================================
   Helpers
   ========================================================================== */

function formatBytes(bytes) {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
}

function formatUptime(seconds) {
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h ${minutes % 60}m`
}

/* ==========================================================================
   About Page
   ========================================================================== */

export default function About() {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(null)
  const [pageLoadTime] = useState(() => Date.now())
  const [uptimeDisplay, setUptimeDisplay] = useState('--')

  /* ------------------------------------------------------------------
     Fetch stats on mount
     ------------------------------------------------------------------ */

  useEffect(() => {
    let cancelled = false

    async function fetchStats() {
      try {
        const res = await fetch('/api/stats')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        if (!cancelled) setStats(data)
      } catch {
        // Non-critical; we show placeholders
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchStats()

    return () => {
      cancelled = true
    }
  }, [])

  /* ------------------------------------------------------------------
     Uptime ticker (updates every second based on page load time)
     ------------------------------------------------------------------ */

  useEffect(() => {
    function tick() {
      const elapsed = Math.floor((Date.now() - pageLoadTime) / 1000)
      setUptimeDisplay(formatUptime(elapsed))
    }

    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [pageLoadTime])

  /* ------------------------------------------------------------------
     Render
     ------------------------------------------------------------------ */

  if (loading) {
    return (
      <div className="main-content__inner">
        <Spinner fullPage label="Loading about page" />
      </div>
    )
  }

  return (
    <div className="main-content__inner">
      {/* Page header */}
      <div className="page-header" style={{ textAlign: 'center' }}>
        <h1 className="page-header__title">ESPScanCam</h1>
        <p className="page-header__description" style={{ marginBottom: 'var(--space-1)' }}>
          Self-hosted document scanning system
        </p>
        <div style={styles.versionBadge}>
          v0.1.0
        </div>
      </div>

      {/* Cards container */}
      <div style={styles.cardsContainer}>

        {/* ---- System Info ---- */}
        <div className="card" style={styles.card}>
          <h2 style={styles.cardTitle}>System Info</h2>

          <div style={styles.infoGrid}>
            <div style={styles.infoItem}>
              <div style={styles.infoLabel}>Server Uptime</div>
              <div style={styles.infoValue}>{uptimeDisplay}</div>
            </div>

            <div style={styles.infoItem}>
              <div style={styles.infoLabel}>Total Batches</div>
              <div style={styles.infoValue}>{stats?.total_batches ?? stats?.total_scans ?? '--'}</div>
            </div>

            <div style={styles.infoItem}>
              <div style={styles.infoLabel}>Total Pages</div>
              <div style={styles.infoValue}>{stats?.total_pages ?? '--'}</div>
            </div>

            <div style={styles.infoItem}>
              <div style={styles.infoLabel}>Total Size</div>
              <div style={styles.infoValue}>
                {stats?.total_size_bytes != null
                  ? formatBytes(stats.total_size_bytes)
                  : stats?.storage_used != null
                    ? formatBytes(stats.storage_used)
                    : '--'}
              </div>
            </div>

            <div style={styles.infoItem}>
              <div style={styles.infoLabel}>Devices Registered</div>
              <div style={styles.infoValue}>{stats?.devices_total ?? '--'}</div>
            </div>

            <div style={styles.infoItem}>
              <div style={styles.infoLabel}>Devices Online</div>
              <div style={styles.infoValue}>{stats?.devices_online ?? '--'}</div>
            </div>
          </div>
        </div>

        {/* ---- Project Links ---- */}
        <div className="card" style={styles.card}>
          <h2 style={styles.cardTitle}>Project Links</h2>

          <div style={styles.linkList}>
            <a
              href="https://github.com/user/espscancam"
              target="_blank"
              rel="noopener noreferrer"
              style={styles.link}
            >
              <span style={styles.linkIcon} aria-hidden="true">&#128279;</span>
              <span>GitHub Repository</span>
            </a>

            <a
              href="https://github.com/user/espscancam/wiki"
              target="_blank"
              rel="noopener noreferrer"
              style={styles.link}
            >
              <span style={styles.linkIcon} aria-hidden="true">&#128214;</span>
              <span>Documentation</span>
            </a>

            <div style={styles.linkStatic}>
              <span style={styles.linkIcon} aria-hidden="true">&#128220;</span>
              <span>License: MIT</span>
            </div>
          </div>
        </div>

        {/* ---- Tech Stack ---- */}
        <div className="card" style={styles.card}>
          <h2 style={styles.cardTitle}>Tech Stack</h2>

          <div style={styles.stackGrid}>
            <div style={styles.stackSection}>
              <div style={styles.stackLabel}>Backend</div>
              <div style={styles.tagList}>
                <span style={styles.tag}>Python</span>
                <span style={styles.tag}>FastAPI</span>
                <span style={styles.tag}>OpenCV</span>
                <span style={styles.tag}>SQLite</span>
              </div>
            </div>

            <div style={styles.stackSection}>
              <div style={styles.stackLabel}>Frontend</div>
              <div style={styles.tagList}>
                <span style={styles.tag}>React</span>
                <span style={styles.tag}>Vite</span>
              </div>
            </div>

            <div style={styles.stackSection}>
              <div style={styles.stackLabel}>Firmware</div>
              <div style={styles.tagList}>
                <span style={styles.tag}>Arduino C++</span>
                <span style={styles.tag}>ESP32-CAM</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}

/* ==========================================================================
   Inline Styles
   ========================================================================== */

const styles = {
  versionBadge: {
    display: 'inline-block',
    padding: '2px var(--space-3)',
    fontSize: 'var(--text-xs)',
    fontWeight: 'var(--font-weight-semibold)',
    fontFamily: 'var(--font-mono)',
    color: 'var(--color-primary)',
    backgroundColor: 'var(--color-primary-light)',
    borderRadius: 'var(--radius-full)',
    marginTop: 'var(--space-2)',
  },

  cardsContainer: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-4)',
    maxWidth: '640px',
    margin: '0 auto',
    width: '100%',
  },

  card: {
    padding: 'var(--space-5)',
  },

  cardTitle: {
    fontSize: 'var(--text-lg)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-text)',
    marginBottom: 'var(--space-4)',
    paddingBottom: 'var(--space-2)',
    borderBottom: '1px solid var(--color-border)',
  },

  /* System Info grid */
  infoGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 'var(--space-4)',
  },

  infoItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-1)',
  },

  infoLabel: {
    fontSize: 'var(--text-xs)',
    fontWeight: 'var(--font-weight-medium)',
    color: 'var(--color-text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },

  infoValue: {
    fontSize: 'var(--text-lg)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-text)',
    fontFamily: 'var(--font-mono)',
  },

  /* Project Links */
  linkList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-3)',
  },

  link: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    padding: 'var(--space-2) var(--space-3)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--color-primary)',
    textDecoration: 'none',
    fontSize: 'var(--text-sm)',
    fontWeight: 'var(--font-weight-medium)',
    transition: 'background-color var(--transition-fast)',
    backgroundColor: 'transparent',
  },

  linkStatic: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    padding: 'var(--space-2) var(--space-3)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--color-text-secondary)',
    fontSize: 'var(--text-sm)',
    fontWeight: 'var(--font-weight-medium)',
  },

  linkIcon: {
    fontSize: 'var(--text-base)',
    flexShrink: 0,
    width: '20px',
    textAlign: 'center',
  },

  /* Tech Stack */
  stackGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-4)',
  },

  stackSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 'var(--space-2)',
  },

  stackLabel: {
    fontSize: 'var(--text-sm)',
    fontWeight: 'var(--font-weight-semibold)',
    color: 'var(--color-text)',
  },

  tagList: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 'var(--space-2)',
  },

  tag: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '2px var(--space-3)',
    fontSize: 'var(--text-xs)',
    fontWeight: 'var(--font-weight-medium)',
    color: 'var(--color-text-secondary)',
    backgroundColor: 'var(--color-surface)',
    borderRadius: 'var(--radius-full)',
    border: '1px solid var(--color-border)',
  },
}
