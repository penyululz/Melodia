"use client"

import Image from "next/image"
import Link from "next/link"
import { User } from "lucide-react"

interface Artist {
  artist: string
  track_count: number
  album_count: number
  image_path?: string | null
}

interface ArtistCardProps {
  artist: Artist
}

export function ArtistCard({ artist }: ArtistCardProps) {
  return (
    <Link
      href={`/artists/${encodeURIComponent(artist.artist)}`}
      className="group flex flex-col items-center space-y-3 p-4 rounded-lg hover:bg-accent transition-colors"
    >
      <div className="relative h-32 w-32 overflow-hidden rounded-full bg-muted transition-all group-hover:shadow-lg">
        {artist.image_path ? (
          <Image
            src={artist.image_path}
            alt={artist.artist}
            fill
            className="object-cover transition-transform group-hover:scale-105"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <User className="h-16 w-16 text-muted-foreground" />
          </div>
        )}
      </div>
      <div className="text-center space-y-1">
        <p className="font-medium">{artist.artist}</p>
        <p className="text-sm text-muted-foreground">
          {artist.album_count} albums • {artist.track_count} songs
        </p>
      </div>
    </Link>
  )
}
