/*
===========================================================
 GRA LEGENDS - MULTI SERVER DISCORD MANAGEMENT BOT
 SINGLE FILE VERSION
===========================================================

 REQUIRED ENVIRONMENT VARIABLES:
 DISCORD_TOKEN=your_bot_token
 CLIENT_ID=your_application_id

 OPTIONAL:
 NODE_ENV=production

 IMPORTANT:
 - No GUILD_ID is required.
 - No channel/role IDs are required.
 - Everything is configured per server with slash commands.
 - Persistent configuration is stored in ./data/database.json
 - Cross-server Admin Server logging is configured with /logs.
===========================================================
*/

const fs = require("fs");
const path = require("path");

const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionsBitField,
  AuditLogEvent
} = require("discord.js");

/* =========================================================
   BASIC CONFIG
========================================================= */

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error("ERROR: DISCORD_TOKEN or CLIENT_ID is missing.");
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "database.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let db = {};

if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch (err) {
    console.error("Could not read database.json. Starting fresh.");
    db = {};
  }
}

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (err) {
    console.error("Database save error:", err);
  }
}

/* =========================================================
   DEFAULT SERVER CONFIGURATION
========================================================= */

function defaultGuild() {
  return {
    createdAt: Date.now(),

    automod: {
      enabled: true,
      invites: true,
      spam: true,
      caps: true,
      badwords: true,
      repeated: true,
      mentions: true,
      links: false,

      maxMentions: 5,
      maxCapsPercent: 70,
      spamMessages: 5,
      spamWindow: 7000,
      repeatedMessages: 3,
      repeatedWindow: 15000,

      badWords: [],
      logChannel: null
    },

    autotimeout: {
      enabled: true,
      strikes: 3,
      minutes: 10
    },

    security: {
      enabled: true,
      antiRaid: true,
      antiNuke: true,
      antiWebhook: true,
      antiBotAdd: true,

      joinLimit: 8,
      joinWindow: 10000,

      lockdown: false,
      raidMode: false
    },

    trusted: {
      users: [],
      bots: []
    },

    roleProtect: {
      enabled: true,
      protectedRoles: [],
      timeoutMinutes: 60
    },

    logs: {
      general: null,
      moderation: null,
      security: null,
      automod: null,
      audit: null,
      tickets: null,
      joins: null,
      leaves: null,
      messages: null,
      roles: null,
      channels: null,
      webhooks: null,
      bots: null,
      suggestions: null,
      announcements: null,
      configuration: null,
      errors: null,

      /*
        CROSS SERVER ADMIN LOGGING

        adminServerId:
          The server where centralized logs are stored.

        destinations:
          {
             logType: channelId
          }

        This allows every server to send its logs
        to channels located in your Admin Server.
      */
      adminServerId: null,
      destinations: {}
    },

    tickets: {
      enabled: true,
      category: null,
      supportRole: null,
      logChannel: null,
      transcript: true,
      dmEnabled: true,
      panelChannel: null,
      panelMessage: null
    },

    suggestions: {
      enabled: true,
      channel: null,
      staffRole: null
    },

    announcements: {
      channel: null,
      role: null,
      image: null,
      footer: "Official Announcement"
    },

    warnings: {},
    punishments: {},
    ticketsData: {},
    suggestionsData: {},

    stats: {
      commands: 0,
      messages: 0,
      joins: 0,
      leaves: 0
    }
  };
}

function getGuild(guildId) {
  if (!db[guildId]) {
    db[guildId] = defaultGuild();
    saveDB();
  }

  const g = db[guildId];

  /* Migration / safety */
  if (!g.automod) g.automod = defaultGuild().automod;
  if (!g.autotimeout) g.autotimeout = defaultGuild().autotimeout;
  if (!g.security) g.security = defaultGuild().security;
  if (!g.trusted) g.trusted = defaultGuild().trusted;
  if (!g.roleProtect) g.roleProtect = defaultGuild().roleProtect;
  if (!g.logs) g.logs = defaultGuild().logs;
  if (!g.tickets) g.tickets = defaultGuild().tickets;
  if (!g.suggestions) g.suggestions = defaultGuild().suggestions;
  if (!g.announcements) g.announcements = defaultGuild().announcements;

  if (!g.warnings) g.warnings = {};
  if (!g.punishments) g.punishments = {};
  if (!g.ticketsData) g.ticketsData = {};
  if (!g.suggestionsData) g.suggestionsData = {};

  if (!g.logs.destinations) g.logs.destinations = {};

  if (!g.stats) {
    g.stats = {
      commands: 0,
      messages: 0,
      joins: 0,
      leaves: 0
    };
  }

  return g;
}

function resetGuild(guildId) {
  db[guildId] = defaultGuild();
  saveDB();
  return db[guildId];
}

/* =========================================================
   DATABASE HELPERS
========================================================= */

function addWarning(guildId, userId, reason, moderatorId) {
  const g = getGuild(guildId);

  if (!g.warnings[userId]) {
    g.warnings[userId] = [];
  }

  const entry = {
    reason,
    moderatorId,
    timestamp: Date.now()
  };

  g.warnings[userId].push(entry);

  if (!g.punishments[userId]) {
    g.punishments[userId] = [];
  }

  g.punishments[userId].push({
    type: "warn",
    reason,
    moderatorId,
    timestamp: Date.now()
  });

  saveDB();

  return g.warnings[userId].length;
}

function addPunishment(guildId, userId, type, reason, moderatorId) {
  const g = getGuild(guildId);

  if (!g.punishments[userId]) {
    g.punishments[userId] = [];
  }

  g.punishments[userId].push({
    type,
    reason,
    moderatorId,
    timestamp: Date.now()
  });

  saveDB();
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
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.DirectMessages
  ],

  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User,
    Partials.GuildMember
  ]
});

/* =========================================================
   TRACKERS
========================================================= */

const messageTracker = new Map();
const joinsTracker = new Map();

/* =========================================================
   GENERAL HELPERS
========================================================= */

function cleanReason(reason) {
  return String(reason || "No reason provided.").slice(0, 500);
}

function durationMs(minutes) {
  return minutes * 60 * 1000;
}

function percentCaps(text) {
  const letters = text.match(/[A-Za-z]/g);

  if (!letters || !letters.length) {
    return 0;
  }

  const caps = text.match(/[A-Z]/g) || [];

  return Math.round((caps.length / letters.length) * 100);
}

function containsInvite(content) {
  return /(?:discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\//i.test(
    content
  );
}

function isTextChannel(channel) {
  return channel && channel.isTextBased();
}

function isAdmin(member) {
  if (!member) return false;

  return member.permissions?.has(
    PermissionsBitField.Flags.Administrator
  );
}

function hasManageGuild(member) {
  if (!member) return false;

  return (
    member.permissions?.has(PermissionsBitField.Flags.Administrator) ||
    member.permissions?.has(PermissionsBitField.Flags.ManageGuild)
  );
}

function isTrusted(guild, userId) {
  if (!guild) return false;

  const g = getGuild(guild.id);

  return (
    userId === guild.ownerId ||
    g.trusted.users.includes(userId)
  );
}

function isTrustedBot(guild, userId) {
  if (!guild) return false;

  const g = getGuild(guild.id);

  return (
    isTrusted(guild, userId) ||
    g.trusted.bots.includes(userId)
  );
}

function getConfiguredChannel(guild, id) {
  if (!guild || !id) return null;

  return guild.channels.cache.get(id) || null;
}

/* =========================================================
   LOG SYSTEM
========================================================= */

/*
  The log system supports two destinations:

  1. Local server channel
  2. Central Admin Server channel

  If a central destination exists, the bot sends the log there.
*/

const LOG_TYPES = [
  "general",
  "moderation",
  "security",
  "automod",
  "audit",
  "tickets",
  "joins",
  "leaves",
  "messages",
  "roles",
  "channels",
  "webhooks",
  "bots",
  "suggestions",
  "announcements",
  "configuration",
  "errors"
];

function getLogChannel(guild, type) {
  const g = getGuild(guild.id);

  const localId =
    g.logs[type] ||
    null;

  if (localId) {
    const local = guild.channels.cache.get(localId);

    if (local && isTextChannel(local)) {
      return local;
    }
  }

  return null;
}

async function getCentralLogChannel(guild, type) {
  try {
    const g = getGuild(guild.id);

    const adminServerId = g.logs.adminServerId;

    if (!adminServerId) {
      return null;
    }

    const adminGuild =
      client.guilds.cache.get(adminServerId);

    if (!adminGuild) {
      return null;
    }

    const channelId =
      g.logs.destinations[type] ||
      g.logs.destinations.general;

    if (!channelId) {
      return null;
    }

    const channel =
      adminGuild.channels.cache.get(channelId);

    if (!channel || !isTextChannel(channel)) {
      return null;
    }

    return channel;
  } catch {
    return null;
  }
}

async function sendLog(
  guild,
  type,
  title,
  description,
  color = 0x5865f2
) {
  try {
    if (!guild) return;

    const g = getGuild(guild.id);

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(description || "No details.")
      .addFields(
        {
          name: "Server",
          value: `${guild.name} (${guild.id})`
        },
        {
          name: "Log Type",
          value: type
        }
      )
      .setTimestamp();

    /* Local server log */
    const localChannel = getLogChannel(guild, type);

    if (localChannel) {
      await localChannel
        .send({ embeds: [embed] })
        .catch(() => {});
    }

    /* Central Admin Server log */
    const centralChannel =
      await getCentralLogChannel(guild, type);

    if (
      centralChannel &&
      centralChannel.id !== localChannel?.id
    ) {
      await centralChannel
        .send({ embeds: [embed] })
        .catch(() => {});
    }

    /* General fallback */
    if (!localChannel && !centralChannel) {
      const general =
        guild.channels.cache.get(g.logs.general);

      if (general && isTextChannel(general)) {
        await general
          .send({ embeds: [embed] })
          .catch(() => {});
      }
    }
  } catch (err) {
    console.error("sendLog error:", err);
  }
}

/* =========================================================
   MODERATION HELPERS
========================================================= */

async function timeoutMember(member, minutes, reason) {
  if (!member?.moderatable) {
    return false;
  }

  try {
    await member.timeout(
      durationMs(minutes),
      cleanReason(reason)
    );

    return true;
  } catch {
    return false;
  }
}

async function makeTranscript(channel) {
  try {
    const messages =
      await channel.messages.fetch({
        limit: 100
      });

    return [...messages.values()]
      .reverse()
      .map(
        m =>
          `[${new Date(
            m.createdTimestamp
          ).toISOString()}] ${m.author.tag}: ${m.content}`
      )
      .join("\n");
  } catch {
    return "Unable to create transcript.";
  }
}

function trackMessage(userId, content) {
  const now = Date.now();

  if (!messageTracker.has(userId)) {
    messageTracker.set(userId, []);
  }

  const arr = messageTracker.get(userId);

  arr.push({
    content,
    timestamp: now
  });

  while (
    arr.length &&
    now - arr[0].timestamp > 30000
  ) {
    arr.shift();
  }

  return arr;
}

/* =========================================================
   AUTOMOD
========================================================= */

async function processAutoMod(message) {
  if (!message.guild) return;
  if (message.author.bot) return;

  const g = getGuild(message.guild.id);

  g.stats.messages++;

  if (
    !g.automod.enabled ||
    isTrusted(message.guild, message.author.id)
  ) {
    return;
  }

  const content = message.content || "";
  const lower = content.toLowerCase();

  let violation = null;

  if (
    g.automod.invites &&
    containsInvite(content)
  ) {
    violation = "Discord invite link";
  }

  if (
    !violation &&
    g.automod.badwords &&
    g.automod.badWords.some(word =>
      lower.includes(String(word).toLowerCase())
    )
  ) {
    violation = "Blocked word";
  }

  if (
    !violation &&
    g.automod.caps &&
    content.length >= 10 &&
    percentCaps(content) >=
      g.automod.maxCapsPercent
  ) {
    violation = "Excessive capital letters";
  }

  const history = trackMessage(
    message.author.id,
    content
  );

  if (
    !violation &&
    g.automod.repeated
  ) {
    const recent =
      history.filter(
        x =>
          Date.now() - x.timestamp <=
          g.automod.repeatedWindow
      );

    if (
      recent.filter(
        x => x.content === content
      ).length >=
      g.automod.repeatedMessages
    ) {
      violation = "Repeated messages";
    }
  }

  if (
    !violation &&
    g.automod.spam
  ) {
    const recent =
      history.filter(
        x =>
          Date.now() - x.timestamp <=
          g.automod.spamWindow
      );

    if (
      recent.length >=
      g.automod.spamMessages
    ) {
      violation = "Spam/flood";
    }
  }

  if (
    !violation &&
    g.automod.mentions &&
    message.mentions.users.size >=
      g.automod.maxMentions
  ) {
    violation = "Excessive mentions";
  }

  if (
    !violation &&
    g.automod.links &&
    /(https?:\/\/|www\.)/i.test(content)
  ) {
    violation = "Unauthorized link";
  }

  if (!violation) return;

  try {
    await message.delete();
  } catch {}

  const strikes = addWarning(
    message.guild.id,
    message.author.id,
    `AutoMod: ${violation}`,
    client.user.id
  );

  await sendLog(
    message.guild,
    "automod",
    "🛡️ AutoMod Action",
    `**User:** ${message.author.tag}\n` +
      `**User ID:** ${message.author.id}\n` +
      `**Violation:** ${violation}\n` +
      `**Strikes:** ${strikes}`,
    0xed4245
  );

  if (
    g.autotimeout.enabled &&
    strikes >= g.autotimeout.strikes
  ) {
    const member =
      await message.guild.members
        .fetch(message.author.id)
        .catch(() => null);

    if (member) {
      const success =
        await timeoutMember(
          member,
          g.autotimeout.minutes,
          `AutoMod escalation: ${violation}`
        );

      if (success) {
        addPunishment(
          message.guild.id,
          message.author.id,
          "auto-timeout",
          violation,
          client.user.id
        );

        await sendLog(
          message.guild,
          "moderation",
          "⏱️ Auto-timeout",
          `**User:** ${message.author.tag}\n` +
            `**Duration:** ${g.autotimeout.minutes} minutes\n` +
            `**Reason:** ${violation}`,
          0xfaa61a
        );
      }
    }
  }

  saveDB();
}

/* =========================================================
   RAID PROTECTION
========================================================= */

async function processJoin(member) {
  const guild = member.guild;
  const g = getGuild(guild.id);

  g.stats.joins++;

  if (
    !g.security.enabled ||
    !g.security.antiRaid ||
    isTrusted(guild, member.id)
  ) {
    saveDB();
    return;
  }

  const now = Date.now();

  if (!joinsTracker.has(guild.id)) {
    joinsTracker.set(guild.id, []);
  }

  const arr = joinsTracker.get(guild.id);

  arr.push(now);

  while (
    arr.length &&
    now - arr[0] >
      g.security.joinWindow
  ) {
    arr.shift();
  }

  if (
    arr.length >=
    g.security.joinLimit
  ) {
    g.security.raidMode = true;

    await sendLog(
      guild,
      "security",
      "🚨 Anti-Raid Triggered",
      `**Recent joins:** ${arr.length}\n` +
        `**Limit:** ${g.security.joinLimit}\n` +
        `**Window:** ${g.security.joinWindow}ms\n` +
        `Raid mode has been enabled.`,
      0xed4245
    );

    saveDB();
  }
}

/* =========================================================
   TICKET HELPERS
========================================================= */

function isTicketChannel(channel) {
  if (!channel?.guild) return false;

  const g = getGuild(channel.guild.id);

  return Boolean(
    g.ticketsData[channel.id]
  );
}

function isTicketStaff(member, guildConfig) {
  if (!member) return false;

  if (isAdmin(member)) return true;

  if (
    guildConfig.tickets.supportRole &&
    member.roles.cache.has(
      guildConfig.tickets.supportRole
    )
  ) {
    return true;
  }

  return false;
}

async function createTicket(
  guild,
  user,
  source = "panel"
) {
  const g = getGuild(guild.id);

  if (!g.tickets.enabled) {
    return null;
  }

  const existing =
    Object.values(g.ticketsData)
      .find(
        t =>
          t.userId === user.id &&
          t.status === "open"
      );

  if (existing) {
    return guild.channels.cache.get(
      existing.channelId
    );
  }

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [
        PermissionsBitField.Flags.ViewChannel
      ]
    },
    {
      id: user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    }
  ];

  if (g.tickets.supportRole) {
    overwrites.push({
      id: g.tickets.supportRole,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageMessages
      ]
    });
  }

  const channel =
    await guild.channels.create({
      name:
        `ticket-${user.username}`
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "")
          .slice(0, 90) ||
        `ticket-${user.id}`,
      type: ChannelType.GuildText,
      parent: g.tickets.category || null,
      permissionOverwrites: overwrites
    });

  g.ticketsData[channel.id] = {
    channelId: channel.id,
    userId: user.id,
    status: "open",
    claimedBy: null,
    locked: false,
    createdAt: Date.now(),
    source
  };

  saveDB();

  const embed =
    new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🎫 Support Ticket")
      .setDescription(
        `Welcome <@${user.id}>!\n\n` +
        `A member of the support team will assist you shortly.`
      )
      .setTimestamp();

  const row =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId("ticket_claim")
          .setLabel("Claim")
          .setEmoji("🙋")
          .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
          .setCustomId("ticket_lock")
          .setLabel("Lock")
          .setEmoji("🔒")
          .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
          .setCustomId("ticket_close")
          .setLabel("Close")
          .setEmoji("🔒")
          .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
          .setCustomId("ticket_delete")
          .setLabel("Delete")
          .setEmoji("🗑️")
          .setStyle(ButtonStyle.Danger)
      );

  const mention =
    g.tickets.supportRole
      ? `<@${user.id}> <@&${g.tickets.supportRole}>`
      : `<@${user.id}>`;

  await channel.send({
    content: mention,
    embeds: [embed],
    components: [row]
  });

  await sendLog(
    guild,
    "tickets",
    "🎫 Ticket Created",
    `**User:** <@${user.id}>\n` +
      `**Channel:** ${channel}\n` +
      `**Source:** ${source}`
  );

  return channel;
}

async function closeTicket(interaction) {
  if (!interaction.guild) {
    return interaction.reply({
      content: "❌ This command can only be used in a server.",
      ephemeral: true
    });
  }

  const g =
    getGuild(interaction.guild.id);

  const ticket =
    g.ticketsData[interaction.channelId];

  if (!ticket) {
    return interaction.reply({
      content: "❌ This is not a ticket.",
      ephemeral: true
    });
  }

  if (
    !isTicketStaff(
      interaction.member,
      g
    ) &&
    interaction.user.id !== ticket.userId
  ) {
    return interaction.reply({
      content: "❌ You cannot close this ticket.",
      ephemeral: true
    });
  }

  await interaction.reply(
    "🔒 Closing ticket..."
  );

  const transcript =
    await makeTranscript(
      interaction.channel
    );

  ticket.status = "closed";
  ticket.closedAt = Date.now();

  saveDB();

  const logChannel =
    interaction.guild.channels.cache.get(
      g.tickets.logChannel
    );

  if (logChannel) {
    await logChannel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("🎫 Ticket Closed")
          .setDescription(
            `**Channel:** ${interaction.channel.name}\n` +
            `**Owner:** <@${ticket.userId}>\n` +
            `**Closed by:** ${interaction.user}`
          )
          .setTimestamp()
      ]
    }).catch(() => {});

    if (g.tickets.transcript) {
      await logChannel.send({
        files: [
          {
            attachment:
              Buffer.from(transcript),
            name:
              `${interaction.channel.name}-transcript.txt`
          }
        ]
      }).catch(() => {});
    }
  }

  await sendLog(
    interaction.guild,
    "tickets",
    "🔒 Ticket Closed",
    `**Channel:** ${interaction.channel.name}\n` +
      `**Owner:** <@${ticket.userId}>\n` +
      `**Closed by:** ${interaction.user}`
  );

  setTimeout(() => {
    interaction.channel.delete()
      .catch(() => {});
  }, 2000);
}

async function deleteTicket(interaction) {
  if (!interaction.guild) return;

  const g =
    getGuild(interaction.guild.id);

  const ticket =
    g.ticketsData[interaction.channelId];

  if (!ticket) {
    return interaction.reply({
      content: "❌ This is not a ticket.",
      ephemeral: true
    });
  }

  if (
    !isTicketStaff(
      interaction.member,
      g
    )
  ) {
    return interaction.reply({
      content: "❌ Staff only.",
      ephemeral: true
    });
  }

  await interaction.reply(
    "🗑️ Deleting ticket..."
  );

  ticket.status = "deleted";
  ticket.deletedAt = Date.now();
  ticket.deletedBy = interaction.user.id;

  saveDB();

  await sendLog(
    interaction.guild,
    "tickets",
    "🗑️ Ticket Deleted",
    `**Channel:** ${interaction.channel.name}\n` +
      `**Owner:** <@${ticket.userId}>\n` +
      `**Deleted by:** ${interaction.user}`
  );

  setTimeout(() => {
    interaction.channel.delete()
      .catch(() => {});
  }, 1000);
}

/* =========================================================
   SLASH COMMAND DEFINITIONS
========================================================= */

const commands = [];

/* General */

commands.push(
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Check bot latency."),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show all bot commands."),

  new SlashCommandBuilder()
    .setName("botinfo")
    .setDescription("Show bot information."),

  new SlashCommandBuilder()
    .setName("serverinfo")
    .setDescription("Show server information."),

  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription("Show user information.")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("avatar")
    .setDescription("Show a user's avatar.")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("uptime")
    .setDescription("Show bot uptime.")
);

/* Moderation */

commands.push(
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member.")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("Show a member's warnings.")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("warnings-clear")
    .setDescription("Clear a member's warnings.")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("punishments")
    .setDescription("Show punishment history.")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member.")
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
    .setDescription("Ban a member.")
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
    .setDescription("Unban a user.")
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
    .setName("timeout")
    .setDescription("Timeout a member.")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("minutes")
        .setDescription("Minutes")
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
    .setName("untimeout")
    .setDescription("Remove a timeout.")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Delete messages.")
    .addIntegerOption(o =>
      o.setName("amount")
        .setDescription("1-100")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    ),

  new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Set channel slowmode.")
    .addIntegerOption(o =>
      o.setName("seconds")
        .setDescription("0-21600")
        .setRequired(true)
        .setMinValue(0)
        .setMaxValue(21600)
    ),

  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Lock the current channel."),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Unlock the current channel.")
);

/* AutoMod */

commands.push(
  new SlashCommandBuilder()
    .setName("automod")
    .setDescription("View or control AutoMod.")
    .addStringOption(o =>
      o.setName("action")
        .setDescription("Action")
        .setRequired(true)
        .addChoices(
          { name: "status", value: "status" },
          { name: "enable", value: "enable" },
          { name: "disable", value: "disable" }
        )
    ),

  new SlashCommandBuilder()
    .setName("automod-config")
    .setDescription("Configure AutoMod.")
    .addStringOption(o =>
      o.setName("feature")
        .setDescription("Feature")
        .setRequired(true)
        .addChoices(
          { name: "invites", value: "invites" },
          { name: "spam", value: "spam" },
          { name: "caps", value: "caps" },
          { name: "badwords", value: "badwords" },
          { name: "repeated", value: "repeated" },
          { name: "mentions", value: "mentions" },
          { name: "links", value: "links" }
        )
    )
    .addBooleanOption(o =>
      o.setName("enabled")
        .setDescription("Enabled?")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("automod-logs")
    .setDescription("Set AutoMod log channel.")
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Log channel")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("automod-word")
    .setDescription("Add a blocked word.")
    .addStringOption(o =>
      o.setName("word")
        .setDescription("Word")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("automod-word-remove")
    .setDescription("Remove a blocked word.")
    .addStringOption(o =>
      o.setName("word")
        .setDescription("Word")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("autotimeout")
    .setDescription("Control automatic timeout.")
    .addStringOption(o =>
      o.setName("action")
        .setDescription("Action")
        .setRequired(true)
        .addChoices(
          { name: "status", value: "status" },
          { name: "enable", value: "enable" },
          { name: "disable", value: "disable" }
        )
    ),

  new SlashCommandBuilder()
    .setName("autotimeout-config")
    .setDescription("Configure automatic timeout.")
    .addIntegerOption(o =>
      o.setName("strikes")
        .setDescription("Strikes")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(20)
    )
    .addIntegerOption(o =>
      o.setName("minutes")
        .setDescription("Minutes")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(40320)
    )
);

/* Security */

commands.push(
  new SlashCommandBuilder()
    .setName("security")
    .setDescription("Security control.")
    .addStringOption(o =>
      o.setName("action")
        .setDescription("Action")
        .setRequired(true)
        .addChoices(
          { name: "status", value: "status" },
          { name: "enable", value: "enable" },
          { name: "disable", value: "disable" },
          { name: "lockdown", value: "lockdown" },
          { name: "unlockdown", value: "unlockdown" }
        )
    ),

  new SlashCommandBuilder()
    .setName("security-config")
    .setDescription("Configure security.")
    .addBooleanOption(o =>
      o.setName("anti_raid")
        .setDescription("Anti-raid")
        .setRequired(true)
    )
    .addBooleanOption(o =>
      o.setName("anti_nuke")
        .setDescription("Anti-nuke")
        .setRequired(true)
    )
    .addBooleanOption(o =>
      o.setName("anti_webhook")
        .setDescription("Anti-webhook")
        .setRequired(true)
    )
    .addBooleanOption(o =>
      o.setName("anti_bot")
        .setDescription("Anti-bot add")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("raidmode")
    .setDescription("Control raid mode.")
    .addStringOption(o =>
      o.setName("action")
        .setDescription("Action")
        .setRequired(true)
        .addChoices(
          { name: "on", value: "on" },
          { name: "off", value: "off" },
          { name: "status", value: "status" }
        )
    ),

  new SlashCommandBuilder()
    .setName("raidmode-config")
    .setDescription("Configure raid detection.")
    .addIntegerOption(o =>
      o.setName("joins")
        .setDescription("Maximum joins")
        .setRequired(true)
        .setMinValue(2)
        .setMaxValue(100)
    )
    .addIntegerOption(o =>
      o.setName("seconds")
        .setDescription("Detection window")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(60)
    ),

  new SlashCommandBuilder()
    .setName("antinuke")
    .setDescription("Anti-nuke control.")
    .addStringOption(o =>
      o.setName("action")
        .setDescription("Action")
        .setRequired(true)
        .addChoices(
          { name: "status", value: "status" },
          { name: "enable", value: "enable" },
          { name: "disable", value: "disable" }
        )
    ),

  new SlashCommandBuilder()
    .setName("antinuke-config")
    .setDescription("Configure anti-nuke.")
    .addBooleanOption(o =>
      o.setName("enabled")
        .setDescription("Enabled")
        .setRequired(true)
    )
);

/* Trusted */

commands.push(
  new SlashCommandBuilder()
    .setName("trusted")
    .setDescription("Show trusted users and bots."),

  new SlashCommandBuilder()
    .setName("trusted-add")
    .setDescription("Trust a user.")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User")
        .setRequired(true)
    )
    .addBooleanOption(o =>
      o.setName("bot")
        .setDescription("Is this a bot?")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("trusted-remove")
    .setDescription("Remove trusted user/bot.")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("trusted-list")
    .setDescription("List trusted users and bots.")
);

/* Role Protection */

commands.push(
  new SlashCommandBuilder()
    .setName("roleprotect")
    .setDescription("Role protection control.")
    .addStringOption(o =>
      o.setName("action")
        .setDescription("Action")
        .setRequired(true)
        .addChoices(
          { name: "status", value: "status" },
          { name: "enable", value: "enable" },
          { name: "disable", value: "disable" }
        )
    ),

  new SlashCommandBuilder()
    .setName("roleprotect-add")
    .setDescription("Protect a role.")
    .addRoleOption(o =>
      o.setName("role")
        .setDescription("Role")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("roleprotect-remove")
    .setDescription("Remove protected role.")
    .addRoleOption(o =>
      o.setName("role")
        .setDescription("Role")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("roleprotect-list")
    .setDescription("List protected roles."),

  new SlashCommandBuilder()
    .setName("roleprotect-config")
    .setDescription("Configure protected-role timeout.")
    .addIntegerOption(o =>
      o.setName("minutes")
        .setDescription("Minutes")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(40320)
    )
);

/* =========================================================
   NEW /LOG SYSTEM
========================================================= */

commands.push(
  new SlashCommandBuilder()
    .setName("logs")
    .setDescription("Configure local or cross-server logs.")
    .addStringOption(o =>
      o.setName("type")
        .setDescription("Log type")
        .setRequired(true)
        .addChoices(
          ...LOG_TYPES.map(x => ({
            name: x,
            value: x
          }))
        )
    )
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription(
          "Destination channel. Can be in the Admin Server."
        )
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addBooleanOption(o =>
      o.setName("central")
        .setDescription(
          "Use this as the central Admin Server destination?"
        )
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("logs-config")
    .setDescription("View complete logging configuration."),

  new SlashCommandBuilder()
    .setName("audit")
    .setDescription("Show recent Discord audit activity."),

  new SlashCommandBuilder()
    .setName("audit-config")
    .setDescription("Set central audit log channel.")
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Audit channel")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("modlogs")
    .setDescription("Show moderation log configuration."),

  new SlashCommandBuilder()
    .setName("security-logs")
    .setDescription("Show security log configuration.")
);

/* Tickets */

commands.push(
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Open a support ticket."),

  new SlashCommandBuilder()
    .setName("ticket-panel")
    .setDescription("Create ticket panel.")
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Panel channel")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ticket-close")
    .setDescription("Close current ticket."),

  new SlashCommandBuilder()
    .setName("ticket-delete")
    .setDescription("Delete current ticket."),

  new SlashCommandBuilder()
    .setName("ticket-add")
    .setDescription("Add member to ticket.")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ticket-remove")
    .setDescription("Remove member from ticket.")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ticket-claim")
    .setDescription("Claim current ticket."),

  new SlashCommandBuilder()
    .setName("ticket-transcript")
    .setDescription("Create ticket transcript."),

  new SlashCommandBuilder()
    .setName("ticket-lock")
    .setDescription("Lock current ticket."),

  new SlashCommandBuilder()
    .setName("ticket-unlock")
    .setDescription("Unlock current ticket."),

  new SlashCommandBuilder()
    .setName("ticket-rename")
    .setDescription("Rename current ticket.")
    .addStringOption(o =>
      o.setName("name")
        .setDescription("New name")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ticket-config")
    .setDescription("Configure tickets.")
    .addRoleOption(o =>
      o.setName("support_role")
        .setDescription("Support role")
        .setRequired(false)
    )
    .addChannelOption(o =>
      o.setName("category")
        .setDescription("Ticket category")
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(false)
    )
    .addChannelOption(o =>
      o.setName("log_channel")
        .setDescription("Ticket log channel")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
);

/* Suggestions */

commands.push(
  new SlashCommandBuilder()
    .setName("suggest")
    .setDescription("Submit a suggestion.")
    .addStringOption(o =>
      o.setName("suggestion")
        .setDescription("Suggestion")
        .setRequired(true)
        .setMaxLength(1000)
    ),

  new SlashCommandBuilder()
    .setName("suggest-config")
    .setDescription("Configure suggestions.")
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Suggestion channel")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addRoleOption(o =>
      o.setName("staff_role")
        .setDescription("Staff role")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("suggestions")
    .setDescription("Show suggestion configuration.")
);

/* Announcements */

commands.push(
  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Create an announcement.")
    .addStringOption(o =>
      o.setName("title")
        .setDescription("Title")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("message")
        .setDescription("Message")
        .setRequired(true)
        .setMaxLength(4000)
    )
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Destination")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addRoleOption(o =>
      o.setName("role")
        .setDescription("Role")
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName("image")
        .setDescription("Image URL")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("announcement-panel")
    .setDescription("Create announcement management panel.")
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Panel channel")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("announcement-config")
    .setDescription("Configure announcements.")
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Default channel")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false)
    )
    .addRoleOption(o =>
      o.setName("role")
        .setDescription("Default role")
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName("image")
        .setDescription("Default image")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("announcement-channel")
    .setDescription("Set default announcement channel.")
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Channel")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("announcement-tags")
    .setDescription("Set default announcement role.")
    .addRoleOption(o =>
      o.setName("role")
        .setDescription("Role")
        .setRequired(true)
    )
);

/* Configuration */

commands.push(
  new SlashCommandBuilder()
    .setName("config")
    .setDescription("View main configuration."),

  new SlashCommandBuilder()
    .setName("config-view")
    .setDescription("View server configuration."),

  new SlashCommandBuilder()
    .setName("config-reset")
    .setDescription("Reset server configuration."),

  new SlashCommandBuilder()
    .setName("config-ticket")
    .setDescription("View ticket configuration."),

  new SlashCommandBuilder()
    .setName("config-automod")
    .setDescription("View AutoMod configuration."),

  new SlashCommandBuilder()
    .setName("config-security")
    .setDescription("View security configuration."),

  new SlashCommandBuilder()
    .setName("config-logs")
    .setDescription("View logging configuration."),

  new SlashCommandBuilder()
    .setName("config-suggestions")
    .setDescription("View suggestion configuration."),

  new SlashCommandBuilder()
    .setName("config-announcements")
    .setDescription("View announcement configuration.")
);

const commandJSON =
  commands.map(c => c.toJSON());

/* =========================================================
   COMMAND REGISTRATION
========================================================= */

async function registerCommands() {
  const rest =
    new REST({ version: "10" })
      .setToken(TOKEN);

  console.log(
    `Registering ${commandJSON.length} commands globally...`
  );

  await rest.put(
    Routes.applicationCommands(CLIENT_ID),
    {
      body: commandJSON
    }
  );

  console.log(
    `Successfully registered ${commandJSON.length} commands.`
  );
}

/* =========================================================
   PERMISSION RESPONSE
========================================================= */

async function requireAdmin(i) {
  if (!isAdmin(i.member)) {
    await i.reply({
      content:
        "❌ Administrator permission is required.",
      ephemeral: true
    });

    return false;
  }

  return true;
}

async function requireManageGuild(i) {
  if (!hasManageGuild(i.member)) {
    await i.reply({
      content:
        "❌ Manage Server or Administrator permission is required.",
      ephemeral: true
    });

    return false;
  }

  return true;
}

/* =========================================================
   COMMAND HANDLER
========================================================= */

client.on(
  "interactionCreate",
  async i => {
    try {
      /* ================= BUTTONS ================= */

      if (i.isButton()) {
        if (!i.guild) {
          return i.reply({
            content: "❌ This button only works in a server.",
            ephemeral: true
          });
        }

        const g =
          getGuild(i.guild.id);

        const ticket =
          g.ticketsData[i.channelId];

        if (i.customId === "ticket_open") {
          const ch =
            await createTicket(
              i.guild,
              i.user,
              "panel"
            );

          return i.reply({
            content:
              ch
                ? `🎫 Ticket created: ${ch}`
                : "❌ Could not create ticket.",
            ephemeral: true
          });
        }

        if (
          i.customId === "ticket_claim"
        ) {
          if (!ticket) {
            return i.reply({
              content:
                "❌ This is not a ticket.",
              ephemeral: true
            });
          }

          if (
            !isTicketStaff(
              i.member,
              g
            )
          ) {
            return i.reply({
              content:
                "❌ Staff only.",
              ephemeral: true
            });
          }

          ticket.claimedBy =
            i.user.id;

          saveDB();

          await sendLog(
            i.guild,
            "tickets",
            "🙋 Ticket Claimed",
            `**Ticket:** ${i.channel}\n` +
              `**Claimed by:** ${i.user}`
          );

          return i.reply(
            `🙋 Ticket claimed by ${i.user}.`
          );
        }

        if (
          i.customId === "ticket_lock"
        ) {
          if (!ticket) {
            return i.reply({
              content:
                "❌ Not a ticket.",
              ephemeral: true
            });
          }

          if (
            !isTicketStaff(
              i.member,
              g
            )
          ) {
            return i.reply({
              content:
                "❌ Staff only.",
              ephemeral: true
            });
          }

          await i.channel.permissionOverwrites
            .edit(
              ticket.userId,
              {
                SendMessages: false
              }
            );

          ticket.locked = true;

          saveDB();

          return i.reply(
            "🔒 Ticket locked."
          );
        }

        if (
          i.customId === "ticket_close"
        ) {
          return closeTicket(i);
        }

        if (
          i.customId === "ticket_delete"
        ) {
          return deleteTicket(i);
        }

        if (
          i.customId.startsWith(
            "suggest_approve_"
          )
        ) {
          if (!isAdmin(i.member)) {
            return i.reply({
              content:
                "❌ Staff only.",
              ephemeral: true
            });
          }

          const id =
            i.customId.replace(
              "suggest_approve_",
              ""
            );

          const suggestion =
            g.suggestionsData[id];

          if (!suggestion) {
            return i.reply({
              content:
                "❌ Suggestion not found.",
              ephemeral: true
            });
          }

          suggestion.status =
            "approved";

          suggestion.reviewedBy =
            i.user.id;

          suggestion.reviewedAt =
            Date.now();

          saveDB();

          await sendLog(
            i.guild,
            "suggestions",
            "✅ Suggestion Approved",
            `Suggestion ID: **${id}**\n` +
              `Approved by: ${i.user}`
          );

          return i.reply(
            "✅ Suggestion approved."
          );
        }

        if (
          i.customId.startsWith(
            "suggest_decline_"
          )
        ) {
          if (!isAdmin(i.member)) {
            return i.reply({
              content:
                "❌ Staff only.",
              ephemeral: true
            });
          }

          const id =
            i.customId.replace(
              "suggest_decline_",
              ""
            );

          const suggestion =
            g.suggestionsData[id];

          if (!suggestion) {
            return i.reply({
              content:
                "❌ Suggestion not found.",
              ephemeral: true
            });
          }

          suggestion.status =
            "declined";

          suggestion.reviewedBy =
            i.user.id;

          suggestion.reviewedAt =
            Date.now();

          saveDB();

          await sendLog(
            i.guild,
            "suggestions",
            "❌ Suggestion Declined",
            `Suggestion ID: **${id}**\n` +
              `Declined by: ${i.user}`
          );

          return i.reply(
            "❌ Suggestion declined."
          );
        }

        return;
      }

      /* ================= SLASH ================= */

      if (!i.isChatInputCommand()) {
        return;
      }

      if (!i.guild) {
        return i.reply({
          content:
            "❌ This command can only be used in a server.",
          ephemeral: true
        });
      }

      const g =
        getGuild(i.guild.id);

      g.stats.commands++;

      saveDB();

      const command =
        i.commandName;

      /* =====================================================
         GENERAL
      ===================================================== */

      if (command === "ping") {
        return i.reply(
          `🏓 Pong! **${client.ws.ping}ms**`
        );
      }

      if (command === "uptime") {
        return i.reply(
          `⏱️ Uptime: **${Math.floor(
            process.uptime()
          )} seconds**`
        );
      }

      if (command === "botinfo") {
        const embed =
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("🤖 Bot Information")
            .addFields(
              {
                name: "Bot",
                value: client.user.tag
              },
              {
                name: "Servers",
                value:
                  String(client.guilds.cache.size)
              },
              {
                name: "Commands",
                value:
                  String(commandJSON.length)
              },
              {
                name: "Discord.js",
                value:
                  "14.27.0"
              },
              {
                name: "Node.js",
                value:
                  process.version
              }
            )
            .setTimestamp();

        return i.reply({
          embeds: [embed]
        });
      }

      if (command === "serverinfo") {
        const embed =
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(`🏠 ${i.guild.name}`)
            .addFields(
              {
                name: "Server ID",
                value: i.guild.id
              },
              {
                name: "Owner",
                value: `<@${i.guild.ownerId}>`
              },
              {
                name: "Members",
                value:
                  String(i.guild.memberCount)
              },
              {
                name: "Channels",
                value:
                  String(i.guild.channels.cache.size)
              },
              {
                name: "Roles",
                value:
                  String(i.guild.roles.cache.size)
              }
            )
            .setTimestamp();

        return i.reply({
          embeds: [embed]
        });
      }

      if (command === "userinfo") {
        const user =
          i.options.getUser(
            "user"
          ) || i.user;

        const member =
          await i.guild.members
            .fetch(user.id)
            .catch(() => null);

        const embed =
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("👤 User Information")
            .setThumbnail(
              user.displayAvatarURL({
                size: 512
              })
            )
            .addFields(
              {
                name: "User",
                value: `${user.tag}`
              },
              {
                name: "ID",
                value: user.id
              },
              {
                name: "Bot",
                value:
                  user.bot ? "Yes" : "No"
              },
              {
                name: "Joined Server",
                value:
                  member?.joinedAt
                    ? `<t:${Math.floor(
                        member.joinedAt.getTime() /
                          1000
                      )}:F>`
                    : "Unknown"
              }
            );

        return i.reply({
          embeds: [embed]
        });
      }

      if (command === "avatar") {
        const user =
          i.options.getUser(
            "user"
          ) || i.user;

        return i.reply(
          user.displayAvatarURL({
            size: 4096
          })
        );
      }

      if (command === "help") {
        const embed =
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("📚 Bot Commands")
            .setDescription(
              `**General:** ping, help, botinfo, serverinfo, userinfo, avatar, uptime\n\n` +
              `**Moderation:** warn, warnings, warnings-clear, punishments, kick, ban, unban, timeout, untimeout, purge, slowmode, lock, unlock\n\n` +
              `**AutoMod:** automod, automod-config, automod-logs, automod-word, automod-word-remove, autotimeout, autotimeout-config\n\n` +
              `**Security:** security, security-config, raidmode, raidmode-config, antinuke, antinuke-config\n\n` +
              `**Trusted:** trusted, trusted-add, trusted-remove, trusted-list\n\n` +
              `**Role Protection:** roleprotect, roleprotect-add, roleprotect-remove, roleprotect-list, roleprotect-config\n\n` +
              `**Logging:** logs, logs-config, audit, audit-config, modlogs, security-logs\n\n` +
              `**Tickets:** ticket, ticket-panel, ticket-close, ticket-delete, ticket-add, ticket-remove, ticket-claim, ticket-transcript, ticket-lock, ticket-unlock, ticket-rename, ticket-config\n\n` +
              `**Suggestions:** suggest, suggest-config, suggestions\n\n` +
              `**Announcements:** announce, announcement-panel, announcement-config, announcement-channel, announcement-tags\n\n` +
              `**Configuration:** config, config-view, config-reset, config-ticket, config-automod, config-security, config-logs, config-suggestions, config-announcements`
            );

        return i.reply({
          embeds: [embed]
        });
      }

      /* =====================================================
         MODERATION
      ===================================================== */

      if (
        [
          "warn",
          "warnings-clear",
          "kick",
          "ban",
          "unban",
          "timeout",
          "untimeout",
          "purge",
          "slowmode",
          "lock",
          "unlock"
        ].includes(command)
      ) {
        if (!(await requireAdmin(i))) {
          return;
        }
      }

      if (command === "warn") {
        const user =
          i.options.getUser("user");

        const reason =
          cleanReason(
            i.options.getString("reason")
          );

        const count =
          addWarning(
            i.guild.id,
            user.id,
            reason,
            i.user.id
          );

        await sendLog(
          i.guild,
          "moderation",
          "⚠️ Member Warned",
          `**User:** ${user}\n` +
            `**Reason:** ${reason}\n` +
            `**Total warnings:** ${count}`
        );

        return i.reply(
          `⚠️ ${user} warned. Total warnings: **${count}**`
        );
      }

      if (command === "warnings") {
        const user =
          i.options.getUser("user");

        const list =
          g.warnings[user.id] || [];

        if (!list.length) {
          return i.reply(
            `✅ ${user} has no warnings.`
          );
        }

        const text =
          list
            .slice(-20)
            .map(
              (w, n) =>
                `**${n + 1}.** ${w.reason} — <@${w.moderatorId}>`
            )
            .join("\n");

        return i.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xfaa61a)
              .setTitle(
                `⚠️ Warnings — ${user.tag}`
              )
              .setDescription(text)
          ]
        });
      }

      if (command === "warnings-clear") {
        const user =
          i.options.getUser("user");

        delete g.warnings[user.id];

        saveDB();

        await sendLog(
          i.guild,
          "moderation",
          "🧹 Warnings Cleared",
          `**User:** ${user}\n` +
            `**Cleared by:** ${i.user}`
        );

        return i.reply(
          `🧹 Warnings cleared for ${user}.`
        );
      }

      if (command === "punishments") {
        const user =
          i.options.getUser("user");

        const list =
          g.punishments[user.id] || [];

        if (!list.length) {
          return i.reply(
            `✅ ${user} has no punishment history.`
          );
        }

        const text =
          list
            .slice(-20)
            .map(
              (p, n) =>
                `**${n + 1}.** ${p.type} — ${p.reason || "No reason"} — <@${p.moderatorId}>`
            )
            .join("\n");

        return i.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xed4245)
              .setTitle(
                `🔨 Punishments — ${user.tag}`
              )
              .setDescription(text)
          ]
        });
      }

      if (command === "kick") {
        const user =
          i.options.getUser("user");

        const reason =
          cleanReason(
            i.options.getString("reason")
          );

        const member =
          await i.guild.members
            .fetch(user.id)
            .catch(() => null);

        if (
          !member ||
          !member.kickable
        ) {
          return i.reply({
            content:
              "❌ I cannot kick this member.",
            ephemeral: true
          });
        }

        await member.kick(reason);

        addPunishment(
          i.guild.id,
          user.id,
          "kick",
          reason,
          i.user.id
        );

        await sendLog(
          i.guild,
          "moderation",
          "👢 Member Kicked",
          `**User:** ${user}\n` +
            `**Reason:** ${reason}\n` +
            `**Moderator:** ${i.user}`,
          0xed4245
        );

        return i.reply(
          `👢 ${user.tag} was kicked.`
        );
      }

      if (command === "ban") {
        const user =
          i.options.getUser("user");

        const reason =
          cleanReason(
            i.options.getString("reason")
          );

        const member =
          await i.guild.members
            .fetch(user.id)
            .catch(() => null);

        if (
          member &&
          !member.bannable
        ) {
          return i.reply({
            content:
              "❌ I cannot ban this member.",
            ephemeral: true
          });
        }

        await i.guild.members.ban(
          user.id,
          {
            reason
          }
        );

        addPunishment(
          i.guild.id,
          user.id,
          "ban",
          reason,
          i.user.id
        );

        await sendLog(
          i.guild,
          "moderation",
          "🔨 Member Banned",
          `**User:** ${user}\n` +
            `**Reason:** ${reason}\n` +
            `**Moderator:** ${i.user}`,
          0xed4245
        );

        return i.reply(
          `🔨 ${user.tag} was banned.`
        );
      }

      if (command === "unban") {
        const userId =
          i.options.getString(
            "userid"
          );

        const reason =
          cleanReason(
            i.options.getString(
              "reason"
            )
          );

        await i.guild.members.unban(
          userId,
          reason
        );

        addPunishment(
          i.guild.id,
          userId,
          "unban",
          reason,
          i.user.id
        );

        await sendLog(
          i.guild,
          "moderation",
          "🔓 User Unbanned",
          `**User ID:** ${userId}\n` +
            `**Reason:** ${reason}\n` +
            `**Moderator:** ${i.user}`
        );

        return i.reply(
          `🔓 User **${userId}** unbanned.`
        );
      }

      if (command === "timeout") {
        const user =
          i.options.getUser("user");

        const minutes =
          i.options.getInteger(
            "minutes"
          );

        const reason =
          cleanReason(
            i.options.getString("reason")
          );

        const member =
          await i.guild.members
            .fetch(user.id)
            .catch(() => null);

        if (
          !member ||
          !member.moderatable
        ) {
          return i.reply({
            content:
              "❌ I cannot timeout this member.",
            ephemeral: true
          });
        }

        await member.timeout(
          durationMs(minutes),
          reason
        );

        addPunishment(
          i.guild.id,
          user.id,
          "timeout",
          reason,
          i.user.id
        );

        await sendLog(
          i.guild,
          "moderation",
          "⏱️ Member Timed Out",
          `**User:** ${user}\n` +
            `**Duration:** ${minutes} minutes\n` +
            `**Reason:** ${reason}\n` +
            `**Moderator:** ${i.user}`
        );

        return i.reply(
          `⏱️ ${user.tag} timed out for **${minutes} minutes**.`
        );
      }

      if (command === "untimeout") {
        const user =
          i.options.getUser("user");

        const member =
          await i.guild.members
            .fetch(user.id)
            .catch(() => null);

        if (!member) {
          return i.reply({
            content:
              "❌ Member not found.",
            ephemeral: true
          });
        }

        await member.timeout(
          null,
          `Timeout removed by ${i.user.tag}`
        );

        addPunishment(
          i.guild.id,
          user.id,
          "untimeout",
          "Timeout removed",
          i.user.id
        );

        return i.reply(
          `🔓 Timeout removed from ${user}.`
        );
      }

      if (command === "purge") {
        const amount =
          i.options.getInteger(
            "amount"
          );

        if (
          !i.channel.bulkDelete
        ) {
          return i.reply({
            content:
              "❌ This channel does not support bulk deletion.",
            ephemeral: true
          });
        }

        const deleted =
          await i.channel.bulkDelete(
            amount,
            true
          );

        return i.reply({
          content:
            `🧹 Deleted **${deleted.size}** messages.`,
          ephemeral: true
        });
      }

      if (command === "slowmode") {
        const seconds =
          i.options.getInteger(
            "seconds"
          );

        await i.channel.setRateLimitPerUser(
          seconds
        );

        return i.reply(
          `🐢 Slowmode set to **${seconds} seconds**.`
        );
      }

      if (command === "lock") {
        await i.channel.permissionOverwrites.edit(
          i.guild.roles.everyone,
          {
            SendMessages: false
          }
        );

        return i.reply(
          "🔒 Channel locked."
        );
      }

      if (command === "unlock") {
        await i.channel.permissionOverwrites.edit(
          i.guild.roles.everyone,
          {
            SendMessages: null
          }
        );

        return i.reply(
          "🔓 Channel unlocked."
        );
      }

      /* =====================================================
         AUTOMOD
      ===================================================== */

      if (
        [
          "automod",
          "automod-config",
          "automod-logs",
          "automod-word",
          "automod-word-remove",
          "autotimeout",
          "autotimeout-config"
        ].includes(command)
      ) {
        if (!(await requireManageGuild(i))) {
          return;
        }
      }

      if (command === "automod") {
        const action =
          i.options.getString(
            "action"
          );

        if (action === "enable") {
          g.automod.enabled = true;
        }

        if (action === "disable") {
          g.automod.enabled = false;
        }

        saveDB();

        return i.reply(
          `🛡️ AutoMod: **${g.automod.enabled ? "Enabled" : "Disabled"}**`
        );
      }

      if (command === "automod-config") {
        const feature =
          i.options.getString(
            "feature"
          );

        const enabled =
          i.options.getBoolean(
            "enabled"
          );

        g.automod[feature] =
          enabled;

        saveDB();

        await sendLog(
          i.guild,
          "configuration",
          "⚙️ AutoMod Configuration Changed",
          `**Feature:** ${feature}\n` +
            `**Enabled:** ${enabled}\n` +
            `**Changed by:** ${i.user}`
        );

        return i.reply(
          `🛡️ AutoMod **${feature}** set to **${enabled ? "enabled" : "disabled"}**.`
        );
      }

      if (command === "automod-logs") {
        const channel =
          i.options.getChannel(
            "channel"
          );

        g.automod.logChannel =
          channel.id;

        g.logs.automod =
          channel.id;

        saveDB();

        return i.reply(
          `🛡️ AutoMod logs set to ${channel}.`
        );
      }

      if (command === "automod-word") {
        const word =
          i.options.getString(
            "word"
          )
            .trim()
            .toLowerCase();

        if (
          !g.automod.badWords.includes(
            word
          )
        ) {
          g.automod.badWords.push(
            word
          );
        }

        saveDB();

        return i.reply(
          `🚫 Blocked word added: **${word}**`
        );
      }

      if (
        command ===
        "automod-word-remove"
      ) {
        const word =
          i.options.getString(
            "word"
          )
            .trim()
            .toLowerCase();

        g.automod.badWords =
          g.automod.badWords.filter(
            x => x !== word
          );

        saveDB();

        return i.reply(
          `✅ Blocked word removed: **${word}**`
        );
      }

      if (command === "autotimeout") {
        const action =
          i.options.getString(
            "action"
          );

        if (action === "enable") {
          g.autotimeout.enabled =
            true;
        }

        if (action === "disable") {
          g.autotimeout.enabled =
            false;
        }

        saveDB();

        return i.reply(
          `⏱️ Auto-timeout: **${g.autotimeout.enabled ? "Enabled" : "Disabled"}**`
        );
      }

      if (
        command ===
        "autotimeout-config"
      ) {
        g.autotimeout.strikes =
          i.options.getInteger(
            "strikes"
          );

        g.autotimeout.minutes =
          i.options.getInteger(
            "minutes"
          );

        saveDB();

        return i.reply(
          `⏱️ Auto-timeout configured: **${g.autotimeout.strikes} strikes / ${g.autotimeout.minutes} minutes**`
        );
      }

      /* =====================================================
         SECURITY
      ===================================================== */

      if (
        [
          "security",
          "security-config",
          "raidmode",
          "raidmode-config",
          "antinuke",
          "antinuke-config",
          "trusted",
          "trusted-add",
          "trusted-remove",
          "trusted-list",
          "roleprotect",
          "roleprotect-add",
          "roleprotect-remove",
          "roleprotect-list",
          "roleprotect-config"
        ].includes(command)
      ) {
        if (
          !(
            await requireAdmin(i)
          )
        ) {
          return;
        }
      }

      if (command === "security") {
        const action =
          i.options.getString(
            "action"
          );

        if (action === "enable") {
          g.security.enabled =
            true;
        }

        if (action === "disable") {
          g.security.enabled =
            false;
        }

        if (action === "lockdown") {
          g.security.lockdown =
            true;
          g.security.raidMode =
            true;
        }

        if (action === "unlockdown") {
          g.security.lockdown =
            false;
        }

        saveDB();

        await sendLog(
          i.guild,
          "security",
          "🔐 Security Configuration Changed",
          `**Action:** ${action}\n` +
            `**Changed by:** ${i.user}`
        );

        return i.reply(
          `🔐 Security action **${action}** completed.`
        );
      }

      if (
        command ===
        "security-config"
      ) {
        g.security.antiRaid =
          i.options.getBoolean(
            "anti_raid"
          );

        g.security.antiNuke =
          i.options.getBoolean(
            "anti_nuke"
          );

        g.security.antiWebhook =
          i.options.getBoolean(
            "anti_webhook"
          );

        g.security.antiBotAdd =
          i.options.getBoolean(
            "anti_bot"
          );

        saveDB();

        return i.reply(
          "🔐 Security configuration updated."
        );
      }

      if (command === "raidmode") {
        const action =
          i.options.getString(
            "action"
          );

        if (action === "on") {
          g.security.raidMode =
            true;
        }

        if (action === "off") {
          g.security.raidMode =
            false;
        }

        saveDB();

        return i.reply(
          `🚨 Raid mode: **${g.security.raidMode ? "ON" : "OFF"}**`
        );
      }

      if (
        command ===
        "raidmode-config"
      ) {
        g.security.joinLimit =
          i.options.getInteger(
            "joins"
          );

        g.security.joinWindow =
          i.options.getInteger(
            "seconds"
          ) * 1000;

        saveDB();

        return i.reply(
          `🚨 Raid detection: **${g.security.joinLimit} joins / ${i.options.getInteger("seconds")} seconds**`
        );
      }

      if (command === "antinuke") {
        const action =
          i.options.getString(
            "action"
          );

        if (action === "enable") {
          g.security.antiNuke =
            true;
        }

        if (action === "disable") {
          g.security.antiNuke =
            false;
        }

        saveDB();

        return i.reply(
          `☢️ Anti-nuke: **${g.security.antiNuke ? "Enabled" : "Disabled"}**`
        );
      }

      if (
        command ===
        "antinuke-config"
      ) {
        g.security.antiNuke =
          i.options.getBoolean(
            "enabled"
          );

        saveDB();

        return i.reply(
          `☢️ Anti-nuke set to **${g.security.antiNuke ? "enabled" : "disabled"}**.`
        );
      }

      /* =====================================================
         TRUSTED
      ===================================================== */

      if (command === "trusted") {
        return i.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle("🛡️ Trusted System")
              .setDescription(
                `**Users:** ${
                  g.trusted.users.length
                }\n` +
                `**Bots:** ${
                  g.trusted.bots.length
                }`
              )
          ]
        });
      }

      if (
        command ===
        "trusted-list"
      ) {
        return i.reply({
          content:
            `🛡️ **Trusted Users**\n` +
            `${
              g.trusted.users.length
                ? g.trusted.users.map(
                    x => `<@${x}>`
                  ).join(", ")
                : "None"
            }\n\n` +
            `🤖 **Trusted Bots**\n` +
            `${
              g.trusted.bots.length
                ? g.trusted.bots.map(
                    x => `<@${x}>`
                  ).join(", ")
                : "None"
            }`
        });
      }

      if (
        command ===
        "trusted-add"
      ) {
        const user =
          i.options.getUser(
            "user"
          );

        const bot =
          i.options.getBoolean(
            "bot"
          ) || user.bot;

        if (bot) {
          if (
            !g.trusted.bots.includes(
              user.id
            )
          ) {
            g.trusted.bots.push(
              user.id
            );
          }
        } else {
          if (
            !g.trusted.users.includes(
              user.id
            )
          ) {
            g.trusted.users.push(
              user.id
            );
          }
        }

        saveDB();

        return i.reply(
          `🛡️ ${user} added to trusted ${bot ? "bots" : "users"}.`
        );
      }

      if (
        command ===
        "trusted-remove"
      ) {
        const user =
          i.options.getUser(
            "user"
          );

        g.trusted.users =
          g.trusted.users.filter(
            x => x !== user.id
          );

        g.trusted.bots =
          g.trusted.bots.filter(
            x => x !== user.id
          );

        saveDB();

        return i.reply(
          `🧹 ${user} removed from trusted lists.`
        );
      }

      /* =====================================================
         ROLE PROTECTION
      ===================================================== */

      if (
        command ===
        "roleprotect"
      ) {
        const action =
          i.options.getString(
            "action"
          );

        if (action === "enable") {
          g.roleProtect.enabled =
            true;
        }

        if (action === "disable") {
          g.roleProtect.enabled =
            false;
        }

        saveDB();

        return i.reply(
          `🎭 Role protection: **${g.roleProtect.enabled ? "Enabled" : "Disabled"}**`
        );
      }

      if (
        command ===
        "roleprotect-add"
      ) {
        const role =
          i.options.getRole(
            "role"
          );

        if (
          !g.roleProtect.protectedRoles.includes(
            role.id
          )
        ) {
          g.roleProtect.protectedRoles.push(
            role.id
          );
        }

        saveDB();

        return i.reply(
          `🛡️ ${role} is now protected.`
        );
      }

      if (
        command ===
        "roleprotect-remove"
      ) {
        const role =
          i.options.getRole(
            "role"
          );

        g.roleProtect.protectedRoles =
          g.roleProtect.protectedRoles.filter(
            x => x !== role.id
          );

        saveDB();

        return i.reply(
          `✅ ${role} removed from protected roles.`
        );
      }

      if (
        command ===
        "roleprotect-list"
      ) {
        return i.reply(
          `🛡️ Protected roles:\n${
            g.roleProtect.protectedRoles.length
              ? g.roleProtect.protectedRoles
                  .map(x => `<@&${x}>`)
                  .join("\n")
              : "None"
          }`
        );
      }

      if (
        command ===
        "roleprotect-config"
      ) {
        g.roleProtect.timeoutMinutes =
          i.options.getInteger(
            "minutes"
          );

        saveDB();

        return i.reply(
          `🎭 Unauthorized role-action timeout set to **${g.roleProtect.timeoutMinutes} minutes**.`
        );
      }

      /* =====================================================
         NEW CENTRAL LOG SYSTEM
      ===================================================== */

      if (
        command ===
        "logs"
      ) {
        if (
          !(await requireAdmin(i))
        ) {
          return;
        }

        const type =
          i.options.getString(
            "type"
          );

        const channel =
          i.options.getChannel(
            "channel"
          );

        const central =
          i.options.getBoolean(
            "central"
          ) || false;

        /*
          IMPORTANT:
          If central=true, the selected channel's server
          becomes the Admin Server for this guild.
        */

        if (central) {
          g.logs.adminServerId =
            channel.guild.id;

          g.logs.destinations[
            type
          ] = channel.id;
        } else {
          g.logs[type] =
            channel.id;
        }

        saveDB();

        await sendLog(
          i.guild,
          "configuration",
          "📜 Log Configuration Changed",
          `**Type:** ${type}\n` +
            `**Channel:** ${channel}\n` +
            `**Central/Admin Server:** ${central ? "Yes" : "No"}\n` +
            `**Changed by:** ${i.user}`
        );

        return i.reply(
          `📜 **${type}** logs are now configured to ${channel}${central ? " as a central Admin Server destination." : "."}`
        );
      }

      if (
        command ===
        "logs-config"
      ) {
        if (
          !(await requireManageGuild(i))
        ) {
          return;
        }

        const local =
          LOG_TYPES
            .map(
              type =>
                `**${type}:** ${
                  g.logs[type]
                    ? `<#${g.logs[type]}>`
                    : "Not set"
                }`
            )
            .join("\n");

        const central =
          LOG_TYPES
            .map(
              type =>
                `**${type}:** ${
                  g.logs.destinations[type]
                    ? `<#${g.logs.destinations[type]}>`
                    : "Not set"
                }`
            )
            .join("\n");

        return i.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle("📜 Logging Configuration")
              .setDescription(
                `**Central Admin Server:** ${
                  g.logs.adminServerId ||
                  "Not configured"
                }\n\n` +
                `**Local Logs**\n${local}\n\n` +
                `**Central Admin Logs**\n${central}`
              )
          ],
          ephemeral: true
        });
      }

      if (command === "audit") {
        if (
          !(await requireAdmin(i))
        ) {
          return;
        }

        const logs =
          await i.guild.fetchAuditLogs({
            limit: 10
          }).catch(() => null);

        if (!logs) {
          return i.reply({
            content:
              "❌ Unable to read audit logs.",
            ephemeral: true
          });
        }

        const text =
          logs.entries.map(
            entry =>
              `• **${entry.action}** — <@${entry.executor?.id || "unknown"}>`
          ).join("\n");

        await sendLog(
          i.guild,
          "audit",
          "📜 Audit Log Viewed",
          `Viewed by: ${i.user}\n\n${text}`
        );

        return i.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle("📜 Recent Audit Activity")
              .setDescription(
                text || "No recent entries."
              )
          ]
        });
      }

      if (
        command ===
        "audit-config"
      ) {
        const channel =
          i.options.getChannel(
            "channel"
          );

        g.logs.audit =
          channel.id;

        /*
          Audit is also configured as
          a central destination.
        */
        g.logs.adminServerId =
          channel.guild.id;

        g.logs.destinations.audit =
          channel.id;

        saveDB();

        return i.reply(
          `📜 Central audit logs set to ${channel}.`
        );
      }

      if (command === "modlogs") {
        return i.reply(
          `🔨 Moderation logs: ${
            g.logs.moderation
              ? `<#${g.logs.moderation}>`
              : "Not configured"
          }`
        );
      }

      if (
        command ===
        "security-logs"
      ) {
        return i.reply(
          `🔐 Security logs: ${
            g.logs.security
              ? `<#${g.logs.security}>`
              : "Not configured"
          }`
        );
      }

      /* =====================================================
         TICKETS
      ===================================================== */

      if (command === "ticket") {
        const channel =
          await createTicket(
            i.guild,
            i.user,
            "command"
          );

        return i.reply({
          content:
            channel
              ? `🎫 Your ticket has been created: ${channel}`
              : "❌ Ticket system is disabled.",
          ephemeral: true
        });
      }

      if (
        command ===
        "ticket-panel"
      ) {
        if (
          !(await requireAdmin(i))
        ) {
          return;
        }

        const channel =
          i.options.getChannel(
            "channel"
          );

        const embed =
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("🎫 Support Center")
            .setDescription(
              "Need help? Click the button below to create a support ticket."
            );

        const row =
          new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(
                  "ticket_open"
                )
                .setLabel(
                  "Open Ticket"
                )
                .setEmoji("🎫")
                .setStyle(
                  ButtonStyle.Primary
                )
            );

        const msg =
          await channel.send({
            embeds: [embed],
            components: [row]
          });

        g.tickets.panelChannel =
          channel.id;

        g.tickets.panelMessage =
          msg.id;

        saveDB();

        return i.reply({
          content:
            `🎫 Ticket panel created in ${channel}.`,
          ephemeral: true
        });
      }

      if (
        [
          "ticket-close",
          "ticket-delete",
          "ticket-add",
          "ticket-remove",
          "ticket-claim",
          "ticket-transcript",
          "ticket-lock",
          "ticket-unlock",
          "ticket-rename"
        ].includes(command)
      ) {
        if (
          !g.ticketsData[
            i.channelId
          ]
        ) {
          return i.reply({
            content:
              "❌ This is not a ticket channel.",
            ephemeral: true
          });
        }
      }

      if (
        command ===
        "ticket-close"
      ) {
        return closeTicket(i);
      }

      if (
        command ===
        "ticket-delete"
      ) {
        return deleteTicket(i);
      }

      if (
        command ===
        "ticket-claim"
      ) {
        const ticket =
          g.ticketsData[
            i.channelId
          ];

        if (
          !isTicketStaff(
            i.member,
            g
          )
        ) {
          return i.reply({
            content:
              "❌ Staff only.",
            ephemeral: true
          });
        }

        ticket.claimedBy =
          i.user.id;

        saveDB();

        await sendLog(
          i.guild,
          "tickets",
          "🙋 Ticket Claimed",
          `**Ticket:** ${i.channel}\n` +
            `**Claimed by:** ${i.user}`
        );

        return i.reply(
          `🙋 Ticket claimed by ${i.user}.`
        );
      }

      if (
        command ===
        "ticket-lock"
      ) {
        const ticket =
          g.ticketsData[
            i.channelId
          ];

        if (
          !isTicketStaff(
            i.member,
            g
          )
        ) {
          return i.reply({
            content:
              "❌ Staff only.",
            ephemeral: true
          });
        }

        await i.channel.permissionOverwrites
          .edit(
            ticket.userId,
            {
              SendMessages: false
            }
          );

        ticket.locked = true;

        saveDB();

        return i.reply(
          "🔒 Ticket locked."
        );
      }

      if (
        command ===
        "ticket-unlock"
      ) {
        const ticket =
          g.ticketsData[
            i.channelId
          ];

        if (
          !isTicketStaff(
            i.member,
            g
          )
        ) {
          return i.reply({
            content:
              "❌ Staff only.",
            ephemeral: true
          });
        }

        await i.channel.permissionOverwrites
          .edit(
            ticket.userId,
            {
              SendMessages: true
            }
          );

        ticket.locked = false;

        saveDB();

        return i.reply(
          "🔓 Ticket unlocked."
        );
      }

      if (
        command ===
        "ticket-add"
      ) {
        if (
          !isTicketStaff(
            i.member,
            g
          )
        ) {
          return i.reply({
            content:
              "❌ Staff only.",
            ephemeral: true
          });
        }

        const user =
          i.options.getUser(
            "user"
          );

        await i.channel.permissionOverwrites
          .edit(
            user.id,
            {
              ViewChannel: true,
              SendMessages: true,
              ReadMessageHistory: true
            }
          );

        return i.reply(
          `➕ ${user} added to the ticket.`
        );
      }

      if (
        command ===
        "ticket-remove"
      ) {
        if (
          !isTicketStaff(
            i.member,
            g
          )
        ) {
          return i.reply({
            content:
              "❌ Staff only.",
            ephemeral: true
          });
        }

        const user =
          i.options.getUser(
            "user"
          );

        await i.channel.permissionOverwrites
          .delete(
            user.id
          )
          .catch(() => {});

        return i.reply(
          `➖ ${user} removed from the ticket.`
        );
      }

      if (
        command ===
        "ticket-transcript"
      ) {
        if (
          !isTicketStaff(
            i.member,
            g
          )
        ) {
          return i.reply({
            content:
              "❌ Staff only.",
            ephemeral: true
          });
        }

        const transcript =
          await makeTranscript(
            i.channel
          );

        await i.reply({
          files: [
            {
              attachment:
                Buffer.from(
                  transcript
                ),
              name:
                `${i.channel.name}-transcript.txt`
            }
          ]
        });

        await sendLog(
          i.guild,
          "tickets",
          "📄 Ticket Transcript Created",
          `**Ticket:** ${i.channel}\n` +
            `**Created by:** ${i.user}`
        );

        return;
      }

      if (
        command ===
        "ticket-rename"
      ) {
        if (
          !isTicketStaff(
            i.member,
            g
          )
        ) {
          return i.reply({
            content:
              "❌ Staff only.",
            ephemeral: true
          });
        }

        let name =
          i.options.getString(
            "name"
          );

        name =
          name
            .toLowerCase()
            .replace(
              /[^a-z0-9-_]/g,
              "-"
            )
            .slice(0, 90);

        await i.channel.setName(
          name
        );

        return i.reply(
          `✏️ Ticket renamed to **${name}**.`
        );
      }

      if (
        command ===
        "ticket-config"
      ) {
        if (
          !(await requireAdmin(i))
        ) {
          return;
        }

        const role =
          i.options.getRole(
            "support_role"
          );

        const category =
          i.options.getChannel(
            "category"
          );

        const logChannel =
          i.options.getChannel(
            "log_channel"
          );

        if (role) {
          g.tickets.supportRole =
            role.id;
        }

        if (category) {
          g.tickets.category =
            category.id;
        }

        if (logChannel) {
          g.tickets.logChannel =
            logChannel.id;

          g.logs.tickets =
            logChannel.id;
        }

        saveDB();

        return i.reply(
          "🎫 Ticket configuration updated."
        );
      }

      /* =====================================================
         SUGGESTIONS
      ===================================================== */

      if (
        command ===
        "suggest"
      ) {
        if (!g.suggestions.enabled) {
          return i.reply({
            content:
              "❌ Suggestions are disabled.",
            ephemeral: true
          });
        }

        const suggestionText =
          i.options.getString(
            "suggestion"
          );

        const id =
          `${Date.now()}-${i.user.id}`;

        g.suggestionsData[id] = {
          id,
          userId: i.user.id,
          text: suggestionText,
          status: "pending",
          createdAt: Date.now()
        };

        saveDB();

        const channel =
          i.guild.channels.cache.get(
            g.suggestions.channel
          );

        if (channel) {
          const embed =
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle("💡 New Suggestion")
              .setDescription(
                suggestionText
              )
              .addFields(
                {
                  name: "Submitted by",
                  value: `${i.user}`
                },
                {
                  name: "Suggestion ID",
                  value: id
                }
              )
              .setTimestamp();

          const row =
            new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId(
                    `suggest_approve_${id}`
                  )
                  .setLabel(
                    "Approve"
                  )
                  .setEmoji("✅")
                  .setStyle(
                    ButtonStyle.Success
                  ),

                new ButtonBuilder()
                  .setCustomId(
                    `suggest_decline_${id}`
                  )
                  .setLabel(
                    "Decline"
                  )
                  .setEmoji("❌")
                  .setStyle(
                    ButtonStyle.Danger
                  )
              );

          await channel.send({
            embeds: [embed],
            components: [row]
          });
        }

        await sendLog(
          i.guild,
          "suggestions",
          "💡 Suggestion Submitted",
          `**User:** ${i.user}\n` +
            `**ID:** ${id}\n` +
            `**Suggestion:** ${suggestionText}`
        );

        return i.reply({
          content:
            "💡 Your suggestion has been submitted.",
          ephemeral: true
        });
      }

      if (
        command ===
        "suggest-config"
      ) {
        if (
          !(await requireAdmin(i))
        ) {
          return;
        }

        const channel =
          i.options.getChannel(
            "channel"
          );

        const role =
          i.options.getRole(
            "staff_role"
          );

        g.suggestions.channel =
          channel.id;

        if (role) {
          g.suggestions.staffRole =
            role.id;
        }

        g.logs.suggestions =
          channel.id;

        saveDB();

        return i.reply(
          `💡 Suggestions configured in ${channel}.`
        );
      }

      if (
        command ===
        "suggestions"
      ) {
        return i.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle("💡 Suggestion Configuration")
              .setDescription(
                `**Enabled:** ${g.suggestions.enabled}\n` +
                `**Channel:** ${
                  g.suggestions.channel
                    ? `<#${g.suggestions.channel}>`
                    : "Not set"
                }\n` +
                `**Staff Role:** ${
                  g.suggestions.staffRole
                    ? `<@&${g.suggestions.staffRole}>`
                    : "Not set"
                }`
              )
          ]
        });
      }

      /* =====================================================
         ANNOUNCEMENTS
      ===================================================== */

      if (
        [
          "announce",
          "announcement-panel",
          "announcement-config",
          "announcement-channel",
          "announcement-tags"
        ].includes(command)
      ) {
        if (
          !(await requireAdmin(i))
        ) {
          return;
        }
      }

      if (
        command ===
        "announce"
      ) {
        const title =
          i.options.getString(
            "title"
          );

        const message =
          i.options.getString(
            "message"
          );

        const channel =
          i.options.getChannel(
            "channel"
          ) ||
          i.guild.channels.cache.get(
            g.announcements.channel
          ) ||
          i.channel;

        const role =
          i.options.getRole(
            "role"
          ) ||
          i.guild.roles.cache.get(
            g.announcements.role
          );

        const image =
          i.options.getString(
            "image"
          ) ||
          g.announcements.image;

        const embed =
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(
              `📢 ${title}`
            )
            .setDescription(
              message
            )
            .setFooter({
              text:
                g.announcements.footer
            })
            .setTimestamp();

        if (image) {
          embed.setImage(image);
        }

        await channel.send({
          content:
            role
              ? `${role}`
              : undefined,
          embeds: [embed]
        });

        await sendLog(
          i.guild,
          "announcements",
          "📢 Announcement Sent",
          `**Title:** ${title}\n` +
            `**Channel:** ${channel}\n` +
            `**Sent by:** ${i.user}`
        );

        return i.reply({
          content:
            `📢 Announcement sent to ${channel}.`,
          ephemeral: true
        });
      }

      if (
        command ===
        "announcement-panel"
      ) {
        const channel =
          i.options.getChannel(
            "channel"
          );

        const embed =
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle(
              "📢 Announcement Management"
            )
            .setDescription(
              "Use `/announce` to send an announcement."
            );

        await channel.send({
          embeds: [embed]
        });

        return i.reply({
          content:
            `📢 Announcement panel created in ${channel}.`,
          ephemeral: true
        });
      }

      if (
        command ===
        "announcement-config"
      ) {
        const channel =
          i.options.getChannel(
            "channel"
          );

        const role =
          i.options.getRole(
            "role"
          );

        const image =
          i.options.getString(
            "image"
          );

        if (channel) {
          g.announcements.channel =
            channel.id;
        }

        if (role) {
          g.announcements.role =
            role.id;
        }

        if (image) {
          g.announcements.image =
            image;
        }

        saveDB();

        return i.reply(
          "📢 Announcement configuration updated."
        );
      }

      if (
        command ===
        "announcement-channel"
      ) {
        const channel =
          i.options.getChannel(
            "channel"
          );

        g.announcements.channel =
          channel.id;

        saveDB();

        return i.reply(
          `📢 Default announcement channel set to ${channel}.`
        );
      }

      if (
        command ===
        "announcement-tags"
      ) {
        const role =
          i.options.getRole(
            "role"
          );

        g.announcements.role =
          role.id;

        saveDB();

        return i.reply(
          `📢 Default announcement role set to ${role}.`
        );
      }

      /* =====================================================
         CONFIGURATION
      ===================================================== */

      if (
        [
          "config",
          "config-view",
          "config-reset",
          "config-ticket",
          "config-automod",
          "config-security",
          "config-logs",
          "config-suggestions",
          "config-announcements"
        ].includes(command)
      ) {
        if (
          !(await requireManageGuild(i))
        ) {
          return;
        }
      }

      if (
        command ===
        "config-reset"
      ) {
        resetGuild(
          i.guild.id
        );

        await sendLog(
          i.guild,
          "configuration",
          "⚙️ Server Configuration Reset",
          `Reset by: ${i.user}`
        );

        return i.reply(
          "⚙️ Server configuration has been reset."
        );
      }

      if (
        command ===
        "config-ticket"
      ) {
        return i.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle(
                "🎫 Ticket Configuration"
              )
              .setDescription(
                `**Enabled:** ${g.tickets.enabled}\n` +
                `**Category:** ${
                  g.tickets.category
                    ? `<#${g.tickets.category}>`
                    : "Not set"
                }\n` +
                `**Support Role:** ${
                  g.tickets.supportRole
                    ? `<@&${g.tickets.supportRole}>`
                    : "Not set"
                }\n` +
                `**Log Channel:** ${
                  g.tickets.logChannel
                    ? `<#${g.tickets.logChannel}>`
                    : "Not set"
                }\n` +
                `**Transcript:** ${g.tickets.transcript}\n` +
                `**DM Tickets:** ${g.tickets.dmEnabled}`
              )
          ]
        });
      }

      if (
        command ===
        "config-automod"
      ) {
        return i.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle(
                "🛡️ AutoMod Configuration"
              )
              .setDescription(
                `\`\`\`json\n${JSON.stringify(
                  g.automod,
                  null,
                  2
                ).slice(
                  0,
                  3900
                )}\n\`\`\``
              )
          ]
        });
      }

      if (
        command ===
        "config-security"
      ) {
        return i.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle(
                "🔐 Security Configuration"
              )
              .setDescription(
                `\`\`\`json\n${JSON.stringify(
                  g.security,
                  null,
                  2
                )}\n\`\`\``
              )
          ]
        });
      }

      if (
        command ===
        "config-logs"
      ) {
        return i.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle(
                "📜 Logging Configuration"
              )
              .setDescription(
                `**Admin Server:** ${
                  g.logs.adminServerId ||
                  "Not set"
                }\n\n` +
                LOG_TYPES.map(
                  type =>
                    `**${type}:** ${
                      g.logs[type]
                        ? `<#${g.logs[type]}>`
                        : g.logs.destinations[type]
                        ? `<#${g.logs.destinations[type]}>`
                        : "Not set"
                    }`
                ).join("\n")
              )
          ]
        });
      }

      if (
        command ===
        "config-suggestions"
      ) {
        return i.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle(
                "💡 Suggestion Configuration"
              )
              .setDescription(
                `**Enabled:** ${g.suggestions.enabled}\n` +
                `**Channel:** ${
                  g.suggestions.channel
                    ? `<#${g.suggestions.channel}>`
                    : "Not set"
                }\n` +
                `**Staff:** ${
                  g.suggestions.staffRole
                    ? `<@&${g.suggestions.staffRole}>`
                    : "Not set"
                }`
              )
          ]
        });
      }

      if (
        command ===
        "config-announcements"
      ) {
        return i.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle(
                "📢 Announcement Configuration"
              )
              .setDescription(
                `**Channel:** ${
                  g.announcements.channel
                    ? `<#${g.announcements.channel}>`
                    : "Not set"
                }\n` +
                `**Role:** ${
                  g.announcements.role
                    ? `<@&${g.announcements.role}>`
                    : "Not set"
                }\n` +
                `**Image:** ${
                  g.announcements.image ||
                  "Not set"
                }`
              )
          ]
        });
      }

      if (
        command ===
        "config-view"
      ) {
        return i.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle(
                `⚙️ ${i.guild.name} Configuration`
              )
              .setDescription(
                `**AutoMod:** ${
                  g.automod.enabled
                    ? "Enabled"
                    : "Disabled"
                }\n` +
                `**Security:** ${
                  g.security.enabled
                    ? "Enabled"
                    : "Disabled"
                }\n` +
                `**Anti-Nuke:** ${
                  g.security.antiNuke
                    ? "Enabled"
                    : "Disabled"
                }\n` +
                `**Raid Mode:** ${
                  g.security.raidMode
                    ? "ON"
                    : "OFF"
                }\n` +
                `**Tickets:** ${
                  g.tickets.enabled
                    ? "Enabled"
                    : "Disabled"
                }\n` +
                `**Suggestions:** ${
                  g.suggestions.enabled
                    ? "Enabled"
                    : "Disabled"
                }\n` +
                `**Central Admin Server:** ${
                  g.logs.adminServerId ||
                  "Not set"
                }`
              )
          ]
        });
      }

      if (
        command ===
        "config"
      ) {
        return i.reply(
          "⚙️ Use `/config-view`, `/config-ticket`, `/config-automod`, `/config-security`, `/config-logs`, `/config-suggestions`, or `/config-announcements` to view each configuration."
        );
      }

      /* Safety fallback */
      return i.reply({
        content:
          "❌ This command is registered but its handler was not found.",
        ephemeral: true
      });
    } catch (err) {
      console.error(
        "Interaction error:",
        err
      );

      if (!i.replied && !i.deferred) {
        await i.reply({
          content:
            "❌ An unexpected error occurred while processing this command.",
          ephemeral: true
        }).catch(() => {});
      } else {
        await i.followUp({
          content:
            "❌ An unexpected error occurred.",
          ephemeral: true
        }).catch(() => {});
      }

      if (i.guild) {
        await sendLog(
          i.guild,
          "errors",
          "❌ Bot Error",
          `**Command:** ${i.commandName || "unknown"}\n` +
            `**User:** ${i.user?.tag || "unknown"}\n` +
            `**Error:** ${String(err).slice(0, 1000)}`,
          0xed4245
        );
      }
    }
  }
);

/* =========================================================
   MESSAGE EVENTS
========================================================= */

client.on(
  "messageCreate",
  async message => {
    try {
      if (message.author.bot) {
        return;
      }

      /* DM TICKET SYSTEM */

      if (
        message.channel.type ===
        ChannelType.DM
      ) {
        /*
          DM ticket routing:
          The bot uses the first guild with DM tickets
          enabled. This avoids requiring a hard-coded
          GUILD_ID.

          For a multi-server production setup, users should
          open tickets through each server's panel/command,
          while DM tickets route to the first enabled support
          server available to the bot.
        */

        const guild =
          client.guilds.cache.find(
            server =>
              getGuild(
                server.id
              ).tickets.dmEnabled &&
              getGuild(
                server.id
              ).tickets.enabled
          );

        if (!guild) {
          return message.reply(
            "The support system is currently unavailable."
          ).catch(() => {});
        }

        const channel =
          await createTicket(
            guild,
            message.author,
            "DM"
          );

        if (channel) {
          await channel.send(
            `📩 **DM from ${message.author.tag}:**\n${message.content}`
          ).catch(() => {});

          await message.reply(
            `🎫 Your support ticket has been created in **${guild.name}**: ${channel.name}`
          ).catch(() => {});
        }

        return;
      }

      if (!message.guild) {
        return;
      }

      await processAutoMod(
        message
      );
    } catch (err) {
      console.error(
        "messageCreate error:",
        err
      );
    }
  }
);

/* =========================================================
   MEMBER EVENTS
========================================================= */

client.on(
  "guildMemberAdd",
  async member => {
    try {
      await processJoin(
        member
      );

      await sendLog(
        member.guild,
        "joins",
        "📥 Member Joined",
        `**Member:** ${member.user}\n` +
          `**ID:** ${member.id}\n` +
          `**Account Created:** <t:${Math.floor(member.user.createdTimestamp / 1000)}:F>`
      );

      const g =
        getGuild(
          member.guild.id
        );

      /*
        Anti-bot protection
      */

      if (
        member.user.bot &&
        g.security.enabled &&
        g.security.antiBotAdd &&
        !isTrustedBot(
          member.guild,
          member.user.id
        )
      ) {
        /*
          Discord bots cannot normally be banned here unless
          the bot has appropriate permissions and hierarchy.
        */

        await sendLog(
          member.guild,
          "bots",
          "🤖 Bot Added",
          `**Bot:** ${member.user.tag}\n` +
            `**Added to:** ${member.guild.name}`,
          0xfaa61a
        );
      }
    } catch (err) {
      console.error(
        "guildMemberAdd error:",
        err
      );
    }
  }
);

client.on(
  "guildMemberRemove",
  async member => {
    try {
      const g =
        getGuild(
          member.guild.id
        );

      g.stats.leaves++;

      saveDB();

      await sendLog(
        member.guild,
        "leaves",
        "📤 Member Left",
        `**Member:** ${member.user?.tag || member.id}\n` +
          `**ID:** ${member.id}`
      );
    } catch {}
  }
);

/* =========================================================
   ROLE PROTECTION
========================================================= */

client.on(
  "roleDelete",
  async role => {
    try {
      const guild =
        role.guild;

      const g =
        getGuild(
          guild.id
        );

      if (
        !g.roleProtect.enabled
      ) {
        return;
      }

      if (
        !g.roleProtect.protectedRoles.includes(
          role.id
        )
      ) {
        return;
      }

      const logs =
        await guild.fetchAuditLogs({
          type:
            AuditLogEvent.RoleDelete,
          limit: 5
        }).catch(() => null);

      const entry =
        logs?.entries.first();

      const executor =
        entry?.executor;

      if (
        executor &&
        isTrusted(
          guild,
          executor.id
        )
      ) {
        return;
      }

      await sendLog(
        guild,
        "security",
        "🛡️ Protected Role Deleted",
        `**Role:** ${role.name}\n` +
          `**Role ID:** ${role.id}\n` +
          `**Executor:** ${
            executor
              ? `${executor.tag} (${executor.id})`
              : "Unknown"
          }`,
        0xed4245
      );

      if (executor) {
        const member =
          await guild.members
            .fetch(executor.id)
            .catch(() => null);

        if (member) {
          await timeoutMember(
            member,
            g.roleProtect.timeoutMinutes,
            "Unauthorized protected-role deletion"
          ).catch(() => {});
        }
      }
    } catch (err) {
      console.error(
        "roleDelete error:",
        err
      );
    }
  }
);

client.on(
  "roleCreate",
  async role => {
    try {
      await sendLog(
        role.guild,
        "roles",
        "🎭 Role Created",
        `**Role:** ${role.name}\n` +
          `**ID:** ${role.id}`
      );
    } catch {}
  }
);

client.on(
  "roleUpdate",
  async (oldRole, newRole) => {
    try {
      if (
        oldRole.name ===
          newRole.name &&
        oldRole.color ===
          newRole.color &&
        oldRole.permissions.bitfield ===
          newRole.permissions.bitfield
      ) {
        return;
      }

      await sendLog(
        newRole.guild,
        "roles",
        "🎭 Role Updated",
        `**Role:** ${newRole.name}\n` +
          `**ID:** ${newRole.id}`
      );
    } catch {}
  }
);

/* =========================================================
   CHANNEL LOGGING
========================================================= */

client.on(
  "channelCreate",
  async channel => {
    if (!channel.guild) return;

    await sendLog(
      channel.guild,
      "channels",
      "📁 Channel Created",
      `**Channel:** ${channel.name}\n` +
        `**ID:** ${channel.id}`
    );
  }
);

client.on(
  "channelDelete",
  async channel => {
    if (!channel.guild) return;

    await sendLog(
      channel.guild,
      "channels",
      "🗑️ Channel Deleted",
      `**Channel:** ${channel.name}\n` +
        `**ID:** ${channel.id}`,
      0xed4245
    );
  }
);

client.on(
  "channelUpdate",
  async (oldChannel, newChannel) => {
    if (!newChannel.guild) return;

    if (
      oldChannel.name ===
        newChannel.name
    ) {
      return;
    }

    await sendLog(
      newChannel.guild,
      "channels",
      "✏️ Channel Updated",
      `**Old:** ${oldChannel.name}\n` +
        `**New:** ${newChannel.name}\n` +
        `**ID:** ${newChannel.id}`
    );
  }
);

/* =========================================================
   WEBHOOK LOGGING
========================================================= */

client.on(
  "webhookUpdate",
  async channel => {
    if (!channel.guild) return;

    const g =
      getGuild(
        channel.guild.id
      );

    if (
      !g.security.antiWebhook
    ) {
      return;
    }

    await sendLog(
      channel.guild,
      "webhooks",
      "🪝 Webhook Activity",
      `Webhook activity detected in ${channel}.`,
      0xfaa61a
    );
  }
);

/* =========================================================
   AUDIT LOG POLLING
========================================================= */

/*
  This periodically reads recent audit events.

  It does not attempt destructive actions by itself.
  It forwards important audit activity to configured
  local/central audit channels.
*/

const auditSeen = new Map();

async function pollAuditLogs() {
  for (
    const guild of client.guilds.cache.values()
  ) {
    try {
      const g =
        getGuild(
          guild.id
        );

      if (
        !g.logs.audit &&
        !g.logs.destinations.audit
      ) {
        continue;
      }

      const logs =
        await guild.fetchAuditLogs({
          limit: 20
        }).catch(() => null);

      if (!logs) continue;

      if (!auditSeen.has(guild.id)) {
        auditSeen.set(
          guild.id,
          new Set()
        );
      }

      const seen =
        auditSeen.get(
          guild.id
        );

      for (
        const entry of logs.entries.values()
      ) {
        if (
          seen.has(entry.id)
        ) {
          continue;
        }

        seen.add(entry.id);

        await sendLog(
          guild,
          "audit",
          "📜 Discord Audit Activity",
          `**Action:** ${entry.action}\n` +
            `**Executor:** ${
              entry.executor
                ? `${entry.executor.tag} (${entry.executor.id})`
                : "Unknown"
            }\n` +
            `**Target:** ${
              entry.target
                ? String(entry.target)
                : "Unknown"
            }`
        );
      }

      while (
        seen.size > 500
      ) {
        const first =
          seen.values().next().value;

        seen.delete(first);
      }
    } catch (err) {
      console.error(
        "Audit poll error:",
        err
      );
    }
  }
}

setInterval(
  pollAuditLogs,
  15000
);

/* =========================================================
   READY
========================================================= */

client.once(
  "ready",
  async () => {
    console.log(
      `Logged in as ${client.user.tag}`
    );

    console.log(
      `Connected to ${client.guilds.cache.size} servers.`
    );

    try {
      await registerCommands();
    } catch (err) {
      console.error(
        "Command registration failed:",
        err
      );
    }

    client.user.setPresence({
      activities: [
        {
          name:
            `${client.guilds.cache.size} servers`,
          type: 3
        }
      ],
      status: "online"
    });
  }
);

/* =========================================================
   ERROR HANDLING
========================================================= */

process.on(
  "unhandledRejection",
  error => {
    console.error(
      "Unhandled rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "Uncaught exception:",
      error
    );
  }
);

/* =========================================================
   LOGIN
========================================================= */

client.login(TOKEN);
