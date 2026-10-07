"use client";

import { type ClipboardEvent as ReactClipboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  Clipboard,
  Copy,
  FileText,
  LockKeyhole,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Table2,
} from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import { ArticleBundlePanel } from "@/components/article-bundle-panel";
import { ArticleImagePromptPanel } from "@/components/article-image-prompt-panel.mjs";
import { GptShortcutsBar } from "@/components/gpt-shortcuts-bar";
import { PublicationCompareDialog } from "@/components/publication-compare-dialog";
import { PublicationHistoryPanel } from "@/components/publication-history-panel";
import { type ArticleBundleEntry, useArticleBundles } from "@/hooks/use-article-bundles";
import { useGptShortcuts } from "@/hooks/use-gpt-shortcuts";
import { usePublicationHistory } from "@/hooks/use-publication-history";
import { MAX_COMPARISON_LENGTH, comparePublishedArticle } from "@/lib/article-comparison.mjs";
import { copyArticle } from "@/lib/clipboard.mjs";
import { applyPublicationTextEdit, createPublicationPasteState } from "@/lib/publication-paste.mjs";
import {
  composePastedValue,
  createTopScrollOptions,
  shouldAutoFormatPaste,
} from "@/lib/paste-workflow.mjs";
import {
  DEFAULT_HEADER_COLOR,
  MAX_INPUT_LENGTH,
  createCopyPayload,
  createImagePromptPayload,
  formatArticles,
  renderArticle,
} from "@/lib/formatter.mjs";
import { inputPanelView, RESULT_LIST_CLASS, RESULT_WORKSPACE_CLASS } from "@/lib/workspace-panel.mjs";

type Article = {
  id: string;
  title: string;
  source: string;
  bodySource: string;
  html: string;
  plainText: string;
  imagePrompt: string;
  tableCount: number;
  characterCount: number;
  engagementCtaAdded: boolean;
  engagementCtaParts: readonly string[];
  engagementCtaTopic: string;
};

type FormatResult = {
  method: "divider" | "label" | "heading" | "single";
  warnings: readonly string[];
  isRecommendedCount: boolean;
  articles: readonly Article[];
};

type ArticleType = "information" | "advertisement";

type CopyStatus = Record<string, string>;
type ComparisonIssue = { type: "missing" | "added" | "formatting" | "order" | "ride-footer"; title: string; detail: string; samples: readonly string[] };

type ComparisonResult = {
  status: "match" | "formatting-only" | "different";
  score: number;
  summary: string;
  issues: readonly ComparisonIssue[];
  expectedCharacters: number;
  actualCharacters: number;
  formatting?: {
    status: "match" | "different" | "unavailable";
    score: number | null;
    summary: string;
    checks: readonly {
      key: string;
      label: string;
      expected: string;
      actual: string;
      matched: boolean;
    }[];
  };
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

type PublicationReviews = Record<string, PublicationReview>;

const HEADER_COLORS = [
  { value: "#F7F7F7", label: "기준 회색" },
  { value: "#DFF7E8", label: "민트" },
  { value: "#E8F1FF", label: "블루" },
  { value: "#FFF1CC", label: "옐로" },
  { value: "#F0E9FF", label: "퍼플" },
];

const ARTICLE_TYPES: readonly { value: ArticleType; label: string; description: string }[] = [
  { value: "information", label: "정보글", description: "기존 질문·댓글 마무리" },
  { value: "advertisement", label: "광고글", description: "준비물 후기형 마무리" },
];

const METHOD_LABELS = {
  divider: "구분선으로 분리",
  label: "글·편 번호로 분리",
  heading: "큰 제목으로 분리",
  single: "한 편으로 유지",
};

const EXAMPLE_TEXT = `# 첫 번째 글: 아침 루틴을 가볍게 만드는 법

“바쁜 아침을 조금 더 가볍게 시작할 수 있을까요?”

가능합니다.

해야 할 일을 늘리기보다 순서를 단순하게 만드는 것이 핵심입니다.

## 이 글에서 볼 내용

1. 10분 루틴은 어떻게 구성하나요?
2. 어떤 순서로 시작하면 좋을까요?

## 1. 10분 루틴은 어떻게 구성하나요?

A: 물 한 잔, 일정 확인, 스트레칭 순서로 시작하면 됩니다.

- 창문을 열고 물 한 잔 마시기
- 오늘 가장 중요한 일 한 가지 적기
- 휴대폰은 준비가 끝난 뒤 확인하기

| 순서 | 추천 흐름 |
| --- | --- |
| 1 | 물 마시기 · 1분 |
| 2 | 일정 확인 · 3분 |
| 3 | 가벼운 스트레칭 · 6분 |

## 2. 어떤 순서로 시작하면 좋을까요?

A: 가장 부담 없는 행동부터 시작해 흐름을 만드는 편이 좋습니다.

## 그래서, 내일부터 해볼 만할까요?

세 가지를 모두 하기 어렵다면 물 한 잔부터 시작해도 충분합니다.

#아침루틴 #생활습관 #시간관리

## 이미지 생성 프롬프트

아침 햇살이 들어오는 정돈된 주방, 물 한 잔과 작은 메모장, 인물 없음, 세로형 4:5

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
  const [articleType, setArticleType] = useState<ArticleType>("information");
  const [result, setResult] = useState<FormatResult | null>(null);
  const [error, setError] = useState("");
  const [expandedIds, setExpandedIds] = useState<readonly string[]>([]);
  const [isInputPanelExpanded, setIsInputPanelExpanded] = useState(false);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>({});
  const [publicationReviews, setPublicationReviews] = useState<PublicationReviews>({});
  const publicationRevisionRef = useRef(0);
  const pageTopRef = useRef<HTMLElement | null>(null);
  const bundles = useArticleBundles();
  const gptShortcuts = useGptShortcuts();
  const history = usePublicationHistory();

  const totalCharacters = useMemo(
    () => result?.articles.reduce((sum, article) => sum + article.characterCount, 0) ?? 0,
    [result],
  );
  const currentArticleTitles = useMemo(
    () => result?.articles.map((article) => article.title) ?? null,
    [result],
  );
  const hasPublicationWork = Object.keys(publicationReviews).length > 0;
  const inputPanel = inputPanelView(isInputPanelExpanded);

  const runFormat = useCallback((content: string, color: string, type: ArticleType) => {
    publicationRevisionRef.current += 1;
    try {
      const nextResult = formatArticles(content, { headerColor: color, articleType: type }) as FormatResult;
      setResult(nextResult);
      setIsInputPanelExpanded(false);
      setExpandedIds([]);
      setCopyStatus({});
      setPublicationReviews({});
      setError("");
      return nextResult;
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "글을 정리하지 못했습니다.";
      setError(message);
      setResult(null);
      return null;
    }
  }, []);

  const revealResults = useCallback(() => {
    window.requestAnimationFrame(() => {
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo(createTopScrollOptions(reduceMotion));
      pageTopRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const handleFormatAndReveal = useCallback((content: string, successMessage = "") => {
    const nextResult = runFormat(content, headerColor, articleType);
    if (!nextResult) return null;
    revealResults();
    if (successMessage) toast.success(successMessage);
    return nextResult;
  }, [articleType, headerColor, revealResults, runFormat]);

  const handleInputPaste = useCallback((event: ReactClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = event.clipboardData.getData("text/plain");
    if (!pastedText) return;

    const pasteInput = {
      currentValue: event.currentTarget.value,
      pastedText,
      selectionStart: event.currentTarget.selectionStart,
      selectionEnd: event.currentTarget.selectionEnd,
    };
    if (!shouldAutoFormatPaste(pasteInput)) return;

    event.preventDefault();
    const nextInput = composePastedValue(pasteInput);
    if (nextInput.length > MAX_INPUT_LENGTH) {
      const message = `입력은 ${MAX_INPUT_LENGTH.toLocaleString("ko-KR")}자까지 정리할 수 있습니다.`;
      setError(message);
      toast.error(message);
      return;
    }

    setInput(nextInput);
    const nextResult = handleFormatAndReveal(nextInput);
    if (nextResult) toast.success(`${nextResult.articles.length}편으로 자동 정리했습니다.`);
  }, [handleFormatAndReveal]);

  const handleSaveBundle = useCallback(async () => {
    const currentResult = result ?? handleFormatAndReveal(input);
    if (!currentResult) return;
    await bundles.save({
      sourceText: input,
      headerColor,
      articleType,
      articleTitles: currentResult.articles.map((article) => article.title),
    });
  }, [articleType, bundles, handleFormatAndReveal, headerColor, input, result]);

  const handleOpenBundle = useCallback((entry: ArticleBundleEntry) => {
    publicationRevisionRef.current += 1;
    setHeaderColor(entry.headerColor);
    setArticleType(entry.articleType);
    setInput(entry.sourceText);
    const formatted = runFormat(entry.sourceText, entry.headerColor, entry.articleType);
    if (!formatted) return;

    const canRestoreTitles = formatted.articles.length === entry.articleTitles.length;
    const articles = canRestoreTitles
      ? formatted.articles.map((article, index) => {
          const titledArticle = { ...article, title: entry.articleTitles[index] };
          const rendered = renderArticle(titledArticle, { headerColor: entry.headerColor, articleType: entry.articleType });
          return { ...titledArticle, ...rendered, characterCount: rendered.plainText.length };
        })
      : formatted.articles;
    setResult({ ...formatted, articles });
    setExpandedIds(articles.length === 1 ? [articles[0].id] : []);
    revealResults();
    toast.success(canRestoreTitles ? "저장한 글뭉치를 다시 열었습니다." : "원고를 다시 열었지만 글 구성이 달라 제목은 새로 정리했습니다.");
  }, [revealResults, runFormat]);

  const handleColorChange = (color: string) => {
    setHeaderColor(color);
    if (!result) return;
    const recoloredArticles = result.articles.map((article) => {
      const rendered = renderArticle(article, { headerColor: color, articleType });
      return {
        ...article,
        ...rendered,
        characterCount: rendered.plainText.length,
      };
    });
    setResult({ ...result, articles: recoloredArticles });
    setCopyStatus({});
  };

  const handleArticleTypeChange = (nextType: ArticleType) => {
    setArticleType(nextType);
    if (!result || nextType === articleType) return;
    publicationRevisionRef.current += 1;
    const articles = result.articles.map((article) => {
      const rendered = renderArticle(article, { headerColor, articleType: nextType });
      return {
        ...article,
        ...rendered,
        characterCount: rendered.plainText.length,
      };
    });
    setResult({ ...result, articles });
    setCopyStatus({});
    setPublicationReviews({});
  };

  const handleReset = () => {
    publicationRevisionRef.current += 1;
    setInput("");
    setArticleType("information");
    setResult(null);
    setError("");
    setExpandedIds([]);
    setCopyStatus({});
    setPublicationReviews({});
    setIsInputPanelExpanded(false);
  };

  const handleTitleChange = (articleId: string, title: string) => {
    if (!result) return;
    publicationRevisionRef.current += 1;
    setResult({
      ...result,
      articles: result.articles.map((article) => {
        if (article.id !== articleId) return article;
        const titledArticle = { ...article, title };
        const rendered = renderArticle(titledArticle, { headerColor, articleType });
        return {
          ...titledArticle,
          ...rendered,
          characterCount: rendered.plainText.length,
        };
      }),
    });
    setCopyStatus({});
    setPublicationReviews((current) => {
      const review = current[articleId];
      if (!review) return current;
      return { ...current, [articleId]: { ...review, comparison: null, error: "" } };
    });
  };

  const handlePublishedChange = (articleId: string, completed: boolean) => {
    publicationRevisionRef.current += 1;
    setPublicationReviews((current) => {
      const review = current[articleId];
      return {
        ...current,
        [articleId]: {
          completed,
          publishedText: review?.publishedText ?? "",
          publishedHtml: review?.publishedHtml ?? "",
          captureMode: review?.captureMode ?? "text-only",
          comparison: completed ? review?.comparison ?? null : null,
          error: "",
          historyId: review?.historyId ?? null,
        },
      };
    });
  };

  const handlePublishedTextChange = (articleId: string, publishedText: string) => {
    publicationRevisionRef.current += 1;
    setPublicationReviews((current) => {
      const review = current[articleId] ?? {
        completed: true,
        publishedText: "",
        publishedHtml: "",
        captureMode: "text-only" as const,
        comparison: null,
        error: "",
        historyId: null,
      };
      const edited = applyPublicationTextEdit(review, publishedText) as Pick<
        PublicationReview,
        "publishedText" | "publishedHtml" | "captureMode"
      >;
      return {
        ...current,
        [articleId]: {
          ...review,
          ...edited,
          completed: true,
          comparison: null,
          error: "",
        },
      };
    });
  };

  const handlePublishedPaste = (
    articleId: string,
    event: ReactClipboardEvent<HTMLTextAreaElement>,
  ) => {
    const plainText = event.clipboardData.getData("text/plain");
    if (!plainText) return;
    event.preventDefault();
    const target = event.currentTarget;
    let pasted: Pick<PublicationReview, "publishedText" | "publishedHtml" | "captureMode">;
    try {
      pasted = createPublicationPasteState({
        currentText: target.value,
        selectionStart: target.selectionStart,
        selectionEnd: target.selectionEnd,
        plainText,
        htmlText: event.clipboardData.getData("text/html"),
      }) as Pick<PublicationReview, "publishedText" | "publishedHtml" | "captureMode">;
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "발행본을 붙여넣지 못했습니다.";
      setPublicationReviews((current) => ({
        ...current,
        [articleId]: {
          completed: true,
          publishedText: current[articleId]?.publishedText ?? target.value,
          publishedHtml: current[articleId]?.publishedHtml ?? "",
          captureMode: current[articleId]?.captureMode ?? "text-only",
          comparison: current[articleId]?.comparison ?? null,
          error: message,
          historyId: current[articleId]?.historyId ?? null,
        },
      }));
      return;
    }

    publicationRevisionRef.current += 1;
    setPublicationReviews((current) => ({
      ...current,
      [articleId]: {
        completed: true,
        ...pasted,
        comparison: null,
        error: "",
        historyId: current[articleId]?.historyId ?? null,
      },
    }));
  };

  const handleComparePublished = async (article: Article) => {
    const review = publicationReviews[article.id];
    const comparisonRevision = publicationRevisionRef.current;
    try {
      const comparison = comparePublishedArticle(article.plainText, review?.publishedText ?? "", {
        title: article.title,
        expectedHtml: createCopyPayload(article, false).html,
        actualHtml: review?.publishedHtml ?? "",
      }) as ComparisonResult;
      const saveResult = await history.saveComparison({
        historyId: review?.historyId ?? null,
        title: article.title,
        preparedText: article.plainText,
        publishedText: review?.publishedText ?? "",
        comparison,
        isCurrent: () => publicationRevisionRef.current === comparisonRevision,
      });
      if (saveResult.status === "stale" || publicationRevisionRef.current !== comparisonRevision) return;

      setPublicationReviews((current) => ({
        ...current,
        [article.id]: {
          completed: true,
          publishedText: current[article.id]?.publishedText ?? "",
          publishedHtml: current[article.id]?.publishedHtml ?? "",
          captureMode: current[article.id]?.captureMode ?? "text-only",
          comparison,
          error: "",
          historyId: saveResult.historyId,
        },
      }));
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : "발행본을 비교하지 못했습니다.";
      setPublicationReviews((current) => ({
        ...current,
        [article.id]: {
          completed: true,
          publishedText: current[article.id]?.publishedText ?? "",
          publishedHtml: current[article.id]?.publishedHtml ?? "",
          captureMode: current[article.id]?.captureMode ?? "text-only",
          comparison: null,
          error: message,
          historyId: current[article.id]?.historyId ?? null,
        },
      }));
    }
  };

  const handleCopy = async (
    article: Article,
    action: "title" | "plain" | "rich" | "image",
  ) => {
    const payload =
      action === "title"
        ? { html: article.title, plainText: article.title }
        : action === "image"
          ? createImagePromptPayload(article)
          : createCopyPayload(article, false);

    try {
      const copied = await copyArticle(payload, action === "rich" ? "rich" : "plain");
      const message =
        action === "title"
          ? "제목을 복사했습니다."
          : action === "image"
            ? "이미지 생성 요청을 복사했습니다."
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
              articleType: { type: "string", enum: ["information", "advertisement"] },
            },
            required: ["content"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: false, untrustedContentHint: true },
          execute: (value: unknown) => {
            if (!value || typeof value !== "object") throw new Error("원고 내용이 필요합니다.");
            const { content, headerColor: requestedColor, articleType: requestedType } = value as {
              content?: unknown;
              headerColor?: unknown;
              articleType?: unknown;
            };
            if (typeof content !== "string" || !content.trim()) {
              throw new Error("content에는 정리할 원고를 입력해야 합니다.");
            }
            const color =
              typeof requestedColor === "string" && /^#[0-9a-f]{6}$/i.test(requestedColor)
                ? requestedColor
                : headerColor;
            const type: ArticleType = requestedType === "advertisement" ? "advertisement" : "information";
            setInput(content);
            setHeaderColor(color);
            setArticleType(type);
            const formatted = runFormat(content, color, type);
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
    <main ref={pageTopRef} tabIndex={-1} className="min-h-screen bg-[var(--canvas)] text-[var(--ink)] outline-none">
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
            글은 이 컴퓨터 밖으로 나가지 않아요
          </Badge>
        </div>
        <GptShortcutsBar
          entries={gptShortcuts.entries}
          warning={gptShortcuts.warning}
          onAdd={gptShortcuts.add}
          onUpdate={gptShortcuts.update}
          onMove={gptShortcuts.move}
          onRemove={gptShortcuts.remove}
        />
      </header>

      <div className="mx-auto max-w-[1500px] px-4 pt-6 pb-24 sm:px-6 lg:px-8 lg:py-8">
        <section className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <Badge className="mb-3 bg-[#17231d] text-white">3~5개 원고 한 번에</Badge>
            <h1 className="max-w-3xl text-[clamp(1.8rem,4vw,3.15rem)] font-black leading-[1.08] tracking-[-0.055em] text-[#13251b]">
              글 뭉치를 붙여넣고,
              <br className="hidden sm:block" /> 발행 직전 원고로 정리하세요.
            </h1>
          </div>
          <p className="max-w-xl text-sm leading-6 text-[var(--muted-ink)] lg:text-right">
            질문형 소제목, A: 핵심 답변, 구분선과 회색 표 제목행을 기준 글 양식에 맞춰 정리합니다.
            제목·본문·이미지 생성 요청을 글별로 따로 복사할 수 있어요.
          </p>
        </section>

        <section className="grid gap-5 xl:grid-cols-[minmax(0,0.95fr)_minmax(520px,1.05fr)] xl:items-start">
          <Card className={`gap-0 overflow-hidden rounded-[24px] border-[var(--line)] py-0 shadow-[0_18px_55px_rgba(24,46,35,0.07)] ${inputPanel.panelClass}`}>
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-5 py-4 sm:px-6">
              <div className="flex items-center gap-2.5">
                <span className="step-number">1</span>
                <div>
                  <h2 className="font-bold tracking-[-0.02em]">GPT 글 묶음 붙여넣기</h2>
                  <p className="text-xs text-[var(--muted-ink)]">글 사이는 --- · 1편/2편 · 1번 글/2번 글 · 주제명 1번/2번 · # 큰 제목으로 자동 구분</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  aria-expanded={inputPanel.expanded}
                  aria-controls="input-panel-content"
                  onClick={() => setIsInputPanelExpanded((current) => !current)}
                >
                  {inputPanel.toggleLabel}
                  <ChevronDown className={`size-4 transition-transform ${inputPanel.expanded ? "rotate-180" : ""}`} aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-emerald-800 hover:bg-emerald-50 hover:text-emerald-900"
                  onClick={() => {
                    publicationRevisionRef.current += 1;
                    setInput(EXAMPLE_TEXT);
                    setResult(null);
                    setExpandedIds([]);
                    setCopyStatus({});
                    setPublicationReviews({});
                    setError("");
                  }}
                >
                  예시 불러오기
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!input.trim()}
                  onClick={() => void handleSaveBundle()}
                >
                  <Save className="size-4" aria-hidden="true" />
                  저장
                </Button>
                <Button
                  type="button"
                  size="sm"
                  className="bg-[var(--brand)] text-white hover:bg-[#02b351]"
                  disabled={!input.trim()}
                  onClick={() => handleFormatAndReveal(input)}
                >
                  <Sparkles className="size-4" aria-hidden="true" />
                  바로 정리
                </Button>
              </div>
            </div>

            <CardContent id="input-panel-content" className="flex min-h-0 flex-1 flex-col space-y-4 px-4 py-4 sm:px-6 sm:py-5">
              <div className="flex flex-col gap-2 rounded-2xl border border-[#d8e7de] bg-[#f7fbf8] p-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-bold text-[#173023]">글뭉치 종류</p>
                  <p className="text-xs leading-5 text-[var(--muted-ink)]">선택한 종류에 맞춰 모든 글의 마지막 문구가 바뀝니다.</p>
                </div>
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="글뭉치 종류">
                  {ARTICLE_TYPES.map((type) => {
                    const selected = articleType === type.value;
                    return (
                      <button
                        key={type.value}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={`${type.label}: ${type.description}`}
                        onClick={() => handleArticleTypeChange(type.value)}
                        className={`rounded-xl border px-4 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 ${selected ? "border-emerald-600 bg-emerald-600 text-white" : "border-slate-200 bg-white text-[#173023] hover:border-emerald-300"}`}
                      >
                        <span className="block text-sm font-extrabold">{type.label}</span>
                        <span className={`block text-[11px] ${selected ? "text-emerald-50" : "text-[var(--muted-ink)]"}`}>{type.description}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className={`relative ${inputPanel.textareaWrapperClass}`}>
                <Textarea
                  aria-label="정리할 블로그 원고"
                  aria-describedby={error ? "input-error" : "input-help"}
                  aria-invalid={Boolean(error)}
                  value={input}
                  maxLength={MAX_INPUT_LENGTH}
                  onPaste={handleInputPaste}
                  onChange={(event) => {
                    publicationRevisionRef.current += 1;
                    setInput(event.target.value);
                    setResult(null);
                    setExpandedIds([]);
                    setCopyStatus({});
                    setPublicationReviews({});
                    if (error) setError("");
                  }}
                  placeholder={`# 첫 번째 글 제목\n\n본문을 붙여넣으세요.\n\n---\n\n# 두 번째 글 제목\n\n다음 글을 이어서 붙여넣으세요.`}
                  className={`${inputPanel.textareaClass} rounded-2xl border-slate-200 bg-[#fbfdfc] p-5 font-[family-name:var(--font-reading)] text-base leading-7 shadow-inner focus-visible:border-emerald-500 focus-visible:ring-emerald-100`}
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
                  붙여넣으면 자동 정리됩니다. 저장한 원고는 로컬 DB에 남아 재시작 후에도 유지되므로 공용 계정에서는 사용 후 삭제하세요.
                </p>
              )}

              <div className="flex flex-col gap-3 sm:flex-row">
                <Button
                  type="button"
                  className="h-12 flex-1 rounded-xl bg-[var(--brand)] text-base font-bold text-white shadow-[0_10px_24px_rgba(3,199,90,0.2)] hover:bg-[#02b351]"
                  onClick={() => handleFormatAndReveal(input)}
                >
                  <Sparkles className="size-4.5" aria-hidden="true" />
                  글별로 정리하기
                  <ArrowRight className="size-4.5" aria-hidden="true" />
                </Button>
                <Button type="button" variant="outline" className="h-12 rounded-xl px-5" onClick={() => void handleSaveBundle()} disabled={!input.trim()}>
                  <Save className="size-4" aria-hidden="true" />
                  글뭉치 저장
                </Button>
                <Button type="button" variant="outline" className="h-12 rounded-xl px-5" onClick={handleReset} disabled={!input && !result}>
                  <RotateCcw className="size-4" aria-hidden="true" />
                  초기화
                </Button>
              </div>
            </CardContent>
          </Card>

          <section aria-labelledby="result-title" className={RESULT_WORKSPACE_CLASS}>
            <p className="sr-only" role="status" aria-live="polite">
              {result ? `${result.articles.length}편 정리가 완료되었습니다. 화면 맨 위로 이동했습니다.` : ""}
            </p>
            <div className="mb-3 flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-3 px-1">
              <div className="flex items-center gap-2.5">
                <span className="step-number">2</span>
                <div>
                  <h2 id="result-title" className="font-bold tracking-[-0.02em]">글별 확인·복사</h2>
                  <p className="text-xs text-[var(--muted-ink)]">제목·본문·이미지 요청을 필요한 순서대로 복사하세요</p>
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
              <div className="grid min-h-[535px] place-items-center rounded-[24px] border border-dashed border-[#bfd6c9] bg-[linear-gradient(145deg,rgba(255,255,255,0.92),rgba(239,250,244,0.78))] p-8 text-center xl:min-h-0 xl:flex-1">
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
              <div className="space-y-3 xl:flex xl:min-h-0 xl:flex-1 xl:flex-col xl:space-y-0 xl:gap-3">
                <div className="flex flex-col gap-3 rounded-2xl border border-[#d8e7de] bg-[#f5fbf7] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#26563e]">
                    <Check className="size-4" aria-hidden="true" />
                    {METHOD_LABELS[result.method]}
                    <Badge variant="outline" className="border-slate-200 bg-white text-slate-700">
                      기준 글 양식 적용
                    </Badge>
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

                <div aria-label="정리된 글 목록" tabIndex={0} className={RESULT_LIST_CLASS}>
                  {result.articles.map((article, index) => {
                    const isExpanded = expandedIds.includes(article.id);
                    const review = publicationReviews[article.id];
                    const isPublished = review?.completed ?? false;
                    const comparison = review?.comparison ?? null;
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
                                {article.engagementCtaAdded && (
                                  <Badge variant="outline" className={articleType === "advertisement" ? "border-amber-200 bg-amber-50 text-amber-800" : "border-violet-200 bg-violet-50 text-violet-800"}>
                                    {articleType === "advertisement" ? "광고글 마무리" : "정보글 마무리"}
                                  </Badge>
                                )}
                                {isPublished && (
                                  <Badge variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-800">
                                    발행 완료
                                  </Badge>
                                )}
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

                          <ArticleImagePromptPanel
                            article={article}
                            index={index}
                            onCopy={() => void handleCopy(article, "image")}
                          />

                          <div className={`mt-3 flex flex-col gap-2 rounded-xl border px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between ${isPublished ? "border-emerald-200 bg-emerald-50/60" : "border-slate-200 bg-slate-50/70"}`}>
                            <div className="flex min-w-0 items-center gap-2.5">
                              <Checkbox
                                id={`${article.id}-published`}
                                checked={isPublished}
                                onCheckedChange={(checked) => handlePublishedChange(article.id, checked === true)}
                              />
                              <label htmlFor={`${article.id}-published`} className="cursor-pointer text-sm font-bold text-[#173023]">
                                발행 완료
                              </label>
                              {comparison && (
                                <Badge variant="outline" className={comparison.status === "match" && comparison.formatting?.status === "match" ? "border-emerald-200 bg-white text-emerald-800" : comparison.status === "different" ? "border-rose-200 bg-white text-rose-800" : "border-amber-200 bg-white text-amber-800"}>
                                  {comparison.status === "different"
                                    ? `내용 ${comparison.score}%`
                                    : comparison.status === "formatting-only"
                                      ? comparison.formatting?.status === "different"
                                        ? `서식 ${comparison.formatting.score}%`
                                        : "문단·띄어쓰기 차이"
                                      : comparison.formatting?.status === "match"
                                        ? "내용·서식 일치"
                                        : "내용 일치 · 서식 미확인"}
                                </Badge>
                              )}
                            </div>

                            {isPublished && review && (
                              <PublicationCompareDialog
                                articleId={article.id}
                                title={article.title}
                                maxLength={MAX_COMPARISON_LENGTH}
                                review={review}
                                onPaste={(event) => handlePublishedPaste(article.id, event)}
                                onTextChange={(value) => handlePublishedTextChange(article.id, value)}
                                onCompare={() => handleComparePublished(article)}
                              />
                            )}
                          </div>

                          <p className="sr-only" role="status" aria-live="polite">
                            {copyStatus[article.id] ?? ""}
                          </p>
                        </div>

                        {isExpanded && (
                          <div className="bg-[#f8faf9] p-3 sm:p-4">
                            <div className="preview-paper overflow-x-auto rounded-xl border border-[#dce5e0] bg-white p-5 sm:p-7" dangerouslySetInnerHTML={{ __html: createCopyPayload(article, false).html }} />
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>

                <p className="shrink-0 px-2 pt-1 text-xs leading-5 text-[var(--muted-ink)]">
                  서식 복사는 브라우저와 네이버 편집기 상태에 따라 표 색상·간격이 달라질 수 있습니다. 이미지는 네이버 포토 업로더에서 따로 넣어주세요.
                </p>
              </div>
            )}
          </section>
        </section>

        {input.trim() && !result && (
          <div
            className="fixed inset-x-4 z-40 lg:hidden"
            style={{ bottom: "calc(1rem + env(safe-area-inset-bottom))" }}
          >
            <Button
              type="button"
              className="h-12 w-full rounded-xl bg-[var(--brand)] text-base font-bold text-white shadow-[0_14px_35px_rgba(3,120,67,0.3)] hover:bg-[#02b351]"
              onClick={() => handleFormatAndReveal(input)}
            >
              <Sparkles className="size-4.5" aria-hidden="true" />
              글별로 바로 정리
            </Button>
          </div>
        )}

        <ArticleBundlePanel
          entries={bundles.entries}
          warning={bundles.warning}
          currentSourceText={input}
          currentHeaderColor={headerColor}
          currentArticleType={articleType}
          currentArticleTitles={currentArticleTitles}
          hasPublicationWork={hasPublicationWork}
          onOpen={handleOpenBundle}
          onDelete={bundles.remove}
          onClear={bundles.clear}
        />

        <PublicationHistoryPanel
          entries={history.entries}
          warning={history.warning}
          onCopy={history.copy}
          onDelete={history.remove}
          onClear={history.clear}
        />
      </div>
    </main>
  );
}
