import Link from "next/link";
import { GITHUB_URL, SITE_NAME } from "@/lib/site";

const LINKS = [
  { href: "/towers", label: "Towers" },
  { href: "/directory", label: "Directory" },
  { href: "/method", label: "Method" },
  { href: "/errata", label: "Errata" },
  { href: GITHUB_URL, label: "GitHub" },
];

export function SiteNav() {
  return (
    <header className="border-b border-rule bg-paper-2">
      <div className="mx-auto flex max-w-6xl flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight no-underline">
          <span aria-hidden className="flex items-end gap-[3px]">
            <span className="block h-5 w-[6px] bg-ink" />
            <span className="block h-[18px] w-[6px] bg-ink" />
          </span>
          {SITE_NAME}
        </Link>
        <nav className="flex gap-5 text-sm text-ink-2">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className="no-underline hover:text-ink">
              {l.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-rule">
      <div className="mx-auto max-w-6xl px-4 py-6 text-xs text-ink-3 sm:px-6">
        <p>
          Tenant list: CNN.com, from CoStar Group, Inc., as archived by the Internet Archive on 2001-09-13. Cited,
          not owned. Extraction, schema and text: CC BY 4.0. Code: MIT.
        </p>
        <p className="mt-1">Early preview. Walk mode, a first-person view inside a floor, is in progress. Corrections welcome on GitHub.</p>
      </div>
    </footer>
  );
}
