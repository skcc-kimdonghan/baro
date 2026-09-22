"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import type { PublicationHistoryEntry } from "@/components/publication-history-panel";
import { copyArticle } from "@/lib/clipboard.mjs";
import {
  HISTORY_STORAGE_KEY,
  clearPublicationHistory,
  loadPublicationHistory,
  removeHistoryEntry,
  savePublicationHistory,
} from "@/lib/publication-history.mjs";
import { savePublicationComparison } from "@/lib/publication-history-save.mjs";

type ComparisonResult = NonNullable<PublicationHistoryEntry["comparison"]>;

type SaveHistoryInput = {
  historyId: string | null;
  title: string;
  preparedText: string;
  publishedText: string;
  comparison: ComparisonResult;
  isCurrent?: () => boolean;
};

const HISTORY_LOCK_NAME = "naver-blog-finalizer-publication-history";

async function withHistoryLock<Result>(operation: () => Result | Promise<Result>) {
  if (globalThis.navigator?.locks?.request) {
    return globalThis.navigator.locks.request(HISTORY_LOCK_NAME, { mode: "exclusive" }, operation);
  }
  throw new Error("이 브라우저에서는 안전한 발행 히스토리 저장을 지원하지 않습니다.");
}

export function usePublicationHistory() {
  const [entries, setEntries] = useState<readonly PublicationHistoryEntry[]>([]);
  const entriesRef = useRef(entries);
  const [warning, setWarning] = useState("");

  const refresh = useCallback(() => {
    try {
      const loaded = loadPublicationHistory(window.localStorage) as {
        entries: readonly PublicationHistoryEntry[];
        warning: string;
      };
      entriesRef.current = loaded.entries;
      setEntries(loaded.entries);
      setWarning(loaded.warning);
    } catch (caughtError) {
      setWarning(caughtError instanceof Error ? caughtError.message : "발행 히스토리를 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(refresh, 0);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === HISTORY_STORAGE_KEY) refresh();
    };
    window.addEventListener("storage", handleStorage);
    return () => {
      window.clearTimeout(initialRefresh);
      window.removeEventListener("storage", handleStorage);
    };
  }, [refresh]);

  const saveComparison = useCallback(async (input: SaveHistoryInput) => {
    const result = await savePublicationComparison({
      storage: window.localStorage,
      withLock: withHistoryLock,
      ...input,
    }) as
      | { status: "saved"; historyId: string; entries: readonly PublicationHistoryEntry[] }
      | { status: "stale"; historyId: null }
      | { status: "failed"; historyId: string | null; error: unknown };

    if (result.status === "stale") return result;
    if (result.status === "saved") {
      entriesRef.current = result.entries;
      setEntries(result.entries);
      setWarning("");
      toast.success(
        input.comparison.status === "match"
          ? "발행본이 일치하며 히스토리에 저장했습니다."
          : "비교 결과를 발행 히스토리에 저장했습니다.",
      );
      return result;
    }

    setWarning(result.error instanceof Error ? result.error.message : "발행 히스토리에 저장하지 못했습니다.");
    toast.error("비교는 완료했지만 히스토리에 저장하지 못했습니다.");
    return result;
  }, []);

  const copy = useCallback(async (text: string, label: string) => {
    try {
      await copyArticle({ html: text, plainText: text }, "plain");
      toast.success(`${label}를 복사했습니다.`);
    } catch (caughtError) {
      toast.error(caughtError instanceof Error ? caughtError.message : `${label}를 복사하지 못했습니다.`);
    }
  }, []);

  const remove = useCallback(async (entryId: string) => {
    try {
      const savedEntries = await withHistoryLock(() => {
        const persisted = loadPublicationHistory(window.localStorage).entries as readonly PublicationHistoryEntry[];
        const nextEntries = removeHistoryEntry(persisted, entryId) as readonly PublicationHistoryEntry[];
        return savePublicationHistory(window.localStorage, nextEntries) as readonly PublicationHistoryEntry[];
      });
      entriesRef.current = savedEntries;
      setEntries(savedEntries);
      setWarning("");
      toast.success("발행 기록을 삭제했습니다.");
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "발행 기록을 삭제하지 못했습니다.";
      setWarning(message);
      toast.error(message);
    }
  }, []);

  const clear = useCallback(async () => {
    try {
      const cleared = await withHistoryLock(
        () => clearPublicationHistory(window.localStorage) as readonly PublicationHistoryEntry[],
      );
      entriesRef.current = cleared;
      setEntries(cleared);
      setWarning("");
      toast.success("발행 히스토리를 모두 삭제했습니다.");
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "발행 히스토리를 삭제하지 못했습니다.";
      setWarning(message);
      toast.error(message);
    }
  }, []);

  return { entries, warning, saveComparison, copy, remove, clear } as const;
}
