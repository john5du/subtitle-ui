import dynamic from "next/dynamic";

const SubtitleManagerApp = dynamic(
  () => import("@/components/subtitle-manager-app").then((module) => module.SubtitleManagerApp),
  { ssr: false }
);

export default function Page() {
  return <SubtitleManagerApp />;
}
