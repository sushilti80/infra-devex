---
name: repository-context
description: Read .ai/ai-repo.md first for repository structure and ownership, then use Graphify only for relationship questions, targeted search for unresolved names, and exact-file reads before edits. Use for repository discovery, onboarding, current-state mapping, and agent handoffs.
---

# Repository Context

Use the cheapest trustworthy source that can answer the question.

## Discovery order

1. **Read `.ai/ai-repo.md` first.**
   - Use it for repository structure, agent/skill/workflow inventory, key entry points, package scripts, data catalogs, and external repository references.
   - Do not re-enumerate directories that the map already answers.
2. **Use Graphify for relationship questions only.**
   - Examples: "what calls X?", "how does Y flow?", "what depends on Z?"
   - Read `.github/skills/graphify-context/SKILL.md` before querying.
   - If `graphify-out/graph.json` is unavailable or stale, fall back to targeted search.
3. **Use targeted search for unresolved names or paths.**
   - Search for the specific symbol, route, component, workflow, or phrase needed.
4. **Read the exact authoritative file before editing or making a file-specific claim.**
   - The map, Graphify, and search results narrow the target; they do not replace the current file.
5. **Use broad enumeration only as a last resort.**
   - Bound it to the smallest relevant subtree.

## Boundaries

- This skill grants no mutation or external-action authority.
- Repository evidence overrides this map if they disagree.
- `.ai/ai-repo.md` is generated orientation data, not repository policy.
- Repository-wide invariants remain in `.github/copilot-instructions.md`.
- Task procedure remains in the owning skill; role authority remains in the owning agent.

## Freshness

Check:

```bash
node scripts/generate-ai-repo.mjs --check
```

Regenerate after structure changes:

```bash
node scripts/generate-ai-repo.mjs
```
