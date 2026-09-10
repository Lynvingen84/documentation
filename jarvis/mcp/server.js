#!/usr/bin/env node
/**
 * Jarvis MCP-server — stdio, ingen avhengigheter, Node 18+.
 *
 * Kjører på din maskin og registreres i Claude-appen. Den publiserte Jarvis-
 * artefakten når disse verktøyene som `host:jarvis` — slik kommer en sandkasset
 * nettside til de virkelige filene dine.
 *
 * Leseverktøy er merket read-only, så appen avbryter deg ikke for dem. Alt som
 * skriver er bevisst umerket: appen spør først. Skallverktøyet er ikke engang
 * listet før du skrur det på.
 */
"use strict";

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");

const createBrain = require("../lib/brain.js");
const expandHome = createBrain.expandHome;

/* ------------------------------------------------------------------ config */

function loadConfig() {
  const defaults = {
    brainDir: path.join(__dirname, "..", "local", "brain"),
    workspace: os.homedir(),
    allowShell: false,
    maxFileBytes: 120000
  };
  let file = {};
  const cfgPath = path.join(__dirname, "jarvis.mcp.json");
  if (fs.existsSync(cfgPath)) {
    try { file = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch (e) {}
  }
  const env = {};
  if (process.env.JARVIS_BRAIN) env.brainDir = process.env.JARVIS_BRAIN;
  if (process.env.JARVIS_WORKSPACE) env.workspace = process.env.JARVIS_WORKSPACE;
  if (process.env.JARVIS_ALLOW_SHELL === "1") env.allowShell = true;

  const cfg = Object.assign(defaults, file, env);
  cfg.brainDir = path.resolve(expandHome(cfg.brainDir));
  cfg.workspace = path.resolve(expandHome(cfg.workspace));
  return cfg;
}

const CFG = loadConfig();
const brain = createBrain(CFG.brainDir);

/* stdout is the protocol channel — every diagnostic goes to stderr. */
function log(...a) { process.stderr.write("[jarvis-mcp] " + a.join(" ") + "\n"); }

/* ------------------------------------------------------------- workspace io */

function inWorkspace(rel) {
  const p = path.resolve(CFG.workspace, expandHome(String(rel || ".")));
  if (p !== CFG.workspace && !p.startsWith(CFG.workspace + path.sep)) {
    throw new Error("Den stien ligger utenfor arbeidsområdet (" + CFG.workspace + ").");
  }
  return p;
}

async function listFiles(dir, limit) {
  const full = inWorkspace(dir);
  const entries = await fsp.readdir(full, { withFileTypes: true });
  const out = [];
  for (const e of entries.slice(0, limit || 200)) {
    if (e.name.startsWith(".")) continue;
    let size = null, modified = null;
    try {
      const st = await fsp.stat(path.join(full, e.name));
      size = e.isDirectory() ? null : st.size;
      modified = new Date(st.mtimeMs).toISOString();
    } catch (err) {}
    out.push({ name: e.name, type: e.isDirectory() ? "dir" : "file", size, modified });
  }
  out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "dir" ? -1 : 1));
  return { dir: path.relative(CFG.workspace, full) || ".", absolute: full, count: out.length, entries: out };
}

async function readFile(rel) {
  const full = inWorkspace(rel);
  const st = await fsp.stat(full);
  if (st.isDirectory()) throw new Error("Det er en mappe. Bruk list_files.");
  const truncated = st.size > CFG.maxFileBytes;
  const fh = await fsp.open(full, "r");
  try {
    const buf = Buffer.alloc(Math.min(st.size, CFG.maxFileBytes));
    await fh.read(buf, 0, buf.length, 0);
    return { path: path.relative(CFG.workspace, full), bytes: st.size, truncated, text: buf.toString("utf8") };
  } finally { await fh.close(); }
}

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

function runShell(command, timeoutMs) {
  return new Promise((resolve, reject) => {
    const shell = process.platform === "win32" ? "powershell.exe" : "/bin/sh";
    const args = process.platform === "win32" ? ["-NoProfile", "-Command", command] : ["-c", command];
    execFile(shell, args, { cwd: CFG.workspace, timeout: timeoutMs || 20000, maxBuffer: 400000 },
      (err, stdout, stderr) => {
        if (err && err.killed) return reject(new Error("Kommandoen brukte for lang tid."));
        resolve({
          command,
          exitCode: err ? (typeof err.code === "number" ? err.code : 1) : 0,
          stdout: String(stdout).slice(0, 20000),
          stderr: String(stderr).slice(0, 4000)
        });
      });
  });
}

/* -------------------------------------------------------------------- tools */

const TOOLS = [
  {
    name: "list_notes",
    description: "List alle notatene i hjernen, med klynge og hva de kobler til. Bruk denne for å orientere deg før du svarer på noe om notatene.",
    annotations: { title: "List notater", readOnlyHint: true },
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: async () => {
      const b = await brain.read();
      return {
        dir: b.dir,
        count: b.nodes.length,
        notes: b.nodes.map(n => ({
          title: n.label,
          group: n.group,
          summary: n.note.slice(0, 160),
          linked: b.links.filter(l => l.s === n.id || l.t === n.id).map(l => (l.s === n.id ? l.t : l.s))
        }))
      };
    }
  },
  {
    name: "read_note",
    description: "Les ett notat i sin helhet, etter tittel eller filnavn.",
    annotations: { title: "Les notat", readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: { title: { type: "string", description: "Notattittel eller filnavn" } },
      required: ["title"], additionalProperties: false
    },
    run: async ({ title }) => {
      const b = await brain.read();
      const n = brain.resolve(b.nodes, title);
      if (!n) throw new Error("Fant ingen notat som heter \"" + title + "\".");
      return {
        title: n.label, group: n.group, file: n.file, body: n.note,
        linked: b.links.filter(l => l.s === n.id || l.t === n.id).map(l => (l.s === n.id ? l.t : l.s))
      };
    }
  },
  {
    name: "search_brain",
    description: "Søk i notattitler og -tekst etter et ord, og få treffene med koblingene deres.",
    annotations: { title: "Søk i hjernen", readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 50 }
      },
      required: ["query"], additionalProperties: false
    },
    run: async ({ query, limit }) => ({ query, hits: await brain.search(query, limit) })
  },
  {
    name: "write_note",
    description: "Fang et nytt notat i hjernen, eventuelt koblet til notater som allerede finnes. Skriver en ekte markdown-fil.",
    annotations: { title: "Skriv notat" },
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Kort tittel, under 60 tegn" },
        group: { type: "string", description: "Klynge: innhold, systemer, research, penger, kunder, prosjekter, notater…" },
        body: { type: "string", description: "Én eller to setninger med substans" },
        related: {
          type: "array", items: { type: "string" },
          description: "Titler på eksisterende notater å koble dette til"
        }
      },
      required: ["title"], additionalProperties: false
    },
    run: async ({ title, group, body, related }) => {
      const r = await brain.writeNote({ label: title, group, note: body, connectTo: related });
      return { ok: true, id: r.id, title, group: group || "notes", linkedTo: r.related };
    }
  },
  {
    name: "link_notes",
    description: "Knytt sammen to notater som allerede finnes, ved å legge en wikilenke i det første.",
    annotations: { title: "Koble notater" },
    inputSchema: {
      type: "object",
      properties: { from: { type: "string" }, to: { type: "string" } },
      required: ["from", "to"], additionalProperties: false
    },
    run: async ({ from, to }) => Object.assign({ ok: true }, await brain.appendLink(from, to))
  },
  {
    name: "trash_note",
    description: "Flytt et notat til hjernens .trash-mappe. Ingenting slettes for godt.",
    annotations: { title: "Kast notat" },
    inputSchema: {
      type: "object",
      properties: { title: { type: "string" } },
      required: ["title"], additionalProperties: false
    },
    run: async ({ title }) => Object.assign({ ok: true }, await brain.trashNote(title))
  },
  {
    name: "list_files",
    description: "List filer og mapper i arbeidsområdet. Bruk denne for spørsmål om prosjekter og nedlastinger.",
    annotations: { title: "List filer", readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: {
        dir: { type: "string", description: "Sti relativt til arbeidsområdet. Utelat for roten." },
        limit: { type: "integer", minimum: 1, maximum: 500 }
      },
      additionalProperties: false
    },
    run: async ({ dir, limit }) => listFiles(dir, limit)
  },
  {
    name: "read_file",
    description: "Les en tekstfil i arbeidsområdet. Lange filer kommer avkortet tilbake.",
    annotations: { title: "Les fil", readOnlyHint: true },
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Sti relativt til arbeidsområdet" } },
      required: ["path"], additionalProperties: false
    },
    run: async ({ path: rel }) => readFile(rel)
  },
  {
    name: "reveal",
    description: "Vis en fil eller mappe i Finder, Utforsker eller skrivebordets filbehandler.",
    annotations: { title: "Vis i filbehandler" },
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "Sti relativt til arbeidsområdet. Utelat for hjernemappa." } },
      additionalProperties: false
    },
    run: async ({ path: rel }) => {
      const target = rel ? inWorkspace(rel) : brain.dir;
      revealInFileManager(target);
      return { ok: true, revealed: target };
    }
  },
  {
    name: "notify",
    description: "Vis et skrivebordsvarsel på denne maskinen.",
    annotations: { title: "Skrivebordsvarsel" },
    inputSchema: {
      type: "object",
      properties: { title: { type: "string" }, body: { type: "string" } },
      required: ["body"], additionalProperties: false
    },
    run: async ({ title, body }) => { notify(title || "Jarvis", body); return { ok: true }; }
  }
];

if (CFG.allowShell) {
  TOOLS.push({
    name: "run_command",
    description: "Kjør en skallkommando i arbeidsområdet og returner utdata. Bare tilgjengelig fordi denne maskinen har det eksplisitt påskrudd.",
    annotations: { title: "Kjør kommando", destructiveHint: true },
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string" },
        timeout_ms: { type: "integer", minimum: 1000, maximum: 120000 }
      },
      required: ["command"], additionalProperties: false
    },
    run: async ({ command, timeout_ms }) => runShell(command, timeout_ms)
  });
}

const BY_NAME = new Map(TOOLS.map(t => [t.name, t]));

/* ----------------------------------------------------------------- protocol */

const SERVER_INFO = { name: "jarvis", version: "1.0.0" };
const FALLBACK_PROTOCOL = "2024-11-05";

function write(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}
function reply(id, result) { write({ jsonrpc: "2.0", id, result }); }
function fail(id, code, message) { write({ jsonrpc: "2.0", id, error: { code, message } }); }

async function handle(msg) {
  const { id, method, params } = msg;
  const isRequest = id !== undefined && id !== null;

  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: (params && params.protocolVersion) || FALLBACK_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO
      });

    case "notifications/initialized":
    case "initialized":
      return;

    case "ping":
      return reply(id, {});

    case "tools/list":
      return reply(id, {
        tools: TOOLS.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
          annotations: t.annotations
        }))
      });

    case "tools/call": {
      const name = params && params.name;
      const tool = BY_NAME.get(name);
      if (!tool) return fail(id, -32602, "Fant ingen verktøy som heter \"" + name + "\".");
      try {
        const out = await tool.run((params && params.arguments) || {});
        return reply(id, {
          content: [{ type: "text", text: JSON.stringify(out, null, 1) }],
          structuredContent: out,
          isError: false
        });
      } catch (err) {
        const message = String((err && err.message) || err);
        log("tool " + name + " failed: " + message);
        /* A tool-level failure is a result, not a protocol error — the client
           shows it to the model rather than tearing down the call. */
        return reply(id, {
          content: [{ type: "text", text: message }],
          isError: true
        });
      }
    }

    case "resources/list":  return isRequest ? reply(id, { resources: [] }) : undefined;
    case "prompts/list":    return isRequest ? reply(id, { prompts: [] }) : undefined;

    default:
      if (isRequest) return fail(id, -32601, "Metoden støttes ikke: " + method);
  }
}

/* The brain is a shared folder of files: a write followed by a read must see
   the write. So messages are handled strictly one at a time, behind the
   readiness of the brain folder itself, rather than raced onto the event loop. */
const ready = brain.ensure()
  .then(seeded => {
    log("brain      " + brain.dir + (seeded ? "  (seeded " + seeded + " example notes)" : ""));
    log("workspace  " + CFG.workspace);
    log("tools      " + TOOLS.map(t => t.name).join(", "));
    if (!CFG.allowShell) log("run_command is off — set \"allowShell\": true in jarvis.mcp.json to enable it");
  })
  .catch(err => log("could not prepare the brain folder: " + ((err && err.message) || err)));

let queue = ready;

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); }
    catch (e) { log("could not parse a line from the client"); continue; }
    queue = queue
      .then(() => handle(msg))
      .catch(err => {
        log("handler error: " + ((err && err.message) || err));
        if (msg && msg.id !== undefined && msg.id !== null) {
          fail(msg.id, -32603, String((err && err.message) || err));
        }
      });
  }
});
process.stdin.on("end", () => process.exit(0));
