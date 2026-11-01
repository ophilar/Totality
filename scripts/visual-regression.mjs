/**
 * Real-app comparison harness. Run from the 0.5 checkout; Playwright and Sharp
 * are installed by the visual-regression workflow, not the application runtime.
 */
import { mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { _electron as electron, chromium } from 'playwright'
import sharp from 'sharp'

const [command, ...args] = process.argv.slice(2)
const viewportSizes = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
}
const screens = ['dashboard', 'movies', 'tv', 'music', 'wishlist', 'settings', 'movie-search']
const port = 9470

function requireArgs(n) {
  if (args.length !== n) throw new Error('Expected ' + n + ' arguments for ' + command)
}
function fail(commandName, result) {
  if (result.status !== 0) throw new Error(commandName + ': ' + (result.stderr?.toString() || result.error?.message || 'failed'))
}
function createMovie(location) {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', '4', '-c:v', 'mpeg4', '-q:v', '4', '-c:a', 'aac', '-shortest', location], { encoding: 'utf8' })
  fail('ffmpeg movie fixture', result)
}
async function generateMedia(root) {
  const folders = [
    path.join(root, 'Movies'),
    path.join(root, 'TV Shows', 'Regression Orbit', 'Season 01'),
    path.join(root, 'Music', 'Regression Ensemble', 'Regression Album'),
  ]
  for (const folder of folders) await mkdir(folder, { recursive: true })
  createMovie(path.join(folders[0], 'Regression Atlas (2024).mp4'))
  createMovie(path.join(folders[1], 'Regression Orbit - S01E01.mkv'))
  const music = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'lavfi', '-i', 'sine=frequency=523:sample_rate=44100', '-t', '4',
    '-metadata', 'artist=Regression Ensemble', '-metadata', 'album=Regression Album',
    '-metadata', 'title=Regression Theme', '-c:a', 'libmp3lame', '-q:a', '3',
    path.join(folders[2], '01 - Regression Theme.mp3')], { encoding: 'utf8' })
  fail('ffmpeg music fixture', music)
}
async function waitForScans(page) {
  try {
    await page.waitForFunction(async () => {
      const state = await window.electronAPI.taskQueueGetState()
      return !state.currentTask && state.queue.length === 0 && state.completedTasks.length >= 3
    }, null, { timeout: 90_000, polling: 1000 })
  } catch (error) {
    const state = await page.evaluate(() => window.electronAPI.taskQueueGetState())
    throw new Error('Real media scan did not finish: ' + JSON.stringify(state), { cause: error })
  }
  const state = await page.evaluate(() => window.electronAPI.taskQueueGetState())
  const failures = state.completedTasks.filter(task => task.status !== 'completed')
  if (failures.length) throw new Error('Real media scanning failed: ' + JSON.stringify(failures))
}
async function seedViaRealApplication(page, root) {
  const libraries = [
    { name: 'Movies', path: path.join(root, 'Movies'), mediaType: 'movies', enabled: true },
    { name: 'TV Shows', path: path.join(root, 'TV Shows'), mediaType: 'tvshows', enabled: true },
    { name: 'Music', path: path.join(root, 'Music'), mediaType: 'music', enabled: true },
  ]
  await page.evaluate(async ({ folderPath, libraries }) => {
    const api = window.electronAPI
    const source = await api.localAddSourceWithLibraries({
      folderPath,
      displayName: 'Visual Regression Media',
      libraries,
    })
    const sourceLibraries = await api.sourcesGetLibraries(source.source_id)
    if (sourceLibraries.length !== libraries.length) {
      throw new Error('Expected ' + libraries.length + ' real libraries, got ' + sourceLibraries.length)
    }
    for (const library of sourceLibraries) {
      await api.taskQueueAddTask({
        type: library.type === 'music' ? 'music-scan' : 'library-scan',
        label: 'Visual comparison scan ' + library.name,
        sourceId: source.source_id,
        libraryId: library.id,
      })
    }
  }, { folderPath: root, libraries })
  await waitForScans(page)
}
async function startApplication(appRoot, profile) {
  const appRequire = createRequire(path.join(appRoot, 'package.json'))
  const executablePath = appRequire('electron')
  const electronApp = await electron.launch({
    executablePath,
    args: ['--no-sandbox', '--disable-gpu', '--enable-logging=stderr', appRoot],
    cwd: appRoot,
    env: {
      ...process.env,
      XDG_CONFIG_HOME: path.join(profile, 'xdg'),
      HOME: path.join(profile, 'home'),
      ELECTRON_DISABLE_SECURITY_WARNINGS: 'true',
    },
    timeout: 90_000,
  })
  const diagnostics = []
  const proc = electronApp.process()
  proc.stderr?.on('data', chunk => {
    const message = String(chunk)
    diagnostics.push(message)
    process.stderr.write(message)
  })
  proc.stdout?.on('data', chunk => {
    const message = String(chunk)
    diagnostics.push(message)
    process.stdout.write(message)
  })
  try {
    await electronApp.firstWindow({ timeout: 20_000 })
    // Electron opens docked DevTools in development builds. Playwright may
    // report DevTools as the first page, so select the exact real app URL.
    const appUrl = pathToFileURL(path.join(appRoot, 'dist', 'index.html')).href
    const page = electronApp.windows().find(window => window.url() === appUrl)
    if (!page) throw new Error('Application window not found at ' + appUrl + '. Windows: ' + electronApp.windows().map(w => w.url()).join(', '))
    page.on('pageerror', error => console.error('[Electron renderer]', error))
    page.on('console', message => {
      if (message.type() === 'error') console.error('[Electron console]', message.text())
    })
    await page.waitForFunction(() => Boolean(window.electronAPI?.taskQueueGetState), null, { timeout: 15_000 })
    const userData = await electronApp.evaluate(({ app, BrowserWindow }) => {
      BrowserWindow.getAllWindows().forEach(win => win.webContents.closeDevTools())
      return app.getPath('userData')
    })
    return { electronApp, page, userData }
  } catch (error) {
    const windows = electronApp.windows()
    console.error('[Electron startup diagnostics]', JSON.stringify({
      appRoot,
      windows: await Promise.all(windows.map(async page => ({
        url: page.url(),
        title: await page.title().catch(e => String(e)),
        body: await page.locator('body').innerText({ timeout: 2000 }).then(s => s.slice(0, 1000)).catch(e => String(e)),
      }))),
      output: diagnostics.join('').slice(-12000),
    }, null, 2))
    await electronApp.close()
    throw error
  }
}
async function configureWeb(page, pin) {
  await page.evaluate(async ({ port, pin }) => {
    const api = window.electronAPI
    await api.setSetting('web_access_https', 'false')
    await api.setSetting('web_access_port', String(port))
    await api.setSetting('web_access_pin', pin)
    await api.setSetting('web_access_enabled', 'true')
    const status = await api.webAccessStart()
    if (status.success === false) throw new Error(status.message || 'Web server failed')
  }, { port, pin })
}
async function navigate(page, screen, viewport) {
  const tabs = {
    dashboard: 'Dashboard',
    movies: 'Movies',
    tv: 'TV Shows',
    music: 'Music',
    'movie-search': 'Movies',
  }
  if (tabs[screen]) {
    if (screen === 'dashboard' && viewport === 'mobile') return false
    await page.getByRole('tablist', { name: 'Navigation' }).getByRole('tab', { name: tabs[screen], exact: true }).click()
  } else if (screen === 'wishlist') {
    if (viewport === 'mobile') {
      await page.getByRole('tablist', { name: 'Navigation' }).getByRole('tab', { name: 'Wishlist' }).click()
    } else {
      await page.getByRole('button', { name: 'Toggle wishlist panel' }).click()
    }
  } else if (screen === 'settings') {
    if (viewport === 'mobile') return false
    await page.getByRole('button', { name: /settings/i }).first().click()
    await page.getByRole('dialog').waitFor()
  }
  if (screen === 'movie-search') {
    if (viewport === 'mobile') return false
    const input = page.getByRole('textbox', { name: 'Search all libraries' })
    await input.fill('Regression Atlas')
    await page.getByText('Regression Atlas', { exact: false }).first().waitFor()
  }
  return true
}
async function shootApp(appRoot, mediaRoot, outputDir, version, seedDb) {
  const profile = path.join(outputDir, 'profiles', version)
  await mkdir(path.join(profile, 'home'), { recursive: true })
  await mkdir(path.join(profile, 'xdg'), { recursive: true })
  let instance = await startApplication(appRoot, profile)
  let completed = false
  try {
  if (seedDb) {
    const dbPath = path.join(instance.userData, 'totality-v2.db')
    await instance.electronApp.close()
    instance = null
    await rm(dbPath + '-wal', { force: true })
    await rm(dbPath + '-shm', { force: true })
    await copyFile(seedDb, dbPath)
    instance = await startApplication(appRoot, profile)
  } else {
    await seedViaRealApplication(instance.page, mediaRoot)
  }
  const dbPath = path.join(instance.userData, 'totality-v2.db')
  if (!existsSync(dbPath)) throw new Error('Expected application database missing: ' + dbPath)
  const pin = String(randomInt(100000, 999999))
  const results = { version, dbPath, screenshots: {}, interactions: {}, errors: [] }
  const browser = await chromium.launch({ headless: true })
  try {
    await configureWeb(instance.page, pin)
    const context = await browser.newContext({ viewport: viewportSizes.desktop, locale: 'en-US', colorScheme: 'dark', deviceScaleFactor: 1, reducedMotion: 'reduce' })
    const page = await context.newPage()
    page.on('pageerror', error => results.errors.push('Page error: ' + error.message))
    await page.goto('http://127.0.0.1:' + port + '/', { waitUntil: 'domcontentloaded' })
    await page.getByPlaceholder('Enter PIN').fill(pin)
    await page.getByRole('button', { name: 'Unlock' }).click()
    await page.getByRole('tablist', { name: 'Navigation' }).first().waitFor({ timeout: 30_000 })
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }' })
    await page.evaluate(() => sessionStorage.setItem('splashShown', 'true'))
    for (const [viewport, size] of Object.entries(viewportSizes)) {
      await page.setViewportSize(size)
      for (const screen of screens) {
        const key = viewport + '/' + screen
        try {
          await page.reload({ waitUntil: 'domcontentloaded' })
          await page.getByRole('tablist', { name: 'Navigation' }).first().waitFor({ timeout: 20_000 })
          const included = await navigate(page, screen, viewport)
          if (!included) continue
          await page.evaluate(async () => { await document.fonts.ready })
          const file = path.join(outputDir, version, viewport, screen + '.png')
          await mkdir(path.dirname(file), { recursive: true })
          await page.screenshot({ path: file, animations: 'disabled', fullPage: false })
          results.screenshots[key] = path.relative(outputDir, file).replaceAll(path.sep, '/')
          results.interactions[key] = 'passed'
        } catch (error) {
          results.interactions[key] = 'FAILED: ' + String(error)
          results.errors.push(key + ': ' + String(error))
        }
      }
    }
    await context.close()
  } finally {
    await browser.close()
  }
  await writeFile(path.join(outputDir, version + '.json'), JSON.stringify(results, null, 2))
  completed = true
  return results
  } finally {
    if (instance) {
      if (completed) await instance.electronApp.close()
      else instance.electronApp.process().kill('SIGKILL')
    }
  }
}
function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
}
async function compareImages(reference, candidate, output) {
  const a = await sharp(reference).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const b = await sharp(candidate).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  if (a.info.width !== b.info.width || a.info.height !== b.info.height) throw new Error('Screenshot dimensions differ')
  const overlay = Buffer.alloc(a.data.length)
  let changed = 0
  for (let i = 0; i < a.data.length; i += 4) {
    const difference = Math.max(Math.abs(a.data[i] - b.data[i]), Math.abs(a.data[i + 1] - b.data[i + 1]), Math.abs(a.data[i + 2] - b.data[i + 2]))
    const gray = Math.round((b.data[i] + b.data[i + 1] + b.data[i + 2]) / 3)
    if (difference > 24) {
      changed++
      overlay[i] = 255
      overlay[i + 1] = 0
      overlay[i + 2] = 180
    } else {
      overlay[i] = gray
      overlay[i + 1] = gray
      overlay[i + 2] = gray
    }
    overlay[i + 3] = 255
  }
  await sharp(overlay, { raw: { width: a.info.width, height: a.info.height, channels: 4 } }).png().toFile(output)
  return { changed, total: a.info.width * a.info.height }
}
async function report(outputDir) {
  const baseline = JSON.parse(await readFile(path.join(outputDir, '0.4.2.json'), 'utf8'))
  const candidate = JSON.parse(await readFile(path.join(outputDir, '0.5.json'), 'utf8'))
  const keys = [...new Set([...Object.keys(baseline.interactions), ...Object.keys(candidate.interactions)])].sort()
  const rows = []
  let failed = false
  for (const key of keys) {
    const a = baseline.screenshots[key]
    const b = candidate.screenshots[key]
    const statusA = baseline.interactions[key] || 'not captured'
    const statusB = candidate.interactions[key] || 'not captured'
    let percent = '—'
    let overlayFile = ''
    if (a && b) {
      overlayFile = 'diffs/' + key.replace('/', '-') + '.png'
      await mkdir(path.join(outputDir, 'diffs'), { recursive: true })
      const metrics = await compareImages(path.join(outputDir, a), path.join(outputDir, b), path.join(outputDir, overlayFile))
      percent = (100 * metrics.changed / metrics.total).toFixed(2) + '%'
    }
    if (statusA.startsWith('FAILED') || statusB.startsWith('FAILED') || Boolean(a) !== Boolean(b)) failed = true
    const cell = file => file ? '<a href="' + encodeURI(file) + '"><img loading="lazy" src="' + encodeURI(file) + '"></a>' : 'not captured'
    rows.push('<tr><th>' + escapeHtml(key) + '</th><td>' + cell(a) + '</td><td>' + cell(b) + '</td><td>' + cell(overlayFile) +
      '</td><td>' + percent + '<p>' + escapeHtml(statusA) + ' / ' + escapeHtml(statusB) + '</p></td></tr>')
  }
  const html = '<!doctype html><html lang="en"><meta charset="utf-8"><title>Totality UI 0.4.2 vs 0.5</title>' +
    '<style>body{font:14px system-ui;background:#17181c;color:#f8f9fa;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #555;padding:10px;vertical-align:top}img{width:100%;max-width:400px}p{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#90caff}</style>' +
    '<h1>Totality 0.4.2 vs 0.5 — real application visual comparison</h1><p>Identical fixtures and separate profiles. Pixel changes are diagnostic, not automatic regressions; a human must classify intentional redesigns.</p>' +
    '<table><thead><tr><th>Scenario</th><th>0.4.2</th><th>0.5</th><th>Pixel overlay</th><th>Changed pixels / result</th></tr></thead><tbody>' +
    rows.join('') + '</tbody></table><h2>Errors</h2><pre>' + escapeHtml(JSON.stringify({ baseline: baseline.errors, candidate: candidate.errors }, null, 2)) + '</pre></html>'
  await writeFile(path.join(outputDir, 'index.html'), html)
  if (failed) throw new Error('Interaction or screenshot capture failures; review index.html')
}
try {
  if (command === 'fixtures') {
    requireArgs(1)
    await generateMedia(path.resolve(args[0]))
  } else if (command === 'capture') {
    requireArgs(5)
    const [appRoot, mediaRoot, outputDir, version, seedDb] = args
    await mkdir(outputDir, { recursive: true })
    await shootApp(path.resolve(appRoot), path.resolve(mediaRoot), path.resolve(outputDir), version, seedDb === '-' ? null : path.resolve(seedDb))
  } else if (command === 'report') {
    requireArgs(1)
    await report(path.resolve(args[0]))
  } else {
    throw new Error('Usage: visual-regression.mjs fixtures MEDIA_DIR | capture APP_ROOT MEDIA_DIR OUTPUT_DIR VERSION DB_OR_- | report OUTPUT_DIR')
  }
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
