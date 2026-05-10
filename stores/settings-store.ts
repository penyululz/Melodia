"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"

// Re-export content utils for client-side use
export { detectContentType, normalizeSongTitle, hasVideoContent } from "@/lib/content-utils"

export type PlaybackMode = "audio" | "video"
export type StreamingQuality = "low" | "normal" | "high"
export type DownloadQuality = "normal" | "high"

export interface EQBand {
  freq: number  // Hz label
  gain: number  // -12 to +12 dB
}

export const DEFAULT_EQ_BANDS: EQBand[] = [
  { freq: 60,   gain: 0 },
  { freq: 170,  gain: 0 },
  { freq: 310,  gain: 0 },
  { freq: 600,  gain: 0 },
  { freq: 1000, gain: 0 },
  { freq: 3000, gain: 0 },
  { freq: 6000, gain: 0 },
  { freq: 12000, gain: 0 },
  { freq: 14000, gain: 0 },
  { freq: 16000, gain: 0 },
]

export const EQ_PRESETS: Record<string, number[]> = {
  Flat:      [0,  0,  0,  0,  0,  0,  0,  0,  0,  0],
  Bass:      [6,  5,  3,  1,  0,  0,  0,  0,  0,  0],
  Treble:    [0,  0,  0,  0,  0,  2,  4,  6,  6,  5],
  Vocal:     [-2, -1,  0,  2,  4,  4,  3,  2,  0, -1],
  Pop:       [-1,  2,  3,  3,  2,  0, -1, -1, -1, -1],
  Rock:      [4,  3,  2,  0,  0, -1,  0,  2,  3,  4],
  Jazz:      [4,  3,  1,  2,  0, -2, -1,  0,  1,  2],
  Classical: [5,  4,  3,  2,  0,  0,  0, -2,  2,  3],
  Electronic:[4,  3,  0,  0, -2,  1,  0,  0,  3,  4],
}

interface SettingsState {
  // Playback settings
  playbackMode: PlaybackMode
  streamingQuality: StreamingQuality
  downloadQuality: DownloadQuality
  autoDownloadLibraryActions: boolean
  alwaysHighQuality: boolean
  dataSaver: boolean
  audioNormalization: boolean

  // Equalizer
  eqEnabled: boolean
  eqBands: EQBand[]

  // Content filters
  showMusicVideos: boolean
  showLivePerformances: boolean
  showCovers: boolean
  showRemixes: boolean
  showPodcasts: boolean

  // Duplicate handling
  preferOfficialAudio: boolean
  hideDuplicates: boolean

  // Privacy
  pauseWatchHistory: boolean
  pauseSearchHistory: boolean

  // Metadata and cloud API usage
  onlineArtworkLookup: boolean
  preferOfficialYouTubeApi: boolean

  // Actions
  setPlaybackMode: (mode: PlaybackMode) => void
  setStreamingQuality: (quality: StreamingQuality) => void
  setDownloadQuality: (quality: DownloadQuality) => void
  setAutoDownloadLibraryActions: (value: boolean) => void
  setAlwaysHighQuality: (value: boolean) => void
  setDataSaver: (value: boolean) => void
  setAudioNormalization: (value: boolean) => void
  setEqEnabled: (value: boolean) => void
  setEqBand: (index: number, gain: number) => void
  applyEqPreset: (preset: string) => void
  setShowMusicVideos: (value: boolean) => void
  setShowLivePerformances: (value: boolean) => void
  setShowCovers: (value: boolean) => void
  setShowRemixes: (value: boolean) => void
  setShowPodcasts: (value: boolean) => void
  setPreferOfficialAudio: (value: boolean) => void
  setHideDuplicates: (value: boolean) => void
  setPauseWatchHistory: (value: boolean) => void
  setPauseSearchHistory: (value: boolean) => void
  setOnlineArtworkLookup: (value: boolean) => void
  setPreferOfficialYouTubeApi: (value: boolean) => void

  // Helpers
  getBitrateForQuality: () => number
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      // Default settings
      playbackMode: "audio",
      streamingQuality: "high",
      downloadQuality: "high",
      autoDownloadLibraryActions: true,
      alwaysHighQuality: false,
      dataSaver: false,
      audioNormalization: true,
      eqEnabled: false,
      eqBands: DEFAULT_EQ_BANDS.map((b) => ({ ...b })),
      showMusicVideos: true,
      showLivePerformances: true,
      showCovers: true,
      showRemixes: true,
      showPodcasts: true,
      preferOfficialAudio: true,
      hideDuplicates: true,
      pauseWatchHistory: false,
      pauseSearchHistory: false,
      onlineArtworkLookup: false,
      preferOfficialYouTubeApi: false,

      // Setters
      setPlaybackMode: (mode) => set({ playbackMode: mode }),
      setStreamingQuality: (quality) => set({ streamingQuality: quality }),
      setDownloadQuality: (quality) => set({ downloadQuality: quality }),
      setAutoDownloadLibraryActions: (value) => set({ autoDownloadLibraryActions: value }),
      setAlwaysHighQuality: (value) => set({ alwaysHighQuality: value }),
      setDataSaver: (value) => set({
        dataSaver: value,
        ...(value ? { playbackMode: "audio", streamingQuality: "normal" } : {})
      }),
      setAudioNormalization: () => set({ audioNormalization: true }),
      setEqEnabled: (value) => set({ eqEnabled: value }),
      setEqBand: (index, gain) => set((state) => {
        const bands = state.eqBands.map((b, i) => i === index ? { ...b, gain } : b)
        return { eqBands: bands }
      }),
      applyEqPreset: (preset) => set((state) => {
        const gains = EQ_PRESETS[preset]
        if (!gains) return {}
        const bands = state.eqBands.map((b, i) => ({ ...b, gain: gains[i] ?? 0 }))
        return { eqBands: bands, eqEnabled: true }
      }),
      setShowMusicVideos: (value) => set({ showMusicVideos: value }),
      setShowLivePerformances: (value) => set({ showLivePerformances: value }),
      setShowCovers: (value) => set({ showCovers: value }),
      setShowRemixes: (value) => set({ showRemixes: value }),
      setShowPodcasts: (value) => set({ showPodcasts: value }),
      setPreferOfficialAudio: (value) => set({ preferOfficialAudio: value }),
      setHideDuplicates: (value) => set({ hideDuplicates: value }),
      setPauseWatchHistory: (value) => set({ pauseWatchHistory: value }),
      setPauseSearchHistory: (value) => set({ pauseSearchHistory: value }),
      setOnlineArtworkLookup: (value) => set({ onlineArtworkLookup: value }),
      setPreferOfficialYouTubeApi: (value) => set({ preferOfficialYouTubeApi: value }),

      // Get target bitrate based on quality setting
      getBitrateForQuality: () => {
        const state = get()
        if (state.alwaysHighQuality) return 256
        
        switch (state.streamingQuality) {
          case "low": return 48
          case "normal": return 128
          case "high": return 256
          default: return 128
        }
      },
    }),
    {
      name: "music-settings-storage",
    }
  )
)

// Quality labels for UI
export const QUALITY_LABELS: Record<StreamingQuality, { label: string; bitrate: string; description: string }> = {
  low: { label: "Low", bitrate: "48kbps", description: "Save data on poor connections" },
  normal: { label: "Normal", bitrate: "128kbps", description: "Balanced quality and data usage" },
  high: { label: "High", bitrate: "256kbps", description: "Best audio quality (Premium)" },
}

// Helper functions for track filtering

// Normalize song titles for duplicate detection (remove case, extra spaces, common suffixes)
function normalizeSongTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*(official audio|official video|music video|lyric video|live|remaster|remix|cover|feat\.|ft\.).*$/i, "")
    .trim()
}

// Detect content type from title keywords
function detectContentType(title: string): "official" | "video" | "live" | "cover" | "remix" | "podcast" {
  const lower = title.toLowerCase()
  
  if (/(^|[\s._-])(podcast|episode|interview|spoken word)([\s._-]|$)/.test(lower)) return "podcast"
  if (lower.includes("live") && (lower.includes("performance") || lower.includes("concert"))) return "live"
  if (lower.includes("cover")) return "cover"
  if (lower.includes("remix")) return "remix"
  if (lower.includes("music video") || lower.includes("official video")) return "video"
  
  return "official"
}

// Group tracks by normalized title (for duplicate detection)
export function groupDuplicates<T extends { title: string; videoId: string }>(
  tracks: T[]
): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  
  for (const track of tracks) {
    const normalized = normalizeSongTitle(track.title)
    const existing = groups.get(normalized) || []
    existing.push(track)
    groups.set(normalized, existing)
  }
  
  return groups
}

// Filter and deduplicate tracks based on settings
export function filterTracks<T extends { title: string; videoId: string }>(
  tracks: T[],
  settings: Pick<SettingsState, "showMusicVideos" | "showLivePerformances" | "showCovers" | "showRemixes" | "showPodcasts" | "preferOfficialAudio" | "hideDuplicates">
): T[] {
  let filtered = tracks.filter((track) => {
    const explicitType = (track as T & { content_type?: string | null; type?: string | null }).content_type
    const type = explicitType === "podcast" ? "podcast" : detectContentType(track.title)
    
    if (type === "video" && !settings.showMusicVideos) return false
    if (type === "live" && !settings.showLivePerformances) return false
    if (type === "cover" && !settings.showCovers) return false
    if (type === "remix" && !settings.showRemixes) return false
    if (type === "podcast" && !settings.showPodcasts) return false
    
    return true
  })
  
  if (settings.hideDuplicates) {
    const groups = groupDuplicates(filtered)
    filtered = []
    
    for (const group of groups.values()) {
      if (group.length === 1) {
        filtered.push(group[0])
      } else {
        // Pick the best version based on preferences
        const sorted = group.sort((a, b) => {
          const typeA = detectContentType(a.title)
          const typeB = detectContentType(b.title)
          
          if (settings.preferOfficialAudio) {
            if (typeA === "official" && typeB !== "official") return -1
            if (typeB === "official" && typeA !== "official") return 1
          }
          
          // Prefer shorter titles (usually cleaner versions)
          return a.title.length - b.title.length
        })
        
        filtered.push(sorted[0])
      }
    }
  }
  
  return filtered
}
