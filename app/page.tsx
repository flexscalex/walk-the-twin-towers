import Image from "next/image";
import Link from "next/link";
import { formatInt, getBuildings, getTenants, loadTenants, sqFtAccountedFor } from "@/lib/tenants";
import { AUTHOR, GITHUB_URL, SITE_NAME, SOCIAL } from "@/lib/site";

export default function HomePage() {
  const { source } = loadTenants();
  const buildings = getBuildings();
  const all = getTenants();
  const totalSqFt = sqFtAccountedFor(all);
  const towerTenants = all.filter((t) => t.building_id === "wtc1" || t.building_id === "wtc2").length;
  const social = SOCIAL.filter((s) => s.href);

  return (
    <div className="-mt-8">
      {/* Hero band: full-bleed navy */}
      <section className="-mx-4 bg-navy px-4 py-12 text-paper sm:-mx-6 sm:px-6 lg:py-16">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1fr_1fr] lg:items-center">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-signal">Open history, built with AI</p>
            <h1 className="mt-3 text-5xl font-bold leading-[0.95] tracking-tight sm:text-6xl">{SITE_NAME}</h1>
            <p className="mt-5 max-w-lg text-lg leading-relaxed text-paper/85">
              Step inside the World Trade Center as it worked in 2001. Walk in the front door, ride the express
              elevator to the 78th floor, find out who leased the 89th, and see the source behind every fact.
            </p>
            <p className="mt-3 max-w-lg text-base text-paper/70">
              {formatInt(towerTenants)} companies and agencies across two 110-story towers, from a 2001 listing and
              the engineering record. Nothing invented. Everything checkable. Open source: go make it better.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Link href="/towers" className="rounded-sm bg-signal px-5 py-3 text-base font-semibold text-paper no-underline hover:bg-[#a90d26]">
                Start exploring
              </Link>
              <Link href="/walk/wtc1/lobby" className="rounded-sm border border-paper/60 px-4 py-3 text-base text-paper no-underline hover:border-paper">
                Walk in the front door
              </Link>
              <a href={GITHUB_URL} className="px-2 py-3 text-sm text-paper/70 no-underline hover:text-paper" rel="noreferrer noopener">
                Source code
              </a>
            </div>
            <p className="mt-4 text-xs text-paper/55">
              Any modern browser, desktop or phone. No account, no download.
              {source === "fixture" ? " This build is running on a three-row fixture." : null}
            </p>
          </div>
          <Link href="/towers" className="block overflow-hidden rounded-md border border-paper/20 bg-navy-2 no-underline" aria-label="Open the towers view">
            <Image src="/preview.gif" alt="Both towers in Lower Manhattan, each floor tinted by its dominant industry" width={720} height={456} unoptimized priority className="block h-auto w-full" />
            <p className="px-3 py-2 text-xs text-paper/60">Every floor tinted by the industry that leased the most space on it. Type a company name and fly to its floor.</p>
          </Link>
        </div>
      </section>

      {/* Three things to do */}
      <section className="mx-auto mt-12 grid max-w-6xl gap-4 sm:grid-cols-3">
        {[
          { n: "1", h: "Orbit the towers", p: "Both towers in the Lower Manhattan of 2001, built from published structural dimensions. Hover a floor, click it.", href: "/towers", cta: "Open the towers" },
          { n: "2", h: "Ride up and walk a floor", p: "Start in the plaza lobby, take an express car to a sky lobby, transfer to a local, step out onto a floor and read who was there.", href: "/walk/wtc1/lobby", cta: "Enter the lobby" },
          { n: "3", h: "Check every source", p: `All ${formatInt(all.length)} tenants across ${buildings.length} buildings, the original listing beside each one, and every judgment call in public.`, href: "/directory", cta: "Open the directory" },
        ].map((c) => (
          <div key={c.n} className="rounded-md border border-rule bg-paper-2 p-5">
            <p className="text-3xl font-bold text-signal">{c.n}</p>
            <h2 className="mt-1 text-lg font-semibold">{c.h}</h2>
            <p className="mt-1 text-sm text-ink-2">{c.p}</p>
            <Link href={c.href} className="mt-3 inline-block text-sm font-medium">{c.cta}</Link>
          </div>
        ))}
      </section>

      {/* Short, expandable back matter */}
      <section className="mx-auto mt-12 max-w-3xl space-y-3">
        <details className="rounded-md border border-rule bg-paper-2 px-5 py-4">
          <summary className="text-lg font-semibold">Why this exists, in sixty seconds</summary>
          <div className="mt-3 space-y-3 text-ink-2">
            <p>
              Most 3D reconstructions of famous buildings are pretty and unsourced. This one takes the opposite bet.
              The tenant list is a September 2001 listing compiled by CoStar and published by CNN, preserved by the
              Internet Archive. The geometry comes from the NIST engineering reports, page by page. Where the record is
              silent, the model says so instead of filling the gap. {formatInt(totalSqFt)} square feet of leases are
              accounted for, and every one of them can be traced.
            </p>
            <p>
              It is also an experiment in how one person can use AI to build an interactive learning experience
              without letting the AI make anything up: every dimension, tenant and sentence was checked against a
              source before it shipped, and the checking is public on the <Link href="/method">method page</Link>.
            </p>
          </div>
        </details>
        <details className="rounded-md border border-rule bg-paper-2 px-5 py-4">
          <summary className="text-lg font-semibold">Build it yourself</summary>
          <div className="mt-3 text-ink-2">
            <p>The code, the data and the reasoning are open. Clone it, run it, make it better, and give credit.</p>
            <pre className="mt-3 overflow-x-auto rounded-sm border border-rule bg-paper p-4 text-sm"><code>{`git clone ${GITHUB_URL}.git
cd walk-the-twin-towers
pnpm install
pnpm dev`}</code></pre>
            <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
              <li>Open http://localhost:3000. The towers build their geometry from the cited parameters on first run.</li>
              <li>Found a mistake or a better source? Open an issue or a pull request with the citation.</li>
              <li>Code is MIT. Data and text are CC BY 4.0. Cite the project and link back. The tenant list belongs to CNN and CoStar.</li>
            </ol>
            <a href={GITHUB_URL} className="mt-3 inline-block rounded-sm border border-ink px-4 py-2 text-sm no-underline" rel="noreferrer noopener">View on GitHub</a>
          </div>
        </details>
      </section>

      <section className="mx-auto mt-12 max-w-3xl border-t border-rule pt-6 text-sm text-ink-2">
        <p>
          Made by {AUTHOR}. Early preview: the city around the towers, the walk mode and the exhibits are all still
          growing. Corrections welcome on GitHub.
        </p>
        {social.length ? (
          <p className="mt-2 flex flex-wrap gap-4">
            {social.map((s) => (
              <a key={s.label} href={s.href!} rel="noreferrer noopener me">{s.label}</a>
            ))}
          </p>
        ) : null}
      </section>
    </div>
  );
}
