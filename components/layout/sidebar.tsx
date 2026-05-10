"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useSidebarStore } from "@/stores/sidebar-store"
import {
  Home,
  Library,
  Disc3,
  Users,
  Mic2,
  Heart,
  ListMusic,
  Upload,
  Settings,
  Music,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"

const navigation = [
  { name: "Home", href: "/", icon: Home },
  { name: "Library", href: "/library", icon: Library },
  { name: "Albums", href: "/albums", icon: Disc3 },
  { name: "Artists", href: "/artists", icon: Users },
  { name: "Genres", href: "/genres", icon: Mic2 },
]

const library = [
  { name: "Favorites", href: "/favorites", icon: Heart },
  { name: "Playlists", href: "/playlists", icon: ListMusic },
]

const manage = [
  { name: "Upload", href: "/upload", icon: Upload },
  { name: "Settings", href: "/settings", icon: Settings },
]

interface NavItemProps {
  name: string
  href: string
  icon: React.ElementType
  isActive: boolean
  isCollapsed: boolean
}

function NavItem({ name, href, icon: Icon, isActive, isCollapsed }: NavItemProps) {
  const btn = (
    <Button
      variant="ghost"
      asChild
      className={cn(
        "w-full gap-3 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all",
        isActive && "bg-sidebar-accent text-sidebar-foreground font-medium",
        isCollapsed ? "justify-center px-0" : "justify-start"
      )}
    >
      <Link href={href}>
        <Icon className="h-5 w-5 flex-shrink-0" />
        {!isCollapsed && <span>{name}</span>}
      </Link>
    </Button>
  )

  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{btn}</TooltipTrigger>
        <TooltipContent side="right">{name}</TooltipContent>
      </Tooltip>
    )
  }

  return btn
}

export function Sidebar() {
  const pathname = usePathname()
  const { isCollapsed, toggleCollapsed } = useSidebarStore()

  const groups = [
    { label: "Browse", items: navigation },
    { label: "Your Library", items: library },
    { label: "Manage", items: manage },
  ]

  return (
    <TooltipProvider delayDuration={0}>
      <aside
        className={cn(
          "fixed left-0 top-0 z-40 hidden h-screen flex-col border-r border-border bg-sidebar transition-all duration-300 lg:flex",
          isCollapsed ? "w-16" : "w-64"
        )}
      >
        {/* Header */}
        <div className="flex h-16 items-center justify-between border-b border-sidebar-border px-3">
          {!isCollapsed && (
            <div className="flex items-center gap-2">
              <Music className="h-6 w-6 flex-shrink-0 text-primary" />
              <span className="text-base font-bold text-sidebar-foreground">Melodia</span>
            </div>
          )}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleCollapsed}
            className={cn(
              "h-8 w-8 flex-shrink-0 text-sidebar-foreground/50 hover:text-sidebar-foreground",
              isCollapsed && "mx-auto"
            )}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </Button>
        </div>

        <ScrollArea className="flex-1 py-4">
          <nav className={cn("space-y-6", isCollapsed ? "px-1" : "px-3")}>
            {groups.map(({ label, items }) => (
              <div key={label}>
                {!isCollapsed && (
                  <h3 className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50">
                    {label}
                  </h3>
                )}
                <div className="space-y-1">
                  {items.map((item) => (
                    <NavItem
                      key={item.name}
                      name={item.name}
                      href={item.href}
                      icon={item.icon}
                      isActive={pathname === item.href}
                      isCollapsed={isCollapsed}
                    />
                  ))}
                </div>
              </div>
            ))}
          </nav>
        </ScrollArea>
      </aside>
    </TooltipProvider>
  )
}
