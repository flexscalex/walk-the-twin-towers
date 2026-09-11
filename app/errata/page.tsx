import type { Metadata } from "next";
import { loadErrata } from "@/lib/data";

export const metadata: Metadata = { title: "Errata" };

export default function ErrataPage() {
  const rows = loadErrata();
  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-semibold tracking-tight">Errata</h1>
      <p className="mt-2 leading-relaxed text-ink-2">
        A dated log of corrections to the data or the text on this site. People who worked in these buildings will
        spot things. When they do, the fix is recorded here with what changed and why.
      </p>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">Format</h2>
        <p className="mt-2 text-sm text-ink-2">
          Each entry is one row in <span className="font-mono text-xs">data/errata.json</span>, newest first:
        </p>
        <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-y-1 text-sm">
          <dt className="font-mono text-xs text-ink-3">date</dt><dd>YYYY-MM-DD the correction shipped.</dd>
          <dt className="font-mono text-xs text-ink-3">subject</dt><dd>What it touches, for example tenant:wtc1-042, geometry:wtc2.floors, method.</dd>
          <dt className="font-mono text-xs text-ink-3">was</dt><dd>The text or value before, verbatim.</dd>
          <dt className="font-mono text-xs text-ink-3">now</dt><dd>The text or value after, verbatim.</dd>
          <dt className="font-mono text-xs text-ink-3">why</dt><dd>The reason, and who raised it if they want to be named.</dd>
          <dt className="font-mono text-xs text-ink-3">source_id</dt><dd>The source that supports the correction, or null if it is a transcription fix against the existing source.</dd>
        </dl>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">Log</h2>
        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-ink-3">No corrections recorded yet.</p>
        ) : (
          <ol className="mt-2 divide-y divide-rule border-y border-rule text-sm">
            {[...rows].sort((a, b) => b.date.localeCompare(a.date)).map((r, i) => (
              <li key={`${r.date}-${r.subject}-${i}`} className="py-3">
                <p className="text-xs text-ink-3">{r.date} <span className="font-mono">{r.subject}</span></p>
                <p className="mt-1"><span className="text-ink-3">Was:</span> {r.was}</p>
                <p><span className="text-ink-3">Now:</span> {r.now}</p>
                <p className="mt-1 text-ink-2">{r.why}</p>
                {r.source_id ? <p className="mt-1 text-xs text-ink-3">Source: {r.source_id}</p> : null}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
