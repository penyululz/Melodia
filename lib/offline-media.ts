"use client"

import type { Track } from "@/stores/player-store"
import type { StreamingQuality } from "@/stores/settings-store"
import {
  getCurrentOfflineOwnerId,
  getOfflineRecordId,
  getOfflineAudio,
  saveForOffline,
  type OfflineTrack,
} from "@/lib/offline-storage"

export type OfflineMediaMode = "audio" | "video"

const YOUTUBE_STREAM_PATH_RE = /^\/api\/youtube\/stream\/([^/?#]+)/

type OfflineUrlResult = {
  key: string
  mimeType: string
  url: string
}

export function getYouTubeVideoIdFromTrack(track: Partial<Track> | null): string | null {
  if (!track) return null
  if (track.videoId) return track.videoId

  const filePath = track.file_path || ""
  const match = filePath.match(YOUTUBE_STREAM_PATH_RE)
  return match?.[1] || null
}

export function getTrackOfflineKeys(track: Partial<Track> | null): string[] {
  if (!track) return []

  const keys = [
    getYouTubeVideoIdFromTrack(track),
    track.id !== undefined && track.id !== null ? String(track.id) : null,
  ].filter(Boolean) as string[]

  return [...new Set(keys)]
}

export function getBestTrackMediaUrl(
  track: Partial<Track>,
  mode: OfflineMediaMode,
  streamingQuality: StreamingQuality
): string {
  const videoId = getYouTubeVideoIdFromTrack(track)
  if (videoId) {
    return `/api/youtube/stream/${videoId}?mode=${mode}&quality=${streamingQuality}`
  }

  return track.file_path || ""
}

export async function getOfflineObjectUrlForTrack(
  track: Partial<Track> | null,
  acceptedMimePrefixes: string[]
): Promise<OfflineUrlResult | null> {
  for (const key of getTrackOfflineKeys(track)) {
    const blob = await getOfflineAudio(key).catch(() => null)
    if (!blob) continue

    const mimeType = blob.type || ""
    const acceptsMimeType =
      acceptedMimePrefixes.length === 0 ||
      acceptedMimePrefixes.some((prefix) => mimeType.startsWith(prefix))

    if (!acceptsMimeType) continue

    return {
      key,
      mimeType,
      url: URL.createObjectURL(blob),
    }
  }

  return null
}

export async function cacheTrackForOffline(
  track: Track,
  mode: OfflineMediaMode,
  streamingQuality: StreamingQuality
): Promise<OfflineTrack | null> {
  const offlineKey = getTrackOfflineKeys(track)[0]
  const ownerId = getCurrentOfflineOwnerId()
  const mediaUrl = getBestTrackMediaUrl(track, mode, streamingQuality)

  if (!offlineKey || !ownerId || !mediaUrl) return null

  const response = await fetch(mediaUrl, { cache: "no-store" })
  if (!response.ok) {
    throw new Error("Failed to fetch media for offline playback")
  }

  const blob = await response.blob()
  await saveForOffline(
    {
      ...track,
      id: offlineKey,
      source: track.source || "local",
      videoId: getYouTubeVideoIdFromTrack(track) || track.videoId,
      file_path: mediaUrl,
    },
    blob
  )

  return {
    id: getOfflineRecordId(offlineKey, ownerId),
    trackId: offlineKey,
    ownerId,
    title: track.title,
    artist: track.artist || "Unknown Artist",
    album: track.album || undefined,
    duration: track.duration || 0,
    cover_art_path: track.cover_art_path || undefined,
    file_path: mediaUrl,
    source: track.source || "local",
    videoId: getYouTubeVideoIdFromTrack(track) || track.videoId,
    savedAt: Date.now(),
    size: blob.size,
  }
}
