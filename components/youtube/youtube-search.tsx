"use client"

import { useState } from "react"
import useSWR from "swr"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Search, Loader2 } from "lucide-react"
import { YouTubeTrackList } from "./youtube-track-list"

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function YouTubeSearch() {
  const [query, setQuery] = useState("")
  const [searchQuery, setSearchQuery] = useState("")

  const { data, isLoading, error } = useSWR(
    searchQuery ? `/api/youtube/search?q=${encodeURIComponent(searchQuery)}` : null,
    fetcher
  )

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (query.trim()) {
      setSearchQuery(query.trim())
    }
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search YouTube Music..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button type="submit" disabled={isLoading || !query.trim()}>
          {isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Search"
          )}
        </Button>
      </form>

      {error && (
        <p className="text-sm text-destructive">Failed to search. Please try again.</p>
      )}

      {data?.results && data.results.length > 0 && (
        <div>
          <h3 className="mb-4 text-lg font-semibold">Search Results</h3>
          <YouTubeTrackList tracks={data.results} />
        </div>
      )}

      {searchQuery && data?.results?.length === 0 && (
        <p className="text-center text-muted-foreground">
          No results found for &quot;{searchQuery}&quot;
        </p>
      )}
    </div>
  )
}
