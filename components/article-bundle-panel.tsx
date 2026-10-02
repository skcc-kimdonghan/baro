"use client";

import { useState } from "react";
import { Archive, CalendarClock, ChevronDown, FileText, FolderOpen, Trash2 } from "lucide-react";

import type { ArticleBundleEntry } from "@/hooks/use-article-bundles";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { hasArticleBundleWorkspaceChanges } from "@/lib/article-bundles.mjs";

type ArticleBundlePanelProps = {
  entries: readonly ArticleBundleEntry[];
  warning: string;
  currentSourceText: string;
  currentHeaderColor: string;
  currentArticleTitles: readonly string[] | null;
  hasPublicationWork: boolean;
  onOpen: (entry: ArticleBundleEntry) => void;
  onDelete: (entryId: string) => void;
  onClear: () => void;
};

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function OpenBundleButton({
  entry,
  needsConfirmation,
  onOpen,
}: {
  entry: ArticleBundleEntry;
  needsConfirmation: boolean;
  onOpen: (entry: ArticleBundleEntry) => void;
}) {
  if (!needsConfirmation) {
    return (
      <Button type="button" size="sm" aria-label={`${entry.displayTitle} 다시 열기`} className="bg-[#17231d] text-white hover:bg-[#284535]" onClick={() => onOpen(entry)}>
        <FolderOpen className="size-3.5" aria-hidden="true" /> 다시 열기
      </Button>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" size="sm" aria-label={`${entry.displayTitle} 다시 열기`} className="bg-[#17231d] text-white hover:bg-[#284535]">
          <FolderOpen className="size-3.5" aria-hidden="true" /> 다시 열기
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>현재 원고를 바꿀까요?</AlertDialogTitle>
          <AlertDialogDescription>
            입력창의 현재 원고가 ‘{entry.displayTitle}’ 저장본으로 교체됩니다. 저장하지 않은 내용은 사라질 수 있습니다.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>취소</AlertDialogCancel>
          <AlertDialogAction onClick={() => onOpen(entry)}>저장본 열기</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ArticleBundlePanel({
  entries,
  warning,
  currentSourceText,
  currentHeaderColor,
  currentArticleTitles,
  hasPublicationWork,
  onOpen,
  onDelete,
  onClear,
}: ArticleBundlePanelProps) {
  const canClear = entries.length > 0 || Boolean(warning);
  const [isListOpen, setIsListOpen] = useState(false);

  return (
    <section aria-labelledby="article-bundles-title" className="mt-5 overflow-hidden rounded-[24px] border border-[var(--line)] bg-white shadow-[0_18px_55px_rgba(24,46,35,0.07)]">
      <div className="flex flex-col gap-3 border-b border-[var(--line)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white">
            <Archive className="size-5" aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="article-bundles-title" className="text-lg font-black tracking-[-0.03em] text-[#173023]">저장한 글뭉치</h2>
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
                {entries.length}개
              </Badge>
              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-600">이 기기 전용</Badge>
            </div>
            <p className="mt-1 text-sm leading-6 text-[var(--muted-ink)]">
              현재 macOS 사용자 계정의 로컬 DB에 저장되어 브라우저와 컴퓨터를 다시 켜도 유지됩니다. 공용·공유 계정에서는 사용 후 전체 삭제해 주세요.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-end sm:self-auto">
          {canClear && isListOpen && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" size="sm" variant="ghost" className="text-red-700 hover:bg-red-50 hover:text-red-800">
                  <Trash2 className="size-3.5" aria-hidden="true" /> 전체 삭제
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>저장한 글뭉치를 모두 삭제할까요?</AlertDialogTitle>
                  <AlertDialogDescription>
                    로컬 DB에 저장된 {entries.length}개 글뭉치가 모두 삭제되며 복구할 수 없습니다. 발행 히스토리는 삭제되지 않습니다.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>취소</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => void onClear()}>모두 삭제</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={isListOpen}
            aria-controls="article-bundles-list"
            onClick={() => setIsListOpen((current) => !current)}
            className="border-slate-200 bg-white text-[#173023]"
          >
            {isListOpen ? "목록 접기" : entries.length > 0 ? "목록 보기" : "안내 보기"}
            <ChevronDown className={`size-4 transition-transform ${isListOpen ? "rotate-180" : ""}`} aria-hidden="true" />
          </Button>
        </div>
      </div>

      {warning && (
        <p role="alert" className="mx-4 my-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm leading-5 text-amber-900 sm:mx-6">
          {warning}
        </p>
      )}

      {isListOpen && <div id="article-bundles-list" className="px-4 py-4 sm:px-6 sm:py-5">
        {entries.length === 0 ? (
          <div className="grid min-h-40 place-items-center rounded-2xl border border-dashed border-[#bfd6c9] bg-[#f7fbf8] p-6 text-center">
            <div className="max-w-md">
              <Archive className="mx-auto size-7 text-emerald-600" aria-hidden="true" />
              <p className="mt-3 text-base font-bold text-[#173023]">아직 저장한 글뭉치가 없습니다</p>
              <p className="mt-1 text-sm leading-6 text-[var(--muted-ink)]">
                원고를 정리한 뒤 ‘글뭉치 저장’을 누르면 글별 제목과 함께 여기에 보관됩니다.
              </p>
            </div>
          </div>
        ) : (
          <Accordion type="multiple" className="max-h-[28rem] space-y-2 overflow-y-auto overscroll-contain pr-1">
            {entries.map((entry) => {
              const needsConfirmation = hasArticleBundleWorkspaceChanges(entry, {
                sourceText: currentSourceText,
                headerColor: currentHeaderColor,
                articleTitles: currentArticleTitles,
                hasPublicationWork,
              });
              return (
                <AccordionItem key={entry.id} value={entry.id} className="overflow-hidden rounded-2xl border border-slate-200 px-4 last:border-b sm:px-5">
                  <AccordionTrigger className="hover:no-underline">
                    <div className="min-w-0 flex-1 pr-2">
                      <p className="break-words text-base font-extrabold tracking-[-0.02em] text-[#173023]">{entry.displayTitle}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-ink)]">
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock className="size-3.5" aria-hidden="true" />
                          {formatUpdatedAt(entry.updatedAt)}
                        </span>
                        <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                          {entry.articleTitles.length}편 · {entry.sourceText.length.toLocaleString("ko-KR")}자
                        </Badge>
                      </div>
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                      <p className="mb-2 flex items-center gap-2 text-sm font-bold text-[#27372f]">
                        <FileText className="size-4 text-emerald-700" aria-hidden="true" /> 묶음 안의 글
                      </p>
                      <ol className="space-y-1.5">
                        {entry.articleTitles.map((title, index) => (
                          <li key={`${entry.id}-${index}`} className="flex gap-2 text-sm leading-6 text-slate-700">
                            <span className="font-bold tabular-nums text-emerald-700">{index + 1}.</span>
                            <span className="break-words">{title}</span>
                          </li>
                        ))}
                      </ol>
                    </div>

                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <OpenBundleButton entry={entry} needsConfirmation={needsConfirmation} onOpen={onOpen} />
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button type="button" size="sm" variant="ghost" aria-label={`${entry.displayTitle} 삭제`} className="text-red-700 hover:bg-red-50 hover:text-red-800">
                            <Trash2 className="size-3.5" aria-hidden="true" /> 삭제
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent size="sm">
                          <AlertDialogHeader>
                            <AlertDialogTitle>이 글뭉치를 삭제할까요?</AlertDialogTitle>
                            <AlertDialogDescription>‘{entry.displayTitle}’ 저장본은 삭제 후 복구할 수 없습니다.</AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>취소</AlertDialogCancel>
                            <AlertDialogAction variant="destructive" onClick={() => void onDelete(entry.id)}>삭제</AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        )}
      </div>}
    </section>
  );
}
