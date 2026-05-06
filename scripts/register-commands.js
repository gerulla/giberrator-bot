import 'dotenv/config';
import { ChannelType, REST, Routes, SlashCommandBuilder } from 'discord.js';

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token) {
  throw new Error('Missing DISCORD_TOKEN environment variable.');
}

if (!clientId) {
  throw new Error('Missing DISCORD_CLIENT_ID environment variable.');
}

const commands = [
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('Replies with Pong!')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('adduser')
    .setDescription('Adds a user to the un-gibberize list.')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The user whose messages should be un-gibberized.')
        .setRequired(true),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('removeuser')
    .setDescription('Removes a user from the un-gibberize list.')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('The user whose messages should no longer be un-gibberized.')
        .setRequired(true),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('users')
    .setDescription('Lists users currently on the un-gibberize list.')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('servicechannel')
    .setDescription('Sets the channel Giberrator uses for service messages.')
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('The service text channel.')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName('sethistorysize')
    .setDescription('Sets how many previous channel messages are sent as translation context.')
    .addIntegerOption((option) =>
      option
        .setName('size')
        .setDescription('How many previous messages to include as context.')
        .setMinValue(1)
        .setMaxValue(50)
        .setRequired(true),
    )
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(token);
const route = guildId
  ? Routes.applicationGuildCommands(clientId, guildId)
  : Routes.applicationCommands(clientId);
const commandNames = commands.map((command) => `/${command.name}`).join(', ');

console.log(
  guildId
    ? `Registering guild commands for guild ${guildId}: ${commandNames}`
    : `Registering global commands: ${commandNames}`,
);

await rest.put(route, { body: commands });

const registeredCommands = await rest.get(route);
const registeredCommandNames = registeredCommands
  .map((command) => `/${command.name}`)
  .join(', ');

console.log(
  guildId
    ? `Discord reports guild commands for ${guildId}: ${registeredCommandNames}`
    : `Discord reports global commands: ${registeredCommandNames}`,
);

if (!guildId) {
  console.warn(
    'DISCORD_GUILD_ID is not set. Global command updates can take a while to appear in Discord.',
  );
}
