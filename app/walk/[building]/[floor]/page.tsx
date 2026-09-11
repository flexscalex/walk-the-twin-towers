import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SITE_NAME } from "@/lib/site";
import { buildWalkData, isTowerId, walkFloorParams } from "@/lib/walk";
import { WalkViewer } from "./WalkViewer";

export const dynamicParams = false;

export function generateStaticParams() {
  return walkFloorParams();
}

type Params = Promise<{ building: string; floor: string }>;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { building, floor } = await params;
  if (!isTowerId(building)) return { title: "Walk" };
  const data = buildWalkData(building, Number(floor));
  return { title: data ? `Walk ${data.buildingName}, floor ${data.floor}` : "Walk" };
}

export default async function WalkPage({ params }: { params: Params }) {
  const { building, floor } = await params;
  if (!isTowerId(building) || !/^\d+$/.test(floor)) notFound();
  const data = buildWalkData(building, Number(floor));
  if (!data) notFound();

  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-ink-3">
        <Link href="/towers" className="no-underline hover:underline">
          Towers
        </Link>{" "}
        / {data.buildingName} / Walk
      </p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">
        {data.buildingName}, floor {data.floor}
        {data.isSkyLobby ? " (sky lobby)" : ""}
      </h1>
      <p className="mt-2 max-w-2xl text-sm text-ink-2">
        {data.isSkyLobby
          ? `One of the two transfer floors of ${SITE_NAME}. Here people stepped off the express elevators from the concourse and on to the local elevators of the zone above. The plate, core and columns are drawn from cited dimensions; the elevators are a panel, since no bank is cited. Where the record is silent, the element is left out and listed below.`
          : `One floor of ${SITE_NAME} at eye height. The plate, core, columns and ceiling are drawn from cited dimensions; the tenant zones are sized by the square footage each row lists. Walk to the core for the elevators. Where the record is silent, the element is left out and listed below.`}
      </p>
      <WalkViewer data={data} />
    </div>
  );
}
