import { NextRequest, NextResponse } from "next/server"
import db, { type Track, type YTTrack } from "@/lib/db"
import { getSessionOrDemo, isDemoSessionEnabled } from "@/lib/auth-policy"
import { getDemoMixes } from "@/lib/demo-data"
import {
  buildTasteProfile,
  isDislikedLocal,
  isDislikedYouTube,
  scoreLocalTrack,
  scoreYouTubeTrack,
} from "@/lib/recommendation-engine"
import { searchYTMusic, type YTSearchResult } from "@/lib/youtube-music"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionOrDemo(request)
    const localTracks = db.prepare("SELECT * FROM tracks ORDER BY created_at DESC").all() as Track[]
    const ytTracks = db.prepare("SELECT * FROM yt_tracks ORDER BY created_at DESC").all() as YTTrack[]
    const musicLocalTracks = localTracks.filter((track) => (track.content_type || "music") !== "podcast")
    const musicYouTubeTracks = ytTracks.filter((track) => (track.content_type || "music") !== "podcast")

    if (localTracks.length === 0 && ytTracks.length === 0) {
      if (isDemoSessionEnabled()) return NextResponse.json({ mixes: getDemoMixes() })

      const freshOnlineTracks = await getFreshOnlineStarterMix()
      return NextResponse.json({
        mixes: {
          ...emptyMixes(),
          ytMix: freshOnlineTracks,
          mixLabels: {
            ...emptyMixes().mixLabels,
            ytMixTitle: "YouTube Starter Mix",
          },
        },
        signals: {
          personalized: false,
          localTracks: 0,
          onlineTracks: freshOnlineTracks.length,
          algorithm: {
            behavior: false,
            itemSimilarity: true,
            context: "fresh-account",
            ranking: "cached-youtube-starter-candidates",
          },
        },
      })
    }

    const profile = buildTasteProfile(user?.id ?? null, localTracks, ytTracks, request)
    const playableLocalTracks = musicLocalTracks.filter((track) => !isDislikedLocal(track.id, profile))
    const playableYouTubeTracks = musicYouTubeTracks.filter((track) => !isDislikedYouTube(track.video_id, profile))

    const playlistSeeds = getPlaylistSeedLocalTracks(playableLocalTracks, profile)
    const yourMix = uniqueLocalTracks([
      ...playlistSeeds,
      ...sortLocalTracks(playableLocalTracks, profile, "direct"),
    ])
    const discoverMix = sortLocalTracks(playableLocalTracks, profile, "discover")
    const newReleaseMix = sortLocalTracks(
      [...playableLocalTracks].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 30),
      profile,
      "recent"
    )
    const supermix = uniqueLocalTracks([
      ...yourMix.slice(0, 8),
      ...playlistSeeds.slice(0, 6),
      ...discoverMix.slice(0, 6),
      ...newReleaseMix.slice(0, 4),
      ...playableLocalTracks.filter((track) => track.is_favorite),
    ])
    const artistRadioData = buildArtistRadio(playableLocalTracks, yourMix, profile)
    const songRadioData = buildSongRadio(playableLocalTracks, yourMix[0] || discoverMix[0] || newReleaseMix[0], profile)
    const genreMoodData = buildGenreMoodMix(playableLocalTracks, yourMix, profile)
    const savedYouTubeMix = playableYouTubeTracks
      .map((track) => ({ track, score: scoreYouTubeTrack(track, profile) }))
      .sort((a, b) => b.score - a.score || b.track.created_at.localeCompare(a.track.created_at))
      .slice(0, 12)
      .map((item) => toYouTubeTrack(item.track))
    const onlineDiscoverMix = await getOnlineRecommendations(profile, playableLocalTracks, playableYouTubeTracks, 12)
    const ytMix = uniqueClientTracks([...savedYouTubeMix, ...onlineDiscoverMix]).slice(0, 12)

    return NextResponse.json({
      mixes: {
        yourMix: yourMix.slice(0, 12).map(toLocalTrack),
        discoverMix: uniqueClientTracks([
          ...discoverMix.slice(0, 8).map(toLocalTrack),
          ...onlineDiscoverMix.slice(0, 4),
        ]).slice(0, 12),
        newReleaseMix: newReleaseMix.slice(0, 12).map(toLocalTrack),
        supermix: supermix.slice(0, 16).map(toLocalTrack),
        artistRadio: artistRadioData.tracks.slice(0, 12).map(toLocalTrack),
        songRadio: songRadioData.tracks.slice(0, 12).map(toLocalTrack),
        genreMoodMix: genreMoodData.tracks.slice(0, 12).map(toLocalTrack),
        onlineDiscoverMix,
        ytMix,
        mixLabels: {
          artistRadioTitle: artistRadioData.title,
          songRadioTitle: songRadioData.title,
          genreMoodTitle: genreMoodData.title,
          ytMixTitle: "Recommended Online Mix",
        },
      },
      signals: {
        personalized: Boolean(user),
        localTracks: localTracks.length,
        onlineTracks: ytTracks.length,
        podcastTracks: localTracks.length - musicLocalTracks.length + ytTracks.length - musicYouTubeTracks.length,
        algorithm: {
          behavior: true,
          itemSimilarity: true,
          similarUsers: true,
          context: profile.context,
          ranking: "candidate-generation-plus-ranking",
        },
      },
    })
  } catch (error) {
    console.error("[mixes] error:", error)
    if (isDemoSessionEnabled()) return NextResponse.json({ mixes: getDemoMixes() })
    return NextResponse.json({ error: "Failed to fetch mixes" }, { status: 500 })
  }
}

async function getFreshOnlineStarterMix() {
  const query = process.env.FRESH_YOUTUBE_MIX_QUERY || "top music"
  const results = await searchYTMusic(query, 12)
  return results.map(toFreshYouTubeTrack)
}

async function getOnlineRecommendations(
  profile: ReturnType<typeof buildTasteProfile>,
  localTracks: Track[],
  ytTracks: YTTrack[],
  limit: number
) {
  const existingVideoIds = new Set(ytTracks.map((track) => track.video_id))
  const seen = new Set<string>()
  const recommendations: ReturnType<typeof toFreshYouTubeTrack>[] = []

  for (const query of buildOnlineRecommendationQueries(profile, localTracks, ytTracks).slice(0, 3)) {
    const batch = await searchYTMusic(query, Math.max(limit, 8))
    for (const result of batch) {
      if (!result.videoId || existingVideoIds.has(result.videoId) || seen.has(result.videoId)) continue
      seen.add(result.videoId)
      recommendations.push(toFreshYouTubeTrack(result))
      if (recommendations.length >= limit) break
    }
    if (recommendations.length >= limit) break
  }

  return recommendations
}

function buildOnlineRecommendationQueries(
  profile: ReturnType<typeof buildTasteProfile>,
  localTracks: Track[],
  ytTracks: YTTrack[]
): string[] {
  const seed = pickSeed(localTracks, ytTracks)
  const artist = firstNonEmpty([
    seed?.artist,
    dominantValue(localTracks, "artist"),
    dominantYouTubeArtist(ytTracks),
  ])
  const genre = dominantValue(localTracks, "genre")
  const mood = dominantValue(localTracks, "mood")
  const searchTerm = [...profile.searchTerms.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([term]) => term)
    .find((term) => term.length > 2)
  const contextual = profile.context.timeBucket === "night" ? "chill night music" : "new music"

  return uniqueStrings([
    artist ? `${artist} songs` : "",
    mood || genre ? `${mood || genre} music` : "",
    searchTerm ? `${searchTerm} music` : "",
    contextual,
    process.env.FRESH_YOUTUBE_MIX_QUERY || "top music",
  ])
}

function pickSeed(localTracks: Track[], ytTracks: YTTrack[]) {
  const favoriteLocal = localTracks.find((track) => track.is_favorite)
  if (favoriteLocal) return favoriteLocal

  const topLocal = [...localTracks].sort((a, b) => b.play_count - a.play_count)[0]
  if (topLocal) return topLocal

  const favoriteYouTube = ytTracks.find((track) => track.is_favorite)
  if (favoriteYouTube) {
    return {
      title: favoriteYouTube.title,
      artist: favoriteYouTube.artist,
      album: favoriteYouTube.album,
    }
  }

  const topYouTube = [...ytTracks].sort((a, b) => b.play_count - a.play_count)[0]
  return topYouTube
    ? {
        title: topYouTube.title,
        artist: topYouTube.artist,
        album: topYouTube.album,
      }
    : null
}

function emptyMixes() {
  return {
    yourMix: [],
    discoverMix: [],
    newReleaseMix: [],
    supermix: [],
    artistRadio: [],
    songRadio: [],
    genreMoodMix: [],
    onlineDiscoverMix: [],
    ytMix: [],
    mixLabels: {
      artistRadioTitle: "Artist Radio",
      songRadioTitle: "Song Radio",
      genreMoodTitle: "Genre / Mood Mix",
    },
  }
}

function sortLocalTracks(
  tracks: Track[],
  profile: ReturnType<typeof buildTasteProfile>,
  mode: "direct" | "discover" | "recent"
): Track[] {
  return tracks
    .map((track) => ({
      track,
      score: scoreLocalTrack(track, profile, mode),
    }))
    .sort((a, b) => b.score - a.score || b.track.created_at.localeCompare(a.track.created_at))
    .map((item) => item.track)
}

function getPlaylistSeedLocalTracks(
  tracks: Track[],
  profile: ReturnType<typeof buildTasteProfile>
): Track[] {
  if (tracks.length === 0) return []

  const trackMap = new Map(tracks.map((track) => [track.id, track]))
  const rows = db.prepare(`
    SELECT
      track_id,
      COUNT(*) as playlist_count,
      MIN(COALESCE(position, 999999)) as best_position,
      MAX(added_at) as last_added_at
    FROM playlist_tracks
    GROUP BY track_id
  `).all() as {
    track_id: number
    playlist_count: number
    best_position: number | null
    last_added_at: string | null
  }[]

  return rows
    .map((row) => {
      const track = trackMap.get(row.track_id)
      if (!track) return null
      const positionBoost = Math.max(0, 20 - Number(row.best_position || 0) * 0.6)
      return {
        track,
        score:
          scoreLocalTrack(track, profile, "direct") +
          Number(row.playlist_count || 0) * 48 +
          positionBoost +
          recencyScore(row.last_added_at),
      }
    })
    .filter(Boolean)
    .sort((a, b) => b!.score - a!.score)
    .map((item) => item!.track)
    .slice(0, 24)
}

function uniqueLocalTracks(tracks: Track[]) {
  const seen = new Set<number>()
  return tracks.filter((track) => {
    if (seen.has(track.id)) return false
    seen.add(track.id)
    return true
  })
}

function uniqueClientTracks<T extends { id: string | number; source?: string; videoId?: string }>(tracks: T[]): T[] {
  const seen = new Set<string>()
  return tracks.filter((track) => {
    const key = track.source === "youtube" && track.videoId ? `youtube:${track.videoId}` : `${track.source || "local"}:${track.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function buildArtistRadio(
  tracks: Track[],
  seeds: Track[],
  profile: ReturnType<typeof buildTasteProfile>
): { title: string; tracks: Track[] } {
  const seedArtist = firstNonEmpty(seeds.map((track) => track.artist)) || dominantValue(tracks, "artist")
  if (!seedArtist) return { title: "Artist Radio", tracks: [] }

  const seedGenres = new Set(
    seeds
      .filter((track) => normalized(track.artist) === normalized(seedArtist))
      .map((track) => normalized(track.genre))
      .filter(Boolean) as string[]
  )
  const seedMoods = new Set(
    seeds
      .filter((track) => normalized(track.artist) === normalized(seedArtist))
      .map((track) => normalized(getTrackMood(track)))
      .filter(Boolean) as string[]
  )

  const ranked = tracks
    .map((track) => {
      const sameArtist = normalized(track.artist) === normalized(seedArtist)
      const relatedGenre = seedGenres.has(normalized(track.genre) || "")
      const relatedMood = seedMoods.has(normalized(getTrackMood(track)) || "")
      return {
        track,
        score:
          scoreLocalTrack(track, profile, sameArtist ? "direct" : "discover") +
          (sameArtist ? 80 : 0) +
          (relatedGenre ? 24 : 0) +
          (relatedMood ? 18 : 0),
      }
    })
    .filter((item) => item.score > -500)
    .sort((a, b) => b.score - a.score || b.track.created_at.localeCompare(a.track.created_at))
    .map((item) => item.track)

  return { title: `${seedArtist} Radio`, tracks: uniqueLocalTracks(ranked) }
}

function buildSongRadio(
  tracks: Track[],
  seed: Track | undefined,
  profile: ReturnType<typeof buildTasteProfile>
): { title: string; tracks: Track[] } {
  if (!seed) return { title: "Song Radio", tracks: [] }

  const seedTempo = getTempoBucket(getTrackTempo(seed))
  const ranked = tracks
    .map((track) => {
      const sameTrack = track.id === seed.id
      return {
        track,
        score:
          scoreLocalTrack(track, profile, sameTrack ? "direct" : "discover") +
          (sameTrack ? 90 : 0) +
          (sameValue(track.artist, seed.artist) ? 36 : 0) +
          (sameValue(track.album, seed.album) ? 20 : 0) +
          (sameValue(track.genre, seed.genre) ? 28 : 0) +
          (sameValue(getTrackMood(track), getTrackMood(seed)) ? 24 : 0) +
          (sameValue(getTrackStyle(track), getTrackStyle(seed)) ? 18 : 0) +
          (getTempoBucket(getTrackTempo(track)) === seedTempo ? 10 : 0),
      }
    })
    .sort((a, b) => b.score - a.score || b.track.created_at.localeCompare(a.track.created_at))
    .map((item) => item.track)

  return { title: `${seed.title} Radio`, tracks: uniqueLocalTracks(ranked) }
}

function buildGenreMoodMix(
  tracks: Track[],
  seeds: Track[],
  profile: ReturnType<typeof buildTasteProfile>
): { title: string; tracks: Track[] } {
  const mood = dominantValue(seeds, "mood") || dominantValue(tracks, "mood")
  const genre = dominantValue(seeds, "genre") || dominantValue(tracks, "genre")
  const target = mood || genre
  if (!target) return { title: "Genre Mix", tracks: [] }

  const mode: "mood" | "genre" = mood ? "mood" : "genre"
  const ranked = tracks
    .map((track) => {
      const exact = mode === "mood" ? sameValue(getTrackMood(track), target) : sameValue(track.genre, target)
      const adjacent =
        mode === "mood"
          ? sameValue(track.genre, genre) || sameValue(getTrackStyle(track), target)
          : sameValue(getTrackMood(track), mood)

      return {
        track,
        score: scoreLocalTrack(track, profile, exact ? "direct" : "discover") + (exact ? 70 : 0) + (adjacent ? 18 : 0),
      }
    })
    .filter((item) => item.score > -500)
    .sort((a, b) => b.score - a.score || b.track.created_at.localeCompare(a.track.created_at))
    .map((item) => item.track)

  return {
    title: mode === "mood" ? `${titleCase(target)} Mix` : `${target} Mix`,
    tracks: uniqueLocalTracks(ranked),
  }
}

function dominantValue(tracks: Track[], field: "artist" | "genre" | "mood"): string | null {
  const counts = new Map<string, { label: string; score: number }>()
  for (const track of tracks) {
    const value = field === "mood" ? getTrackMood(track) : track[field]
    const key = normalized(value)
    if (!key || key === "unknown artist" || key === "unknown album") continue
    const existing = counts.get(key)
    counts.set(key, {
      label: value || key,
      score: (existing?.score || 0) + 1 + track.play_count * 0.05 + (track.is_favorite ? 1 : 0),
    })
  }

  return [...counts.values()].sort((a, b) => b.score - a.score)[0]?.label || null
}

function dominantYouTubeArtist(tracks: YTTrack[]): string | null {
  const counts = new Map<string, { label: string; score: number }>()
  for (const track of tracks) {
    const artist = track.artist?.trim()
    const key = normalized(artist)
    if (!key || key === "unknown artist") continue
    const existing = counts.get(key)
    counts.set(key, {
      label: artist!,
      score: (existing?.score || 0) + 1 + track.play_count * 0.05 + (track.is_favorite ? 1 : 0),
    })
  }
  return [...counts.values()].sort((a, b) => b.score - a.score)[0]?.label || null
}

function getTrackMood(track: Track): string | null {
  return (track as Track & { mood?: string | null }).mood || null
}

function getTrackStyle(track: Track): string | null {
  return (track as Track & { style?: string | null }).style || track.genre || null
}

function getTrackTempo(track: Track): number | null {
  const tempo = Number((track as Track & { tempo?: number | null }).tempo)
  return Number.isFinite(tempo) && tempo > 0 ? tempo : null
}

function getTempoBucket(tempo: number | null): string {
  if (!tempo) return "unknown-tempo"
  if (tempo < 90) return "slow"
  if (tempo < 120) return "mid"
  if (tempo < 145) return "upbeat"
  return "fast"
}

function firstNonEmpty(values: Array<string | null | undefined>): string | null {
  return values.find((value) => value?.trim())?.trim() || null
}

function sameValue(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalized(a)
  const right = normalized(b)
  return Boolean(left && right && left === right)
}

function normalized(value: string | null | undefined): string | null {
  const result = value?.trim().toLowerCase()
  return result || null
}

function titleCase(value: string): string {
  return value
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ")
}

function recencyScore(date: string | null | undefined): number {
  const value = getDateValue(date)
  if (!value) return 0
  const ageDays = Math.max(0, (Date.now() - value) / 86_400_000)
  return Math.max(0, 30 - ageDays)
}

function getDateValue(date: string | null | undefined): number {
  if (!date) return 0
  const parsed = Date.parse(date.includes("T") ? date : `${date.replace(" ", "T")}Z`)
  return Number.isFinite(parsed) ? parsed : 0
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const clean = value.trim()
    const key = normalized(clean)
    if (!clean || !key || seen.has(key)) continue
    seen.add(key)
    result.push(clean)
  }
  return result
}

function toLocalTrack(track: Track) {
  return {
    ...track,
    source: "local" as const,
  }
}

function toYouTubeTrack(track: YTTrack) {
  return {
    id: track.id,
    source: "youtube" as const,
    videoId: track.video_id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    cover_art_path: track.thumbnail_url,
    is_favorite: track.is_favorite,
    is_cached: track.is_cached,
    play_count: track.play_count,
  }
}

function toFreshYouTubeTrack(track: YTSearchResult) {
  return {
    id: `youtube-${track.videoId}`,
    source: "youtube" as const,
    videoId: track.videoId,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    cover_art_path: track.thumbnailUrlHQ || track.thumbnailUrl,
    thumbnailUrl: track.thumbnailUrl,
    thumbnailUrlHQ: track.thumbnailUrlHQ,
    content_type: track.content_type || "music",
    podcast_title: track.podcast_title || null,
    podcast_author: track.podcast_author || null,
    is_favorite: false,
    is_cached: false,
    play_count: 0,
  }
}
