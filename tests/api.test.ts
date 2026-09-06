import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createApiServer } from '../src/http/api.ts';
import { JsonStore } from '../src/store/json-store.ts';

interface ResponseBody {
  token?: string;
  application?: {
    id: string;
    status: string;
    notes?: string;
    deadline?: string;
    followUpDate?: string;
    stageDates?: Record<string, string>;
  };
  applications?: Array<{ id: string; company: string }>;
  reminders?: Array<{ id: string }>;
  error?: { code: string; message: string };
}

test('supports authenticated application CRUD and prevents cross-user access', async () => {
  const parent = join(process.cwd(), '.test-tmp');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'placement-api-'));
  const store = new JsonStore(join(directory, 'data.json'));
  await store.init();
  const server = createApiServer({
    store,
    jwtSecret: 'integration-secret',
    now: () => new Date('2026-09-06T12:00:00.000Z'),
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  async function request(path: string, options: RequestInit = {}) {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) as ResponseBody : {} };
  }

  try {
    const firstRegistration = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'first@example.com', password: 'password-one' }),
    });
    assert.equal(firstRegistration.status, 201);
    assert.ok(firstRegistration.body.token);

    const login = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'first@example.com', password: 'password-one' }),
    });
    assert.equal(login.status, 200);
    assert.ok(login.body.token);
    const firstAuth = { authorization: `Bearer ${login.body.token}` };

    const created = await request('/api/applications', {
      method: 'POST',
      headers: firstAuth,
      body: JSON.stringify({
        company: 'Acme Labs',
        role: 'Backend Intern',
        followUpDate: '2026-09-05',
      }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.body.application?.status, 'SAVED');
    const applicationId = created.body.application?.id;
    assert.ok(applicationId);

    const edited = await request(`/api/applications/${applicationId}`, {
      method: 'PATCH',
      headers: firstAuth,
      body: JSON.stringify({
        notes: 'Technical assessment confirmed',
        deadline: '2026-09-30',
        followUpDate: '2026-09-06',
        stageDates: { ASSESSMENT: '2026-09-24' },
      }),
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.body.application?.notes, 'Technical assessment confirmed');
    assert.equal(edited.body.application?.deadline, '2026-09-30');
    assert.equal(edited.body.application?.followUpDate, '2026-09-06');
    assert.equal(edited.body.application?.stageDates?.ASSESSMENT, '2026-09-24');

    const listed = await request('/api/applications?q=backend&status=SAVED', { headers: firstAuth });
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.body.applications?.map((item) => item.company), ['Acme Labs']);

    const invalidTransition = await request(`/api/applications/${applicationId}`, {
      method: 'PATCH',
      headers: firstAuth,
      body: JSON.stringify({ status: 'INTERVIEW' }),
    });
    assert.equal(invalidTransition.status, 400);
    assert.equal(invalidTransition.body.error?.code, 'VALIDATION_ERROR');

    const generated = await request('/api/reminders/generate', { method: 'POST', headers: firstAuth, body: '{}' });
    const generatedAgain = await request('/api/reminders/generate', { method: 'POST', headers: firstAuth, body: '{}' });
    assert.equal(generated.status, 201);
    assert.equal(generated.body.reminders?.length, 1);
    assert.equal(generatedAgain.body.reminders?.length, 0);

    const secondRegistration = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email: 'second@example.com', password: 'password-two' }),
    });
    const secondAuth = { authorization: `Bearer ${secondRegistration.body.token}` };

    const privateRead = await request(`/api/applications/${applicationId}`, { headers: secondAuth });
    assert.equal(privateRead.status, 404);
    const privateEdit = await request(`/api/applications/${applicationId}`, {
      method: 'PATCH',
      headers: secondAuth,
      body: JSON.stringify({ notes: 'Not allowed' }),
    });
    assert.equal(privateEdit.status, 404);
    const privateDelete = await request(`/api/applications/${applicationId}`, { method: 'DELETE', headers: secondAuth });
    assert.equal(privateDelete.status, 404);

    const ownerDelete = await request(`/api/applications/${applicationId}`, { method: 'DELETE', headers: firstAuth });
    assert.equal(ownerDelete.status, 204);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('returns consistent errors for malformed JSON and missing authentication', async () => {
  const parent = join(process.cwd(), '.test-tmp');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'placement-errors-'));
  const store = new JsonStore(join(directory, 'data.json'));
  await store.init();
  const server = createApiServer({ store, jwtSecret: 'integration-secret' });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const unauthenticated = await fetch(`${baseUrl}/api/applications`);
    assert.equal(unauthenticated.status, 401);
    assert.deepEqual(await unauthenticated.json(), {
      error: { code: 'UNAUTHORIZED', message: 'Authentication is required' },
    });

    const malformed = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{bad json',
    });
    assert.equal(malformed.status, 400);
    assert.deepEqual(await malformed.json(), {
      error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON' },
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('serves the dashboard and blocks path traversal', async () => {
  const parent = join(process.cwd(), '.test-tmp');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'placement-static-'));
  const publicDirectory = join(directory, 'public');
  await mkdir(publicDirectory);
  await writeFile(join(publicDirectory, 'index.html'), '<h1>Placement Tracker</h1>');
  await writeFile(join(publicDirectory, 'app.js'), 'console.log("tracker")');
  const store = new JsonStore(join(directory, 'data.json'));
  await store.init();
  const server = createApiServer({ store, jwtSecret: 'integration-secret', publicDirectory });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const home = await fetch(`${baseUrl}/`);
    assert.equal(home.status, 200);
    assert.equal(home.headers.get('content-type'), 'text/html; charset=utf-8');
    assert.equal(await home.text(), '<h1>Placement Tracker</h1>');

    const script = await fetch(`${baseUrl}/app.js`);
    assert.equal(script.status, 200);
    assert.equal(script.headers.get('content-type'), 'text/javascript; charset=utf-8');

    const traversal = await fetch(`${baseUrl}/..%2Fdata.json`);
    assert.equal(traversal.status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
