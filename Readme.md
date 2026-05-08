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

## Current Usage

Giberrator currently includes a simple Discord.js slash command:

```text
/ping
```

Expected response:

```text
Pong!
```

It includes a few utility commands:

```text
/servicechannel channel:#channel
/sethistorysize size:15
```

`/servicechannel` stores a server service channel and sends a test message there. If the bot cannot send the test message, it will try to DM the user who ran the command with the permission issue.

When someone replies to a message and mentions the bot, Giberrator queues the replied-to message for interpretation, sends it to the configured local Ollama server, then replies with either the best readable interpretation or up to three likely interpretations.

Example trigger:

```text
User A: some txt thts typod
User B replies to User A and says: @Giberrator
```

Sanitized translation trigger:

```text
User A: some txt thts typod
User B replies to User A and says: @Giberrator translate
```

The translator also receives recent chat context from the same channel. By default it includes the previous `15` non-bot messages, and you can change that per server with `/sethistorysize`.

If the replied-to message includes image attachments, or contains an `x.com`, `twitter.com`, or `vxtwitter.com` post link with an image preview, Giberrator first sends those images to Ollama using `nemotron3:33b` to get a concise image summary, then uses that summary as extra context for the final interpretation or translation.

Before translation starts, Giberrator logs the picked-up message to the configured service channel in this format:

```text
Ungibberizing Users's message: <message>
```

If Ollama translation fails for any reason, Giberrator sends that error to the service channel as a notification.

## Setup

1. Create a Discord application in the Discord Developer Portal
2. Create a bot for the application
3. Copy `.env.example` to `.env`
4. Fill in your Discord bot token and application client ID
5. Invite the bot to your server with the `bot` and `applications.commands` scopes

## Environment Variables

```text
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_application_client_id
DISCORD_GUILD_ID=your_test_server_id
GIBERRATOR_DB_PATH=data/giberrator.sqlite
OLLAMA_MODEL=llama3.2
OLLAMA_IMAGE_SUMMARY_MODEL=nemotron3:33b
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_TIMEOUT_MS=30000
OLLAMA_IMAGE_SUMMARY_TIMEOUT_MS=120000
UNGIBBERISH_PROMPT_PATH=prompts/ungibberish-system.txt
UNGIBBERISH_INTERPRET_PROMPT_PATH=prompts/ungibberish-interpret-system.txt
UNGIBBERISH_REFERENCE_PATH=prompts/ffxiv-reference.txt
TRANSLATION_QUEUE_MAX_SIZE=100
```

`DISCORD_GUILD_ID` is optional, but recommended during development because guild commands update faster than global commands.

`GIBERRATOR_DB_PATH` is optional and defaults to `data/giberrator.sqlite`.

`OLLAMA_MODEL` is required for the translation service. `OLLAMA_BASE_URL` defaults to `http://localhost:11434` locally. When running with Docker Compose, the compose file defaults it to `http://host.docker.internal:11434` and maps `host.docker.internal` to the host gateway so the container can reach Ollama running on your machine.

`TRANSLATION_QUEUE_MAX_SIZE` is optional and defaults to `100`.

Keep tokens private and never commit them to the repository.

The bot needs the Message Content intent enabled in the Discord Developer Portal because it reads message text from tracked users.

## Translation Service

The default interpreter-style prompt lives in `prompts/ungibberish-interpret-system.txt`.
The simpler sanitized translation prompt lives in `prompts/ungibberish-system.txt`.

FFXIV-specific glossary/context lives in `prompts/ffxiv-reference.txt`. The translator appends that reference file to the system prompt so common job names, races, places, shorthand, and community terms are treated as known terms instead of random gibberish.

When a replied-to message includes images, the translator first runs a vision pass with `OLLAMA_IMAGE_SUMMARY_MODEL` and uses the resulting image summary as extra context for the final text response.

The backend translator accepts a string and returns a JSON array of one to three readable translations:

```js
import { translateGibberish } from './src/services/gibberishTranslator.js';

const translations = await translateGibberish('i cnat evn typw thsi rn');
// ["I can't even type this right now."]
```

You can test it manually while Ollama is running:

```sh
npm run translate -- "i cnat evn typw thsi rn"
```

## Running Locally

Install dependencies:

```sh
npm install
```

Register slash commands:

```sh
npm run register
```

Start the bot:

```sh
npm start
```

## Running With Docker

Build and start the bot:

```sh
docker compose up --build
```

Register slash commands from inside the container:

```sh
docker compose build giberrator
docker compose run --rm giberrator npm run register
```

After registration completes, use `/ping` in Discord and the bot will reply with `Pong!`.

The Docker Compose setup mounts `./data` to `/app/data` so the SQLite database persists between container rebuilds.

## Contributing

Contributions are welcome. Useful improvements could include:

- Better gibberish detection
- More accurate translations
- Slash command support
- Message context handling
- Server-specific configuration

## License

Add a license before publishing or distributing the project.
