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

function createTranslationError(message, cause) {
  const error = new Error(message);
  error.name = 'TranslationError';
  error.cause = cause;
  return error;
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
    throw createTranslationError(
      `Ollama response did not contain a JSON array: ${trimmed}`,
    );
  }

  let parsed;

  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1));
  } catch (error) {
    throw createTranslationError('Failed to parse JSON array from Ollama response.', error);
  }

  if (!Array.isArray(parsed)) {
    throw createTranslationError('Ollama response JSON was not an array.');
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
    let response;

    try {
      response = await fetch(`${normalizeBaseUrl(ollamaBaseUrl)}/api/generate`, {
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
    } catch (error) {
      if (error.name === 'AbortError') {
        throw createTranslationError(
          `Ollama request timed out after ${ollamaTimeoutMs}ms.`,
          error,
        );
      }

      throw createTranslationError(
        `Failed to connect to Ollama at ${normalizeBaseUrl(ollamaBaseUrl)}.`,
        error,
      );
    }

    if (!response.ok) {
      const body = await response.text();
      throw createTranslationError(
        `Ollama request failed with ${response.status}: ${body}`,
      );
    }

    let data;

    try {
      data = await response.json();
    } catch (error) {
      throw createTranslationError('Failed to parse Ollama HTTP response as JSON.', error);
    }

    const translations = normalizeTranslations(extractJsonArray(data.response ?? ''));

    if (translations.length === 0) {
      throw createTranslationError('Ollama returned an empty translation array.');
    }

    return translations;
  } finally {
    clearTimeout(timeout);
  }
}
