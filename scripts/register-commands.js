import 'dotenv/config';
import { PermissionFlagsBits, REST, Routes, SlashCommandBuilder } from 'discord.js';

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
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
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
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
  new SlashCommandBuilder()
    .setName('users')
    .setDescription('Lists users currently on the un-gibberize list.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .toJSON(),
];

const rest = new REST({ version: '10' }).setToken(token);
const route = guildId
  ? Routes.applicationGuildCommands(clientId, guildId)
  : Routes.applicationCommands(clientId);

await rest.put(route, { body: commands });

console.log(
  guildId
    ? `Registered /ping for guild ${guildId}.`
    : 'Registered /ping globally.',
);
