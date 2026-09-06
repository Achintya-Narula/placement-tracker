import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { createApiServer } from './http/api.ts';
import { JsonStore } from './store/json-store.ts';

const sourceDirectory = dirname(fileURLToPath(import.meta.url));
const projectDirectory = resolve(sourceDirectory, '..');
const port = Number.parseInt(process.env.PORT ?? '3000', 10);
const host = process.env.HOST ?? '127.0.0.1';
const jwtSecret = process.env.JWT_SECRET ?? 'local-development-secret-change-me';
const dataFile = process.env.DATA_FILE ?? join(projectDirectory, 'data', 'placement-tracker.json');

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required in production');
}

const store = new JsonStore(dataFile);
await store.init();
const server = createApiServer({
  store,
  jwtSecret,
  publicDirectory: join(projectDirectory, 'public'),
});

server.listen(port, host, () => {
  console.log(`Placement Tracker is running at http://${host}:${port}`);
});

function shutdown() {
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

