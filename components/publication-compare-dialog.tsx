"use client";

import type { ClipboardEvent as ReactClipboardEvent } from "react";
import {
  Check,
  CircleCheckBig,
  ClipboardPaste,
  GitCompareArrows,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

type ComparisonIssue = {
  type: string;
  title: string;
  detail: string;
  samples: readonly string[];
};

type FormatCheck = {
  key: string;
  label: string;
  expected: string;
  actual: string;
  matched: boolean;
};

type FormattingComparison = {
  status: "match" | "different" | "unavailable";
  score: number | null;
  summary: string;
  checks: readonly FormatCheck[];
};

type ComparisonResult = {
  status: "match" | "formatting-only" | "different";
  score: number;
  summary: string;
  issues: readonly ComparisonIssue[];
  expectedCharacters: number;
  actualCharacters: number;
  formatting?: FormattingComparison;
};

type PublicationReview = {
  completed: boolean;
  publishedText: string;
  publishedHtml: string;
  captureMode: "rich-html" | "text-only";
  comparison: ComparisonResult | null;
  error: string;
  historyId: string | null;
};

type PublicationCompareDialogProps = {
  articleId: string;
  title: string;
  maxLength: number;
  review: PublicationReview;
  onPaste: (event: ReactClipboardEvent<HTMLTextAreaElement>) => void;
  onTextChange: (value: string) => void;
  onCompare: () => void | Promise<void>;
};

function contentStatusLabel(comparison: ComparisonResult | null) {
  if (!comparison) return "미비교";
  if (comparison.status === "different") return "내용 차이";
  return "내용 일치";
}

function formatStatusLabel(formatting: FormattingComparison | undefined) {
  if (!formatting || formatting.status === "unavailable") return "서식 미확인";
  if (formatting.status === "different") return `서식 ${formatting.score}%`;
  return "서식 일치";
}

export function PublicationCompareDialog({
  articleId,
  title,
  maxLength,
  review,
  onPaste,
  onTextChange,
  onCompare,
}: PublicationCompareDialogProps) {
  const comparison = review.comparison;
  const formatting = comparison?.formatting;
  const mismatchedChecks = formatting?.checks.filter((check) => !check.matched) ?? [];
  const highlightedChecks = mismatchedChecks.slice(0, 4);
  const isFullMatch = comparison?.status === "match" && formatting?.status === "match";

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="sm" className="shrink-0 rounded-lg bg-[#17231d] text-white hover:bg-[#284535]">
          <ClipboardPaste className="size-3.5" aria-hidden="true" />
          {comparison ? "비교 결과 보기" : "발행본 붙여넣기·비교"}
        </Button>
      </DialogTrigger>

      <DialogContent className="max-h-[92dvh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-slate-200 px-5 py-4 pr-12">
          <DialogTitle className="truncate text-lg font-black text-[#173023]">{title}</DialogTitle>
          <DialogDescription>
            네이버에서 발행된 본문 전체를 복사해 붙여넣으면 내용과 HTML 서식을 함께 비교합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[calc(92dvh-92px)] overflow-y-auto px-5 py-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className={!review.publishedText ? "border-slate-200 bg-slate-50 text-slate-600" : review.captureMode === "rich-html" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-amber-200 bg-amber-50 text-amber-800"}>
                {!review.publishedText ? "붙여넣기 대기" : review.captureMode === "rich-html" ? "HTML 서식 감지됨" : "텍스트만 감지됨"}
              </Badge>
              {comparison && (
                <>
                  <Badge variant="outline" className="border-slate-200 bg-white text-slate-700">
                    {contentStatusLabel(comparison)} {comparison.score}%
                  </Badge>
                  <Badge variant="outline" className="border-slate-200 bg-white text-slate-700">
                    {formatStatusLabel(formatting)}
                  </Badge>
                </>
              )}
            </div>
            <span className="text-xs tabular-nums text-slate-500">
              {review.publishedText.length.toLocaleString("ko-KR")} / {maxLength.toLocaleString("ko-KR")}
            </span>
          </div>

          <label htmlFor={`${articleId}-published-text`} className="sr-only">실제로 발행한 글 붙여넣기</label>
          <Textarea
            id={`${articleId}-published-text`}
            value={review.publishedText}
            maxLength={maxLength}
            aria-describedby={review.error ? `${articleId}-comparison-error` : undefined}
            aria-invalid={Boolean(review.error)}
            onPaste={onPaste}
            onChange={(event) => onTextChange(event.target.value)}
            placeholder="네이버 블로그의 발행 본문 전체를 복사해 붙여넣으세요."
            className="min-h-24 max-h-[32vh] resize-y rounded-xl border-slate-200 bg-white text-sm leading-6 focus-visible:border-emerald-500 focus-visible:ring-emerald-100"
          />

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs leading-5 text-slate-500">
              붙여넣은 뒤 직접 수정하면 HTML 서식 정보가 해제되어 텍스트만 비교됩니다.
            </p>
            <Button
              type="button"
              className="shrink-0 rounded-xl bg-[#0d7a42] text-white hover:bg-[#096936]"
              disabled={!review.publishedText.trim()}
              onClick={() => void onCompare()}
            >
              <GitCompareArrows className="size-4" aria-hidden="true" />
              내용·서식 비교하기
            </Button>
          </div>

          {review.error && (
            <p id={`${articleId}-comparison-error`} role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
              {review.error}
            </p>
          )}

          {comparison && (
            <div className="mt-4 space-y-3" role="status" aria-live="polite">
              <div className={`rounded-xl border p-4 ${isFullMatch ? "border-emerald-200 bg-emerald-50/70" : comparison.status === "different" ? "border-rose-200 bg-rose-50/70" : "border-amber-200 bg-amber-50/70"}`}>
                <p className="flex items-center gap-2 text-sm font-black text-[#173023]">
                  {isFullMatch ? (
                    <CircleCheckBig className="size-4.5 text-emerald-600" aria-hidden="true" />
                  ) : (
                    <TriangleAlert className="size-4.5 text-amber-600" aria-hidden="true" />
                  )}
                  {comparison.summary}
                </p>
                {formatting && <p className="mt-1 text-xs leading-5 text-slate-600">{formatting.summary}</p>}
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-xs font-bold text-slate-500">본문 내용</p>
                  <p className="mt-1 text-xl font-black text-[#173023]">{comparison.score}%</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <p className="text-xs font-bold text-slate-500">글자 크기·서식</p>
                  <p className="mt-1 text-xl font-black text-[#173023]">{formatting?.score === null || formatting?.score === undefined ? "확인 불가" : `${formatting.score}%`}</p>
                </div>
              </div>

              {mismatchedChecks.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3">
                  <p className="text-sm font-bold text-amber-950">달라진 서식</p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {highlightedChecks.map((check) => (
                      <div key={check.key} className="rounded-lg border border-amber-100 bg-white px-3 py-2 text-xs leading-5">
                        <p className="font-bold text-slate-800">{check.label}</p>
                        <p className="text-slate-500">예상 {check.expected}</p>
                        <p className="text-rose-700">실제 {check.actual}</p>
                      </div>
                    ))}
                  </div>
                  {mismatchedChecks.length > highlightedChecks.length && (
                    <p className="mt-2 text-xs font-medium text-amber-900">
                      나머지 {mismatchedChecks.length - highlightedChecks.length}개 항목은 ‘전체 세부 비교 보기’에서 확인할 수 있습니다.
                    </p>
                  )}
                </div>
              )}

              {(comparison.issues.length > 0 || (formatting?.checks.length ?? 0) > 0) && (
                <details className="rounded-xl border border-slate-200 bg-white">
                  <summary className="cursor-pointer px-4 py-3 text-sm font-bold text-[#27372f]">전체 세부 비교 보기</summary>
                  <div className="space-y-3 border-t border-slate-200 p-4">
                    {comparison.issues.length > 0 && (
                      <ul className="space-y-2">
                        {comparison.issues.map((comparisonIssue, issueIndex) => (
                          <li key={`${comparisonIssue.type}-${issueIndex}`} className="rounded-lg bg-slate-50 p-3">
                            <p className="text-sm font-bold text-[#27372f]">{comparisonIssue.title}</p>
                            <p className="mt-1 text-xs leading-5 text-slate-600">{comparisonIssue.detail}</p>
                            {comparisonIssue.samples.length > 0 && (
                              <ul className="mt-2 space-y-1">
                                {comparisonIssue.samples.map((sample, sampleIndex) => (
                                  <li key={`${sample}-${sampleIndex}`} className="break-words rounded-md bg-white px-2.5 py-1.5 font-mono text-[11px] leading-5 text-slate-700">
                                    {sample}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}

                    {formatting && formatting.checks.length > 0 && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {formatting.checks.map((check) => (
                          <div key={check.key} className="flex items-start gap-2 rounded-lg border border-slate-100 p-2.5 text-xs">
                            {check.matched ? <Check className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden="true" /> : <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600" aria-hidden="true" />}
                            <div className="min-w-0">
                              <p className="font-bold text-slate-800">{check.label}</p>
                              <p className="break-words text-slate-500">예상 {check.expected}</p>
                              <p className="break-words text-slate-500">실제 {check.actual}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
