// MinecraftBuddy — a Claude-powered companion bot for your LAN world.
require('dotenv').config()

const mineflayer = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')
const collectBlock = require('mineflayer-collectblock').plugin
const pvp = require('mineflayer-pvp').plugin

const createActions = require('./actions')
const { Brain } = require('./brain')

const HOST = process.env.MC_HOST || 'localhost'
const PORT = Number(process.env.MC_PORT)
const BOT_NAME = process.env.BOT_USERNAME || 'ClaudeBuddy'
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8'

if (!PORT) {
  console.error(
    'Missing MC_PORT. Open your world to LAN (Esc > Open to LAN), then copy the port from\n' +
    'the chat message "Local game hosted on port XXXXX" into .env as MC_PORT=XXXXX'
  )
  process.exit(1)
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('Missing ANTHROPIC_API_KEY in .env — get one at https://console.anthropic.com')
  process.exit(1)
}

console.log(`Connecting to ${HOST}:${PORT} as ${BOT_NAME} (brain: ${MODEL})...`)

const bot = mineflayer.createBot({
  host: HOST,
  port: PORT,
  username: BOT_NAME,
  auth: 'offline' // LAN worlds accept offline players, no Microsoft account needed for the bot
})

bot.loadPlugin(pathfinder)
bot.loadPlugin(collectBlock)
bot.loadPlugin(pvp)

const actions = createActions(bot)
const brain = new Brain(bot, actions, { model: MODEL, botName: BOT_NAME })

bot.once('spawn', () => {
  const movements = new Movements(bot)
  movements.canDig = true
  bot.pathfinder.setMovements(movements)
  console.log('Spawned! Say something in game chat to talk to the bot.')
  bot.chat(`Hey! ${BOT_NAME} online. Talk to me in chat — I can follow, mine, fight, and hand you stuff.`)
})

bot.on('chat', (username, message) => {
  if (username === bot.username) return
  console.log(`<${username}> ${message}`)
  brain.handleChat(username, message)
})

bot.on('whisper', (username, message) => {
  if (username === bot.username) return
  brain.handleChat(username, message)
})

bot.on('death', () => {
  bot.chat('I died! Respawning — save my stuff if you can!')
})

bot.on('kicked', (reason) => console.error('Kicked:', reason))
bot.on('error', (err) => console.error('Bot error:', err.message))
bot.on('end', (reason) => {
  console.log(`Disconnected (${reason}).`)
  console.log('Note: LAN ports change every time you reopen the world — update MC_PORT and run again.')
  process.exit(0)
})
