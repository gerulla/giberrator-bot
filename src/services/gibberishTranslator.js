import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultPromptPath = path.resolve(__dirname, '../../prompts/ungibberish-system.txt');

const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const ollamaModel = process.env.OLLAMA_MODEL;
const ollamaTimeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? 30000);
const promptPath = process.env.UNGIBBERISH_PROMPT_PATH ?? defaultPromptPath;

if (!ollamaModel) {
  throw new Error('Missing OLLAMA_MODEL environment variable.');
}

let systemPromptPromise;

function getSystemPrompt() {
  systemPromptPromise ??= fs.readFile(promptPath, 'utf8');
  return systemPromptPromise;
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function extractJsonArray(text) {
  const trimmed = text.trim();

  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Some models still wrap JSON in surrounding text. Fall through and recover.
  }

  const start = trimmed.indexOf('[');
  const end = trimmed.lastIndexOf(']');

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`Ollama response did not contain a JSON array: ${trimmed}`);
  }

  const parsed = JSON.parse(trimmed.slice(start, end + 1));

  if (!Array.isArray(parsed)) {
    throw new Error('Ollama response JSON was not an array.');
  }

  return parsed;
}

function normalizeTranslations(value) {
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
}

export async function translateGibberish(text) {
  const input = text?.trim();

  if (!input) {
    return [];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ollamaTimeoutMs);

  try {
    const response = await fetch(`${normalizeBaseUrl(ollamaBaseUrl)}/api/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: ollamaModel,
        system: await getSystemPrompt(),
        prompt: input,
        stream: false,
        format: 'json',
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Ollama request failed with ${response.status}: ${body}`);
    }

    const data = await response.json();
    const translations = normalizeTranslations(extractJsonArray(data.response ?? ''));

    if (translations.length === 0) {
      throw new Error('Ollama returned an empty translation array.');
    }

    return translations;
  } finally {
    clearTimeout(timeout);
  }
}
