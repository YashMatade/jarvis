"use client";

import dynamic from "next/dynamic";
import { NexusSceneProps } from "./types";

const NexusScene = dynamic(() => import("./NexusScene"), { ssr: false });

export default function NexusSceneClient(props: NexusSceneProps) {
  return <NexusScene {...props} />;
}
