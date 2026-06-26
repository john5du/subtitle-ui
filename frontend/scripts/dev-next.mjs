#!/usr/bin/env node
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { nextDev } = require("next/dist/cli/next-dev.js");

const port = Number.parseInt(process.env.PORT || "3300", 10);

if (!Number.isInteger(port) || port <= 0) {
  console.error(`Invalid PORT: ${process.env.PORT}`);
  process.exit(1);
}

process.env.NODE_ENV ||= "development";
process.env.NEXT_RUNTIME ||= "nodejs";
process.env.NEXT_PRIVATE_START_TIME = Date.now().toString();

try {
  await nextDev(
    {
      port,
      disableSourceMaps: false,
      experimentalCpuProf: false,
      experimentalHttps: false,
      experimentalNextConfigStripTypes: false,
    },
    "cli",
    process.cwd(),
  );
} catch (error) {
  console.error(error);
  process.exit(1);
}

setInterval(() => {}, 2147483647);
