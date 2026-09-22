"use client";

import { CalendarClock, Copy, Database, History, Trash2 } from "lucide-react";

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

type HistoryIssue = {
  type: string;
  title: string;
  detail: string;
  samples: readonly string[];
};

export type PublicationHistoryEntry = {
  schemaVersion: number;
  id: string;
  title: string;
  preparedText: string;
  publishedText: string;
  comparison: {
    status: "match" | "formatting-only" | "different";
    score: number;
    summary: string;
    issues: readonly HistoryIssue[];
    expectedCharacters: number;
    actualCharacters: number;
  } | null;
  completedAt: string;
  updatedAt: string;
};

type PublicationHistoryPanelProps = {
  entries: readonly PublicationHistoryEntry[];
  warning: string;
  onCopy: (text: string, label: string) => void | Promise<void>;
  onDelete: (entryId: string) => void;
  onClear: () => void;
};

const STATUS_LABELS = {
  match: "일치",
  "formatting-only": "서식 차이",
  different: "내용 차이",
};

function formatCompletedAt(value: string) {
  return new Intl.DateTimeFormat("ko-KR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function PublicationHistoryPanel({
  entries,
  warning,
  onCopy,
  onDelete,
  onClear,
}: PublicationHistoryPanelProps) {
  const canClear = entries.length > 0 || Boolean(warning);

  return (
    <section aria-labelledby="history-title" className="mt-5 overflow-hidden rounded-[24px] border border-[var(--line)] bg-white shadow-[0_18px_55px_rgba(24,46,35,0.07)]">
      <div className="flex flex-col gap-3 border-b border-[var(--line)] px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#17231d] text-white">
            <History className="size-5" aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="history-title" className="text-lg font-black tracking-[-0.03em] text-[#173023]">발행 히스토리</h2>
              <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
                {entries.length}건
              </Badge>
            </div>
            <p className="mt-1 text-sm leading-6 text-[var(--muted-ink)]">
              비교를 마친 글은 삭제할 때까지 이 브라우저에 저장됩니다. 공용 기기에서는 사용 후 전체 삭제해 주세요.
            </p>
          </div>
        </div>

        {canClear && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="outline" className="border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800">
                <Trash2 className="size-4" aria-hidden="true" />
                전체 삭제
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>발행 히스토리를 모두 삭제할까요?</AlertDialogTitle>
                <AlertDialogDescription>
                  이 브라우저에 저장된 {entries.length}건의 기록과 손상된 저장 데이터가 모두 삭제되며 복구할 수 없습니다.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>취소</AlertDialogCancel>
                <AlertDialogAction variant="destructive" onClick={() => void onClear()}>모두 삭제</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      <div className="px-4 py-4 sm:px-6 sm:py-5">
        {warning && (
          <p role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
            {warning}
          </p>
        )}

        {entries.length === 0 ? (
          <div className="grid min-h-40 place-items-center rounded-2xl border border-dashed border-[#bfd6c9] bg-[#f7fbf8] p-6 text-center">
            <div className="max-w-md">
              <Database className="mx-auto size-7 text-emerald-600" aria-hidden="true" />
              <p className="mt-3 text-base font-bold text-[#173023]">아직 저장된 발행 글이 없습니다</p>
              <p className="mt-1 text-sm leading-6 text-[var(--muted-ink)]">
                글을 발행 완료로 체크하고 실제 발행본 비교를 마치면 자동으로 기록됩니다.
              </p>
            </div>
          </div>
        ) : (
          <Accordion type="multiple" className="space-y-2">
            {entries.map((entry) => (
              <AccordionItem key={entry.id} value={entry.id} className="overflow-hidden rounded-2xl border border-slate-200 px-4 last:border-b sm:px-5">
                <AccordionTrigger className="hover:no-underline">
                  <div className="min-w-0 flex-1 pr-2">
                    <p className="break-words text-base font-extrabold tracking-[-0.02em] text-[#173023]">{entry.title}</p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-ink)]">
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="size-3.5" aria-hidden="true" />
                        {formatCompletedAt(entry.completedAt)}
                      </span>
                      {entry.comparison && (
                        <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                          {STATUS_LABELS[entry.comparison.status]} · {entry.comparison.score}%
                        </Badge>
                      )}
                    </div>
                  </div>
                </AccordionTrigger>
                <AccordionContent>
                  {entry.comparison && (
                    <div className="mb-3 rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3">
                      <p className="text-sm font-bold text-[#24553c]">{entry.comparison.summary}</p>
                      {entry.comparison.issues.length > 0 && (
                        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-[var(--muted-ink)]">
                          {entry.comparison.issues.map((issue, index) => (
                            <li key={`${issue.type}-${index}`}>{issue.title}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  <div className="grid gap-3 lg:grid-cols-2">
                    <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <h3 className="text-sm font-bold text-[#27372f]">제공 원고</h3>
                        <Button type="button" size="sm" variant="outline" className="bg-white" aria-label={`${entry.title} 제공 원고 복사`} onClick={() => void onCopy(entry.preparedText, "제공 원고")}>
                          <Copy className="size-3.5" aria-hidden="true" /> 복사
                        </Button>
                      </div>
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-[family-name:var(--font-reading)] text-sm leading-6 text-slate-700">{entry.preparedText}</pre>
                    </div>
                    <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <h3 className="text-sm font-bold text-[#27372f]">실제 발행본</h3>
                        <Button type="button" size="sm" variant="outline" className="bg-white" aria-label={`${entry.title} 실제 발행본 복사`} disabled={!entry.publishedText} onClick={() => void onCopy(entry.publishedText, "실제 발행본")}>
                          <Copy className="size-3.5" aria-hidden="true" /> 복사
                        </Button>
                      </div>
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-[family-name:var(--font-reading)] text-sm leading-6 text-slate-700">{entry.publishedText || "저장된 실제 발행본이 없습니다."}</pre>
                    </div>
                  </div>

                  <div className="mt-3 flex justify-end">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button type="button" size="sm" variant="ghost" className="text-red-700 hover:bg-red-50 hover:text-red-800">
                          <Trash2 className="size-3.5" aria-hidden="true" /> 이 기록 삭제
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent size="sm">
                        <AlertDialogHeader>
                          <AlertDialogTitle>이 기록을 삭제할까요?</AlertDialogTitle>
                          <AlertDialogDescription>
                            ‘{entry.title}’ 기록은 삭제 후 복구할 수 없습니다.
                          </AlertDialogDescription>
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
            ))}
          </Accordion>
        )}
      </div>
    </section>
  );
}
