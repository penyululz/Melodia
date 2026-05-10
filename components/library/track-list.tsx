"use client"

import { memo, useState } from "react"
import Image from "next/image"
import { mutate } from "swr"
import { usePlayerStore, Track } from "@/stores/player-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { AddToPlaylistSubmenu } from "@/components/playlists/add-to-playlist-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatDuration } from "@/lib/format"
import {
  Check,
  Download,
  Heart,
  Loader2,
  MoreHorizontal,
  Music,
  Pause,
  Pencil,
  Play,
  Trash2,
  Video,
  X,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { useSettingsStore } from "@/stores/settings-store"
import {
  cacheTrackForOffline,
  getTrackOfflineKeys,
  type OfflineMediaMode,
} from "@/lib/offline-media"
import { removeFromOffline } from "@/lib/offline-storage"

interface TrackListProps {
  tracks: Track[]
  showAlbum?: boolean
  showCover?: boolean
  playlistId?: string | number
  onPlaylistTrackRemoved?: (trackId: string | number) => void
  onTrackDeleted?: (trackId: string | number) => void
}

interface EditTrackForm {
  title: string
  artist: string
  album: string
  genre: string
  year: string
}

function isYouTubeTrack(track: Track): boolean {
  return track.source === "youtube" && Boolean(track.videoId)
}

function getComparableTrackKey(track: Partial<Track> | null | undefined): string {
  const videoId = track?.videoId || track?.file_path?.match(/^\/api\/youtube\/stream\/([^/?#]+)/)?.[1]
  if (videoId) return `youtube:${videoId}`
  if (track?.id !== undefined && track.id !== null) return `${track.source || "local"}:${track.id}`
  return `path:${track?.file_path || track?.title || ""}`
}

function isSameTrack(left: Partial<Track> | null | undefined, right: Partial<Track> | null | undefined): boolean {
  return Boolean(left && right && getComparableTrackKey(left) === getComparableTrackKey(right))
}

function getNumericTrackId(track: Track): number | null {
  const id = Number(track.id)
  return Number.isInteger(id) && id > 0 ? id : null
}

function getTrackFavorite(track: Track): boolean {
  return Boolean((track as Track & { is_favorite?: boolean | number }).is_favorite)
}

function getTrackCached(track: Track): boolean {
  return Boolean((track as Track & { is_cached?: boolean | number }).is_cached)
}

export function TrackList({
  tracks,
  showAlbum = true,
  showCover = true,
  playlistId,
  onPlaylistTrackRemoved,
  onTrackDeleted,
}: TrackListProps) {
  const settings = useSettingsStore()
  const [editingTrack, setEditingTrack] = useState<Track | null>(null)
  const [editForm, setEditForm] = useState<EditTrackForm>({
    title: "",
    artist: "",
    album: "",
    genre: "",
    year: "",
  })
  const [savingEdit, setSavingEdit] = useState(false)
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set())

  const getAutoDownloadMediaType = (): OfflineMediaMode =>
    settings.playbackMode === "video" ? "video" : "audio"

  const refreshLibraryData = (trackId?: string | number) => {
    mutate((key) => typeof key === "string" && key.startsWith("/api/tracks"))
    mutate("/api/albums")
    mutate("/api/artists")
    mutate("/api/genres")
    mutate("/api/stats")
    if (trackId !== undefined) {
      mutate(`/api/tracks/${trackId}`)
    }
  }

  const toggleFavorite = async (track: Track) => {
    try {
      const response = isYouTubeTrack(track)
        ? await fetch(`/api/youtube/tracks/${track.videoId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "toggleFavorite" }),
          })
        : await fetch(`/api/tracks/${track.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ favorite: true }),
          })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(data?.error || "Failed to update favorite")
      }

      refreshLibraryData(track.id)
      mutate("/api/tracks?favorites=true")
      mutate("/api/youtube/tracks")
      mutate("/api/youtube/tracks?filter=favorites")

      const updatedTrack = data?.track
      const isNowFavorite = Boolean(updatedTrack?.is_favorite)
      if (
        isYouTubeTrack(track) &&
        settings.autoDownloadLibraryActions &&
        isNowFavorite
      ) {
        await ensureYouTubeDownloaded(track, getAutoDownloadMediaType(), {
          successMessage: "Saved locally for offline favorites",
        })
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update favorite")
    }
  }

  const removeTrackFromPlaylist = async (track: Track) => {
    if (!playlistId) return
    const trackIsYouTube = isYouTubeTrack(track)
    const videoId = track.videoId || (trackIsYouTube ? String(track.id) : null)
    const trackId = getNumericTrackId(track)
    if (!trackIsYouTube && !trackId) return
    if (trackIsYouTube && !videoId) return

    try {
      const response = await fetch(`/api/playlists/${playlistId}/tracks`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          trackIsYouTube
            ? { yt_video_id: videoId }
            : { track_id: trackId }
        ),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(data?.error || "Failed to remove track")
      }

      toast.success("Removed from playlist")
      mutate("/api/playlists")
      mutate(`/api/playlists/${playlistId}`)
      mutate(`/api/playlists/${playlistId}/tracks`)
      const removedTrackId = trackIsYouTube ? videoId : trackId
      if (removedTrackId) onPlaylistTrackRemoved?.(removedTrackId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to remove track")
    }
  }

  const openEditDialog = (track: Track) => {
    const editableTrack = track as Track & { genre?: string | null; year?: number | null }
    setEditingTrack(track)
    setEditForm({
      title: track.title || "",
      artist: track.artist || "",
      album: track.album || "",
      genre: editableTrack.genre || "",
      year: editableTrack.year ? String(editableTrack.year) : "",
    })
  }

  const saveTrackEdit = async () => {
    if (!editingTrack || !editForm.title.trim()) return

    setSavingEdit(true)
    try {
      const response = await fetch(`/api/tracks/${editingTrack.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: editForm.title.trim(),
          artist: editForm.artist.trim() || null,
          album: editForm.album.trim() || null,
          genre: editForm.genre.trim() || null,
          year: editForm.year.trim() ? Number(editForm.year) : null,
        }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(data?.error || "Failed to update track")
      }

      toast.success("Track updated")
      setEditingTrack(null)
      refreshLibraryData(editingTrack.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update track")
    } finally {
      setSavingEdit(false)
    }
  }

  const deleteTrack = async (track: Track) => {
    if (!confirm(`Delete "${track.title}" from your library?`)) return

    try {
      const response = isYouTubeTrack(track)
        ? await fetch(`/api/youtube/tracks/${track.videoId}`, { method: "DELETE" })
        : await fetch(`/api/tracks/${track.id}`, { method: "DELETE" })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(data?.error || "Failed to delete track")
      }

      toast.success("Track deleted")
      await Promise.all(getTrackOfflineKeys(track).map((key) => removeFromOffline(key))).catch(() => {})
      refreshLibraryData(track.id)
      mutate("/api/playlists")
      mutate("/api/youtube/tracks")
      mutate("/api/youtube/tracks?filter=favorites")
      mutate("/api/youtube/tracks?filter=cached")
      if (playlistId) {
        mutate(`/api/playlists/${playlistId}/tracks`)
      }
      onTrackDeleted?.(track.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete track")
    }
  }

  const ensureYouTubeDownloaded = async (
    track: Track,
    media: OfflineMediaMode = "audio",
    options?: { successMessage?: string; silent?: boolean }
  ): Promise<number | null> => {
    if (!track.videoId) return null

    setDownloadingIds((current) => new Set(current).add(track.videoId!))
    if (!options?.silent) {
      toast.info(media === "video" ? "Saving MP4 locally..." : "Saving song locally...")
    }

    try {
      const response = await fetch(
        `/api/youtube/download/${track.videoId}?quality=${settings.downloadQuality}&media=${media}`,
        { method: "POST" }
      )
      const data = await response.json().catch(() => null)

      if (!response.ok || !data?.success) {
        throw new Error(data?.error || "Download failed")
      }

      const localTrack = data.localTrack as (Track & { id: number }) | undefined
      const cacheTrack: Track = {
        ...track,
        ...(localTrack || {}),
        id: track.videoId,
        source: "youtube",
        videoId: track.videoId,
        file_path: `/api/youtube/stream/${track.videoId}`,
        file_format: media === "video" ? "MP4" : localTrack?.file_format || track.file_format,
        cover_art_path: localTrack?.cover_art_path || track.cover_art_path,
      }

      await cacheTrackForOffline(cacheTrack, media, settings.streamingQuality).catch((error) => {
        console.warn("[v0] Could not cache track in browser offline storage:", error)
      })

      if (!options?.silent) {
        toast.success(
          options?.successMessage ||
            (media === "video" ? "MP4 added to your library" : "Song saved locally")
        )
      }
      refreshLibraryData(track.id)
      mutate("/api/youtube/tracks")
      mutate("/api/youtube/tracks?filter=cached")
      return localTrack?.id ? Number(localTrack.id) : null
    } catch (error) {
      if (!options?.silent) {
        toast.error(error instanceof Error ? error.message : "Download failed")
      }
      return null
    } finally {
      setDownloadingIds((current) => {
        const next = new Set(current)
        next.delete(track.videoId!)
        return next
      })
    }
  }

  const downloadYouTubeTrack = async (track: Track, media: OfflineMediaMode = "audio") => {
    if (!track.videoId) return

    if (getTrackCached(track) && media === "audio") {
      try {
        const response = await fetch(`/api/youtube/download/${track.videoId}`, { method: "DELETE" })
        const data = await response.json().catch(() => null)
        if (!response.ok) throw new Error(data?.error || "Failed to remove download")

        toast.success("Download removed")
        await Promise.all(getTrackOfflineKeys(track).map((key) => removeFromOffline(key))).catch(() => {})
        refreshLibraryData(track.id)
        mutate("/api/youtube/tracks")
        mutate("/api/youtube/tracks?filter=cached")
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Failed to remove download")
      }
      return
    }

    await ensureYouTubeDownloaded(track, media)
  }

  if (tracks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Music className="mb-4 h-16 w-16 text-muted-foreground" />
        <h3 className="text-lg font-medium">No tracks found</h3>
        <p className="text-sm text-muted-foreground">
          Upload some music to get started
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="space-y-1">
        {tracks.map((track, index) => {
          const trackIsYouTube = isYouTubeTrack(track)
          const isCached = getTrackCached(track)
          const isFavorite = getTrackFavorite(track)

          return (
            <TrackRow
              key={`${track.source || "local"}-${trackIsYouTube ? track.videoId : track.id}`}
              track={track}
              index={index}
              tracks={tracks}
              showAlbum={showAlbum}
              showCover={showCover}
              playlistId={playlistId}
              trackIsYouTube={trackIsYouTube}
              isCached={isCached}
              isFavorite={isFavorite}
              isDownloading={track.videoId ? downloadingIds.has(track.videoId) : false}
              onToggleFavorite={toggleFavorite}
              onRemoveFromPlaylist={removeTrackFromPlaylist}
              onOpenEdit={openEditDialog}
              onDelete={deleteTrack}
              onDownloadYouTube={downloadYouTubeTrack}
            />
          )
        })}
      </div>

      <Dialog open={!!editingTrack} onOpenChange={(open) => !open && setEditingTrack(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Track Details</DialogTitle>
            <DialogDescription>
              Update the metadata used in albums, artists, and genres.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="track-title">Title</Label>
              <Input
                id="track-title"
                value={editForm.title}
                onChange={(event) => setEditForm((form) => ({ ...form, title: event.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="track-artist">Artist</Label>
              <Input
                id="track-artist"
                value={editForm.artist}
                onChange={(event) => setEditForm((form) => ({ ...form, artist: event.target.value }))}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="track-album">Album</Label>
              <Input
                id="track-album"
                value={editForm.album}
                onChange={(event) => setEditForm((form) => ({ ...form, album: event.target.value }))}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="track-genre">Genre</Label>
                <Input
                  id="track-genre"
                  value={editForm.genre}
                  onChange={(event) => setEditForm((form) => ({ ...form, genre: event.target.value }))}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="track-year">Year</Label>
                <Input
                  id="track-year"
                  inputMode="numeric"
                  value={editForm.year}
                  onChange={(event) => setEditForm((form) => ({ ...form, year: event.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingTrack(null)}>
              Cancel
            </Button>
            <Button onClick={saveTrackEdit} disabled={savingEdit || !editForm.title.trim()}>
              {savingEdit ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

interface TrackRowProps {
  track: Track
  index: number
  tracks: Track[]
  showAlbum: boolean
  showCover: boolean
  playlistId?: string | number
  trackIsYouTube: boolean
  isCached: boolean
  isFavorite: boolean
  isDownloading: boolean
  onToggleFavorite: (track: Track) => void
  onRemoveFromPlaylist: (track: Track) => void
  onOpenEdit: (track: Track) => void
  onDelete: (track: Track) => void
  onDownloadYouTube: (track: Track, media?: OfflineMediaMode) => void
}

const TrackRow = memo(function TrackRow({
  track,
  index,
  tracks,
  showAlbum,
  showCover,
  playlistId,
  trackIsYouTube,
  isCached,
  isFavorite,
  isDownloading,
  onToggleFavorite,
  onRemoveFromPlaylist,
  onOpenEdit,
  onDelete,
  onDownloadYouTube,
}: TrackRowProps) {
  const isCurrentTrack = usePlayerStore((state) => isSameTrack(state.currentTrack, track))
  const isTrackPlaying = usePlayerStore((state) => isSameTrack(state.currentTrack, track) && state.isPlaying)
  const playTrack = usePlayerStore((state) => state.playTrack)
  const togglePlay = usePlayerStore((state) => state.togglePlay)
  const addToQueue = usePlayerStore((state) => state.addToQueue)
  const thumbnail = track.cover_art_path || (track as Track & { thumbnailUrl?: string | null }).thumbnailUrl

  const handlePlay = () => {
    if (isCurrentTrack) {
      togglePlay()
    } else {
      playTrack(track, tracks)
    }
  }

  return (
    <div
      className={cn(
        "group flex items-center gap-3 rounded-md px-3 py-2 hover:bg-accent [contain-intrinsic-size:56px] [content-visibility:auto]",
        isCurrentTrack && "bg-accent"
      )}
    >
      <div className="w-8 text-center text-sm text-muted-foreground">
        <span className="hidden sm:inline group-hover:hidden">
          {isTrackPlaying ? (
            <span className="flex items-center justify-center">
              <span className="flex gap-0.5">
                <span className="h-3 w-0.5 animate-pulse bg-primary" />
                <span className="h-3 w-0.5 animate-pulse bg-primary [animation-delay:150ms]" />
                <span className="h-3 w-0.5 animate-pulse bg-primary [animation-delay:300ms]" />
              </span>
            </span>
          ) : (
            index + 1
          )}
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="flex h-8 w-8 sm:hidden sm:group-hover:flex"
          onClick={handlePlay}
          title={isTrackPlaying ? "Pause" : "Play"}
        >
          {isTrackPlaying ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Play className="h-4 w-4" />
          )}
        </Button>
      </div>

      {showCover && (
        <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-muted">
          {thumbnail ? (
            <Image
              src={thumbnail}
              alt={track.album || "Album"}
              fill
              className="object-cover"
              unoptimized={trackIsYouTube}
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <Music className="h-4 w-4 text-muted-foreground" />
            </div>
          )}
          {isCached && (
            <div className="absolute bottom-0 right-0 rounded-tl bg-emerald-500 p-0.5">
              <Download className="h-2 w-2 text-white" />
            </div>
          )}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <p
          className={cn(
            "truncate text-sm font-medium",
            isCurrentTrack && "text-primary"
          )}
        >
          {track.title}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {track.artist || "Unknown Artist"}
          {showAlbum && track.album && ` \u2022 ${track.album}`}
        </p>
      </div>

      <span className="hidden text-sm text-muted-foreground sm:block">
        {formatDuration(track.duration)}
      </span>

      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "h-8 w-8 opacity-100 sm:opacity-0 sm:group-hover:opacity-100",
          isFavorite && "text-primary opacity-100"
        )}
        onClick={() => onToggleFavorite(track)}
        title={isFavorite ? "Remove favorite" : "Favorite"}
      >
        <Heart className={cn("h-4 w-4", isFavorite && "fill-current")} />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 opacity-100"
            title="Track actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuItem onClick={handlePlay}>
            Play Now
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => addToQueue(track)}>
            Add to Queue
          </DropdownMenuItem>
          <AddToPlaylistSubmenu track={track} />
          {playlistId && (
            <DropdownMenuItem onClick={() => onRemoveFromPlaylist(track)}>
              <X className="h-4 w-4" />
              Remove from Playlist
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={() => onToggleFavorite(track)}>
            Toggle Favorite
          </DropdownMenuItem>
          {trackIsYouTube && (
            <>
              <DropdownMenuItem
                onClick={() => onDownloadYouTube(track)}
                disabled={isDownloading}
              >
                {isDownloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isCached ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                {isCached ? "Remove Download" : "Download Audio"}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDownloadYouTube(track, "video")}
                disabled={isDownloading}
              >
                <Video className="h-4 w-4" />
                Download MP4 Video
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuSeparator />
          {!trackIsYouTube && (
            <DropdownMenuItem onClick={() => onOpenEdit(track)}>
              <Pencil className="h-4 w-4" />
              Edit Details
            </DropdownMenuItem>
          )}
          <DropdownMenuItem variant="destructive" onClick={() => onDelete(track)}>
            <Trash2 className="h-4 w-4" />
            {trackIsYouTube ? "Remove from Library" : "Delete Track"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
})
