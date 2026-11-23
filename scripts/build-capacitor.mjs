import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const ROOT = process.cwd();
const STASH_DIR = path.join(ROOT, ".capacitor-api-stash");

// Dynamic route folders that are only used by the Vercel server build and
// must be temporarily excluded during Next.js static export (`output: "export"`).
const DYNAMIC_ROUTES = [
  "src/app/api",
  "src/app/novel-downloader.user.js",
];

function stashDynamicRoutes() {
  fs.rmSync(STASH_DIR, { recursive: true, force: true });
  fs.mkdirSync(STASH_DIR, { recursive: true });

  for (const rel of DYNAMIC_ROUTES) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) continue;
    const dst = path.join(STASH_DIR, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.renameSync(src, dst);
  }
}

function restoreDynamicRoutes() {
  for (const rel of DYNAMIC_ROUTES) {
    const dst = path.join(STASH_DIR, rel);
    if (!fs.existsSync(dst)) continue;
    const src = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(src), { recursive: true });
    fs.renameSync(dst, src);
  }
  fs.rmSync(STASH_DIR, { recursive: true, force: true });
}

function main() {
  const skipSync = process.argv.includes("--no-sync");
  stashDynamicRoutes();

  try {
    // Clean stale .next/types that may reference stashed API routes
    fs.rmSync(path.join(ROOT, ".next"), { recursive: true, force: true });

    console.log("Building static Next.js bundle for Capacitor...");
    execSync("yarn build", {
      cwd: ROOT,
      stdio: "inherit",
      env: { ...process.env, CAPACITOR_BUILD: "1" },
    });
  } finally {
    restoreDynamicRoutes();
    // Clean .next so subsequent dev/server builds regenerate cleanly with API routes
    fs.rmSync(path.join(ROOT, ".next"), { recursive: true, force: true });
  }

  if (!skipSync && fs.existsSync(path.join(ROOT, "android"))) {
    console.log("Syncing Capacitor Android project...");
    execSync("npx cap sync android", { cwd: ROOT, stdio: "inherit" });
  }
}

main();
