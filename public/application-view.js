const stageLabels = {
  APPLIED: 'Applied date',
  ASSESSMENT: 'Assessment date',
  INTERVIEW: 'Interview date',
  OFFER: 'Offer date',
};

function dateState(value, today) {
  const iso = typeof value === 'string' ? value : '';
  return { iso, overdue: iso !== '' && iso < today };
}

export function applicationPresentation(application, today) {
  const currentStageIso = stageLabels[application.status]
    ? application.stageDates?.[application.status] ?? ''
    : '';
  return {
    notes: typeof application.notes === 'string' ? application.notes : '',
    deadline: dateState(application.deadline, today),
    followUpDate: dateState(application.followUpDate, today),
    currentStageDate: stageLabels[application.status]
      ? {
          label: stageLabels[application.status],
          ...dateState(currentStageIso, today),
        }
      : null,
  };
}
