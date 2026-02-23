import { useState, useRef, useCallback, useEffect } from 'react'

/**
 * React hook wrapping navigator.mediaDevices.getUserMedia() for camera access.
 *
 * Provides:
 *  - videoRef          – ref to attach to a <video> element
 *  - isActive          – whether the camera stream is currently running
 *  - error             – 'permission_denied' | 'no_camera' | 'camera_error' | null
 *  - facingMode        – 'environment' | 'user'
 *  - hasMultipleCameras – whether the device has more than one video input
 *  - torchSupported    – whether the torch/flash is available
 *  - torchOn           – whether the torch is currently on
 *  - capabilities      – { width, height } of the active video track
 *  - start(constraints?) – start the camera
 *  - stop()            – stop the camera and release the stream
 *  - capture()         – capture a single frame as a JPEG Blob
 *  - switchCamera()    – toggle between front and back cameras
 *  - toggleTorch()     – toggle the torch/flash on or off
 */
export function useCamera() {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const [isActive, setIsActive] = useState(false)
  const [error, setError] = useState(null)
  const [facingMode, setFacingMode] = useState('environment')
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [capabilities, setCapabilities] = useState({ width: 0, height: 0 })

  /**
   * Enumerate video input devices and update hasMultipleCameras.
   * Called after a stream is obtained (permission is required to get labels).
   */
  const _detectMultipleCameras = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      const videoDevices = devices.filter((d) => d.kind === 'videoinput')
      setHasMultipleCameras(videoDevices.length > 1)
    } catch {
      setHasMultipleCameras(false)
    }
  }, [])

  /**
   * Inspect the active video track for torch support and resolution.
   */
  const _inspectTrack = useCallback((stream) => {
    const track = stream.getVideoTracks()[0]
    if (!track) return

    // Check torch capability
    const caps = typeof track.getCapabilities === 'function' ? track.getCapabilities() : {}
    setTorchSupported(!!caps.torch)

    // Read actual video dimensions from settings (may differ from constraints)
    const settings = track.getSettings()
    setCapabilities({
      width: settings.width || 0,
      height: settings.height || 0,
    })
  }, [])

  /**
   * Start the camera with the given constraints merged over sensible defaults.
   *
   * @param {MediaStreamConstraints} [constraints] – partial overrides
   */
  const start = useCallback(
    async (constraints = {}) => {
      try {
        setError(null)

        // Merge caller constraints over defaults
        const videoConstraints = {
          facingMode: constraints.video?.facingMode || facingMode,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          ...(typeof constraints.video === 'object' ? constraints.video : {}),
        }

        const mergedConstraints = {
          video: videoConstraints,
          audio: false,
        }

        const stream = await navigator.mediaDevices.getUserMedia(mergedConstraints)
        streamRef.current = stream

        if (videoRef.current) {
          videoRef.current.srcObject = stream
          // Ensure the video plays (required on some mobile browsers)
          try {
            await videoRef.current.play()
          } catch {
            // play() can fail if the user hasn't interacted yet; ignore
          }
        }

        setIsActive(true)
        _inspectTrack(stream)
        await _detectMultipleCameras()
      } catch (err) {
        const code =
          err.name === 'NotAllowedError'
            ? 'permission_denied'
            : err.name === 'NotFoundError' || err.name === 'NotReadableError'
              ? 'no_camera'
              : 'camera_error'
        setError(code)
        setIsActive(false)
      }
    },
    [facingMode, _inspectTrack, _detectMultipleCameras],
  )

  /**
   * Stop the camera and release all tracks.
   */
  const stop = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setIsActive(false)
    setTorchOn(false)
    setTorchSupported(false)
    setCapabilities({ width: 0, height: 0 })
  }, [])

  /**
   * Capture the current video frame as a JPEG Blob.
   *
   * @param {number} [quality=0.92] – JPEG quality (0-1)
   * @returns {Promise<Blob|null>}
   */
  const capture = useCallback(
    async (quality = 0.92) => {
      if (!videoRef.current || !isActive) return null

      const video = videoRef.current
      // Wait for video to have actual dimensions
      if (!video.videoWidth || !video.videoHeight) return null

      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')
      ctx.drawImage(video, 0, 0)

      return new Promise((resolve) => {
        canvas.toBlob(
          (blob) => resolve(blob),
          'image/jpeg',
          quality,
        )
      })
    },
    [isActive],
  )

  /**
   * Switch between front and back cameras.
   * Stops the current stream and restarts with the opposite facingMode.
   */
  const switchCamera = useCallback(async () => {
    const newMode = facingMode === 'environment' ? 'user' : 'environment'
    setFacingMode(newMode)

    if (isActive) {
      stop()
      // Small delay to allow OS-level cleanup of the previous camera
      await new Promise((resolve) => setTimeout(resolve, 150))
      await start({ video: { facingMode: newMode } })
    }
  }, [facingMode, isActive, stop, start])

  /**
   * Toggle the torch/flash.
   */
  const toggleTorch = useCallback(async () => {
    if (!streamRef.current || !torchSupported) return

    const track = streamRef.current.getVideoTracks()[0]
    if (!track) return

    const newState = !torchOn
    try {
      await track.applyConstraints({ advanced: [{ torch: newState }] })
      setTorchOn(newState)
    } catch (e) {
      console.warn('Torch toggle failed:', e)
    }
  }, [torchOn, torchSupported])

  // Cleanup: stop camera on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop())
        streamRef.current = null
      }
    }
  }, [])

  return {
    videoRef,
    isActive,
    error,
    facingMode,
    hasMultipleCameras,
    torchSupported,
    torchOn,
    capabilities,
    start,
    stop,
    capture,
    switchCamera,
    toggleTorch,
  }
}
