"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clipboard,
  Copy,
  FileText,
  LockKeyhole,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Table2,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import { copyArticle } from "@/lib/clipboard.mjs";
import {
  DEFAULT_HEADER_COLOR,
  MAX_INPUT_LENGTH,
  createCopyPayload,
  formatArticles,
  renderArticle,
} from "@/lib/formatter.mjs";

type Article = {
  id: string;
  title: string;
  source: string;
  bodySource: string;
  html: string;
  plainText: string;
  tableCount: number;
  characterCount: number;
};

type FormatResult = {
  method: "divider" | "label" | "heading" | "single";
  warnings: readonly string[];
  isRecommendedCount: boolean;
  articles: readonly Article[];
};

type CopyStatus = Record<string, string>;

const HEADER_COLORS = [
  { value: "#DFF7E8", label: "민트" },
  { value: "#E8F1FF", label: "블루" },
  { value: "#FFF1CC", label: "옐로" },
  { value: "#F0E9FF", label: "퍼플" },
];

const METHOD_LABELS = {
  divider: "구분선으로 분리",
  label: "글 번호로 분리",
  heading: "큰 제목으로 분리",
  single: "한 편으로 유지",
};

const EXAMPLE_TEXT = `# 첫 번째 글: 아침 루틴을 가볍게 만드는 법

바쁜 아침에는 할 일을 더하는 것보다 순서를 단순하게 만드는 편이 좋습니다.

## 10분 루틴

- 창문을 열고 물 한 잔 마시기
- 오늘 가장 중요한 일 한 가지 적기
- 휴대폰은 준비가 끝난 뒤 확인하기

| 순서 | 할 일 | 권장 시간 |
| --- | --- | ---: |
| 1 | 물 마시기 | 1분 |
| 2 | 일정 확인 | 3분 |
| 3 | 가벼운 스트레칭 | 6분 |

---

# 두 번째 글: 오래 쓰는 메모 습관

메모는 많이 남기는 것보다 다시 찾을 수 있게 남기는 것이 중요합니다.

> 한 메모에는 한 가지 주제만 담아보세요.

1. 제목에 날짜보다 주제를 씁니다.
2. 마지막 줄에 다음 행동을 적습니다.
3. 일주일에 한 번 불필요한 메모를 정리합니다.

---

# 세 번째 글: 주말 정리 체크리스트

일요일 저녁 20분이면 다음 주를 훨씬 가볍게 시작할 수 있습니다.

- 가방 속 영수증 비우기
- 월요일 일정 한 번 확인하기
- 자주 입는 옷 미리 준비하기`;

export default function Home() {
  const [input, setInput] = useState("");
  const [headerColor, setHeaderColor] = useState(DEFAULT_HEADER_COLOR);
  const [result, setResult] = useState<FormatResult | null>(null);
  const [error, setError] = useState("");
  const [expandedIds, setExpandedIds] = useState<readonly string[]>([]);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>({});

  const totalCharacters = useMemo(
    () => result?.articles.reduce((sum, article) => sum + article.characterCount, 0) ?? 0,
    [result],
  );

  const runFormat = useCallback((content: string, color: string) => {
    try {
      const nextResult = formatArticles(content, { headerColor: color }) as FormatResult;
      setResult(nextResult);
      setExpandedIds(nextResult.articles.length === 1 ? [nextResult.articles[0].id] : []);
      setCopyStatus({});
      setError("");
      return nextResult;
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "글을 정리하지 못했습니다.";
      setError(message);
      setResult(null);
      return null;
    }
  }, []);

  const handleColorChange = (color: string) => {
    setHeaderColor(color);
    if (!result) return;
    const recoloredArticles = result.articles.map((article) => {
      const rendered = renderArticle(article, { headerColor: color });
      return {
        ...article,
        ...rendered,
        characterCount: rendered.plainText.length,
      };
    });
    setResult({ ...result, articles: recoloredArticles });
    setCopyStatus({});
  };

  const handleReset = () => {
    setInput("");
    setResult(null);
    setError("");
    setExpandedIds([]);
    setCopyStatus({});
  };

  const handleTitleChange = (articleId: string, title: string) => {
    if (!result) return;
    setResult({
      ...result,
      articles: result.articles.map((article) =>
        article.id === articleId ? { ...article, title } : article,
      ),
    });
  };

  const handleCopy = async (
    article: Article,
    action: "title" | "plain" | "rich",
  ) => {
    const payload =
      action === "title"
        ? { html: article.title, plainText: article.title }
        : createCopyPayload(article, false);

    try {
      const copied = await copyArticle(payload, action === "rich" ? "rich" : "plain");
      const message =
        action === "title"
          ? "제목을 복사했습니다."
          : copied.mode === "plain-fallback" || (action === "rich" && copied.mode !== "rich")
            ? "서식 복사가 제한되어 안전한 텍스트로 복사했습니다."
            : action === "rich"
              ? "서식을 포함해 본문을 복사했습니다."
              : "안전한 텍스트로 본문을 복사했습니다.";
      setCopyStatus((current) => ({ ...current, [article.id]: message }));
      toast.success(message);
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "복사하지 못했습니다.";
      setCopyStatus((current) => ({ ...current, [article.id]: message }));
      toast.error(message);
    }
  };

  const togglePreview = (articleId: string) => {
    setExpandedIds((current) =>
      current.includes(articleId)
        ? current.filter((id) => id !== articleId)
        : [...current, articleId],
    );
  };

  useEffect(() => {
    const modelContext = (
      document as Document & {
        modelContext?: {
          registerTool: (tool: unknown, options?: { signal?: AbortSignal }) => void | Promise<void>;
        };
      }
    ).modelContext;
    if (!modelContext?.registerTool) return;

    const lifecycle = new AbortController();
    void Promise.resolve(
      modelContext.registerTool(
        {
          name: "format_blog_articles",
          title: "블로그 원고 정리",
          description: "여러 개의 한국어 블로그 원고를 글별로 분리하고 네이버 블로그 붙여넣기용으로 정리합니다.",
          inputSchema: {
            type: "object",
            properties: {
              content: { type: "string", minLength: 1, maxLength: MAX_INPUT_LENGTH },
              headerColor: { type: "string", pattern: "^#[0-9A-Fa-f]{6}$" },
            },
            required: ["content"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: true },
          execute: (value: unknown) => {
            if (!value || typeof value !== "object") throw new Error("원고 내용이 필요합니다.");
            const { content, headerColor: requestedColor } = value as {
              content?: unknown;
              headerColor?: unknown;
            };
            if (typeof content !== "string" || !content.trim()) {
              throw new Error("content에는 정리할 원고를 입력해야 합니다.");
            }
            const color =
              typeof requestedColor === "string" && /^#[0-9a-f]{6}$/i.test(requestedColor)
                ? requestedColor
                : headerColor;
            setInput(content);
            setHeaderColor(color);
            const formatted = runFormat(content, color);
            if (!formatted) throw new Error("원고를 정리하지 못했습니다.");
            return {
              articleCount: formatted.articles.length,
              titles: formatted.articles.map((article) => article.title),
              warnings: formatted.warnings,
            };
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => undefined);

    return () => lifecycle.abort();
  }, [headerColor, runFormat]);

  return (
    <main className="min-h-screen bg-[var(--canvas)] text-[var(--ink)]">
      <Toaster position="top-center" />

      <header className="border-b border-[var(--line)] bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex min-h-16 max-w-[1500px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-[var(--brand)] text-white shadow-[0_8px_24px_rgba(3,199,90,0.22)]">
              <FileText className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-lg font-black tracking-[-0.04em]">바로발행</p>
              <p className="hidden text-xs text-[var(--muted-ink)] sm:block">네이버 블로그용 최종 원고 정리</p>
            </div>
          </div>
          <Badge className="border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-emerald-800" variant="outline">
            <LockKeyhole className="size-3.5" aria-hidden="true" />
            글은 브라우저 밖으로 나가지 않아요
          </Badge>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <section className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Badge className="mb-3 bg-[#17231d] text-white">3~5개 원고 한 번에</Badge>
            <h1 className="max-w-3xl text-[clamp(1.8rem,4vw,3.15rem)] font-black leading-[1.08] tracking-[-0.055em] text-[#13251b]">
              글 뭉치를 붙여넣고,
              <br className="hidden sm:block" /> 발행 직전 원고로 정리하세요.
            </h1>
          </div>
          <p className="max-w-xl text-sm leading-6 text-[var(--muted-ink)] lg:text-right">
            마크다운 기호와 들쭉날쭉한 문단을 정리하고 표 제목행까지 손봅니다.
            제목과 본문은 글별로 따로 복사할 수 있어요.
          </p>
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(520px,1.05fr)]">
          <Card className="gap-0 overflow-hidden rounded-[24px] border-[var(--line)] py-0 shadow-[0_18px_55px_rgba(24,46,35,0.07)]">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4 sm:px-6">
              <div className="flex items-center gap-2.5">
                <span className="step-number">1</span>
                <div>
                  <h2 className="font-bold tracking-[-0.02em]">GPT 글 묶음 붙여넣기</h2>
                  <p className="text-xs text-[var(--muted-ink)]">글 사이는 --- 또는 # 큰 제목으로 구분</p>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-emerald-800 hover:bg-emerald-50 hover:text-emerald-900"
                onClick={() => {
                  setInput(EXAMPLE_TEXT);
                  setResult(null);
                  setExpandedIds([]);
                  setCopyStatus({});
                  setError("");
                }}
              >
                예시 불러오기
              </Button>
            </div>

            <CardContent className="space-y-4 px-4 py-4 sm:px-6 sm:py-5">
              <div className="relative">
                <Textarea
                  aria-label="정리할 블로그 원고"
                  aria-describedby={error ? "input-error" : "input-help"}
                  aria-invalid={Boolean(error)}
                  value={input}
                  maxLength={MAX_INPUT_LENGTH}
                  onChange={(event) => {
                    setInput(event.target.value);
                    setResult(null);
                    setExpandedIds([]);
                    setCopyStatus({});
                    if (error) setError("");
                  }}
                  placeholder={`# 첫 번째 글 제목\n\n본문을 붙여넣으세요.\n\n---\n\n# 두 번째 글 제목\n\n다음 글을 이어서 붙여넣으세요.`}
                  className="min-h-[390px] resize-y rounded-2xl border-slate-200 bg-[#fbfdfc] p-5 font-[family-name:var(--font-reading)] text-base leading-7 shadow-inner focus-visible:border-emerald-500 focus-visible:ring-emerald-100"
                />
                <span className="absolute bottom-3 right-4 rounded-md bg-white/90 px-2 py-1 text-xs tabular-nums text-[var(--muted-ink)] shadow-sm">
                  {input.length.toLocaleString("ko-KR")} / {MAX_INPUT_LENGTH.toLocaleString("ko-KR")}
                </span>
              </div>

              {error ? (
                <p id="input-error" role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                  {error}
                </p>
              ) : (
                <p id="input-help" className="flex items-center gap-2 text-xs leading-5 text-[var(--muted-ink)]">
                  <ShieldCheck className="size-4 shrink-0 text-emerald-600" aria-hidden="true" />
                  붙여넣은 내용은 서버로 전송하거나 저장하지 않습니다.
                </p>
              )}

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  type="button"
                  className="h-12 flex-1 rounded-xl bg-[var(--brand)] text-base font-bold text-white shadow-[0_10px_24px_rgba(3,199,90,0.2)] hover:bg-[#02b351]"
                  onClick={() => runFormat(input, headerColor)}
                >
                  <Sparkles className="size-4.5" aria-hidden="true" />
                  글별로 정리하기
                  <ArrowRight className="size-4.5" aria-hidden="true" />
                </Button>
                <Button type="button" variant="outline" className="h-12 rounded-xl px-5" onClick={handleReset} disabled={!input && !result}>
                  <RotateCcw className="size-4" aria-hidden="true" />
                  초기화
                </Button>
              </div>
            </CardContent>
          </Card>

          <section aria-labelledby="result-title" className="min-w-0">
            <div className="mb-3 flex min-h-10 flex-wrap items-center justify-between gap-3 px-1">
              <div className="flex items-center gap-2.5">
                <span className="step-number">2</span>
                <div>
                  <h2 id="result-title" className="font-bold tracking-[-0.02em]">글별 확인·복사</h2>
                  <p className="text-xs text-[var(--muted-ink)]">제목과 본문을 순서대로 복사하세요</p>
                </div>
              </div>
              {result && (
                <div className="flex items-center gap-2 text-xs text-[var(--muted-ink)]">
                  <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
                    {result.articles.length}편
                  </Badge>
                  <span>{totalCharacters.toLocaleString("ko-KR")}자</span>
                </div>
              )}
            </div>

            {!result ? (
              <div className="grid min-h-[535px] place-items-center rounded-[24px] border border-dashed border-[#bfd6c9] bg-[linear-gradient(145deg,rgba(255,255,255,0.92),rgba(239,250,244,0.78))] p-8 text-center">
                <div className="max-w-sm">
                  <span className="mx-auto mb-5 grid size-16 place-items-center rounded-2xl border border-emerald-100 bg-white text-emerald-600 shadow-[0_12px_30px_rgba(14,92,55,0.1)]">
                    <Clipboard className="size-7" aria-hidden="true" />
                  </span>
                  <h3 className="text-xl font-black tracking-[-0.035em] text-[#173023]">정리된 글이 여기에 나와요</h3>
                  <p className="mt-2 text-sm leading-6 text-[var(--muted-ink)]">
                    왼쪽에 글을 붙여넣고 정리하면 글마다 제목, 표 개수, 미리보기와 복사 버튼을 확인할 수 있습니다.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-col gap-3 rounded-2xl border border-[#d8e7de] bg-[#f5fbf7] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#26563e]">
                    <Check className="size-4" aria-hidden="true" />
                    {METHOD_LABELS[result.method]}
                  </div>
                  <div className="flex items-center gap-2" role="radiogroup" aria-label="표 제목행 색상">
                    <span className="mr-1 text-xs text-[var(--muted-ink)]">표 제목색</span>
                    {HEADER_COLORS.map((color) => (
                      <button
                        key={color.value}
                        type="button"
                        role="radio"
                        aria-checked={headerColor === color.value}
                        aria-label={color.label}
                        title={color.label}
                        className="color-swatch"
                        style={{ backgroundColor: color.value }}
                        data-selected={headerColor === color.value}
                        onClick={() => handleColorChange(color.value)}
                      />
                    ))}
                  </div>
                </div>

                {result.warnings.map((warning) => (
                  <p key={warning} className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs leading-5 text-amber-900">
                    {warning}
                  </p>
                ))}

                <div className="max-h-[690px] space-y-3 overflow-y-auto pr-1 scrollbar-thin">
                  {result.articles.map((article, index) => {
                    const isExpanded = expandedIds.includes(article.id);
                    return (
                      <article key={article.id} className="overflow-hidden rounded-[20px] border border-[var(--line)] bg-white shadow-[0_12px_34px_rgba(24,46,35,0.06)]">
                        <div className="border-b border-[var(--line)] px-4 py-4 sm:px-5">
                          <div className="mb-3 flex items-start gap-3">
                            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-[#17231d] text-xs font-black text-white">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <div className="min-w-0 flex-1">
                              <label htmlFor={`${article.id}-title`} className="sr-only">{index + 1}번째 글 제목</label>
                              <input
                                id={`${article.id}-title`}
                                value={article.title}
                                maxLength={100}
                                onChange={(event) => handleTitleChange(article.id, event.target.value)}
                                className="w-full rounded-md border-0 bg-transparent px-1 py-0.5 text-base font-extrabold tracking-[-0.025em] outline-none ring-emerald-200 focus:ring-2"
                              />
                              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-ink)]">
                                <span>{article.characterCount.toLocaleString("ko-KR")}자</span>
                                <span aria-hidden="true">·</span>
                                <span className="inline-flex items-center gap-1">
                                  <Table2 className="size-3.5" aria-hidden="true" /> 표 {article.tableCount}개
                                </span>
                              </div>
                            </div>
                            <Button type="button" size="sm" variant="ghost" className="shrink-0" onClick={() => void handleCopy(article, "title")}>
                              <Copy className="size-3.5" aria-hidden="true" /> 제목 복사
                            </Button>
                          </div>

                          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                            <Button type="button" variant="outline" className="min-h-11 rounded-xl border-slate-200" onClick={() => void handleCopy(article, "plain")}>
                              <ShieldCheck className="size-4 text-emerald-600" aria-hidden="true" /> 본문 안전 복사
                            </Button>
                            <Button type="button" className="min-h-11 rounded-xl bg-[#17231d] text-white hover:bg-[#284535]" onClick={() => void handleCopy(article, "rich")}>
                              <Sparkles className="size-4" aria-hidden="true" /> 본문 서식 복사
                            </Button>
                            <Button type="button" size="icon-lg" variant="ghost" className="min-h-11 rounded-xl" aria-expanded={isExpanded} aria-label={isExpanded ? "미리보기 접기" : "미리보기 열기"} onClick={() => togglePreview(article.id)}>
                              <ChevronDown className={`size-5 transition-transform ${isExpanded ? "rotate-180" : ""}`} aria-hidden="true" />
                            </Button>
                          </div>

                          <p className="sr-only" role="status" aria-live="polite">
                            {copyStatus[article.id] ?? ""}
                          </p>
                        </div>

                        {isExpanded && (
                          <div className="bg-[#f8faf9] p-3 sm:p-4">
                            <div className="preview-paper overflow-x-auto rounded-xl border border-[#dce5e0] bg-white p-5 sm:p-7" dangerouslySetInnerHTML={{ __html: article.html }} />
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>

                <p className="px-2 pt-1 text-xs leading-5 text-[var(--muted-ink)]">
                  서식 복사는 브라우저와 네이버 편집기 상태에 따라 표 색상·간격이 달라질 수 있습니다. 이미지는 네이버 포토 업로더에서 따로 넣어주세요.
                </p>
              </div>
            )}
          </section>
        </section>
      </div>
    </main>
  );
}
