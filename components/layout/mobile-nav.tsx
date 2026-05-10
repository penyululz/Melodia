"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Home, Library, Heart, ListMusic, Settings } from "lucide-react"

const navigation = [
  { name: "Home", href: "/", icon: Home },
  { name: "Library", href: "/library", icon: Library },
  { name: "Playlists", href: "/playlists", icon: ListMusic },
  { name: "Favorites", href: "/favorites", icon: Heart },
  { name: "Settings", href: "/settings", icon: Settings },
]

export function MobileNav() {
  const pathname = usePathname()

  return (
    // Always at the very bottom on mobile/tablet; hidden on lg+
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-background/95 backdrop-blur-lg pb-safe lg:hidden">
      <div className="flex h-16 items-center justify-around px-2 px-safe">
        {navigation.map((item) => (
          <Link
            key={item.name}
            href={item.href}
            className={cn(
              "flex flex-col items-center gap-1 px-3 py-2 text-muted-foreground transition-colors",
              pathname === item.href && "text-primary"
            )}
          >
            <item.icon className="h-5 w-5" />
            <span className="text-[10px] font-medium">{item.name}</span>
          </Link>
        ))}
      </div>
    </nav>
  )
}
