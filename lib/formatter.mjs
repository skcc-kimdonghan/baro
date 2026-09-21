export const MAX_INPUT_LENGTH = 100_000;
export const MAX_LINE_COUNT = 6_000;
export const MAX_ARTICLES = 50;
export const DEFAULT_HEADER_COLOR = "#F7F7F7";

const RECOMMENDED_MIN_ARTICLES = 3;
const RECOMMENDED_MAX_ARTICLES = 5;
const DIVIDER_PATTERN = /^(?:-{3,}|={3,}|\*{3,})$/;
const LABEL_PATTERN = /^\s{0,3}#{0,6}\s*(?:글|원고|포스팅|아티클)\s*\d+\s*(?::|[.)-])?\s*(.*)$/i;
const H1_PATTERN = /^#\s+(.+)$/;

function validationError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeLine(line, isCode) {
  const withoutTrailingWhitespace = line.replace(/[ \t]+$/g, "");
  if (isCode) return withoutTrailingWhitespace;
  return withoutTrailingWhitespace
    .replace(/^[ \t]+/g, "")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[ \t]{2,}/g, " ");
}

export function normalizeWhitespace(value) {
  const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
  let inFence = false;
  let blankRun = 0;
  const normalized = [];

  for (const line of lines) {
    const isFence = /^\s*```/.test(line);
    const result = normalizeLine(line, inFence || isFence);
    if (isFence) {
      normalized.push(result);
      inFence = !inFence;
      blankRun = 0;
      continue;
    }
    if (inFence) {
      normalized.push(result);
      continue;
    }
    if (!result.trim()) {
      if (blankRun === 0) normalized.push("");
      blankRun += 1;
      continue;
    }
    normalized.push(result);
    blankRun = 0;
  }

  return normalized.join("\n").trim();
}

function collectBoundaries(lines, predicate) {
  let inFence = false;
  return lines.reduce((boundaries, line, index) => {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      return boundaries;
    }
    if (!inFence && predicate(line, index)) boundaries.push(index);
    return boundaries;
  }, []);
}

function nextContentIndexes(lines) {
  const nextByIndex = new Array(lines.length).fill(-1);
  let nextIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    nextByIndex[index] = nextIndex;
    if (lines[index].trim()) nextIndex = index;
  }
  return nextByIndex;
}

function isArticleDivider(lines, nextByIndex, index) {
  if (!DIVIDER_PATTERN.test(lines[index].trim())) return false;
  const previousIsBlank = index === 0 || !lines[index - 1].trim();
  const nextIsBlank = index === lines.length - 1 || !lines[index + 1].trim();
  const nextIndex = nextByIndex[index];
  const nextContent = nextIndex >= 0 ? lines[nextIndex] : "";
  const followingIndex = nextIndex >= 0 ? nextByIndex[nextIndex] : -1;
  const followingContent = followingIndex >= 0 ? lines[followingIndex] : "";
  if (
    structuralText(nextContent) === "이 글에서 볼 내용" ||
    isReferenceQuestion(nextContent, followingContent)
  ) {
    return false;
  }
  const nextStartsArticle = H1_PATTERN.test(nextContent) || LABEL_PATTERN.test(nextContent);
  return (previousIsBlank && nextIsBlank) || nextStartsArticle;
}

function splitAtDivider(lines, dividerIndexes) {
  const dividerSet = new Set(dividerIndexes);
  const sections = [];
  let current = [];

  lines.forEach((line, index) => {
    if (!dividerSet.has(index)) {
      current.push(line);
      return;
    }
    const content = normalizeWhitespace(current.join("\n"));
    if (content) sections.push(content);
    current = [];
  });

  const tail = normalizeWhitespace(current.join("\n"));
  if (tail) sections.push(tail);
  return sections;
}

function splitAtStarts(lines, starts) {
  const leading = normalizeWhitespace(lines.slice(0, starts[0]).join("\n"));
  return starts
    .map((start, index) => {
      const end = starts[index + 1] ?? lines.length;
      const sectionLines = lines.slice(start, end);
      if (index === 0 && leading) return `${leading}\n\n${sectionLines.join("\n")}`;
      return sectionLines.join("\n");
    })
    .map(normalizeWhitespace)
    .filter(Boolean);
}

function stripInlineMarkdown(value) {
  return value
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\s*(?:제목|title)\s*[:：]\s*/i, "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .replace(/[*_~`]/g, "")
    .trim();
}

function extractTitle(source, preferredTitle = "") {
  const preferred = stripInlineMarkdown(preferredTitle);
  if (preferred) return preferred.slice(0, 100);

  const lines = source.split("\n");
  const explicitTitle = lines.find((line) => H1_PATTERN.test(line));
  if (explicitTitle) return stripInlineMarkdown(explicitTitle).slice(0, 100);

  const namedTitle = lines.find((line) => /^\s*(?:제목|title)\s*[:：]/i.test(line));
  if (namedTitle) return stripInlineMarkdown(namedTitle).slice(0, 100);

  const firstContent = lines.find((line) => line.trim() && !DIVIDER_PATTERN.test(line.trim()));
  if (!firstContent) return "제목 없는 글";
  const candidate = stripInlineMarkdown(firstContent);
  return candidate.length > 60 ? `${candidate.slice(0, 57)}…` : candidate;
}

function removeLeadingTitle(source) {
  const lines = source.split("\n");
  const firstContentIndex = lines.findIndex((line) => line.trim());
  if (firstContentIndex < 0) return "";

  const firstLine = lines[firstContentIndex];
  if (
    H1_PATTERN.test(firstLine) ||
    LABEL_PATTERN.test(firstLine) ||
    /^\s*(?:제목|title)\s*[:：]/i.test(firstLine)
  ) {
    return normalizeWhitespace([
      ...lines.slice(0, firstContentIndex),
      ...lines.slice(firstContentIndex + 1),
    ].join("\n"));
  }
  return normalizeWhitespace(source);
}

function toArticle(source, index) {
  const labelMatch = source.split("\n").find((line) => LABEL_PATTERN.test(line))?.match(LABEL_PATTERN);
  const title = extractTitle(source, labelMatch?.[1] ?? "");
  return Object.freeze({
    id: `article-${index + 1}`,
    title,
    source,
    bodySource: removeLeadingTitle(source),
  });
}

export function splitArticles(input) {
  const normalized = normalizeWhitespace(input);
  if (!normalized) throw validationError("정리할 글을 먼저 붙여넣어 주세요.", "EMPTY_INPUT");
  if (normalized.length > MAX_INPUT_LENGTH) {
    throw validationError(
      `입력은 ${MAX_INPUT_LENGTH.toLocaleString("ko-KR")}자까지 정리할 수 있습니다.`,
      "INPUT_TOO_LONG",
    );
  }

  const lines = normalized.split("\n");
  if (lines.length > MAX_LINE_COUNT) {
    throw validationError(
      `입력은 ${MAX_LINE_COUNT.toLocaleString("ko-KR")}줄까지 정리할 수 있습니다.`,
      "TOO_MANY_LINES",
    );
  }
  const nextByIndex = nextContentIndexes(lines);
  const dividers = collectBoundaries(lines, (_line, index) => isArticleDivider(lines, nextByIndex, index));
  const dividedSections = splitAtDivider(lines, dividers);

  let method = "single";
  let sections = [normalized];

  if (dividers.length > 0 && dividedSections.length > 1) {
    method = "divider";
    sections = dividedSections;
  } else {
    const labels = collectBoundaries(lines, (line) => LABEL_PATTERN.test(line));
    if (labels.length > 1) {
      method = "label";
      sections = splitAtStarts(lines, labels);
    } else {
      const headings = collectBoundaries(lines, (line) => H1_PATTERN.test(line));
      if (headings.length > 1) {
        method = "heading";
        sections = splitAtStarts(lines, headings);
      }
    }
  }

  if (sections.length > MAX_ARTICLES) {
    throw validationError(
      `한 번에 최대 ${MAX_ARTICLES}편까지 정리할 수 있습니다.`,
      "TOO_MANY_ARTICLES",
    );
  }

  const articles = sections.map(toArticle);
  const warnings = [];
  if (method === "single") {
    warnings.push("글 경계를 확실히 찾지 못해 한 편으로 유지했습니다.");
  }
  if (articles.length < RECOMMENDED_MIN_ARTICLES || articles.length > RECOMMENDED_MAX_ARTICLES) {
    warnings.push("한 번에 3~5편을 정리할 때 가장 확인하기 쉽습니다.");
  }

  return Object.freeze({ method, articles: Object.freeze(articles), warnings: Object.freeze(warnings) });
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replace(/\bon[a-z]+\s*=/gi, (attribute) => attribute.replace("=", "&#61;"));
}

function renderInlineMarkdown(value) {
  const tokens = [];
  const reserve = (html) => {
    const token = `\u0000${tokens.length}\u0000`;
    tokens.push(html);
    return token;
  };

  let rendered = escapeHtml(value);
  rendered = rendered.replace(/`([^`]+)`/g, (_, code) => reserve(`<code style="padding:2px 5px;border-radius:5px;background:#f1f3f5;font-family:monospace;">${code}</code>`));
  rendered = rendered.replace(/\[([^\]]+)\]\(([^()]*(?:\([^)]*\)[^()]*)*)\)/g, (_, label, url) => {
    const decodedUrl = url.replaceAll("&amp;", "&");
    if (!/^https?:\/\/[^\s]+$/i.test(decodedUrl)) return reserve(label);
    return reserve(`<a href="${escapeHtml(decodedUrl)}" style="color:#087f5b;text-decoration:underline;">${label}</a>`);
  });
  rendered = rendered
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");

  return rendered.replace(/\u0000(\d+)\u0000/g, (_, index) => tokens[Number(index)] ?? "");
}

function plainInline(value) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "[이미지: $1]")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^()]*(?:\([^)]*\)[^()]*)*)\)/gi, "$1 ($2)")
    .replace(/\[([^\]]+)\]\(([^()]*(?:\([^)]*\)[^()]*)*)\)/g, "$1")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1$2");
}

function parsePipeRow(line) {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let current = "";
  let escaped = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const character = trimmed[index];
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\" && ["|", "\\"].includes(trimmed[index + 1])) {
      escaped = true;
    } else if (character === "|") {
      cells.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }
  cells.push(current.trim());
  return cells;
}

function isTableDivider(line) {
  const cells = parsePipeRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function tableAlignments(dividerCells) {
  return dividerCells.map((cell) => {
    if (cell.startsWith(":") && cell.endsWith(":")) return "center";
    if (cell.startsWith(":")) return "left";
    if (cell.endsWith(":")) return "right";
    return "center";
  });
}

function renderTable(lines, headerColor) {
  const rawHeader = parsePipeRow(lines[0]);
  const rawRows = lines.slice(2).map(parsePipeRow);
  const width = Math.max(rawHeader.length, ...rawRows.map((row) => row.length));
  const header = Array.from(
    { length: width },
    (_, index) => rawHeader[index] ?? `열 ${index + 1}`,
  );
  const rawAlignments = tableAlignments(parsePipeRow(lines[1]));
  const alignments = Array.from(
    { length: width },
    (_, index) => rawAlignments[index] ?? "center",
  );
  const rows = rawRows.map((cells) =>
    Array.from({ length: width }, (_, index) => cells[index] ?? ""),
  );
  const borderStyle = "border:1px solid #e1e1e1;padding:10px;line-height:1.6;vertical-align:middle;color:#666666;font-size:15px;";
  const headHtml = header
    .map((cell, index) => `<th style="${borderStyle}background-color:${headerColor};font-weight:700;text-align:${alignments[index] ?? "left"};">${renderInlineMarkdown(cell)}</th>`)
    .join("");
  const bodyHtml = rows
    .map((row) => `<tr>${row.map((cell, index) => `<td style="${borderStyle}text-align:${alignments[index] ?? "left"};">${renderInlineMarkdown(cell)}</td>`).join("")}</tr>`)
    .join("");
  const html = `<div style="max-width:100%;overflow-x:auto;margin:18px 0;"><table style="width:100%;border-collapse:collapse;table-layout:auto;border:1px solid #e1e1e1;"><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
  const plainText = [header, ...rows].map((row) => row.map(plainInline).join("\t")).join("\n");
  return { html, plainText };
}

function isBlockStart(lines, index) {
  const line = lines[index] ?? "";
  const next = lines[index + 1] ?? "";
  const blockText = structuralText(line);
  return (
    !line.trim() ||
    /^```/.test(line.trim()) ||
    DIVIDER_PATTERN.test(line.trim()) ||
    /^#{2,6}\s+/.test(line) ||
    /^>\s?/.test(line) ||
    /^[-*+]\s+/.test(line) ||
    /^\d+[.)]\s+/.test(line) ||
    blockText === "이 글에서 볼 내용" ||
    /^A\s*[:：]\s*\S/.test(blockText) ||
    /^(?:\d+[.)]\s+|그래서[,，]?\s*).+[?？]$/.test(blockText) ||
    (line.includes("|") && isTableDivider(next))
  );
}

function structuralText(value) {
  const withoutHeading = value.replace(/^#{2,6}\s+/, "").trim();
  const hasStrongWrapper =
    (withoutHeading.startsWith("**") && withoutHeading.endsWith("**")) ||
    (withoutHeading.startsWith("__") && withoutHeading.endsWith("__"));
  return (hasStrongWrapper ? withoutHeading.slice(2, -2) : withoutHeading).trim();
}

function isReferenceAnswer(value) {
  return /^A\s*[:：]\s*\S/.test(structuralText(value));
}

function isReferenceQuestion(value, nextValue = "", allowPlain = false) {
  const text = structuralText(value);
  if (/^그래서[,，]?\s*.+[?？]$/.test(text)) return true;
  if (!/^\d+[.)]\s+.+[?？]$/.test(text)) return false;
  return /^#{2,6}\s+/.test(value) || allowPlain || isReferenceAnswer(nextValue);
}

function renderReferenceHeading(value) {
  const text = structuralText(value);
  return `<hr style="margin:30px 0;border:0;border-top:1px solid #e5e5e5;"><p style="margin:0 0 12px;font-size:15px;line-height:1.8;font-weight:700;color:#666666;word-break:keep-all;overflow-wrap:anywhere;"><strong>${renderInlineMarkdown(text)}</strong></p>`;
}

function renderReferenceAnswer(value) {
  const text = structuralText(value);
  return `<p style="margin:0 0 18px;font-size:15px;line-height:1.8;font-weight:700;color:#666666;word-break:keep-all;overflow-wrap:anywhere;"><strong>${renderInlineMarkdown(text)}</strong></p>`;
}

function safeHeaderColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value ?? "") ? value.toUpperCase() : DEFAULT_HEADER_COLOR;
}

export function renderArticle(article, options = {}) {
  const headerColor = safeHeaderColor(options.headerColor);
  const lines = normalizeWhitespace(article.bodySource).split("\n");
  const nextByIndex = nextContentIndexes(lines);
  const htmlBlocks = [];
  const plainBlocks = [];
  let tableCount = 0;
  let expectOutlineList = false;

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (/^```/.test(line.trim())) {
      const language = line.trim().slice(3).trim();
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index].trim())) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const code = codeLines.join("\n");
      htmlBlocks.push(`<pre style="margin:0 0 18px;padding:14px 16px;border-radius:10px;background:#f4f5f6;white-space:pre-wrap;line-height:1.6;"><code>${escapeHtml(code)}</code></pre>`);
      plainBlocks.push(`${language ? `[${language}]\n` : ""}${code}`);
      expectOutlineList = false;
      continue;
    }

    if (DIVIDER_PATTERN.test(line.trim())) {
      const nextIndex = nextByIndex[index];
      const nextContent = nextIndex >= 0 ? lines[nextIndex] : "";
      const followingIndex = nextIndex >= 0 ? nextByIndex[nextIndex] : -1;
      const followingContent = followingIndex >= 0 ? lines[followingIndex] : "";
      if (!isReferenceQuestion(nextContent, followingContent)) {
        htmlBlocks.push(`<hr style="margin:30px 0;border:0;border-top:1px solid #e5e5e5;">`);
      }
      expectOutlineList = false;
      index += 1;
      continue;
    }

    if (line.includes("|") && isTableDivider(lines[index + 1] ?? "")) {
      const tableLines = [line, lines[index + 1]];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        tableLines.push(lines[index]);
        index += 1;
      }
      const table = renderTable(tableLines, headerColor);
      htmlBlocks.push(table.html);
      plainBlocks.push(table.plainText);
      tableCount += 1;
      expectOutlineList = false;
      continue;
    }

    const headingMatch = line.match(/^(#{2,6})\s+(.+)$/);
    const blockText = structuralText(headingMatch?.[2] ?? line);
    if (blockText === "이 글에서 볼 내용") {
      htmlBlocks.push(`<p style="margin:24px 0 10px;font-size:16px;line-height:1.8;font-weight:700;color:#666666;"><strong>이 글에서 볼 내용</strong></p>`);
      plainBlocks.push("이 글에서 볼 내용");
      expectOutlineList = true;
      index += 1;
      continue;
    }

    if (
      !expectOutlineList &&
      isReferenceQuestion(
        line,
        nextByIndex[index] >= 0 ? lines[nextByIndex[index]] : "",
      )
    ) {
      htmlBlocks.push(renderReferenceHeading(headingMatch?.[2] ?? line));
      plainBlocks.push(blockText);
      index += 1;
      continue;
    }

    if (/^A\s*[:：]\s*\S/.test(blockText)) {
      htmlBlocks.push(renderReferenceAnswer(headingMatch?.[2] ?? line));
      plainBlocks.push(blockText);
      expectOutlineList = false;
      index += 1;
      continue;
    }

    if (headingMatch) {
      const level = headingMatch[1].length <= 2 ? 2 : 3;
      htmlBlocks.push(`<h${level} style="margin:30px 0 12px;font-size:${level === 2 ? "22px" : "18px"};line-height:1.45;font-weight:800;color:#17231d;">${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
      plainBlocks.push(plainInline(headingMatch[2]));
      expectOutlineList = false;
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      htmlBlocks.push(`<blockquote style="margin:18px 0;padding:14px 18px;border-left:4px solid #16a56a;background:#f2fbf6;color:#666666;font-size:15px;line-height:1.8;">${quoteLines.map(renderInlineMarkdown).join("<br>")}</blockquote>`);
      plainBlocks.push(quoteLines.map((quote) => `> ${plainInline(quote)}`).join("\n"));
      expectOutlineList = false;
      continue;
    }

    const unordered = /^[-*+]\s+/.test(line);
    const ordered = /^\d+[.)]\s+/.test(line);
    if (unordered || ordered) {
      const pattern = unordered ? /^[-*+]\s+(.+)$/ : /^(\d+)[.)]\s+(.+)$/;
      const items = [];
      while (index < lines.length) {
        const match = lines[index].match(pattern);
        if (!match) break;
        items.push(
          unordered
            ? { text: match[1], value: null }
            : { text: match[2], value: Number(match[1]) },
        );
        index += 1;
      }
      const tag = unordered ? "ul" : "ol";
      htmlBlocks.push(`<${tag} style="margin:0 0 18px;padding-left:24px;color:#666666;font-size:15px;line-height:1.8;">${items.map((item) => `<li${item.value === null ? "" : ` value="${item.value}"`} style="margin:4px 0;">${renderInlineMarkdown(item.text)}</li>`).join("")}</${tag}>`);
      plainBlocks.push(items.map((item) => `${item.value === null ? "•" : `${item.value}.`} ${plainInline(item.text)}`).join("\n"));
      expectOutlineList = false;
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length && !isBlockStart(lines, index)) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    if (paragraphLines.length === 0) {
      paragraphLines.push(line);
      index += 1;
    }
    htmlBlocks.push(`<p style="margin:0 0 18px;font-size:15px;line-height:1.8;color:#666666;word-break:keep-all;overflow-wrap:anywhere;">${paragraphLines.map(renderInlineMarkdown).join("<br>")}</p>`);
    plainBlocks.push(paragraphLines.map(plainInline).join("\n"));
    expectOutlineList = false;
  }

  return Object.freeze({
    html: htmlBlocks.join(""),
    plainText: plainBlocks.join("\n\n").trim(),
    tableCount,
  });
}

export function createCopyPayload(article, includeTitle = false) {
  if (!includeTitle) return Object.freeze({ html: article.html, plainText: article.plainText });
  return Object.freeze({
    html: `<h1 style="margin:0 0 24px;font-size:28px;line-height:1.4;font-weight:800;color:#17231d;">${escapeHtml(article.title)}</h1>${article.html}`,
    plainText: `${article.title}\n\n${article.plainText}`.trim(),
  });
}

export function formatArticles(input, options = {}) {
  const split = splitArticles(input);
  const articles = split.articles.map((article) => {
    const rendered = renderArticle(article, options);
    return Object.freeze({
      ...article,
      ...rendered,
      characterCount: rendered.plainText.length,
    });
  });

  return Object.freeze({
    method: split.method,
    warnings: split.warnings,
    isRecommendedCount:
      articles.length >= RECOMMENDED_MIN_ARTICLES && articles.length <= RECOMMENDED_MAX_ARTICLES,
    articles: Object.freeze(articles),
  });
}
