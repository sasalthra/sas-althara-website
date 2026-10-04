export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') return;
  if (process.env.NEXT_PHASE === 'phase-production-build' || process.env.npm_lifecycle_event === 'build') return;
  const {startSheetSyncInterval} = await import('@/lib/sheet-sync-job.server');
  startSheetSyncInterval();
}
