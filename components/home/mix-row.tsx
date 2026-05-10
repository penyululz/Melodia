"use client"

import Image from "next/image"
import { useRef } from "react"
import { usePlayerStore, type Track } from "@/stores/player-store"
import { Button } from "@/components/ui/button"
import { AddToPlaylistSubmenu } from "@/components/playlists/add-to-playlist-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ChevronLeft, ChevronRight, MoreHorizontal, Play, Music, Youtube } from "lucide-react"
import { cn } from "@/lib/utils"

interface MixRowProps {
  title: string
  subtitle?: string
  tracks: Track[]
  accentColor?: string
  icon?: React.ReactNode
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return ""
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

export function MixRow({ title, subtitle, tracks, accentColor = "text-primary", icon }: MixRowProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { playTrack } = usePlayerStore()

  const scroll = (dir: "left" | "right") => {
    if (!scrollRef.current) return
    scrollRef.current.scrollBy({ left: dir === "right" ? 320 : -320, behavior: "smooth" })
  }

  if (tracks.length === 0) return null

  const playFromTrack = (track: Track) => {
    playTrack(track, tracks)
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          {icon && <span className={cn("flex-shrink-0", accentColor)}>{icon}</span>}
          <div>
            <h2 className="text-lg font-semibold leading-tight">{title}</h2>
            {subtitle && <p className="text-xs text-muted-foreground leading-relaxed">{subtitle}</p>}
          </div>
        </div>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => scroll("left")}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => scroll("right")}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 scrollbar-hide md:-mx-6 md:px-6 lg:mx-0 lg:px-0"
        style={{ scrollSnapType: "x mandatory" }}
      >
        {tracks.map((track, i) => (
          <div
            key={`${track.id}-${i}`}
            role="button"
            tabIndex={0}
            onClick={() => playFromTrack(track)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                playFromTrack(track)
              }
            }}
            className="group w-32 flex-shrink-0 cursor-pointer text-left focus:outline-none sm:w-36"
            style={{ scrollSnapAlign: "start" }}
          >
            <div className="relative mb-2 aspect-square w-full overflow-hidden rounded-md bg-muted">
              {track.cover_art_path ? (
                <Image
                  src={track.cover_art_path}
                  alt={track.album || track.title}
                  fill
                  className="object-cover transition-transform duration-200 group-hover:scale-105"
                  unoptimized={track.source === "youtube"}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  {track.source === "youtube" ? (
                    <Youtube className="h-8 w-8 text-red-500/60" />
                  ) : (
                    <Music className="h-8 w-8 text-muted-foreground/40" />
                  )}
                </div>
              )}
              <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary shadow-lg">
                  <Play className="h-4 w-4 fill-primary-foreground text-primary-foreground" />
                </div>
              </div>
              <div className="absolute right-1.5 top-1.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="secondary"
                      size="icon"
                      className="h-7 w-7 bg-black/55 text-white hover:bg-black/70 hover:text-white"
                      title="Track actions"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onClick={() => playFromTrack(track)}>
                      <Play className="h-4 w-4" />
                      Play Now
                    </DropdownMenuItem>
                    <AddToPlaylistSubmenu track={track} />
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
            <p className="truncate text-sm font-medium leading-tight">{track.title}</p>
            <p className="truncate text-xs leading-relaxed text-muted-foreground">
              {track.artist || "Unknown"}
              {track.duration ? ` - ${formatDuration(track.duration)}` : ""}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
