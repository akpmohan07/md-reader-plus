# md-reader: self-build feasibility + free alternatives

_2026-10-16_

> **Status (same day):** built. The spike confirmed the approach and the fork has a working Files tab plus search, with unit and
> e2e tests passing. See [FORK.md](../../FORK.md) for install and usage. Actual effort was a few hours, under the 1.5–2 day estimate.

## TL;DR

- **The folder tree is not in the open-source code.** `md-reader/md-reader` (MIT, v2.12.12, last commit 2026-09-12) only has the
  heading-outline sidebar. The Files tab, search, and "Upgrade to Pro" panel in the store build are closed-source Pro features.
- **Self-build is very feasible.** The OSS codebase is small (~1,700 LOC of TS/Svelte), MIT lets us fork and modify freely, and
  it already uses the exact mechanism a folder tree needs (service-worker `fetch()` of `file://` URLs, used for auto-refresh).
  Estimate: **~1–2 days** for fork + file tree + cross-file search, used unpacked in Chrome.
- **No free extension today matches md-reader rendering + a `file://` folder tree with a verified open-source licence.** Closest:
  _Pretty Markdown Navigator_ (MIT, tree, but weak rendering and 0 stars) and _Markdown Viewer_ (MIT, great rendering, no tree).
- **Recommendation:** fork md-reader, rename it (don't reuse the "md-reader" name/logo), and add a Files tab.

---

## 1. What md-reader is, and what the OSS repo actually contains

Inspected from a clone of upstream (`git remote upstream` in this repo).

| Item                      | Finding                                                                                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Licence                   | MIT, © 2018-present Bener. Fork/modify/redistribute is allowed if we keep the copyright notice.                                                                                  |
| Stack                     | Manifest V3, TypeScript, Svelte 3 (popup only), Less, webpack 5, pnpm                                                                                                            |
| Size                      | `src/` ≈ 1,670 lines (main.ts 376, core/ ≈ 590, plugins/ ≈ 400, popup ≈ 230, background 67)                                                                                      |
| Renderer                  | markdown-it 13 + plugins: emoji, footnote, sub/sup, ins, mark, abbr, deflist, container, multimd-table, task-lists, TOC, alerts, KaTeX, Mermaid, Graphviz (viz-js), highlight.js |
| UI                        | Heading-outline sidebar, go-to-top, raw/rendered toggle, image viewer, code-block copy, centered layout, light/dark/auto + page themes                                           |
| Behaviour                 | Content script on `*.md/.mdx/.mkd/.markdown` (http + file), auto-refresh by polling every 500 ms through the background worker                                                   |
| Shortcuts                 | Alt+Shift+B sidebar, C centered, R refresh, T theme                                                                                                                              |
| **Missing vs. store Pro** | **Folder/file tree, the search panel, the settings panel in the sidebar.** No folder, Pro, or licensing code exists in the repo.                                                 |

The website says "Subscribe to the Pro plan to unlock more features" but doesn't list the Pro features or prices.
From your screenshot, Pro adds: a **Files** tab (folder listing), an **Outline** tab, **search**, and **sidebar settings**.

## 2. Feasibility of a self-build

### Key technical question: can an extension list a local folder?

Yes, and md-reader already does the hard part:

- `src/background.ts` calls `fetch(sender.url)` on `file://` URLs from the MV3 service worker (this is how auto-refresh works).
  It needs "Allow access to file URLs" turned on, which you already have.
- Fetching a **directory** URL (`file:///Users/…/applications/`) returns Chrome's built-in directory-listing HTML. Each entry is a
  `addRow("name","url",isDir,size,…)` call that can be parsed with a regex.
- So: page URL → parent dir → SW fetches the listing → parse → render the tree → load subfolders when expanded. No native helper,
  no File System Access picker, no server.

> ⚠️ Verify with a 30-minute spike first: confirm that the SW `fetch()` of a _directory_ `file://` URL returns the listing in the
> current Chrome. If Chrome ever blocks it, the fallbacks are (a) a File System Access API "open folder" button (what Pretty
> Markdown Navigator does) or (b) a tiny local `markserv`-style server.

### Feature-by-feature plan

| Feature                                                                                                | Approach                                                                                                                                                 | Effort |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Everything in OSS md-reader (rendering, KaTeX, Mermaid, Graphviz, themes, outline, refresh, shortcuts) | Fork as-is                                                                                                                                               | 0      |
| Sidebar tabs: **Files / Outline**                                                                      | Wrap the existing `mdSide` in a tab bar; Outline keeps current `renderSide()`                                                                            | 0.25 d |
| **Folder tree**                                                                                        | New `listDir` message in background.ts → parse `addRow` → lazy, collapsible tree; show only `.md*` files + dirs; highlight current file; click navigates | 0.5 d  |
| Remember expanded folders / sidebar width                                                              | `chrome.storage.local`, keyed by root path                                                                                                               | 0.1 d  |
| Root selection ("open from here up to repo root")                                                      | Walk up the tree until a `.git` dir or user-pinned root; store pins                                                                                      | 0.25 d |
| **Filename filter** (search box)                                                                       | Client-side filter over the loaded tree                                                                                                                  | 0.1 d  |
| **Full-text search across folder**                                                                     | SW fetches each `.md` (lazy, cached by mtime from listing), simple substring/regex match, results list                                                   | 0.5 d  |
| Sidebar settings panel                                                                                 | Reuse popup's Svelte settings components                                                                                                                 | 0.25 d |
| Auto-refresh tree when files added                                                                     | Re-poll the listing at a slow interval (5 s) while the Files tab is open                                                                                 | 0.1 d  |
| Packaging                                                                                              | `pnpm build` → Load unpacked from `dist/` (no Web Store needed for personal use)                                                                         | 0.1 d  |

**Total ≈ 1.5–2 days** including the spike and polish. A from-scratch rewrite would take ~4–5 days and gain nothing, since the MIT
fork already has the renderer and plugin pipeline.

### Risks / gotchas

- **Naming/branding:** MIT covers the code, not the "md-reader" name or logo. Rename (e.g. "md-shelf") if you publish anything.
- **Upstream drift:** keep the fork's changes in new files (`src/side/files.ts`, `src/side/search.ts`) so upstream merges stay simple.
- **Chrome listing format** is unofficial (it's Chrome's internal `net::` directory page). Small risk of breakage; isolate the parser.
- **Large folders:** full-text search over thousands of files is slow from `file://`. Fine for a jobs/notes folder (tens to hundreds).
- **Old toolchain:** webpack 4-era plugins, TS 4.8, Svelte 3. It builds, but expect `pnpm install` warnings on Node 22+.

## 3. Free / open alternatives

### Browser extensions

| Extension                                                                                                       | Folder tree                                          | Rendering                                                    | Open source       | Notes                                                                                                                |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------ | ----------------- | -------------------------------------------------------------------------------------------------------------------- |
| **[Markdown Viewer](https://github.com/simov/markdown-viewer)** (simov)                                         | ❌                                                   | ⭐ Excellent: 30+ themes, Mermaid, MathJax, TOC, auto-reload | ✅ MIT            | Best free _single-file_ viewer, mature (470+ commits)                                                                |
| **[Pretty Markdown Navigator](https://github.com/josepedrodiaz/pretty-markdown-navigator)**                     | ✅ collapsible + name search, outline, in-doc search | Basic (`marked`, no Mermaid/math noted)                      | ✅ MIT            | Uses File System Access API (pick a folder) instead of `file://`; 0 stars, unpacked install, Web Store "coming soon" |
| **Markdown Local Preview** ([store](https://chromewebstore.google.com/detail/nlejfmkcfajgajlgmccmdokdefpcabpb)) | ✅ file list + outline                               | Mermaid, highlight                                           | ❓ no source link | v0.1.0 (Feb 2026), 14 users, says "no paywall for core features"                                                     |
| **Markdown Chrome** ([store](https://chromewebstore.google.com/detail/dkimnacnkjidlkihibckidekfnkdlgfj))        | ✅ collapsible tree                                  | GFM, Mermaid, split edit                                     | ❓ no source link | Also an editor; says no uploads, no analytics                                                                        |

### Outside the browser (all free)

| Tool                                                                       | Fit                                                                                                                                                                       |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[markserv](https://github.com/markserv/markserv)** (`npm i -g markserv`) | Serves a folder at `localhost` with **directory index + live reload**, MathJax, 4 themes. MIT. Closest "browser + folders" experience with zero coding. No Mermaid noted. |
| **Obsidian**                                                               | Open `jobs/applications` as a vault: folder tree, backlinks, search, Mermaid, math. Free for personal use, not OSS.                                                       |
| **VS Code** (built-in preview, + "Markdown Preview Enhanced")              | Explorer tree + preview, Mermaid/KaTeX. Free, OSS core.                                                                                                                   |
| **MarkText / Zettlr**                                                      | OSS desktop Markdown apps with a folder sidebar.                                                                                                                          |

## 4. Recommendation

1. **Now, zero effort:** keep md-reader free for rendering. For folder browsing, run `markserv` in `jobs/` or open it in
   Obsidian/VS Code.
2. **Best long-term:** fork md-reader and add a Files tab plus search (≈1.5–2 days). You keep the exact rendering you already use,
   get the Pro folder UX for free, and own it.
3. **If you'd rather not maintain code:** try Pretty Markdown Navigator (MIT) for the tree, alongside Markdown Viewer for rendering.

## Sources

- md-reader site: <https://md-reader.github.io/>
- md-reader source (cloned): <https://github.com/md-reader/md-reader>
- Markdown Viewer: <https://github.com/simov/markdown-viewer>
- Pretty Markdown Navigator: <https://github.com/josepedrodiaz/pretty-markdown-navigator>
- Markdown Local Preview: <https://chromeboard.com/extension/markdown-local-preview-nlejfmkcfajgajlgmccmdokdefpcabpb>
- Markdown Chrome: <https://chromewebstore.google.com/detail/dkimnacnkjidlkihibckidekfnkdlgfj>
- markserv: <https://github.com/markserv/markserv>
