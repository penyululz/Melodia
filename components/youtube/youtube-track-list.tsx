"use client"

import { useMemo } from "react"
import Image from "next/image"
import { usePlayerStore, type Track } from "@/stores/player-store"
import { useSettingsStore, filterTracks, detectContentType } from "@/stores/settings-store"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { AddToPlaylistSubmenu } from "@/components/playlists/add-to-playlist-menu"
import { formatDuration } from "@/lib/format"
import { Play, Pause, Plus, Heart, MoreHorizontal, Youtube, Download, Video, Check, Loader2, Trash2 } from "lucide-react"
import { useState } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { mutate } from "swr"
import { toast } from "sonner"

export interface YTTrackResult {
  videoId: string
  title: string
  artist: string
  album: string | null
  duration: number | null
  thumbnailUrl: string | null
  thumbnailUrlHQ?: string | null
  type?: "song" | "video" | string
  content_type?: "music" | "podcast" | string | null
  podcast_title?: string | null
  podcast_author?: string | null
  is_cached?: boolean
  is_favorite?: boolean
}

interface YouTubeTrackListProps {
  tracks: YTTrackResult[]
  showActions?: boolean
}

export function YouTubeTrackList({
  tracks,
  showActions = true,
}: YouTubeTrackListProps) {
  const { currentTrack, isPlaying, playYTTrack, togglePlay, addYTToQueue } =
    usePlayerStore()
  const settings = useSettingsStore()
  
  // Filter tracks based on user settings
  const filteredTracks = useMemo(() => {
    return filterTracks(tracks, settings)
  }, [tracks, settings])

  const handlePlay = (track: YTTrackResult) => {
    const ytTrack = toPlayerTrack(track)

    if (currentTrack?.videoId === track.videoId) {
      togglePlay()
    } else {
      // Use filtered tracks for the queue
      playYTTrack(ytTrack, filteredTracks.map(toPlayerTrack))
    }
  }

  const saveToLibrary = async (track: YTTrackResult) => {
    try {
      const response = await fetch("/api/youtube/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: track.videoId,
          title: track.title,
          artist: track.artist,
          album: track.album,
          duration: track.duration,
          thumbnailUrl: track.thumbnailUrl,
          thumbnailUrlHQ: track.thumbnailUrlHQ,
          contentType: track.content_type || "music",
          podcastTitle: track.podcast_title,
          podcastAuthor: track.podcast_author,
        }),
      })

      const data = await response.json().catch(() => null)
      if (!response.ok) {
        throw new Error(data?.error || "Failed to save track")
      }

      toast.success("Track saved to library")
      mutate("/api/youtube/tracks")
      return data?.track
    } catch {
      toast.error("Failed to save track")
      throw new Error("Failed to save track")
    }
  }

  const toggleFavorite = async (videoId: string) => {
    try {
      await fetch(`/api/youtube/tracks/${videoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggleFavorite" }),
      })
      mutate("/api/youtube/tracks")
      mutate("/api/youtube/tracks?filter=favorites")
    } catch {
      toast.error("Failed to update favorite")
    }
  }

  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set())

  const downloadTrack = async (track: YTTrackResult, media: "audio" | "video" = "audio") => {
    if (track.is_cached && media === "audio") {
      // Already downloaded, offer to delete
      try {
        const response = await fetch(`/api/youtube/download/${track.videoId}`, { method: "DELETE" })
        if (!response.ok) throw new Error("Failed to remove download")
        toast.success("Download removed")
        mutate("/api/youtube/tracks")
        mutate("/api/youtube/tracks?filter=cached")
        mutate("/api/tracks")
        mutate("/api/albums")
        mutate("/api/artists")
        mutate("/api/genres")
      } catch {
        toast.error("Failed to remove download")
      }
      return
    }

    // First save to library if not already
    try {
      await saveToLibrary(track)
    } catch {
      return
    }

    setDownloadingIds(prev => new Set(prev).add(track.videoId))
    toast.info(media === "video" ? "Downloading MP4 video..." : "Downloading track...")

    try {
      const res = await fetch(
        `/api/youtube/download/${track.videoId}?quality=${settings.downloadQuality}&media=${media}`,
        { method: "POST" }
      )
      const data = await res.json()

      if (data.success) {
        toast.success(
          media === "video"
            ? "MP4 video downloaded and added to your library"
            : "Track downloaded for offline playback"
        )
        mutate("/api/youtube/tracks")
        mutate("/api/youtube/tracks?filter=cached")
        mutate(`/api/youtube/tracks/${track.videoId}`)
        mutate("/api/tracks")
        mutate("/api/albums")
        mutate("/api/artists")
        mutate("/api/genres")
      } else {
        toast.error(data.error || "Download failed")
      }
    } catch {
      toast.error("Download failed")
    } finally {
      setDownloadingIds(prev => {
        const next = new Set(prev)
        next.delete(track.videoId)
        return next
      })
    }
  }

  if (filteredTracks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Youtube className="mb-4 h-16 w-16 text-muted-foreground" />
        <h3 className="text-lg font-medium">No tracks found</h3>
        <p className="text-sm text-muted-foreground">
          {tracks.length > 0 
            ? "All tracks filtered out. Check your settings."
            : "Search for music or import a playlist"}
        </p>
      </div>
    )
  }

  const getContentTypeBadge = (track: YTTrackResult) => {
    const type = track.content_type === "podcast" ? "podcast" : detectContentType(track.title)
    if (type === "unknown" || type === "official") return null
    
    const labels: Record<string, string> = {
      video: "Video",
      live: "Live",
      cover: "Cover",
      remix: "Remix",
      podcast: "Podcast",
    }
    
    return (
      <Badge variant="secondary" className="ml-2 text-xs">
        {labels[type]}
      </Badge>
    )
  }

  return (
    <div className="space-y-1">
      {filteredTracks.map((track, index) => {
        const isCurrentTrack = currentTrack?.videoId === track.videoId
        const isTrackPlaying = isCurrentTrack && isPlaying

        return (
          <div
            key={track.videoId}
            className={cn(
              "group flex items-center gap-3 rounded-md px-3 py-2 hover:bg-accent",
              isCurrentTrack && "bg-accent"
            )}
          >
            <div className="w-8 text-center text-sm text-muted-foreground">
              <span className="group-hover:hidden">
                {isTrackPlaying ? (
                  <span className="flex items-center justify-center">
                    <span className="flex gap-0.5">
                      <span className="h-3 w-0.5 animate-pulse bg-red-500" />
                      <span className="h-3 w-0.5 animate-pulse bg-red-500 [animation-delay:150ms]" />
                      <span className="h-3 w-0.5 animate-pulse bg-red-500 [animation-delay:300ms]" />
                    </span>
                  </span>
                ) : (
                  index + 1
                )}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="hidden h-8 w-8 group-hover:flex"
                onClick={() => handlePlay(track)}
              >
                {isTrackPlaying ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </Button>
            </div>

            <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-muted">
              {track.thumbnailUrl ? (
                <Image
                  src={track.thumbnailUrl}
                  alt={track.title}
                  fill
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Youtube className="h-4 w-4 text-red-500" />
                </div>
              )}
              {track.is_cached && (
                <div className="absolute bottom-0 right-0 rounded-tl bg-green-500 p-0.5">
                  <Download className="h-2 w-2 text-white" />
                </div>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-center">
                <p
                  className={cn(
                    "truncate text-sm font-medium",
                    isCurrentTrack && "text-red-500"
                  )}
                >
                  {track.title}
                </p>
                {getContentTypeBadge(track)}
              </div>
              <p className="truncate text-xs text-muted-foreground">
                {track.artist}
                {track.album && ` • ${track.album}`}
              </p>
            </div>

            <span className="hidden text-sm text-muted-foreground sm:block">
              {formatDuration(track.duration)}
            </span>

            {showActions && (
              <>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                  onClick={() => saveToLibrary(track)}
                  title="Save to library"
                >
                  <Plus className="h-4 w-4" />
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-8 w-8 opacity-100 sm:opacity-0 sm:group-hover:opacity-100",
                    track.is_favorite && "text-red-500 opacity-100"
                  )}
                  onClick={() => toggleFavorite(track.videoId)}
                >
                  <Heart className={cn("h-4 w-4", track.is_favorite && "fill-current")} />
                </Button>

                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "h-8 w-8",
                    track.is_cached ? "text-green-500 opacity-100" : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                  )}
                  onClick={() => downloadTrack(track)}
                  disabled={downloadingIds.has(track.videoId)}
                >
                  {downloadingIds.has(track.videoId) ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : track.is_cached ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                  >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handlePlay(track)}>
                      Play Now
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => addYTToQueue({
                      ...toPlayerTrack(track),
                      source: "youtube",
                    })}>
                      Add to Queue
                    </DropdownMenuItem>
                    <AddToPlaylistSubmenu track={toPlayerTrack(track)} />
                    <DropdownMenuItem onClick={() => saveToLibrary(track)}>
                      Save to Library
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => downloadTrack(track)}>
                      {track.is_cached ? (
                        <>
                          <Trash2 className="mr-2 h-4 w-4" />
                          Remove Download
                        </>
                      ) : (
                        <>
                          <Download className="mr-2 h-4 w-4" />
                          Download
                        </>
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => downloadTrack(track, "video")}>
                      <Video className="mr-2 h-4 w-4" />
                      Download MP4 Video
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

function toPlayerTrack(track: YTTrackResult): Track {
  return {
    id: track.videoId,
    source: "youtube",
    videoId: track.videoId,
    media_type: track.type,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    cover_art_path: track.thumbnailUrlHQ || track.thumbnailUrl,
    content_type: track.content_type || "music",
    podcast_title: track.podcast_title || null,
    podcast_author: track.podcast_author || null,
    ...(track.thumbnailUrl ? { thumbnailUrl: track.thumbnailUrl } : {}),
    ...(track.thumbnailUrlHQ ? { thumbnailUrlHQ: track.thumbnailUrlHQ } : {}),
    is_cached: track.is_cached,
    is_favorite: track.is_favorite,
  } as Track
}
