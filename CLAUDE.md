# CLAUDE.md

Guidelines for Claude Code when working in this repository.

---

## Code Style

**Control flow body on its own line.**
Always put the body of `if`, `for`, and `while` on a separate line from the condition.
Never inline the body, even for single statements:

```js
// correct
if (condition)
    statement;

if (condition) {
    block;
}

// wrong — never do this
if (condition) statement;
```

This makes it easy to set a breakpoint on the body when debugging.

**User context**
The user is a software engineer with strong knowledge of C++ but
only moderate knowledge of the ecosystem of JavaScript, HTML and webapps
in general. The user prefers WebStorm IDE for development and GitHub Pages
fot deployment.

**No added comments or docstrings** on code you didn't change.
Only add comments where the logic isn't self-evident.

**Delete dead code outright.**
Don't leave unused variables, functions, or imports behind.
Don't add backwards-compatibility shims or `// removed` comments.

**No defensive coding for impossible cases.**
Don't add error handling or fallbacks for scenarios that can't happen given the
internal invariants. Trust framework and internal guarantees.
Only validate at real system boundaries (user input, external APIs).

---

## JavaScript Conventions

**ES modules throughout** (`import`/`export`). No build step; code runs directly
in the browser or in Node.js (`"type": "module"` in package.json).

---

## Testing

Tests live in `*.test.js` using Node's built-in `node:test` runner.
No packages to install;.

- Write thorough tests for pure functions (anchors, midpoints, edge cases,
  known outputs).
- Write sanity checks for stochastic or hard-to-verify functions
  (value ranges, determinism, monotonicity).
- Verify round-trips where applicable (encode → decode recovers the original).

---

## Markdown

Hard-wrap prose at sentence and clause boundaries (~80–100 chars per line).
This keeps editor sync-scroll aligned between raw and rendered views.
Leave code blocks, SQL, table rows, and HTML on single lines — they must not wrap.

---

## Git Commits

Do not add `Co-Authored-By: Claude` or similar attribution lines to commit messages.

---

## Working Style

**Read before suggesting.**
Don't propose changes to code you haven't read.
Understand existing code before modifying it.

**Minimal scope.**
A bug fix doesn't need surrounding cleanup.
A simple feature doesn't need extra configurability.
Match the scope of changes to what was actually requested.

**Lead with the action.**
Keep responses short and direct.
Don't summarize what was just done at the end of a response unless multiple edits were involved.

**Flag dead code.**
When something appears unused, say so and offer to remove it rather than leaving it.
