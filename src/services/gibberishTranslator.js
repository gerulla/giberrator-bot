import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultPromptPath = path.resolve(__dirname, '../../prompts/ungibberish-system.txt');
const defaultReferencePath = path.resolve(__dirname, '../../prompts/ffxiv-reference.txt');

const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const ollamaModel = process.env.OLLAMA_MODEL;
const ollamaTimeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? 30000);
const promptPath = process.env.UNGIBBERISH_PROMPT_PATH ?? defaultPromptPath;
const referencePath = process.env.UNGIBBERISH_REFERENCE_PATH ?? defaultReferencePath;
const translationSchema = {
  type: 'array',
  items: {
    type: 'string',
  },
  minItems: 1,
  maxItems: 3,
};

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

async function buildSystemPrompt() {
  const [prompt, reference] = await Promise.all([
    fs.readFile(promptPath, 'utf8'),
    fs.readFile(referencePath, 'utf8').catch(() => ''),
  ]);

  return reference.trim() ? `${prompt.trim()}\n\n${reference.trim()}\n` : prompt;
}

function getSystemPrompt() {
  systemPromptPromise ??= buildSystemPrompt();
  return systemPromptPromise;
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
}

function extractQuotedStrings(text) {
  const matches = text.match(/"([^"\\]*(?:\\.[^"\\]*)*)"/g) ?? [];
  return matches
    .map((match) => {
      try {
        return JSON.parse(match);
      } catch {
        return match.slice(1, -1);
      }
    })
    .filter(Boolean);
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
    const salvage = extractQuotedStrings(trimmed);

    if (salvage.length > 0) {
      return salvage;
    }

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
    .filter((item) => item.length > 0)
    .filter((item) => /[A-Za-z0-9]/.test(item))
    .filter((item, index, items) => items.indexOf(item) === index)
    .slice(0, 3);
}

function buildUserPrompt(job) {
  if (typeof job === 'string') {
    return job.trim();
  }

  const targetMessage = job?.message?.content?.trim();

  if (!targetMessage) {
    return '';
  }

  const history = Array.isArray(job.history) ? job.history : [];
  const payload = {
    instructions: 'Translate only the target message. Use the history only as context for meaning.',
    history,
    target_message: {
      author: job.message.author?.username ?? 'Unknown',
      content: targetMessage,
    },
  };

  return JSON.stringify(payload);
}

export async function translateGibberish(job) {
  const input = buildUserPrompt(job);

  if (!input) {
    return [];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ollamaTimeoutMs);

  try {
    let response;

    try {
      response = await fetch(`${normalizeBaseUrl(ollamaBaseUrl)}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: ollamaModel,
          messages: [
            {
              role: 'system',
              content: await getSystemPrompt(),
            },
            {
              role: 'user',
              content: input,
            },
          ],
          stream: false,
          format: translationSchema,
          options: {
            temperature: 0,
          },
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

    const rawContent = data.message?.content ?? data.response ?? '';
    const translations = normalizeTranslations(extractJsonArray(rawContent));

    if (translations.length === 0) {
      throw createTranslationError('Ollama returned an empty translation array.');
    }

    return translations;
  } finally {
    clearTimeout(timeout);
  }
}
