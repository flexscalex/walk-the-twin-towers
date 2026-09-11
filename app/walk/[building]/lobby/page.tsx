import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TOWER_IDS } from "@/lib/floors";
import { SITE_NAME } from "@/lib/site";
import { buildLobbyData, isTowerId } from "@/lib/walk";
import { WalkViewer } from "../[floor]/WalkViewer";

export const dynamicParams = false;

export function generateStaticParams() {
  return TOWER_IDS.map((building) => ({ building }));
}

type Params = Promise<{ building: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { building } = await params;
  if (!isTowerId(building)) return { title: "Lobby" };
  const data = buildLobbyData(building);
  return { title: data ? `${data.buildingName}, Plaza lobby` : "Lobby" };
}

export default async function LobbyPage({ params }: { params: Params }) {
  const { building } = await params;
  if (!isTowerId(building)) notFound();
  const data = buildLobbyData(building);
  if (!data) notFound();

  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-ink-3">
        <Link href="/towers" className="no-underline hover:underline">
          Towers
        </Link>{" "}
        / {data.buildingName} / Lobby
      </p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">{data.buildingName}, Plaza lobby</h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-2">
        The front door of {SITE_NAME}. Floor 2 is cited as the Plaza lobby; the Concourse is the floor below. You start
        just inside the glass, facing the core. Walk to the core for the elevators: express cars to the sky lobbies on
        44 and 78, local cars for the lowest zone, and the dedicated cars to the top floors. Where the record is silent,
        the element is left out and listed below.
      </p>
      <WalkViewer data={data} />
    </div>
  );
}
