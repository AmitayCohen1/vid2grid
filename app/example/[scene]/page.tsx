import { notFound } from "next/navigation";
import App from "@/components/App";
import { SCENES, isSceneId } from "@/lib/examples";

/** /example/solo, /example/group, … — a recorded example opened straight into one setup. */
export function generateStaticParams() {
  return Object.keys(SCENES).map((scene) => ({ scene }));
}

export async function generateMetadata({ params }: { params: Promise<{ scene: string }> }) {
  const { scene } = await params;
  return isSceneId(scene) ? { title: SCENES[scene].title } : {};
}

export default async function Page({ params }: { params: Promise<{ scene: string }> }) {
  const { scene } = await params;
  if (!isSceneId(scene)) notFound();
  return <App scene={scene} />;
}
