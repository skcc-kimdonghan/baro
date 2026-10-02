"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { PublicationHistoryEntry } from "@/components/publication-history-panel";
import {
  getBrowserLocalDataStore,
  notifyLocalDataChanged,
  subscribeToLocalDataChanges,
} from "@/lib/browser-local-data.mjs";
import { copyArticle } from "@/lib/clipboard.mjs";
import {
  createHistoryEntry,
  createHistoryIdFromContent,
  removeHistoryEntry,
  upsertHistoryEntry,
} from "@/lib/publication-history.mjs";
import {
  isCurrentRequestGeneration,
  shouldReportRequestFailure,
} from "@/lib/request-generation.mjs";

type ComparisonResult = NonNullable<PublicationHistoryEntry["comparison"]>;

type SaveHistoryInput = {
  historyId: string | null;
  title: string;
  preparedText: string;
  publishedText: string;
  comparison: ComparisonResult;
  isCurrent?: () => boolean;
};

export function usePublicationHistory() {
  const [entries, setEntries] = useState<readonly PublicationHistoryEntry[]>([]);
  const entriesRef = useRef(entries);
  const requestRevisionRef = useRef(0);
  const [warning, setWarning] = useState("");

  const refresh = useCallback(async () => {
    const requestRevision = ++requestRevisionRef.current;
    try {
      const store = getBrowserLocalDataStore();
      const migration = await store.prepare();
      const loaded = await store.read("publicationHistory") as {
        entries: readonly PublicationHistoryEntry[];
      };
      if (requestRevision === requestRevisionRef.current) {
        entriesRef.current = loaded.entries;
        setEntries(loaded.entries);
        setWarning(migration.warning ?? "");
      }
    } catch (caughtError) {
      if (requestRevision === requestRevisionRef.current) {
        setWarning(caughtError instanceof Error ? caughtError.message : "로컬 DB의 발행 히스토리를 불러오지 못했습니다.");
      }
    }
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refresh(), 0);
    const unsubscribe = subscribeToLocalDataChanges("publicationHistory", () => void refresh());
    return () => {
      window.clearTimeout(initialRefresh);
      unsubscribe();
    };
  }, [refresh]);

  const saveComparison = useCallback(async (input: SaveHistoryInput) => {
    const mutationRevision = ++requestRevisionRef.current;
    if (input.isCurrent && !input.isCurrent()) {
      return { status: "stale", historyId: null } as const;
    }
    const previousHistoryId = input.historyId;
    const historyId = previousHistoryId ?? createHistoryIdFromContent(input.title, input.preparedText);
    const timestamp = new Date().toISOString();
    let previousEntry: PublicationHistoryEntry | null = null;
    try {
      const store = getBrowserLocalDataStore();
      const saved = await store.mutate(
        "publicationHistory",
        (persisted: readonly PublicationHistoryEntry[]) => {
          if (input.isCurrent && !input.isCurrent()) {
            throw Object.assign(new Error("오래된 비교 요청입니다."), { code: "STALE_PUBLICATION_COMPARISON" });
          }
          const existing = persisted.find((entry) => entry.id === historyId);
          previousEntry = existing ?? null;
          const entry = createHistoryEntry({
            id: historyId,
            title: input.title,
            preparedText: input.preparedText,
            publishedText: input.publishedText,
            comparison: input.comparison,
            completedAt: existing?.completedAt ?? timestamp,
            updatedAt: timestamp,
          });
          return upsertHistoryEntry(persisted, entry);
        },
      ) as { entries: readonly PublicationHistoryEntry[] };
      if (input.isCurrent && !input.isCurrent()) {
        await store.mutate(
          "publicationHistory",
          (persisted: readonly PublicationHistoryEntry[]) => {
            const written = persisted.find((entry) => entry.id === historyId);
            if (written?.updatedAt !== timestamp) return persisted;
            if (previousEntry) return upsertHistoryEntry(removeHistoryEntry(persisted, historyId), previousEntry);
            return removeHistoryEntry(persisted, historyId);
          },
        );
        notifyLocalDataChanged("publicationHistory");
        return { status: "stale", historyId: null } as const;
      }
      if (!saved.entries.some((entry) => entry.id === historyId)) {
        throw new Error("새 비교 기록이 DB 저장 한도에 포함되지 않았습니다.");
      }
      if (isCurrentRequestGeneration(mutationRevision, requestRevisionRef.current)) {
        entriesRef.current = saved.entries;
        setEntries(saved.entries);
        setWarning("");
      } else {
        void refresh();
      }
      notifyLocalDataChanged("publicationHistory");
      toast.success(
        input.comparison.status === "match" && input.comparison.formatting?.status === "match"
          ? "내용과 서식이 일치하며 로컬 DB에 저장했습니다."
          : "내용·서식 비교 결과를 로컬 DB 히스토리에 저장했습니다.",
      );
      return { status: "saved", historyId, entries: saved.entries } as const;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "STALE_PUBLICATION_COMPARISON") {
        return { status: "stale", historyId: null } as const;
      }
      if (shouldReportRequestFailure(mutationRevision, requestRevisionRef.current)) {
        setWarning(error instanceof Error ? error.message : "발행 히스토리에 저장하지 못했습니다.");
        toast.error("비교는 완료했지만 로컬 DB 히스토리에 저장하지 못했습니다.");
      } else {
        void refresh();
      }
      return { status: "failed", historyId: previousHistoryId, error } as const;
    }
  }, [refresh]);

  const copy = useCallback(async (text: string, label: string) => {
    try {
      await copyArticle({ html: text, plainText: text }, "plain");
      toast.success(`${label}를 복사했습니다.`);
    } catch (caughtError) {
      toast.error(caughtError instanceof Error ? caughtError.message : `${label}를 복사하지 못했습니다.`);
    }
  }, []);

  const remove = useCallback(async (entryId: string) => {
    const mutationRevision = ++requestRevisionRef.current;
    try {
      const saved = await getBrowserLocalDataStore().mutate(
        "publicationHistory",
        (persisted: readonly PublicationHistoryEntry[]) => removeHistoryEntry(persisted, entryId),
      ) as { entries: readonly PublicationHistoryEntry[] };
      const savedEntries = saved.entries;
      if (isCurrentRequestGeneration(mutationRevision, requestRevisionRef.current)) {
        entriesRef.current = savedEntries;
        setEntries(savedEntries);
        setWarning("");
      } else {
        void refresh();
      }
      notifyLocalDataChanged("publicationHistory");
      toast.success("발행 기록을 삭제했습니다.");
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "발행 기록을 삭제하지 못했습니다.";
      if (shouldReportRequestFailure(mutationRevision, requestRevisionRef.current)) {
        setWarning(message);
        toast.error(message);
      } else {
        void refresh();
      }
    }
  }, [refresh]);

  const clear = useCallback(async () => {
    const mutationRevision = ++requestRevisionRef.current;
    try {
      const saved = await getBrowserLocalDataStore().mutate("publicationHistory", () => []) as {
        entries: readonly PublicationHistoryEntry[];
      };
      const cleared = saved.entries;
      if (isCurrentRequestGeneration(mutationRevision, requestRevisionRef.current)) {
        entriesRef.current = cleared;
        setEntries(cleared);
        setWarning("");
      } else {
        void refresh();
      }
      notifyLocalDataChanged("publicationHistory");
      toast.success("발행 히스토리를 모두 삭제했습니다.");
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "발행 히스토리를 삭제하지 못했습니다.";
      if (shouldReportRequestFailure(mutationRevision, requestRevisionRef.current)) {
        setWarning(message);
        toast.error(message);
      } else {
        void refresh();
      }
    }
  }, [refresh]);

  return { entries, warning, saveComparison, copy, remove, clear } as const;
}
