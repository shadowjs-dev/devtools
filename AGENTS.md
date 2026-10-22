# AGENTS.md: working on devtools

This file is for anyone who changes this repository, people and coding agents alike. It says how the repository is laid out, how to implement
and test a change, and how a pull request is reviewed. To **use** the released package, read [README.md](README.md) and [SKILL.md](SKILL.md)
instead; to take part in the project, read [CONTRIBUTING.md](CONTRIBUTING.md).

Browser inspection of signals, owners and hydration.

## What is in this repository

| Package | Folder | What it is | Documentation |
| --- | --- | --- | --- |
| `@shadow-js/devtools` | `.` | A development panel that shows the components, signals, effects and updates of a running app | https://devtools.shadowjs.net |

The repository is the package: `@shadow-js/devtools`. Source and issues:
https://github.com/shadowjs-dev/devtools. Every package of the project has the same version number.

## Set up

You need Node.js 22.12 or newer and npm (pnpm and Yarn are not used).

```sh
npm install
npm run check   # lint, build, type check and every test
```

## Commands

| Command | What it does |
| --- | --- |
| `npm run lint` | Biome: lint and format check (`npx biome check --write <path>` fixes what it can) |
| `npm run build` | builds the package with tsdown |
| `npm run typecheck` | TypeScript 7 in strict mode, tests included |
| `npm test` | unit, DOM and server tests (Vitest) |
| `npx vitest run <path>` | one test file |
| `npm run test:gc` | memory and leak tests |
| `npm run test:perf` | wall-clock budgets; run alone, never in parallel with other work |
| `npm run check` | all of the above; a change is ready when it passes |

## Layout

- `.github/`: workflows, issue and pull request templates, code owners.
- `build/`: the shared tsdown preset every package build uses.
- `extension/`: the browser extension of the devtools.
- `scripts/`: build and release scripts; `release.mjs` is run by the workflows.
- `src/`: the source of the package; one folder per concern, `index.ts` re-exports the public API. Folders: `ui/`.
- `test/`: the tests; one file per behavior, each test named by an invariant id such as `[ROUTER-12]`.
- `test-types/`: type-level tests: what the package promises to the compiler of its users.
- `types/`: ambient declarations shared with the build.
- `CHANGELOG.md`: what each release changed.
- `biome.json`: lint and format rules.
- `package.json`: the manifest; `version` is changed only by a release.
- `tsconfig.json`: type check of the source.
- `tsconfig.test-types.json`: type check of `test-types/`.
- `tsdown.config.mjs`: the build.
- `vitest.config.ts`: the test projects (unit, DOM, server, gc, perf).
- `vitest.setup.ts`: test setup: an unasserted `console.warn` or `console.error` fails a test.

## How to implement a change

1. **Find where the behavior lives.** Search `test/` and `src/` for the name of the behavior or its invariant id, then read the source the tests exercise. The invariants below say what must stay true.
2. **Write the failing test first.** A bug fix reproduces the bug; a feature states the behavior it promises. Name the test with an invariant id in square brackets, the way the neighboring tests do, then the behavior in words. The test asserts what the code does and is never skipped, marked as todo or marked as an expected failure.
3. **Make it pass with the smallest change** that keeps the invariants. Match the code around it.
4. **Keep the surface honest.** A public symbol has TSDoc (summary, parameters, return value, an example and `@since`). An error says what happened and how to fix it. User-visible behavior gets a documentation update and a line under `## Unreleased` in CHANGELOG.md.
5. **Run `npm run check`** and read its output; do not report a change as done without it passing.

### Rules every change keeps

- No `any`, `@ts-ignore` or non-null assertion. Use `unknown` and narrow.
- Compare indices, lengths and counts explicitly (`=== undefined`, `=== -1`, `> 0`), never by truthiness.
- No empty `catch`: every catch rethrows, passes the error to the owner's handler, or reports it. Every "set the current X" register is restored in `finally`.
- User callbacks run untracked unless the API says otherwise. No stack parsing, no `fn.name` sniffing, no flags stamped on user functions.
- Traversals whose depth the user controls are iterative. Caches, queues and recursion are bounded, and a test hits the bound.
- Code meant for development only sits behind `__DEV__`. No import-time side effects and no module-level mutable state beyond the registers the core owns (bounded caches and `WeakMap`s excepted).
- No sleeps in tests (flush the scheduler); a `console.warn` or `console.error` that a test does not assert fails the test. Property tests use `fast-check` with a fixed seed.
- Files are kebab-case, tests are `*.test.ts`, internals live in `src/internal/`. American English in code, comments and documentation. Comments explain why, not what.
- The reactive core and the DOM renderer have no runtime dependencies.

## Pull requests

1. **Open an issue first** for anything that adds or changes public API, behavior, supported platforms or dependencies. A small fix needs no issue.
2. **Fork, then branch from `main`** (`fix/<topic>`, `feat/<topic>`, `docs/<topic>`). One concern per pull request.
3. **Commit in small steps** with a message that says what changed and why: a short type prefix (`fix:`, `feat:`, `docs:`, `test:`, `chore:`), then the subject. Commit under your own identity; do not add trailers or notes about tools.
4. **Open the pull request against `main`** and fill in the template: what changes, why, and the checks you ran. The CI workflow (`.github/workflows/ci.yml`) runs lint, build, type check and all tests; it must be green.
5. **Review.** A maintainer (see `.github/CODEOWNERS`) reviews every pull request. Expect questions about the test, the public surface and the error messages. Push fixes to the same branch; the pull request is squash-merged.
6. **Releases are not part of a pull request.** Do not change `version`, `.github/workflows/release.yml` or `scripts/release.mjs`, and do not create tags or publish. A maintainer releases by renaming `## Unreleased` in the changelog to the version and pushing a version that is not yet on npm to `main`; the workflow publishes it with provenance.

Security problems never go in a public issue or pull request: follow [SECURITY.md](SECURITY.md).

## Architecture and invariants

What each package keeps true. A change that breaks one of these is a bug in the change.

Package rules:
- Everything is dev-only. `installHook()` and `mountDevtools()` start with `if (!__DEV__) return`;
  a test (`production.dom.test.ts`) bundles with `__DEV__ = false` and fails if the UI, the hook
  name or any import survives. No module has import-time side effects.
- The protocol (`src/protocol.ts`) is the contract with the runtime. Event kinds are numbers and
  their positional arguments are documented in one table; changing the meaning of an argument means
  bumping `PROTOCOL_VERSION`. Adding a kind does not.
- The runtime reports its own objects (positional, no allocation). Only `agent.ts` turns them into
  id-based `WireEvent`s, through WeakMaps and WeakRefs: the agent must never keep application
  objects alive (`agent.gc.test.ts`, `runtime.gc.test.ts`). Leaf nodes (signals, stores, resources)
  are registered with the agent's finalizer once per object (`registerLeaf`); owners and computations
  are not, because an unreachable owner can still own live signals. A store's handle is anchored to its
  root in core (dev only), so it lives exactly as long as the store.
- The extension (`extension/`) is a development tool built as classic scripts, for Chromium and Firefox from the
  same bundles (`extension/src/manifest.ts` generates both manifests; `extensionApi` picks `browser` or `chrome`).
  Its manifests ask for no permissions (Firefox lists the loopback hosts as host permissions) and match only the loopback hosts; its build fails on `eval`, `new Function`, string
  timers and `document.write` (`build.mjs`). Every message that crosses the bridge or the relay is checked
  (`isAgentMessage`, `isPanelMessage`), and the panel checks the `inspect` answer (`parseInspectResult`).
- Inspection sources are read on request and bounded: at most `MAX_INSPECTIONS` (16) per hook, and
  `sanitizeRows` cuts a source to `MAX_INSPECTION_ROWS` (500) rows of text fields of 200 characters.
- Recording is O(1) per event and every buffer is bounded (`RingBuffer`, graveyard, `maxNodes`,
  pending queue, replay buffer, flash boxes, component cache). Each bound has a test that hits it.
- `model.ts` and `inspector.ts` are pure folds/queries over `WireEvent`s: no DOM, no timers, no
  core imports. Their tests feed synthetic streams (`test/support/stream.ts`).
- The panel (`src/ui/*.tsx`, `mount.tsx`) is written with ShadowJS and tested as compiled by the repo
  compiler (`test/support/ui-loader.ts`). It talks only to a `Backend`, so the same panel serves the
  local overlay and a remote (extension) panel. Everything the panel creates is created inside
  `agent.quiet()` so the tools never inspect themselves.
- The panel binds events natively (`on:click`, `on:input`): delegated events do not cross a shadow
  root reliably.
- Tests build a REAL graph with the public `@shadow-js/core/extend` API through
  `test/support/instrument.ts` (the stand-in for the runtime patch) and compare the agent's model
  with the engine's own `sources` / `observers`.
- The Timeline tab (`extension/src/timeline/`, `extension/src/panel/timeline-view.tsx`) is passive until the user
  records. `createEventTap` wraps the panel's transport and hands event batches to a listener only while one is
  attached; `TimelineRecorder` keeps entries in a `RingBuffer` and does nothing when it is off. A recording file is
  untrusted input: `parseRecording` checks the size first and rebuilds every object from known fields.

## Where to look next

- [README.md](README.md): what the package does and every option.
- [SKILL.md](SKILL.md): how to use the released package (install, import paths, a quick start).
- [CONTRIBUTING.md](CONTRIBUTING.md): the short guide to taking part.
- [CHANGELOG.md](CHANGELOG.md): what each release changed.
- [ShadowJS hub](https://github.com/shadowjs-dev/shadow): every repository of the project.
