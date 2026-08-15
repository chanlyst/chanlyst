import type { Metadata } from "next";
import { Onest, Wix_Madefor_Display } from "next/font/google";
import "./globals.css";

// Two faces, two jobs, and Cyrillic in both — the site carries a Russian
// switch, and a Latin-only face would silently fall back to a system font on
// half the copy.
//
// Geist did all three jobs before: headings, running text and numbers. It is
// Vercel's face and it is on half the SaaS landing pages published since 2024,
// which is most of why this site read as generated.
const display = Wix_Madefor_Display({
  variable: "--font-display",
  subsets: ["latin", "cyrillic"],
  weight: ["700", "800"],
  display: "swap",
});

const body = Onest({
  variable: "--font-body",
  subsets: ["latin", "cyrillic"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://chanlyst.com"),
  title: {
    default: "Chanlyst — find the channels your paying customers already use",
    template: "%s · Chanlyst",
  },
  description:
    "Contact databases give you people. Chanlyst gives you places — the directories, communities, creators, newsletters and partners that already own your paying audience — with the reason each one fits, what it requires, and outreach you approve before anything is sent.",
  alternates: { canonical: "/" },
  keywords: [
    "customer acquisition channels",
    "channel research",
    "partner discovery",
    "outreach research",
    "B2B SaaS distribution",
  ],
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    siteName: "Chanlyst",
    locale: "en_US",
    url: "https://chanlyst.com",
    title: "Chanlyst — from product to channels and ready-to-review outreach",
    description:
      "Find where your paying customers already are: directories, communities, creators, ad networks and partners, each with the reason it fits.",
    images: ["https://chanlyst.com/og-chanlyst.png"],
  },
  twitter: {
    card: "summary_large_image",
    title: "Chanlyst — find the channels your paying customers already use",
    description:
      "Channel research, fit explanations and drafted outreach. Nothing sends without you.",
    images: ["https://chanlyst.com/og-chanlyst.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
  // Matches the page ground, so the browser chrome on mobile stops fighting it.
  themeColor: "#fffaf1",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // English is what the server renders, so English is what gets indexed; the
    // RU switch lives in the browser and has no URL of its own.
    <html lang="en">
      <body className={`${display.variable} ${body.variable}`}>
        {children}
      </body>
    </html>
  );
}
