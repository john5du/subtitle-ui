import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const thisFile = fileURLToPath(import.meta.url);
const rootDir = resolve(dirname(thisFile), "..");

const sourceDir = join(rootDir, "node_modules", "libarchive.js", "dist");
const targetDir = join(rootDir, "public", "libarchive");

const files = ["libarchive.js", "worker-bundle.js", "libarchive.wasm"];

await mkdir(targetDir, { recursive: true });

for (const file of files) {
  await copyFile(join(sourceDir, file), join(targetDir, file));
}

