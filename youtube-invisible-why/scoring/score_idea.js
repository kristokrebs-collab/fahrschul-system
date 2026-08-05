#!/usr/bin/env node
// Deterministic scorer for The Invisible Why idea pipeline.
// Usage:
//   node score_idea.js <scored-idea.json>        score a single object or an array
//   cat idea.json | node score_idea.js -         read from stdin
//   node score_idea.js --route <dir> <input.json> also split output into
//                                                  <dir>/scored/pass.json,
//                                                  <dir>/scored/maybe.json,
//                                                  <dir>/rejected/rejected.json
//
// The rubric (weights, thresholds, hard-reject flags) lives in rubric.json
// so the Idea Scorer agent's prompt and this script never drift apart.

const fs = require("fs");
const path = require("path");

const RUBRIC_PATH = path.join(__dirname, "rubric.json");

function loadRubric() {
  return JSON.parse(fs.readFileSync(RUBRIC_PATH, "utf8"));
}

function scoreOne(entry, rubric) {
  const scores = entry.scores || {};
  const riskFlags = entry.risk_flags || [];

  const hardReject = riskFlags.some((f) => rubric.hard_reject_flags.includes(f));

  let weightedSum = 0;
  const missing = [];
  for (const factor of rubric.factors) {
    const sub = scores[factor.key];
    if (typeof sub !== "number" || sub < 0 || sub > 10) {
      missing.push(factor.key);
      continue;
    }
    weightedSum += sub * factor.weight * 10;
  }

  const total = Math.round(weightedSum * 10) / 10;

  let verdict;
  if (hardReject) {
    verdict = "reject";
  } else if (missing.length > 0) {
    verdict = "incomplete";
  } else if (total >= rubric.pass_threshold) {
    verdict = "pass";
  } else if (total >= rubric.maybe_threshold) {
    verdict = "maybe";
  } else {
    verdict = "reject";
  }

  return {
    ...entry,
    total,
    verdict,
    ...(missing.length > 0 ? { missing_factors: missing } : {}),
    ...(hardReject ? { hard_reject_flags_triggered: riskFlags.filter((f) => rubric.hard_reject_flags.includes(f)) } : {}),
  };
}

function readInput(arg) {
  const raw = arg === "-" ? fs.readFileSync(0, "utf8") : fs.readFileSync(arg, "utf8");
  return JSON.parse(raw);
}

function route(results, baseDir) {
  const buckets = { pass: [], maybe: [], reject: [], incomplete: [] };
  for (const r of results) buckets[r.verdict].push(r);

  const scoredDir = path.join(baseDir, "ideas", "scored");
  const rejectedDir = path.join(baseDir, "ideas", "rejected");
  fs.mkdirSync(scoredDir, { recursive: true });
  fs.mkdirSync(rejectedDir, { recursive: true });

  fs.writeFileSync(path.join(scoredDir, "pass.json"), JSON.stringify(buckets.pass, null, 2));
  fs.writeFileSync(path.join(scoredDir, "maybe.json"), JSON.stringify(buckets.maybe, null, 2));
  fs.writeFileSync(path.join(rejectedDir, "rejected.json"), JSON.stringify(buckets.reject, null, 2));
  if (buckets.incomplete.length > 0) {
    fs.writeFileSync(path.join(scoredDir, "incomplete.json"), JSON.stringify(buckets.incomplete, null, 2));
  }
  return buckets;
}

function main() {
  const args = process.argv.slice(2);
  let routeDir = null;
  const routeIdx = args.indexOf("--route");
  if (routeIdx !== -1) {
    routeDir = args[routeIdx + 1];
    args.splice(routeIdx, 2);
  }

  const input = args[0];
  if (!input) {
    console.error("Usage: score_idea.js [--route <dir>] <input.json|->");
    process.exit(1);
  }

  const rubric = loadRubric();
  const data = readInput(input);
  const entries = Array.isArray(data) ? data : [data];
  const results = entries.map((e) => scoreOne(e, rubric));

  if (routeDir) {
    const buckets = route(results, routeDir);
    console.log(
      JSON.stringify(
        {
          pass: buckets.pass.length,
          maybe: buckets.maybe.length,
          reject: buckets.reject.length,
          incomplete: buckets.incomplete.length,
        },
        null,
        2
      )
    );
  } else {
    console.log(JSON.stringify(Array.isArray(data) ? results : results[0], null, 2));
  }
}

if (require.main === module) {
  main();
}

module.exports = { scoreOne, loadRubric };
