"use client"

import { useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Download, CheckCircle, Loader2, Trash2, WifiOff } from "lucide-react"
import { useOfflineTrack, useOnlineStatus } from "@/hooks/use-offline"
import { cn } from "@/lib/utils"
import { Track } from "@/stores/player-store"
import { useSettingsStore } from "@/stores/settings-store"
import { useAuthStore } from "@/stores/auth-store"
import {
  cacheTrackForOffline,
  getTrackOfflineKeys,
  type OfflineMediaMode,
} from "@/lib/offline-media"

interface SaveOfflineButtonProps {
  track: Track
  variant?: "icon" | "button"
  size?: "sm" | "default"
  className?: string
}

export function SaveOfflineButton({
  track,
  variant = "icon",
  size = "default",
  className,
}: SaveOfflineButtonProps) {
  const settings = useSettingsStore()
  const user = useAuthStore((state) => state.user)
  const trackIds = getTrackOfflineKeys(track)
  const { isOffline, isLoading, removeOffline, refresh } = useOfflineTrack(trackIds)
  const isOnline = useOnlineStatus()
  const [downloading, setDownloading] = useState(false)

  const handleSaveOffline = useCallback(async () => {
    if (trackIds.length === 0 || !user) return
    setDownloading(true)

    try {
      const mode: OfflineMediaMode = settings.playbackMode === "video" ? "video" : "audio"
      await cacheTrackForOffline(track, mode, settings.streamingQuality)
      await refresh()
    } catch (error) {
      console.error("Failed to save offline:", error)
    } finally {
      setDownloading(false)
    }
  }, [refresh, settings.playbackMode, settings.streamingQuality, track, trackIds.length, user])

  const handleRemoveOffline = useCallback(async () => {
    await removeOffline()
  }, [removeOffline])

  const loading = isLoading || downloading

  // Already saved offline
  if (isOffline) {
    if (variant === "icon") {
      return (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={handleRemoveOffline}
          disabled={loading}
          className={cn("text-primary hover:text-destructive", className)}
          title="Remove from offline"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle className="h-4 w-4" />
          )}
        </Button>
      )
    }

    return (
      <Button
        type="button"
        variant="outline"
        size={size}
        onClick={handleRemoveOffline}
        disabled={loading}
        className={cn("gap-2", className)}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="h-4 w-4" />
        )}
        Remove Offline
      </Button>
    )
  }

  // Not online - can't download
  if (!user || !isOnline) {
    if (variant === "icon") {
      return (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled
          className={cn("text-muted-foreground", className)}
          title={!user ? "Sign in to save offline" : "Offline - cannot download"}
        >
          <WifiOff className="h-4 w-4" />
        </Button>
      )
    }

    return (
      <Button
        type="button"
        variant="outline"
        size={size}
        disabled
        className={cn("gap-2", className)}
      >
        <WifiOff className="h-4 w-4" />
        {!user ? "Sign In Required" : "Offline"}
      </Button>
    )
  }

  // Can download
  if (variant === "icon") {
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={handleSaveOffline}
        disabled={loading}
        className={cn("text-muted-foreground hover:text-foreground", className)}
        title="Save for offline"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Download className="h-4 w-4" />
        )}
      </Button>
    )
  }

  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      onClick={handleSaveOffline}
      disabled={loading}
      className={cn("gap-2", className)}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Download className="h-4 w-4" />
      )}
      Save Offline
    </Button>
  )
}
