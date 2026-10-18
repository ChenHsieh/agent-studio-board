# Studio board

A one-page live board for a pipeline where coding agents build and review work: what is being built right now, by which
agent, its latest commit, what is queued, what is parked, and what each item has cost. Plain HTML, CSS and JS in `docs/`,
served by GitHub Pages; no build step.

Live: https://chenhsieh.github.io/agent-studio-board/

The example data is Play Lab, a small studio of browser games (https://chenhsieh.github.io/play-lab/).

## How it updates

A script on the build machine reads the pipeline's own records (task queue folders, a change log, a cost ledger, and the
last commit on each task's branch) and writes `docs/data/status.json`. It pushes only when something changed, so
the page moves when a task is claimed, an agent commits, or a task finishes. Agents make a "start: <task>" commit when
they pick up a task, which is the heartbeat the board shows.

## Using it for another pipeline

Write a `docs/data/status.json` with this shape and the page renders it:

```
{ "generated": ISO time, "project": { "name", "noun", "nounPlural", "url", "blurb" },
  "lanes": [ { "worker", "game", "task", "since", "activity", "commit": { "at", "subject" } } ],
  "codexLanes": n, "apiSpentUsd": n, "houseRules": n,
  "games": [ { "id", "title", "line", "url", "image", "stage": building|review|queued|planning|live|shelf,
               "priority": "P1".."P4", "priorityNote", "shelfNote", "lastChange",
               "cost": { "apiUsd", "codexRuns", "claudeRuns" },
               "tasks": [ { "title", "state", "worker", "plan", "since", "done", "reviewed", "commit", "result" } ],
               "history": [ { "at", "ok", "note" } ] } ] }
```

Tasks carry written action plans, not raw feedback.
