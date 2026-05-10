"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Download, Loader2 } from "lucide-react"
import { toast } from "sonner"
import { mutate } from "swr"

interface ImportYouTubePlaylistModalProps {
  onImported?: () => void
}

export function ImportYouTubePlaylistModal({ onImported }: ImportYouTubePlaylistModalProps) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState("")
  const [loading, setLoading] = useState(false)

  const handleImport = async () => {
    const playlistUrl = url.trim()
    if (!playlistUrl) return

    setLoading(true)
    try {
      const response = await fetch("/api/youtube/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: playlistUrl }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(data?.error || "Failed to import YouTube playlist")
      }

      toast.success(
        data?.importedTracks
          ? `Imported ${data.importedTracks} songs to your library`
          : "YouTube playlist imported"
      )
      mutate("/api/tracks")
      mutate("/api/youtube/tracks")
      mutate("/api/playlists")
      mutate("/api/albums")
      mutate("/api/artists")
      mutate("/api/genres")
      setUrl("")
      setOpen(false)
      onImported?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to import YouTube playlist")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2">
          <Download className="h-4 w-4" />
          Import YouTube
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import YouTube Playlist</DialogTitle>
          <DialogDescription>
            Paste a YouTube or YouTube Music playlist link to create a normal Melodia playlist.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Playlist Link</label>
            <Input
              type="url"
              placeholder="https://music.youtube.com/playlist?list=..."
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && handleImport()}
            />
          </div>
          <Button onClick={handleImport} disabled={!url.trim() || loading} className="w-full">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Importing...
              </>
            ) : (
              "Import Playlist"
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
