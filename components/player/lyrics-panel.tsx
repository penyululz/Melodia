"use client"

import { useEffect, useRef, useState } from "react"
import useSWR from "swr"
import { usePlayerStore } from "@/stores/player-store"
import { Button } from "@/components/ui/button"
import { X, Loader2, MicVocal } from "lucide-react"
import { cn } from "@/lib/utils"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

interface LyricLine {
  time: number // seconds
  text: string
}

function parseLRC(lrc: string): LyricLine[] {
  const lines: LyricLine[] = []
  for (const line of lrc.split("\n")) {
    const match = line.match(/\[(\d+):(\d+\.\d+)\](.*)/)
    if (match) {
      const time = parseInt(match[1]) * 60 + parseFloat(match[2])
      lines.push({ time, text: match[3].trim() })
    }
  }
  return lines.filter((l) => l.text)
}

interface LyricsPanelProps {
  onClose: () => void
}

export function LyricsPanel({ onClose }: LyricsPanelProps) {
  const { currentTrack, currentTime } = usePlayerStore()
  const [activeIndex, setActiveIndex] = useState(0)
  const activeRef = useRef<HTMLParagraphElement>(null)

  const params = currentTrack
    ? `?title=${encodeURIComponent(currentTrack.title)}&artist=${encodeURIComponent(currentTrack.artist ?? "")}&duration=${Math.round(currentTrack.duration ?? 0)}&trackId=${encodeURIComponent(String(currentTrack.id))}&videoId=${encodeURIComponent(currentTrack.videoId ?? "")}`
    : null

  const { data, isLoading } = useSWR(
    currentTrack ? `/api/lyrics${params}` : null,
    fetcher
  )

  const syncedLines: LyricLine[] = data?.syncedLyrics ? parseLRC(data.syncedLyrics) : []
  const hasSync = syncedLines.length > 0

  // Track active line
  useEffect(() => {
    if (!hasSync) return
    let idx = 0
    for (let i = 0; i < syncedLines.length; i++) {
      if (syncedLines[i].time <= currentTime) idx = i
    }
    setActiveIndex(idx)
  }, [currentTime, hasSync, syncedLines])

  // Auto-scroll active line into view
  useEffect(() => {
    activeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [activeIndex])

  if (!currentTrack) return null

  return (
    <div className="fixed inset-x-0 bottom-[88px] z-40 mx-auto max-w-lg rounded-t-2xl border border-border bg-card/95 shadow-2xl backdrop-blur-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-2">
          <MicVocal className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold">Lyrics</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Track info */}
      <div className="px-5 pt-3 pb-1">
        <p className="text-sm font-medium truncate">{currentTrack.title}</p>
        <p className="text-xs text-muted-foreground truncate">{currentTrack.artist ?? "Unknown Artist"}</p>
      </div>

      {/* Lyrics content */}
      <div className="h-64 overflow-y-auto px-5 py-3 scrollbar-hide">
        {isLoading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : hasSync ? (
          <div className="space-y-3 py-8 text-center">
            {syncedLines.map((line, i) => (
              <p
                key={i}
                ref={i === activeIndex ? activeRef : undefined}
                className={cn(
                  "text-sm leading-relaxed transition-all duration-300",
                  i === activeIndex
                    ? "text-foreground text-base font-semibold scale-105"
                    : i < activeIndex
                    ? "text-muted-foreground/50"
                    : "text-muted-foreground/70"
                )}
              >
                {line.text}
              </p>
            ))}
          </div>
        ) : data?.plainLyrics ? (
          <div className="space-y-1 py-4">
            {data.plainLyrics.split("\n").map((line: string, i: number) => (
              <p key={i} className={cn("text-sm leading-relaxed", line === "" ? "mt-3" : "")}>
                {line || "\u00A0"}
              </p>
            ))}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <MicVocal className="h-8 w-8 text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No lyrics found</p>
            <p className="text-xs text-muted-foreground/60">
              {"Lyrics aren't available for this track"}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
