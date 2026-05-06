import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultPromptPath = path.resolve(__dirname, '../../prompts/ungibberish-system.txt');
const defaultInterpretPromptPath = path.resolve(__dirname, '../../prompts/ungibberish-interpret-system.txt');
const defaultReferencePath = path.resolve(__dirname, '../../prompts/ffxiv-reference.txt');

const ollamaBaseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const ollamaModel = process.env.OLLAMA_MODEL;
const ollamaTimeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS ?? 30000);
const promptPath = process.env.UNGIBBERISH_PROMPT_PATH ?? defaultPromptPath;
const interpretPromptPath =
  process.env.UNGIBBERISH_INTERPRET_PROMPT_PATH ?? defaultInterpretPromptPath;
const referencePath = process.env.UNGIBBERISH_REFERENCE_PATH ?? defaultReferencePath;
const translationSchema = {
  type: 'array',
  items: {
    type: 'string',
  },
  minItems: 1,
  maxItems: 3,
};

function log(scope, message, details) {
  const timestamp = new Date().toISOString();
  const suffix = details ? ` ${JSON.stringify(details)}` : '';
  console.log(`[${timestamp}] [${scope}] ${message}${suffix}`);
}

if (!ollamaModel) {
  throw new Error('Missing OLLAMA_MODEL environment variable.');
}

function createTranslationError(message, cause) {
  const error = new Error(message);
  error.name = 'TranslationError';
  error.cause = cause;
  return error;
}

const systemPromptPromises = new Map();

function getPromptPath(mode) {
  return mode === 'interpret' ? interpretPromptPath : promptPath;
}

async function buildSystemPrompt(mode) {
  const selectedPromptPath = getPromptPath(mode);
  log('translator', 'Loading translator prompt files', {
    mode,
    promptPath: selectedPromptPath,
    referencePath,
  });
  const [prompt, reference] = await Promise.all([
    fs.readFile(selectedPromptPath, 'utf8'),
    fs.readFile(referencePath, 'utf8').catch(() => ''),
  ]);

  log('translator', 'Loaded translator prompt files', {
    mode,
    promptLength: prompt.length,
    referenceLength: reference.length,
  });
  return reference.trim() ? `${prompt.trim()}\n\n${reference.trim()}\n` : prompt;
}

function getSystemPrompt(mode) {
  if (!systemPromptPromises.has(mode)) {
    systemPromptPromises.set(mode, buildSystemPrompt(mode));
  }

  return systemPromptPromises.get(mode);
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
  const mode = job?.mode === 'interpret' ? 'interpret' : 'translate';

  if (!input) {
    log('translator', 'Skipping translation because input was empty');
    return [];
  }

  log('translator', 'Starting translation request', {
    model: ollamaModel,
    mode,
    baseUrl: normalizeBaseUrl(ollamaBaseUrl),
    inputLength: input.length,
    historyCount: Array.isArray(job?.history) ? job.history.length : 0,
    targetAuthor: job?.message?.author?.username ?? null,
    targetMessageId: job?.message?.id ?? null,
  });

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
              content: await getSystemPrompt(mode),
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

    log('translator', 'Received Ollama HTTP response', {
      status: response.status,
      mode,
      targetMessageId: job?.message?.id ?? null,
    });

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

    log('translator', 'Completed translation request', {
      targetMessageId: job?.message?.id ?? null,
      mode,
      translationCount: translations.length,
    });

    return translations;
  } finally {
    clearTimeout(timeout);
  }
}
