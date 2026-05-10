import { NextResponse } from "next/server"
import { queries } from "@/lib/db"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  try {
    const genres = queries.getGenres.all()
    return NextResponse.json({ genres })
  } catch (error) {
    console.error("Error fetching genres:", error)
    return NextResponse.json(
      { error: "Failed to fetch genres" },
      { status: 500 }
    )
  }
}
