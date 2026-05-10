import { NextRequest, NextResponse } from "next/server"
import db from "@/lib/db"
import { getDemoPlaylists } from "@/lib/demo-data"
import { authErrorResponse, isDemoSessionEnabled, requireMutationAuth } from "@/lib/auth-policy"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const playlists = db.prepare(`
      SELECT
        p.id,
        p.name,
        p.description,
        p.created_at,
        p.updated_at,
        (
          (SELECT COUNT(*) FROM playlist_tracks WHERE playlist_id = p.id) +
          (SELECT COUNT(*) FROM playlist_youtube_tracks WHERE playlist_id = p.id)
        ) as track_count
      FROM playlists p
      ORDER BY p.name
    `).all()

    return NextResponse.json(playlists.length > 0 ? playlists : isDemoSessionEnabled() ? getDemoPlaylists() : [])
  } catch (error) {
    console.error("Error fetching playlists:", error)
    if (isDemoSessionEnabled()) return NextResponse.json(getDemoPlaylists())
    return NextResponse.json({ error: "Failed to fetch playlists" }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireMutationAuth(req)
    const { name, description } = await req.json()

    if (!name?.trim()) {
      return NextResponse.json({ error: "Playlist name is required" }, { status: 400 })
    }

    const result = db.prepare(`
      INSERT INTO playlists (name, description, is_smart, smart_rules, is_demo, created_at, updated_at)
      VALUES (?, ?, 0, NULL, 0, datetime('now'), datetime('now'))
    `).run(name.trim(), description?.trim() || null)

    const playlist = db.prepare(`
      SELECT id, name, description, created_at, updated_at, 0 as track_count
      FROM playlists
      WHERE id = ?
    `).get(result.lastInsertRowid)

    return NextResponse.json(playlist, { status: 201 })
  } catch (error) {
    const authResponse = authErrorResponse(error)
    if (authResponse) return authResponse
    console.error("Error creating playlist:", error)
    return NextResponse.json({ error: "Failed to create playlist" }, { status: 500 })
  }
}
