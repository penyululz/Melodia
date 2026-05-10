import "server-only"

import {
  canSpendRequestBudget,
  getCachedJson,
  makeCacheKey,
  setCachedJson,
  spendQuota,
} from "@/lib/api-cache"
import { saveRemoteImageAsWebp } from "@/lib/metadata"

type ArtistProfileCache = {
  imageUrl: string | null
  localPath?: string | null
}

export async function getArtistProfileImage(artistName: string | null | undefined): Promise<string | null> {
  const artist = artistName?.trim()
  if (!artist || /^unknown artist$/i.test(artist)) return null
  if (process.env.THEAUDIODB_ENABLED === "0") return null

  const cacheKey = makeCacheKey("theaudiodb-artist-profile", [artist.toLowerCase()])
  const cached = getCachedJson<ArtistProfileCache>(cacheKey)
  if (cached?.localPath) return cached.localPath
  if (cached && !cached.imageUrl) return null

  if (cached?.imageUrl) {
    const localPath = await saveRemoteImageAsWebp(cached.imageUrl, `artist-profile-${artist}`)
    if (localPath) {
      setCachedJson(cacheKey, { ...cached, localPath }, getArtistProfileCacheTtlSeconds())
      return localPath
    }
  }

  const provider = "theaudiodb"
  const dailyBudget = parseEnvInt(process.env.THEAUDIODB_DAILY_REQUEST_BUDGET, 200)
  const perMinuteBudget = parseEnvInt(process.env.THEAUDIODB_REQUESTS_PER_MINUTE, 20)
  if (!canSpendRequestBudget(provider, 1, dailyBudget, perMinuteBudget)) return null

  const imageUrl = await fetchTheAudioDbArtistImage(artist).catch(() => null)
  spendQuota(provider, 1)

  const localPath = await saveRemoteImageAsWebp(imageUrl, `artist-profile-${artist}`)
  setCachedJson(cacheKey, { imageUrl, localPath }, getArtistProfileCacheTtlSeconds())
  return localPath
}

async function fetchTheAudioDbArtistImage(artist: string): Promise<string | null> {
  const apiKey = process.env.THEAUDIODB_API_KEY || "123"
  const url = new URL(`https://www.theaudiodb.com/api/v1/json/${apiKey}/search.php`)
  url.searchParams.set("s", artist)

  const response = await fetch(url, {
    headers: {
      "User-Agent": process.env.THEAUDIODB_USER_AGENT || "Melodia/0.1 (self-hosted music player)",
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(3500),
  })
  if (!response.ok) return null

  const data = await response.json()
  const profile = Array.isArray(data?.artists) ? data.artists[0] : null
  return preferMediumTheAudioDbImage(
    profile?.strArtistThumb ||
      profile?.strArtistFanart ||
      profile?.strArtistFanart2 ||
      profile?.strArtistFanart3 ||
      null
  )
}

function getArtistProfileCacheTtlSeconds(): number {
  const days = Number.parseInt(process.env.ARTIST_PROFILE_CACHE_TTL_DAYS || "30", 10)
  return Math.max(1, Number.isFinite(days) ? days : 30) * 86_400
}

function parseEnvInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function preferMediumTheAudioDbImage(imageUrl: string | null): string | null {
  if (!imageUrl) return null
  if (/\/(?:thumb|preview|medium|small)\//.test(imageUrl)) return imageUrl
  return `${imageUrl}/medium`
}
