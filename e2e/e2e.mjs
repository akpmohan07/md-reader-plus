// End-to-end check of the Files tab in a real Chromium with the built extension.
import { chromium } from 'playwright'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const [ext, fixture, shots] = process.argv.slice(2)
fs.mkdirSync(shots, { recursive: true })
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'mdr-e2e-'))
const ctx = await chromium.launchPersistentContext(udd, {
  channel: 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
})
let [sw] = ctx.serviceWorkers()
if (!sw) sw = await ctx.waitForEvent('serviceworker')
const id = new URL(sw.url()).host

const setup = await ctx.newPage()
await setup.goto('chrome://extensions/')
await setup.evaluate(
  id =>
    chrome.developerPrivate.updateExtensionConfiguration({
      extensionId: id,
      fileAccess: true,
    }),
  id,
)
await setup.waitForTimeout(1500)
await setup.close()

const page = await ctx.newPage()
const errors = []
page.on('pageerror', e => errors.push(String(e)))
const rows = () =>
  page.$$eval('.md-reader__files-tree .md-reader__files-row', els =>
    els
      .filter(e => e.offsetParent)
      .map(e =>
        ['caret', 'icon', 'name']
          .map(k => e.querySelector(`.md-reader__files-${k}`).textContent)
          .join(''),
      ),
  )
const appFiles = [
  'amazon-21.md',
  'cisco-11.md',
  'ibm-3.md',
  'ibm-12.md',
  'revolut-17.md',
]
const appOrder = async () =>
  (await rows()).map(r => r.slice(1)).filter(n => appFiles.includes(n))
const sortBtn = '.md-reader__files-icon-btn[aria-haspopup="menu"]'
const pickSort = async label => {
  await page.click(sortBtn)
  await page.click(`.md-reader__files-menu-item:has-text("${label}")`)
}
const step = async (name, fn) => {
  await fn()
  await page.screenshot({ path: path.join(shots, `${name}.png`) })
  console.log('✓', name)
}

await step('1-files-tab', async () => {
  await page.goto(`file://${fixture}/applications/amazon-21.md`)
  await page.waitForSelector('.md-reader__files-row.is-active')
  assert.deepEqual(await rows(), [
    '›archive',
    'Mamazon-21.md',
    'Mcisco-11.md',
    'Mibm-3.md',
    'Mibm-12.md',
    'Mrevolut-17.md',
  ])
  assert.equal(await page.textContent('.md-reader__files-root'), 'applications')
  assert.equal(
    await page.textContent(
      '.md-reader__files-row.is-active .md-reader__files-name',
    ),
    'amazon-21.md',
  )
  assert.ok(
    await page.$(
      '.md-reader__markdown-content .mermaid svg, .md-reader__markdown-content .katex',
    ),
    'rendering still works',
  )
})

await step('2-expand-folder', async () => {
  await page.click('text=archive')
  await page.waitForSelector('text=old-2025.md')
})

await step('3-parent-root', async () => {
  await page.click('.md-reader__files-icon-btn[title="Show parent folder"]')
  await page.waitForFunction(
    () =>
      document.querySelector('.md-reader__files-root').textContent === 'jobs',
  )
  await page.waitForSelector('text=README.md')
  const r = await rows()
  assert.ok(
    r.includes('›applications') &&
      r.includes('›companies') &&
      r.includes('›my notes'),
    r.join(),
  )
  assert.ok(
    !r.some(x => x.includes('.hidden') || x.includes('notes.txt')),
    'hides dotfolders and non-md',
  )
  assert.ok(r.includes('Mamazon-21.md'), 'path to current file auto-expanded')
})

await step('4-root-persists-on-navigation', async () => {
  await page.click('text=cisco-11.md')
  await page.waitForURL(/cisco-11\.md$/)
  await page.waitForSelector('.md-reader__files-row.is-active')
  assert.equal(await page.textContent('.md-reader__files-root'), 'jobs')
  await page.waitForSelector('.md-reader__files-tree >> text=old-2025.md', {
    timeout: 3000,
  })
})

await step('5-search', async () => {
  await page.fill('.md-reader__files-search', 'valkey')
  await page.waitForFunction(() =>
    /Content · \d/.test(
      document.querySelector('.md-reader__files-results').textContent,
    ),
  )
  const text = await page.textContent('.md-reader__files-results')
  assert.match(text, /Content · 3 files/)
  assert.match(text, /companies\/amazon\.md/)
  await page.fill('.md-reader__files-search', 'ibm')
  await page.waitForFunction(() =>
    /Names · 2/.test(
      document.querySelector('.md-reader__files-results').textContent,
    ),
  )
})

await step('6-outline-tab', async () => {
  await page.fill('.md-reader__files-search', '')
  await page.goto(`file://${fixture}/applications/amazon-21.md`)
  await page.click('.md-reader__side-tab:has-text("Outline")')
  assert.ok(await page.isVisible('.md-reader__side-toc >> text=Timeline'))
  assert.ok(!(await page.isVisible('.md-reader__files')))
  await page.reload()
  await page.waitForTimeout(300)
  assert.ok(
    await page.isVisible('.md-reader__side-toc >> text=Timeline'),
    'tab choice remembered',
  )
  await page.click('.md-reader__side-tab:has-text("Files")')
})

await step('7-dark', async () => {
  const worker = ctx
    .serviceWorkers()
    .filter(w => w.url().includes(id))
    .pop()
  await worker.evaluate(() => chrome.storage.local.set({ pageTheme: 'dark' }))
  await page.reload()
  await page.waitForSelector('.md-reader__files-row.is-active')
  await page.click('text=companies')
  await page.waitForSelector('text=amazon.md >> nth=0')
})

await step('8-new-file-appears-on-refresh', async () => {
  fs.writeFileSync(`${fixture}/applications/zeta-99.md`, '# new')
  await page.click('.md-reader__files-icon-btn[title="Refresh"]')
  await page.waitForSelector('text=zeta-99.md')
  fs.unlinkSync(`${fixture}/applications/zeta-99.md`)
})

await step('9-sort-menu', async () => {
  // Deterministic mtimes: ibm-3 newest … ibm-12 oldest.
  const now = Date.now() / 1000
  const ages = {
    'ibm-3.md': 60 * 5,
    'revolut-17.md': 3600 * 3,
    'amazon-21.md': 86400 * 2,
    'cisco-11.md': 86400 * 20,
    'ibm-12.md': 86400 * 400,
  }
  for (const [f, age] of Object.entries(ages)) {
    fs.utimesSync(`${fixture}/applications/${f}`, now - age, now - age)
  }
  const worker = ctx
    .serviceWorkers()
    .filter(w => w.url().includes(id))
    .pop()
  await worker.evaluate(() => chrome.storage.local.set({ pageTheme: 'light' }))
  await page.goto(`file://${fixture}/applications/amazon-21.md`)
  await page.waitForSelector('.md-reader__files-row.is-active')
  assert.deepEqual(await appOrder(), appFiles)
  await page.click(sortBtn)
  await page.waitForSelector(
    '.md-reader__files-menu-item[aria-checked="true"]:has-text("Name (A → Z)")',
  )
})

await step('10-sort-modified', async () => {
  await page.click(
    '.md-reader__files-menu-item:has-text("Modified (newest first)")',
  )
  assert.ok(await page.isHidden('.md-reader__files-menu'), 'menu closes')
  await page.waitForSelector('.md-reader__files-meta')
  const newest = [
    'ibm-3.md',
    'revolut-17.md',
    'amazon-21.md',
    'cisco-11.md',
    'ibm-12.md',
  ]
  assert.deepEqual(await appOrder(), newest)
  const metas = await page.$$eval('.md-reader__files-meta', els =>
    els.map(e => e.textContent),
  )
  assert.ok(
    ['5m', '3h', '2d'].every(m => metas.includes(m)),
    metas.join(),
  )
  await page.reload()
  await page.waitForSelector('.md-reader__files-row.is-active')
  assert.deepEqual(await appOrder(), newest, 'sort persists across reloads')
})

await step('11-sort-other-modes', async () => {
  await pickSort('Name (Z → A)')
  await page.waitForSelector('.md-reader__files-row.is-active')
  assert.deepEqual(await appOrder(), [...appFiles].reverse())
  await pickSort('Modified (oldest first)')
  await page.waitForSelector('.md-reader__files-meta')
  assert.deepEqual(await appOrder(), [
    'ibm-12.md',
    'cisco-11.md',
    'amazon-21.md',
    'revolut-17.md',
    'ibm-3.md',
  ])
  await pickSort('Folders first')
  assert.match(await page.getAttribute(sortBtn, 'title'), /folders mixed in/)
  // Name search results follow the sort too.
  await page.fill('.md-reader__files-search', '.md')
  await page.waitForFunction(() =>
    /Names · \d/.test(
      document.querySelector('.md-reader__files-results').textContent,
    ),
  )
  assert.match(
    await page.textContent(
      '.md-reader__files-results .md-reader__files-result',
    ),
    /ibm-12\.md/,
  )
  await page.fill('.md-reader__files-search', '')
  await pickSort('Folders first')
  await pickSort('Name (A → Z)')
  await page.waitForSelector('.md-reader__files-row.is-active')
  assert.deepEqual(await appOrder(), appFiles)
})

assert.deepEqual(errors, [])
console.log('all passed')
await ctx.close()
