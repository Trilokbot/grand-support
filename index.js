"use strict";

/*
===========================================================
 GRA LEGENDS - MULTI SERVER DISCORD MANAGEMENT BOT
===========================================================

ONLY REQUIRED FILES:
  1. index.js
  2. package.json

ENVIRONMENT VARIABLES:
  DISCORD_TOKEN=YOUR_BOT_TOKEN
  CLIENT_ID=YOUR_APPLICATION_ID

OPTIONAL:
  PORT=10000

IMPORTANT BOT INTENTS:
  Guilds
  GuildMembers
  GuildMessages
  MessageContent
  GuildModeration
  GuildWebhooks
  GuildPresences

The bot stores all server configuration in:
  data/database.json

Every guild has independent:
  AutoMod
  Security
  Anti-nuke
  Role protection
  Trusted users/bots
  Logs
  Tickets
  Suggestions
  Announcements
  Warnings
  Punishments
===========================================================
*/

const fs = require("fs");
const path = require("path");
const http = require("http");

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
  AuditLogEvent,
  AttachmentBuilder
} = require("discord.js");

/* =========================================================
   BASIC CONFIG
========================================================= */

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error("ERROR: DISCORD_TOKEN and CLIENT_ID are required.");
  process.exit(1);
}

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "database.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

/* =========================================================
   DATABASE
========================================================= */

let db = {};

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

const DEFAULT_GUILD = {
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
    timeoutMinutes: 5,
    logChannel: null,
    badWords: []
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

  roleProtect: {
    enabled: true,
    protectedRoles: [],
    timeoutMinutes: 60
  },

  trusted: {
    users: [],
    bots: []
  },

  logs: {
    general: null,
    moderation: null,
    security: null,
    automod: null,
    audit: null,
    tickets: null
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

  createdAt: Date.now()
};

try {
  if (fs.existsSync(DB_FILE)) {
    db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  }
} catch (err) {
  console.error("Database read error:", err);
  db = {};
}

function saveDB() {
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
  } catch (err) {
    console.error("Database save error:", err);
  }
}

function getGuild(guildId) {
  if (!guildId) return null;

  if (!db[guildId]) {
    db[guildId] = clone(DEFAULT_GUILD);
    saveDB();
  }

  const g = db[guildId];

  if (!g.automod) g.automod = clone(DEFAULT_GUILD.automod);
  if (!g.autotimeout) g.autotimeout = clone(DEFAULT_GUILD.autotimeout);
  if (!g.security) g.security = clone(DEFAULT_GUILD.security);
  if (!g.roleProtect) g.roleProtect = clone(DEFAULT_GUILD.roleProtect);
  if (!g.trusted) g.trusted = clone(DEFAULT_GUILD.trusted);
  if (!g.logs) g.logs = clone(DEFAULT_GUILD.logs);
  if (!g.tickets) g.tickets = clone(DEFAULT_GUILD.tickets);
  if (!g.suggestions) g.suggestions = clone(DEFAULT_GUILD.suggestions);
  if (!g.announcements) g.announcements = clone(DEFAULT_GUILD.announcements);
  if (!g.warnings) g.warnings = {};
  if (!g.punishments) g.punishments = {};
  if (!g.ticketsData) g.ticketsData = {};
  if (!g.suggestionsData) g.suggestionsData = {};

  for (const key of Object.keys(DEFAULT_GUILD.automod)) {
    if (g.automod[key] === undefined) {
      g.automod[key] = clone(DEFAULT_GUILD.automod[key]);
    }
  }

  return g;
}

function resetGuild(guildId) {
  db[guildId] = clone(DEFAULT_GUILD);
  saveDB();
  return db[guildId];
}

function addWarning(guildId, userId, reason, moderatorId) {
  const g = getGuild(guildId);

  if (!g.warnings[userId]) {
    g.warnings[userId] = [];
  }

  const entry = {
    reason: cleanReason(reason),
    moderatorId,
    timestamp: Date.now()
  };

  g.warnings[userId].push(entry);

  if (!g.punishments[userId]) {
    g.punishments[userId] = [];
  }

  g.punishments[userId].push({
    type: "warn",
    reason: entry.reason,
    moderatorId,
    timestamp: entry.timestamp
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
    reason: cleanReason(reason),
    moderatorId,
    timestamp: Date.now()
  });

  saveDB();
}

/* =========================================================
   HELPERS
========================================================= */

function cleanReason(reason) {
  return String(reason || "No reason provided.").slice(0, 500);
}

function durationMs(minutes) {
  return Math.max(1, Number(minutes)) * 60 * 1000;
}

function percentCaps(text) {
  const letters = text.match(/[A-Za-z]/g);

  if (!letters || !letters.length) return 0;

  const caps = text.match(/[A-Z]/g) || [];

  return Math.round((caps.length / letters.length) * 100);
}

function containsInvite(content) {
  return /(?:discord\.gg|discord(?:app)?\.com\/invite)\//i.test(content);
}

function containsLink(content) {
  return /(https?:\/\/|www\.)/i.test(content);
}

function isAdmin(member) {
  if (!member) return false;

  return member.permissions?.has(
    PermissionsBitField.Flags.Administrator
  );
}

function isManager(member) {
  if (!member) return false;

  return (
    isAdmin(member) ||
    member.permissions?.has(PermissionsBitField.Flags.ManageGuild)
  );
}

function hasSupportRole(member, guildConfig) {
  if (!member || !guildConfig?.tickets?.supportRole) return false;

  return member.roles?.cache?.has(guildConfig.tickets.supportRole);
}

function canManage(member, guildConfig) {
  return isManager(member) || hasSupportRole(member, guildConfig);
}

function isTrusted(guild, userId) {
  if (!guild || !userId) return false;

  const g = getGuild(guild.id);

  return (
    guild.ownerId === userId ||
    g.trusted.users.includes(userId)
  );
}

function isTrustedBot(guild, userId) {
  if (!guild || !userId) return false;

  const g = getGuild(guild.id);

  return (
    isTrusted(guild, userId) ||
    g.trusted.bots.includes(userId)
  );
}

function getLogChannel(guild, type = "general") {
  if (!guild) return null;

  const g = getGuild(guild.id);

  const id =
    g.logs[type] ||
    g.logs.general ||
    null;

  if (!id) return null;

  return guild.channels.cache.get(id) || null;
}

async function sendLog(
  guild,
  type,
  title,
  description,
  color = 0x5865f2
) {
  try {
    const channel = getLogChannel(guild, type);

    if (!channel || !channel.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(description || "No details.")
      .setTimestamp();

    await channel.send({
      embeds: [embed]
    });
  } catch {}
}

async function timeoutMember(member, minutes, reason) {
  if (!member?.moderatable) return false;

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

async function safeReply(interaction, data) {
  try {
    if (interaction.replied || interaction.deferred) {
      return await interaction.followUp(data);
    }

    return await interaction.reply(data);
  } catch {
    return null;
  }
}

function adminOnly(i) {
  return isManager(i.member);
}

function staffOnly(i) {
  const g = getGuild(i.guild.id);

  return canManage(i.member, g);
}

function commandPermission(i, type = "admin") {
  if (!i.guild) return false;

  if (type === "staff") {
    return staffOnly(i);
  }

  return adminOnly(i);
}

function memberTarget(i, name = "user") {
  return i.options.getMember(name);
}

function userTarget(i, name = "user") {
  return i.options.getUser(name);
}

async function makeTranscript(channel) {
  try {
    const messages = await channel.messages.fetch({
      limit: 100
    });

    return [...messages.values()]
      .reverse()
      .map(
        m =>
          `[${new Date(
            m.createdTimestamp
          ).toISOString()}] ${m.author.tag}: ${m.content || "[attachment/embed]"}`
      )
      .join("\n");
  } catch {
    return "Unable to create transcript.";
  }
}

function formatConfig(g) {
  return [
    `🛡️ AutoMod: ${g.automod.enabled ? "ON" : "OFF"}`,
    `🚨 Security: ${g.security.enabled ? "ON" : "OFF"}`,
    `☢️ Anti-Nuke: ${g.security.antiNuke ? "ON" : "OFF"}`,
    `🎫 Tickets: ${g.tickets.enabled ? "ON" : "OFF"}`,
    `💡 Suggestions: ${g.suggestions.enabled ? "ON" : "OFF"}`,
    `🛡️ Role Protection: ${g.roleProtect.enabled ? "ON" : "OFF"}`,
    `📋 Audit Log: ${g.logs.audit ? `<#${g.logs.audit}>` : "Not configured"}`
  ].join("\n");
}

/* =========================================================
   COMMAND DEFINITIONS
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
        .setDescription("User to inspect")
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
        .setDescription("Strikes before timeout")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(20)
    )
    .addIntegerOption(o =>
      o.setName("minutes")
        .setDescription("Timeout duration")
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
        .setDescription("Protect bot additions")
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
    .setDescription("Remove a trusted user/bot.")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("trusted-list")
    .setDescription("List trusted users and bots.")
);

/* Role protection */

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
    .setDescription("Remove a protected role.")
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
        .setDescription("Unauthorized user timeout")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(40320)
    )
);

/* Logging */

commands.push(
  new SlashCommandBuilder()
    .setName("logs")
    .setDescription("Configure logs.")
    .addStringOption(o =>
      o.setName("type")
        .setDescription("Log type")
        .setRequired(true)
        .addChoices(
          { name: "general", value: "general" },
          { name: "moderation", value: "moderation" },
          { name: "security", value: "security" },
          { name: "automod", value: "automod" },
          { name: "audit", value: "audit" },
          { name: "tickets", value: "tickets" }
        )
    )
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Channel")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("logs-config")
    .setDescription("View logging configuration."),

  new SlashCommandBuilder()
    .setName("audit")
    .setDescription("Show recent Discord audit activity."),

  new SlashCommandBuilder()
    .setName("audit-config")
    .setDescription("Set audit log channel.")
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Channel")
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
    .setDescription("Create the ticket panel.")
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Panel channel")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ticket-close")
    .setDescription("Close the current ticket."),

  new SlashCommandBuilder()
    .setName("ticket-delete")
    .setDescription("Delete the current ticket."),

  new SlashCommandBuilder()
    .setName("ticket-add")
    .setDescription("Add a member to the ticket.")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ticket-remove")
    .setDescription("Remove a member from the ticket.")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ticket-claim")
    .setDescription("Claim the current ticket."),

  new SlashCommandBuilder()
    .setName("ticket-unclaim")
    .setDescription("Unclaim the current ticket."),

  new SlashCommandBuilder()
    .setName("ticket-transcript")
    .setDescription("Create a ticket transcript."),

  new SlashCommandBuilder()
    .setName("ticket-lock")
    .setDescription("Lock the current ticket."),

  new SlashCommandBuilder()
    .setName("ticket-unlock")
    .setDescription("Unlock the current ticket."),

  new SlashCommandBuilder()
    .setName("ticket-rename")
    .setDescription("Rename the current ticket.")
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
        .setDescription("Your suggestion")
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
        .setDescription("Role to mention")
        .setRequired(false)
    )
    .addStringOption(o =>
      o.setName("image")
        .setDescription("Image URL")
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("announcement-panel")
    .setDescription("Create an announcement management panel.")
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
        .setDescription("Default image URL")
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
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildPresences,
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
const joins = new Map();
const auditCache = new Map();

function trackMessage(guildId, userId, content) {
  const key = `${guildId}:${userId}`;
  const now = Date.now();

  if (!messageTracker.has(key)) {
    messageTracker.set(key, []);
  }

  const arr = messageTracker.get(key);

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
  if (!message.guild || message.author.bot) return;

  const g = getGuild(message.guild.id);

  if (!g.automod.enabled) return;

  if (isTrusted(message.guild, message.author.id)) {
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
    g.automod.badWords.some(
      word =>
        lower.includes(
          String(word).toLowerCase()
        )
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
    containsLink(content)
  ) {
    violation = "Unauthorized link";
  }

  const history = trackMessage(
    message.guild.id,
    message.author.id,
    content
  );

  if (
    !violation &&
    g.automod.repeated
  ) {
    const recent = history.filter(
      x =>
        Date.now() - x.timestamp <=
        g.automod.repeatedWindow
    );

    const count = recent.filter(
      x => x.content === content
    ).length;

    if (
      count >=
      g.automod.repeatedMessages
    ) {
      violation = "Repeated messages";
    }
  }

  if (
    !violation &&
    g.automod.spam
  ) {
    const recent = history.filter(
      x =>
        Date.now() - x.timestamp <=
        g.automod.spamWindow
    );

    if (
      recent.length >=
      g.automod.spamMessages
    ) {
      violation = "Spam";
    }
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
    `**User:** ${message.author.tag}\n**Violation:** ${violation}\n**Strikes:** ${strikes}`,
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
          `**User:** ${message.author.tag}\n**Duration:** ${g.autotimeout.minutes} minutes\n**Reason:** ${violation}`,
          0xfaa61a
        );
      }
    }
  }
}

/* =========================================================
   TICKET SYSTEM
========================================================= */

function isTicketChannel(guild, channelId) {
  const g = getGuild(guild.id);

  return !!g.ticketsData[channelId];
}

function getTicket(guild, channelId) {
  const g = getGuild(guild.id);

  return g.ticketsData[channelId] || null;
}

async function createTicket(
  guild,
  user,
  source = "command"
) {
  const g = getGuild(guild.id);

  if (!g.tickets.enabled) {
    return null;
  }

  if (!g.tickets.supportRole) {
    return null;
  }

  const existing =
    Object.values(g.ticketsData).find(
      t =>
        t.userId === user.id &&
        t.status === "open"
    );

  if (existing) {
    return (
      guild.channels.cache.get(
        existing.channelId
      ) || null
    );
  }

  let baseName =
    String(user.username || "user")
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .slice(0, 70);

  if (!baseName) baseName = "user";

  const permissionOverwrites = [
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
    },

    {
      id: g.tickets.supportRole,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageMessages
      ]
    }
  ];

  const channel =
    await guild.channels.create({
      name: `ticket-${baseName}`,
      type: ChannelType.GuildText,
      parent:
        g.tickets.category || undefined,
      permissionOverwrites
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
        `Welcome <@${user.id}>!\n\nA member of the support team will assist you shortly.`
      )
      .setFooter({
        text: guild.name
      })
      .setTimestamp();

  const row =
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket_claim")
        .setLabel("Claim")
        .setEmoji("🙋")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("ticket_unclaim")
        .setLabel("Unclaim")
        .setEmoji("↩️")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("ticket_lock")
        .setLabel("Lock")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("ticket_close")
        .setLabel("Close")
        .setEmoji("🔴")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId("ticket_delete")
        .setLabel("Delete")
        .setEmoji("🗑️")
        .setStyle(ButtonStyle.Danger)
    );

  await channel.send({
    content: `<@${user.id}> <@&${g.tickets.supportRole}>`,
    embeds: [embed],
    components: [row]
  });

  await sendLog(
    guild,
    "tickets",
    "🎫 Ticket Created",
    `**User:** <@${user.id}>\n**Channel:** ${channel}\n**Source:** ${source}`
  );

  return channel;
}

async function closeTicket(interaction) {
  const g = getGuild(interaction.guild.id);
  const ticket = g.ticketsData[interaction.channelId];

  if (!ticket) {
    return safeReply(interaction, {
      content: "❌ This is not a ticket.",
      ephemeral: true
    });
  }

  if (
    !isManager(interaction.member) &&
    interaction.user.id !== ticket.userId &&
    !hasSupportRole(interaction.member, g)
  ) {
    return safeReply(interaction, {
      content: "❌ You cannot close this ticket.",
      ephemeral: true
    });
  }

  await safeReply(interaction, {
    content: "🔒 Closing ticket..."
  });

  const transcript =
    await makeTranscript(interaction.channel);

  ticket.status = "closed";
  ticket.closedAt = Date.now();
  ticket.closedBy = interaction.user.id;

  saveDB();

  const logChannel =
    interaction.guild.channels.cache.get(
      g.tickets.logChannel ||
        g.logs.tickets ||
        g.logs.general
    );

  if (logChannel) {
    await logChannel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("🎫 Ticket Closed")
          .setDescription(
            `**Channel:** ${interaction.channel.name}\n**Owner:** <@${ticket.userId}>\n**Closed by:** ${interaction.user}`
          )
          .setTimestamp()
      ]
    }).catch(() => {});

    if (g.tickets.transcript) {
      await logChannel.send({
        files: [
          {
            attachment:
              Buffer.from(transcript, "utf8"),
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
    `**Ticket:** ${interaction.channel.name}\n**Closed by:** ${interaction.user}`
  );

  setTimeout(() => {
    interaction.channel.delete().catch(() => {});
  }, 2000);
}

async function deleteTicket(interaction) {
  const g = getGuild(interaction.guild.id);
  const ticket = g.ticketsData[interaction.channelId];

  if (!ticket) {
    return safeReply(interaction, {
      content: "❌ This is not a ticket.",
      ephemeral: true
    });
  }

  if (
    !isManager(interaction.member) &&
    !hasSupportRole(interaction.member, g)
  ) {
    return safeReply(interaction, {
      content: "❌ Staff only.",
      ephemeral: true
    });
  }

  await safeReply(interaction, {
    content: "🗑️ Deleting ticket..."
  });

  const transcript =
    await makeTranscript(interaction.channel);

  if (g.tickets.transcript) {
    const logChannel =
      interaction.guild.channels.cache.get(
        g.tickets.logChannel ||
          g.logs.tickets ||
          g.logs.general
      );

    if (logChannel) {
      await logChannel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle("🗑️ Ticket Deleted")
            .setDescription(
              `**Channel:** ${interaction.channel.name}\n**Owner:** <@${ticket.userId}>\n**Deleted by:** ${interaction.user}`
            )
            .setTimestamp()
        ]
      }).catch(() => {});

      await logChannel.send({
        files: [
          {
            attachment:
              Buffer.from(transcript, "utf8"),
            name:
              `${interaction.channel.name}-transcript.txt`
          }
        ]
      }).catch(() => {});
    }
  }

  ticket.status = "deleted";
  ticket.deletedAt = Date.now();
  ticket.deletedBy = interaction.user.id;

  saveDB();

  await sendLog(
    interaction.guild,
    "tickets",
    "🗑️ Ticket Deleted",
    `**Ticket:** ${interaction.channel.name}\n**Deleted by:** ${interaction.user}`
  );

  await interaction.channel.delete().catch(() => {});
}

/* =========================================================
   RAID DETECTION
========================================================= */

async function handleMemberJoin(member) {
  const guild = member.guild;
  const g = getGuild(guild.id);

  if (!g.security.enabled) return;
  if (!g.security.antiRaid) return;

  const now = Date.now();

  if (!joins.has(guild.id)) {
    joins.set(guild.id, []);
  }

  const arr = joins.get(guild.id);

  arr.push({
    id: member.id,
    timestamp: now
  });

  while (
    arr.length &&
    now - arr[0].timestamp >
      g.security.joinWindow
  ) {
    arr.shift();
  }

  if (
    arr.length >=
    g.security.joinLimit
  ) {
    g.security.raidMode = true;
    saveDB();

    await sendLog(
      guild,
      "security",
      "🚨 Raid Detection",
      `Detected **${arr.length} joins** within the configured window.\n\nRaid mode has been enabled.`,
      0xed4245
    );
  }
}

/* =========================================================
   AUDIT / ANTI-NUKE
========================================================= */

async function checkAudit(guild, type, userId) {
  const g = getGuild(guild.id);

  if (!g.security.enabled) return;
  if (!g.security.antiNuke) return;
  if (isTrusted(guild, userId)) return;

  const key =
    `${guild.id}:${type}:${userId}`;

  const now = Date.now();
  const last =
    auditCache.get(key) || 0;

  if (now - last < 5000) return;

  auditCache.set(key, now);

  await sendLog(
    guild,
    "security",
    "☢️ Anti-Nuke Alert",
    `**Action:** ${type}\n**User:** <@${userId}>\n\nThe actor is not trusted.`,
    0xed4245
  );

  try {
    const member =
      await guild.members
        .fetch(userId)
        .catch(() => null);

    if (
      member &&
      member.moderatable
    ) {
      await timeoutMember(
        member,
        60,
        `Anti-nuke protection: ${type}`
      );

      addPunishment(
        guild.id,
        userId,
        "anti-nuke-timeout",
        type,
        client.user.id
      );
    }
  } catch {}
}

/* =========================================================
   COMMAND HANDLER
========================================================= */

async function handleCommand(i) {
  const command = i.commandName;

  if (!i.guild) {
    return safeReply(i, {
      content:
        "❌ This command can only be used inside a server.",
      ephemeral: true
    });
  }

  const g = getGuild(i.guild.id);

  /* ================= GENERAL ================= */

  if (command === "ping") {
    return safeReply(i, {
      content: `🏓 Pong! **${client.ws.ping}ms**`
    });
  }

  if (command === "uptime") {
    const seconds =
      Math.floor(process.uptime());

    const days =
      Math.floor(seconds / 86400);

    const hours =
      Math.floor((seconds % 86400) / 3600);

    const minutes =
      Math.floor((seconds % 3600) / 60);

    const secs =
      seconds % 60;

    return safeReply(i, {
      content:
        `⏱️ Uptime: **${days}d ${hours}h ${minutes}m ${secs}s**`
    });
  }

  if (command === "help") {
    const categories = {
      "General":
        ["ping", "help", "botinfo", "serverinfo", "userinfo", "avatar", "uptime"],

      "Moderation":
        ["warn", "warnings", "warnings-clear", "punishments", "kick", "ban", "unban", "timeout", "untimeout", "purge", "slowmode", "lock", "unlock"],

      "AutoMod":
        ["automod", "automod-config", "automod-logs", "automod-word", "automod-word-remove", "autotimeout", "autotimeout-config"],

      "Security":
        ["security", "security-config", "raidmode", "raidmode-config", "antinuke", "antinuke-config"],

      "Trusted":
        ["trusted", "trusted-add", "trusted-remove", "trusted-list"],

      "Role Protection":
        ["roleprotect", "roleprotect-add", "roleprotect-remove", "roleprotect-list", "roleprotect-config"],

      "Logging":
        ["logs", "logs-config", "audit", "audit-config", "modlogs", "security-logs"],

      "Tickets":
        ["ticket", "ticket-panel", "ticket-close", "ticket-delete", "ticket-add", "ticket-remove", "ticket-claim", "ticket-unclaim", "ticket-transcript", "ticket-lock", "ticket-unlock", "ticket-rename", "ticket-config"],

      "Suggestions":
        ["suggest", "suggest-config", "suggestions"],

      "Announcements":
        ["announce", "announcement-panel", "announcement-config", "announcement-channel", "announcement-tags"],

      "Configuration":
        ["config", "config-view", "config-reset", "config-ticket", "config-automod", "config-security", "config-logs", "config-suggestions", "config-announcements"]
    };

    const embed =
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("🤖 Bot Commands")
        .setDescription(
          Object.entries(categories)
            .map(
              ([name, list]) =>
                `**${name}**\n${list.map(x => `\`/${x}\``).join(" • ")}`
            )
            .join("\n\n")
        )
        .setTimestamp();

    return safeReply(i, {
      embeds: [embed],
      ephemeral: true
    });
  }

  if (command === "botinfo") {
    const embed =
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("🤖 Bot Information")
        .addFields(
          {
            name: "Servers",
            value: String(client.guilds.cache.size),
            inline: true
          },
          {
            name: "Users",
            value: String(client.guilds.cache.reduce((a, x) => a + (x.memberCount || 0), 0)),
            inline: true
          },
          {
            name: "Ping",
            value: `${client.ws.ping}ms`,
            inline: true
          },
          {
            name: "Commands",
            value: String(commands.length),
            inline: true
          },
          {
            name: "Database",
            value: "Persistent JSON",
            inline: true
          },
          {
            name: "Architecture",
            value: "Multi-server",
            inline: true
          }
        )
        .setTimestamp();

    return safeReply(i, {
      embeds: [embed]
    });
  }

  if (command === "serverinfo") {
    const guild = i.guild;

    const embed =
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🏠 ${guild.name}`)
        .setThumbnail(
          guild.iconURL({ size: 1024 }) || null
        )
        .addFields(
          {
            name: "Owner",
            value: `<@${guild.ownerId}>`,
            inline: true
          },
          {
            name: "Members",
            value: String(guild.memberCount),
            inline: true
          },
          {
            name: "Channels",
            value: String(guild.channels.cache.size),
            inline: true
          },
          {
            name: "Roles",
            value: String(guild.roles.cache.size),
            inline: true
          },
          {
            name: "Created",
            value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>`,
            inline: false
          }
        )
        .setTimestamp();

    return safeReply(i, {
      embeds: [embed]
    });
  }

  if (command === "userinfo") {
    const user =
      userTarget(i) || i.user;

    const member =
      await i.guild.members
        .fetch(user.id)
        .catch(() => null);

    const embed =
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`👤 ${user.tag}`)
        .setThumbnail(
          user.displayAvatarURL({
            size: 1024
          })
        )
        .addFields(
          {
            name: "User ID",
            value: user.id,
            inline: true
          },
          {
            name: "Bot",
            value: user.bot ? "Yes" : "No",
            inline: true
          },
          {
            name: "Joined Server",
            value:
              member?.joinedTimestamp
                ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`
                : "Unknown",
            inline: false
          }
        )
        .setTimestamp();

    return safeReply(i, {
      embeds: [embed]
    });
  }

  if (command === "avatar") {
    const user =
      userTarget(i) || i.user;

    return safeReply(i, {
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`🖼️ ${user.tag}'s Avatar`)
          .setImage(
            user.displayAvatarURL({
              size: 4096,
              extension: "png"
            })
          )
      ]
    });
  }

  /* ================= MODERATION ================= */

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
    if (!commandPermission(i, "admin")) {
      return safeReply(i, {
        content:
          "❌ Administrator/Manage Server permission required.",
        ephemeral: true
      });
    }
  }

  if (command === "warn") {
    const user =
      userTarget(i, "user");

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
      member.id === i.guild.ownerId
    ) {
      return safeReply(i, {
        content:
          "❌ The server owner cannot be warned.",
        ephemeral: true
      });
    }

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
      "⚠️ Warning",
      `**User:** ${user}\n**Moderator:** ${i.user}\n**Reason:** ${reason}\n**Total warnings:** ${count}`,
      0xfaa61a
    );

    return safeReply(i, {
      content:
        `⚠️ ${user} warned.\nReason: **${reason}**\nTotal warnings: **${count}**`
    });
  }

  if (command === "warnings") {
    const user =
      userTarget(i, "user");

    const list =
      g.warnings[user.id] || [];

    if (!list.length) {
      return safeReply(i, {
        content:
          `✅ ${user} has no warnings.`
      });
    }

    const text =
      list.slice(-15)
        .map(
          (x, n) =>
            `**${n + 1}.** ${x.reason}\nModerator: <@${x.moderatorId}>\n<t:${Math.floor(x.timestamp / 1000)}:R>`
        )
        .join("\n\n");

    return safeReply(i, {
      embeds: [
        new EmbedBuilder()
          .setColor(0xfaa61a)
          .setTitle(`⚠️ Warnings — ${user.tag}`)
          .setDescription(text)
      ]
    });
  }

  if (command === "warnings-clear") {
    const user =
      userTarget(i, "user");

    const old =
      (g.warnings[user.id] || []).length;

    g.warnings[user.id] = [];

    saveDB();

    await sendLog(
      i.guild,
      "moderation",
      "🧹 Warnings Cleared",
      `**User:** ${user}\n**Moderator:** ${i.user}\n**Cleared:** ${old}`
    );

    return safeReply(i, {
      content:
        `🧹 Cleared **${old}** warnings for ${user}.`
    });
  }

  if (command === "punishments") {
    const user =
      userTarget(i, "user");

    const list =
      g.punishments[user.id] || [];

    if (!list.length) {
      return safeReply(i, {
        content:
          `✅ ${user} has no punishment history.`
      });
    }

    const text =
      list.slice(-20)
        .map(
          (x, n) =>
            `**${n + 1}. ${x.type}** — ${x.reason}\nModerator: <@${x.moderatorId}>\n<t:${Math.floor(x.timestamp / 1000)}:R>`
        )
        .join("\n\n");

    return safeReply(i, {
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle(`📋 Punishments — ${user.tag}`)
          .setDescription(text)
      ]
    });
  }

  if (command === "kick") {
    const member =
      memberTarget(i);

    const reason =
      cleanReason(
        i.options.getString("reason")
      );

    if (!member) {
      return safeReply(i, {
        content: "❌ Member not found.",
        ephemeral: true
      });
    }

    if (
      member.id === i.guild.ownerId ||
      !member.kickable
    ) {
      return safeReply(i, {
        content:
          "❌ I cannot kick this member.",
        ephemeral: true
      });
    }

    await member.kick(reason);

    addPunishment(
      i.guild.id,
      member.id,
      "kick",
      reason,
      i.user.id
    );

    await sendLog(
      i.guild,
      "moderation",
      "👢 Member Kicked",
      `**User:** ${member.user}\n**Moderator:** ${i.user}\n**Reason:** ${reason}`,
      0xed4245
    );

    return safeReply(i, {
      content:
        `👢 ${member.user} has been kicked.`
    });
  }

  if (command === "ban") {
    const member =
      memberTarget(i);

    const reason =
      cleanReason(
        i.options.getString("reason")
      );

    if (!member) {
      return safeReply(i, {
        content: "❌ Member not found.",
        ephemeral: true
      });
    }

    if (
      member.id === i.guild.ownerId ||
      !member.bannable
    ) {
      return safeReply(i, {
        content:
          "❌ I cannot ban this member.",
        ephemeral: true
      });
    }

    await member.ban({
      reason
    });

    addPunishment(
      i.guild.id,
      member.id,
      "ban",
      reason,
      i.user.id
    );

    await sendLog(
      i.guild,
      "moderation",
      "🔨 Member Banned",
      `**User:** ${member.user}\n**Moderator:** ${i.user}\n**Reason:** ${reason}`,
      0xed4245
    );

    return safeReply(i, {
      content:
        `🔨 ${member.user} has been banned.`
    });
  }

  if (command === "unban") {
    const userId =
      i.options.getString("userid");

    const reason =
      cleanReason(
        i.options.getString("reason")
      );

    try {
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
        `**User ID:** ${userId}\n**Moderator:** ${i.user}\n**Reason:** ${reason}`
      );

      return safeReply(i, {
        content:
          `🔓 User **${userId}** has been unbanned.`
      });
    } catch {
      return safeReply(i, {
        content:
          "❌ Could not unban that user.",
        ephemeral: true
      });
    }
  }

  if (command === "timeout") {
    const member =
      memberTarget(i);

    const minutes =
      i.options.getInteger("minutes");

    const reason =
      cleanReason(
        i.options.getString("reason")
      );

    if (!member?.moderatable) {
      return safeReply(i, {
        content:
          "❌ I cannot timeout this member.",
        ephemeral: true
      });
    }

    const success =
      await timeoutMember(
        member,
        minutes,
        reason
      );

    if (!success) {
      return safeReply(i, {
        content:
          "❌ Timeout failed.",
        ephemeral: true
      });
    }

    addPunishment(
      i.guild.id,
      member.id,
      "timeout",
      `${minutes} minutes: ${reason}`,
      i.user.id
    );

    await sendLog(
      i.guild,
      "moderation",
      "⏱️ Member Timed Out",
      `**User:** ${member.user}\n**Duration:** ${minutes} minutes\n**Moderator:** ${i.user}\n**Reason:** ${reason}`,
      0xfaa61a
    );

    return safeReply(i, {
      content:
        `⏱️ ${member.user} timed out for **${minutes} minutes**.`
    });
  }

  if (command === "untimeout") {
    const member =
      memberTarget(i);

    if (!member?.moderatable) {
      return safeReply(i, {
        content:
          "❌ I cannot remove this member's timeout.",
        ephemeral: true
      });
    }

    try {
      await member.timeout(null, "Timeout removed");

      addPunishment(
        i.guild.id,
        member.id,
        "untimeout",
        "Timeout removed",
        i.user.id
      );

      await sendLog(
        i.guild,
        "moderation",
        "🔓 Timeout Removed",
        `**User:** ${member.user}\n**Moderator:** ${i.user}`
      );

      return safeReply(i, {
        content:
          `🔓 Timeout removed from ${member.user}.`
      });
    } catch {
      return safeReply(i, {
        content:
          "❌ Failed to remove timeout.",
        ephemeral: true
      });
    }
  }

  if (command === "purge") {
    const amount =
      i.options.getInteger("amount");

    if (!i.channel?.isTextBased()) {
      return safeReply(i, {
        content:
          "❌ This channel cannot be purged.",
        ephemeral: true
      });
    }

    const deleted =
      await i.channel.bulkDelete(
        amount,
        true
      );

    await sendLog(
      i.guild,
      "moderation",
      "🧹 Messages Purged",
      `**Channel:** ${i.channel}\n**Amount:** ${deleted.size}\n**Moderator:** ${i.user}`
    );

    return safeReply(i, {
      content:
        `🧹 Deleted **${deleted.size}** messages.`
    });
  }

  if (command === "slowmode") {
    const seconds =
      i.options.getInteger("seconds");

    if (!i.channel?.setRateLimitPerUser) {
      return safeReply(i, {
        content:
          "❌ This channel does not support slowmode.",
        ephemeral: true
      });
    }

    await i.channel.setRateLimitPerUser(
      seconds,
      `Changed by ${i.user.tag}`
    );

    return safeReply(i, {
      content:
        `🐌 Slowmode set to **${seconds}s**.`
    });
  }

  if (
    command === "lock" ||
    command === "unlock"
  ) {
    const everyone =
      i.guild.roles.everyone;

    const locked =
      command === "lock";

    await i.channel.permissionOverwrites.edit(
      everyone,
      {
        SendMessages: locked ? false : null
      }
    );

    await sendLog(
      i.guild,
      "moderation",
      locked
        ? "🔒 Channel Locked"
        : "🔓 Channel Unlocked",
      `**Channel:** ${i.channel}\n**Moderator:** ${i.user}`
    );

    return safeReply(i, {
      content:
        locked
          ? "🔒 Channel locked."
          : "🔓 Channel unlocked."
    });
  }

  /* ================= AUTOMOD ================= */

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
    if (!commandPermission(i)) {
      return safeReply(i, {
        content:
          "❌ Administrator/Manage Server permission required.",
        ephemeral: true
      });
    }
  }

  if (command === "automod") {
    const action =
      i.options.getString("action");

    if (action === "status") {
      return safeReply(i, {
        content:
          `🛡️ AutoMod is currently **${g.automod.enabled ? "ENABLED" : "DISABLED"}**.`
      });
    }

    g.automod.enabled =
      action === "enable";

    saveDB();

    await sendLog(
      i.guild,
      "automod",
      "🛡️ AutoMod Updated",
      `**Status:** ${g.automod.enabled ? "Enabled" : "Disabled"}\n**Changed by:** ${i.user}`
    );

    return safeReply(i, {
      content:
        `🛡️ AutoMod **${g.automod.enabled ? "enabled" : "disabled"}**.`
    });
  }

  if (command === "automod-config") {
    const feature =
      i.options.getString("feature");

    const enabled =
      i.options.getBoolean("enabled");

    g.automod[feature] =
      enabled;

    saveDB();

    return safeReply(i, {
      content:
        `🛡️ AutoMod feature **${feature}** is now **${enabled ? "enabled" : "disabled"}**.`
    });
  }

  if (command === "automod-logs") {
    const channel =
      i.options.getChannel("channel");

    g.automod.logChannel =
      channel.id;

    g.logs.automod =
      channel.id;

    saveDB();

    return safeReply(i, {
      content:
        `🛡️ AutoMod logs set to ${channel}.`
    });
  }

  if (command === "automod-word") {
    const word =
      i.options.getString("word")
        .trim()
        .toLowerCase();

    if (
      !g.automod.badWords.includes(word)
    ) {
      g.automod.badWords.push(word);
      saveDB();
    }

    return safeReply(i, {
      content:
        `🚫 Added blocked word: **${word}**`
    });
  }

  if (command === "automod-word-remove") {
    const word =
      i.options.getString("word")
        .trim()
        .toLowerCase();

    g.automod.badWords =
      g.automod.badWords.filter(
        x => x !== word
      );

    saveDB();

    return safeReply(i, {
      content:
        `✅ Removed blocked word: **${word}**`
    });
  }

  if (command === "autotimeout") {
    const action =
      i.options.getString("action");

    if (action === "status") {
      return safeReply(i, {
        content:
          `⏱️ Auto-timeout is **${g.autotimeout.enabled ? "ENABLED" : "DISABLED"}**.\nStrikes: **${g.autotimeout.strikes}**\nDuration: **${g.autotimeout.minutes} minutes**`
      });
    }

    g.autotimeout.enabled =
      action === "enable";

    saveDB();

    return safeReply(i, {
      content:
        `⏱️ Auto-timeout **${g.autotimeout.enabled ? "enabled" : "disabled"}**.`
    });
  }

  if (command === "autotimeout-config") {
    g.autotimeout.strikes =
      i.options.getInteger("strikes");

    g.autotimeout.minutes =
      i.options.getInteger("minutes");

    saveDB();

    return safeReply(i, {
      content:
        `⏱️ Auto-timeout configured.\nStrikes: **${g.autotimeout.strikes}**\nMinutes: **${g.autotimeout.minutes}**`
    });
  }

  /* ================= SECURITY ================= */

  if (
    [
      "security",
      "security-config",
      "raidmode",
      "raidmode-config",
      "antinuke",
      "antinuke-config"
    ].includes(command)
  ) {
    if (!commandPermission(i)) {
      return safeReply(i, {
        content:
          "❌ Administrator/Manage Server permission required.",
        ephemeral: true
      });
    }
  }

  if (command === "security") {
    const action =
      i.options.getString("action");

    if (action === "status") {
      return safeReply(i, {
        content:
          `🚨 Security: **${g.security.enabled ? "ON" : "OFF"}**\n🛡️ Anti-Raid: **${g.security.antiRaid ? "ON" : "OFF"}**\n☢️ Anti-Nuke: **${g.security.antiNuke ? "ON" : "OFF"}**\n🪝 Anti-Webhook: **${g.security.antiWebhook ? "ON" : "OFF"}**\n🤖 Anti-Bot: **${g.security.antiBotAdd ? "ON" : "OFF"}**\n🔒 Lockdown: **${g.security.lockdown ? "ON" : "OFF"}**\n🚨 Raid Mode: **${g.security.raidMode ? "ON" : "OFF"}**`
      });
    }

    if (action === "enable") {
      g.security.enabled = true;
    }

    if (action === "disable") {
      g.security.enabled = false;
    }

    if (action === "lockdown") {
      g.security.lockdown = true;
    }

    if (action === "unlockdown") {
      g.security.lockdown = false;
    }

    saveDB();

    return safeReply(i, {
      content:
        `🚨 Security action **${action}** completed.`
    });
  }

  if (command === "security-config") {
    g.security.antiRaid =
      i.options.getBoolean("anti_raid");

    g.security.antiNuke =
      i.options.getBoolean("anti_nuke");

    g.security.antiWebhook =
      i.options.getBoolean("anti_webhook");

    g.security.antiBotAdd =
      i.options.getBoolean("anti_bot");

    saveDB();

    return safeReply(i, {
      content:
        "🛡️ Security configuration updated."
    });
  }

  if (command === "raidmode") {
    const action =
      i.options.getString("action");

    if (action === "status") {
      return safeReply(i, {
        content:
          `🚨 Raid mode: **${g.security.raidMode ? "ON" : "OFF"}**`
      });
    }

    g.security.raidMode =
      action === "on";

    saveDB();

    return safeReply(i, {
      content:
        `🚨 Raid mode **${g.security.raidMode ? "enabled" : "disabled"}**.`
    });
  }

  if (command === "raidmode-config") {
    const joinsLimit =
      i.options.getInteger("joins");

    const seconds =
      i.options.getInteger("seconds");

    g.security.joinLimit =
      joinsLimit;

    g.security.joinWindow =
      seconds * 1000;

    saveDB();

    return safeReply(i, {
      content:
        `🚨 Raid detection configured.\nMaximum joins: **${joinsLimit}**\nWindow: **${seconds}s**`
    });
  }

  if (command === "antinuke") {
    const action =
      i.options.getString("action");

    if (action === "status") {
      return safeReply(i, {
        content:
          `☢️ Anti-nuke is **${g.security.antiNuke ? "ENABLED" : "DISABLED"}**.`
      });
    }

    g.security.antiNuke =
      action === "enable";

    saveDB();

    return safeReply(i, {
      content:
        `☢️ Anti-nuke **${g.security.antiNuke ? "enabled" : "disabled"}**.`
    });
  }

  if (command === "antinuke-config") {
    g.security.antiNuke =
      i.options.getBoolean("enabled");

    saveDB();

    return safeReply(i, {
      content:
        `☢️ Anti-nuke **${g.security.antiNuke ? "enabled" : "disabled"}**.`
    });
  }

  /* ================= TRUSTED ================= */

  if (
    [
      "trusted",
      "trusted-add",
      "trusted-remove",
      "trusted-list"
    ].includes(command)
  ) {
    if (!commandPermission(i)) {
      return safeReply(i, {
        content:
          "❌ Administrator/Manage Server permission required.",
        ephemeral: true
      });
    }
  }

  if (
    command === "trusted" ||
    command === "trusted-list"
  ) {
    return safeReply(i, {
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle("🛡️ Trusted Users / Bots")
          .addFields(
            {
              name: "Trusted Users",
              value:
                g.trusted.users.length
                  ? g.trusted.users.map(x => `<@${x}>`).join("\n")
                  : "None"
            },
            {
              name: "Trusted Bots",
              value:
                g.trusted.bots.length
                  ? g.trusted.bots.map(x => `<@${x}>`).join("\n")
                  : "None"
            }
          )
      ]
    });
  }

  if (command === "trusted-add") {
    const user =
      userTarget(i);

    const isBot =
      i.options.getBoolean("bot") || user.bot;

    if (isBot) {
      if (!g.trusted.bots.includes(user.id)) {
        g.trusted.bots.push(user.id);
      }
    } else {
      if (!g.trusted.users.includes(user.id)) {
        g.trusted.users.push(user.id);
      }
    }

    saveDB();

    return safeReply(i, {
      content:
        `🛡️ ${user} added to trusted ${isBot ? "bots" : "users"}.`
    });
  }

  if (command === "trusted-remove") {
    const user =
      userTarget(i);

    g.trusted.users =
      g.trusted.users.filter(
        x => x !== user.id
      );

    g.trusted.bots =
      g.trusted.bots.filter(
        x => x !== user.id
      );

    saveDB();

    return safeReply(i, {
      content:
        `✅ ${user} removed from the trusted list.`
    });
  }

  /* ================= ROLE PROTECTION ================= */

  if (
    [
      "roleprotect",
      "roleprotect-add",
      "roleprotect-remove",
      "roleprotect-list",
      "roleprotect-config"
    ].includes(command)
  ) {
    if (!commandPermission(i)) {
      return safeReply(i, {
        content:
          "❌ Administrator/Manage Server permission required.",
        ephemeral: true
      });
    }
  }

  if (command === "roleprotect") {
    const action =
      i.options.getString("action");

    if (action === "status") {
      return safeReply(i, {
        content:
          `🛡️ Role protection: **${g.roleProtect.enabled ? "ON" : "OFF"}**`
      });
    }

    g.roleProtect.enabled =
      action === "enable";

    saveDB();

    return safeReply(i, {
      content:
        `🛡️ Role protection **${g.roleProtect.enabled ? "enabled" : "disabled"}**.`
    });
  }

  if (command === "roleprotect-add") {
    const role =
      i.options.getRole("role");

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

    return safeReply(i, {
      content:
        `🛡️ Protected role added: ${role}`
    });
  }

  if (command === "roleprotect-remove") {
    const role =
      i.options.getRole("role");

    g.roleProtect.protectedRoles =
      g.roleProtect.protectedRoles.filter(
        x => x !== role.id
      );

    saveDB();

    return safeReply(i, {
      content:
        `✅ Role protection removed for ${role}.`
    });
  }

  if (command === "roleprotect-list") {
    const roles =
      g.roleProtect.protectedRoles
        .map(id => i.guild.roles.cache.get(id))
        .filter(Boolean);

    return safeReply(i, {
      content:
        roles.length
          ? `🛡️ Protected roles:\n${roles.map(r => `• ${r}`).join("\n")}`
          : "🛡️ No protected roles."
    });
  }

  if (command === "roleprotect-config") {
    g.roleProtect.timeoutMinutes =
      i.options.getInteger("minutes");

    saveDB();

    return safeReply(i, {
      content:
        `🛡️ Unauthorized role-change timeout set to **${g.roleProtect.timeoutMinutes} minutes**.`
    });
  }

  /* ================= LOGGING ================= */

  if (
    [
      "logs",
      "logs-config",
      "audit",
      "audit-config",
      "modlogs",
      "security-logs"
    ].includes(command)
  ) {
    if (!commandPermission(i)) {
      return safeReply(i, {
        content:
          "❌ Administrator/Manage Server permission required.",
        ephemeral: true
      });
    }
  }

  if (command === "logs") {
    const type =
      i.options.getString("type");

    const channel =
      i.options.getChannel("channel");

    g.logs[type] =
      channel.id;

    if (type === "tickets") {
      g.tickets.logChannel =
        channel.id;
    }

    saveDB();

    return safeReply(i, {
      content:
        `📋 **${type}** logs set to ${channel}.`
    });
  }

  if (
    command === "logs-config" ||
    command === "modlogs" ||
    command === "security-logs"
  ) {
    return safeReply(i, {
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("📋 Logging Configuration")
          .setDescription(
            Object.entries(g.logs)
              .map(
                ([key, id]) =>
                  `**${key}:** ${id ? `<#${id}>` : "Not configured"}`
              )
              .join("\n")
          )
      ]
    });
  }

  if (command === "audit-config") {
    const channel =
      i.options.getChannel("channel");

    g.logs.audit =
      channel.id;

    saveDB();

    return safeReply(i, {
      content:
        `📋 Audit log channel set to ${channel}.`
    });
  }

  if (command === "audit") {
    try {
      const logs =
        await i.guild.fetchAuditLogs({
          limit: 10
        });

      const text =
        [...logs.entries.values()]
          .slice(0, 10)
          .map(
            x =>
              `**${x.action}** — <@${x.executor?.id || "0"}>\n<t:${Math.floor(x.createdTimestamp / 1000)}:R>`
          )
          .join("\n\n");

      return safeReply(i, {
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("📋 Recent Audit Activity")
            .setDescription(
              text || "No audit activity found."
            )
        ]
      });
    } catch {
      return safeReply(i, {
        content:
          "❌ I cannot read the Discord audit log. Make sure I have View Audit Log permission.",
        ephemeral: true
      });
    }
  }

  /* ================= TICKETS ================= */

  if (
    [
      "ticket-panel",
      "ticket-config"
    ].includes(command)
  ) {
    if (!commandPermission(i)) {
      return safeReply(i, {
        content:
          "❌ Administrator/Manage Server permission required.",
        ephemeral: true
      });
    }
  }

  if (command === "ticket") {
    const channel =
      await createTicket(
        i.guild,
        i.user,
        "command"
      );

    if (!channel) {
      return safeReply(i, {
        content:
          "❌ Ticket system is disabled or not configured. An administrator must set a support role.",
        ephemeral: true
      });
    }

    return safeReply(i, {
      content:
        `🎫 Your ticket has been created: ${channel}`,
      ephemeral: true
    });
  }

  if (command === "ticket-panel") {
    const channel =
      i.options.getChannel("channel");

    g.tickets.panelChannel =
      channel.id;

    const embed =
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("🎫 Support Center")
        .setDescription(
          "Need help? Click the button below to create a private support ticket."
        )
        .setTimestamp();

    const row =
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("ticket_open")
          .setLabel("Open Ticket")
          .setEmoji("🎫")
          .setStyle(ButtonStyle.Primary)
      );

    const sent =
      await channel.send({
        embeds: [embed],
        components: [row]
      });

    g.tickets.panelMessage =
      sent.id;

    saveDB();

    return safeReply(i, {
      content:
        `🎫 Ticket panel created in ${channel}.`
    });
  }

  if (
    command === "ticket-close"
  ) {
    return closeTicket(i);
  }

  if (
    command === "ticket-delete"
  ) {
    return deleteTicket(i);
  }

  if (
    [
      "ticket-add",
      "ticket-remove",
      "ticket-claim",
      "ticket-unclaim",
      "ticket-transcript",
      "ticket-lock",
      "ticket-unlock",
      "ticket-rename"
    ].includes(command)
  ) {
    if (!isTicketChannel(i.guild, i.channelId)) {
      return safeReply(i, {
        content:
          "❌ This command can only be used inside a ticket.",
        ephemeral: true
      });
    }
  }

  if (command === "ticket-add") {
    if (!staffOnly(i)) {
      return safeReply(i, {
        content: "❌ Staff only.",
        ephemeral: true
      });
    }

    const user =
      userTarget(i);

    await i.channel.permissionOverwrites.edit(
      user.id,
      {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      }
    );

    return safeReply(i, {
      content:
        `➕ Added ${user} to the ticket.`
    });
  }

  if (command === "ticket-remove") {
    if (!staffOnly(i)) {
      return safeReply(i, {
        content: "❌ Staff only.",
        ephemeral: true
      });
    }

    const user =
      userTarget(i);

    const ticket =
      getTicket(
        i.guild,
        i.channelId
      );

    if (
      user.id === ticket.userId
    ) {
      return safeReply(i, {
        content:
          "❌ The ticket owner cannot be removed.",
        ephemeral: true
      });
    }

    await i.channel.permissionOverwrites.delete(
      user.id
    ).catch(() => {});

    return safeReply(i, {
      content:
        `➖ Removed ${user} from the ticket.`
    });
  }

  if (command === "ticket-claim") {
    if (!staffOnly(i)) {
      return safeReply(i, {
        content: "❌ Staff only.",
        ephemeral: true
      });
    }

    const ticket =
      getTicket(
        i.guild,
        i.channelId
      );

    ticket.claimedBy =
      i.user.id;

    saveDB();

    return safeReply(i, {
      content:
        `🙋 Ticket claimed by ${i.user}.`
    });
  }

  if (command === "ticket-unclaim") {
    if (!staffOnly(i)) {
      return safeReply(i, {
        content: "❌ Staff only.",
        ephemeral: true
      });
    }

    const ticket =
      getTicket(
        i.guild,
        i.channelId
      );

    ticket.claimedBy = null;

    saveDB();

    return safeReply(i, {
      content:
        "↩️ Ticket unclaimed."
    });
  }

  if (command === "ticket-transcript") {
    if (!staffOnly(i)) {
      return safeReply(i, {
        content: "❌ Staff only.",
        ephemeral: true
      });
    }

    const transcript =
      await makeTranscript(
        i.channel
      );

    const attachment =
      new AttachmentBuilder(
        Buffer.from(
          transcript,
          "utf8"
        ),
        {
          name:
            `${i.channel.name}-transcript.txt`
        }
      );

    return safeReply(i, {
      content:
        "📄 Ticket transcript:",
      files: [attachment],
      ephemeral: true
    });
  }

  if (command === "ticket-lock") {
    if (!staffOnly(i)) {
      return safeReply(i, {
        content: "❌ Staff only.",
        ephemeral: true
      });
    }

    const ticket =
      getTicket(
        i.guild,
        i.channelId
      );

    await i.channel.permissionOverwrites.edit(
      ticket.userId,
      {
        SendMessages: false
      }
    );

    ticket.locked = true;

    saveDB();

    return safeReply(i, {
      content:
        "🔒 Ticket locked."
    });
  }

  if (command === "ticket-unlock") {
    if (!staffOnly(i)) {
      return safeReply(i, {
        content: "❌ Staff only.",
        ephemeral: true
      });
    }

    const ticket =
      getTicket(
        i.guild,
        i.channelId
      );

    await i.channel.permissionOverwrites.edit(
      ticket.userId,
      {
        SendMessages: true
      }
    );

    ticket.locked = false;

    saveDB();

    return safeReply(i, {
      content:
        "🔓 Ticket unlocked."
    });
  }

  if (command === "ticket-rename") {
    if (!staffOnly(i)) {
      return safeReply(i, {
        content: "❌ Staff only.",
        ephemeral: true
      });
    }

    let name =
      i.options
        .getString("name")
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-")
        .slice(0, 90);

    if (!name) {
      name = "ticket";
    }

    await i.channel.setName(
      name
    );

    return safeReply(i, {
      content:
        `✏️ Ticket renamed to **${name}**.`
    });
  }

  if (command === "ticket-config") {
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

    return safeReply(i, {
      content:
        `🎫 Ticket configuration updated.\n\n**Support Role:** ${g.tickets.supportRole ? `<@&${g.tickets.supportRole}>` : "Not set"}\n**Category:** ${g.tickets.category ? `<#${g.tickets.category}>` : "Not set"}\n**Log Channel:** ${g.tickets.logChannel ? `<#${g.tickets.logChannel}>` : "Not set"}\n**Transcripts:** ${g.tickets.transcript ? "Enabled" : "Disabled"}`
    });
  }

  /* ================= SUGGESTIONS ================= */

  if (
    [
      "suggest",
      "suggest-config",
      "suggestions"
    ].includes(command)
  ) {
    if (
      command !== "suggest" &&
      !commandPermission(i)
    ) {
      return safeReply(i, {
        content:
          "❌ Administrator/Manage Server permission required.",
        ephemeral: true
      });
    }
  }

  if (command === "suggest") {
    if (!g.suggestions.enabled) {
      return safeReply(i, {
        content:
          "❌ Suggestions are disabled.",
        ephemeral: true
      });
    }

    if (!g.suggestions.channel) {
      return safeReply(i, {
        content:
          "❌ Suggestion channel is not configured.",
        ephemeral: true
      });
    }

    const channel =
      i.guild.channels.cache.get(
        g.suggestions.channel
      );

    if (!channel) {
      return safeReply(i, {
        content:
          "❌ Suggestion channel no longer exists.",
        ephemeral: true
      });
    }

    const suggestion =
      i.options.getString(
        "suggestion"
      );

    const id =
      `${Date.now()}-${i.user.id}`;

    const embed =
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("💡 New Suggestion")
        .setDescription(
          suggestion
        )
        .addFields(
          {
            name: "Submitted by",
            value: `${i.user}`,
            inline: true
          },
          {
            name: "Status",
            value: "🟡 Pending",
            inline: true
          }
        )
        .setFooter({
          text: `Suggestion ID: ${id}`
        })
        .setTimestamp();

    const row =
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`suggest_approve_${id}`)
          .setLabel("Approve")
          .setEmoji("✅")
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId(`suggest_decline_${id}`)
          .setLabel("Decline")
          .setEmoji("❌")
          .setStyle(ButtonStyle.Danger)
      );

    const sent =
      await channel.send({
        embeds: [embed],
        components: [row]
      });

    g.suggestionsData[id] = {
      id,
      messageId: sent.id,
      channelId: channel.id,
      userId: i.user.id,
      suggestion,
      status: "pending",
      createdAt: Date.now()
    };

    saveDB();

    return safeReply(i, {
      content:
        `💡 Your suggestion has been submitted to ${channel}.`,
      ephemeral: true
    });
  }

  if (command === "suggest-config") {
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

    saveDB();

    return safeReply(i, {
      content:
        `💡 Suggestions configured.\nChannel: ${channel}\nStaff role: ${g.suggestions.staffRole ? `<@&${g.suggestions.staffRole}>` : "Not set"}`
    });
  }

  if (command === "suggestions") {
    return safeReply(i, {
      content:
        `💡 Suggestion system: **${g.suggestions.enabled ? "Enabled" : "Disabled"}**\nChannel: ${g.suggestions.channel ? `<#${g.suggestions.channel}>` : "Not configured"}\nStaff Role: ${g.suggestions.staffRole ? `<@&${g.suggestions.staffRole}>` : "Not configured"}`
    });
  }

  /* ================= ANNOUNCEMENTS ================= */

  if (
    [
      "announce",
      "announcement-panel",
      "announcement-config",
      "announcement-channel",
      "announcement-tags"
    ].includes(command)
  ) {
    if (!commandPermission(i)) {
      return safeReply(i, {
        content:
          "❌ Administrator/Manage Server permission required.",
        ephemeral: true
      });
    }
  }

  if (command === "announce") {
    const title =
      i.options.getString("title");

    const message =
      i.options.getString("message");

    const destination =
      i.options.getChannel(
        "channel"
      ) ||
      i.guild.channels.cache.get(
        g.announcements.channel
      ) ||
      i.channel;

    const role =
      i.options.getRole("role") ||
      (
        g.announcements.role
          ? i.guild.roles.cache.get(
              g.announcements.role
            )
          : null
      );

    const image =
      i.options.getString("image") ||
      g.announcements.image;

    const embed =
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`📢 ${title}`)
        .setDescription(message)
        .setFooter({
          text:
            g.announcements.footer ||
            "Official Announcement"
        })
        .setTimestamp();

    if (image) {
      embed.setImage(image);
    }

    await destination.send({
      content: role ? `${role}` : undefined,
      embeds: [embed]
    });

    await sendLog(
      i.guild,
      "general",
      "📢 Announcement Sent",
      `**Title:** ${title}\n**Channel:** ${destination}\n**By:** ${i.user}`
    );

    return safeReply(i, {
      content:
        `📢 Announcement sent to ${destination}.`
    });
  }

  if (command === "announcement-panel") {
    const channel =
      i.options.getChannel(
        "channel"
      );

    const embed =
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("📢 Announcement Management")
        .setDescription(
          "Use `/announce` to create an announcement.\n\nUse the configuration commands to set default destinations and mentions."
        );

    await channel.send({
      embeds: [embed]
    });

    return safeReply(i, {
      content:
        `📢 Announcement panel created in ${channel}.`
    });
  }

  if (command === "announcement-config") {
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

    if (image !== null) {
      g.announcements.image =
        image;
    }

    saveDB();

    return safeReply(i, {
      content:
        "📢 Announcement configuration updated."
    });
  }

  if (command === "announcement-channel") {
    const channel =
      i.options.getChannel(
        "channel"
      );

    g.announcements.channel =
      channel.id;

    saveDB();

    return safeReply(i, {
      content:
        `📢 Default announcement channel set to ${channel}.`
    });
  }

  if (command === "announcement-tags") {
    const role =
      i.options.getRole(
        "role"
      );

    g.announcements.role =
      role.id;

    saveDB();

    return safeReply(i, {
      content:
        `📢 Default announcement role set to ${role}.`
    });
  }

  /* ================= CONFIG ================= */

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
    if (!commandPermission(i)) {
      return safeReply(i, {
        content:
          "❌ Administrator/Manage Server permission required.",
        ephemeral: true
      });
    }
  }

  if (
    command === "config" ||
    command === "config-view"
  ) {
    return safeReply(i, {
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`⚙️ ${i.guild.name} Configuration`)
          .setDescription(
            formatConfig(g)
          )
          .setTimestamp()
      ]
    });
  }

  if (command === "config-reset") {
    resetGuild(i.guild.id);

    await sendLog(
      i.guild,
      "general",
      "⚙️ Configuration Reset",
      `Server configuration was reset by ${i.user}.`
    );

    return safeReply(i, {
      content:
        "⚙️ Server configuration has been reset to defaults."
    });
  }

  if (command === "config-ticket") {
    return safeReply(i, {
      content:
        `🎫 **Ticket Configuration**\n\nEnabled: **${g.tickets.enabled}**\nCategory: ${g.tickets.category ? `<#${g.tickets.category}>` : "Not set"}\nSupport Role: ${g.tickets.supportRole ? `<@&${g.tickets.supportRole}>` : "Not set"}\nLog Channel: ${g.tickets.logChannel ? `<#${g.tickets.logChannel}>` : "Not set"}\nTranscripts: **${g.tickets.transcript ? "Enabled" : "Disabled"}**\nDM Tickets: **${g.tickets.dmEnabled ? "Enabled" : "Disabled"}**`
    });
  }

  if (command === "config-automod") {
    return safeReply(i, {
      content:
        `🛡️ **AutoMod Configuration**\n\nEnabled: **${g.automod.enabled}**\nInvites: **${g.automod.invites}**\nSpam: **${g.automod.spam}**\nCaps: **${g.automod.caps}**\nBad Words: **${g.automod.badwords}**\nRepeated: **${g.automod.repeated}**\nMentions: **${g.automod.mentions}**\nLinks: **${g.automod.links}**\nMax Mentions: **${g.automod.maxMentions}**\nCaps Limit: **${g.automod.maxCapsPercent}%**`
    });
  }

  if (command === "config-security") {
    return safeReply(i, {
      content:
        `🚨 **Security Configuration**\n\nEnabled: **${g.security.enabled}**\nAnti-Raid: **${g.security.antiRaid}**\nAnti-Nuke: **${g.security.antiNuke}**\nAnti-Webhook: **${g.security.antiWebhook}**\nAnti-Bot: **${g.security.antiBotAdd}**\nRaid Mode: **${g.security.raidMode}**\nLockdown: **${g.security.lockdown}**\nJoin Limit: **${g.security.joinLimit}**\nJoin Window: **${g.security.joinWindow / 1000}s**`
    });
  }

  if (command === "config-logs") {
    return safeReply(i, {
      content:
        Object.entries(g.logs)
          .map(
            ([key, id]) =>
              `**${key}:** ${id ? `<#${id}>` : "Not configured"}`
          )
          .join("\n")
    });
  }

  if (command === "config-suggestions") {
    return safeReply(i, {
      content:
        `💡 **Suggestion Configuration**\n\nEnabled: **${g.suggestions.enabled}**\nChannel: ${g.suggestions.channel ? `<#${g.suggestions.channel}>` : "Not configured"}\nStaff Role: ${g.suggestions.staffRole ? `<@&${g.suggestions.staffRole}>` : "Not configured"}`
    });
  }

  if (command === "config-announcements") {
    return safeReply(i, {
      content:
        `📢 **Announcement Configuration**\n\nDefault Channel: ${g.announcements.channel ? `<#${g.announcements.channel}>` : "Not configured"}\nDefault Role: ${g.announcements.role ? `<@&${g.announcements.role}>` : "Not configured"}\nDefault Image: ${g.announcements.image || "None"}\nFooter: ${g.announcements.footer}`
    });
  }

  return safeReply(i, {
    content:
      "❌ This command is registered but no handler was found."
  });
}

/* =========================================================
   BUTTON HANDLER
========================================================= */

async function handleButton(i) {
  if (!i.guild) {
    return safeReply(i, {
      content:
        "❌ This button can only be used in a server.",
      ephemeral: true
    });
  }

  const id = i.customId;

  /* Ticket open */

  if (id === "ticket_open") {
    const channel =
      await createTicket(
        i.guild,
        i.user,
        "panel"
      );

    return safeReply(i, {
      content:
        channel
          ? `🎫 Ticket created: ${channel}`
          : "❌ Ticket system is not configured.",
      ephemeral: true
    });
  }

  /* Ticket buttons */

  if (
    [
      "ticket_claim",
      "ticket_unclaim",
      "ticket_lock",
      "ticket_close",
      "ticket_delete"
    ].includes(id)
  ) {
    const ticket =
      getTicket(
        i.guild,
        i.channelId
      );

    if (!ticket) {
      return safeReply(i, {
        content:
          "❌ This is not a ticket.",
        ephemeral: true
      });
    }

    const g =
      getGuild(i.guild.id);

    if (
      id !== "ticket_close" &&
      !staffOnly(i)
    ) {
      return safeReply(i, {
        content:
          "❌ Staff only.",
        ephemeral: true
      });
    }

    if (id === "ticket_claim") {
      ticket.claimedBy =
        i.user.id;

      saveDB();

      return safeReply(i, {
        content:
          `🙋 Ticket claimed by ${i.user}.`
      });
    }

    if (id === "ticket_unclaim") {
      ticket.claimedBy = null;

      saveDB();

      return safeReply(i, {
        content:
          "↩️ Ticket unclaimed."
      });
    }

    if (id === "ticket_lock") {
      await i.channel.permissionOverwrites.edit(
        ticket.userId,
        {
          SendMessages: false
        }
      );

      ticket.locked = true;

      saveDB();

      return safeReply(i, {
        content:
          "🔒 Ticket locked."
      });
    }

    if (id === "ticket_close") {
      return closeTicket(i);
    }

    if (id === "ticket_delete") {
      return deleteTicket(i);
    }
  }

  /* Suggestion buttons */

  if (
    id.startsWith("suggest_approve_") ||
    id.startsWith("suggest_decline_")
  ) {
    const approve =
      id.startsWith(
        "suggest_approve_"
      );

    const suggestionId =
      id.replace(
        approve
          ? "suggest_approve_"
          : "suggest_decline_",
        ""
      );

    const g =
      getGuild(i.guild.id);

    const suggestion =
      g.suggestionsData[
        suggestionId
      ];

    if (!suggestion) {
      return safeReply(i, {
        content:
          "❌ Suggestion record not found.",
        ephemeral: true
      });
    }

    const staffAllowed =
      isManager(i.member) ||
      (
        g.suggestions.staffRole &&
        i.member.roles.cache.has(
          g.suggestions.staffRole
        )
      );

    if (!staffAllowed) {
      return safeReply(i, {
        content:
          "❌ Suggestion staff only.",
        ephemeral: true
      });
    }

    suggestion.status =
      approve
        ? "approved"
        : "declined";

    suggestion.reviewedBy =
      i.user.id;

    suggestion.reviewedAt =
      Date.now();

    saveDB();

    const oldEmbed =
      i.message.embeds[0];

    const embed =
      EmbedBuilder.from(
        oldEmbed
      )
        .setColor(
          approve
            ? 0x57f287
            : 0xed4245
        )
        .spliceFields(
          1,
          1,
          {
            name: "Status",
            value:
              approve
                ? "✅ Approved"
                : "❌ Declined",
            inline: true
          }
        )
        .setFooter({
          text:
            `Reviewed by ${i.user.tag}`
        });

    await i.message.edit({
      embeds: [embed],
      components: []
    });

    return safeReply(i, {
      content:
        approve
          ? "✅ Suggestion approved."
          : "❌ Suggestion declined."
    });
  }

  return safeReply(i, {
    content:
      "❌ Unknown button.",
    ephemeral: true
  });
}

/* =========================================================
   INTERACTION EVENT
========================================================= */

client.on(
  "interactionCreate",
  async interaction => {
    try {
      if (interaction.isButton()) {
        return handleButton(
          interaction
        );
      }

      if (
        interaction.isChatInputCommand()
      ) {
        return handleCommand(
          interaction
        );
      }
    } catch (err) {
      console.error(
        "Interaction error:",
        err
      );

      await safeReply(
        interaction,
        {
          content:
            "❌ An unexpected error occurred while processing this command.",
          ephemeral: true
        }
      );
    }
  }
);

/* =========================================================
   MESSAGE EVENT
========================================================= */

client.on(
  "messageCreate",
  async message => {
    try {
      if (message.author.bot) return;

      /* DM ticket system */

      if (
        message.channel.type ===
        ChannelType.DM
      ) {
        if (!client.guilds.cache.size) {
          return message.reply(
            "❌ Support servers are currently unavailable."
          );
        }

        /*
          A DM does not contain a guild ID.
          Therefore the bot selects the first guild
          where the user is actually a member and
          where DM tickets are enabled.
        */

        let targetGuild = null;

        for (
          const guild of client.guilds.cache.values()
        ) {
          const g =
            getGuild(guild.id);

          if (
            !g.tickets.enabled ||
            !g.tickets.dmEnabled ||
            !g.tickets.supportRole
          ) {
            continue;
          }

          const member =
            await guild.members
              .fetch(message.author.id)
              .catch(() => null);

          if (member) {
            targetGuild =
              guild;
            break;
          }
        }

        if (!targetGuild) {
          return message.reply(
            "❌ I could not find a configured support server for you."
          );
        }

        const channel =
          await createTicket(
            targetGuild,
            message.author,
            "DM"
          );

        if (!channel) {
          return message.reply(
            "❌ The ticket system is not configured."
          );
        }

        await channel.send(
          `📩 **DM from ${message.author.tag}:**\n${message.content}`
        ).catch(() => {});

        return message.reply(
          `🎫 Your support ticket has been created in **${targetGuild.name}**.`
        );
      }

      /* AutoMod */

      await processAutoMod(
        message
      );

      /* Lockdown */

      const g =
        getGuild(
          message.guild.id
        );

      if (
        g.security.lockdown &&
        !isTrusted(
          message.guild,
          message.author.id
        )
      ) {
        try {
          await message.delete();
        } catch {}
      }
    } catch (err) {
      console.error(
        "Message event error:",
        err
      );
    }
  }
);

/* =========================================================
   MEMBER JOIN
========================================================= */

client.on(
  "guildMemberAdd",
  async member => {
    try {
      await handleMemberJoin(
        member
      );

      const g =
        getGuild(
          member.guild.id
        );

      if (
        g.security.raidMode &&
        !isTrusted(
          member.guild,
          member.id
        )
      ) {
        await sendLog(
          member.guild,
          "security",
          "🚨 Raid Mode Join",
          `User **${member.user.tag}** joined while raid mode is active.`,
          0xed4245
        );
      }

      /* Anti-bot */

      if (
        member.user.bot &&
        g.security.enabled &&
        g.security.antiBotAdd &&
        !isTrustedBot(
          member.guild,
          member.user.id
        )
      ) {
        try {
          const audit =
            await member.guild.fetchAuditLogs({
              type: AuditLogEvent.BotAdd,
              limit: 5
            });

          const entry =
            audit.entries.find(
              x =>
                x.target?.id ===
                member.id
            );

          if (
            entry &&
            entry.executor &&
            !isTrusted(
              member.guild,
              entry.executor.id
            )
          ) {
            await member.kick(
              "Anti-bot protection"
            ).catch(() => {});

            await sendLog(
              member.guild,
              "security",
              "🤖 Unauthorized Bot Blocked",
              `**Bot:** ${member.user.tag}\n**Added by:** <@${entry.executor.id}>`,
              0xed4245
            );
          }
        } catch {}
      }
    } catch (err) {
      console.error(
        "guildMemberAdd error:",
        err
      );
    }
  }
);

/* =========================================================
   WEBHOOK UPDATE
========================================================= */

client.on(
  "webhookUpdate",
  async channel => {
    try {
      const guild =
        channel.guild;

      if (!guild) return;

      const g =
        getGuild(guild.id);

      if (
        !g.security.enabled ||
        !g.security.antiWebhook
      ) {
        return;
      }

      const audit =
        await guild.fetchAuditLogs({
          type:
            AuditLogEvent.WebhookCreate,
          limit: 5
        }).catch(() => null);

      const entry =
        audit?.entries.find(
          x =>
            Date.now() -
              x.createdTimestamp <
            10000
        );

      if (
        entry?.executor &&
        !isTrusted(
          guild,
          entry.executor.id
        )
      ) {
        await checkAudit(
          guild,
          "Webhook creation",
          entry.executor.id
        );
      }
    } catch {}
  }
);

/* =========================================================
   ROLE UPDATE / DELETE PROTECTION
========================================================= */

client.on(
  "roleDelete",
  async role => {
    try {
      const guild =
        role.guild;

      const g =
        getGuild(guild.id);

      if (
        !g.roleProtect.enabled ||
        !g.roleProtect.protectedRoles.includes(
          role.id
        )
      ) {
        return;
      }

      const audit =
        await guild.fetchAuditLogs({
          type:
            AuditLogEvent.RoleDelete,
          limit: 5
        }).catch(() => null);

      const entry =
        audit?.entries.find(
          x =>
            x.target?.id === role.id
        );

      if (
        entry?.executor &&
        !isTrusted(
          guild,
          entry.executor.id
        )
      ) {
        await checkAudit(
          guild,
          "Protected role deletion",
          entry.executor.id
        );
      }
    } catch {}
  }
);

client.on(
  "roleUpdate",
  async (oldRole, newRole) => {
    try {
      const guild =
        newRole.guild;

      const g =
        getGuild(guild.id);

      if (
        !g.roleProtect.enabled ||
        !g.roleProtect.protectedRoles.includes(
          newRole.id
        )
      ) {
        return;
      }

      if (
        oldRole.name === newRole.name &&
        oldRole.color === newRole.color &&
        oldRole.permissions.bitfield ===
          newRole.permissions.bitfield
      ) {
        return;
      }

      const audit =
        await guild.fetchAuditLogs({
          type:
            AuditLogEvent.RoleUpdate,
          limit: 5
        }).catch(() => null);

      const entry =
        audit?.entries.find(
          x =>
            x.target?.id ===
            newRole.id
        );

      if (
        entry?.executor &&
        !isTrusted(
          guild,
          entry.executor.id
        )
      ) {
        await checkAudit(
          guild,
          "Protected role modification",
          entry.executor.id
        );
      }
    } catch {}
  }
);

/* =========================================================
   CHANNEL DELETE / UPDATE ANTI-NUKE
========================================================= */

client.on(
  "channelDelete",
  async channel => {
    try {
      const guild =
        channel.guild;

      if (!guild) return;

      const g =
        getGuild(guild.id);

      if (
        !g.security.enabled ||
        !g.security.antiNuke
      ) {
        return;
      }

      const audit =
        await guild.fetchAuditLogs({
          type:
            AuditLogEvent.ChannelDelete,
          limit: 5
        }).catch(() => null);

      const entry =
        audit?.entries.find(
          x =>
            x.target?.id ===
            channel.id
        );

      if (
        entry?.executor &&
        !isTrusted(
          guild,
          entry.executor.id
        )
      ) {
        await checkAudit(
          guild,
          "Channel deletion",
          entry.executor.id
        );
      }
    } catch {}
  }
);

/* =========================================================
   GUILD BAN / MEMBER EVENTS FOR AUDIT
========================================================= */

client.on(
  "guildBanAdd",
  async ban => {
    try {
      const guild =
        ban.guild;

      const g =
        getGuild(guild.id);

      if (
        !g.security.enabled ||
        !g.security.antiNuke
      ) {
        return;
      }

      const audit =
        await guild.fetchAuditLogs({
          type:
            AuditLogEvent.MemberBanAdd,
          limit: 5
        }).catch(() => null);

      const entry =
        audit?.entries.find(
          x =>
            x.target?.id ===
            ban.user.id
        );

      if (
        entry?.executor &&
        !isTrusted(
          guild,
          entry.executor.id
        )
      ) {
        await checkAudit(
          guild,
          "Member ban",
          entry.executor.id
        );
      }
    } catch {}
  }
);

/* =========================================================
   AUDIT LOG POLLER
========================================================= */

setInterval(
  async () => {
    try {
      for (
        const guild of client.guilds.cache.values()
      ) {
        const g =
          getGuild(guild.id);

        if (!g.logs.audit) continue;

        const channel =
          guild.channels.cache.get(
            g.logs.audit
          );

        if (
          !channel ||
          !channel.isTextBased()
        ) {
          continue;
        }

        const logs =
          await guild.fetchAuditLogs({
            limit: 10
          }).catch(() => null);

        if (!logs) continue;

        const previous =
          auditCache.get(
            `audit:${guild.id}`
          ) || 0;

        const latest =
          [...logs.entries.values()]
            .sort(
              (a, b) =>
                b.createdTimestamp -
                a.createdTimestamp
            )[0];

        if (!latest) continue;

        if (
          latest.createdTimestamp <=
          previous
        ) {
          continue;
        }

        auditCache.set(
          `audit:${guild.id}`,
          latest.createdTimestamp
        );

        const executor =
          latest.executor;

        if (!executor) continue;

        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0x5865f2)
              .setTitle("📋 Audit Log")
              .setDescription(
                `**Action:** ${latest.action}\n**Executor:** ${executor}\n**Target:** ${latest.target ? String(latest.target) : "Unknown"}`
              )
              .setTimestamp(
                latest.createdTimestamp
              )
          ]
        }).catch(() => {});
      }
    } catch {}
  },
  15000
);

/* =========================================================
   READY / COMMAND REGISTRATION
========================================================= */

async function registerCommands() {
  const rest =
    new REST({
      version: "10"
    }).setToken(
      TOKEN
    );

  const body =
    commands.map(
      command =>
        command.toJSON()
    );

  console.log(
    `Registering ${body.length} slash commands globally...`
  );

  await rest.put(
    Routes.applicationCommands(
      CLIENT_ID
    ),
    {
      body
    }
  );

  console.log(
    `Successfully registered ${body.length} commands globally.`
  );
}

client.once(
  "ready",
  async () => {
    console.log(
      `Logged in as ${client.user.tag}`
    );

    console.log(
      `Connected to ${client.guilds.cache.size} server(s).`
    );

    console.log(
      `Loaded ${commands.length} slash commands.`
    );

    for (
      const guild of client.guilds.cache.values()
    ) {
      getGuild(guild.id);
    }

    saveDB();

    try {
      await registerCommands();
    } catch (err) {
      console.error(
        "Command registration error:",
        err
      );
    }
  }
);

/* =========================================================
   GUILD CREATE
========================================================= */

client.on(
  "guildCreate",
  guild => {
    getGuild(guild.id);
    saveDB();

    console.log(
      `Joined new server: ${guild.name} (${guild.id})`
    );

    sendLog(
      guild,
      "general",
      "🤖 Bot Added",
      `Bot joined **${guild.name}**.`
    ).catch(() => {});
  }
);

/* =========================================================
   ERROR HANDLING
========================================================= */

client.on(
  "error",
  error => {
    console.error(
      "Discord client error:",
      error
    );
  }
);

client.on(
  "warn",
  warning => {
    console.warn(
      "Discord warning:",
      warning
    );
  }
);

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
   OPTIONAL WEB SERVER FOR RENDER
========================================================= */

const PORT =
  Number(process.env.PORT) ||
  10000;

const server =
  http.createServer(
    (req, res) => {
      res.writeHead(
        200,
        {
          "Content-Type":
            "application/json"
        }
      );

      res.end(
        JSON.stringify({
          status: "online",
          bot:
            client.user
              ? client.user.tag
              : "starting",
          guilds:
            client.guilds.size,
          commands:
            commands.length,
          uptime:
            process.uptime()
        })
      );
    }
  );

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Web server listening on port ${PORT}`
    );
  }
);

/* =========================================================
   LOGIN
========================================================= */

client.login(
  TOKEN
);
