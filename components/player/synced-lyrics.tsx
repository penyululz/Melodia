"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import useSWR from "swr"
import { Loader2, MicVocal } from "lucide-react"
import { usePlayerStore } from "@/stores/player-store"
import { cn } from "@/lib/utils"

interface LyricLine {
  time: number
  text: string
}

const fetcher = (url: string) => fetch(url).then((response) => response.json())

function parseLRC(lrc: string): LyricLine[] {
  const lines: LyricLine[] = []

  for (const line of lrc.split("\n")) {
    const match = line.match(/\[(\d+):(\d+(?:\.\d+)?)\](.*)/)
    if (!match) continue

    const time = Number.parseInt(match[1], 10) * 60 + Number.parseFloat(match[2])
    const text = match[3].trim()
    if (text) lines.push({ time, text })
  }

  return lines
}

export function SyncedLyrics() {
  const { currentTrack, currentTime } = usePlayerStore()
  const containerRef = useRef<HTMLDivElement>(null)
  const [currentLineIndex, setCurrentLineIndex] = useState(0)
  const lyricsUrl = currentTrack
    ? `/api/lyrics?title=${encodeURIComponent(currentTrack.title)}&artist=${encodeURIComponent(
        currentTrack.artist ?? ""
      )}&album=${encodeURIComponent(currentTrack.album ?? "")}&duration=${Math.round(
        currentTrack.duration ?? 0
      )}&trackId=${encodeURIComponent(String(currentTrack.id))}&videoId=${encodeURIComponent(currentTrack.videoId ?? "")}`
    : null
  const { data, isLoading } = useSWR(lyricsUrl, fetcher)
  const syncedLines = useMemo(
    () => (data?.syncedLyrics ? parseLRC(data.syncedLyrics) : []),
    [data]
  )

  useEffect(() => {
    if (!syncedLines.length) return

    let nextIndex = 0
    for (let i = 0; i < syncedLines.length; i++) {
      if (currentTime >= syncedLines[i].time) nextIndex = i
      else break
    }

    setCurrentLineIndex(nextIndex)
  }, [currentTime, syncedLines])

  useEffect(() => {
    const currentLineEl = containerRef.current?.querySelector(
      `[data-line-index="${currentLineIndex}"]`
    )
    currentLineEl?.scrollIntoView({ behavior: "smooth", block: "center" })
  }, [currentLineIndex])

  if (!currentTrack) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        No track playing
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (syncedLines.length > 0) {
    return (
      <div ref={containerRef} className="h-full overflow-y-auto px-4 py-8 scrollbar-hide">
        <div className="space-y-4">
          {syncedLines.map((line, index) => (
            <p
              key={`${line.time}-${line.text}`}
              data-line-index={index}
              className={cn(
                "cursor-pointer text-lg transition-all duration-300 hover:text-foreground/80",
                index === currentLineIndex
                  ? "origin-left scale-105 text-xl font-bold text-primary"
                  : index < currentLineIndex
                    ? "text-muted-foreground/50"
                    : "text-muted-foreground"
              )}
            >
              {line.text}
            </p>
          ))}
        </div>
      </div>
    )
  }

  if (data?.plainLyrics) {
    return (
      <div className="h-full overflow-y-auto px-4 py-8 scrollbar-hide">
        <div className="space-y-1">
          {data.plainLyrics.split("\n").map((line: string, index: number) => (
            <p
              key={`${index}-${line}`}
              className={cn("text-sm leading-relaxed", line === "" && "mt-3")}
            >
              {line || "\u00A0"}
            </p>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
      <MicVocal className="h-8 w-8 opacity-30" />
      <p className="text-sm">No lyrics found</p>
    </div>
  )
}
