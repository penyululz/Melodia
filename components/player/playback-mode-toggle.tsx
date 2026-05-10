"use client"

import { useSettingsStore } from "@/stores/settings-store"
import { Button } from "@/components/ui/button"
import { Music, Video } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function PlaybackModeToggle() {
  const { playbackMode, dataSaver, setPlaybackMode } = useSettingsStore()

  const toggleMode = () => {
    if (dataSaver) return
    setPlaybackMode(playbackMode === "audio" ? "video" : "audio")
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleMode}
            disabled={dataSaver}
            className={cn(
              "h-8 w-8",
              playbackMode === "video" && "text-primary"
            )}
          >
            {playbackMode === "video" ? (
              <Video className="h-4 w-4" />
            ) : (
              <Music className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>
            {playbackMode === "video" ? "Switch to Audio" : "Switch to Video"}
            {dataSaver && " (disabled in Data Saver mode)"}
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
