"use client"

import Image from "next/image"
import Link from "next/link"
import { Disc3 } from "lucide-react"

interface Album {
  album: string
  artist: string
  year: number | null
  cover_art_path: string | null
  track_count: number
}

interface AlbumCardProps {
  album: Album
}

export function AlbumCard({ album }: AlbumCardProps) {
  return (
    <Link
      href={`/albums/${encodeURIComponent(album.album)}`}
      className="group block space-y-3"
    >
      <div className="relative aspect-square overflow-hidden rounded-lg bg-muted transition-all group-hover:shadow-lg">
        {album.cover_art_path ? (
          <Image
            src={album.cover_art_path}
            alt={album.album}
            fill
            className="object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Disc3 className="h-16 w-16 text-muted-foreground" />
          </div>
        )}
        <div className="absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10" />
      </div>
      <div className="space-y-1">
        <p className="truncate font-medium">{album.album}</p>
        <p className="truncate text-sm text-muted-foreground">
          {album.artist}
          {album.year && ` • ${album.year}`}
        </p>
      </div>
    </Link>
  )
}
