import type { ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";

import { FACTORY_MODELS, factoryModel, familyOf } from "./catalog";

const FACTORY_MODEL_DOCS_URL = "https://docs.factory.ai/models.md";

export type FactoryModelDocsSection = "anthropic" | "openai" | "core";

export type FactoryModelDocsEntry = {
  id: string;
  displayName: string;
  section: FactoryModelDocsSection;
  reasoning: string;
};

function sectionForHeading(line: string): FactoryModelDocsSection | null {
  if (line.includes(">Anthropic</span>")) {
    return "anthropic";
  }

  if (line.includes(">OpenAI</span>")) {
    return "openai";
  }

  if (line.includes(">Droid Core (Open Models)</span>")) {
    return "core";
  }

  return null;
}

function stripDocsMarkup(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/\\(.)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseFactoryModelDocs(markdown: string): FactoryModelDocsEntry[] {
  const entries: FactoryModelDocsEntry[] = [];
  let section: FactoryModelDocsSection | null = null;

  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();

    if (line.startsWith("## ")) {
      section = sectionForHeading(line);
      continue;
    }

    if (section === null || !line.startsWith("|")) {
      continue;
    }

    const cells = line.split("|").map((cell) => cell.trim());
    if (cells.length < 4) {
      continue;
    }

    const displayCell = cells[1] ?? "";
    const idMatch = (cells[2] ?? "").match(/`([^`]+)`/);
    if (!idMatch) {
      continue;
    }

    const id = idMatch[1].trim();
    if (id.length === 0 || displayCell.includes("\u2020") || familyOf(id) === "unsupported") {
      continue;
    }

    entries.push({
      id,
      displayName: stripDocsMarkup(displayCell),
      section,
      reasoning: cells[4] ?? "",
    });
  }

  return entries;
}

function docsEntryToModel(entry: FactoryModelDocsEntry): ProviderModelConfig | null {
  switch (familyOf(entry.id)) {
    case "anthropic":
      return factoryModel({
        id: entry.id,
        name: `${entry.displayName} (Factory)`,
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 200000,
        maxTokens: 64000,
      });
    case "openai-responses":
      return factoryModel({
        id: entry.id,
        name: `${entry.displayName} (Factory)`,
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 400000,
        maxTokens: 128000,
      });
    case "openai-completions":
      return factoryModel({
        id: entry.id,
        name: `${entry.displayName} (Factory Core)`,
        reasoning: true,
        input: ["text"],
        contextWindow: 200000,
        maxTokens: 32000,
      });
    case "unsupported":
      return null;
  }
}

function mergeDocsModels(entries: FactoryModelDocsEntry[]): ProviderModelConfig[] {
  const merged: ProviderModelConfig[] = [...FACTORY_MODELS];
  const seen = new Set<string>(merged.map((model) => model.id));

  for (const entry of entries) {
    if (seen.has(entry.id)) {
      continue;
    }

    const model = docsEntryToModel(entry);
    if (!model) {
      continue;
    }

    merged.push(model);
    seen.add(entry.id);
  }

  return merged;
}

export async function fetchFactoryDynamicModels(_apiKey?: string): Promise<readonly ProviderModelConfig[]> {
  let markdown: string;

  try {
    const response = await fetch(FACTORY_MODEL_DOCS_URL, {
      headers: { Accept: "text/markdown,text/plain;q=0.9,*/*;q=0.1" },
    });

    if (!response.ok) {
      return FACTORY_MODELS;
    }

    markdown = await response.text();
  } catch {
    return FACTORY_MODELS;
  }

  const entries = parseFactoryModelDocs(markdown);
  if (entries.length === 0) {
    return FACTORY_MODELS;
  }

  const merged = mergeDocsModels(entries);
  if (merged.length === 0) {
    return FACTORY_MODELS;
  }

  return merged;
}
