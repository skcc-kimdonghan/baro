import { createElement } from "react";
import { Copy, ImagePlus } from "lucide-react";

const COPY_BUTTON_CLASS = [
  "inline-flex h-8 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md",
  "border border-sky-200 bg-white px-2.5 text-sm font-medium text-sky-900 shadow-xs",
  "transition-all outline-none hover:bg-sky-100 focus-visible:ring-3 focus-visible:ring-sky-200/50",
  "[&_svg]:pointer-events-none [&_svg]:shrink-0",
].join(" ");

export function ArticleImagePromptPanel({ article, index, onCopy }) {
  const prompt = String(article?.imagePrompt ?? "").trim();
  const articleId = String(article?.id ?? "");
  const title = String(article?.title ?? "").trim();

  return createElement(
    "div",
    {
      "data-image-prompt-panel": articleId,
      className: "mt-3 rounded-xl border border-sky-200 bg-sky-50/70 p-3.5",
    },
    createElement(
      "div",
      { className: "flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between" },
      createElement(
        "p",
        { className: "flex items-center gap-2 text-sm font-bold text-sky-950" },
        createElement(ImagePlus, { className: "size-4 text-sky-700", "aria-hidden": true }),
        "아래 이미지를 생성해주세요",
      ),
      createElement(
        "button",
        {
          type: "button",
          className: COPY_BUTTON_CLASS,
          "aria-label": `${index + 1}번째 글 ${title} 이미지 요청 복사`,
          onClick: onCopy,
        },
        createElement(Copy, { className: "size-3.5", "aria-hidden": true }),
        "이미지 요청 복사",
      ),
    ),
    createElement(
      "p",
      {
        className: `mt-2 whitespace-pre-wrap text-sm leading-6 ${prompt ? "text-slate-700" : "text-slate-500"}`,
      },
      prompt || "이미지 설명 없음 · 위 문구만 복사됩니다.",
    ),
  );
}
