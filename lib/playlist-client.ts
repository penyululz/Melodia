"use client"

import { mutate } from "swr"
import { toast } from "sonner"
import type { Track } from "@/stores/player-store"

export interface PlaylistSummary {
  id: string | number
  name: string
  track_count?: number
}

type PlaylistTrackPayload =
  | {
      track_id: number
      source: "local"
    }
  | {
      yt_video_id: string
      source: "youtube"
      title: string
      artist: string | null
      album: string | null
      duration: number | null
      thumbnailUrl: string | null
      contentType: string | null
      podcastTitle: string | null
      podcastAuthor: string | null
      podcastEpisodeNumber: number | null
      podcastSeasonNumber: number | null
      podcastDescription: string | null
      podcastPublishedAt: string | null
    }

export function getPlaylistTrackPayload(track: Track): PlaylistTrackPayload | null {
  if (track.source === "youtube") {
    const videoId = track.videoId || String(track.id || "").trim()
    if (!videoId) return null

    const typedTrack = track as Track & {
      thumbnailUrl?: string | null
      thumbnailUrlHQ?: string | null
      is_favorite?: boolean | number
      is_cached?: boolean | number
    }

    return {
      yt_video_id: videoId,
      source: "youtube",
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
      thumbnailUrl: typedTrack.thumbnailUrlHQ || typedTrack.thumbnailUrl || track.cover_art_path || null,
      contentType: track.content_type || "music",
      podcastTitle: track.podcast_title || null,
      podcastAuthor: track.podcast_author || null,
      podcastEpisodeNumber: track.podcast_episode_number || null,
      podcastSeasonNumber: track.podcast_season_number || null,
      podcastDescription: track.podcast_description || null,
      podcastPublishedAt: track.podcast_published_at || null,
    }
  }

  const trackId = Number(track.id)
  if (!Number.isInteger(trackId) || trackId <= 0) return null

  return {
    track_id: trackId,
    source: "local",
  }
}

export async function addTrackToPlaylist(track: Track, playlist: PlaylistSummary) {
  const payload = getPlaylistTrackPayload(track)
  if (!payload) {
    toast.error("This track cannot be added to a playlist")
    return null
  }

  const response = await fetch(`/api/playlists/${playlist.id}/tracks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
  const data = await response.json().catch(() => null)

  if (!response.ok) {
    throw new Error(data?.error || "Failed to add track")
  }

  toast.success(
    data?.alreadyAdded ? "Track is already in that playlist" : `Added to ${playlist.name}`
  )
  mutate("/api/playlists")
  mutate(`/api/playlists/${playlist.id}`)
  mutate(`/api/playlists/${playlist.id}/tracks`)
  mutate("/api/home")
  mutate("/api/mixes")

  return data
}
