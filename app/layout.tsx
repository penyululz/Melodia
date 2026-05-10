import type { Metadata, Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { AppShell } from '@/components/layout/app-shell'
import { AuthProvider } from '@/components/auth/auth-provider'
import { Toaster } from 'sonner'
import './globals.css'

const geist = Geist({ 
  subsets: ["latin"],
  variable: "--font-geist-sans",
})
const geistMono = Geist_Mono({ 
  subsets: ["latin"],
  variable: "--font-geist-mono",
})

export const metadata: Metadata = {
  applicationName: 'Melodia',
  title: 'Melodia - Personal Music Player',
  description: 'Your personal self-hosted music streaming service',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Melodia',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/icon.svg', type: 'image/svg+xml' },
    ],
    apple: '/apple-icon.png',
  },
}

export const viewport: Viewport = {
  themeColor: '#1a1a2e',
  width: 'device-width',
  initialScale: 1,
  // Allow zoom via pinch but keep layout stable. Don't lock scale.
  minimumScale: 1,
  maximumScale: 5,
  userScalable: true,
  // Support both portrait and landscape rotations
  interactiveWidget: 'resizes-content',
  // Enable safe-area-inset-* env vars for notched devices
  viewportFit: 'cover',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${geist.variable} ${geistMono.variable} bg-background`} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
        <Toaster theme="dark" position="top-center" />
      </body>
    </html>
  )
}

