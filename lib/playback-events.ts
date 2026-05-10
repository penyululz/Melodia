"use client"

import { usePlayerStore } from "@/stores/player-store"

const SEEK_EVENT = "melodia:seek"

export function seekToPlayback(time: number) {
  const safeTime = Math.max(0, Number.isFinite(time) ? time : 0)
  usePlayerStore.getState().setCurrentTime(safeTime)
  window.dispatchEvent(new CustomEvent(SEEK_EVENT, { detail: { time: safeTime } }))
}

export function listenForPlaybackSeek(handler: (time: number) => void): () => void {
  const listener = (event: Event) => {
    const time = Number((event as CustomEvent<{ time?: number }>).detail?.time)
    if (Number.isFinite(time)) handler(Math.max(0, time))
  }

  window.addEventListener(SEEK_EVENT, listener)
  return () => window.removeEventListener(SEEK_EVENT, listener)
}
