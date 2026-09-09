# Jarvis · lokal

Samme konsoll som den hostede versjonen, men kjørende **på din maskin** — så den faktisk
når filene dine, prosjektene dine og Claude Code på denne datamaskinen.

To deler:

- **`server.js`** — en liten følgesvenn-prosess. Ingen avhengigheter, Node 18+.
- **`public/index.html`** — konsollet den serverer.

## Kjør den

```bash
cd jarvis/local
npm start
```

Åpne så **http://localhost:8787**.

Første gang lager den `brain/` med ni eksempelnotater, så grafen ikke er tom. Pek den på
en ekte mappe når du vil (se *Innstillinger*).

For å kjøre den på Mac-en også: kopier over samme mappe og `npm start` der. Hver maskin
har sin egen hjernemappe.

## Hvordan tester du at den virker?

**1. Grafen tegner seg.** Etter `npm start` skal http://localhost:8787 vise ni noder med
`Førstehjernen` i midten, og øverst til høyre skal det stå `NOTATER 9`, `KOBLINGER 10`.
Står det «Følgesvennen kjører ikke», har ikke prosessen startet — se terminalen.

**2. Filene er ekte.** Klikk **Åpne hjernemappa** i docken. Filbehandleren skal åpne mappa
med ni `.md`-filer. Åpne en i en hvilken som helst editor, endre teksten, lagre — grafen
skal oppdatere seg i løpet av et øyeblikk uten at du laster siden på nytt.

**3. Skriving går andre veien.** Trykk **+ Notat**, skriv en tittel, trykk **Skriv fil**.
Det skal dukke opp en ny `.md`-fil i mappa med én gang.

**4. Claude svarer.** Skriv i kommandolinja: *«hva ligger i hjernen min?»* Du skal se
verktøybrikker («Read», «Glob») mens den jobber, og et kort svar på norsk. Kommer det
«Fant ikke kommandoen `claude`», er ikke Claude Code installert — sett `claudeBin` til
full sti, eller installer den.

**5. Stemme.** Trykk mikrofonknappen i Chrome eller Edge og si *«Jarvis, hva ligger i
hjernen min?»* Statusbrikka skal gå fra Rolig til Lytter til Tenker til Snakker.

**6. Den skriver notater selv.** Sett tilgang til **Skriv** og si eller skriv:
*«noter at podcast-introen må skrives om før fredag, og koble det til Innholdsmotor»*.
En ny fil skal dukke opp i mappa, og grafen skal få en ny node med en kobling.

Vil du teste MCP-halvdelen i stedet, kjør `cd ../mcp && npm test` — 28 automatiske
sjekker uten oppsett.

## Hva den kan som den hostede versjonen ikke kan

| | Hostet artefakt | Lokal |
| --- | --- | --- |
| Graf, notater, koblinger, stemme | ✅ | ✅ |
| Notatene er ekte `.md`-filer du eier | ❌ | ✅ |
| Lese filene og prosjektene dine | ❌ | ✅ |
| Skrive filer, kjøre kommandoer | ❌ | ✅ (valgfritt) |
| Fungerer med et eksisterende Obsidian-vault | ❌ | ✅ |
| Nåbar fra telefonen | ✅ overalt | ✅ på ditt nettverk |

## Maskintilgang

**Les / Skriv / Full**-bryteren i konsollet bestemmer hva Jarvis får gjøre denne økta.
Den styrer hvordan Claude Code startes:

| Nivå | Claude Code kjøres med | Jarvis kan |
| --- | --- | --- |
| **Les** | `--restricted`, ingen skriveverktøy | Lese filer, søke, svare fra notatene |
| **Skriv** | `--restricted` | I tillegg lage og endre filer, inkludert nye notater |
| **Full** | uten begrensning, `--permission-mode bypassPermissions` | I tillegg kjøre skallkommandoer, uten bekreftelse |

Les er standard. Full ber om bekreftelse én gang, og er det eneste nivået der en
talekommando kan kjøre noe på maskinen din — bruk det mens du ser på.

Hvert kall skriver den eksakte kommandoen til terminalen, så du kan alltid se hva som ble
startet.

Henger en forespørsel og melder tidsavbrudd, ventet Claude Code sannsynligvis på en
tillatelse den ikke får vist i denne modusen. Sett `"permissionMode"` i
`jarvis.config.json` til noe som ikke spør, eller gå ned et nivå.

## Innstillinger

Kopier `jarvis.config.example.json` til `jarvis.config.json` og rediger:

```json
{
  "port": 8787,
  "brainDir": "~/Documents/Hjernen",
  "workspace": "~/Prosjekter",
  "claudeBin": "claude",
  "model": "",
  "access": "read",
  "permissionMode": "acceptEdits",
  "askTimeoutMs": 180000
}
```

- **`brainDir`** — notatmappa. Et Obsidian-vault fungerer.
- **`workspace`** — hvor Claude Code starter. Dette er hva «prosjektene mine» betyr for Jarvis.
- **`model`** — la stå tom for standarden din, eller lås en.

Miljøvariablene `JARVIS_PORT`, `JARVIS_BRAIN`, `JARVIS_WORKSPACE` og `JARVIS_MODEL`
overstyrer fila, og `--port` / `--brain` overstyrer begge.

`jarvis.config.json` og `brain/` er gitignorert.

## Å nå den fra telefonen

```bash
npm run lan
```

Den binder seg til nettverket og skriver ut en URL med en engangsnøkkel:

```
telefon        http://192.168.1.24:8787?k=Xf3k9...
```

Åpne den på telefonen mens du er på samme wifi. To ting å vite:

- **Nøkkelen er hele beskyttelsen.** Alle på det nettverket som har den, får samme
  tilgangsnivå som du har valgt. Ikke la Full stå på i LAN-modus.
- **Stemme virker ikke over vanlig http på telefonen** — nettlesere gir bare
  mikrofontilgang på sikre origins. Skriving fungerer fint. Vil du ha stemme på
  telefonen, nå maskinen over Tailscale eller en annen https-rute i stedet.

## Krav

- **Node 18+**
- **Claude Code** installert og innlogget (`claude`). Ligger den et uvanlig sted, sett
  `claudeBin` til full sti.
- **Chrome eller Edge** for stemmeinngang. Alt annet fungerer i alle nettlesere.

Hvert spørsmål starter en ny `claude -p`-prosess, så den bærer Claude Codes vanlige
oppstartskostnad per spørsmål. De siste replikkene sendes med som kontekst, så den følger
en samtale.

## Endepunkter

Vil du koble på noe annet:

| Metode | Sti | Gjør |
| --- | --- | --- |
| `GET` | `/api/state` | Hele grafen pluss innstillinger |
| `POST` | `/api/ask` | Spør Claude; strømmer SSE (`delta`, `tool`, `error`, `done`) |
| `POST` | `/api/note` | Lag eller oppdater et notat |
| `DELETE` | `/api/note` | Flytt et notat til `.trash` |
| `POST` | `/api/link` | Legg en wikilenke mellom to notater |
| `POST` | `/api/layout` | Lagre nodeposisjoner |
| `POST` | `/api/reveal` | Vis en fil i Finder/Utforsker |
| `POST` | `/api/notify` | Skrivebordsvarsel |
| `GET` | `/api/events` | SSE-strøm av `brain-changed` |
