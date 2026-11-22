# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`destroyer` — macOS-only disk cleaner for mobile dev (Flutter / iOS / Android). Bare `destroyer` = scan → one screen ("ล้างได้เลย" = tier A, one Enter; tier B/C = yes/no questions, default keep) → delete. `destroyer --pick` = the older tick-each-item picker → plan → type `DESTROY`. Runtime is **bun** (TypeScript run directly, no build step, no dependencies, no `bun install`). User-facing strings and most comments are Thai; keep that style when touching UI text.

## Commands

```bash
bun test                                         # all tests (28)
bun test test/exec.test.ts                       # one file
bun test test/exec.test.ts -t "PRESET LOCK"      # one test by name
bun run scan                                     # = bun run src/cli.ts scan (read-only)
bun run src/cli.ts apply --dry-run               # show plan, delete nothing
bun run src/cli.ts show <id> | preset | watch status
```

No lint/build/typecheck scripts exist. `--fresh` bypasses the `du` size cache; `--plain` disables color/animation.

**Never test deletion against the real machine.** Use a fake home: `HOME=$(mktemp -d) bun run src/cli.ts ...`. Env overrides: `DESTROYER_CONFIG`, `DESTROYER_LOG_DIR`, `XDG_CACHE_HOME`. Unit tests inject `{ home, preset }` into `applyTarget` instead of touching `$HOME`.

A fake `HOME` does **not** isolate everything: owner checks (`pgrep`/`pkill`) see real processes, so a fake `.gradle` target can stop your real Gradle daemon; `xcode:sim-syscache` points at the absolute `/Library/Developer/CoreSimulator/Caches`; and `apply` copies printed sudo commands to the real clipboard (`pbcopy`, interactive only). For end-to-end runs in a pty use only owner-less targets (`projects:*:.dart_tool`, `ai:hf:*`) and set `ANDROID_HOME` to a nonexistent path.

## Architecture

Data flow: `cli.ts` → `core.scan()` (modules emit `Target`s) → `home.ts` (home screen over `plan.classify()`) or `tui.pick` (`--pick`) → `apply.ts` (plan → gates → confirm → run) → `exec.ts` (only place that deletes) → JSONL log.

**The preset lock is the central invariant.** `config/preset.toml` is part of the code (no user config can widen it). It is enforced in *three* independent places — keep all three when refactoring:
1. `core.scan()` drops any target whose id doesn't match `inPreset()` (never shown).
2. `apply.applyFlow()` re-filters the plan with `inPreset()`.
3. `exec.applyTarget()` refuses non-preset ids — last line of defence, regardless of caller.

Preset globs are `module:name` with `*` wildcards; `loadPreset` rejects bare `*` and `module:*`. Adding a cleanable thing = add id to `preset.toml`; if no scanner produces that id yet, add/extend a module in `src/modules/`.

**Modules (`src/modules/*.ts`)** are auto-loaded from the directory (`core.load`), built-in only. Each default-exports a `Mod` (`detect?`, `scan?`, `annotate?`). Modules return **data only** (`Target` with `tier`, `action`, `owners`, `regen`) and never delete. A throwing module is marked skipped without breaking others. Scanners run in parallel; `annotate` runs after, sequentially, adding notes to targets.

**`Target.action`** is one of: `rm` (`keepDir` = empty folder but keep it), `exec` (argv, no shell), `sudo` (command is *printed*, never run). `validateTarget` checks every target at scan time; `exec.ts` re-checks at delete time.

**Safety layers in `exec.ts`/`core.ts`** (changing any needs matching tests in `test/exec.test.ts`/`core.test.ts`):
- `checkPath`: absolute, no `..`, inside `$HOME`, not in `INSIDE_DENY` (e.g. `.ssh`, `Documents`) or equal to `EQUAL_DENY` (e.g. `~/Library`, `~/.gradle` itself). Sole exception: `/Library/Developer/CoreSimulator/*`.
- `removePath`: re-runs `checkPath`, refuses symlink targets, re-checks `realpath`; symlinks *inside* a target are unlinked, never followed.
- `javaEnv`: `sdkmanager`/`avdmanager` need a JDK; when `JAVA_HOME` is unset/stale the child gets Android Studio's bundled JBR (failed 3 targets on 2026-11-21 without it).
- `checkExec`: argv allowlist of exactly 4 shapes (`xcrun simctl delete`, `xcrun simctl runtime delete`, `avdmanager delete avd -n`, `sdkmanager --uninstall`). `core.ts` gets it via `setExecCheck` to avoid an import cycle.
- Owner gate: `OWNER` map in `exec.ts` maps owner name → `pgrep -f` pattern; targets whose `owners` are running are skipped. Only Gradle daemon / Dart analysis server are `stop`pable — the home flow stops them automatically (`stop: true`), `apply` needs `--stop-daemons`.

**Tiers:** A = regenerates itself, B = re-download/data in emulator, C = user decides. Any tier C in the plan forces typing `DESTROY`; `--yes` is only valid for plans without tier C. Tier D (never touch) cannot be declared (`validateTarget` rejects it).

**Home screen (`plan.ts` + `home.ts`):** `classify()` is pure (process checks injected) and sorts targets into `auto` (tier A), `sudo` (printed), `skip` (owner app running), `stops`, and `ask` (tier B/C grouped by `questionKey` — one yes/no per kind, default keep). `homeScreen` returns the ids to apply (auto + sudo + skip + "yes" answers); `cli.ts` then calls `applyFlow(..., { yes: true, stop: true, quiet: true })`, so the existing `hasC` rule still forces `DESTROY` whenever a tier C answer was "yes". The Enter button must only ever count tier A + yes-answers, and `watch`'s notification quotes the same number (tier A, no sudo).

**UI split:** `ui.ts` (colors, `Live`, spinner; `live` = TTY check), `view.ts` (target tables, disk, summaries), `home.ts` (home screen), `tui.ts` (`--pick` picker + run screen; exports `enter/leave/frame` for `home.ts`). The run screen shows elapsed time, not a %, because `rm` reports no progress. `apply.ts` falls back to `runPlain` when not a TTY. `watch.ts` is a launchd notifier (`com.stars.destroyer.watch`) that only measures free space and notifies; it must never delete.

**Size cache:** `du` results cached 10 min in `~/.cache/destroyer/du.json` (`~/.dartServer` alone is ~315k files); `clearCache()` runs after a successful apply.

## Conventions

- Commits follow `feat(destroyer): ...` / `feat(destroyer)!: ...` style (see `git log`).
- Code is deliberately dense/minimal; `ponytail:` comments mark intentional shortcuts.
- Any new behavior that deletes or widens scope needs a test that runs on a temp dir (`mkdtempSync`), never real paths.
