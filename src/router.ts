import type { ProviderConfig } from "@oh-my-pi/pi-coding-agent";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import type { Api, Model, ModelSpec } from "@oh-my-pi/pi-catalog/types";
import { createProviderErrorMessage } from "@oh-my-pi/pi-ai/providers/error-message";
import { streamSimple } from "@oh-my-pi/pi-ai/stream";
import { AssistantMessageEventStream } from "@oh-my-pi/pi-ai/utils/event-stream";
import type { Context } from "@oh-my-pi/pi-ai/types";

import { familyOf } from "./catalog";
import {
  ANTHROPIC_VERSION,
  FACTORY_API,
  FACTORY_API_BASE_OVERRIDDEN,
  FACTORY_HEADERS,
  FACTORY_OPENAI_PLATFORM_ORG,
  FACTORY_ORG_ID,
  PROVIDER_ID,
} from "./constants";

type FactoryTargetApi = "anthropic-messages" | "openai-responses" | "openai-completions";

type ParsedCredential = {
  access?: string;
  orgId: string | null;
  apiEndpoint: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
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
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;

  return atob(padded);
}

function orgIdFromAccessToken(accessToken: string): string | null {
  const [, payloadSegment] = accessToken.split(".");

  if (!payloadSegment) {
    return null;
  }

  try {
    const payload: unknown = JSON.parse(decodeBase64Url(payloadSegment));

    if (!isRecord(payload)) {
      return null;
    }

    return (
      firstStringField(payload, ["external_org_id", "org_id", "organization_id", "organizationId", "orgId"]) ?? null
    );
  } catch {
    return null;
  }
}

function parseCredential(raw: string | undefined): ParsedCredential {
  if (!raw) {
    return { orgId: null, apiEndpoint: null };
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (isRecord(parsed) && typeof parsed.access === "string" && parsed.access.length > 0) {
      const parsedOrgId = typeof parsed.orgId === "string" && parsed.orgId.length > 0 ? parsed.orgId : null;

      return {
        access: parsed.access,
        orgId: parsedOrgId ?? orgIdFromAccessToken(parsed.access),
        apiEndpoint: typeof parsed.apiEndpoint === "string" && parsed.apiEndpoint.length > 0 ? parsed.apiEndpoint : null,
      };
    }
  } catch {
    return {
      access: raw,
      orgId: orgIdFromAccessToken(raw),
      apiEndpoint: null,
    };
  }
  return {
    access: raw,
    orgId: orgIdFromAccessToken(raw),
    apiEndpoint: null,
  };
}

function errorStream(model: Model<Api>, message: string): AssistantMessageEventStream {
  const stream = new AssistantMessageEventStream();
  const error = createProviderErrorMessage(model, new Error(message));
  stream.push({ type: "error", reason: "error", error });

  return stream;
}

function targetApiFor(modelId: string): FactoryTargetApi | null {
  const family = familyOf(modelId);

  switch (family) {
    case "anthropic":
      return "anthropic-messages";
    case "openai-responses":
      return "openai-responses";
    case "openai-completions":
      return "openai-completions";
    case "unsupported":
      return null;
  }
}

function proxyApiProviderFor(targetApi: FactoryTargetApi): string {
  switch (targetApi) {
    case "anthropic-messages":
      return "anthropic";
    case "openai-responses":
      return "openai";
    case "openai-completions":
      return "factory";
  }
}

function randomHeaderId(prefix: string): string {
  return globalThis.crypto?.randomUUID?.() ?? `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function buildRequestHeaders(options: Parameters<NonNullable<ProviderConfig["streamSimple"]>>[2]): Record<string, string> {
  return {
    "x-session-id": options?.sessionId ?? randomHeaderId("session"),
    "x-assistant-message-id": randomHeaderId("assistant"),
  };
}

function foldSystemPromptForFactoryAnthropic(context: Context): Context {
  const systemText = context.systemPrompt?.filter((part) => part.length > 0).join("\n\n");

  if (!systemText) {
    return context;
  }

  const systemPreamble = `<system>\n${systemText}\n</system>\n\n`;
  const [firstMessage, ...restMessages] = context.messages;

  if (firstMessage?.role === "user") {
    const content =
      typeof firstMessage.content === "string"
        ? `${systemPreamble}${firstMessage.content}`
        : [{ type: "text" as const, text: systemPreamble }, ...firstMessage.content];

    return {
      ...context,
      systemPrompt: undefined,
      messages: [{ ...firstMessage, content }, ...restMessages],
    };
  }

  return {
    ...context,
    systemPrompt: undefined,
    messages: [
      {
        role: "user",
        content: systemPreamble,
        synthetic: true,
        timestamp: Date.now(),
      },
      ...context.messages,
    ],
  };
}

function buildTargetModel(
  model: Model<Api>,
  targetApi: FactoryTargetApi,
  orgId: string | null,
  apiEndpoint: string,
): Model<FactoryTargetApi> {
  const isAnthropic = targetApi === "anthropic-messages";
  const baseUrl = isAnthropic ? `${apiEndpoint}/api/llm/a` : `${apiEndpoint}/api/llm/o/v1`;
  const headers: Record<string, string> = { ...FACTORY_HEADERS, "x-api-provider": proxyApiProviderFor(targetApi) };

  if (isAnthropic) {
    headers["anthropic-version"] = ANTHROPIC_VERSION;
  }

  if (targetApi === "openai-responses") {
    headers["OpenAI-Platform"] = FACTORY_OPENAI_PLATFORM_ORG;
  }

  if (orgId) {
    headers["X-Factory-Org-Id"] = orgId;
  }

  const spec: ModelSpec<FactoryTargetApi> = {
    provider: PROVIDER_ID,
    id: model.id,
    name: model.name,
    api: targetApi,
    baseUrl,
    reasoning: model.reasoning,
    input: model.input,
    cost: model.cost,
    premiumMultiplier: model.premiumMultiplier,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    thinking: model.thinking,
    headers,
  };

  return buildModel(spec);
}

export const factoryStreamSimple: NonNullable<ProviderConfig["streamSimple"]> = (model, context, options) => {
  const rawApiKey = typeof options?.apiKey === "string" ? options.apiKey : undefined;
  const credential = parseCredential(rawApiKey);

  if (!credential.access) {
    return errorStream(model, "factory: no Factory credential; run `/login factory`");
  }

  const targetApi = targetApiFor(model.id);

  if (!targetApi) {
    return errorStream(model, `factory: model ${model.id} is not supported in v1 (Gemini/other)`);
  }

  try {
    const apiEndpoint = FACTORY_API_BASE_OVERRIDDEN ? FACTORY_API : credential.apiEndpoint ?? FACTORY_API;
    const target = buildTargetModel(model, targetApi, credential.orgId ?? FACTORY_ORG_ID, apiEndpoint);

    const routedContext = targetApi === "anthropic-messages" ? foldSystemPromptForFactoryAnthropic(context) : context;

    return streamSimple(target, routedContext, {
      ...options,
      apiKey: credential.access,
      headers: {
        ...buildRequestHeaders(options),
        ...(options?.headers ?? {}),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return errorStream(model, `factory: failed to route model ${model.id}: ${message}`);
  }
};
