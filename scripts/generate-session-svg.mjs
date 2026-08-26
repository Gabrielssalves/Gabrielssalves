// scripts/generate-session-svg.mjs
//
// Renders assets/terminal-session.svg with placeholder stats. Run manually
// after editing scripts/lib/session-svg.mjs. The real numbers are filled in
// by scripts/update-stats.mjs (run by .github/workflows/stats.yml).

import { mkdir, writeFile } from "node:fs/promises";
import { renderSession } from "./lib/session-svg.mjs";

const placeholderStats = {
  stars: "—",
  lastYear: "—",
  streak: "—",
  topLangs: "—",
};

async function main() {
  const svg = renderSession(placeholderStats);
  await mkdir("assets", { recursive: true });
  await writeFile("assets/terminal-session.svg", svg);
  console.log("Wrote assets/terminal-session.svg");
}

main();
