# Jarvis · local

The same console as the hosted version, but running **on your machine** — so it can
actually reach your files, your projects and Claude Code on this computer.

Two pieces:

- **`server.js`** — a small companion process. No dependencies, Node 18+.
- **`public/index.html`** — the console it serves.

## Run it

```bash
cd jarvis/local
npm start
```

Then open **http://localhost:8787**.

On first run it creates `brain/` with a handful of example notes so the graph
isn't empty. Point it at a real folder whenever you like (see *Configuration*).

To run it on your Mac as well, copy the same folder over and `npm start` there —
each machine keeps its own brain folder.

## What it can do that the hosted version cannot

| | Hosted artifact | Local |
| --- | --- | --- |
| Graph, notes, links, voice | ✅ | ✅ |
| Notes are real `.md` files you own | ❌ | ✅ |
| Read your files and projects | ❌ | ✅ |
| Write files, run commands | ❌ | ✅ (opt-in) |
| Works with an existing Obsidian vault | ❌ | ✅ |
| Reachable from your phone | ✅ anywhere | ✅ on your network |

## The brain is a folder of markdown

Every note is one `.md` file:

```markdown
---
group: content
---

# Video scripts

Drafts live here. Related to [[Content engine]].
```

- **Title** comes from the `# Heading`, or the filename.
- **Cluster** comes from `group:` in the frontmatter, or the subfolder name, or `notes`.
- **Links** are `[[Wiki Links]]` — the same syntax Obsidian uses, so you can point
  `brainDir` at an existing vault and your real graph shows up.
- **Node positions** live in `.jarvis-layout.json` inside the brain folder, so dragging
  things around never rewrites your notes.

Edit a file in any editor and the graph redraws within a moment — the companion
watches the folder.

## Machine access

The **Read / Write / Full** switch in the console decides what Jarvis may do this
session. It maps onto how Claude Code is launched:

| Level | Claude Code runs with | Jarvis can |
| --- | --- | --- |
| **Read** | `--restricted`, no write tools | Read files, search, answer from your notes |
| **Write** | `--restricted` | Also create and edit files, including new notes |
| **Full** | no restriction, `--permission-mode bypassPermissions` | Also run shell commands, with no confirmation |

Read is the default. Full asks you to confirm once, and is the only level where a
spoken command can run something on your machine — use it while you're watching.

Every call prints the exact command to the terminal, so you can always see what
was launched.

If a request hangs and then reports a timeout, Claude Code was most likely waiting
on a permission prompt it cannot show in this mode. Set `"permissionMode"` in
`jarvis.config.json` to something that doesn't prompt, or drop to a lower level.

## Configuration

Copy `jarvis.config.example.json` to `jarvis.config.json` and edit:

```json
{
  "port": 8787,
  "brainDir": "~/Documents/Brain",
  "workspace": "~/Projects",
  "claudeBin": "claude",
  "model": "",
  "access": "read",
  "permissionMode": "acceptEdits",
  "askTimeoutMs": 180000
}
```

- **`brainDir`** — the notes folder. An Obsidian vault works.
- **`workspace`** — where Claude Code starts. This is what "my projects" means to Jarvis.
- **`model`** — leave empty for your default, or pin one.

Environment variables `JARVIS_PORT`, `JARVIS_BRAIN`, `JARVIS_WORKSPACE` and
`JARVIS_MODEL` override the file, and `--port` / `--brain` override both.

`jarvis.config.json` and `brain/` are gitignored.

## Reaching it from your phone

```bash
npm run lan
```

This binds to your network and prints a URL containing a one-time key:

```
phone   http://192.168.1.24:8787?k=Xf3k9...
```

Open that on your phone while on the same Wi-Fi. Two things to know:

- **The key is the only protection.** Anyone on that network who has it gets the same
  access level you've selected. Don't leave Full on while in LAN mode.
- **Voice won't work over plain http on the phone** — browsers only allow microphone
  access on secure origins. Typing works fine. If you want voice on the phone, reach
  the machine over Tailscale or another https route instead.

## Requirements

- **Node 18+**
- **Claude Code** installed and signed in (`claude`). If it lives somewhere unusual,
  set `claudeBin` to the full path.
- **Chrome or Edge** for voice input. Everything else works in any browser.

Each question spawns a fresh `claude -p` process, so it carries Claude Code's normal
startup cost per question. Recent turns are passed back in as context, so it follows
a conversation.

## Endpoints

If you want to wire something else in:

| Method | Path | Does |
| --- | --- | --- |
| `GET` | `/api/state` | Whole graph plus config |
| `POST` | `/api/ask` | Ask Claude; streams SSE (`delta`, `tool`, `error`, `done`) |
| `POST` | `/api/note` | Create or update a note |
| `DELETE` | `/api/note` | Move a note to `.trash` |
| `POST` | `/api/link` | Add a wiki link between two notes |
| `POST` | `/api/layout` | Save node positions |
| `POST` | `/api/reveal` | Show a file in Finder/Explorer |
| `POST` | `/api/notify` | System notification |
| `GET` | `/api/events` | SSE stream of `brain-changed` |
