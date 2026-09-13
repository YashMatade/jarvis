"use client";

import dynamic from "next/dynamic";
import { JarvisSceneProps } from "./types";

const JarvisScene = dynamic(() => import("./JarvisScene"), { ssr: false });

export default function JarvisSceneClient(props: JarvisSceneProps) {
  return <JarvisScene {...props} />;
}
