# Deck

A fork of T3 Code that replaces the chat window with a splittable grid of
**terminal** and **browser** panes.

```
┌──────────────┬────────────────────────────────────┐
│ Projects     │  + Terminal  + Browser   ⊞ ⊟       │
│  ▾ terminal  ├─────────────────────┬──────────────┤
│    Window 1  │ Term 1 │ Term 2 │ ✕ │ Browser  │ ✕ │
│    Window 2  ├─────────────────────┼──────────────┤
│  ▾ yuki      │                     │              │
│    Window 1  │      terminal       │   webview    │
│              │                     ├──────────────┤
│              │                     │  DevTools    │
└──────────────┴─────────────────────┴──────────────┘
```

Three levels: a **window** per project, a **grid of panes** per window, and a
**stack of tabs** per pane.

Upstream's own `README.md` still applies for everything else — this file only
covers what the fork changes.

## What Deck adds

Deck is a layout change hosted by T3's Electron app. It adds no runtime of its
own; both tab kinds are T3's existing surfaces.

| Piece              | Where it comes from                                                                     |
| ------------------ | --------------------------------------------------------------------------------------- |
| Desktop host       | `apps/desktop` (Electron)                                                               |
| Terminals          | `apps/server/src/terminal/*` over T3's environment-scoped RPC — local, SSH, WSL, cloud  |
| Terminal rendering | `@xterm/xterm` + `@xterm/addon-fit`                                                     |
| Browser tabs       | `apps/desktop/src/preview/` + `apps/web/src/components/preview/` (Electron `<webview>`) |
| Layout             | Deck — windows, a split tree, and tabs, in `apps/web/src/deck/`                         |

Browser tabs require the desktop app; T3 gates them on
`isPreviewSupportedInRuntime()`. Terminals work in desktop and web.

### Windows

A window is identified by a **thread id**, because everything a window needs is
already scoped that way: `deckStore` keys layouts by thread, the server's
terminal manager keys sessions and history by `threadId\0terminalId`, and
preview sessions open per thread. Nothing registers that id as a chat thread —
the terminal manager treats it as an opaque key — so a window never shows up in
T3's inbox.

Windows get their own route. Reusing the thread route would not work:
`resolveThreadRouteRenderState` reports an id it does not know as missing and
sends you back to the index.

### Tabs

A pane is a stack of tabs and the kind lives on the tab, so one pane can hold
terminals and browsers together. Closing the last tab closes the pane and the
surrounding split collapses; the window then offers ⌘T instead of a grid, and
the next tab rebuilds the root pane.

Closing a tab also closes the session behind it — the PTY with its history, or
the preview tab — and closing a window closes every session of its thread.
`term-N` ids are handed out from the ids in use, so a leaked session would be
reattached by the next tab under the same id: old output back on screen, and an
`exit`ed session reattaching exited, which the viewport reads as another exit
and closes the new tab as it opens. "In use" counts the thread's server-side
sessions as well as the deck's tabs, because upstream's drawer and mobile create
terminals under the same thread — a tab given an id they already hold would
attach to their PTY and kill it on close, leaving them writing to a session the
server no longer has. Seeding a window's first pane therefore waits for the
terminal metadata query; until it answers the window shows "Opening terminal…"
rather than allocating `term-1` blind. A failed query counts as answered — an
empty window is worse than a risked id.

Reusing an id is safe on the server and still not safe in the client: the attach
atom outlives its subscribers by a five-minute idle TTL, so a session closed in
between leaves a cached state — status `closed`, the old scrollback, no attach
call on the next mount. `TerminalViewport` therefore refreshes the atom when it
mounts, which reopens the session instead of showing a prompt from a shell that
no longer exists and failing every keystroke.

Inactive tabs stay mounted. Unmounting a terminal drops its scrollback and xterm
state, and unmounting a `<webview>` tears the page down entirely. They are
hidden with `invisible` rather than `hidden` so panes keep their measured size
and terminals do not refit on every switch.

Browser tabs need more than CSS: an Electron `<webview>` composites in its own
layer, so `visibility: hidden` on an ancestor leaves it painted on top. T3 parks
inactive surfaces at `HIDDEN_BROWSER_WEBVIEW_OFFSET` instead, driven by
`PreviewPanel`'s `visible` prop.

## Files the fork owns

| Path                                                          | Purpose                                                                                 |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `apps/web/src/deck/paneTree.ts`                               | Pure split-tree and tab model (n-ary splits, sizes, normalization)                      |
| `apps/web/src/deck/deckStore.ts`                              | Per-thread layout, persisted like `terminalUiStateStore`                                |
| `apps/web/src/deck/deckWindowStore.ts`                        | Windows per project: create, rename, close, reorder                                     |
| `apps/web/src/deck/DeckSidebar.tsx`                           | Projects and their windows                                                              |
| `apps/web/src/deck/DeckPaneGrid.tsx`                          | Nested CSS grids with draggable dividers                                                |
| `apps/web/src/deck/DeckWorkspace.tsx`                         | Toolbar, pane bootstrap, tab strips, terminal and browser tabs                          |
| `apps/web/src/deck/DeckDevToolsSlot.tsx`                      | Keeps the docked DevTools view aligned with its slot                                    |
| `apps/web/src/deck/DeckPalette.tsx`                           | ⌘K palette over windows and creation actions                                            |
| `apps/web/src/deck/deckShortcuts.ts`                          | Keyboard mapping, matched in the capture phase                                          |
| `apps/web/src/deck/deckTabSessions.ts`                        | Which server session a closing tab has to take down                                     |
| `apps/web/src/deck/deckMode.ts`                               | Pane mode toggle (`?deck=0` restores upstream chat)                                     |
| `apps/desktop/src/preview/deckForwardedShortcuts.ts`          | Keys a browser pane hands back to the window, beyond upstream's own                     |
| `apps/web/src/routes/_chat.deck.$environmentId.$windowId.tsx` | The window route                                                                        |
| `apps/web/src/components/TerminalViewport.tsx`                | Extracted from `ThreadTerminalDrawer` so drawer and grid share one terminal             |
| `apps/web/src/components/terminalBufferSync.ts`               | Append or reset, decided from the buffer's stream offset and reset epoch                |
| `apps/web/src/sql/SqlPanel.tsx`                               | SQL pane: connection picker, editor, object tree, results grid                          |
| `apps/web/src/sql/SqlEditor.tsx`                              | CodeMirror 6 SQL editor, schema-aware completion, vim toggle, ⌘⏎ run                    |
| `apps/web/src/sql/SqlObjectTree.tsx`                          | Lazy schema → object type → object → columns browser                                    |
| `apps/web/src/sql/SqlResultsGrid.tsx`                         | Virtualized result grid; double-click edits cells where a row identity exists           |
| `apps/web/src/sql/sqlGridEdit.ts`                             | Pure edit rules: editability, per-row UPDATE payloads, cell parsing                     |
| `apps/web/src/sql/SqlConnectionsDialog.tsx`                   | Per-project connections CRUD, test, per-window visibility checkboxes                    |
| `apps/web/src/sql/sqlPaneStore.ts`                            | Persisted pane state: per-tab connection + SQL, vim toggle, window allowlist            |
| `apps/server/src/sql/SqlIdeService.ts`                        | SQL sessions per window tab: open/execute/cancel, tree, identity, row edits             |
| `apps/server/src/sql/postgresDriver.ts`                       | porsager `postgres` driver + pg_catalog metadata queries                                |
| `apps/server/src/sql/sqliteDriver.ts`                         | `node:sqlite` driver + sqlite_master/pragma metadata                                    |
| `apps/server/src/sql/SqlCredentialStore.ts`                   | Passwords: macOS `security` / Linux `secret-tool`, file-store fallback                  |
| `apps/server/src/sql/SqlConnectionStore.ts`                   | Connection configs (no secrets) in `state.sqlite` per project                           |
| `apps/server/src/sql/pgpass.ts`                               | `.pgpass` parser and lookup, used before prompting                                      |
| `apps/server/src/sql/sqlText.ts`                              | Statement splitter (strings/comments/dollar quotes), identifier quoting, UPDATE builder |

## Changes to upstream files

Kept deliberately small so rebases stay cheap:

- `apps/web/src/components/ThreadTerminalDrawer.tsx` — `TerminalViewport` moved
  out into its own module; the drawer imports it.
- `apps/web/src/routes/_chat.$environmentId.$threadId.tsx`,
  `_chat.draft.$draftId.tsx`, `_chat.index.tsx` — render `DeckWorkspace`, and
  land on a window instead of a draft.
- `apps/web/src/components/AppSidebarLayout.tsx` — picks `DeckSidebar` in deck
  mode. It already chose between two sidebars; this adds a third rather than
  branching inside T3's, which render an inbox (snooze and settle shelves,
  rename, change-request state) that does not apply to a window.
- `apps/desktop/src/preview/Manager.ts`, `ipc/`, `preload.ts`,
  `packages/contracts/src/ipc.ts` — `openDevToolsDocked`, `setDevToolsBounds`
  and `closeDevTools`; `forwardShortcut` also asks
  `deckForwardedShortcuts.ts`, leaving upstream's `APP_FORWARDED_SHORTCUTS`
  alone; real popups for OAuth instead of navigating the opener.
- `packages/client-runtime/src/state/terminalSession.ts` — `resetEpoch`,
  `streamOffset` and `bufferBytes` on the buffer state, a trimmed buffer resumes
  at a control boundary, and the buffer may overshoot the cap by a quarter
  before it is cut back. The overshoot is what keeps scrolling smooth: trimming
  encodes the whole buffer, so doing it per output event costs a pass over half
  a megabyte per redraw. The fields are required, so a merge that adds a
  construction site upstream fails typecheck rather than mirroring a terminal
  wrongly.
- `apps/desktop/src/preview/BrowserSession.ts` — permission prompts and the
  blocklist check.
- `apps/desktop/src/window/DesktopApplicationMenu.ts` — Close Window keeps its
  menu entry but releases ⌘W, which deck binds to closing a tab.
- `apps/web/vite.config.ts` — `T3CODE_WEB_REACT_COMPILER=0` skips the React
  Compiler babel pass, which OOMs on memory-constrained hosts.
- SQL IDE wiring: `packages/contracts/src/sql.ts` + `rpc.ts` (`sql.*` methods),
  `apps/server/src/ws.ts` handlers (scope `terminal:operate`),
  `apps/server/src/server.ts` (`SqlIdeLayerLive`), migration
  `035_SqlConnections`, `packages/client-runtime/src/state/sql.ts` atoms, and a
  third deck tab kind `"sql"` across `paneTree.ts`/`deckStore.ts`/
  `DeckWorkspace.tsx`/`DeckPalette.tsx`.

## Run

```bash
pnpm install
pnpm dev:desktop
```

## Building a package

```bash
pnpm dist:desktop:dmg:arm64
```

Signing is off by default (`T3CODE_DESKTOP_SIGNED`), so this needs no Apple
account. Two things follow from that:

- Gatekeeper blocks the first launch. Right-click → Open, once.
- The packaged app uses the `t3code` data directory while `pnpm dev:desktop`
  uses `t3code-dev`, so it starts with no windows, panes or cookies from your
  dev sessions.

An unsigned build also gets a new designated requirement every time it is
built, and macOS ties keychain access to that — so the Safe Storage prompt
guarding cookie encryption reappears after every rebuild. `scripts/deck-codesign.sh`
signs a build with a self-signed identity that stays put, which keeps the grant.
It is a local identity, not an Apple one: Gatekeeper still asks on first launch.

## Permissions

`clipboard-read`, `geolocation` and `notifications` prompt per origin; the
answer is remembered for the run of the app rather than persisted, so a
mistaken allow does not outlive a restart. `clipboard-sanitized-write` stays
granted — writing discloses nothing, and refusing it breaks ordinary Copy
buttons. Everything else is denied outright.

## Phishing and malware

Electron ships no Safe Browsing: Chromium's service is not wired into Electron
builds and there is no API to enable it. Main-frame navigation is matched
against lists from abuse.ch and OpenPhish instead, on this machine, so no
address is sent anywhere.

Weaker than Google's by design — it catches known campaigns, not a domain
registered an hour ago. It fails open throughout: an unreachable or malformed
feed leaves browsing untouched, and a refresh returning nothing keeps the
previous list rather than silently dropping protection.

## Keyboard

|                               |                                          |
| ----------------------------- | ---------------------------------------- |
| `⌘T` / `⇧⌘T`                  | new terminal / browser tab               |
| `⌘W`                          | close the active tab                     |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | cycle tabs (`⇧⌘]` / `⇧⌘[` alias)         |
| `⌘K`                          | palette: jump to a window, or create one |
| `⌘N`                          | new window in the current project        |

`⌘Tab` cannot be used: macOS takes it for the app switcher.

These run on a capture-phase listener, because xterm claims keys on the
terminal element and only lets a fixed set past its own handler. Keys pressed
inside a browser pane belong to the guest, so they are also listed in
`deckForwardedShortcuts.ts`, which the preview manager consults alongside
upstream's own list before replaying the key into the window. `⌘B` and `⌥⌘B`
are forwarded too: they are T3's, but a focused pane would otherwise swallow
them. A letter chord replays its physical key, since ⌥ rewrites the reported
one (`⌥B` arrives as `∫`).

## DevTools in browser tabs

The `</>` strip at the bottom of a browser tab docks DevTools into that tab,
resizable by dragging.

They are hosted in a main-process `WebContentsView`. Electron's docking modes
dock into the whole window rather than a pane, and `setDevToolsWebContents`
needs a host that has never navigated — which rules out a `<webview>`, since it
only creates its guest once a `src` is set and any `src` is a navigation.

Docking waits for `devtools-opened` and fails if it never lands, so a dock that
silently does nothing surfaces as an error with a fallback to a detached window
rather than an empty panel.

That view is not part of the DOM, so `DeckDevToolsSlot` reports its rect and
keeps the view aligned: on its own resize, on window resize, and on scroll in
the capture phase. Two consequences follow from it being a native view:

- it paints over the DOM, so anything overlapping that rectangle is hidden
  behind it
- backgrounding the tab parks it off-screen rather than closing it, so DevTools
  keep whatever was open

While DevTools are open the automation control session is detached — the agent
cannot drive that tab until they are closed again. That is why it is a toggle
and off by default.
