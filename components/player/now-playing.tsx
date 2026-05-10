"use client"

import Image from "next/image"
import { usePlayerStore } from "@/stores/player-store"
import { useSettingsStore, QUALITY_LABELS } from "@/stores/settings-store"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { MarqueeText } from "@/components/ui/marquee-text"
import { Heart, Music, Youtube } from "lucide-react"
import useSWR, { mutate } from "swr"

const fetcher = (url: string) => fetch(url).then((res) => res.json())

interface NowPlayingProps {
  onExpand?: () => void
}

export function NowPlaying({ onExpand }: NowPlayingProps) {
  const { currentTrack } = usePlayerStore()
  const { streamingQuality, playbackMode } = useSettingsStore()
  const isYouTube = currentTrack?.source === "youtube"

  // Fetch the full track data to get favorite status
  const { data } = useSWR(
    currentTrack 
      ? isYouTube 
        ? `/api/youtube/tracks/${currentTrack.videoId}` 
        : `/api/tracks/${currentTrack.id}` 
      : null,
    fetcher
  )

  const isFavorite = data?.track?.is_favorite === 1

  const toggleFavorite = async () => {
    if (!currentTrack) return

    if (isYouTube) {
      await fetch(`/api/youtube/tracks/${currentTrack.videoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "toggleFavorite" }),
      })
      mutate(`/api/youtube/tracks/${currentTrack.videoId}`)
      mutate("/api/youtube/tracks?filter=favorites")
    } else {
      await fetch(`/api/tracks/${currentTrack.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ favorite: true }),
      })
      mutate(`/api/tracks/${currentTrack.id}`)
      mutate("/api/tracks?favorites=true")
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
        className="hidden h-8 w-8 flex-shrink-0 sm:flex"
      >
        <Heart
          className={`h-4 w-4 ${isFavorite ? "fill-primary text-primary" : ""}`}
        />
      </Button>
    </div>
  )
}
