"use client"

import { usePlayerStore } from "@/stores/player-store"
import { Button } from "@/components/ui/button"
import { Slider } from "@/components/ui/slider"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { getBaseVolumeForNormalizedVolume, getNormalizedVolume } from "@/lib/audio-normalization"
import { Volume, Volume1, Volume2, VolumeX } from "lucide-react"

export function VolumeControl() {
  const { currentTrack, volume, isMuted, setVolume, toggleMute } = usePlayerStore()
  const effectiveVolume = getNormalizedVolume(volume, isMuted, currentTrack)
  const effectivePercent = Math.round(effectiveVolume * 100)

  const getVolumeIcon = () => {
    if (isMuted || effectiveVolume === 0) return VolumeX
    if (effectiveVolume < 0.3) return Volume
    if (effectiveVolume < 0.7) return Volume1
    return Volume2
  }

  const VolumeIcon = getVolumeIcon()
  const handleVolumeChange = (value: number[]) => {
    setVolume(getBaseVolumeForNormalizedVolume(value[0] / 100, currentTrack))
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="flex h-8 w-8 sm:h-9 sm:w-9"
          title={`Volume ${effectivePercent}%`}
        >
          <VolumeIcon className="h-4 w-4 sm:h-5 sm:w-5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-3" side="top" align="center">
        <div className="flex flex-col items-center gap-2">
          <Slider
            value={[effectivePercent]}
            max={100}
            step={1}
            orientation="vertical"
            onValueChange={handleVolumeChange}
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
