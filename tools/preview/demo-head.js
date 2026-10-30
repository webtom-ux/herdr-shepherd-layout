import { appHome, machines, run, writeTextFile, home, knownAgents, props, openOverlay, closeOverlay, window, shared, setShared, nextCommand } from "herdr";

// Demo data for the preview screenshot: no real spaces, agents or files.
const T0 = Date.now();
const ago_ = (s) => T0 - s * 1000;
const DEMO_SPACES = [
  { id: "s1", name: "webshop", machine: null, tabs: [
    { id: "a1", name: "checkout", named: true }, { id: "a2", name: "login", named: true },
    { id: "a3", name: "dev-server", named: true }, { id: "a4", name: "orders", named: true } ] },
  { id: "s2", name: "api-gateway", machine: null, tabs: [
    { id: "b1", name: "limits", named: true }, { id: "b2", name: "docs", named: true },
    { id: "b3", name: "logs", named: true } ] },
  { id: "s3", name: "ml-pipeline", machine: "buildbox", tabs: [
    { id: "c1", name: "train-eval", named: true }, { id: "c2", name: "data-cleanup", named: true } ] },
];
const P = (terminal, tab, prog, status, title) => ({ terminal, tab, pane: `p${terminal}`, title,
  program: prog ? { agent: true, key: prog, name: prog } : null, status });
const DEMO_PANES = [
  P("t1", "a1", "claude", "working", "Updating cart totals and tax rules"),
  P("t2", "a2", "claude", "done", "Tests pass, PR #214 ready for review"),
  P("t3", "a3", null, null, ""),
  P("t4", "a4", "codex", "blocked", "Approve schema change for orders table?"),
  P("t5", "b1", "claude", "working", "Adding token bucket per API key"),
  P("t6", "b2", "pi", "idle", "Waiting for next task"),
  P("t7", "b3", null, null, ""),
  P("buildbox/t8", "c1", "claude", "working", "Running eval on validation split"),
  P("buildbox/t9", "c2", "grok", "done", "Removed 1,284 duplicate rows"),
];
// address: [seconds since status change, age in seconds, program, pid of a Claude session]
const DEMO_INFO = {
  t1: [2, 2400, "claude", 101], t2: [40, 3900, "claude", 102], t3: [0, 7200, "npm"], t4: [95, 5100, "codex"],
  t5: [6, 1500, "claude", 105], t6: [600, 9000, "pi"], t7: [0, 10800, "tail"],
  "buildbox/t8": [12, 4300, "claude", 108], "buildbox/t9": [300, 6600, "grok"],
};
const SESS = { 101: ["webshop", 4.12], 102: ["webshop", 1.87], 105: ["api-gateway", 2.64], 108: ["ml-pipeline", 6.31] };
const SCREEN = [
  "⏺ Update(src/cart/totals.ts)",
  "  ⎿  Updated src/cart/totals.ts with 18 additions and 6 removals",
  "⏺ Bash(npm test -- cart)",
  "  ⎿  PASS  src/cart/totals.test.ts (14 tests)",
  "     PASS  src/cart/tax.test.ts (9 tests)",
  "⏺ Now applying the reduced tax rate to digital goods…",
  "",
  "✻ Working… (2m 14s · ↓ 8.2k tokens)",
].join("\n");
const spaces = () => DEMO_SPACES;
const panes = () => DEMO_PANES;
const agents = () => DEMO_PANES.filter((p) => p.program).map((p) => ({ address: p.terminal, status: p.status }));
const terminals = () => [{ address: "t10", state: "live", parent: "t1" }, { address: "t11", state: "live", parent: "t5" }];
async function hc(args) {
  if (args[0] === "read") return { code: 0, stdout: JSON.stringify({ text: SCREEN }), stderr: "" };
  if (args[0] !== "get") return { code: 0, stdout: "", stderr: "" };
  const [changed, created, fg, pid] = DEMO_INFO[args[1]] ?? [0, 0, "sh"];
  return { code: 0, stdout: JSON.stringify({ status_ms: ago_(changed), created_ms: ago_(created),
    foreground: { argv: [fg], pid: pid ?? null, cwd: "/demo" }, status: { app: fg } }), stderr: "" };
}
async function exec() { return { code: 1, stdout: "", stderr: "" }; }
async function readTextFile(path) {
  if (path.endsWith("cli-models.json")) return JSON.stringify({ claude: { default: "opus", models: [{ id: "opus", label: "Opus", efforts: ["low", "medium", "high"] }] } });
  if (path.endsWith("quota-cache.json")) return JSON.stringify({ at: T0 / 1000, rate_limits: {
    five_hour: { used_percentage: 34, resets_at: T0 / 1000 + 2 * 3600 }, seven_day: { used_percentage: 62, resets_at: T0 / 1000 + 3 * 86400 } } });
  const sm = path.match(/\/sessions\/(\d+)\.json$/);
  if (sm && SESS[sm[1]]) return JSON.stringify({ name: null, sessionId: `demo-${sm[1]}`, cwd: `/demo/${SESS[sm[1]][0]}` });
  const cm = path.match(/statusline-cache\/demo-(\d+)\.json$/);
  if (cm) return JSON.stringify({ model: { display_name: "Opus" }, cost: { total_cost_usd: SESS[cm[1]][1] },
    context_window: { context_window_size: 1000000, used_percentage: 10.2, current_usage: { input_tokens: 2000, cache_read_input_tokens: 96000, cache_creation_input_tokens: 4000 } } });
  if (path.endsWith("data/shepherd/state.json")) return JSON.stringify({
    cfg: { who: "claude", model: "Opus", effort: "high", lang: "en", preview: true }, stars: ["t2"], sel: "t1",
    short: { "demo-101": "cart-tax-rules", "demo-102": "fix-login-bug", "demo-105": "api-rate-limits", "demo-108": "eval-validation" } });
  return null;
}
