"use client"

import { usePlayerStore, type Track } from "@/stores/player-store"
import { Button } from "@/components/ui/button"
import { Play, Shuffle } from "lucide-react"
import Image from "next/image"
import { cn } from "@/lib/utils"

interface MixCardProps {
  title: string
  description: string
  tracks: Track[]
  gradient: string
  icon: React.ReactNode
}

export function MixCard({ title, description, tracks, gradient, icon }: MixCardProps) {
  const { playTrack, toggleShuffle, shuffle } = usePlayerStore()

  const handlePlay = () => {
    if (tracks.length === 0) return
    playTrack(tracks[0], tracks)
  }

  const handleShuffle = () => {
    if (tracks.length === 0) return
    const idx = Math.floor(Math.random() * tracks.length)
    playTrack(tracks[idx], tracks)
    if (!shuffle) toggleShuffle()
  }

  // Pick up to 4 art covers for the collage
  const arts = tracks
    .filter((t) => t.cover_art_path)
    .slice(0, 4)
    .map((t) => t.cover_art_path!)

  return (
    <div className={cn("relative flex aspect-square flex-col justify-between overflow-hidden rounded-lg p-4", gradient)}>
      {/* Art collage in top-right */}
      {arts.length > 0 && (
        <div className="absolute right-3 top-3 grid h-14 w-14 grid-cols-2 gap-0.5 overflow-hidden rounded-md opacity-40">
          {arts.map((src, i) => (
            <div key={i} className="relative w-full h-full bg-black/30">
              <Image src={src} alt="" fill className="object-cover" unoptimized />
            </div>
          ))}
          {arts.length < 4 && Array.from({ length: 4 - arts.length }).map((_, i) => (
            <div key={`empty-${i}`} className="bg-black/20" />
          ))}
        </div>
      )}

      <div className="relative z-10 space-y-1 pr-12">
        <div className="mb-1 flex items-center gap-2 text-white/80">
          {icon}
        </div>
        <h3 className="text-lg font-bold text-white leading-tight">{title}</h3>
        <p className="line-clamp-2 text-xs leading-relaxed text-white/70">{description}</p>
        <p className="text-xs text-white/50">{tracks.length} tracks</p>
      </div>

      <div className="relative z-10 mt-3 flex gap-1.5">
        <Button
          size="sm"
          onClick={handlePlay}
          disabled={tracks.length === 0}
          className="bg-white/20 hover:bg-white/30 text-white border-0 backdrop-blur-sm"
        >
          <Play className="mr-1.5 h-3.5 w-3.5 fill-white" />
          Play
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={handleShuffle}
          disabled={tracks.length === 0}
          className="text-white/80 hover:bg-white/10 hover:text-white"
        >
          <Shuffle className="mr-1.5 h-3.5 w-3.5" />
          Shuffle
        </Button>
      </div>
    </div>
  )
}
