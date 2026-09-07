#!/usr/bin/env node
/**
 * Screenshot a set of routes at phone widths and FAIL on horizontal overflow.
 *
 * Ported in spirit from jan-portal's `scripts/mobile-sweep.mjs`, which catches
 * the one class of bug that neither tsc, eslint nor a unit test can see: a table
 * or a header that is 40px too wide at 360px. The portal's version is wired to
 * its own session minting and to WSL paths; this one is a plain crawler, so it
 * takes the routes to sweep as arguments.
 *
 *   node scripts/mobile-sweep.mjs /competitors/fakes /stock
 *   BASE=http://localhost:3000 OUT=/tmp/shots node scripts/mobile-sweep.mjs /
 *
 * Exit code is the number of (route, width) pairs that overflowed, so it can
 * gate anything that cares. Screenshots land in OUT (default /tmp/jan-sweep).
 *
 * playwright is not a dependency of this app — the script borrows an installed
 * `playwright-core` and a chromium from the shared ms-playwright cache, and
 * says so plainly when it cannot find either rather than failing obscurely.
 */
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const BASE = process.env.BASE || 'http://localhost:3000'
const OUT = process.env.OUT || '/tmp/jan-sweep'
const WIDTHS = (process.env.WIDTHS || '360,390,430').split(',').map(Number)
const ROUTES = process.argv.slice(2)

if (!ROUTES.length) {
  console.error('usage: node scripts/mobile-sweep.mjs <route> [route...]')
  process.exit(2)
}

/** First existing path, or null. */
const firstOf = (candidates) => candidates.find(p => p && existsSync(p)) ?? null

function findPlaywright() {
  const npx = path.join(homedir(), '.npm/_npx')
  const fromNpx = existsSync(npx)
    ? readdirSync(npx).map(d => path.join(npx, d, 'node_modules/playwright-core/index.mjs'))
    : []
  return firstOf([
    process.env.PLAYWRIGHT_CORE,
    path.resolve('node_modules/playwright-core/index.mjs'),
    ...fromNpx,
  ])
}

/** Newest chromium (or headless shell) in the shared browser cache. */
function findChromium() {
  const cache = path.join(homedir(), 'Library/Caches/ms-playwright')
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH
  if (!existsSync(cache)) return null
  const dirs = readdirSync(cache)
    .filter(d => d.startsWith('chromium'))
    // Highest build number wins; the names sort lexically the wrong way (1169
    // after 1234), so compare the trailing number.
    .sort((a, b) => Number(b.split('-').pop()) - Number(a.split('-').pop()))
  for (const d of dirs) {
    const hit = firstOf([
      path.join(cache, d, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
      path.join(cache, d, 'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium'),
      path.join(cache, d, 'chrome-headless-shell-mac/chrome-headless-shell'),
      path.join(cache, d, 'chrome-headless-shell-mac-arm64/chrome-headless-shell'),
    ])
    if (hit) return hit
  }
  return null
}

const pwPath = findPlaywright()
const exec = findChromium()
if (!pwPath || !exec) {
  console.error(
    `cannot run: ${!pwPath ? 'no playwright-core found' : ''}${!pwPath && !exec ? ' and ' : ''}${
      !exec ? 'no chromium in ~/Library/Caches/ms-playwright' : ''
    }.\nSet PLAYWRIGHT_CORE / CHROMIUM_PATH, or run: npx playwright install chromium`,
  )
  process.exit(2)
}

const { chromium } = await import(pwPath)
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch({ executablePath: exec })
const failures = []

for (const width of WIDTHS) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 },
    isMobile: width < 700,
    hasTouch: width < 700,
    deviceScaleFactor: 2,
    locale: 'he-IL',
  })
  const page = await ctx.newPage()
  const consoleErrors = []
  page.on('console', m => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 200)))

  for (const route of ROUTES) {
    const name = route.replace(/^\//, '').replace(/[/?=&]/g, '-') || 'home'
    await page.goto(BASE + route, { waitUntil: 'networkidle', timeout: 45_000 }).catch(() => {})
    // Tables and charts settle a frame or two after the fetch resolves.
    await page.waitForTimeout(2000)

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement
      if (doc.scrollWidth <= window.innerWidth + 1) return null
      const offenders = []
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect()
        if (r.width === 0 || r.height === 0) continue
        // In RTL the page runs the other way, so BOTH edges are checked.
        if (r.right > window.innerWidth + 1 || r.left < -1) {
          if (offenders.length < 5) {
            offenders.push(
              `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} [${Math.round(r.left)}..${Math.round(r.right)}]`,
            )
          }
        }
      }
      return { scrollWidth: doc.scrollWidth, innerWidth: window.innerWidth, offenders }
    })

    // `animations: 'disabled'` is not optional here. A fullPage capture resizes
    // the viewport, which REPLAYS CSS entrance animations — so a staggered
    // table photographs as a page of blank rows that look like missing data.
    // Disabling pins every animation at its end state instead.
    await page.screenshot({
      path: path.join(OUT, `${name}-${width}.png`),
      fullPage: true,
      animations: 'disabled',
    })

    if (overflow) {
      failures.push({ route, width, ...overflow })
      console.log(`✗ ${route} @${width}: scrollWidth ${overflow.scrollWidth} > ${overflow.innerWidth}`)
      for (const o of overflow.offenders) console.log(`    ${o}`)
    } else {
      console.log(`✓ ${route} @${width}`)
    }
  }

  if (consoleErrors.length) {
    console.log(`  console errors @${width}: ${[...new Set(consoleErrors)].slice(0, 3).join(' | ')}`)
  }
  await ctx.close()
}

await browser.close()
console.log(`\n${failures.length ? `${failures.length} overflow(s)` : 'no overflow'} · shots in ${OUT}`)
process.exit(failures.length)
