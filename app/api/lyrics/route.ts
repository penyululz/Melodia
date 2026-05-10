import { NextRequest, NextResponse } from "next/server"
import { getOrFetchLyrics } from "@/lib/lyrics-service"

export const dynamic = "force-dynamic"

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const title = searchParams.get("title") ?? ""

  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 })
  }

  try {
    const lyrics = await getOrFetchLyrics({
      title,
      artist: searchParams.get("artist") ?? "",
      album: searchParams.get("album") ?? "",
      duration: searchParams.get("duration") ?? "",
      trackId: searchParams.get("trackId"),
      videoId: searchParams.get("videoId"),
    })

    return NextResponse.json(lyrics)
  } catch (err) {
    console.error("[lyrics] fetch error:", err)
    return NextResponse.json({ plainLyrics: null, syncedLyrics: null, source: null })
  }
}
