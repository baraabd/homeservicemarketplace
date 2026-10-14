// R27 — preloaded into a profiled API process only (node --require).
//
// Windows cannot deliver a catchable SIGINT to a windowless child, and V8
// writes a --cpu-prof profile only on a normal exit. The harness therefore
// asks over the IPC channel it opened, and the process exits cleanly.
if (typeof process.send === 'function') {
  process.on('message', (message) => {
    if (message === 'r27:exit') process.exit(0);
  });
  // Do not let the IPC channel alone keep the process alive.
  process.channel?.unref();
}
