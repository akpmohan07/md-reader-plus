// Spike: can the MV3 service worker fetch() a file:// DIRECTORY URL and get Chrome's listing?
import { chromium } from 'playwright'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const ext = process.argv[2]
const dir = process.argv[3]
const udd = fs.mkdtempSync(path.join(os.tmpdir(), 'mdr-spike-'))

const ctx = await chromium.launchPersistentContext(udd, {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
})

let [sw] = ctx.serviceWorkers()
if (!sw) sw = await ctx.waitForEvent('serviceworker')
const id = new URL(sw.url()).host
console.log('extension id', id)

const tryFetch = async label => {
  const workers = ctx.serviceWorkers().filter(w => w.url().includes(id))
  const w = workers[workers.length - 1]
  const out = await w.evaluate(async u => {
    try {
      const t = await (await fetch(u)).text()
      return {
        ok: true,
        len: t.length,
        rows: (t.match(/addRow\(/g) || []).length,
        head: t.slice(0, 120),
      }
    } catch (e) {
      return { ok: false, err: String(e) }
    }
  }, 'file://' + dir)
  console.log(label, JSON.stringify(out))
}

await tryFetch('before file access:')

// Turn on "Allow access to file URLs" the same way the toggle on chrome://extensions does.
const page = await ctx.newPage()
await page.goto('chrome://extensions/')
await page.evaluate(
  id =>
    chrome.developerPrivate.updateExtensionConfiguration({
      extensionId: id,
      fileAccess: true,
    }),
  id,
)
await page.waitForTimeout(1500)
await tryFetch('after file access:')

await ctx.close()
