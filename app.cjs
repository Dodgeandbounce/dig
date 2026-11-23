// Startup file for cPanel "Setup Node.js App" (Phusion Passenger).
// Passenger loads the startup file with require(), so this CommonJS shim
// hands off to the ES-module server. Passenger also takes over listen(),
// so PORT doesn't matter there.
import('./server/index.js').catch((err) => {
  console.error('Failed to start Do I Go? server:', err);
  process.exit(1);
});
