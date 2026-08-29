const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Collection
} = require("discord.js");

const fs = require("fs");
const path = require("path");

/* =========================================================
   ENVIRONMENT
========================================================= */

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const GUILD_ID = "1493700265499689154";
const SUPPORT_ADMIN_ROLE_ID = "1542498406981959801";
const SUPPORT_LOG_CHANNEL_ID = "1542500573000106024";

if (!TOKEN) {
  console.error("DISCORD_TOKEN is missing.");
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error("CLIENT_ID is missing.");
  process.exit(1);
}

/* =========================================================
   CLIENT
========================================================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions,
    GatewayIntentBits.GuildModeration
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User,
    Partials.GuildMember
  ]
});

/* =========================================================
   DATA STORAGE
========================================================= */

const DATA_DIR = path.join(__dirname, "data");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const WARNINGS_FILE = path.join(DATA_DIR, "warnings.json");
const PUNISHMENTS_FILE = path.join(DATA_DIR, "punishments.json");
const TICKETS_FILE = path.join(DATA_DIR, "tickets.json");

function loadJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
      return fallback;
    }

    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.error(`Failed loading ${file}:`, error);
    return fallback;
  }
}

function saveJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error(`Failed saving ${file}:`, error);
  }
}

const configs = loadJSON(CONFIG_FILE, {});
const warnings = loadJSON(WARNINGS_FILE, {});
const punishments = loadJSON(PUNISHMENTS_FILE, {});
const tickets = loadJSON(TICKETS_FILE, {});

/* =========================================================
   DEFAULT CONFIG
========================================================= */

function defaultConfig() {
  return {
    automod: {
      enabled: true,
      invites: true,
      spam: true,
      massMentions: true,
      badWords: true,
      caps: true,
      repeatedMessages: true,

      spamLimit: 6,
      spamWindow: 7000,

      mentionLimit: 5,

      capsPercent: 75,
      capsMinimum: 12,

      repeatLimit: 3,

      badWords: [
        "badword1",
        "badword2"
      ],

      action: "timeout",
      timeoutSeconds: 300,

      logChannelId: null
    },

    security: {
      enabled: true,

      antiRaid: true,
      raidJoinLimit: 8,
      raidWindow: 10000,

      newAccountProtection: false,
      minimumAccountAgeDays: 3,

      antiNuke: true,

      channelDeleteLimit: 3,
      channelCreateLimit: 6,
      roleDeleteLimit: 3,
      roleCreateLimit: 6,
      banLimit: 5,
      kickLimit: 5,
      permissionChangeLimit: 5,

      action: "kick",

      logChannelId: null,

      trustedUsers: [],
      trustedBots: []
    },

    suggestions: {
      enabled: true,
      channelId: null
    },

    announcements: {
      channelId: null
    },

    tickets: {
      enabled: true,
      categoryId: null
    },

    moderation: {
      warningEscalation: true,

      levels: [
        {
          warnings: 3,
          action: "timeout",
          duration: 300
        },
        {
          warnings: 5,
          action: "kick",
          duration: 0
        },
        {
          warnings: 7,
          action: "ban",
          duration: 0
        }
      ]
    }
  };
}

function getConfig(guildId) {
  if (!configs[guildId]) {
    configs[guildId] = defaultConfig();
    saveJSON(CONFIG_FILE, configs);
  }

  return configs[guildId];
}

/* =========================================================
   COLLECTIONS / MEMORY
========================================================= */

const messageTracker = new Map();
const raidTracker = new Map();
const securityTracker = new Map();
const autoModCooldown = new Map();

/* =========================================================
   HELPERS
========================================================= */

function isOwner(member) {
  return member?.id === member.guild.ownerId;
}

function isAdmin(member) {
  if (!member) return false;

  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.id === member.guild.ownerId
  );
}

function isSupport(member) {
  if (!member) return false;

  return (
    isAdmin(member) ||
    member.roles.cache.has(SUPPORT_ADMIN_ROLE_ID)
  );
}

function isTrusted(member, config) {
  if (!member) return false;

  if (member.user?.bot && config.security.trustedBots.includes(member.id)) {
    return true;
  }

  if (config.security.trustedUsers.includes(member.id)) {
    return true;
  }

  return isOwner(member);
}

function cleanText(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/<a?:\w+:\d+>/g, "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .trim();
}

function containsInvite(text) {
  return /(discord\.gg\/|discord\.com\/invite\/|discordapp\.com\/invite\/)/i.test(
    text
  );
}

function hasMassMentions(message, limit) {
  const total =
    message.mentions.users.size +
    message.mentions.roles.size +
    (message.mentions.everyone ? limit : 0);

  return total >= limit || message.mentions.everyone;
}

function isMostlyCaps(text, percent, minimum) {
  const letters = text.match(/[A-Za-z]/g);

  if (!letters || letters.length < minimum) {
    return false;
  }

  const upper = letters.filter((x) => x === x.toUpperCase()).length;

  return (upper / letters.length) * 100 >= percent;
}

function containsBadWord(text, badWords) {
  const lower = cleanText(text);

  return badWords.find((word) => {
    const escaped = String(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\s)${escaped}(\\s|$)`, "i").test(lower);
  });
}

function getRepeatedCount(message) {
  const key = `${message.guild.id}:${message.author.id}`;

  const current = messageTracker.get(key) || {
    content: "",
    count: 0,
    time: Date.now()
  };

  const content = cleanText(message.content);

  if (
    current.content === content &&
    Date.now() - current.time < 15000
  ) {
    current.count++;
  } else {
    current.content = content;
    current.count = 1;
  }

  current.time = Date.now();

  messageTracker.set(key, current);

  return current.count;
}

function cooldown(key, ms = 3000) {
  const now = Date.now();
  const previous = autoModCooldown.get(key) || 0;

  if (now - previous < ms) {
    return true;
  }

  autoModCooldown.set(key, now);
  return false;
}

/* =========================================================
   EMBEDS / LOGGING
========================================================= */

async function getLogChannel(guild, type = "general") {
  if (!guild) return null;

  const config = getConfig(guild.id);

  let id = null;

  if (type === "automod") {
    id = config.automod.logChannelId;
  } else if (type === "security") {
    id = config.security.logChannelId;
  }

  if (!id) {
    id = SUPPORT_LOG_CHANNEL_ID;
  }

  try {
    const channel = await guild.channels.fetch(id);
    return channel?.isTextBased() ? channel : null;
  } catch {
    return null;
  }
}

async function sendLog(guild, title, description, type = "general") {
  try {
    const channel = await getLogChannel(guild, type);

    if (!channel) return;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("Log error:", error);
  }
}

/* =========================================================
   MODERATION DATABASE
========================================================= */

function addPunishment(guildId, userId, data) {
  if (!punishments[guildId]) {
    punishments[guildId] = {};
  }

  if (!punishments[guildId][userId]) {
    punishments[guildId][userId] = [];
  }

  const record = {
    id: Date.now().toString(),
    ...data,
    timestamp: new Date().toISOString()
  };

  punishments[guildId][userId].push(record);

  saveJSON(PUNISHMENTS_FILE, punishments);

  return record;
}

function addWarning(guildId, userId, moderatorId, reason) {
  if (!warnings[guildId]) {
    warnings[guildId] = {};
  }

  if (!warnings[guildId][userId]) {
    warnings[guildId][userId] = [];
  }

  const record = {
    id: Date.now().toString(),
    moderatorId,
    reason,
    timestamp: new Date().toISOString()
  };

  warnings[guildId][userId].push(record);

  saveJSON(WARNINGS_FILE, warnings);

  addPunishment(guildId, userId, {
    type: "warn",
    moderatorId,
    reason
  });

  return record;
}

function getWarnings(guildId, userId) {
  return warnings[guildId]?.[userId] || [];
}

function getPunishments(guildId, userId) {
  return punishments[guildId]?.[userId] || [];
}

/* =========================================================
   WARNING ESCALATION
========================================================= */

async function applyWarningEscalation(member, count, moderatorId) {
  const config = getConfig(member.guild.id);

  if (!config.moderation.warningEscalation) {
    return;
  }

  const levels = [...config.moderation.levels]
    .sort((a, b) => b.warnings - a.warnings);

  const level = levels.find((x) => count >= x.warnings);

  if (!level) return;

  try {
    if (level.action === "timeout") {
      await member.timeout(
        level.duration * 1000,
        `Automatic warning escalation (${count} warnings)`
      );

      addPunishment(member.guild.id, member.id, {
        type: "timeout",
        moderatorId,
        reason: `Warning escalation: ${count} warnings`,
        duration: level.duration
      });
    }

    if (level.action === "kick") {
      await member.kick(
        `Automatic warning escalation (${count} warnings)`
      );

      addPunishment(member.guild.id, member.id, {
        type: "kick",
        moderatorId,
        reason: `Warning escalation: ${count} warnings`
      });
    }

    if (level.action === "ban") {
      await member.ban({
        reason: `Automatic warning escalation (${count} warnings)`
      });

      addPunishment(member.guild.id, member.id, {
        type: "ban",
        moderatorId,
        reason: `Warning escalation: ${count} warnings`
      });
    }

    await sendLog(
      member.guild,
      "⚠️ Warning Escalation",
      `**User:** ${member.user.tag}\n**Warnings:** ${count}\n**Action:** ${level.action}`,
      "security"
    );
  } catch (error) {
    console.error("Escalation error:", error);
  }
}

/* =========================================================
   AUTOMOD ACTION
========================================================= */

async function autoModAction(message, reason) {
  if (!message.guild || !message.member) return;

  const config = getConfig(message.guild.id);

  const key = `${message.guild.id}:${message.author.id}:${reason}`;

  if (cooldown(key, 2500)) {
    return;
  }

  try {
    if (message.deletable) {
      await message.delete().catch(() => {});
    }

    await sendLog(
      message.guild,
      "🛡️ AutoMod Action",
      `**User:** ${message.author.tag} (${message.author.id})\n**Reason:** ${reason}\n**Channel:** ${message.channel}\n**Action:** ${config.automod.action}`,
      "automod"
    );

    if (config.automod.action === "timeout") {
      await message.member
        .timeout(
          config.automod.timeoutSeconds * 1000,
          `AutoMod: ${reason}`
        )
        .catch(() => {});

      addPunishment(message.guild.id, message.author.id, {
        type: "automod-timeout",
        moderatorId: client.user.id,
        reason
      });
    }

    if (config.automod.action === "kick") {
      await message.member
        .kick(`AutoMod: ${reason}`)
        .catch(() => {});

      addPunishment(message.guild.id, message.author.id, {
        type: "automod-kick",
        moderatorId: client.user.id,
        reason
      });
    }

    if (config.automod.action === "ban") {
      await message.member
        .ban({ reason: `AutoMod: ${reason}` })
        .catch(() => {});

      addPunishment(message.guild.id, message.author.id, {
        type: "automod-ban",
        moderatorId: client.user.id,
        reason
      });
    }
  } catch (error) {
    console.error("AutoMod action error:", error);
  }
}

/* =========================================================
   ADVANCED AUTOMOD
========================================================= */

async function processAutoMod(message) {
  if (!message.guild) return false;
  if (!message.member) return false;
  if (message.author.bot) return false;

  const config = getConfig(message.guild.id);

  if (!config.automod.enabled) return false;
  if (isTrusted(message.member, config)) return false;

  const content = message.content || "";

  if (
    config.automod.invites &&
    containsInvite(content)
  ) {
    await autoModAction(message, "Discord invite link");
    return true;
  }

  if (
    config.automod.massMentions &&
    hasMassMentions(message, config.automod.mentionLimit)
  ) {
    await autoModAction(message, "Mass mentions");
    return true;
  }

  if (
    config.automod.badWords &&
    containsBadWord(content, config.automod.badWords)
  ) {
    await autoModAction(message, "Blocked word");
    return true;
  }

  if (
    config.automod.caps &&
    isMostlyCaps(
      content,
      config.automod.capsPercent,
      config.automod.capsMinimum
    )
  ) {
    await autoModAction(message, "Excessive capital letters");
    return true;
  }

  if (
    config.automod.repeatedMessages &&
    getRepeatedCount(message) >= config.automod.repeatLimit
  ) {
    await autoModAction(message, "Repeated messages");
    return true;
  }

  if (config.automod.spam) {
    const key = `${message.guild.id}:${message.author.id}`;

    const data = messageTracker.get(`spam:${key}`) || [];

    const now = Date.now();

    data.push(now);

    const filtered = data.filter(
      (time) => now - time <= config.automod.spamWindow
    );

    messageTracker.set(`spam:${key}`, filtered);

    if (filtered.length >= config.automod.spamLimit) {
      await autoModAction(message, "Message spam");
      messageTracker.set(`spam:${key}`, []);
      return true;
    }
  }

  return false;
}

/* =========================================================
   ANTI RAID
========================================================= */

async function processAntiRaid(member) {
  const guild = member.guild;
  const config = getConfig(guild.id);

  if (!config.security.enabled || !config.security.antiRaid) {
    return;
  }

  if (isTrusted(member, config)) {
    return;
  }

  const now = Date.now();

  const joins = raidTracker.get(guild.id) || [];

  joins.push(now);

  const filtered = joins.filter(
    (time) => now - time <= config.security.raidWindow
  );

  raidTracker.set(guild.id, filtered);

  if (filtered.length >= config.security.raidJoinLimit) {
    await sendLog(
      guild,
      "🚨 ANTI-RAID ALERT",
      `Possible raid detected.\n\n**Recent joins:** ${filtered.length}\n**Window:** ${config.security.raidWindow}ms\n**Member:** ${member.user.tag}`,
      "security"
    );

    try {
      await guild.setMFALevel?.("elevated").catch(() => {});
    } catch {}

    await member
      .kick("Anti-Raid protection")
      .catch(() => {});

    addPunishment(guild.id, member.id, {
      type: "anti-raid-kick",
      moderatorId: client.user.id,
      reason: "Anti-Raid join detection"
    });
  }

  if (config.security.newAccountProtection) {
    const age =
      Date.now() - member.user.createdTimestamp;

    const minimum =
      config.security.minimumAccountAgeDays *
      24 *
      60 *
      60 *
      1000;

    if (age < minimum) {
      await member
        .kick("Account too new")
        .catch(() => {});

      await sendLog(
        guild,
        "🔐 New Account Protection",
        `**User:** ${member.user.tag}\n**Action:** Kick\n**Reason:** Account is newer than configured minimum.`,
        "security"
      );
    }
  }
}

/* =========================================================
   ANTI NUKE TRACKER
========================================================= */

function trackSecurity(guildId, type, userId, limit, callback) {
  const key = `${guildId}:${type}:${userId}`;

  const now = Date.now();

  const arr = securityTracker.get(key) || [];

  arr.push(now);

  const filtered = arr.filter(
    (time) => now - time <= 15000
  );

  securityTracker.set(key, filtered);

  if (filtered.length >= limit) {
    callback();
    securityTracker.set(key, []);
  }
}

/* =========================================================
   ANTI NUKE AUDIT LOG
========================================================= */

async function getExecutor(guild, type) {
  try {
    const logs = await guild.fetchAuditLogs({
      limit: 5,
      type
    });

    const entry = logs.entries.first();

    if (!entry) return null;

    if (Date.now() - entry.createdTimestamp > 10000) {
      return null;
    }

    return entry.executor;
  } catch {
    return null;
  }
}

async function punishNuker(guild, userId, reason) {
  const config = getConfig(guild.id);

  if (config.security.trustedUsers.includes(userId)) {
    return;
  }

  if (config.security.trustedBots.includes(userId)) {
    return;
  }

  try {
    const member = await guild.members.fetch(userId);

    if (
      member.id === guild.ownerId ||
      member.id === client.user.id
    ) {
      return;
    }

    if (config.security.action === "ban") {
      await member.ban({
        reason: `Anti-Nuke: ${reason}`
      }).catch(() => {});
    } else {
      await member.kick(
        `Anti-Nuke: ${reason}`
      ).catch(() => {});
    }

    await sendLog(
      guild,
      "💥 ANTI-NUKE ACTION",
      `**User:** ${member.user.tag}\n**Reason:** ${reason}\n**Action:** ${config.security.action}`,
      "security"
    );

    addPunishment(guild.id, userId, {
      type: "anti-nuke",
      moderatorId: client.user.id,
      reason
    });
  } catch (error) {
    console.error("Anti-Nuke error:", error);
  }
}

/* =========================================================
   CHANNEL DELETE
========================================================= */

client.on("channelDelete", async (channel) => {
  if (!channel.guild) return;

  const guild = channel.guild;
  const config = getConfig(guild.id);

  if (!config.security.enabled || !config.security.antiNuke) {
    return;
  }

  const executor = await getExecutor(
    guild,
    12
  );

  if (!executor || executor.id === client.user.id) {
    return;
  }

  if (config.security.trustedUsers.includes(executor.id)) {
    return;
  }

  trackSecurity(
    guild.id,
    "channelDelete",
    executor.id,
    config.security.channelDeleteLimit,
    () =>
      punishNuker(
        guild,
        executor.id,
        "Mass channel deletion"
      )
  );
});

/* =========================================================
   CHANNEL CREATE
========================================================= */

client.on("channelCreate", async (channel) => {
  if (!channel.guild) return;

  const guild = channel.guild;
  const config = getConfig(guild.id);

  if (!config.security.enabled || !config.security.antiNuke) {
    return;
  }

  const executor = await getExecutor(
    guild,
    10
  );

  if (!executor || executor.id === client.user.id) {
    return;
  }

  if (config.security.trustedUsers.includes(executor.id)) {
    return;
  }

  trackSecurity(
    guild.id,
    "channelCreate",
    executor.id,
    config.security.channelCreateLimit,
    () =>
      punishNuker(
        guild,
        executor.id,
        "Mass channel creation"
      )
  );
});

/* =========================================================
   ROLE DELETE
========================================================= */

client.on("roleDelete", async (role) => {
  const guild = role.guild;
  const config = getConfig(guild.id);

  if (!config.security.enabled || !config.security.antiNuke) {
    return;
  }

  const executor = await getExecutor(
    guild,
    32
  );

  if (!executor || executor.id === client.user.id) {
    return;
  }

  if (config.security.trustedUsers.includes(executor.id)) {
    return;
  }

  trackSecurity(
    guild.id,
    "roleDelete",
    executor.id,
    config.security.roleDeleteLimit,
    () =>
      punishNuker(
        guild,
        executor.id,
        "Mass role deletion"
      )
  );
});

/* =========================================================
   ROLE CREATE
========================================================= */

client.on("roleCreate", async (role) => {
  const guild = role.guild;
  const config = getConfig(guild.id);

  if (!config.security.enabled || !config.security.antiNuke) {
    return;
  }

  const executor = await getExecutor(
    guild,
    30
  );

  if (!executor || executor.id === client.user.id) {
    return;
  }

  if (config.security.trustedUsers.includes(executor.id)) {
    return;
  }

  trackSecurity(
    guild.id,
    "roleCreate",
    executor.id,
    config.security.roleCreateLimit,
    () =>
      punishNuker(
        guild,
        executor.id,
        "Mass role creation"
      )
  );
});

/* =========================================================
   GUILD MEMBER BAN
========================================================= */

client.on("guildBanAdd", async (ban) => {
  const guild = ban.guild;
  const config = getConfig(guild.id);

  if (!config.security.enabled || !config.security.antiNuke) {
    return;
  }

  const executor = await getExecutor(
    guild,
    22
  );

  if (!executor || executor.id === client.user.id) {
    return;
  }

  if (config.security.trustedUsers.includes(executor.id)) {
    return;
  }

  trackSecurity(
    guild.id,
    "ban",
    executor.id,
    config.security.banLimit,
    () =>
      punishNuker(
        guild,
        executor.id,
        "Mass member banning"
      )
  );
});

/* =========================================================
   GUILD MEMBER REMOVE / KICK
========================================================= */

client.on("guildMemberRemove", async (member) => {
  const guild = member.guild;
  const config = getConfig(guild.id);

  if (!config.security.enabled || !config.security.antiNuke) {
    return;
  }

  const executor = await getExecutor(
    guild,
    20
  );

  if (!executor || executor.id === client.user.id) {
    return;
  }

  if (config.security.trustedUsers.includes(executor.id)) {
    return;
  }

  if (executor.id === member.id) {
    return;
  }

  trackSecurity(
    guild.id,
    "kick",
    executor.id,
    config.security.kickLimit,
    () =>
      punishNuker(
        guild,
        executor.id,
        "Mass member kicking"
      )
  );
});

/* =========================================================
   MESSAGE EVENTS
========================================================= */

client.on("messageCreate", async (message) => {
  if (message.guild) {
    await processAutoMod(message);
    return;
  }

  /* =======================================================
     DM TICKET SYSTEM
  ======================================================= */

  if (message.author.bot) return;

  const guild = client.guilds.cache.get(GUILD_ID);

  if (!guild) {
    await message.reply(
      "The support server is currently unavailable."
    );
    return;
  }

  const config = getConfig(GUILD_ID);

  if (!config.tickets.enabled) {
    await message.reply(
      "The support ticket system is currently disabled."
    );
    return;
  }

  const existing = tickets[message.author.id];

  if (existing) {
    try {
      const channel = await guild.channels.fetch(
        existing.channelId
      );

      if (channel) {
        await channel.send({
          content:
            `📩 **Message from ${message.author.tag}**\n${message.content || "*Attachment/empty message*"}`
        });

        await message.reply(
          "Your message has been added to your existing support ticket."
        );

        return;
      }
    } catch {}

    delete tickets[message.author.id];
    saveJSON(TICKETS_FILE, tickets);
  }

  let category = null;

  if (config.tickets.categoryId) {
    category = guild.channels.cache.get(
      config.tickets.categoryId
    );
  }

  const channel = await guild.channels.create({
    name: `ticket-${message.author.username}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .slice(0, 80),

    type: ChannelType.GuildText,

    parent: category?.id || null,

    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [
          PermissionsBitField.Flags.ViewChannel
        ]
      },
      {
        id: SUPPORT_ADMIN_ROLE_ID,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory
        ]
      }
    ]
  });

  tickets[message.author.id] = {
    channelId: channel.id,
    userId: message.author.id,
    createdAt: new Date().toISOString()
  };

  saveJSON(TICKETS_FILE, tickets);

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel("Close Ticket")
      .setStyle(ButtonStyle.Danger),

    new ButtonBuilder()
      .setCustomId("ticket_claim")
      .setLabel("Claim Ticket")
      .setStyle(ButtonStyle.Primary)
  );

  const embed = new EmbedBuilder()
    .setTitle("🎫 New DM Support Ticket")
    .setDescription(
      `A new ticket has been opened by **${message.author.tag}**.\n\n` +
      `**User ID:** ${message.author.id}\n` +
      `**Initial Message:**\n${message.content || "*Attachment/empty message*"}`
    )
    .setTimestamp();

  await channel.send({
    content: `<@&${SUPPORT_ADMIN_ROLE_ID}>`,
    embeds: [embed],
    components: [buttons]
  });

  await message.reply(
    "🎫 Your support ticket has been created. A staff member will assist you soon."
  );

  await sendLog(
    guild,
    "🎫 Ticket Created",
    `**User:** ${message.author.tag}\n**Ticket:** ${channel}\n**User ID:** ${message.author.id}`
  );
});

/* =========================================================
   GUILD MEMBER ADD
========================================================= */

client.on("guildMemberAdd", async (member) => {
  if (member.guild.id !== GUILD_ID) return;

  await processAntiRaid(member);

  await sendLog(
    member.guild,
    "📥 Member Joined",
    `**User:** ${member.user.tag}\n**ID:** ${member.id}`
  );
});

/* =========================================================
   MESSAGE DELETE LOG
========================================================= */

client.on("messageDelete", async (message) => {
  if (!message.guild || message.author?.bot) return;

  await sendLog(
    message.guild,
    "🗑️ Message Deleted",
    `**Author:** ${message.author?.tag || "Unknown"}\n**Channel:** ${message.channel}\n**Content:** ${message.content || "*Unavailable*"}`
  );
});

/* =========================================================
   MESSAGE UPDATE LOG
========================================================= */

client.on("messageUpdate", async (oldMessage, newMessage) => {
  if (!oldMessage.guild) return;

  if (
    oldMessage.content === newMessage.content ||
    newMessage.author?.bot
  ) {
    return;
  }

  await sendLog(
    oldMessage.guild,
    "✏️ Message Edited",
    `**Author:** ${newMessage.author?.tag || "Unknown"}\n**Channel:** ${newMessage.channel}\n\n**Before:**\n${oldMessage.content || "*Empty*"}\n\n**After:**\n${newMessage.content || "*Empty*"}`
  );
});

/* =========================================================
   SLASH COMMANDS
========================================================= */

const commands = [

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member to warn")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Warning reason")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("View a member's warnings")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("punishments")
    .setDescription("View punishment history")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a member")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("duration")
        .setDescription("Duration in minutes")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(40320)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unban a user")
    .addStringOption(o =>
      o.setName("userid")
        .setDescription("User ID")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("suggest")
    .setDescription("Create a suggestion")
    .addStringOption(o =>
      o.setName("suggestion")
        .setDescription("Your suggestion")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Send an announcement")
    .addStringOption(o =>
      o.setName("message")
        .setDescription("Announcement text")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("automod")
    .setDescription("Configure AutoMod")
    .addSubcommand(s =>
      s.setName("status")
        .setDescription("Show AutoMod status")
    )
    .addSubcommand(s =>
      s.setName("enable")
        .setDescription("Enable AutoMod")
    )
    .addSubcommand(s =>
      s.setName("disable")
        .setDescription("Disable AutoMod")
    )
    .addSubcommand(s =>
      s.setName("invites")
        .setDescription("Toggle invite protection")
        .addBooleanOption(o =>
          o.setName("enabled")
            .setDescription("Enabled")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("spam")
        .setDescription("Toggle spam protection")
        .addBooleanOption(o =>
          o.setName("enabled")
            .setDescription("Enabled")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("mentions")
        .setDescription("Toggle mass mention protection")
        .addBooleanOption(o =>
          o.setName("enabled")
            .setDescription("Enabled")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("badwords")
        .setDescription("Toggle bad-word protection")
        .addBooleanOption(o =>
          o.setName("enabled")
            .setDescription("Enabled")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("caps")
        .setDescription("Toggle caps protection")
        .addBooleanOption(o =>
          o.setName("enabled")
            .setDescription("Enabled")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("repeated")
        .setDescription("Toggle repeated-message protection")
        .addBooleanOption(o =>
          o.setName("enabled")
            .setDescription("Enabled")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("log")
        .setDescription("Set AutoMod log channel")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Log channel")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName("security")
    .setDescription("Configure security")
    .addSubcommand(s =>
      s.setName("status")
        .setDescription("Show security status")
    )
    .addSubcommand(s =>
      s.setName("enable")
        .setDescription("Enable security")
    )
    .addSubcommand(s =>
      s.setName("disable")
        .setDescription("Disable security")
    )
    .addSubcommand(s =>
      s.setName("antiraid")
        .setDescription("Toggle Anti-Raid")
        .addBooleanOption(o =>
          o.setName("enabled")
            .setDescription("Enabled")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("antinuke")
        .setDescription("Toggle Anti-Nuke")
        .addBooleanOption(o =>
          o.setName("enabled")
            .setDescription("Enabled")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("log")
        .setDescription("Set security log channel")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Security log channel")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("trust")
        .setDescription("Trust a user or bot")
        .addUserOption(o =>
          o.setName("user")
            .setDescription("User or bot")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("untrust")
        .setDescription("Remove trusted status")
        .addUserOption(o =>
          o.setName("user")
            .setDescription("User or bot")
            .setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName("config")
    .setDescription("Configure bot systems")
    .addSubcommand(s =>
      s.setName("view")
        .setDescription("View complete configuration")
    )
    .addSubcommand(s =>
      s.setName("suggestions")
        .setDescription("Set suggestion channel")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Suggestion channel")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("announcements")
        .setDescription("Set announcement channel")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Announcement channel")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("ticket-category")
        .setDescription("Set ticket category")
        .addChannelOption(o =>
          o.setName("category")
            .setDescription("Ticket category")
            .addChannelTypes(ChannelType.GuildCategory)
            .setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Manage a support ticket")
    .addSubcommand(s =>
      s.setName("close")
        .setDescription("Close current ticket")
    ),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show bot systems and commands")

].map(command => command.toJSON());

/* =========================================================
   REGISTER COMMANDS
========================================================= */

async function registerCommands() {
  try {
    const rest = new REST({ version: "10" })
      .setToken(TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(
        CLIENT_ID,
        GUILD_ID
      ),
      {
        body: commands
      }
    );

    console.log(
      `Successfully registered ${commands.length} slash commands.`
    );
  } catch (error) {
    console.error(
      "Slash command registration failed:",
      error
    );
  }
}

/* =========================================================
   INTERACTION HANDLER
========================================================= */

client.on("interactionCreate", async (interaction) => {

  if (interaction.isChatInputCommand()) {

    if (!interaction.guild) {
      await interaction.reply({
        content:
          "This command can only be used inside the server.",
        ephemeral: true
      });
      return;
    }

    const guild = interaction.guild;
    const config = getConfig(guild.id);

    /* =====================================================
       HELP
    ===================================================== */

    if (interaction.commandName === "help") {

      const embed = new EmbedBuilder()
        .setTitle("🤖 Bot Command Center")
        .setDescription(
          "Complete DM Ticket, AutoMod, Security, Anti-Nuke, Moderation and Suggestion system."
        )
        .addFields(
          {
            name: "🎫 Tickets",
            value: "`/ticket close`\nDM the bot to create a ticket."
          },
          {
            name: "🛡️ AutoMod",
            value:
              "`/automod status`\n`/automod enable`\n`/automod disable`\n`/automod invites`\n`/automod spam`\n`/automod mentions`\n`/automod badwords`\n`/automod caps`\n`/automod repeated`\n`/automod log`"
          },
          {
            name: "🔐 Security",
            value:
              "`/security status`\n`/security enable`\n`/security disable`\n`/security antiraid`\n`/security antinuke`\n`/security trust`\n`/security untrust`\n`/security log`"
          },
          {
            name: "⚖️ Moderation",
            value:
              "`/warn`\n`/warnings`\n`/punishments`\n`/timeout`\n`/kick`\n`/ban`\n`/unban`"
          },
          {
            name: "📢 Community",
            value:
              "`/announce`\n`/suggest`"
          },
          {
            name: "⚙️ Configuration",
            value:
              "`/config view`\n`/config suggestions`\n`/config announcements`\n`/config ticket-category`"
          }
        )
        .setTimestamp();

      await interaction.reply({
        embeds: [embed],
        ephemeral: true
      });

      return;
    }

    /* =====================================================
       PERMISSION CHECK
    ===================================================== */

    const staffCommands = [
      "warn",
      "warnings",
      "punishments",
      "timeout",
      "kick",
      "ban",
      "unban",
      "announce",
      "automod",
      "security",
      "config"
    ];

    if (
      staffCommands.includes(interaction.commandName) &&
      !isSupport(interaction.member)
    ) {
      await interaction.reply({
        content:
          "❌ You do not have permission to use this command.",
        ephemeral: true
      });
      return;
    }

    /* =====================================================
       WARN
    ===================================================== */

    if (interaction.commandName === "warn") {

      const user =
        interaction.options.getUser("user");

      const reason =
        interaction.options.getString("reason");

      const member =
        await guild.members.fetch(user.id).catch(() => null);

      if (!member) {
        await interaction.reply({
          content: "❌ Member not found.",
          ephemeral: true
        });
        return;
      }

      if (
        member.id === guild.ownerId ||
        member.id === interaction.user.id
      ) {
        await interaction.reply({
          content:
            "❌ You cannot warn this member.",
          ephemeral: true
        });
        return;
      }

      const record = addWarning(
        guild.id,
        user.id,
        interaction.user.id,
        reason
      );

      const count =
        getWarnings(guild.id, user.id).length;

      await interaction.reply({
        content:
          `⚠️ **${user.tag}** has been warned.\n` +
          `**Reason:** ${reason}\n` +
          `**Warning count:** ${count}\n` +
          `**Warning ID:** ${record.id}`
      });

      await sendLog(
        guild,
        "⚠️ Member Warned",
        `**User:** ${user.tag}\n**Moderator:** ${interaction.user.tag}\n**Reason:** ${reason}\n**Warnings:** ${count}`
      );

      await applyWarningEscalation(
        member,
        count,
        interaction.user.id
      );

      return;
    }

    /* =====================================================
       WARNINGS
    ===================================================== */

    if (interaction.commandName === "warnings") {

      const user =
        interaction.options.getUser("user");

      const list =
        getWarnings(guild.id, user.id);

      if (!list.length) {
        await interaction.reply({
          content:
            `✅ ${user.tag} has no warnings.`,
          ephemeral: true
        });
        return;
      }

      const text = list
        .slice(-15)
        .map(
          (w, i) =>
            `**${i + 1}.** ${w.reason}\n` +
            `Moderator: <@${w.moderatorId}>\n` +
            `Date: <t:${Math.floor(
              new Date(w.timestamp).getTime() / 1000
            )}:R>\n` +
            `ID: \`${w.id}\``
        )
        .join("\n\n");

      const embed = new EmbedBuilder()
        .setTitle(`⚠️ Warnings — ${user.tag}`)
        .setDescription(text)
        .setFooter({
          text: `Total warnings: ${list.length}`
        });

      await interaction.reply({
        embeds: [embed],
        ephemeral: true
      });

      return;
    }

    /* =====================================================
       PUNISHMENTS
    ===================================================== */

    if (interaction.commandName === "punishments") {

      const user =
        interaction.options.getUser("user");

      const list =
        getPunishments(guild.id, user.id);

      if (!list.length) {
        await interaction.reply({
          content:
            `✅ ${user.tag} has no punishment history.`,
          ephemeral: true
        });
        return;
      }

      const text = list
        .slice(-15)
        .map(
          (p, i) =>
            `**${i + 1}. ${p.type}**\n` +
            `Reason: ${p.reason || "None"}\n` +
            `Moderator: <@${p.moderatorId}>\n` +
            `Date: <t:${Math.floor(
              new Date(p.timestamp).getTime() / 1000
            )}:R>`
        )
        .join("\n\n");

      const embed = new EmbedBuilder()
        .setTitle(`📋 Punishment History — ${user.tag}`)
        .setDescription(text)
        .setFooter({
          text: `Total records: ${list.length}`
        });

      await interaction.reply({
        embeds: [embed],
        ephemeral: true
      });

      return;
    }

    /* =====================================================
       TIMEOUT
    ===================================================== */

    if (interaction.commandName === "timeout") {

      const user =
        interaction.options.getUser("user");

      const duration =
        interaction.options.getInteger("duration");

      const reason =
        interaction.options.getString("reason") ||
        "No reason provided";

      const member =
        await guild.members.fetch(user.id).catch(() => null);

      if (!member) {
        await interaction.reply({
          content: "❌ Member not found.",
          ephemeral: true
        });
        return;
      }

      if (
        member.id === guild.ownerId ||
        !member.moderatable
      ) {
        await interaction.reply({
          content:
            "❌ I cannot timeout this member.",
          ephemeral: true
        });
        return;
      }

      await member.timeout(
        duration * 60 * 1000,
        reason
      );

      addPunishment(
        guild.id,
        user.id,
        {
          type: "timeout",
          moderatorId: interaction.user.id,
          reason,
          duration: duration * 60
        }
      );

      await interaction.reply(
        `⏱️ **${user.tag}** has been timed out for **${duration} minutes**.\nReason: ${reason}`
      );

      await sendLog(
        guild,
        "⏱️ Member Timeout",
        `**User:** ${user.tag}\n**Moderator:** ${interaction.user.tag}\n**Duration:** ${duration} minutes\n**Reason:** ${reason}`
      );

      return;
    }

    /* =====================================================
       KICK
    ===================================================== */

    if (interaction.commandName === "kick") {

      const user =
        interaction.options.getUser("user");

      const reason =
        interaction.options.getString("reason") ||
        "No reason provided";

      const member =
        await guild.members.fetch(user.id).catch(() => null);

      if (!member || !member.kickable) {
        await interaction.reply({
          content:
            "❌ I cannot kick this member.",
          ephemeral: true
        });
        return;
      }

      await member.kick(reason);

      addPunishment(
        guild.id,
        user.id,
        {
          type: "kick",
          moderatorId: interaction.user.id,
          reason
        }
      );

      await interaction.reply(
        `👢 **${user.tag}** has been kicked.\nReason: ${reason}`
      );

      await sendLog(
        guild,
        "👢 Member Kicked",
        `**User:** ${user.tag}\n**Moderator:** ${interaction.user.tag}\n**Reason:** ${reason}`
      );

      return;
    }

    /* =====================================================
       BAN
    ===================================================== */

    if (interaction.commandName === "ban") {

      const user =
        interaction.options.getUser("user");

      const reason =
        interaction.options.getString("reason") ||
        "No reason provided";

      const member =
        await guild.members.fetch(user.id).catch(() => null);

      if (member && !member.bannable) {
        await interaction.reply({
          content:
            "❌ I cannot ban this member.",
          ephemeral: true
        });
        return;
      }

      await guild.members.ban(user.id, {
        reason
      });

      addPunishment(
        guild.id,
        user.id,
        {
          type: "ban",
          moderatorId: interaction.user.id,
          reason
        }
      );

      await interaction.reply(
        `🔨 **${user.tag}** has been banned.\nReason: ${reason}`
      );

      await sendLog(
        guild,
        "🔨 Member Banned",
        `**User:** ${user.tag}\n**Moderator:** ${interaction.user.tag}\n**Reason:** ${reason}`
      );

      return;
    }

    /* =====================================================
       UNBAN
    ===================================================== */

    if (interaction.commandName === "unban") {

      const userId =
        interaction.options.getString("userid");

      const reason =
        interaction.options.getString("reason") ||
        "No reason provided";

      try {
        const user =
          await client.users.fetch(userId);

        await guild.members.unban(
          userId,
          reason
        );

        addPunishment(
          guild.id,
          userId,
          {
            type: "unban",
            moderatorId: interaction.user.id,
            reason
          }
        );

        await interaction.reply(
          `✅ **${user.tag}** has been unbanned.\nReason: ${reason}`
        );

        await sendLog(
          guild,
          "✅ Member Unbanned",
          `**User:** ${user.tag}\n**Moderator:** ${interaction.user.tag}\n**Reason:** ${reason}`
        );
      } catch {
        await interaction.reply({
          content:
            "❌ User is not banned or the ID is invalid.",
          ephemeral: true
        });
      }

      return;
    }

    /* =====================================================
       SUGGEST
    ===================================================== */

    if (interaction.commandName === "suggest") {

      if (!config.suggestions.enabled) {
        await interaction.reply({
          content:
            "❌ Suggestions are disabled.",
          ephemeral: true
        });
        return;
      }

      const channelId =
        config.suggestions.channelId;

      if (!channelId) {
        await interaction.reply({
          content:
            "❌ Suggestion channel has not been configured.",
          ephemeral: true
        });
        return;
      }

      const channel =
        guild.channels.cache.get(channelId);

      if (!channel) {
        await interaction.reply({
          content:
            "❌ Suggestion channel could not be found.",
          ephemeral: true
        });
        return;
      }

      const suggestion =
        interaction.options.getString("suggestion");

      const embed = new EmbedBuilder()
        .setTitle("💡 New Suggestion")
        .setDescription(suggestion)
        .addFields(
          {
            name: "Submitted by",
            value: `<@${interaction.user.id}>`
          },
          {
            name: "Status",
            value: "🟡 Pending"
          }
        )
        .setFooter({
          text: `Suggestion ID: ${Date.now()}`
        })
        .setTimestamp();

      const buttons =
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("suggest_approve")
            .setLabel("Approve")
            .setStyle(ButtonStyle.Success),

          new ButtonBuilder()
            .setCustomId("suggest_decline")
            .setLabel("Decline")
            .setStyle(ButtonStyle.Danger)
        );

      await channel.send({
        embeds: [embed],
        components: [buttons]
      });

      await interaction.reply({
        content:
          "✅ Your suggestion has been submitted.",
        ephemeral: true
      });

      return;
    }

    /* =====================================================
       ANNOUNCE
    ===================================================== */

    if (interaction.commandName === "announce") {

      const channelId =
        config.announcements.channelId;

      if (!channelId) {
        await interaction.reply({
          content:
            "❌ Announcement channel is not configured.",
          ephemeral: true
        });
        return;
      }

      const channel =
        guild.channels.cache.get(channelId);

      if (!channel) {
        await interaction.reply({
          content:
            "❌ Announcement channel not found.",
          ephemeral: true
        });
        return;
      }

      const message =
        interaction.options.getString("message");

      const embed = new EmbedBuilder()
        .setTitle("📢 Announcement")
        .setDescription(message)
        .setFooter({
          text: `Posted by ${interaction.user.tag}`
        })
        .setTimestamp();

      await channel.send({
        embeds: [embed]
      });

      await interaction.reply({
        content:
          "✅ Announcement sent.",
        ephemeral: true
      });

      return;
    }

    /* =====================================================
       AUTOMOD
    ===================================================== */

    if (interaction.commandName === "automod") {

      const sub =
        interaction.options.getSubcommand();

      if (sub === "status") {

        const a = config.automod;

        const embed = new EmbedBuilder()
          .setTitle("🛡️ AutoMod Status")
          .addFields(
            {
              name: "Master",
              value: a.enabled ? "🟢 Enabled" : "🔴 Disabled"
            },
            {
              name: "Invite Links",
              value: a.invites ? "🟢" : "🔴",
              inline: true
            },
            {
              name: "Spam",
              value: a.spam ? "🟢" : "🔴",
              inline: true
            },
            {
              name: "Mass Mentions",
              value: a.massMentions ? "🟢" : "🔴",
              inline: true
            },
            {
              name: "Bad Words",
              value: a.badWords ? "🟢" : "🔴",
              inline: true
            },
            {
              name: "Caps",
              value: a.caps ? "🟢" : "🔴",
              inline: true
            },
            {
              name: "Repeated Messages",
              value: a.repeatedMessages ? "🟢" : "🔴",
              inline: true
            },
            {
              name: "Action",
              value: a.action
            },
            {
              name: "Log Channel",
              value:
                a.logChannelId
                  ? `<#${a.logChannelId}>`
                  : "Default Support Log"
            }
          );

        await interaction.reply({
          embeds: [embed],
          ephemeral: true
        });

        return;
      }

      if (sub === "enable") {
        config.automod.enabled = true;
      }

      if (sub === "disable") {
        config.automod.enabled = false;
      }

      if (sub === "invites") {
        config.automod.invites =
          interaction.options.getBoolean("enabled");
      }

      if (sub === "spam") {
        config.automod.spam =
          interaction.options.getBoolean("enabled");
      }

      if (sub === "mentions") {
        config.automod.massMentions =
          interaction.options.getBoolean("enabled");
      }

      if (sub === "badwords") {
        config.automod.badWords =
          interaction.options.getBoolean("enabled");
      }

      if (sub === "caps") {
        config.automod.caps =
          interaction.options.getBoolean("enabled");
      }

      if (sub === "repeated") {
        config.automod.repeatedMessages =
          interaction.options.getBoolean("enabled");
      }

      if (sub === "log") {
        config.automod.logChannelId =
          interaction.options.getChannel("channel").id;
      }

      saveJSON(CONFIG_FILE, configs);

      await interaction.reply({
        content:
          `✅ AutoMod setting **${sub}** updated.`,
        ephemeral: true
      });

      return;
    }

    /* =====================================================
       SECURITY
    ===================================================== */

    if (interaction.commandName === "security") {

      const sub =
        interaction.options.getSubcommand();

      if (sub === "status") {

        const s = config.security;

        const embed = new EmbedBuilder()
          .setTitle("🔐 Security Status")
          .addFields(
            {
              name: "Security",
              value: s.enabled ? "🟢 Enabled" : "🔴 Disabled"
            },
            {
              name: "Anti-Raid",
              value: s.antiRaid ? "🟢 Enabled" : "🔴 Disabled"
            },
            {
              name: "Anti-Nuke",
              value: s.antiNuke ? "🟢 Enabled" : "🔴 Disabled"
            },
            {
              name: "Trusted Users",
              value: `${s.trustedUsers.length}`
            },
            {
              name: "Trusted Bots",
              value: `${s.trustedBots.length}`
            },
            {
              name: "Security Log",
              value:
                s.logChannelId
                  ? `<#${s.logChannelId}>`
                  : "Default Support Log"
            }
          );

        await interaction.reply({
          embeds: [embed],
          ephemeral: true
        });

        return;
      }

      if (sub === "enable") {
        config.security.enabled = true;
      }

      if (sub === "disable") {
        config.security.enabled = false;
      }

      if (sub === "antiraid") {
        config.security.antiRaid =
          interaction.options.getBoolean("enabled");
      }

      if (sub === "antinuke") {
        config.security.antiNuke =
          interaction.options.getBoolean("enabled");
      }

      if (sub === "log") {
        config.security.logChannelId =
          interaction.options.getChannel("channel").id;
      }

      if (sub === "trust") {

        const user =
          interaction.options.getUser("user");

        if (user.bot) {
          if (!config.security.trustedBots.includes(user.id)) {
            config.security.trustedBots.push(user.id);
          }
        } else {
          if (!config.security.trustedUsers.includes(user.id)) {
            config.security.trustedUsers.push(user.id);
          }
        }

        await sendLog(
          guild,
          "🤖 Trusted Entity Added",
          `**User:** ${user.tag}\n**Added by:** ${interaction.user.tag}`,
          "security"
        );
      }

      if (sub === "untrust") {

        const user =
          interaction.options.getUser("user");

        config.security.trustedUsers =
          config.security.trustedUsers.filter(
            id => id !== user.id
          );

        config.security.trustedBots =
          config.security.trustedBots.filter(
            id => id !== user.id
          );

        await sendLog(
          guild,
          "🔓 Trusted Entity Removed",
          `**User:** ${user.tag}\n**Removed by:** ${interaction.user.tag}`,
          "security"
        );
      }

      saveJSON(CONFIG_FILE, configs);

      await interaction.reply({
        content:
          `✅ Security setting **${sub}** updated.`,
        ephemeral: true
      });

      return;
    }

    /* =====================================================
       CONFIG
    ===================================================== */

    if (interaction.commandName === "config") {

      const sub =
        interaction.options.getSubcommand();

      if (sub === "view") {

        const embed = new EmbedBuilder()
          .setTitle("⚙️ Complete Bot Configuration")
          .addFields(
            {
              name: "🛡️ AutoMod",
              value:
                `Master: ${config.automod.enabled ? "ON" : "OFF"}\n` +
                `Invites: ${config.automod.invites ? "ON" : "OFF"}\n` +
                `Spam: ${config.automod.spam ? "ON" : "OFF"}\n` +
                `Mentions: ${config.automod.massMentions ? "ON" : "OFF"}\n` +
                `Bad Words: ${config.automod.badWords ? "ON" : "OFF"}\n` +
                `Caps: ${config.automod.caps ? "ON" : "OFF"}\n` +
                `Repeated: ${config.automod.repeatedMessages ? "ON" : "OFF"}`
            },
            {
              name: "🔐 Security",
              value:
                `Security: ${config.security.enabled ? "ON" : "OFF"}\n` +
                `Anti-Raid: ${config.security.antiRaid ? "ON" : "OFF"}\n` +
                `Anti-Nuke: ${config.security.antiNuke ? "ON" : "OFF"}\n` +
                `Trusted Users: ${config.security.trustedUsers.length}\n` +
                `Trusted Bots: ${config.security.trustedBots.length}`
            },
            {
              name: "🎫 Tickets",
              value:
                `Enabled: ${config.tickets.enabled ? "ON" : "OFF"}\n` +
                `Category: ${config.tickets.categoryId ? `<#${config.tickets.categoryId}>` : "Not set"}`
            },
            {
              name: "💡 Suggestions",
              value:
                config.suggestions.channelId
                  ? `<#${config.suggestions.channelId}>`
                  : "Not set"
            },
            {
              name: "📢 Announcements",
              value:
                config.announcements.channelId
                  ? `<#${config.announcements.channelId}>`
                  : "Not set"
            }
          );

        await interaction.reply({
          embeds: [embed],
          ephemeral: true
        });

        return;
      }

      if (sub === "suggestions") {
        config.suggestions.channelId =
          interaction.options.getChannel("channel").id;
      }

      if (sub === "announcements") {
        config.announcements.channelId =
          interaction.options.getChannel("channel").id;
      }

      if (sub === "ticket-category") {
        config.tickets.categoryId =
          interaction.options.getChannel("category").id;
      }

      saveJSON(CONFIG_FILE, configs);

      await interaction.reply({
        content:
          `✅ Configuration **${sub}** updated.`,
        ephemeral: true
      });

      return;
    }

    /* =====================================================
       TICKET COMMAND
    ===================================================== */

    if (interaction.commandName === "ticket") {

      const sub =
        interaction.options.getSubcommand();

      if (sub === "close") {

        if (
          !isSupport(interaction.member)
        ) {
          await interaction.reply({
            content:
              "❌ You need Support Admin permission.",
            ephemeral: true
          });
          return;
        }

        const entry =
          Object.entries(tickets).find(
            ([, value]) =>
              value.channelId === interaction.channel.id
          );

        if (!entry) {
          await interaction.reply({
            content:
              "❌ This channel is not a DM ticket.",
            ephemeral: true
          });
          return;
        }

        const [userId] = entry;

        delete tickets[userId];

        saveJSON(TICKETS_FILE, tickets);

        await sendLog(
          guild,
          "🎫 Ticket Closed",
          `**Closed by:** ${interaction.user.tag}\n**User ID:** ${userId}`
        );

        await interaction.reply(
          "🔒 Ticket closed. This channel will be deleted."
        );

        setTimeout(() => {
          interaction.channel.delete().catch(() => {});
        }, 3000);

        return;
      }
    }
  }

  /* =======================================================
     BUTTONS
  ======================================================= */

  if (interaction.isButton()) {

    if (
      interaction.customId === "ticket_claim"
    ) {

      if (!isSupport(interaction.member)) {
        await interaction.reply({
          content:
            "❌ Only support staff can claim tickets.",
          ephemeral: true
        });
        return;
      }

      await interaction.reply(
        `✅ Ticket claimed by ${interaction.user}.`
      );

      await sendLog(
        interaction.guild,
        "🎫 Ticket Claimed",
        `**Staff:** ${interaction.user.tag}\n**Channel:** ${interaction.channel}`
      );

      return;
    }

    if (
      interaction.customId === "ticket_close"
    ) {

      if (!isSupport(interaction.member)) {
        await interaction.reply({
          content:
            "❌ Only support staff can close tickets.",
          ephemeral: true
        });
        return;
      }

      const entry =
        Object.entries(tickets).find(
          ([, value]) =>
            value.channelId === interaction.channel.id
        );

      if (entry) {
        delete tickets[entry[0]];
        saveJSON(TICKETS_FILE, tickets);
      }

      await interaction.reply(
        "🔒 Ticket closed. Deleting channel..."
      );

      await sendLog(
        interaction.guild,
        "🎫 Ticket Closed",
        `**Closed by:** ${interaction.user.tag}\n**Channel:** ${interaction.channel}`
      );

      setTimeout(() => {
        interaction.channel.delete().catch(() => {});
      }, 2500);

      return;
    }

    /* =====================================================
       SUGGESTION APPROVE
    ===================================================== */

    if (
      interaction.customId === "suggest_approve"
    ) {

      if (!isSupport(interaction.member)) {
        await interaction.reply({
          content:
            "❌ Only staff can approve suggestions.",
          ephemeral: true
        });
        return;
      }

      const embed =
        EmbedBuilder.from(
          interaction.message.embeds[0]
        );

      const fields = embed.data.fields || [];

      const statusField =
        fields.find(
          field => field.name === "Status"
        );

      if (statusField) {
        statusField.value = "🟢 Approved";
      }

      embed.setFields(fields);

      const disabledButtons =
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("suggest_approved")
            .setLabel("Approved")
            .setStyle(ButtonStyle.Success)
            .setDisabled(true)
        );

      await interaction.update({
        embeds: [embed],
        components: [disabledButtons]
      });

      await sendLog(
        interaction.guild,
        "💡 Suggestion Approved",
        `**Approved by:** ${interaction.user.tag}\n**Suggestion:** ${embed.data.description || "Unknown"}`
      );

      return;
    }

    /* =====================================================
       SUGGESTION DECLINE
    ===================================================== */

    if (
      interaction.customId === "suggest_decline"
    ) {

      if (!isSupport(interaction.member)) {
        await interaction.reply({
          content:
            "❌ Only staff can decline suggestions.",
          ephemeral: true
        });
        return;
      }

      const embed =
        EmbedBuilder.from(
          interaction.message.embeds[0]
        );

      const fields = embed.data.fields || [];

      const statusField =
        fields.find(
          field => field.name === "Status"
        );

      if (statusField) {
        statusField.value = "🔴 Declined";
      }

      embed.setFields(fields);

      const disabledButtons =
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("suggest_declined")
            .setLabel("Declined")
            .setStyle(ButtonStyle.Danger)
            .setDisabled(true)
        );

      await interaction.update({
        embeds: [embed],
        components: [disabledButtons]
      });

      await sendLog(
        interaction.guild,
        "💡 Suggestion Declined",
        `**Declined by:** ${interaction.user.tag}\n**Suggestion:** ${embed.data.description || "Unknown"}`
      );

      return;
    }
  }
});

/* =========================================================
   ERROR HANDLERS
========================================================= */

client.on("error", error => {
  console.error("Discord client error:", error);
});

process.on("unhandledRejection", error => {
  console.error("Unhandled rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("Uncaught exception:", error);
});

/* =========================================================
   READY
========================================================= */

client.once("ready", async () => {

  console.log("==========================================");
  console.log(`Bot: ${client.user.tag}`);
  console.log(`Guild: ${GUILD_ID}`);
  console.log("DM Tickets: ENABLED");
  console.log("Advanced AutoMod: ENABLED");
  console.log("Anti-Raid: ENABLED");
  console.log("Anti-Nuke: ENABLED");
  console.log("Moderation History: ENABLED");
  console.log("Suggestions: ENABLED");
  console.log("Persistent Storage: ENABLED");
  console.log("==========================================");

  await registerCommands();

  client.user.setPresence({
    activities: [
      {
        name: "DM Support • AutoMod • Security",
        type: 3
      }
    ],
    status: "online"
  });
});

/* =========================================================
   LOGIN
========================================================= */

client.login(TOKEN);
