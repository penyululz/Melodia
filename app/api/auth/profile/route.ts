import { NextRequest, NextResponse } from "next/server"
import { getSession } from "@/lib/auth"
import { queries } from "@/lib/db"

export async function PATCH(request: NextRequest) {
  try {
    const user = await getSession()
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    const { name } = await request.json()

    if (!name || name.trim().length < 2) {
      return NextResponse.json(
        { error: "Name must be at least 2 characters" },
        { status: 400 }
      )
    }

    queries.updateUser.run(name.trim(), user.avatar_url, user.id)

    return NextResponse.json({
      user: {
        ...user,
        name: name.trim(),
      },
    })
  } catch (error) {
    console.error("[v0] Profile update error:", error)
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 })
  }
}
