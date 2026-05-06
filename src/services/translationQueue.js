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

export function createTranslationQueue({
  translator = translateGibberish,
  maxQueueSize = defaultMaxQueueSize,
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
          const translations = await translator(job.message.content);

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
        }
      }
    } finally {
      isProcessing = false;
    }
  }

  function enqueue(message) {
    if (queue.length >= maxQueueSize) {
      console.warn(
        `Translation queue is full. Dropping message ${message.id} in guild ${message.guildId}.`,
      );
      return false;
    }

    queue.push({ message });
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
