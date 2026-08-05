#!/usr/bin/env node
// Downloads a pilot's finished narration track and muxes it onto that
// pilot's rendered silent video, producing the publish-ready MP4.
//
// The narration for all three pilots was generated (Higgsfield seed_audio,
// voice "Arthur"), concatenated, and uploaded to a hosted URL — one file
// per pilot, already in the right order. `narration_url` in each pilot's
// segments-manifest.json points at it. (The per-segment URLs are still
// listed there for reference / regeneration.)
//
// Usage:
//   node mux-narration.js pilot-01-cancel-subscriptions
//   node mux-narration.js all
//
// Requires: ffmpeg on PATH.
//
// Equivalent one-liner if you'd rather not run this:
//   ffmpeg -i renders/<video-id>.mp4 -i narration.mp3 \
//          -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 160k \
//          -movflags +faststart renders/<video-id>-final.mp4
//
// Do NOT add -shortest here. Combined with -c:v copy it silently truncated
// the audio to ~6 seconds while ffprobe still reported the full duration
// and both streams present — the kind of failure you only catch by
// summing packet sizes per stream. The durations already match within
// 0.05s, so it buys nothing anyway.

const fs = require("fs");
const path = require("path");
const https = require("https");
const { execFileSync } = require("child_process");

const PILOTS = [
  "pilot-01-cancel-subscriptions",
  "pilot-02-sleep-deprivation",
  "pilot-03-supermarket-psychology",
];

const arg = process.argv[2];
if (!arg) {
  console.error(`Usage: node mux-narration.js <pilot-id|all>\n\nPilots:\n  ${PILOTS.join("\n  ")}`);
  process.exit(1);
}
const targets = arg === "all" ? PILOTS : [arg];

const ROOT = path.join(__dirname, "..");

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

async function muxOne(pilotId) {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, pilotId, "segments-manifest.json"), "utf8"));
  const narrationPath = path.join(__dirname, pilotId, "narration.mp3");

  if (!fs.existsSync(narrationPath)) {
    console.log(`[${pilotId}] downloading narration (${manifest.total_duration_sec.toFixed(1)}s)...`);
    await download(manifest.narration_url, narrationPath);
  }
  console.log(`[${pilotId}] narration: ${narrationPath}`);

  const videoPath = path.join(ROOT, "renders", `${manifest.video_id}.mp4`);
  if (!fs.existsSync(videoPath)) {
    console.log(`[${pilotId}] no rendered video at ${videoPath} — render it first:`);
    console.log(`  cd remotion-engine && npx remotion render src/index.ts MainVideo ../renders/${manifest.video_id}.mp4 --props=../pilots/${pilotId}/storyboard.json`);
    return;
  }

  const finalPath = path.join(ROOT, "renders", `${manifest.video_id}-final.mp4`);
  execFileSync("ffmpeg", ["-y", "-i", videoPath, "-i", narrationPath, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", finalPath], { stdio: "inherit" });
  console.log(`[${pilotId}] wrote ${finalPath}`);
}

(async () => {
  for (const p of targets) await muxOne(p);
})().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
