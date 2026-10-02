# MinecraftBuddy

A Claude-powered AI that joins your Minecraft (Java Edition) world as a second player.
Talk to it in normal game chat and it talks back, follows you, mines, fights mobs, and
hands you items — great for recording videos together.

## Setup (one time)

1. Install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env` and paste in your Anthropic API key
   (from https://console.anthropic.com).

## Every play session

1. Start Minecraft **Java Edition** and open your world (any version 1.8–1.21.x).
2. Press **Esc → Open to LAN → Start LAN World**.
3. Chat shows: `Local game hosted on port 54321` — put that number in `.env` as `MC_PORT=54321`.
   (The port is different every time you reopen the world.)
4. Run the bot:
   ```
   npm start
   ```
5. The bot spawns in and says hi. Just type in chat — no commands needed:
   - "follow me"
   - "go chop some wood and bring it to me"
   - "there's a creeper behind me, kill it!"
   - "what's in your inventory?"
   - "how are you doing on health?"
   - "stop"

## What it can do

| Ability | Notes |
| --- | --- |
| Follow / come to you | Pathfinds around terrain, digs through obstacles if needed |
| Walk to coordinates | "go to 100 64 -200" |
| Mine + collect blocks | Any block within 64 blocks, e.g. wood, stone, ores |
| Fight | Attacks the nearest hostile mob, or a specific type you name |
| Give you items | Throws items from its inventory at you |
| Chat | Full Claude conversation — banter, plans, reactions |

## Tips for filming

- The bot answers **every** chat message, so it's always "on" — perfect for a duo video.
- Its personality lives in `src/brain.js` (`systemPrompt()`); edit that to change its vibe
  (sarcastic, chaotic, wholesome, scared of caves...).
- If it gets stuck or runs off, type "stop".
- Keep render distance decent — the bot can only see loaded chunks around itself.

## Troubleshooting

- **"Missing MC_PORT"** — you skipped step 3, or the world was reopened (new port).
- **Bot connects then instantly disconnects** — check the Minecraft version is 1.8–1.21.x
  and that you clicked Start LAN World in the same world you expect.
- **Bot is silent** — check the terminal for API errors (bad key, no credit).
