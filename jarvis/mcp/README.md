# Jarvis · MCP server

An MCP server that runs on your machine and hands Claude your second brain and your
workspace. Register it once with the Claude desktop app and Claude can read your notes,
capture new ones, look through your project files and put a notification on your screen —
on your Mac and on your PC, each with its own brain folder.

No dependencies. Node 18+.

## Register it with the Claude app

In the app: **Settings → Developer → Edit Config**. Or edit the file directly:

- **macOS** — `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows** — `%APPDATA%\Claude\claude_desktop_config.json`

Add a `jarvis` entry, with an **absolute** path to `server.js`:

```json
{
  "mcpServers": {
    "jarvis": {
      "command": "node",
      "args": ["/Users/you/code/documentation/jarvis/mcp/server.js"],
      "env": {
        "JARVIS_BRAIN": "/Users/you/Documents/Brain",
        "JARVIS_WORKSPACE": "/Users/you/Projects"
      }
    }
  }
}
```

On Windows use double backslashes: `"C:\\Users\\you\\code\\documentation\\jarvis\\mcp\\server.js"`.

Restart the app. The tools appear under the connectors icon. If the app's config UI
disagrees with the shape above, trust the app — it owns that file.

Then try: *"What's in my second brain?"*, *"Note that the podcast intro needs a rewrite
before Friday, and link it to the Content engine"*, *"What's in my Projects folder?"*

## The tools

| Tool | Reads or writes | Does |
| --- | --- | --- |
| `list_notes` | read | Every note with its cluster and links |
| `read_note` | read | One note in full |
| `search_brain` | read | Search titles and bodies |
| `list_files` | read | Directory listing inside the workspace |
| `read_file` | read | A text file inside the workspace |
| `write_note` | write | Capture a new note as a markdown file |
| `link_notes` | write | Relate two notes with a wiki link |
| `trash_note` | write | Move a note to `.trash` |
| `reveal` | write | Show a file in Finder or Explorer |
| `notify` | write | Desktop notification |
| `run_command` | write | Shell command — **off unless you turn it on** |

The read tools are annotated read-only, so the app runs them without interrupting you.
Everything that writes is deliberately left un-annotated: the app asks first.

## Safety

- **`read_file` and `list_files` cannot escape the workspace.** Paths that try are
  rejected, `../..` included.
- **`trash_note` never deletes.** Notes move to `.trash` inside the brain folder.
- **`run_command` is not even listed** unless you set `"allowShell": true` in
  `jarvis.mcp.json` (or `JARVIS_ALLOW_SHELL=1`). Turn it on only if you want spoken
  commands able to run things.

## Configuration

Copy `jarvis.mcp.example.json` to `jarvis.mcp.json`, or use the `env` block in the app
config as shown above.

| Key | Env | Default | Meaning |
| --- | --- | --- | --- |
| `brainDir` | `JARVIS_BRAIN` | `../local/brain` | The notes folder. An Obsidian vault works. |
| `workspace` | `JARVIS_WORKSPACE` | your home folder | What `list_files` and `read_file` may see. |
| `allowShell` | `JARVIS_ALLOW_SHELL=1` | `false` | Whether `run_command` exists at all. |
| `maxFileBytes` | — | `120000` | Where `read_file` truncates. |

It shares the brain folder and the note format with `jarvis/local`, through
`jarvis/lib/brain.js` — point both at the same folder and they see the same graph.

## Talking to it from the hosted console

The Jarvis artifact has a **This machine** switch that reads its graph from this server
instead of from the cloud, and gives the voice assistant `list_files`, `read_file` and
`notify` on top of the note tools.

For that to light up, two things must be true:

1. The page is published with `host:jarvis` in its `mcp` capability manifest, and
2. you open it in the **Claude desktop app**, with this server running.

Host servers can only be declared when publishing from a session that allows them, and
only the artifact's owner can call them. Publishing the page from a session where host
servers aren't available leaves the switch permanently disabled — the page says so
plainly rather than pretending. Everything in this README works regardless: the app
itself can use these tools with no artifact involved.

## Checking it by hand

The server speaks JSON-RPC on stdin/stdout, so you can drive it without the app:

```bash
{ echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}'
  echo '{"jsonrpc":"2.0","method":"notifications/initialized"}'
  echo '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
  echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_notes","arguments":{}}}'
  sleep 1
} | node server.js
```

Diagnostics go to stderr, so they never corrupt the protocol on stdout.
