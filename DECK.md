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
surrounding split collapses.

Inactive tabs stay mounted. Unmounting a terminal drops its scrollback and xterm
state, and unmounting a `<webview>` tears the page down entirely. They are
hidden with `invisible` rather than `hidden` so panes keep their measured size
and terminals do not refit on every switch.

Browser tabs need more than CSS: an Electron `<webview>` composites in its own
layer, so `visibility: hidden` on an ancestor leaves it painted on top. T3 parks
inactive surfaces at `HIDDEN_BROWSER_WEBVIEW_OFFSET` instead, driven by
`PreviewPanel`'s `visible` prop.

## Files the fork owns

| Path                                                          | Purpose                                                                     |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `apps/web/src/deck/paneTree.ts`                               | Pure split-tree and tab model (n-ary splits, sizes, normalization)          |
| `apps/web/src/deck/deckStore.ts`                              | Per-thread layout, persisted like `terminalUiStateStore`                    |
| `apps/web/src/deck/deckWindowStore.ts`                        | Windows per project: create, rename, close, reorder                         |
| `apps/web/src/deck/DeckSidebar.tsx`                           | Projects and their windows                                                  |
| `apps/web/src/deck/DeckPaneGrid.tsx`                          | Nested CSS grids with draggable dividers                                    |
| `apps/web/src/deck/DeckWorkspace.tsx`                         | Toolbar, pane bootstrap, tab strips, terminal and browser tabs              |
| `apps/web/src/deck/DeckDevToolsSlot.tsx`                      | Keeps the docked DevTools view aligned with its slot                        |
| `apps/web/src/deck/DeckPalette.tsx`                           | ⌘K palette over windows and creation actions                                |
| `apps/web/src/deck/deckShortcuts.ts`                          | Keyboard mapping, matched in the capture phase                              |
| `apps/web/src/deck/deckMode.ts`                               | Pane mode toggle (`?deck=0` restores upstream chat)                         |
| `apps/web/src/routes/_chat.deck.$environmentId.$windowId.tsx` | The window route                                                            |
| `apps/web/src/components/TerminalViewport.tsx`                | Extracted from `ThreadTerminalDrawer` so drawer and grid share one terminal |

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
  and `closeDevTools`; deck shortcuts added to `APP_FORWARDED_SHORTCUTS`; real
  popups for OAuth instead of navigating the opener.
- `apps/desktop/src/preview/BrowserSession.ts` — permission prompts and the
  blocklist check.
- `apps/desktop/src/window/DesktopApplicationMenu.ts` — Close Window keeps its
  menu entry but releases ⌘W, which deck binds to closing a tab.
- `apps/web/vite.config.ts` — `T3CODE_WEB_REACT_COMPILER=0` skips the React
  Compiler babel pass, which OOMs on memory-constrained hosts.

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
`APP_FORWARDED_SHORTCUTS` in the preview manager, which forwards them to the
window.

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
