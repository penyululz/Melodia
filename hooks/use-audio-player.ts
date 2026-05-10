"use client"

import { useEffect, useRef, useCallback } from "react"
import { Howl } from "howler"
import { usePlayerStore, type Track } from "@/stores/player-store"
import { useSettingsStore } from "@/stores/settings-store"
import {
  getBestTrackMediaUrl,
  getOfflineObjectUrlForTrack,
  getYouTubeVideoIdFromTrack,
} from "@/lib/offline-media"
import { hasVideoExtension, HOWLER_FORMATS } from "@/lib/format"
import { getNormalizedVolume } from "@/lib/audio-normalization"
import {
  listenForMediaEngineActive,
  listenForPlaybackSeek,
  notifyMediaEngineActive,
} from "@/lib/playback-events"

function getHowlerFormats(track: { source?: string; file_format?: string | null; file_path?: string } | null) {
  return track ? HOWLER_FORMATS : undefined
}

function getNumericTrackId(track: { id?: number | string } | null): number | null {
  const id = Number(track?.id)
  return Number.isInteger(id) && id > 0 ? id : null
}

function getTrackMediaKey(track: Partial<Track> | null): string | null {
  if (!track) return null

  const videoId = getYouTubeVideoIdFromTrack(track)
  if (videoId) return `youtube:${videoId}`

  if (track.id !== undefined && track.id !== null) return `local:${track.id}`
  return track.file_path ? `file:${track.file_path}` : null
}

const OFFLINE_FALLBACK_TIMEOUT_MS = 4500

function getUsableDuration(mediaDuration: number | null | undefined, fallbackDuration: number | null | undefined): number {
  if (typeof mediaDuration === "number" && Number.isFinite(mediaDuration) && mediaDuration > 0) {
    return mediaDuration
  }

  if (typeof fallbackDuration === "number" && Number.isFinite(fallbackDuration) && fallbackDuration > 0) {
    return fallbackDuration
  }

  return 0
}

export function useAudioPlayer() {
  const { playbackMode, streamingQuality, pauseWatchHistory } = useSettingsStore()
  const offlineUrlRef = useRef<string | null>(null)
  const howlRef = useRef<Howl | null>(null)
  const animationRef = useRef<number | null>(null)
  const recordedPlayKeyRef = useRef<string | null>(null)
  const loadedTrackKeyRef = useRef<string | null>(null)
  const suppressPauseStateRef = useRef(false)

  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    queue,
    queueIndex,
    setIsPlaying,
    setCurrentTime,
    setDuration,
    playNext,
  } = usePlayerStore()

  useEffect(() => {
    recordedPlayKeyRef.current = null
  }, [currentTrack?.id, currentTrack?.videoId, currentTrack?.source])

  // Update time display
  const updateTime = useCallback(() => {
    if (howlRef.current && howlRef.current.playing()) {
      const seek = howlRef.current.seek() as number
      setCurrentTime(seek)
      animationRef.current = requestAnimationFrame(updateTime)
    }
  }, [setCurrentTime])

  // Initialize or change track
  useEffect(() => {
    let isCancelled = false
    let offlineFallbackTimer: ReturnType<typeof setTimeout> | null = null

    const clearOfflineFallbackTimer = () => {
      if (offlineFallbackTimer) {
        clearTimeout(offlineFallbackTimer)
        offlineFallbackTimer = null
      }
    }

    if (!currentTrack) {
      clearOfflineFallbackTimer()
      if (howlRef.current) {
        howlRef.current.unload()
        howlRef.current = null
      }
      loadedTrackKeyRef.current = null
      if (offlineUrlRef.current) {
        URL.revokeObjectURL(offlineUrlRef.current)
        offlineUrlRef.current = null
      }
      return
    }

    const activeTrack = currentTrack
    const activeTrackKey = getTrackMediaKey(activeTrack)
    const knownDuration = getUsableDuration(null, activeTrack.duration)
    if (knownDuration > 0) {
      setDuration(knownDuration)
    }

    // Determine audio source based on track type and settings
    const youtubeVideoId = getYouTubeVideoIdFromTrack(activeTrack)
    const isYouTube = Boolean(youtubeVideoId)
    const isLocalVideoTrack = !isYouTube && activeTrack.source !== "youtube" && hasVideoExtension(activeTrack)
    const shouldSkipAudio = playbackMode === "video" && (isYouTube || isLocalVideoTrack)
    const hasBridgeAudio =
      Boolean(howlRef.current) &&
      Boolean(activeTrackKey) &&
      loadedTrackKeyRef.current === activeTrackKey

    const stopAudio = () => {
      if (howlRef.current) {
        howlRef.current.unload()
        howlRef.current = null
      }
      loadedTrackKeyRef.current = null

      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      }

      if (offlineUrlRef.current) {
        URL.revokeObjectURL(offlineUrlRef.current)
        offlineUrlRef.current = null
      }
    }

    if (shouldSkipAudio) {
      if (!hasBridgeAudio) {
        stopAudio()
        return
      }

      if (isPlaying && howlRef.current?.playing()) {
        animationRef.current = requestAnimationFrame(updateTime)
      } else if (!isPlaying && howlRef.current?.playing()) {
        howlRef.current.pause()
      }

      return
    }

    stopAudio()

    const swapToOffline = async (resumeFrom?: number) => {
      const offlineMedia = await getOfflineObjectUrlForTrack(activeTrack, [
        "audio/",
        "video/",
      ]).catch(() => null)

      if (isCancelled) {
        if (offlineMedia?.url) URL.revokeObjectURL(offlineMedia.url)
        return false
      }

      if (!offlineMedia) return false

      const previousHowl = howlRef.current
      const shouldResume = usePlayerStore.getState().isPlaying
      const liveSeek = previousHowl?.seek()
      const resumeTime =
        typeof resumeFrom === "number"
          ? resumeFrom
          : typeof liveSeek === "number"
            ? liveSeek
            : usePlayerStore.getState().currentTime

      previousHowl?.unload()
      if (offlineUrlRef.current) {
        URL.revokeObjectURL(offlineUrlRef.current)
      }
      offlineUrlRef.current = offlineMedia.url

      startHowl(offlineMedia.url, Math.max(0, resumeTime || 0), true)
      if (shouldResume) {
        howlRef.current?.play()
      }
      return true
    }

    function startHowl(audioSrc: string, resumeTime: number, usingOffline: boolean) {
      clearOfflineFallbackTimer()
      loadedTrackKeyRef.current = activeTrackKey

      const scheduleOfflineFallback = () => {
        if (usingOffline || !usePlayerStore.getState().isPlaying) return

        offlineFallbackTimer = setTimeout(() => {
          const activeHowl = howlRef.current
          if (!activeHowl || activeHowl.playing()) return

          const liveSeek = activeHowl.seek()
          void swapToOffline(
            typeof liveSeek === "number" ? liveSeek : usePlayerStore.getState().currentTime
          )
        }, OFFLINE_FALLBACK_TIMEOUT_MS)
      }

      howlRef.current = new Howl({
        src: [audioSrc],
        html5: true,
        format: getHowlerFormats(activeTrack),
        volume: getNormalizedVolume(volume, isMuted, activeTrack),
        onload: () => {
          clearOfflineFallbackTimer()
          if (howlRef.current) {
            setDuration(getUsableDuration(howlRef.current.duration(), activeTrack.duration))
            if (resumeTime > 0) {
              howlRef.current.seek(resumeTime)
              setCurrentTime(resumeTime)
            }
          }
        },
        onloaderror: () => {
          clearOfflineFallbackTimer()
          if (!usingOffline) {
            void swapToOffline(resumeTime)
          }
        },
        onplayerror: () => {
          clearOfflineFallbackTimer()
          if (!usingOffline) {
            void swapToOffline().then((swapped) => {
              if (!swapped) setIsPlaying(false)
            })
            return
          }
          setIsPlaying(false)
        },
        onplay: () => {
          clearOfflineFallbackTimer()
          setIsPlaying(true)
          animationRef.current = requestAnimationFrame(updateTime)
          const seek = howlRef.current?.seek()
          notifyMediaEngineActive(
            "audio",
            typeof seek === "number" ? seek : usePlayerStore.getState().currentTime
          )

          const playKey =
            activeTrack.source === "youtube" && activeTrack.videoId
              ? `youtube:${activeTrack.videoId}`
              : `local:${activeTrack.id}`

          if (recordedPlayKeyRef.current !== playKey) {
            recordedPlayKeyRef.current = playKey

            // Update play count
            if (activeTrack.source === "youtube" && activeTrack.videoId) {
              fetch(`/api/youtube/tracks/${activeTrack.videoId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action: "incrementPlayCount" }),
              }).catch(() => {})
              if (!pauseWatchHistory) {
                fetch("/api/history", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    ytVideoId: activeTrack.videoId,
                    source: "youtube",
                    progressPct: 0,
                  }),
                }).catch(() => {})
              }
            } else {
              const trackId = getNumericTrackId(activeTrack)
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

          updateMediaSessionMetadata(activeTrack)
        },
        onpause: () => {
          clearOfflineFallbackTimer()
          if (animationRef.current) {
            cancelAnimationFrame(animationRef.current)
            animationRef.current = null
          }

          if (!suppressPauseStateRef.current) {
            setIsPlaying(false)
          }
        },
        onend: () => {
          clearOfflineFallbackTimer()
          if (animationRef.current) {
            cancelAnimationFrame(animationRef.current)
            animationRef.current = null
          }
          playNext()
        },
      })

      scheduleOfflineFallback()
    }

    // Load audio - check offline first, then online
    const loadAudio = async () => {
      const resumeTime = usePlayerStore.getState().currentTime

      // Try offline version first
      const offlineMedia = await getOfflineObjectUrlForTrack(activeTrack, [
        "audio/",
        "video/",
      ]).catch(() => null)

      if (isCancelled) {
        if (offlineMedia?.url) URL.revokeObjectURL(offlineMedia.url)
        return
      }

      const audioSrc = offlineMedia
        ? offlineMedia.url
        : getBestTrackMediaUrl(activeTrack, "audio", streamingQuality)

      if (offlineMedia) {
        offlineUrlRef.current = offlineMedia.url
      } else {
        offlineUrlRef.current = null
      }

      if (!audioSrc) return

      startHowl(audioSrc, resumeTime, Boolean(offlineMedia))

      // Auto-play
      if (isPlaying) {
        howlRef.current?.play()
      }
    }

    loadAudio()

    return () => {
      isCancelled = true
      clearOfflineFallbackTimer()
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      }
    }
  }, [currentTrack?.id, currentTrack?.videoId, currentTrack?.file_path, playbackMode, streamingQuality])

  useEffect(() => {
    return listenForMediaEngineActive(({ engine, time }) => {
      if (engine !== "video") return
      if (useSettingsStore.getState().playbackMode !== "video") return

      const activeTrackKey = getTrackMediaKey(usePlayerStore.getState().currentTrack)
      if (!activeTrackKey || loadedTrackKeyRef.current !== activeTrackKey) return

      const activeHowl = howlRef.current
      if (!activeHowl) return

      suppressPauseStateRef.current = true
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      }
      activeHowl.pause()
      activeHowl.unload()
      howlRef.current = null
      loadedTrackKeyRef.current = null
      setCurrentTime(time)

      window.setTimeout(() => {
        suppressPauseStateRef.current = false
      }, 0)
    })
  }, [setCurrentTime])

  // Handle play/pause changes
  useEffect(() => {
    if (!howlRef.current) return

    if (isPlaying && !howlRef.current.playing()) {
      howlRef.current.play()
    } else if (!isPlaying && howlRef.current.playing()) {
      howlRef.current.pause()
    }
  }, [isPlaying])

  useEffect(() => {
    return listenForPlaybackSeek((time) => {
      if (howlRef.current) {
        howlRef.current.seek(time)
      }
      setCurrentTime(time)
    })
  }, [setCurrentTime])

  // Handle volume changes
  useEffect(() => {
    if (howlRef.current) {
      howlRef.current.volume(getNormalizedVolume(volume, isMuted, currentTrack))
    }
  }, [volume, isMuted, currentTrack?.loudness_adjust_db, currentTrack?.replaygain_track_gain, currentTrack?.replaygain_album_gain])

  useEffect(() => {
    const nextTrack = queue[queueIndex + 1]
    if (!nextTrack) return

    const url = getBestTrackMediaUrl(nextTrack, "audio", streamingQuality)
    if (!url?.startsWith("/")) return

    const controller = new AbortController()
    fetch(url, {
      headers: { Range: "bytes=0-4095" },
      signal: controller.signal,
    }).catch(() => {})

    return () => controller.abort()
  }, [queue, queueIndex, streamingQuality])

  useEffect(() => {
    if (!currentTrack || !isPlaying) return

    const youtubeVideoId = getYouTubeVideoIdFromTrack(currentTrack)
    const canUseVideo = Boolean(
      youtubeVideoId ||
        (currentTrack.source !== "youtube" && hasVideoExtension(currentTrack))
    )
    if (!canUseVideo) return

    const url = getBestTrackMediaUrl(currentTrack, "video", streamingQuality)
    if (!url?.startsWith("/")) return

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      fetch(url, {
        cache: "no-store",
        headers: { Range: "bytes=0-4095" },
        signal: controller.signal,
      }).catch(() => {})
    }, 700)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [currentTrack?.id, currentTrack?.videoId, currentTrack?.file_path, isPlaying, streamingQuality])

  // Media Session API handlers
  useEffect(() => {
    if ("mediaSession" in navigator) {
      const store = usePlayerStore.getState()
      const seekTo = (time: number) => {
        const latest = usePlayerStore.getState()
        const safeTime = Math.max(0, Math.min(time, latest.duration || time))
        if (howlRef.current) {
          howlRef.current.seek(safeTime)
        }
        latest.setCurrentTime(safeTime)
      }

      navigator.mediaSession.setActionHandler("play", () => store.setIsPlaying(true))
      navigator.mediaSession.setActionHandler("pause", () => store.setIsPlaying(false))
      navigator.mediaSession.setActionHandler("previoustrack", () => store.playPrevious())
      navigator.mediaSession.setActionHandler("nexttrack", () => store.playNext())
      navigator.mediaSession.setActionHandler("seekto", (details) => {
        if (details.seekTime !== undefined) {
          seekTo(details.seekTime)
        }
      })
      navigator.mediaSession.setActionHandler("seekbackward", (details) => {
        const offset = details.seekOffset || 10
        seekTo(usePlayerStore.getState().currentTime - offset)
      })
      navigator.mediaSession.setActionHandler("seekforward", (details) => {
        const offset = details.seekOffset || 10
        seekTo(usePlayerStore.getState().currentTime + offset)
      })
    }
  }, [])

  useEffect(() => {
    if (!currentTrack || !("mediaSession" in navigator)) return

    updateMediaSessionMetadata(currentTrack)
  }, [currentTrack?.id, currentTrack?.videoId, currentTrack?.title, currentTrack?.artist, currentTrack?.album, currentTrack?.cover_art_path])

  useEffect(() => {
    if (!("mediaSession" in navigator)) return

    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused"
    if (duration > 0 && "setPositionState" in navigator.mediaSession) {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: 1,
        position: Math.min(currentTime, duration),
      })
    }
  }, [currentTime, duration, isPlaying])

  // Seek function
  const seek = useCallback(
    (time: number) => {
      if (howlRef.current) {
        howlRef.current.seek(time)
      }
      setCurrentTime(time)
    },
    [setCurrentTime]
  )

  // Toggle play/pause
  const togglePlay = useCallback(() => {
    setIsPlaying(!isPlaying)
  }, [isPlaying, setIsPlaying])

  return {
    seek,
    togglePlay,
    currentTime,
    duration,
  }
}

function updateMediaSessionMetadata(track: {
  title: string
  artist: string | null
  album: string | null
  cover_art_path?: string | null
}) {
  if (!("mediaSession" in navigator) || !("MediaMetadata" in window)) return

  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist || "Unknown Artist",
    album: track.album || "Unknown Album",
    artwork: track.cover_art_path
      ? [
          { src: track.cover_art_path, sizes: "96x96" },
          { src: track.cover_art_path, sizes: "512x512" },
        ]
      : [],
  })
}
