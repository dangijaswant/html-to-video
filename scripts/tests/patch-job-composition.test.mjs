// Tests for scripts/patch-job-composition.mjs — the composition patcher that the
// "Render HQ Job" workflow runs before capturing frames. Exercises it as a child
// process (exactly as CI does) against fixture job files in scripts/tests/fixtures/.
//
// No dependencies: plain node:assert. Run: `node scripts/tests/patch-job-composition.test.mjs`

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures");
const PATCHER = path.join(__dirname, "..", "patch-job-composition.mjs");

function runPatcher(fixture, outDir) {
  const jobPath = path.join(FIXTURES, fixture);
  const res = spawnSync(process.execPath, [PATCHER, jobPath, outDir], {
    encoding: "utf8",
  });
  assert.equal(res.status, 0, `patcher failed for ${fixture}:\n${res.stderr}`);
  return outDir;
}

let passed = 0;
function test(name, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patch-test-"));
  try {
    fn(dir);
    passed++;
    console.log(`ok - ${name}`);
  } catch (err) {
    fs.rmSync(dir, { recursive: true, force: true });
    console.error(`FAIL - ${name}\n${err.message}`);
    process.exitCode = 1;
  }
}

test("bare HTML is wrapped in a HyperFrames root/clip", (dir) => {
  runPatcher("bare-job.json", dir);
  const html = fs.readFileSync(path.join(dir, "composition.html"), "utf8");
  assert.match(html, /id="root"/);
  assert.match(html, /class="stage clip"/);
  assert.match(html, /id="main-clip"/);
});

test("bare HTML keeps its body content and sets the composition timing", (dir) => {
  runPatcher("bare-job.json", dir);
  const html = fs.readFileSync(path.join(dir, "composition.html"), "utf8");
  const settings = JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8"));
  assert.match(html, /<h1>It is a very good day to do good things<\/h1>/, "body content preserved");
  assert.ok(html.includes(`data-duration="${settings.duration}"`), "duration retimed");
  assert.ok(html.includes(`data-fps="${settings.fps}"`), "fps retimed");
});

test("existing compositions are NOT re-wrapped, only retimed", (dir) => {
  runPatcher("wrapped-job.json", dir);
  const html = fs.readFileSync(path.join(dir, "composition.html"), "utf8");
  const settings = JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8"));
  assert.match(html, /id="root"/);
  // the job's own clip keeps its content; timing attrs are overwritten
  assert.match(html, /<div class="logo reveal">/);
  // exactly one main-clip div: a double-wrap would emit a second one
  const mainClipCount = (html.match(/id="main-clip"/g) || []).length;
  assert.equal(mainClipCount, 1, "composition must not be double-wrapped");
  // the original 4s duration is replaced by the job's 10s everywhere
  assert.ok(!html.includes('data-duration="4"'), "stale duration must be retimed");
  assert.ok(html.includes(`data-duration="${settings.duration}"`));
  // viewport meta is rewritten to the job dimensions
  assert.match(html, new RegExp(`width=${settings.width}, height=${settings.height}`));
});

test("settings.json mirrors the job (width/height/fps/duration/formats)", (dir) => {
  runPatcher("wrapped-job.json", dir);
  const settings = JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8"));
  assert.deepEqual(settings, {
    width: 1080,
    height: 1920,
    fps: 30,
    duration: 10,
    formats: ["webm", "webp"],
  });
});

test("meta.json and hyperframes.json are written for the job", (dir) => {
  runPatcher("bare-job.json", dir);
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
  assert.equal(meta.id, "job-test");
  const hf = JSON.parse(fs.readFileSync(path.join(dir, "hyperframes.json"), "utf8"));
  assert.match(hf.registry, /hyperframes/);
});

console.log(`\n${passed} passed${process.exitCode ? " (WITH FAILURES)" : ""}`);
