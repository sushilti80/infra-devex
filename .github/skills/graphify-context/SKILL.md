---
name: graphify-context
description: Use Graphify for architecture, dependency, data-flow, and "what depends on X?" questions after .ai/ai-repo.md has established repository structure. If graphify-out/graph.json is unavailable or stale, fall back to targeted search. Never use Graphify instead of reading the exact file before editing it.
---

# graphify-context: relationship-first exploration

Read `.ai/ai-repo.md` first. It owns cheap repository orientation and structure lookup. Use this skill only
when the remaining question is about relationships, dependencies, or data flow.

A Graphify snapshot may be available locally at `graphify-out/graph.json` (with
`graphify-out/GRAPH_REPORT.md` and `graphify-out/graph.html`). The snapshot is not guaranteed to be
tracked in Git, so check for it before querying. When present, it can cover code, docs, and their
relationships and can reduce repeated multi-file reads during isolated agent handoffs.

## When to query the graph instead of reading files

Use `graphify query` first — before `read_file`/`grep_search` sweeps across many files — whenever the
task is a **relationship or discovery** question, not a direct edit:
- "How does X flow through the system?" / "What calls/depends on Y?" / "Where is Z handled?"
- Building a "current-state" picture before writing a PRD, spec, or SRE baseline (avoids re-reading
  `server.js`, `routes/`, `services/`, `srcV2/` in full just to find the 3 relevant files)
- Handing context to another agent in the pipeline (Orchestrator → Architect → Dev/QA/DevOps) — query
  the graph for the specific fact needed instead of pasting whole file contents into the handoff
- Onboarding-style questions ("what agents exist", "what patterns does this feature touch")

Do **not** use it as a substitute for reading the exact file you are about to edit — always `read_file`
the real target before modifying it. The graph is for narrowing down *which* files matter and *how they
relate*, not for the authoritative current content of a file.

## How to query

Check the graph exists, then query it:

```bash
graphify query "<question>"
```

If the `graphify` CLI is not on PATH, use the interpreter pinned during the last build and fall back to
an inline read of the JSON:

```bash
$(cat graphify-out/.graphify_python) -c "
from pathlib import Path
if not Path('graphify-out/graph.json').exists():
    print('ERROR: no graph found — fall back to normal file search for this task.')
"
```

Answer only from what the graph returns (nodes, edges, `source_location`), and quote `source_location`
when citing a specific fact. If the graph has no relevant vocabulary for the question, say so and fall
back to normal `grep_search`/`semantic_search` — do not stall waiting on the graph.

## Keeping it fresh

The graph is a snapshot. After a batch of code/doc changes lands (e.g. after an Orchestrator pipeline
run completes, or before a new feature's discovery phase), rebuild the changed subset instead of a full
rerun:

```bash
graphify <path> --update
```

If `graphify-out/graph.json` is missing entirely or clearly stale (references files/paths that no longer
exist), fall back to normal exploration tools for that task rather than blocking on a rebuild.

## Why this matters for multi-agent pipelines

Each pipeline agent (`Orchestrator`, `PM`, `Architect`, `Vue.js Dev`, `QA`, `SRE DevOps`, `Release
Manager`) already runs with **Context Isolation** — it does not inherit prior agents' conversation and
must re-derive context from the file system. Without the graph, that means every agent re-reads the same
files from scratch. Querying `graphify-out/graph.json` for the specific relationship or file-location
needed turns that into a targeted lookup instead of a full re-scan, which is the main token cost in
sequential/parallel agent handoffs.
