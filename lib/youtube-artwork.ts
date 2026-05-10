import "server-only"

import { saveRemoteImageAsWebp } from "@/lib/metadata"

const YOUTUBE_VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/

export function getReliableYouTubeThumbnailUrl(videoId: string): string | null {
  if (!YOUTUBE_VIDEO_ID_RE.test(videoId)) return null
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
}

export function getYouTubeThumbnailCandidates(
  videoId: string,
  urls: Array<string | null | undefined>
): string[] {
  const seen = new Set<string>()
  const candidates: string[] = []

  const add = (url: string | null | undefined) => {
    const trimmed = url?.trim()
    if (!trimmed || seen.has(trimmed)) return
    seen.add(trimmed)
    candidates.push(trimmed)
  }

  for (const url of urls) add(url)

  if (YOUTUBE_VIDEO_ID_RE.test(videoId)) {
    add(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`)
    add(`https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`)
    add(`https://i.ytimg.com/vi/${videoId}/default.jpg`)
    add(`https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`)
  }

  return candidates
}

export async function saveBestYouTubeThumbnailAsWebp(
  videoId: string,
  urls: Array<string | null | undefined>,
  key = `youtube-${videoId}`
): Promise<string | null> {
  for (const candidate of getYouTubeThumbnailCandidates(videoId, urls)) {
    const saved = await saveRemoteImageAsWebp(candidate, key).catch(() => null)
    if (saved) return saved
  }

  return getReliableYouTubeThumbnailUrl(videoId)
}
