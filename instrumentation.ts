export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Pre-warm SQLite cache from PostgreSQL on startup
    // Runs in background — readQuery() returns empty until sync completes
    import('./lib/sqlite').then(({ syncSqliteFromPg }) => {
      syncSqliteFromPg().catch(err => {
        console.error('[Instrumentation] SQLite sync failed:', err)
      })
    })

    // Graceful shutdown — drain DB pool on SIGTERM/SIGINT
    const shutdown = async (signal: string) => {
      console.log(`${signal} received — shutting down gracefully`)
      try {
        const { closeSqlite } = await import('./lib/sqlite')
        closeSqlite()
      } catch {}
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
  }
}
