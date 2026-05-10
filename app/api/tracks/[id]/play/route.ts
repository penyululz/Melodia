import { NextRequest, NextResponse } from "next/server"
import { queries } from "@/lib/db"
import { authErrorResponse, requireMutationAuth } from "@/lib/auth-policy"

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const trackId = parseInt(id, 10)

  if (isNaN(trackId)) {
    return NextResponse.json({ error: "Invalid track ID" }, { status: 400 })
  }

  try {
    await requireMutationAuth(request)
    queries.incrementPlayCount.run(trackId)
    return NextResponse.json({ success: true })
  } catch (error) {
    const authResponse = authErrorResponse(error)
    if (authResponse) return authResponse
    console.error("Error incrementing play count:", error)
    return NextResponse.json(
      { error: "Failed to update play count" },
      { status: 500 }
    )
  }
}
