import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applicationPayload,
  applicationRequest,
  completeApplicationSubmission,
} from '../public/application-form.js';
import { applicationPresentation } from '../public/application-view.js';

test('builds create and edit requests with stage dates', () => {
  const payload = applicationPayload({
    company: ' Acme Labs ',
    role: ' Backend Intern ',
    notes: ' Prepare DSA ',
    deadline: '2026-09-30',
    followUpDate: '2026-09-18',
    stageAppliedDate: '2026-09-10',
    stageAssessmentDate: '2026-09-20',
    stageInterviewDate: '',
    stageOfferDate: '',
  });

  assert.deepEqual(payload, {
    company: ' Acme Labs ',
    role: ' Backend Intern ',
    notes: ' Prepare DSA ',
    deadline: '2026-09-30',
    followUpDate: '2026-09-18',
    stageDates: {
      APPLIED: '2026-09-10',
      ASSESSMENT: '2026-09-20',
      INTERVIEW: '',
      OFFER: '',
    },
  });
  assert.deepEqual(applicationRequest(null, payload), {
    path: '/api/applications',
    method: 'POST',
    body: JSON.stringify(payload),
  });
  assert.deepEqual(applicationRequest('app/1', payload), {
    path: '/api/applications/app%2F1',
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
});

test('presents notes and editable dates with overdue state', () => {
  const presentation = applicationPresentation({
    status: 'ASSESSMENT',
    notes: 'Prepare graphs and dynamic programming',
    deadline: '2026-09-15',
    followUpDate: '2026-09-22',
    stageDates: {
      APPLIED: '2026-09-10',
      ASSESSMENT: '2026-09-19',
      INTERVIEW: '2026-09-28',
      OFFER: '',
    },
  }, '2026-09-20');

  assert.equal(presentation.notes, 'Prepare graphs and dynamic programming');
  assert.deepEqual(presentation.deadline, { iso: '2026-09-15', overdue: true });
  assert.deepEqual(presentation.followUpDate, { iso: '2026-09-22', overdue: false });
  assert.deepEqual(presentation.currentStageDate, {
    label: 'Assessment date',
    iso: '2026-09-19',
    overdue: true,
  });
});

test('resets the captured application form after an asynchronous request', async () => {
  let currentTarget: { reset(): void } | null;
  let resetCount = 0;
  let closeCount = 0;
  let refreshCount = 0;
  const form = { reset: () => { resetCount += 1; } };
  currentTarget = form;

  const submission = completeApplicationSubmission({
    form: currentTarget,
    values: { company: 'Acme Labs', role: 'Backend Intern' },
    createApplication: async () => {
      // Browser Event.currentTarget becomes null after dispatch completes.
      currentTarget = null;
    },
    closeDialog: () => { closeCount += 1; },
    refresh: async () => { refreshCount += 1; },
  });

  await submission;
  assert.equal(currentTarget, null);
  assert.equal(resetCount, 1);
  assert.equal(closeCount, 1);
  assert.equal(refreshCount, 1);
});
