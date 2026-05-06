import { translateGibberish } from './gibberishTranslator.js';

const defaultMaxQueueSize = Number(process.env.TRANSLATION_QUEUE_MAX_SIZE ?? 100);

function log(scope, message, details) {
  const timestamp = new Date().toISOString();
  const suffix = details ? ` ${JSON.stringify(details)}` : '';
  console.log(`[${timestamp}] [${scope}] ${message}${suffix}`);
}

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

async function withTyping(message, task) {
  const channel = message.channel;

  if (!channel?.sendTyping) {
    log('queue', 'Channel does not support typing indicator', {
      guildId: message.guildId,
      channelId: message.channelId,
      messageId: message.id,
    });
    return task();
  }

  log('queue', 'Starting typing indicator', {
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: message.id,
  });
  await channel.sendTyping().catch(() => {});

  const interval = setInterval(() => {
    void channel.sendTyping().catch(() => {});
  }, 8000);

  try {
    return await task();
  } finally {
    clearInterval(interval);
    log('queue', 'Stopped typing indicator', {
      guildId: message.guildId,
      channelId: message.channelId,
      messageId: message.id,
    });
  }
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
      log('queue', 'Queue processor already active', {
        queuedJobs: queue.length,
      });
      return;
    }

    isProcessing = true;
    log('queue', 'Queue processor started', {
      queuedJobs: queue.length,
    });

    try {
      while (queue.length > 0) {
        const job = queue.shift();
        log('queue', 'Dequeued translation job', {
          messageId: job.message.id,
          guildId: job.message.guildId,
          channelId: job.message.channelId,
          remainingJobs: queue.length,
          historyCount: job.history?.length ?? 0,
        });

        try {
          await notifyServiceChannel(job.message, truncateForNotification(formatProcessLog(job.message)));
          const translations = await withTyping(job.message, () => translator(job));

          if (translations.length === 0) {
            log('queue', 'Translator returned no translations', {
              messageId: job.message.id,
              guildId: job.message.guildId,
            });
            continue;
          }

          log('queue', 'Translator returned translations', {
            messageId: job.message.id,
            guildId: job.message.guildId,
            translationCount: translations.length,
          });

          await job.message.reply({
            content: formatTranslations(translations),
            allowedMentions: { repliedUser: false },
          });

          log('queue', 'Sent translation reply', {
            messageId: job.message.id,
            guildId: job.message.guildId,
            channelId: job.message.channelId,
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

          log('queue', 'Sent translation failure notification', {
            messageId: job.message.id,
            guildId: job.message.guildId,
          });
        }
      }
    } finally {
      isProcessing = false;
      log('queue', 'Queue processor stopped', {
        queuedJobs: queue.length,
      });
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
    log('queue', 'Enqueued translation job', {
      messageId: job.message.id,
      guildId: job.message.guildId,
      channelId: job.message.channelId,
      queuedJobs: queue.length,
      historyCount: job.history?.length ?? 0,
    });
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
