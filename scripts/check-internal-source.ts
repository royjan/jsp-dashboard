/**
 * Regression guard for shipment supplier resolution. No test runner in this
 * repo — run it directly:
 *
 *   npx tsx scripts/check-internal-source.ts
 *
 * What it pins: an INTERNAL delivery carries no sender label of any kind.
 *
 * Every internal shipment sits in the single Firestore folder "לובינסקי"
 * whoever actually sent it, and the sender only appears in the free-text
 * `name`. The old code derived a label from that name against a three-name
 * whitelist and fell back to the FOLDER when it recognised nobody — so
 * `רקורד - סמי ואהרון כהן בע"מ`, a different company entirely, was presented
 * to the reader as Lubinsky's. The fixtures below are real rows (the Record
 * one is shipment kLain7etYJGVzgBEcqtH, 2026-08-19).
 *
 * The Record row and the Lubinsky row must now be INDISTINGUISHABLE, and so
 * must קאר איסט and ג'אן. That is the assertion — not that the fallback picks
 * a better default, but that there is no per-sender label left to get wrong.
 */
import { resolveShipmentSupplier } from '../lib/supplier-registry'

let failures = 0
const check = (name: string, cond: boolean, extra?: unknown) => {
  if (!cond) { failures++; console.log('FAIL', name, extra ?? '') } else console.log('ok  ', name)
}

const INTERNAL_NAMES = [
  'רקורד - סמי ואהרון כהן בע"מ — 19/08/2026',
  'משלוח לובינסקי 29.7.26',
  'משלוח לןבינסקי 3.8.26',        // the nun-for-vav typo the warehouse actually types
  'קאר איסט 12.8.26',
  "משלוח ג'אן חלפים 5.8.26",
]

for (const name of INTERNAL_NAMES) {
  const r = resolveShipmentSupplier({ name, folder: 'לובינסקי', isInternal: true }, null, null)
  check(`internal "${name.slice(0, 24)}…" is internal`, r.isInternal === true)
  // `tag` feeds the API's `supplier` field. It falls back to the folder, so a
  // non-null tag here is the folder name — i.e. "לובינסקי" — leaking back out.
  check(`internal "${name.slice(0, 24)}…" has no tag`, r.tag === null, r.tag)
  check(`internal "${name.slice(0, 24)}…" matches no supplier`, r.matchedSupplier === null, r.matchedSupplier)
  check(`internal "${name.slice(0, 24)}…" exposes no sender label`,
    !('internalSource' in r), Object.keys(r))
}

// Indistinguishable: every internal row resolves to the same shape.
const shapes = new Set(
  INTERNAL_NAMES.map((name) =>
    JSON.stringify(resolveShipmentSupplier({ name, folder: 'לובינסקי', isInternal: true }, null, null))),
)
check('every internal sender resolves identically', shapes.size === 1, [...shapes])

// The folder still travels — the UI does not show it, but dropping it from the
// payload would be a different change from dropping the label.
const rec = resolveShipmentSupplier(
  { name: INTERNAL_NAMES[0], folder: 'לובינסקי', isInternal: true }, null, null)
check('internal keeps its folder', rec.folder === 'לובינסקי', rec.folder)

// A NON-internal row must still run the four-step ladder unchanged.
const stated = resolveShipmentSupplier(
  { name: '07 Reinz 12.8.26', folder: '07', isInternal: false, supplierCode: '0000000007' }, null, null)
check('stated supplierCode wins', stated.matchedSupplier?.code === '0000000007', stated)
check('non-internal keeps its tag', stated.tag === '07', stated.tag)

const byToken = resolveShipmentSupplier({ name: '11-0526 shipment', isInternal: false }, null, null)
check('no registry -> no match, but a tag survives', byToken.matchedSupplier === null && byToken.tag === '11-0526',
  byToken)

// A registry hit on the folder, the step the internal short-circuit skips.
const registry = {
  name: (code: string) => (code === '0000000008' ? 'ספק שמונה' : null),
  resolve: (key: string | null) => (key === '08' ? { code: '0000000008', name: 'ספק שמונה' } : null),
} as unknown as Parameters<typeof resolveShipmentSupplier>[1]
const byFolder = resolveShipmentSupplier({ name: 'whatever', folder: '08', isInternal: false }, registry, null)
check('folder resolves through the registry', byFolder.matchedSupplier?.code === '0000000008', byFolder)

// ...and it must NOT resolve when the same row is internal.
const internalWithFolder = resolveShipmentSupplier(
  { name: 'whatever', folder: '08', isInternal: true }, registry, null)
check('internal never reaches the registry', internalWithFolder.matchedSupplier === null, internalWithFolder)

console.log(failures ? `\n${failures} FAILED` : '\nall checks passed')
process.exit(failures ? 1 : 0)
