#!/usr/bin/env node
/**
 * Selvtest for Jarvis MCP-server.
 *
 * Starter serveren mot en midlertidig hjernemappe, kjører hele protokollen og
 * hvert verktøy, og sier fra om noe ikke stemmer. Rører ikke dine egne notater.
 *
 *     npm test
 */
"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const os = require("os");

const GRØNN = "[32m", RØD = "[31m", GRÅ = "[90m", AV = "[0m";

let bestått = 0, feilet = 0;
function sjekk(navn, ok, detalj) {
  if (ok) { bestått++; console.log("  " + GRØNN + "✓" + AV + " " + navn); }
  else { feilet++; console.log("  " + RØD + "✗" + AV + " " + navn + (detalj ? "\n    " + GRÅ + detalj + AV : "")); }
}

/* ------------------------------------------------------------- klienten --- */

function startServer(hjerne, arbeid) {
  const barn = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: Object.assign({}, process.env, {
      JARVIS_BRAIN: hjerne,
      JARVIS_WORKSPACE: arbeid,
      JARVIS_ALLOW_SHELL: "0"
    }),
    stdio: ["pipe", "pipe", "pipe"]
  });

  const venter = new Map();
  let buf = "";
  let stderr = "";

  barn.stdout.setEncoding("utf8");
  barn.stdout.on("data", chunk => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const linje = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!linje || linje[0] !== "{") continue;
      let msg;
      try { msg = JSON.parse(linje); } catch (e) { continue; }
      if (msg.id !== undefined && venter.has(msg.id)) {
        const { resolve } = venter.get(msg.id);
        venter.delete(msg.id);
        resolve(msg);
      }
    }
  });
  barn.stderr.on("data", d => { stderr += d.toString(); });

  let nesteId = 1;
  function be(method, params) {
    const id = nesteId++;
    return new Promise((resolve, reject) => {
      venter.set(id, { resolve, reject });
      barn.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
      setTimeout(() => {
        if (venter.has(id)) { venter.delete(id); reject(new Error("Ikke noe svar på " + method)); }
      }, 15000);
    });
  }
  function varsle(method, params) {
    barn.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
  }
  function kall(navn, args) {
    return be("tools/call", { name: navn, arguments: args || {} });
  }
  return { barn, be, varsle, kall, stderr: () => stderr };
}

function innhold(svar) {
  const r = svar && svar.result;
  if (!r) return null;
  if (r.structuredContent !== undefined) return r.structuredContent;
  try { return JSON.parse(r.content[0].text); } catch (e) { return r.content && r.content[0] && r.content[0].text; }
}
function erFeil(svar) {
  return !!(svar && svar.result && svar.result.isError);
}

/* ------------------------------------------------------------------ løp --- */

(async () => {
  const rot = await fsp.mkdtemp(path.join(os.tmpdir(), "jarvis-selvtest-"));
  const hjerne = path.join(rot, "hjerne");
  const arbeid = path.join(rot, "arbeid");
  await fsp.mkdir(arbeid, { recursive: true });
  await fsp.writeFile(path.join(arbeid, "lesmeg.txt"), "hei fra arbeidsområdet\n", "utf8");
  await fsp.mkdir(path.join(arbeid, "prosjekt"), { recursive: true });

  console.log("\n  Jarvis MCP · selvtest");
  console.log("  " + GRÅ + rot + AV + "\n");

  const s = startServer(hjerne, arbeid);
  let kode = 1;

  try {
    /* --- protokoll --- */
    const init = await s.be("initialize", {
      protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "selvtest", version: "1" }
    });
    sjekk("initialize svarer med serverInfo",
      !!(init.result && init.result.serverInfo && init.result.serverInfo.name === "jarvis"),
      JSON.stringify(init.result));
    s.varsle("notifications/initialized");

    const liste = await s.be("tools/list");
    const verktøy = (liste.result && liste.result.tools) || [];
    const navn = verktøy.map(t => t.name);
    sjekk("tools/list gir de ti verktøyene", navn.length === 10, navn.join(", "));
    sjekk("run_command er ikke listet uten allowShell", !navn.includes("run_command"));
    const kunLes = verktøy.filter(t => t.annotations && t.annotations.readOnlyHint).map(t => t.name);
    sjekk("leseverktøyene er merket read-only",
      ["list_notes", "read_note", "search_brain", "list_files", "read_file"].every(n => kunLes.includes(n)),
      kunLes.join(", "));
    sjekk("skriveverktøyene er ikke merket read-only",
      !["write_note", "link_notes", "trash_note"].some(n => kunLes.includes(n)));

    /* --- hjernen såes --- */
    const start = innhold(await s.kall("list_notes"));
    sjekk("hjernemappa såes med eksempelnotater", start && start.count === 9, "count=" + (start && start.count));
    sjekk("rotnotatet heter Førstehjernen",
      !!(start && start.notes.some(n => n.title === "Førstehjernen")),
      start && start.notes.map(n => n.title).join(", "));
    sjekk("klyngene er norske",
      !!(start && start.notes.every(n => /^(kjerne|innhold|systemer|research)$/.test(n.group))),
      start && Array.from(new Set(start.notes.map(n => n.group))).join(", "));

    /* --- skrive, lese, søke --- */
    const skrevet = innhold(await s.kall("write_note", {
      title: "Sponsoroppfølging", group: "penger",
      body: "Purr på fakturaen etter fredagsmøtet.",
      related: ["Førstehjernen"]
    }));
    sjekk("write_note lager notatet", !!(skrevet && skrevet.ok), JSON.stringify(skrevet));
    sjekk("write_note kobler til notatet du ba om",
      !!(skrevet && skrevet.linkedTo && skrevet.linkedTo.includes("Førstehjernen")));

    const påDisk = path.join(hjerne, "Sponsoroppfølging.md");
    sjekk("fila finnes på disk", fs.existsSync(påDisk));
    const tekst = fs.existsSync(påDisk) ? fs.readFileSync(påDisk, "utf8") : "";
    sjekk("fila har riktig frontmatter og wikilenke",
      /^---\ngroup: penger\n---/.test(tekst) && tekst.includes("[[Førstehjernen]]"),
      JSON.stringify(tekst.slice(0, 90)));

    const lest = innhold(await s.kall("read_note", { title: "Sponsoroppfølging" }));
    sjekk("read_note ser skrivingen med én gang",
      !!(lest && lest.body && lest.body.includes("fakturaen")), JSON.stringify(lest && lest.body));
    sjekk("koblingen er med i grafen",
      !!(lest && lest.linked && lest.linked.includes("Førstehjernen")), JSON.stringify(lest && lest.linked));

    const søk = innhold(await s.kall("search_brain", { query: "faktura" }));
    sjekk("search_brain finner det nye notatet",
      !!(søk && søk.hits && søk.hits.length === 1 && søk.hits[0].title === "Sponsoroppfølging"),
      JSON.stringify(søk && søk.hits && søk.hits.map(h => h.title)));

    const koblet = innhold(await s.kall("link_notes", { from: "Sponsoroppfølging", to: "Systemer" }));
    sjekk("link_notes knytter to notater", !!(koblet && koblet.ok), JSON.stringify(koblet));
    const igjen = innhold(await s.kall("read_note", { title: "Sponsoroppfølging" }));
    sjekk("den nye koblingen vises", !!(igjen && igjen.linked.includes("Systemer")), JSON.stringify(igjen && igjen.linked));

    /* --- filer --- */
    const filer = innhold(await s.kall("list_files", {}));
    sjekk("list_files ser arbeidsområdet",
      !!(filer && filer.entries.some(e => e.name === "lesmeg.txt") && filer.entries.some(e => e.name === "prosjekt")),
      JSON.stringify(filer && filer.entries));
    sjekk("mapper sorteres først",
      !!(filer && filer.entries[0] && filer.entries[0].type === "dir"));
    const fil = innhold(await s.kall("read_file", { path: "lesmeg.txt" }));
    sjekk("read_file leser innholdet", !!(fil && fil.text.includes("hei fra arbeidsområdet")));

    /* --- grenser --- */
    sjekk("read_file slipper ikke ut av arbeidsområdet",
      erFeil(await s.kall("read_file", { path: "../../../etc/passwd" })));
    sjekk("write_note slipper ikke ut av hjernemappa",
      erFeil(await s.kall("write_note", { title: "../rømling", body: "nei" })) ||
      !fs.existsSync(path.join(rot, "rømling.md")));
    sjekk("ukjent notat gir en tydelig feil, ikke et krasj",
      erFeil(await s.kall("read_note", { title: "finnes ikke" })));
    sjekk("ukjent verktøy avvises",
      !!(await s.be("tools/call", { name: "slett_alt", arguments: {} })).error);

    /* --- kasting --- */
    const kastet = innhold(await s.kall("trash_note", { title: "Sponsoroppfølging" }));
    sjekk("trash_note flytter notatet", !!(kastet && kastet.ok));
    sjekk("fila er borte fra hjernemappa", !fs.existsSync(påDisk));
    const iSøpla = fs.existsSync(path.join(hjerne, ".trash"))
      ? fs.readdirSync(path.join(hjerne, ".trash")) : [];
    sjekk("men ligger i .trash, ikke slettet",
      iSøpla.some(f => f.includes("Sponsoroppfølging")), iSøpla.join(", "));

    const slutt = innhold(await s.kall("list_notes"));
    sjekk("hjernen er tilbake til ni notater", !!(slutt && slutt.count === 9), "count=" + (slutt && slutt.count));

    kode = feilet === 0 ? 0 : 1;
  } catch (err) {
    feilet++;
    console.log("\n  " + RØD + "Testen stoppet: " + (err && err.message) + AV);
    const e = s.stderr();
    if (e) console.log(GRÅ + e.split("\n").map(l => "    " + l).join("\n") + AV);
  } finally {
    try { s.barn.stdin.end(); } catch (e) {}
    try { s.barn.kill(); } catch (e) {}
    await fsp.rm(rot, { recursive: true, force: true }).catch(() => {});
  }

  console.log("\n  " + (feilet === 0 ? GRØNN + bestått + " av " + bestått + " i orden." + AV
                                     : RØD + feilet + " feilet" + AV + ", " + bestått + " i orden.") + "\n");
  process.exit(kode);
})();
