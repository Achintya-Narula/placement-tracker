export function applicationPayload(entries) {
  const {
    stageAppliedDate = '',
    stageAssessmentDate = '',
    stageInterviewDate = '',
    stageOfferDate = '',
    ...fields
  } = entries;
  return {
    ...fields,
    stageDates: {
      APPLIED: stageAppliedDate,
      ASSESSMENT: stageAssessmentDate,
      INTERVIEW: stageInterviewDate,
      OFFER: stageOfferDate,
    },
  };
}

export function applicationRequest(applicationId, payload) {
  return {
    path: applicationId === null
      ? '/api/applications'
      : `/api/applications/${encodeURIComponent(applicationId)}`,
    method: applicationId === null ? 'POST' : 'PATCH',
    body: JSON.stringify(payload),
  };
}

export async function completeApplicationSubmission({
  form,
  values,
  createApplication,
  closeDialog,
  refresh,
}) {
  await createApplication(values);
  form.reset();
  closeDialog();
  await refresh();
}
