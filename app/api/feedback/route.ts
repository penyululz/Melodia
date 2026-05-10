import { NextRequest, NextResponse } from "next/server"
import db from "@/lib/db"
import { authErrorResponse, getSessionOrDemo, requireMutationAuth } from "@/lib/auth-policy"
import { getPersistableUserId } from "@/lib/recommendation-engine"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type FeedbackAction = "like" | "dislike" | null

export async function GET(request: NextRequest) {
  try {
    const user = await getSessionOrDemo(request)
    const target = getFeedbackTarget(request)

    const userId = getPersistableUserId(user?.id)

    if (!user || !target) {
      return NextResponse.json({ action: null })
    }

    const row = target.ytVideoId
      ? db.prepare(`
          SELECT action
          FROM track_feedback
          WHERE user_id IS ? AND yt_video_id = ?
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 1
        `).get(userId, target.ytVideoId) as { action: FeedbackAction } | null
      : db.prepare(`
          SELECT action
          FROM track_feedback
          WHERE user_id IS ? AND track_id = ? AND yt_video_id IS NULL
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 1
        `).get(userId, target.trackId) as { action: FeedbackAction } | null

    return NextResponse.json({ action: row?.action ?? null })
  } catch (error) {
    console.error("[feedback] get error:", error)
    return NextResponse.json({ action: null })
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireMutationAuth(request)
    const body = await request.json()
    const userId = getPersistableUserId(user.id)
    const action = normalizeAction(body.action)
    const trackId = normalizeTrackId(body.trackId)
    const ytVideoId = normalizeVideoId(body.ytVideoId)
    const source = ytVideoId ? "youtube" : "local"

    if (!trackId && !ytVideoId) {
      return NextResponse.json({ error: "Missing feedback target" }, { status: 400 })
    }

    const save = db.transaction(() => {
      if (ytVideoId) {
        db.prepare(`
          DELETE FROM track_feedback
          WHERE user_id IS ? AND yt_video_id = ?
        `).run(userId, ytVideoId)
      } else {
        db.prepare(`
          DELETE FROM track_feedback
          WHERE user_id IS ? AND track_id = ? AND yt_video_id IS NULL
        `).run(userId, trackId)
      }

      if (action) {
        db.prepare(`
          INSERT INTO track_feedback (user_id, track_id, yt_video_id, source, action)
          VALUES (?, ?, ?, ?, ?)
        `).run(userId, trackId, ytVideoId, source, action)
      }
    })

    save()

    return NextResponse.json({ action })
  } catch (error) {
    const authResponse = authErrorResponse(error)
    if (authResponse) return authResponse
    console.error("[feedback] post error:", error)
    return NextResponse.json({ error: "Failed to save feedback" }, { status: 500 })
  }
}

function getFeedbackTarget(request: NextRequest): { trackId: number | null; ytVideoId: string | null } | null {
  const trackId = normalizeTrackId(request.nextUrl.searchParams.get("trackId"))
  const ytVideoId = normalizeVideoId(request.nextUrl.searchParams.get("ytVideoId"))
  if (!trackId && !ytVideoId) return null
  return { trackId, ytVideoId }
}

function normalizeAction(action: unknown): FeedbackAction {
  return action === "like" || action === "dislike" ? action : null
}

function normalizeTrackId(trackId: unknown): number | null {
  const id = Number(trackId)
  return Number.isInteger(id) && id > 0 ? id : null
}

function normalizeVideoId(videoId: unknown): string | null {
  return typeof videoId === "string" && videoId.trim() ? videoId.trim() : null
}
