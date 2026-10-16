export interface DirEntry {
  name: string
  url: string
  isDir: boolean
  size: number
  mtime: number
}

export const MD_FILE_RE = /\.(md|mdx|mkd|markdown)$/i

const HIDDEN_DIRS = ['node_modules']

/**
 * Parse Chrome's built-in `file://` directory listing page.
 * Each entry is emitted as `<script>addRow("name","url",isDir,size,"size",mtime,"date");</script>`,
 * where the arguments are JSON-quoted.
 */
export function parseDirListing(html: string, dirUrl: string): DirEntry[] {
  const base = toDirUrl(dirUrl)
  const entries: DirEntry[] = []
  const rowRe = /addRow\((.*)\);?<\/script>/g
  let match: RegExpExecArray | null
  while ((match = rowRe.exec(html))) {
    let args: unknown[]
    try {
      args = JSON.parse(`[${match[1]}]`)
    } catch {
      continue
    }
    const [name, rawUrl, isDir, size, , mtime] = args as [
      string,
      string,
      number,
      number,
      string,
      number,
    ]
    if (typeof name !== 'string' || name === '.' || name === '..') continue
    const dir = Boolean(isDir)
    const href = dir && !rawUrl.endsWith('/') ? `${rawUrl}/` : rawUrl
    entries.push({
      name,
      url: new URL(href, base).href,
      isDir: dir,
      size: Number(size) || 0,
      mtime: Number(mtime) || 0,
    })
  }
  return entries
}

export function isVisibleEntry(entry: DirEntry): boolean {
  if (entry.name.startsWith('.')) return false
  if (entry.isDir) return !HIDDEN_DIRS.includes(entry.name)
  return MD_FILE_RE.test(entry.name)
}

const collator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})

export const SORT_MODES = {
  'name-asc': 'Name (A → Z)',
  'name-desc': 'Name (Z → A)',
  'mtime-desc': 'Modified (newest first)',
  'mtime-asc': 'Modified (oldest first)',
  'size-desc': 'Size (largest first)',
}
export type SortMode = keyof typeof SORT_MODES

const byName = (a: DirEntry, b: DirEntry) => collator.compare(a.name, b.name)

const comparators: Record<SortMode, (a: DirEntry, b: DirEntry) => number> = {
  'name-asc': byName,
  'name-desc': (a, b) => byName(b, a),
  'mtime-desc': (a, b) => b.mtime - a.mtime || byName(a, b),
  'mtime-asc': (a, b) => a.mtime - b.mtime || byName(a, b),
  // Chrome reports a folder's inode size, not its contents, so folders sort by name.
  'size-desc': (a, b) =>
    a.isDir && b.isDir ? byName(a, b) : b.size - a.size || byName(a, b),
}

export function isSortMode(mode: unknown): mode is SortMode {
  return typeof mode === 'string' && Object.hasOwn(SORT_MODES, mode)
}

export function sortEntries(
  entries: DirEntry[],
  mode: SortMode = 'name-asc',
  foldersFirst = true,
): DirEntry[] {
  const compare = comparators[mode] ?? byName
  return [...entries].sort(
    (a, b) =>
      (foldersFirst ? Number(b.isDir) - Number(a.isDir) : 0) || compare(a, b),
  )
}

/** Short modified-time label: `5m`, `3h`, `6d`, `16 Oct`, `16 Oct 2024`. */
export function formatAge(mtimeSec: number, nowMs = Date.now()): string {
  const diff = Math.max(0, nowMs / 1000 - mtimeSec)
  if (diff < 3600) return `${Math.max(1, Math.floor(diff / 60))}m`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`
  if (diff < 7 * 86400) return `${Math.floor(diff / 86400)}d`
  const date = new Date(mtimeSec * 1000)
  const sameYear = date.getFullYear() === new Date(nowMs).getFullYear()
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/** `512 B`, `2.0 kB`, `1.3 MB` */
export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`
  const units = ['kB', 'MB', 'GB']
  let value = bytes
  let unit = -1
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000
    unit++
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

/** `file:///a/b` → `file:///a/b/` */
export function toDirUrl(url: string): string {
  const u = new URL(url)
  u.search = ''
  u.hash = ''
  if (!u.pathname.endsWith('/')) u.pathname += '/'
  return u.href
}

/** Directory containing a file URL: `file:///a/b.md?x#y` → `file:///a/` */
export function dirOf(fileUrl: string): string {
  return new URL('.', fileUrl).href
}

/** `file:///a/b/` → `file:///a/`; the filesystem root stays as is. */
export function parentDir(dirUrl: string): string {
  return new URL('..', toDirUrl(dirUrl)).href
}

/** Directories from `root` (exclusive) down to `dir` (inclusive). Empty if `dir` is not under `root`. */
export function dirsBetween(root: string, dir: string): string[] {
  if (!dir.startsWith(root) || dir === root) return []
  const parts = dir.slice(root.length).split('/').filter(Boolean)
  return parts.map((_, i) => root + parts.slice(0, i + 1).join('/') + '/')
}

/** Decoded path of `url` relative to `root`, e.g. `notes/a b.md`. */
export function relativePath(root: string, url: string): string {
  return decodeURIComponent(url.startsWith(root) ? url.slice(root.length) : url)
}

/** Readable name of a directory URL: `file:///a/my%20dir/` → `my dir` */
export function dirName(dirUrl: string): string {
  const parts = new URL(dirUrl).pathname.split('/').filter(Boolean)
  return parts.length ? decodeURIComponent(parts[parts.length - 1]) : '/'
}
