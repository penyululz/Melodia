export interface LoudnessAdjustedTrack {
  loudness_adjust_db?: number | null
  replaygain_track_gain?: number | null
  replaygain_album_gain?: number | null
}

const MIN_GAIN_DB = -12
const MAX_GAIN_DB = 12

export function getTrackGainDb(track: LoudnessAdjustedTrack | null | undefined): number {
  const rawGain =
    track?.loudness_adjust_db ??
    track?.replaygain_track_gain ??
    track?.replaygain_album_gain ??
    0
  const gain = Number(rawGain)

  if (!Number.isFinite(gain)) return 0
  return Math.min(MAX_GAIN_DB, Math.max(MIN_GAIN_DB, gain))
}

export function getTrackLinearGain(track: LoudnessAdjustedTrack | null | undefined): number {
  return Math.pow(10, getTrackGainDb(track) / 20)
}

export function getNormalizedVolume(
  volume: number,
  isMuted: boolean,
  track: LoudnessAdjustedTrack | null | undefined
): number {
  if (isMuted) return 0

  const baseVolume = Math.min(1, Math.max(0, Number(volume) || 0))
  return Math.min(1, Math.max(0, baseVolume * getTrackLinearGain(track)))
}

export function getBaseVolumeForNormalizedVolume(
  normalizedVolume: number,
  track: LoudnessAdjustedTrack | null | undefined
): number {
  const targetVolume = Math.min(1, Math.max(0, Number(normalizedVolume) || 0))
  const linearGain = getTrackLinearGain(track)

  if (!Number.isFinite(linearGain) || linearGain <= 0) return targetVolume
  return Math.min(1, Math.max(0, targetVolume / linearGain))
}
