import { NextRequest, NextResponse } from "next/server"
import db, { type Track, type YTTrack } from "@/lib/db"
import { getSessionOrDemo, isDemoSessionEnabled } from "@/lib/auth-policy"
import { getDemoMixes } from "@/lib/demo-data"
import {
  buildTasteProfile,
  isDislikedLocal,
  scoreLocalTrack,
} from "@/lib/recommendation-engine"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionOrDemo(request)
    const localTracks = db.prepare("SELECT * FROM tracks ORDER BY created_at DESC").all() as Track[]
    const ytTracks = db.prepare("SELECT * FROM yt_tracks ORDER BY created_at DESC").all() as YTTrack[]

    if (localTracks.length === 0) {
      return NextResponse.json({
        recommendations: isDemoSessionEnabled() ? getDemoMixes().discoverMix : [],
      })
    }

    const profile = buildTasteProfile(user?.id ?? null, localTracks, ytTracks, request)
    const recommendations = localTracks
      .filter((track) => !isDislikedLocal(track.id, profile))
      .map((track) => ({
        track,
        score: scoreLocalTrack(track, profile, "discover"),
      }))
      .sort((a, b) => b.score - a.score || b.track.created_at.localeCompare(a.track.created_at))
      .slice(0, 15)
      .map((item) => ({ ...item.track, source: "local" as const }))

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
