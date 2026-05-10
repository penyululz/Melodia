"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import useSWR from "swr"
import { TrackList } from "@/components/library/track-list"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Music, Radio, Download, Loader2, Upload, ChevronDown, ChevronUp, Podcast } from "lucide-react"
import type { Track } from "@/stores/player-store"

const fetcher = (url: string) => fetch(url).then((res) => res.json())
const UploadZone = dynamic(
  () => import("@/components/upload/upload-zone").then((mod) => mod.UploadZone),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    ),
  }
)

export default function LibraryPage() {
  const [showUpload, setShowUpload] = useState(false)
  const { data: localData, isLoading: localLoading } = useSWR("/api/tracks", fetcher)
  const { data: ytData, isLoading: ytLoading } = useSWR("/api/youtube/tracks", fetcher)
  
  const localTracks = (localData?.tracks || []) as Track[]
  const ytTracks = ytData?.tracks || []
  const promotedVideoIds = new Set(localTracks.map(getPromotedYouTubeVideoId).filter(Boolean))
  const savedOnlineTracks = ytTracks
    .filter((track: any) => !promotedVideoIds.has(track.video_id))
    .map(toNativeOnlineTrack) as Track[]
  const promotedDownloadedTracks = localTracks.filter((track) => Boolean(getPromotedYouTubeVideoId(track)))
  const downloadedTracks = [
    ...promotedDownloadedTracks,
    ...savedOnlineTracks.filter((track: Track) => (track as any).is_cached),
  ]
  const allTracks = [...localTracks, ...savedOnlineTracks]
  const podcastTracks = allTracks.filter(isPodcastTrack)

  const totalTracks = allTracks.length

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Library</h1>
          <p className="text-muted-foreground">
            {totalTracks} items in your library
          </p>
        </div>
        <Button
          variant={showUpload ? "secondary" : "default"}
          onClick={() => setShowUpload(!showUpload)}
          className="gap-2"
        >
          <Upload className="h-4 w-4" />
          Upload Music
          {showUpload ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </div>

      {/* Collapsible upload zone */}
      {showUpload && (
        <div className="mb-6 rounded-lg border bg-card p-4">
          <UploadZone />
        </div>
      )}

      <Tabs defaultValue="all" className="space-y-4">
        <TabsList className="flex-wrap">
          <TabsTrigger value="all" className="gap-2">
            All Songs
            <span className="text-xs text-muted-foreground">({totalTracks})</span>
          </TabsTrigger>
          <TabsTrigger value="local" className="gap-2">
            <Music className="h-4 w-4" />
            Local Files
            <span className="text-xs text-muted-foreground">({localTracks.length})</span>
          </TabsTrigger>
          <TabsTrigger value="online" className="gap-2">
            <Radio className="h-4 w-4" />
            Saved Online
            <span className="text-xs text-muted-foreground">({savedOnlineTracks.length})</span>
          </TabsTrigger>
          <TabsTrigger value="downloaded" className="gap-2">
            <Download className="h-4 w-4" />
            Downloads
            <span className="text-xs text-muted-foreground">({downloadedTracks.length})</span>
          </TabsTrigger>
          <TabsTrigger value="podcasts" className="gap-2">
            <Podcast className="h-4 w-4" />
            Podcasts
            <span className="text-xs text-muted-foreground">({podcastTracks.length})</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="all" className="space-y-6">
          {localLoading || ytLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              {allTracks.length > 0 ? (
                <div className="rounded-lg border bg-card">
                  <TrackList tracks={allTracks} />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center rounded-lg border bg-card py-16 text-center">
                  <Music className="mb-4 h-16 w-16 text-muted-foreground" />
                  <h3 className="text-lg font-medium">Your library is empty</h3>
                  <p className="text-sm text-muted-foreground">
                    Upload music or use search to save songs.
                  </p>
                </div>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="local">
          {localLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="rounded-lg border bg-card">
              <TrackList tracks={localTracks} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="online">
          {ytLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="rounded-lg border bg-card">
              <TrackList tracks={savedOnlineTracks} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="downloaded">
          {ytLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : downloadedTracks.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border bg-card py-16 text-center">
              <Download className="mb-4 h-16 w-16 text-muted-foreground" />
              <h3 className="text-lg font-medium">No downloads yet</h3>
              <p className="text-sm text-muted-foreground">
                Download saved online songs for offline playback.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border bg-card">
              <TrackList tracks={downloadedTracks} />
            </div>
          )}
        </TabsContent>

        <TabsContent value="podcasts">
          {localLoading || ytLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : podcastTracks.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border bg-card py-16 text-center">
              <Podcast className="mb-4 h-16 w-16 text-muted-foreground" />
              <h3 className="text-lg font-medium">No podcasts yet</h3>
              <p className="text-sm text-muted-foreground">
                Upload or save podcast episodes to collect them here.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border bg-card">
              <TrackList tracks={podcastTracks} />
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}

function toNativeOnlineTrack(track: any): Track {
  return {
    id: track.video_id,
    source: "youtube",
    videoId: track.video_id,
    title: track.title,
    artist: track.artist || "Unknown Artist",
    album: track.album || null,
    duration: track.duration ?? null,
    cover_art_path: track.thumbnail_url || null,
    file_path: track.cached_file_path ? `/api/youtube/stream/${track.video_id}` : undefined,
    file_format: track.cached_file_path?.toLowerCase?.().endsWith(".mp4") ? "MP4" : null,
    content_type: track.content_type || "music",
    podcast_title: track.podcast_title || null,
    podcast_author: track.podcast_author || null,
    podcast_episode_number: track.podcast_episode_number || null,
    podcast_season_number: track.podcast_season_number || null,
    podcast_description: track.podcast_description || null,
    podcast_published_at: track.podcast_published_at || null,
    loudness_adjust_db: track.loudness_adjust_db ?? null,
    replaygain_track_gain: track.replaygain_track_gain ?? null,
    replaygain_album_gain: track.replaygain_album_gain ?? null,
    ...(track.thumbnail_url ? { thumbnailUrl: track.thumbnail_url } : {}),
    is_cached: track.is_cached === 1 || track.is_cached === true,
    is_favorite: track.is_favorite === 1 || track.is_favorite === true,
  } as Track
}

function getPromotedYouTubeVideoId(track: Track): string | null {
  const filePath = track.file_path || ""
  const match = filePath.match(/^\/api\/youtube\/stream\/([^/?#]+)/)
  return match?.[1] || null
}

function isPodcastTrack(track: Track): boolean {
  const typed = track as Track & { content_type?: string | null }
  return typed.content_type === "podcast"
}
