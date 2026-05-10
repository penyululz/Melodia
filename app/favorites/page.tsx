"use client"

import useSWR from "swr"
import { TrackList } from "@/components/library/track-list"
import { Button } from "@/components/ui/button"
import { usePlayerStore } from "@/stores/player-store"
import { Play, Shuffle, Heart } from "lucide-react"
import type { Track } from "@/stores/player-store"

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export default function FavoritesPage() {
  const { data, isLoading } = useSWR("/api/tracks?favorites=true", fetcher)
  const { data: ytData, isLoading: ytLoading } = useSWR("/api/youtube/tracks?filter=favorites", fetcher)
  const { playTrack } = usePlayerStore()

  const localTracks = (data?.tracks || []) as Track[]
  const promotedVideoIds = new Set(localTracks.map(getPromotedYouTubeVideoId).filter(Boolean))
  const tracks = [
    ...localTracks,
    ...((ytData?.tracks || [])
      .filter((track: any) => !promotedVideoIds.has(track.video_id))
      .map(toNativeOnlineTrack)),
  ] as Track[]

  const playAll = () => {
    if (tracks.length > 0) {
      playTrack(tracks[0], tracks)
    }
  }

  const shufflePlay = () => {
    if (tracks.length > 0) {
      const shuffled = [...tracks].sort(() => Math.random() - 0.5)
      playTrack(shuffled[0], shuffled)
    }
  }

  return (
    <div className="p-6">
      <div className="mb-8">
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-full bg-primary/10 p-3">
            <Heart className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Favorites</h1>
            <p className="text-muted-foreground">{tracks.length} liked songs</p>
          </div>
        </div>
        {tracks.length > 0 && (
          <div className="flex gap-3">
            <Button onClick={playAll} size="lg">
              <Play className="mr-2 h-5 w-5" />
              Play
            </Button>
            <Button onClick={shufflePlay} variant="secondary" size="lg">
              <Shuffle className="mr-2 h-5 w-5" />
              Shuffle
            </Button>
          </div>
        )}
      </div>

      {isLoading || ytLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : tracks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border bg-card py-16 text-center">
          <Heart className="mb-4 h-16 w-16 text-muted-foreground" />
          <h3 className="text-lg font-medium">No favorites yet</h3>
          <p className="text-sm text-muted-foreground">
            Like songs to add them to your favorites
          </p>
        </div>
      ) : (
        <div className="rounded-lg border bg-card">
          <TrackList tracks={tracks} />
        </div>
      )}
    </div>
  )
}

function toNativeOnlineTrack(track: any): Track {
  return {
    id: track.video_id,
    source: "youtube",
    videoId: track.video_id,
    title: track.title,
    artist: track.artist || "Unknown Artist",
    album: track.album || null,
    duration: track.duration ?? null,
    cover_art_path: track.thumbnail_url || null,
    file_path: track.cached_file_path ? `/api/youtube/stream/${track.video_id}` : undefined,
    file_format: track.cached_file_path?.toLowerCase?.().endsWith(".mp4") ? "MP4" : null,
    is_cached: track.is_cached === 1 || track.is_cached === true,
    is_favorite: true,
  } as Track
}

function getPromotedYouTubeVideoId(track: Track): string | null {
  const filePath = track.file_path || ""
  const match = filePath.match(/^\/api\/youtube\/stream\/([^/?#]+)/)
  return match?.[1] || null
}
