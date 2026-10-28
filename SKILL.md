---
name: shadowjs-devtools
description: "Work with @shadow-js/devtools. A development panel that shows the components, signals, effects and updates of a running app. Use when a project imports it, or when asked to add, configure or debug it."
---

# @shadow-js/devtools

Version 1.0.1. A development panel that shows the components, signals, effects and updates of a running app.

## Where to read more

- @shadow-js/devtools: https://devtools.shadowjs.net
- Source and issues: https://github.com/shadowjs-dev/devtools
- The package README is the full reference for options and behavior; read it before changing a configuration.

## Install

```sh
npm install -D @shadow-js/devtools @shadow-js/core @shadow-js/web
```

## Peer dependencies

| Package | Range | Required |
| --- | --- | --- |
| `@shadow-js/core` | `^1.0.1` | yes |
| `@shadow-js/web` | `^1.0.1` | yes |

## Import paths

Import only from these paths. Never from `dist` or `src`: files that are not listed here are private and change without notice.

- `@shadow-js/devtools`

## Quick start

```tsx
/// <reference types="vite/client" />
import { useSignal } from "@shadow-js/core";
import { mountDevtools } from "@shadow-js/devtools";
import { render } from "@shadow-js/web";

function Counter() {
  const [count, setCount] = useSignal(0);
  return <button on:click={() => setCount(count() + 1)}>Count: {count()}</button>;
}

// Dev only. Mount the panel before the app renders, so no event is missed.
if (import.meta.env.DEV) mountDevtools({ open: true });

render(() => <Counter />, document.body);
```

## Working rules

- Run `npm run check` before proposing a change; it lints, builds, type-checks and tests.
- Keep a public change documented: TSDoc on every exported symbol, and a CHANGELOG entry.
- To change this repository rather than use the package, read AGENTS.md: the layout, the commands, the rules and how a pull request is reviewed.
