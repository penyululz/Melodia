import { NextRequest, NextResponse } from "next/server"
import db, { queries, YTPlaylist, YTTrack } from "@/lib/db"
import { authErrorResponse, requireMutationAuth } from "@/lib/auth-policy"

type RouteParams = { params: Promise<{ id: string }> }

// GET - Get playlist with tracks
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const playlistId = parseInt(id, 10)

    const playlist = queries.getYTPlaylistById.get(playlistId) as YTPlaylist | null
    if (!playlist) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 })
    }

    const tracks = queries.getYTPlaylistTracks.all(playlistId) as YTTrack[]

    return NextResponse.json({ playlist, tracks })
  } catch (error) {
    console.error("[v0] Get YT playlist error:", error)
    return NextResponse.json({ error: "Failed to get playlist" }, { status: 500 })
  }
}

// DELETE - Remove imported playlist
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    await requireMutationAuth(request)
    const { id } = await params
    const playlistId = parseInt(id, 10)

    queries.deleteYTPlaylist.run(playlistId)

    return NextResponse.json({ message: "Playlist deleted" })
  } catch (error) {
    const authResponse = authErrorResponse(error)
    if (authResponse) return authResponse
    console.error("[v0] Delete YT playlist error:", error)
    return NextResponse.json({ error: "Failed to delete playlist" }, { status: 500 })
  }
}
