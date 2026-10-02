"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  createArticleBundleId,
  removeArticleBundle,
  upsertArticleBundle,
} from "@/lib/article-bundles.mjs";
import {
  getBrowserLocalDataStore,
  notifyLocalDataChanged,
  subscribeToLocalDataChanges,
} from "@/lib/browser-local-data.mjs";
import {
  isCurrentRequestGeneration,
  shouldReportRequestFailure,
} from "@/lib/request-generation.mjs";

export type ArticleBundleEntry = {
  schemaVersion: 1;
  id: string;
  displayTitle: string;
  sourceText: string;
  headerColor: string;
  articleTitles: readonly string[];
  createdAt: string;
  updatedAt: string;
};

type SaveArticleBundleInput = {
  sourceText: string;
  headerColor: string;
  articleTitles: readonly string[];
};

export function useArticleBundles() {
  const [entries, setEntries] = useState<readonly ArticleBundleEntry[]>([]);
  const entriesRef = useRef(entries);
  const requestRevisionRef = useRef(0);
  const [warning, setWarning] = useState("");

  const applyEntries = useCallback((nextEntries: readonly ArticleBundleEntry[]) => {
    entriesRef.current = nextEntries;
    setEntries(nextEntries);
  }, []);

  const refresh = useCallback(async () => {
    const requestRevision = ++requestRevisionRef.current;
    try {
      const store = getBrowserLocalDataStore();
      const migration = await store.prepare();
      const loaded = await store.read("articleBundles") as {
        entries: readonly ArticleBundleEntry[];
      };
      if (requestRevision === requestRevisionRef.current) {
        applyEntries(loaded.entries);
        setWarning(migration.warning ?? "");
      }
    } catch (caughtError) {
      if (requestRevision === requestRevisionRef.current) {
        setWarning(caughtError instanceof Error ? caughtError.message : "로컬 DB의 글뭉치를 불러오지 못했습니다.");
      }
    }
  }, [applyEntries]);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refresh(), 0);
    const unsubscribe = subscribeToLocalDataChanges("articleBundles", () => void refresh());
    return () => {
      window.clearTimeout(initialRefresh);
      unsubscribe();
    };
  }, [refresh]);

  const save = useCallback(async (input: SaveArticleBundleInput) => {
    const mutationRevision = ++requestRevisionRef.current;
    try {
      const timestamp = new Date().toISOString();
      let wasUpdate = false;
      let expectedCount = 0;
      const id = createArticleBundleId(input.sourceText);
      const saved = await getBrowserLocalDataStore().mutate("articleBundles", (persisted: readonly ArticleBundleEntry[]) => {
        const id = createArticleBundleId(input.sourceText);
        const existing = persisted.find((entry) => entry.id === id);
        wasUpdate = Boolean(existing);
        expectedCount = persisted.length + (existing ? 0 : 1);
        const nextEntry = {
          schemaVersion: 1,
          id,
          sourceText: input.sourceText,
          headerColor: input.headerColor,
          articleTitles: [...input.articleTitles],
          createdAt: existing?.createdAt ?? timestamp,
          updatedAt: timestamp,
        } as const;
        return upsertArticleBundle(persisted, nextEntry) as readonly ArticleBundleEntry[];
      }) as { entries: readonly ArticleBundleEntry[] };
      const savedEntries = saved.entries;
      if (!savedEntries.some((entry) => entry.id === id)) {
        throw new Error("글뭉치가 DB 저장 목록에 남지 않았습니다. 오래된 글뭉치를 삭제한 뒤 다시 시도해 주세요.");
      }

      const droppedCount = Math.max(0, expectedCount - savedEntries.length);
      if (isCurrentRequestGeneration(mutationRevision, requestRevisionRef.current)) {
        applyEntries(savedEntries);
        setWarning(droppedCount > 0 ? `저장 한도 때문에 오래된 글뭉치 ${droppedCount}건을 목록에서 제외했습니다.` : "");
      } else {
        void refresh();
      }
      notifyLocalDataChanged("articleBundles");
      toast.success(wasUpdate ? "저장한 글뭉치를 최신 내용으로 바꿨습니다." : "글뭉치를 로컬 DB에 저장했습니다.");
      return savedEntries.find((entry) => entry.id === id) ?? null;
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "글뭉치를 저장하지 못했습니다.";
      if (shouldReportRequestFailure(mutationRevision, requestRevisionRef.current)) {
        setWarning(message);
        toast.error(message);
      } else {
        void refresh();
      }
      return null;
    }
  }, [applyEntries, refresh]);

  const remove = useCallback(async (entryId: string) => {
    const mutationRevision = ++requestRevisionRef.current;
    try {
      const saved = await getBrowserLocalDataStore().mutate(
        "articleBundles",
        (persisted: readonly ArticleBundleEntry[]) => removeArticleBundle(persisted, entryId),
      ) as { entries: readonly ArticleBundleEntry[] };
      const savedEntries = saved.entries;
      if (isCurrentRequestGeneration(mutationRevision, requestRevisionRef.current)) {
        applyEntries(savedEntries);
        setWarning("");
      } else {
        void refresh();
      }
      notifyLocalDataChanged("articleBundles");
      toast.success("저장한 글뭉치를 삭제했습니다.");
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "글뭉치를 삭제하지 못했습니다.";
      if (shouldReportRequestFailure(mutationRevision, requestRevisionRef.current)) {
        setWarning(message);
        toast.error(message);
      } else {
        void refresh();
      }
    }
  }, [applyEntries, refresh]);

  const clear = useCallback(async () => {
    const mutationRevision = ++requestRevisionRef.current;
    try {
      const saved = await getBrowserLocalDataStore().mutate("articleBundles", () => []) as {
        entries: readonly ArticleBundleEntry[];
      };
      const cleared = saved.entries;
      if (isCurrentRequestGeneration(mutationRevision, requestRevisionRef.current)) {
        applyEntries(cleared);
        setWarning("");
      } else {
        void refresh();
      }
      notifyLocalDataChanged("articleBundles");
      toast.success("저장한 글뭉치를 모두 삭제했습니다.");
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "글뭉치를 모두 삭제하지 못했습니다.";
      if (shouldReportRequestFailure(mutationRevision, requestRevisionRef.current)) {
        setWarning(message);
        toast.error(message);
      } else {
        void refresh();
      }
    }
  }, [applyEntries, refresh]);

  return { entries, warning, save, remove, clear } as const;
}
