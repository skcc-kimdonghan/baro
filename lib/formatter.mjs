import { cleanGeneratedArtifacts, closesFence, fenceMarker } from "./input-cleaner.mjs";
import { createEngagementClosing, isFixedEngagementLine } from "./engagement-cta.mjs";
import { extractImagePromptSections } from "./image-prompts.mjs";
import { transformMarkdownLinks } from "./inline-links.mjs";

export const MAX_INPUT_LENGTH = 100_000;
export const MAX_LINE_COUNT = 6_000;
export const MAX_ARTICLES = 50;
export const DEFAULT_HEADER_COLOR = "#F7F7F7";

const RECOMMENDED_MIN_ARTICLES = 3;
const RECOMMENDED_MAX_ARTICLES = 5;
const DIVIDER_PATTERN = /^(?:-{3,}|={3,}|\*{3,})$/;
const VISUAL_DIVIDER_PATTERN = /^[─━═⎯—–]{5,}$/;
const STANDARD_DIVIDER_HTML = '<hr style="margin:30px 0;border:0;border-top:1px solid #e5e5e5;">';
const BLANK_LINE_HTML = '<p style="margin:0;font-size:16px;line-height:1.8;color:#666666;"><br></p>';
const RIDE_FOOTER_LABEL = "에버랜드 우리아이 놀이기구 찾기↓↓ 아래 링크 클릭";
const RIDE_FOOTER_URL = "https://onecalc.kr/calc/everland-ride-passport/";
const EVERLAND_KEYWORD_PATTERN = /에버랜드/;
const LABEL_CORE_PATTERN = String.raw`(?:(?:글|원고|포스팅|아티클)\s*\d+|\d+\s*편|\d+\s*번\s*(?:글|원고|포스팅|아티클))`;
const LABEL_PATTERN = new RegExp(
  String.raw`^\s{0,3}#{0,6}\s*(?:\[\s*${LABEL_CORE_PATTERN}\s*\]|${LABEL_CORE_PATTERN})(?:\s*(?::|[.)—–―-])\s*|\s+|(?:&#x20;|&#32;|&nbsp;)\s*|$)(.*)$`,
  "i",
);
const BRACKETED_LABEL_REFERENCE_PATTERN = new RegExp(
  String.raw`^\s{0,3}\[\s*${LABEL_CORE_PATTERN}\s*\]\s*:\s*(?:<[^>\s]+>|\S+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$`,
  "i",
);
const H1_PATTERN = /^#\s+(.+)$/;
const TOPIC_NUMBER_HEADING_PATTERN = /^\s{0,3}#{2,6}\s+(.+?\S)\s+(\d{1,3})\s*번(?:\s*(?:&#x20;|&#32;|&nbsp;))?\s*$/i;

function articleLabelMatch(line) {
  if (BRACKETED_LABEL_REFERENCE_PATTERN.test(line)) return null;
  return line.match(LABEL_PATTERN);
}

function isArticleLabelLine(line) {
  return Boolean(articleLabelMatch(line));
}

function topicNumberHeadingMatch(line) {
  const match = line.match(TOPIC_NUMBER_HEADING_PATTERN);
  if (!match) return null;
  return Object.freeze({
    topic: match[1].replace(/[*_~`]/g, "").replace(/\s+/g, " ").trim().toLocaleLowerCase("ko-KR"),
    number: Number(match[2]),
  });
}

function isDividerLine(line) {
  const value = line.trim();
  return DIVIDER_PATTERN.test(value) || VISUAL_DIVIDER_PATTERN.test(value);
}

function validationError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function normalizeLine(line, isCode) {
  let contentEnd = line.length;
  while (contentEnd > 0 && (line[contentEnd - 1] === " " || line[contentEnd - 1] === "\t")) {
    contentEnd -= 1;
  }
  const withoutTrailingWhitespace = line.slice(0, contentEnd);
  if (isCode) return withoutTrailingWhitespace;
  return decodeNumericEntities(withoutTrailingWhitespace)
    .replace(/^[ \t]+/g, "")
    .replace(/[\u00a0\u2007\u202f]/g, " ")
    .replace(/[ \t]{2,}/g, " ");
}

function decodeNumericEntities(value) {
  return value.replace(/&#(?:x([0-9a-f]{1,6})|([0-9]{1,7}));/gi, (entity, hex, decimal) => {
    const codePoint = Number.parseInt(hex ?? decimal, hex ? 16 : 10);
    if (
      !Number.isInteger(codePoint) ||
      codePoint <= 0 ||
      codePoint > 0x10ffff ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      return entity;
    }
    return String.fromCodePoint(codePoint);
  });
}

function findOutsideFence(lines, predicate) {
  let activeFence = null;
  for (let index = 0; index < lines.length; index += 1) {
    const marker = fenceMarker(lines[index]);
    if (activeFence) {
      if (closesFence(marker, activeFence)) activeFence = null;
      continue;
    }
    if (marker) {
      activeFence = marker;
      continue;
    }
    if (predicate(lines[index])) return { line: lines[index], index };
  }
  return null;
}

function restoreReservedTokens(value, tokens, pattern) {
  let restored = value;
  for (let depth = 0; depth <= tokens.length; depth += 1) {
    let replaced = false;
    const next = restored.replace(pattern, (_, index) => {
      replaced = true;
      return tokens[Number(index)] ?? "";
    });
    restored = next;
    if (!replaced) break;
  }
  return restored;
}

export function normalizeWhitespace(value) {
  const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
  let activeFence = null;
  let blankRun = 0;
  const normalized = [];

  for (const line of lines) {
    const marker = fenceMarker(line);
    const isOpeningFence = !activeFence && Boolean(marker);
    const isClosingFence = Boolean(activeFence) && closesFence(marker, activeFence);
    const wasInFence = Boolean(activeFence);
    const result = normalizeLine(line, wasInFence || isOpeningFence);
    if (isOpeningFence || isClosingFence) {
      normalized.push(result);
      activeFence = isOpeningFence ? marker : null;
      blankRun = 0;
      continue;
    }
    if (wasInFence) {
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
  let activeFence = null;
  let activeInlineDelimiterLength = 0;
  return lines.reduce((boundaries, line, index) => {
    const marker = fenceMarker(line);
    if (activeFence) {
      if (closesFence(marker, activeFence)) activeFence = null;
      return boundaries;
    }
    if (activeInlineDelimiterLength === 0 && marker) {
      activeFence = marker;
      return boundaries;
    }
    const startsInsideInlineCode = activeInlineDelimiterLength > 0;
    const inlineResult = stripInlineCodeSpans(line, activeInlineDelimiterLength);
    activeInlineDelimiterLength = inlineResult.activeDelimiterLength;
    if (!startsInsideInlineCode && predicate(line, index)) boundaries.push(index);
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

function nextNonDividerContentIndexes(lines) {
  const nextByIndex = new Array(lines.length).fill(-1);
  let nextIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    nextByIndex[index] = nextIndex;
    if (lines[index].trim() && !isDividerLine(lines[index])) nextIndex = index;
  }
  return nextByIndex;
}

function blankSurroundedDividerIndexes(lines) {
  const surroundedByIndex = new Array(lines.length).fill(false);
  let group = [];

  const flushGroup = () => {
    if (group.length > 0) {
      const firstIndex = group[0];
      const lastIndex = group[group.length - 1];
      const previousIsBlank = firstIndex === 0 || !lines[firstIndex - 1].trim();
      const nextIsBlank = lastIndex === lines.length - 1 || !lines[lastIndex + 1].trim();
      if (previousIsBlank && nextIsBlank) {
        group.forEach((index) => {
          surroundedByIndex[index] = true;
        });
      }
    }
    group = [];
  };

  lines.forEach((line, index) => {
    if (isDividerLine(line)) {
      group.push(index);
      return;
    }
    if (line.trim()) flushGroup();
  });
  flushGroup();

  return surroundedByIndex;
}

function expandDividerBoundaries(lines, dividerIndexes) {
  const dividerStarts = new Set(dividerIndexes);
  const expanded = new Set(dividerIndexes);
  let group = [];

  const flushGroup = () => {
    if (group.some((index) => dividerStarts.has(index))) {
      group.forEach((index) => expanded.add(index));
    }
    group = [];
  };

  lines.forEach((line, index) => {
    if (isDividerLine(line)) {
      group.push(index);
      return;
    }
    if (line.trim()) flushGroup();
  });
  flushGroup();

  return [...expanded].sort((left, right) => left - right);
}

function isArticleDivider(lines, nextByIndex, nextNonDividerByIndex, blankSurroundedByIndex, index) {
  if (!DIVIDER_PATTERN.test(lines[index].trim())) return false;
  const nextIndex = nextNonDividerByIndex[index];
  const nextContent = nextIndex >= 0 ? lines[nextIndex] : "";
  const followingIndex = nextIndex >= 0 ? nextByIndex[nextIndex] : -1;
  const followingContent = followingIndex >= 0 ? lines[followingIndex] : "";
  if (
    structuralText(nextContent) === "이 글에서 볼 내용" ||
    isReferenceQuestion(nextContent, followingContent) ||
    isFixedEngagementLine(nextContent)
  ) {
    return false;
  }
  const nextStartsArticle = H1_PATTERN.test(nextContent) || isArticleLabelLine(nextContent);
  return blankSurroundedByIndex[index] || nextStartsArticle;
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

function splitAtStarts(lines, starts, includeLeading = true) {
  const leading = normalizeWhitespace(lines.slice(0, starts[0]).join("\n"));
  return starts
    .map((start, index) => {
      const end = starts[index + 1] ?? lines.length;
      const sectionLines = lines.slice(start, end);
      if (includeLeading && index === 0 && leading) return `${leading}\n\n${sectionLines.join("\n")}`;
      return sectionLines.join("\n");
    })
    .map(normalizeWhitespace)
    .filter(Boolean);
}

function repeatedTopicNumberHeadingBoundaries(lines) {
  const candidates = collectBoundaries(lines, (line) => Boolean(topicNumberHeadingMatch(line)));
  const groups = new Map();

  for (const index of candidates) {
    const match = topicNumberHeadingMatch(lines[index]);
    if (!match) continue;
    const current = groups.get(match.topic);
    groups.set(match.topic, Object.freeze({
      count: (current?.count ?? 0) + 1,
      firstNumber: current?.firstNumber ?? match.number,
      hasDifferentNumber: Boolean(current?.hasDifferentNumber || (current && current.firstNumber !== match.number)),
    }));
  }

  const qualifyingTopics = new Set(
    [...groups.entries()]
      .filter(([, summary]) => summary.count > 1 && summary.hasDifferentNumber)
      .map(([topic]) => topic),
  );

  return candidates.filter((index) => {
    const match = topicNumberHeadingMatch(lines[index]);
    return Boolean(match && qualifyingTopics.has(match.topic));
  });
}

function replaceTopicNumberHeadingWithLabel(section) {
  const lines = section.split("\n");
  const headingIndex = lines.findIndex((line) => line.trim());
  if (headingIndex < 0) return section;
  const match = topicNumberHeadingMatch(lines[headingIndex]);
  if (!match) return section;
  return normalizeWhitespace([
    ...lines.slice(0, headingIndex),
    `${match.number}번 글`,
    ...lines.slice(headingIndex + 1),
  ].join("\n"));
}

function splitByStructuredStarts(section) {
  const lines = section.split("\n");
  const labels = collectBoundaries(lines, (line) => isArticleLabelLine(line));
  const headings = collectBoundaries(lines, (line) => H1_PATTERN.test(line));
  const hasH1BeforeFirstLabel =
    labels.length > 0 && headings.some((index) => index < labels[0]);
  const repeatedLabelsDefineArticles =
    labels.length > 1 &&
    !hasH1BeforeFirstLabel &&
    (labels[0] === 0 || hasGeneratedWrapperSignal(lines.slice(0, labels[0])));
  const labelsDefineArticles =
    repeatedLabelsDefineArticles ||
    (labels.length === 1 && isSingleArticleLabelStart(lines, labels[0]));
  if (labelsDefineArticles) {
    return Object.freeze({
      method: "label",
      sections: Object.freeze(splitAtStarts(lines, labels, false)),
    });
  }

  if (headings.length > 1) {
    return Object.freeze({
      method: "heading",
      sections: Object.freeze(splitAtStarts(lines, headings)),
    });
  }

  const topicNumberHeadings = repeatedTopicNumberHeadingBoundaries(lines);
  if (topicNumberHeadings.length > 1) {
    return Object.freeze({
      method: "label",
      sections: Object.freeze(
        splitAtStarts(lines, topicNumberHeadings, false)
          .map(replaceTopicNumberHeadingWithLabel),
      ),
    });
  }

  return Object.freeze({ method: "single", sections: Object.freeze([section]) });
}

function stripInlineMarkdown(value) {
  const withoutLinks = transformMarkdownLinks(value, ({ label }) => label);
  return withoutLinks
    .replace(/^#{1,6}\s+/, "")
    .replace(/^\s*(?:제목|title)\s*[:：]\s*/i, "")
    .replace(/[*_~`]/g, "")
    .trim();
}

function isQuestionLine(value) {
  return /[?？]["'”’」』]?$/.test(stripInlineMarkdown(value));
}

function isStandaloneInferredTitle(lines, titleIndex, followingIndex) {
  if (titleIndex < 0 || followingIndex < 0) return false;
  const titleCandidate = stripInlineMarkdown(lines[titleIndex] ?? "");
  const hasStandaloneBoundary = lines
    .slice(titleIndex + 1, followingIndex)
    .some((line) => !line.trim());
  return (
    hasStandaloneBoundary &&
    titleCandidate.length > 0 &&
    titleCandidate.length <= 100 &&
    !/[.!。！？?…]["'”’」』]?$/.test(titleCandidate) &&
    isQuestionLine(lines[followingIndex] ?? "")
  );
}

function stripInlineCodeSpans(value, activeDelimiterLength = 0) {
  let output = "";
  let index = 0;
  let delimiterLength = activeDelimiterLength;

  const isEscapedBacktick = (position) => {
    let slashIndex = position - 1;
    while (slashIndex >= 0 && value[slashIndex] === "\\") slashIndex -= 1;
    return (position - slashIndex - 1) % 2 === 1;
  };

  const findClosingRun = (start, expectedLength) => {
    let searchIndex = start;
    while (searchIndex < value.length) {
      const runStart = value.indexOf("`", searchIndex);
      if (runStart < 0) return null;
      let runEnd = runStart;
      while (value[runEnd] === "`") runEnd += 1;
      if (isEscapedBacktick(runStart)) {
        searchIndex = runEnd;
        continue;
      }
      if (runEnd - runStart === expectedLength) return { runStart, runEnd };
      searchIndex = runEnd;
    }
    return null;
  };

  if (delimiterLength > 0) {
    const closingRun = findClosingRun(0, delimiterLength);
    if (!closingRun) return { text: "", activeDelimiterLength: delimiterLength };
    output = " ";
    index = closingRun.runEnd;
    delimiterLength = 0;
  }

  while (index < value.length) {
    if (value[index] !== "`" || isEscapedBacktick(index)) {
      output += value[index];
      index += 1;
      continue;
    }

    let openingEnd = index;
    while (value[openingEnd] === "`") openingEnd += 1;
    delimiterLength = openingEnd - index;
    const closingRun = findClosingRun(openingEnd, delimiterLength);
    if (!closingRun) return { text: output, activeDelimiterLength: delimiterLength };
    output += " ";
    index = closingRun.runEnd;
    delimiterLength = 0;
  }
  return { text: output, activeDelimiterLength: 0 };
}

function hasGeneratedWrapperSignal(lines) {
  let activeFence = null;
  let activeInlineDelimiterLength = 0;
  for (const line of lines) {
    const marker = fenceMarker(line);
    if (activeFence) {
      if (closesFence(marker, activeFence)) activeFence = null;
      continue;
    }
    if (activeInlineDelimiterLength === 0 && marker) {
      activeFence = marker;
      continue;
    }
    const withoutLinks = transformMarkdownLinks(line, () => "");
    const inlineResult = stripInlineCodeSpans(withoutLinks, activeInlineDelimiterLength);
    activeInlineDelimiterLength = inlineResult.activeDelimiterLength;
    const text = inlineResult.text
      .replace(/[*_~]/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const hasBlogCopyDomain = /(?:폰|모바일|블로그|원고|포스팅|아티클|글별|(?:\d{1,2}|여러)\s*개(?:의\s*)?(?:글|원고|포스팅))/.test(text);
    const hasCopyAction = /(?:복사|복붙|붙여넣기)/.test(text);
    const hasGrouping = /(?:아래|다음|각각|글별|따로|블록)/.test(text);
    const hasPreparation = /(?:나눴|나누|분리했|분리하|정리했|구성했|준비했)/.test(text);
    const isFinalDraftNotice =
      /(?:아래|다음).{0,80}(?:요청하신|최종).{0,40}(?:원고|글)/.test(text);
    if (
      (hasBlogCopyDomain && hasCopyAction && hasGrouping && hasPreparation) ||
      isFinalDraftNotice
    ) {
      return true;
    }
  }
  return false;
}

function extractTitle(source, preferredTitle = "") {
  const preferred = stripInlineMarkdown(preferredTitle);
  if (preferred) return preferred.slice(0, 100);

  const lines = source.split("\n");
  const explicitTitle = findOutsideFence(lines, (line) => H1_PATTERN.test(line))?.line;
  if (explicitTitle) return stripInlineMarkdown(explicitTitle).slice(0, 100);

  const namedTitle = findOutsideFence(
    lines,
    (line) => /^\s*(?:제목|title)\s*[:：]/i.test(line),
  )?.line;
  if (namedTitle) return stripInlineMarkdown(namedTitle).slice(0, 100);

  const firstContent = findOutsideFence(
    lines,
    (line) =>
      line.trim() &&
      !isDividerLine(line) &&
      !isArticleLabelLine(line),
  )?.line;
  if (!firstContent) return "제목 없는 글";
  const candidate = stripInlineMarkdown(firstContent);
  return candidate.length > 60 ? `${candidate.slice(0, 57)}…` : candidate;
}

function removeLeadingTitle(source) {
  const lines = source.split("\n");
  const firstContentIndex = lines.findIndex((line) => line.trim() && !isDividerLine(line));
  if (firstContentIndex < 0) return "";

  const firstLine = lines[firstContentIndex];
  const labelMatch = articleLabelMatch(firstLine);
  if (labelMatch) {
    const remaining = lines.slice(firstContentIndex + 1);
    if (!stripInlineMarkdown(labelMatch[1] ?? "")) {
      const nextContentIndex = remaining.findIndex((line) => line.trim() && !isDividerLine(line));
      const nextContent = nextContentIndex >= 0 ? remaining[nextContentIndex] : "";
      const followingContentIndex = remaining.findIndex(
        (line, index) => index > nextContentIndex && line.trim() && !isDividerLine(line),
      );
      const nextIsExplicitTitle =
        H1_PATTERN.test(nextContent) || /^\s*(?:제목|title)\s*[:：]/i.test(nextContent);
      const nextIsInferredTitle = isStandaloneInferredTitle(
        remaining,
        nextContentIndex,
        followingContentIndex,
      );
      if (nextIsExplicitTitle || nextIsInferredTitle) {
        return normalizeWhitespace([
          ...remaining.slice(0, nextContentIndex),
          ...remaining.slice(nextContentIndex + 1),
        ].join("\n"));
      }
    }
    return normalizeWhitespace(remaining.join("\n"));
  }
  if (
    H1_PATTERN.test(firstLine) ||
    /^\s*(?:제목|title)\s*[:：]/i.test(firstLine)
  ) {
    return normalizeWhitespace(lines.slice(firstContentIndex + 1).join("\n"));
  }
  return normalizeWhitespace(source);
}

function isSingleArticleLabelStart(lines, labelIndex) {
  const hasEarlierH1 = collectBoundaries(lines, (line) => H1_PATTERN.test(line))
    .some((index) => index < labelIndex);
  if (hasEarlierH1) return false;
  if (labelIndex === 0) return true;
  if (!hasGeneratedWrapperSignal(lines.slice(0, labelIndex))) return false;

  const labelMatch = articleLabelMatch(lines[labelIndex] ?? "");
  if (!labelMatch) return false;
  if (stripInlineMarkdown(labelMatch[1] ?? "")) return true;

  const remaining = lines.slice(labelIndex + 1);
  const nextContentIndex = remaining.findIndex((line) => line.trim() && !isDividerLine(line));
  if (nextContentIndex < 0) return false;
  const nextContent = remaining[nextContentIndex];
  if (
    H1_PATTERN.test(nextContent) ||
    /^\s*(?:제목|title)\s*[:：]/i.test(nextContent) ||
    isQuestionLine(nextContent)
  ) {
    return true;
  }
  const followingContentIndex = remaining.findIndex(
    (line, index) => index > nextContentIndex && line.trim() && !isDividerLine(line),
  );
  return isStandaloneInferredTitle(remaining, nextContentIndex, followingContentIndex);
}

function removeTerminalRideFooter(value) {
  const lines = String(value ?? "").split("\n");
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  const hasFooter =
    lines.length >= 2 &&
    lines[lines.length - 2].trim() === RIDE_FOOTER_LABEL &&
    lines[lines.length - 1].trim() === RIDE_FOOTER_URL;
  return Object.freeze({
    bodySource: hasFooter ? lines.slice(0, -2).join("\n") : value,
    hasFooter,
  });
}

function textOutsideInlineCode(value) {
  const source = String(value ?? "");
  const visible = [];
  let activeRunLength = 0;
  let pendingStart = -1;
  let index = 0;

  while (index < source.length) {
    if (source[index] !== "`" || (index > 0 && source[index - 1] === "\\")) {
      if (activeRunLength === 0) visible.push(source[index]);
      index += 1;
      continue;
    }

    let runEnd = index + 1;
    while (source[runEnd] === "`") runEnd += 1;
    const runLength = runEnd - index;
    if (activeRunLength === 0) {
      activeRunLength = runLength;
      pendingStart = index;
    } else if (runLength === activeRunLength) {
      activeRunLength = 0;
      pendingStart = -1;
    }
    index = runEnd;
  }

  if (activeRunLength > 0 && pendingStart >= 0) visible.push(source.slice(pendingStart));
  return visible.join("");
}

function textOutsideFencedCode(value) {
  const visible = [];
  let activeFence = null;
  for (const line of String(value ?? "").split("\n")) {
    const marker = fenceMarker(line);
    if (activeFence) {
      if (closesFence(marker, activeFence)) activeFence = null;
      visible.push("");
      continue;
    }
    if (marker) {
      activeFence = marker;
      visible.push("");
      continue;
    }
    visible.push(line);
  }
  return visible.join("\n");
}

function isEverlandArticle(article) {
  if (EVERLAND_KEYWORD_PATTERN.test(article.title)) return true;
  const visibleBody = textOutsideInlineCode(textOutsideFencedCode(article.bodySource));
  return EVERLAND_KEYWORD_PATTERN.test(visibleBody);
}

function splitTerminalHashtags(lines) {
  let activeFence = null;
  const outsideFence = lines.map((line) => {
    const marker = fenceMarker(line);
    if (activeFence) {
      if (closesFence(marker, activeFence)) activeFence = null;
      return false;
    }
    if (marker) {
      activeFence = marker;
      return false;
    }
    return true;
  });
  let endIndex = lines.length;
  while (endIndex > 0 && !lines[endIndex - 1].trim()) endIndex -= 1;
  let startIndex = endIndex;
  while (
    startIndex > 0 &&
    outsideFence[startIndex - 1] &&
    /^(?:#[^#\s]+)(?:\s+#[^#\s]+)*$/.test(lines[startIndex - 1].trim())
  ) {
    startIndex -= 1;
  }
  if (startIndex === endIndex) {
    return Object.freeze({ bodyLines: lines, hashtagLines: Object.freeze([]) });
  }
  let bodyEndIndex = startIndex;
  while (bodyEndIndex > 0 && !lines[bodyEndIndex - 1].trim()) bodyEndIndex -= 1;
  return Object.freeze({
    bodyLines: lines.slice(0, bodyEndIndex),
    hashtagLines: Object.freeze(lines.slice(startIndex, endIndex)),
  });
}

function stripTerminalClosingDividers(lines) {
  let endIndex = lines.length;
  while (endIndex > 0 && !lines[endIndex - 1].trim()) endIndex -= 1;
  let removedDivider = false;
  while (endIndex > 0 && isDividerLine(lines[endIndex - 1])) {
    removedDivider = true;
    endIndex -= 1;
    while (endIndex > 0 && !lines[endIndex - 1].trim()) endIndex -= 1;
  }
  return removedDivider ? lines.slice(0, endIndex) : lines;
}

function stripExistingEngagementLines(lines) {
  let activeFence = null;
  let activeInlineRunLength = 0;
  return lines.filter((line) => {
    const marker = fenceMarker(line);
    if (activeFence) {
      if (closesFence(marker, activeFence)) activeFence = null;
      return true;
    }
    if (marker) {
      activeFence = marker;
      return true;
    }
    const startsInsideInlineCode = activeInlineRunLength > 0;
    for (let index = 0; index < line.length;) {
      if (line[index] !== "`" || (index > 0 && line[index - 1] === "\\")) {
        index += 1;
        continue;
      }
      let runEnd = index + 1;
      while (line[runEnd] === "`") runEnd += 1;
      const runLength = runEnd - index;
      if (activeInlineRunLength === 0) activeInlineRunLength = runLength;
      else if (runLength === activeInlineRunLength) activeInlineRunLength = 0;
      index = runEnd;
    }
    if (startsInsideInlineCode) return true;
    return !isFixedEngagementLine(line);
  });
}

function toArticle(source, index) {
  const lines = source.split("\n");
  const firstContentLine = findOutsideFence(
    lines,
    (line) => line.trim() && !isDividerLine(line),
  )?.line ?? "";
  const labelMatch = articleLabelMatch(firstContentLine);
  const title = extractTitle(source, labelMatch?.[1] ?? "");
  const extracted = extractImagePromptSections(removeLeadingTitle(source));
  const footer = removeTerminalRideFooter(normalizeWhitespace(extracted.bodySource));
  return Object.freeze({
    id: `article-${index + 1}`,
    title,
    source,
    bodySource: normalizeWhitespace(footer.bodySource),
    imagePrompt: normalizeWhitespace(extracted.imagePrompt),
    hadRideFooter: footer.hasFooter,
  });
}

export function splitArticles(input) {
  const rawInput = String(input ?? "");
  if (rawInput.length > MAX_INPUT_LENGTH) {
    throw validationError(
      `입력은 ${MAX_INPUT_LENGTH.toLocaleString("ko-KR")}자까지 정리할 수 있습니다.`,
      "INPUT_TOO_LONG",
    );
  }
  const rawLineCount = rawInput.replace(/\r\n?/g, "\n").split("\n").length;
  if (rawLineCount > MAX_LINE_COUNT) {
    throw validationError(
      `입력은 ${MAX_LINE_COUNT.toLocaleString("ko-KR")}줄까지 정리할 수 있습니다.`,
      "TOO_MANY_LINES",
    );
  }

  const cleanedInput = cleanGeneratedArtifacts(
    rawInput,
    (line) => H1_PATTERN.test(line) || isArticleLabelLine(line),
  );
  const normalized = normalizeWhitespace(cleanedInput);
  if (!normalized) throw validationError("정리할 글을 먼저 붙여넣어 주세요.", "EMPTY_INPUT");

  const lines = normalized.split("\n");
  const nextByIndex = nextContentIndexes(lines);
  const nextNonDividerByIndex = nextNonDividerContentIndexes(lines);
  const blankSurroundedByIndex = blankSurroundedDividerIndexes(lines);
  const dividerStarts = collectBoundaries(lines, (_line, index) =>
    isArticleDivider(
      lines,
      nextByIndex,
      nextNonDividerByIndex,
      blankSurroundedByIndex,
      index,
    ));
  const dividers = expandDividerBoundaries(lines, dividerStarts);
  const dividedSections = splitAtDivider(lines, dividers);

  let method = "single";
  let sections = [normalized];

  if (dividers.length > 0 && dividedSections.length > 1) {
    method = "divider";
    sections = dividedSections.flatMap(
      (section) => splitByStructuredStarts(section).sections,
    );
  } else {
    const structured = splitByStructuredStarts(normalized);
    method = structured.method;
    sections = [...structured.sections];
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

  let rendered = escapeHtml(value).replaceAll("\u0000", "&#0;");
  rendered = rendered.replace(/`([^`]+)`/g, (_, code) => reserve(`<code style="padding:2px 5px;border-radius:5px;background:#f1f3f5;font-family:monospace;">${code}</code>`));
  rendered = transformMarkdownLinks(rendered, ({ image, label, url }) => {
    if (image) return reserve(`[이미지: ${label}]`);
    const decodedUrl = url.replaceAll("&amp;", "&");
    const link = !/^https?:\/\/[^\s]+$/i.test(decodedUrl)
      ? reserve(label)
      : reserve(`<a href="${escapeHtml(decodedUrl)}" style="color:#087f5b;text-decoration:underline;">${label}</a>`);
    return link;
  });
  rendered = rendered
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<s>$1</s>")
    .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1<em>$2</em>");

  return restoreReservedTokens(rendered, tokens, /\u0000(\d+)\u0000/g);
}

function plainInline(value) {
  const withoutLinks = transformMarkdownLinks(value, ({ image, label, url }) => {
    if (image) return `[이미지: ${label}]`;
    return /^https?:\/\/[^\s]+$/i.test(url) ? `${label} (${url})` : label;
  });
  return withoutLinks
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1$2");
}

function visibleInlineText(value) {
  const withoutLinks = transformMarkdownLinks(value, ({ label }) => label);
  return withoutLinks
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/(^|[^*])\*([^*]+)\*(?!\*)/g, "$1$2")
    .trim();
}

function parsePipeRow(line) {
  const structuralPipes = line.trim().replace(/^\\\|/, "|").replace(/\\\|$/, "|");
  const trimmed = structuralPipes.replace(/^\|/, "").replace(/\|$/, "");
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
  return cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

const MAX_INFERRED_TABLE_COLUMNS = 20;
const INFERRED_TABLE_BLOCK_PREFIX = /^(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/;
const SENTENCE_END_PATTERN = /[.!?。！？]["'”’」』]?$/;

function inferredTableCells(line) {
  const trimmed = line.trim();
  if (
    !trimmed ||
    !line.includes("|") ||
    trimmed.includes("`") ||
    INFERRED_TABLE_BLOCK_PREFIX.test(trimmed) ||
    isTableDivider(line)
  ) {
    return null;
  }
  const cells = parsePipeRow(line);
  if (cells.length < 2 || cells.length > MAX_INFERRED_TABLE_COLUMNS) return null;
  return cells;
}

function isRawInferredTableRow(line) {
  const trimmed = line.trim();
  return Boolean(
    trimmed &&
    line.includes("|") &&
    !INFERRED_TABLE_BLOCK_PREFIX.test(trimmed)
  );
}

function collectInferredTables(lines) {
  const tables = new Map();
  let index = 0;

  while (index < lines.length) {
    const openingFence = fenceMarker(lines[index]);
    if (openingFence) {
      index += 1;
      while (
        index < lines.length &&
        !closesFence(fenceMarker(lines[index]), openingFence)
      ) {
        index += 1;
      }
      if (index < lines.length) index += 1;
      continue;
    }

    if (!isRawInferredTableRow(lines[index])) {
      index += 1;
      continue;
    }

    const startIndex = index;
    const tableLines = [];
    let bridgedDataStart = -1;
    while (index < lines.length && isRawInferredTableRow(lines[index])) {
      tableLines.push(lines[index]);
      index += 1;
    }

    if (
      tableLines.length === 1 &&
      index + 1 < lines.length &&
      !lines[index].trim() &&
      isRawInferredTableRow(lines[index + 1])
    ) {
      index += 1;
      bridgedDataStart = index;
      while (index < lines.length && isRawInferredTableRow(lines[index])) {
        tableLines.push(lines[index]);
        index += 1;
      }
    }
    if (tableLines.length < 3) continue;

    const parsedRows = tableLines.map(inferredTableCells);
    const headerCells = parsedRows[0];
    if (
      !headerCells ||
      headerCells.some((cell) => !cell) ||
      SENTENCE_END_PATTERN.test(visibleInlineText(headerCells.at(-1) ?? "")) ||
      parsedRows.some((cells) => !cells || cells.length !== headerCells.length)
    ) {
      if (bridgedDataStart >= 0) index = bridgedDataStart;
      continue;
    }
    tables.set(startIndex, Object.freeze({
      lines: Object.freeze([...tableLines]),
      endIndex: index,
    }));
  }

  return tables;
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

function calculationExpression(value) {
  const text = plainInline(value).replace(/\\=/g, "=").trim();
  const equalsIndex = text.indexOf("=");
  if (equalsIndex <= 0) return false;
  const left = text.slice(0, equalsIndex);
  const right = text.slice(equalsIndex + 1);
  return /\d/.test(left) && /[+\-−×÷*/%]/.test(left) && /\d/.test(right);
}

function expressionPrefix(value) {
  const text = plainInline(value).trim();
  return /^[\d(]/.test(text) && /\d/.test(text) && /[+\-−×÷*/%]/.test(text) && !text.includes("=");
}

function boldEquationResult(value) {
  const normalized = value.replace(/\\=/g, "=").trim();
  const match = normalized.match(/^(.*?=\s*)(?:\*\*([^*]+)\*\*|__([^_]+)__)(.*)$/);
  if (!match) return null;
  const result = (match[2] ?? match[3] ?? "").trim();
  if (!result) return null;
  const suffix = match[4].trim();
  const formula = `${match[1]}**${result}**${suffix}`;
  const explanatorySuffix = /^[을를이가은는에도로](?!니다)/.test(suffix) ? suffix : "";
  return Object.freeze({
    formula: explanatorySuffix ? `${match[1]}**${result}**` : formula,
    explanation: explanatorySuffix ? `따라서 ${result}${explanatorySuffix}` : "",
  });
}

function collectCalculationLayout(lines, nextByIndex) {
  const formulaBlocks = new Map();
  const consumedFormulaLines = new Set();
  const stepStarts = new Set();
  const analysisLines = Array.from({ length: lines.length }, () => "");
  let activeFence = null;
  let activeInlineDelimiterLength = 0;

  for (let index = 0; index < lines.length; index += 1) {
    const marker = activeInlineDelimiterLength === 0 ? fenceMarker(lines[index]) : null;
    if (activeFence) {
      if (closesFence(marker, activeFence)) activeFence = null;
      continue;
    }
    if (marker) {
      activeFence = marker;
      continue;
    }
    const inlineResult = stripInlineCodeSpans(lines[index], activeInlineDelimiterLength);
    activeInlineDelimiterLength = inlineResult.activeDelimiterLength;
    analysisLines[index] = inlineResult.text;
  }

  for (let index = 0; index < lines.length; index += 1) {
    const analysisLine = analysisLines[index];
    if (
      isDividerLine(analysisLine) ||
      analysisLine.includes("|") ||
      /^#{1,6}\s+/.test(analysisLine) ||
      /^>\s?/.test(analysisLine) ||
      /^[-*+]\s+/.test(analysisLine) ||
      /^\d+[.)]\s+/.test(analysisLine)
    ) {
      continue;
    }

    if (calculationExpression(analysisLine)) {
      const result = boldEquationResult(lines[index]);
      formulaBlocks.set(index, Object.freeze({
        endIndex: index,
        formula: result?.formula ?? lines[index].replace(/\\=/g, "="),
        explanation: result?.explanation ?? "",
        withinStep: false,
      }));
      continue;
    }

    const resultIndex = nextByIndex[index];
    const resultAnalysisLine = analysisLines[resultIndex] ?? "";
    if (!expressionPrefix(analysisLine) || resultIndex < 0 || consumedFormulaLines.has(resultIndex)) continue;
    const analyzedResult = boldEquationResult(resultAnalysisLine);
    const result = boldEquationResult(lines[resultIndex]);
    if (!analyzedResult || !result || !/^\s*\\?=/.test(resultAnalysisLine)) continue;
    const combinedFormula = `${lines[index].trim()} ${result.formula}`;
    if (!calculationExpression(combinedFormula)) continue;
    formulaBlocks.set(index, Object.freeze({
      endIndex: resultIndex,
      formula: combinedFormula,
      explanation: result.explanation,
      withinStep: false,
    }));
    consumedFormulaLines.add(resultIndex);
  }

  for (let index = 0; index < lines.length; index += 1) {
    const stepMatch = analysisLines[index].match(/^(\d+)\)\s+(.+)$/);
    if (!stepMatch || !/(?:먼저|여기에|이어서|적용|반영|계산(?!기)|빼|더|곱|나눕)/.test(stepMatch[2])) {
      continue;
    }
    if (calculationExpression(stepMatch[2])) {
      stepStarts.add(index);
      continue;
    }
    for (let cursor = index + 1; cursor < lines.length && cursor <= index + 16; cursor += 1) {
      const candidate = analysisLines[cursor];
      if (!candidate.trim()) continue;
      if (/^\d+[.)]\s+/.test(candidate) || /^#{2,6}\s+/.test(candidate) || /^>\s?/.test(candidate) || isDividerLine(candidate) || fenceMarker(candidate)) {
        break;
      }
      const block = formulaBlocks.get(cursor);
      if (!block) continue;
      stepStarts.add(index);
      formulaBlocks.set(cursor, Object.freeze({ ...block, withinStep: true }));
      break;
    }
  }

  return Object.freeze({ formulaBlocks, stepStarts });
}

function isBlockStart(lines, index, inferredTables, calculationLayout) {
  const line = lines[index] ?? "";
  const next = lines[index + 1] ?? "";
  const blockText = structuralText(line);
  return (
    !line.trim() ||
    Boolean(fenceMarker(line)) ||
    isDividerLine(line) ||
    /^#{2,6}\s+/.test(line) ||
    /^>\s?/.test(line) ||
    /^[-*+]\s+/.test(line) ||
    /^\d+[.)]\s+/.test(line) ||
    blockText === "이 글에서 볼 내용" ||
    /^A\s*[:：]\s*\S/.test(blockText) ||
    /^(?:\d+[.)]\s+|그래서[,，]?\s*).+[?？]$/.test(blockText) ||
    (line.includes("|") && isTableDivider(next)) ||
    inferredTables.has(index)
    || calculationLayout.stepStarts.has(index)
    || calculationLayout.formulaBlocks.has(index)
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
  return `${STANDARD_DIVIDER_HTML}<p style="margin:0 0 12px;font-size:15px;line-height:1.8;font-weight:700;color:#666666;word-break:keep-all;overflow-wrap:anywhere;"><strong>${renderInlineMarkdown(text)}</strong></p>`;
}

function renderReferenceAnswer(value) {
  const text = structuralText(value);
  return `<p style="margin:0;font-size:15px;line-height:1.8;font-weight:700;color:#666666;word-break:keep-all;overflow-wrap:anywhere;"><strong>${renderInlineMarkdown(text)}</strong></p>`;
}

function answerNeedsVisibleBlankLine(lines, answerIndex, nextByIndex) {
  const nextIndex = nextByIndex[answerIndex];
  if (nextIndex < 0) return false;
  const nextLine = lines[nextIndex];
  const followingIndex = nextByIndex[nextIndex];
  const followingLine = followingIndex >= 0 ? lines[followingIndex] : "";
  return !(
    isDividerLine(nextLine) ||
    /^#{2,6}\s+/.test(nextLine) ||
    structuralText(nextLine) === "이 글에서 볼 내용" ||
    isReferenceQuestion(nextLine, followingLine, true) ||
    isReferenceAnswer(nextLine)
  );
}

function safeHeaderColor(value) {
  return /^#[0-9a-f]{6}$/i.test(value ?? "") ? value.toUpperCase() : DEFAULT_HEADER_COLOR;
}

export function renderArticle(article, options = {}) {
  const headerColor = safeHeaderColor(options.headerColor);
  const normalizedBody = normalizeWhitespace(article.bodySource);
  const withoutExistingClosing = stripExistingEngagementLines(normalizedBody.split("\n"));
  const terminal = splitTerminalHashtags(stripTerminalClosingDividers(withoutExistingClosing));
  const normalizedFooter = removeTerminalRideFooter(
    normalizeWhitespace(terminal.bodyLines.join("\n")),
  );
  const lines = normalizedFooter.bodySource ? normalizedFooter.bodySource.split("\n") : [];
  const shouldAddRideFooter = isEverlandArticle({
    ...article,
    bodySource: normalizedFooter.bodySource,
  });
  const inferredTables = collectInferredTables(lines);
  const nextByIndex = nextContentIndexes(lines);
  const nextNonDividerByIndex = nextNonDividerContentIndexes(lines);
  const calculationLayout = collectCalculationLayout(lines, nextByIndex);
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

    const openingFence = fenceMarker(line);
    if (openingFence) {
      const language = openingFence.suffix.trim();
      const codeLines = [];
      index += 1;
      while (
        index < lines.length &&
        !closesFence(fenceMarker(lines[index]), openingFence)
      ) {
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

    if (isDividerLine(line)) {
      const nextIndex = nextNonDividerByIndex[index];
      const nextContent = nextIndex >= 0 ? lines[nextIndex] : "";
      const followingIndex = nextIndex >= 0 ? nextByIndex[nextIndex] : -1;
      const followingContent = followingIndex >= 0 ? lines[followingIndex] : "";
      if (!isReferenceQuestion(nextContent, followingContent)) {
        htmlBlocks.push(STANDARD_DIVIDER_HTML);
      }
      expectOutlineList = false;
      index = nextIndex >= 0 ? nextIndex : lines.length;
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

    const inferredTable = inferredTables.get(index);
    if (inferredTable) {
      const inferredLines = inferredTable.lines;
      const syntheticDivider = parsePipeRow(inferredLines[0]).map(() => "---").join(" | ");
      const table = renderTable(
        [inferredLines[0], syntheticDivider, ...inferredLines.slice(1)],
        headerColor,
      );
      htmlBlocks.push(table.html);
      plainBlocks.push(table.plainText);
      tableCount += 1;
      expectOutlineList = false;
      index = inferredTable.endIndex;
      continue;
    }

    const headingMatch = line.match(/^(#{2,6})\s+(.+)$/);
    const blockText = structuralText(headingMatch?.[2] ?? line);

    if (calculationLayout.stepStarts.has(index)) {
      htmlBlocks.push(`<p style="margin:0 0 18px;font-size:15px;line-height:1.8;color:#666666;word-break:keep-all;overflow-wrap:anywhere;">${renderInlineMarkdown(line)}</p>`);
      plainBlocks.push(plainInline(line));
      expectOutlineList = false;
      index += 1;
      continue;
    }

    const calculationBlock = calculationLayout.formulaBlocks.get(index);
    if (calculationBlock) {
      const nextIndex = nextByIndex[calculationBlock.endIndex];
      const needsBlankLine = Boolean(calculationBlock.explanation) || (calculationBlock.withinStep && nextIndex >= 0);
      htmlBlocks.push(`<p style="margin:${needsBlankLine ? "0" : "0 0 18px"};font-size:15px;line-height:1.8;color:#666666;word-break:keep-all;overflow-wrap:anywhere;">${renderInlineMarkdown(calculationBlock.formula)}</p>`);
      if (needsBlankLine) htmlBlocks.push(BLANK_LINE_HTML);
      if (calculationBlock.explanation) {
        htmlBlocks.push(`<p style="margin:0 0 18px;font-size:15px;line-height:1.8;color:#666666;word-break:keep-all;overflow-wrap:anywhere;">${renderInlineMarkdown(calculationBlock.explanation)}</p>`);
      }
      plainBlocks.push(
        calculationBlock.explanation
          ? `${plainInline(calculationBlock.formula)}\n\n${plainInline(calculationBlock.explanation)}`
          : plainInline(calculationBlock.formula),
      );
      expectOutlineList = false;
      index = calculationBlock.endIndex + 1;
      continue;
    }

    if (blockText === "이 글에서 볼 내용") {
      if (htmlBlocks.length > 0) htmlBlocks.push(BLANK_LINE_HTML);
      htmlBlocks.push(`<p style="margin:0 0 10px;font-size:16px;line-height:1.8;font-weight:700;color:#666666;"><strong>이 글에서 볼 내용</strong></p>`);
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
      if (answerNeedsVisibleBlankLine(lines, index, nextByIndex)) {
        htmlBlocks.push(BLANK_LINE_HTML);
      }
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
    while (index < lines.length && !isBlockStart(lines, index, inferredTables, calculationLayout)) {
      paragraphLines.push(lines[index]);
      index += 1;
    }
    if (paragraphLines.length === 0) {
      paragraphLines.push(line);
      index += 1;
    }
    const openingQuestion = plainBlocks.length === 0 && /[?？]["'”’」』]?$/.test(
      plainInline(paragraphLines[0]).trim(),
    );
    const renderedParagraph = paragraphLines
      .map((paragraphLine, lineIndex) => {
        const renderedLine = renderInlineMarkdown(paragraphLine);
        if (!openingQuestion || lineIndex > 0) return renderedLine;
        return `<em style="font-style:italic;font-size:16px;">${renderedLine}</em>`;
      })
      .join("<br>");
    htmlBlocks.push(`<p style="margin:0 0 18px;font-size:15px;line-height:1.8;color:#666666;word-break:keep-all;overflow-wrap:anywhere;">${renderedParagraph}</p>`);
    plainBlocks.push(paragraphLines.map(plainInline).join("\n"));
    expectOutlineList = false;
  }

  const engagement = createEngagementClosing();

  if (shouldAddRideFooter) {
    htmlBlocks.push(`<p style="margin:30px 0 8px;font-size:16px;line-height:1.7;font-weight:700;color:#111111;">${RIDE_FOOTER_LABEL}</p><p style="margin:0;font-size:16px;line-height:1.7;"><a href="${RIDE_FOOTER_URL}" style="color:#568ac5;text-decoration:underline;">${RIDE_FOOTER_URL}</a></p>`);
    plainBlocks.push(`${RIDE_FOOTER_LABEL}\n${RIDE_FOOTER_URL}`);
  }

  if (terminal.hashtagLines.length > 0) {
    const hashtags = terminal.hashtagLines.map((line) => line.trim()).join("\n");
    htmlBlocks.push(`<p style="margin:12px 0 18px;font-size:15px;line-height:1.8;color:#568ac5;word-break:keep-all;overflow-wrap:anywhere;">${hashtags.split("\n").map(renderInlineMarkdown).join("<br>")}</p>`);
    plainBlocks.push(hashtags);
  }

  if (engagement.paragraphs.length > 0) {
    htmlBlocks.push(STANDARD_DIVIDER_HTML);
    plainBlocks.push("---");
    for (const [index, paragraph] of engagement.paragraphs.entries()) {
      const isQuestion = engagement.addedParts[index] === "question";
      const margin = index === 0
        ? `0 0 ${engagement.paragraphs.length === 1 ? "18px" : "10px"}`
        : `0 0 ${index === engagement.paragraphs.length - 1 ? "18px" : "10px"}`;
      htmlBlocks.push(`<p style="margin:${margin};font-size:15px;line-height:1.8;${isQuestion ? "font-weight:700;" : ""}color:#666666;word-break:keep-all;overflow-wrap:anywhere;">${isQuestion ? `<strong>${escapeHtml(paragraph)}</strong>` : escapeHtml(paragraph)}</p>`);
      plainBlocks.push(paragraph);
    }
  }

  return Object.freeze({
    html: htmlBlocks.join(""),
    plainText: plainBlocks.join("\n\n").trim(),
    tableCount,
    engagementCtaAdded: engagement.paragraphs.length > 0,
    engagementCtaParts: engagement.addedParts,
    engagementCtaTopic: engagement.topic,
  });
}

export function createCopyPayload(article, includeTitle = false) {
  const bodyHtml = article.html.replace(/^<hr\b[^>]*>/i, "");
  if (!includeTitle) return Object.freeze({ html: bodyHtml, plainText: article.plainText });
  return Object.freeze({
    html: `<h1 style="margin:0 0 24px;font-size:28px;line-height:1.4;font-weight:800;color:#17231d;">${escapeHtml(article.title)}</h1>${bodyHtml}`,
    plainText: `${article.title}\n\n${article.plainText}`.trim(),
  });
}

export function createImagePromptPayload(article) {
  const label = "아래 이미지를 생성해주세요";
  const prompt = String(article?.imagePrompt ?? "").trim();
  if (!prompt) return Object.freeze({ html: "", plainText: "" });
  return Object.freeze({
    html: `<p style="margin:0 0 12px;font-size:16px;line-height:1.6;font-weight:700;"><strong>${label}</strong></p><p style="margin:0;font-size:15px;line-height:1.7;white-space:pre-wrap;">${escapeHtml(prompt).replaceAll("\n", "<br>")}</p>`,
    plainText: `${label}\n\n${prompt}`,
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
