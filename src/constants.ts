type ProcessLike = {
  env?: Record<string, string | undefined>;
};

type GlobalWithProcess = typeof globalThis & {
  process?: ProcessLike;
};

const runtimeGlobal: GlobalWithProcess = globalThis;
const FACTORY_API_KEY_ENV = "FACTORY_API_KEY";
const FACTORY_ORG_ID_ENV = "FACTORY_ORG_ID";
const FACTORY_ORGANIZATION_ID_ENV = "FACTORY_ORGANIZATION_ID";
const factoryApiBase = runtimeGlobal.process?.env?.FACTORY_API_BASE?.trim().replace(/\/+$/, "");
const factoryApiKeyPresent = (runtimeGlobal.process?.env?.[FACTORY_API_KEY_ENV]?.length ?? 0) > 0;
const factoryUpstreamClientType = runtimeGlobal.process?.env?.FACTORY_UPSTREAM_CLIENT_TYPE?.trim() || "cli";
const factoryOrgId =
  runtimeGlobal.process?.env?.[FACTORY_ORG_ID_ENV]?.trim() ??
  runtimeGlobal.process?.env?.[FACTORY_ORGANIZATION_ID_ENV]?.trim();

export const FACTORY_API = factoryApiBase ?? "https://api.factory.ai";
export const FACTORY_API_BASE_OVERRIDDEN = !!factoryApiBase;
export const FACTORY_API_KEY = factoryApiKeyPresent ? FACTORY_API_KEY_ENV : undefined;
export const FACTORY_ORG_ID = factoryOrgId && factoryOrgId.length > 0 ? factoryOrgId : null;
export const ANTHROPIC_BASE = `${FACTORY_API}/api/llm/a`;
export const OPENAI_BASE = `${FACTORY_API}/api/llm/o/v1`;

export function factoryApiForRegion(region: string | undefined): string {
  if (!region || region === "global") {
    return FACTORY_API;
  }

  if (region.startsWith("http://") || region.startsWith("https://")) {
    return region;
  }

  if (region === "eu" || region === "europe") {
    return "https://api.eu.factory.ai";
  }

  return `https://api.${region}.factory.ai`;
}
export const FACTORY_CLIENT_VERSION = "0.153.1";
export const FACTORY_HEADERS = {
  "X-Factory-Client": factoryUpstreamClientType,
  "X-Client-Version": FACTORY_CLIENT_VERSION,
  "User-Agent": `factory-cli/${FACTORY_CLIENT_VERSION}`,
};
export const FACTORY_OPENAI_PLATFORM_ORG = "org-bHuLtG1fGmYk5YaOihAAXFBw";
export const ANTHROPIC_VERSION = "2023-06-01";
export const WORKOS_DEVICE_AUTHORIZE = "https://api.workos.com/user_management/authorize/device";
export const WORKOS_TOKEN = "https://api.workos.com/user_management/authenticate";
export const WORKOS_CLIENT_ID = "client_01HNM792M5G5G1A2THWPXKFMXB";
export const PROVIDER_ID = "factory";
export const CUSTOM_API = "factory";
