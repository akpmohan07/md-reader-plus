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
    els.filter(e => e.offsetParent).map(e => e.textContent.trim()),
  )
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

assert.deepEqual(errors, [])
console.log('all passed')
await ctx.close()
