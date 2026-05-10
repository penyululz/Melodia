"use client"

import { use } from "react"
import useSWR from "swr"
import Image from "next/image"
import { TrackList } from "@/components/library/track-list"
import { Button } from "@/components/ui/button"
import { usePlayerStore } from "@/stores/player-store"
import { Play, Shuffle, User } from "lucide-react"

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export default function ArtistPage({
  params,
}: {
  params: Promise<{ artist: string }>
}) {
  const { artist } = use(params)
  const decodedArtist = decodeURIComponent(artist)
  const { data, isLoading } = useSWR(
    `/api/tracks?artist=${encodeURIComponent(decodedArtist)}`,
    fetcher
  )
  const { data: profileData } = useSWR(
    `/api/artists/profile?artist=${encodeURIComponent(decodedArtist)}`,
    fetcher,
    { revalidateOnFocus: false }
  )
  const { playTrack } = usePlayerStore()

  const tracks = data?.tracks || []
  const fallbackArtistImage = tracks.find((track: { cover_art_path?: string | null }) => track.cover_art_path)?.cover_art_path
  const artistImage = profileData?.image_path || fallbackArtistImage

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
      {/* Artist Header */}
      <div className="mb-8 flex flex-col items-center gap-6 text-center sm:flex-row sm:text-left">
        <div className="relative flex h-40 w-40 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted shadow-lg">
          {artistImage ? (
            <Image
              src={artistImage}
              alt={decodedArtist}
              fill
              className="object-cover"
              priority
            />
          ) : (
            <User className="h-20 w-20 text-muted-foreground" />
          )}
        </div>

        <div>
          <p className="text-sm font-medium text-muted-foreground">Artist</p>
          <h1 className="mb-2 text-4xl font-bold">{decodedArtist}</h1>
          <p className="mb-6 text-muted-foreground">{tracks.length} songs</p>
          <div className="flex justify-center gap-3 sm:justify-start">
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
        <TrackList tracks={tracks} />
      </div>
    </div>
  )
}
