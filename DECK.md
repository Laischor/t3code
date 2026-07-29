# Deck

A fork of T3 Code that replaces the chat window with a splittable grid of
**terminal** and **browser** panes.

```
┌──────────────┬──────────────────────────────┐
│ T3 Sidebar   │  + Terminal  + Browser       │
│ Projects     ├────────────┬─────────────────┤
│              │ Terminal   │ Browser         │
│              ├────────────┤                 │
│              │ Terminal   │                 │
└──────────────┴────────────┴─────────────────┘
```

Upstream's own `README.md` still applies for everything else — this file only
covers what the fork changes.

## What Deck adds

Deck is a layout change hosted by T3's Electron app. It adds no runtime of its
own; both pane kinds are T3's existing surfaces.

| Piece              | Where it comes from                                                                     |
| ------------------ | --------------------------------------------------------------------------------------- |
| Desktop host       | `apps/desktop` (Electron)                                                               |
| Terminals          | `apps/server/src/terminal/*` over T3's environment-scoped RPC — local, SSH, WSL, cloud  |
| Terminal rendering | `@xterm/xterm` + `@xterm/addon-fit`                                                     |
| Browser panes      | `apps/desktop/src/preview/` + `apps/web/src/components/preview/` (Electron `<webview>`) |
| Pane layout        | Deck — a split tree in `apps/web/src/deck/`                                             |

Browser panes require the desktop app; T3 gates them on
`isPreviewSupportedInRuntime()`. Terminals work in desktop and web.

## Files the fork owns

| Path                                           | Purpose                                                                     |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| `apps/web/src/deck/paneTree.ts`                | Pure split-tree model (n-ary splits, sizes, normalization)                  |
| `apps/web/src/deck/deckStore.ts`               | Per-thread layout, persisted like `terminalUiStateStore`                    |
| `apps/web/src/deck/DeckPaneGrid.tsx`           | Nested CSS grids with draggable dividers                                    |
| `apps/web/src/deck/DeckWorkspace.tsx`          | Toolbar, pane bootstrap, terminal/browser leaves                            |
| `apps/web/src/deck/DeckDevToolsPane.tsx`       | DevTools pinned inside a browser pane                                       |
| `apps/web/src/deck/deckMode.ts`                | Pane mode toggle (`?deck=0` restores upstream chat)                         |
| `apps/web/src/components/TerminalViewport.tsx` | Extracted from `ThreadTerminalDrawer` so drawer and grid share one terminal |

## Changes to upstream files

Kept deliberately small so rebases stay cheap:

- `apps/web/src/components/ThreadTerminalDrawer.tsx` — `TerminalViewport` moved
  out into its own module; the drawer imports it.
- `apps/web/src/routes/_chat.$environmentId.$threadId.tsx`,
  `_chat.draft.$draftId.tsx` — render `DeckWorkspace` instead of `ChatView`.
- `apps/desktop/src/preview/Manager.ts`, `ipc/`, `preload.ts`,
  `packages/contracts/src/ipc.ts` — `openDevToolsInHost` / `closeDevTools`, so
  DevTools can render into a pane-local `<webview>` instead of a detached
  window.
- `apps/web/vite.config.ts` — `T3CODE_WEB_REACT_COMPILER=0` skips the React
  Compiler babel pass, which OOMs on memory-constrained hosts.

## Run

```bash
pnpm install
pnpm dev:desktop
```

## DevTools in browser panes

The `</>` button in a browser pane header docks DevTools at the bottom of that
pane. Electron's docking modes would dock into the whole window, so the guest
renders its DevTools into a second `<webview>` via `setDevToolsWebContents`.

While DevTools are open the automation control session is detached — the agent
cannot drive that tab until they are closed again. That is why it is a toggle
and off by default.
