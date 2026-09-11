import type { Evidence } from "@/lib/types";

// The evidence scale, rendered.
//   documented   solid
//   corroborated solid, with a note
//   reported     reduced opacity
//   unknown      a labeled void
const STYLES: Record<Evidence, string> = {
  documented: "bg-ink text-paper border-ink",
  corroborated: "bg-ink text-paper border-ink",
  reported: "bg-transparent text-ink border-ink opacity-50",
  unknown: "bg-transparent text-ink-3 border-ink-3 border-dashed",
};

const LABELS: Record<Evidence, string> = {
  documented: "documented",
  corroborated: "corroborated",
  reported: "reported",
  unknown: "no record",
};

export function EvidenceBadge({ level, note }: { level: Evidence; note?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] uppercase tracking-wide leading-none ${STYLES[level]}`}
      title={EVIDENCE_TITLES[level]}
    >
      {LABELS[level]}
      {level === "corroborated" && note !== false ? <span aria-hidden>*</span> : null}
    </span>
  );
}

export const EVIDENCE_TITLES: Record<Evidence, string> = {
  documented: "Directly attested in a contemporaneous or primary source",
  corroborated: "Multiple independent secondary sources agree, no primary found",
  reported: "A single secondary source, uncorroborated",
  unknown: "The record is silent",
};

/** Row-level treatment. Reported rows go lighter; unknown rows are a labeled void. */
export function evidenceRowClass(level: Evidence): string {
  if (level === "reported") return "opacity-60";
  if (level === "unknown") return "text-ink-3 italic";
  return "";
}
