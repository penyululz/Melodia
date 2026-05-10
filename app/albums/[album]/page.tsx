"use client"

import { use } from "react"
import useSWR from "swr"
import Image from "next/image"
import { TrackList } from "@/components/library/track-list"
import { Button } from "@/components/ui/button"
import { usePlayerStore } from "@/stores/player-store"
import { Play, Shuffle, Disc3 } from "lucide-react"
import { formatDuration } from "@/lib/format"

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export default function AlbumPage({
  params,
}: {
  params: Promise<{ album: string }>
}) {
  const { album } = use(params)
  const decodedAlbum = decodeURIComponent(album)
  const { data, isLoading } = useSWR(
    `/api/tracks?album=${encodeURIComponent(decodedAlbum)}`,
    fetcher
  )
  const { playTrack, setQueue } = usePlayerStore()

  const tracks = data?.tracks || []
  const firstTrack = tracks[0]
  const totalDuration = tracks.reduce(
    (acc: number, t: { duration: number | null }) => acc + (t.duration || 0),
    0
  )

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
      {/* Album Header */}
      <div className="mb-8 flex flex-col gap-6 sm:flex-row">
        <div className="relative aspect-square w-full max-w-[240px] flex-shrink-0 overflow-hidden rounded-lg bg-muted shadow-lg">
          {firstTrack?.cover_art_path ? (
            <Image
              src={firstTrack.cover_art_path}
              alt={decodedAlbum}
              fill
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Disc3 className="h-24 w-24 text-muted-foreground" />
            </div>
          )}
        </div>

        <div className="flex flex-col justify-end">
          <p className="text-sm font-medium text-muted-foreground">Album</p>
          <h1 className="mb-2 text-4xl font-bold">{decodedAlbum}</h1>
          <p className="mb-4 text-lg text-muted-foreground">
            {firstTrack?.artist || "Unknown Artist"}
          </p>
          <p className="mb-6 text-sm text-muted-foreground">
            {tracks.length} songs • {formatDuration(totalDuration)}
            {firstTrack?.year && ` • ${firstTrack.year}`}
          </p>
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
      </div>

      {/* Track List */}
      <div className="rounded-lg border bg-card">
        <TrackList tracks={tracks} showAlbum={false} />
      </div>
    </div>
  )
}
