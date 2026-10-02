export function isCurrentRequestGeneration(startedAt, current) {
  return Number.isSafeInteger(startedAt)
    && Number.isSafeInteger(current)
    && startedAt >= 0
    && startedAt === current;
}

export function shouldReportRequestFailure(startedAt, current) {
  return isCurrentRequestGeneration(startedAt, current);
}
