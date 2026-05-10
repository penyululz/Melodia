import { NextRequest, NextResponse } from "next/server"
import db from "@/lib/db"
import { authErrorResponse, requireMutationAuth } from "@/lib/auth-policy"
import { getPersistableUserId, getRecommendationContext } from "@/lib/recommendation-engine"

export const dynamic = "force-dynamic"

// POST: record a listen event
export async function POST(req: NextRequest) {
  try {
    const user = await requireMutationAuth(req)
    const { trackId, ytVideoId, source, eventType, completed, progressPct } = await req.json()
    const safeEventType = eventType === "skip" || eventType === "complete" ? eventType : "play"

    db.prepare(`
      INSERT INTO listen_history (user_id, track_id, yt_video_id, source, event_type, completed, progress_pct, device_type)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      getPersistableUserId(user?.id),
      trackId ?? null,
      ytVideoId ?? null,
      source ?? "local",
      safeEventType,
      completed ? 1 : 0,
      progressPct ?? 0,
      getRecommendationContext(req).deviceType
    )

    return NextResponse.json({ ok: true })
  } catch (error) {
    const authResponse = authErrorResponse(error)
    if (authResponse) return authResponse
    console.error("[history] post error:", error)
    return NextResponse.json({ error: "Failed to record history" }, { status: 500 })
  }
}

// DELETE: clear history for current user
export async function DELETE(req: NextRequest) {
  try {
    const user = await requireMutationAuth(req)
    const userId = getPersistableUserId(user?.id)

    db.prepare(`DELETE FROM listen_history WHERE user_id IS ?`).run(userId)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const authResponse = authErrorResponse(error)
    if (authResponse) return authResponse
    return NextResponse.json({ error: "Failed to clear history" }, { status: 500 })
  }
}
