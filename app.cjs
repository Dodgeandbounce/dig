// Startup file for cPanel "Setup Node.js App" (Phusion Passenger).
// Passenger loads the startup file with require(), so this shim hands off to
// the ES-module server with a dynamic import. Passenger also takes over
// listen(), so PORT doesn't matter there. app.js and server.js are identical
// copies, since cPanel's starter apps use those names.
process.env.BASE_PATH ??= '/dig';
import('./server/index.js').catch((err) => {
  console.error('Failed to start Do I Go? server:', err);
  process.exit(1);
});
