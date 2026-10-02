# MinecraftBuddy

An AI teammate for Minecraft Java Edition: a Node.js bot that joins your world as a second player, chats with you in game chat, and carries out what you ask by calling real in-game actions through Claude's tool-use API.

## What it does

- Joins a Minecraft Java world (a singleplayer world opened to LAN) as a real player entity, with no mods required on the player's side.
- Holds a natural conversation in normal game chat. No slash commands: "go chop some wood and bring it to me" works as written.
- Turns requests into actions: follow or come to a player, walk to coordinates, find and mine blocks, fight mobs, toss items to a player, and report its inventory and health.
- Reports back honestly. When an action fails (no blocks nearby, player out of sight, timed out), the error goes back to the model, which tells the player and suggests something else.
- Has an editable personality (upbeat and camera-friendly by default) because it was built to co-star in a YouTube video.

## Tech stack

- **Node.js** (22 or newer, required by Mineflayer 4.37)
- **[Mineflayer](https://github.com/PrismarineJS/mineflayer)** to connect to the server and control the player
- **mineflayer-pathfinder** for navigation, **mineflayer-collectblock** for mining, **mineflayer-pvp** for combat, **minecraft-data** for block and item lookups
- **Anthropic Claude API** via the official `@anthropic-ai/sdk`, using tool use (function calling)
- **dotenv** for configuration

## How it works

The project is three files, each with one job:

- **`src/bot.js`: the connection to the game.** Reads config from `.env`, creates the Mineflayer bot (offline auth, which LAN worlds accept), loads the pathfinding, mining and combat plugins, and listens for chat. Every chat message from another player is handed to the brain.
- **`src/brain.js`: the decision-maker.** Wraps the Claude API. It holds the system prompt (personality plus rules such as "replies go straight into game chat, keep them under 200 characters" and "when asked to do something physical, actually call the tool"), the list of tools Claude may call, and a short conversation history.
- **`src/actions.js`: the hands.** Nine async functions (`follow`, `come`, `goto`, `mine`, `attack`, `give`, `inventory`, `status`, `stop`) that drive the Mineflayer plugins and return a short plain-English result string such as `"Collected 8 oak_log."` or `"No iron_ore within 64 blocks of me."`.

What happens when a player types "grab me some oak logs":

1. `bot.js` receives the chat event and passes `(username, message)` to the brain.
2. The brain **queues** the message. Messages are processed one at a time, so two quick chats can't start two overlapping Claude conversations or conflicting actions.
3. The brain builds the request: the player's message plus a **game-context note** generated live from the bot's state (position, health, food, day or night, nearby entities). The model can't see the game, so this note stands in for its eyes.
4. Claude replies. Any text is posted to chat immediately (split into chunks under Minecraft's 256-character limit), so the bot says something like "On it!" before it starts working.
5. If Claude asked to use tools (for example `mine` with `{ "blockName": "oak_log", "count": 8 }`, then `give`), each call is looked up in `actions.js` and run. Long-running actions are wrapped in a timeout that cancels pathfinding, mining and combat if they hang. Each result string, or the error message if it failed, is sent back to Claude as a `tool_result`.
6. Steps 4 and 5 repeat (an agent loop capped at 6 rounds) until Claude stops asking for tools.
7. A plain-text summary of the exchange is added to a rolling history (the last 20 messages), so the bot remembers recent conversation without the prompt growing forever.

The key design idea is that the language model never touches the game directly. It can only choose from a small, typed set of actions with JSON-schema inputs, and the code turns each choice into deterministic Mineflayer calls. That keeps the bot predictable and makes failures easy to explain back to the player.

## Quick start

**You need:**

- Node.js 22 or newer
- Minecraft Java Edition, on a version the installed Mineflayer supports (1.8.8 through 1.21.11 at the time of writing)
- Your own Anthropic API key from [console.anthropic.com](https://console.anthropic.com). API usage is billed to your account.

**Steps:**

1. Clone the repo and install dependencies:
   ```
   git clone https://github.com/OceanAKA/MinecraftBuddy.git
   cd MinecraftBuddy
   npm install
   ```
2. Copy the example config and fill in your own values:
   ```
   cp .env.example .env
   ```
   (On Windows Command Prompt, use `copy .env.example .env`.) Set `ANTHROPIC_API_KEY` to your own key. `.env` is git-ignored; never commit it.
3. In Minecraft, open a singleplayer world, then press **Esc > Open to LAN > Start LAN World**. Chat shows `Local game hosted on port NNNNN`. Put that number in `.env` as `MC_PORT=NNNNN`. The port changes every time you reopen the world to LAN.
4. Start the bot:
   ```
   npm start
   ```
5. The bot joins the world and says hello in chat. Talk to it normally: "follow me", "go to 100 64 -200", "kill that zombie", "what's in your inventory?", "stop".

## How I built it

I built this with Claude Code (Anthropic's AI coding agent) for a YouTube video. I designed the buddy's behaviour and personality, directed the implementation, and playtested it in game to tune how it talks and acts. A separate companion client-side mod explores the same idea from inside the game.

This project is not affiliated with, endorsed by, or connected to Mojang Studios or Microsoft. Minecraft is a trademark of Mojang Studios.

## Technical details

### Configuration (`.env`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | (required) | Your Anthropic API key |
| `MC_HOST` | `localhost` | Server address; `localhost` for a LAN world on the same PC |
| `MC_PORT` | (required) | LAN port shown in chat after "Open to LAN" |
| `BOT_USERNAME` | `ClaudeBuddy` | The bot's in-game name |
| `CLAUDE_MODEL` | `claude-opus-4-8` | Which Claude model powers the brain |

The bot connects with `auth: 'offline'`, so it works on LAN worlds and servers running in offline mode. It does not sign in with a Microsoft account.

### Abilities

| Tool | What it does | Notes |
| --- | --- | --- |
| `follow` | Follows a player continuously | Dynamic pathfinder goal; keeps following until `stop` |
| `come` | Walks to a player once | 90-second timeout |
| `goto` | Walks to x, y, z coordinates | 90-second timeout |
| `mine` | Finds and collects blocks by id (e.g. `oak_log`, `iron_ore`) | Searches within 64 blocks, up to 32 blocks per request, 180-second timeout; pathfinding may dig through obstacles |
| `attack` | Attacks the nearest hostile mob, or the nearest mob of a named type | Starts combat and returns immediately; `stop` ends it |
| `give` | Looks at a player and tosses them items from its inventory | Reports its inventory if it doesn't have the item |
| `inventory` | Lists what it is carrying | |
| `status` | Reports health, food, position and time of day | |
| `stop` | Cancels following, mining, fighting and walking | |

### Behaviour notes

- The bot responds to **every** chat message from other players, so each message costs at least one API call, and any player in the world can give it instructions.
- The personality lives in `systemPrompt()` in `src/brain.js`. Edit it to change the bot's vibe (sarcastic, chaotic, wholesome, scared of caves, and so on).
- If a brain request fails (bad key, no credit, network error), the bot says its brain glitched and the real error is logged in the terminal.
- When the bot dies it announces it in chat and respawns.
- It can only see and act on chunks loaded around itself, so keep render distance reasonable.

### Tips for filming

- Because it always answers, it works well as an "always on" duo partner.
- If it gets stuck or wanders off, type "stop".

### Troubleshooting

- **"Missing MC_PORT"**: you skipped step 3, or the world was reopened to LAN and the port changed.
- **"Missing ANTHROPIC_API_KEY"**: `.env` is missing or the key line is empty.
- **Bot connects then immediately disconnects**: check the game version is one Mineflayer supports, and that you started the LAN world in the world you expect.
- **Bot is silent in chat**: check the terminal for API errors (invalid key, no credit, unknown model name).

## License

[MIT](LICENSE)
