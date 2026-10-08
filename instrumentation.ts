export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build' || process.env.npm_lifecycle_event === 'build') return;
  const {startSheetSyncInterval} = await import('@/lib/sheet-sync-job.server');
  startSheetSyncInterval();
}

export async function onRequestError(error: unknown) {
  const {rememberRenderError} = await import('@/lib/render-error-log');
  rememberRenderError(error);
}
