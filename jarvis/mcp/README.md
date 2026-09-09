# Jarvis · MCP-server

En MCP-server som kjører på din maskin og gir Claude førstehjernen din og arbeidsområdet
ditt. Registrer den én gang i Claude-appen, så kan Claude lese notatene dine, fange nye,
lete i prosjektfilene dine og legge et varsel på skjermen — på Mac-en og på PC-en, hver
med sin egen hjernemappe.

Ingen avhengigheter. Node 18+.

## Test den først

```bash
cd jarvis/mcp
npm test
```

Selvtesten starter serveren mot en midlertidig hjernemappe, kjører hele protokollen og
hvert eneste verktøy, og rydder opp etter seg. **Dine egne notater blir ikke rørt.**
Den sjekker 28 ting:

- at `initialize`, `tools/list` og `tools/call` svarer riktig
- at de ti verktøyene er der, og at `run_command` *ikke* er det uten at du har skrudd det på
- at leseverktøyene er merket read-only og skriveverktøyene ikke er det
- at hjernemappa såes med de ni eksempelnotatene, at rotnotatet heter Førstehjernen
  og at klyngene er norske
- at `write_note` skriver riktig frontmatter og wikilenke, og at `read_note` ser
  skrivingen med én gang
- at `search_brain` finner det nye notatet og `link_notes` knytter det videre
- at `list_files` og `read_file` ser arbeidsområdet
- at `read_file` og `write_note` **ikke** slipper ut av mappene sine
- at ukjente notater og ukjente verktøy gir tydelige feil i stedet for krasj
- at `trash_note` flytter til `.trash` i stedet for å slette

Grønt hele veien betyr at serveren er i orden. Da gjenstår bare å koble den til appen.

## Registrer den i Claude-appen

I appen: **Settings → Developer → Edit Config**. Eller rediger fila direkte:

- **macOS** — `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows** — `%APPDATA%\Claude\claude_desktop_config.json`

Legg inn en `jarvis`-oppføring med **absolutt** sti til `server.js`:

```json
{
  "mcpServers": {
    "jarvis": {
      "command": "node",
      "args": ["/Users/deg/kode/documentation/jarvis/mcp/server.js"],
      "env": {
        "JARVIS_BRAIN": "/Users/deg/Documents/Hjernen",
        "JARVIS_WORKSPACE": "/Users/deg/Prosjekter"
      }
    }
  }
}
```

På Windows må du doble skråstrekene: `"C:\\Users\\deg\\kode\\documentation\\jarvis\\mcp\\server.js"`.

Start appen på nytt. Verktøyene dukker opp under koblings-ikonet. Er appens eget
konfigurasjonsgrensesnitt uenig med formen over, stol på appen — den eier den fila.

### Prøv den

- *«Hva ligger i førstehjernen min?»*
- *«Noter at podcast-introen må skrives om før fredag, og koble det til Innholdsmotor.»*
- *«Hva ligger i Prosjekter-mappa mi?»*
- *«Søk i hjernen etter faktura.»*

Etter det andre spørsmålet skal det ligge en ny `.md`-fil i hjernemappa, med riktig
frontmatter og en `[[Innholdsmotor]]`-lenke. Åpner du mappa i Obsidian, er den der også.

## Verktøyene

| Verktøy | Leser eller skriver | Gjør |
| --- | --- | --- |
| `list_notes` | leser | Alle notater med klynge og koblinger |
| `read_note` | leser | Ett notat i sin helhet |
| `search_brain` | leser | Søk i titler og tekst |
| `list_files` | leser | Kataloglisting i arbeidsområdet |
| `read_file` | leser | En tekstfil i arbeidsområdet |
| `write_note` | skriver | Fanger et nytt notat som markdown-fil |
| `link_notes` | skriver | Knytter to notater med en wikilenke |
| `trash_note` | skriver | Flytter et notat til `.trash` |
| `reveal` | skriver | Viser en fil i Finder eller Utforsker |
| `notify` | skriver | Skrivebordsvarsel |
| `run_command` | skriver | Skallkommando — **av med mindre du skrur den på** |

Leseverktøyene er merket read-only, så appen kjører dem uten å avbryte deg. Alt som
skriver er bevisst umerket: appen spør først.

## Sikkerhet

- **`read_file` og `list_files` slipper ikke ut av arbeidsområdet.** Stier som forsøker
  blir avvist, `../..` inkludert. Selvtesten sjekker nettopp dette.
- **`trash_note` sletter aldri.** Notater flyttes til `.trash` inne i hjernemappa.
- **`run_command` er ikke engang listet** med mindre du setter `"allowShell": true` i
  `jarvis.mcp.json` (eller `JARVIS_ALLOW_SHELL=1`). Skru den på bare hvis du vil at
  talekommandoer skal kunne kjøre ting.

## Innstillinger

Kopier `jarvis.mcp.example.json` til `jarvis.mcp.json`, eller bruk `env`-blokka i
app-konfigurasjonen som vist over.

| Nøkkel | Miljøvariabel | Standard | Betyr |
| --- | --- | --- | --- |
| `brainDir` | `JARVIS_BRAIN` | `../local/brain` | Notatmappa. Et Obsidian-vault fungerer. |
| `workspace` | `JARVIS_WORKSPACE` | hjemmemappa di | Hva `list_files` og `read_file` får se. |
| `allowShell` | `JARVIS_ALLOW_SHELL=1` | `false` | Om `run_command` i det hele tatt finnes. |
| `maxFileBytes` | — | `120000` | Hvor `read_file` kutter. |

Den deler hjernemappa og notatformatet med `jarvis/local`, gjennom `jarvis/lib/brain.js` —
pek begge på samme mappe, så ser de samme graf.

## Å snakke med den fra det hostede konsollet

Jarvis-artefakten har en **Denne maskinen**-bryter som leser grafen fra denne serveren i
stedet for fra skya, og som gir stemmeassistenten `list_files`, `read_file` og `notify` i
tillegg til notatverktøyene.

For at det skal lyse opp må to ting stemme:

1. Siden er publisert med `host:jarvis` i `mcp`-manifestet sitt, og
2. du åpner den i **Claude-appen**, med denne serveren i gang.

Host-servere kan bare deklareres når man publiserer fra en økt som tillater dem, og bare
artefaktens eier kan kalle dem. Publiserer du siden fra en økt der host-servere ikke er
tilgjengelige, står bryteren permanent deaktivert — siden sier det rett ut i stedet for å
late som. Alt annet i denne fila fungerer uansett: appen selv kan bruke disse verktøyene
helt uten artefakt.

## Å sjekke den for hånd

Serveren snakker JSON-RPC på stdin/stdout, så du kan styre den uten appen:

```bash
{ echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'
  echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
  echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_notes","arguments":{}}}'
  sleep 1
} | node server.js
```

Diagnostikk går til stderr, så den ødelegger aldri protokollen på stdout.
