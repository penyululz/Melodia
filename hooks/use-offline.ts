"use client"

import { useState, useEffect, useCallback } from "react"
import {
  isAvailableOffline,
  saveForOffline,
  removeFromOffline,
  getAllOfflineTracks,
  getOfflineStorageUsed,
  type OfflineTrack,
} from "@/lib/offline-storage"
import { useAuthStore } from "@/stores/auth-store"

/**
 * Hook to check if the app is online/offline
 */
export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(true)

  useEffect(() => {
    // Set initial state
    setIsOnline(navigator.onLine)

    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)

    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
    }
  }, [])

  return isOnline
}

/**
 * Hook to manage offline availability for a single track
 */
export function useOfflineTrack(trackId: string | string[] | undefined) {
  const userId = useAuthStore((state) => state.user?.id)
  const [isOffline, setIsOffline] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const trackIds = Array.isArray(trackId) ? trackId : trackId ? [trackId] : []
  const trackIdsKey = trackIds.join("|")

  const refresh = useCallback(async () => {
    if (trackIds.length === 0) {
      setIsOffline(false)
      return
    }

    await Promise.all(trackIds.map((id) => isAvailableOffline(id).catch(() => false)))
      .then((results) => setIsOffline(results.some(Boolean)))
      .catch(() => setIsOffline(false))
  }, [trackIdsKey, userId])

  useEffect(() => {
    refresh()
  }, [trackIdsKey, userId, refresh])

  const saveOffline = useCallback(
    async (track: Parameters<typeof saveForOffline>[0], audioBlob: Blob) => {
      if (trackIds.length === 0) return
      setIsLoading(true)
      try {
        await saveForOffline(track, audioBlob)
        setIsOffline(true)
      } finally {
        setIsLoading(false)
      }
    },
    [trackIdsKey, userId]
  )

  const removeOffline = useCallback(async () => {
    if (trackIds.length === 0) return
    setIsLoading(true)
    try {
      await Promise.all(trackIds.map((id) => removeFromOffline(id)))
      setIsOffline(false)
    } finally {
      setIsLoading(false)
    }
  }, [trackIdsKey, userId])

  return { isOffline, isLoading, saveOffline, removeOffline, refresh }
}

/**
 * Hook to get all offline tracks and storage info
 */
export function useOfflineLibrary() {
  const userId = useAuthStore((state) => state.user?.id)
  const [tracks, setTracks] = useState<OfflineTrack[]>([])
  const [storageUsed, setStorageUsed] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  const refresh = useCallback(async () => {
    setIsLoading(true)
    try {
      const [allTracks, used] = await Promise.all([
        getAllOfflineTracks(),
        getOfflineStorageUsed(),
      ])
      setTracks(allTracks)
      setStorageUsed(used)
    } catch (error) {
      console.error("Failed to load offline library:", error)
    } finally {
      setIsLoading(false)
    }
  }, [userId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { tracks, storageUsed, isLoading, refresh }
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  const k = 1024
  const sizes = ["B", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}
