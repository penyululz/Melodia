"use client"

import { useRef } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { MixCard } from "@/components/home/mix-card"
import type { Track } from "@/stores/player-store"

interface MixCardCarouselItem {
  key: string
  title: string
  description: string
  tracks: Track[]
  gradient: string
  icon: React.ReactNode
}

interface MixCardCarouselProps {
  title: string
  items: MixCardCarouselItem[]
}

export function MixCardCarousel({ title, items }: MixCardCarouselProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const scroll = (dir: "left" | "right") => {
    if (!scrollRef.current) return
    scrollRef.current.scrollBy({ left: dir === "right" ? 280 : -280, behavior: "smooth" })
  }

  if (items.length === 0) return null

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => scroll("left")}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={() => scroll("right")}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 scrollbar-hide md:-mx-6 md:px-6 lg:mx-0 lg:px-0"
        style={{ scrollSnapType: "x mandatory" }}
      >
        {items.map((item) => (
          <div
            key={item.key}
            className="basis-[min(72vw,220px)] flex-shrink-0 flex-grow-0 sm:basis-56 md:basis-60 lg:basis-[calc((100%_-_36px)/4)]"
            style={{ scrollSnapAlign: "start" }}
          >
            <MixCard
              title={item.title}
              description={item.description}
              tracks={item.tracks}
              gradient={item.gradient}
              icon={item.icon}
            />
          </div>
        ))}
      </div>
    </section>
  )
}
