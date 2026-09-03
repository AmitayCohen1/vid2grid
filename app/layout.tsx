import type { Metadata } from "next";
import { Geist, Geist_Mono, Newsreader } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
const newsreader = Newsreader({ subsets: ["latin"], style: ["normal", "italic"], variable: "--font-newsreader" });

const SITE = "https://vid2grid.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "Video — Movement Languages", template: "%s — Movement Languages" },
  description: "Film a phrase, read it back: a short video of one dancer becomes a grid-snapped, playable 3D score in Labanotation and Eshkol-Wachman terms.",
  applicationName: "Movement Languages",
  openGraph: {
    type: "website",
    siteName: "Movement Languages",
    url: SITE,
    title: "Video — Movement Languages",
    description: "A short video of one dancer becomes a grid-snapped, playable 3D score.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${geist.variable} ${geistMono.variable} ${newsreader.variable}`}>
      <body>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
