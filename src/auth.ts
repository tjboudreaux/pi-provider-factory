import { setTimeout as delay } from "node:timers/promises";

import type { OAuthCredentials, OAuthLoginCallbacks } from "@oh-my-pi/pi-ai/oauth/types";

import { FACTORY_API, factoryApiForRegion, WORKOS_CLIENT_ID, WORKOS_DEVICE_AUTHORIZE, WORKOS_TOKEN } from "./constants";

type Fetcher = NonNullable<OAuthLoginCallbacks["fetch"]>;

type DeviceAuthorization = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresInSeconds: number;
  intervalSeconds: number;
};

type ParsedTokenResponse = {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds?: number;
  email?: string;
  apiEndpoint?: string;
};

const DEVICE_CODE_GRANT = "urn:ietf:params:oauth:grant-type:device_code";
const TOKEN_EXPIRY_SKEW_MS = 60_000;

function formatErrorDetails(error: unknown): string {
  if (error instanceof Error) {
    const details = [`${error.name}: ${error.message}`];
    const errorWithCode: Error & { code?: string; errno?: number | string; cause?: unknown } = error;

    if (errorWithCode.code) {
      details.push(`code=${errorWithCode.code}`);
    }

    if (typeof errorWithCode.errno !== "undefined") {
      details.push(`errno=${String(errorWithCode.errno)}`);
    }

    if (typeof error.cause !== "undefined") {
      details.push(`cause=${formatErrorDetails(error.cause)}`);
    }

    return details.join("; ");
  }

  return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];

  if (typeof value === "string" && value.length > 0) {
    return value;
  }

  return undefined;
}

function numberField(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.length > 0) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return undefined;
}

function firstStringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = stringField(record, key);

    if (value) {
      return value;
    }
  }

  return undefined;
}

function decodeBase64Url(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const paddedBase64 = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(paddedBase64);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));

  return new TextDecoder().decode(bytes);
}

function decodeJwtPayload(accessToken: string): Record<string, unknown> | null {
  const segments = accessToken.split(".");

  if (segments.length < 2 || !segments[1]) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(decodeBase64Url(segments[1]));

    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function orgIdFromAccessToken(accessToken: string): string | undefined {
  const payload = decodeJwtPayload(accessToken);

  if (!payload) {
    return undefined;
  }

  return firstStringField(payload, ["external_org_id", "org_id", "organization_id", "organizationId", "orgId"]);
}

function emailFromAccessToken(accessToken: string): string | undefined {
  const payload = decodeJwtPayload(accessToken);

  if (!payload) {
    return undefined;
  }

  return stringField(payload, "email");
}

function expiresFromAccessToken(accessToken: string): number | undefined {
  const payload = decodeJwtPayload(accessToken);

  if (!payload) {
    return undefined;
  }

  const exp = numberField(payload, "exp");

  if (!exp) {
    return undefined;
  }

  return exp * 1000 - TOKEN_EXPIRY_SKEW_MS;
}

function userEmailFromResponse(record: Record<string, unknown>): string | undefined {
  const user = record.user;

  if (!isRecord(user)) {
    return undefined;
  }

  return stringField(user, "email");
}

function parseDeviceAuthorization(value: unknown): DeviceAuthorization {
  if (!isRecord(value)) {
    throw new Error("Factory device authorization returned a non-object response");
  }

  const deviceCode = stringField(value, "device_code");
  const userCode = stringField(value, "user_code");
  const verificationUri = stringField(value, "verification_uri");
  const verificationUriComplete = stringField(value, "verification_uri_complete");
  const expiresInSeconds = numberField(value, "expires_in");
  const intervalSeconds = numberField(value, "interval");

  if (!deviceCode || !userCode || !verificationUri || !verificationUriComplete || !expiresInSeconds || !intervalSeconds) {
    throw new Error("Factory device authorization response is missing required fields");
  }

  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete,
    expiresInSeconds,
    intervalSeconds,
  };
}

function parseTokenResponse(value: unknown, label: string, fallbackRefreshToken?: string): ParsedTokenResponse {
  if (!isRecord(value)) {
    throw new Error(`Factory OAuth ${label} returned a non-object response`);
  }

  const accessToken = stringField(value, "access_token");
  if (!accessToken) {
    throw new Error(`Factory OAuth ${label} response did not include access_token`);
  }

  const refreshToken = stringField(value, "refresh_token") ?? fallbackRefreshToken;
  if (!refreshToken) {
    throw new Error(`Factory OAuth ${label} response did not include refresh_token`);
  }

  return {
    accessToken,
    refreshToken,
    expiresInSeconds: numberField(value, "expires_in"),
    email: userEmailFromResponse(value),
  };
}

function firstOrganizationId(value: unknown): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const workosOrgIds = value.workosOrgIds;

  if (!Array.isArray(workosOrgIds)) {
    return undefined;
  }

  for (const orgId of workosOrgIds) {
    if (typeof orgId === "string" && orgId.length > 0) {
      return orgId;
    }
  }

  return undefined;
}

function identityFromWhoami(value: unknown): { accountId?: string; region?: string; apiEndpoint?: string } {
  if (!isRecord(value)) {
    return {};
  }

  const accountId = firstStringField(value, ["orgId", "org_id", "organization_id", "organizationId"]);
  const region = stringField(value, "region");

  return {
    accountId,
    region,
    apiEndpoint: factoryApiForRegion(region),
  };
}

async function readJsonResponse(response: Response, label: string): Promise<unknown> {
  const responseBody = await response.text();

  if (!response.ok) {
    throw new Error(`Factory OAuth ${label} request failed. status=${response.status}; body=${responseBody}`);
  }

  try {
    return JSON.parse(responseBody);
  } catch (error) {
    throw new Error(`Factory OAuth ${label} returned invalid JSON: ${formatErrorDetails(error)}`);
  }
}

async function requestDeviceAuthorization(fetchImpl: Fetcher): Promise<DeviceAuthorization> {
  const response = await fetchImpl(WORKOS_DEVICE_AUTHORIZE, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: WORKOS_CLIENT_ID,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const parsed = await readJsonResponse(response, "device authorization");

  return parseDeviceAuthorization(parsed);
}

async function resolveOrganizationId(accessToken: string, fetchImpl: Fetcher): Promise<string | undefined> {
  const response = await fetchImpl(`${FACTORY_API}/api/cli/org`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    return undefined;
  }

  const parsed = await readJsonResponse(response, "organization membership");

  return firstOrganizationId(parsed);
}

async function resolveWhoami(
  accessToken: string,
  fetchImpl: Fetcher,
  organizationId?: string,
): Promise<{ accountId?: string; region?: string; apiEndpoint?: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };

  if (organizationId) {
    headers["X-Factory-Org-Id"] = organizationId;
  }

  const response = await fetchImpl(`${FACTORY_API}/api/cli/whoami`, {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    return {};
  }

  const parsed = await readJsonResponse(response, "whoami");

  return identityFromWhoami(parsed);
}

async function pollDeviceToken(
  authorization: DeviceAuthorization,
  callbacks: OAuthLoginCallbacks,
  fetchImpl: Fetcher,
): Promise<ParsedTokenResponse> {
  const timeoutSignal = AbortSignal.timeout(authorization.expiresInSeconds * 1000);
  const signal = callbacks.signal ? AbortSignal.any([callbacks.signal, timeoutSignal]) : timeoutSignal;
  let intervalSeconds = authorization.intervalSeconds;

  while (!signal.aborted) {
    callbacks.onProgress?.("Waiting for Factory browser login...");
    await delay(intervalSeconds * 1000, undefined, { signal });

    const response = await fetchImpl(WORKOS_TOKEN, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: DEVICE_CODE_GRANT,
        device_code: authorization.deviceCode,
        client_id: WORKOS_CLIENT_ID,
      }),
      signal,
    });
    const responseBody = await response.text();

    if (response.ok) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(responseBody);
      } catch (error) {
        throw new Error(`Factory OAuth device token returned invalid JSON: ${formatErrorDetails(error)}`);
      }

      return parseTokenResponse(parsed, "device token");
    }

    let errorCode = "unknown";
    try {
      const parsed: unknown = JSON.parse(responseBody);

      if (isRecord(parsed)) {
        errorCode = stringField(parsed, "error") ?? errorCode;
      }
    } catch {
      throw new Error(`Factory OAuth device token failed. status=${response.status}; body=${responseBody}`);
    }

    switch (errorCode) {
      case "authorization_pending":
        break;
      case "slow_down":
        intervalSeconds += 1;
        callbacks.onProgress?.(`Factory asked us to slow polling to ${intervalSeconds}s`);
        break;
      case "access_denied":
      case "expired_token":
        throw new Error("Factory OAuth authorization failed or expired");
      default:
        throw new Error(`Factory OAuth device token failed with ${errorCode}`);
    }
  }

  throw new Error(`Factory OAuth device login cancelled: ${signal.reason}`);
}

async function postRefreshToken(
  refreshToken: string,
  fetchImpl: Fetcher,
  fallbackRefreshToken: string,
  organizationId?: string,
): Promise<ParsedTokenResponse> {
  const response = await fetchImpl(WORKOS_TOKEN, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: WORKOS_CLIENT_ID,
      ...(organizationId ? { organization_id: organizationId } : {}),
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const parsed = await readJsonResponse(response, "refresh token");

  return parseTokenResponse(parsed, "refresh token", fallbackRefreshToken);
}

function toCredentials(parsed: ParsedTokenResponse, prior?: OAuthCredentials): OAuthCredentials {
  const accountId = orgIdFromAccessToken(parsed.accessToken);
  const email = parsed.email ?? emailFromAccessToken(parsed.accessToken) ?? prior?.email;
  const expires = parsed.expiresInSeconds
    ? Date.now() + parsed.expiresInSeconds * 1000 - TOKEN_EXPIRY_SKEW_MS
    : expiresFromAccessToken(parsed.accessToken) ?? Date.now() + 300 * 1000;

  return {
    refresh: parsed.refreshToken,
    access: parsed.accessToken,
    expires,
    accountId,
    email,
    apiEndpoint: parsed.apiEndpoint ?? prior?.apiEndpoint,
    projectId: prior?.projectId,
  };
}

function requireOrgScopedCredential(credentials: OAuthCredentials, requestedOrganizationId: string): void {
  const orgId = orgIdFromAccessToken(credentials.access);

  if (!orgId) {
    throw new Error(
      `Factory OAuth did not return an organization-scoped access token for ${requestedOrganizationId}; LLM calls would 403`,
    );
  }
}

async function loginWithBrowser(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
  const fetchImpl = callbacks.fetch ?? fetch;

  try {
    const authorization = await requestDeviceAuthorization(fetchImpl);
    callbacks.onAuth({
      url: authorization.verificationUriComplete,
      instructions: `Complete Factory login in your browser. If prompted, enter code ${authorization.userCode}.`,
    });
    callbacks.onProgress?.(`Factory device login code: ${authorization.userCode}`);

    const parsed = await pollDeviceToken(authorization, callbacks, fetchImpl);
    const credentials = toCredentials(parsed);
    const initialFactoryOrgId = orgIdFromAccessToken(credentials.access);

    if (initialFactoryOrgId) {
      const identity = await resolveWhoami(credentials.access, fetchImpl, initialFactoryOrgId);

      return {
        ...credentials,
        accountId: identity.accountId ?? initialFactoryOrgId,
        apiEndpoint: identity.apiEndpoint ?? credentials.apiEndpoint,
      };
    }

    const workosOrganizationId = await resolveOrganizationId(credentials.access, fetchImpl);

    if (!workosOrganizationId) {
      throw new Error("Factory OAuth login did not expose an organization id; LLM calls would 403");
    }

    const organizationParsed = await postRefreshToken(
      credentials.refresh,
      fetchImpl,
      credentials.refresh,
      workosOrganizationId,
    );

    const credentialsWithOrg = {
      ...toCredentials(organizationParsed, credentials),
      projectId: workosOrganizationId,
    };
    requireOrgScopedCredential(credentialsWithOrg, workosOrganizationId);
    const identity = await resolveWhoami(credentialsWithOrg.access, fetchImpl, credentialsWithOrg.accountId);

    return {
      ...credentialsWithOrg,
      accountId: identity.accountId ?? credentialsWithOrg.accountId,
      apiEndpoint: identity.apiEndpoint ?? credentialsWithOrg.apiEndpoint,
    };
  } catch (error) {
    throw new Error(`Factory OAuth device login failed: ${formatErrorDetails(error)}`);
  }
}

export async function login(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials | string> {
  const pasted = await callbacks.onPrompt({
    message: "Paste a Factory API key (fk-…) to use a key, or leave blank to log in with your browser",
    placeholder: "fk-...",
    allowEmpty: true,
  });
  const trimmed = pasted.trim();

  if (trimmed.startsWith("fk-")) {
    return trimmed;
  }

  if (trimmed.length > 0) {
    const retry = await callbacks.onPrompt({
      message:
        "That value does not start with fk-. Paste a Factory API key again, or leave blank to use the previous value as a raw bearer token.",
      placeholder: "fk-...",
      allowEmpty: true,
    });
    const retryTrimmed = retry.trim();

    return retryTrimmed || trimmed;
  }

  return loginWithBrowser(callbacks);
}

export async function refreshToken(credentials: OAuthCredentials): Promise<OAuthCredentials> {
  try {
    let workosOrganizationId = credentials.projectId;
    let parsed = await postRefreshToken(credentials.refresh, fetch, credentials.refresh, workosOrganizationId);
    let refreshed = {
      ...toCredentials(parsed, credentials),
      projectId: workosOrganizationId ?? credentials.projectId,
    };

    if (!orgIdFromAccessToken(refreshed.access)) {
      workosOrganizationId = workosOrganizationId ?? (await resolveOrganizationId(refreshed.access, fetch));

      if (!workosOrganizationId) {
        throw new Error("Factory OAuth refresh did not expose an organization id; run `/logout factory` and `/login factory`");
      }

      parsed = await postRefreshToken(refreshed.refresh, fetch, refreshed.refresh, workosOrganizationId);
      refreshed = {
        ...toCredentials(parsed, { ...credentials, ...refreshed, projectId: workosOrganizationId }),
        projectId: workosOrganizationId,
      };
      requireOrgScopedCredential(refreshed, workosOrganizationId);
    }

    const identity = await resolveWhoami(refreshed.access, fetch, refreshed.accountId);

    return {
      ...refreshed,
      accountId: identity.accountId ?? refreshed.accountId,
      apiEndpoint: identity.apiEndpoint ?? refreshed.apiEndpoint,
    };
  } catch (error) {
    throw new Error(`Factory OAuth token refresh failed: ${formatErrorDetails(error)}`);
  }
}

export function getApiKey(credentials: OAuthCredentials): string {
  return JSON.stringify({
    access: credentials.access,
    orgId: credentials.accountId ?? null,
    apiEndpoint: credentials.apiEndpoint ?? null,
  });
}
