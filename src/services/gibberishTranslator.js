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
const ollamaImageSummaryModel = process.env.OLLAMA_IMAGE_SUMMARY_MODEL ?? 'nemotron3:33b';
const ollamaImageSummaryTimeoutMs = Number(process.env.OLLAMA_IMAGE_SUMMARY_TIMEOUT_MS ?? 120000);
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
  return mode === 'translate' ? promptPath : interpretPromptPath;
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

function getImageAttachments(message) {
  const attachments = Array.from(message?.attachments?.values?.() ?? []);

  return attachments.filter((attachment) => {
    if (attachment.contentType?.startsWith('image/')) {
      return true;
    }

    return /\.(png|jpe?g|gif|webp|bmp)$/i.test(attachment.name ?? attachment.url ?? '');
  });
}

function extractUrls(text) {
  return text.match(/https?:\/\/\S+/gi) ?? [];
}

function normalizeSocialPostUrl(rawUrl) {
  let parsed;

  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase();

  if (hostname === 'x.com' || hostname === 'www.x.com' ||
      hostname === 'twitter.com' || hostname === 'www.twitter.com') {
    parsed.hostname = 'vxtwitter.com';
    return parsed.toString();
  }

  if (hostname === 'vxtwitter.com' || hostname === 'www.vxtwitter.com') {
    return parsed.toString();
  }

  return null;
}

function extractMetaImageUrls(html) {
  const imageUrls = [];
  const metaPattern = /<meta\s+(?:property|name)=["'](?:og:image|twitter:image(?:\:src)?)["']\s+content=["']([^"']+)["'][^>]*>/gi;

  let match;
  while ((match = metaPattern.exec(html)) !== null) {
    imageUrls.push(match[1]);
  }

  return imageUrls;
}

async function resolveSocialImageUrls(message) {
  const normalizedUrls = extractUrls(message?.content ?? '')
    .map((url) => normalizeSocialPostUrl(url))
    .filter(Boolean);

  if (normalizedUrls.length === 0) {
    return [];
  }

  const imageUrlSets = await Promise.all(
    normalizedUrls.map(async (url) => {
      log('translator', 'Resolving social image link', {
        targetMessageId: message?.id ?? null,
        url,
      });

      try {
        const response = await fetch(url, {
          headers: {
            'User-Agent': 'Giberrator/1.0 (+https://github.com/)',
          },
        });

        if (!response.ok) {
          log('translator', 'Failed to fetch social page', {
            targetMessageId: message?.id ?? null,
            url,
            status: response.status,
          });
          return [];
        }

        const html = await response.text();
        return extractMetaImageUrls(html);
      } catch (error) {
        log('translator', 'Failed to resolve social image link', {
          targetMessageId: message?.id ?? null,
          url,
          error: error.message,
        });
        return [];
      }
    }),
  );

  return imageUrlSets
    .flat()
    .filter((url, index, urls) => urls.indexOf(url) === index);
}

async function fetchImageAsBase64(url) {
  const response = await fetch(url);

  if (!response.ok) {
    throw createTranslationError(`Failed to fetch image attachment: ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  return bytes.toString('base64');
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

async function summarizeImages(job) {
  const imageAttachments = getImageAttachments(job?.message);
  const socialImageUrls = await resolveSocialImageUrls(job?.message);
  const totalImageCount = imageAttachments.length + socialImageUrls.length;

  if (totalImageCount === 0) {
    return null;
  }

  log('translator', 'Starting image summary request', {
    model: ollamaImageSummaryModel,
    imageCount: totalImageCount,
    attachmentCount: imageAttachments.length,
    socialImageCount: socialImageUrls.length,
    targetMessageId: job?.message?.id ?? null,
  });

  const encodedImages = await Promise.all(
    [
      ...imageAttachments.map((attachment) => attachment.url),
      ...socialImageUrls,
    ].map((url) => fetchImageAsBase64(url)),
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ollamaImageSummaryTimeoutMs);

  try {
    let response;

    try {
      response = await fetch(`${normalizeBaseUrl(ollamaBaseUrl)}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: ollamaImageSummaryModel,
          messages: [
            {
              role: 'user',
              content:
                'Summarize these Discord image attachments in one concise paragraph. Focus on what is visibly happening, any text shown in the image, and details that would help interpret the sender\'s intended meaning.',
              images: encodedImages,
            },
          ],
          stream: false,
          options: {
            temperature: 0,
          },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (error.name === 'AbortError') {
        throw createTranslationError(
          `Image summary request timed out after ${ollamaImageSummaryTimeoutMs}ms.`,
          error,
        );
      }

      throw createTranslationError(
        `Failed to connect to Ollama image model at ${normalizeBaseUrl(ollamaBaseUrl)}.`,
        error,
      );
    }

    if (!response.ok) {
      const body = await response.text();
      throw createTranslationError(
        `Ollama image summary request failed with ${response.status}: ${body}`,
      );
    }

    const data = await response.json();
    const summary = data.message?.content?.trim() ?? '';

    if (!summary) {
      throw createTranslationError('Ollama image summary response was empty.');
    }

    log('translator', 'Completed image summary request', {
      targetMessageId: job?.message?.id ?? null,
      imageCount: totalImageCount,
      summaryLength: summary.length,
    });

    return summary;
  } finally {
    clearTimeout(timeout);
  }
}

function buildUserPrompt(job) {
  if (typeof job === 'string') {
    return job.trim();
  }

  const targetMessage = job?.message?.content?.trim();
  const imageSummary = job?.imageSummary?.trim();

  if (!targetMessage && !imageSummary) {
    return '';
  }

  const history = Array.isArray(job.history) ? job.history : [];
  const payload = {
    instructions: 'Translate only the target message. Use the history only as context for meaning.',
    history,
    target_message: {
      author: job.message.author?.username ?? 'Unknown',
      content: targetMessage ?? '',
    },
  };

  if (imageSummary) {
    payload.image_summary = imageSummary;
  }

  return JSON.stringify(payload);
}

export async function translateGibberish(job) {
  const enrichedJob = typeof job === 'string'
    ? job
    : {
        ...job,
        imageSummary: await summarizeImages(job),
      };
  const input = buildUserPrompt(enrichedJob);
  const mode = job?.mode === 'translate' ? 'translate' : 'interpret';

  if (!input) {
    log('translator', 'Skipping translation because input was empty');
    return [];
  }

  log('translator', 'Starting translation request', {
    model: ollamaModel,
    mode,
    baseUrl: normalizeBaseUrl(ollamaBaseUrl),
    inputLength: input.length,
    hasImageSummary: Boolean(enrichedJob?.imageSummary),
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
