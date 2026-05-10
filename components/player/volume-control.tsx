"use client"

import { usePlayerStore } from "@/stores/player-store"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Volume, Volume1, Volume2, VolumeX } from "lucide-react"

export function VolumeControl() {
  const { volume, isMuted, setVolume, toggleMute } = usePlayerStore()

  const getVolumeIcon = () => {
    if (isMuted || volume === 0) return VolumeX
    if (volume < 0.3) return Volume
    if (volume < 0.7) return Volume1
    return Volume2
  }

  const VolumeIcon = getVolumeIcon()

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="flex h-8 w-8 sm:h-9 sm:w-9"
          title="Volume"
        >
          <VolumeIcon className="h-4 w-4 sm:h-5 sm:w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" side="top" align="center">
        <div className="flex flex-col items-center gap-2">
          <Slider
            value={[isMuted ? 0 : volume * 100]}
            max={100}
            step={1}
            orientation="vertical"
            onValueChange={(value) => setVolume(value[0] / 100)}
            className="h-24 w-2"
          />
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleMute}
            className="h-8 w-8"
          >
            <VolumeIcon className="h-4 w-4" />
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
