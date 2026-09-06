import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canTransition,
  createApplication,
  updateApplication,
  type ApplicationStatus,
} from '../src/domain/application.ts';

test('allows only forward workflow transitions and rejection from active stages', () => {
  const cases: Array<[ApplicationStatus, ApplicationStatus, boolean]> = [
    ['SAVED', 'APPLIED', true],
    ['APPLIED', 'ASSESSMENT', true],
    ['ASSESSMENT', 'INTERVIEW', true],
    ['INTERVIEW', 'OFFER', true],
    ['SAVED', 'REJECTED', true],
    ['INTERVIEW', 'REJECTED', true],
    ['APPLIED', 'SAVED', false],
    ['OFFER', 'REJECTED', false],
    ['REJECTED', 'APPLIED', false],
    ['SAVED', 'INTERVIEW', false],
  ];

  for (const [from, to, expected] of cases) {
    assert.equal(canTransition(from, to), expected, `${from} -> ${to}`);
  }
});

test('creates a normalized application for its owner', () => {
  const created = createApplication(
    {
      company: '  Acme Labs ',
      role: ' Backend Intern ',
      location: 'Hyderabad',
      applicationUrl: 'https://example.com/jobs/42',
      deadline: '2026-09-20',
      followUpDate: '2026-09-12',
      notes: ' Referral submitted ',
    },
    'user-1',
    new Date('2026-09-06T12:00:00.000Z'),
    'app-1',
  );

  assert.deepEqual(created, {
    id: 'app-1',
    userId: 'user-1',
    company: 'Acme Labs',
    role: 'Backend Intern',
    location: 'Hyderabad',
    applicationUrl: 'https://example.com/jobs/42',
    deadline: '2026-09-20',
    followUpDate: '2026-09-12',
    notes: 'Referral submitted',
    stageDates: {
      APPLIED: '',
      ASSESSMENT: '',
      INTERVIEW: '',
      OFFER: '',
    },
    status: 'SAVED',
    createdAt: '2026-09-06T12:00:00.000Z',
    updatedAt: '2026-09-06T12:00:00.000Z',
  });
});

test('rejects missing company and invalid URLs', () => {
  assert.throws(
    () => createApplication({ company: ' ', role: 'Engineer' }, 'user-1', new Date(), 'app-1'),
    /Company is required/,
  );
  assert.throws(
    () => createApplication({ company: 'Acme', role: 'Engineer', applicationUrl: 'javascript:alert(1)' }, 'user-1', new Date(), 'app-1'),
    /Application URL must use http or https/,
  );
});

test('updates fields and enforces status transitions', () => {
  const existing = createApplication(
    { company: 'Acme', role: 'Engineer' },
    'user-1',
    new Date('2026-09-06T12:00:00.000Z'),
    'app-1',
  );
  const updated = updateApplication(
    existing,
    { status: 'APPLIED', notes: '  Sent via careers page ' },
    new Date('2026-09-07T08:00:00.000Z'),
  );

  assert.equal(updated.status, 'APPLIED');
  assert.equal(updated.notes, 'Sent via careers page');
  assert.equal(updated.updatedAt, '2026-09-07T08:00:00.000Z');

  const rescheduled = updateApplication(
    updated,
    {
      deadline: '2026-10-02',
      followUpDate: '2026-09-18',
      stageDates: { ASSESSMENT: '2026-09-25', INTERVIEW: '2026-10-01' },
    },
    new Date('2026-09-08T08:00:00.000Z'),
  );
  assert.equal(rescheduled.deadline, '2026-10-02');
  assert.equal(rescheduled.followUpDate, '2026-09-18');
  assert.deepEqual(rescheduled.stageDates, {
    APPLIED: '',
    ASSESSMENT: '2026-09-25',
    INTERVIEW: '2026-10-01',
    OFFER: '',
  });
  assert.throws(
    () => updateApplication(updated, { stageDates: { INTERVIEW: '25/09/2026' } }, new Date()),
    /INTERVIEW date must use YYYY-MM-DD/,
  );
  assert.throws(
    () => updateApplication(updated, { status: 'SAVED' }, new Date()),
    /Cannot move application from APPLIED to SAVED/,
  );
});
