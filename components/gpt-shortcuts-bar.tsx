"use client";

import { type FormEvent, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ExternalLink, Link2, Pencil, Plus, Settings2, Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type GptShortcutEntry } from "@/hooks/use-gpt-shortcuts";
import { MAX_GPT_SHORTCUT_NAME_LENGTH, MAX_GPT_SHORTCUTS } from "@/lib/gpt-shortcuts.mjs";
import {
  SHORTCUTS_DIALOG_CLASS,
  SHORTCUTS_NAV_CLASS,
  SHORTCUTS_ROW_CLASS,
  shortcutMoveControls,
} from "@/lib/gpt-shortcuts-view.mjs";

type GptShortcutsBarProps = {
  entries: readonly GptShortcutEntry[];
  warning: string;
  onAdd: (input: { name: string; url: string }) => Promise<boolean>;
  onUpdate: (id: string, input: { name: string; url: string }) => Promise<boolean>;
  onMove: (id: string, direction: "up" | "down") => Promise<void>;
  onRemove: (id: string) => Promise<void>;
};

function shortcutHost(url: string) {
  try {
    return new URL(url).hostname;
  } catch {
    return "웹사이트";
  }
}

export function GptShortcutsBar({ entries, warning, onAdd, onUpdate, onMove, onRemove }: GptShortcutsBarProps) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<GptShortcutEntry | null>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);

  const atLimit = entries.length >= MAX_GPT_SHORTCUTS;
  const isEditing = editingId !== null;

  function resetForm() {
    setEditingId(null);
    setName("");
    setUrl("");
  }

  function beginEdit(entry: GptShortcutEntry) {
    setEditingId(entry.id);
    setName(entry.name);
    setUrl(entry.url);
    window.setTimeout(() => nameInputRef.current?.focus(), 0);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || (!isEditing && atLimit)) return;
    setSubmitting(true);
    const saved = editingId
      ? await onUpdate(editingId, { name, url })
      : await onAdd({ name, url });
    setSubmitting(false);
    if (saved) resetForm();
  }

  async function handleMove(id: string, direction: "up" | "down") {
    if (movingId !== null) return;
    setMovingId(id);
    try {
      await onMove(id, direction);
    } finally {
      setMovingId(null);
    }
  }

  return (
    <div className="border-t border-[var(--line)] bg-[#f8fbf9]">
      <div className="mx-auto flex max-w-[1500px] items-center gap-2 px-4 py-2 sm:px-6 lg:px-8">
        <span className="hidden shrink-0 items-center gap-1.5 text-xs font-bold text-[#426052] sm:flex">
          <Link2 className="size-3.5" aria-hidden="true" />
          바로가기
        </span>

        <nav aria-label="자주 가는 웹사이트" className={SHORTCUTS_NAV_CLASS}>
          <div className="flex min-w-max items-center gap-2 pr-2">
            {entries.map((entry) => (
              <a
                key={entry.id}
                href={entry.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${entry.name}, 새 탭에서 열기`}
                title={`${entry.name} — ${shortcutHost(entry.url)}`}
                className="inline-flex h-8 max-w-48 shrink-0 items-center gap-1.5 rounded-full border border-[#cadbd2] bg-white px-3 text-sm font-semibold text-[#173025] shadow-xs transition hover:border-[#03c75a] hover:text-[#04783a] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#03c75a]/40"
              >
                <span className="truncate">{entry.name}</span>
                <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
              </a>
            ))}
            {entries.length === 0 && (
              <span className="text-xs text-[var(--muted-ink)]">자주 가는 웹사이트를 등록해 두세요.</span>
            )}
          </div>
        </nav>

        <Dialog
          open={open}
          onOpenChange={(nextOpen) => {
            setOpen(nextOpen);
            if (!nextOpen) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 rounded-full bg-white"
              aria-label={`바로가기 ${entries.length === 0 ? "추가" : "관리"} (${entries.length}/${MAX_GPT_SHORTCUTS})`}
            >
              {entries.length === 0 ? <Plus aria-hidden="true" /> : <Settings2 aria-hidden="true" />}
              <span className="hidden sm:inline">{entries.length === 0 ? "추가" : "관리"}</span>
              <span className="text-xs text-[var(--muted-ink)]">{entries.length}/{MAX_GPT_SHORTCUTS}</span>
            </Button>
          </DialogTrigger>
          <DialogContent className={SHORTCUTS_DIALOG_CLASS}>
            <DialogHeader>
              <DialogTitle>바로가기 관리</DialogTitle>
              <DialogDescription>
                이름과 웹사이트 주소는 현재 macOS 사용자 계정의 로컬 DB에 저장되어 재시작 후에도 유지됩니다. 공용 계정에서는 사용 후 삭제해 주세요.
              </DialogDescription>
            </DialogHeader>

            <form className="min-w-0 rounded-xl border border-[var(--line)] bg-[#f8fbf9] p-4" onSubmit={handleSubmit}>
              <div className="mb-3 flex items-center justify-between gap-3">
                <h3 className="text-sm font-bold">{isEditing ? "바로가기 수정" : "새 바로가기"}</h3>
                <span className="text-xs text-[var(--muted-ink)]">{entries.length}/{MAX_GPT_SHORTCUTS}</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
                <div className="grid gap-1.5">
                  <Label htmlFor="gpt-shortcut-name">이름</Label>
                  <Input
                    ref={nameInputRef}
                    id="gpt-shortcut-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    maxLength={MAX_GPT_SHORTCUT_NAME_LENGTH}
                    placeholder="예: 블로그 글쓰기"
                    disabled={!isEditing && atLimit}
                    required
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="gpt-shortcut-url">웹사이트 URL</Label>
                  <Input
                    id="gpt-shortcut-url"
                    type="url"
                    inputMode="url"
                    value={url}
                    onChange={(event) => setUrl(event.target.value)}
                    placeholder="https://example.com/..."
                    disabled={!isEditing && atLimit}
                    required
                  />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-[var(--muted-ink)]">
                  {atLimit && !isEditing ? `최대 ${MAX_GPT_SHORTCUTS}개를 등록했습니다. 기존 항목을 수정하거나 삭제해 주세요.` : "HTTPS 웹사이트 주소를 등록할 수 있습니다."}
                </p>
                <div className="flex gap-2">
                  {isEditing && (
                    <Button type="button" variant="outline" size="sm" onClick={resetForm}>
                      취소
                    </Button>
                  )}
                  <Button type="submit" size="sm" disabled={submitting || (!isEditing && atLimit)}>
                    {submitting ? "저장 중…" : isEditing ? "수정 저장" : "추가"}
                  </Button>
                </div>
              </div>
              {warning && <p role="alert" className="mt-3 text-sm font-medium text-red-700">{warning}</p>}
            </form>

            <section aria-labelledby="saved-gpt-shortcuts-title">
              <h3 id="saved-gpt-shortcuts-title" className="mb-2 text-sm font-bold">등록한 바로가기</h3>
              {entries.length === 0 ? (
                <p className="rounded-xl border border-dashed border-[var(--line)] p-5 text-center text-sm text-[var(--muted-ink)]">
                  아직 등록한 바로가기가 없습니다.
                </p>
              ) : (
                <ul className="grid min-w-0 gap-2">
                  {entries.map((entry, index) => {
                    const controls = shortcutMoveControls(entry.name, index, entries.length);
                    const moving = movingId !== null;
                    return (
                      <li key={entry.id} className={SHORTCUTS_ROW_CLASS}>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-bold">{entry.name}</p>
                          <p className="truncate text-xs text-[var(--muted-ink)]">{entry.url}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <div className="flex items-center gap-1" role="group" aria-label={`${entry.name} 순서 변경`}>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-sm"
                              aria-label={controls.upLabel}
                              disabled={!controls.canMoveUp || moving}
                              onClick={() => void handleMove(entry.id, "up")}
                            >
                              <ArrowUp aria-hidden="true" />
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon-sm"
                              aria-label={controls.downLabel}
                              disabled={!controls.canMoveDown || moving}
                              onClick={() => void handleMove(entry.id, "down")}
                            >
                              <ArrowDown aria-hidden="true" />
                            </Button>
                          </div>
                          <Button type="button" variant="outline" size="icon-sm" aria-label={`${entry.name} 수정`} onClick={() => beginEdit(entry)}>
                            <Pencil aria-hidden="true" />
                          </Button>
                          <Button type="button" variant="outline" size="icon-sm" aria-label={`${entry.name} 삭제`} onClick={() => setDeleteTarget(entry)}>
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </DialogContent>
        </Dialog>
      </div>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(nextOpen) => !nextOpen && setDeleteTarget(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>바로가기를 삭제할까요?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? `“${deleteTarget.name}” 버튼이 로컬 DB에서 삭제됩니다.` : "선택한 바로가기가 삭제됩니다."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleteTarget) void onRemove(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              삭제
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
