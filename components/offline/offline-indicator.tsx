"use client"

import { WifiOff } from "lucide-react"
import { useOnlineStatus } from "@/hooks/use-offline"

export function OfflineIndicator() {
  const isOnline = useOnlineStatus()

  if (isOnline) return null

  return (
    <div className="flex items-center gap-1.5 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-medium text-destructive">
      <WifiOff className="h-3 w-3" />
      <span>Offline</span>
    </div>
  )
}
