import { closesFence, fenceMarker } from "./input-cleaner.mjs";
import { isFixedEngagementLine } from "./engagement-cta.mjs";

const PROMPT_HEADING_PATTERN = /^#{1,6}\s+(?:이미지|썸네일)\s+생성\s+프롬프트\s*$/;
const INLINE_PROMPT_PATTERN = /^(?:이미지|썸네일)\s+생성\s+프롬프트\s*[:：]\s*(\S.*)$/;
const SECTION_HEADING_PATTERN = /^#{1,6}\s+\S.*$/;
const NUMBERED_PROMPT_PATTERN = /^이미지\s+(\d{1,2})\s*[—–―-]\s*(?:제목(?:\s*바로)?\s*(?:아래|위|앞|뒤)|\d+\s*(?:[~∼～〜—–-]\s*\d+)?\s*번\s+설명\s*(?:아래|위|앞|뒤)|마지막\s+설명\s*(?:아래|위|앞|뒤)|마무리\s+문단\s*(?:아래|위|앞|뒤))\s*$/;
const PROMPT_BOUNDARY_PATTERN = /^(?:#{1,6}\s+\S.*|[-=*]{3,}|[─━═⎯—–]{5,}|#[^#\s]+(?:[,\s]+#[^#\s]+)*)$/;
const EDITORIAL_HEADING_PATTERN = /^#{1,6}\s*(?:개선안|수정안|최종안)\s*$/;

function trimBlankLines(lines) {
  let start = 0;
  let end = lines.length;
  while (start < end && !lines[start].trim()) start += 1;
  while (end > start && !lines[end - 1].trim()) end -= 1;
  return lines.slice(start, end);
}

function collectHeadingPrompt(lines, start) {
  const promptLines = [];
  let activeFence = null;
  let index = start + 1;

  while (index < lines.length) {
    const line = lines[index];
    const marker = fenceMarker(line);
    if (activeFence) {
      promptLines.push(line);
      if (closesFence(marker, activeFence)) activeFence = null;
      index += 1;
      continue;
    }
    if (marker) {
      activeFence = marker;
      promptLines.push(line);
      index += 1;
      continue;
    }
    if (SECTION_HEADING_PATTERN.test(line)) break;
    promptLines.push(line);
    index += 1;
  }

  const trimmed = trimBlankLines(promptLines);
  return Object.freeze({ end: index, lines: trimmed, prompt: trimmed.join("\n") });
}

function collectNumberedPrompt(lines, start) {
  const promptLines = [];
  let index = start + 1;

  while (index < lines.length) {
    const line = lines[index];
    if (
      NUMBERED_PROMPT_PATTERN.test(line) ||
      PROMPT_BOUNDARY_PATTERN.test(line.trim()) ||
      isFixedEngagementLine(line)
    ) break;
    promptLines.push(line);
    index += 1;
  }

  const trimmed = trimBlankLines(promptLines);
  return Object.freeze({
    end: index,
    prompt: [lines[start].trim(), ...trimmed].join("\n"),
  });
}

function updateInlineCodeRunLength(line, initialRunLength) {
  let activeRunLength = initialRunLength;
  for (let index = 0; index < line.length;) {
    if (line[index] !== "`" || (index > 0 && line[index - 1] === "\\")) {
      index += 1;
      continue;
    }
    let runEnd = index + 1;
    while (line[runEnd] === "`") runEnd += 1;
    const runLength = runEnd - index;
    if (activeRunLength === 0) activeRunLength = runLength;
    else if (runLength === activeRunLength) activeRunLength = 0;
    index = runEnd;
  }
  return activeRunLength;
}

function outsideMarkdownLiteralLines(lines) {
  let activeFence = null;
  let activeInlineRunLength = 0;
  return lines.map((line) => {
    if (activeFence) {
      const marker = fenceMarker(line);
      if (closesFence(marker, activeFence)) activeFence = null;
      return false;
    }
    if (activeInlineRunLength > 0) {
      activeInlineRunLength = updateInlineCodeRunLength(line, activeInlineRunLength);
      return false;
    }
    const marker = fenceMarker(line);
    if (marker) {
      activeFence = marker;
      return false;
    }
    activeInlineRunLength = updateInlineCodeRunLength(line, activeInlineRunLength);
    return true;
  });
}

function eligibleNumberedPromptStarts(lines) {
  const candidates = [];
  const outsideLiteral = outsideMarkdownLiteralLines(lines);

  for (let index = 0; index < lines.length; index += 1) {
    if (!outsideLiteral[index]) continue;
    const match = lines[index].match(NUMBERED_PROMPT_PATTERN);
    if (match) candidates.push({ index, number: Number(match[1]) });
  }

  if (candidates.length < 2 || candidates[0].number !== 1) return new Set();
  let precedingIndex = candidates[0].index - 1;
  while (precedingIndex >= 0 && !lines[precedingIndex].trim()) precedingIndex -= 1;
  const precedingLine = precedingIndex >= 0 ? lines[precedingIndex].trim() : "";
  const startsAfterTailMarker =
    isFixedEngagementLine(precedingLine) ||
    isDividerLike(precedingLine) ||
    PROMPT_HEADING_PATTERN.test(precedingLine) ||
    /^(?:#[^#\s]+)(?:[,\s]+#[^#\s]+)*$/.test(precedingLine);
  if (candidates.length < 3 && !startsAfterTailMarker) return new Set();
  for (let index = 1; index < candidates.length; index += 1) {
    const previous = candidates[index - 1].number;
    const current = candidates[index].number;
    if (current !== 1 && current !== previous + 1) return new Set();
  }

  for (let index = candidates[0].index; index < lines.length; index += 1) {
    if (!outsideLiteral[index]) return new Set();
    if (
      SECTION_HEADING_PATTERN.test(lines[index]) &&
      !EDITORIAL_HEADING_PATTERN.test(lines[index])
    ) return new Set();
  }

  let paragraphStarted = false;
  let paragraphEnded = false;
  let metadataStarted = false;
  for (let index = candidates.at(-1).index + 1; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    const isMetadata =
      isFixedEngagementLine(trimmed) ||
      isDividerLike(trimmed) ||
      EDITORIAL_HEADING_PATTERN.test(trimmed) ||
      /^(?:#[^#\s]+)(?:[,\s]+#[^#\s]+)*$/.test(trimmed);
    if (isMetadata) {
      metadataStarted = true;
      continue;
    }
    if (!trimmed) {
      if (paragraphStarted && !metadataStarted) paragraphEnded = true;
      continue;
    }
    if (metadataStarted || paragraphEnded) return new Set();
    paragraphStarted = true;
  }

  return new Set(candidates.map(({ index }) => index));
}

function isDividerLike(value) {
  return /^(?:[-=*]{3,}|[─━═⎯—–]{5,})$/.test(String(value ?? "").trim());
}

export function extractImagePromptSections(value) {
  const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
  const bodyLines = [];
  const prompts = [];
  const seenPrompts = new Set();
  const numberedPromptStarts = eligibleNumberedPromptStarts(lines);
  const outsideLiteral = outsideMarkdownLiteralLines(lines);

  const addPrompt = (prompt) => {
    const normalized = String(prompt ?? "").trim();
    if (!normalized || seenPrompts.has(normalized)) return;
    seenPrompts.add(normalized);
    prompts.push(normalized);
  };

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (!outsideLiteral[index]) {
      bodyLines.push(line);
      index += 1;
      continue;
    }

    if (PROMPT_HEADING_PATTERN.test(line)) {
      const section = collectHeadingPrompt(lines, index);
      if (!section.prompt) bodyLines.push(line, ...section.lines);
      else addPrompt(section.prompt);
      index = section.end;
      continue;
    }

    const inlineMatch = line.match(INLINE_PROMPT_PATTERN);
    if (inlineMatch) {
      addPrompt(inlineMatch[1]);
      index += 1;
      continue;
    }

    if (numberedPromptStarts.has(index)) {
      const section = collectNumberedPrompt(lines, index);
      addPrompt(section.prompt);
      index = section.end;
      continue;
    }

    bodyLines.push(line);
    index += 1;
  }

  return Object.freeze({
    bodySource: bodyLines.join("\n"),
    imagePrompt: prompts.join("\n\n"),
  });
}
