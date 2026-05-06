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

async function notifyServiceChannel(message, content) {
  const serviceChannelId = getServiceChannel({ guildId: message.guildId });

  if (!serviceChannelId) {
    return;
  }

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
  const fetchedMessages = await message.channel.messages.fetch({ limit: historySize + 1 });

  return fetchedMessages
    .filter((entry) => entry.id !== message.id && !entry.author.bot)
    .sort((left, right) => left.createdTimestamp - right.createdTimestamp)
    .map((entry) => ({
      author: entry.author.username,
      content: describeMessage(entry),
    }))
    .slice(-historySize);
}

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

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

  if (!message.mentions.users.has(client.user.id) || !message.reference?.messageId) {
    return;
  }

  const referencedMessage = await message.fetchReference().catch((error) => {
    console.error(
      `Failed to fetch referenced message for trigger ${message.id} in guild ${message.guildId}:`,
      error,
    );
    return null;
  });

  if (!referencedMessage || referencedMessage.author.bot || !describeMessage(referencedMessage)) {
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
});

client.login(token);
