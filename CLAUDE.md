# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

Picnic Desktop (Unofficial) — cross-platform (Windows + macOS) desktop clone of the Picnic iOS photo-sorting app. See `PLAN.md` for the full design.

## Workflow

- **After completing a set of changes, always commit them.** Write a clear, conventional commit message describing what changed and why.
- **After committing, push if a git remote exists.** Check with `git remote -v`; if no remote is configured, skip the push silently — do not create a remote.
- Group related edits into a single commit rather than committing every file separately.
