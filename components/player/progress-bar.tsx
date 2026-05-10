"use client"

import { usePlayerStore } from "@/stores/player-store"
import { Slider } from "@/components/ui/slider"
import { formatDuration } from "@/lib/format"

interface ProgressBarProps {
  onSeek: (time: number) => void
}

export function ProgressBar({ onSeek }: ProgressBarProps) {
  const { currentTrack, currentTime, duration: playerDuration } = usePlayerStore()

  const trackDuration = Number(currentTrack?.duration)
  const duration =
    Number.isFinite(playerDuration) && playerDuration > 0
      ? playerDuration
      : Number.isFinite(trackDuration) && trackDuration > 0
        ? trackDuration
        : 0
  const safeCurrentTime = duration > 0
    ? Math.min(Math.max(currentTime, 0), duration)
    : Math.max(currentTime, 0)
  const progress = duration > 0
    ? Math.min(100, Math.max(0, (safeCurrentTime / duration) * 100))
    : 0

  const handleSeek = (value: number[]) => {
    if (duration <= 0) return
    const percent = Math.min(100, Math.max(0, value[0]))
    const time = (percent / 100) * duration
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
        <span>{formatDuration(safeCurrentTime)}</span>
        <span>{formatDuration(duration)}</span>
      </div>
    </div>
  )
}
