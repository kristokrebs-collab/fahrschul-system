#!/usr/bin/env node
// Downloads a pilot's per-segment narration audio (see segments-manifest.json),
// concatenates it into one track, and muxes it onto that pilot's rendered
// silent video (renders/<video_id>.mp4).
//
// This exists because the sandbox that generated these voiceovers couldn't
// reach Higgsfield's asset CDN (d8j0ntlcm91z4.cloudfront.net) due to an
// egress policy — the durations were fetched via the API and used to
// re-time each storyboard.json, but the actual audio bytes were never
// downloaded there. Run this from a machine that CAN reach that CDN
// (any normal machine/browser can — it's a public policy on that one
// sandbox, not a restriction on the files themselves).
//
// Usage:
//   node mux-narration.js pilot-01-cancel-subscriptions
//
// Requires: ffmpeg on PATH (a full build — the tools/ffmpeg-1011 build
// bundled in some sandboxes is a minimal capture-only build and won't
// decode these files; use a normal system ffmpeg).

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execFileSync } = require("child_process");

const pilotId = process.argv[2];
if (!pilotId) {
  console.error("Usage: node mux-narration.js <pilot-id>");
  process.exit(1);
}

const ROOT = path.join(__dirname, "..");
const manifestPath = path.join(__dirname, pilotId, "segments-manifest.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

const segmentsDir = path.join(__dirname, pilotId, "segments");
fs.mkdirSync(segmentsDir, { recursive: true });

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https
      .get(url, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", reject);
  });
}

async function main() {
  console.log(`Downloading ${manifest.segments.length} segments for ${pilotId}...`);
  const files = [];
  for (const seg of manifest.segments) {
    const dest = path.join(segmentsDir, `${String(seg.index).padStart(2, "0")}.wav`);
    await download(seg.url, dest);
    files.push(dest);
    console.log(`  [${seg.index}] ${dest} (${seg.duration_sec.toFixed(1)}s)`);
  }

  const concatListPath = path.join(segmentsDir, "concat-list.txt");
  fs.writeFileSync(concatListPath, files.map((f) => `file '${f}'`).join("\n"));

  const narrationPath = path.join(__dirname, pilotId, "narration.wav");
  execFileSync("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", concatListPath, "-c", "copy", narrationPath]);
  console.log(`Wrote ${narrationPath}`);

  const videoPath = path.join(ROOT, "renders", `${manifest.video_id}.mp4`);
  const finalPath = path.join(ROOT, "renders", `${manifest.video_id}-final.mp4`);
  if (!fs.existsSync(videoPath)) {
    console.log(`No rendered video found at ${videoPath} — skipping mux. Run the Remotion render first (remotion-engine/README.md).`);
    return;
  }
  execFileSync("ffmpeg", [
    "-y",
    "-i", videoPath,
    "-i", narrationPath,
    "-c:v", "copy",
    "-c:a", "aac",
    "-b:a", "160k",
    "-shortest",
    finalPath,
  ]);
  console.log(`Wrote ${finalPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
