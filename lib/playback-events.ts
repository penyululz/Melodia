"use client"

import { usePlayerStore } from "@/stores/player-store"

const SEEK_EVENT = "melodia:seek"
const MEDIA_ENGINE_ACTIVE_EVENT = "melodia:media-engine-active"

export type MediaEngine = "audio" | "video"

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

export function notifyMediaEngineActive(engine: MediaEngine, time: number) {
  window.dispatchEvent(
    new CustomEvent(MEDIA_ENGINE_ACTIVE_EVENT, {
      detail: { engine, time: Math.max(0, Number.isFinite(time) ? time : 0) },
    })
  )
}

export function listenForMediaEngineActive(
  handler: (event: { engine: MediaEngine; time: number }) => void
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ engine?: MediaEngine; time?: number }>).detail
    if (detail?.engine !== "audio" && detail?.engine !== "video") return
    const time = Number(detail.time)
    handler({ engine: detail.engine, time: Number.isFinite(time) ? Math.max(0, time) : 0 })
  }

  window.addEventListener(MEDIA_ENGINE_ACTIVE_EVENT, listener)
  return () => window.removeEventListener(MEDIA_ENGINE_ACTIVE_EVENT, listener)
}
