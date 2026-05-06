import 'dotenv/config';
import { Client, Events, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { addTrackedUser, listTrackedUsers, removeTrackedUser } from './database.js';

const token = process.env.DISCORD_TOKEN;

if (!token) {
  throw new Error('Missing DISCORD_TOKEN environment variable.');
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

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

  if (!interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: 'You need the Manage Server permission to manage tracked users.',
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
  }
});

client.login(token);
