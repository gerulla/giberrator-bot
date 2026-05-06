import 'dotenv/config';
import { ChannelType, Client, Events, GatewayIntentBits } from 'discord.js';
import {
  getHistorySize,
  getServiceChannel,
  setHistorySize,
  setServiceChannel,
} from './database.js';
import { createTranslationQueue } from './services/translationQueue.js';

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error('Missing DISCORD_TOKEN environment variable.');
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

function log(scope, message, details) {
  const timestamp = new Date().toISOString();
  const suffix = details ? ` ${JSON.stringify(details)}` : '';
  console.log(`[${timestamp}] [${scope}] ${message}${suffix}`);
}

async function notifyServiceChannel(message, content) {
  const serviceChannelId = getServiceChannel({ guildId: message.guildId });

  if (!serviceChannelId) {
    log('service-channel', 'No service channel configured', {
      guildId: message.guildId,
      sourceMessageId: message.id,
    });
    return;
  }

  log('service-channel', 'Sending notification', {
    guildId: message.guildId,
    serviceChannelId,
    sourceMessageId: message.id,
  });

  const serviceChannel = await client.channels.fetch(serviceChannelId).catch((error) => {
    console.error(
      `Failed to fetch service channel ${serviceChannelId} for guild ${message.guildId}:`,
      error,
    );
    return null;
  });

  if (!serviceChannel?.isTextBased()) {
    return;
  }

  await serviceChannel.send({
    content,
    allowedMentions: { users: [], roles: [], repliedUser: false },
  });
}

const translationQueue = createTranslationQueue({
  notifyServiceChannel,
});

function describeMessage(message) {
  const parts = [];
  const content = message.content.trim();

  if (content) {
    parts.push(content);
  }

  for (const attachment of message.attachments.values()) {
    parts.push(attachment.url);
  }

  return parts.join('\n') || '[no text content]';
}

async function getMessageHistory(message) {
  const historySize = getHistorySize({ guildId: message.guildId });
  log('history', 'Fetching channel history', {
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: message.id,
    historySize,
  });
  const fetchedMessages = await message.channel.messages.fetch({ limit: historySize + 1 });

  const history = fetchedMessages
    .filter((entry) => entry.id !== message.id && !entry.author.bot)
    .sort((left, right) => left.createdTimestamp - right.createdTimestamp)
    .map((entry) => ({
      author: entry.author.username,
      content: describeMessage(entry),
    }))
    .slice(-historySize);

  log('history', 'Fetched channel history', {
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: message.id,
    fetchedCount: history.length,
  });

  return history;
}

client.once(Events.ClientReady, (readyClient) => {
  log('startup', 'Client ready', {
    userTag: readyClient.user.tag,
    userId: readyClient.user.id,
  });
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  log('interaction', 'Received chat input command', {
    commandName: interaction.commandName,
    guildId: interaction.guildId,
    userId: interaction.user.id,
  });

  if (interaction.commandName === 'ping') {
    await interaction.reply('Pong!');
    return;
  }

  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: 'This command can only be used in a server.',
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === 'servicechannel') {
    const channel = interaction.options.getChannel('channel', true);

    if (channel.type !== ChannelType.GuildText) {
      await interaction.reply({
        content: 'Please choose a regular text channel.',
        ephemeral: true,
      });
      return;
    }

    setServiceChannel({
      guildId: interaction.guildId,
      channelId: channel.id,
      setBy: interaction.user.id,
    });

    log('interaction', 'Updated service channel', {
      guildId: interaction.guildId,
      channelId: channel.id,
      setBy: interaction.user.id,
    });

    try {
      await channel.send(
        'Giberrator service channel test: I can send messages here.',
      );

      await interaction.reply({
        content: `Service channel set to ${channel}. Test message sent successfully.`,
        allowedMentions: { users: [], roles: [] },
        ephemeral: true,
      });
    } catch (error) {
      console.error(
        `Failed to send service channel test in guild ${interaction.guildId}, channel ${channel.id}:`,
        error,
      );

      await interaction.reply({
        content: `Service channel set to ${channel}, but I could not send the test message there. I will DM you the details.`,
        allowedMentions: { users: [], roles: [] },
        ephemeral: true,
      });

      try {
        await interaction.user.send(
          `I could not send the Giberrator service test message in ${channel} for ${interaction.guild.name}. Please check that I have View Channel and Send Messages permissions there.`,
        );
      } catch (dmError) {
        console.error(
          `Failed to DM service channel permission issue to user ${interaction.user.id}:`,
          dmError,
        );
      }
    }

    return;
  }

  if (interaction.commandName === 'sethistorysize') {
    const historySize = interaction.options.getInteger('size', true);

    setHistorySize({
      guildId: interaction.guildId,
      historySize,
    });

    log('interaction', 'Updated history size', {
      guildId: interaction.guildId,
      historySize,
      setBy: interaction.user.id,
    });

    await interaction.reply({
      content: `History size set to ${historySize} messages.`,
      ephemeral: true,
    });
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.inGuild() || message.author.bot) {
    return;
  }

  log('message', 'Received guild message', {
    guildId: message.guildId,
    channelId: message.channelId,
    messageId: message.id,
    authorId: message.author.id,
    isReply: Boolean(message.reference?.messageId),
    mentionsBot: message.mentions.users.has(client.user.id),
  });

  if (!message.mentions.users.has(client.user.id) || !message.reference?.messageId) {
    log('message', 'Ignoring message because trigger conditions were not met', {
      guildId: message.guildId,
      channelId: message.channelId,
      messageId: message.id,
    });
    return;
  }

  log('message', 'Trigger conditions met, fetching referenced message', {
    guildId: message.guildId,
    channelId: message.channelId,
    triggerMessageId: message.id,
    referencedMessageId: message.reference.messageId,
  });

  const referencedMessage = await message.fetchReference().catch((error) => {
    console.error(
      `Failed to fetch referenced message for trigger ${message.id} in guild ${message.guildId}:`,
      error,
    );
    return null;
  });

  if (!referencedMessage || referencedMessage.author.bot || !describeMessage(referencedMessage)) {
    log('message', 'Referenced message could not be processed', {
      guildId: message.guildId,
      channelId: message.channelId,
      triggerMessageId: message.id,
      referencedMessageFound: Boolean(referencedMessage),
      referencedAuthorIsBot: referencedMessage?.author?.bot ?? null,
    });
    return;
  }

  const history = await getMessageHistory(referencedMessage).catch((error) => {
    console.error(
      `Failed to fetch message history for message ${referencedMessage.id} in guild ${referencedMessage.guildId}:`,
      error,
    );
    return [];
  });

  translationQueue.enqueue({
    message: referencedMessage,
    history,
  });

  log('message', 'Queued referenced message for translation', {
    guildId: referencedMessage.guildId,
    channelId: referencedMessage.channelId,
    messageId: referencedMessage.id,
    authorId: referencedMessage.author.id,
    historyCount: history.length,
  });
});

client.login(token);
