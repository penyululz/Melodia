"use client"

import { usePlayerStore } from "@/stores/player-store"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ListMusic, X, Music } from "lucide-react"
import Image from "next/image"
import { cn } from "@/lib/utils"

export function QueueButton() {
  const { queue, queueIndex, currentTrack, removeFromQueue, playTrack } =
    usePlayerStore()

  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="hidden h-9 w-9 sm:flex">
          <ListMusic className="h-5 w-5" />
        </Button>
      </SheetTrigger>
      <SheetContent className="w-80 p-0">
        <SheetHeader className="border-b p-4">
          <SheetTitle>Queue</SheetTitle>
        </SheetHeader>
        <ScrollArea className="h-[calc(100vh-5rem)]">
          {queue.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ListMusic className="mb-4 h-12 w-12 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Queue is empty</p>
            </div>
          ) : (
            <div className="p-2">
              {queue.map((track, index) => (
                <div
                  key={`${track.id}-${index}`}
                  className={cn(
                    "group flex items-center gap-3 rounded-md p-2 hover:bg-accent",
                    index === queueIndex && "bg-accent"
                  )}
                >
                  <button
                    onClick={() => playTrack(track, queue)}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <div className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded bg-muted">
                      {track.cover_art_path ? (
                        <Image
                          src={track.cover_art_path}
                          alt={track.album || "Album"}
                          fill
                          className="object-cover"
                        />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <Music className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                      <p
                        className={cn(
                          "truncate text-sm",
                          index === queueIndex && "font-medium text-primary"
                        )}
                      >
                        {track.title}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {track.artist || "Unknown Artist"}
                      </p>
                    </div>
                  </button>
                  {index !== queueIndex && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeFromQueue(index)}
                      className="h-7 w-7 opacity-0 group-hover:opacity-100"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
