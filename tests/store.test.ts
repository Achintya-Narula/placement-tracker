import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { createApplication } from '../src/domain/application.ts';
import { JsonStore } from '../src/store/json-store.ts';

async function withStore(run: (store: JsonStore, file: string) => Promise<void>) {
  const parent = join(process.cwd(), '.test-tmp');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'placement-store-'));
  const file = join(directory, 'data.json');
  try {
    const store = new JsonStore(file);
    await store.init();
    await run(store, file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('persists users and enforces unique normalized emails', async () => {
  await withStore(async (store, file) => {
    const created = await store.createUser({
      id: 'user-1',
      email: ' Student@Example.com ',
      passwordHash: 'scrypt$one$two',
      createdAt: '2026-09-06T10:00:00.000Z',
    });

    assert.equal(created.email, 'student@example.com');
    assert.equal((await store.findUserByEmail('STUDENT@example.com'))?.id, 'user-1');
    await assert.rejects(
      store.createUser({ id: 'user-2', email: 'student@example.com', passwordHash: 'hash', createdAt: 'now' }),
      /Email is already registered/,
    );
    const disk = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(disk.users.length, 1);
  });
});

test('scopes application CRUD to the owner and supports search filters', async () => {
  await withStore(async (store) => {
    const alpha = createApplication({ company: 'Acme Labs', role: 'Backend Intern' }, 'user-1', new Date(), 'app-1');
    const beta = createApplication({ company: 'Beta Corp', role: 'Frontend Engineer' }, 'user-1', new Date(), 'app-2');
    const privateApp = createApplication({ company: 'Secret Co', role: 'Engineer' }, 'user-2', new Date(), 'app-3');
    await store.addApplication(alpha);
    await store.addApplication(beta);
    await store.addApplication(privateApp);

    assert.deepEqual((await store.listApplications('user-1')).map((item) => item.id).sort(), ['app-1', 'app-2']);
    assert.deepEqual((await store.listApplications('user-1', { query: 'backend' })).map((item) => item.id), ['app-1']);
    assert.deepEqual((await store.listApplications('user-1', { status: 'SAVED' })).map((item) => item.id).sort(), ['app-1', 'app-2']);
    assert.equal(await store.getApplication('user-1', 'app-3'), undefined);
    assert.equal(await store.deleteApplication('user-1', 'app-3'), false);

    const changed = { ...alpha, notes: 'Updated', updatedAt: '2026-09-07T00:00:00.000Z' };
    assert.equal((await store.replaceApplication('user-1', changed))?.notes, 'Updated');
    assert.equal(await store.deleteApplication('user-1', 'app-2'), true);
    assert.deepEqual((await store.listApplications('user-1')).map((item) => item.id), ['app-1']);
  });
});

test('rescheduling a follow-up removes its old reminder without affecting another application', async () => {
  await withStore(async (store) => {
    const first = createApplication({ company: 'Acme', role: 'Engineer', followUpDate: '2026-09-06' }, 'user-1', new Date(), 'app-1');
    const second = createApplication({ company: 'Beta', role: 'Developer', followUpDate: '2026-09-06' }, 'user-1', new Date(), 'app-2');
    await store.addApplication(first);
    await store.addApplication(second);
    await store.addReminders([first, second].map((application) => ({
      id: `${application.id}:2026-09-06`,
      userId: 'user-1',
      applicationId: application.id,
      followUpDate: '2026-09-06',
      message: `Follow up with ${application.company} about ${application.role}`,
      createdAt: '2026-09-06T12:00:00.000Z',
    })));

    await store.replaceApplication('user-1', { ...first, followUpDate: '2026-09-20' });

    assert.deepEqual((await store.listReminders('user-1')).map((reminder) => reminder.id), ['app-2:2026-09-06']);
  });
});

test('closing an application removes its outstanding reminder', async () => {
  await withStore(async (store) => {
    const application = createApplication({ company: 'Acme', role: 'Engineer', followUpDate: '2026-09-06' }, 'user-1', new Date(), 'app-1');
    await store.addApplication(application);
    await store.addReminders([{
      id: 'app-1:2026-09-06',
      userId: 'user-1',
      applicationId: 'app-1',
      followUpDate: '2026-09-06',
      message: 'Follow up with Acme about Engineer',
      createdAt: '2026-09-06T12:00:00.000Z',
    }]);

    await store.replaceApplication('user-1', { ...application, status: 'REJECTED' });

    assert.deepEqual(await store.listReminders('user-1'), []);
  });
});

test('a stale reminder generated before rescheduling or closing cannot be inserted afterward', async () => {
  await withStore(async (store) => {
    for (const [id, update] of [
      ['rescheduled', { followUpDate: '2026-09-20' }],
      ['closed', { status: 'REJECTED' as const }],
    ] as const) {
      const application = createApplication(
        { company: 'Acme', role: 'Engineer', followUpDate: '2026-09-06' }, 'user-1', new Date(), id,
      );
      await store.addApplication(application);
      const stale = {
        id: `${id}:2026-09-06`,
        userId: 'user-1',
        applicationId: id,
        followUpDate: '2026-09-06',
        message: 'Follow up with Acme about Engineer',
        createdAt: '2026-09-06T12:00:00.000Z',
      };
      await store.replaceApplication('user-1', { ...application, ...update });

      assert.deepEqual(await store.addReminders([stale]), []);
    }
    assert.deepEqual(await store.listReminders('user-1'), []);
  });
});

test('normalizes legacy applications that do not have stage dates', async () => {
  const parent = join(process.cwd(), '.test-tmp');
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, 'placement-legacy-'));
  const file = join(directory, 'data.json');
  try {
    await writeFile(file, JSON.stringify({
      users: [],
      reminders: [],
      applications: [{
        id: 'legacy-1',
        userId: 'user-1',
        company: 'Legacy Co',
        role: 'Engineer',
        location: '',
        applicationUrl: '',
        deadline: '',
        followUpDate: '',
        notes: 'Preserve me',
        status: 'SAVED',
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      }],
    }));
    const store = new JsonStore(file);
    await store.init();
    const [application] = await store.listApplications('user-1');
    assert.equal(application.notes, 'Preserve me');
    assert.deepEqual(application.stageDates, {
      APPLIED: '', ASSESSMENT: '', INTERVIEW: '', OFFER: '',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
