import {
  createHistoryEntry,
  createHistoryIdFromContent,
  loadPublicationHistory,
  savePublicationHistory,
  upsertHistoryEntry,
} from "./publication-history.mjs";

function staleResult() {
  return Object.freeze({ status: "stale", historyId: null });
}

export async function savePublicationComparison({
  storage,
  withLock,
  historyId: requestedHistoryId,
  title,
  preparedText,
  publishedText,
  comparison,
  isCurrent = () => true,
  now = () => new Date().toISOString(),
}) {
  if (!isCurrent()) return staleResult();

  const previousHistoryId = requestedHistoryId ?? null;
  const historyId = previousHistoryId ?? createHistoryIdFromContent(title, preparedText);
  try {
    const savedEntries = await withLock(() => {
      if (!isCurrent()) return null;
      const persisted = loadPublicationHistory(storage).entries;
      const existingEntry = persisted.find((entry) => entry.id === historyId);
      const timestamp = now();
      const historyEntry = createHistoryEntry({
        id: historyId,
        title,
        preparedText,
        publishedText,
        comparison,
        completedAt: existingEntry?.completedAt ?? timestamp,
        updatedAt: timestamp,
      });
      const nextEntries = upsertHistoryEntry(persisted, historyEntry);
      return savePublicationHistory(storage, nextEntries);
    });

    if (!savedEntries) return staleResult();
    if (!savedEntries.some((entry) => entry.id === historyId)) {
      return Object.freeze({
        status: "failed",
        historyId: previousHistoryId,
        error: new Error("새 비교 기록이 저장 한도에 포함되지 않았습니다."),
      });
    }
    return Object.freeze({ status: "saved", historyId, entries: savedEntries });
  } catch (error) {
    return Object.freeze({ status: "failed", historyId: previousHistoryId, error });
  }
}
