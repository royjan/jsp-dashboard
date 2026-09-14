/**
 * Demo vehicles must not leak into the dashboard.
 *
 * The PartsLink24 brand trial scanned on 2026-09-14 (Skoda, Seat/Cupra, Audi,
 * VW, Volvo, BMW …) is marked `projects.keywords->>'demo' = 'true'` and is
 * scheduled for deletion. Nothing WRITES it into the dashboard — but the
 * dashboard reads Partly's tables live, so an Audi demo car showed up on
 * /items/4M0019902A as if it were a vehicle we work on.
 *
 * Applied at the PROJECT level, not the part: a code carried by both a demo car
 * and a real one is still a code we carry, and hiding it would be the opposite
 * mistake.
 *
 * `DASHBOARD_SHOW_DEMO_VEHICLES=1` brings them back, for checking the trial
 * from the dashboard side without editing SQL.
 */
export const SHOW_DEMO = process.env.DASHBOARD_SHOW_DEMO_VEHICLES === '1'

/** SQL fragment for a query that has `partly.projects` aliased as `p`. */
export const notDemoProject = (alias = 'p') =>
  SHOW_DEMO ? '' : ` AND coalesce(${alias}.keywords->>'demo', '') <> 'true'`

/**
 * SQL fragment for a query over `partly.global_parts` (aliased `gp`) that has
 * no project join of its own: keep a part only if some NON-demo vehicle carries
 * it, or if no vehicle carries it at all (catalogue-only codes are not demo).
 */
export const partNotOnlyOnDemoVehicles = (alias = 'gp') =>
  SHOW_DEMO
    ? ''
    : ` AND (
        NOT EXISTS (
          SELECT 1 FROM partly.project_parts pp_d
            JOIN partly.projects p_d ON p_d.id = pp_d.project_id
           WHERE pp_d.global_part_id = ${alias}.id AND pp_d.deleted_at IS NULL
        )
        OR EXISTS (
          SELECT 1 FROM partly.project_parts pp_r
            JOIN partly.projects p_r ON p_r.id = pp_r.project_id
           WHERE pp_r.global_part_id = ${alias}.id AND pp_r.deleted_at IS NULL
             AND coalesce(p_r.keywords->>'demo', '') <> 'true'
        )
      )`
