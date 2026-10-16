import test from 'node:test'
import assert from 'node:assert/strict'

const load = () => import('../src/core/dir-listing.ts')

// Shape of Chrome's file:// directory listing (captured from Chrome 155).
const listing = `
<script>start("/Users/me/jobs/");</script>
<script>addRow("applications","applications",1,640,"640 B",1792144584,"16/10/2026, 10:56:24");</script>
<script>addRow(".git",".git",1,416,"416 B",1792144584,"16/10/2026, 10:56:24");</script>
<script>addRow("node_modules","node_modules",1,96,"96 B",1792144584,"16/10/2026, 10:56:24");</script>
<script>addRow("amazon-21.md","amazon-21.md",0,2048,"2.0 kB",1792144584,"16/10/2026, 10:56:24");</script>
<script>addRow("ibm-12.md","ibm-12.md",0,10,"10 B",1792144584,"16/10/2026, 10:56:24");</script>
<script>addRow("ibm-3.md","ibm-3.md",0,10,"10 B",1792144584,"16/10/2026, 10:56:24");</script>
<script>addRow("my \\"cv\\" notes.markdown","my%20%22cv%22%20notes.markdown",0,1,"1 B",1,"x");</script>
<script>addRow("photo.png","photo.png",0,1,"1 B",1,"x");</script>
`

test('parses addRow entries into absolute URLs', async () => {
  const { parseDirListing } = await load()
  const entries = parseDirListing(listing, 'file:///Users/me/jobs')
  assert.equal(entries.length, 8)
  assert.deepEqual(entries[0], {
    name: 'applications',
    url: 'file:///Users/me/jobs/applications/',
    isDir: true,
    size: 640,
    mtime: 1792144584,
  })
  assert.equal(entries[6].name, 'my "cv" notes.markdown')
  assert.equal(
    entries[6].url,
    'file:///Users/me/jobs/my%20%22cv%22%20notes.markdown',
  )
})

test('keeps only markdown files and non-hidden folders, natural-sorted', async () => {
  const { parseDirListing, isVisibleEntry, sortEntries } = await load()
  const names = sortEntries(
    parseDirListing(listing, 'file:///Users/me/jobs/').filter(isVisibleEntry),
  ).map(e => e.name)
  assert.deepEqual(names, [
    'applications',
    'amazon-21.md',
    'ibm-3.md',
    'ibm-12.md',
    'my "cv" notes.markdown',
  ])
})

test('path helpers', async () => {
  const { dirOf, parentDir, dirsBetween, relativePath, dirName, toDirUrl } =
    await load()
  assert.equal(dirOf('file:///a/b/c.md?x#h'), 'file:///a/b/')
  assert.equal(parentDir('file:///a/b/'), 'file:///a/')
  assert.equal(parentDir('file:///'), 'file:///')
  assert.equal(toDirUrl('file:///a/b?q#h'), 'file:///a/b/')
  assert.deepEqual(dirsBetween('file:///a/', 'file:///a/b/c/'), [
    'file:///a/b/',
    'file:///a/b/c/',
  ])
  assert.deepEqual(dirsBetween('file:///x/', 'file:///a/b/'), [])
  assert.equal(
    relativePath('file:///a/', 'file:///a/my%20dir/n.md'),
    'my dir/n.md',
  )
  assert.equal(dirName('file:///a/my%20dir/'), 'my dir')
})
