import fs from 'node:fs/promises'
import express from 'express'

import config from "./config.json" with { type: "json" };


import { createClient } from "@libsql/client";
const db  = createClient({
  url: config["db_url"],
  authToken: config["db_token"],
});

// Constants
const isProduction = process.env.NODE_ENV === 'production'
const port = process.env.PORT || 3001
const base = process.env.BASE || '/'

// Cached production assets
const templateHtml = isProduction
  ? await fs.readFile('./dist/client/index.html', 'utf-8')
  : ''
const ssrManifest = isProduction
  ? await fs.readFile('./dist/client/.vite/ssr-manifest.json', 'utf-8')
  : undefined

  
// Create http server
const app = express()

// Add Vite or respective production middlewares
let vite
if (!isProduction) {
  const { createServer } = await import('vite')
  vite = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    base
  })
  app.use(vite.middlewares)
} else {
  const compression = (await import('compression')).default
  const sirv = (await import('sirv')).default
  app.use(compression())
  app.use(base, sirv('./dist/client', { extensions: [] }))
}

app.use('/api/apps', async (req, res) => {
  const stmt = await db.execute('SELECT apps.name, apps.icon, apps.url, apps.server_id, servers.name as server_name FROM apps INNER JOIN servers ON apps.server_id = servers.id');
  let data = []
  for(let each of stmt["rows"]) {
    data.push({"name":  each[0], "icon": each[1], "url": each[2], "server_id": each[3], "server_name": each[4]})
  }
  res.json(data);
});

app.use('/api/servers', async (req, res) => {
  const stmt = await db.execute('SELECT * FROM servers');
  let data = []
  for(let each of stmt["rows"]) {
    data.push({"id":  each[0], "name": each[1], "host": each[2], "port": each[3]})
  }
  res.json(data)
});

app.use('/api/bookmarks', async (req, res) => {
  const stmt = await db.execute('SELECT bookmarks.name, bookmarks.url, bookmarks.icon, bookmarks.category_id, bookmark_categories.name as category_name FROM bookmarks INNER JOIN bookmark_categories ON bookmarks.category_id = bookmark_categories.id');
  let data = []
  for(let each of stmt["rows"]) {
    data.push({"name":  each[0], "url": each[1], "icon": each[2], "category_id": each[3], "category_name": each[4]})
  }
  res.json(data);
});

app.use('/api/bookmark_categories', async (req, res) => {
  const stmt = await db.execute('SELECT * FROM bookmark_categories');
  let data = []
  for(let each of stmt["rows"]) {
    data.push({"id":  each[0], "name": each[1]})
  }
  res.json(data);
});

app.use('/api/settings', async (req, res) => {
  const stmt = await db.execute('SELECT * FROM settings');
  let data = []
  for(let each of stmt["rows"]) {
    data.push({"name":  each[0], "value": each[1]})
  }
  res.json(data);
});

// Serve static files
app.use('/public', express.static('public'))

// Serve HTML
app.use('*', async (req, res) => {
  try {
    const url = req.originalUrl.replace(base, '')

    let template
    let render
    if (!isProduction) {
      // Always read fresh template in development
      template = await fs.readFile('./index.html', 'utf-8')
      template = await vite.transformIndexHtml(url, template)
      render = (await vite.ssrLoadModule('/src/entry-server.js')).render
    } else {
      template = templateHtml
      render = (await import('./dist/server/entry-server.js')).render
    }

    const rendered = await render(url, ssrManifest)

    const html = template
      .replace(`<!--app-head-->`, rendered.head ?? '')
      .replace(`<!--app-html-->`, rendered.html ?? '')

    res.status(200).set({ 'Content-Type': 'text/html' }).send(html)
  } catch (e) {
    vite?.ssrFixStacktrace(e)
    console.log(e.stack)
    res.status(500).end(e.stack)
  }
})

// Start http server
app.listen(port, () => {
  console.log(`Server started at http://localhost:${port}`)
})
