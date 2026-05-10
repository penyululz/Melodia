"use client"

import useSWR from "swr"
import { AlbumCard } from "@/components/library/album-card"
import { Disc3 } from "lucide-react"

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export default function AlbumsPage() {
  const { data, isLoading } = useSWR("/api/albums", fetcher)
  const albums = data?.albums || []

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Albums</h1>
        <p className="text-muted-foreground">
          {albums.length} albums in your library
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : albums.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Disc3 className="mb-4 h-16 w-16 text-muted-foreground" />
          <h3 className="text-lg font-medium">No albums yet</h3>
          <p className="text-sm text-muted-foreground">
            Upload music with album tags to see them here
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {albums.map((album: { album: string; artist: string; year: number | null; cover_art_path: string | null; track_count: number }) => (
            <AlbumCard key={`${album.album}-${album.artist}`} album={album} />
          ))}
        </div>
      )}
    </div>
  )
}
