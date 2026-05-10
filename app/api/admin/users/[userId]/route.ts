import { NextRequest, NextResponse } from "next/server"
import { queries } from "@/lib/db"
import { authErrorResponse, requireAdminAccess } from "@/lib/auth-policy"

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const admin = await requireAdminAccess(request)
    const { userId } = await params
    const id = parseInt(userId)

    if (isNaN(id)) {
      return NextResponse.json({ error: "Invalid user ID" }, { status: 400 })
    }

    if (id === admin.id) {
      return NextResponse.json({ error: "Cannot delete yourself" }, { status: 400 })
    }

    // Delete user sessions first
    queries.deleteUserSessions.run(id)
    // Then delete the user
    queries.deleteUser.run(id)

    return NextResponse.json({ success: true })
  } catch (error) {
    const authResponse = authErrorResponse(error)
    if (authResponse) return authResponse
    console.error("[v0] Delete user error:", error)
    return NextResponse.json({ error: "Failed to delete user" }, { status: 500 })
  }
}
