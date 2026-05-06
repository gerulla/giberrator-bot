# Giberrator

Giberrator is a Discord bot that turns messy, typo-heavy, or otherwise gibberish messages into normal readable text.

The goal is simple: when someone sends a message that is hard to understand, Giberrator helps translate it into a cleaner version so the conversation can keep moving.

## What It Does

- Translates gibberish messages into readable text
- Helps clarify typo-heavy or chaotic Discord messages
- Makes confusing messages easier for everyone in a server to understand
- Can be used as a fun moderation or utility bot for casual servers

## Example

```text
User: i cnat evn typw thsi rn
Giberrator: I can't even type this right now.
```

## Planned Usage

Once the bot is implemented, Giberrator should be able to listen for messages or respond to commands, then return a cleaned-up translation.

Example command idea:

```text
/translate i hve no idae waht im sayign
```

Expected response:

```text
I have no idea what I'm saying.
```

## Setup

Project setup instructions will depend on the final bot implementation.

Typical setup will include:

1. Creating a Discord application and bot token in the Discord Developer Portal
2. Adding the bot token to an environment variable
3. Installing project dependencies
4. Running the bot locally or on a server

## Environment Variables

The bot will likely require:

```text
DISCORD_TOKEN=your_discord_bot_token
```

Keep tokens private and never commit them to the repository.

## Contributing

Contributions are welcome. Useful improvements could include:

- Better gibberish detection
- More accurate translations
- Slash command support
- Message context handling
- Server-specific configuration

## License

Add a license before publishing or distributing the project.
