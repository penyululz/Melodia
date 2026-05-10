"use client"

import useSWR from "swr"
import type { Track } from "@/stores/player-store"
import { addTrackToPlaylist, getPlaylistTrackPayload, type PlaylistSummary } from "@/lib/playlist-client"
import {
  DropdownMenuItem,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu"
import { ListPlus } from "lucide-react"
import { toast } from "sonner"

const fetcher = (url: string) => fetch(url).then((res) => res.json())

interface AddToPlaylistSubmenuProps {
  track: Track
  onAdded?: (playlist: PlaylistSummary) => void
}

export function AddToPlaylistSubmenu({ track, onAdded }: AddToPlaylistSubmenuProps) {
  const { data: playlists = [] } = useSWR<PlaylistSummary[]>("/api/playlists", fetcher)
  const availablePlaylists = playlists.filter((playlist) =>
    Number.isInteger(Number(playlist.id))
  )
  const canAddTrack = Boolean(getPlaylistTrackPayload(track))

  const handleAdd = async (playlist: PlaylistSummary) => {
    try {
      const data = await addTrackToPlaylist(track, playlist)
      if (data) onAdded?.(playlist)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add track")
    }
  }

  return (
    <>
      <DropdownMenuLabel className="flex items-center gap-2 text-muted-foreground">
        <ListPlus className="h-4 w-4" />
        Add to Playlist
      </DropdownMenuLabel>
      {!canAddTrack ? (
        <DropdownMenuItem disabled>Unavailable for this track</DropdownMenuItem>
      ) : availablePlaylists.length === 0 ? (
        <DropdownMenuItem disabled>No playlists</DropdownMenuItem>
      ) : (
        availablePlaylists.map((playlist) => (
          <DropdownMenuItem
            key={playlist.id}
            onSelect={() => void handleAdd(playlist)}
          >
            {playlist.name}
          </DropdownMenuItem>
        ))
      )}
    </>
  )
}
