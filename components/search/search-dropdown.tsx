"use client"

import { useState, useEffect, useRef } from "react"
import Image from "next/image"
import { usePlayerStore, Track } from "@/stores/player-store"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Spinner } from "@/components/ui/spinner"
import { AddToPlaylistSubmenu } from "@/components/playlists/add-to-playlist-menu"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { MoreHorizontal, Play, ListPlus, Music, Youtube, Search, Plus } from "lucide-react"
import { mutate } from "swr"
import { toast } from "sonner"
import { useSettingsStore } from "@/stores/settings-store"

interface SearchResult {
  id: number | string
  videoId?: string
  title: string
  artist: string
  album?: string
  duration?: number
  cover_art_path?: string
  thumbnailUrl?: string
  type?: "song" | "video" | string
  content_type?: "music" | "podcast" | string | null
  podcast_title?: string | null
  podcast_author?: string | null
  source: "local" | "youtube"
}

interface SearchDropdownProps {
  query: string
  isOpen: boolean
  onClose: () => void
  onSelect?: () => void
}

type Filter = "all" | "local" | "youtube"

export function SearchDropdown({ query, isOpen, onClose, onSelect }: SearchDropdownProps) {
  const [localResults, setLocalResults] = useState<SearchResult[]>([])
  const [youtubeResults, setYoutubeResults] = useState<SearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>("all")
  const { playTrack, playYTTrack, addToQueue, addYTToQueue } = usePlayerStore()
  const { pauseSearchHistory, preferOfficialYouTubeApi, showPodcasts } = useSettingsStore()
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Click outside to close
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside)
    }
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [isOpen, onClose])

  // Debounced search
  useEffect(() => {
    if (!query.trim() || query.length < 2) {
      setLocalResults([])
      setYoutubeResults([])
      setFilter("all")
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(async () => {
      setIsLoading(true)
      try {
        // Fetch both in parallel
        const headers = {
          "x-melodia-pause-search-history": pauseSearchHistory ? "true" : "false",
          "x-melodia-use-official-youtube": preferOfficialYouTubeApi ? "true" : "false",
        }
        const [localRes, ytRes] = await Promise.all([
          fetch(`/api/tracks?search=${encodeURIComponent(query)}`, { headers, signal: controller.signal }),
          fetch(`/api/youtube/search?q=${encodeURIComponent(query)}&limit=6`, { headers, signal: controller.signal }),
        ])

        if (localRes.ok) {
          const data = await localRes.json()
          setLocalResults(
            (data.tracks || []).slice(0, 5).map((t: any) => ({
              ...t,
              source: "local" as const,
            }))
          )
        }

        if (ytRes.ok) {
          const data = await ytRes.json()
          setYoutubeResults(
            (data.results || []).map((r: any) => ({
              id: r.videoId,
              videoId: r.videoId,
              title: r.title,
              artist: r.artist,
              album: r.album,
              duration: r.duration,
              thumbnailUrl: r.thumbnailUrl,
              cover_art_path: r.thumbnailUrl,
              type: r.type,
              content_type: r.content_type || "music",
              podcast_title: r.podcast_title || null,
              podcast_author: r.podcast_author || null,
              source: "youtube" as const,
            }))
          )
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          console.error("[v0] Search error:", err)
        }
      } finally {
        setIsLoading(false)
      }
    }, 300)

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  }, [pauseSearchHistory, preferOfficialYouTubeApi, query])

  const handlePlay = (result: SearchResult) => {
    const track = toPlayerTrack(result)

    if (result.source === "youtube") {
      playYTTrack(track)
    } else {
      playTrack(track)
    }
    onSelect?.()
    onClose()
  }

  const handleAddToQueue = (result: SearchResult, e: React.MouseEvent) => {
    e.stopPropagation()
    const track = toPlayerTrack(result)

    if (result.source === "youtube") {
      addYTToQueue(track)
    } else {
      addToQueue(track)
    }
  }

  const handleSave = async (result: SearchResult, e: React.MouseEvent) => {
    e.stopPropagation()
    if (result.source !== "youtube" || !result.videoId) return

    try {
      const response = await fetch("/api/youtube/tracks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videoId: result.videoId,
          title: result.title,
          artist: result.artist,
          album: result.album,
          duration: result.duration,
          thumbnailUrl: result.thumbnailUrl || result.cover_art_path,
          contentType: result.content_type || "music",
          podcastTitle: result.podcast_title,
          podcastAuthor: result.podcast_author,
        }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        throw new Error(data?.error || "Failed to save song")
      }

      toast.success("Saved to library")
      mutate("/api/youtube/tracks")
      mutate("/api/tracks")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save song")
    }
  }

  const formatDuration = (seconds?: number) => {
    if (!seconds) return ""
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins}:${secs.toString().padStart(2, "0")}`
  }

  if (!isOpen || query.length < 2) return null

  const hasResults = localResults.length > 0 || youtubeResults.length > 0
  const showLocal = filter === "all" || filter === "local"
  const showYoutube = filter === "all" || filter === "youtube"
  const filteredLocal = showLocal ? localResults.filter((result) => showPodcasts || result.content_type !== "podcast") : []
  const filteredYoutube = showYoutube ? youtubeResults.filter((result) => showPodcasts || result.content_type !== "podcast") : []
  const hasFilteredResults = filteredLocal.length > 0 || filteredYoutube.length > 0

  const filters: { label: string; value: Filter; icon: React.ReactNode }[] = [
    { label: "All", value: "all", icon: <Search className="h-3 w-3" /> },
    { label: "Local", value: "local", icon: <Music className="h-3 w-3" /> },
    { label: "Online", value: "youtube", icon: <Youtube className="h-3 w-3" /> },
  ]

  return (
    <div
      ref={dropdownRef}
      className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-popover shadow-xl"
    >
      {/* Filter bar — always visible while dropdown is open */}
      <div className="sticky top-0 z-10 flex items-center gap-1.5 border-b border-border bg-popover px-3 py-2">
        {filters.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            className={cn(
              "flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors",
              filter === f.value
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
            )}
          >
            {f.icon}
            {f.label}
          </button>
        ))}
        {isLoading && <Spinner className="ml-auto h-4 w-4 flex-shrink-0" />}
      </div>

      {!isLoading && !hasFilteredResults && hasResults && (
        <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
          <Search className="h-8 w-8" />
          <p className="text-sm">No {filter} results for &quot;{query}&quot;</p>
        </div>
      )}

      {!isLoading && !hasResults && (
        <div className="flex flex-col items-center gap-2 py-8 text-muted-foreground">
          <Search className="h-8 w-8" />
          <p className="text-sm">No results for &quot;{query}&quot;</p>
        </div>
      )}

      {/* Local Results */}
      {filteredLocal.length > 0 && (
        <div>
          {filter === "all" && (
            <div className="flex items-center gap-2 bg-popover px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Music className="h-3.5 w-3.5" />
              Local Library
            </div>
          )}
          {filteredLocal.map((result) => (
            <SearchResultRow
              key={`local-${result.id}`}
              result={result}
              onPlay={() => handlePlay(result)}
              onAddToQueue={(e) => handleAddToQueue(result, e)}
              onSave={(e) => handleSave(result, e)}
              formatDuration={formatDuration}
            />
          ))}
        </div>
      )}

      {/* YouTube Results */}
      {filteredYoutube.length > 0 && (
        <div>
          {filter === "all" && (
            <div className="flex items-center gap-2 bg-popover px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <Youtube className="h-3.5 w-3.5" />
              Online Results
            </div>
          )}
          {filteredYoutube.map((result) => (
            <SearchResultRow
              key={`yt-${result.videoId}`}
              result={result}
              onPlay={() => handlePlay(result)}
              onAddToQueue={(e) => handleAddToQueue(result, e)}
              onSave={(e) => handleSave(result, e)}
              formatDuration={formatDuration}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function SearchResultRow({
  result,
  onPlay,
  onAddToQueue,
  onSave,
  formatDuration,
}: {
  result: SearchResult
  onPlay: () => void
  onAddToQueue: (e: React.MouseEvent) => void
  onSave: (e: React.MouseEvent) => void
  formatDuration: (s?: number) => string
}) {
  const thumbnail = result.cover_art_path || result.thumbnailUrl || "/placeholder.svg?height=48&width=48"
  const playlistTrack = toPlayerTrack(result)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPlay}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onPlay()
        }
      }}
      className="group flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-accent"
    >
      {/* Thumbnail */}
      <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded">
        <Image src={thumbnail} alt="" fill className="object-cover" />
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
          <Play className="h-4 w-4 fill-current text-white" />
        </div>
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{result.title}</p>
        <p className="truncate text-xs text-muted-foreground">{result.artist}</p>
      </div>

      {/* Duration */}
      {result.duration && (
        <span className="flex-shrink-0 text-xs text-muted-foreground">
          {formatDuration(result.duration)}
        </span>
      )}

      {/* Source badge */}
      <Badge
        variant="outline"
        className={cn(
          "flex-shrink-0 text-[10px]",
          result.source === "youtube" ? "border-red-500/50 text-red-500" : "border-primary/50 text-primary"
        )}
      >
        {result.source === "youtube" ? "YT" : "Local"}
      </Badge>

      {result.source === "youtube" && (
        <Button
          variant="ghost"
          size="icon"
          onClick={onSave}
          className="h-8 w-8 flex-shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
          title="Save to library"
        >
          <Plus className="h-4 w-4" />
        </Button>
      )}

      {/* Add to queue */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onAddToQueue}
        className="h-8 w-8 flex-shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
        title="Add to queue"
      >
        <ListPlus className="h-4 w-4" />
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            onClick={(event) => event.stopPropagation()}
            className="h-8 w-8 flex-shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100"
            title="More actions"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <AddToPlaylistSubmenu track={playlistTrack} />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function toPlayerTrack(result: SearchResult): Track {
  return {
    id: result.id,
    title: result.title,
    artist: result.artist,
    album: result.album || null,
    duration: result.duration || null,
    cover_art_path: result.cover_art_path || result.thumbnailUrl || null,
    source: result.source,
    videoId: result.videoId,
    media_type: result.type,
    content_type: result.content_type || "music",
    podcast_title: result.podcast_title || null,
    podcast_author: result.podcast_author || null,
    ...(result.thumbnailUrl ? { thumbnailUrl: result.thumbnailUrl } : {}),
  } as Track
}
