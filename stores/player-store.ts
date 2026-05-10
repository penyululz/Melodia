"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"
import { useSettingsStore } from "@/stores/settings-store"

export interface Track {
  id: number | string
  source?: "local" | "youtube"
  videoId?: string
  title: string
  artist: string | null
  album: string | null
  duration: number | null
  cover_art_path: string | null
  file_path?: string
  file_format?: string | null
  content_type?: "music" | "podcast" | string | null
  podcast_title?: string | null
  podcast_author?: string | null
  podcast_episode_number?: number | null
  podcast_season_number?: number | null
  podcast_description?: string | null
  podcast_published_at?: string | null
  loudness_adjust_db?: number | null
  replaygain_track_gain?: number | null
  replaygain_album_gain?: number | null
}

export type RepeatMode = "off" | "all" | "one"

interface PlayerState {
  // Current track
  currentTrack: Track | null
  isPlaying: boolean
  currentTime: number
  duration: number
  volume: number
  isMuted: boolean
  isExpandedPlayerOpen: boolean

  // Queue
  queue: Track[]
  queueIndex: number
  originalQueue: Track[] // For shuffle restore

  // Modes
  shuffle: boolean
  repeat: RepeatMode

  // Actions
  setTrack: (track: Track) => void
  playTrack: (track: Track, queue?: Track[]) => void
  setIsPlaying: (isPlaying: boolean) => void
  togglePlay: () => void
  setCurrentTime: (time: number) => void
  setDuration: (duration: number) => void
  setVolume: (volume: number) => void
  toggleMute: () => void
  setExpandedPlayerOpen: (open: boolean) => void

  // Queue actions
  setQueue: (tracks: Track[], startIndex?: number) => void
  addToQueue: (track: Track) => void
  removeFromQueue: (index: number) => void
  clearQueue: () => void
  playNext: () => void
  playPrevious: () => void

  // Mode actions
  toggleShuffle: () => void
  cycleRepeat: () => void

  // YouTube actions
  playYTTrack: (track: Track, queue?: Track[]) => void
  addYTToQueue: (track: Track) => void
}

// Fisher-Yates shuffle
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

function recordTrackTransition(state: Pick<PlayerState, "currentTrack" | "currentTime" | "duration">) {
  const { currentTrack, currentTime, duration } = state
  if (!currentTrack || currentTime < 3) return
  if (useSettingsStore.getState().pauseWatchHistory) return

  const progressPct = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0
  const completed = progressPct >= 80
  const trackId = currentTrack.source === "youtube" ? null : Number(currentTrack.id)
  const ytVideoId = currentTrack.source === "youtube" ? currentTrack.videoId : null

  if (!ytVideoId && (!Number.isInteger(trackId) || !trackId)) return

  fetch("/api/history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      trackId: Number.isInteger(trackId) && trackId ? trackId : null,
      ytVideoId,
      source: currentTrack.source === "youtube" ? "youtube" : "local",
      eventType: completed ? "complete" : "skip",
      completed,
      progressPct,
    }),
  }).catch(() => {})
}

function getInitialDuration(track: Pick<Track, "duration"> | null): number {
  const duration = Number(track?.duration)
  return Number.isFinite(duration) && duration > 0 ? duration : 0
}

function getSafeTime(time: number): number {
  return Number.isFinite(time) && time > 0 ? time : 0
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      currentTrack: null,
      isPlaying: false,
      currentTime: 0,
      duration: 0,
      volume: 0.8,
      isMuted: false,
      isExpandedPlayerOpen: false,
      queue: [],
      queueIndex: 0,
      originalQueue: [],
      shuffle: false,
      repeat: "off",

      setTrack: (track) => set({ currentTrack: track }),

      playTrack: (track, queue) => {
        const state = get()
        if (queue) {
          const index = queue.findIndex((t) => t.id === track.id)
          set({
            currentTrack: track,
            queue: state.shuffle ? shuffleArray(queue) : queue,
            originalQueue: queue,
            queueIndex: index >= 0 ? index : 0,
            isPlaying: true,
            currentTime: 0,
            duration: getInitialDuration(track),
          })
        } else {
          set({
            currentTrack: track,
            isPlaying: true,
            currentTime: 0,
            duration: getInitialDuration(track),
          })
        }
      },

      setIsPlaying: (isPlaying) => set({ isPlaying }),

      togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),

      setCurrentTime: (time) => set({ currentTime: getSafeTime(time) }),

      setDuration: (duration) => set({ duration: getInitialDuration({ duration }) }),

      setVolume: (volume) => set({ volume, isMuted: false }),

      toggleMute: () => set((state) => ({ isMuted: !state.isMuted })),

      setExpandedPlayerOpen: (isExpandedPlayerOpen) => set({ isExpandedPlayerOpen }),

      setQueue: (tracks, startIndex = 0) => {
        const state = get()
        const queue = state.shuffle ? shuffleArray(tracks) : tracks
        set({
          queue,
          originalQueue: tracks,
          queueIndex: startIndex,
          currentTrack: queue[startIndex] || null,
          currentTime: 0,
          duration: getInitialDuration(queue[startIndex] || null),
        })
      },

      addToQueue: (track) =>
        set((state) => ({
          queue: [...state.queue, track],
          originalQueue: [...state.originalQueue, track],
        })),

      removeFromQueue: (index) =>
        set((state) => {
          const newQueue = state.queue.filter((_, i) => i !== index)
          let newIndex = state.queueIndex
          if (index < state.queueIndex) {
            newIndex--
          } else if (index === state.queueIndex) {
            newIndex = Math.min(newIndex, newQueue.length - 1)
          }
          return {
            queue: newQueue,
            queueIndex: Math.max(0, newIndex),
          }
        }),

      clearQueue: () =>
        set({
          queue: [],
          originalQueue: [],
          queueIndex: 0,
        }),

      playNext: () => {
        const state = get()
        if (state.queue.length === 0) return
        recordTrackTransition(state)

        let nextIndex: number

        if (state.repeat === "one") {
          // Repeat the same track
          set({ currentTime: 0, duration: getInitialDuration(state.currentTrack), isPlaying: true })
          return
        }

        if (state.queueIndex < state.queue.length - 1) {
          nextIndex = state.queueIndex + 1
        } else if (state.repeat === "all") {
          nextIndex = 0
        } else {
          // End of queue, stop playing
          set({ isPlaying: false })
          return
        }

        set({
          queueIndex: nextIndex,
          currentTrack: state.queue[nextIndex],
          currentTime: 0,
          duration: getInitialDuration(state.queue[nextIndex]),
          isPlaying: true,
        })
      },

      playPrevious: () => {
        const state = get()
        if (state.queue.length === 0) return

        // If more than 3 seconds in, restart current track
        if (state.currentTime > 3) {
          recordTrackTransition(state)
          set({ currentTime: 0, duration: getInitialDuration(state.currentTrack) })
          return
        }

        let prevIndex: number
        if (state.queueIndex > 0) {
          prevIndex = state.queueIndex - 1
        } else if (state.repeat === "all") {
          prevIndex = state.queue.length - 1
        } else {
          prevIndex = 0
        }

        set({
          queueIndex: prevIndex,
          currentTrack: state.queue[prevIndex],
          currentTime: 0,
          duration: getInitialDuration(state.queue[prevIndex]),
          isPlaying: true,
        })
      },

      toggleShuffle: () =>
        set((state) => {
          if (state.shuffle) {
            // Turn off shuffle - restore original order
            const currentTrack = state.currentTrack
            const newIndex = state.originalQueue.findIndex(
              (t) => t.id === currentTrack?.id
            )
            return {
              shuffle: false,
              queue: state.originalQueue,
              queueIndex: newIndex >= 0 ? newIndex : 0,
            }
          } else {
            // Turn on shuffle
            const currentTrack = state.currentTrack
            const otherTracks = state.queue.filter(
              (t) => t.id !== currentTrack?.id
            )
            const shuffled = currentTrack
              ? [currentTrack, ...shuffleArray(otherTracks)]
              : shuffleArray(state.queue)
            return {
              shuffle: true,
              queue: shuffled,
              queueIndex: 0,
            }
          }
        }),

      cycleRepeat: () =>
        set((state) => {
          const modes: RepeatMode[] = ["off", "all", "one"]
          const currentIndex = modes.indexOf(state.repeat)
          const nextIndex = (currentIndex + 1) % modes.length
          return { repeat: modes[nextIndex] }
        }),

      // YouTube-specific actions
      playYTTrack: (track, queue) => {
        const state = get()
        const ytTrack = { ...track, source: "youtube" as const }
        if (queue) {
          const ytQueue = queue.map(t => ({ ...t, source: "youtube" as const }))
          const index = ytQueue.findIndex((t) => t.videoId === track.videoId)
          set({
            currentTrack: ytTrack,
            queue: state.shuffle ? shuffleArray(ytQueue) : ytQueue,
            originalQueue: ytQueue,
            queueIndex: index >= 0 ? index : 0,
            isPlaying: true,
            currentTime: 0,
            duration: getInitialDuration(ytTrack),
          })
        } else {
          set({
            currentTrack: ytTrack,
            isPlaying: true,
            currentTime: 0,
            duration: getInitialDuration(ytTrack),
          })
        }
      },

      addYTToQueue: (track) =>
        set((state) => {
          const ytTrack = { ...track, source: "youtube" as const }
          return {
            queue: [...state.queue, ytTrack],
            originalQueue: [...state.originalQueue, ytTrack],
          }
        }),
    }),
    {
      name: "music-player-storage",
      partialize: (state) => ({
        volume: state.volume,
        shuffle: state.shuffle,
        repeat: state.repeat,
      }),
    }
  )
)
