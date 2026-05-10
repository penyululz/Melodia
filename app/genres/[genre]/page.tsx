"use client"

import { use } from "react"
import useSWR from "swr"
import { TrackList } from "@/components/library/track-list"
import { Button } from "@/components/ui/button"
import { usePlayerStore } from "@/stores/player-store"
import { Play, Shuffle } from "lucide-react"

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export default function GenrePage({
  params,
}: {
  params: Promise<{ genre: string }>
}) {
  const { genre } = use(params)
  const decodedGenre = decodeURIComponent(genre)
  const { data, isLoading } = useSWR(
    `/api/tracks?genre=${encodeURIComponent(decodedGenre)}`,
    fetcher
  )
  const { playTrack } = usePlayerStore()

  const tracks = data?.tracks || []

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  return (
    <div className="p-6">
      {/* Genre Header */}
      <div className="mb-8">
        <p className="text-sm font-medium text-muted-foreground">Genre</p>
        <h1 className="mb-2 text-4xl font-bold">{decodedGenre}</h1>
        <p className="mb-6 text-muted-foreground">{tracks.length} songs</p>
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
      </div>

      {/* Track List */}
      <div className="rounded-lg border bg-card">
        <TrackList tracks={tracks} />
      </div>
    </div>
  )
}
