"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { usePlayerStore, Track } from "@/stores/player-store"
import { useSidebarStore } from "@/stores/sidebar-store"
import { useSettingsStore } from "@/stores/settings-store"
import { seekToPlayback } from "@/lib/playback-events"
import { MOCK_TRACKS } from "@/lib/mock-data"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import { MarqueeText } from "@/components/ui/marquee-text"
import { cn } from "@/lib/utils"
import { SyncedLyrics } from "./synced-lyrics"
import { SaveOfflineButton } from "@/components/offline/save-offline-button"
import { getYouTubeVideoIdFromTrack } from "@/lib/offline-media"
import { hasVideoExtension } from "@/lib/format"
import {
  ChevronDown,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  ThumbsUp,
  ThumbsDown,
  Music,
  Headphones,
  Video,
  MoreVertical,
  Maximize,
  Minimize,
  PictureInPicture2,
  Volume2,
  VolumeX,
  Volume1,
  Volume,
  Captions,
} from "lucide-react"

interface ExpandedPlayerProps {
  onClose: () => void
}

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return "0:00"
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, "0")}`
}

function getSubtitleSource(
  track: {
    id?: number | string
    videoId?: string
    file_path?: string
  } | null
): string | null {
  const videoId = getYouTubeVideoIdFromTrack(track)
  if (videoId) return `/api/subtitles/youtube/${encodeURIComponent(videoId)}`

  const id = Number(track?.id)
  return Number.isInteger(id) && id > 0 ? `/api/subtitles/tracks/${id}` : null
}

export function ExpandedPlayer({ onClose }: ExpandedPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const recordedPlayKeyRef = useRef<string | null>(null)
  const {
    currentTrack,
    isPlaying,
    currentTime: playerCurrentTime,
    duration: playerDuration,
    volume,
    isMuted,
    queue,
    shuffle,
    repeat,
    setCurrentTime,
    setDuration,
    setIsPlaying,
    setVolume,
    toggleMute,
    setExpandedPlayerOpen,
    togglePlay,
    toggleShuffle,
    cycleRepeat,
    playNext,
    playPrevious,
    playTrack,
  } = usePlayerStore()

  const { isCollapsed } = useSidebarStore()
  const { playbackMode, setPlaybackMode, streamingQuality, pauseWatchHistory } = useSettingsStore()
  const currentTime = playerCurrentTime
  const trackDuration = Number(currentTrack?.duration)
  const duration =
    playerDuration > 0
      ? playerDuration
      : Number.isFinite(trackDuration) && trackDuration > 0
        ? trackDuration
        : 0
  const [activeTab, setActiveTab] = useState<"queue" | "lyrics" | "related">("queue")
  const [liked, setLiked] = useState(false)
  const [disliked, setDisliked] = useState(false)
  const [isVideoFullscreen, setIsVideoFullscreen] = useState(false)
  const [ccEnabled, setCcEnabled] = useState(false)
  const [showVolume, setShowVolume] = useState(false)
  const subtitleSrc = getSubtitleSource(currentTrack || null)
  const feedbackVideoId = getYouTubeVideoIdFromTrack(currentTrack || null)
  const isYouTube = Boolean(feedbackVideoId)
  const isLocalVideo = !isYouTube && currentTrack?.source !== "youtube" && hasVideoExtension(currentTrack || null)
  const shouldRenderVideo = playbackMode === "video" && (isYouTube || isLocalVideo)
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0
  const feedbackTrackId = !feedbackVideoId && Number.isInteger(Number(currentTrack?.id))
    ? Number(currentTrack?.id)
    : null

  const handleSeek = (value: number[]) => {
    if (duration <= 0) return
    const nextTime = (value[0] / 100) * duration
    seekToPlayback(nextTime)
  }

  useEffect(() => {
    setLiked(false)
    setDisliked(false)

    const params = new URLSearchParams()
    if (feedbackVideoId) {
      params.set("ytVideoId", feedbackVideoId)
    } else if (feedbackTrackId) {
      params.set("trackId", String(feedbackTrackId))
    } else {
      return
    }

    let cancelled = false
    fetch(`/api/feedback?${params.toString()}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (cancelled || !data) return
        setLiked(data.action === "like")
        setDisliked(data.action === "dislike")
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [feedbackTrackId, feedbackVideoId])

  const handleFeedback = (nextAction: "like" | "dislike") => {
    const action =
      (nextAction === "like" && liked) || (nextAction === "dislike" && disliked)
        ? null
        : nextAction

    setLiked(action === "like")
    setDisliked(action === "dislike")

    fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action,
        trackId: feedbackTrackId,
        ytVideoId: feedbackVideoId,
      }),
    }).catch(() => {})
  }

  // Related: same genre, excluding current track
  const related = MOCK_TRACKS.filter(
    (t) => t.genre === (currentTrack as any)?.genre && t.id !== currentTrack?.id
  ).slice(0, 8)

  const videoSrc =
    currentTrack?.source === "youtube" && currentTrack.videoId
      ? `/api/youtube/stream/${currentTrack.videoId}?mode=video&quality=${streamingQuality}`
      : currentTrack?.file_path || ""

  useEffect(() => {
    setExpandedPlayerOpen(true)
    return () => setExpandedPlayerOpen(false)
  }, [setExpandedPlayerOpen])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !shouldRenderVideo || !currentTrack || !videoSrc) return

    if (isPlaying) {
      video.play().catch(console.error)
    } else {
      video.pause()
    }
  }, [isPlaying, shouldRenderVideo, currentTrack?.id, currentTrack?.videoId, videoSrc])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.volume = isMuted ? 0 : volume
  }, [volume, isMuted])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !shouldRenderVideo) return

    if (Math.abs(video.currentTime - currentTime) > 1) {
      video.currentTime = currentTime
    }
  }, [currentTime, shouldRenderVideo])

  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    for (const track of Array.from(video.textTracks)) {
      track.mode = ccEnabled ? "showing" : "hidden"
    }
  }, [ccEnabled, shouldRenderVideo, subtitleSrc])

  const recordVideoPlay = () => {
    if (!currentTrack) return

    const playKey = isYouTube
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
    } else if (currentTrack.id) {
      fetch(`/api/tracks/${currentTrack.id}/play`, { method: "POST" }).catch(() => {})

      if (!pauseWatchHistory) {
        fetch("/api/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            trackId: currentTrack.id,
            source: "local",
            progressPct: 0,
          }),
        }).catch(() => {})
      }
    }
  }

  const requestPictureInPicture = () => {
    videoRef.current?.requestPictureInPicture?.().catch(() => {})
  }

  const openVideoFullscreen = () => {
    const video = videoRef.current
    if (video?.requestFullscreen) {
      video.requestFullscreen().catch(() => setIsVideoFullscreen(true))
      return
    }

    setIsVideoFullscreen(true)
  }

  const renderVideo = (className: string) => (
    <video
      ref={videoRef}
      src={videoSrc}
      poster={thumbnail}
      className={className}
      preload="auto"
      playsInline
      onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
      onLoadedMetadata={(event) => {
        const mediaDuration = event.currentTarget.duration
        setDuration(Number.isFinite(mediaDuration) && mediaDuration > 0 ? mediaDuration : duration)
      }}
      onDurationChange={(event) => {
        const mediaDuration = event.currentTarget.duration
        setDuration(Number.isFinite(mediaDuration) && mediaDuration > 0 ? mediaDuration : duration)
      }}
      onEnded={() => setIsPlaying(false)}
      onPlay={recordVideoPlay}
    >
      {subtitleSrc && (
        <track kind="subtitles" src={subtitleSrc} srcLang="en" label="Captions" />
      )}
    </video>
  )

  if (!currentTrack) return null

  const thumbnail =
    currentTrack.cover_art_path ||
    (currentTrack as any).thumbnailUrl ||
    "/placeholder.svg?height=400&width=400"

  // On desktop the expanded player must also be offset by the sidebar
  const sidebarOffset = isCollapsed ? "lg:pl-16" : "lg:pl-64"

  // Compute volume icon
  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 0.3 ? Volume : volume < 0.7 ? Volume1 : Volume2

  // Video fullscreen mode
  if (isVideoFullscreen && shouldRenderVideo) {
    return (
      <div className="fixed inset-0 z-[200] flex flex-col bg-black">
        {/* Video area — fills all available space */}
        <div className="relative flex-1 overflow-hidden">
          {renderVideo("h-full w-full object-contain")}
          {/* CC overlay (mock) */}
          {ccEnabled && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
              <span className="rounded bg-black/80 px-3 py-1 text-sm text-white">
                ♪ {currentTrack.title} ♪
              </span>
            </div>
          )}
        </div>

        {/* Seekable progress bar */}
        <div className="group relative h-1 w-full cursor-pointer bg-white/20 hover:h-2 transition-all">
          <div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} />
        </div>

        {/* Bottom controls bar — two rows on mobile, one row on desktop */}
        <div className="flex flex-col bg-black/90 px-3 pb-3 pt-2 lg:px-5">

          {/* Row 1 (mobile only): track info + exit */}
          <div className="flex items-center gap-2 pb-1 lg:hidden">
            <div className="relative h-8 w-8 flex-shrink-0 overflow-hidden rounded">
              <Image src={thumbnail} alt="" fill className="object-cover" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{currentTrack.title}</p>
              <p className="truncate text-xs text-white/60">{currentTrack.artist}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setIsVideoFullscreen(false)}
              className="h-8 w-8 flex-shrink-0 text-white/70 hover:text-white">
              <Minimize className="h-4 w-4" />
            </Button>
          </div>

          {/* Row 2: all controls in one flex row */}
          <div className="flex items-center gap-1 lg:gap-2">

            {/* Playback: prev / play / next */}
            <Button variant="ghost" size="icon" onClick={playPrevious}
              className="h-9 w-9 flex-shrink-0 text-white/80 hover:text-white">
              <SkipBack className="h-4 w-4 fill-current" />
            </Button>
            <Button variant="ghost" size="icon" onClick={togglePlay}
              className="h-10 w-10 flex-shrink-0 text-white hover:text-white">
              {isPlaying
                ? <Pause className="h-5 w-5 fill-current" />
                : <Play className="h-5 w-5 fill-current" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={playNext}
              className="h-9 w-9 flex-shrink-0 text-white/80 hover:text-white">
              <SkipForward className="h-4 w-4 fill-current" />
            </Button>

            {/* Timestamp */}
            <span className="whitespace-nowrap text-xs text-white/60 lg:text-sm">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>

            {/* Track info — desktop only, fills remaining space */}
            <div className="hidden min-w-0 flex-1 items-center gap-2 px-2 lg:flex">
              <div className="relative h-8 w-8 flex-shrink-0 overflow-hidden rounded">
                <Image src={thumbnail} alt="" fill className="object-cover" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-white">{currentTrack.title}</p>
                <p className="truncate text-xs text-white/60">{currentTrack.artist}</p>
              </div>
            </div>

            {/* Spacer on mobile */}
            <div className="flex-1 lg:hidden" />

            {/* Shuffle */}
            <Button variant="ghost" size="icon" onClick={toggleShuffle}
              className={cn("h-9 w-9 flex-shrink-0 hover:text-white", shuffle ? "text-primary" : "text-white/70")}>
              <Shuffle className="h-4 w-4" />
            </Button>

            {/* Repeat/Loop */}
            <Button variant="ghost" size="icon" onClick={cycleRepeat}
              className={cn("h-9 w-9 flex-shrink-0 hover:text-white", repeat !== "off" ? "text-primary" : "text-white/70")}>
              {repeat === "one" ? <Repeat1 className="h-4 w-4" /> : <Repeat className="h-4 w-4" />}
            </Button>

            {/* Volume — click to toggle slider */}
            <div className="relative flex flex-shrink-0 items-center">
              <Button variant="ghost" size="icon"
                onClick={() => setShowVolume(!showVolume)}
                className={cn("h-9 w-9 hover:text-white", showVolume ? "text-primary" : "text-white/70")}>
                <VolumeIcon className="h-4 w-4" />
              </Button>
              {showVolume && (
                <div className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-lg bg-black/90 px-3 py-3 shadow-xl">
                  <Slider
                    value={[isMuted ? 0 : volume * 100]}
                    max={100}
                    step={1}
                    orientation="vertical"
                    onValueChange={(v) => setVolume(v[0] / 100)}
                    className="h-24"
                  />
                </div>
              )}
            </div>

            {/* CC / Subtitles */}
            <Button variant="ghost" size="icon"
              onClick={() => setCcEnabled(!ccEnabled)}
              className={cn("h-9 w-9 flex-shrink-0 hover:text-white", ccEnabled ? "text-primary" : "text-white/70")}>
              <Captions className="h-4 w-4" />
            </Button>

            {/* Like / Dislike */}
            <Button variant="ghost" size="icon"
              onClick={() => handleFeedback("dislike")}
              className={cn("h-9 w-9 flex-shrink-0 hover:text-white", disliked ? "text-primary" : "text-white/70")}>
              <ThumbsDown className={cn("h-4 w-4", disliked && "fill-current")} />
            </Button>
            <Button variant="ghost" size="icon"
              onClick={() => handleFeedback("like")}
              className={cn("h-9 w-9 flex-shrink-0 hover:text-white", liked ? "text-primary" : "text-white/70")}>
              <ThumbsUp className={cn("h-4 w-4", liked && "fill-current")} />
            </Button>

            {/* Exit fullscreen — desktop only (mobile has it in row 1) */}
            <Button variant="ghost" size="icon"
              onClick={() => setIsVideoFullscreen(false)}
              className="hidden h-9 w-9 flex-shrink-0 text-white/70 hover:text-white lg:flex">
              <Minimize className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={cn("fixed inset-0 z-[100] bg-background", sidebarOffset)}>
      {/* Subtle gradient overlay */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-muted/20 to-background" />

      {/* ── DESKTOP LAYOUT: two columns ── */}
      <div className="relative hidden h-full lg:flex lg:flex-col">
        {/* Desktop header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-3">
          <Button variant="ghost" size="icon" onClick={onClose} className="h-9 w-9">
            <ChevronDown className="h-5 w-5" />
          </Button>

          <SongVideoToggle mode={playbackMode} onChange={setPlaybackMode} />

          <Button variant="ghost" size="icon" className="h-9 w-9">
            <MoreVertical className="h-5 w-5" />
          </Button>
        </div>

        {/* Desktop body: artwork + controls left, queue/lyrics right */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left: artwork + controls */}
          <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-10 py-6">
            {/* Artwork */}
            <div
              className={cn(
                "relative w-full overflow-hidden rounded-xl bg-black shadow-2xl",
                shouldRenderVideo
                  ? "aspect-video max-w-[640px] xl:max-w-[760px]"
                  : "aspect-square max-w-[320px] xl:max-w-[380px]"
              )}
              data-video-dock={shouldRenderVideo ? "expanded-player" : undefined}
            >
              {playbackMode === "video" ? (
                <div className="relative h-full w-full">
                  {shouldRenderVideo ? (
                    <div className="h-full w-full bg-black" />
                  ) : (
                    <>
                      <Image src={thumbnail} alt={currentTrack.title} fill className="object-cover" />
                      <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                        <span className="rounded bg-black/50 px-2 py-1 text-xs text-white/80">Video Mode</span>
                      </div>
                    </>
                  )}
                  {/* Video controls overlay */}
                  {!shouldRenderVideo && (
                  <div className="absolute bottom-2 right-2 flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={requestPictureInPicture}
                      className="h-8 w-8 bg-black/60 text-white hover:bg-black/80"
                    >
                      <PictureInPicture2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={openVideoFullscreen}
                      className="h-8 w-8 bg-black/60 text-white hover:bg-black/80"
                    >
                      <Maximize className="h-4 w-4" />
                    </Button>
                  </div>
                  )}
                </div>
              ) : (
                <Image src={thumbnail} alt={currentTrack.title} fill className="object-cover" priority />
              )}
            </div>

            {/* Track info */}
            <div className="w-full max-w-[380px] text-center">
              <MarqueeText text={currentTrack.title} className="text-xl font-bold" />
              <MarqueeText text={currentTrack.artist || "Unknown Artist"} className="mt-1 text-sm text-muted-foreground" />
            </div>

            {/* Like/Dislike/Offline */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline" size="sm" onClick={() => handleFeedback("like")}
                className={cn("gap-1.5 rounded-full", liked && "border-primary text-primary")}
              >
                <ThumbsUp className={cn("h-4 w-4", liked && "fill-current")} />
                <span className="text-xs">12K</span>
              </Button>
              <Button
                variant="outline" size="sm" onClick={() => handleFeedback("dislike")}
                className={cn("rounded-full", disliked && "border-primary text-primary")}
              >
                <ThumbsDown className={cn("h-4 w-4", disliked && "fill-current")} />
              </Button>
              <SaveOfflineButton track={currentTrack} variant="icon" />
              <Button variant="outline" size="sm" className="gap-1.5 rounded-full">
                <Music className="h-4 w-4" />
                <span className="text-xs">Lyrics</span>
              </Button>
            </div>

            {/* Progress */}
            <div className="w-full max-w-[380px]">
              <Slider value={[progress]} max={100} step={0.1} onValueChange={handleSeek} className="cursor-pointer" />
              <div className="mt-1.5 flex justify-between text-xs text-muted-foreground">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>

            {/* Controls */}
            <div className="flex items-center gap-5">
              <Button variant="ghost" size="icon" onClick={toggleShuffle}
                className={cn("h-9 w-9 text-muted-foreground", shuffle && "text-primary")}>
                <Shuffle className="h-5 w-5" />
              </Button>
              <Button variant="ghost" size="icon" onClick={playPrevious} className="h-11 w-11">
                <SkipBack className="h-6 w-6 fill-current" />
              </Button>
              <Button onClick={togglePlay} size="icon"
                className="h-14 w-14 rounded-full bg-foreground text-background hover:bg-foreground/90">
                {isPlaying ? <Pause className="h-6 w-6 fill-current" /> : <Play className="h-6 w-6 fill-current" />}
              </Button>
              <Button variant="ghost" size="icon" onClick={playNext} className="h-11 w-11">
                <SkipForward className="h-6 w-6 fill-current" />
              </Button>
              <Button variant="ghost" size="icon" onClick={cycleRepeat}
                className={cn("h-9 w-9 text-muted-foreground", repeat !== "off" && "text-primary")}>
                {repeat === "one" ? <Repeat1 className="h-5 w-5" /> : <Repeat className="h-5 w-5" />}
              </Button>
            </div>
          </div>

          {/* Right: queue/lyrics/related panel - fixed width, own scroll */}
          <div className="flex w-[340px] flex-shrink-0 flex-col border-l border-border xl:w-[400px]">
            {/* Tabs - fixed */}
            <div className="flex flex-shrink-0 border-b border-border">
              {(["queue", "lyrics", "related"] as const).map((tab) => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={cn(
                    "flex-1 py-3 text-xs font-semibold uppercase tracking-wider transition-colors",
                    activeTab === tab ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"
                  )}>
                  {tab === "queue" ? "Up Next" : tab}
                </button>
              ))}
            </div>

            {/* Tab content - scrolls independently */}
            <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-muted">
              {activeTab === "queue" && (
                <div className="space-y-0.5">
                  {queue.length === 0 ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">Queue is empty</p>
                  ) : queue.slice(0, 20).map((track, i) => (
                    <QueueItem key={`${track.id}-${i}`} track={track} />
                  ))}
                </div>
              )}
              {activeTab === "lyrics" && (
                <div className="h-full">
                  <SyncedLyrics />
                </div>
              )}
              {activeTab === "related" && (
                <div className="space-y-0.5">
                  {related.length === 0 ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">No related tracks</p>
                  ) : related.map((track, i) => (
                    <QueueItem key={`${track.id}-${i}`} track={track as Track} />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── MOBILE / TABLET LAYOUT: scrollable single column ── */}
      <div className="relative flex h-full flex-col overflow-y-auto lg:hidden">
        {/* Mobile header — sticky */}
        <div className="sticky top-0 z-10 flex items-center justify-between bg-background/95 px-4 py-3 backdrop-blur">
          <Button variant="ghost" size="icon" onClick={onClose} className="h-10 w-10">
            <ChevronDown className="h-6 w-6" />
          </Button>

          <SongVideoToggle mode={playbackMode} onChange={setPlaybackMode} />

          <Button variant="ghost" size="icon" className="h-10 w-10">
            <MoreVertical className="h-5 w-5" />
          </Button>
        </div>

        {/* Artwork */}
        <div className="flex justify-center px-8 pt-4">
          <div
            className={cn(
              "relative w-full overflow-hidden rounded-xl bg-black shadow-2xl",
              shouldRenderVideo
                ? "aspect-video max-w-[420px] sm:max-w-[560px]"
                : "aspect-square max-w-[300px] sm:max-w-[360px]"
            )}
            data-video-dock={shouldRenderVideo ? "expanded-player" : undefined}
          >
            {playbackMode === "video" ? (
              <div className="relative h-full w-full">
                {shouldRenderVideo ? (
                  <div className="h-full w-full bg-black" />
                ) : (
                  <>
                    <Image src={thumbnail} alt={currentTrack.title} fill className="object-cover" />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/30">
                      <span className="rounded bg-black/50 px-2 py-1 text-xs text-white/80">Video Mode</span>
                    </div>
                  </>
                )}
                {/* Video expand button */}
                {!shouldRenderVideo && (
                <div className="absolute bottom-2 right-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={openVideoFullscreen}
                    className="h-9 w-9 bg-black/60 text-white hover:bg-black/80"
                  >
                    <Maximize className="h-4 w-4" />
                  </Button>
                </div>
                )}
              </div>
            ) : (
              <Image src={thumbnail} alt={currentTrack.title} fill className="object-cover" priority />
            )}
          </div>
        </div>

        {/* Track info */}
        <div className="mt-6 px-6 text-center">
          <MarqueeText text={currentTrack.title} className="text-xl font-bold" />
          <MarqueeText text={currentTrack.artist || "Unknown Artist"} className="mt-1 text-sm text-muted-foreground" />
        </div>

        {/* Like/Dislike/Offline */}
        <div className="mt-4 flex items-center justify-center gap-2">
          <Button
            variant="outline" size="sm" onClick={() => handleFeedback("like")}
            className={cn("gap-1.5 rounded-full", liked && "border-primary text-primary")}
          >
            <ThumbsUp className={cn("h-4 w-4", liked && "fill-current")} />
            <span className="text-xs">12K</span>
          </Button>
          <Button
            variant="outline" size="sm" onClick={() => handleFeedback("dislike")}
            className={cn("rounded-full", disliked && "border-primary text-primary")}
          >
            <ThumbsDown className={cn("h-4 w-4", disliked && "fill-current")} />
          </Button>
          <SaveOfflineButton track={currentTrack} variant="icon" />
          <Button variant="outline" size="sm" className="gap-1.5 rounded-full">
            <Music className="h-4 w-4" />
            <span className="text-xs">Lyrics</span>
          </Button>
        </div>

        {/* Progress */}
        <div className="mt-6 px-6">
          <Slider value={[progress]} max={100} step={0.1} onValueChange={handleSeek} className="cursor-pointer" />
          <div className="mt-2 flex justify-between text-xs text-muted-foreground">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="mt-4 flex items-center justify-center gap-4 px-6">
          <Button variant="ghost" size="icon" onClick={toggleShuffle}
            className={cn("h-10 w-10 text-muted-foreground", shuffle && "text-primary")}>
            <Shuffle className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" onClick={playPrevious} className="h-12 w-12">
            <SkipBack className="h-6 w-6 fill-current" />
          </Button>
          <Button onClick={togglePlay} size="icon"
            className="h-16 w-16 rounded-full bg-foreground text-background hover:bg-foreground/90">
            {isPlaying ? <Pause className="h-7 w-7 fill-current" /> : <Play className="h-7 w-7 fill-current" />}
          </Button>
          <Button variant="ghost" size="icon" onClick={playNext} className="h-12 w-12">
            <SkipForward className="h-6 w-6 fill-current" />
          </Button>
          <Button variant="ghost" size="icon" onClick={cycleRepeat}
            className={cn("h-10 w-10 text-muted-foreground", repeat !== "off" && "text-primary")}>
            {repeat === "one" ? <Repeat1 className="h-5 w-5" /> : <Repeat className="h-5 w-5" />}
          </Button>
        </div>

        {/* Queue label */}
        {queue.length > 0 && (
          <p className="mt-6 px-6 text-xs text-muted-foreground">
            Playing from <span className="font-medium text-foreground">Your Mix</span>
          </p>
        )}

        {/* Up Next (mobile) */}
        {queue.length > 0 && (
          <div className="mt-3 px-3">
            <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Up Next</h3>
            <div className="space-y-0.5">
              {queue.slice(0, 10).map((track, i) => (
                <QueueItem key={`${track.id}-${i}`} track={track} />
              ))}
            </div>
          </div>
        )}

        {/* Related tracks (mobile) */}
        {related.length > 0 && (
          <div className="mt-6 px-3 pb-8">
            <h3 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              More like this
            </h3>
            <div className="space-y-0.5">
              {related.map((track, i) => (
                <QueueItem key={`${track.id}-${i}`} track={track as Track} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Shared Song/Video toggle
function SongVideoToggle({
  mode,
  onChange,
}: {
  mode: string
  onChange: (mode: "audio" | "video") => void
}) {
  return (
    <div className="flex items-center rounded-full bg-muted/60 p-1">
      <button
        onClick={() => onChange("audio")}
        className={cn(
          "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
          mode === "audio" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Headphones className="h-4 w-4" />
        Song
      </button>
      <button
        onClick={() => onChange("video")}
        className={cn(
          "flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors",
          mode === "video" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground"
        )}
      >
        <Video className="h-4 w-4" />
        Video
      </button>
    </div>
  )
}

// Shared queue item
function QueueItem({ track }: { track: Track }) {
  const { playTrack, queue } = usePlayerStore()
  const thumbnail =
    track.cover_art_path || (track as any).thumbnailUrl || "/placeholder.svg?height=48&width=48"

  return (
    <button
      onClick={() => playTrack(track, queue)}
      className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-muted/50"
    >
      <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-md">
        <Image src={thumbnail} alt={track.title} fill className="object-cover" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{track.title}</p>
        <p className="truncate text-xs text-muted-foreground">{track.artist}</p>
      </div>
      {track.duration && (
        <span className="flex-shrink-0 text-xs text-muted-foreground">{formatTime(track.duration)}</span>
      )}
    </button>
  )
}
