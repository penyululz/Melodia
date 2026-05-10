import { NextRequest, NextResponse } from "next/server"
import db, { queries, YTPlaylist } from "@/lib/db"
import { getYTPlaylist, extractPlaylistId } from "@/lib/youtube-music"
import { authErrorResponse, requireMutationAuth } from "@/lib/auth-policy"

// GET - List all imported YouTube playlists
export async function GET() {
  try {
    const playlists = queries.getAllYTPlaylists.all() as YTPlaylist[]
    return NextResponse.json({ playlists })
  } catch (error) {
    console.error("[v0] Get YT playlists error:", error)
    return NextResponse.json({ error: "Failed to get playlists" }, { status: 500 })
  }
}

// POST - Import a new YouTube playlist
export async function POST(request: NextRequest) {
  try {
    await requireMutationAuth(request)
    const body = await request.json()
    const { url } = body

    if (!url) {
      return NextResponse.json({ error: "Playlist URL is required" }, { status: 400 })
    }

    const playlistId = extractPlaylistId(url)
    if (!playlistId) {
      return NextResponse.json({ error: "Invalid playlist URL" }, { status: 400 })
    }

    // Check if already imported
    const existing = queries.getYTPlaylistByPlaylistId.get(playlistId) as YTPlaylist | null
    if (existing) {
      return NextResponse.json({ 
        message: "Playlist already imported", 
        playlist: existing 
      })
    }

    // Fetch playlist from YouTube Music
    const playlistInfo = await getYTPlaylist(playlistId)
    if (!playlistInfo) {
      return NextResponse.json({ error: "Could not fetch playlist" }, { status: 404 })
    }

    // Insert playlist
    const playlistResult = queries.insertYTPlaylist.run(
      playlistInfo.playlistId,
      playlistInfo.name,
      playlistInfo.description,
      playlistInfo.thumbnailUrl,
      playlistInfo.trackCount
    )

    const newPlaylistId = playlistResult.lastInsertRowid as number

    // Insert tracks and link to playlist
    for (let i = 0; i < playlistInfo.tracks.length; i++) {
      const track = playlistInfo.tracks[i]
      
      // Insert track (or ignore if exists)
      queries.insertYTTrack.run(
        track.videoId,
        track.title,
        track.artist,
        track.album,
        track.duration,
        track.thumbnailUrl
      )

      // Get track ID
      const ytTrack = queries.getYTTrackByVideoId.get(track.videoId)
      if (ytTrack) {
        queries.addToYTPlaylist.run(newPlaylistId, ytTrack.id, i + 1)
      }
    }

    return NextResponse.json({ 
      message: "Playlist imported successfully",
      playlist: {
        id: newPlaylistId,
        ...playlistInfo
      }
    })
  } catch (error) {
    const authResponse = authErrorResponse(error)
    if (authResponse) return authResponse
    console.error("[v0] Import YT playlist error:", error)
    return NextResponse.json({ error: "Failed to import playlist" }, { status: 500 })
  }
}
