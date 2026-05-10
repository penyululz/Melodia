"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import type { CSSProperties } from "react"
import { usePlayerStore } from "@/stores/player-store"
import { useSettingsStore } from "@/stores/settings-store"
import { Button } from "@/components/ui/button"
import { Maximize2, Minimize2, PictureInPicture2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  getBestTrackMediaUrl,
  getOfflineObjectUrlForTrack,
  getYouTubeVideoIdFromTrack,
} from "@/lib/offline-media"
import { hasVideoExtension } from "@/lib/format"
import { getNormalizedVolume } from "@/lib/audio-normalization"
import {
  listenForMediaEngineActive,
  listenForPlaybackSeek,
  notifyMediaEngineActive,
} from "@/lib/playback-events"

type DockRect = {
  left: number
  top: number
  width: number
  height: number
}

type FloatingRect = DockRect

type DragState = {
  pointerId: number
  startX: number
  startY: number
  startLeft: number
  startTop: number
  width: number
  height: number
}

type MobileFullscreenVideoElement = HTMLVideoElement & {
  webkitEnterFullscreen?: () => void
  webkitSetPresentationMode?: (mode: "fullscreen" | "inline" | "picture-in-picture") => void
}

function getNumericTrackId(track: { id?: number | string } | null): number | null {
  const id = Number(track?.id)
  return Number.isInteger(id) && id > 0 ? id : null
}

function getSubtitleSource(
  track: {
    id?: number | string
    videoId?: string
    file_path?: string
  } | null,
  resolvedVideoId?: string | null
): string | null {
  if (resolvedVideoId) return `/api/subtitles/youtube/${encodeURIComponent(resolvedVideoId)}`

  const videoId = getYouTubeVideoIdFromTrack(track)
  if (videoId) return `/api/subtitles/youtube/${encodeURIComponent(videoId)}`

  const trackId = getNumericTrackId(track)
  return trackId ? `/api/subtitles/tracks/${trackId}` : null
}

function getExpandedVideoDock(): HTMLElement | null {
  if (typeof document === "undefined") return null

  const docks = document.querySelectorAll<HTMLElement>('[data-video-dock="expanded-player"]')
  for (const dock of docks) {
    const rect = dock.getBoundingClientRect()
    if (rect.width > 1 && rect.height > 1) {
      return dock
    }
  }

  return null
}

function getDockRect(element: HTMLElement): DockRect {
  const rect = element.getBoundingClientRect()
  return {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }
}

function rectsMatch(a: DockRect | null, b: DockRect): boolean {
  return Boolean(
    a &&
      a.left === b.left &&
      a.top === b.top &&
      a.width === b.width &&
      a.height === b.height
  )
}

function clampFloatingRect(rect: FloatingRect): FloatingRect {
  if (typeof window === "undefined") return rect

  const margin = 8
  const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin)
  const maxTop = Math.max(margin, window.innerHeight - rect.height - margin)

  return {
    ...rect,
    left: Math.min(Math.max(rect.left, margin), maxLeft),
    top: Math.min(Math.max(rect.top, margin), maxTop),
  }
}

function isAbortPlayError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError"
}

function reportPlayError(error: unknown) {
  if (isAbortPlayError(error)) return
  console.error(error)
}

const OFFLINE_VIDEO_FALLBACK_TIMEOUT_MS = 4500

type ResolvedYouTubeVideo = {
  videoId: string
  title: string
  artist: string
  duration: number | null
  thumbnailUrl: string | null
}

async function requestNativeFullscreen(video: HTMLVideoElement): Promise<boolean> {
  try {
    if (video.requestFullscreen) {
      await video.requestFullscreen()
      return true
    }
  } catch {
    // Mobile Safari may expose requestFullscreen but reject for video nodes.
  }

  const mobileVideo = video as MobileFullscreenVideoElement

  try {
    if (mobileVideo.webkitEnterFullscreen) {
      mobileVideo.webkitEnterFullscreen()
      return true
    }
  } catch {
    // Fall through to presentation mode, then app-level fullscreen fallback.
  }

  try {
    if (mobileVideo.webkitSetPresentationMode) {
      mobileVideo.webkitSetPresentationMode("fullscreen")
      return true
    }
  } catch {
    // Fall back to app-level fullscreen.
  }

  return false
}

export function VideoPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const recordedPlayKeyRef = useRef<string | null>(null)
  const offlineVideoUrlRef = useRef<string | null>(null)
  const offlineFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const videoClockFrameRef = useRef<number | null>(null)
  const dragStateRef = useRef<DragState | null>(null)
  const suppressPauseStateRef = useRef(false)
  const { currentTrack, isPlaying, currentTime, volume, isMuted, isExpandedPlayerOpen, setCurrentTime, setDuration, setIsPlaying } = usePlayerStore()
  const { playbackMode, streamingQuality, pauseWatchHistory } = useSettingsStore()
  const [isExpanded, setIsExpanded] = useState(false)
  const [isVisible, setIsVisible] = useState(false)
  const [audioHandoffActive, setAudioHandoffActive] = useState(false)
  const [previousPlaybackMode, setPreviousPlaybackMode] = useState(playbackMode)
  const [dockRect, setDockRect] = useState<DockRect | null>(null)
  const [offlineVideoUrl, setOfflineVideoUrl] = useState<string | null>(null)
  const [floatingRect, setFloatingRect] = useState<FloatingRect | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [resolvedYouTubeVideo, setResolvedYouTubeVideo] = useState<ResolvedYouTubeVideo | null>(null)

  const youtubeVideoId = getYouTubeVideoIdFromTrack(currentTrack || null)
  const resolvedYouTubeVideoId = resolvedYouTubeVideo?.videoId || null
  const effectiveYouTubeVideoId = resolvedYouTubeVideoId || youtubeVideoId
  const isYouTube = Boolean(youtubeVideoId)
  const isLocalVideo = !isYouTube && currentTrack?.source !== "youtube" && hasVideoExtension(currentTrack || null)
  const shouldResolveYouTubeVideo = Boolean(
    currentTrack &&
      playbackMode === "video" &&
      !isLocalVideo &&
      (currentTrack.title || currentTrack.artist) &&
      (!isYouTube || currentTrack.media_type !== "video")
  )
  const canUseVideoTrack = Boolean(currentTrack && (isLocalVideo || effectiveYouTubeVideoId))
  const isVideoToAudioHandoff =
    previousPlaybackMode === "video" &&
    playbackMode === "audio" &&
    canUseVideoTrack
  const shouldUseVideoEngine = Boolean(
    currentTrack &&
      canUseVideoTrack &&
      (playbackMode === "video" || audioHandoffActive || isVideoToAudioHandoff)
  )
  const subtitleSrc = getSubtitleSource(currentTrack || null, resolvedYouTubeVideoId)
  const shouldShowVideo = Boolean(
    playbackMode === "video" &&
      isVisible &&
      currentTrack &&
      (effectiveYouTubeVideoId || isLocalVideo)
  )
  const isFloatingPicture = shouldShowVideo && !isExpandedPlayerOpen && !isExpanded
  const streamingVideoSrc = effectiveYouTubeVideoId
    ? `/api/youtube/stream/${effectiveYouTubeVideoId}?mode=video&quality=${streamingQuality}`
    : currentTrack
    ? getBestTrackMediaUrl(currentTrack, "video", streamingQuality)
    : ""
  const videoSrc = offlineVideoUrl || streamingVideoSrc
  const knownDuration =
    typeof currentTrack?.duration === "number" && Number.isFinite(currentTrack.duration) && currentTrack.duration > 0
      ? currentTrack.duration
      : 0

  const clearOfflineFallbackTimer = useCallback(() => {
    if (offlineFallbackTimerRef.current) {
      clearTimeout(offlineFallbackTimerRef.current)
      offlineFallbackTimerRef.current = null
    }
  }, [])

  const syncVideoToPlayerTime = useCallback((video: HTMLVideoElement) => {
    const targetTime = usePlayerStore.getState().currentTime
    if (targetTime > 0 && Math.abs(video.currentTime - targetTime) > 0.5) {
      video.currentTime = targetTime
    }
  }, [])

  const applyVideoVolume = useCallback((video: HTMLVideoElement) => {
    const playerState = usePlayerStore.getState()
    video.volume = getNormalizedVolume(
      playerState.volume,
      playerState.isMuted,
      playerState.currentTrack
    )
  }, [])

  const tryOfflineVideoFallback = useCallback(async () => {
    if (!currentTrack || offlineVideoUrlRef.current) return false

    const video = videoRef.current
    const resumeTime = video?.currentTime || usePlayerStore.getState().currentTime
    const shouldResume = Boolean(video && !video.paused) || usePlayerStore.getState().isPlaying

    const offlineMedia = await getOfflineObjectUrlForTrack(currentTrack, ["video/"]).catch(() => null)
    if (!offlineMedia) return false

    if (offlineVideoUrlRef.current) {
      URL.revokeObjectURL(offlineVideoUrlRef.current)
    }
    offlineVideoUrlRef.current = offlineMedia.url
    setOfflineVideoUrl(offlineMedia.url)

    requestAnimationFrame(() => {
      const nextVideo = videoRef.current
      if (!nextVideo) return

      if (resumeTime > 0 && Math.abs(nextVideo.currentTime - resumeTime) > 0.5) {
        nextVideo.currentTime = resumeTime
      }
      if (shouldResume) {
        applyVideoVolume(nextVideo)
        syncVideoToPlayerTime(nextVideo)
        nextVideo.play().catch(reportPlayError)
      }
    })

    return true
  }, [applyVideoVolume, currentTrack?.id, currentTrack?.videoId, currentTrack?.file_path, syncVideoToPlayerTime])

  const playVideoWhenReady = useCallback(() => {
    const video = videoRef.current
    if (!video || !shouldUseVideoEngine || !usePlayerStore.getState().isPlaying) return

    applyVideoVolume(video)
    syncVideoToPlayerTime(video)
    video.play().catch((error) => {
      if (isAbortPlayError(error)) return
      reportPlayError(error)
      void tryOfflineVideoFallback()
    })
  }, [applyVideoVolume, shouldUseVideoEngine, syncVideoToPlayerTime, tryOfflineVideoFallback])

  useEffect(() => {
    setResolvedYouTubeVideo(null)

    if (!shouldResolveYouTubeVideo || !currentTrack) return
    const title = currentTrack.title?.trim()
    const artist = currentTrack.artist?.trim() || ""
    if (!title && !artist) return

    const controller = new AbortController()
    const params = new URLSearchParams({
      title: title || "",
      artist,
    })
    if (currentTrack.album) params.set("album", currentTrack.album)
    if (currentTrack.duration) params.set("duration", String(currentTrack.duration))

    fetch(`/api/youtube/resolve-video?${params.toString()}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (controller.signal.aborted || !data?.video?.videoId) return
        setResolvedYouTubeVideo(data.video)
      })
      .catch((error) => {
        if ((error as DOMException)?.name !== "AbortError") {
          console.warn("[video-player] Could not resolve YouTube video:", error)
        }
      })

    return () => controller.abort()
  }, [
    currentTrack?.id,
    currentTrack?.title,
    currentTrack?.artist,
    currentTrack?.album,
    currentTrack?.duration,
    currentTrack?.media_type,
    playbackMode,
    shouldResolveYouTubeVideo,
    isLocalVideo,
  ])

  const updateDockRect = useCallback(() => {
    if (!isExpandedPlayerOpen || !shouldShowVideo) {
      setDockRect(null)
      return
    }

    const dock = getExpandedVideoDock()
    if (!dock) {
      setDockRect(null)
      return
    }

    const nextRect = getDockRect(dock)
    setDockRect((previousRect) => (rectsMatch(previousRect, nextRect) ? previousRect : nextRect))
  }, [isExpandedPlayerOpen, shouldShowVideo])

  useEffect(() => {
    if (playbackMode === "video" && (effectiveYouTubeVideoId || isLocalVideo) && (currentTrack?.videoId || currentTrack?.file_path || effectiveYouTubeVideoId)) {
      setIsVisible(true)
      if (knownDuration > 0) setDuration(knownDuration)
    }
  }, [playbackMode, effectiveYouTubeVideoId, isLocalVideo, currentTrack?.id, currentTrack?.videoId, currentTrack?.file_path, knownDuration, setDuration])

  useEffect(() => {
    if (previousPlaybackMode === "video" && playbackMode === "audio" && canUseVideoTrack) {
      const video = videoRef.current
      if (video && !video.paused) {
        setAudioHandoffActive(true)
      }
    }

    if (playbackMode === "video") {
      setAudioHandoffActive(false)
    }

    if (previousPlaybackMode !== playbackMode) {
      setPreviousPlaybackMode(playbackMode)
    }
  }, [playbackMode, canUseVideoTrack, previousPlaybackMode])

  useEffect(() => {
    let isCancelled = false

    const clearOfflineVideoUrl = () => {
      clearOfflineFallbackTimer()
      if (offlineVideoUrlRef.current) {
        URL.revokeObjectURL(offlineVideoUrlRef.current)
        offlineVideoUrlRef.current = null
      }
      setOfflineVideoUrl(null)
    }

    if (!currentTrack || !shouldUseVideoEngine) {
      clearOfflineVideoUrl()
      return
    }

    getOfflineObjectUrlForTrack(currentTrack, ["video/"])
      .then((offlineMedia) => {
        if (isCancelled) {
          if (offlineMedia?.url) URL.revokeObjectURL(offlineMedia.url)
          return
        }

        clearOfflineVideoUrl()
        if (offlineMedia) {
          offlineVideoUrlRef.current = offlineMedia.url
          setOfflineVideoUrl(offlineMedia.url)
        }
      })
      .catch(() => {
        if (!isCancelled) clearOfflineVideoUrl()
      })

    return () => {
      isCancelled = true
    }
  }, [currentTrack?.id, currentTrack?.videoId, currentTrack?.file_path, shouldUseVideoEngine, clearOfflineFallbackTimer])

  useEffect(() => {
    const video = videoRef.current
    clearOfflineFallbackTimer()

    if (!video || !shouldUseVideoEngine || !isPlaying || offlineVideoUrl || !streamingVideoSrc) {
      return
    }

    offlineFallbackTimerRef.current = setTimeout(() => {
      if (video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA) {
        void tryOfflineVideoFallback()
      }
    }, OFFLINE_VIDEO_FALLBACK_TIMEOUT_MS)

    const clearWhenReady = () => clearOfflineFallbackTimer()
    video.addEventListener("canplay", clearWhenReady)
    video.addEventListener("playing", clearWhenReady)

    return () => {
      clearOfflineFallbackTimer()
      video.removeEventListener("canplay", clearWhenReady)
      video.removeEventListener("playing", clearWhenReady)
    }
  }, [
    clearOfflineFallbackTimer,
    isPlaying,
    offlineVideoUrl,
    shouldUseVideoEngine,
    streamingVideoSrc,
    tryOfflineVideoFallback,
  ])

  useLayoutEffect(() => {
    updateDockRect()

    if (!isExpandedPlayerOpen || !shouldShowVideo) return

    const dock = getExpandedVideoDock()
    const resizeObserver = dock && typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(updateDockRect)
      : null

    if (dock && resizeObserver) {
      resizeObserver.observe(dock)
    }

    const animationFrame = requestAnimationFrame(updateDockRect)
    window.addEventListener("resize", updateDockRect)
    window.addEventListener("scroll", updateDockRect, true)

    return () => {
      cancelAnimationFrame(animationFrame)
      resizeObserver?.disconnect()
      window.removeEventListener("resize", updateDockRect)
      window.removeEventListener("scroll", updateDockRect, true)
    }
  }, [updateDockRect, isExpandedPlayerOpen, shouldShowVideo, currentTrack?.id, currentTrack?.videoId, resolvedYouTubeVideoId, playbackMode])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !shouldUseVideoEngine) return

    if (isPlaying) {
      playVideoWhenReady()
    } else {
      video.pause()
    }
  }, [isPlaying, playVideoWhenReady, shouldUseVideoEngine])

  useEffect(() => {
    return listenForMediaEngineActive(({ engine }) => {
      if (engine !== "audio") return
      if (!audioHandoffActive && playbackMode !== "audio") return

      const video = videoRef.current
      if (video) {
        suppressPauseStateRef.current = true
        video.pause()
        window.setTimeout(() => {
          suppressPauseStateRef.current = false
        }, 0)
      }

      setAudioHandoffActive(false)
    })
  }, [audioHandoffActive, playbackMode])

  useEffect(() => {
    if (!shouldUseVideoEngine || !isPlaying) {
      if (videoClockFrameRef.current) {
        cancelAnimationFrame(videoClockFrameRef.current)
        videoClockFrameRef.current = null
      }
      return
    }

    const updateVideoClock = () => {
      const video = videoRef.current
      if (!video || !shouldUseVideoEngine) return

      if (!video.paused) {
        setCurrentTime(video.currentTime)
        const mediaDuration = video.duration
        if (Number.isFinite(mediaDuration) && mediaDuration > 0) {
          setDuration(mediaDuration)
        } else if (knownDuration > 0) {
          setDuration(knownDuration)
        }
      }

      videoClockFrameRef.current = requestAnimationFrame(updateVideoClock)
    }

    videoClockFrameRef.current = requestAnimationFrame(updateVideoClock)

    return () => {
      if (videoClockFrameRef.current) {
        cancelAnimationFrame(videoClockFrameRef.current)
        videoClockFrameRef.current = null
      }
    }
  }, [isPlaying, knownDuration, setCurrentTime, setDuration, shouldUseVideoEngine, videoSrc])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = getNormalizedVolume(volume, isMuted, currentTrack)
  }, [volume, isMuted, currentTrack?.loudness_adjust_db, currentTrack?.replaygain_track_gain, currentTrack?.replaygain_album_gain])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !shouldUseVideoEngine) return
    
    // Sync video time with player state (allow small drift)
    if (Math.abs(video.currentTime - currentTime) > 1) {
      video.currentTime = currentTime
    }
  }, [currentTime, shouldUseVideoEngine])

  useEffect(() => {
    return listenForPlaybackSeek((time) => {
      const video = videoRef.current
      if (!video || !shouldUseVideoEngine) return
      video.currentTime = time
      setCurrentTime(time)
    })
  }, [setCurrentTime, shouldUseVideoEngine])

  useEffect(() => {
    if (!floatingRect) return

    const handleResize = () => setFloatingRect((rect) => (rect ? clampFloatingRect(rect) : rect))
    window.addEventListener("resize", handleResize)

    return () => window.removeEventListener("resize", handleResize)
  }, [floatingRect])

  if (!currentTrack || !shouldUseVideoEngine || (!effectiveYouTubeVideoId && !currentTrack.file_path)) return null

  const floatingStyle: CSSProperties | undefined = isFloatingPicture && floatingRect && !isExpanded
    ? {
        bottom: "auto",
        height: floatingRect.height,
        left: floatingRect.left,
        right: "auto",
        top: floatingRect.top,
        width: floatingRect.width,
      }
    : undefined

  const videoStyle: CSSProperties | undefined = isExpanded
    ? undefined
    : isExpandedPlayerOpen && shouldShowVideo && dockRect
    ? {
        left: dockRect.left,
        top: dockRect.top,
        width: dockRect.width,
        height: dockRect.height,
      }
    : !shouldShowVideo
      ? { left: -1, top: -1, width: 1, height: 1 }
      : floatingStyle

  const requestFullscreen = async () => {
    const video = videoRef.current
    if (!video) return

    const wasPlaying = !video.paused
    const enteredFullscreen = await requestNativeFullscreen(video)
    if (!enteredFullscreen) {
      setIsExpanded(true)
    }

    if (wasPlaying) {
      video.play().catch(reportPlayError)
    }
  }

  const requestPictureInPicture = () => {
    videoRef.current?.requestPictureInPicture?.().catch(() => {})
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isFloatingPicture) return
    if (event.target instanceof HTMLElement && event.target.closest("button")) return

    const rect = event.currentTarget.getBoundingClientRect()
    const startRect = floatingRect || {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    }

    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: startRect.left,
      startTop: startRect.top,
      width: rect.width,
      height: rect.height,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    setFloatingRect(clampFloatingRect(startRect))
    setIsDragging(true)
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    setFloatingRect(
      clampFloatingRect({
        left: dragState.startLeft + event.clientX - dragState.startX,
        top: dragState.startTop + event.clientY - dragState.startY,
        width: dragState.width,
        height: dragState.height,
      })
    )
  }

  const handlePointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current
    if (!dragState || dragState.pointerId !== event.pointerId) return

    dragStateRef.current = null
    event.currentTarget.releasePointerCapture(event.pointerId)
    setIsDragging(false)
  }

  const recordPlay = () => {
    const playKey = currentTrack.source === "youtube"
      ? `youtube:${currentTrack.videoId}`
      : `local:${currentTrack.id}`

    setIsPlaying(true)

    if (recordedPlayKeyRef.current === playKey) {
      return
    }
    recordedPlayKeyRef.current = playKey

    if (isYouTube && currentTrack.videoId) {
      fetch(`/api/youtube/tracks/${currentTrack.videoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "incrementPlayCount" }),
      }).catch(() => {})
      if (!pauseWatchHistory) {
        fetch("/api/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ytVideoId: currentTrack.videoId,
            source: "youtube",
            progressPct: 0,
          }),
        }).catch(() => {})
      }
    } else {
      const trackId = getNumericTrackId(currentTrack)
      if (trackId) {
        fetch(`/api/tracks/${trackId}/play`, { method: "POST" }).catch(() => {})
        if (!pauseWatchHistory) {
          fetch("/api/history", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              trackId,
              source: "local",
              progressPct: 0,
            }),
          }).catch(() => {})
        }
      }
    }
  }

  return (
    <div
      className={cn(
        "fixed overflow-hidden rounded-lg bg-black shadow-2xl transition-shadow duration-150 [contain:layout_paint] [transform:translateZ(0)]",
        !shouldShowVideo
          ? "pointer-events-none z-[-1] opacity-0"
          : isExpanded
          ? "inset-0 z-[210] rounded-none"
          : isExpandedPlayerOpen && dockRect
          ? "z-[160]"
          : isExpandedPlayerOpen
          ? cn(
              "z-[160]",
              "left-4 right-4 top-[calc(6rem+env(safe-area-inset-top,0px))] aspect-video max-h-[calc(100vh-12rem)]",
              "sm:left-1/2 sm:right-auto sm:w-[560px] sm:max-w-[calc(100vw-4rem)] sm:-translate-x-1/2"
            )
          : "bottom-[calc(9rem+env(safe-area-inset-bottom,0px))] left-4 right-4 z-50 h-40 w-auto sm:left-auto sm:h-48 sm:w-80 md:h-56 md:w-96 lg:bottom-24",
        isFloatingPicture && "cursor-grab touch-none active:cursor-grabbing",
        isDragging && "cursor-grabbing"
      )}
      style={videoStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
    >
      <video
        ref={videoRef}
        src={videoSrc}
        className="h-full w-full object-contain"
        preload="auto"
        playsInline
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          applyVideoVolume(e.currentTarget)
          const mediaDuration = e.currentTarget.duration
          setDuration(Number.isFinite(mediaDuration) && mediaDuration > 0 ? mediaDuration : knownDuration)
          if (currentTime > 0 && Math.abs(e.currentTarget.currentTime - currentTime) > 0.5) {
            e.currentTarget.currentTime = currentTime
          }
        }}
        onLoadedData={playVideoWhenReady}
        onCanPlay={playVideoWhenReady}
        onPlaying={(e) => {
          clearOfflineFallbackTimer()
          const liveTime = e.currentTarget.currentTime
          setCurrentTime(liveTime)
          if (playbackMode === "video") {
            notifyMediaEngineActive("video", liveTime)
          }
        }}
        onDurationChange={(e) => {
          const mediaDuration = e.currentTarget.duration
          setDuration(Number.isFinite(mediaDuration) && mediaDuration > 0 ? mediaDuration : knownDuration)
        }}
        onEnded={() => setIsPlaying(false)}
        onError={() => {
          if (!offlineVideoUrl) void tryOfflineVideoFallback()
        }}
        onWaiting={() => {
          if (offlineVideoUrl || !usePlayerStore.getState().isPlaying) return
          clearOfflineFallbackTimer()
          offlineFallbackTimerRef.current = setTimeout(() => {
            void tryOfflineVideoFallback()
          }, OFFLINE_VIDEO_FALLBACK_TIMEOUT_MS)
        }}
        onPlay={recordPlay}
        onPause={() => {
          if (suppressPauseStateRef.current || audioHandoffActive || playbackMode === "audio") return

          const playerState = usePlayerStore.getState()
          const settingsState = useSettingsStore.getState()

          if (!playerState.isExpandedPlayerOpen && settingsState.playbackMode === "video") {
            setIsPlaying(false)
          }
        }}
      >
        {subtitleSrc && (
          <track kind="subtitles" src={subtitleSrc} srcLang="en" label="Captions" />
        )}
      </video>

      {/* Controls overlay */}
      <div className="absolute inset-0 flex items-start justify-end gap-2 p-2 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:hover:opacity-100">
        {isExpandedPlayerOpen && (
          <Button
            variant="secondary"
            size="icon"
            className="h-8 w-8 bg-black/50 hover:bg-black/70"
            onClick={requestPictureInPicture}
          >
            <PictureInPicture2 className="h-4 w-4" />
          </Button>
        )}
        <Button
          variant="secondary"
          size="icon"
          className="h-8 w-8 bg-black/50 hover:bg-black/70"
          onClick={() => {
            if (isExpanded) {
              setIsExpanded(false)
              return
            }
            requestFullscreen()
          }}
        >
          {isExpanded && !isExpandedPlayerOpen ? (
            <Minimize2 className="h-4 w-4" />
          ) : (
            <Maximize2 className="h-4 w-4" />
          )}
        </Button>
        {!isExpandedPlayerOpen && (
          <Button
            variant="secondary"
            size="icon"
            className="h-8 w-8 bg-black/50 hover:bg-black/70"
            onClick={() => setIsVisible(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Track info */}
      {!isExpandedPlayerOpen && (
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-3">
          <p className="truncate text-sm font-medium text-white">
            {currentTrack.title}
          </p>
          <p className="truncate text-xs text-white/70">
            {currentTrack.artist}
          </p>
        </div>
      )}
    </div>
  )
}
