// In-game abilities the Claude brain can invoke. Each returns a short string
// that gets fed back to Claude as the tool result.
const { goals } = require('mineflayer-pathfinder')

const ACTION_TIMEOUT_MS = 90_000

function withTimeout(promise, ms, onTimeout) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (onTimeout) onTimeout()
      reject(new Error('Action timed out'))
    }, ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

module.exports = function createActions(bot) {
  function playerEntity(name) {
    const record = bot.players[name]
    return record && record.entity ? record.entity : null
  }

  function stopEverything() {
    bot.pathfinder.setGoal(null)
    if (bot.pvp) bot.pvp.stop()
    if (bot.collectBlock) bot.collectBlock.cancelTask().catch(() => {})
  }

  const actions = {
    async follow({ playerName }) {
      const target = playerEntity(playerName)
      if (!target) return `I can't see ${playerName} right now — they may be too far away.`
      bot.pathfinder.setGoal(new goals.GoalFollow(target, 2), true)
      return `Now following ${playerName}.`
    },

    async come({ playerName }) {
      const target = playerEntity(playerName)
      if (!target) return `I can't see ${playerName} right now.`
      const { x, y, z } = target.position
      await withTimeout(
        bot.pathfinder.goto(new goals.GoalNear(x, y, z, 1)),
        ACTION_TIMEOUT_MS,
        stopEverything
      )
      return `Arrived next to ${playerName}.`
    },

    async goto({ x, y, z }) {
      await withTimeout(
        bot.pathfinder.goto(new goals.GoalNear(x, y, z, 1)),
        ACTION_TIMEOUT_MS,
        stopEverything
      )
      return `Arrived at ${Math.round(x)}, ${Math.round(y)}, ${Math.round(z)}.`
    },

    async mine({ blockName, count = 1 }) {
      const mcData = require('minecraft-data')(bot.version)
      const blockType = mcData.blocksByName[blockName]
      if (!blockType) {
        return `"${blockName}" isn't a block id I know. Use snake_case ids like oak_log, stone, iron_ore.`
      }
      const positions = bot.findBlocks({
        matching: blockType.id,
        maxDistance: 64,
        count: Math.min(count, 32)
      })
      if (positions.length === 0) return `No ${blockName} within 64 blocks of me.`
      const targets = positions.map((pos) => bot.blockAt(pos)).filter(Boolean)
      await withTimeout(bot.collectBlock.collect(targets), ACTION_TIMEOUT_MS * 2, stopEverything)
      return `Collected ${targets.length} ${blockName}.`
    },

    async attack({ targetName }) {
      const wanted = targetName ? targetName.toLowerCase() : null
      const target = bot.nearestEntity((entity) => {
        if (!entity || entity === bot.entity) return false
        const name = (entity.name || entity.displayName || '').toLowerCase()
        if (wanted) return name.includes(wanted)
        return entity.kind === 'Hostile mobs'
      })
      if (!target) {
        return wanted ? `No "${targetName}" nearby.` : 'No hostile mobs nearby.'
      }
      bot.pvp.attack(target)
      return `Attacking the ${target.name || 'target'}!`
    },

    async give({ playerName, itemName, count = 1 }) {
      const target = playerEntity(playerName)
      if (!target) return `I can't see ${playerName} to throw items to.`
      const item = bot.inventory.items().find((i) => i.name === itemName)
      if (!item) return `I don't have any ${itemName}. My inventory: ${await actions.inventory()}`
      const tossCount = Math.min(count, item.count)
      await bot.lookAt(target.position.offset(0, 1.5, 0))
      await bot.toss(item.type, null, tossCount)
      return `Tossed ${tossCount} ${itemName} toward ${playerName}.`
    },

    async inventory() {
      const items = bot.inventory.items()
      if (items.length === 0) return 'My inventory is empty.'
      return items.map((i) => `${i.count}x ${i.name}`).join(', ')
    },

    async status() {
      const pos = bot.entity.position
      const time = bot.time.isDay ? 'day' : 'night'
      return (
        `Health ${Math.round(bot.health)}/20, food ${Math.round(bot.food)}/20, ` +
        `at ${Math.round(pos.x)}, ${Math.round(pos.y)}, ${Math.round(pos.z)}, time: ${time}.`
      )
    },

    async stop() {
      stopEverything()
      return 'Stopped everything I was doing.'
    }
  }

  return actions
}
