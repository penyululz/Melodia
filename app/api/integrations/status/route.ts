import { NextResponse } from "next/server"
import { getQuotaStatus } from "@/lib/api-cache"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function GET() {
  const youtubeDailyBudget = Number.parseInt(process.env.YOUTUBE_DATA_DAILY_SEARCH_BUDGET || "1000", 10)
  const googleImageDailyBudget = Number.parseInt(process.env.GOOGLE_CSE_DAILY_IMAGE_BUDGET || "25", 10)

  return NextResponse.json({
    youtubeDataApi: {
      configured: Boolean(process.env.YOUTUBE_DATA_API_KEY || process.env.GOOGLE_API_KEY),
      quota: getQuotaStatus("youtube-data-api", Number.isFinite(youtubeDailyBudget) ? youtubeDailyBudget : 1000),
      cacheTtlHours: Number.parseInt(process.env.YOUTUBE_SEARCH_CACHE_TTL_HOURS || "24", 10),
    },
    googleCustomSearch: {
      configured: Boolean(
        (process.env.GOOGLE_CUSTOM_SEARCH_API_KEY || process.env.GOOGLE_API_KEY) &&
          (process.env.GOOGLE_CUSTOM_SEARCH_CX || process.env.GOOGLE_CSE_ID)
      ),
      quota: getQuotaStatus(
        "google-custom-search",
        Number.isFinite(googleImageDailyBudget) ? googleImageDailyBudget : 25
      ),
      cacheTtlDays: Number.parseInt(process.env.ARTWORK_CACHE_TTL_DAYS || "30", 10),
    },
  })
}
