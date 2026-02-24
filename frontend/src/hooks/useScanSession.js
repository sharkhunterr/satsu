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
  const [showGuide, setShowGuide] = useState(true)
  const [flashAnimation, setFlashAnimation] = useState(false)
  const pagePileRef = useRef(null)

  // ---- Crop modal state ----
  const cropQueueRef = useRef([])
  const [cropModalOpen, setCropModalOpen] = useState(false)
  const [cropCurrentImage, setCropCurrentImage] = useState(null)
  const [cropPoints, setCropPoints] = useState(null)
  const [cropDetecting, setCropDetecting] = useState(false)
  const [cropQueueLength, setCropQueueLength] = useState(0)

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
     File validation (must be before crop helpers that depend on it)
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

  /* ========================================================================
     Crop modal helpers
     ======================================================================== */

  const startCropForItem = useCallback(async (item) => {
    setCropCurrentImage(item)
    setCropModalOpen(true)
    setCropDetecting(true)
    setCropPoints(null)

    try {
      const formData = new FormData()
      formData.append('file', item.blob, item.name)
      const res = await fetch('/api/detect-document', { method: 'POST', body: formData })
      if (!res.ok) throw new Error('Detection failed')
      const data = await res.json()
      setCropPoints(data.detected ? data.points : null)
    } catch {
      setCropPoints(null)
    } finally {
      setCropDetecting(false)
    }
  }, [])

  const advanceCropQueue = useCallback(() => {
    const queue = cropQueueRef.current
    queue.shift()
    setCropQueueLength(queue.length)
    if (queue.length > 0) {
      startCropForItem(queue[0])
    } else {
      setCropModalOpen(false)
      setCropCurrentImage(null)
      setCropPoints(null)
    }
  }, [startCropForItem])

  const enqueueCrop = useCallback(
    (fileList) => {
      const items = []
      for (const file of fileList) {
        const error = validateFile(file)
        if (error) {
          // Invalid files skip crop and go directly to pile with error
          const id = ++pageIdRef.current
          setPages((prev) => [...prev, { id, blob: file, url: null, name: file.name, size: file.size, error }])
          continue
        }
        const url = URL.createObjectURL(file)
        items.push({ blob: file, url, name: file.name, size: file.size })
      }
      if (items.length === 0) return

      const wasEmpty = cropQueueRef.current.length === 0
      cropQueueRef.current.push(...items)
      setCropQueueLength(cropQueueRef.current.length)
      if (wasEmpty) {
        startCropForItem(items[0])
      }
    },
    [validateFile, startCropForItem],
  )

  const handleCropConfirm = useCallback(
    ({ points, rotation }) => {
      if (!cropCurrentImage) return
      const id = ++pageIdRef.current
      const cropInfo = { points, skip: false }
      if (rotation) cropInfo.rotation = rotation
      setPages((prev) => [
        ...prev,
        {
          id,
          blob: cropCurrentImage.blob,
          url: cropCurrentImage.url,
          name: cropCurrentImage.name,
          size: cropCurrentImage.size,
          cropInfo,
        },
      ])
      advanceCropQueue()
    },
    [cropCurrentImage, advanceCropQueue],
  )

  const handleCropSkip = useCallback(() => {
    if (!cropCurrentImage) return
    const id = ++pageIdRef.current
    setPages((prev) => [
      ...prev,
      {
        id,
        blob: cropCurrentImage.blob,
        url: cropCurrentImage.url,
        name: cropCurrentImage.name,
        size: cropCurrentImage.size,
        cropInfo: { skip: true },
      },
    ])
    advanceCropQueue()
  }, [cropCurrentImage, advanceCropQueue])

  const handleCropCancel = useCallback(() => {
    if (cropCurrentImage?.url) URL.revokeObjectURL(cropCurrentImage.url)
    advanceCropQueue()
  }, [cropCurrentImage, advanceCropQueue])

  const handleCropRedetect = useCallback(() => {
    if (!cropCurrentImage) return
    startCropForItem(cropCurrentImage)
  }, [cropCurrentImage, startCropForItem])

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

    enqueueCrop([new File([blob], `page-${pages.length + 1}.jpg`, { type: 'image/jpeg' })])

    setTimeout(() => {
      if (pagePileRef.current) {
        pagePileRef.current.scrollLeft = pagePileRef.current.scrollWidth
      }
    }, 50)
  }, [camera, enqueueCrop, pages.length])

  /* ========================================================================
     Upload mode helpers
     ======================================================================== */

  const handleFileSelect = useCallback(
    (e) => {
      if (e.target.files?.length) {
        enqueueCrop(Array.from(e.target.files))
      }
      e.target.value = ''
    },
    [enqueueCrop],
  )

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault()
      setIsDragOver(false)
      if (e.dataTransfer?.files?.length) {
        enqueueCrop(Array.from(e.dataTransfer.files))
      }
    },
    [enqueueCrop],
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
      const cropDataMap = {}
      validPages.forEach((page, i) => {
        formData.append('files', page.blob, page.name)
        if (page.cropInfo) {
          cropDataMap[String(i)] = page.cropInfo
        }
      })
      formData.append('profile', selectedProfile)
      formData.append('source_type', mode === 'camera' ? 'web_camera' : 'file_upload')
      if (Object.keys(cropDataMap).length > 0) {
        formData.append('crop_data', JSON.stringify(cropDataMap))
      }

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
    showGuide,
    setShowGuide,
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

    // Crop modal
    cropModalOpen,
    cropCurrentImage,
    cropPoints,
    cropDetecting,
    cropQueueLength,
    handleCropConfirm,
    handleCropSkip,
    handleCropCancel,
    handleCropRedetect,
  }
}
