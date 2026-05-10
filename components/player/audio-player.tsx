"use client"

import { useEffect, useState } from "react"
import { usePlayerStore } from "@/stores/player-store"
import { useSidebarStore } from "@/stores/sidebar-store"
import { seekToPlayback } from "@/lib/playback-events"
import { PlayerControls } from "./player-controls"
import { ProgressBar } from "./progress-bar"
import { VolumeControl } from "./volume-control"
import { NowPlaying } from "./now-playing"
import { QueueButton } from "./queue-button"
import { PlaybackModeToggle } from "./playback-mode-toggle"
import { ExpandedPlayer } from "./expanded-player"
import { Button } from "@/components/ui/button"
import { ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"

export function AudioPlayer() {
  const { currentTrack, isPlaying, setExpandedPlayerOpen } = usePlayerStore()
  const { isCollapsed } = useSidebarStore()
  const canPlayVideo = Boolean(currentTrack)
  const [isExpanded, setIsExpanded] = useState(false)

  useEffect(() => {
    if (isPlaying) return

    document.querySelectorAll<HTMLMediaElement>("audio, video").forEach((media) => {
      if (!media.paused) media.pause()
    })
  }, [currentTrack?.id, currentTrack?.videoId, isPlaying])

  if (!currentTrack) return null

  const openExpandedPlayer = () => {
    setExpandedPlayerOpen(true)
    setIsExpanded(true)
  }

  const closeExpandedPlayer = () => {
    setIsExpanded(false)
    setExpandedPlayerOpen(false)
  }

  if (isExpanded) {
    return <ExpandedPlayer onClose={closeExpandedPlayer} />
  }

  return (
    <div
      className={cn(
        // Fixed positioning - bottom-16 on mobile (above 64px MobileNav), bottom-0 on desktop
        "fixed left-0 right-0 z-50 bottom-16 lg:bottom-0",
        "border-t border-border bg-card/95 backdrop-blur-lg",
        // On desktop: offset left to not overlap sidebar
        isCollapsed ? "lg:pl-16" : "lg:pl-64"
      )}
    >
      <ProgressBar onSeek={seekToPlayback} />

      <div className="flex h-16 items-center gap-1 px-2 sm:gap-2 sm:px-3 lg:h-20 lg:gap-4 lg:px-6">
        {/* Now Playing — tappable to expand */}
        <div className="min-w-0 flex-1 lg:w-64 lg:flex-none">
          <NowPlaying onExpand={openExpandedPlayer} />
        </div>

        {/* Full controls — hidden on mobile, centered on desktop */}
        <div className="hidden flex-1 justify-center sm:flex">
          <PlayerControls />
        </div>

        {/* Compact prev/play/next — mobile only */}
        <div className="flex items-center sm:hidden">
          <PlayerControls compact />
        </div>

        {/* Right side extras */}
        <div className="flex flex-shrink-0 items-center gap-0.5 sm:gap-1">
          {canPlayVideo && (
            <span className="inline-flex">
              <PlaybackModeToggle />
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="hidden h-8 w-8 sm:inline-flex"
            onClick={openExpandedPlayer}
            title="Expand player"
          >
            <ChevronUp className="h-4 w-4" />
          </Button>
          <VolumeControl />
          <QueueButton />
        </div>
      </div>
    </div>
  )
}
