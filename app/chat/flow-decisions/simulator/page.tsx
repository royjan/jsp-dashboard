import { redirect } from 'next/navigation'

/**
 * The standalone Flow Decision Simulator is superseded by the Decision Observatory Tracer,
 * which decodes the plate, labels generic rules clearly, shows sim-vs-production, and verifies
 * against PSA ground truth. Redirect there. (The live dock inside the rule editor still uses
 * /api/flow-decisions/simulate for in-context "does my edit win?" feedback.)
 */
export default async function SimulatorPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const sp = await searchParams
  const raw = sp?.q ?? sp?.partDescription
  const q = typeof raw === 'string' ? raw : ''
  redirect(`/chat/flow-decisions/observatory?tab=tracer${q ? `&q=${encodeURIComponent(q)}` : ''}`)
}
