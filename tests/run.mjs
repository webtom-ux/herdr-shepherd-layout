// Checks the session readers and helpers embedded in mods/shepherd/main.js against the
// anonymous sessions in fixtures/: Claude Code, Codex (older and newer rollouts), pi, grok.
// Run with `node --test tests/` (Node 20+, python3 and lsof on PATH). Nothing here talks to
// Herdr, the agents or the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fx = join(here, "fixtures");
const src = readFileSync(join(here, "../shepherd/mods/shepherd/main.js"), "utf8");

// A python script kept in main.js as a template string.
const script = (name) => src.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`))[1];
// A top-level function of main.js, evaluated on its own.
const fn = (name) => new Function(`${src.match(new RegExp(`function ${name}[\\s\\S]*?\\n}\\n`))[0]}; return ${name};`)();

function py(name, args, env = {}) {
  const r = spawnSync("python3", ["-I", "-c", script(name), ...args], { encoding: "utf8", env: { ...process.env, ...env } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout.trim();
}
const json = (name, args, env) => JSON.parse(py(name, args, env) || "null");

// A process that holds `file` open, as an agent holds its session file.
async function holding(file, body) {
  const p = spawn("python3", ["-c", `import time; f = open(${JSON.stringify(file)}); time.sleep(30)`]);
  await new Promise((ok) => setTimeout(ok, 400));
  try { return await body(String(p.pid)); } finally { p.kill(); }
}

const CLAUDE = join(fx, "claude/session.jsonl");
const CODEX_OLD = join(fx, "codex/rollout-old.jsonl");
const CODEX_NEW = join(fx, "codex/rollout-new.jsonl");
const PI = join(fx, "pi/--work-site--/2026-10-30T10-00-00_pi1.jsonl");
const GROK = join(fx, "grok/%2Fwork%2Fsite/grok-1");

test("FIRST_ASK finds the first real request of every agent", () => {
  assert.equal(py("FIRST_ASK", [CLAUDE]), "Add dark mode to the settings page");
  assert.equal(py("FIRST_ASK", [CODEX_OLD]), "Fix the flaky checkout test please");
  assert.equal(py("FIRST_ASK", [CODEX_NEW]), "Run a security check on the API");
  assert.equal(py("FIRST_ASK", [PI]), "Make the gallery on the start page responsive");
  assert.equal(py("FIRST_ASK", [GROK]), "Write tests for the contact form please");
});

test("AGENT_READ: codex context, model, effort and quota", () => {
  const d = json("AGENT_READ", ["codex", CODEX_OLD]);
  assert.deepEqual([d.used, d.size, d.model, d.effort], [25500, 272000, "gpt-5-codex", "high"]);
  assert.equal(d.rate_limits.primary.used_percent, 12);
  const n = json("AGENT_READ", ["codex", CODEX_NEW]);
  assert.deepEqual([n.used, n.size, n.model], [81851, 475000, "gpt-6.1-sol"]);
});

test("AGENT_READ: pi context, cost, thinking level and cache", () => {
  const d = json("AGENT_READ", ["pi", PI]);
  assert.deepEqual([d.used, d.model, d.effort, d.cache], [43500, "claude-sonnet-4-5", "high", 300]);
  assert.equal(d.cost, 0.05);
});

test("AGENT_READ: grok context, model, effort and cost", () => {
  const d = json("AGENT_READ", ["grok", GROK]);
  assert.deepEqual([d.used, d.model, d.effort, d.cost], [52900, "grok-4.5-build", "medium", 1.2]);
});

test("AGENT_FIND: the session file the process holds open", async () => {
  await holding(CODEX_NEW, async (pid) => {
    assert.deepEqual(json("AGENT_FIND", ["codex", pid, "/elsewhere"]), { path: CODEX_NEW, id: "codex-new", cwd: "/work/api" });
  });
  const home = mkdtempSync(join(tmpdir(), "shepherd-grok-"));
  cpSync(join(fx, "grok"), join(home, "sessions"), { recursive: true });
  const dir = join(home, "sessions/%2Fwork%2Fsite/grok-1");
  await holding(join(dir, "updates.jsonl"), async (pid) => {
    assert.equal(json("AGENT_FIND", ["grok", pid, "/elsewhere"], { GROK_HOME: home }).id, "grok-1");
  });
});

test("AGENT_FIND: else the session of the same folder that started with the process", async () => {
  const home = mkdtempSync(join(tmpdir(), "shepherd-pi-"));
  const dir = join(home, "sessions/--work-site--");
  mkdirSync(dir, { recursive: true });
  const lines = readFileSync(PI, "utf8").trim().split("\n");
  const at = (s) => new Date(Date.now() + s * 1000).toISOString();
  // An old session of the same folder, and one that starts now.
  for (const [name, start] of [["old", -3600], ["now", 1]]) {
    const head = { ...JSON.parse(lines[0]), id: `pi-${name}`, timestamp: at(start) };
    writeFileSync(join(dir, `${name}.jsonl`), [JSON.stringify(head), ...lines.slice(1)].join("\n") + "\n");
  }
  const p = spawn("python3", ["-c", "import time; time.sleep(30)"]);
  try {
    const f = json("AGENT_FIND", ["pi", String(p.pid), "/work/site"], { PI_CODING_AGENT_DIR: home });
    assert.equal(f.id, "pi-now");
    assert.equal(json("AGENT_FIND", ["pi", String(p.pid), "/other"], { PI_CODING_AGENT_DIR: home }), null);
  } finally { p.kill(); }
});

test("MODELS_SEEN lists the models each agent used", () => {
  const root = mkdtempSync(join(tmpdir(), "shepherd-models-"));
  cpSync(join(fx, "codex"), join(root, "codex/sessions/2026/10/30"), { recursive: true });
  writeFileSync(join(root, "codex/config.toml"), 'model = "gpt-6.1-sol"\n');
  cpSync(join(fx, "pi"), join(root, "pi/sessions"), { recursive: true });
  cpSync(join(fx, "grok"), join(root, "grok/sessions"), { recursive: true });
  const d = json("MODELS_SEEN", [], { CODEX_HOME: join(root, "codex"), PI_CODING_AGENT_DIR: join(root, "pi"), GROK_HOME: join(root, "grok") });
  assert.equal(d.codex[0], "gpt-6.1-sol");
  assert.ok(d.codex.includes("gpt-5-codex"));
  assert.deepEqual(d.pi, ["claude-sonnet-4-5"]);
  assert.deepEqual(d.grok, ["grok-4.5-build"]);
});

test("abbr gives three letters per repo name", () => {
  const abbr = fn("abbr");
  for (const [name, code] of [["webshop", "wbs"], ["invoicing", "inv"], ["landing-page", "lnp"],
    ["api-gateway", "apg"], ["Customer-Portal-App", "cpa"], [".dotfiles", "dtf"], ["ml", "ml"]]) {
    assert.equal(abbr(name), code, name);
  }
});

test("codexWindows labels quota windows by their length", () => {
  const w = fn("codexWindows")({ primary: { used_percent: 12, window_minutes: 300, resets_at: 100 },
    secondary: { used_percent: 40, window_minutes: 10080, resets_in_seconds: 60 } }, "2026-10-30T10:00:00Z");
  assert.deepEqual(w[0], ["5h", { used_percentage: 12, resets_at: 100 }]);
  assert.equal(w[1][0], "7d");
  assert.equal(w[1][1].resets_at, Date.parse("2026-10-30T10:00:00Z") / 1000 + 60);
});

test("outputLines keeps only the agent's output", () => {
  const out = fn("outputLines");
  const rule = "─".repeat(60);
  const claude = ["⏺ Fixed the cart totals.", "", "✽ Thinking… (16s · ↓ 1.2k tokens)", "Now: step two",
    "                              ✔ Update installed · /restart to apply", rule, "❯ ", rule,
    "  Opus 5.5 (medium) · 7d 18%", "  ⏵⏵ auto mode on (shift+tab to cycle)"].join("\n");
  assert.deepEqual(out(claude, 8), ["⏺ Fixed the cart totals."]);
  const codex = ["  Tests pass now.", "", "  Worked for 3m 9s • 01:23", "", "› Ask Codex to do anything", "",
    "  GPT-6.1-Sol medium · ~/work", "  ? for shortcuts"].join("\n");
  assert.deepEqual(out(codex, 8), ["  Tests pass now."]);
  assert.deepEqual(out("a\nb\nc\n\n", 2), ["b", "c"]);
});

test("SAFE_VALUE lets model names through, not options or quotes", () => {
  const safe = new Function(`${src.match(/const SAFE_VALUE = .*;/)[0]} return SAFE_VALUE;`)();
  for (const ok of ["Opus 5.5", "claude-opus-5-5[1m]", "gpt-6.1-sol", "grok-4.5-build", "openrouter/x:free"]) assert.ok(safe.test(ok), ok);
  for (const bad of ["--dangerously-skip-permissions", "-m", "", 'x"; y', "a\nb"]) assert.ok(!safe.test(bad), bad);
});
