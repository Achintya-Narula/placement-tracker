import test from 'node:test';
import assert from 'node:assert/strict';

import { createApplication } from '../src/domain/application.ts';
import { buildDueReminders } from '../src/domain/reminders.ts';

test('creates reminders only for the owner when follow-up is due', () => {
  const due = createApplication(
    { company: 'Acme', role: 'Backend Intern', followUpDate: '2026-09-06' },
    'user-1', new Date(), 'app-1',
  );
  const future = createApplication(
    { company: 'Beta', role: 'Engineer', followUpDate: '2026-09-08' },
    'user-1', new Date(), 'app-2',
  );
  const otherUser = createApplication(
    { company: 'Private', role: 'Engineer', followUpDate: '2026-09-01' },
    'user-2', new Date(), 'app-3',
  );

  const reminders = buildDueReminders(
    [due, future, otherUser],
    [],
    'user-1',
    '2026-09-06',
    new Date('2026-09-06T12:00:00.000Z'),
  );

  assert.deepEqual(reminders, [{
    id: 'app-1:2026-09-06',
    userId: 'user-1',
    applicationId: 'app-1',
    followUpDate: '2026-09-06',
    message: 'Follow up with Acme about Backend Intern',
    createdAt: '2026-09-06T12:00:00.000Z',
  }]);
});

test('does not duplicate an existing reminder on repeated generation', () => {
  const application = createApplication(
    { company: 'Acme', role: 'Backend Intern', followUpDate: '2026-09-06' },
    'user-1', new Date(), 'app-1',
  );
  const existing = [{
    id: 'app-1:2026-09-06',
    userId: 'user-1',
    applicationId: 'app-1',
    followUpDate: '2026-09-06',
    message: 'Follow up with Acme about Backend Intern',
    createdAt: '2026-09-06T09:00:00.000Z',
  }];

  assert.deepEqual(buildDueReminders([application], existing, 'user-1', '2026-09-06'), []);
});

test('ignores applications without a follow-up date and closed applications', () => {
  const missingDate = createApplication({ company: 'Acme', role: 'Intern' }, 'user-1', new Date(), 'app-1');
  const rejected = { ...createApplication(
    { company: 'Beta', role: 'Engineer', followUpDate: '2026-09-01' },
    'user-1', new Date(), 'app-2',
  ), status: 'REJECTED' as const };

  assert.deepEqual(buildDueReminders([missingDate, rejected], [], 'user-1', '2026-09-06'), []);
});
