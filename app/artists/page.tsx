"use client"

import useSWR from "swr"
import { ArtistCard } from "@/components/library/artist-card"
import { Users } from "lucide-react"

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export default function ArtistsPage() {
  const { data, isLoading } = useSWR("/api/artists", fetcher)
  const artists = data?.artists || []

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Artists</h1>
        <p className="text-muted-foreground">
          {artists.length} artists in your library
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : artists.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Users className="mb-4 h-16 w-16 text-muted-foreground" />
          <h3 className="text-lg font-medium">No artists yet</h3>
          <p className="text-sm text-muted-foreground">
            Upload music with artist tags to see them here
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {artists.map((artist: { artist: string; track_count: number; album_count: number; image_path?: string | null }) => (
            <ArtistCard key={artist.artist} artist={artist} />
          ))}
        </div>
      )}
    </div>
  )
}
