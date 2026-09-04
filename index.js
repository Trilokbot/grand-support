const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AuditLogEvent
} = require("discord.js");

const fs = require("fs");
const path = require("path");

/* =========================================================
   AKIYO DISCORD BOT
   Single-file multi-server Discord bot
   discord.js 14
========================================================= */

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || "1542750606739898428";

const OWNER_IDS = new Set(
  (process.env.BOT_OWNER_IDS || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean)
);

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.5";

if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN is missing.");
}

/* =========================================================
   DATABASE
========================================================= */

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "config.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT_GUILD = {
  automod: {
    enabled: true,

    spamLimit: 6,
    spamWindow: 5000,

    repeatedLimit: 3,

    capsPercent: 75,

    badWords: [],

    invite: true,
    massMentions: true,

    userMentionsLimit: 5,
    roleMentionsLimit: 5,

    actions: {
      spam: "timeout",
      invite: "timeout",
      badword: "delete",
      caps: "delete",
      repeat: "timeout",
      massmention: "timeout"
    },

    timeoutSeconds: {
      spam: 60,
      invite: 300,
      badword: 60,
      caps: 30,
      repeat: 120,
      massmention: 300
    },

    logChannelId: null
  },

  security: {
    enabled: true,

    raidJoinCount: 10,
    raidWindow: 10000,

    massBan: 3,
    massKick: 3,

    massChannelDelete: 3,
    massRoleDelete: 3,

    massChannelCreate: 5,
    massRoleCreate: 5,

    massWebhookCreate: 2,

    action: "timeout",

    trustedUsers: [],
    trustedBots: [],
    trustedMembers: [],

    trustedRoleId: null,

    protectedRoles: [],
    protectedChannels: [],

    roleSnapshots: {},
    channelSnapshots: {},

    logChannelId: null
  },

  logs: {},

  ticket: {
    categoryId: null,
    staffRoleId: null,
    logChannelId: null
  },

  suggestionsChannelId: null,

  autorole: {
    enabled: false,
    roleId: null
  },

  welcome: {
    enabled: false,
    channelId: null,
    message: "Welcome {user} to {server}! You are member #{count}."
  },

  verification: {
    enabled: false,
    channelId: null,
    roleId: null,
    messageId: null
  },

  reactionRoles: {},

  leaderboard: {
    enabled: true,
    messages: {}
  },

  ads: {
    enabled: false,
    channelId: null,
    message: "AkiyO announcement.",
    intervalMinutes: 60
  },

  warnings: {},
  punishments: {},
  suggestions: {}
};

const DEFAULT_DB = {
  guilds: {},
  tickets: {},
  dmTickets: {},
  meta: {
    version: 6
  }
};

let db = loadDB();

function clone(object) {
  return JSON.parse(JSON.stringify(object));
}

function merge(target, defaults) {
  for (const [key, value] of Object.entries(defaults)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      if (
        !target[key] ||
        typeof target[key] !== "object" ||
        Array.isArray(target[key])
      ) {
        target[key] = {};
      }

      merge(target[key], value);
    } else if (target[key] === undefined) {
      target[key] = clone(value);
    }
  }

  return target;
}

function loadDB() {
  try {
    if (!fs.existsSync(DB_FILE)) {
      return clone(DEFAULT_DB);
    }

    const data = JSON.parse(
      fs.readFileSync(DB_FILE, "utf8")
    );

    merge(data, DEFAULT_DB);

    return data;
  } catch (error) {
    console.error("Database load error:", error);
    return clone(DEFAULT_DB);
  }
}

let saveTimer;

function save() {
  clearTimeout(saveTimer);

  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(
        DB_FILE,
        JSON.stringify(db, null, 2)
      );
    } catch (error) {
      console.error("Database save error:", error);
    }
  }, 150);
}

function gc(guild) {
  if (!db.guilds[guild.id]) {
    db.guilds[guild.id] = clone(DEFAULT_GUILD);
  }

  merge(db.guilds[guild.id], DEFAULT_GUILD);

  return db.guilds[guild.id];
}

/* =========================================================
   HELPERS
========================================================= */

function guildOnly(interaction) {
  if (!interaction.guild) {
    interaction.reply({
      content: "❌ This command can only be used inside a server.",
      ephemeral: true
    }).catch(() => {});

    return false;
  }

  return true;
}

function isAdmin(interaction) {
  return (
    interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    ) ||
    interaction.memberPermissions?.has(
      PermissionFlagsBits.ManageGuild
    )
  );
}

function isOwner(interaction) {
  return OWNER_IDS.has(interaction.user.id);
}

function isStaff(interaction) {
  if (!interaction.guild) return false;

  const config = gc(interaction.guild);

  if (
    interaction.memberPermissions?.has(
      PermissionFlagsBits.Administrator
    )
  ) {
    return true;
  }

  return Boolean(
    config.ticket.staffRoleId &&
    interaction.member?.roles?.cache?.has(
      config.ticket.staffRoleId
    )
  );
}

function mention(id) {
  return id ? `<@${id}>` : "Not configured";
}

function safeName(name) {
  return (
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .slice(0, 70) || "ticket"
  );
}

function parseDuration(input) {
  const match = String(input || "")
    .trim()
    .match(/^(\d+)\s*(s|m|h|d)$/i);

  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();

  const ms =
    amount *
    (
      unit === "s"
        ? 1000
        : unit === "m"
          ? 60000
          : unit === "h"
            ? 3600000
            : 86400000
    );

  if (ms <= 0 || ms > 28 * 86400000) {
    return null;
  }

  return ms;
}

function emojiKey(raw) {
  const value = String(raw || "").trim();

  const custom = value.match(
    /^<a?:[^:>]+:(\d+)>$/
  );

  return custom ? custom[1] : value;
}

function getLogChannel(guild, type) {
  const config = gc(guild);

  return (
    config.logs[type] ||
    config.logs.all ||
    config.automod.logChannelId ||
    config.security.logChannelId ||
    config.ticket.logChannelId
  );
}

/* =========================================================
   LOGGING
========================================================= */

async function sendLog(guild, type, title, fields = {}) {
  try {
    const channelId = getLogChannel(guild, type);

    if (!channelId) return;

    const channel = await guild.channels
      .fetch(channelId)
      .catch(() => null);

    if (!channel?.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setColor(0x5865f2)
      .setTimestamp();

    for (const [name, value] of Object.entries(fields)) {
      let text = String(value ?? "None");

      if (text.length > 1000) {
        text = text.slice(0, 997) + "...";
      }

      embed.addFields({
        name,
        value: text,
        inline: true
      });
    }

    await channel.send({
      embeds: [embed]
    });
  } catch (error) {
    console.error("Log error:", error.message);
  }
}

/* =========================================================
   TRUST / SECURITY
========================================================= */

function isTrusted(guild, member) {
  if (!member) return false;

  const config = gc(guild);

  if (member.id === guild.ownerId) {
    return true;
  }

  if (config.security.trustedUsers.includes(member.id)) {
    return true;
  }

  if (config.security.trustedMembers.includes(member.id)) {
    return true;
  }

  if (
    config.security.trustedRoleId &&
    member.roles.cache.has(config.security.trustedRoleId)
  ) {
    return true;
  }

  return false;
}

/* =========================================================
   MODERATION ACTION
========================================================= */

async function moderationAction(
  guild,
  member,
  type,
  reason
) {
  try {
    if (!member) return false;

    const config = gc(guild);

    const action =
      config.automod.actions[type] || "timeout";

    const seconds =
      Number(
        config.automod.timeoutSeconds[type] || 60
      );

    if (action === "timeout") {
      if (!member.moderatable) return false;

      await member.timeout(
        Math.min(
          seconds * 1000,
          28 * 86400000
        ),
        reason
      );
    }

    else if (action === "kick") {
      if (!member.kickable) return false;

      await member.kick(reason);
    }

    else if (action === "ban") {
      if (!member.bannable) return false;

      await member.ban({
        reason
      });
    }

    else if (action === "warn") {
      const warnings =
        db.guilds[guild.id].warnings[
          member.id
        ] || [];

      warnings.push({
        at: Date.now(),
        reason,
        by: "AutoMod"
      });

      db.guilds[guild.id].warnings[
        member.id
      ] = warnings;

      save();
    }

    return true;
  } catch (error) {
    console.error(
      "Moderation action:",
      error.message
    );

    return false;
  }
}

/* =========================================================
   AUTOMOD
========================================================= */

const spamTracker = new Map();
const repeatTracker = new Map();

async function processAutoMod(message) {
  if (!message.guild) return;
  if (message.author.bot) return;
  if (!message.content) return;

  const guild = message.guild;
  const config = gc(guild);
  const member = message.member;

  if (!config.automod.enabled) return;

  if (isTrusted(guild, member)) return;

  const text = message.content;
  const lower = text.toLowerCase();

  let type = null;
  let reason = null;

  /* INVITE */
  if (
    config.automod.invite &&
    /(discord\.gg\/|discord(?:app)?\.com\/invite\/)/i.test(text)
  ) {
    type = "invite";
    reason = "Discord invite link";
  }

  /* BAD WORD */
  if (!type) {
    const words = config.automod.badWords || [];

    if (
      words.some(word =>
        word &&
        lower.includes(
          String(word).toLowerCase()
        )
      )
    ) {
      type = "badword";
      reason = "Blocked word";
    }
  }

  /* MASS MENTION */
  const userMentions =
    message.mentions?.users?.size || 0;

  const roleMentions =
    message.mentions?.roles?.size || 0;

  if (
    !type &&
    config.automod.massMentions &&
    (
      message.mentions.everyone ||
      userMentions >
        config.automod.userMentionsLimit ||
      roleMentions >
        config.automod.roleMentionsLimit
    )
  ) {
    type = "massmention";
    reason = "Mass mention";
  }

  /* CAPS */
  const letters =
    text.replace(/[^A-Za-z]/g, "");

  const uppercase =
    letters.replace(/[^A-Z]/g, "").length;

  const capsPercent =
    letters.length
      ? uppercase / letters.length * 100
      : 0;

  if (
    !type &&
    letters.length >= 8 &&
    capsPercent >= config.automod.capsPercent
  ) {
    type = "caps";
    reason = "Excessive capital letters";
  }

  /* SPAM */
  const key =
    guild.id + ":" + message.author.id;

  const now = Date.now();

  let spam =
    spamTracker.get(key) || [];

  spam = spam.filter(
    time =>
      now - time <
      config.automod.spamWindow
  );

  spam.push(now);

  spamTracker.set(key, spam);

  if (
    !type &&
    spam.length >= config.automod.spamLimit
  ) {
    type = "spam";
    reason = "Spam/flood";

    spamTracker.set(key, []);
  }

  /* REPEATED MESSAGE */
  let repeats =
    repeatTracker.get(key) || [];

  repeats = repeats.filter(
    item =>
      now - item.time <
      config.automod.spamWindow
  );

  repeats.push({
    time: now,
    content: lower
  });

  repeatTracker.set(key, repeats);

  const same =
    repeats.filter(
      item => item.content === lower
    ).length;

  if (
    !type &&
    same >= config.automod.repeatedLimit
  ) {
    type = "repeat";
    reason = "Repeated message";

    repeatTracker.set(key, []);
  }

  if (!type) return;

  await message.delete().catch(() => {});

  await moderationAction(
    guild,
    member,
    type,
    reason
  );

  await sendLog(
    guild,
    "automod",
    "AutoMod Action",
    {
      User: message.author.tag,
      Type: type,
      Reason: reason,
      Channel: message.channel.name
    }
  );
}

/* =========================================================
   SECURITY COUNTERS
========================================================= */

const securityCounters = new Map();

function increaseSecurityCounter(
  guild,
  key,
  window
) {
  const counterKey =
    `${guild.id}:${key}`;

  const now = Date.now();

  let values =
    securityCounters.get(counterKey) || [];

  values = values.filter(
    time => now - time < window
  );

  values.push(now);

  securityCounters.set(
    counterKey,
    values
  );

  return values.length;
}

/* =========================================================
   SECURITY / ANTI NUKE
========================================================= */

async function processAuditLog(
  entry,
  guild
) {
  const config = gc(guild);

  if (!config.security.enabled) return;

  const executor =
    entry.executorId
      ? await guild.members
          .fetch(entry.executorId)
          .catch(() => null)
      : null;

  if (executor && isTrusted(guild, executor)) {
    return;
  }

  let counter = null;
  let limit = 0;

  switch (entry.action) {
    case AuditLogEvent.MemberBanAdd:
      counter = "ban";
      limit = config.security.massBan;
      break;

    case AuditLogEvent.MemberKick:
      counter = "kick";
      limit = config.security.massKick;
      break;

    case AuditLogEvent.ChannelDelete:
      counter = "channel-delete";
      limit =
        config.security.massChannelDelete;
      break;

    case AuditLogEvent.RoleDelete:
      counter = "role-delete";
      limit =
        config.security.massRoleDelete;
      break;

    case AuditLogEvent.ChannelCreate:
      counter = "channel-create";
      limit =
        config.security.massChannelCreate;
      break;

    case AuditLogEvent.RoleCreate:
      counter = "role-create";
      limit =
        config.security.massRoleCreate;
      break;

    default:
      return;
  }

  const count =
    increaseSecurityCounter(
      guild,
      counter,
      10000
    );

  await sendLog(
    guild,
    "security",
    "Security Audit",
    {
      Action: String(entry.action),
      Executor:
        executor?.user?.tag ||
        entry.executorId ||
        "Unknown",
      Count: count
    }
  );

  if (count < limit) return;

  if (!executor) return;

  try {
    if (
      config.security.action === "timeout" &&
      executor.moderatable
    ) {
      await executor.timeout(
        10 * 60 * 1000,
        "AkiyO Anti-Nuke"
      );
    }

    else if (
      config.security.action === "kick" &&
      executor.kickable
    ) {
      await executor.kick(
        "AkiyO Anti-Nuke"
      );
    }

    else if (
      config.security.action === "ban" &&
      executor.bannable
    ) {
      await executor.ban({
        reason: "AkiyO Anti-Nuke"
      });
    }
  } catch (error) {
    console.error(
      "Anti-nuke action:",
      error.message
    );
  }
}

/* =========================================================
   SLASH COMMANDS
========================================================= */

const commands = [];

function addCommand(command) {
  commands.push(command);
}

/* HELP */
addCommand(
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show AkiyO commands")
);

/* BOT INFO */
addCommand(
  new SlashCommandBuilder()
    .setName("botinfo")
    .setDescription("Show bot information")
);

/* AI */
addCommand(
  new SlashCommandBuilder()
    .setName("ai")
    .setDescription("AI assistant")
    .addSubcommand(sub =>
      sub
        .setName("ask")
        .setDescription("Ask the AI")
        .addStringOption(option =>
          option
            .setName("prompt")
            .setDescription("Your prompt")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("reset")
        .setDescription(
          "Reset your AI conversation"
        )
    )
);

/* MODERATION */

addCommand(
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Member")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("Reason")
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a member")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Member")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("duration")
        .setDescription(
          "30s, 10m, 2h, 1d"
        )
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("Reason")
    )
);

for (const name of [
  "kick",
  "ban"
]) {
  addCommand(
    new SlashCommandBuilder()
      .setName(name)
      .setDescription(
        `${name} a member`
      )
      .addUserOption(option =>
        option
          .setName("user")
          .setDescription("Member")
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName("reason")
          .setDescription("Reason")
      )
  );
}

addCommand(
  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unban a user")
    .addStringOption(option =>
      option
        .setName("user_id")
        .setDescription("User ID")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("Reason")
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("View warnings")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Member")
        .setRequired(true)
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName("punishments")
    .setDescription(
      "View punishment history"
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Member")
        .setRequired(true)
    )
);

/* =========================================================
   AUTOMOD COMMAND
========================================================= */

addCommand(
  new SlashCommandBuilder()
    .setName("automod")
    .setDescription("Configure AutoMod")
    .addSubcommand(sub =>
      sub
        .setName("enable")
        .setDescription("Enable AutoMod")
    )
    .addSubcommand(sub =>
      sub
        .setName("disable")
        .setDescription("Disable AutoMod")
    )
    .addSubcommand(sub =>
      sub
        .setName("status")
        .setDescription("AutoMod status")
    )
    .addSubcommand(sub =>
      sub
        .setName("badword")
        .setDescription("Add bad word")
        .addStringOption(option =>
          option
            .setName("word")
            .setDescription("Word")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("removebadword")
        .setDescription("Remove bad word")
        .addStringOption(option =>
          option
            .setName("word")
            .setDescription("Word")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("log")
        .setDescription(
          "Set AutoMod log channel"
        )
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription("Channel")
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
    )
);

/* =========================================================
   SECURITY COMMAND
========================================================= */

addCommand(
  new SlashCommandBuilder()
    .setName("security")
    .setDescription("Configure security")
    .addSubcommand(sub =>
      sub
        .setName("enable")
        .setDescription("Enable security")
    )
    .addSubcommand(sub =>
      sub
        .setName("disable")
        .setDescription("Disable security")
    )
    .addSubcommand(sub =>
      sub
        .setName("status")
        .setDescription("Security status")
    )
    .addSubcommand(sub =>
      sub
        .setName("action")
        .setDescription("Set security action")
        .addStringOption(option =>
          option
            .setName("action")
            .setDescription("Action")
            .setRequired(true)
            .addChoices(
              {
                name: "Timeout",
                value: "timeout"
              },
              {
                name: "Kick",
                value: "kick"
              },
              {
                name: "Ban",
                value: "ban"
              }
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("trusted")
        .setDescription("Trust a user")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("User")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("untrusted")
        .setDescription("Untrust a user")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("User")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("trustedrole")
        .setDescription("Set trusted role")
        .addRoleOption(option =>
          option
            .setName("role")
            .setDescription("Role")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("trustedmember")
        .setDescription("Trust member")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("User")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("untrustedmember")
        .setDescription("Untrust member")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("User")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("trustedbot")
        .setDescription("Trust bot")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("Bot")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("untrustedbot")
        .setDescription("Untrust bot")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("Bot")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("protectedrole")
        .setDescription("Protect role")
        .addRoleOption(option =>
          option
            .setName("role")
            .setDescription("Role")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("unprotectedrole")
        .setDescription(
          "Unprotect role"
        )
        .addRoleOption(option =>
          option
            .setName("role")
            .setDescription("Role")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("protectedchannel")
        .setDescription(
          "Protect channel"
        )
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription("Channel")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("unprotectedchannel")
        .setDescription(
          "Unprotect channel"
        )
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription("Channel")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("list")
        .setDescription(
          "List security settings"
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("log")
        .setDescription(
          "Set security log"
        )
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription("Channel")
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
    )
);

/* =========================================================
   CONFIG
========================================================= */

addCommand(
  new SlashCommandBuilder()
    .setName("config")
    .setDescription("Server configuration")
    .addSubcommand(sub =>
      sub
        .setName("view")
        .setDescription("View configuration")
    )
    .addSubcommand(sub =>
      sub
        .setName("log")
        .setDescription("Set log channel")
        .addStringOption(option =>
          option
            .setName("type")
            .setDescription("Log type")
            .setRequired(true)
        )
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription("Channel")
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("staffrole")
        .setDescription("Set staff role")
        .addRoleOption(option =>
          option
            .setName("role")
            .setDescription("Role")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("ticketcategory")
        .setDescription(
          "Set ticket category"
        )
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription("Category")
            .addChannelTypes(
              ChannelType.GuildCategory
            )
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("suggestions")
        .setDescription(
          "Set suggestions channel"
        )
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription("Channel")
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
    )
);

/* =========================================================
   TICKETS
========================================================= */

addCommand(
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription(
      "Create a support ticket"
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription(
      "Send ticket panel"
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName("ticketsetup")
    .setDescription(
      "Ticket setup information"
    )
);

for (const name of [
  "close",
  "reopen",
  "delete",
  "claim",
  "unclaim",
  "lock",
  "unlock",
  "transcript",
  "ticketstats",
  "ticketinfo"
]) {
  addCommand(
    new SlashCommandBuilder()
      .setName(name)
      .setDescription(
        `Ticket ${name}`
      )
  );
}

addCommand(
  new SlashCommandBuilder()
    .setName("ticketadd")
    .setDescription(
      "Add member to ticket"
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User")
        .setRequired(true)
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName("ticketremove")
    .setDescription(
      "Remove member from ticket"
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("User")
        .setRequired(true)
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName("ticketrename")
    .setDescription(
      "Rename ticket"
    )
    .addStringOption(option =>
      option
        .setName("name")
        .setDescription("Name")
        .setRequired(true)
    )
);

/* =========================================================
   SUGGESTIONS
========================================================= */

addCommand(
  new SlashCommandBuilder()
    .setName("suggest")
    .setDescription(
      "Create a suggestion"
    )
    .addStringOption(option =>
      option
        .setName("text")
        .setDescription("Suggestion")
        .setRequired(true)
    )
);

/* =========================================================
   ANNOUNCEMENTS
========================================================= */

addCommand(
  new SlashCommandBuilder()
    .setName("announce")
    .setDescription(
      "Send announcement"
    )
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Channel")
        .addChannelTypes(
          ChannelType.GuildText
        )
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("message")
        .setDescription("Message")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("title")
        .setDescription("Embed title")
    )
    .addStringOption(option =>
      option
        .setName("footer")
        .setDescription("Footer")
    )
    .addBooleanOption(option =>
      option
        .setName("embed")
        .setDescription("Use embed")
    )
    .addBooleanOption(option =>
      option
        .setName("everyone")
        .setDescription(
          "Mention everyone"
        )
    )
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription("Mention role")
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Mention user")
    )
);

/* =========================================================
   AUTOROLE
========================================================= */

addCommand(
  new SlashCommandBuilder()
    .setName("autorole")
    .setDescription("Auto role")
    .addSubcommand(sub =>
      sub
        .setName("set")
        .setDescription("Set role")
        .addRoleOption(option =>
          option
            .setName("role")
            .setDescription("Role")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("disable")
        .setDescription("Disable")
    )
    .addSubcommand(sub =>
      sub
        .setName("status")
        .setDescription("Status")
    )
);

/* =========================================================
   WELCOME
========================================================= */

addCommand(
  new SlashCommandBuilder()
    .setName("welcome")
    .setDescription("Welcome system")
    .addSubcommand(sub =>
      sub
        .setName("set")
        .setDescription("Configure")
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription("Channel")
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("message")
            .setDescription(
              "Welcome message"
            )
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("disable")
        .setDescription("Disable")
    )
    .addSubcommand(sub =>
      sub
        .setName("status")
        .setDescription("Status")
    )
);

/* =========================================================
   VERIFICATION
========================================================= */

addCommand(
  new SlashCommandBuilder()
    .setName("verification")
    .setDescription(
      "Verification system"
    )
    .addSubcommand(sub =>
      sub
        .setName("setup")
        .setDescription("Setup")
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription("Channel")
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName("role")
            .setDescription("Verified role")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("disable")
        .setDescription("Disable")
    )
    .addSubcommand(sub =>
      sub
        .setName("status")
        .setDescription("Status")
    )
);

/* =========================================================
   REACTION ROLES
========================================================= */

addCommand(
  new SlashCommandBuilder()
    .setName("autoreactionrole")
    .setDescription(
      "Reaction role system"
    )
    .addSubcommand(sub =>
      sub
        .setName("add")
        .setDescription("Add reaction role")
        .addStringOption(option =>
          option
            .setName("message_id")
            .setDescription("Message ID")
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("emoji")
            .setDescription(
              "Unicode or custom emoji"
            )
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName("role")
            .setDescription("Role")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("remove")
        .setDescription(
          "Remove reaction role"
        )
        .addStringOption(option =>
          option
            .setName("message_id")
            .setDescription("Message ID")
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("emoji")
            .setDescription("Emoji")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("list")
        .setDescription(
          "List reaction roles"
        )
    )
);

/* =========================================================
   LEADERBOARD
========================================================= */

addCommand(
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription(
      "Message leaderboard"
    )
    .addSubcommand(sub =>
      sub
        .setName("top")
        .setDescription("Top members")
    )
    .addSubcommand(sub =>
      sub
        .setName("reset")
        .setDescription("Reset")
    )
    .addSubcommand(sub =>
      sub
        .setName("enable")
        .setDescription("Enable")
    )
    .addSubcommand(sub =>
      sub
        .setName("disable")
        .setDescription("Disable")
    )
    .addSubcommand(sub =>
      sub
        .setName("status")
        .setDescription("Status")
    )
);

/* =========================================================
   ADS
========================================================= */

addCommand(
  new SlashCommandBuilder()
    .setName("ads")
    .setDescription(
      "Owner advertisement system"
    )
    .addSubcommand(sub =>
      sub
        .setName("set")
        .setDescription(
          "Set advertisement channel"
        )
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription("Channel")
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("message")
        .setDescription(
          "Set advertisement message"
        )
        .addStringOption(option =>
          option
            .setName("message")
            .setDescription("Message")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("interval")
        .setDescription(
          "Set advertisement interval"
        )
        .addIntegerOption(option =>
          option
            .setName("minutes")
            .setDescription("Minutes")
            .setRequired(true)
            .setMinValue(1)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("enable")
        .setDescription("Enable")
    )
    .addSubcommand(sub =>
      sub
        .setName("disable")
        .setDescription("Disable")
    )
    .addSubcommand(sub =>
      sub
        .setName("status")
        .setDescription("Status")
    )
    .addSubcommand(sub =>
      sub
        .setName("broadcast")
        .setDescription(
          "Broadcast now"
        )
    )
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
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildWebhooks
  ],

  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User,
    Partials.Reaction
  ]
});

/* =========================================================
   AI
========================================================= */

const aiHistory = new Map();

async function askAI(userId, prompt) {
  if (!OPENAI_KEY) {
    throw new Error(
      "OPENAI_API_KEY is not configured."
    );
  }

  let history =
    aiHistory.get(userId) || [];

  history.push({
    role: "user",
    content: prompt
  });

  history = history.slice(-10);

  const response = await fetch(
    "https://api.openai.com/v1/responses",
    {
      method: "POST",

      headers: {
        Authorization:
          `Bearer ${OPENAI_KEY}`,

        "Content-Type":
          "application/json"
      },

      body: JSON.stringify({
        model: OPENAI_MODEL,

        input: history.map(item => ({
          role: item.role,
          content: [
            {
              type: "input_text",
              text: item.content
            }
          ]
        }))
      })
    }
  );

  const data =
    await response.json();

  if (!response.ok) {
    throw new Error(
      data.error?.message ||
      `OpenAI error ${response.status}`
    );
  }

  const output =
    data.output_text ||
    data.output
      ?.flatMap(item =>
        item.content || []
      )
      .map(item =>
        item.text || ""
      )
      .join("") ||
    "No response.";

  history.push({
    role: "assistant",
    content: output
  });

  aiHistory.set(
    userId,
    history.slice(-10)
  );

  return output;
}

/* =========================================================
   TICKET SYSTEM
========================================================= */

async function getTicket(channel) {
  if (!channel?.id) return null;

  return db.tickets[channel.id] || null;
}

async function createTicket(
  guild,
  user,
  source = "command"
) {
  const config = gc(guild);

  for (const ticket of Object.values(
    db.tickets
  )) {
    if (
      ticket.guildId === guild.id &&
      ticket.userId === user.id &&
      !ticket.closed
    ) {
      return ticket;
    }
  }

  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [
        PermissionFlagsBits.ViewChannel
      ]
    },

    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ]
    }
  ];

  if (config.ticket.staffRoleId) {
    permissionOverwrites.push({
      id: config.ticket.staffRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ]
    });
  }

  const channel =
    await guild.channels.create({
      name:
        `ticket-${safeName(
          user.username
        )}`,

      type: ChannelType.GuildText,

      parent:
        config.ticket.categoryId ||
        undefined,

      permissionOverwrites
    });

  db.tickets[channel.id] = {
    guildId: guild.id,
    userId: user.id,
    channelId: channel.id,
    createdAt: Date.now(),
    closed: false,
    locked: false,
    claimedBy: null
  };

  save();

  const buttons =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            "ticket_claim"
          )
          .setLabel("Claim")
          .setStyle(
            ButtonStyle.Primary
          ),

        new ButtonBuilder()
          .setCustomId(
            "ticket_close"
          )
          .setLabel("Close")
          .setStyle(
            ButtonStyle.Danger
          ),

        new ButtonBuilder()
          .setCustomId(
            "ticket_lock"
          )
          .setLabel("Lock")
          .setStyle(
            ButtonStyle.Secondary
          ),

        new ButtonBuilder()
          .setCustomId(
            "ticket_transcript"
          )
          .setLabel("Transcript")
          .setStyle(
            ButtonStyle.Success
          )
      );

  await channel.send({
    content: `<@${user.id}>`,

    embeds: [
      new EmbedBuilder()
        .setTitle(
          "AkiyO Support Ticket"
        )
        .setDescription(
          "Please describe your issue. Staff will assist you shortly."
        )
        .setColor(0x5865f2)
    ],

    components: [buttons]
  });

  await sendLog(
    guild,
    "tickets",
    "Ticket Created",
    {
      User: user.tag,
      Channel: channel.id,
      Source: source
    }
  );

  return db.tickets[channel.id];
}

async function makeTranscript(channel) {
  const messages = [];

  let before;

  for (let page = 0; page < 20; page++) {
    const fetched =
      await channel.messages
        .fetch({
          limit: 100,
          before
        })
        .catch(() => null);

    if (
      !fetched ||
      !fetched.size
    ) {
      break;
    }

    for (const message of fetched.values()) {
      messages.push(
        `[${new Date(
          message.createdTimestamp
        ).toISOString()}] ${message.author.tag}: ${
          message.content ||
          "[embed/attachment]"
        }`
      );
    }

    before =
      fetched.last().id;

    if (fetched.size < 100) {
      break;
    }
  }

  return messages
    .reverse()
    .join("\n");
}

async function handleTicketAction(
  interaction,
  action
) {
  const ticket =
    await getTicket(
      interaction.channel
    );

  if (!ticket) {
    return interaction.reply({
      content:
        "❌ This is not a ticket.",
      ephemeral: true
    });
  }

  if (
    !isStaff(interaction) &&
    ![
      "close",
      "transcript"
    ].includes(action) &&
    interaction.user.id !==
      ticket.userId
  ) {
    return interaction.reply({
      content:
        "❌ Staff only.",
      ephemeral: true
    });
  }

  const channel =
    interaction.channel;

  if (action === "claim") {
    ticket.claimedBy =
      interaction.user.id;

    save();

    await channel.send(
      `✅ Claimed by <@${interaction.user.id}>.`
    );

    return interaction.reply({
      content: "Ticket claimed.",
      ephemeral: true
    });
  }

  if (action === "unclaim") {
    ticket.claimedBy = null;

    save();

    return interaction.reply(
      "✅ Ticket unclaimed."
    );
  }

  if (action === "lock") {
    ticket.locked = true;

    await channel.permissionOverwrites
      .edit(
        ticket.userId,
        {
          SendMessages: false
        }
      );

    save();

    return interaction.reply(
      "🔒 Ticket locked."
    );
  }

  if (action === "unlock") {
    ticket.locked = false;

    await channel.permissionOverwrites
      .edit(
        ticket.userId,
        {
          SendMessages: true
        }
      );

    save();

    return interaction.reply(
      "🔓 Ticket unlocked."
    );
  }

  if (action === "close") {
    ticket.closed = true;

    await channel.permissionOverwrites
      .edit(
        ticket.userId,
        {
          SendMessages: false
        }
      );

    await channel
      .setName(
        `closed-${channel.name.replace(
          /^closed-/,
          ""
        )}`
      )
      .catch(() => {});

    save();

    await sendLog(
      channel.guild,
      "tickets",
      "Ticket Closed",
      {
        Channel: channel.id,
        By: interaction.user.tag
      }
    );

    return interaction.reply(
      "🔒 Ticket closed."
    );
  }

  if (action === "reopen") {
    ticket.closed = false;

    await channel.permissionOverwrites
      .edit(
        ticket.userId,
        {
          SendMessages: true
        }
      );

    await channel
      .setName(
        channel.name.replace(
          /^closed-/,
          "ticket-"
        )
      )
      .catch(() => {});

    save();

    return interaction.reply(
      "🔓 Ticket reopened."
    );
  }

  if (action === "delete") {
    await sendLog(
      channel.guild,
      "tickets",
      "Ticket Deleted",
      {
        Channel: channel.id,
        By: interaction.user.tag
      }
    );

    delete db.tickets[
      channel.id
    ];

    save();

    return channel
      .delete()
      .catch(() => {});
  }

  if (action === "transcript") {
    const text =
      await makeTranscript(
        channel
      );

    const config =
      gc(channel.guild);

    const logId =
      config.ticket.logChannelId ||
      getLogChannel(
        channel.guild,
        "tickets"
      );

    if (logId) {
      const logChannel =
        await channel.guild.channels
          .fetch(logId)
          .catch(() => null);

      if (
        logChannel?.isTextBased()
      ) {
        await logChannel.send({
          content:
            `Transcript: ${channel.name}`,

          files: [
            {
              attachment:
                Buffer.from(
                  text ||
                  "No messages."
                ),

              name:
                `${channel.name}.txt`
            }
          ]
        });
      }
    }

    return interaction.reply({
      content:
        "📄 Transcript generated.",
      ephemeral: true
    });
  }
}

/* =========================================================
   READY
========================================================= */

client.once(
  "ready",
  async () => {
    console.log(
      `✅ AkiyO online as ${client.user.tag}`
    );

    const rest =
      new REST({
        version: "10"
      }).setToken(TOKEN);

    try {
      await rest.put(
        Routes.applicationCommands(
          CLIENT_ID
        ),
        {
          body: commands.map(
            command =>
              command.toJSON()
          )
        }
      );

      console.log(
        `✅ Registered ${commands.length} global commands.`
      );
    } catch (error) {
      console.error(
        "Command registration error:",
        error
      );
    }
  }
);

/* =========================================================
   MESSAGE SYSTEM
========================================================= */

client.on(
  "messageCreate",
  async message => {
    if (message.author.bot) {
      return;
    }

    /* SERVER MESSAGE */

    if (message.guild) {
      const config =
        gc(message.guild);

      /* LEADERBOARD */

      if (
        config.leaderboard.enabled
      ) {
        config.leaderboard.messages[
          message.author.id
        ] =
          (
            config.leaderboard.messages[
              message.author.id
            ] || 0
          ) + 1;

        save();
      }

      /* AUTOMOD */

      await processAutoMod(
        message
      );

      /* TICKET STAFF → USER DM */

      const ticket =
        db.tickets[
          message.channel.id
        ];

      if (
        ticket &&
        message.author.id !==
          ticket.userId &&
        message.channel.isTextBased()
      ) {
        const user =
          await client.users
            .fetch(ticket.userId)
            .catch(() => null);

        if (user) {
          await user
            .send(
              `💬 **Staff reply in ${message.guild.name}:**\n${
                message.content ||
                "[attachment/embed]"
              }`
            )
            .catch(() => {});
        }
      }

      return;
    }

    /* DM → TICKET */

    for (
      const ticket of Object.values(
        db.tickets
      )
    ) {
      if (
        ticket.userId ===
          message.author.id &&
        !ticket.closed
      ) {
        const channel =
          await client.channels
            .fetch(
              ticket.channelId
            )
            .catch(() => null);

        if (
          channel?.isTextBased()
        ) {
          await channel.send(
            `💬 **User DM:**\n${
              message.content ||
              "[attachment]"
            }`
          ).catch(() => {});
        }

        break;
      }
    }
  }
);

/* =========================================================
   MEMBER JOIN
========================================================= */

const raidTracker = new Map();

client.on(
  "guildMemberAdd",
  async member => {
    const guild =
      member.guild;

    const config =
      gc(guild);

    /* AUTOROLE */

    if (
      config.autorole.enabled &&
      config.autorole.roleId
    ) {
      const role =
        guild.roles.cache.get(
          config.autorole.roleId
        );

      const me =
        guild.members.me;

      if (
        role &&
        me &&
        role.position <
          me.roles.highest.position
      ) {
        await member.roles
          .add(
            role,
            "AkiyO AutoRole"
          )
          .catch(() => {});
      }
    }

    /* WELCOME */

    if (
      config.welcome.enabled &&
      config.welcome.channelId
    ) {
      const channel =
        guild.channels.cache.get(
          config.welcome.channelId
        );

      if (
        channel?.isTextBased()
      ) {
        const text =
          config.welcome.message
            .replaceAll(
              "{user}",
              `<@${member.id}>`
            )
            .replaceAll(
              "{username}",
              member.user.username
            )
            .replaceAll(
              "{server}",
              guild.name
            )
            .replaceAll(
              "{count}",
              String(
                guild.memberCount
              )
            );

        await channel
          .send(text)
          .catch(() => {});
      }
    }

    /* ANTI RAID */

    const now =
      Date.now();

    let joins =
      raidTracker.get(
        guild.id
      ) || [];

    joins.push(now);

    joins =
      joins.filter(
        time =>
          now - time <
          config.security.raidWindow
      );

    raidTracker.set(
      guild.id,
      joins
    );

    if (
      joins.length >=
      config.security.raidJoinCount
    ) {
      await sendLog(
        guild,
        "security",
        "Possible Raid Detected",
        {
          Joins: joins.length,
          Window:
            `${config.security.raidWindow}ms`
        }
      );
    }
  }
);

/* =========================================================
   REACTION ROLES
========================================================= */

client.on(
  "messageReactionAdd",
  async (reaction, user) => {
    if (user.bot) return;

    try {
      if (reaction.partial) {
        await reaction.fetch();
      }

      if (
        reaction.message.partial
      ) {
        await reaction.message.fetch();
      }

      const guild =
        reaction.message.guild;

      if (!guild) return;

      const config =
        gc(guild);

      const mappings =
        config.reactionRoles?.[
          reaction.message.id
        ];

      const key =
        reaction.emoji.id ||
        reaction.emoji.name;

      if (
        !mappings ||
        !mappings[key]
      ) {
        return;
      }

      const role =
        await guild.roles
          .fetch(
            mappings[key].roleId
          )
          .catch(() => null);

      const me =
        guild.members.me;

      if (
        !role ||
        !me?.permissions.has(
          PermissionFlagsBits.ManageRoles
        ) ||
        role.position >=
          me.roles.highest.position
      ) {
        await sendLog(
          guild,
          "reactionRoles",
          "Reaction Role Failed",
          {
            Message:
              reaction.message.id,
            Emoji: key,
            Role:
              mappings[key].roleId,
            Reason:
              "Permission or role hierarchy"
          }
        );

        return;
      }

      const member =
        await guild.members
          .fetch(user.id)
          .catch(() => null);

      if (member) {
        await member.roles.add(
          role,
          "AkiyO Reaction Role"
        );
      }
    } catch (error) {
      console.error(
        "Reaction role add:",
        error.message
      );
    }
  }
);

client.on(
  "messageReactionRemove",
  async (reaction, user) => {
    if (user.bot) return;

    try {
      if (reaction.partial) {
        await reaction.fetch();
      }

      if (
        reaction.message.partial
      ) {
        await reaction.message.fetch();
      }

      const guild =
        reaction.message.guild;

      if (!guild) return;

      const config =
        gc(guild);

      const mappings =
        config.reactionRoles?.[
          reaction.message.id
        ];

      const key =
        reaction.emoji.id ||
        reaction.emoji.name;

      if (
        !mappings ||
        !mappings[key]
      ) {
        return;
      }

      const role =
        await guild.roles
          .fetch(
            mappings[key].roleId
          )
          .catch(() => null);

      const member =
        await guild.members
          .fetch(user.id)
          .catch(() => null);

      const me =
        guild.members.me;

      if (
        role &&
        member &&
        me?.permissions.has(
          PermissionFlagsBits.ManageRoles
        ) &&
        role.position <
          me.roles.highest.position
      ) {
        await member.roles.remove(
          role,
          "AkiyO Reaction Role"
        );
      }
    } catch (error) {
      console.error(
        "Reaction role remove:",
        error.message
      );
    }
  }
);

/* =========================================================
   AUDIT LOG SECURITY
========================================================= */

client.on(
  "guildAuditLogEntryCreate",
  async (entry, guild) => {
    try {
      await processAuditLog(
        entry,
        guild
      );
    } catch (error) {
      console.error(
        "Audit log error:",
        error
      );
    }
  }
);

/* =========================================================
   INTERACTIONS
========================================================= */

client.on(
  "interactionCreate",
  async interaction => {
    /* =====================================================
       BUTTONS
    ===================================================== */

    if (interaction.isButton()) {

      /* VERIFICATION */

      if (
        interaction.customId ===
        "verify"
      ) {
        const config =
          gc(interaction.guild);

        const member =
          await interaction.guild.members
            .fetch(
              interaction.user.id
            )
            .catch(() => null);

        const role =
          config.verification.roleId
            ? await interaction.guild.roles
                .fetch(
                  config.verification.roleId
                )
                .catch(() => null)
            : null;

        if (!member || !role) {
          return interaction.reply({
            content:
              "❌ Verification is not configured correctly.",
            ephemeral: true
          });
        }

        const me =
          interaction.guild.members.me;

        if (
          role.position >=
          me.roles.highest.position
        ) {
          return interaction.reply({
            content:
              "❌ My highest role must be above the verification role.",
            ephemeral: true
          });
        }

        await member.roles.add(
          role,
          "AkiyO Verification"
        );

        return interaction.reply({
          content:
            "✅ You are verified!",
          ephemeral: true
        });
      }

      /* TICKET BUTTONS */

      if (
        interaction.customId.startsWith(
          "ticket_"
        )
      ) {
        const action =
          interaction.customId
            .slice(7);

        return handleTicketAction(
          interaction,
          action
        );
      }

      /* CREATE TICKET BUTTON */

      if (
        interaction.customId ===
        "ticket_create"
      ) {
        const ticket =
          await createTicket(
            interaction.guild,
            interaction.user,
            "button"
          );

        return interaction.reply({
          content:
            `🎫 Ticket: <#${ticket.channelId}>`,
          ephemeral: true
        });
      }

      /* SUGGESTION BUTTONS */

      if (
        interaction.customId.startsWith(
          "suggest_"
        )
      ) {
        const parts =
          interaction.customId
            .split("_");

        const action =
          parts[1];

        const id =
          parts.slice(2).join("_");

        const config =
          gc(interaction.guild);

        const suggestion =
          config.suggestions[id];

        if (!suggestion) {
          return interaction.reply({
            content:
              "❌ Suggestion not found.",
            ephemeral: true
          });
        }

        if (!isAdmin(interaction)) {
          return interaction.reply({
            content:
              "❌ Staff only.",
            ephemeral: true
          });
        }

        suggestion.status =
          action;

        save();

        return interaction.update({
          content:
            `Suggestion **${action}** by ${interaction.user.tag}.`,
          components: []
        });
      }

      return;
    }

    if (
      !interaction.isChatInputCommand()
    ) {
      return;
    }

    const command =
      interaction.commandName;

    /* =====================================================
       HELP
    ===================================================== */

    if (
      command === "help"
    ) {
      return interaction.reply({
        content:
`**🤖 AkiyO Commands**

**🎫 Tickets**
/ticket
/ticketpanel
/ticketsetup
/close
/reopen
/delete
/claim
/unclaim
/lock
/unlock
/transcript
/ticketstats
/ticketinfo
/ticketadd
/ticketremove
/ticketrename

**🛡 Moderation**
/warn
/timeout
/kick
/ban
/unban
/warnings
/punishments

**🤖 AutoMod**
/automod

**🔐 Security**
/security

**⚙️ Configuration**
/config

**💡 Community**
/suggest
/announce
/autorole
/welcome
/verification
/autoreactionrole
/leaderboard

**📢 Owner**
/ads

**🧠 AI**
/ai`,
        ephemeral: true
      });
    }

    /* =====================================================
       BOT INFO
    ===================================================== */

    if (
      command === "botinfo"
    ) {
      return interaction.reply(
`🤖 **AkiyO**

Discord servers: ${client.guilds.cache.size}

Discord.js 14
Multi-server configuration
Persistent JSON database

Support:
https://discord.gg/x9JvgBrgX`
      );
    }

    /* =====================================================
       AI
    ===================================================== */

    if (
      command === "ai"
    ) {
      const subcommand =
        interaction.options
          .getSubcommand();

      if (
        subcommand === "reset"
      ) {
        aiHistory.delete(
          interaction.user.id
        );

        return interaction.reply({
          content:
            "🧠 AI conversation reset.",
          ephemeral: true
        });
      }

      await interaction.deferReply();

      try {
        const result =
          await askAI(
            interaction.user.id,
            interaction.options
              .getString(
                "prompt"
              )
          );

        return interaction.editReply(
          result.slice(0, 1900)
        );
      } catch (error) {
        return interaction.editReply(
          `❌ ${error.message}`
        );
      }
    }

    /* Everything below requires guild */

    if (!guildOnly(interaction)) {
      return;
    }

    const config =
      gc(interaction.guild);

    /* =====================================================
       MODERATION PERMISSION
    ===================================================== */

    if (
      [
        "warn",
        "timeout",
        "kick",
        "ban",
        "unban",
        "announce"
      ].includes(command) &&
      !isAdmin(interaction)
    ) {
      return interaction.reply({
        content:
          "❌ You need Manage Server or Administrator.",
        ephemeral: true
      });
    }

    /* =====================================================
       WARN
    ===================================================== */

    if (
      command === "warn"
    ) {
      const user =
        interaction.options.getUser(
          "user"
        );

      const member =
        await interaction.guild.members
          .fetch(user.id)
          .catch(() => null);

      const reason =
        interaction.options
          .getString("reason") ||
        "No reason provided.";

      if (!member) {
        return interaction.reply(
          "❌ Member not found."
        );
      }

      const warnings =
        config.warnings[user.id] ||
        [];

      warnings.push({
        at: Date.now(),
        reason,
        by: interaction.user.id
      });

      config.warnings[user.id] =
        warnings;

      config.punishments[user.id] ??=
        [];

      config.punishments[
        user.id
      ].push({
        type: "warn",
        at: Date.now(),
        reason,
        by: interaction.user.id
      });

      /* ESCALATION */

      if (
        warnings.length >= 7 &&
        member.bannable
      ) {
        await member.ban({
          reason:
            "AkiyO warning escalation"
        });
      }

      else if (
        warnings.length >= 5 &&
        member.kickable
      ) {
        await member.kick(
          "AkiyO warning escalation"
        );
      }

      else if (
        warnings.length >= 3 &&
        member.moderatable
      ) {
        await member.timeout(
          10 * 60 * 1000,
          "AkiyO warning escalation"
        );
      }

      save();

      await sendLog(
        interaction.guild,
        "moderation",
        "Member Warned",
        {
          User: user.tag,
          Warnings:
            warnings.length,
          Reason: reason
        }
      );

      return interaction.reply(
        `⚠️ ${user.tag} warned.\nWarnings: ${warnings.length}`
      );
    }

    /* =====================================================
       WARNINGS / PUNISHMENTS
    ===================================================== */

    if (
      command === "warnings" ||
      command === "punishments"
    ) {
      const user =
        interaction.options.getUser(
          "user"
        );

      const data =
        config[command][user.id] ||
        [];

      if (!data.length) {
        return interaction.reply({
          content:
            `No ${command} found for ${user.tag}.`,
          ephemeral: true
        });
      }

      const text =
        data
          .slice(-20)
          .map(
            (item, index) =>
              `${index + 1}. ${new Date(
                item.at
              ).toLocaleString()} — ${
                item.reason ||
                item.type
              }`
          )
          .join("\n");

      return interaction.reply({
        content: text.slice(0, 1900),
        ephemeral: true
      });
    }

    /* =====================================================
       TIMEOUT / KICK / BAN
    ===================================================== */

    if (
      [
        "timeout",
        "kick",
        "ban"
      ].includes(command)
    ) {
      const user =
        interaction.options.getUser(
          "user"
        );

      const member =
        await interaction.guild.members
          .fetch(user.id)
          .catch(() => null);

      const reason =
        interaction.options
          .getString("reason") ||
        "No reason provided.";

      if (!member) {
        return interaction.reply(
          "❌ Member not found."
        );
      }

      if (
        command === "timeout"
      ) {
        const duration =
          parseDuration(
            interaction.options
              .getString(
                "duration"
              )
          );

        if (!duration) {
          return interaction.reply(
            "❌ Invalid duration. Use 30s, 10m, 2h or 1d."
          );
        }

        if (!member.moderatable) {
          return interaction.reply(
            "❌ I cannot timeout this member."
          );
        }

        await member.timeout(
          duration,
          reason
        );
      }

      if (
        command === "kick"
      ) {
        if (!member.kickable) {
          return interaction.reply(
            "❌ I cannot kick this member."
          );
        }

        await member.kick(reason);
      }

      if (
        command === "ban"
      ) {
        if (!member.bannable) {
          return interaction.reply(
            "❌ I cannot ban this member."
          );
        }

        await member.ban({
          reason
        });
      }

      config.punishments[
        user.id
      ] ??= [];

      config.punishments[
        user.id
      ].push({
        type: command,
        at: Date.now(),
        reason,
        by: interaction.user.id
      });

      save();

      await sendLog(
        interaction.guild,
        "moderation",
        `Member ${command}`,
        {
          User: user.tag,
          Reason: reason
        }
      );

      return interaction.reply(
        `✅ ${command} completed for ${user.tag}.`
      );
    }

    /* =====================================================
       UNBAN
    ===================================================== */

    if (
      command === "unban"
    ) {
      const userId =
        interaction.options
          .getString(
            "user_id"
          );

      const reason =
        interaction.options
          .getString("reason") ||
        "No reason provided.";

      await interaction.guild.members
        .unban(
          userId,
          reason
        );

      config.punishments[
        userId
      ] ??= [];

      config.punishments[
        userId
      ].push({
        type: "unban",
        at: Date.now(),
        reason,
        by: interaction.user.id
      });

      save();

      return interaction.reply(
        `✅ User ${userId} unbanned.`
      );
    }

    /* =====================================================
       AUTOMOD
    ===================================================== */

    if (
      command === "automod"
    ) {
      if (!isAdmin(interaction)) {
        return interaction.reply({
          content:
            "❌ Staff only.",
          ephemeral: true
        });
      }

      const subcommand =
        interaction.options
          .getSubcommand();

      if (
        subcommand === "enable"
      ) {
        config.automod.enabled =
          true;
      }

      if (
        subcommand === "disable"
      ) {
        config.automod.enabled =
          false;
      }

      if (
        subcommand === "badword"
      ) {
        const word =
          interaction.options
            .getString(
              "word"
            );

        if (
          !config.automod.badWords
            .includes(word)
        ) {
          config.automod.badWords
            .push(word);
        }
      }

      if (
        subcommand ===
        "removebadword"
      ) {
        const word =
          interaction.options
            .getString(
              "word"
            )
            .toLowerCase();

        config.automod.badWords =
          config.automod.badWords
            .filter(
              x =>
                x.toLowerCase() !==
                word
            );
      }

      if (
        subcommand === "log"
      ) {
        config.automod.logChannelId =
          interaction.options
            .getChannel(
              "channel"
            ).id;
      }

      save();

      if (
        subcommand === "status"
      ) {
        return interaction.reply({
          content:
`**AutoMod**

Status: ${
  config.automod.enabled
    ? "ON"
    : "OFF"
}

Bad words: ${
  config.automod.badWords.length
}

Spam limit: ${
  config.automod.spamLimit
}

Spam window: ${
  config.automod.spamWindow
}ms`,
          ephemeral: true
        });
      }

      return interaction.reply(
        "✅ AutoMod configuration updated."
      );
    }

    /* =====================================================
       SECURITY
    ===================================================== */

    if (
      command === "security"
    ) {
      if (!isAdmin(interaction)) {
        return interaction.reply({
          content:
            "❌ Staff only.",
          ephemeral: true
        });
      }

      const subcommand =
        interaction.options
          .getSubcommand();

      const user =
        interaction.options
          .getUser("user");

      const role =
        interaction.options
          .getRole("role");

      const channel =
        interaction.options
          .getChannel("channel");

      if (
        subcommand === "enable"
      ) {
        config.security.enabled =
          true;
      }

      if (
        subcommand === "disable"
      ) {
        config.security.enabled =
          false;
      }

      if (
        subcommand === "action"
      ) {
        config.security.action =
          interaction.options
            .getString(
              "action"
            );
      }

      if (
        subcommand === "trusted" ||
        subcommand ===
          "trustedmember"
      ) {
        if (
          user &&
          !config.security
            .trustedUsers
            .includes(user.id)
        ) {
          config.security
            .trustedUsers
            .push(user.id);
        }
      }

      if (
        subcommand === "untrusted" ||
        subcommand ===
          "untrustedmember"
      ) {
        config.security
          .trustedUsers =
          config.security
            .trustedUsers
            .filter(
              id =>
                id !== user?.id
            );
      }

      if (
        subcommand ===
        "trustedbot"
      ) {
        if (
          user &&
          !config.security
            .trustedBots
            .includes(user.id)
        ) {
          config.security
            .trustedBots
            .push(user.id);
        }
      }

      if (
        subcommand ===
        "untrustedbot"
      ) {
        config.security
          .trustedBots =
          config.security
            .trustedBots
            .filter(
              id =>
                id !== user?.id
            );
      }

      if (
        subcommand ===
        "trustedrole"
      ) {
        config.security
          .trustedRoleId =
          role.id;
      }

      if (
        subcommand ===
        "protectedrole"
      ) {
        if (
          !config.security
            .protectedRoles
            .includes(role.id)
        ) {
          config.security
            .protectedRoles
            .push(role.id);
        }
      }

      if (
        subcommand ===
        "unprotectedrole"
      ) {
        config.security
          .protectedRoles =
          config.security
            .protectedRoles
            .filter(
              id =>
                id !== role?.id
            );
      }

      if (
        subcommand ===
        "protectedchannel"
      ) {
        if (
          !config.security
            .protectedChannels
            .includes(channel.id)
        ) {
          config.security
            .protectedChannels
            .push(channel.id);
        }
      }

      if (
        subcommand ===
        "unprotectedchannel"
      ) {
        config.security
          .protectedChannels =
          config.security
            .protectedChannels
            .filter(
              id =>
                id !== channel?.id
            );
      }

      if (
        subcommand === "log"
      ) {
        config.security
          .logChannelId =
          channel.id;
      }

      save();

      if (
        subcommand === "status"
      ) {
        return interaction.reply({
          content:
`**Security**

Status: ${
  config.security.enabled
    ? "ON"
    : "OFF"
}

Action: ${
  config.security.action
}

Trusted users: ${
  config.security.trustedUsers.length
}

Protected roles: ${
  config.security.protectedRoles.length
}

Protected channels: ${
  config.security.protectedChannels.length
}`,
          ephemeral: true
        });
      }

      if (
        subcommand === "list"
      ) {
        return interaction.reply({
          content:
`Trusted users: ${
  config.security.trustedUsers.length
}
Trusted bots: ${
  config.security.trustedBots.length
}
Protected roles: ${
  config.security.protectedRoles.length
}
Protected channels: ${
  config.security.protectedChannels.length
}`,
          ephemeral: true
        });
      }

      return interaction.reply(
        "✅ Security configuration updated."
      );
    }

    /* =====================================================
       CONFIG
    ===================================================== */

    if (
      command === "config"
    ) {
      if (!isAdmin(interaction)) {
        return interaction.reply({
          content:
            "❌ Staff only.",
          ephemeral: true
        });
      }

      const subcommand =
        interaction.options
          .getSubcommand();

      if (
        subcommand === "view"
      ) {
        return interaction.reply({
          content:
`**AkiyO Server Configuration**

Staff role:
${mention(
  config.ticket.staffRoleId
)}

Ticket category:
${mention(
  config.ticket.categoryId
)}

Suggestions:
${mention(
  config.suggestionsChannelId
)}

AutoRole:
${mention(
  config.autorole.roleId
)}

Welcome:
${
  config.welcome.enabled
    ? "ON"
    : "OFF"
}

Verification:
${
  config.verification.enabled
    ? "ON"
    : "OFF"
}`,
          ephemeral: true
        });
      }

      if (
        subcommand === "staffrole"
      ) {
        config.ticket.staffRoleId =
          interaction.options
            .getRole(
              "role"
            ).id;
      }

      if (
        subcommand ===
        "ticketcategory"
      ) {
        config.ticket.categoryId =
          interaction.options
            .getChannel(
              "channel"
            ).id;
      }

      if (
        subcommand ===
        "suggestions"
      ) {
        config.suggestionsChannelId =
          interaction.options
            .getChannel(
              "channel"
            ).id;
      }

      if (
        subcommand === "log"
      ) {
        const type =
          interaction.options
            .getString(
              "type"
            );

        config.logs[type] =
          interaction.options
            .getChannel(
              "channel"
            ).id;
      }

      save();

      return interaction.reply(
        "✅ Configuration updated."
      );
    }

    /* =====================================================
       TICKET CREATE
    ===================================================== */

    if (
      command === "ticket"
    ) {
      const ticket =
        await createTicket(
          interaction.guild,
          interaction.user
        );

      return interaction.reply({
        content:
          `🎫 Ticket created: <#${ticket.channelId}>`,
        ephemeral: true
      });
    }

    /* =====================================================
       TICKET PANEL
    ===================================================== */

    if (
      command === "ticketpanel"
    ) {
      if (!isAdmin(interaction)) {
        return interaction.reply({
          content:
            "❌ Staff only.",
          ephemeral: true
        });
      }

      const row =
        new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(
                "ticket_create"
              )
              .setLabel(
                "Create Ticket"
              )
              .setEmoji("🎫")
              .setStyle(
                ButtonStyle.Primary
              )
          );

      return interaction.reply({
        content:
          "🎫 **AkiyO Support**\nClick below to create a support ticket.",
        components: [row]
      });
    }

    /* =====================================================
       TICKET SETUP
    ===================================================== */

    if (
      command ===
      "ticketsetup"
    ) {
      if (!isAdmin(interaction)) {
        return interaction.reply({
          content:
            "❌ Staff only.",
          ephemeral: true
        });
      }

      return interaction.reply({
        content:
`Configure tickets with:

/config staffrole
/config ticketcategory
/config log

Then use:

/ticketpanel`,
        ephemeral: true
      });
    }

    /* =====================================================
       TICKET ACTIONS
    ===================================================== */

    if (
      [
        "close",
        "reopen",
        "delete",
        "claim",
        "unclaim",
        "lock",
        "unlock",
        "transcript"
      ].includes(command)
    ) {
      return handleTicketAction(
        interaction,
        command
      );
    }

    /* =====================================================
       TICKET STATS
    ===================================================== */

    if (
      command ===
      "ticketstats"
    ) {
      const tickets =
        Object.values(
          db.tickets
        )
        .filter(
          ticket =>
            ticket.guildId ===
            interaction.guild.id
        );

      return interaction.reply(
`🎫 **Ticket Statistics**

Total: ${tickets.length}
Open: ${
  tickets.filter(
    x => !x.closed
  ).length
}
Closed: ${
  tickets.filter(
    x => x.closed
  ).length
}`
      );
    }

    /* =====================================================
       TICKET INFO
    ===================================================== */

    if (
      command ===
      "ticketinfo"
    ) {
      const ticket =
        await getTicket(
          interaction.channel
        );

      if (!ticket) {
        return interaction.reply(
          "❌ This is not a ticket."
        );
      }

      return interaction.reply(
`🎫 **Ticket Information**

User: <@${ticket.userId}>

Created:
<t:${Math.floor(
  ticket.createdAt / 1000
)}:R>

Status:
${
  ticket.closed
    ? "Closed"
    : "Open"
}

Claimed:
${mention(
  ticket.claimedBy
)}`
      );
    }

    /* =====================================================
       TICKET ADD / REMOVE
    ===================================================== */

    if (
      command ===
        "ticketadd" ||
      command ===
        "ticketremove"
    ) {
      const ticket =
        await getTicket(
          interaction.channel
        );

      if (
        !ticket ||
        !isStaff(interaction)
      ) {
        return interaction.reply({
          content:
            "❌ Staff only in tickets.",
          ephemeral: true
        });
      }

      const user =
        interaction.options
          .getUser("user");

      if (
        command ===
        "ticketadd"
      ) {
        await interaction.channel
          .permissionOverwrites
          .edit(
            user.id,
            {
              ViewChannel: true,
              SendMessages: true,
              ReadMessageHistory:
                true
            }
          );
      } else {
        await interaction.channel
          .permissionOverwrites
          .edit(
            user.id,
            {
              ViewChannel: false
            }
          );
      }

      return interaction.reply(
        `✅ ${
          command ===
          "ticketadd"
            ? "Added"
            : "Removed"
        } ${user}.`
      );
    }

    /* =====================================================
       TICKET RENAME
    ===================================================== */

    if (
      command ===
      "ticketrename"
    ) {
      const ticket =
        await getTicket(
          interaction.channel
        );

      if (
        !ticket ||
        !isStaff(interaction)
      ) {
        return interaction.reply({
          content:
            "❌ Staff only.",
          ephemeral: true
        });
      }

      await interaction.channel
        .setName(
          safeName(
            interaction.options
              .getString(
                "name"
              )
          )
        );

      return interaction.reply(
        "✅ Ticket renamed."
      );
    }

    /* =====================================================
       SUGGESTION
    ===================================================== */

    if (
      command === "suggest"
    ) {
      const channel =
        config.suggestionsChannelId
          ? await interaction.guild.channels
              .fetch(
                config.suggestionsChannelId
              )
              .catch(() => null)
          : null;

      if (
        !channel?.isTextBased()
      ) {
        return interaction.reply({
          content:
            "❌ Suggestions channel is not configured.",
          ephemeral: true
        });
      }

      const id =
        `${interaction.user.id}-${Date.now()}`;

      const text =
        interaction.options
          .getString(
            "text"
          );

      config.suggestions[id] = {
        userId:
          interaction.user.id,

        text,

        status:
          "pending",

        at: Date.now()
      };

      save();

      const row =
        new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(
                `suggest_approved_${id}`
              )
              .setLabel(
                "Approve"
              )
              .setStyle(
                ButtonStyle.Success
              ),

            new ButtonBuilder()
              .setCustomId(
                `suggest_declined_${id}`
              )
              .setLabel(
                "Decline"
              )
              .setStyle(
                ButtonStyle.Danger
              )
          );

      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(
              "💡 Suggestion"
            )
            .setDescription(
              text
            )
            .setFooter({
              text:
                `By ${interaction.user.tag}`
            })
            .setColor(
              0xfee75c
            )
        ],

        components: [row]
      });

      return interaction.reply({
        content:
          "✅ Suggestion submitted.",
        ephemeral: true
      });
    }

    /* =====================================================
       ANNOUNCEMENT
    ===================================================== */

    if (
      command === "announce"
    ) {
      const channel =
        interaction.options
          .getChannel(
            "channel"
          );

      const text =
        interaction.options
          .getString(
            "message"
          );

      const embedEnabled =
        interaction.options
          .getBoolean(
            "embed"
          ) ?? true;

      let content = "";

      if (
        interaction.options
          .getBoolean(
            "everyone"
          )
      ) {
        content +=
          "@everyone ";
      }

      const role =
        interaction.options
          .getRole("role");

      if (role) {
        content +=
          `${role} `;
      }

      const user =
        interaction.options
          .getUser("user");

      if (user) {
        content +=
          `${user} `;
      }

      content += text;

      const payload = {
        content,

        allowedMentions: {
          parse:
            interaction.options
              .getBoolean(
                "everyone"
              )
              ? ["everyone"]
              : [],

          roles:
            role
              ? [role.id]
              : [],

          users:
            user
              ? [user.id]
              : []
        }
      };

      if (embedEnabled) {
        payload.embeds = [
          new EmbedBuilder()
            .setTitle(
              interaction.options
                .getString(
                  "title"
                ) ||
                "Announcement"
            )
            .setDescription(
              text
            )
            .setFooter({
              text:
                interaction.options
                  .getString(
                    "footer"
                  ) ||
                "AkiyO"
            })
            .setColor(
              0x5865f2
            )
        ];
      }

      await channel.send(
        payload
      );

      return interaction.reply({
        content:
          "✅ Announcement sent.",
        ephemeral: true
      });
    }

    /* =====================================================
       AUTOROLE
    ===================================================== */

    if (
      command ===
      "autorole"
    ) {
      if (!isAdmin(interaction)) {
        return interaction.reply({
          content:
            "❌ Staff only.",
          ephemeral: true
        });
      }

      const subcommand =
        interaction.options
          .getSubcommand();

      if (
        subcommand === "set"
      ) {
        const role =
          interaction.options
            .getRole(
              "role"
            );

        config.autorole = {
          enabled: true,
          roleId: role.id
        };
      }

      if (
        subcommand ===
        "disable"
      ) {
        config.autorole.enabled =
          false;
      }

      save();

      if (
        subcommand ===
        "status"
      ) {
        return interaction.reply({
          content:
`AutoRole: ${
  config.autorole.enabled
    ? "ON"
    : "OFF"
}

Role:
${mention(
  config.autorole.roleId
)}`,
          ephemeral: true
        });
      }

      return interaction.reply(
        "✅ AutoRole updated."
      );
    }

    /* =====================================================
       WELCOME
    ===================================================== */

    if (
      command === "welcome"
    ) {
      if (!isAdmin(interaction)) {
        return interaction.reply({
          content:
            "❌ Staff only.",
          ephemeral: true
        });
      }

      const subcommand =
        interaction.options
          .getSubcommand();

      if (
        subcommand === "set"
      ) {
        config.welcome = {
          enabled: true,

          channelId:
            interaction.options
              .getChannel(
                "channel"
              ).id,

          message:
            interaction.options
              .getString(
                "message"
              )
        };
      }

      if (
        subcommand ===
        "disable"
      ) {
        config.welcome.enabled =
          false;
      }

      save();

      if (
        subcommand ===
        "status"
      ) {
        return interaction.reply({
          content:
`Welcome:
${
  config.welcome.enabled
    ? "ON"
    : "OFF"
}

Channel:
${mention(
  config.welcome.channelId
)}

Message:
${config.welcome.message}`,
          ephemeral: true
        });
      }

      return interaction.reply(
        "✅ Welcome system updated."
      );
    }

    /* =====================================================
       VERIFICATION
    ===================================================== */

    if (
      command ===
      "verification"
    ) {
      if (!isAdmin(interaction)) {
        return interaction.reply({
          content:
            "❌ Staff only.",
          ephemeral: true
        });
      }

      const subcommand =
        interaction.options
          .getSubcommand();

      if (
        subcommand === "setup"
      ) {
        const channel =
          interaction.options
            .getChannel(
              "channel"
            );

        const role =
          interaction.options
            .getRole(
              "role"
            );

        config.verification.enabled =
          true;

        config.verification.channelId =
          channel.id;

        config.verification.roleId =
          role.id;

        const message =
          await channel.send({
            content:
              "🔐 Click the button below to verify.",

            components: [
              new ActionRowBuilder()
                .addComponents(
                  new ButtonBuilder()
                    .setCustomId(
                      "verify"
                    )
                    .setLabel(
                      "Verify"
                    )
                    .setEmoji(
                      "✅"
                    )
                    .setStyle(
                      ButtonStyle.Success
                    )
                )
            ]
          });

        config.verification.messageId =
          message.id;
      }

      if (
        subcommand ===
        "disable"
      ) {
        config.verification.enabled =
          false;
      }

      save();

      if (
        subcommand ===
        "status"
      ) {
        return interaction.reply({
          content:
`Verification:
${
  config.verification.enabled
    ? "ON"
    : "OFF"
}

Channel:
${mention(
  config.verification.channelId
)}

Role:
${mention(
  config.verification.roleId
)}`,
          ephemeral: true
        });
      }

      return interaction.reply(
        "✅ Verification updated."
      );
    }

    /* =====================================================
       REACTION ROLES
    ===================================================== */

    if (
      command ===
      "autoreactionrole"
    ) {
      if (!isAdmin(interaction)) {
        return interaction.reply({
          content:
            "❌ Staff only.",
          ephemeral: true
        });
      }

      const subcommand =
        interaction.options
          .getSubcommand();

      if (
        subcommand === "add"
      ) {
        const messageId =
          interaction.options
            .getString(
              "message_id"
            );

        const rawEmoji =
          interaction.options
            .getString(
              "emoji"
            );

        const role =
          interaction.options
            .getRole(
              "role"
            );

        const message =
          await interaction.channel.messages
            .fetch(
              messageId
            )
            .catch(() => null);

        if (!message) {
          return interaction.reply(
            "❌ Message not found in this channel."
          );
        }

        const me =
          interaction.guild.members.me;

        if (
          !me?.permissions.has(
            PermissionFlagsBits.ManageRoles
          )
        ) {
          return interaction.reply(
            "❌ I need Manage Roles permission."
          );
        }

        if (
          role.position >=
          me.roles.highest.position
        ) {
          return interaction.reply(
            "❌ My highest role must be above that role."
          );
        }

        const key =
          emojiKey(
            rawEmoji
          );

        config.reactionRoles[
          messageId
        ] ??= {};

        config.reactionRoles[
          messageId
        ][key] = {
          roleId: role.id,
          emoji: rawEmoji
        };

        try {
          await message.react(
            rawEmoji
          );
        } catch (error) {
          delete config
            .reactionRoles[
              messageId
            ][key];

          save();

          return interaction.reply(
            `❌ I could not react with that emoji.\n${error.message}`
          );
        }

        save();

        return interaction.reply(
          `✅ ${rawEmoji} → ${role}`
        );
      }

      if (
        subcommand ===
        "remove"
      ) {
        const messageId =
          interaction.options
            .getString(
              "message_id"
            );

        const key =
          emojiKey(
            interaction.options
              .getString(
                "emoji"
              )
          );

        if (
          config.reactionRoles[
            messageId
          ]
        ) {
          delete config
            .reactionRoles[
              messageId
            ][key];
        }

        save();

        return interaction.reply(
          "✅ Reaction role removed."
        );
      }

      if (
        subcommand === "list"
      ) {
        const output =
          JSON.stringify(
            config.reactionRoles,
            null,
            2
          );

        return interaction.reply({
          content:
            output.slice(
              0,
              1900
            ),
          ephemeral: true
        });
      }
    }

    /* =====================================================
       LEADERBOARD
    ===================================================== */

    if (
      command ===
      "leaderboard"
    ) {
      const subcommand =
        interaction.options
          .getSubcommand();

      if (
        [
          "enable",
          "disable",
          "reset"
        ].includes(
          subcommand
        ) &&
        !isAdmin(interaction)
      ) {
        return interaction.reply({
          content:
            "❌ Staff only.",
          ephemeral: true
        });
      }

      if (
        subcommand ===
        "enable"
      ) {
        config.leaderboard.enabled =
          true;
      }

      if (
        subcommand ===
        "disable"
      ) {
        config.leaderboard.enabled =
          false;
      }

      if (
        subcommand ===
        "reset"
      ) {
        config.leaderboard.messages =
          {};
      }

      if (
        subcommand ===
        "status"
      ) {
        return interaction.reply({
          content:
            `Leaderboard: ${
              config.leaderboard.enabled
                ? "ON"
                : "OFF"
            }`,
          ephemeral: true
        });
      }

      if (
        subcommand === "top"
      ) {
        const top =
          Object.entries(
            config.leaderboard
              .messages
          )
          .sort(
            (a, b) =>
              b[1] - a[1]
          )
          .slice(
            0,
            10
          );

        if (!top.length) {
          return interaction.reply(
            "No leaderboard data yet."
          );
        }

        return interaction.reply(
          top
            .map(
              (entry, index) =>
                `${index + 1}. <@${entry[0]}> — ${entry[1]} messages`
            )
            .join("\n")
        );
      }

      save();

      return interaction.reply(
        "✅ Leaderboard updated."
      );
    }

    /* =====================================================
       ADS
    ===================================================== */

    if (
      command === "ads"
    ) {
      if (!isOwner(interaction)) {
        return interaction.reply({
          content:
            "❌ Bot owner only.",
          ephemeral: true
        });
      }

      const subcommand =
        interaction.options
          .getSubcommand();

      if (
        subcommand === "set"
      ) {
        config.ads.channelId =
          interaction.options
            .getChannel(
              "channel"
            ).id;
      }

      if (
        subcommand ===
        "message"
      ) {
        config.ads.message =
          interaction.options
            .getString(
              "message"
            );
      }

      if (
        subcommand ===
        "interval"
      ) {
        config.ads.intervalMinutes =
          interaction.options
            .getInteger(
              "minutes"
            );
      }

      if (
        subcommand ===
        "enable"
      ) {
        config.ads.enabled =
          true;
      }

      if (
        subcommand ===
        "disable"
      ) {
        config.ads.enabled =
          false;
      }

      if (
        subcommand ===
        "status"
      ) {
        return interaction.reply({
          content:
`Ads:
${
  config.ads.enabled
    ? "ON"
    : "OFF"
}

Channel:
${mention(
  config.ads.channelId
)}

Interval:
${config.ads.intervalMinutes} minutes`,
          ephemeral: true
        });
      }

      if (
        subcommand ===
        "broadcast"
      ) {
        const channel =
          config.ads.channelId
            ? await interaction.guild.channels
                .fetch(
                  config.ads.channelId
                )
                .catch(
                  () => null
                )
            : null;

        if (
          channel?.isTextBased()
        ) {
          await channel.send(
            config.ads.message
          );
        }

        return interaction.reply({
          content:
            "✅ Advertisement broadcasted.",
          ephemeral: true
        });
      }

      save();

      return interaction.reply(
        "✅ Ads configuration updated."
      );
    }
  } catch (error) {
    console.error(
      "Interaction error:",
      error
    );

    const response =
      `❌ Error: ${error.message}`;

    if (
      interaction.replied ||
      interaction.deferred
    ) {
      await interaction
        .editReply(response)
        .catch(() => {});
    } else {
      await interaction
        .reply({
          content: response,
          ephemeral: true
        })
        .catch(() => {});
    }
  }
});

/* =========================================================
   AD SCHEDULER
========================================================= */

const nextAdvertisement =
  new Map();

setInterval(
  async () => {
    for (
      const guild of
        client.guilds.cache.values()
    ) {
      try {
        const config =
          gc(guild);

        if (
          !config.ads.enabled ||
          !config.ads.channelId
        ) {
          continue;
        }

        if (
          !nextAdvertisement.has(
            guild.id
          )
        ) {
          nextAdvertisement.set(
            guild.id,
            Date.now() +
              config.ads
                .intervalMinutes *
              60000
          );

          continue;
        }

        if (
          Date.now() <
          nextAdvertisement.get(
            guild.id
          )
        ) {
          continue;
        }

        const channel =
          await guild.channels
            .fetch(
              config.ads.channelId
            )
            .catch(() => null);

        if (
          channel?.isTextBased()
        ) {
          await channel.send(
            config.ads.message
          ).catch(() => {});
        }

        nextAdvertisement.set(
          guild.id,
          Date.now() +
            config.ads
              .intervalMinutes *
            60000
        );
      } catch (error) {
        console.error(
          "Advertisement error:",
          error.message
        );
      }
    }
  },
  60000
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
   START BOT
========================================================= */

client.login(TOKEN)
  .catch(error => {
    console.error(
      "❌ Discord login failed:",
      error
    );
  });
