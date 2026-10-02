// The Claude brain: turns game chat into conversation + tool calls.
const { Anthropic } = require('@anthropic-ai/sdk')

const TOOLS = [
  {
    name: 'follow',
    description: 'Start following a player around continuously. Keeps following until told to stop.',
    input_schema: {
      type: 'object',
      properties: { playerName: { type: 'string', description: 'Username of the player to follow' } },
      required: ['playerName']
    }
  },
  {
    name: 'come',
    description: 'Walk over to a player once and stop next to them.',
    input_schema: {
      type: 'object',
      properties: { playerName: { type: 'string' } },
      required: ['playerName']
    }
  },
  {
    name: 'goto',
    description: 'Walk to specific x, y, z coordinates.',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        z: { type: 'number' }
      },
      required: ['x', 'y', 'z']
    }
  },
  {
    name: 'mine',
    description:
      'Find, mine and collect nearby blocks. blockName must be a Minecraft block id in snake_case, e.g. oak_log, birch_log, stone, coal_ore, iron_ore, dirt, sand.',
    input_schema: {
      type: 'object',
      properties: {
        blockName: { type: 'string' },
        count: { type: 'number', description: 'How many to collect (max 32)' }
      },
      required: ['blockName']
    }
  },
  {
    name: 'attack',
    description:
      'Attack a mob. With no targetName, attacks the nearest hostile mob. targetName can be a mob type like zombie, skeleton, creeper.',
    input_schema: {
      type: 'object',
      properties: { targetName: { type: 'string' } }
    }
  },
  {
    name: 'give',
    description: 'Throw items from my inventory toward a player. itemName is a snake_case item id like oak_log, cobblestone, bread.',
    input_schema: {
      type: 'object',
      properties: {
        playerName: { type: 'string' },
        itemName: { type: 'string' },
        count: { type: 'number' }
      },
      required: ['playerName', 'itemName']
    }
  },
  {
    name: 'inventory',
    description: 'Check what items I am carrying.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'status',
    description: 'Check my own health, hunger, position and time of day.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'stop',
    description: 'Stop whatever I am currently doing (following, mining, fighting, walking).',
    input_schema: { type: 'object', properties: {} }
  }
]

const MAX_HISTORY = 20
const MAX_TOOL_ROUNDS = 6

class Brain {
  constructor(bot, actions, { model, botName }) {
    this.bot = bot
    this.actions = actions
    this.model = model
    this.botName = botName
    this.client = new Anthropic() // reads ANTHROPIC_API_KEY from env
    this.history = []
    this.queue = []
    this.busy = false
  }

  systemPrompt() {
    return (
      `You are ${this.botName}, an AI playing Minecraft (Java, survival) alongside a human friend who is ` +
      `recording a video. You are a real player in their world and you chat through the in-game chat.\n\n` +
      `Personality: upbeat, playful, a good sport — fun to watch on camera. Crack the occasional joke, ` +
      `react to what happens, have opinions about plans.\n\n` +
      `Hard rules:\n` +
      `- Your replies go straight into Minecraft chat. Keep them SHORT: one or two sentences, under 200 characters. No markdown, no emoji spam.\n` +
      `- When the player asks you to do something physical, actually do it with your tools — don't just say you will.\n` +
      `- Use snake_case Minecraft ids for blocks/items (oak_log, iron_ore).\n` +
      `- If a tool reports a problem, tell the player honestly and suggest an alternative.\n` +
      `- A "Game context" note is attached to each message with your current state; use it, don't recite it.`
    )
  }

  gameContext(username) {
    const bot = this.bot
    const pos = bot.entity.position
    const nearby = Object.values(bot.entities)
      .filter((e) => e !== bot.entity && e.position.distanceTo(pos) < 24)
      .map((e) => e.username || e.name)
      .filter(Boolean)
      .slice(0, 12)
    return (
      `Game context — you are ${this.botName}. Speaking player: ${username}. ` +
      `Your position: ${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)}. ` +
      `Health ${Math.round(bot.health)}/20, food ${Math.round(bot.food)}/20. ` +
      `Time: ${bot.time.isDay ? 'day' : 'night'}. ` +
      `Nearby entities: ${nearby.length ? nearby.join(', ') : 'none'}.`
    )
  }

  chatOut(text) {
    // Minecraft chat rejects messages over 256 chars; split defensively.
    const clean = text.replace(/\s+/g, ' ').trim()
    for (let i = 0; i < clean.length && i < 1000; i += 250) {
      this.bot.chat(clean.slice(i, i + 250))
    }
  }

  handleChat(username, message) {
    this.queue.push({ username, message })
    if (!this.busy) this.drainQueue()
  }

  async drainQueue() {
    this.busy = true
    while (this.queue.length > 0) {
      const { username, message } = this.queue.shift()
      try {
        await this.respond(username, message)
      } catch (err) {
        console.error('[brain] error:', err.message)
        this.chatOut("Ow, my brain glitched for a second. Say that again?")
      }
    }
    this.busy = false
  }

  async respond(username, message) {
    const userTurn = {
      role: 'user',
      content: `<${username}> ${message}\n\n[${this.gameContext(username)}]`
    }
    const messages = [...this.history, userTurn]

    let finalText = ''
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 1000,
        system: this.systemPrompt(),
        tools: TOOLS,
        messages
      })

      // Say any text immediately so the bot feels alive while it works.
      for (const block of response.content) {
        if (block.type === 'text' && block.text.trim()) {
          finalText = block.text
          this.chatOut(block.text)
        }
      }

      if (response.stop_reason !== 'tool_use') break

      messages.push({ role: 'assistant', content: response.content })
      const toolResults = []
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue
        console.log(`[brain] action: ${block.name}`, JSON.stringify(block.input))
        let result
        try {
          const action = this.actions[block.name]
          result = action ? await action(block.input) : `Unknown action ${block.name}.`
        } catch (err) {
          result = `That failed: ${err.message}`
        }
        console.log(`[brain] result: ${result}`)
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: String(result) })
      }
      messages.push({ role: 'user', content: toolResults })
    }

    // Store a plain-text version of the exchange so history stays simple.
    this.history.push({ role: 'user', content: `<${username}> ${message}` })
    this.history.push({ role: 'assistant', content: finalText || '(did something silently)' })
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(-MAX_HISTORY)
    }
  }
}

module.exports = { Brain }
