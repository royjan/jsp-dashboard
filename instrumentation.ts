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

    // Free, self-scheduling eBay price warmer (rate-limit-aware). Production only
    // so local `next dev` doesn't spend the shared Browse quota.
    if (process.env.NODE_ENV === 'production') {
      try {
        const { startEbayWarmLoop } = await import('./lib/ebay-warm-loop')
        startEbayWarmLoop()
      } catch (e) {
        console.error('[instrumentation] failed to start eBay warm loop:', e)
      }
    }
  }
}
