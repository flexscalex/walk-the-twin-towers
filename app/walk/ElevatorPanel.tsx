"use client";
// The elevator panel. A list drawn from the cited system (JourneyData), not a
// drawn bank: no cab, shaft or door is cited, so none is modelled. Which
// buttons appear depends on where the visitor is, under the rules in paradata
// P-073: from the Plaza lobby, the express cars to each sky lobby and the
// locals of the lowest zone; from a sky lobby, that zone's locals and the
// express car back down; from a floor, its zone's locals only. Selecting a
// floor plays a counter that ticks past each floor name and its tenant count,
// then navigates to that floor's walk route.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { EvidenceBadge } from "@/components/EvidenceBadge";
import type { JourneyData, JourneyFloor, JourneyZone } from "@/lib/journey";
import type { WalkParam } from "@/lib/walk";

export type WalkLocation = { kind: "lobby" } | { kind: "floor"; floor: number };

interface Stop {
  key: string;
  label: string;
  /** null when the stop cannot be selected (no cited elevation). */
  href: string | null;
  floor: number | null;
  sub: string | null;
  disabledWhy: string | null;
}

interface Section {
  key: string;
  title: string;
  note: string | null;
  stops: Stop[];
}

function walkHref(buildingId: string, floor: number, lobbyFloor: number): string {
  return floor === lobbyFloor ? `/walk/${buildingId}/lobby` : `/walk/${buildingId}/${floor}`;
}

function zoneOf(zones: JourneyZone[], floor: number): JourneyZone {
  const z = zones.find((z) => floor >= z.from && floor <= z.to);
  if (!z) throw new Error(`elevators: floor ${floor} is in no zone`);
  return z;
}

function floorLabel(f: JourneyFloor, lobbyFloor: number): string {
  if (f.floor === lobbyFloor) return "Plaza lobby";
  return `Floor ${f.floor}`;
}

function rowsLabel(rows: number): string {
  return rows === 0 ? "no tenant record" : `${rows} ${rows === 1 ? "row" : "rows"}`;
}

function floorSub(f: JourneyFloor): string {
  const parts: string[] = [];
  if (f.usage) parts.push(f.usage);
  parts.push(rowsLabel(f.rows));
  if (f.hasPlate && f.plateEvidence === "reported") parts.push("elevation reported");
  return parts.join(", ");
}

function stopFor(j: JourneyData, f: JourneyFloor): Stop {
  const sub = floorSub(f);
  if (!f.hasPlate) {
    return { key: String(f.floor), label: floorLabel(f, j.lobbyFloor), href: null, floor: f.floor, sub, disabledWhy: "no cited elevation" };
  }
  return { key: String(f.floor), label: floorLabel(f, j.lobbyFloor), href: walkHref(j.buildingId, f.floor, j.lobbyFloor), floor: f.floor, sub, disabledWhy: null };
}

/** The buttons reachable from a location, under the P-073 rules. */
export function elevatorSections(j: JourneyData, loc: WalkLocation): Section[] {
  const byFloor = new Map(j.floors.map((f) => [f.floor, f]));
  const f = (n: number): JourneyFloor => {
    const x = byFloor.get(n);
    if (!x) throw new Error(`elevators: floor ${n} not in journey data`);
    return x;
  };
  const here = loc.kind === "lobby" ? j.lobbyFloor : loc.floor;
  const zone = zoneOf(j.zones, here);
  const localsOf = (z: JourneyZone): Stop[] => {
    const out: Stop[] = [];
    for (let n = z.from; n <= z.to; n++) if (n !== here) out.push(stopFor(j, f(n)));
    return out;
  };
  const sections: Section[] = [];
  const dedicatedFloors = j.floors.filter((x) => x.dedicatedExpress).map((x) => x.floor);

  if (here === j.lobbyFloor) {
    sections.push({
      key: "express",
      title: "Express elevators",
      note: `From the concourse to each sky lobby. ${j.counts.express44} cars to floor ${j.zones[1].skyLobby}, ${j.counts.express78} cars to floor ${j.zones[2].skyLobby}.`,
      stops: [j.zones[1], j.zones[2]].map((z) => {
        const fl = f(z.skyLobby as number);
        const s = stopFor(j, fl);
        return { ...s, key: `express-${fl.floor}`, label: `Sky lobby ${fl.floor}`, sub: `${z.expressCars} express cars, ${rowsLabel(fl.rows)}${fl.plateEvidence === "reported" ? ", elevation reported" : ""}` };
      }),
    });
    if (dedicatedFloors.length) {
      sections.push({
        key: "dedicated",
        title: "Dedicated express",
        note: j.facts.dedicated.map((d) => d.text).join(" "),
        stops: dedicatedFloors.map((n) => ({ ...stopFor(j, f(n)), key: `dedicated-${n}` })),
      });
    }
    sections.push({
      key: "local-low",
      title: `Local elevators, ${zone.label}`,
      note: `${j.counts.localPerZone} local cars per zone. Zone floor ranges are interpretive (paradata ${j.zoneParadata}).`,
      stops: localsOf(zone),
    });
    return sections;
  }

  const hereFloor = f(here);
  if (hereFloor.isSkyLobby) {
    sections.push({
      key: "local",
      title: `Local elevators, ${zone.label}`,
      note: `${j.counts.localPerZone} local cars per zone, boarded here after the express ride. Zone floor ranges are interpretive (paradata ${j.zoneParadata}).`,
      stops: localsOf(zone),
    });
    sections.push({
      key: "express-down",
      title: "Express elevator down",
      note: `${zone.expressCars} express cars between the concourse and this sky lobby.`,
      stops: [{ ...stopFor(j, f(j.lobbyFloor)), key: "express-lobby", label: "Plaza lobby", sub: `Floor ${j.lobbyFloor}, ${f(j.lobbyFloor).usage ?? ""}`.trim() }],
    });
    return sections;
  }

  sections.push({
    key: "local",
    title: `Local elevators, ${zone.label}`,
    note:
      zone.skyLobby === null
        ? `${j.counts.localPerZone} local cars per zone. To reach the floors above ${zone.to}, ride down to the Plaza lobby and take an express car. Zone floor ranges are interpretive (paradata ${j.zoneParadata}).`
        : `${j.counts.localPerZone} local cars per zone. To leave this zone, ride to sky lobby ${zone.skyLobby} and take the express car down. Zone floor ranges are interpretive (paradata ${j.zoneParadata}).`,
    stops: localsOf(zone),
  });
  if (hereFloor.dedicatedExpress) {
    sections.push({
      key: "dedicated-down",
      title: "Dedicated express down",
      note: j.facts.dedicated.map((d) => d.text).join(" "),
      stops: [{ ...stopFor(j, f(j.lobbyFloor)), key: "dedicated-lobby", label: "Plaza lobby", sub: `Floor ${j.lobbyFloor}` }],
    });
  }
  return sections;
}

interface Ride {
  from: number;
  to: number;
  href: string;
  /** Floors passed, in travel order, ending at the destination. */
  path: JourneyFloor[];
  index: number;
}

function ParamList({ ids, params }: { ids: string[]; params: Record<string, WalkParam> }) {
  const rows = ids.map((id) => params[id]).filter(Boolean);
  return (
    <ul className="mt-2 divide-y divide-rule border-y border-rule">
      {rows.map((p) => (
        <li key={p.id} className="py-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <code className="font-mono">{p.id}</code>
            <span className="tabular">
              {p.value} {p.unit}
            </span>
            <EvidenceBadge level={p.evidence} />
          </div>
          <p className="mt-0.5 text-ink-2">&ldquo;{p.quote}&rdquo;</p>
          <p className="mt-0.5 text-ink-3">
            {p.citation}. {p.locator}.
          </p>
        </li>
      ))}
    </ul>
  );
}

export function ElevatorPanel({
  journey,
  location,
  open,
  onClose,
}: {
  journey: JourneyData;
  location: WalkLocation;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [ride, setRide] = useState<Ride | null>(null);
  const [showSources, setShowSources] = useState(false);
  const sections = useMemo(() => elevatorSections(journey, location), [journey, location]);
  const here = location.kind === "lobby" ? journey.lobbyFloor : location.floor;
  const timer = useRef<number | null>(null);

  const board = (stop: Stop) => {
    if (!stop.href || stop.floor === null) return;
    const to = stop.floor;
    const step = to > here ? 1 : -1;
    const path: JourneyFloor[] = [];
    for (let n = here + step; step > 0 ? n <= to : n >= to; n += step) {
      const f = journey.floors.find((x) => x.floor === n);
      if (f) path.push(f);
    }
    setRide({ from: here, to, href: stop.href, path, index: 0 });
  };

  // Tick past each floor, then navigate. Total ride time is bounded so a
  // 100-floor express run does not take a minute.
  useEffect(() => {
    if (!ride) return;
    const n = ride.path.length;
    const perFloor = Math.max(40, Math.min(160, 2600 / Math.max(1, n)));
    if (ride.index >= n - 1) {
      timer.current = window.setTimeout(() => router.push(ride.href), 650);
      return () => {
        if (timer.current) window.clearTimeout(timer.current);
      };
    }
    timer.current = window.setTimeout(() => setRide((r) => (r ? { ...r, index: r.index + 1 } : r)), perFloor);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [ride, router]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (ride) {
    const at = ride.path[ride.index];
    const arrived = ride.index >= ride.path.length - 1;
    const dest = ride.path[ride.path.length - 1];
    return (
      <div className="absolute inset-0 z-40 flex items-center justify-center bg-ink p-4 text-paper" role="status" aria-live="polite">
        <div className="w-full max-w-sm rounded-sm border border-paper/40 bg-ink px-5 py-4">
          <p className="text-[10px] uppercase tracking-wide text-paper/70">
            {journey.buildingName} · {ride.to > ride.from ? "going up" : "going down"} · no cab is drawn (none is cited)
          </p>
          <p className="mt-2 text-5xl font-semibold tabular tracking-tight">{at ? (at.floor === journey.lobbyFloor ? "Plaza lobby" : at.floor) : ride.to}</p>
          <p className="mt-1 text-sm text-paper/85">{at ? floorSub(at) : ""}</p>
          <div className="mt-3 h-1 w-full bg-paper/20">
            <div className="h-1 bg-paper" style={{ width: `${Math.round(((ride.index + 1) / Math.max(1, ride.path.length)) * 100)}%` }} />
          </div>
          <p className="mt-2 text-xs text-paper/70">
            {arrived ? `Arriving at ${dest.floor === journey.lobbyFloor ? "the Plaza lobby" : `floor ${dest.floor}`}.` : `To ${dest.floor === journey.lobbyFloor ? "the Plaza lobby" : `floor ${dest.floor}`}, ${ride.path.length} ${ride.path.length === 1 ? "floor" : "floors"}.`}
          </p>
          <button type="button" onClick={() => router.push(ride.href)} className="mt-3 rounded-sm border border-paper/60 px-2 py-1 text-xs hover:bg-paper/10">
            Skip the ride
          </button>
        </div>
      </div>
    );
  }

  if (!open) return null;

  const stairsParams = journey.facts.stairs.flatMap((s) => s.params);
  const allParams = [...new Set([...journey.facts.system, ...journey.facts.skyLobby, ...journey.facts.stairs, journey.facts.freight, ...journey.facts.dedicated].flatMap((f) => f.params))];

  return (
    <div className="absolute inset-0 z-30 overflow-y-auto bg-paper p-3 text-xs sm:p-4" role="dialog" aria-modal="true" aria-label="Elevators">
      <div className="mx-auto max-w-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-wide text-ink-3">{journey.buildingName}</p>
            <h2 className="text-xl font-semibold tracking-tight">Elevators</h2>
            <p className="mt-0.5 text-ink-2">
              You are {location.kind === "lobby" ? "in the Plaza lobby" : `on floor ${location.floor}`}. Cars are listed from the cited system; nothing here is drawn as a cab.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-sm border border-rule bg-paper px-2 py-1 text-ink-2 hover:bg-paper-2" aria-label="Close the elevator panel">
            close
          </button>
        </div>

        {sections.map((s) => (
          <section key={s.key} className="mt-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-3">{s.title}</h3>
            {s.note ? <p className="mt-0.5 text-ink-2">{s.note}</p> : null}
            <ul className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-3 md:grid-cols-4">
              {s.stops.map((st) => (
                <li key={st.key}>
                  {st.href ? (
                    <button
                      type="button"
                      onClick={() => board(st)}
                      className="block w-full rounded-sm border border-ink bg-paper px-2 py-1.5 text-left hover:bg-ink hover:text-paper"
                    >
                      <span className="block font-medium">{st.label}</span>
                      {st.sub ? <span className="block text-[11px] opacity-80">{st.sub}</span> : null}
                    </button>
                  ) : (
                    <span className="block w-full rounded-sm border border-dashed border-ink-3 px-2 py-1.5 text-left text-ink-3" title={st.disabledWhy ?? ""}>
                      <span className="block font-medium">{st.label}</span>
                      <span className="block text-[11px]">{st.disabledWhy}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}

        <section className="mt-5 border-t border-rule pt-3">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-3">The system</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-2">
            {journey.facts.system.map((f) => (
              <li key={f.text}>{f.text}</li>
            ))}
            {journey.facts.skyLobby.map((f) => (
              <li key={f.text}>{f.text}</li>
            ))}
          </ul>
          <p className="mt-2 text-ink-2">
            {journey.facts.stairs.map((f) => f.text).join(" ")} <span className="font-mono text-ink-3">({stairsParams.join(", ")})</span>
          </p>
          <p className="mt-2 text-ink-3">Freight: {journey.facts.freight.text}</p>
          <button type="button" onClick={() => setShowSources((v) => !v)} className="mt-3 rounded-sm border border-rule px-2 py-1 text-ink-2 hover:bg-paper-2">
            {showSources ? "Hide" : "Show"} the {allParams.length} cited parameters behind this panel
          </button>
          {showSources ? <ParamList ids={allParams} params={journey.params} /> : null}
        </section>
      </div>
    </div>
  );
}
