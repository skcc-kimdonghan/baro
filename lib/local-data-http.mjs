import { timingSafeEqual } from "node:crypto";

import { LOCAL_DATA_COLLECTIONS } from "./local-data-model.mjs";

const DEFAULT_MAX_REQUEST_BYTES = 12_000_000;
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);
const ACCESS_TOKEN_PATTERN = /^[a-f0-9]{64}$/;

function jsonResponse(body, status = 200) {
  return Response.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function success(data, status = 200) {
  return jsonResponse({ success: true, data }, status);
}

function failure(code, message, status) {
  return jsonResponse({ success: false, error: { code, message } }, status);
}

function checkWriteRequest(request) {
  const requestUrl = new URL(request.url);
  const origin = request.headers.get("origin");
  if (!LOOPBACK_HOSTNAMES.has(requestUrl.hostname) || origin !== requestUrl.origin) {
    return failure("LOCAL_DATA_FORBIDDEN", "이 요청은 로컬 바로발행 화면에서만 사용할 수 있습니다.", 403);
  }
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return failure("UNSUPPORTED_MEDIA_TYPE", "JSON 형식의 요청만 처리할 수 있습니다.", 415);
  }
  return null;
}

function checkLoopbackRequest(request) {
  if (!LOOPBACK_HOSTNAMES.has(new URL(request.url).hostname)) {
    return failure("LOCAL_DATA_FORBIDDEN", "이 요청은 로컬 바로발행 화면에서만 사용할 수 있습니다.", 403);
  }
  return null;
}

function checkCapabilityRequest(request, accessToken) {
  if (!ACCESS_TOKEN_PATTERN.test(accessToken)) {
    return failure("LOCAL_DATA_AUTH_UNAVAILABLE", "로컬 DB 인증을 준비하지 못했습니다. 바로발행을 다시 실행해 주세요.", 503);
  }
  const provided = request.headers.get("x-baro-publish-token") ?? "";
  if (!ACCESS_TOKEN_PATTERN.test(provided)) {
    return failure("LOCAL_DATA_UNAUTHORIZED", "바로발행 바로가기로 다시 열어 주세요.", 401);
  }
  const expectedBytes = new TextEncoder().encode(accessToken);
  const providedBytes = new TextEncoder().encode(provided);
  if (!timingSafeEqual(expectedBytes, providedBytes)) {
    return failure("LOCAL_DATA_UNAUTHORIZED", "바로발행 바로가기로 다시 열어 주세요.", 401);
  }
  return null;
}

async function readJsonBody(request, maxRequestBytes) {
  const declaredLengthHeader = request.headers.get("content-length");
  if (declaredLengthHeader !== null && !/^\d+$/.test(declaredLengthHeader)) {
    throw Object.assign(new Error("요청 크기 정보가 올바르지 않습니다."), { code: "INVALID_CONTENT_LENGTH" });
  }
  const declaredLength = declaredLengthHeader === null ? 0 : Number(declaredLengthHeader);
  if (!Number.isSafeInteger(declaredLength) || declaredLength > maxRequestBytes) {
    throw Object.assign(new Error("요청 크기가 저장 한도를 초과했습니다."), { code: "REQUEST_TOO_LARGE" });
  }

  const reader = request.body?.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunks = [];
  let receivedBytes = 0;
  try {
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        receivedBytes += value.byteLength;
        if (receivedBytes > maxRequestBytes) {
          try { await reader.cancel(); } catch {}
          throw Object.assign(new Error("요청 크기가 저장 한도를 초과했습니다."), { code: "REQUEST_TOO_LARGE" });
        }
        chunks.push(decoder.decode(value, { stream: true }));
      }
    }
    chunks.push(decoder.decode());
  } catch (error) {
    if (error?.code === "REQUEST_TOO_LARGE") throw error;
    throw Object.assign(new Error("요청 JSON 형식이 올바르지 않습니다."), { code: "INVALID_JSON" });
  }
  const text = chunks.join("");
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("요청 JSON 형식이 올바르지 않습니다."), { code: "INVALID_JSON" });
  }
}

function errorResponse(error, onError) {
  if (error?.code === "REQUEST_TOO_LARGE") return failure(error.code, error.message, 413);
  if (error?.code === "INVALID_JSON" || error?.code === "INVALID_CONTENT_LENGTH") {
    return failure(error.code, error.message, 400);
  }
  if (error?.code === "REVISION_CONFLICT" || error?.code === "MIGRATION_CONFLICT") {
    return failure(error.code, "다른 화면에서 데이터가 변경되었습니다. 최신 데이터를 다시 불러와 주세요.", 409);
  }
  if (
    typeof error?.code === "string" &&
    (error.code.startsWith("INVALID_") || error.code.includes("LIMIT") || error.code.includes("DUPLICATE"))
  ) {
    return failure(error.code, error.message || "저장할 데이터가 올바르지 않습니다.", 422);
  }
  onError(error);
  return failure("LOCAL_DATA_UNAVAILABLE", "로컬 DB를 사용할 수 없습니다. 바로발행을 다시 실행해 주세요.", 500);
}

function validateReplaceBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw Object.assign(new Error("저장 요청 형식이 올바르지 않습니다."), { code: "INVALID_LOCAL_DATA" });
  }
  if (!LOCAL_DATA_COLLECTIONS.includes(body.collection) || !Array.isArray(body.entries)) {
    throw Object.assign(new Error("저장할 컬렉션이 올바르지 않습니다."), { code: "INVALID_LOCAL_DATA_COLLECTION" });
  }
  if (!Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0) {
    throw Object.assign(new Error("데이터 revision이 올바르지 않습니다."), { code: "INVALID_LOCAL_DATA_REVISION" });
  }
  return body;
}

export function createLocalDataHttpHandlers({
  service,
  accessToken = "",
  maxRequestBytes = DEFAULT_MAX_REQUEST_BYTES,
  onError = (error) => console.error("Local data API error", error),
}) {
  return Object.freeze({
    async GET(request) {
      const rejected = checkLoopbackRequest(request);
      if (rejected) return rejected;
      const unauthorized = checkCapabilityRequest(request, accessToken);
      if (unauthorized) return unauthorized;
      try {
        const collection = new URL(request.url).searchParams.get("collection");
        if (collection === null) return success(await service.readAll());
        if (!LOCAL_DATA_COLLECTIONS.includes(collection)) {
          return failure("INVALID_LOCAL_DATA_COLLECTION", "로컬 데이터 컬렉션이 올바르지 않습니다.", 422);
        }
        return success(await service.read(collection));
      } catch (error) {
        return errorResponse(error, onError);
      }
    },
    async PUT(request) {
      const rejected = checkWriteRequest(request);
      if (rejected) return rejected;
      const unauthorized = checkCapabilityRequest(request, accessToken);
      if (unauthorized) return unauthorized;
      try {
        const body = validateReplaceBody(await readJsonBody(request, maxRequestBytes));
        return success(await service.replace(body.collection, body.entries, body.expectedRevision));
      } catch (error) {
        return errorResponse(error, onError);
      }
    },
    async POST(request) {
      const rejected = checkWriteRequest(request);
      if (rejected) return rejected;
      const unauthorized = checkCapabilityRequest(request, accessToken);
      if (unauthorized) return unauthorized;
      try {
        const body = await readJsonBody(request, maxRequestBytes);
        return success(await service.importLegacy(body));
      } catch (error) {
        return errorResponse(error, onError);
      }
    },
  });
}
