#!/usr/bin/env node
// Builds the 45-second quality proof: the opening of the decoy-effect video,
// rebuilt to the density the channel now requires.
//
// This exists as the approval gate from the strategy plan — voice and visual
// density are the two reasons viewers leave, and both are visible in 45
// seconds. Nothing longer gets produced until this convinces.
//
// Differences from the pilot-4/5/6 generator, all deliberate:
//   * minimum 5 drawing elements per scene (was 3)
//   * at most every fourth scene may be `static`, never two in a row
//   * roughly every second scene carries on-screen text
//   * scene 1 opens pre-hydrated so frame 1 already has a drawing on it
//
// Usage: node build-proof.js

const fs = require("fs");
const path = require("path");

// Measured from the Sterling take (see narration.json written alongside).
// Durations are distributed across scenes by word count, the same method
// used for the full pilots.
const CHUNK_DURATION_SEC = Number(process.argv[2] || 0);

// [narration, [elements], on_screen_text|null, camera]
const SCENES = [
  ["There's a price on this page that exists only to make you pick a different one.",
    ["price-box", "price-box", "price-box", "eye", "question-mark"], null, "slow zoom in"],
  ["It isn't there to be bought. It's there to be rejected.",
    ["price-box", "x-mark", "signpost", "arrow-up", "brain"], "NOT FOR SALE", "pan right"],
  ["In two thousand eight, an economist found a subscription offer that looked like a mistake.",
    ["person", "price-tag", "question-mark", "calendar", "grid"], null, "slow zoom out"],
  ["Web only, fifty-nine dollars. Print only, one hundred and twenty-five.",
    ["price-box", "price-box", "coin", "coin", "scale"], "$59 vs $125", "static"],
  ["Print and web — also one hundred and twenty-five dollars. Read that again.",
    ["price-box", "price-box", "price-box", "coin", "question-mark", "scale"], "$125 = $125", "slow zoom in"],
  ["Print alone cost the same as print plus web. Nobody would ever choose it.",
    ["price-box", "x-mark", "scale", "arrow-down", "brain"], null, "pan left"],
  ["So he ran it on a hundred students. Sixteen. Zero. Eighty-four.",
    ["bar-chart", "person", "checkmark", "price-box", "grid"], "16 / 0 / 84", "slow zoom in"],
  ["Then he deleted the option nobody wanted, and ran it again.",
    ["price-box", "x-mark", "bar-chart", "person", "question-mark"], null, "static"],
  ["Sixty-eight. Thirty-two. The expensive plan lost more than half its buyers.",
    ["bar-chart", "arrow-down", "coin", "price-box", "scale", "brain"], "68 / 32", "zoom out to reveal"],
];

const OUT = path.join(__dirname, "storyboard.json");

const words = SCENES.map(([n]) => n.trim().split(/\s+/).length);
const totalWords = words.reduce((a, b) => a + b, 0);
// Fall back to the 155 wpm channel target when no measured duration is given,
// so the file is still renderable before the voice take exists.
const total = CHUNK_DURATION_SEC > 0 ? CHUNK_DURATION_SEC : (totalWords / 155) * 60;

let t = 0;
const scenes = SCENES.map(([narration, drawing_elements, on_screen_text, camera], i) => {
  const duration = total * (words[i] / totalWords);
  const scene = {
    scene: i + 1,
    start: Math.round(t * 1000) / 1000,
    duration: Math.round(duration * 1000) / 1000,
    narration,
    visual: `${drawing_elements.join(", ")} — pen only, page persists across scenes`,
    drawing_elements,
    on_screen_text: on_screen_text ?? null,
    camera,
    sound_effect: null,
    ...(i === 0 ? { open_prehydrated: true } : {}),
  };
  t += duration;
  return scene;
});

fs.writeFileSync(OUT, JSON.stringify({ video_id: "proof-45s", accent_color: "#C62828", scenes }, null, 2));

const statics = scenes.filter((s) => s.camera === "static").length;
const withText = scenes.filter((s) => s.on_screen_text).length;
const minEls = Math.min(...scenes.map((s) => s.drawing_elements.length));
console.log(`${scenes.length} scenes, ${t.toFixed(1)}s, ${totalWords} words`);
console.log(`static ${statics}/${scenes.length} (target <=25%), text ${withText}/${scenes.length} (target >=50%), min elements ${minEls} (target >=5)`);
