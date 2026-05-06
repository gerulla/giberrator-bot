import 'dotenv/config';
import { ChannelType, Client, Events, GatewayIntentBits } from 'discord.js';
import {
  addTrackedUser,
  getServiceChannel,
  isTrackedUser,
  listTrackedUsers,
  removeTrackedUser,
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

const translationQueue = createTranslationQueue();

function formatMessageForResend(message) {
  const parts = [];
  const content = message.content.trim();

  if (content) {
    parts.push(content);
  }

  for (const attachment of message.attachments.values()) {
    parts.push(attachment.url);
  }

  return parts.join('\n');
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

  if (interaction.commandName === 'adduser') {
    const user = interaction.options.getUser('user', true);
    const wasAdded = addTrackedUser({
      guildId: interaction.guildId,
      userId: user.id,
      createdBy: interaction.user.id,
    });

    await interaction.reply({
      content: wasAdded
        ? `Added ${user} to the un-gibberize list.`
        : `${user} is already on the un-gibberize list.`,
      allowedMentions: { users: [] },
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === 'removeuser') {
    const user = interaction.options.getUser('user', true);
    const wasRemoved = removeTrackedUser({
      guildId: interaction.guildId,
      userId: user.id,
    });

    await interaction.reply({
      content: wasRemoved
        ? `Removed ${user} from the un-gibberize list.`
        : `${user} was not on the un-gibberize list.`,
      allowedMentions: { users: [] },
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === 'users') {
    const userIds = listTrackedUsers({ guildId: interaction.guildId });
    const content = userIds.length > 0
      ? `Un-gibberize list:\n${userIds.map((userId) => `- <@${userId}>`).join('\n')}`
      : 'No users are currently on the un-gibberize list.';

    await interaction.reply({
      content,
      allowedMentions: { users: [] },
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
  }
});

client.on(Events.MessageCreate, (message) => {
  if (!message.inGuild() || message.author.bot) {
    return;
  }

  const serviceChannelId = getServiceChannel({ guildId: message.guildId });

  if (serviceChannelId === message.channelId) {
    const content = formatMessageForResend(message);

    if (content) {
      void message.channel.send({
        content,
        allowedMentions: { users: [], roles: [], repliedUser: false },
      });
    }

    return;
  }

  if (!message.content.trim()) {
    return;
  }

  const shouldTranslate = isTrackedUser({
    guildId: message.guildId,
    userId: message.author.id,
  });

  if (!shouldTranslate) {
    return;
  }

  translationQueue.enqueue(message);
});

client.login(token);
