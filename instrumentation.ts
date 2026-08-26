export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // No SQLite mirror anymore — the dashboard reads Neon Postgres directly.

    // Graceful shutdown — drain the PG pool on SIGTERM/SIGINT.
    const shutdown = async (signal: string) => {
      console.log(`${signal} received — shutting down gracefully`)
      try {
        const { getPool } = await import('./lib/db')
        const pool = await getPool()
        await pool.end()
        console.log('PG pool closed')
      } catch {}
      process.exit(0)
    }
    process.on('SIGTERM', () => shutdown('SIGTERM'))
    process.on('SIGINT', () => shutdown('SIGINT'))

    // The eBay price warmer, the 07:00 morning brief and the books live-year
    // top-up used to start here as setInterval loops inside this process.
    //
    // They are systemd timers on jan-box now — jan-ebay-prices, jan-morning-brief,
    // jan-books-refresh — calling the same /api/cron/* routes, which were already
    // the canonical entry points and are unchanged.
    //
    // Why they moved: in-process timers reset on every deploy, are invisible from
    // outside the container, have no retry, keep no history, and would double-fire
    // the moment this app runs more than one replica. `systemctl list-timers` and
    // `journalctl -u jan-ebay-prices` now answer "did it run, and what happened",
    // which nothing could answer before, and a failed run alerts to Telegram.
    //
    // Both paths take the same Redis locks, so the switchover was safe to overlap.
    // If you ever run this outside jan-box, those schedules do NOT come with it —
    // the timers are host state, not app state.
  }
}
