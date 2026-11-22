# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`hellbringer` (renamed from `destroyer` 2026-11) — macOS-only toolbox for mobile dev (Flutter / iOS / Android): the cleaner (tool name **DESTROYER**), `fever`, `siren`. Bare `hellbringer` = hub menu (`hub.ts`: DESTROYER / FEVER / SIREN; cursor starts on DESTROYER) and `hellbringer destroyer` = the cleaner directly: scan → one screen ("ล้างได้เลย" = tier A, one Enter; tier B/C = yes/no questions, default keep) → delete. `hellbringer --pick` = the older tick-each-item picker → plan → type `DESTROY`. Runtime is **bun** (TypeScript run directly, no build step, no dependencies, no `bun install`). User-facing strings and most comments are Thai; keep that style when touching UI text.

**Naming:** user-facing text says `hellbringer`; the old `destroyer` command still works as an alias (`package.json` bin + `~/.local/bin/destroyer` symlink). On-disk names deliberately stay `destroyer` so existing data and the installed watch keep working: `~/.config/destroyer`, `~/.cache/destroyer`, `~/Library/Logs/destroyer`, launchd label `com.stars.destroyer.watch`, `DESTROYER_*` env vars, the repo folder and git remote. Do not "finish the rename" there without a migration.

## Commands

```bash
bun test                                         # all tests (49)
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

**Hub (`hub.ts`):** `cli.ts` shows it only for bare `hellbringer` in a TTY, after the scan (the cleaner's status line needs `classify()`), and on Enter runs the chosen tool's default command (`runFever` / `runSiren status`) or falls through to `homeScreen`. `hubItems`/`hubView` are pure and tested. Do not probe devices there: siren's status is static because `adb devices` starts the adb daemon.

**UI split:** `ui.ts` (colors, `Live`, spinner; `live` = TTY check), `view.ts` (target tables, disk, summaries), `home.ts` (home screen), `tui.ts` (`--pick` picker + run screen; exports `enter/leave/frame` for `home.ts`). The run screen shows elapsed time, not a %, because `rm` reports no progress. `apply.ts` falls back to `runPlain` when not a TTY. `watch.ts` is a launchd notifier (`com.stars.destroyer.watch`) that only measures free space and notifies; it must never delete.

**Extra tools (`src/tools/`)** — `fever.ts` (read-only machine check-up) and `siren.ts` (test push / deep link into booted simulators/emulators). Neither deletes anything, so neither goes through the preset lock. Shape to copy for a new tool: pure parsers/validators exported and unit-tested with real command output as fixtures; the raw commands injected (`Sh` / `Io`) so tests never touch a device; argv arrays only, never a shell. `siren` hard rules: targets come only from `simctl … booted` and `adb` serials matching `emulator-N` (a real phone is never listed), Android push is not supported (needs FCM), the single string that reaches a device shell has its url single-quoted after `URL_OK` validation, and it reads `DESTROYER_CONFIG` at call time. Both are wired in `cli.ts` as `hellbringer fever` / `hellbringer siren`.

**Size cache:** `du` results cached 10 min in `~/.cache/destroyer/du.json` (`~/.dartServer` alone is ~315k files); `clearCache()` runs after a successful apply.

## Conventions

- Commits follow `feat(hellbringer): ...` / `feat(hellbringer)!: ...` (older history says `destroyer`) style (see `git log`).
- Code is deliberately dense/minimal; `ponytail:` comments mark intentional shortcuts.
- Any new behavior that deletes or widens scope needs a test that runs on a temp dir (`mkdtempSync`), never real paths.
