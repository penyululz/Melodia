"use client"

import { usePlayerStore } from "@/stores/player-store"
import { Slider } from "@/components/ui/slider"
import { formatDuration } from "@/lib/format"

interface ProgressBarProps {
  onSeek: (time: number) => void
}

export function ProgressBar({ onSeek }: ProgressBarProps) {
  const { currentTime, duration } = usePlayerStore()

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0

  const handleSeek = (value: number[]) => {
    const time = (value[0] / 100) * duration
    onSeek(time)
  }

  return (
    <div className="group relative">
      <Slider
        value={[progress]}
        max={100}
        step={0.1}
        onValueChange={handleSeek}
        className="absolute -top-1.5 left-0 right-0 h-1 cursor-pointer rounded-none [&>span:first-child]:h-1 [&>span:first-child]:rounded-none [&_[role=slider]]:h-3 [&_[role=slider]]:w-3 [&_[role=slider]]:opacity-0 [&_[role=slider]]:transition-opacity group-hover:[&_[role=slider]]:opacity-100"
      />
      <div className="absolute -top-6 left-4 right-4 flex justify-between text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
        <span>{formatDuration(currentTime)}</span>
        <span>{formatDuration(duration)}</span>
      </div>
    </div>
  )
}
