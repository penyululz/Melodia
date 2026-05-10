"use client"

import useSWR from "swr"
import Link from "next/link"
import { useAuthStore } from "@/stores/auth-store"
import { Button } from "@/components/ui/button"
import { AlbumCard } from "@/components/library/album-card"
import { MixRow } from "@/components/home/mix-row"
import { MixCardCarousel } from "@/components/home/mix-card-carousel"
import {
  Music,
  Upload,
  Disc3,
  Clock,
  Sparkles,
  Compass,
  Zap,
  Radio,
  TrendingUp,
} from "lucide-react"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 12) return "Good morning"
  if (h < 18) return "Good afternoon"
  return "Good evening"
}

export default function HomePage() {
  const { user } = useAuthStore()
  const { data: homeData } = useSWR("/api/home", fetcher)
  const { data: mixesData } = useSWR("/api/mixes", fetcher)

  const stats = homeData?.stats
  const recentTracks = homeData?.recentTracks || []
  const albums = homeData?.albums || []
  const mostPlayed = homeData?.mostPlayedTracks || []
  const mixes = mixesData?.mixes ?? {}

  const totalDurationHours = stats?.total_duration
    ? Math.floor(stats.total_duration / 3600)
    : 0

  const hasLocalMusic = (stats?.total_tracks ?? 0) > 0
  const topMixCards = [
    {
      key: "your-mix",
      title: "Your Mix",
      description: "Based on your listening history",
      tracks: mixes.yourMix ?? [],
      gradient: "bg-gradient-to-br from-emerald-900 to-emerald-700",
      icon: <Sparkles className="h-4 w-4" />,
    },
    {
      key: "discover-mix",
      title: "Discover Mix",
      description: "Fresh sounds beyond your usual taste",
      tracks: mixes.discoverMix ?? [],
      gradient: "bg-gradient-to-br from-blue-900 to-blue-700",
      icon: <Compass className="h-4 w-4" />,
    },
    {
      key: "supermix",
      title: "Supermix",
      description: "Your favorites blended together",
      tracks: mixes.supermix ?? [],
      gradient: "bg-gradient-to-br from-violet-900 to-violet-700",
      icon: <Zap className="h-4 w-4" />,
    },
    {
      key: "artist-radio",
      title: mixes.mixLabels?.artistRadioTitle ?? "Artist Radio",
      description: "A station around your strongest artist signal",
      tracks: mixes.artistRadio ?? [],
      gradient: "bg-gradient-to-br from-cyan-900 to-cyan-700",
      icon: <Radio className="h-4 w-4" />,
    },
    {
      key: "song-radio",
      title: mixes.mixLabels?.songRadioTitle ?? "Song Radio",
      description: "Similar tracks by sound, genre, and behavior",
      tracks: mixes.songRadio ?? [],
      gradient: "bg-gradient-to-br from-fuchsia-900 to-pink-700",
      icon: <Music className="h-4 w-4" />,
    },
    {
      key: "genre-mood-mix",
      title: mixes.mixLabels?.genreMoodTitle ?? "Mood Mix",
      description: "Grouped by genre, mood, tempo, and style",
      tracks: mixes.genreMoodMix ?? [],
      gradient: "bg-gradient-to-br from-amber-900 to-orange-700",
      icon: <Sparkles className="h-4 w-4" />,
    },
    {
      key: "saved-online-mix",
      title: "Saved Online Mix",
      description: "From songs you saved through search",
      tracks: mixes.ytMix ?? [],
      gradient: "bg-gradient-to-br from-rose-900 to-red-700",
      icon: <Radio className="h-4 w-4" />,
    },
  ].filter((mix) => mix.tracks.length > 0)

  return (
    <div className="space-y-8 px-4 py-4 md:px-6 md:py-6 lg:px-8 lg:py-8">
      {/* Greeting */}
      <div className="flex items-start justify-between gap-3 sm:items-end">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold leading-tight sm:text-3xl">
            {getGreeting()}{user?.name ? `, ${user.name.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
            {hasLocalMusic
              ? `${stats?.total_tracks ?? 0} tracks · ${stats?.total_artists ?? 0} artists · ${totalDurationHours}h of music`
              : "Upload music or use search to save songs"}
          </p>
        </div>
        {!hasLocalMusic && (
          <Button asChild size="sm">
            <Link href="/upload">
              <Upload className="mr-2 h-4 w-4" />
              Upload
            </Link>
          </Button>
        )}
      </div>

      <MixCardCarousel title="Your Mixes" items={topMixCards} />

      {/* New Release Mix row */}
      {mixes.newReleaseMix?.length > 0 && (
        <MixRow
          title="New Releases"
          subtitle="Recently added to your library"
          tracks={mixes.newReleaseMix}
          accentColor="text-amber-400"
          icon={<Radio className="h-4 w-4" />}
        />
      )}

      {/* Discover Mix row */}
      {mixes.discoverMix?.length > 0 && (
        <MixRow
          title="Discover Mix"
          subtitle="Artists and sounds outside your usual rotation"
          tracks={mixes.discoverMix}
          accentColor="text-blue-400"
          icon={<Compass className="h-4 w-4" />}
        />
      )}

      {/* Most Played row */}
      {mostPlayed.length > 0 && (
        <MixRow
          title="Most Played"
          subtitle="Your most listened-to tracks"
          tracks={mostPlayed}
          accentColor="text-primary"
          icon={<TrendingUp className="h-4 w-4" />}
        />
      )}

      {/* Recent Albums */}
      {albums.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <Disc3 className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-lg font-semibold">Albums</h2>
            </div>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/albums">View All</Link>
            </Button>
          </div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
            {albums.map((album: { album: string; artist: string; year: number | null; cover_art_path: string | null; track_count: number }) => (
              <AlbumCard key={`${album.album}-${album.artist}`} album={album} />
            ))}
          </div>
        </section>
      )}

      {/* Recently Added row */}
      {recentTracks.length > 0 && (
        <MixRow
          title="Recently Added"
          subtitle="Your latest additions"
          tracks={recentTracks}
          accentColor="text-muted-foreground"
          icon={<Clock className="h-4 w-4" />}
        />
      )}

      {/* Your Mix full row */}
      {mixes.yourMix?.length > 0 && (
        <MixRow
          title="Your Mix"
          subtitle="Personalized based on what you play most"
          tracks={mixes.yourMix}
          accentColor="text-primary"
          icon={<Sparkles className="h-4 w-4" />}
        />
      )}

      {/* Saved online mix row */}
      {mixes.ytMix?.length > 0 && (
        <MixRow
          title="Saved Online Mix"
          subtitle="From songs you saved through search"
          tracks={mixes.ytMix}
          accentColor="text-red-500"
          icon={<Radio className="h-4 w-4" />}
        />
      )}

      {/* Empty state */}
      {!hasLocalMusic && (mixes.yourMix?.length ?? 0) === 0 && (
        <section className="flex flex-col items-center justify-center rounded-xl border bg-card py-20 text-center">
          <div className="mb-4 rounded-full bg-primary/10 p-6">
            <Music className="h-12 w-12 text-primary" />
          </div>
          <h2 className="mb-2 text-2xl font-bold">Welcome to Melodia</h2>
          <p className="mb-6 max-w-sm text-muted-foreground leading-relaxed">
            Upload your music collection or use the top search to start building
            your personalized mixes.
          </p>
          <div className="flex gap-3">
            <Button asChild>
              <Link href="/upload">
                <Upload className="mr-2 h-4 w-4" />
                Upload Music
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link href="/library">
                <Radio className="mr-2 h-4 w-4" />
                Open Library
              </Link>
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}
