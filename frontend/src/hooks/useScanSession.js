import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWS } from '../App'
import { useCamera } from './useCamera'
import { useToast } from '../components/shared/Toast'

/* ==========================================================================
   Constants
   ========================================================================== */

const MAX_FILE_SIZE = 20 * 1024 * 1024 // 20 MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const ACCEPTED_EXTENSIONS = '.jpg,.jpeg,.png,.webp'

/* ==========================================================================
   useScanSession Hook
   ========================================================================== */

export function useScanSession() {
  const navigate = useNavigate()
  const ws = useWS()
  const toast = useToast()
  const camera = useCamera()

  // ---- Mode ----
  const [mode, setMode] = useState(null) // null | 'camera' | 'upload'
  const [cameraSupported, setCameraSupported] = useState(true)

  // ---- Profile ----
  const [profiles, setProfiles] = useState([])
  const [selectedProfile, setSelectedProfile] = useState('default')

  // ---- Pages (shared between camera and upload) ----
  const [pages, setPages] = useState([]) // [{ id, blob, url, name, size, error? }]
  const pageIdRef = useRef(0)

  // ---- Upload state ----
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef(null)
  const nativeCameraInputRef = useRef(null)
  const [swapSource, setSwapSource] = useState(null)

  // ---- Send / progress state ----
  const [isSending, setIsSending] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [processingState, setProcessingState] = useState(null)
  const activeBatchRef = useRef(null)

  // ---- Camera extras ----
  const [showGrid, setShowGrid] = useState(false)
  const [flashAnimation, setFlashAnimation] = useState(false)
  const pagePileRef = useRef(null)

  // ---- Detect camera support ----
  useEffect(() => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraSupported(false)
    }
  }, [])

  // ---- Fetch profiles on mount ----
  useEffect(() => {
    let cancelled = false
    async function fetchProfiles() {
      try {
        const res = await fetch('/api/settings/profiles')
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        setProfiles(data)
        const defaultProfile = data.find((p) => p.is_default)
        if (defaultProfile) {
          setSelectedProfile(defaultProfile.id || defaultProfile.name)
        }
      } catch {
        // Silently fail; will use "default" profile
      }
    }
    fetchProfiles()
    return () => { cancelled = true }
  }, [])

  // ---- WebSocket: listen for processing events ----
  useEffect(() => {
    if (!ws?.subscribe) return

    const unsubs = [
      ws.subscribe('processing_started', (data) => {
        if (data.batch_id === activeBatchRef.current) {
          setProcessingState({ step: 'Starting...', pageIndex: 0, pageCount: data.page_count })
        }
      }),
      ws.subscribe('processing_page', (data) => {
        if (data.batch_id === activeBatchRef.current) {
          setProcessingState((prev) => ({
            ...prev,
            step: data.step,
            pageIndex: data.page_index + 1,
            stepIndex: data.step_index,
            totalSteps: data.total_steps,
          }))
        }
      }),
      ws.subscribe('page_processed', (data) => {
        if (data.batch_id === activeBatchRef.current) {
          setProcessingState((prev) => prev ? { ...prev, step: 'Page processed' } : prev)
        }
      }),
      ws.subscribe('processing_complete', (data) => {
        if (data.batch_id === activeBatchRef.current) {
          const batchId = activeBatchRef.current
          activeBatchRef.current = null
          setProcessingState(null)
          setIsSending(false)
          toast.success(`Scan complete (${data.page_count} pages, ${(data.total_duration_ms / 1000).toFixed(1)}s)`)
          navigate(`/history/${batchId}`)
        }
      }),
      ws.subscribe('processing_error', (data) => {
        if (data.batch_id === activeBatchRef.current) {
          toast.error(`Processing error on page ${data.page_index + 1}: ${data.error}`)
        }
      }),
    ]

    return () => unsubs.forEach((fn) => fn())
  }, [ws, navigate, toast])

  // ---- Cleanup object URLs on unmount ----
  useEffect(() => {
    return () => {
      pages.forEach((p) => {
        if (p.url) URL.revokeObjectURL(p.url)
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Handle camera error -> auto-fallback to upload ----
  useEffect(() => {
    if (camera.error === 'no_camera') {
      setCameraSupported(false)
      if (mode === 'camera') setMode('upload')
    }
  }, [camera.error, mode])

  /* ========================================================================
     Camera mode helpers
     ======================================================================== */

  const handleStartCamera = useCallback(async () => {
    await camera.start()
  }, [camera])

  const handleCapture = useCallback(async () => {
    const blob = await camera.capture()
    if (!blob) return

    setFlashAnimation(true)
    setTimeout(() => setFlashAnimation(false), 200)

    const id = ++pageIdRef.current
    const url = URL.createObjectURL(blob)
    setPages((prev) => [
      ...prev,
      { id, blob, url, name: `page-${prev.length + 1}.jpg`, size: blob.size },
    ])

    setTimeout(() => {
      if (pagePileRef.current) {
        pagePileRef.current.scrollLeft = pagePileRef.current.scrollWidth
      }
    }, 50)
  }, [camera])

  /* ========================================================================
     Upload mode helpers
     ======================================================================== */

  const validateFile = useCallback((file) => {
    if (!ACCEPTED_TYPES.includes(file.type)) {
      return `Unsupported format: ${file.type || 'unknown'}. Use JPEG, PNG, or WebP.`
    }
    if (file.size > MAX_FILE_SIZE) {
      return `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 20 MB.`
    }
    return null
  }, [])

  const addFiles = useCallback(
    (fileList) => {
      const newPages = []
      for (const file of fileList) {
        const error = validateFile(file)
        const id = ++pageIdRef.current
        const url = error ? null : URL.createObjectURL(file)
        newPages.push({ id, blob: file, url, name: file.name, size: file.size, error })
      }
      setPages((prev) => [...prev, ...newPages])
    },
    [validateFile],
  )

  const handleFileSelect = useCallback(
    (e) => {
      if (e.target.files?.length) {
        addFiles(Array.from(e.target.files))
      }
      e.target.value = ''
    },
    [addFiles],
  )

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault()
      setIsDragOver(false)
      if (e.dataTransfer?.files?.length) {
        addFiles(Array.from(e.dataTransfer.files))
      }
    },
    [addFiles],
  )

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    setIsDragOver(false)
  }, [])

  /* ========================================================================
     Page management
     ======================================================================== */

  const removePage = useCallback((id) => {
    setPages((prev) => {
      const page = prev.find((p) => p.id === id)
      if (page?.url) URL.revokeObjectURL(page.url)
      return prev.filter((p) => p.id !== id)
    })
    setSwapSource(null)
  }, [])

  const handleThumbnailClick = useCallback(
    (index) => {
      if (swapSource === null) {
        setSwapSource(index)
      } else {
        if (swapSource !== index) {
          setPages((prev) => {
            const next = [...prev]
            const temp = next[swapSource]
            next[swapSource] = next[index]
            next[index] = temp
            return next
          })
        }
        setSwapSource(null)
      }
    },
    [swapSource],
  )

  const clearPages = useCallback(() => {
    pages.forEach((p) => {
      if (p.url) URL.revokeObjectURL(p.url)
    })
    setPages([])
    setSwapSource(null)
  }, [pages])

  /* ========================================================================
     Send (upload)
     ======================================================================== */

  const validPages = useMemo(() => pages.filter((p) => !p.error), [pages])

  const handleSend = useCallback(async () => {
    if (validPages.length === 0) return
    setIsSending(true)
    setUploadProgress(0)
    setProcessingState(null)

    try {
      const formData = new FormData()
      validPages.forEach((page) => {
        formData.append('files', page.blob, page.name)
      })
      formData.append('profile', selectedProfile)
      formData.append('source_type', mode === 'camera' ? 'web_camera' : 'file_upload')

      const result = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', '/api/scan/web-upload')

        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            setUploadProgress(Math.round((e.loaded / e.total) * 100))
          }
        })

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText))
            } catch {
              reject(new Error('Invalid response from server'))
            }
          } else {
            reject(new Error(`Upload failed (HTTP ${xhr.status})`))
          }
        })

        xhr.addEventListener('error', () => reject(new Error('Network error during upload')))
        xhr.addEventListener('abort', () => reject(new Error('Upload cancelled')))

        xhr.send(formData)
      })

      activeBatchRef.current = result.id
      setUploadProgress(100)
      toast.info(`Uploaded ${validPages.length} page(s). Processing...`)

      setTimeout(() => {
        if (activeBatchRef.current === result.id) {
          activeBatchRef.current = null
          setIsSending(false)
          setProcessingState(null)
          navigate(`/history/${result.id}`)
        }
      }, 30000)
    } catch (err) {
      toast.error(err.message || 'Upload failed')
      setIsSending(false)
      setUploadProgress(0)
    }
  }, [validPages, selectedProfile, mode, toast, navigate])

  /* ========================================================================
     Switch mode
     ======================================================================== */

  const handleModeSwitch = useCallback(
    (newMode) => {
      if (newMode === mode) {
        // Toggle off
        if (camera.isActive) camera.stop()
        setMode(null)
        return
      }
      if (newMode === 'upload' && camera.isActive) {
        camera.stop()
      }
      setMode(newMode)
      setSwapSource(null)
    },
    [mode, camera],
  )

  return {
    // Mode
    mode,
    setMode,
    cameraSupported,
    handleModeSwitch,

    // Camera
    camera,
    showGrid,
    setShowGrid,
    flashAnimation,
    handleStartCamera,
    handleCapture,
    pagePileRef,

    // Profile
    profiles,
    selectedProfile,
    setSelectedProfile,

    // Pages
    pages,
    validPages,
    swapSource,
    removePage,
    handleThumbnailClick,
    clearPages,

    // Upload
    isDragOver,
    fileInputRef,
    nativeCameraInputRef,
    handleFileSelect,
    handleDrop,
    handleDragOver,
    handleDragLeave,

    // Sending
    isSending,
    uploadProgress,
    processingState,
    handleSend,
  }
}
