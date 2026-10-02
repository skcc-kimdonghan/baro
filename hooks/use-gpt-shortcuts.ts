"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  getBrowserLocalDataStore,
  notifyLocalDataChanged,
  subscribeToLocalDataChanges,
} from "@/lib/browser-local-data.mjs";
import {
  addGptShortcut,
  createGptShortcut,
  removeGptShortcut,
  updateGptShortcut,
} from "@/lib/gpt-shortcuts.mjs";
import {
  isCurrentRequestGeneration,
  shouldReportRequestFailure,
} from "@/lib/request-generation.mjs";

export type GptShortcutEntry = {
  schemaVersion: 1;
  id: string;
  name: string;
  url: string;
  createdAt: string;
  updatedAt: string;
};

type GptShortcutInput = { name: string; url: string };

function createShortcutId() {
  if (globalThis.crypto?.randomUUID) return `gpt-${globalThis.crypto.randomUUID()}`;
  return `gpt-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function useGptShortcuts() {
  const [entries, setEntries] = useState<readonly GptShortcutEntry[]>([]);
  const requestRevisionRef = useRef(0);
  const [warning, setWarning] = useState("");

  const applyEntries = useCallback((nextEntries: readonly GptShortcutEntry[]) => {
    setEntries(nextEntries);
  }, []);

  const refresh = useCallback(async () => {
    const requestRevision = ++requestRevisionRef.current;
    try {
      const store = getBrowserLocalDataStore();
      const migration = await store.prepare();
      const loaded = await store.read("shortcuts") as { entries: readonly GptShortcutEntry[] };
      if (requestRevision === requestRevisionRef.current) {
        applyEntries(loaded.entries);
        setWarning(migration.warning ?? "");
      }
    } catch (caughtError) {
      if (requestRevision === requestRevisionRef.current) {
        setWarning(caughtError instanceof Error ? caughtError.message : "로컬 DB의 바로가기를 불러오지 못했습니다.");
      }
    }
  }, [applyEntries]);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refresh(), 0);
    const unsubscribe = subscribeToLocalDataChanges("shortcuts", () => void refresh());
    return () => {
      window.clearTimeout(initialRefresh);
      unsubscribe();
    };
  }, [refresh]);

  const add = useCallback(async (input: GptShortcutInput) => {
    const mutationRevision = ++requestRevisionRef.current;
    try {
      const timestamp = new Date().toISOString();
      const created = createGptShortcut({
        schemaVersion: 1,
        id: createShortcutId(),
        name: input.name,
        url: input.url,
        createdAt: timestamp,
        updatedAt: timestamp,
      }) as GptShortcutEntry;
      const saved = await getBrowserLocalDataStore().mutate(
        "shortcuts",
        (persisted: readonly GptShortcutEntry[]) => (
          persisted.some((entry) => entry.id === created.id)
            ? persisted
            : addGptShortcut(persisted, created)
        ),
      ) as { entries: readonly GptShortcutEntry[] };
      if (!saved.entries.some((entry) => entry.id === created.id)) {
        throw new Error("추가한 바로가기가 DB 저장 목록에 남지 않았습니다. 다시 시도해 주세요.");
      }
      if (isCurrentRequestGeneration(mutationRevision, requestRevisionRef.current)) {
        applyEntries(saved.entries);
        setWarning("");
      } else {
        void refresh();
      }
      notifyLocalDataChanged("shortcuts");
      toast.success("바로가기를 추가했습니다.");
      return true;
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "바로가기를 추가하지 못했습니다.";
      if (shouldReportRequestFailure(mutationRevision, requestRevisionRef.current)) {
        setWarning(message);
        toast.error(message);
      } else {
        void refresh();
      }
      return false;
    }
  }, [applyEntries, refresh]);

  const update = useCallback(async (id: string, input: GptShortcutInput) => {
    const mutationRevision = ++requestRevisionRef.current;
    try {
      const timestamp = new Date().toISOString();
      const saved = await getBrowserLocalDataStore().mutate(
        "shortcuts",
        (persisted: readonly GptShortcutEntry[]) => updateGptShortcut(persisted, id, {
          ...input,
          updatedAt: timestamp,
        }),
      ) as { entries: readonly GptShortcutEntry[] };
      const actual = saved.entries.find((entry) => entry.id === id);
      if (!actual || actual.name !== input.name.trim()) {
        throw new Error("수정한 바로가기가 DB 저장 목록에 반영되지 않았습니다. 다시 시도해 주세요.");
      }
      if (isCurrentRequestGeneration(mutationRevision, requestRevisionRef.current)) {
        applyEntries(saved.entries);
        setWarning("");
      } else {
        void refresh();
      }
      notifyLocalDataChanged("shortcuts");
      toast.success("바로가기를 수정했습니다.");
      return true;
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "바로가기를 수정하지 못했습니다.";
      if (shouldReportRequestFailure(mutationRevision, requestRevisionRef.current)) {
        setWarning(message);
        toast.error(message);
      } else {
        void refresh();
      }
      return false;
    }
  }, [applyEntries, refresh]);

  const remove = useCallback(async (id: string) => {
    const mutationRevision = ++requestRevisionRef.current;
    try {
      const saved = await getBrowserLocalDataStore().mutate(
        "shortcuts",
        (persisted: readonly GptShortcutEntry[]) => removeGptShortcut(persisted, id),
      ) as { entries: readonly GptShortcutEntry[] };
      if (saved.entries.some((entry) => entry.id === id)) {
        throw new Error("삭제한 바로가기가 DB 저장 목록에 남아 있습니다. 다시 시도해 주세요.");
      }
      if (isCurrentRequestGeneration(mutationRevision, requestRevisionRef.current)) {
        applyEntries(saved.entries);
        setWarning("");
      } else {
        void refresh();
      }
      notifyLocalDataChanged("shortcuts");
      toast.success("바로가기를 삭제했습니다.");
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "바로가기를 삭제하지 못했습니다.";
      if (shouldReportRequestFailure(mutationRevision, requestRevisionRef.current)) {
        setWarning(message);
        toast.error(message);
      } else {
        void refresh();
      }
    }
  }, [applyEntries, refresh]);

  return { entries, warning, add, update, remove } as const;
}
