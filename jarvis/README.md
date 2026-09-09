# Jarvis · Førstehjernen

Et stemmestyrt konsoll for hjernen din: en kraftsimulert graf av notatene dine til
venstre, JARVIS-ringen og kommandolinja til høyre. Spør høyt, og Claude svarer fra
grafen — og kan legge til notater og koblinger mens den snakker.

Det heter *Førstehjernen*, ikke «andre hjerne». Dette er den du faktisk bruker.

## Tre måter å kjøre den på

| | Hvor den bor | Hva den når |
| --- | --- | --- |
| **Hostet** (`index.html`) | Publisert som en Claude-artefakt | Sin egen graf, synket mellom enhetene dine |
| **Lokal** ([`local/`](local/)) | En følgesvenn-prosess på PC-en eller Mac-en | Dine ekte markdown-filer, prosjektene dine, maskinen din |
| **MCP** ([`mcp/`](mcp/)) | En server registrert i Claude-appen | De samme notatene og filene, fra inne i Claude-appen |

- [`local/`](local/) — hele konsollet, servert fra din egen maskin. Bruk den hvis du vil ha
  grafen, stemmesløyfa og maskintilgang i ett vindu.
- [`mcp/`](mcp/) — den samme hjernen eksponert for Claude-appen som verktøy. Bruk den hvis du
  vil snakke helt vanlig med Claude og la den nå notatene og filene dine.

Begge leser den samme markdown-mappa gjennom [`lib/brain.js`](lib/brain.js), så peker du dem
på samme katalog, har du én hjerne.

## Hvordan tester du den?

Raskest først — ingen oppsett, ingen Claude-app:

```bash
cd jarvis/mcp && npm test
```

28 sjekker som starter serveren mot en midlertidig hjernemappe, kjører hele protokollen
og hvert verktøy, og bekrefter at grensene holder. Dine egne notater blir ikke rørt.

Så det lokale konsollet:

```bash
cd jarvis/local && npm start     # åpne http://localhost:8787
```

Full framgangsmåte for begge står i [`local/README.md`](local/README.md) og
[`mcp/README.md`](mcp/README.md).

## Hjernen er en mappe med markdown

Ett notat er én `.md`-fil:

```markdown
---
group: innhold
---

# Videomanus

Utkast bor her. Relatert: [[Innholdsmotor]].
```

- **Tittel** kommer fra overskriften, ellers filnavnet.
- **Klynge** kommer fra `group:` i frontmatter, ellers undermappenavnet, ellers `notater`.
- **Koblinger** er `[[Wikilenker]]` — samme syntaks som Obsidian, så du kan peke den på et
  eksisterende vault og se den ekte grafen din.
- **Nodeposisjoner** ligger i `.jarvis-layout.json` i hjernemappa, så det å dra rundt på
  noder aldri skriver om notatene dine.

Klyngenavnene er norske (`kjerne`, `innhold`, `systemer`, `research`, `penger`, `kunder`,
`prosjekter`, `notater`, `innboks`, `folk`), men de engelske virker fortsatt som aliaser,
så et vault som allerede bruker dem ser likt ut.

## Hva som virker hvor

| Funksjon | Krever |
| --- | --- |
| Graf, notater, koblinger, visualiseringer | hvilken som helst moderne nettleser |
| Stemme inn (talegjenkjenning) | Chrome eller Edge |
| Stemme ut (opplesing) | alle nettlesere med talesyntese |
| Claude-svar i den hostede versjonen | publisert som artefakt (`sample`) |
| Synk mellom enheter | publisert som artefakt (`db`); ellers `localStorage` |
| Ekte filer og maskintilgang | `local/` eller `mcp/` på din egen maskin |

## Bruk

- **Mikrofonknappen** slår på kontinuerlig lytting. Si `Jarvis, …`, eller skru av
  *Kun vekkeord* så reagerer den på alt den hører.
- **Skriv i stedet** — kommandolinja fungerer alltid; `/` setter markøren der.
- **Grafen** — dra noder, scroll for zoom, dra bakgrunnen for panorering, klikk en node
  for å redigere teksten, koble den, eller slette den.
- **Docken** — nytt notat, tilpass visningen, demp opplesing, tøm hjernen.
