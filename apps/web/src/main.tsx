// Keep this entry independent of the application module graph. Static imports
// fail before any code in this file can run; a rejected dynamic import lets us
// retain the HTML recovery screen instead of leaving an empty root.
void import('./bootstrap')
  .then(({ mountApp }) => mountApp())
  .catch((error: unknown) => {
    console.error('[startup] Application could not start', error);
    document.getElementById('startup-loading')?.setAttribute('hidden', '');
    document.getElementById('startup-error')?.removeAttribute('hidden');
    document.getElementById('startup-retry')?.addEventListener('click', () => {
      window.location.reload();
    });
  });
