import {
  applicationPayload,
  applicationRequest,
  completeApplicationSubmission,
} from './application-form.js';
import { applicationPresentation } from './application-view.js';

const state = {
  token: sessionStorage.getItem('placement-token'),
  applications: [],
  mode: 'login',
  editingApplicationId: null,
};
const stages = ['SAVED', 'APPLIED', 'ASSESSMENT', 'INTERVIEW', 'OFFER'];
const byId = (id) => document.getElementById(id);

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'content-type': 'application/json',
      ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(body.error?.message || 'Request failed');
  return body;
}

function setAuthenticated(authenticated) {
  byId('auth-view').classList.toggle('hidden', authenticated);
  byId('dashboard-view').classList.toggle('hidden', !authenticated);
  byId('logout-button').classList.toggle('hidden', !authenticated);
}

function selectMode(mode) {
  state.mode = mode;
  const registering = mode === 'register';
  byId('login-tab').classList.toggle('active', !registering);
  byId('login-tab').setAttribute('aria-selected', String(!registering));
  byId('register-tab').classList.toggle('active', registering);
  byId('register-tab').setAttribute('aria-selected', String(registering));
  byId('auth-submit').textContent = registering ? 'Create account' : 'Sign in';
  byId('password').autocomplete = registering ? 'new-password' : 'current-password';
  byId('auth-message').textContent = '';
}

function formatDate(value) {
  if (!value) return 'Not set';
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00Z`));
}

function nextStage(status) {
  const index = stages.indexOf(status);
  return index >= 0 && index < stages.length - 1 ? stages[index + 1] : null;
}

function updateStats() {
  byId('stat-total').textContent = state.applications.length;
  byId('stat-active').textContent = state.applications.filter((item) => !['OFFER', 'REJECTED'].includes(item.status)).length;
  byId('stat-interviews').textContent = state.applications.filter((item) => item.status === 'INTERVIEW').length;
  byId('stat-offers').textContent = state.applications.filter((item) => item.status === 'OFFER').length;
}

function renderDate(element, date) {
  element.classList.toggle('date-overdue', date.overdue);
  element.textContent = date.iso
    ? `${formatDate(date.iso)}${date.overdue ? ' · Overdue' : ''}`
    : 'Not set';
}

function formControl(name) {
  return byId('application-form').elements.namedItem(name);
}

function closeApplicationDialog() {
  state.editingApplicationId = null;
  byId('application-form-message').textContent = '';
  byId('application-dialog').close();
}

function openCreateDialog() {
  state.editingApplicationId = null;
  byId('application-form').reset();
  byId('application-form-message').textContent = '';
  byId('application-dialog-eyebrow').textContent = 'NEW OPPORTUNITY';
  byId('application-dialog-title').textContent = 'Add application';
  byId('application-submit').textContent = 'Save application';
  byId('application-dialog').showModal();
}

function openEditDialog(application) {
  state.editingApplicationId = application.id;
  const values = {
    company: application.company,
    role: application.role,
    location: application.location,
    applicationUrl: application.applicationUrl,
    deadline: application.deadline,
    followUpDate: application.followUpDate,
    notes: application.notes,
    stageAppliedDate: application.stageDates?.APPLIED ?? '',
    stageAssessmentDate: application.stageDates?.ASSESSMENT ?? '',
    stageInterviewDate: application.stageDates?.INTERVIEW ?? '',
    stageOfferDate: application.stageDates?.OFFER ?? '',
  };
  for (const [name, value] of Object.entries(values)) formControl(name).value = value ?? '';
  byId('application-form-message').textContent = '';
  byId('application-dialog-eyebrow').textContent = 'UPDATE OPPORTUNITY';
  byId('application-dialog-title').textContent = 'Edit application';
  byId('application-submit').textContent = 'Save changes';
  byId('application-dialog').showModal();
}

function renderApplications() {
  const list = byId('application-list');
  list.replaceChildren();
  updateStats();
  if (state.applications.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<strong>No applications here yet.</strong><span>Add an opportunity or change your filters.</span>';
    list.append(empty);
    return;
  }
  for (const application of state.applications) {
    const card = byId('application-template').content.firstElementChild.cloneNode(true);
    const presentation = applicationPresentation(application, new Date().toISOString().slice(0, 10));
    card.querySelector('.application-role').textContent = application.role;
    card.querySelector('.application-company').textContent = application.company;
    card.querySelector('.application-location').textContent = application.location || 'Remote / unspecified';
    renderDate(card.querySelector('.application-deadline'), presentation.deadline);
    renderDate(card.querySelector('.application-followup'), presentation.followUpDate);
    const stageDate = card.querySelector('.application-stage-date');
    if (presentation.currentStageDate) {
      card.querySelector('.application-stage-label').textContent = presentation.currentStageDate.label;
      renderDate(card.querySelector('.application-stage-value'), presentation.currentStageDate);
    } else {
      stageDate.classList.add('hidden');
    }
    const notes = card.querySelector('.application-notes');
    if (presentation.notes) {
      notes.textContent = presentation.notes;
      notes.classList.remove('hidden');
    }
    const link = card.querySelector('.application-link');
    if (application.applicationUrl) {
      link.href = application.applicationUrl;
      link.classList.remove('hidden');
    }
    const pill = card.querySelector('.status-pill');
    pill.textContent = application.status.replace('_', ' ');
    pill.dataset.status = application.status;
    const advance = card.querySelector('.advance-button');
    const next = nextStage(application.status);
    if (next) {
      advance.textContent = `Move to ${next.toLowerCase()}`;
      advance.addEventListener('click', () => changeStatus(application.id, next));
    } else {
      advance.remove();
    }
    const reject = card.querySelector('.reject-button');
    if (['OFFER', 'REJECTED'].includes(application.status)) reject.remove();
    else reject.addEventListener('click', () => changeStatus(application.id, 'REJECTED'));
    card.querySelector('.edit-button').addEventListener('click', () => openEditDialog(application));
    card.querySelector('.delete-button').addEventListener('click', () => removeApplication(application.id));
    list.append(card);
  }
}

async function loadApplications() {
  const query = new URLSearchParams();
  const search = byId('search-input').value.trim();
  const status = byId('status-filter').value;
  if (search) query.set('q', search);
  if (status) query.set('status', status);
  const body = await api(`/api/applications?${query}`);
  state.applications = body.applications;
  renderApplications();
}

async function changeStatus(id, status) {
  try {
    await api(`/api/applications/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ status }) });
    await Promise.all([loadApplications(), loadReminders(true)]);
  } catch (error) {
    byId('applications-message').textContent = error.message;
  }
}

async function removeApplication(id) {
  if (!window.confirm('Delete this application and its reminders?')) return;
  try {
    await api(`/api/applications/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await Promise.all([loadApplications(), loadReminders()]);
  } catch (error) {
    byId('applications-message').textContent = error.message;
  }
}

async function loadReminders(generate = false) {
  if (generate) await api('/api/reminders/generate', { method: 'POST', body: '{}' });
  const { reminders } = await api('/api/reminders');
  const list = byId('reminder-list');
  list.replaceChildren();
  if (reminders.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No reminders due.';
    list.append(empty);
    return;
  }
  for (const reminder of reminders) {
    const item = document.createElement('article');
    item.className = 'reminder';
    const message = document.createElement('strong');
    message.textContent = reminder.message;
    const date = document.createElement('span');
    date.textContent = `Due ${formatDate(reminder.followUpDate)}`;
    item.append(message, date);
    list.append(item);
  }
}

byId('login-tab').addEventListener('click', () => selectMode('login'));
byId('register-tab').addEventListener('click', () => selectMode('register'));
byId('auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  byId('auth-message').textContent = '';
  const form = new FormData(event.currentTarget);
  try {
    const { token } = await api(`/api/auth/${state.mode}`, {
      method: 'POST',
      body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
    });
    state.token = token;
    sessionStorage.setItem('placement-token', token);
    setAuthenticated(true);
    await Promise.all([loadApplications(), loadReminders(true)]);
  } catch (error) {
    byId('auth-message').textContent = error.message;
  }
});

byId('logout-button').addEventListener('click', () => {
  state.token = null;
  state.applications = [];
  sessionStorage.removeItem('placement-token');
  setAuthenticated(false);
});
byId('new-application-button').addEventListener('click', openCreateDialog);
byId('close-dialog').addEventListener('click', closeApplicationDialog);
byId('cancel-dialog').addEventListener('click', closeApplicationDialog);
byId('application-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const values = applicationPayload(Object.fromEntries(new FormData(formElement)));
  const editing = state.editingApplicationId !== null;
  const request = applicationRequest(state.editingApplicationId, values);
  byId('application-form-message').textContent = '';
  try {
    await completeApplicationSubmission({
      form: formElement,
      values,
      createApplication: () => api(request.path, { method: request.method, body: request.body }),
      closeDialog: closeApplicationDialog,
      refresh: () => Promise.all([loadApplications(), loadReminders(true)]),
    });
    const message = byId('applications-message');
    message.textContent = editing ? 'Application updated.' : 'Application added.';
    message.classList.add('success');
  } catch (error) {
    byId('application-form-message').textContent = error.message;
  }
});

let searchTimer;
byId('search-input').addEventListener('input', () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(loadApplications, 180);
});
byId('status-filter').addEventListener('change', loadApplications);
byId('generate-reminders').addEventListener('click', () => loadReminders(true));

setAuthenticated(Boolean(state.token));
if (state.token) Promise.all([loadApplications(), loadReminders(true)]).catch(() => {
  sessionStorage.removeItem('placement-token');
  state.token = null;
  setAuthenticated(false);
});
