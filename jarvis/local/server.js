#!/usr/bin/env node
/**
 * Jarvis local companion.
 *
 * Serves the console UI and gives it three things the browser cannot do on its own:
 *   - a brain made of real markdown files on disk (Obsidian-compatible)
 *   - answers from Claude Code running on this machine, with its own file/shell tools
 *   - a couple of small OS affordances (reveal in Finder/Explorer, system notification)
 *
 * No dependencies. Node 18+.
 */
"use strict";

const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn, execFile } = require("child_process");

/* ------------------------------------------------------------------ config */

const HERE = __dirname;
const ARGV = process.argv.slice(2);
const hasFlag = f => ARGV.includes(f);

function loadConfig() {
  const defaults = {
    port: 8787,
    brainDir: path.join(HERE, "brain"),
    workspace: os.homedir(),
    claudeBin: "claude",
    model: "",
    access: "read",              // read | write | full
    permissionMode: "acceptEdits",
    askTimeoutMs: 180000,
    lan: false
  };
  let file = {};
  const cfgPath = path.join(HERE, "jarvis.config.json");
  if (fs.existsSync(cfgPath)) {
    try { file = JSON.parse(fs.readFileSync(cfgPath, "utf8")); }
    catch (e) { console.error("! jarvis.config.json is not valid JSON — ignoring it.\n  " + e.message); }
  }
  const env = {};
  if (process.env.JARVIS_PORT) env.port = Number(process.env.JARVIS_PORT);
  if (process.env.JARVIS_BRAIN) env.brainDir = process.env.JARVIS_BRAIN;
  if (process.env.JARVIS_WORKSPACE) env.workspace = process.env.JARVIS_WORKSPACE;
  if (process.env.JARVIS_MODEL) env.model = process.env.JARVIS_MODEL;

  const cfg = Object.assign(defaults, file, env);
  if (hasFlag("--lan")) cfg.lan = true;
  const pi = ARGV.indexOf("--port");
  if (pi >= 0 && ARGV[pi + 1]) cfg.port = Number(ARGV[pi + 1]);
  const bi = ARGV.indexOf("--brain");
  if (bi >= 0 && ARGV[bi + 1]) cfg.brainDir = path.resolve(ARGV[bi + 1]);

  cfg.brainDir = path.resolve(expandHome(cfg.brainDir));
  cfg.workspace = path.resolve(expandHome(cfg.workspace));
  return cfg;
}
function expandHome(p) {
  return String(p).replace(/^~(?=$|[/\\])/, os.homedir());
}

const CFG = loadConfig();
const TOKEN = CFG.lan ? crypto.randomBytes(9).toString("base64url") : null;

/* ------------------------------------------------------------- brain on disk */

const LAYOUT_FILE = ".jarvis-layout.json";
const SKIP_DIRS = new Set([".git", ".obsidian", ".trash", "node_modules", ".jarvis"]);

const NAMED_GROUPS = {
  core: "#e6ecf7", content: "#f06fa8", systems: "#a480ff",
  research: "#48d8ff", money: "#f0a04b", clients: "#3ddc97",
  notes: "#8ea0bd", inbox: "#ffb45c", projects: "#5ee0c8", people: "#ff9fd0"
};
/* Hues deliberately clear of the named groups above, so an unknown folder
   never reads as "research" or "clients" at a glance. */
const EXTRA_COLORS = ["#f5d76e", "#b6e84f", "#ff77c8", "#ff6b5e", "#7fa8ff", "#4fe0d8"];
function groupColor(g) {
  if (NAMED_GROUPS[g]) return NAMED_GROUPS[g];
  let h = 0;
  for (let i = 0; i < g.length; i++) h = (h * 31 + g.charCodeAt(i)) >>> 0;
  return EXTRA_COLORS[h % EXTRA_COLORS.length];
}

async function ensureBrain() {
  await fsp.mkdir(CFG.brainDir, { recursive: true });
  const entries = await fsp.readdir(CFG.brainDir);
  if (!entries.some(e => e.endsWith(".md"))) await seedBrain();
}

const SEED = [
  ["Second Brain", "core", "Everything this machine knows, as plain markdown files.\n\nLinks: [[Content engine]], [[Systems]], [[Research]]"],
  ["Content engine", "content", "One idea in, four formats out. Feeds [[Second Brain]]."],
  ["Video scripts", "content", "Drafts live here. Related: [[Content engine]], [[Hook library]]."],
  ["Hook library", "content", "First eight seconds, collected. Related: [[Content engine]]."],
  ["Systems", "systems", "How the work actually gets done. Part of [[Second Brain]]."],
  ["Prompt library", "systems", "Reusable prompts, each with the input it expects. Part of [[Systems]]."],
  ["Weekly review", "systems", "Friday: close loops, promote notes, prune the graph. Part of [[Systems]]."],
  ["Research", "research", "Open questions and reading. Part of [[Second Brain]]."],
  ["Model notes", "research", "What each model is good and bad at. Part of [[Research]], used by [[Prompt library]]."]
];

async function seedBrain() {
  for (const [label, group, body] of SEED) {
    const p = path.join(CFG.brainDir, sanitizeName(label) + ".md");
    const fm = "---\ngroup: " + group + "\n---\n\n# " + label + "\n\n" + body + "\n";
    await fsp.writeFile(p, fm, "utf8");
  }
  console.log("  seeded " + SEED.length + " example notes in " + CFG.brainDir);
}

function sanitizeName(label) {
  return String(label).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80) || "note";
}

function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if (/^\[.*\]$/.test(v)) {
      v = v.slice(1, -1).split(",").map(s => s.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    } else {
      v = v.replace(/^["']|["']$/g, "");
      if (v !== "" && !isNaN(Number(v))) v = Number(v);
    }
    data[kv[1]] = v;
  }
  return { data, body: text.slice(m[0].length) };
}

async function walk(dir, base, out) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); }
  catch (e) { return out; }
  for (const e of entries) {
    if (e.name.startsWith(".") || SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, base, out);
    else if (e.name.toLowerCase().endsWith(".md")) out.push(full);
  }
  return out;
}

async function readLayout() {
  try { return JSON.parse(await fsp.readFile(path.join(CFG.brainDir, LAYOUT_FILE), "utf8")); }
  catch (e) { return {}; }
}
async function writeLayout(layout) {
  await fsp.writeFile(path.join(CFG.brainDir, LAYOUT_FILE), JSON.stringify(layout, null, 1), "utf8");
}

async function readBrain() {
  await fsp.mkdir(CFG.brainDir, { recursive: true });
  const files = await walk(CFG.brainDir, CFG.brainDir, []);
  const layout = await readLayout();
  const nodes = [];
  const byKey = new Map();

  for (const file of files) {
    let raw;
    try { raw = await fsp.readFile(file, "utf8"); } catch (e) { continue; }
    const { data, body } = parseFrontmatter(raw);
    const rel = path.relative(CFG.brainDir, file);
    const id = rel.replace(/\.md$/i, "").split(path.sep).join("/");
    const base = path.basename(id);
    const heading = /^#\s+(.+)$/m.exec(body);
    const label = String(data.label || (heading ? heading[1] : base)).trim().slice(0, 70);
    const folder = rel.includes(path.sep) ? rel.split(path.sep)[0].toLowerCase() : "";
    const group = String(data.group || folder || "notes").toLowerCase();

    const wikis = [];
    const re = /\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g;
    let mm;
    while ((mm = re.exec(body))) wikis.push(mm[1].trim());
    const fmLinks = Array.isArray(data.links) ? data.links : (data.links ? [String(data.links)] : []);

    const note = body.replace(/^#\s+.+$/m, "").replace(/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g, "$1").trim();

    const n = {
      id, label, group, file,
      note: note.slice(0, 4000),
      targets: wikis.concat(fmLinks),
      x: 0, y: 0, r: 9,
      mtime: 0
    };
    try { n.mtime = (await fsp.stat(file)).mtimeMs; } catch (e) {}
    nodes.push(n);
    byKey.set(id.toLowerCase(), n);
    byKey.set(base.toLowerCase(), n);
    byKey.set(label.toLowerCase(), n);
  }

  const links = [];
  const seen = new Set();
  for (const n of nodes) {
    for (const t of n.targets) {
      const hit = byKey.get(String(t).toLowerCase().replace(/\.md$/i, ""));
      if (!hit || hit.id === n.id) continue;
      const key = [n.id, hit.id].sort().join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ s: n.id, t: hit.id });
    }
    delete n.targets;
  }

  const degree = new Map();
  for (const l of links) {
    degree.set(l.s, (degree.get(l.s) || 0) + 1);
    degree.set(l.t, (degree.get(l.t) || 0) + 1);
  }

  const N = Math.max(1, nodes.length);
  nodes.forEach((n, i) => {
    n.r = Math.round(Math.min(23, 8 + (degree.get(n.id) || 0) * 1.9));
    const saved = layout[n.id];
    if (saved && typeof saved.x === "number") { n.x = saved.x; n.y = saved.y; }
    else {
      const a = (i / N) * Math.PI * 2;
      const ring = n.r > 15 ? 90 : 230;
      n.x = Math.round(Math.cos(a) * ring);
      n.y = Math.round(Math.sin(a) * ring);
    }
    n.color = groupColor(n.group);
  });

  const groups = {};
  for (const n of nodes) groups[n.group] = n.color;
  return { nodes, links, groups, dir: CFG.brainDir };
}

async function writeNote({ id, label, group, note, connectTo }) {
  label = sanitizeName(label || id || "");
  if (!label) throw new Error("A note needs a label.");
  const rel = id ? id + ".md" : label + ".md";
  const file = safeJoin(CFG.brainDir, rel);
  let links = [];
  if (connectTo) {
    const brain = await readBrain();
    const hit = brain.nodes.find(n => n.id.toLowerCase() === String(connectTo).toLowerCase())
             || brain.nodes.find(n => n.label.toLowerCase() === String(connectTo).toLowerCase());
    if (hit) links.push(hit.label);
  }
  const fm = "---\ngroup: " + (group || "notes") + "\n---\n\n# " + label + "\n\n" +
             (note || "") + (links.length ? "\n\nRelated: " + links.map(l => "[[" + l + "]]").join(", ") : "") + "\n";
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.writeFile(file, fm, "utf8");
  return path.relative(CFG.brainDir, file).replace(/\.md$/i, "").split(path.sep).join("/");
}

async function appendLink(fromId, toLabel) {
  const file = safeJoin(CFG.brainDir, fromId + ".md");
  let raw = await fsp.readFile(file, "utf8");
  if (raw.includes("[[" + toLabel + "]]")) return true;
  raw = raw.replace(/\s*$/, "") + "\n\nRelated: [[" + toLabel + "]]\n";
  await fsp.writeFile(file, raw, "utf8");
  return true;
}

async function trashNote(id) {
  const file = safeJoin(CFG.brainDir, id + ".md");
  const trash = path.join(CFG.brainDir, ".trash");
  await fsp.mkdir(trash, { recursive: true });
  const dest = path.join(trash, Date.now() + "-" + path.basename(file));
  await fsp.rename(file, dest);
  return dest;
}

function safeJoin(root, rel) {
  const p = path.resolve(root, rel);
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error("Path escapes the brain directory.");
  return p;
}

/* --------------------------------------------------------------- the brain */

const PERSONA = [
  "You are JARVIS, the resident intelligence of this machine and of the user's second brain.",
  "Voice: composed, dry, economical — a capable chief of staff. Never chirpy, never a disclaimer machine.",
  "Your answers are SPOKEN ALOUD. Keep them to 1-3 short sentences unless explicitly asked for more.",
  "Never use markdown, bullet lists, headings or emoji in your reply — it is read by a speech synthesiser.",
  "Always reply in the same language the user just used.",
  "",
  "The second brain is a folder of markdown files at: " + CFG.brainDir,
  "Each note is one .md file: YAML frontmatter with a `group:` line, then `# Title`, then the body.",
  "Notes link to each other with [[Wiki Links]] naming another note's title.",
  "To capture something new, write a new .md file there in exactly that shape.",
  "To relate two notes, add a [[Wiki Link]] to one of them.",
  "The console redraws the graph automatically when files change — do not describe the file operation, just say what you captured.",
  "",
  "When asked about files, projects or the state of the machine, look before you answer.",
  "If you genuinely cannot find something, say so plainly and offer to capture it as a note."
].join("\n");

function accessArgs(access) {
  if (access === "full") {
    return ["--permission-mode", "bypassPermissions"];
  }
  if (access === "write") {
    return ["--restricted", "--permission-mode", CFG.permissionMode];
  }
  return ["--restricted", "--permission-mode", CFG.permissionMode,
          "--disallowedTools", "Write,Edit,NotebookEdit"];
}

function buildPrompt(question, history) {
  const turns = (history || []).slice(-6)
    .map(t => (t.role === "user" ? "User: " : "You: ") + t.content)
    .join("\n");
  return (turns ? "Recent conversation:\n" + turns + "\n\n" : "") + "User: " + question;
}

function runClaude(question, history, access, onEvent) {
  const args = [
    "-p",
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--add-dir", CFG.brainDir,
    "--append-system-prompt", PERSONA
  ];
  if (CFG.model) args.push("--model", CFG.model);
  args.push(...accessArgs(access));

  console.log("  → " + CFG.claudeBin + " " + args.map(a => (/\s/.test(a) ? '"…"' : a)).join(" ") + "  <prompt on stdin>");

  const child = spawn(CFG.claudeBin, args, {
    cwd: CFG.workspace,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  try {
    child.stdin.on("error", () => {});
    child.stdin.end(buildPrompt(question, history), "utf8");
  } catch (e) {}

  let buf = "";
  let stderr = "";
  let answered = false;
  let settled = false;

  const timer = setTimeout(() => {
    if (settled) return;
    child.kill("SIGKILL");
    onEvent({ type: "error", message: answered
      ? "Claude Code stopped partway through."
      : "Claude Code did not answer in time. If it is waiting on a permission prompt, change \"permissionMode\" in jarvis.config.json." });
    settle();
  }, CFG.askTimeoutMs);

  function settle() {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    onEvent({ type: "done" });
  }

  child.stdout.on("data", chunk => {
    buf += chunk.toString("utf8");
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line || line[0] !== "{") continue;
      let ev;
      try { ev = JSON.parse(line); } catch (e) { continue; }

      if (ev.type === "stream_event" && ev.event) {
        const e = ev.event;
        if (e.type === "content_block_delta" && e.delta && e.delta.type === "text_delta" && e.delta.text) {
          answered = true;
          onEvent({ type: "delta", text: e.delta.text });
        }
      } else if (ev.type === "assistant" && ev.message && Array.isArray(ev.message.content)) {
        for (const block of ev.message.content) {
          if (block && block.type === "tool_use" && block.name) {
            onEvent({ type: "tool", name: block.name, input: summarizeToolInput(block.input) });
          }
        }
      } else if (ev.type === "result" && ev.subtype && ev.subtype !== "success" && !answered) {
        onEvent({ type: "error", message: "Claude Code ended with: " + ev.subtype });
      }
    }
  });

  child.stderr.on("data", d => { stderr += d.toString("utf8").slice(0, 2000); });

  child.on("error", err => {
    onEvent({ type: "error", message: err.code === "ENOENT"
      ? "Could not find the `claude` command. Install Claude Code, or set \"claudeBin\" in jarvis.config.json."
      : err.message });
    settle();
  });

  child.on("close", code => {
    if (!answered && code !== 0) {
      onEvent({ type: "error", message: (stderr.trim().split("\n").pop() || "Claude Code exited with code " + code) });
    }
    settle();
  });

  return child;
}

function summarizeToolInput(input) {
  if (!input || typeof input !== "object") return "";
  const file = input.file_path || input.path;
  if (file) return path.basename(String(file));
  const v = input.pattern || input.command || input.query || input.url || "";
  return String(v).replace(/\s+/g, " ").slice(0, 54);
}

/* ------------------------------------------------------------- OS niceties */

function revealInFileManager(target) {
  const p = expandHome(target);
  if (process.platform === "darwin") execFile("open", ["-R", p], () => {});
  else if (process.platform === "win32") execFile("explorer.exe", ["/select,", p], () => {});
  else execFile("xdg-open", [path.dirname(p)], () => {});
}

function notify(title, body) {
  if (process.platform === "darwin") {
    const esc = s => String(s).replace(/["\\]/g, "\\$&");
    execFile("osascript", ["-e", 'display notification "' + esc(body) + '" with title "' + esc(title) + '"'], () => {});
  } else if (process.platform === "win32") {
    execFile("powershell", ["-NoProfile", "-Command",
      "[reflection.assembly]::LoadWithPartialName('System.Windows.Forms');" +
      "$n=New-Object System.Windows.Forms.NotifyIcon;$n.Icon=[System.Drawing.SystemIcons]::Information;" +
      "$n.Visible=$true;$n.ShowBalloonTip(4000,'" + String(title).replace(/'/g, "") + "','" +
      String(body).replace(/'/g, "") + "',0)"], () => {});
  } else {
    execFile("notify-send", [String(title), String(body)], () => {});
  }
}

/* ------------------------------------------------------------------ server */

const clients = new Set();

function broadcast(obj) {
  const payload = "data: " + JSON.stringify(obj) + "\n\n";
  for (const res of clients) { try { res.write(payload); } catch (e) {} }
}

let watchTimer = null;
function watchBrain() {
  try {
    fs.watch(CFG.brainDir, { recursive: true }, (evt, name) => {
      if (name && (String(name).includes(LAYOUT_FILE) || String(name).includes(".trash"))) return;
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => broadcast({ type: "brain-changed" }), 260);
    });
  } catch (e) {
    console.log("  (live file watching unavailable here — the console still reloads on demand)");
  }
}

function send(res, code, body, type) {
  res.writeHead(code, {
    "Content-Type": type || "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", c => { d += c; if (d.length > 2e6) req.destroy(); });
    req.on("end", () => { try { resolve(d ? JSON.parse(d) : {}); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
               ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png" };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  const p = url.pathname;

  if (TOKEN) {
    const given = url.searchParams.get("k") || req.headers["x-jarvis-key"];
    if (given !== TOKEN) return send(res, 403, { error: "Bad or missing key." });
  }

  try {
    if (p === "/" || p === "/index.html") {
      const file = path.join(HERE, "public", "index.html");
      const html = await fsp.readFile(file, "utf8");
      return send(res, 200, html, MIME[".html"]);
    }

    if (p === "/api/state") {
      const brain = await readBrain();
      return send(res, 200, {
        brain,
        config: {
          brainDir: CFG.brainDir,
          workspace: CFG.workspace,
          access: CFG.access,
          model: CFG.model || "default",
          platform: process.platform,
          host: os.hostname()
        }
      });
    }

    if (p === "/api/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      });
      res.write("retry: 2000\n\n");
      clients.add(res);
      const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch (e) {} }, 25000);
      req.on("close", () => { clearInterval(ping); clients.delete(res); });
      return;
    }

    if (p === "/api/note" && req.method === "POST") {
      const b = await readBody(req);
      const id = await writeNote(b);
      broadcast({ type: "brain-changed" });
      return send(res, 200, { ok: true, id });
    }

    if (p === "/api/note" && req.method === "DELETE") {
      const b = await readBody(req);
      await trashNote(b.id);
      broadcast({ type: "brain-changed" });
      return send(res, 200, { ok: true });
    }

    if (p === "/api/link" && req.method === "POST") {
      const b = await readBody(req);
      await appendLink(b.from, b.toLabel);
      broadcast({ type: "brain-changed" });
      return send(res, 200, { ok: true });
    }

    if (p === "/api/layout" && req.method === "POST") {
      const b = await readBody(req);
      await writeLayout(b.layout || {});
      return send(res, 200, { ok: true });
    }

    if (p === "/api/reveal" && req.method === "POST") {
      const b = await readBody(req);
      revealInFileManager(b.path || CFG.brainDir);
      return send(res, 200, { ok: true });
    }

    if (p === "/api/notify" && req.method === "POST") {
      const b = await readBody(req);
      notify(b.title || "Jarvis", b.body || "");
      return send(res, 200, { ok: true });
    }

    if (p === "/api/ask" && req.method === "POST") {
      const b = await readBody(req);
      const question = String(b.question || "").slice(0, 8000);
      if (!question) return send(res, 400, { error: "Nothing to ask." });
      const access = ["read", "write", "full"].includes(b.access) ? b.access : CFG.access;

      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      });
      console.log("? " + question.slice(0, 90) + "   [" + access + "]");

      const child = runClaude(question, b.history, access, ev => {
        try { res.write("data: " + JSON.stringify(ev) + "\n\n"); } catch (e) {}
        if (ev.type === "done") { try { res.end(); } catch (e) {} }
      });
      req.on("close", () => { try { child.kill("SIGTERM"); } catch (e) {} });
      return;
    }

    return send(res, 404, { error: "No such endpoint." });
  } catch (err) {
    return send(res, 500, { error: String(err && err.message || err) });
  }
});

/* -------------------------------------------------------------------- boot */

function localAddresses() {
  const out = [];
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name] || []) {
      if (i.family === "IPv4" && !i.internal) out.push(i.address);
    }
  }
  return out;
}

(async () => {
  await ensureBrain();
  watchBrain();

  const hostBind = CFG.lan ? "0.0.0.0" : "127.0.0.1";
  server.listen(CFG.port, hostBind, () => {
    const q = TOKEN ? "?k=" + TOKEN : "";
    console.log("");
    console.log("  J A R V I S   ·   local companion");
    console.log("  ─────────────────────────────────");
    console.log("  console    http://localhost:" + CFG.port + q);
    if (CFG.lan) {
      for (const a of localAddresses()) console.log("  phone      http://" + a + ":" + CFG.port + q);
      console.log("  (LAN mode: the key above is required. Anyone on this network with it gets the same access.)");
    }
    console.log("  brain      " + CFG.brainDir);
    console.log("  workspace  " + CFG.workspace);
    console.log("  access     " + CFG.access + "   (change it in the console, or in jarvis.config.json)");
    console.log("");
  });
  server.on("error", e => {
    if (e.code === "EADDRINUSE") {
      console.error("! Port " + CFG.port + " is taken. Start it with --port 8788, or change \"port\" in jarvis.config.json.");
      process.exit(1);
    }
    throw e;
  });
})();
