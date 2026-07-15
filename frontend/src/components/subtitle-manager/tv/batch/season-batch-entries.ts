import type { SubHDSeasonPrepareResult } from "@/lib/types";
import type { ZipSubtitleEntry } from "@/lib/subtitle-zip";

/** Maps SubHD prepare response archive listing into client ZipSubtitleEntry rows. */
export function mapSubHDPrepareEntries(prepared: SubHDSeasonPrepareResult): ZipSubtitleEntry[] {
  return (prepared.entries || []).map((entry, index) => {
    const pathValue = (entry.path || entry.fileName || "").replace(/\\/g, "/").replace(/^\/+/, "");
    return {
      id: `subhd-${index}-${pathValue.toLowerCase()}`,
      path: `${prepared.fileName || "pack"}/${pathValue}`,
      fileName: entry.fileName || pathValue.split("/").pop() || pathValue,
      size: Number(entry.size) || 0,
      archiveEntry: pathValue,
      cacheToken: prepared.cacheToken
    };
  });
}
