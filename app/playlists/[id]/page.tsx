"use client"

import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { TrackList } from "@/components/library/track-list"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Pencil, Trash2 } from "lucide-react"
import { toast } from "sonner"

interface Playlist {
  id: string
  name: string
  description: string | null
  track_count: number
}

interface Track {
  id: string
  title: string
  artist: string | null
  album: string | null
  duration: number | null
  genre: string | null
  cover_art_path: string | null
  file_path?: string
  file_format?: string | null
}

export default function PlaylistDetailPage() {
  const params = useParams()
  const playlistId = params.id as string
  const [playlist, setPlaylist] = useState<Playlist | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [loading, setLoading] = useState(true)
  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState("")
  const [editDescription, setEditDescription] = useState("")
  const [savingEdit, setSavingEdit] = useState(false)

  useEffect(() => {
    const loadData = async () => {
      try {
        const [playlistRes, tracksRes] = await Promise.all([
          fetch(`/api/playlists/${playlistId}`),
          fetch(`/api/playlists/${playlistId}/tracks`),
        ])

        if (playlistRes.ok) {
          setPlaylist(await playlistRes.json())
        }
        if (tracksRes.ok) {
          setTracks(await tracksRes.json())
        }
      } catch (error) {
        console.error("Error loading playlist:", error)
      } finally {
        setLoading(false)
      }
    }

    loadData()
  }, [playlistId])

  const openEditDialog = () => {
    if (!playlist) return
    setEditName(playlist.name)
    setEditDescription(playlist.description || "")
    setEditOpen(true)
  }

  const handleSavePlaylist = async () => {
    if (!editName.trim()) return

    setSavingEdit(true)
    try {
      const response = await fetch(`/api/playlists/${playlistId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim(),
          description: editDescription.trim() || null,
        }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(data?.error || "Failed to update playlist")
      }

      setPlaylist((current) =>
        current
          ? {
              ...current,
              name: editName.trim(),
              description: editDescription.trim() || null,
            }
          : current
      )
      setEditOpen(false)
      toast.success("Playlist updated")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to update playlist")
    } finally {
      setSavingEdit(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm("Delete this playlist?")) return

    try {
      const response = await fetch(`/api/playlists/${playlistId}`, { method: "DELETE" })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(data?.error || "Failed to delete playlist")
      }

      toast.success("Playlist deleted")
      window.location.href = "/playlists"
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete playlist")
    }
  }

  const removeTrackFromLocalState = (trackId: string | number) => {
    setTracks((current) => current.filter((track) => String(track.id) !== String(trackId)))
    setPlaylist((current) =>
      current
        ? { ...current, track_count: Math.max(0, current.track_count - 1) }
        : current
    )
  }

  if (loading) {
    return (
      <main className="flex-1 overflow-y-auto">
        <div className="p-4 md:p-8">
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </main>
    )
  }

  if (!playlist) {
    return (
      <main className="flex-1 overflow-y-auto">
        <div className="p-4 md:p-8">
          <p className="text-muted-foreground">Playlist not found</p>
        </div>
      </main>
    )
  }

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="p-4 md:p-8">
        <div className="mb-8 flex items-start justify-between gap-4">
          <div>
            <h1 className="mb-2 text-3xl font-bold">{playlist.name}</h1>
            {playlist.description && (
              <p className="text-muted-foreground">{playlist.description}</p>
            )}
            <p className="mt-2 text-sm text-muted-foreground">{playlist.track_count} songs</p>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={openEditDialog}
              className="gap-2"
            >
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              className="gap-2"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          </div>
        </div>

        {tracks.length === 0 ? (
          <p className="py-12 text-center text-muted-foreground">No tracks in this playlist</p>
        ) : (
          <TrackList
            tracks={tracks}
            playlistId={playlistId}
            onPlaylistTrackRemoved={removeTrackFromLocalState}
            onTrackDeleted={removeTrackFromLocalState}
          />
        )}
      </div>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Playlist</DialogTitle>
            <DialogDescription>Update the playlist name and description.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="playlist-name">Name</Label>
              <Input
                id="playlist-name"
                value={editName}
                onChange={(event) => setEditName(event.target.value)}
                onKeyDown={(event) => event.key === "Enter" && handleSavePlaylist()}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="playlist-description">Description</Label>
              <Input
                id="playlist-description"
                value={editDescription}
                onChange={(event) => setEditDescription(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSavePlaylist} disabled={savingEdit || !editName.trim()}>
              {savingEdit ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  )
}
