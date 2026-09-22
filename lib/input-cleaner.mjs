import { transformOutsideMarkdownLiterals } from "./inline-links.mjs";

const REFERENCE_DEFINITION_PATTERN = /^\s*\[\d+\]:\s+\S+/;
const PARENTHETICAL_PATTERN = /\(([^()\n]*)\)/g;
const REFERENCE_TOKEN_PATTERN = /\[[^\[\]\n]+\]\[\d+\]/g;

export function fenceMarker(line) {
  const match = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
  if (!match) return null;
  return Object.freeze({ delimiter: match[1], suffix: match[2] });
}

export function closesFence(marker, activeFence) {
  return Boolean(
    marker &&
    activeFence &&
    marker.delimiter[0] === activeFence.delimiter[0] &&
    marker.delimiter.length >= activeFence.delimiter.length &&
    !marker.suffix.trim(),
  );
}

function stripReferenceCitations(line) {
  const stripUnprotectedText = (unprotectedLine) => {
    const withoutParentheticalCitations = unprotectedLine.replace(
      PARENTHETICAL_PATTERN,
      (fullMatch, content) => {
        let hasReferenceToken = false;
        const remainder = content.replace(REFERENCE_TOKEN_PATTERN, () => {
          hasReferenceToken = true;
          return "";
        });
        return hasReferenceToken && /^[\s,;]*$/.test(remainder) ? "" : fullMatch;
      },
    );
    return withoutParentheticalCitations.replace(REFERENCE_TOKEN_PATTERN, "");
  };
  const transformed = transformOutsideMarkdownLiterals(line, stripUnprotectedText);
  return transformed.trimEnd();
}

function isGeneratedMetaLine(line) {
  const text = line
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const isCopyPreparation =
    /(?:복붙|복사|붙여넣기)/.test(text) &&
    /(?:각각|글별|따로|블록|나눴|정리했|구성했)/.test(text) &&
    /(?:\d{1,2}\s*개\s*(?:의\s*)?(?:글|원고|포스팅)|여러\s*개(?:의)?\s*(?:글|원고|포스팅)|(?:글|원고|포스팅)\s*\d{1,2}\s*개)/.test(text);
  const editorialSignals = [
    /(?:억지로|임의로|추측해서?)/,
    /(?:만들|작성|반영|넣)/,
    /(?:않았|제외)/,
  ];
  let signalOffset = 0;
  const hasOrderedEditorialSignals = editorialSignals.every((pattern) => {
    const match = pattern.exec(text.slice(signalOffset));
    if (!match) return false;
    signalOffset += match.index + match[0].length;
    return true;
  });
  const isEditorialNote =
    /^\d+\s*번(?:\s+|[.)])/.test(text) &&
    /(?:공개|확인|확정)(?:이\s*)?되지/.test(text) &&
    hasOrderedEditorialSignals;
  return isCopyPreparation || isEditorialNote;
}

function removeLeadingGeneratedMeta(lines, isArticleStartLine) {
  let activeFence = null;
  let firstArticleIndex = -1;
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
    if (isArticleStartLine(lines[index])) {
      firstArticleIndex = index;
      break;
    }
  }
  if (firstArticleIndex <= 0) return lines;

  const leading = lines.slice(0, firstArticleIndex);
  const filtered = leading.filter((line) => !line.trim() || !isGeneratedMetaLine(line));
  return [...filtered, ...lines.slice(firstArticleIndex)];
}

export function cleanGeneratedArtifacts(value, isArticleStartLine) {
  const lines = String(value ?? "").replace(/\r\n?/g, "\n").split("\n");
  const cleaned = [];
  let activeFence = null;

  for (const line of lines) {
    const marker = fenceMarker(line);
    if (activeFence) {
      cleaned.push(line);
      if (closesFence(marker, activeFence)) activeFence = null;
      continue;
    }
    if (marker) {
      cleaned.push(line);
      activeFence = marker;
      continue;
    }
    if (REFERENCE_DEFINITION_PATTERN.test(line)) continue;
    cleaned.push(stripReferenceCitations(line));
  }

  return removeLeadingGeneratedMeta(cleaned, isArticleStartLine).join("\n");
}
