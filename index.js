const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} = require("discord.js");
const fs = require("fs");
const path = require("path");

/* =========================================================
   CONFIG
========================================================= */

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const GUILD_ID =
  process.env.GUILD_ID || "1493700265499689154";

const SUPPORT_ADMIN_ROLE_ID =
  process.env.SUPPORT_ADMIN_ROLE_ID || "1542498406981959801";

const SUPPORT_LOG_CHANNEL_ID =
  process.env.SUPPORT_LOG_CHANNEL_ID || "1542500573000106024";

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
    GatewayIntentBits.GuildModeration,
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
   DATABASE
========================================================= */

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "database.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
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
    lockdown: false
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
    tickets: SUPPORT_LOG_CHANNEL_ID
  },

  tickets: {
    enabled: true,
    category: null,
    supportRole: SUPPORT_ADMIN_ROLE_ID,
    logChannel: SUPPORT_LOG_CHANNEL_ID,
    transcript: true,
    dmEnabled: true,
    panelChannel: null,
    panelMessage: null
  },

  suggestions: {
    enabled: true,
    channel: null,
    staffRole: SUPPORT_ADMIN_ROLE_ID
  },

  announcements: {
    channel: null,
    role: null,
    image: null,
    footer: "Official Announcement"
  },

  punishments: {},
  warnings: {},
  ticketsData: {},
  suggestionsData: {},

  createdAt: Date.now()
};

let db = {};

if (fs.existsSync(DB_FILE)) {
  try {
    db = JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
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

function getGuild(guildId) {
  if (!db[guildId]) {
    db[guildId] = JSON.parse(JSON.stringify(DEFAULT_GUILD));
    saveDB();
  }

  const g = db[guildId];

  if (!g.warnings) g.warnings = {};
  if (!g.punishments) g.punishments = {};
  if (!g.ticketsData) g.ticketsData = {};
  if (!g.suggestionsData) g.suggestionsData = {};

  return g;
}

/* =========================================================
   HELPERS
========================================================= */

function isAdmin(member) {
  if (!member) return false;

  return (
    member.permissions?.has(PermissionsBitField.Flags.Administrator) ||
    member.roles?.cache?.has(SUPPORT_ADMIN_ROLE_ID)
  );
}

function isTrusted(guild, userId) {
  const g = getGuild(guild.id);

  return (
    userId === guild.ownerId ||
    g.trusted.users.includes(userId)
  );
}

function isTrustedBot(guild, userId) {
  const g = getGuild(guild.id);

  return (
    isTrusted(guild, userId) ||
    g.trusted.bots.includes(userId)
  );
}

function getLogChannel(guild, type = "general") {
  const g = getGuild(guild.id);

  const id =
    g.logs[type] ||
    g.logs.general ||
    SUPPORT_LOG_CHANNEL_ID;

  return guild.channels.cache.get(id);
}

async function sendLog(guild, type, title, description, color = 0x5865f2) {
  try {
    const channel = getLogChannel(guild, type);

    if (!channel || !channel.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(description || "No details.")
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch {}
}

function hasPermission(member, permission) {
  return member?.permissions?.has(permission);
}

function durationMs(minutes) {
  return minutes * 60 * 1000;
}

function addWarning(guildId, userId, reason, moderatorId) {
  const g = getGuild(guildId);

  if (!g.warnings[userId]) g.warnings[userId] = [];

  g.warnings[userId].push({
    reason,
    moderatorId,
    timestamp: Date.now()
  });

  if (!g.punishments[userId]) g.punishments[userId] = [];

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

async function timeoutMember(member, minutes, reason) {
  if (!member?.moderatable) return false;

  try {
    await member.timeout(
      durationMs(minutes),
      reason
    );
    return true;
  } catch {
    return false;
  }
}

function cleanReason(reason) {
  return String(reason || "No reason provided.").slice(0, 500);
}

/* =========================================================
   COMMANDS
========================================================= */

const commands = [];

/* ---------- GENERAL ---------- */

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

/* ---------- MODERATION ---------- */

commands.push(
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member.")
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true)),

  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("Show a member's warnings.")
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true)),

  new SlashCommandBuilder()
    .setName("warnings-clear")
    .setDescription("Clear a member's warnings.")
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true)),

  new SlashCommandBuilder()
    .setName("punishments")
    .setDescription("Show punishment history.")
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true)),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member.")
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member.")
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),

  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unban a user.")
    .addStringOption(o => o.setName("userid").setDescription("User ID").setRequired(true))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a member.")
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
    .addIntegerOption(o => o.setName("minutes").setDescription("Minutes").setRequired(true).setMinValue(1).setMaxValue(40320))
    .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),

  new SlashCommandBuilder()
    .setName("untimeout")
    .setDescription("Remove a timeout.")
    .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true)),

  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Delete messages.")
    .addIntegerOption(o => o.setName("amount").setDescription("1-100").setRequired(true).setMinValue(1).setMaxValue(100)),

  new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription("Set channel slowmode.")
    .addIntegerOption(o => o.setName("seconds").setDescription("0-21600").setRequired(true).setMinValue(0).setMaxValue(21600)),

  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Lock the current channel."),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Unlock the current channel.")
);

/* ---------- AUTOMOD ---------- */

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
      o.setName("enabled").setDescription("Enabled?").setRequired(true)
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
    .addStringOption(o => o.setName("word").setDescription("Word").setRequired(true)),

  new SlashCommandBuilder()
    .setName("automod-word-remove")
    .setDescription("Remove a blocked word.")
    .addStringOption(o => o.setName("word").setDescription("Word").setRequired(true)),

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
    .setDescription("Configure AutoMod automatic timeout.")
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

/* ---------- SECURITY ---------- */

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
    .addBooleanOption(o => o.setName("anti_raid").setDescription("Anti-raid").setRequired(true))
    .addBooleanOption(o => o.setName("anti_nuke").setDescription("Anti-nuke").setRequired(true))
    .addBooleanOption(o => o.setName("anti_webhook").setDescription("Anti-webhook").setRequired(true))
    .addBooleanOption(o => o.setName("anti_bot").setDescription("Protect bot additions").setRequired(true)),

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
    .addBooleanOption(o => o.setName("enabled").setDescription("Enabled").setRequired(true))
);

/* ---------- TRUSTED ---------- */

commands.push(
  new SlashCommandBuilder()
    .setName("trusted")
    .setDescription("Show trusted users and bots."),

  new SlashCommandBuilder()
    .setName("trusted-add")
    .setDescription("Trust a user.")
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
    .addBooleanOption(o => o.setName("bot").setDescription("Is this a bot?").setRequired(false)),

  new SlashCommandBuilder()
    .setName("trusted-remove")
    .setDescription("Remove a trusted user/bot.")
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),

  new SlashCommandBuilder()
    .setName("trusted-list")
    .setDescription("List trusted users and bots.")
);

/* ---------- ROLE PROTECTION ---------- */

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
    .addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true)),

  new SlashCommandBuilder()
    .setName("roleprotect-remove")
    .setDescription("Remove a protected role.")
    .addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true)),

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

/* ---------- LOGGING ---------- */

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

/* ---------- TICKETS ---------- */

commands.push(
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Open a support ticket from Discord."),

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
    .setName("ticket-add")
    .setDescription("Add a member to the ticket.")
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),

  new SlashCommandBuilder()
    .setName("ticket-remove")
    .setDescription("Remove a member from the ticket.")
    .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),

  new SlashCommandBuilder()
    .setName("ticket-claim")
    .setDescription("Claim the current ticket."),

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
    .addStringOption(o => o.setName("name").setDescription("New name").setRequired(true)),

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

/* ---------- SUGGESTIONS ---------- */

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

/* ---------- ANNOUNCEMENTS ---------- */

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

/* ---------- CONFIG ---------- */

commands.push(
  new SlashCommandBuilder()
    .setName("config")
    .setDescription("View or modify main configuration."),

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
   REGISTER COMMANDS
========================================================= */

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  const body = commands.map(command => command.toJSON());

  console.log(`Registering ${body.length} slash commands...`);

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body }
  );

  console.log(`Successfully registered ${body.length} commands.`);
}

/* =========================================================
   MESSAGE TRACKING
========================================================= */

const messageTracker = new Map();

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
    now - arr[0].timestamp > 20000
  ) {
    arr.shift();
  }

  return arr;
}

function percentCaps(text) {
  const letters = text.match(/[A-Za-z]/g);

  if (!letters || !letters.length) return 0;

  const caps = text.match(/[A-Z]/g) || [];

  return Math.round(
    (caps.length / letters.length) * 100
  );
}

function containsInvite(content) {
  return /(?:discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\//i.test(
    content
  );
}

/* =========================================================
   AUTOMOD
========================================================= */

async function processAutoMod(message) {
  if (!message.guild || message.author.bot) return;

  const g = getGuild(message.guild.id);

  if (!g.automod.enabled) return;

  if (isTrusted(message.guild, message.author.id)) return;

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
    g.automod.badWords.some(w =>
      lower.includes(String(w).toLowerCase())
    )
  ) {
    violation = "Blocked word";
  }

  if (
    !violation &&
    g.automod.caps &&
    content.length >= 10 &&
    percentCaps(content) >= g.automod.maxCapsPercent
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
    const recent = history.filter(
      x =>
        Date.now() - x.timestamp <=
        g.automod.repeatedWindow
    );

    const repeated = recent.filter(
      x => x.content === content
    ).length;

    if (
      repeated >=
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
      await timeoutMember(
        member,
        g.autotimeout.minutes,
        `AutoMod escalation: ${violation}`
      );

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

/* =========================================================
   RAID DETECTION
========================================================= */

const joins = new Map();

async function processJoin(member) {
  const guild = member.guild;
  const g = getGuild(guild.id);

  if (
    !g.security.enabled ||
    !g.security.antiRaid
  ) return;

  const now = Date.now();

  if (!joins.has(guild.id)) {
    joins.set(guild.id, []);
  }

  const arr = joins.get(guild.id);

  arr.push(now);

  while (
    arr.length &&
    now - arr[0] > g.security.joinWindow
  ) {
    arr.shift();
  }

  if (
    arr.length >=
    g.security.joinLimit
  ) {
    g.security.lockdown = true;
    saveDB();

    await sendLog(
      guild,
      "security",
      "🚨 Possible Raid Detected",
      `**${arr.length} joins** detected in the configured raid window.\nSecurity lockdown has been enabled.`,
      0xed4245
    );

    for (const m of guild.members.cache.values()) {
      if (
        m.user.bot ||
        isTrusted(guild, m.id) ||
        m.id === guild.ownerId
      ) continue;

      if (m.joinedTimestamp &&
          Date.now() - m.joinedTimestamp < 30000) {
        await timeoutMember(
          m,
          10,
          "Anti-raid temporary lockdown"
        );
      }
    }
  }
}

/* =========================================================
   ROLE PROTECTOR
========================================================= */

client.on("roleUpdate", async (oldRole, newRole) => {
  const guild = newRole.guild;
  const g = getGuild(guild.id);

  if (!g.roleProtect.enabled) return;

  if (
    !g.roleProtect.protectedRoles.includes(
      newRole.id
    )
  ) return;

  const audit =
    await guild.fetchAuditLogs({
      type: 31,
      limit: 5
    }).catch(() => null);

  const entry =
    audit?.entries?.find(
      e =>
        e.target?.id === newRole.id &&
        Date.now() - e.createdTimestamp < 10000
    );

  if (!entry) return;

  const executor = entry.executor;

  if (
    !executor ||
    isTrusted(guild, executor.id)
  ) return;

  try {
    await newRole.edit({
      name: oldRole.name,
      color: oldRole.color,
      hoist: oldRole.hoist,
      mentionable: oldRole.mentionable,
      permissions: oldRole.permissions
    });

    const member =
      await guild.members
        .fetch(executor.id)
        .catch(() => null);

    if (member) {
      await timeoutMember(
        member,
        g.roleProtect.timeoutMinutes,
        "Unauthorized protected-role modification"
      );
    }

    await sendLog(
      guild,
      "security",
      "🛡️ Role Protector",
      `Unauthorized modification of protected role **${newRole.name}** was detected.\nExecutor: **${executor.tag}**\nAction: role restored + timeout.`,
      0xed4245
    );
  } catch (err) {
    console.error("Role protector error:", err);
  }
});

/* =========================================================
   BOT ADD PROTECTION
========================================================= */

client.on("guildMemberAdd", async member => {
  await processJoin(member);

  if (
    !member.user.bot
  ) return;

  const g = getGuild(member.guild.id);

  if (
    !g.security.enabled ||
    !g.security.antiBotAdd
  ) return;

  const audit =
    await member.guild.fetchAuditLogs({
      type: 28,
      limit: 5
    }).catch(() => null);

  const entry =
    audit?.entries?.find(
      e =>
        e.target?.id === member.id &&
        Date.now() - e.createdTimestamp < 15000
    );

  if (!entry) return;

  const executor = entry.executor;

  if (
    !executor ||
    isTrustedBot(member.guild, executor.id)
  ) return;

  try {
    await member.kick(
      "Unauthorized bot addition"
    );

    await sendLog(
      member.guild,
      "security",
      "🤖 Unauthorized Bot Blocked",
      `Bot **${member.user.tag}** was added by **${executor.tag}** and removed because the executor is not trusted.`,
      0xed4245
    );
  } catch {}
});

/* =========================================================
   AUDIT / ANTI-NUKE
========================================================= */

const auditCache = new Map();

async function antiNukeCheck(guild, executorId, action) {
  const g = getGuild(guild.id);

  if (
    !g.security.enabled ||
    !g.security.antiNuke
  ) return;

  if (
    isTrusted(guild, executorId)
  ) return;

  const key = `${guild.id}:${executorId}:${action}`;

  const now = Date.now();

  if (!auditCache.has(key)) {
    auditCache.set(key, []);
  }

  const arr = auditCache.get(key);

  arr.push(now);

  while (
    arr.length &&
    now - arr[0] > 30000
  ) {
    arr.shift();
  }

  if (arr.length >= 3) {
    const member =
      await guild.members
        .fetch(executorId)
        .catch(() => null);

    if (member) {
      await timeoutMember(
        member,
        60,
        `Anti-nuke: ${action}`
      );
    }

    await sendLog(
      guild,
      "security",
      "☢️ Anti-Nuke Triggered",
      `**Executor:** <@${executorId}>\n**Action:** ${action}\n**Detected actions:** ${arr.length}\nUnauthorized executor was temporarily restricted.`,
      0xed4245
    );
  }
}

client.on("channelCreate", async channel => {
  if (!channel.guild) return;

  const logs =
    await channel.guild.fetchAuditLogs({
      type: 10,
      limit: 5
    }).catch(() => null);

  const entry =
    logs?.entries?.find(
      e =>
        e.target?.id === channel.id &&
        Date.now() - e.createdTimestamp < 10000
    );

  if (entry) {
    await antiNukeCheck(
      channel.guild,
      entry.executor.id,
      "channel creation"
    );
  }
});

client.on("channelDelete", async channel => {
  if (!channel.guild) return;

  const logs =
    await channel.guild.fetchAuditLogs({
      type: 12,
      limit: 5
    }).catch(() => null);

  const entry =
    logs?.entries?.find(
      e =>
        e.target?.id === channel.id &&
        Date.now() - e.createdTimestamp < 10000
    );

  if (entry) {
    await antiNukeCheck(
      channel.guild,
      entry.executor.id,
      "channel deletion"
    );
  }
});

client.on("guildBanAdd", async ban => {
  const logs =
    await ban.guild.fetchAuditLogs({
      type: 22,
      limit: 5
    }).catch(() => null);

  const entry =
    logs?.entries?.find(
      e =>
        e.target?.id === ban.user.id &&
        Date.now() - e.createdTimestamp < 10000
    );

  if (entry) {
    await antiNukeCheck(
      ban.guild,
      entry.executor.id,
      "member ban"
    );
  }
});

client.on("guildMemberRemove", async member => {
  const logs =
    await member.guild.fetchAuditLogs({
      type: 20,
      limit: 5
    }).catch(() => null);

  const entry =
    logs?.entries?.find(
      e =>
        e.target?.id === member.id &&
        Date.now() - e.createdTimestamp < 10000
    );

  if (entry) {
    await antiNukeCheck(
      member.guild,
      entry.executor.id,
      "member kick"
    );
  }
});

/* =========================================================
   MESSAGE AUTOMOD
========================================================= */

client.on("messageCreate", async message => {
  if (message.author.bot) return;

  if (
    message.channel.type === ChannelType.DM
  ) {
    await handleDM(message);
    return;
  }

  await processAutoMod(message);
});

/* =========================================================
   DM TICKET SYSTEM
========================================================= */

async function createTicket(guild, user, source = "dm") {
  const g = getGuild(guild.id);

  const existing =
    Object.values(g.ticketsData).find(
      t =>
        t.userId === user.id &&
        t.status === "open"
    );

  if (existing) {
    return guild.channels.cache.get(
      existing.channelId
    );
  }

  const channel =
    await guild.channels.create({
      name: `ticket-${user.username}`.toLowerCase().slice(0, 90),
      type: ChannelType.GuildText,
      parent: g.tickets.category || null,
      permissionOverwrites: [
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
      ]
    });

  g.ticketsData[channel.id] = {
    channelId: channel.id,
    userId: user.id,
    status: "open",
    claimedBy: null,
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
        `A member of the support team will assist you shortly.\n\n` +
        `Use the buttons below to manage this ticket.`
      )
      .setTimestamp();

  const row =
    new ActionRowBuilder().addComponents(
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
    `User: <@${user.id}>\nChannel: ${channel}\nSource: ${source}`
  );

  return channel;
}

async function handleDM(message) {
  const guild =
    client.guilds.cache.get(GUILD_ID);

  if (!guild) {
    await message.reply(
      "The support server is currently unavailable."
    ).catch(() => {});
    return;
  }

  const channel =
    await createTicket(
      guild,
      message.author,
      "DM"
    );

  if (!channel) return;

  await channel.send(
    `📩 **DM from ${message.author.tag}:**\n${message.content}`
  ).catch(() => {});

  await message.reply(
    `🎫 Your support ticket has been created: **${channel.name}**\nOur support team will contact you there.`
  ).catch(() => {});
}

/* =========================================================
   TICKET TRANSCRIPT
========================================================= */

async function makeTranscript(channel) {
  const messages =
    await channel.messages
      .fetch({ limit: 100 })
      .catch(() => null);

  if (!messages) return "Unable to create transcript.";

  const arr =
    [...messages.values()]
      .reverse()
      .map(
        m =>
          `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content}`
      );

  return arr.join("\n");
}

/* =========================================================
   INTERACTIONS
========================================================= */

client.on("interactionCreate", async interaction => {
  try {
    if (
      interaction.isButton()
    ) {
      await handleButton(interaction);
      return;
    }

    if (
      interaction.isChatInputCommand()
    ) {
      await handleCommand(interaction);
      return;
    }
  } catch (err) {
    console.error("Interaction error:", err);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "❌ An unexpected error occurred.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

/* =========================================================
   BUTTONS
========================================================= */

async function handleButton(interaction) {
  const id = interaction.customId;

  if (
    id === "ticket_open"
  ) {
    if (!interaction.guild) return;

    const channel =
      await createTicket(
        interaction.guild,
        interaction.user,
        "panel"
      );

    await interaction.reply({
      content: channel
        ? `🎫 Ticket created: ${channel}`
        : "❌ Could not create your ticket.",
      ephemeral: true
    });

    return;
  }

  if (
    !interaction.guild
  ) return;

  const g =
    getGuild(interaction.guild.id);

  const ticket =
    g.ticketsData[interaction.channelId];

  if (
    id === "ticket_claim"
  ) {
    if (!ticket) {
      await interaction.reply({
        content: "❌ This is not a ticket.",
        ephemeral: true
      });
      return;
    }

    if (!isAdmin(interaction.member)) {
      await interaction.reply({
        content: "❌ Staff only.",
        ephemeral: true
      });
      return;
    }

    ticket.claimedBy =
      interaction.user.id;

    saveDB();

    await interaction.reply(
      `🙋 Ticket claimed by ${interaction.user}.`
    );

    return;
  }

  if (
    id === "ticket_lock"
  ) {
    if (!ticket) return;

    if (!isAdmin(interaction.member)) {
      await interaction.reply({
        content: "❌ Staff only.",
        ephemeral: true
      });
      return;
    }

    await interaction.channel.permissionOverwrites.edit(
      ticket.userId,
      {
        SendMessages: false
      }
    );

    await interaction.reply(
      "🔒 Ticket locked."
    );

    return;
  }

  if (
    id === "ticket_close"
  ) {
    if (!ticket) return;

    if (
      !isAdmin(interaction.member) &&
      interaction.user.id !== ticket.userId
    ) {
      await interaction.reply({
        content: "❌ You cannot close this ticket.",
        ephemeral: true
      });
      return;
    }

    await interaction.reply(
      "🔒 Closing ticket..."
    );

    ticket.status = "closed";
    ticket.closedAt = Date.now();

    saveDB();

    const transcript =
      await makeTranscript(
        interaction.channel
      );

    const log =
      interaction.guild.channels.cache.get(
        g.tickets.logChannel
      );

    if (log) {
      const embed =
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("🎫 Ticket Closed")
          .setDescription(
            `Ticket: ${interaction.channel.name}\n` +
            `Closed by: ${interaction.user}\n` +
            `Owner: <@${ticket.userId}>`
          )
          .setTimestamp();

      await log.send({
        embeds: [embed]
      });

      if (g.tickets.transcript) {
        await log.send({
          files: [
            {
              attachment: Buffer.from(transcript),
              name: `${interaction.channel.name}-transcript.txt`
            }
          ]
        }).catch(() => {});
      }
    }

    setTimeout(() => {
      interaction.channel.delete().catch(() => {});
    }, 2000);

    return;
  }

  if (
    id === "suggest_approve" ||
    id === "suggest_decline"
  ) {
    if (!isAdmin(interaction.member)) {
      await interaction.reply({
        content: "❌ Staff only.",
        ephemeral: true
      });
      return;
    }

    const data =
      g.suggestionsData[interaction.message.id];

    if (!data) {
      await interaction.reply({
        content: "❌ Suggestion data not found.",
        ephemeral: true
      });
      return;
    }

    data.status =
      id === "suggest_approve"
        ? "approved"
        : "declined";

    data.reviewedBy =
      interaction.user.id;

    saveDB();

    const embed =
      EmbedBuilder.from(
        interaction.message.embeds[0]
      )
        .setColor(
          id === "suggest_approve"
            ? 0x57f287
            : 0xed4245
        )
        .addFields({
          name: "Status",
          value:
            id === "suggest_approve"
              ? "✅ Approved"
              : "❌ Declined"
        });

    await interaction.message.edit({
      embeds: [embed]
    });

    await interaction.reply({
      content: `Suggestion ${data.status}.`,
      ephemeral: true
    });
  }
}

/* =========================================================
   COMMAND HANDLER
========================================================= */

async function handleCommand(i) {
  const command = i.commandName;

  /* ---------- BASIC ---------- */

  if (command === "ping") {
    await i.reply(
      `🏓 Pong! ${client.ws.ping}ms`
    );
    return;
  }

  if (command === "uptime") {
    const seconds =
      Math.floor(process.uptime());

    const d =
      Math.floor(seconds / 86400);

    const h =
      Math.floor((seconds % 86400) / 3600);

    const m =
      Math.floor((seconds % 3600) / 60);

    const s =
      seconds % 60;

    await i.reply(
      `⏱️ Uptime: **${d}d ${h}h ${m}m ${s}s**`
    );
    return;
  }

  if (command === "botinfo") {
    const embed =
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("🤖 Bot Information")
        .addFields(
          {
            name: "Servers",
            value: `${client.guilds.cache.size}`,
            inline: true
          },
          {
            name: "Commands",
            value: `${commands.length}`,
            inline: true
          },
          {
            name: "Discord.js",
            value: "14.27.0",
            inline: true
          }
        )
        .setTimestamp();

    await i.reply({
      embeds: [embed]
    });
    return;
  }

  if (command === "serverinfo") {
    const guild = i.guild;

    const embed =
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`🏠 ${guild.name}`)
        .addFields(
          {
            name: "Members",
            value: `${guild.memberCount}`,
            inline: true
          },
          {
            name: "Channels",
            value: `${guild.channels.cache.size}`,
            inline: true
          },
          {
            name: "Roles",
            value: `${guild.roles.cache.size}`,
            inline: true
          }
        )
        .setTimestamp();

    await i.reply({
      embeds: [embed]
    });
    return;
  }

  if (command === "userinfo") {
    const user =
      i.options.getUser("user") ||
      i.user;

    const member =
      i.guild.members.cache.get(
        user.id
      );

    const embed =
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`👤 ${user.tag}`)
        .setThumbnail(
          user.displayAvatarURL({
            size: 512
          })
        )
        .addFields(
          {
            name: "User ID",
            value: user.id
          },
          {
            name: "Joined Server",
            value: member?.joinedTimestamp
              ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`
              : "Unknown"
          }
        );

    await i.reply({
      embeds: [embed]
    });
    return;
  }

  if (command === "avatar") {
    const user =
      i.options.getUser("user") ||
      i.user;

    await i.reply(
      user.displayAvatarURL({
        size: 4096,
        extension: "png"
      })
    );

    return;
  }

  if (command === "help") {
    const names =
      commands.map(c =>
        `\`/${c.name}\``
      );

    const chunks = [];

    for (
      let x = 0;
      x < names.length;
      x += 20
    ) {
      chunks.push(
        names.slice(x, x + 20).join(" • ")
      );
    }

    const embed =
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("📚 Complete Bot Commands")
        .setDescription(
          chunks.join("\n\n")
        )
        .setFooter({
          text: `${commands.length} registered commands`
        });

    await i.reply({
      embeds: [embed],
      ephemeral: true
    });

    return;
  }

  /* ---------- PERMISSION ---------- */

  const adminCommands = [
    "automod",
    "automod-config",
    "automod-logs",
    "automod-word",
    "automod-word-remove",
    "autotimeout",
    "autotimeout-config",
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
    "roleprotect-config",
    "logs",
    "logs-config",
    "audit",
    "audit-config",
    "modlogs",
    "security-logs",
    "ticket-panel",
    "ticket-config",
    "suggest-config",
    "suggestions",
    "announcement-panel",
    "announcement-config",
    "announcement-channel",
    "announcement-tags",
    "config",
    "config-view",
    "config-reset",
    "config-ticket",
    "config-automod",
    "config-security",
    "config-logs",
    "config-suggestions",
    "config-announcements"
  ];

  if (
    adminCommands.includes(command) &&
    !isAdmin(i.member)
  ) {
    await i.reply({
      content: "❌ Administrator/Support Staff only.",
      ephemeral: true
    });
    return;
  }

  /* ---------- MODERATION ---------- */

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
    ].includes(command) &&
    !isAdmin(i.member)
  ) {
    await i.reply({
      content: "❌ Staff only.",
      ephemeral: true
    });
    return;
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

    const member =
      await i.guild.members
        .fetch(user.id)
        .catch(() => null);

    const g =
      getGuild(i.guild.id);

    if (
      member &&
      g.autotimeout.enabled &&
      count >= g.autotimeout.strikes
    ) {
      await timeoutMember(
        member,
        g.autotimeout.minutes,
        "Warning escalation"
      );

      addPunishment(
        i.guild.id,
        user.id,
        "timeout",
        "Warning escalation",
        i.user.id
      );
    }

    await i.reply(
      `⚠️ ${user} warned.\nWarnings: **${count}**\nReason: **${reason}**`
    );

    await sendLog(
      i.guild,
      "moderation",
      "⚠️ Warning",
      `User: ${user}\nModerator: ${i.user}\nReason: ${reason}\nWarnings: ${count}`,
      0xfaa61a
    );

    return;
  }

  if (command === "warnings") {
    const user =
      i.options.getUser("user");

    const g =
      getGuild(i.guild.id);

    const list =
      g.warnings[user.id] || [];

    const text =
      list.length
        ? list
            .slice(-20)
            .map(
              (w, n) =>
                `**${n + 1}.** ${w.reason} — <@${w.moderatorId}> <t:${Math.floor(w.timestamp / 1000)}:R>`
            )
            .join("\n")
        : "No warnings.";

    await i.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xfaa61a)
          .setTitle(`⚠️ Warnings — ${user.tag}`)
          .setDescription(text)
      ]
    });

    return;
  }

  if (command === "warnings-clear") {
    const user =
      i.options.getUser("user");

    const g =
      getGuild(i.guild.id);

    g.warnings[user.id] = [];

    saveDB();

    await i.reply(
      `✅ Warnings cleared for ${user}.`
    );

    return;
  }

  if (command === "punishments") {
    const user =
      i.options.getUser("user");

    const g =
      getGuild(i.guild.id);

    const list =
      g.punishments[user.id] || [];

    const text =
      list.length
        ? list
            .slice(-20)
            .map(
              (p, n) =>
                `**${n + 1}.** ${p.type} — ${p.reason} — <@${p.moderatorId}> <t:${Math.floor(p.timestamp / 1000)}:R>`
            )
            .join("\n")
        : "No punishment history.";

    await i.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`📋 Punishments — ${user.tag}`)
          .setDescription(text)
      ]
    });

    return;
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

    if (!member?.kickable) {
      await i.reply({
        content: "❌ I cannot kick this member.",
        ephemeral: true
      });
      return;
    }

    await member.kick(reason);

    addPunishment(
      i.guild.id,
      user.id,
      "kick",
      reason,
      i.user.id
    );

    await i.reply(
      `👢 ${user.tag} kicked.\nReason: ${reason}`
    );

    await sendLog(
      i.guild,
      "moderation",
      "👢 Member Kicked",
      `User: ${user.tag}\nModerator: ${i.user}\nReason: ${reason}`,
      0xed4245
    );

    return;
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
      await i.reply({
        content: "❌ I cannot ban this member.",
        ephemeral: true
      });
      return;
    }

    await i.guild.members.ban(
      user.id,
      { reason }
    );

    addPunishment(
      i.guild.id,
      user.id,
      "ban",
      reason,
      i.user.id
    );

    await i.reply(
      `🔨 ${user.tag} banned.\nReason: ${reason}`
    );

    await sendLog(
      i.guild,
      "moderation",
      "🔨 Member Banned",
      `User: ${user.tag}\nModerator: ${i.user}\nReason: ${reason}`,
      0xed4245
    );

    return;
  }

  if (command === "unban") {
    const id =
      i.options.getString("userid");

    const reason =
      cleanReason(
        i.options.getString("reason")
      );

    await i.guild.members.unban(
      id,
      reason
    );

    addPunishment(
      i.guild.id,
      id,
      "unban",
      reason,
      i.user.id
    );

    await i.reply(
      `✅ <@${id}> unbanned.`
    );

    return;
  }

  if (command === "timeout") {
    const user =
      i.options.getUser("user");

    const minutes =
      i.options.getInteger("minutes");

    const reason =
      cleanReason(
        i.options.getString("reason")
      );

    const member =
      await i.guild.members
        .fetch(user.id)
        .catch(() => null);

    if (!member) {
      await i.reply({
        content: "❌ Member not found.",
        ephemeral: true
      });
      return;
    }

    if (
      !await timeoutMember(
        member,
        minutes,
        reason
      )
    ) {
      await i.reply({
        content: "❌ I cannot timeout this member.",
        ephemeral: true
      });
      return;
    }

    addPunishment(
      i.guild.id,
      user.id,
      "timeout",
      reason,
      i.user.id
    );

    await i.reply(
      `⏱️ ${user.tag} timed out for **${minutes} minutes**.\nReason: ${reason}`
    );

    return;
  }

  if (command === "untimeout") {
    const user =
      i.options.getUser("user");

    const member =
      await i.guild.members
        .fetch(user.id)
        .catch(() => null);

    if (!member?.moderatable) {
      await i.reply({
        content: "❌ I cannot modify this member.",
        ephemeral: true
      });
      return;
    }

    await member.timeout(
      null,
      "Timeout removed"
    );

    await i.reply(
      `✅ Timeout removed from ${user}.`
    );

    return;
  }

  if (command === "purge") {
    const amount =
      i.options.getInteger("amount");

    const messages =
      await i.channel.bulkDelete(
        amount,
        true
      );

    await i.reply({
      content: `🧹 Deleted ${messages.size} messages.`,
      ephemeral: true
    });

    return;
  }

  if (command === "slowmode") {
    const seconds =
      i.options.getInteger("seconds");

    await i.channel.setRateLimitPerUser(
      seconds
    );

    await i.reply(
      `🐌 Slowmode set to ${seconds}s.`
    );

    return;
  }

  if (
    command === "lock" ||
    command === "unlock"
  ) {
    const locked =
      command === "lock";

    await i.channel.permissionOverwrites.edit(
      i.guild.roles.everyone,
      {
        SendMessages: !locked
      }
    );

    await i.reply(
      locked
        ? "🔒 Channel locked."
        : "🔓 Channel unlocked."
    );

    return;
  }

  /* ---------- AUTOMOD ---------- */

  if (command === "automod") {
    const action =
      i.options.getString("action");

    const g =
      getGuild(i.guild.id);

    if (action === "status") {
      await i.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("🛡️ AutoMod Status")
            .setDescription(
              `Main: **${g.automod.enabled ? "ON" : "OFF"}**\n` +
              `Invites: **${g.automod.invites ? "ON" : "OFF"}**\n` +
              `Spam: **${g.automod.spam ? "ON" : "OFF"}**\n` +
              `Caps: **${g.automod.caps ? "ON" : "OFF"}**\n` +
              `Bad words: **${g.automod.badwords ? "ON" : "OFF"}**\n` +
              `Repeated: **${g.automod.repeated ? "ON" : "OFF"}**\n` +
              `Mentions: **${g.automod.mentions ? "ON" : "OFF"}**`
            )
        ],
        ephemeral: true
      });
      return;
    }

    g.automod.enabled =
      action === "enable";

    saveDB();

    await i.reply(
      `🛡️ AutoMod **${g.automod.enabled ? "enabled" : "disabled"}**.`
    );

    return;
  }

  if (command === "automod-config") {
    const feature =
      i.options.getString("feature");

    const enabled =
      i.options.getBoolean("enabled");

    const g =
      getGuild(i.guild.id);

    g.automod[feature] =
      enabled;

    saveDB();

    await i.reply(
      `✅ AutoMod **${feature}** set to **${enabled ? "ON" : "OFF"}**.`
    );

    return;
  }

  if (command === "automod-logs") {
    const channel =
      i.options.getChannel("channel");

    const g =
      getGuild(i.guild.id);

    g.automod.logChannel =
      channel.id;

    g.logs.automod =
      channel.id;

    saveDB();

    await i.reply(
      `✅ AutoMod logs set to ${channel}.`
    );

    return;
  }

  if (
    command === "automod-word" ||
    command === "automod-word-remove"
  ) {
    const word =
      i.options.getString("word")
        .toLowerCase();

    const g =
      getGuild(i.guild.id);

    if (
      command === "automod-word"
    ) {
      if (
        !g.automod.badWords.includes(word)
      ) {
        g.automod.badWords.push(word);
      }

      await i.reply(
        `✅ Added \`${word}\` to the blocked-word list.`
      );
    } else {
      g.automod.badWords =
        g.automod.badWords.filter(
          x => x !== word
        );

      await i.reply(
        `✅ Removed \`${word}\`.`
      );
    }

    saveDB();
    return;
  }

  if (command === "autotimeout") {
    const action =
      i.options.getString("action");

    const g =
      getGuild(i.guild.id);

    if (action === "status") {
      await i.reply(
        `⏱️ Auto-timeout: **${g.autotimeout.enabled ? "ON" : "OFF"}**\nStrikes: **${g.autotimeout.strikes}**\nDuration: **${g.autotimeout.minutes} minutes**`
      );
      return;
    }

    g.autotimeout.enabled =
      action === "enable";

    saveDB();

    await i.reply(
      `⏱️ Auto-timeout **${g.autotimeout.enabled ? "enabled" : "disabled"}**.`
    );

    return;
  }

  if (command === "autotimeout-config") {
    const strikes =
      i.options.getInteger("strikes");

    const minutes =
      i.options.getInteger("minutes");

    const g =
      getGuild(i.guild.id);

    g.autotimeout.strikes =
      strikes;

    g.autotimeout.minutes =
      minutes;

    saveDB();

    await i.reply(
      `✅ Auto-timeout configured: **${strikes} strikes → ${minutes} minutes**.`
    );

    return;
  }

  /* ---------- SECURITY ---------- */

  if (command === "security") {
    const action =
      i.options.getString("action");

    const g =
      getGuild(i.guild.id);

    if (action === "status") {
      await i.reply(
        `🔐 Security: **${g.security.enabled ? "ON" : "OFF"}**\nAnti-Raid: **${g.security.antiRaid ? "ON" : "OFF"}**\nAnti-Nuke: **${g.security.antiNuke ? "ON" : "OFF"}**\nAnti-Webhook: **${g.security.antiWebhook ? "ON" : "OFF"}**\nBot protection: **${g.security.antiBotAdd ? "ON" : "OFF"}**\nLockdown: **${g.security.lockdown ? "ON" : "OFF"}**`
      );
      return;
    }

    if (action === "lockdown") {
      g.security.lockdown = true;
    } else if (action === "unlockdown") {
      g.security.lockdown = false;
    } else {
      g.security.enabled =
        action === "enable";
    }

    saveDB();

    await i.reply(
      "🔐 Security configuration updated."
    );

    return;
  }

  if (command === "security-config") {
    const g =
      getGuild(i.guild.id);

    g.security.antiRaid =
      i.options.getBoolean("anti_raid");

    g.security.antiNuke =
      i.options.getBoolean("anti_nuke");

    g.security.antiWebhook =
      i.options.getBoolean("anti_webhook");

    g.security.antiBotAdd =
      i.options.getBoolean("anti_bot");

    saveDB();

    await i.reply(
      "✅ Security settings updated."
    );

    return;
  }

  if (command === "raidmode") {
    const action =
      i.options.getString("action");

    const g =
      getGuild(i.guild.id);

    if (action === "status") {
      await i.reply(
        `🚨 Raid mode: **${g.security.lockdown ? "ON" : "OFF"}**`
      );
      return;
    }

    g.security.lockdown =
      action === "on";

    saveDB();

    await i.reply(
      `🚨 Raid mode **${g.security.lockdown ? "enabled" : "disabled"}**.`
    );

    return;
  }

  if (command === "raidmode-config") {
    const joins =
      i.options.getInteger("joins");

    const seconds =
      i.options.getInteger("seconds");

    const g =
      getGuild(i.guild.id);

    g.security.joinLimit =
      joins;

    g.security.joinWindow =
      seconds * 1000;

    saveDB();

    await i.reply(
      `✅ Raid detection: **${joins} joins / ${seconds}s**.`
    );

    return;
  }

  if (command === "antinuke") {
    const action =
      i.options.getString("action");

    const g =
      getGuild(i.guild.id);

    if (action === "status") {
      await i.reply(
        `☢️ Anti-nuke: **${g.security.antiNuke ? "ON" : "OFF"}**`
      );
      return;
    }

    g.security.antiNuke =
      action === "enable";

    saveDB();

    await i.reply(
      `☢️ Anti-nuke **${g.security.antiNuke ? "enabled" : "disabled"}**.`
    );

    return;
  }

  if (command === "antinuke-config") {
    const enabled =
      i.options.getBoolean("enabled");

    const g =
      getGuild(i.guild.id);

    g.security.antiNuke =
      enabled;

    saveDB();

    await i.reply(
      `☢️ Anti-nuke set to **${enabled ? "ON" : "OFF"}**.`
    );

    return;
  }

  /* ---------- TRUSTED ---------- */

  if (
    command === "trusted" ||
    command === "trusted-list"
  ) {
    const g =
      getGuild(i.guild.id);

    const users =
      g.trusted.users.length
        ? g.trusted.users.map(
            id => `<@${id}>`
          ).join(", ")
        : "None";

    const bots =
      g.trusted.bots.length
        ? g.trusted.bots.map(
            id => `<@${id}>`
          ).join(", ")
        : "None";

    await i.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("👤 Trusted Security List")
          .addFields(
            {
              name: "Trusted Users",
              value: users
            },
            {
              name: "Trusted Bots",
              value: bots
            }
          )
      ],
      ephemeral: true
    });

    return;
  }

  if (command === "trusted-add") {
    const user =
      i.options.getUser("user");

    const bot =
      i.options.getBoolean("bot") || false;

    const g =
      getGuild(i.guild.id);

    const list =
      bot
        ? g.trusted.bots
        : g.trusted.users;

    if (!list.includes(user.id)) {
      list.push(user.id);
    }

    saveDB();

    await i.reply(
      `✅ ${user} added to trusted ${bot ? "bot" : "user"} list.`
    );

    return;
  }

  if (command === "trusted-remove") {
    const user =
      i.options.getUser("user");

    const g =
      getGuild(i.guild.id);

    g.trusted.users =
      g.trusted.users.filter(
        id => id !== user.id
      );

    g.trusted.bots =
      g.trusted.bots.filter(
        id => id !== user.id
      );

    saveDB();

    await i.reply(
      `✅ ${user} removed from trusted lists.`
    );

    return;
  }

  /* ---------- ROLE PROTECT ---------- */

  if (command === "roleprotect") {
    const action =
      i.options.getString("action");

    const g =
      getGuild(i.guild.id);

    if (action === "status") {
      await i.reply(
        `🛡️ Role Protector: **${g.roleProtect.enabled ? "ON" : "OFF"}**\nProtected roles: **${g.roleProtect.protectedRoles.length}**\nUnauthorized timeout: **${g.roleProtect.timeoutMinutes} minutes**`
      );
      return;
    }

    g.roleProtect.enabled =
      action === "enable";

    saveDB();

    await i.reply(
      `🛡️ Role Protector **${g.roleProtect.enabled ? "enabled" : "disabled"}**.`
    );

    return;
  }

  if (
    command === "roleprotect-add" ||
    command === "roleprotect-remove"
  ) {
    const role =
      i.options.getRole("role");

    const g =
      getGuild(i.guild.id);

    if (
      command === "roleprotect-add"
    ) {
      if (
        !g.roleProtect.protectedRoles.includes(
          role.id
        )
      ) {
        g.roleProtect.protectedRoles.push(
          role.id
        );
      }

      await i.reply(
        `🛡️ ${role} is now protected. Unauthorized modification will be restored and the executor will receive a timeout.`
      );
    } else {
      g.roleProtect.protectedRoles =
        g.roleProtect.protectedRoles.filter(
          id => id !== role.id
        );

      await i.reply(
        `✅ ${role} removed from protection.`
      );
    }

    saveDB();
    return;
  }

  if (command === "roleprotect-list") {
    const g =
      getGuild(i.guild.id);

    const text =
      g.roleProtect.protectedRoles.length
        ? g.roleProtect.protectedRoles
            .map(id => `<@&${id}>`)
            .join("\n")
        : "No protected roles.";

    await i.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("🛡️ Protected Roles")
          .setDescription(text)
      ],
      ephemeral: true
    });

    return;
  }

  if (command === "roleprotect-config") {
    const minutes =
      i.options.getInteger("minutes");

    const g =
      getGuild(i.guild.id);

    g.roleProtect.timeoutMinutes =
      minutes;

    saveDB();

    await i.reply(
      `✅ Unauthorized protected-role modification timeout set to **${minutes} minutes**.`
    );

    return;
  }

  /* ---------- LOGS ---------- */

  if (command === "logs") {
    const type =
      i.options.getString("type");

    const channel =
      i.options.getChannel("channel");

    const g =
      getGuild(i.guild.id);

    g.logs[type] =
      channel.id;

    saveDB();

    await i.reply(
      `📋 **${type}** logs set to ${channel}.`
    );

    return;
  }

  if (
    command === "logs-config" ||
    command === "modlogs" ||
    command === "security-logs"
  ) {
    const g =
      getGuild(i.guild.id);

    await i.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("📋 Logging Configuration")
          .setDescription(
            Object.entries(g.logs)
              .map(
                ([k, v]) =>
                  `**${k}:** ${v ? `<#${v}>` : "Not configured"}`
              )
              .join("\n")
          )
      ],
      ephemeral: true
    });

    return;
  }

  if (command === "audit") {
    const logs =
      await i.guild.fetchAuditLogs({
        limit: 10
      });

    const text =
      logs.entries
        .map(
          e =>
            `**${e.action}** — ${e.executor?.tag || "Unknown"} — <t:${Math.floor(e.createdTimestamp / 1000)}:R>`
        )
        .join("\n");

    await i.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("📋 Recent Audit Activity")
          .setDescription(
            text || "No recent audit entries."
          )
      ],
      ephemeral: true
    });

    return;
  }

  if (command === "audit-config") {
    const channel =
      i.options.getChannel("channel");

    const g =
      getGuild(i.guild.id);

    g.logs.audit =
      channel.id;

    saveDB();

    await i.reply(
      `✅ Audit logs set to ${channel}.`
    );

    return;
  }

  /* ---------- TICKETS ---------- */

  if (command === "ticket") {
    const channel =
      await createTicket(
        i.guild,
        i.user,
        "command"
      );

    await i.reply({
      content:
        channel
          ? `🎫 Ticket created: ${channel}`
          : "❌ Ticket creation failed.",
      ephemeral: true
    });

    return;
  }

  if (command === "ticket-panel") {
    const channel =
      i.options.getChannel("channel");

    const embed =
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("🎫 Support Center")
        .setDescription(
          "Need help? Click the button below to create a support ticket.\n\n" +
          "Our support team will assist you as soon as possible."
        )
        .setFooter({
          text: "Support System"
        })
        .setTimestamp();

    const row =
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("ticket_open")
          .setLabel("Open Ticket")
          .setEmoji("🎫")
          .setStyle(ButtonStyle.Primary)
      );

    const msg =
      await channel.send({
        embeds: [embed],
        components: [row]
      });

    const g =
      getGuild(i.guild.id);

    g.tickets.panelChannel =
      channel.id;

    g.tickets.panelMessage =
      msg.id;

    saveDB();

    await i.reply({
      content: `✅ Ticket panel created in ${channel}.`,
      ephemeral: true
    });

    return;
  }

  if (command === "ticket-close") {
    await closeTicket(i);
    return;
  }

  if (
    command === "ticket-claim"
  ) {
    const g =
      getGuild(i.guild.id);

    const ticket =
      g.ticketsData[i.channelId];

    if (!ticket) {
      await i.reply({
        content: "❌ Not a ticket channel.",
        ephemeral: true
      });
      return;
    }

    ticket.claimedBy =
      i.user.id;

    saveDB();

    await i.reply(
      `🙋 Ticket claimed by ${i.user}.`
    );

    return;
  }

  if (command === "ticket-add") {
    const user =
      i.options.getUser("user");

    const g =
      getGuild(i.guild.id);

    const ticket =
      g.ticketsData[i.channelId];

    if (!ticket) {
      await i.reply({
        content: "❌ Not a ticket.",
        ephemeral: true
      });
      return;
    }

    await i.channel.permissionOverwrites.edit(
      user.id,
      {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      }
    );

    await i.reply(
      `✅ Added ${user} to the ticket.`
    );

    return;
  }

  if (command === "ticket-remove") {
    const user =
      i.options.getUser("user");

    await i.channel.permissionOverwrites.delete(
      user.id
    ).catch(() => {});

    await i.reply(
      `✅ Removed ${user} from the ticket.`
    );

    return;
  }

  if (
    command === "ticket-transcript"
  ) {
    const transcript =
      await makeTranscript(
        i.channel
      );

    await i.reply({
      files: [
        {
          attachment:
            Buffer.from(transcript),
          name:
            `${i.channel.name}-transcript.txt`
        }
      ],
      ephemeral: true
    });

    return;
  }

  if (
    command === "ticket-lock" ||
    command === "ticket-unlock"
  ) {
    const g =
      getGuild(i.guild.id);

    const ticket =
      g.ticketsData[i.channelId];

    if (!ticket) {
      await i.reply({
        content: "❌ Not a ticket.",
        ephemeral: true
      });
      return;
    }

    const locked =
      command === "ticket-lock";

    await i.channel.permissionOverwrites.edit(
      ticket.userId,
      {
        SendMessages: !locked
      }
    );

    await i.reply(
      locked
        ? "🔒 Ticket locked."
        : "🔓 Ticket unlocked."
    );

    return;
  }

  if (command === "ticket-rename") {
    const name =
      i.options.getString("name");

    await i.channel.setName(
      name.slice(0, 90)
    );

    await i.reply(
      `✅ Ticket renamed to **${name}**.`
    );

    return;
  }

  if (command === "ticket-config") {
    const g =
      getGuild(i.guild.id);

    const role =
      i.options.getRole("support_role");

    const category =
      i.options.getChannel("category");

    const logs =
      i.options.getChannel("log_channel");

    if (role)
      g.tickets.supportRole =
        role.id;

    if (category)
      g.tickets.category =
        category.id;

    if (logs)
      g.tickets.logChannel =
        logs.id;

    saveDB();

    await i.reply(
      "✅ Ticket configuration updated."
    );

    return;
  }

  /* ---------- SUGGESTIONS ---------- */

  if (command === "suggest") {
    const g =
      getGuild(i.guild.id);

    if (!g.suggestions.enabled) {
      await i.reply({
        content: "❌ Suggestions are disabled.",
        ephemeral: true
      });
      return;
    }

    const text =
      i.options.getString("suggestion");

    const channel =
      i.guild.channels.cache.get(
        g.suggestions.channel
      );

    if (!channel) {
      await i.reply({
        content: "❌ Suggestion channel is not configured.",
        ephemeral: true
      });
      return;
    }

    const embed =
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("💡 New Suggestion")
        .setDescription(text)
        .addFields({
          name: "Submitted by",
          value: `${i.user}`
        })
        .setTimestamp();

    const row =
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("suggest_approve")
          .setLabel("Approve")
          .setEmoji("✅")
          .setStyle(ButtonStyle.Success),

        new ButtonBuilder()
          .setCustomId("suggest_decline")
          .setLabel("Decline")
          .setEmoji("❌")
          .setStyle(ButtonStyle.Danger)
      );

    const msg =
      await channel.send({
        embeds: [embed],
        components: [row]
      });

    g.suggestionsData[msg.id] = {
      userId: i.user.id,
      text,
      status: "pending",
      createdAt: Date.now()
    };

    saveDB();

    await i.reply({
      content: `✅ Suggestion submitted: ${msg.url}`,
      ephemeral: true
    });

    return;
  }

  if (
    command === "suggest-config"
  ) {
    const channel =
      i.options.getChannel("channel");

    const role =
      i.options.getRole("staff_role");

    const g =
      getGuild(i.guild.id);

    g.suggestions.channel =
      channel.id;

    if (role)
      g.suggestions.staffRole =
        role.id;

    saveDB();

    await i.reply(
      `✅ Suggestions configured for ${channel}.`
    );

    return;
  }

  if (
    command === "suggestions"
  ) {
    const g =
      getGuild(i.guild.id);

    await i.reply(
      `💡 Suggestion channel: ${g.suggestions.channel ? `<#${g.suggestions.channel}>` : "Not configured"}\nStaff role: ${g.suggestions.staffRole ? `<@&${g.suggestions.staffRole}>` : "Not configured"}`
    );

    return;
  }

  /* ---------- ANNOUNCEMENTS ---------- */

  if (command === "announce") {
    const title =
      i.options.getString("title");

    const message =
      i.options.getString("message");

    const channel =
      i.options.getChannel("channel") ||
      i.guild.channels.cache.get(
        getGuild(i.guild.id)
          .announcements.channel
      ) ||
      i.channel;

    const role =
      i.options.getRole("role") ||
      (
        getGuild(i.guild.id)
          .announcements.role
          ? i.guild.roles.cache.get(
              getGuild(i.guild.id)
                .announcements.role
            )
          : null
      );

    const image =
      i.options.getString("image") ||
      getGuild(i.guild.id)
        .announcements.image;

    const embed =
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`📢 ${title}`)
        .setDescription(message)
        .setFooter({
          text: getGuild(i.guild.id)
            .announcements.footer
        })
        .setTimestamp();

    if (image) {
      embed.setImage(image);
    }

    await channel.send({
      content: role
        ? `${role}`
        : undefined,
      embeds: [embed]
    });

    await i.reply({
      content: `✅ Announcement sent to ${channel}.`,
      ephemeral: true
    });

    return;
  }

  if (
    command === "announcement-panel"
  ) {
    const channel =
      i.options.getChannel("channel");

    const embed =
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("📢 Announcement Center")
        .setDescription(
          "Use the announcement commands to create professional announcements."
        );

    const row =
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("announcement_info")
          .setLabel("Announcement System")
          .setEmoji("📢")
          .setStyle(ButtonStyle.Primary)
      );

    await channel.send({
      embeds: [embed],
      components: [row]
    });

    await i.reply({
      content: `✅ Announcement panel created in ${channel}.`,
      ephemeral: true
    });

    return;
  }

  if (
    command === "announcement-config"
  ) {
    const g =
      getGuild(i.guild.id);

    const channel =
      i.options.getChannel("channel");

    const role =
      i.options.getRole("role");

    const image =
      i.options.getString("image");

    if (channel)
      g.announcements.channel =
        channel.id;

    if (role)
      g.announcements.role =
        role.id;

    if (image)
      g.announcements.image =
        image;

    saveDB();

    await i.reply(
      "✅ Announcement configuration updated."
    );

    return;
  }

  if (
    command === "announcement-channel"
  ) {
    const channel =
      i.options.getChannel("channel");

    const g =
      getGuild(i.guild.id);

    g.announcements.channel =
      channel.id;

    saveDB();

    await i.reply(
      `📢 Default announcement channel set to ${channel}.`
    );

    return;
  }

  if (
    command === "announcement-tags"
  ) {
    const role =
      i.options.getRole("role");

    const g =
      getGuild(i.guild.id);

    g.announcements.role =
      role.id;

    saveDB();

    await i.reply(
      `📢 Default announcement role set to ${role}.`
    );

    return;
  }

  /* ---------- CONFIG ---------- */

  if (
    command === "config" ||
    command === "config-view"
  ) {
    const g =
      getGuild(i.guild.id);

    await i.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle("⚙️ Server Configuration")
          .setDescription(
            `🛡️ AutoMod: **${g.automod.enabled ? "ON" : "OFF"}**\n` +
            `⏱️ Auto-timeout: **${g.autotimeout.enabled ? "ON" : "OFF"}**\n` +
            `🔐 Security: **${g.security.enabled ? "ON" : "OFF"}**\n` +
            `☢️ Anti-nuke: **${g.security.antiNuke ? "ON" : "OFF"}**\n` +
            `🛡️ Role Protector: **${g.roleProtect.enabled ? "ON" : "OFF"}**\n` +
            `🎫 Tickets: **${g.tickets.enabled ? "ON" : "OFF"}**\n` +
            `💡 Suggestions: **${g.suggestions.enabled ? "ON" : "OFF"}**`
          )
      ],
      ephemeral: true
    });

    return;
  }

  if (command === "config-reset") {
    db[i.guild.id] =
      JSON.parse(
        JSON.stringify(DEFAULT_GUILD)
      );

    saveDB();

    await i.reply(
      "⚙️ Server configuration reset."
    );

    return;
  }

  const configMap = {
    "config-ticket": "tickets",
    "config-automod": "automod",
    "config-security": "security",
    "config-logs": "logs",
    "config-suggestions": "suggestions",
    "config-announcements": "announcements"
  };

  if (configMap[command]) {
    const g =
      getGuild(i.guild.id);

    const key =
      configMap[command];

    const data =
      g[key];

    const text =
      Object.entries(data)
        .map(
          ([k, v]) => {
            if (Array.isArray(v))
              return `**${k}:** ${v.length ? v.join(", ") : "None"}`;

            if (typeof v === "object" && v !== null)
              return `**${k}:** ${JSON.stringify(v)}`;

            return `**${k}:** ${v}`;
          }
        )
        .join("\n");

    await i.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle(`⚙️ ${key} Configuration`)
          .setDescription(
            text.slice(0, 3900)
          )
      ],
      ephemeral: true
    });

    return;
  }
}

/* =========================================================
   CLOSE TICKET
========================================================= */

async function closeTicket(i) {
  const g =
    getGuild(i.guild.id);

  const ticket =
    g.ticketsData[i.channelId];

  if (!ticket) {
    await i.reply({
      content: "❌ This is not a ticket.",
      ephemeral: true
    });
    return;
  }

  if (
    !isAdmin(i.member) &&
    i.user.id !== ticket.userId
  ) {
    await i.reply({
      content: "❌ You cannot close this ticket.",
      ephemeral: true
    });
    return;
  }

  await i.reply(
    "🔒 Closing ticket..."
  );

  const transcript =
    await makeTranscript(
      i.channel
    );

  ticket.status = "closed";
  ticket.closedAt = Date.now();

  saveDB();

  const log =
    i.guild.channels.cache.get(
      g.tickets.logChannel
    );

  if (log) {
    await log.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("🎫 Ticket Closed")
          .setDescription(
            `Channel: **${i.channel.name}**\nOwner: <@${ticket.userId}>\nClosed by: ${i.user}`
          )
          .setTimestamp()
      ]
    });

    if (g.tickets.transcript) {
      await log.send({
        files: [
          {
            attachment:
              Buffer.from(transcript),
            name:
              `${i.channel.name}-transcript.txt`
          }
        ]
      }).catch(() => {});
    }
  }

  setTimeout(() => {
    i.channel.delete().catch(() => {});
  }, 2000);
}

/* =========================================================
   READY
========================================================= */

client.once("ready", async () => {
  console.log(
    `Logged in as ${client.user.tag}`
  );

  console.log(
    `Guild: ${GUILD_ID}`
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
        name: "Support • Security • AutoMod",
        type: 3
      }
    ],
    status: "online"
  });
});

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
