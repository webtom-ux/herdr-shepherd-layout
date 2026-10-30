# herdr-shepherd-layout

The **Shepherd** layout for the Herdr app: every agent and terminal of every space in one list, with a command line. See [shepherd/RECIPE.md](shepherd/RECIPE.md) for how it is built.

![Shepherd](shepherd/preview.png)

## Installation

1. Copy `shepherd/layouts/*` into `~/.config/herdr-app/layouts/`.
2. Copy `shepherd/mods/shepherd` into `~/.config/herdr-app/mods/`.
3. Add this to `~/.config/herdr-app/keys.json`:
   ```json
   "layout:shepherd": { "escape": "shepherd.escape", "cmd-enter": "shepherd.type" }
   ```
4. Pick the `shepherd` layout in the Herdr settings (or run `layout.switch {"name":"shepherd"}`).

Requirements:

- The **Geist Mono** font installed
- `gh` logged in (for `/space gh:…`)
- `python3` and `claude` on your PATH (for automatic names)
- For `ctx`, `cache` and the quota display, a Claude Code statusline hook that writes
  `~/.claude/statusline-cache/<session>.json` and `~/.claude/quota-cache.json`.
  Without it those fields show `—` or `keine Daten`.
- Optional: `~/.shepherdr/cli-models.json` for the model list of `/model`

The UI text is German; this guide quotes it as it appears on screen.

## Guide

### The screen

| Area | Contents |
| --- | --- |
| **Top** | The pixel shepherd and four counts: `agents` (all agents), `working`, `paused` (blocked, waiting for you) and `done`. Shells are not counted. |
| **List** | A colored header per space with its terminal count, then one row per terminal. Starred rows (★) come first. |
| **Bottom** | Messages, the command line, and two info lines about your settings and the selected row's context. |

Columns of a terminal row: number · status · name · `+N` (sub-terminals) · machine (`lokal` or its name) · time since the last status change · age of the terminal · program · title (the agent's status message, or a shell's foreground program).

Status marks:

| Mark | Meaning |
| --- | --- |
| `⠋` (spinning, yellow) | working |
| `‖` (red) | blocked, waiting for input |
| `✔` (green) | done |
| `●` (gray) | idle |
| `▸` | shell, not an agent |
| `★` | starred row |

The info lines at the bottom show:

- `machine` · `where` · `who` · `model` · `effort`: where and with what new agents start.
  `where ·sel` means the selected row's space is used.
- `ctx`: context used by the selected Claude session. `cache`: how long its prompt cache lasts
  (`noch Nm` = N minutes left, `abgelaufen` = expired). `5h` / `7d`: quota in percent with the
  reset time (`↻`). Green below 60 %, yellow from 60 %, red from 80 %.
  The quota shown is the `/who` agent's: Claude Code's from the statusline hook, Codex's from
  its newest rollout. For a Codex, pi or grok row, `ctx` comes from its session file. pi and grok
  don't store their window size, so `ctx` shows only the tokens used there. `cache` stays `—`,
  except for pi on Anthropic (5 minutes). pi and grok show no quota.

### Controls

| Input | Effect |
| --- | --- |
| `↑` / `↓` | Select a row (headers are skipped) |
| `PageUp` / `PageDown` | Jump 15 rows |
| Click | Select a row; clicking a header selects that space's first terminal |
| Double click, or `Enter` on an empty line | **Peek**: the agent's live terminal opens over the list and keeps the keyboard while open |
| Right click | Star / unstar the row (★) |
| Text + `Enter` | Send the text to the selected agent (shows `→ <name>`). For a shell row it asks first, since the shell runs it as a command: `Enter` = send, `Esc` = cancel |
| `⌘⌫` on an empty line | Close the selected row (asks first) |
| `⌘↩` | Close the peek if open and put the cursor in the command line, for the selected row |
| `Esc` | Cancel a pending confirmation, else close the peek (back in the list on that agent's row, so `↑`/`↓` go on from there), else clear the line |

The selection and stars survive restarts.

### Commands

Every command starts with `/` and is suggested as you type:
`↑`/`↓` picks a suggestion, `Tab` fills it into the line, `Enter` runs it.
A command without a value (e.g. `/effort` + `Enter`) opens the list of values it accepts.

#### Settings for new agents

| Command | Effect | Example |
| --- | --- | --- |
| `/who <agent>` | Which coding agent to start (installed agents, otherwise `claude`/`codex`) | `/who codex` |
| `/where <space>` | Which space new agents start in. `.` or `-` = the selected row's space | `/where invoicing` |
| `/model <model>` | Model for new agents, listed for the `/who` agent: Claude's from `~/.shepherdr/cli-models.json` (with id and default effort), Codex/pi/grok's from their config and recent sessions. Free text works too | `/model Opus 5.5` |
| `/effort <level>` | Effort, listed for the agent and model: Claude per model (`low`…`max`), Codex `minimal`…`xhigh`, pi `off`…`xhigh`, grok `low`/`medium`/`high`. A model that doesn't take the current level resets it to its default | `/effort high` |
| `/machine <computer>` | Computer for new spaces: `lokal` (this one) or a saved Herdr machine | `/machine mini` |

#### Starting agents and spaces

| Command | Effect |
| --- | --- |
| `/new <task>` | Opens a new tab in the `where` space running the `who` agent, with the task as its first message. On a header row only `/new` works. |
| `/space <folder> [name]` | New space for a folder; its first tab runs the `who` agent. The folder is autocompleted as you type (`/space ~/dev/…`). The new space becomes `where`. |
| `/space gh:<owner>/<repo> [name]` | Same, for a GitHub repo. Suggestions list your repos (most recently pushed first). An existing clone under `~/dev` is reused; otherwise it clones into `~/dev/<repo>` (or `~/dev/<owner>-<repo>` if that name is taken). |

#### Organizing and cleaning up

| Command | Effect |
| --- | --- |
| `/star` | Star or unstar the selected row (same as right click) |
| `/close` | Close the selected row |
| `/close done` | Close all finished agents |
| `/close shells` | Close all shells |
| `/close space [name]` | Close a whole space with all its agents and shells (without a name: the selected one) |

`/close` always asks first: `Enter` = yes, `Esc` = no, and typing anything else or moving to
another row also cancels.
The question warns when agents are still working, or when the last tab of a space (and so the
space itself) would close.

### Automatic names

When a Claude session gets its first real request (four words or more, not a command),
`claude -p --model haiku` gives it a short 1–3 word name, e.g. `stand-abfragen`.
Codex, pi and grok sessions get one the same way, from their session files in
`~/.codex/sessions`, `~/.pi/agent/sessions` and `~/.grok/sessions`.
In front of it goes a three-letter code for the agent's repo (from `origin`, else the git or
working folder), e.g. `wbs-stand-abfragen` for `webshop`. Three or more words give their
initials (`Customer-Portal-App` → `cpa`), two words the first letter and next consonant of
the first plus the second's initial (`landing-page` → `lnp`), one word its first letter and next
two consonants (`invoicing` → `inv`); names of up to three letters stay as they are.
That name replaces the session or tab name in the list. This works with Claude Code, Codex, pi and grok.

### Refresh

Terminals, sessions and quota refresh every 8 seconds. The selected row's context and cache
refresh every 3 seconds and whenever the selection changes.

## License

[MIT](LICENSE) © 2026 webtom-ux
