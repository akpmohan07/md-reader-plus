import debounce from 'lodash.debounce'
import Ele from '@/core/ele'
import {
  dirName,
  dirOf,
  dirsBetween,
  formatAge,
  formatSize,
  isSortMode,
  isVisibleEntry,
  parentDir,
  relativePath,
  sortEntries,
  SORT_MODES,
  type DirEntry,
  type SortMode,
} from '@/core/dir-listing'

const PREFIX = 'md-reader__files'
const ROOTS_KEY = 'filesRoots'
const EXPANDED_KEY = 'filesExpanded'
const SORT_KEY = 'filesSort'
const MAX_EXPANDED = 500
const MAX_CRAWL_FILES = 3000
const MAX_CRAWL_DEPTH = 8
const MAX_CONTENT_FILES = 1000
const CONTENT_CONCURRENCY = 6

type ListResult = { entries?: DirEntry[]; error?: string }
type TextResult = { text?: string; error?: string }

const send = <T>(action: string, data: object): Promise<T> =>
  new Promise(resolve => chrome.runtime.sendMessage({ action, data }, resolve))

const local = {
  get: <T>(key: string, fallback: T): Promise<T> =>
    new Promise(resolve =>
      chrome.storage.local.get(key, res =>
        resolve((res?.[key] as T) ?? fallback),
      ),
    ),
  set: (key: string, value: unknown): Promise<void> =>
    new Promise(resolve => chrome.storage.local.set({ [key]: value }, resolve)),
}

function el<T extends HTMLElement = HTMLElement>(
  tag: string,
  className?: string,
  text?: string,
): T {
  const node = document.createElement(tag) as T
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/** Wrap every case-insensitive occurrence of `query` in <mark>. */
function highlight(text: string, query: string): DocumentFragment {
  const df = document.createDocumentFragment()
  const lower = text.toLowerCase()
  const q = query.toLowerCase()
  let from = 0
  let at: number
  while (q && (at = lower.indexOf(q, from)) !== -1) {
    df.append(
      text.slice(from, at),
      el('mark', '', text.slice(at, at + q.length)),
    )
    from = at + q.length
  }
  df.append(text.slice(from))
  return df
}

export interface FilesPanel {
  ele: Ele<HTMLElement>
  /** Re-read the listing of every open folder (e.g. when the tab regains focus). */
  refresh(): void
  focusSearch(): void
}

export function createFilesPanel(currentUrl: string): FilesPanel {
  const currentFile = currentUrl.split(/[?#]/)[0]
  const currentDir = dirOf(currentFile)

  let root = currentDir
  let pinnedRoots: string[] = []
  let expanded = new Set<string>()
  let listCache = new Map<string, Promise<DirEntry[]>>()
  const textCache = new Map<string, Promise<string>>()
  let crawlCache: Promise<DirEntry[]> = null
  let searchToken = 0
  let sortMode: SortMode = 'name-asc'
  let foldersFirst = true

  /* ---------- DOM ---------- */
  const panel = new Ele<HTMLElement>('div', { className: PREFIX })

  const toolbar = el('div', `${PREFIX}-toolbar`)
  const upBtn = el<HTMLButtonElement>('button', `${PREFIX}-icon-btn`, '↑')
  upBtn.title = 'Show parent folder'
  const rootLabel = el('span', `${PREFIX}-root`)
  const resetBtn = el<HTMLButtonElement>('button', `${PREFIX}-icon-btn`, '⌖')
  resetBtn.title = "Back to this file's folder"
  const sortBtn = el<HTMLButtonElement>('button', `${PREFIX}-icon-btn`, '⇅')
  sortBtn.title = 'Sort'
  sortBtn.setAttribute('aria-haspopup', 'menu')
  const refreshBtn = el<HTMLButtonElement>('button', `${PREFIX}-icon-btn`, '↻')
  refreshBtn.title = 'Refresh'
  toolbar.append(upBtn, rootLabel, resetBtn, sortBtn, refreshBtn)

  const sortMenu = el('div', `${PREFIX}-menu`)
  sortMenu.setAttribute('role', 'menu')
  sortMenu.hidden = true

  const search = el<HTMLInputElement>('input', `${PREFIX}-search`)
  search.type = 'search'
  search.placeholder = 'Search names and content…'
  search.spellcheck = false

  const tree = el('div', `${PREFIX}-tree`)
  const results = el('div', `${PREFIX}-results`)
  results.hidden = true

  panel.append([toolbar, sortMenu, search, tree, results])

  /* ---------- data ---------- */
  function list(dirUrl: string): Promise<DirEntry[]> {
    if (!listCache.has(dirUrl)) {
      listCache.set(
        dirUrl,
        send<ListResult>('listDir', { url: dirUrl }).then(res => {
          if (!res || res.error) throw new Error(res?.error ?? 'No response')
          return res.entries.filter(isVisibleEntry)
        }),
      )
    }
    return listCache.get(dirUrl)
  }

  function readText(url: string): Promise<string> {
    if (!textCache.has(url)) {
      textCache.set(
        url,
        send<TextResult>('fetchText', { url }).then(res => res?.text ?? ''),
      )
    }
    return textCache.get(url)
  }

  /** Every markdown file under the root (breadth-first, bounded). */
  function crawl(): Promise<DirEntry[]> {
    if (!crawlCache) {
      crawlCache = (async () => {
        const files: DirEntry[] = []
        let level = [root]
        for (let depth = 0; depth <= MAX_CRAWL_DEPTH && level.length; depth++) {
          const listed = await Promise.all(
            level.map(d => list(d).catch(() => [])),
          )
          level = []
          for (const entries of listed) {
            for (const entry of entries) {
              if (entry.isDir) level.push(entry.url)
              else if (files.length < MAX_CRAWL_FILES) files.push(entry)
            }
          }
        }
        return files
      })()
    }
    return crawlCache
  }

  /* ---------- state ---------- */
  async function load() {
    pinnedRoots = await local.get<string[]>(ROOTS_KEY, [])
    // The deepest pinned root that contains this file wins.
    root =
      pinnedRoots
        .filter(r => currentDir.startsWith(r))
        .sort((a, b) => b.length - a.length)[0] ?? currentDir
    expanded = new Set(await local.get<string[]>(EXPANDED_KEY, []))
    const sort = await local.get<{ mode?: string; foldersFirst?: boolean }>(
      SORT_KEY,
      {},
    )
    sortMode = isSortMode(sort.mode) ? sort.mode : 'name-asc'
    foldersFirst = sort.foldersFirst !== false
    dirsBetween(root, currentDir).forEach(d => expanded.add(d))
    render()
  }

  function saveExpanded() {
    // One list for all roots, so a folder stays open however the tree is rooted.
    return local.set(EXPANDED_KEY, [...expanded].slice(-MAX_EXPANDED))
  }

  async function setRoot(next: string) {
    const prev = root
    pinnedRoots = pinnedRoots.filter(r => r !== prev)
    if (next !== currentDir) pinnedRoots.push(next)
    await local.set(ROOTS_KEY, pinnedRoots)
    crawlCache = null
    await load()
  }

  function setSort(mode: SortMode, folders: boolean) {
    sortMode = mode
    foldersFirst = folders
    local.set(SORT_KEY, { mode, foldersFirst: folders })
    rerender()
  }

  /* ---------- render ---------- */
  function render() {
    sortBtn.classList.toggle('is-on', sortMode !== 'name-asc' || !foldersFirst)
    sortBtn.title = `Sort: ${SORT_MODES[sortMode]}${
      foldersFirst ? '' : ', folders mixed in'
    }`
    rootLabel.textContent = dirName(root)
    rootLabel.title = decodeURIComponent(new URL(root).pathname)
    upBtn.disabled = parentDir(root) === root
    resetBtn.hidden = root === currentDir
    tree.textContent = ''
    renderDir(root, 0, tree)
    if (search.value.trim()) runSearch()
  }

  function renderDir(dirUrl: string, depth: number, container: HTMLElement) {
    const loading = el('div', `${PREFIX}-hint`, 'Loading…')
    loading.style.paddingLeft = indent(depth)
    container.append(loading)

    list(dirUrl)
      .then(entries => {
        loading.remove()
        if (!entries.length) {
          const empty = el('div', `${PREFIX}-hint`, 'No markdown files')
          empty.style.paddingLeft = indent(depth)
          container.append(empty)
        }
        for (const entry of sortEntries(entries, sortMode, foldersFirst)) {
          container.append(renderEntry(entry, depth))
        }
        const active = container.querySelector<HTMLElement>(
          `.${PREFIX}-row.is-active`,
        )
        active?.scrollIntoView({ block: 'nearest' })
      })
      .catch(err => {
        loading.textContent = /access|denied|fail/i.test(String(err))
          ? 'Cannot read folder. Turn on "Allow access to file URLs" for this extension.'
          : `Cannot read folder: ${err.message ?? err}`
      })
  }

  function renderEntry(entry: DirEntry, depth: number): HTMLElement {
    const row = el<HTMLAnchorElement>('a', `${PREFIX}-row`)
    row.href = entry.url
    row.title = entry.name
    row.style.paddingLeft = indent(depth)

    const caret = el('span', `${PREFIX}-caret`, entry.isDir ? '›' : '')
    const icon = el('span', `${PREFIX}-icon`, entry.isDir ? '' : 'M')
    const name = el('span', `${PREFIX}-name`, entry.name)
    row.append(caret, icon, name)

    if (!entry.isDir) {
      if (entry.url === currentFile) row.classList.add('is-active')
      const meta = metaLabel(entry)
      meta && row.append(el('span', `${PREFIX}-meta`, meta))
      if (entry.mtime) {
        const modified = new Date(entry.mtime * 1000).toLocaleString()
        row.title = `${entry.name}\nModified ${modified} · ${formatSize(
          entry.size,
        )}`
      }
      return row
    }

    row.classList.add('is-dir')
    const wrap = el('div', `${PREFIX}-dir`)
    const children = el('div', `${PREFIX}-children`)
    wrap.append(row, children)

    const open = (value: boolean) => {
      row.classList.toggle('is-open', value)
      children.hidden = !value
      if (value && !children.childElementCount)
        renderDir(entry.url, depth + 1, children)
    }
    open(expanded.has(entry.url))

    row.addEventListener('click', e => {
      if (e.metaKey || e.ctrlKey || e.shiftKey) return
      e.preventDefault()
      const value = !expanded.has(entry.url)
      value ? expanded.add(entry.url) : expanded.delete(entry.url)
      open(value)
      saveExpanded()
    })
    row.addEventListener('dblclick', e => {
      e.preventDefault()
      setRoot(entry.url)
    })
    row.title = `${entry.name}\nDouble-click to make this the root`
    return wrap
  }

  const indent = (depth: number) => `${0.6 + depth * 0.9}em`

  /** Right-aligned hint matching the active sort, so the order is explainable. */
  function metaLabel(entry: DirEntry): string {
    if (sortMode.startsWith('mtime'))
      return entry.mtime ? formatAge(entry.mtime) : ''
    if (sortMode === 'size-desc') return formatSize(entry.size)
    return ''
  }

  /* ---------- sort menu ---------- */
  function renderMenu() {
    sortMenu.textContent = ''
    const item = (label: string, checked: boolean, onClick: () => void) => {
      const btn = el<HTMLButtonElement>('button', `${PREFIX}-menu-item`)
      btn.setAttribute('role', 'menuitemradio')
      btn.setAttribute('aria-checked', String(checked))
      btn.append(el('span', `${PREFIX}-check`, checked ? '✓' : ''), label)
      btn.addEventListener('click', () => {
        onClick()
        closeMenu()
      })
      sortMenu.append(btn)
    }
    for (const mode of Object.keys(SORT_MODES) as SortMode[]) {
      item(SORT_MODES[mode], mode === sortMode, () =>
        setSort(mode, foldersFirst),
      )
    }
    sortMenu.append(el('div', `${PREFIX}-menu-sep`))
    item('Folders first', foldersFirst, () => setSort(sortMode, !foldersFirst))
  }

  function openMenu() {
    renderMenu()
    sortMenu.hidden = false
    sortBtn.classList.add('is-active')
    setTimeout(() => document.addEventListener('click', onOutsideClick, true))
    sortMenu.querySelector<HTMLElement>('[aria-checked="true"]')?.focus()
  }

  function closeMenu() {
    sortMenu.hidden = true
    sortBtn.classList.remove('is-active')
    document.removeEventListener('click', onOutsideClick, true)
  }

  function onOutsideClick(e: MouseEvent) {
    const target = e.target as Node
    if (!sortMenu.contains(target) && !sortBtn.contains(target)) closeMenu()
  }

  /* ---------- search ---------- */
  async function runSearch() {
    const query = search.value.trim()
    const token = ++searchToken
    tree.hidden = Boolean(query)
    results.hidden = !query
    if (!query) return

    results.textContent = ''
    const nameSection = el('div', `${PREFIX}-section`)
    const contentSection = el('div', `${PREFIX}-section`)
    results.append(nameSection, contentSection)

    const files = await crawl()
    if (token !== searchToken) return

    const q = query.toLowerCase()
    const byName = files.filter(f =>
      relativePath(root, f.url).toLowerCase().includes(q),
    )
    nameSection.append(
      el('div', `${PREFIX}-heading`, `Names · ${byName.length}`),
    )
    sortEntries(byName, sortMode, false).forEach(f =>
      nameSection.append(resultRow(f, query)),
    )

    if (query.length < 2) return
    const heading = el('div', `${PREFIX}-heading`, 'Content · searching…')
    contentSection.append(heading)

    let hits = 0
    const queue = files.slice(0, MAX_CONTENT_FILES)
    const worker = async () => {
      while (queue.length) {
        const file = queue.shift()
        const text = await readText(file.url)
        if (token !== searchToken) return
        const lines = text.split('\n')
        const matches = lines.filter(line => line.toLowerCase().includes(q))
        if (!matches.length) continue
        hits++
        const row = resultRow(file, query, matches.length)
        matches.slice(0, 3).forEach(line => {
          const snippet = el('div', `${PREFIX}-snippet`)
          snippet.append(highlight(trimAround(line.trim(), q), query))
          row.append(snippet)
        })
        contentSection.append(row)
      }
    }
    await Promise.all(Array.from({ length: CONTENT_CONCURRENCY }, worker))
    if (token !== searchToken) return
    heading.textContent = `Content · ${hits} file${hits === 1 ? '' : 's'}`
  }

  function resultRow(
    file: DirEntry,
    query: string,
    count?: number,
  ): HTMLElement {
    const row = el<HTMLAnchorElement>('a', `${PREFIX}-result`)
    row.href = file.url
    if (file.url === currentFile) row.classList.add('is-active')
    const path = el('div', `${PREFIX}-result-path`)
    path.append(highlight(relativePath(root, file.url), query))
    if (count) path.append(el('span', `${PREFIX}-count`, String(count)))
    row.append(path)
    return row
  }

  function trimAround(line: string, q: string, width = 90): string {
    const at = line.toLowerCase().indexOf(q)
    if (line.length <= width || at < 0) return line.slice(0, width)
    const start = Math.max(0, Math.min(at - 30, line.length - width))
    return (start ? '…' : '') + line.slice(start, start + width) + '…'
  }

  /* ---------- events ---------- */
  upBtn.addEventListener('click', () => setRoot(parentDir(root)))
  resetBtn.addEventListener('click', () => setRoot(currentDir))
  refreshBtn.addEventListener('click', () => refresh())
  sortBtn.addEventListener('click', () =>
    sortMenu.hidden ? openMenu() : closeMenu(),
  )
  sortMenu.addEventListener('keydown', e => {
    const items = Array.from(
      sortMenu.querySelectorAll<HTMLElement>(`.${PREFIX}-menu-item`),
    )
    const at = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'Escape') {
      closeMenu()
      sortBtn.focus()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      items[(at + step + items.length) % items.length]?.focus()
    }
  })
  search.addEventListener('input', debounce(runSearch, 200))
  search.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      search.value = ''
      runSearch()
    } else if (e.key === 'Enter') {
      const first = results.querySelector<HTMLAnchorElement>(
        `.${PREFIX}-result`,
      )
      first && (window.location.href = first.href)
    }
  })

  function refresh() {
    listCache = new Map()
    textCache.clear()
    crawlCache = null
    rerender()
  }

  /** Re-render from the current caches, keeping the scroll position. */
  function rerender() {
    const scroll = tree.scrollTop
    render()
    setTimeout(() => (tree.scrollTop = scroll), 50)
  }

  load()

  return {
    ele: panel,
    refresh,
    focusSearch: () => search.focus(),
  }
}
