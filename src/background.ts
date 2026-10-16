import storage from '@/core/storage'
import commands from '@/core/commands'
import { parseDirListing } from '@/core/dir-listing'

chrome.runtime.onMessage.addListener(({ action, data }, sender, callback) => {
  messageHandler(action, data, sender, callback)
  return true
})

async function messageHandler(
  action: string,
  data: any,
  sender: chrome.runtime.MessageSender,
  callback?: (response?: any) => void,
) {
  switch (action) {
    case 'storage':
      await storage.set({ [data.key]: data.value })
      updatePage(data.key, data.value)
      callback?.(data)
      break
    case 'fetch':
      fetchData(sender.url).then(callback)
      break
    case 'listDir':
      listDir(data?.url).then(callback)
      break
    case 'fetchText':
      fetchText(data?.url).then(callback)
      break
  }
}

// Only local files: the side panel never needs to read other origins.
const isFileUrl = (url?: string) =>
  typeof url === 'string' && url.startsWith('file://')

async function listDir(url?: string) {
  if (!isFileUrl(url)) return { error: 'Not a file:// URL' }
  try {
    const html = await (await fetch(url)).text()
    return { entries: parseDirListing(html, url) }
  } catch (err) {
    return { error: String(err?.message ?? err) }
  }
}

async function fetchText(url?: string) {
  if (!isFileUrl(url)) return { error: 'Not a file:// URL' }
  try {
    return { text: await (await fetch(url)).text() }
  } catch (err) {
    return { error: String(err?.message ?? err) }
  }
}

async function fetchData(url?: string) {
  if (!url) {
    const error = new Error('Fetch error: URL is undefined.')
    console.error(error)
    return error.message
  }

  return fetch(url)
    .then(res => res.text())
    .catch(err => {
      console.error(err)
      return err.message
    })
}

// Chrome extension shortcuts
chrome.commands.onCommand.addListener(action => {
  commands[action]?.(messageHandler)
})

const actionMap = {
  enable: 'reload',
  refresh: 'toggleRefresh',
  centered: 'toggleCentered',
  mdPlugins: 'updateMdPlugins',
  pageTheme: 'updatePageTheme',
  hiddenSide: 'toggleSide',
}

function updatePage(key: keyof typeof actionMap, value?: any) {
  const action = actionMap[key]
  action &&
    chrome.tabs.query({ currentWindow: true, active: true }, tabs => {
      tabs.length &&
        chrome.tabs.sendMessage(tabs[0].id, { action, data: { key, value } })
    })
}
