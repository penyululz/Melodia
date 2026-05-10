import { NextRequest, NextResponse } from "next/server"
import db, { queries, type Track, type YTTrack } from "@/lib/db"
import { getSessionOrDemo, isDemoSessionEnabled } from "@/lib/auth-policy"
import { getDemoStats } from "@/lib/demo-data"
import {
  buildTasteProfile,
  isDislikedLocal,
  isDislikedYouTube,
  scoreLocalTrack,
  scoreYouTubeTrack,
  type TasteProfile,
} from "@/lib/recommendation-engine"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type ClientTrack = ReturnType<typeof toLocalTrack> | ReturnType<typeof toYouTubeTrack>

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionOrDemo(request)
    const stats = getStats()
    const localTracks = db.prepare("SELECT * FROM tracks ORDER BY created_at DESC").all() as Track[]
    const ytTracks = db.prepare("SELECT * FROM yt_tracks ORDER BY created_at DESC").all() as YTTrack[]
    const musicLocalTracks = localTracks.filter((track) => (track.content_type || "music") !== "podcast")
    const musicYouTubeTracks = ytTracks.filter((track) => (track.content_type || "music") !== "podcast")
    const profile = buildTasteProfile(user?.id ?? null, localTracks, ytTracks, request)
    const localTrackMap = new Map(localTracks.map((track) => [track.id, track]))
    const ytTrackMap = new Map(ytTracks.map((track) => [track.video_id, track]))

    const listenAgain = getListenAgain(profile.userId, localTrackMap, ytTrackMap)
    const similar = getSimilarTracks(musicLocalTracks, musicYouTubeTracks, profile, listenAgain)
    const playlistPicks = getPlaylistPicks(localTrackMap, ytTrackMap, profile)
    const trendingTracks = getTrendingTracks(musicLocalTracks, musicYouTubeTracks, profile)
    const recentTracks = getRecentlyAdded(musicLocalTracks, musicYouTubeTracks)
    const mostPlayedTracks = getMostPlayedTracks(musicLocalTracks, musicYouTubeTracks)
    const albums = queries.getAlbums.all().slice(0, 8)

    return NextResponse.json({
      stats,
      context: profile.context,
      recentTracks,
      mostPlayedTracks,
      listenAgain,
      similarTracks: similar.tracks,
      similarTitle: similar.title,
      playlistPicks,
      trendingTracks,
      albums,
      signals: {
        personalized: Boolean(user),
        hasHistory: listenAgain.length > 0,
        hasPlaylistSignals: playlistPicks.length > 0,
        localTracks: localTracks.length,
        onlineTracks: ytTracks.length,
      },
    })
  } catch (error) {
    console.error("[home] error:", error)
    if (!isDemoSessionEnabled()) {
      return NextResponse.json({ error: "Failed to fetch home data" }, { status: 500 })
    }
    return NextResponse.json({
      stats: getDemoStats(),
      context: null,
      recentTracks: [],
      mostPlayedTracks: [],
      listenAgain: [],
      similarTracks: [],
      similarTitle: "Similar to Your Music",
      playlistPicks: [],
      trendingTracks: [],
      albums: [],
      signals: {
        personalized: false,
        hasHistory: false,
        hasPlaylistSignals: false,
        localTracks: 0,
        onlineTracks: 0,
      },
    })
  }
}

function getStats() {
  const local = db.prepare(`
    SELECT
      COUNT(*) as total_tracks,
      COALESCE(SUM(duration), 0) as total_duration,
      COUNT(DISTINCT NULLIF(artist, '')) as total_artists,
      COUNT(DISTINCT NULLIF(album, '')) as total_albums,
      COALESCE(SUM(is_favorite), 0) as total_favorites,
      COALESCE(SUM(play_count), 0) as total_plays,
      SUM(CASE WHEN COALESCE(content_type, 'music') = 'podcast' THEN 1 ELSE 0 END) as podcast_tracks
    FROM tracks
  `).get() as any

  const youtube = db.prepare(`
    SELECT
      COUNT(*) as yt_tracks,
      COALESCE(SUM(duration), 0) as yt_duration,
      COUNT(DISTINCT NULLIF(artist, '')) as yt_artists,
      COUNT(DISTINCT NULLIF(album, '')) as yt_albums,
      COALESCE(SUM(is_favorite), 0) as yt_favorites,
      COALESCE(SUM(play_count), 0) as yt_plays,
      COALESCE(SUM(is_cached), 0) as cached_yt_tracks,
      SUM(CASE WHEN COALESCE(content_type, 'music') = 'podcast' THEN 1 ELSE 0 END) as yt_podcast_tracks
    FROM yt_tracks
  `).get() as any

  const localTracks = Number(local?.total_tracks || 0)
  const ytTracks = Number(youtube?.yt_tracks || 0)

  if (localTracks + ytTracks === 0) return isDemoSessionEnabled() ? getDemoStats() : emptyStats()

  return {
    total_tracks: localTracks + ytTracks,
    local_tracks: localTracks,
    yt_tracks: ytTracks,
    cached_yt_tracks: Number(youtube?.cached_yt_tracks || 0),
    total_duration: Number(local?.total_duration || 0) + Number(youtube?.yt_duration || 0),
    total_artists: Number(local?.total_artists || 0) + Number(youtube?.yt_artists || 0),
    total_albums: Number(local?.total_albums || 0) + Number(youtube?.yt_albums || 0),
    total_favorites: Number(local?.total_favorites || 0) + Number(youtube?.yt_favorites || 0),
    total_plays: Number(local?.total_plays || 0) + Number(youtube?.yt_plays || 0),
    podcast_tracks: Number(local?.podcast_tracks || 0) + Number(youtube?.yt_podcast_tracks || 0),
  }
}

function emptyStats() {
  return {
    total_tracks: 0,
    local_tracks: 0,
    yt_tracks: 0,
    cached_yt_tracks: 0,
    total_duration: 0,
    total_artists: 0,
    total_albums: 0,
    total_favorites: 0,
    total_plays: 0,
    podcast_tracks: 0,
  }
}

function getListenAgain(
  userId: number | null,
  localTracks: Map<number, Track>,
  ytTracks: Map<string, YTTrack>
): ClientTrack[] {
  const rows = db.prepare(`
    SELECT
      track_id,
      yt_video_id,
      source,
      MAX(listened_at) as last_listened_at,
      COUNT(*) as listen_count
    FROM listen_history
    WHERE user_id IS ?
      AND (track_id IS NOT NULL OR yt_video_id IS NOT NULL)
    GROUP BY track_id, yt_video_id, source
    ORDER BY last_listened_at DESC, listen_count DESC
    LIMIT 24
  `).all(userId) as {
    track_id: number | null
    yt_video_id: string | null
    source: string
    last_listened_at: string
    listen_count: number
  }[]

  const tracks = rows
    .map((row) => {
      if (row.yt_video_id) {
        const track = ytTracks.get(row.yt_video_id)
        return track ? toYouTubeTrack(track) : null
      }
      if (row.track_id) {
        const track = localTracks.get(row.track_id)
        return track ? toLocalTrack(track) : null
      }
      return null
    })
    .filter(Boolean) as ClientTrack[]

  return uniqueTracks(tracks).slice(0, 16)
}

function getPlaylistPicks(
  localTracks: Map<number, Track>,
  ytTracks: Map<string, YTTrack>,
  profile: TasteProfile
): ClientTrack[] {
  const rows = db.prepare(`
    SELECT *
    FROM (
      SELECT
        'local' as source,
        track_id,
        NULL as video_id,
        COUNT(*) as playlist_count,
        MAX(added_at) as last_added_at
      FROM playlist_tracks
      GROUP BY track_id

      UNION ALL

      SELECT
        'youtube' as source,
        NULL as track_id,
        y.video_id,
        COUNT(*) as playlist_count,
        MAX(pt.added_at) as last_added_at
      FROM playlist_youtube_tracks pt
      JOIN yt_tracks y ON y.id = pt.yt_track_id
      GROUP BY y.video_id
    )
  `).all() as {
    source: "local" | "youtube"
    track_id: number | null
    video_id: string | null
    playlist_count: number
    last_added_at: string | null
  }[]

  return rows
    .map((row) => {
      if (row.source === "youtube" && row.video_id) {
        const track = ytTracks.get(row.video_id)
        if (!track || isDislikedYouTube(track.video_id, profile)) return null
        return {
          track: toYouTubeTrack(track),
          score: scoreYouTubeTrack(track, profile) + Number(row.playlist_count || 0) * 24 + recencyScore(row.last_added_at),
        }
      }

      if (row.track_id) {
        const track = localTracks.get(row.track_id)
        if (!track || isDislikedLocal(track.id, profile)) return null
        return {
          track: toLocalTrack(track),
          score: scoreLocalTrack(track, profile) + Number(row.playlist_count || 0) * 24 + recencyScore(row.last_added_at),
        }
      }

      return null
    })
    .filter(Boolean)
    .sort((a, b) => b!.score - a!.score)
    .map((item) => item!.track)
    .slice(0, 16)
}

function getTrendingTracks(
  localTracks: Track[],
  ytTracks: YTTrack[],
  profile: TasteProfile
): ClientTrack[] {
  const local = localTracks
    .filter((track) => !isDislikedLocal(track.id, profile))
    .map((track) => ({
      track: toLocalTrack(track),
      score:
        scoreLocalTrack(track, profile, "direct") +
        track.play_count * 4 +
        (track.is_favorite ? 40 : 0) +
        recencyScore(track.last_played_at || track.created_at),
    }))

  const youtube = ytTracks
    .filter((track) => !isDislikedYouTube(track.video_id, profile))
    .map((track) => ({
      track: toYouTubeTrack(track),
      score:
        scoreYouTubeTrack(track, profile) +
        track.play_count * 4 +
        (track.is_favorite ? 40 : 0) +
        (track.is_cached ? 12 : 0) +
        recencyScore(track.last_played_at || track.created_at),
    }))

  return [...local, ...youtube]
    .sort((a, b) => b.score - a.score)
    .map((item) => item.track)
    .filter(uniqueTrackFilter())
    .slice(0, 16)
}

function getRecentlyAdded(localTracks: Track[], ytTracks: YTTrack[]): ClientTrack[] {
  return [
    ...localTracks.map((track) => ({ track: toLocalTrack(track), createdAt: track.created_at })),
    ...ytTracks.map((track) => ({ track: toYouTubeTrack(track), createdAt: track.created_at })),
  ]
    .sort((a, b) => getDateValue(b.createdAt) - getDateValue(a.createdAt))
    .map((item) => item.track)
    .filter(uniqueTrackFilter())
    .slice(0, 20)
}

function getMostPlayedTracks(localTracks: Track[], ytTracks: YTTrack[]): ClientTrack[] {
  return [
    ...localTracks.map((track) => ({ track: toLocalTrack(track), plays: track.play_count })),
    ...ytTracks.map((track) => ({ track: toYouTubeTrack(track), plays: track.play_count })),
  ]
    .filter((item) => item.plays > 0)
    .sort((a, b) => b.plays - a.plays)
    .map((item) => item.track)
    .filter(uniqueTrackFilter())
    .slice(0, 20)
}

function getSimilarTracks(
  localTracks: Track[],
  ytTracks: YTTrack[],
  profile: TasteProfile,
  listenAgain: ClientTrack[]
): { title: string; tracks: ClientTrack[] } {
  const seed = pickSeed(localTracks, ytTracks, listenAgain)
  if (!seed) return { title: "Similar to Your Music", tracks: [] }

  const local = localTracks
    .filter((track) => !isDislikedLocal(track.id, profile))
    .map((track) => ({
      track: toLocalTrack(track),
      score: similarityScore(seed, {
        id: String(track.id),
        source: "local",
        artist: track.artist,
        album: track.album,
        genre: track.genre,
      }) + scoreLocalTrack(track, profile, "discover") * 0.2,
    }))

  const youtube = ytTracks
    .filter((track) => !isDislikedYouTube(track.video_id, profile))
    .map((track) => ({
      track: toYouTubeTrack(track),
      score: similarityScore(seed, {
        id: track.video_id,
        source: "youtube",
        artist: track.artist,
        album: track.album,
        genre: null,
      }) + scoreYouTubeTrack(track, profile) * 0.2,
    }))

  const tracks = [...local, ...youtube]
    .filter((item) => item.score > 0 && !(item.track.source === seed.source && String(item.track.id) === seed.id))
    .sort((a, b) => b.score - a.score)
    .map((item) => item.track)

  return {
    title: `Similar to ${seed.title}`,
    tracks: uniqueTracks(tracks).slice(0, 16),
  }
}

function pickSeed(localTracks: Track[], ytTracks: YTTrack[], listenAgain: ClientTrack[]) {
  const listened = listenAgain[0]
  if (listened) {
    return {
      id: String(listened.id),
      source: listened.source || "local",
      title: listened.title,
      artist: listened.artist,
      album: listened.album,
      genre: "genre" in listened ? listened.genre : null,
    }
  }

  const favoriteLocal = localTracks.find((track) => track.is_favorite)
  if (favoriteLocal) {
    return {
      id: String(favoriteLocal.id),
      source: "local" as const,
      title: favoriteLocal.title,
      artist: favoriteLocal.artist,
      album: favoriteLocal.album,
      genre: favoriteLocal.genre,
    }
  }

  const favoriteYouTube = ytTracks.find((track) => track.is_favorite)
  if (favoriteYouTube) {
    return {
      id: favoriteYouTube.video_id,
      source: "youtube" as const,
      title: favoriteYouTube.title,
      artist: favoriteYouTube.artist,
      album: favoriteYouTube.album,
      genre: null,
    }
  }

  const topLocal = [...localTracks].sort((a, b) => b.play_count - a.play_count)[0]
  if (topLocal) {
    return {
      id: String(topLocal.id),
      source: "local" as const,
      title: topLocal.title,
      artist: topLocal.artist,
      album: topLocal.album,
      genre: topLocal.genre,
    }
  }

  const topYouTube = [...ytTracks].sort((a, b) => b.play_count - a.play_count)[0]
  if (topYouTube) {
    return {
      id: topYouTube.video_id,
      source: "youtube" as const,
      title: topYouTube.title,
      artist: topYouTube.artist,
      album: topYouTube.album,
      genre: null,
    }
  }

  return null
}

function similarityScore(
  seed: { id: string; source: string; artist: string | null; album: string | null; genre: string | null },
  candidate: { id: string; source: string; artist: string | null; album: string | null; genre: string | null }
): number {
  if (seed.source === candidate.source && seed.id === candidate.id) return 0

  let score = 0
  if (sameValue(seed.artist, candidate.artist)) score += 60
  if (sameValue(seed.album, candidate.album)) score += 28
  if (sameValue(seed.genre, candidate.genre)) score += 34
  if (seed.source === "youtube" && candidate.source === "youtube") score += 8
  return score
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

function sameValue(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalized(a)
  const right = normalized(b)
  return Boolean(left && right && left === right)
}

function normalized(value: string | null | undefined): string | null {
  const result = value?.trim().toLowerCase()
  return result || null
}

function uniqueTracks(tracks: ClientTrack[]): ClientTrack[] {
  const seen = new Set<string>()
  return tracks.filter((track) => {
    const key = getClientTrackKey(track)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function uniqueTrackFilter() {
  const seen = new Set<string>()
  return (track: ClientTrack) => {
    const key = getClientTrackKey(track)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }
}

function getClientTrackKey(track: ClientTrack): string {
  const promotedVideoId = track.source === "youtube"
    ? track.videoId || String(track.id)
    : getYouTubeVideoIdFromPath((track as ClientTrack & { file_path?: string | null }).file_path)

  return promotedVideoId ? `youtube:${promotedVideoId}` : `local:${track.id}`
}

function getYouTubeVideoIdFromPath(filePath: string | null | undefined): string | null {
  const match = filePath?.match(/^\/api\/youtube\/stream\/([^/?#]+)/)
  return match?.[1] || null
}

function toLocalTrack(track: Track) {
  return {
    ...track,
    source: "local" as const,
  }
}

function toYouTubeTrack(track: YTTrack) {
  return {
    id: track.video_id,
    source: "youtube" as const,
    videoId: track.video_id,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    cover_art_path: track.thumbnail_url,
    file_path: track.is_cached ? `/api/youtube/stream/${track.video_id}` : undefined,
    file_format: track.cached_media_type === "video" ? "MP4" : null,
    content_type: track.content_type || "music",
    podcast_title: track.podcast_title,
    podcast_author: track.podcast_author,
    podcast_episode_number: track.podcast_episode_number,
    podcast_season_number: track.podcast_season_number,
    podcast_description: track.podcast_description,
    podcast_published_at: track.podcast_published_at,
    loudness_adjust_db: track.loudness_adjust_db,
    replaygain_track_gain: track.replaygain_track_gain,
    replaygain_album_gain: track.replaygain_album_gain,
    is_favorite: track.is_favorite,
    is_cached: track.is_cached,
    play_count: track.play_count,
  }
}
