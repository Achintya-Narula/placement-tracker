import type { JobApplication } from './application.ts';
import type { ReminderRecord } from '../store/json-store.ts';

export function buildDueReminders(
  applications: JobApplication[],
  existing: ReminderRecord[],
  userId: string,
  today: string,
  now = new Date(),
): ReminderRecord[] {
  const existingIds = new Set(existing.map((reminder) => reminder.id));
  return applications
    .filter((application) =>
      application.userId === userId &&
      application.followUpDate !== '' &&
      application.followUpDate <= today &&
      application.status !== 'OFFER' &&
      application.status !== 'REJECTED')
    .map((application) => ({
      id: `${application.id}:${application.followUpDate}`,
      userId,
      applicationId: application.id,
      followUpDate: application.followUpDate,
      message: `Follow up with ${application.company} about ${application.role}`,
      createdAt: now.toISOString(),
    }))
    .filter((reminder) => !existingIds.has(reminder.id));
}
