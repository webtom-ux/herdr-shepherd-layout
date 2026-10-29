// Shepherd: every terminal of every space in one list, a summary on top and a
// command line at the bottom. ↑/↓ or a click selects a row, a double click or
// Enter on an empty line peeks at it. Text goes to the selected terminal; on a
// space header, or with /new, it starts a new agent with /who /where /model /effort.
// Right click or /star stars a row (starred rows lead their space).
// /space <folder> [name] makes a space running the /who agent and sets it as /where;
// /space gh:owner/repo [name] clones the GitHub repo into ~/dev first (or reuses its clone).
// /close (or ⌘⌫ on an empty line) closes the selected agent, /close done every finished
// one, /close shells every shell, /close space [name] a whole space (the selected
// row's unless named); each asks first, Enter says yes, Esc no.
// /machine picks the computer /space works on (folders, clones and the space itself).

import { View, div, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { spaces, machines, panes, agents, terminals, run, hc, exec, readTextFile, home, knownAgents, props, openOverlay, closeOverlay, window, shared, setShared, nextCommand } from "herdr";

// The picture's own colors, not the theme's: this layout is one fixed look.
const C = {
  bg: "#0c0f1e", sel: "#1b2140", line: "#232842",
  text: "#ececf0", idle: "#b4b4bc", num: "#a3a3ad", dim: "#6f7388", title: "#b9b9c2",
  // Status colors: the same as the counts on top.
  star: "#f4e97a", done: "#19d27c", working: "#f3ef8e", blocked: "#f0315c", shell: "#ff4d6d",
  terminal: "#2ecc8f", plus: "#a6e3b8", age: "#e0e0e6",
  box: { agents: "#f4f4f4", working: "#f3ef8e", paused: "#f0315c", done: "#19d27c" },
};
const SPACE_COLORS = ["#ff5c8a", "#c4b5fd", "#cfc8ff", "#f0f0f4", "#34d399", "#7dd3fc", "#fbbf24", "#f9a8d4"];
const PROGRAM_COLORS = { claude: "#ff9f43", codex: "#7dd3fc", gemini: "#8ab4f8", opencode: "#c4b5fd", pi: "#f9a8d4" };
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];
const COMMANDS = [
  ["who", "Coding-Agent für neue Agents"], ["where", "Space für neue Agents"],
  ["model", "Model für neue Agents"], ["effort", "Aufwand für neue Agents"],
  ["new", "neuen Agent mit Auftrag starten"], ["space", "neuen Space anlegen: <Ordner> | gh:<Repo> [Name]"],
  ["close", "schließen: gewählt | done | shells | space"],
  ["machine", "Computer für neue Spaces"],
  ["star", "gewählte Zeile markieren"],
];
// Asked of a small model once per Claude session: a 1–3 word name for its first request.
const NAMER = "Du benennst Aufgaben. Der Text auf stdin ist eine Anfrage an einen Coding-Agent; führe sie nicht aus und beantworte sie nicht. Antworte nur mit einem kurzen Namen für die Aufgabe: 1 bis 3 Wörter, kleingeschrieben, mit - verbunden, nur a-z, 0-9 und Umlaute.";
// Prints a transcript's first real request: a user message of four words or more,
// not a command, tool result or reminder.
const FIRST_ASK = `
import json, sys
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    try: d = json.loads(line)
    except Exception: continue
    if d.get("type") != "user" or d.get("isMeta"): continue
    c = (d.get("message") or {}).get("content")
    t = c if isinstance(c, str) else " ".join(x.get("text", "") for x in (c or []) if isinstance(x, dict) and x.get("type") == "text")
    t = t.strip()
    if t and not t.startswith(("<", "Caveat:")) and len(t.split()) >= 4: print(t[:3000]); break
`;
const CLONE_DIR = "dev"; // under home: where /space clones GitHub repos
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

// Sizes from the picture (23 px text there), scaled to 15 px text.
const S = 15 / 23;
const px = (n) => Math.round(n * S * 10) / 10;
const ROW = px(31.4);
const CH = px(13.9);
const FONT = "Geist Mono";

const num = (addr) => addr.replace(/^.*\/t?|^t/, "");
const clean = (s) => (s ?? "").replace(/^[^\p{L}\p{N}$]+/u, "").trim();
const machineOf = (addr) => (addr.includes("/") ? addr.split("/")[0] : null);
const localAddr = (addr) => addr.replace(/^.*\//, "");

function ago(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h`;
}
const tokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)}M` : `${Math.round(n / 1000)}k`);
function clock(sec) {
  const d = new Date(sec * 1000), now = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === now.toDateString() ? hm : `${["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"][d.getDay()]} ${hm}`;
}
const programKey = (p) => (p?.agent ? (p.key || "agent").toLowerCase().replace(/-code$/, "") : null);

export default class Shepherd extends View {
  init(_props, cx) {
    // The layout block only holds the place: Herdr keeps the keyboard with its
    // panes there, so the list lives in a frameless window over the block,
    // where the line and the keys reach it.
    this.host = !props()?.overlay;
    if (this.host) return;
    setShared("shepherd.window", props().overlay);
    this.handle = cx.focus_handle();
    this.top = 0;       // first shown row
    this.listH = 600;   // the list's height, px
    this.wheel = 0;     // scroll px not yet a whole row
    this.input = InputState.new({ placeholder: "" });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.sugI = 0; if (this.text && this.confirm) { this.confirm = null; this.msg = null; } this.loadDirs(cx); cx.notify(); });
    this.sugI = 0;       // highlighted suggestion
    this.dirs = { for: null, list: [] }; // folders for /space's path
    this.input.on("submit", (_e, cx) => { this.submit(cx); cx.notify(); });
    // The line keeps the keyboard: ↑/↓ reach the list from it, Enter submits it.
    this.typing = false;
    this.input.on("focus", (_e, cx) => { this.typing = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.typing = false; cx.notify(); });
    this.input.focus();
    // Escape (keys.json, layout:shepherd) closes the open agent, else clears the line.
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c !== "escape") continue;
        if (this.confirm) { this.confirm = null; this.msg = null; }
        else if (this.peeked) { closeOverlay(this.peeked); this.peeked = null; this.input.focus(); }
        else { this.input.set_value(""); this.text = ""; this.msg = null; }
        cx.notify();
      }
    });
    this.text = "";
    this.selKey = localStorage.getItem("sel");
    this.stars = JSON.parse(localStorage.getItem("stars") ?? "[]");
    this.short = JSON.parse(localStorage.getItem("short") ?? "{}"); // session id → short name
    this.naming = new Set(); // session ids being named
    this.cfg = { who: "claude", where: null, model: null, effort: "medium", ...JSON.parse(localStorage.getItem("cfg") ?? "{}") };
    this.info = {};     // address → hc get facts
    this.sess = {};     // address → Claude Code session (name, id, cwd)
    this.ctx = {};      // address → context and cache of its session
    this.quota = {};    // agent kind → quota windows
    this.models = { claude: [] };
    this.agentsKnown = [];
    this.repos = [];    // GitHub repos, for /space gh:
    this.clones = {};   // owner/repo (lower case) → its folder under ~/dev
    this.mhome = home(); // home folder on /machine's computer
    this.msg = null;
    cx.spawn(async (cx) => { await this.loadStatic(); await this.refresh(); await this.refreshSelected(); cx.notify(); });
    cx.timer.every(8000, (cx) => cx.spawn(async (cx) => { await this.refresh(); cx.notify(); }));
    cx.timer.every(3000, (cx) => cx.spawn(async (cx) => { this.adoptNewSpace(); await this.refreshSelected(); cx.notify(); }));
  }

  save() {
    localStorage.setItem("cfg", JSON.stringify(this.cfg));
    localStorage.setItem("stars", JSON.stringify(this.stars));
    if (this.selKey) localStorage.setItem("sel", this.selKey);
  }

  async loadStatic() {
    try {
      const m = JSON.parse((await readTextFile(`${home()}/.shepherdr/cli-models.json`)) ?? "{}");
      this.models.claude = [...(m.claude?.models ?? []), ...(m.claude?.others ?? [])];
      if (!this.cfg.model) this.cfg.model = (m.claude?.models ?? []).find((x) => x.id === m.claude?.default)?.label ?? "Opus 5.5";
    } catch {}
    try { this.agentsKnown = await knownAgents(); } catch {}
    await this.loadRepos();
  }

  // Every GitHub repo gh can reach, recently pushed first, and which ones ~/dev already holds.
  async loadRepos() {
    try {
      const r = await exec("gh", ["api", "user/repos?per_page=100&sort=pushed", "--paginate", "--jq", '.[] | [.full_name, (.description // "")] | @tsv']);
      if (r.code === 0) this.repos = r.stdout.split("\n").filter(Boolean).map((l) => { const [repo, desc] = l.split("\t"); return { repo, desc }; });
    } catch {}
    await this.loadMachine();
  }

  // /machine's home folder and the repos its ~/dev already holds.
  async loadMachine() {
    const on = this.cfg.machine ?? undefined;
    this.clones = {};
    this.dirs = { for: null, list: [] };
    try {
      const r = await exec("sh", ["-c", 'printf "%s\\n" "$HOME"; for d in "$HOME/$1"/*/; do u=$(git -C "$d" remote get-url origin 2>/dev/null) && printf "%s\\t%s\\n" "${d%/}" "$u"; done', "sh", CLONE_DIR], { on });
      if (r.code !== 0) throw new Error(r.stderr);
      const [h, ...rest] = r.stdout.split("\n");
      this.mhome = h || home();
      r.stdout = rest.join("\n");
      for (const l of r.stdout.split("\n").filter(Boolean)) {
        const [dir, url] = l.split("\t");
        const m = url.match(/github\.com[:/](.+?)(\.git)?\/?$/);
        if (m) this.clones[m[1].toLowerCase()] = dir;
      }
    } catch { this.mhome = on ? "~" : home(); }
  }

  // Facts hc keeps per terminal (start, last change, foreground pid) and the
  // Claude Code session behind each claude terminal.
  async refresh() {
    for (const p of panes()) {
      if (!p.terminal) continue;
      const addr = p.terminal;
      try {
        const r = await hc(["get", addr, "--json"]);
        if (r.code !== 0) continue;
        const g = JSON.parse(r.stdout);
        this.info[addr] = g;
        const on = machineOf(addr);
        const pid = g.foreground?.pid;
        const isClaude = (g.status?.app ?? "").startsWith("claude") || (g.foreground?.argv?.[0] ?? "").endsWith("claude");
        if (pid && isClaude) {
          const s = JSON.parse((await readTextFile(`${home()}/.claude/sessions/${pid}.json`, { on })) ?? "null");
          if (s) this.sess[addr] = { name: s.name, id: s.sessionId, cwd: s.cwd, on };
          if (s && !this.short[s.sessionId]) this.nameSession(this.sess[addr]);
        }
      } catch {}
    }
    await this.loadQuota();
  }

  // The first real request (FIRST_ASK), named by NAMER;
  // retried on a later refresh while the session has none yet.
  async nameSession(s) {
    if (this.naming.has(s.id)) return;
    this.naming.add(s.id);
    try {
      const path = `${home()}/.claude/projects/${s.cwd.replace(/[^A-Za-z0-9]/g, "-")}/${s.id}.jsonl`;
      // Streamed by python: a message with an image is one huge line.
      const r = await exec("python3", ["-I", "-c", FIRST_ASK, path], { on: s.on });
      const ask = (r.stdout ?? "").trim();
      if (!ask) return;
      const n = await exec("sh", ["-c", 'printf "%s" "$1" | claude -p --model haiku --no-session-persistence --tools "" --setting-sources "" --strict-mcp-config --system-prompt "$2" "Name für diese Anfrage:"', "sh", ask.slice(0, 3000), NAMER], { cwd: home() });
      const name = (n.stdout ?? "").trim().split("\n").pop().toLowerCase()
        .replace(/[^a-z0-9äöüß-]+/g, "-").split("-").filter(Boolean).slice(0, 3).join("-");
      if (n.code !== 0 || !name) return;
      this.short[s.id] = name;
      localStorage.setItem("short", JSON.stringify(this.short));
    } catch {} finally { this.naming.delete(s.id); }
  }

  async loadQuota() {
    try {
      const q = JSON.parse((await readTextFile(`${home()}/.claude/quota-cache.json`)) ?? "null");
      if (q?.rate_limits) this.quota.claude = { at: q.at, windows: [["5h", q.rate_limits.five_hour], ["7d", q.rate_limits.seven_day]] };
    } catch {}
    if (this.cfg.who === "codex") {
      try {
        const r = await exec("sh", ["-c", "f=$(ls -t ~/.codex/sessions/*/*/*/*.jsonl 2>/dev/null | head -1); [ -n \"$f\" ] && grep rate_limits \"$f\" | tail -1"]);
        const d = JSON.parse(r.stdout.trim() || "null");
        const rl = d?.payload?.rate_limits ?? d?.rate_limits;
        if (rl) {
          const w = (x) => x && { used_percentage: x.used_percent, resets_at: x.resets_at ?? (x.resets_in_seconds ? Date.now() / 1000 + x.resets_in_seconds : null) };
          this.quota.codex = { at: Date.parse(d.timestamp) / 1000 || null, windows: [["5h", w(rl.primary)], ["7d", w(rl.secondary)]] };
        }
      } catch {}
    }
  }

  // Context window and prompt cache of the selected row's session.
  async refreshSelected() {
    const row = this.rows && this.selected();
    const s = row?.addr && this.sess[row.addr];
    if (!s?.id) return;
    const out = { at: Date.now() };
    try {
      const line = JSON.parse((await readTextFile(`${home()}/.claude/statusline-cache/${s.id}.json`, { on: s.on })) ?? "null");
      const cw = line?.context_window;
      if (cw?.context_window_size) {
        const u = cw.current_usage ?? {};
        out.size = cw.context_window_size;
        out.used = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) || null;
        out.pct = cw.used_percentage ?? (out.used ? (100 * out.used) / out.size : null);
        out.model = line.model?.display_name;
        out.effort = line.effort?.level;
      }
    } catch {}
    try {
      const path = `${home()}/.claude/projects/${s.cwd.replace(/[^A-Za-z0-9]/g, "-")}/${s.id}.jsonl`;
      const r = await exec("tail", ["-c", "600000", path], { on: s.on });
      const lines = r.stdout.split("\n").slice(1);
      let last = null, ttl = null;
      for (let i = lines.length - 1; i >= 0; i--) {
        if (!lines[i].includes('"usage"')) continue;
        let d;
        try { d = JSON.parse(lines[i]); } catch { continue; }
        const u = d.message?.usage;
        if (d.type !== "assistant" || !u) continue;
        if (!last) last = { at: Date.parse(d.timestamp), u, model: d.message.model };
        const cc = u.cache_creation ?? {};
        if (cc.ephemeral_1h_input_tokens > 0) { ttl = 3600e3; break; }
        if (cc.ephemeral_5m_input_tokens > 0) { ttl = 300e3; break; }
      }
      if (last) {
        out.cacheUntil = last.at + (ttl ?? 300e3);
        if (out.used == null) {
          out.used = (last.u.input_tokens ?? 0) + (last.u.cache_creation_input_tokens ?? 0) + (last.u.cache_read_input_tokens ?? 0);
          out.size = out.size ?? (/1m/i.test(last.model ?? "") ? 1e6 : 2e5);
          out.pct = (100 * out.used) / out.size;
        }
        out.model = out.model ?? last.model;
      }
    } catch {}
    this.ctx[row.addr] = out;
  }

  // Header and terminal rows, space by space; starred rows first, then by number.
  buildRows() {
    const all = panes();
    const live = terminals().filter((k) => k.state === "live");
    const status = new Map(agents().map((a) => [a.address, a.status]));
    const rows = [];
    spaces().forEach((sp, i) => {
      const tabIds = new Map(sp.tabs.map((t) => [t.id, t]));
      const mine = all.filter((p) => p.terminal && tabIds.has(p.tab)).map((p) => {
        const g = this.info[p.terminal] ?? {};
        const tab = tabIds.get(p.tab);
        const agent = Boolean(p.program?.agent || p.status);
        const fg = g.foreground?.argv?.[0]?.split("/").pop();
        const name = agent
          ? this.short[this.sess[p.terminal]?.id] || this.sess[p.terminal]?.name || (tab.named ? tab.name : null) || g.name || clean(p.title) || p.program?.name
          : `$ ${tab.named ? tab.name : g.name || `term-${num(p.terminal)}`}`;
        return {
          key: p.terminal, kind: "term", addr: p.terminal, pane: p.pane, tab: p.tab, space: sp, agent,
          status: agent ? (status.get(p.terminal) ?? p.status ?? "idle") : null,
          name,
          kids: live.filter((k) => k.parent === p.terminal).length,
          changed: g.status_ms ?? null,
          created: g.created_ms ?? null,
          program: agent ? programKey(p.program) ?? "agent" : "terminal",
          title: agent ? clean(g.status?.msg || g.title || p.title) : fg || clean(p.title),
          star: this.stars.includes(p.terminal),
        };
      });
      mine.sort((a, b) => (b.star - a.star) || (Number(num(a.addr)) - Number(num(b.addr))));
      const label = sp.machine ? `${sp.machine}/${sp.name}` : sp.name;
      rows.push({ key: `space:${sp.id}`, kind: "space", space: sp, label, count: mine.length, color: SPACE_COLORS[i % SPACE_COLORS.length] });
      rows.push(...mine);
    });
    return rows;
  }

  selected() {
    return this.rows.find((r) => r.key === this.selKey && r.kind === "term") ?? this.rows.find((r) => r.kind === "term");
  }

  // Steps over space headers: only terminals take a task.
  move(by, cx) {
    const terms = this.rows.filter((r) => r.kind === "term");
    if (!terms.length) return;
    const i = Math.max(0, terms.findIndex((r) => r.key === this.selected()?.key));
    const next = terms[Math.min(terms.length - 1, Math.max(0, i + by))];
    this.selKey = next.key;
    const j = this.rows.indexOf(next);
    // At the top of a space, show its header too.
    this.reveal(this.rows[j - 1]?.kind === "space" ? j - 1 : j);
    this.reveal(j);
    this.save();
    cx.spawn(async (cx) => { await this.refreshSelected(); cx.notify(); });
  }

  // Keeps row i on screen.
  reveal(i) {
    const fit = Math.max(1, Math.floor(this.listH / ROW));
    if (i < this.top) this.top = i;
    else if (i >= this.top + fit) this.top = i - fit + 1;
  }

  scrollBy(dy) {
    this.wheel += dy;
    const step = Math.trunc(this.wheel / ROW);
    if (!step) return false;
    this.wheel -= step * ROW;
    const fit = Math.max(1, Math.floor(this.listH / ROW));
    this.top = Math.max(0, Math.min(Math.max(0, this.rows.length - fit), this.top - step));
    return true;
  }

  // Where a new agent goes: /where's space, else the selected row's.
  whereSpace() {
    return spaces().find((s) => s.id === this.cfg.where) ?? this.selected()?.space ?? spaces()[0];
  }

  argvFor() {
    const who = this.cfg.who;
    const model = this.models.claude.find((m) => m.label === this.cfg.model || m.id === this.cfg.model);
    if (who === "claude") return ["claude", ...(model ? ["--model", model.id] : this.cfg.model ? ["--model", this.cfg.model] : []), "--effort", this.cfg.effort];
    if (who === "codex") return ["codex", ...(this.cfg.model ? ["-m", this.cfg.model] : []), "-c", `model_reasoning_effort="${this.cfg.effort}"`];
    return this.agentsKnown.find((a) => a.key === who)?.run ?? [who];
  }

  startAgent(task) {
    const sp = this.whereSpace();
    run("tab.new", { space: sp.id, argv: this.argvFor(), ...(task ? { task } : {}) });
    this.msg = { text: `Neuer ${this.cfg.who} in ${sp.name}`, ok: true };
  }

  // /space ~/dev/api [name]: a word that looks like a path is the folder, the rest the name.
  newSpace(arg, cx) {
    if (!arg) return (this.msg = { text: "/space <Ordner> | gh:<Repo> [Name]" });
    const words = arg.split(/\s+/);
    const gi = words.findIndex((w) => /^gh:/i.test(w));
    const repo = gi < 0 ? null : words.splice(gi, 1)[0].slice(3);
    const i = words.findIndex((w) => /^[~/.]/.test(w));
    let folder = i < 0 ? null : words.splice(i, 1)[0].replace(/^~(?=\/|$)/, this.mhome);
    const on = this.cfg.machine ?? undefined;
    const name = words.join(" ") || (repo ? repo.split("/").pop() : null);
    const make = () => {
      this.spacesBefore = new Set(spaces().map((s) => s.id));
      // Its first tab runs the /who agent with /model and /effort, not a shell.
      run("space.new", { ...(name ? { name } : {}), ...(folder ? { folder } : {}), ...(on ? { machine: on } : {}), argv: this.argvFor() });
      this.msg = { text: `Neuer Space ${name ?? folder} mit ${this.cfg.who}${on ? ` auf ${on}` : ""}`, ok: true };
      this.adoptNewSpace();
    };
    if (!repo) return make();
    folder ??= this.clones[repo.toLowerCase()];
    if (folder) return make();
    // Clone into ~/dev/<repo>, or ~/dev/<owner>-<repo> when that name is taken.
    this.msg = { text: `Klone ${repo}${on ? ` auf ${on}` : ""} …`, ok: true };
    cx.spawn(async (cx) => {
      const base = `${this.mhome}/${CLONE_DIR}`;
      const [owner, short] = repo.split("/");
      const taken = await exec("test", ["-e", `${base}/${short}`], { on });
      const dest = taken.code === 0 ? `${base}/${owner}-${short}` : `${base}/${short}`;
      const r = await exec("gh", ["repo", "clone", repo, dest], { on });
      if (r.code !== 0) { this.msg = { text: `Klonen fehlgeschlagen: ${(r.stderr ?? "").trim().split("\n").pop()}` }; return cx.notify(); }
      this.clones[repo.toLowerCase()] = dest;
      folder = dest;
      make();
      cx.notify();
    });
  }

  // Ask before closing: the selected row, every finished agent, or every shell.
  askClose(arg = "") {
    const [first, ...rest] = arg.split(/\s+/);
    const which = (this.options("close").find((o) => o.startsWith(first.toLowerCase())) ?? "gewählt");
    if (which === "space") return this.askCloseSpace(rest.join(" "));
    const terms = this.rows.filter((r) => r.kind === "term");
    const sel = this.selected();
    const list = which === "done" ? terms.filter((r) => r.agent && r.status === "done")
      : which === "shells" ? terms.filter((r) => !r.agent)
      : sel?.kind === "term" ? [sel] : [];
    if (!list.length) return (this.msg = { text: which === "gewählt" ? "Erst eine Agent-Zeile wählen" : `Keine ${which === "done" ? "fertigen Agents" : "Shells"}` });
    const busy = list.filter((r) => r.agent && r.status === "working").length;
    // Closing a space's last tab closes the space too.
    const gone = [...new Set(list.map((r) => r.space))].filter((sp) => sp.tabs.every((t) => list.some((r) => r.tab === t.id)));
    const what = list.length === 1 ? list[0].name : `${list.length} ${which === "shells" ? "Shells" : "fertige Agents"}`;
    this.confirm = list;
    this.msg = {
      text: `${what} schließen?${busy ? ` ${busy === 1 && list.length === 1 ? "Arbeitet noch!" : `${busy} arbeiten noch!`}` : ""}`
        + `${gone.length ? ` Schließt auch Space ${gone.map((sp) => sp.name).join(", ")}.` : ""}  Enter = ja · Esc = nein`,
      color: busy || gone.length ? C.blocked : C.star,
    };
  }

  // A whole space, with every agent and shell in it.
  askCloseSpace(name) {
    const low = name.toLowerCase();
    const sp = name
      ? spaces().find((s) => s.name.toLowerCase() === low) ?? spaces().find((s) => s.name.toLowerCase().includes(low))
      : this.selected()?.space;
    if (!sp) return (this.msg = { text: name ? `Kein Space „${name}“` : "Erst eine Zeile wählen" });
    const mine = this.rows.filter((r) => r.kind === "term" && r.space.id === sp.id);
    const agents = mine.filter((r) => r.agent).length;
    const busy = mine.filter((r) => r.agent && r.status === "working").length;
    this.confirm = { space: sp, rows: mine };
    this.msg = {
      text: `Space ${sp.name} schließen (${agents} Agents, ${mine.length - agents} Shells)?${busy ? ` ${busy} arbeiten noch!` : ""}  Enter = ja · Esc = nein`,
      color: C.blocked,
    };
  }

  // A terminal alone in its tab closes the tab; one beside others ends just itself.
  closeRows(list) {
    if (list.space) {
      run("space.close", { id: list.space.id, confirmed: true });
      if (this.cfg.where === list.space.id) { this.cfg.where = null; this.save(); }
      if (this.peeked && list.rows.some((r) => r.addr === this.peekedAddr)) { closeOverlay(this.peeked); this.peeked = null; }
      return (this.msg = { text: `Space ${list.space.name} geschlossen`, ok: true });
    }
    const all = panes();
    for (const tab of new Set(list.map((r) => r.tab))) {
      const mine = list.filter((r) => r.tab === tab);
      const others = all.filter((p) => p.tab === tab && !mine.some((r) => r.pane === p.pane));
      if (!others.length) run("tab.close", { id: tab, confirmed: true });
      else for (const r of mine) run("terminal.kill", { terminal: r.addr });
    }
    if (this.peeked && list.some((r) => r.addr === this.peekedAddr)) { closeOverlay(this.peeked); this.peeked = null; }
    this.msg = { text: `Geschlossen: ${list.length === 1 ? list[0].name : list.length}`, ok: true };
  }

  // The space /space just made becomes /where once Herdr lists it.
  adoptNewSpace() {
    if (!this.spacesBefore) return;
    const sp = spaces().find((s) => !this.spacesBefore.has(s.id));
    if (!sp) return;
    this.spacesBefore = null;
    this.cfg.where = sp.id;
    this.save();
    this.msg = { text: `Neuer Space ${sp.name} · where → ${sp.name}`, ok: true };
  }

  // Values a command can take, for the suggestions.
  options(cmd) {
    if (cmd === "close") return ["gewählt", "done", "shells", "space"];
    if (cmd === "machine") return ["lokal", ...machines().filter((m) => m.name && !m.temporary).map((m) => m.name)];
    if (cmd === "who") return (this.agentsKnown.length ? this.agentsKnown.filter((a) => a.installed).map((a) => programKey(a) ?? a.key) : ["claude", "codex"]);
    if (cmd === "where") return spaces().map((s) => s.name);
    if (cmd === "model") return this.cfg.who === "claude" ? this.models.claude.map((m) => m.label) : [];
    if (cmd === "effort") return EFFORTS;
    return [];
  }

  command(cmd, arg, cx) {
    const pick = (list) => list.find((o) => o.toLowerCase() === arg.toLowerCase()) ?? list.find((o) => o.toLowerCase().includes(arg.toLowerCase()));
    const set = (k, v, shown = v) => { this.cfg[k] = v; this.save(); this.msg = { text: `${cmd} → ${shown}`, ok: true }; };
    if (cmd === "new") return this.startAgent(arg);
    if (cmd === "space") return this.newSpace(arg, cx);
    if (cmd === "close") return this.askClose(arg);
    if (cmd === "star") {
      const r = this.selected();
      if (r?.kind !== "term") return;
      this.stars = this.stars.includes(r.addr) ? this.stars.filter((s) => s !== r.addr) : [...this.stars, r.addr];
      return this.save();
    }
    if (cmd === "machine") {
      const list = this.options("machine");
      if (!arg) return (this.msg = { text: `/machine: ${list.join("  ")}` });
      const v = pick(list);
      if (!v) return (this.msg = { text: `Kein Computer „${arg}“ (hc machine add …)` });
      set("machine", v === "lokal" ? null : v, v);
      return cx?.spawn(async (cx) => { await this.loadMachine(); cx.notify(); });
    }
    if (!["who", "where", "model", "effort"].includes(cmd)) return (this.msg = { text: `Unbekannt: /${cmd}  (/who /where /model /effort /new /space /machine /star)` });
    if (!arg) return (this.msg = { text: `/${cmd}: ${this.options(cmd).join("  ") || "Name eingeben"}` });
    if (cmd === "where") {
      if (arg === "." || arg === "-") return set("where", null, "gewählter Space");
      const sp = spaces().find((s) => s.name.toLowerCase() === arg.toLowerCase()) ?? spaces().find((s) => s.name.toLowerCase().includes(arg.toLowerCase()));
      return sp ? set("where", sp.id, sp.name) : (this.msg = { text: `Kein Space „${arg}“` });
    }
    if (cmd === "effort") { const e = pick(EFFORTS); return e ? set("effort", e) : (this.msg = { text: `effort: ${EFFORTS.join(" ")}` }); }
    if (cmd === "model") {
      const list = this.options("model");
      return set("model", (list.length && pick(list)) || arg);
    }
    if (cmd === "who") {
      const v = pick(this.options("who")) ?? arg;
      set("who", v);
      if (v !== "claude") this.cfg.model = null;
      else if (!this.cfg.model) this.cfg.model = "Opus 5.5";
      this.save();
      this.loadQuota();
    }
  }

  submit(cx) {
    if (this.confirm && !this.text.trim()) { const list = this.confirm; this.confirm = null; return this.closeRows(list); }
    this.confirm = null;
    const sug = this.suggestions()[this.sugI];
    // Enter takes the highlighted suggestion, except a /space path, which Enter creates as typed.
    if (sug && sug.value.trim() !== this.text.trim() && !/^\/space\s+[~/.]/.test(this.text)) return this.accept(sug, cx);
    const text = this.text.trim();
    const r = this.selected();
    this.msg = null;
    if (!text) { if (r?.kind === "term") this.peek(r.addr); return; }
    this.input.set_value("");
    this.text = "";
    const m = text.match(/^\/(\w+)\s*(.*)$/);
    if (m) return this.command(m[1].toLowerCase(), m[2].trim(), cx);
    if (r?.kind !== "term") return (this.msg = { text: "Erst eine Agent-Zeile wählen (oder /new <Auftrag>)" });
    cx.spawn(async (cx) => {
      const res = await hc(["send", r.addr, text]);
      this.msg = res.code === 0 ? { text: `→ ${r.name}`, ok: true } : { text: res.stderr.trim() || "Senden fehlgeschlagen" };
      cx.notify();
    });
  }

  // What the line could become: commands, then each command's values.
  suggestions() {
    const m = this.text.match(/^\/(\w*)(\s+)?(.*)$/);
    if (!m) return [];
    if (!m[2]) return COMMANDS.filter(([c]) => c.startsWith(m[1].toLowerCase()))
      .map(([c, desc]) => ({ label: `/${c}`, desc, value: `/${c} `, final: false }));
    const cmd = m[1].toLowerCase(), arg = m[3], low = arg.toLowerCase();
    if (cmd === "space") {
      if (!/^[~/.]/.test(arg)) {
        if (arg.includes(" ")) return [];
        const want = low.replace(/^gh:/, "");
        const folder = arg ? [] : [{ label: "~/", desc: "Ordner wählen", value: "/space ~/", final: false }];
        return [...folder, ...this.repos.filter((r) => r.repo.toLowerCase().includes(want))
          .sort((a, b) => (a.repo.toLowerCase().split("/")[1].startsWith(want) ? 0 : 1) - (b.repo.toLowerCase().split("/")[1].startsWith(want) ? 0 : 1))
          .map((r) => {
            const have = this.clones[r.repo.toLowerCase()];
            return { label: `gh:${r.repo}`, desc: have ? `schon da: ${have.replace(this.mhome, "~")}` : r.desc || "wird nach ~/" + CLONE_DIR + " geklont", value: `/space gh:${r.repo}`, final: true };
          })];
      }
      if (arg.includes(" ")) return [];
      return this.dirs.list.filter((d) => d.toLowerCase().startsWith(low))
        .map((d) => ({ label: d, value: `/space ${d}`, final: false }));
    }
    const cs = cmd === "close" && arg.match(/^space\s+(.*)$/i);
    if (cs) return spaces().filter((sp) => sp.name.toLowerCase().includes(cs[1].toLowerCase()))
      .sort((a, b) => (b.id === this.selected()?.space.id) - (a.id === this.selected()?.space.id))
      .map((sp) => ({ label: sp.name, desc: sp.id === this.selected()?.space.id ? "gewählt" : null, value: `/close space ${sp.name}`, final: true }));
    const opts = this.options(cmd);
    const starts = opts.filter((o) => o.toLowerCase().startsWith(low));
    const has = opts.filter((o) => !starts.includes(o) && o.toLowerCase().includes(low));
    const cur = { who: this.cfg.who, where: this.whereSpace()?.name, model: this.cfg.model, effort: this.cfg.effort, machine: this.cfg.machine ?? "lokal" }[cmd];
    return [...starts, ...has].map((o) => ({ label: o, desc: o === cur ? "aktuell" : null, value: `/${cmd} ${o}`, final: true }));
  }

  // Folders under the typed path, for /space; ~ stays ~ in the list.
  loadDirs(cx) {
    const m = this.text.match(/^\/space\s+([~/.]\S*)$/);
    if (!m) return;
    const dir = m[1].slice(0, m[1].lastIndexOf("/") + 1);
    if (!dir || this.dirs.for === dir) return;
    this.dirs = { for: dir, list: [] };
    const real = dir.replace(/^~(?=\/)/, this.mhome);
    cx.spawn(async (cx) => {
      const r = await exec("sh", ["-c", 'for d in "$1"*/; do [ -d "$d" ] && printf "%s\\n" "$d"; done | head -200', "sh", real], { on: this.cfg.machine ?? undefined });
      if (this.dirs.for !== dir) return;
      this.dirs.list = (r.stdout ?? "").split("\n").filter(Boolean).map((d) => dir + d.slice(real.length));
      cx.notify();
    });
  }

  // Take the highlighted suggestion; a final value runs at once.
  accept(sug, cx) {
    if (!sug) return false;
    if (sug.final) { this.input.set_value(sug.value); this.text = sug.value; this.submit(cx); return true; }
    this.input.set_value(sug.value);
    this.text = sug.value;
    this.sugI = 0;
    this.loadDirs(cx);
    return true;
  }

  click(key, twice, cx) {
    // A space header selects its first terminal.
    const i = this.rows.findIndex((x) => x.key === key);
    if (this.rows[i]?.kind === "space") key = this.rows[i + 1]?.kind === "term" ? this.rows[i + 1].key : this.selKey;
    this.selKey = key;
    this.save();
    this.input.focus();
    const r = this.rows.find((x) => x.key === key);
    if (twice && r?.kind === "term") this.peek(r.addr);
    cx.spawn(async (cx) => { await this.refreshSelected(); cx.notify(); });
    cx.notify();
  }

  // The agent's terminal over the list, with the peek bar on top. Opened here
  // rather than with terminal.peek, so Escape knows which overlay to close.
  peek(addr) {
    if (this.peeked) closeOverlay(this.peeked);
    this.peeked = openOverlay({ kind: "dialog", width: 0.8, height: 0.8, layout: { type: "column", children: [
      { type: "block", size: { px: 30 }, content: { mod: "peek", props: { terminal: addr } } },
      { type: "block", content: { terminal: addr } },
    ] } });
    this.peekedAddr = addr;
    run("pane.focus", { terminal: addr });
  }

  // The pixel shepherd and the four counts.
  summary(rows) {
    const terms = rows.filter((r) => r.kind === "term" && r.agent);
    const n = (s) => terms.filter((r) => r.status === s).length;
    const box = (value, label, bg) => h_flex().h(px(31.4)).items_center()
      .child(div().w(px(55)).h_full().bg(bg).flex().items_center().justify_end().pr(px(13)).text_color("#111318").child(String(value)))
      .child(div().pl(px(14)).text_color(C.idle).child(label));
    return h_flex().flex_none().pt(px(20)).pl(px(15)).h(px(238)).items_start()
      .child(image("mods/shepherd/shepherd.svg").w(px(126)).h(px(196)).flex_none())
      .child(v_flex().pl(px(41)).pt(px(66))
        .child(box(terms.length, "agents", C.box.agents))
        .child(box(n("working"), "working", C.box.working))
        .child(box(n("blocked"), "paused", C.box.paused))
        .child(box(n("done"), "done", C.box.done)));
  }

  rowEl(r, on, now) {
    const base = h_flex().h(ROW).w_full().items_center().pl(px(15)).whitespace_nowrap().when(on, (el) => el.bg(C.sel));
    if (r.kind === "space") {
      return base.child(div().text_color(r.color).font_semibold().child(r.label))
        .child(div().text_color(C.num).child(` · ${r.count}`));
    }
    const st = r.status;
    // The status mark and the name carry the status color, the program its own; the rest is plain text.
    // A star still shows its agent's status by its color.
    const statusColor = !r.agent ? C.shell : C[st] ?? C.idle;
    const mark = div().text_color(statusColor);
    const icon = !r.agent ? mark.child("▸")
      : r.star ? mark.child("★")
      : st === "working" ? mark.frames(SPIN, 90)
      : st === "done" ? mark.child("✔")
      : st === "blocked" ? mark.child("‖")
      : mark.child("●");
    const right = (w, text) => div().w(w * CH).flex_none().text_right().child(text ?? "");
    const progColor = r.program === "terminal" ? C.terminal : PROGRAM_COLORS[r.program] ?? C.plus;
    return base.text_color(C.text)
      .child(right(2, num(r.addr)))
      .child(div().w(3.5 * CH).flex_none())
      .child(div().w(CH).flex_none().child(icon))
      .child(div().w(0.55 * CH).flex_none())
      .child(div().w(26 * CH).flex_none().truncate().when(r.agent, (el) => el.text_color(statusColor)).child(r.name))
      .child(div().w(3 * CH).flex_none().child(r.kids ? `+${r.kids}` : ""))
      .child(div().w(10 * CH).flex_none().pr(CH).truncate().child(r.space?.machine ?? "lokal"))
      .child(right(4, r.agent && r.changed ? ago(now - r.changed) : ""))
      .child(right(5, r.created ? ago(now - r.created) : ""))
      .child(div().w(1.1 * CH).flex_none())
      .child(div().w(9 * CH).flex_none().text_color(progColor).child(r.program))
      .child(div().flex_1().min_w(0).truncate().child(r.title || ""));
  }

  // Only the rows that fit are drawn; the wheel and the selection move the window.
  list(rows, sel, now) {
    const fit = Math.max(1, Math.floor(this.listH / ROW));
    this.top = Math.max(0, Math.min(this.top, Math.max(0, rows.length - fit)));
    const shown = rows.slice(this.top, this.top + fit + 1);
    const thumb = rows.length > fit ? { h: Math.max(24, (this.listH * fit) / rows.length), y: (this.listH * this.top) / rows.length } : null;
    return div().id("list").flex_1().min_h(0).relative().overflow_hidden()
      .on_size_change((size, cx) => { this.listH = size.height; cx.notify(); })
      .on_scroll_wheel((e, cx) => { if (this.scrollBy(e.delta_lines ? e.delta_lines.y * ROW : e.delta.y)) cx.notify(); })
      .children(shown.map((r) => this.rowEl(r, r.key === sel?.key, now).id(`row-${r.key}`)
        .on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.click(r.key, e.click_count >= 2, cx); })
        .on_mouse_down("right", (_e, cx) => { this.selKey = r.key; this.command("star", ""); cx.notify(); })))
      .when(Boolean(thumb), (el) => el.child(div().absolute().right(px(4)).top(thumb.y).w(px(5)).h(thumb.h).rounded(3).bg(C.line)));
  }

  // What a new agent gets, and the selected session's context, cache and quota.
  footer(sel, now) {
    const kv = (k, v, color = C.text) => h_flex().gap(px(9)).child(div().text_color(C.dim).child(k)).child(div().text_color(color).child(v ?? "—"));
    const where = this.cfg.where ? this.whereSpace()?.name : `${this.whereSpace()?.name ?? "—"}`;
    const ctx = sel?.kind === "term" ? this.ctx[sel.addr] : null;
    const pctColor = (p) => (p >= 80 ? C.blocked : p >= 60 ? C.star : C.done);
    const left = ctx?.cacheUntil ? ctx.cacheUntil - now : null;
    const q = this.quota[this.cfg.who];
    const sugs = this.suggestions();
    const si = Math.min(this.sugI, Math.max(0, sugs.length - 1));
    const first = Math.max(0, Math.min(si - 3, sugs.length - 7));
    const placeholder = sel?.kind === "term" ? `Auftrag an ${sel.name} …` : `Neuer ${this.cfg.who} in ${where} …`;
    return v_flex().flex_none().border_t(1).border_color(C.line).px(px(15)).pt(px(10)).pb(px(14)).gap(px(8))
      .when(sugs.length > 0, (el) => el.child(v_flex().flex_none().text_size(14)
        .children(sugs.slice(first, first + 7).map((g, j) => h_flex().id(`sug-${first + j}`).h(px(26)).px(px(10)).gap(px(16)).items_center().rounded(4).cursor_pointer()
          .when(first + j === si, (el) => el.bg(C.sel))
          .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.accept(g, cx); this.input.focus(); cx.notify(); })
          .child(div().flex_none().text_color(first + j === si ? C.text : C.title).child(g.label))
          .when(Boolean(g.desc), (el) => el.child(div().text_color(C.dim).truncate().child(g.desc)))))
        .child(div().h(px(18)).px(px(10)).text_size(12).text_color(C.dim)
          .child(`↑↓ wählen · Tab übernehmen · Enter ${sugs[si]?.final ? "setzen" : "übernehmen"}${sugs.length > 7 ? ` · ${si + 1}/${sugs.length}` : ""}`))))
      .when(!sugs.length && Boolean(this.msg), (el) => el.child(h_flex().h(ROW).flex_none().items_center().text_color(this.msg.color ?? (this.msg.ok ? C.done : C.blocked)).truncate().child(this.msg.text)))
      .child(h_flex().id("line").h(ROW).items_center().gap(px(14)).cursor_text()
        .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.input.focus(); })
        .child(div().text_color(this.typing ? SPACE_COLORS[0] : C.dim).font_semibold().child("›"))
        .child(div().flex_1().relative().h_full().flex().items_center()
          .when(!this.text, (el) => el.child(div().absolute().left_0().text_color(C.dim).truncate()
            .child(this.typing ? placeholder : "Klicken zum Tippen")))
          .child(Input.new(this.input).w_full().h_full().text_color(C.text).font_family(FONT).text_size(15))))
      .child(h_flex().gap(px(28)).text_size(13)
        .child(kv("machine", this.cfg.machine ?? "lokal", this.cfg.machine ? SPACE_COLORS[2] : C.text))
        .child(kv("where", where + (this.cfg.where ? "" : " ·sel"), SPACE_COLORS[1]))
        .child(kv("who", this.cfg.who, PROGRAM_COLORS[this.cfg.who] ?? C.plus))
        .child(kv("model", this.cfg.model ?? "default"))
        .child(kv("effort", this.cfg.effort)))
      .child(h_flex().gap(px(28)).text_size(13)
        .child(kv("ctx", ctx?.used != null ? `${tokens(ctx.used)} / ${tokens(ctx.size)}  ${Math.round(ctx.pct)}%` : "—", ctx?.pct != null ? pctColor(ctx.pct) : C.text))
        .child(kv("cache", left == null ? "—" : left > 60000 ? `noch ${Math.floor(left / 60000)}m` : left > 0 ? "noch <1m" : "abgelaufen", left > 0 ? C.done : C.blocked))
        .children((q?.windows ?? []).filter(([, w]) => w?.used_percentage != null).map(([k, w]) =>
          kv(k, `${Math.round(w.used_percentage)}%${w.resets_at ? `  ↻ ${clock(w.resets_at)}` : ""}`, pctColor(w.used_percentage))))
        .when(!q, (el) => el.child(kv("quota", `keine Daten für ${this.cfg.who}`, C.dim))));
  }

  // Opens (or, with the same key, resizes) the window over this block.
  place(size) {
    const w = Math.round(size.width), h = Math.round(size.height);
    // Window coordinates start above the system title bar (28 px on macOS, full screen too).
    const win = window();
    const top = win.titlebar === "system" && win.platform === "macos" ? 28 : 0;
    if (this.size?.w === w && this.size?.h === h && this.size.top === top) return;
    this.size = { w, h, top };
    // Reopening by the same key would keep the old spot: close it first.
    // A window key keeps the spot it first opened at, so each size gets its own;
    // a reload of the same size finds and replaces its window.
    // The last window, also one a previous build of this mod opened.
    const old = shared("shepherd.window");
    if (old) closeOverlay(old);
    this.win = openOverlay({ mod: "shepherd", kind: "window", key: `shepherd-${w}x${h}+${top}`, frame: "none", width: w, height: h, at: { x: 0, y: top } });
  }

  async close() {
    if (this.host && shared("shepherd.window")) closeOverlay(shared("shepherd.window"));
  }

  render(cx) {
    if (this.host) return div().id("host").size_full().bg(C.bg).on_size_change((size) => this.place(size));
    const now = Date.now();
    const rows = (this.rows = this.buildRows());
    const sel = this.selected();
    return v_flex().id("shepherd").size_full().bg(C.bg).text_color(C.text)
      .font_family(FONT).text_size(15)
      .on_key_down((e, cx) => {
        const k = e.key;
        const sugs = this.suggestions();
        if (sugs.length && (k === "up" || k === "down")) this.sugI = (this.sugI + (k === "up" ? -1 : 1) + sugs.length) % sugs.length;
        else if (k === "up") this.move(-1, cx);
        else if (k === "down") this.move(1, cx);
        else if (k === "pageup") this.move(-15, cx);
        else if (k === "pagedown") this.move(15, cx);
        else if (k === "backspace" && e.modifiers.platform && !this.text) this.askClose();
        else if (k === "tab") this.accept(sugs[this.sugI] && { ...sugs[this.sugI], final: false }, cx);
        else if (k === "escape") { this.input.set_value(""); this.text = ""; this.msg = null; this.confirm = null; }
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .on_mouse_down("left", (_e, cx) => { cx.stop_propagation(); this.input.focus(); })
      .child(this.summary(rows))
      .child(this.list(rows, sel, now))
      .child(this.footer(sel, now));
  }
}
