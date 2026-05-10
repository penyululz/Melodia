"use client"

import { useState, useRef } from "react"
import { Input } from "@/components/ui/input"
import { Search } from "lucide-react"
import { UserMenu } from "@/components/auth/user-menu"
import { SearchDropdown } from "@/components/search/search-dropdown"
import { OfflineIndicator } from "@/components/offline/offline-indicator"

export function Header() {
  const [search, setSearch] = useState("")
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    // Keep search in dropdown only, no navigation
  }

  const handleFocus = () => {
    if (search.length >= 2) {
      setIsDropdownOpen(true)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearch(value)
    setIsDropdownOpen(value.length >= 2)
  }

  return (
    <header className="sticky top-0 z-30 flex min-h-[calc(3.5rem+env(safe-area-inset-top,0px))] items-center gap-2 border-b border-border bg-background/95 px-4 pt-safe backdrop-blur supports-[backdrop-filter]:bg-background/60 lg:min-h-[calc(4rem+env(safe-area-inset-top,0px))] lg:gap-4 lg:px-6">
      {/* Search bar with dropdown */}
      <form onSubmit={handleSearch} className="relative flex flex-1 items-center min-w-0">
        <div className="relative w-full max-w-sm lg:max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            ref={inputRef}
            type="search"
            placeholder="Search songs, artists, online..."
            value={search}
            onChange={handleChange}
            onFocus={handleFocus}
            className="h-8 pl-10 pr-2 text-sm lg:h-9"
            autoComplete="off"
          />
          
          {/* Search dropdown */}
          <SearchDropdown
            query={search}
            isOpen={isDropdownOpen}
            onClose={() => setIsDropdownOpen(false)}
            onSelect={() => {
              setSearch("")
              inputRef.current?.blur()
            }}
          />
        </div>
      </form>

      <OfflineIndicator />
      <UserMenu />
    </header>
  )
}
