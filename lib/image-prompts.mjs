import { closesFence, fenceMarker } from "./input-cleaner.mjs";

const PROMPT_HEADING_PATTERN = /^##\s+이미지 생성 프롬프트\s*$/;
const INLINE_PROMPT_PATTERN = /^이미지 생성 프롬프트\s*[:：]\s*(\S.*)$/;
const SECTION_HEADING_PATTERN = /^#{1,2}\s+\S/;

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

export function extractImagePromptSections(value) {
  const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
  const bodyLines = [];
  const prompts = [];
  let activeFence = null;

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    const marker = fenceMarker(line);
    if (activeFence) {
      bodyLines.push(line);
      if (closesFence(marker, activeFence)) activeFence = null;
      index += 1;
      continue;
    }
    if (marker) {
      activeFence = marker;
      bodyLines.push(line);
      index += 1;
      continue;
    }

    if (PROMPT_HEADING_PATTERN.test(line)) {
      const section = collectHeadingPrompt(lines, index);
      if (!section.prompt) bodyLines.push(line, ...section.lines);
      else prompts.push(section.prompt);
      index = section.end;
      continue;
    }

    const inlineMatch = line.match(INLINE_PROMPT_PATTERN);
    if (inlineMatch) {
      prompts.push(inlineMatch[1].trim());
      index += 1;
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
