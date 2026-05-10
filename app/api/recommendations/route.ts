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

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionOrDemo(request)
    const localTracks = db.prepare("SELECT * FROM tracks ORDER BY created_at DESC").all() as Track[]
    const ytTracks = db.prepare("SELECT * FROM yt_tracks ORDER BY created_at DESC").all() as YTTrack[]
    const trackId = Number(request.nextUrl.searchParams.get("trackId"))
    const videoId = request.nextUrl.searchParams.get("videoId")?.trim() || null

    if (localTracks.length === 0 && ytTracks.length === 0) {
      return NextResponse.json({
        recommendations: isDemoSessionEnabled() ? getDemoMixes().discoverMix : [],
      })
    }

    const profile = buildTasteProfile(user?.id ?? null, localTracks, ytTracks, request)

    if ((Number.isInteger(trackId) && trackId > 0) || videoId) {
      return NextResponse.json({
        recommendations: getRelatedRecommendations(
          localTracks,
          ytTracks,
          profile,
          Number.isInteger(trackId) && trackId > 0 ? trackId : null,
          videoId
        ),
        signals: {
          personalized: Boolean(user),
          localTracks: localTracks.length,
          onlineTracks: ytTracks.length,
          algorithm: "item-similarity-playlist-cooccurrence-ranking",
        },
      })
    }

    const localRecommendations = localTracks
      .filter((track) => !isDislikedLocal(track.id, profile))
      .map((track) => ({
        track: toClientLocalTrack(track),
        score: scoreLocalTrack(track, profile, "discover"),
      }))
    const youtubeRecommendations = ytTracks
      .filter((track) => !isDislikedYouTube(track.video_id, profile))
      .map((track) => ({
        track: toClientYouTubeTrack(track),
        score: scoreYouTubeTrack(track, profile),
      }))
    const recommendations = [...localRecommendations, ...youtubeRecommendations]
      .sort((a, b) => b.score - a.score)
      .map((item) => item.track)
      .filter(uniqueTrackFilter())
      .slice(0, 15)

    return NextResponse.json({
      recommendations: recommendations.length > 0
        ? recommendations
        : isDemoSessionEnabled()
          ? getDemoMixes().discoverMix
          : [],
      signals: {
        personalized: Boolean(user),
        localTracks: localTracks.length,
        context: profile.context,
        algorithm: "behavior-similarity-context-ranking",
      },
    })
  } catch (error) {
    console.error("[recommendations] error:", error)
    return NextResponse.json({ error: "Failed to fetch recommendations" }, { status: 500 })
  }
}

function getRelatedRecommendations(
  localTracks: Track[],
  ytTracks: YTTrack[],
  profile: ReturnType<typeof buildTasteProfile>,
  requestedTrackId: number | null,
  requestedVideoId: string | null
) {
  const localById = new Map(localTracks.map((track) => [track.id, track]))
  const ytByVideoId = new Map(ytTracks.map((track) => [track.video_id, track]))
  const seedLocal =
    requestedTrackId !== null
      ? localById.get(requestedTrackId) || null
      : requestedVideoId
        ? localTracks.find((track) => getYouTubeVideoIdFromPath(track.file_path) === requestedVideoId) || null
        : null
  const seedYouTube = requestedVideoId ? ytByVideoId.get(requestedVideoId) || null : null
  const seed = seedLocal
    ? {
        id: String(seedLocal.id),
        source: "local",
        title: seedLocal.title,
        artist: seedLocal.artist,
        album: seedLocal.album,
        genre: seedLocal.genre,
        videoId: getYouTubeVideoIdFromPath(seedLocal.file_path),
      }
    : seedYouTube
      ? {
          id: seedYouTube.video_id,
          source: "youtube",
          title: seedYouTube.title,
          artist: seedYouTube.artist,
          album: seedYouTube.album,
          genre: null,
          videoId: seedYouTube.video_id,
        }
      : null

  if (!seed) return []

  const localPlaylistScores = getLocalPlaylistCoScores(seedLocal?.id ?? null, seed.videoId)
  const youtubePlaylistScores = getYouTubePlaylistCoScores(seed.videoId, seedLocal?.id ?? null)

  const local = localTracks
    .filter((track) => (track.content_type || "music") !== "podcast")
    .filter((track) => !isDislikedLocal(track.id, profile))
    .map((track) => {
      const candidateVideoId = getYouTubeVideoIdFromPath(track.file_path)
      return {
        track: toClientLocalTrack(track),
        score:
          relatedScore(seed, {
            id: String(track.id),
            source: "local",
            title: track.title,
            artist: track.artist,
            album: track.album,
            genre: track.genre,
            videoId: candidateVideoId,
          }) +
          scoreLocalTrack(track, profile, "discover") * 0.25 +
          (localPlaylistScores.get(track.id) || 0) * 70,
      }
    })

  const youtube = ytTracks
    .filter((track) => (track.content_type || "music") !== "podcast")
    .filter((track) => !isDislikedYouTube(track.video_id, profile))
    .map((track) => ({
      track: toClientYouTubeTrack(track),
      score:
        relatedScore(seed, {
          id: track.video_id,
          source: "youtube",
          title: track.title,
          artist: track.artist,
          album: track.album,
          genre: null,
          videoId: track.video_id,
        }) +
        scoreYouTubeTrack(track, profile) * 0.25 +
        (youtubePlaylistScores.get(track.video_id) || 0) * 70,
    }))

  const seedKey = seed.videoId ? `youtube:${seed.videoId}` : `${seed.source}:${seed.id}`

  return [...local, ...youtube]
    .filter((item) => item.score > 0 && getClientTrackKey(item.track) !== seedKey)
    .sort((a, b) => b.score - a.score)
    .map((item) => item.track)
    .filter(uniqueTrackFilter())
    .slice(0, 16)
}

function getLocalPlaylistCoScores(seedTrackId: number | null, seedVideoId: string | null) {
  const scores = new Map<number, number>()
  const seedTrackIds = new Set<number>()
  if (seedTrackId) seedTrackIds.add(seedTrackId)

  if (seedVideoId) {
    const rows = db.prepare(`
      SELECT id
      FROM tracks
      WHERE file_path = ? OR file_path LIKE ?
    `).all(`/api/youtube/stream/${seedVideoId}`, `/api/youtube/stream/${seedVideoId}?%`) as { id: number }[]

    for (const row of rows) seedTrackIds.add(row.id)
  }

  if (seedTrackIds.size > 0) {
    const placeholders = [...seedTrackIds].map(() => "?").join(",")
    const rows = db.prepare(`
      SELECT other.track_id, COUNT(*) as score
      FROM playlist_tracks seed
      JOIN playlist_tracks other ON other.playlist_id = seed.playlist_id
      WHERE seed.track_id IN (${placeholders})
        AND other.track_id NOT IN (${placeholders})
      GROUP BY other.track_id
    `).all(...seedTrackIds, ...seedTrackIds) as { track_id: number; score: number }[]

    for (const row of rows) scores.set(row.track_id, Number(row.score || 0))
  }

  if (seedVideoId) {
    const crossRows = db.prepare(`
      SELECT other.track_id, COUNT(*) as score
      FROM playlist_youtube_tracks seed
      JOIN yt_tracks seed_track ON seed_track.id = seed.yt_track_id
      JOIN playlist_tracks other ON other.playlist_id = seed.playlist_id
      WHERE seed_track.video_id = ?
      GROUP BY other.track_id
    `).all(seedVideoId) as { track_id: number; score: number }[]

    for (const row of crossRows) {
      scores.set(row.track_id, (scores.get(row.track_id) || 0) + Number(row.score || 0))
    }
  }

  return scores
}

function getYouTubePlaylistCoScores(seedVideoId: string | null, seedTrackId: number | null) {
  const scores = new Map<string, number>()
  if (!seedVideoId && !seedTrackId) return scores

  if (seedVideoId) {
    const savedPlaylistRows = db.prepare(`
      SELECT other_track.video_id, COUNT(*) as score
      FROM playlist_youtube_tracks seed
      JOIN yt_tracks seed_track ON seed_track.id = seed.yt_track_id
      JOIN playlist_youtube_tracks other ON other.playlist_id = seed.playlist_id
      JOIN yt_tracks other_track ON other_track.id = other.yt_track_id
      WHERE seed_track.video_id = ?
        AND other_track.video_id != ?
      GROUP BY other_track.video_id
    `).all(seedVideoId, seedVideoId) as { video_id: string; score: number }[]

    const importedPlaylistRows = db.prepare(`
      SELECT other_track.video_id, COUNT(*) as score
      FROM yt_playlist_tracks seed
      JOIN yt_tracks seed_track ON seed_track.id = seed.yt_track_id
      JOIN yt_playlist_tracks other ON other.yt_playlist_id = seed.yt_playlist_id
      JOIN yt_tracks other_track ON other_track.id = other.yt_track_id
      WHERE seed_track.video_id = ?
        AND other_track.video_id != ?
      GROUP BY other_track.video_id
    `).all(seedVideoId, seedVideoId) as { video_id: string; score: number }[]

    for (const row of [...savedPlaylistRows, ...importedPlaylistRows]) {
      scores.set(row.video_id, (scores.get(row.video_id) || 0) + Number(row.score || 0))
    }
  }

  if (seedTrackId) {
    const crossRows = db.prepare(`
      SELECT other_track.video_id, COUNT(*) as score
      FROM playlist_tracks seed
      JOIN playlist_youtube_tracks other ON other.playlist_id = seed.playlist_id
      JOIN yt_tracks other_track ON other_track.id = other.yt_track_id
      WHERE seed.track_id = ?
      GROUP BY other_track.video_id
    `).all(seedTrackId) as { video_id: string; score: number }[]

    for (const row of crossRows) {
      scores.set(row.video_id, (scores.get(row.video_id) || 0) + Number(row.score || 0))
    }
  }

  return scores
}

function relatedScore(
  seed: {
    id: string
    source: string
    title: string
    artist: string | null
    album: string | null
    genre: string | null
    videoId: string | null
  },
  candidate: {
    id: string
    source: string
    title: string
    artist: string | null
    album: string | null
    genre: string | null
    videoId: string | null
  }
): number {
  if (seed.videoId && candidate.videoId && seed.videoId === candidate.videoId) return 0
  if (!seed.videoId && seed.source === candidate.source && seed.id === candidate.id) return 0

  let score = 0
  if (sameValue(seed.artist, candidate.artist)) score += 58
  if (sameValue(seed.album, candidate.album)) score += 24
  if (sameValue(seed.genre, candidate.genre)) score += 30
  score += tokenOverlapScore(seed.title, candidate.title) * 22
  if (seed.source === candidate.source) score += 4
  return score
}

function tokenOverlapScore(left: string, right: string): number {
  const leftTokens = new Set(tokenize(left))
  const rightTokens = tokenize(right)
  if (leftTokens.size === 0 || rightTokens.length === 0) return 0

  let matches = 0
  for (const token of rightTokens) {
    if (leftTokens.has(token)) matches++
  }

  return matches / Math.max(leftTokens.size, rightTokens.length)
}

function tokenize(value: string | null | undefined): string[] {
  return Array.from(
    new Set(
      (value || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 3)
    )
  )
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

function uniqueTrackFilter() {
  const seen = new Set<string>()
  return (track: ReturnType<typeof toClientLocalTrack> | ReturnType<typeof toClientYouTubeTrack>) => {
    const key = getClientTrackKey(track)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }
}

function getClientTrackKey(track: ReturnType<typeof toClientLocalTrack> | ReturnType<typeof toClientYouTubeTrack>): string {
  const promotedVideoId = track.source === "youtube"
    ? track.videoId || String(track.id)
    : getYouTubeVideoIdFromPath((track as ReturnType<typeof toClientLocalTrack> & { file_path?: string | null }).file_path)

  return promotedVideoId ? `youtube:${promotedVideoId}` : `local:${track.id}`
}

function getYouTubeVideoIdFromPath(filePath: string | null | undefined): string | null {
  const match = filePath?.match(/^\/api\/youtube\/stream\/([^/?#]+)/)
  return match?.[1] || null
}

function toClientLocalTrack(track: Track) {
  return {
    ...track,
    source: "local" as const,
  }
}

function toClientYouTubeTrack(track: YTTrack) {
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
