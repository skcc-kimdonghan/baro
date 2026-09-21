function browserEnvironment() {
  return {
    Blob: globalThis.Blob,
    ClipboardItem: globalThis.ClipboardItem,
    clipboard: globalThis.navigator?.clipboard,
    document: globalThis.document,
  };
}

async function copyWithLegacySelection(text, documentObject) {
  if (!documentObject?.body || typeof documentObject.execCommand !== "function") {
    throw new Error("이 브라우저에서는 자동 복사를 사용할 수 없습니다.");
  }

  const textarea = documentObject.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  Object.assign(textarea.style, {
    position: "fixed",
    inset: "-9999px auto auto -9999px",
    opacity: "0",
  });
  documentObject.body.appendChild(textarea);
  textarea.select();
  const copied = documentObject.execCommand("copy");
  textarea.remove();

  if (!copied) throw new Error("복사 권한을 확인해 주세요.");
  return Object.freeze({ mode: "legacy" });
}

async function copyPlainText(text, environment) {
  if (environment.clipboard?.writeText) {
    try {
      await environment.clipboard.writeText(text);
      return Object.freeze({ mode: "plain" });
    } catch {
      return copyWithLegacySelection(text, environment.document);
    }
  }
  return copyWithLegacySelection(text, environment.document);
}

export async function copyArticle(payload, requestedMode = "rich", providedEnvironment) {
  const environment = providedEnvironment ?? browserEnvironment();
  if (!payload?.plainText) throw new Error("복사할 내용이 없습니다.");

  if (
    requestedMode === "rich" &&
    environment.clipboard?.write &&
    environment.ClipboardItem &&
    environment.Blob
  ) {
    try {
      const item = new environment.ClipboardItem({
        "text/html": new environment.Blob([payload.html], { type: "text/html" }),
        "text/plain": new environment.Blob([payload.plainText], { type: "text/plain" }),
      });
      await environment.clipboard.write([item]);
      return Object.freeze({ mode: "rich" });
    } catch {
      const fallback = await copyPlainText(payload.plainText, environment);
      return Object.freeze({
        mode: fallback.mode === "plain" ? "plain-fallback" : fallback.mode,
      });
    }
  }

  return copyPlainText(payload.plainText, environment);
}
