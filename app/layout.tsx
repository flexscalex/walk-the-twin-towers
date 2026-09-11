import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Archivo } from "next/font/google";
import { SiteFooter, SiteNav } from "@/components/SiteNav";
import { SITE_NAME, TAGLINE } from "@/lib/site";
import "./globals.css";

const archivo = Archivo({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-archivo", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://walk-the-twin-towers.vercel.app"),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: TAGLINE,
  openGraph: { title: SITE_NAME, description: TAGLINE, images: ["/og.png"], type: "website" },
  twitter: { card: "summary_large_image", title: SITE_NAME, description: TAGLINE, images: ["/og.png"] },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={archivo.variable}>
      <body className="flex min-h-screen flex-col">
        <SiteNav />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">{children}</main>
        <SiteFooter />
        <Analytics />
      </body>
    </html>
  );
}
