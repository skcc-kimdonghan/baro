export const MAX_COMPARISON_HTML_LENGTH = 500_000;
export const MAX_FORMAT_TEXT_UNITS = 120_000;

const FORMAT_CHECKS = Object.freeze([
  ["font-size", "글자 크기"],
  ["font-family", "글꼴"],
  ["line-height", "줄 간격"],
  ["letter-spacing", "자간"],
  ["paragraph", "문단"],
  ["bold", "굵게"],
  ["italic", "기울임"],
  ["underline", "밑줄"],
  ["list", "목록"],
  ["table", "표"],
  ["divider", "구분선"],
  ["link", "링크"],
  ["alignment", "정렬"],
  ["color", "글자색"],
  ["background", "배경색"],
  ["margin", "문단 간격"],
  ["padding", "내부 여백"],
  ["border", "테두리"],
]);

const TEXT_BOUND_FORMAT_KEYS = Object.freeze([
  "font-size",
  "font-family",
  "line-height",
  "letter-spacing",
  "bold",
  "italic",
  "underline",
  "link",
  "alignment",
  "color",
  "background",
]);

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
const TITLE_BLOCK_TAGS = new Set(["div", "h1", "h2", "h3", "h4", "h5", "h6", "p"]);

function validationError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function stripIgnoredSections(html) {
  const lower = html.toLowerCase();
  const startPattern = /<!--|<(script|style|noscript)\b/gi;
  const chunks = [];
  let cursor = 0;
  let match;

  while ((match = startPattern.exec(html)) !== null) {
    chunks.push(html.slice(cursor, match.index));
    if (match[0] === "<!--") {
      const close = lower.indexOf("-->", startPattern.lastIndex);
      if (close < 0) return chunks.join("");
      cursor = close + 3;
    } else {
      const tagName = match[1].toLowerCase();
      const closeStart = lower.indexOf(`</${tagName}`, startPattern.lastIndex);
      if (closeStart < 0) return chunks.join("");
      const closeEnd = lower.indexOf(">", closeStart + tagName.length + 2);
      if (closeEnd < 0) return chunks.join("");
      cursor = closeEnd + 1;
    }
    startPattern.lastIndex = cursor;
  }

  chunks.push(html.slice(cursor));
  return chunks.join("");
}

function safeHtml(value, label) {
  const html = String(value ?? "");
  if (html.length > MAX_COMPARISON_HTML_LENGTH) {
    throw validationError(
      `${label} 서식은 ${MAX_COMPARISON_HTML_LENGTH.toLocaleString("ko-KR")}자까지 비교할 수 있습니다.`,
      label === "제공 원고" ? "EXPECTED_HTML_TOO_LONG" : "ACTUAL_HTML_TOO_LONG",
    );
  }
  return stripIgnoredSections(html);
}

function tagCount(html, tags) {
  const pattern = new RegExp(`<(?:${tags.join("|")})(?:\\s|>)`, "gi");
  return (html.match(pattern) ?? []).length;
}

function styleValues(html, property) {
  const values = [];
  const stylePattern = /\bstyle\s*=\s*(["'])([^]*?)\1/gi;
  const propertyPattern = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i");
  for (const match of html.matchAll(stylePattern)) {
    const value = match[2].match(propertyPattern)?.[1]?.trim();
    if (value) values.push(value);
  }
  return values;
}

function rounded(value) {
  return Number(value.toFixed(2)).toString();
}

function normalizeLength(value) {
  const normalized = value.trim().toLowerCase();
  const match = normalized.match(/^(-?\d+(?:\.\d+)?)(px|pt)$/);
  if (!match) return normalized.replace(/\s+/g, " ");
  const amount = Number(match[1]);
  const pixels = match[2] === "pt" ? amount * (96 / 72) : amount;
  return `${rounded(pixels)}px`;
}

function normalizeLineHeight(value) {
  const normalized = value.trim().toLowerCase();
  return /(?:px|pt)$/.test(normalized) ? normalizeLength(normalized) : normalized.replace(/\s+/g, " ");
}

function componentToHex(value) {
  return Math.max(0, Math.min(255, Number(value))).toString(16).padStart(2, "0");
}

function normalizeColor(value) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "");
  const shortHex = normalized.match(/^#([0-9a-f]{3})$/i);
  if (shortHex) return `#${[...shortHex[1]].map((part) => part.repeat(2)).join("")}`;
  if (/^#[0-9a-f]{6}$/i.test(normalized)) return normalized;
  const rgb = normalized.match(/^rgb\((\d+),(\d+),(\d+)\)$/);
  if (rgb) return `#${componentToHex(rgb[1])}${componentToHex(rgb[2])}${componentToHex(rgb[3])}`;
  return normalized;
}

function valueSummary(values, normalize = (value) => value.trim().toLowerCase()) {
  const unique = [...new Set(values.map(normalize).filter(Boolean))].sort((left, right) => left.localeCompare(right));
  return unique.length > 0 ? unique.join(", ") : "없음";
}

function decodeTextEntities(value) {
  return value
    .replace(/&#(\d+);?/g, (_, code) => String.fromCodePoint(Math.min(Number(code), 0x10ffff)))
    .replace(/&#x([0-9a-f]+);?/gi, (_, code) => String.fromCodePoint(Math.min(Number.parseInt(code, 16), 0x10ffff)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function attributeValue(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:(["'])(.*?)\\1|([^\\s>]+))`, "i"));
  return match?.[2] ?? match?.[3] ?? "";
}

function styleDeclarations(tag) {
  const declarationText = attributeValue(tag, "style");
  return Object.fromEntries(declarationText
    .split(";")
    .map((declaration) => declaration.split(":"))
    .filter((parts) => parts.length > 1)
    .map(([property, ...value]) => [property.trim().toLowerCase(), value.join(":").trim()]));
}

function findTagEnd(html, start) {
  let quote = "";
  for (let index = start + 1; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    }
  }
  return html.length - 1;
}

function compactVisibleText(value) {
  return decodeTextEntities(value).replace(/\s+/g, " ").trim();
}

export function stripOptionalTitleHtml(value, titleValue) {
  const html = String(value ?? "");
  const title = compactVisibleText(String(titleValue ?? ""));
  if (!title || html.length > MAX_COMPARISON_HTML_LENGTH) return html;

  const stack = [];
  let cursor = 0;
  let visiblePrefix = "";
  const prefixLimit = title.length + 1;

  const captureText = (rawText) => {
    const decoded = decodeTextEntities(rawText);
    visiblePrefix = `${visiblePrefix}${decoded}`.slice(0, prefixLimit);
    if (stack.length > 0) {
      const current = stack.at(-1);
      current.text = `${current.text}${decoded}`.slice(0, prefixLimit);
    }
  };

  while (cursor < html.length) {
    const tagStart = html.indexOf("<", cursor);
    if (tagStart < 0) break;
    captureText(html.slice(cursor, tagStart));
    const tagEnd = findTagEnd(html, tagStart);
    const tag = html.slice(tagStart, tagEnd + 1);
    const closing = tag.match(/^<\s*\/\s*([a-z0-9:-]+)/i);

    if (closing) {
      const tagName = closing[1].toLowerCase();
      const current = stack.at(-1);
      if (current?.tagName === tagName) {
        stack.pop();
        const startsAtDocumentText = compactVisibleText(visiblePrefix.slice(0, current.visibleStart)).length === 0;
        if (TITLE_BLOCK_TAGS.has(tagName) && startsAtDocumentText && compactVisibleText(current.text) === title) {
          return `${html.slice(0, current.sourceStart)}${html.slice(tagEnd + 1)}`;
        }
        if (stack.length > 0) {
          const parent = stack.at(-1);
          parent.text = `${parent.text}${current.text}`.slice(0, prefixLimit);
        }
      }
    } else {
      const opening = tag.match(/^<\s*([a-z0-9:-]+)/i);
      if (opening) {
        const tagName = opening[1].toLowerCase();
        if (!VOID_TAGS.has(tagName) && !/\/\s*>$/.test(tag)) {
          stack.push({ tagName, sourceStart: tagStart, visibleStart: visiblePrefix.length, text: "" });
        }
      }
    }
    cursor = tagEnd + 1;
  }

  return html;
}

function defaultTextStyle() {
  return Object.freeze({
    "font-size": "",
    "font-family": "",
    "line-height": "",
    "letter-spacing": "",
    bold: false,
    italic: false,
    underline: false,
    link: "",
    alignment: "",
    color: "",
    background: "",
  });
}

function normalizedHref(value) {
  const href = value.trim().replaceAll("&amp;", "&");
  return /^https?:\/\//i.test(href) ? href : "";
}

function textStyleForTag(parent, tagName, tag) {
  const declarations = styleDeclarations(tag);
  const fontWeight = declarations["font-weight"]?.toLowerCase();
  const fontStyle = declarations["font-style"]?.toLowerCase();
  const textDecoration = declarations["text-decoration"]?.toLowerCase();
  const align = declarations["text-align"] || attributeValue(tag, "align");
  const background = declarations["background-color"] || declarations.background;
  const hasFontWeight = fontWeight !== undefined;
  const hasFontStyle = fontStyle !== undefined;
  const hasTextDecoration = textDecoration !== undefined;

  return Object.freeze({
    ...parent,
    "font-size": declarations["font-size"] ? normalizeLength(declarations["font-size"]) : parent["font-size"],
    "font-family": declarations["font-family"] ? declarations["font-family"].toLowerCase().replace(/["']/g, "") : parent["font-family"],
    "line-height": declarations["line-height"] ? normalizeLineHeight(declarations["line-height"]) : parent["line-height"],
    "letter-spacing": declarations["letter-spacing"] ? normalizeLength(declarations["letter-spacing"]) : parent["letter-spacing"],
    bold: tagName === "strong" || tagName === "b"
      ? true
      : hasFontWeight
        ? fontWeight === "bold" || fontWeight === "bolder" || Number.parseInt(fontWeight, 10) >= 600
        : parent.bold,
    italic: tagName === "em" || tagName === "i"
      ? true
      : hasFontStyle
        ? fontStyle === "italic" || fontStyle === "oblique"
        : parent.italic,
    underline: tagName === "u"
      ? true
      : hasTextDecoration
        ? textDecoration.includes("underline")
        : parent.underline,
    link: tagName === "a" ? normalizedHref(attributeValue(tag, "href")) : parent.link,
    alignment: align ? align.trim().toLowerCase() : parent.alignment,
    color: declarations.color ? normalizeColor(declarations.color) : parent.color,
    background: background ? normalizeColor(background) : parent.background,
  });
}

function updateHash(hash, value) {
  let next = hash >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    next ^= value.charCodeAt(index);
    next = Math.imul(next, 16777619) >>> 0;
  }
  return next;
}

function textStyleFingerprints(html, enabled) {
  if (!enabled) return Object.freeze({ exceeded: false, values: Object.freeze({}) });
  const states = Object.fromEntries(TEXT_BOUND_FORMAT_KEYS.map((key, index) => [key, {
    hash1: 2166136261 ^ index,
    hash2: 2166136261 ^ (index + 97),
    lastValue: null,
    runLength: 0,
  }]));
  const stack = [{ tagName: "", style: defaultTextStyle() }];
  let textUnits = 0;
  let cursor = 0;

  const flushRun = (state) => {
    if (state.lastValue === null || state.runLength === 0) return;
    const signature = `${state.runLength}\u0000${state.lastValue}\u0001`;
    state.hash1 = updateHash(state.hash1, signature);
    state.hash2 = updateHash(state.hash2, `secondary\u0000${signature}`);
    state.runLength = 0;
  };

  const captureText = (rawText) => {
    let unitCount = 0;
    for (const character of decodeTextEntities(rawText)) {
      if (!/\s/u.test(character)) unitCount += 1;
    }
    if (unitCount === 0) return false;
    textUnits += unitCount;
    if (textUnits > MAX_FORMAT_TEXT_UNITS) return true;

    const activeStyle = stack.at(-1).style;
    for (const key of TEXT_BOUND_FORMAT_KEYS) {
      const state = states[key];
      const value = String(activeStyle[key]);
      if (state.lastValue !== value) {
        flushRun(state);
        state.lastValue = value;
      }
      state.runLength += unitCount;
    }
    return false;
  };

  while (cursor < html.length) {
    const tagStart = html.indexOf("<", cursor);
    if (tagStart < 0) {
      if (captureText(html.slice(cursor))) return Object.freeze({ exceeded: true, values: Object.freeze({}) });
      break;
    }
    if (captureText(html.slice(cursor, tagStart))) return Object.freeze({ exceeded: true, values: Object.freeze({}) });
    const tagEnd = findTagEnd(html, tagStart);
    const tag = html.slice(tagStart, tagEnd + 1);
    const closing = tag.match(/^<\s*\/\s*([a-z0-9:-]+)/i);
    if (closing) {
      const closingName = closing[1].toLowerCase();
      if (stack.at(-1)?.tagName === closingName && stack.length > 1) stack.pop();
    } else {
      const opening = tag.match(/^<\s*([a-z0-9:-]+)/i);
      if (opening) {
        const tagName = opening[1].toLowerCase();
        const style = textStyleForTag(stack.at(-1).style, tagName, tag);
        if (!VOID_TAGS.has(tagName) && !/\/\s*>$/.test(tag)) stack.push({ tagName, style });
      }
    }
    cursor = tagEnd + 1;
  }

  for (const state of Object.values(states)) flushRun(state);
  return Object.freeze({
    exceeded: false,
    values: Object.freeze(Object.fromEntries(TEXT_BOUND_FORMAT_KEYS.map((key) => [
      key,
      `${textUnits}:${states[key].hash1.toString(16)}:${states[key].hash2.toString(16)}`,
    ]))),
  });
}

function linkSummary(html) {
  const tags = html.match(/<a(?:\s|>)[^>]*>/gi) ?? [];
  const hrefs = tags
    .map((tag) => {
      const match = tag.match(/\bhref\s*=\s*(?:(["'])(.*?)\1|([^\s>]+))/i);
      return match?.[2] ?? match?.[3] ?? "";
    })
    .map((href) => href.trim().replaceAll("&amp;", "&"))
    .filter((href) => /^https?:\/\//i.test(href));
  return `${tags.length}개${hrefs.length > 0 ? ` · ${[...new Set(hrefs)].sort().join(", ")}` : ""}`;
}

function styledCount(html, property, predicate) {
  return styleValues(html, property).filter((value) => predicate(value.trim().toLowerCase())).length;
}

function profile(html, includeFingerprints) {
  const bold = Math.max(tagCount(html, ["strong", "b"]), styledCount(
    html,
    "font-weight",
    (value) => value === "bold" || value === "bolder" || Number.parseInt(value, 10) >= 600,
  ));
  const italic = Math.max(tagCount(html, ["em", "i"]), styledCount(
    html,
    "font-style",
    (value) => value === "italic" || value === "oblique",
  ));
  const underline = Math.max(tagCount(html, ["u"]), styledCount(
    html,
    "text-decoration",
    (value) => value.includes("underline"),
  ));
  const list = `목록 ${tagCount(html, ["ul", "ol"])}개 · 항목 ${tagCount(html, ["li"])}개`;
  const table = `표 ${tagCount(html, ["table"])}개 · 행 ${tagCount(html, ["tr"])}개 · 제목셀 ${tagCount(html, ["th"])}개 · 셀 ${tagCount(html, ["td"])}개`;

  return Object.freeze({
    "font-size": valueSummary(styleValues(html, "font-size"), normalizeLength),
    "font-family": valueSummary(styleValues(html, "font-family"), (value) => value.trim().toLowerCase().replace(/["']/g, "")),
    "line-height": valueSummary(styleValues(html, "line-height"), normalizeLineHeight),
    "letter-spacing": valueSummary(styleValues(html, "letter-spacing"), normalizeLength),
    paragraph: `${tagCount(html, ["p"])}개`,
    bold: `${bold}곳`,
    italic: `${italic}곳`,
    underline: `${underline}곳`,
    list,
    table,
    divider: `${tagCount(html, ["hr"])}개`,
    link: linkSummary(html),
    alignment: valueSummary([
      ...styleValues(html, "text-align"),
      ...[...html.matchAll(/\balign\s*=\s*["']?([^\s"'>]+)/gi)].map((match) => match[1]),
    ]),
    color: valueSummary(styleValues(html, "color"), normalizeColor),
    background: valueSummary([
      ...styleValues(html, "background-color"),
      ...styleValues(html, "background"),
    ], normalizeColor),
    margin: valueSummary(styleValues(html, "margin"), (value) => value.trim().toLowerCase().replace(/\s+/g, " ")),
    padding: valueSummary(styleValues(html, "padding"), (value) => value.trim().toLowerCase().replace(/\s+/g, " ")),
    border: valueSummary([
      ...styleValues(html, "border"),
      ...styleValues(html, "border-top"),
      ...styleValues(html, "border-right"),
      ...styleValues(html, "border-bottom"),
      ...styleValues(html, "border-left"),
    ], (value) => value.trim().toLowerCase().replace(/\s+/g, " ")),
    fingerprintResult: textStyleFingerprints(html, includeFingerprints),
  });
}

export function compareArticleFormatting(expectedValue, actualValue, options = {}) {
  const expectedHtml = safeHtml(expectedValue, "제공 원고");
  const actualHtml = safeHtml(actualValue, "실제 발행본");

  if (!actualHtml.trim()) {
    return Object.freeze({
      status: "unavailable",
      score: null,
      summary: "클립보드 HTML이 없어 서식과 글자 크기를 확인하지 못했습니다.",
      checks: Object.freeze([]),
    });
  }

  const compareTextPositions = options.compareTextPositions !== false;
  const expectedProfile = profile(expectedHtml, compareTextPositions);
  const actualProfile = profile(actualHtml, compareTextPositions);
  if (expectedProfile.fingerprintResult.exceeded || actualProfile.fingerprintResult.exceeded) {
    return Object.freeze({
      status: "unavailable",
      score: null,
      summary: "HTML 본문 구조가 너무 복잡해 서식 비교를 중단했습니다.",
      checks: Object.freeze([]),
    });
  }
  const checks = FORMAT_CHECKS.map(([key, label]) => {
    const textBound = TEXT_BOUND_FORMAT_KEYS.includes(key);
    const fingerprintMatches = !textBound
      || !compareTextPositions
      || expectedProfile.fingerprintResult.values[key] === actualProfile.fingerprintResult.values[key];
    const normalizedWrapperDifference = textBound
      && compareTextPositions
      && fingerprintMatches
      && expectedProfile[key] !== actualProfile[key];
    return Object.freeze({
      key,
      label,
      expected: normalizedWrapperDifference ? "적용 결과 같음" : expectedProfile[key],
      actual: normalizedWrapperDifference ? "적용 결과 같음" : actualProfile[key],
      matched: textBound && compareTextPositions
        ? fingerprintMatches
        : expectedProfile[key] === actualProfile[key],
    });
  });
  const matchedCount = checks.filter((check) => check.matched).length;
  const mismatchCount = checks.length - matchedCount;
  const score = Math.round((matchedCount * 100) / checks.length);

  return Object.freeze({
    status: mismatchCount === 0 ? "match" : "different",
    score,
    summary: mismatchCount === 0
      ? "글자 크기와 주요 서식이 모두 일치합니다."
      : `글자 크기와 주요 서식 ${mismatchCount}개 항목이 다릅니다.`,
    checks: Object.freeze(checks),
  });
}
