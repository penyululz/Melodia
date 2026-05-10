import demoData from "./demo-data.json"

type DemoTrack = (typeof demoData.tracks)[number]
type DemoYouTubeTrack = (typeof demoData.youtubeTracks)[number]

export const DEMO_TRACKS = demoData.tracks
export const DEMO_PLAYLISTS = demoData.playlists
export const DEMO_YOUTUBE_TRACKS = demoData.youtubeTracks

export const DEMO_USER = {
  id: 1,
  email: "demo@melodia.app",
  name: "Demo User",
  avatar_url: null,
  role: "admin",
}

export function getDemoStats() {
  const localDuration = DEMO_TRACKS.reduce((total, track) => total + track.duration, 0)
  const ytDuration = DEMO_YOUTUBE_TRACKS.reduce((total, track) => total + track.duration, 0)
  const artists = new Set([
    ...DEMO_TRACKS.map((track) => track.artist),
    ...DEMO_YOUTUBE_TRACKS.map((track) => track.artist),
  ])
  const albums = new Set([
    ...DEMO_TRACKS.map((track) => track.album),
    ...DEMO_YOUTUBE_TRACKS.map((track) => track.album),
  ])

  return {
    total_tracks: DEMO_TRACKS.length + DEMO_YOUTUBE_TRACKS.length,
    local_tracks: DEMO_TRACKS.length,
    yt_tracks: DEMO_YOUTUBE_TRACKS.length,
    cached_yt_tracks: DEMO_YOUTUBE_TRACKS.filter((track) => track.isCached).length,
    total_albums: albums.size,
    total_artists: artists.size,
    total_duration: localDuration + ytDuration,
    total_favorites:
      DEMO_TRACKS.filter((track) => track.isFavorite).length +
      DEMO_YOUTUBE_TRACKS.filter((track) => track.isFavorite).length,
    total_plays:
      DEMO_TRACKS.reduce((total, track) => total + track.playCount, 0) +
      DEMO_YOUTUBE_TRACKS.reduce((total, track) => total + track.playCount, 0),
    podcast_tracks: DEMO_TRACKS.filter((track) => track.contentType === "podcast").length,
  }
}

export function getDemoMixes() {
  const localTracks = DEMO_TRACKS.filter((track) => track.contentType !== "podcast").map(toLocalTrack)
  const topTracks = [...localTracks].sort((a, b) => (b.play_count || 0) - (a.play_count || 0))

  return {
    yourMix: topTracks.filter((track) => track.is_favorite || (track.play_count || 0) >= 40).slice(0, 10),
    discoverMix: topTracks.filter((track) => (track.play_count || 0) < 30).slice(0, 10),
    newReleaseMix: localTracks.filter((track) => (track.year || 0) >= 2025),
    supermix: [...topTracks.filter((track) => track.is_favorite), ...topTracks.slice(0, 4)].slice(0, 12),
    ytMix: DEMO_YOUTUBE_TRACKS.map(toYouTubeMixTrack),
  }
}

export function getDemoPlaylists() {
  return DEMO_PLAYLISTS.map((playlist) => ({
    id: playlist.id,
    name: playlist.name,
    description: playlist.description,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    track_count: playlist.trackSlugs.length,
  }))
}

export function getDemoPlaylist(id: string) {
  const playlist = DEMO_PLAYLISTS.find((item) => item.id === id)
  if (!playlist) return null

  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    track_count: playlist.trackSlugs.length,
  }
}

export function getDemoPlaylistTracks(id: string) {
  const playlist = DEMO_PLAYLISTS.find((item) => item.id === id)
  if (!playlist) return []

  return playlist.trackSlugs
    .map((slug) => DEMO_TRACKS.find((track) => track.slug === slug))
    .filter(Boolean)
    .map((track) => toLocalTrack(track as DemoTrack))
}

export function getDemoYouTubeSearchResults(query: string, limit = 20) {
  const normalized = query.trim().toLowerCase()
  const matches = DEMO_YOUTUBE_TRACKS.filter((track) => {
    if (!normalized) return true

    return [track.title, track.artist, track.album]
      .filter(Boolean)
      .some((value) => value.toLowerCase().includes(normalized))
  })

  const results = matches.length > 0 ? matches : DEMO_YOUTUBE_TRACKS
  return results.slice(0, limit).map(toYouTubeSearchResult)
}

function toLocalTrack(track: DemoTrack) {
  const ext = track.kind === "video" ? "mp4" : "wav"

  return {
    id: `demo-${track.slug}`,
    source: "local" as const,
    title: track.title,
    artist: track.artist,
    album: track.album,
    album_artist: track.albumArtist,
    genre: track.genre,
    year: track.year,
    track_number: track.trackNumber,
    disc_number: 1,
    duration: track.duration,
    file_path: `/api/demo/media/${track.kind === "video" ? "video" : "audio"}/${track.slug}.${ext}`,
    file_name: `${track.slug}.${ext}`,
    file_size: null,
    file_format: track.kind === "video" ? "MP4" : "WAV",
    bit_rate: track.kind === "video" ? null : 705,
    sample_rate: track.kind === "video" ? null : 44100,
    cover_art_path: null,
    content_type: track.contentType || "music",
    podcast_title: track.podcastTitle || null,
    podcast_author: track.podcastAuthor || null,
    podcast_episode_number: track.podcastEpisodeNumber || null,
    podcast_season_number: track.podcastSeasonNumber || null,
    podcast_description: track.podcastDescription || null,
    podcast_published_at: track.podcastPublishedAt || null,
    loudness_adjust_db: 0,
    replaygain_track_gain: null,
    replaygain_album_gain: null,
    play_count: track.playCount,
    last_played_at: null,
    is_favorite: track.isFavorite ? 1 : 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
}

function toYouTubeSearchResult(track: DemoYouTubeTrack) {
  return {
    videoId: track.videoId,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    thumbnailUrl: track.thumbnailUrl,
    thumbnailUrlHQ: track.thumbnailUrl,
    type: "song" as const,
  }
}

function toYouTubeMixTrack(track: DemoYouTubeTrack) {
  return {
    id: track.videoId,
    source: "youtube" as const,
    videoId: track.videoId,
    title: track.title,
    artist: track.artist,
    album: track.album,
    duration: track.duration,
    cover_art_path: track.thumbnailUrl,
    is_favorite: track.isFavorite,
    play_count: track.playCount,
  }
}
