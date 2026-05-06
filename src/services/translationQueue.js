import { translateGibberish } from './gibberishTranslator.js';

const defaultMaxQueueSize = Number(process.env.TRANSLATION_QUEUE_MAX_SIZE ?? 100);

function formatTranslations(translations) {
  if (translations.length === 1) {
    return translations[0];
  }

  return translations
    .map((translation, index) => `${index + 1}. ${translation}`)
    .join('\n');
}

function truncateForNotification(text, maxLength = 1500) {
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 3)}...`;
}

function describeMessage(message) {
  const parts = [];
  const content = message.content.trim();

  if (content) {
    parts.push(content);
  }

  for (const attachment of message.attachments?.values?.() ?? []) {
    parts.push(attachment.url);
  }

  return parts.join('\n') || '[no text content]';
}

function formatProcessLog(message) {
  return `Ungibberizing ${message.author.username}'s message: ${describeMessage(message)}`;
}

function formatTranslationError(message, error) {
  return [
    `Ungibberizing failed for ${message.author.username}'s message: ${describeMessage(message)}`,
    `Error: ${error.message}`,
  ].join('\n');
}

export function createTranslationQueue({
  translator = translateGibberish,
  maxQueueSize = defaultMaxQueueSize,
  notifyServiceChannel = async () => {},
} = {}) {
  const queue = [];
  let isProcessing = false;

  async function processNext() {
    if (isProcessing) {
      return;
    }

    isProcessing = true;

    try {
      while (queue.length > 0) {
        const job = queue.shift();

        try {
          await notifyServiceChannel(job.message, truncateForNotification(formatProcessLog(job.message)));
          const translations = await translator(job);

          if (translations.length === 0) {
            continue;
          }

          await job.message.reply({
            content: formatTranslations(translations),
            allowedMentions: { repliedUser: false },
          });
        } catch (error) {
          console.error(
            `Failed to translate message ${job.message.id} in guild ${job.message.guildId}:`,
            error,
          );

          await notifyServiceChannel(
            job.message,
            truncateForNotification(formatTranslationError(job.message, error)),
          );
        }
      }
    } finally {
      isProcessing = false;
    }
  }

  function enqueue(job) {
    if (queue.length >= maxQueueSize) {
      console.warn(
        `Translation queue is full. Dropping message ${job.message.id} in guild ${job.message.guildId}.`,
      );
      return false;
    }

    queue.push(job);
    void processNext();
    return true;
  }

  function size() {
    return queue.length;
  }

  return {
    enqueue,
    size,
  };
}
