import { NextRequest, NextResponse } from "next/server"
import { getSession, hashPassword, verifyPassword } from "@/lib/auth"
import { queries, User } from "@/lib/db"

export async function POST(request: NextRequest) {
  try {
    const sessionUser = await getSession()
    if (!sessionUser) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { currentPassword, newPassword } = await request.json()

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { error: "Current and new password are required" },
        { status: 400 }
      )
    }

    if (newPassword.length < 8) {
      return NextResponse.json(
        { error: "New password must be at least 8 characters" },
        { status: 400 }
      )
    }

    // Get user with password hash
    const user = queries.getUserById.get(sessionUser.id) as User | null
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    // Verify current password
    const isValid = await verifyPassword(currentPassword, user.password_hash)
    if (!isValid) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 })
    }

    // Hash and update new password
    const newHash = await hashPassword(newPassword)
    queries.updateUserPassword.run(newHash, user.id)

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("[v0] Password change error:", error)
    return NextResponse.json({ error: "Failed to change password" }, { status: 500 })
  }
}
