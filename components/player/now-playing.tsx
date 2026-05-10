"use client"

import Image from "next/image"
import { usePlayerStore } from "@/stores/player-store"
import { useSettingsStore, QUALITY_LABELS } from "@/stores/settings-store"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { MarqueeText } from "@/components/ui/marquee-text"
import { Heart, Music, Youtube } from "lucide-react"
import useSWR, { mutate } from "swr"
import { toast } from "sonner"
import { getYouTubeVideoIdFromTrack } from "@/lib/offline-media"

const fetcher = (url: string) => fetch(url).then((res) => res.json())

interface NowPlayingProps {
  onExpand?: () => void
}

export function NowPlaying({ onExpand }: NowPlayingProps) {
  const { currentTrack } = usePlayerStore()
  const { autoDownloadLibraryActions, downloadQuality, streamingQuality } = useSettingsStore()
  const youtubeVideoId = getYouTubeVideoIdFromTrack(currentTrack || null)
  const isYouTube = Boolean(youtubeVideoId)

  // Fetch the full track data to get favorite status
  const { data } = useSWR(
    currentTrack 
      ? isYouTube 
        ? `/api/youtube/tracks/${youtubeVideoId}` 
        : `/api/tracks/${currentTrack.id}` 
      : null,
    fetcher
  )

  const isFavorite = data?.track?.is_favorite === 1 || data?.track?.is_favorite === true

  const toggleFavorite = async () => {
    if (!currentTrack) return

    try {
      if (isYouTube && youtubeVideoId) {
        let response = await fetch(`/api/youtube/tracks/${youtubeVideoId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "toggleFavorite" }),
        })

        if (response.status === 404) {
          const saveResponse = await fetch("/api/youtube/tracks", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              videoId: youtubeVideoId,
              title: currentTrack.title,
              artist: currentTrack.artist,
              album: currentTrack.album,
              duration: currentTrack.duration,
              thumbnailUrl: currentTrack.cover_art_path,
              contentType: currentTrack.content_type || "music",
              podcastTitle: currentTrack.podcast_title,
              podcastAuthor: currentTrack.podcast_author,
            }),
          })
          const saveData = await saveResponse.json().catch(() => null)
          if (!saveResponse.ok) {
            throw new Error(saveData?.error || "Failed to save song before favoriting")
          }

          response = await fetch(`/api/youtube/tracks/${youtubeVideoId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "toggleFavorite" }),
          })
        }

        const data = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(data?.error || "Failed to update favorite")
        }

        mutate(`/api/youtube/tracks/${youtubeVideoId}`)
        mutate("/api/youtube/tracks")
        mutate("/api/youtube/tracks?filter=favorites")
        mutate("/api/tracks")
        mutate("/api/tracks?favorites=true")

        const isNowFavorite = data?.track?.is_favorite === 1 || data?.track?.is_favorite === true
        if (isNowFavorite && autoDownloadLibraryActions) {
          fetch(`/api/youtube/download/${youtubeVideoId}?quality=${downloadQuality}&media=audio`, {
            method: "POST",
          }).catch(() => {})
        }
      } else {
        const response = await fetch(`/api/tracks/${currentTrack.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ favorite: true }),
        })
        const data = await response.json().catch(() => null)
        if (!response.ok) {
          throw new Error(data?.error || "Failed to update favorite")
        }

        mutate(`/api/tracks/${currentTrack.id}`)
        mutate("/api/tracks")
        mutate("/api/tracks?favorites=true")
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update favorite")
    }
  }

  if (!currentTrack) return null

  return (
    <div
      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 lg:gap-3"
      onClick={onExpand}
      role={onExpand ? "button" : undefined}
      tabIndex={onExpand ? 0 : undefined}
    >
      <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-md bg-muted lg:h-14 lg:w-14">
        {currentTrack.cover_art_path ? (
          <Image
            src={currentTrack.cover_art_path}
            alt={currentTrack.album || "Album cover"}
            fill
            className="object-cover"
            unoptimized={isYouTube}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            {isYouTube ? (
              <Youtube className="h-6 w-6 text-red-500" />
            ) : (
              <Music className="h-6 w-6 text-muted-foreground" />
            )}
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <MarqueeText text={currentTrack.title} className="text-sm font-medium" />
        <div className="flex items-center gap-1.5">
          <MarqueeText
            text={currentTrack.artist || "Unknown Artist"}
            className="text-xs text-muted-foreground"
          />
          {isYouTube && (
            <Badge variant="secondary" className="h-4 px-1 text-[10px]">
              {QUALITY_LABELS[streamingQuality].bitrate}
            </Badge>
          )}
        </div>
      </div>

      <Button
        variant="ghost"
        size="icon"
        onClick={(e) => {
          e.stopPropagation()
          toggleFavorite()
        }}
        className="h-8 w-8 flex-shrink-0"
        title={isFavorite ? "Remove favorite" : "Favorite"}
      >
        <Heart
          className={`h-4 w-4 ${isFavorite ? "fill-primary text-primary" : ""}`}
        />
      </Button>
    </div>
  )
}
