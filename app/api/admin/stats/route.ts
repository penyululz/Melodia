import { NextResponse } from "next/server"
import { queries } from "@/lib/db"
import { authErrorResponse, requireAdminAccess } from "@/lib/auth-policy"

export async function GET() {
  try {
    await requireAdminAccess()

    const users = queries.getAllUsers.all()
    const fullStats = queries.getFullLibraryStats.get() as any

    return NextResponse.json({
      stats: {
        totalUsers: users.length,
        localTracks: fullStats?.local_tracks || 0,
        ytTracks: fullStats?.yt_tracks || 0,
        cachedTracks: fullStats?.cached_yt_tracks || 0,
      },
    })
  } catch (error) {
    const authResponse = authErrorResponse(error)
    if (authResponse) return authResponse
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 })
  }
}
