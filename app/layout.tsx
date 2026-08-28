import type { Metadata, Viewport } from "next"
import { Heebo, Geist_Mono } from "next/font/google"
import { Providers } from "./providers"
import { AppShell } from "./app-shell"
import "./globals.css"

// Heebo, not Geist. Geist ships no Hebrew glyphs and was loaded latin-only, so
// every Hebrew character in this Hebrew-first UI fell through to whatever the
// OS picked -- the app rendered in a different typeface on every machine while
// still paying to download a font it could barely use. Heebo covers Hebrew and
// Latin in one family, so mixed part-number/description lines stay in one voice.
const heebo = Heebo({
  variable: "--font-ui-sans",
  subsets: ["hebrew", "latin"],
  display: "swap",
})

// Mono stays Latin-only on purpose: it is for part numbers, VINs, doc numbers
// and timestamps, which are never Hebrew.
const geistMono = Geist_Mono({
  variable: "--font-ui-mono",
  subsets: ["latin"],
  display: "swap",
})

export const metadata: Metadata = {
  title: "Jan Parts Analytics",
  description: "Auto-parts inventory analytics dashboard",
}

// `viewportFit: 'cover'` is what makes env(safe-area-inset-*) resolve to a real
// value instead of 0 — the bottom nav's clearance depends on it.
// Deliberately no maximum-scale / user-scalable=no: pinch-zoom is the fallback
// for reading a dense table on a phone, and blocking it is an a11y failure.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfcfd" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1217" },
  ],
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="he" dir="rtl" suppressHydrationWarning>
      <body className={`${heebo.variable} ${geistMono.variable} font-sans antialiased`}>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  )
}
