"use client"

import useSWR from "swr"
import Link from "next/link"
import { Mic2 } from "lucide-react"

const fetcher = (url: string) => fetch(url).then((res) => res.json())

const genreColors = [
  "from-rose-500 to-pink-500",
  "from-amber-500 to-orange-500",
  "from-emerald-500 to-teal-500",
  "from-cyan-500 to-blue-500",
  "from-violet-500 to-purple-500",
  "from-fuchsia-500 to-pink-500",
  "from-lime-500 to-green-500",
  "from-sky-500 to-indigo-500",
]

export default function GenresPage() {
  const { data, isLoading } = useSWR("/api/genres", fetcher)
  const genres = data?.genres || []

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-3xl font-bold">Genres</h1>
        <p className="text-muted-foreground">
          Browse your music by genre
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : genres.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Mic2 className="mb-4 h-16 w-16 text-muted-foreground" />
          <h3 className="text-lg font-medium">No genres yet</h3>
          <p className="text-sm text-muted-foreground">
            Upload music with genre tags to see them here
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {genres.map((genre: { genre: string; track_count: number }, index: number) => (
            <Link
              key={genre.genre}
              href={`/genres/${encodeURIComponent(genre.genre)}`}
              className={`group relative overflow-hidden rounded-lg bg-gradient-to-br ${genreColors[index % genreColors.length]} p-6 transition-transform hover:scale-105`}
            >
              <h3 className="text-xl font-bold text-white">{genre.genre}</h3>
              <p className="text-sm text-white/80">{genre.track_count} songs</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
