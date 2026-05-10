import "server-only"

const DEFAULT_FILE_MB = 500
const DEFAULT_REQUEST_MB = 2048
const MB = 1024 * 1024

export interface UploadLimits {
  maxFileBytes: number
  maxRequestBytes: number
}

export function getUploadLimits(): UploadLimits {
  return {
    maxFileBytes: parseMegabytes(process.env.MAX_UPLOAD_FILE_MB, DEFAULT_FILE_MB) * MB,
    maxRequestBytes: parseMegabytes(process.env.MAX_UPLOAD_REQUEST_MB, DEFAULT_REQUEST_MB) * MB,
  }
}

export function formatBytes(bytes: number): string {
  const mb = bytes / MB
  return `${Math.round(mb)}MB`
}

function parseMegabytes(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}
