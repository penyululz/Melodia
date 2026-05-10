import "server-only"

import Busboy from "busboy"
import fs from "fs"
import os from "os"
import path from "path"
import { randomUUID } from "crypto"
import { Readable } from "stream"
import type { NextRequest } from "next/server"
import { formatBytes, getUploadLimits } from "@/lib/upload-limits"
import { isMediaFile, isSubtitleFile } from "@/lib/format"

export interface ParsedUploadFile {
  originalName: string
  tempPath: string
  size: number
  mimeType: string
  kind: "media" | "subtitle"
}

export interface ParsedUpload {
  files: ParsedUploadFile[]
  errors: string[]
}

export class UploadLimitError extends Error {
  status = 413
}

export function assertUploadRequestSize(request: NextRequest): void {
  const contentLength = Number(request.headers.get("content-length") || 0)
  const { maxRequestBytes } = getUploadLimits()

  if (contentLength > maxRequestBytes) {
    throw new UploadLimitError(`Upload request is too large. Limit is ${formatBytes(maxRequestBytes)}.`)
  }
}

export async function parseMediaUpload(request: NextRequest): Promise<ParsedUpload> {
  assertUploadRequestSize(request)

  if (!request.body) {
    return { files: [], errors: ["No upload body was provided"] }
  }

  const headers = Object.fromEntries(request.headers.entries())
  const uploadTempDir = path.join(os.tmpdir(), "melodia-uploads")
  const { maxFileBytes } = getUploadLimits()
  fs.mkdirSync(uploadTempDir, { recursive: true })

  return new Promise((resolve, reject) => {
    const files: ParsedUploadFile[] = []
    const errors: string[] = []
    const pending: Promise<void>[] = []
    const busboy = Busboy({
      headers,
      limits: {
        fileSize: maxFileBytes,
      },
    })

    busboy.on("file", (fieldName, file, info) => {
      const originalName = sanitizeFileName(info.filename || "upload")

      if (fieldName !== "files") {
        file.resume()
        return
      }

      const kind = isMediaFile(originalName) ? "media" : isSubtitleFile(originalName) ? "subtitle" : null
      if (!kind) {
        errors.push(`${originalName}: unsupported media format`)
        file.resume()
        return
      }

      const tempPath = path.join(uploadTempDir, `${randomUUID()}-${originalName}`)
      const output = fs.createWriteStream(tempPath, { flags: "wx" })
      let size = 0
      let limited = false

      file.on("data", (chunk: Buffer) => {
        size += chunk.length
      })

      file.on("limit", () => {
        limited = true
        errors.push(`${originalName}: file is larger than ${formatBytes(maxFileBytes)}`)
      })

      file.pipe(output)

      pending.push(new Promise((finish) => {
        output.on("finish", () => {
          if (limited) {
            fs.rmSync(tempPath, { force: true })
          } else {
            files.push({
              originalName,
              tempPath,
              size,
              mimeType: info.mimeType || "application/octet-stream",
              kind,
            })
          }
          finish()
        })

        output.on("error", (error) => {
          fs.rmSync(tempPath, { force: true })
          errors.push(`${originalName}: ${error instanceof Error ? error.message : "upload failed"}`)
          finish()
        })
      }))
    })

    busboy.on("error", reject)
    busboy.on("finish", async () => {
      try {
        await Promise.all(pending)
        resolve({ files, errors })
      } catch (error) {
        reject(error)
      }
    })

    Readable.fromWeb(request.body as any).pipe(busboy)
  })
}

export function sanitizeFileName(fileName: string): string {
  const parsed = path.parse(fileName)
  const base = parsed.name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  const ext = parsed.ext.toLowerCase()
  return `${base || "upload"}${ext}`
}
