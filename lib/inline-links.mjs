function parseMarkdownLinkAt(source, start) {
  const isImage = source[start] === "!";
  const labelStart = start + (isImage ? 2 : 1);
  if (source[start + (isImage ? 1 : 0)] !== "[") return null;

  let labelEnd = labelStart;
  while (labelEnd < source.length && source[labelEnd] !== "]") {
    if (source[labelEnd] === "[") return null;
    labelEnd += 1;
  }
  if (labelEnd >= source.length) return Object.freeze({ incomplete: true });
  if (source[labelEnd + 1] !== "(") return null;

  const urlStart = labelEnd + 2;
  let depth = 0;
  for (let index = urlStart; index < source.length; index += 1) {
    const character = source[index];
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character !== ")") continue;
    if (depth > 0) {
      depth -= 1;
      continue;
    }
    return Object.freeze({
      end: index + 1,
      image: isImage,
      label: source.slice(labelStart, labelEnd),
      raw: source.slice(start, index + 1),
      url: source.slice(urlStart, index),
    });
  }
  return Object.freeze({ incomplete: true });
}

export function transformMarkdownLinks(value, transform, transformText = (text) => text) {
  const source = String(value ?? "");
  const output = [];
  let cursor = 0;
  let textStart = 0;

  while (cursor < source.length) {
    const bracketIndex = source.indexOf("[", cursor);
    if (bracketIndex < 0) break;

    const start = bracketIndex > textStart && source[bracketIndex - 1] === "!"
      ? bracketIndex - 1
      : bracketIndex;
    const parsed = parseMarkdownLinkAt(source, start);
    if (parsed?.incomplete) break;
    if (!parsed) {
      cursor = bracketIndex + 1;
      continue;
    }

    output.push(transformText(source.slice(textStart, start)));
    output.push(transform(parsed));
    cursor = parsed.end;
    textStart = cursor;
  }

  output.push(transformText(source.slice(textStart)));
  return output.join("");
}

export function transformOutsideMarkdownLiterals(value, transformText) {
  const source = String(value ?? "");
  const output = [];
  let cursor = 0;
  let textStart = 0;
  let linksDisabled = false;

  while (cursor < source.length) {
    const codeStart = source.indexOf("`", cursor);
    const bracketIndex = linksDisabled ? -1 : source.indexOf("[", cursor);
    const linkStart = bracketIndex > textStart && source[bracketIndex - 1] === "!"
      ? bracketIndex - 1
      : bracketIndex;
    const codeComesFirst = codeStart >= 0 && (linkStart < 0 || codeStart < linkStart);

    if (codeComesFirst) {
      const codeEnd = source.indexOf("`", codeStart + 1);
      if (codeEnd < 0) {
        cursor = codeStart + 1;
        continue;
      }
      output.push(transformText(source.slice(textStart, codeStart)));
      output.push(source.slice(codeStart, codeEnd + 1));
      cursor = codeEnd + 1;
      textStart = cursor;
      continue;
    }

    if (linkStart < 0) break;
    const parsed = parseMarkdownLinkAt(source, linkStart);
    if (parsed?.incomplete) {
      linksDisabled = true;
      cursor = bracketIndex + 1;
      continue;
    }
    if (!parsed) {
      cursor = bracketIndex + 1;
      continue;
    }
    output.push(transformText(source.slice(textStart, linkStart)));
    output.push(parsed.raw);
    cursor = parsed.end;
    textStart = cursor;
  }

  output.push(transformText(source.slice(textStart)));
  return output.join("");
}
