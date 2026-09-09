# Jarvis Second Brain

A voice-driven knowledge console: a force-directed graph of your notes on the left,
a JARVIS HUD and command bar on the right. Ask a question out loud and Claude answers
from the graph — and can add notes and links to it while it talks.

## Run it

It is a single self-contained page. Either:

- open `index.html` directly in Chrome, or
- publish it as a Claude Artifact (that is what unlocks the Claude brain and cross-device sync).

## What works where

| Feature | Needs |
| --- | --- |
| Graph, notes, links, visualisers | any modern browser |
| Voice in (speech recognition) | Chrome or Edge |
| Voice out (spoken replies) | any browser with speech synthesis |
| Claude answers + graph edits by voice | published as an Artifact (`sample` capability) |
| Sync across devices | published as an Artifact (`db` capability); otherwise `localStorage` |

## Using it

- **Mic button** — toggles continuous listening. Say `Jarvis, …` or turn off *Wake word only*
  to have it act on everything it hears.
- **Type instead** — the command bar always works; `/` focuses it.
- **Graph** — drag nodes, scroll to zoom, drag the background to pan, click a node to edit
  its note, link it, or delete it.
- **Dock** — add a node, fit the view, mute spoken replies, or clear the brain.

It ships with a sample brain so the first screen shows something real. Editing anything
clears the sample marker; **Clear brain** empties it down to a single root node.

## Two ways to run it

| | Where it lives | What it reaches |
| --- | --- | --- |
| **Hosted** (`index.html`) | Published as a Claude Artifact | Its own graph, synced across your devices |
| **Local** (`local/`) | A companion process on your PC or Mac | Your real markdown files, your projects, your machine |

The local version is in [`local/`](local/) and has its own README. It is the one to
use if you want Jarvis to read your files or run things for you.

## Claude's tools

While answering, Claude can call three page functions: `add_note`, `connect`, and
`search_brain`. So "Jarvis, note that the Q4 launch moves to November and link it to
the content engine" actually changes the graph.
