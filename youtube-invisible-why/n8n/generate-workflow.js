#!/usr/bin/env node
// Generates n8n/youtube-pipeline.workflow.json programmatically instead of
// hand-editing 40+ near-identical node blocks in raw JSON. Re-run this after
// changing AGENT_STEPS or the pipeline shape below; it also self-validates
// (every connection target must exist as a node, every node name unique)
// before writing the file, so a bad edit fails loudly here instead of
// silently producing a broken import in n8n.
//
// Usage: node generate-workflow.js
//
// Built against n8n's 1.x node schema. It was NOT test-imported into a live
// n8n instance (none was available while generating this) — treat it as a
// structurally-complete, logically-correct reference: import it, then click
// through each node once against your n8n version and fix any renamed
// parameter (httpRequest / code node param names shift slightly between
// minor n8n versions). See n8n/README.md for the credential setup this
// workflow expects.

const fs = require("fs");
const path = require("path");

const OUT_FILE = path.join(__dirname, "youtube-pipeline.workflow.json");

// ---------------------------------------------------------------------------
// low-level node/connection builders
// ---------------------------------------------------------------------------

let colX = 0;
const COL_W = 260;
function nextPos(rowY = 300) {
  const p = [colX, rowY];
  colX += COL_W;
  return p;
}

let idSeq = 0;
function nodeId(prefix) {
  idSeq += 1;
  return `${prefix.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${idSeq}`;
}

const nodes = [];
const connections = {};
let prevName = null; // linear chain cursor

function connect(from, to, outputIndex = 0) {
  connections[from] = connections[from] || { main: [] };
  while (connections[from].main.length <= outputIndex) connections[from].main.push([]);
  connections[from].main[outputIndex].push({ node: to, type: "main", index: 0 });
}

function push(node, { chain = true, rowY } = {}) {
  if (rowY !== undefined) node.position[1] = rowY;
  nodes.push(node);
  if (chain && prevName) connect(prevName, node.name);
  prevName = node.name;
  return node.name;
}

function sticky(name, content, opts = {}) {
  const n = {
    parameters: { content, height: opts.h || 260, width: opts.w || 280, color: opts.color || 4 },
    id: nodeId(name),
    name,
    type: "n8n-nodes-base.stickyNote",
    typeVersion: 1,
    position: [colX, (opts.rowY ?? 0)],
  };
  nodes.push(n); // stickies never chain
  return n.name;
}

function scheduleTrigger(name, cronExpr) {
  return {
    parameters: { rule: { interval: [{ field: "cronExpression", expression: cronExpr }] } },
    id: nodeId(name),
    name,
    type: "n8n-nodes-base.scheduleTrigger",
    typeVersion: 1.2,
    position: nextPos(),
  };
}

function code(name, jsCode, rowY) {
  return {
    parameters: { jsCode },
    id: nodeId(name),
    name,
    type: "n8n-nodes-base.code",
    typeVersion: 2,
    position: nextPos(rowY),
  };
}

function httpRequest(name, url, { method = "POST", headers = [], jsonBody, credentialName, credentialType } = {}, rowY) {
  const n = {
    parameters: {
      method,
      url,
      sendHeaders: headers.length > 0,
      headerParameters: { parameters: headers },
      sendBody: true,
      specifyBody: "json",
      jsonBody: jsonBody || "={{ JSON.stringify($json.requestBody) }}",
      options: { timeout: 120000 },
    },
    id: nodeId(name),
    name,
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: nextPos(rowY),
  };
  if (credentialName) {
    n.credentials = { [credentialType]: { id: "REPLACE_ME", name: credentialName } };
  }
  return n;
}

function ifNode(name, conditionExpr, rowY) {
  return {
    parameters: {
      conditions: {
        options: { caseSensitive: true, leftValue: "", typeValidation: "loose" },
        conditions: [
          {
            leftValue: conditionExpr,
            rightValue: true,
            operator: { type: "boolean", operation: "true" },
          },
        ],
        combinator: "and",
      },
      options: {},
    },
    id: nodeId(name),
    name,
    type: "n8n-nodes-base.if",
    typeVersion: 2,
    position: nextPos(rowY),
  };
}

function noOp(name, notes, rowY) {
  return { parameters: {}, id: nodeId(name), name, type: "n8n-nodes-base.noOp", typeVersion: 1, position: nextPos(rowY), notes };
}

// n8n-nodes-base.executeCommand does not exist in current n8n (verified
// against a live n8n 2.33.3 instance's /types/nodes.json registry — it's
// been removed, not just deprecated). A Code node with require('child_
// process') is the direct replacement, and fits the pipeline's existing
// trust model: it already requires self-hosted n8n with NODE_FUNCTION_
// ALLOW_BUILTIN=fs,path for the agent-call nodes, so allowing child_
// process there too is a small extension, not a new class of requirement.
function shellCommand(name, buildCommandJs, rowY) {
  return code(
    name,
    `const { execSync } = require('child_process');
const PROJECT_ROOT = $env.INVISIBLE_WHY_ROOT || '/data/youtube-invisible-why';

return $input.all().map(item => {
${buildCommandJs}
  let stdout = '';
  let stderr = '';
  let commandFailed = false;
  try {
    stdout = execSync(command, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 });
  } catch (e) {
    commandFailed = true;
    stdout = e.stdout ? e.stdout.toString() : '';
    stderr = e.stderr ? e.stderr.toString() : String(e.message || e);
  }
  return { json: { ...item.json, stdout, stderr, commandFailed } };
});`,
    rowY
  );
}

function splitOut(name, fieldToSplit, rowY) {
  return {
    parameters: { fieldToSplitOut: fieldToSplit, options: {} },
    id: nodeId(name),
    name,
    type: "n8n-nodes-base.splitOut",
    typeVersion: 1,
    position: nextPos(rowY),
  };
}

function wait(name, rowY) {
  return {
    parameters: {
      resume: "form",
      formTitle: "Invisible Why — Script Approval",
      formDescription: "Final human sign-off before packaging/rendering continue (editorial-rules.md §9).",
      formFields: { values: [{ fieldLabel: "Approve script?", fieldType: "dropdown", fieldOptions: { values: [{ option: "approve" }, { option: "reject" }] } }] },
    },
    id: nodeId(name),
    name,
    type: "n8n-nodes-base.wait",
    typeVersion: 1.1,
    position: nextPos(rowY),
    notes: "MVP human gate. Configure a form/webhook resume in n8n UI per editorial-rules.md §9 (final script sign-off is never automated).",
  };
}

function youTubeUpload(name, rowY) {
  return {
    parameters: {
      resource: "video",
      operation: "upload",
      title: "={{ $json.title }}",
      regionCode: "US",
      options: {
        description: "={{ $json.description }}",
        privacyStatus: "private",
        categoryId: "27",
      },
    },
    id: nodeId(name),
    name,
    type: "n8n-nodes-base.youTube",
    typeVersion: 1,
    position: nextPos(rowY),
    credentials: { youTubeOAuth2Api: { id: "REPLACE_ME", name: "YouTube OAuth2 (Invisible Why channel)" } },
  };
}

// ---------------------------------------------------------------------------
// shared "call a Claude agent" triplet: Build Prompt (code) -> Call Claude
// (httpRequest) -> Save Output (code). Kept generic; per-agent JS bodies are
// supplied by the caller so each step's actual input/output shape is
// explicit and reviewable rather than hidden behind a generic abstraction.
// ---------------------------------------------------------------------------

function agentStep({ label, promptFile, buildPromptJs, saveOutputJs, rowY = 300 }) {
  const buildName = push(
    code(
      `${label}: Build Prompt`,
      `const fs = require('fs');
const path = require('path');
const PROJECT_ROOT = $env.INVISIBLE_WHY_ROOT || '/data/youtube-invisible-why';
const systemPrompt = fs.readFileSync(path.join(PROJECT_ROOT, '${promptFile}'), 'utf8');

return $input.all().map(item => {
${buildPromptJs}
  return {
    json: {
      requestBody: {
        model: 'claude-sonnet-5',
        max_tokens: 8000,
        system: systemPrompt,
        messages: [{ role: 'user', content: JSON.stringify(userPayload) }],
      },
      meta,
    },
  };
});`
    ),
    { rowY }
  );

  const httpName = push(
    httpRequest(
      `${label}: Call Claude`,
      "https://api.anthropic.com/v1/messages",
      {
        headers: [
          { name: "anthropic-version", value: "2023-06-01" },
          { name: "content-type", value: "application/json" },
        ],
        credentialName: "Anthropic API Key",
        credentialType: "httpHeaderAuth",
      },
      rowY
    )
  );

  const saveName = push(
    code(
      `${label}: Save Output`,
      `const fs = require('fs');
const path = require('path');
const PROJECT_ROOT = $env.INVISIBLE_WHY_ROOT || '/data/youtube-invisible-why';

return $input.all().map((item, i) => {
  const meta = $('${buildName}').all()[i].json.meta;
  const text = item.json.content && item.json.content[0] ? item.json.content[0].text : '';
${saveOutputJs}
});`
    ),
    { rowY }
  );

  return { buildName, httpName, saveName };
}

// ---------------------------------------------------------------------------
// SECTION 1 — Research & ideation (weekly)
// ---------------------------------------------------------------------------

sticky(
  "Section: Research & Ideation",
  "## 1. Research & Ideation (weekly)\nCollect trend/competitor signals, run the Trend Scout agent, score every idea, and route pass/maybe/reject.\n\nSee agents/01-trend-scout.md and agents/02-idea-scorer.md.",
  { rowY: -260, h: 220, w: 300 }
);

push(scheduleTrigger("Weekly Research Trigger", "0 6 * * 1"), { chain: false });

push(
  httpRequest(
    "Collect Google Trends Signal",
    "https://serpapi.com/search.json?engine=google_trends_trending_now&geo=US",
    { credentialName: "SerpApi Key", credentialType: "httpQueryAuth" }
  )
);
nodes[nodes.length - 1].parameters.method = "GET";
nodes[nodes.length - 1].parameters.sendBody = false;
nodes[nodes.length - 1].continueOnFail = true;

push(
  httpRequest(
    "Collect Competitor Uploads",
    "https://www.googleapis.com/youtube/v3/search?part=snippet&order=date&maxResults=10&channelId={{$json.channelId}}&key={{$env.YOUTUBE_API_KEY}}"
  )
);
nodes[nodes.length - 1].parameters.method = "GET";
nodes[nodes.length - 1].parameters.sendBody = false;
nodes[nodes.length - 1].continueOnFail = true;

push(
  code(
    "Merge Trend Signals",
    `const fs = require('fs');
const path = require('path');
const PROJECT_ROOT = $env.INVISIBLE_WHY_ROOT || '/data/youtube-invisible-why';
const trends = $('Collect Google Trends Signal').all().map(i => i.json);
const competitors = $('Collect Competitor Uploads').all().map(i => i.json);
const batchDate = new Date().toISOString().slice(0, 10);

return [{
  json: {
    batch_date: batchDate,
    sources_available: { google_trends: trends, competitor_uploads: competitors },
  },
}];`
  )
);

agentStep({
  label: "Trend Scout",
  promptFile: "agents/01-trend-scout.md",
  buildPromptJs: `  const userPayload = { sources_available: item.json.sources_available, batch_date: item.json.batch_date };
  const meta = { batch_date: item.json.batch_date };`,
  saveOutputJs: `  let ideas = [];
  try { ideas = JSON.parse(text); } catch (e) { ideas = []; }
  const outPath = path.join(PROJECT_ROOT, 'ideas/inbox/' + meta.batch_date + '-batch.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(ideas, null, 2));
  return { json: { ideas, outPath } };`,
});

push(splitOut("Split Out Ideas", "ideas"));

// ---------------------------------------------------------------------------
// SECTION 2 — Scoring
// ---------------------------------------------------------------------------

sticky(
  "Section: Scoring",
  "## 2. Idea Scoring\nEach idea gets qualitative sub-scores from Claude (Idea Scorer agent), then a deterministic weighted total from scoring/rubric.json — same logic as scoring/score_idea.js.",
  { rowY: -260 }
);

agentStep({
  label: "Idea Scorer",
  promptFile: "agents/02-idea-scorer.md",
  buildPromptJs: `  const userPayload = item.json;
  const meta = { id: item.json.id || item.json.working_title };`,
  saveOutputJs: `  let scored = {};
  try { scored = JSON.parse(text); } catch (e) { scored = { id: meta.id, verdict: 'incomplete', raw: text }; }
  return { json: scored };`,
});

push(
  code(
    "Compute Weighted Score",
    `const fs = require('fs');
const path = require('path');
const PROJECT_ROOT = $env.INVISIBLE_WHY_ROOT || '/data/youtube-invisible-why';
const { scoreOne, loadRubric } = require(path.join(PROJECT_ROOT, 'scoring/score_idea.js'));
const rubric = loadRubric();

return $input.all().map(item => {
  const result = scoreOne(item.json, rubric);
  const dir = result.verdict === 'pass' ? 'scored' : result.verdict === 'maybe' ? 'scored' : 'rejected';
  const outPath = path.join(PROJECT_ROOT, 'ideas', dir, (result.id || 'unknown') + '.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  return { json: result };
});`
  )
);

push(ifNode("If Idea Passes", "={{ $json.verdict === 'pass' }}"));
connect("If Idea Passes", "Research Agent: Build Prompt", 0);
const rejectStop = noOp("Idea Rejected or Maybe — Stop", "Routed to ideas/scored or ideas/rejected by the previous node. Nothing further happens automatically — the Trend Scout will not resurface it (checks ideas/rejected/).");
nodes.push(rejectStop);
connect("If Idea Passes", rejectStop.name, 1);
prevName = "If Idea Passes"; // keep chain cursor on the branch node; next agentStep() call connects its first node manually below

// ---------------------------------------------------------------------------
// SECTION 3 — Research, script, fact-check
// ---------------------------------------------------------------------------

sticky(
  "Section: Research & Script",
  "## 3. Research -> Draft -> Fact-Check -> Language Edit\nOnly ideas with verdict=pass reach here. A FAIL fact-check or a re-score recommendation stops the pipeline for human triage.",
  { rowY: -260 }
);

agentStep({
  label: "Research Agent",
  promptFile: "agents/03-research-agent.md",
  buildPromptJs: `  const userPayload = item.json;
  const meta = { id: item.json.id };`,
  saveOutputJs: `  const outPath = path.join(PROJECT_ROOT, 'research', meta.id + '-dossier.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, text);
  return { json: { id: meta.id, dossier: text, recommendReScore: text.includes('RECOMMEND RE-SCORE') } };`,
});

push(ifNode("If Research Recommends Re-score", "={{ $json.recommendReScore === true }}"));
const rescoreStop = noOp("Weak Topic — Notify Human", "Research Agent flagged RECOMMEND RE-SCORE. A human should re-evaluate before any further automated work is spent on this idea.");
nodes.push(rescoreStop);
connect("If Research Recommends Re-score", rescoreStop.name, 0);
connect("If Research Recommends Re-score", "Story Writer: Build Prompt", 1);
prevName = "If Research Recommends Re-score";

agentStep({
  label: "Story Writer",
  promptFile: "agents/05-story-writer.md",
  buildPromptJs: `  const userPayload = { id: item.json.id, dossier: item.json.dossier };
  const meta = { id: item.json.id };`,
  saveOutputJs: `  const outPath = path.join(PROJECT_ROOT, 'scripts', meta.id + '-draft.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, text);
  return { json: { id: meta.id, script: text } };`,
});

agentStep({
  label: "Fact Checker",
  promptFile: "agents/04-fact-checker.md",
  buildPromptJs: `  const dossierPath = path.join(PROJECT_ROOT, 'research', item.json.id + '-dossier.md');
  const dossier = fs.readFileSync(dossierPath, 'utf8');
  const userPayload = { id: item.json.id, script: item.json.script, dossier };
  const meta = { id: item.json.id, script: item.json.script };`,
  saveOutputJs: `  const outPath = path.join(PROJECT_ROOT, 'research', meta.id + '-factcheck.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, text);
  const failed = /Verdict:\\s*FAIL/i.test(text);
  return { json: { id: meta.id, script: meta.script, factcheck: text, failed } };`,
});

push(ifNode("If Fact Check Failed", "={{ $json.failed === true }}"));
const factFailStop = noOp("Script Failed Fact-Check — Notify Human", "Fact Checker verdict was FAIL on a load-bearing claim. Revise via Story Writer manually or re-run after fixing the research dossier.");
nodes.push(factFailStop);
connect("If Fact Check Failed", factFailStop.name, 0);
connect("If Fact Check Failed", "Native English Editor: Build Prompt", 1);
prevName = "If Fact Check Failed";

agentStep({
  label: "Native English Editor",
  promptFile: "agents/08-native-english-editor.md",
  buildPromptJs: `  const userPayload = { id: item.json.id, script: item.json.script };
  const meta = { id: item.json.id };`,
  saveOutputJs: `  const outPath = path.join(PROJECT_ROOT, 'scripts', meta.id + '-final.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, text);
  return { json: { id: meta.id, finalScript: text } };`,
});

// ---------------------------------------------------------------------------
// SECTION 4 — Human sign-off, packaging, storyboard
// ---------------------------------------------------------------------------

sticky(
  "Section: Human Sign-off + Packaging",
  "## 4. Human Sign-off -> Title/Thumbnail -> Storyboard\nFinal script sign-off is a mandatory human gate (editorial-rules.md §9) before any rendering cost is spent.",
  { rowY: -260 }
);

push(wait("Human Script Approval Gate"));

agentStep({
  label: "Title Thumbnail Agent",
  promptFile: "agents/07-title-thumbnail-agent.md",
  buildPromptJs: `  const userPayload = { id: item.json.id, finalScript: item.json.finalScript };
  const meta = { id: item.json.id, finalScript: item.json.finalScript };`,
  saveOutputJs: `  const outPath = path.join(PROJECT_ROOT, 'scripts', meta.id + '-packaging.md');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, text);
  return { json: { id: meta.id, finalScript: meta.finalScript, packaging: text } };`,
});

agentStep({
  label: "Storyboard Agent",
  promptFile: "agents/06-storyboard-agent.md",
  buildPromptJs: `  const userPayload = { id: item.json.id, finalScript: item.json.finalScript };
  const meta = { id: item.json.id };`,
  saveOutputJs: `  let storyboard = {};
  try { storyboard = JSON.parse(text); } catch (e) { storyboard = { video_id: meta.id, scenes: [], parseError: true, raw: text }; }
  const outPath = path.join(PROJECT_ROOT, 'storyboards', meta.id + '.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(storyboard, null, 2));
  return { json: { id: meta.id, storyboardPath: outPath, scenes: storyboard.scenes || [] } };`,
});

// ---------------------------------------------------------------------------
// SECTION 5 — Voice, render, QA, upload
// ---------------------------------------------------------------------------

sticky(
  "Section: Voice, Render, QA, Upload",
  "## 5. Voiceover -> Remotion Render -> QA -> Private Upload\nRequires: ElevenLabs API key, a rendering machine with Remotion + ffmpeg/ffprobe installed, and a verified YouTube Data API OAuth app. See docs/SETUP.md.",
  { rowY: -260, h: 260 }
);

push(
  code(
    "Build Voiceover Script Text",
    `const PROJECT_ROOT = $env.INVISIBLE_WHY_ROOT || '/data/youtube-invisible-why';
return $input.all().map(item => {
  const narration = (item.json.scenes || []).map(s => s.narration).join(' ');
  return { json: { id: item.json.id, narration, storyboardPath: item.json.storyboardPath } };
});`
  )
);

push(
  httpRequest(
    "Generate Voiceover (ElevenLabs)",
    "https://api.elevenlabs.io/v1/text-to-speech/{{$env.ELEVENLABS_VOICE_ID}}",
    {
      headers: [{ name: "content-type", value: "application/json" }],
      credentialName: "ElevenLabs API Key",
      credentialType: "httpHeaderAuth",
      jsonBody:
        "={{ JSON.stringify({ text: $json.narration, model_id: 'eleven_multilingual_v2', voice_settings: { stability: 0.5, similarity_boost: 0.75 } }) }}",
    }
  )
);
nodes[nodes.length - 1].parameters.options.response = { response: { responseFormat: "file" } };

push(
  code(
    "Save Voiceover Audio",
    `const fs = require('fs');
const path = require('path');
const PROJECT_ROOT = $env.INVISIBLE_WHY_ROOT || '/data/youtube-invisible-why';

return $input.all().map((item, i) => {
  const id = $('Build Voiceover Script Text').all()[i].json.id;
  const outPath = path.join(PROJECT_ROOT, 'voiceovers', id + '.mp3');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  if (item.binary && item.binary.data) {
    fs.writeFileSync(outPath, Buffer.from(item.binary.data.data, 'base64'));
  }
  return { json: { id, audioPath: outPath } };
});`
  )
);

push(
  shellCommand(
    "Trigger Remotion Render",
    `  const command = \`npx remotion render \${PROJECT_ROOT}/remotion-engine/src/index.ts MainVideo \${PROJECT_ROOT}/renders/\${item.json.id}.mp4 --props=\${PROJECT_ROOT}/storyboards/\${item.json.id}.json\`;`
  )
);

push(
  shellCommand(
    "Probe Rendered Video (ffprobe)",
    `  const command = \`ffprobe -v error -show_entries format=duration,size -of json \${PROJECT_ROOT}/renders/\${item.json.id}.mp4\`;`
  )
);

push(
  code(
    "Validate Render QA",
    `return $input.all().map(item => {
  let probe = {};
  try { probe = JSON.parse(item.json.stdout); } catch (e) { probe = {}; }
  const duration = parseFloat((probe.format || {}).duration || '0');
  const minOk = duration >= 8 * 60;   // monetization-relevant minimum
  const maxOk = duration <= 16 * 60;  // sanity ceiling for this format
  return { json: { ...item.json, duration, qaPassed: minOk && maxOk } };
});`
  )
);

push(ifNode("If QA Passed", "={{ $json.qaPassed === true }}"));
const qaFailStop = noOp("Render QA Failed — Notify Human", "Rendered video duration is outside the 8-16 minute expected range, or ffprobe failed. Check the render manually before uploading.");
nodes.push(qaFailStop);
connect("If QA Passed", qaFailStop.name, 0);
connect("If QA Passed", "Upload to YouTube (Private)", 1);
prevName = "If QA Passed";

push(youTubeUpload("Upload to YouTube (Private)"));

push(
  httpRequest("Notify Human — Ready for Review", "={{$env.SLACK_WEBHOOK_URL}}", {
    jsonBody:
      "={{ JSON.stringify({ text: 'New Invisible Why video uploaded privately and ready for title/thumbnail/publish review: https://studio.youtube.com/video/' + $json.id + '/edit' }) }}",
  })
);
nodes[nodes.length - 1].continueOnFail = true;

push(
  code(
    "Log Production Status",
    `const fs = require('fs');
const path = require('path');
const PROJECT_ROOT = $env.INVISIBLE_WHY_ROOT || '/data/youtube-invisible-why';
const logPath = path.join(PROJECT_ROOT, 'published/status-log.json');

return $input.all().map(item => {
  let log = [];
  try { log = JSON.parse(fs.readFileSync(logPath, 'utf8')); } catch (e) { log = []; }
  log.push({ id: item.json.id, uploadedAt: new Date().toISOString(), status: 'private-uploaded-pending-review' });
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
  return { json: item.json };
});`
  )
);

// ---------------------------------------------------------------------------
// assemble + validate + write
// ---------------------------------------------------------------------------

const nodeNames = new Set(nodes.map((n) => n.name));
const dupes = nodes.map((n) => n.name).filter((n, i, arr) => arr.indexOf(n) !== i);
if (dupes.length) throw new Error("Duplicate node names: " + dupes.join(", "));

for (const [from, conn] of Object.entries(connections)) {
  if (!nodeNames.has(from)) throw new Error(`Connection source "${from}" is not a node`);
  for (const branch of conn.main) {
    for (const target of branch) {
      if (!nodeNames.has(target.node)) throw new Error(`Connection target "${target.node}" (from "${from}") is not a node`);
    }
  }
}

const workflow = {
  name: "The Invisible Why — Production Pipeline",
  nodes,
  connections,
  pinData: {},
  settings: { executionOrder: "v1" },
  staticData: null,
  meta: { instanceId: "invisible-why-pipeline" },
  id: "invisible-why-production-pipeline",
  tags: [],
};

fs.writeFileSync(OUT_FILE, JSON.stringify(workflow, null, 2));
console.log(`Wrote ${nodes.length} nodes to ${OUT_FILE}`);
