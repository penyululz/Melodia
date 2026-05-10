"use client"

import { Sidebar } from '@/components/layout/sidebar'
import { MobileNav } from '@/components/layout/mobile-nav'
import { Header } from '@/components/layout/header'
import { AudioEngine } from '@/components/player/audio-engine'
import { AudioPlayer } from '@/components/player/audio-player'
import { VideoPlayer } from '@/components/player/video-player'
import { PWAInstaller } from '@/components/pwa/pwa-installer'
import { useSidebarStore } from '@/stores/sidebar-store'
import { usePlayerStore } from '@/stores/player-store'
import { cn } from '@/lib/utils'

export function AppShell({ children }: { children: React.ReactNode }) {
  const { isCollapsed } = useSidebarStore()
  const { currentTrack } = usePlayerStore()
  const hasPlayer = !!currentTrack

  return (
    // Use dvh (dynamic viewport height) so the shell fills correctly in both
    // portrait and landscape on mobile when the browser chrome resizes
    <div className="relative flex h-[100dvh] overflow-hidden">
      {/* Sidebar — fixed, desktop only */}
      <Sidebar />

      {/* Everything to the right of the sidebar */}
      <div
        className={cn(
          "flex h-full w-full flex-col transition-[padding] duration-300",
          isCollapsed ? "lg:pl-16" : "lg:pl-64"
        )}
      >
        {/* Sticky top header */}
        <Header />

        {/* Page content — only this element scrolls, not the whole page */}
        <main
          className={cn(
            "flex-1 overflow-y-auto overscroll-contain",
            // Mobile/tablet: mobile nav (64px) + player bar (64px) = 128px
            // Desktop: player bar only (80px)
            hasPlayer ? "pb-32 lg:pb-20" : "pb-16 lg:pb-0"
          )}
        >
          {children}
        </main>
      </div>

      {/* Mobile bottom nav — fixed, mobile/tablet only */}
      <MobileNav />

      {/* Audio player bar — fixed at bottom */}
      <AudioEngine />
      <AudioPlayer />
      <VideoPlayer />
      <PWAInstaller />
    </div>
  )
}
