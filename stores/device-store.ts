import { create } from "zustand"
import { persist } from "zustand/middleware"

// Generate a unique device ID that persists across sessions
function generateDeviceId(): string {
  return `device_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
}

// Detect device type from user agent
function detectDeviceType(): "desktop" | "tablet" | "mobile" {
  if (typeof window === "undefined") return "desktop"
  const ua = navigator.userAgent.toLowerCase()
  if (/mobile|iphone|ipod|android.*mobile|windows phone/i.test(ua)) return "mobile"
  if (/ipad|android(?!.*mobile)|tablet/i.test(ua)) return "tablet"
  return "desktop"
}

// Get device name
function getDeviceName(): string {
  if (typeof window === "undefined") return "Unknown Device"
  const ua = navigator.userAgent
  
  // Try to extract device/browser info
  if (/iPhone/i.test(ua)) return "iPhone"
  if (/iPad/i.test(ua)) return "iPad"
  if (/Mac/i.test(ua)) return "Mac"
  if (/Windows/i.test(ua)) return "Windows PC"
  if (/Android/i.test(ua)) return "Android Device"
  if (/Linux/i.test(ua)) return "Linux Device"
  
  return "Web Browser"
}

export interface Device {
  id: string
  name: string
  type: "desktop" | "tablet" | "mobile"
  isActive: boolean
  lastSeen: string
  currentTrackId?: string | number | null
  isPlaying?: boolean
}

interface DeviceState {
  deviceId: string
  deviceName: string
  deviceType: "desktop" | "tablet" | "mobile"
  
  // Initialize device on first load
  initDevice: () => void
  
  // Rename this device
  renameDevice: (name: string) => void
}

export const useDeviceStore = create<DeviceState>()(
  persist(
    (set, get) => ({
      deviceId: "",
      deviceName: "",
      deviceType: "desktop",

      initDevice: () => {
        const current = get()
        if (current.deviceId) return // Already initialized

        set({
          deviceId: generateDeviceId(),
          deviceName: getDeviceName(),
          deviceType: detectDeviceType(),
        })
      },

      renameDevice: (name: string) => {
        set({ deviceName: name })
      },
    }),
    {
      name: "melodia-device",
      partialize: (state) => ({
        deviceId: state.deviceId,
        deviceName: state.deviceName,
        deviceType: state.deviceType,
      }),
    }
  )
)
