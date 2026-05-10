"use client"

import { usePlayerStore } from "@/stores/player-store"
import { Button } from "@/components/ui/button"
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
} from "lucide-react"
import { cn } from "@/lib/utils"

interface PlayerControlsProps {
  // compact: show only prev/play/next, hide shuffle & repeat
  compact?: boolean
}

export function PlayerControls({ compact = false }: PlayerControlsProps) {
  const {
    isPlaying,
    shuffle,
    repeat,
    togglePlay,
    playPrevious,
    playNext,
    toggleShuffle,
    cycleRepeat,
  } = usePlayerStore()

  return (
    <div className="flex items-center gap-1">
      {!compact && (
        <Button
          variant="ghost"
          size="icon"
          onClick={toggleShuffle}
          className={cn(
            "h-9 w-9 text-muted-foreground hover:text-foreground",
            shuffle && "text-primary"
          )}
        >
          <Shuffle className="h-4 w-4" />
        </Button>
      )}

      <Button
        variant="ghost"
        size="icon"
        onClick={playPrevious}
        className={cn("h-9 w-9", compact && "h-8 w-8")}
      >
        <SkipBack className={cn("h-5 w-5", compact && "h-4 w-4")} />
      </Button>

      <Button
        variant="default"
        size="icon"
        onClick={togglePlay}
        className={cn("rounded-full", compact ? "h-8 w-8" : "h-10 w-10")}
      >
        {isPlaying ? (
          <Pause className={cn("h-5 w-5", compact && "h-4 w-4")} />
        ) : (
          <Play className={cn("h-5 w-5 ml-0.5", compact && "h-4 w-4")} />
        )}
      </Button>

      <Button
        variant="ghost"
        size="icon"
        onClick={playNext}
        className={cn("h-9 w-9", compact && "h-8 w-8")}
      >
        <SkipForward className={cn("h-5 w-5", compact && "h-4 w-4")} />
      </Button>

      {!compact && (
        <Button
          variant="ghost"
          size="icon"
          onClick={cycleRepeat}
          className={cn(
            "h-9 w-9 text-muted-foreground hover:text-foreground",
            repeat !== "off" && "text-primary"
          )}
        >
          {repeat === "one" ? (
            <Repeat1 className="h-4 w-4" />
          ) : (
            <Repeat className="h-4 w-4" />
          )}
        </Button>
      )}
    </div>
  )
}
