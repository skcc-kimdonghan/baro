import { LOCAL_DATA_COLLECTIONS } from "./local-data-model.mjs";

function clientError(code, message, status = 0, cause) {
  return Object.assign(new Error(message, cause ? { cause } : undefined), { code, status });
}

async function readJsonResponse(response) {
  let body;
  try {
    body = await response.json();
  } catch (cause) {
    throw clientError(
      "LOCAL_DATA_PROTOCOL_ERROR",
      "로컬 DB 응답을 읽지 못했습니다. 서버를 다시 실행해 주세요.",
      response.status,
      cause,
    );
  }
  if (!body || typeof body !== "object") {
    throw clientError("LOCAL_DATA_PROTOCOL_ERROR", "로컬 DB 응답 형식이 올바르지 않습니다.", response.status);
  }
  if (!response.ok || body.success !== true) {
    const code = typeof body.error?.code === "string" ? body.error.code : "LOCAL_DATA_REQUEST_FAILED";
    const message = typeof body.error?.message === "string"
      ? body.error.message
      : "로컬 DB 요청을 처리하지 못했습니다.";
    throw clientError(code, message, response.status);
  }
  return body.data;
}

async function safeFetch(fetchImpl, url, options) {
  try {
    return await fetchImpl(url, options);
  } catch (cause) {
    throw clientError(
      "LOCAL_DATA_NETWORK_ERROR",
      "로컬 DB 서버에 연결하지 못했습니다. 바로발행을 다시 실행해 주세요.",
      0,
      cause,
    );
  }
}

function assertCollection(collection) {
  if (!LOCAL_DATA_COLLECTIONS.includes(collection)) {
    throw clientError("INVALID_LOCAL_DATA_COLLECTION", "로컬 데이터 컬렉션이 올바르지 않습니다.");
  }
}

export function createLocalDataClient({ fetchImpl = globalThis.fetch, baseUrl = "", accessToken = "" } = {}) {
  if (typeof fetchImpl !== "function") {
    throw clientError("LOCAL_DATA_CLIENT_UNAVAILABLE", "로컬 DB 연결 기능을 사용할 수 없습니다.");
  }

  if (typeof accessToken !== "string" || !/^[a-f0-9]{64}$/.test(accessToken)) {
    throw clientError(
      "LOCAL_DATA_AUTH_REQUIRED",
      "바로발행 바로가기로 다시 열어 로컬 DB 연결을 인증해 주세요.",
    );
  }

  const authHeaders = Object.freeze({ "x-baro-publish-token": accessToken });

  const request = async (path, options) => {
    const response = await safeFetch(fetchImpl, `${baseUrl}${path}`, {
      ...options,
      headers: { ...authHeaders, ...options?.headers },
    });
    return readJsonResponse(response);
  };

  return Object.freeze({
    async read(collection) {
      assertCollection(collection);
      return request(`/api/local-data?collection=${encodeURIComponent(collection)}`);
    },
    async readAll() {
      return request("/api/local-data");
    },
    async replace(collection, entries, expectedRevision) {
      assertCollection(collection);
      return request("/api/local-data", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ collection, entries, expectedRevision }),
      });
    },
    async importLegacy(input) {
      return request("/api/local-data/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
    },
  });
}
