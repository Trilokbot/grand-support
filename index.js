/* =========================================================
   AKIYO - ALL IN ONE DISCORD MANAGEMENT BOT
   80+ SLASH COMMANDS
   discord.js v14
   Node.js 18+
   ========================================================= */

const http = require("http");
const fs = require("fs");
const path = require("path");

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

/* =========================================================
   ENVIRONMENT
   ========================================================= */

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.5";
const PORT = Number(process.env.PORT || 10000);

if (!TOKEN || !CLIENT_ID) {
  console.error("ERROR: DISCORD_TOKEN and CLIENT_ID are required.");
  process.exit(1);
}

/* Render / Railway / other hosting health server */
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("AkiyO Bot Online");
}).listen(PORT, "0.0.0.0");

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
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildPresences
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User,
    Partials.Reaction
  ]
});

/* =========================================================
   DATABASE
   ========================================================= */

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "akiyo.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DEFAULT_GUILD = {
  configVersion: 3,

  logs: {
    all: null,
    automod: null,
    moderation: null,
    security: null,
    tickets: null,
    members: null,
    messages: null,
    channels: null,
    roles: null,
    audit: null,
    welcome: null,
    announcements: null,
    verification: null,
    ai: null
  },

  ticket: {
    enabled: true,
    categoryId: null,
    staffRoleId: null,
    logChannelId: null,
    panelChannelId: null,
    panelMessageId: null,
    dmEnabled: true,
    records: {}
  },

  automod: {
    enabled: true,

    spam: {
      enabled: true,
      limit: 6,
      window: 5000,
      action: "timeout"
    },

    repeat: {
      enabled: true,
      limit: 3,
      action: "timeout"
    },

    caps: {
      enabled: true,
      percent: 75,
      action: "delete"
    },

    badword: {
      enabled: true,
      words: [],
      action: "delete"
    },

    invite: {
      enabled: true,
      action: "timeout"
    },

    links: {
      enabled: false,
      action: "delete"
    },

    massMention: {
      enabled: true,
      users: 5,
      roles: 5,
      action: "timeout"
    },

    attachments: {
      enabled: false,
      action: "delete"
    },

    duplicate: {
      enabled: true,
      limit: 3,
      action: "delete"
    },

    timeoutSeconds: {
      spam: 60,
      repeat: 120,
      caps: 30,
      badword: 60,
      invite: 300,
      links: 60,
      massMention: 300,
      attachments: 60,
      duplicate: 120
    }
  },

  security: {
    enabled: true,

    antiRaid: {
      enabled: true,
      joins: 10,
      window: 10000,
      action: "alert"
    },

    antiNuke: {
      enabled: true,
      ban: 3,
      kick: 3,
      channelDelete: 3,
      channelCreate: 5,
      roleDelete: 3,
      roleCreate: 5,
      webhook: 2,
      action: "alert"
    },

    trustedMembers: [],
    trustedBots: [],
    trustedRole: null,

    protectedRoles: [],
    protectedChannels: [],

    lockdown: false
  },

  warnings: {},
  punishments: {},

  autorole: {
    enabled: false,
    roleId: null
  },

  welcome: {
    enabled: false,
    channelId: null,
    message:
      "Welcome {user} to {server}! You are member #{count}."
  },

  leave: {
    enabled: false,
    channelId: null,
    message:
      "{username} has left {server}."
  },

  verification: {
    enabled: false,
    channelId: null,
    roleId: null,
    messageId: null
  },

  reactionRoles: {},

  announcements: {
    defaultChannel: null
  },

  activity: {
    enabled: true,
    requiredMinutes: 60,
    staffRoleId: null,
    lastCheck: null,
    users: {}
  },

  ai: {
    enabled: true,
    adminAudit: false,
    adminUserId: null
  },

  lockdown: {
    enabled: false
  }
};

let db = {};

try {
  if (fs.existsSync(DATA_FILE)) {
    db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  }
} catch (err) {
  console.error("Database load error:", err);
  db = {};
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function merge(base, extra) {
  for (const key of Object.keys(extra || {})) {
    if (
      extra[key] &&
      typeof extra[key] === "object" &&
      !Array.isArray(extra[key])
    ) {
      base[key] = merge(base[key] || {}, extra[key]);
    } else if (extra[key] !== undefined) {
      base[key] = extra[key];
    }
  }
  return base;
}

function guildConfig(guild) {
  if (!db[guild.id]) {
    db[guild.id] = clone(DEFAULT_GUILD);
  } else {
    db[guild.id] = merge(clone(DEFAULT_GUILD), db[guild.id]);
  }

  return db[guild.id];
}

function saveDB() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(db, null, 2)
    );
  } catch (err) {
    console.error("Database save error:", err);
  }
}

/* =========================================================
   HELPERS
   ========================================================= */

const COLORS = {
  primary: 0x5865F2,
  success: 0x57F287,
  warning: 0xFEE75C,
  danger: 0xED4245,
  purple: 0x9B59B6,
  pink: 0xEB459E,
  dark: 0x2B2D31
};

function safe(value, max = 1024) {
  return String(value ?? "-")
    .replace(/\u0000/g, "")
    .slice(0, max) || "-";
}

function field(name, value, inline = false) {
  return {
    name: safe(name, 256),
    value: safe(value, 1024),
    inline
  };
}

function userTag(user) {
  if (!user) return "Unknown";
  return `${user.tag || user.username} (${user.id})`;
}

function userMention(id) {
  return id ? `<@${id}>` : "None";
}

function roleMention(id) {
  return id ? `<@&${id}>` : "None";
}

function channelMention(id) {
  return id ? `<#${id}>` : "None";
}

function makeEmbed(
  title,
  description,
  color = COLORS.primary,
  guild = null,
  fields = []
) {
  const e = new EmbedBuilder()
    .setTitle(safe(title, 256))
    .setDescription(safe(description, 4096))
    .setColor(color)
    .setTimestamp();

  if (guild) {
    const icon = guild.iconURL?.({ size: 128 });
    if (icon) {
      e.setAuthor({
        name: guild.name,
        iconURL: icon
      });
    }
  }

  if (fields.length) {
    e.addFields(fields.slice(0, 25));
  }

  e.setFooter({
    text: "AkiyO • Professional Discord Management"
  });

  return e;
}

async function reply(
  interaction,
  title,
  description,
  color = COLORS.success,
  fields = [],
  extra = {}
) {
  const payload = {
    embeds: [
      makeEmbed(
        title,
        description,
        color,
        interaction.guild,
        fields
      )
    ],
    ...extra
  };

  if (interaction.replied || interaction.deferred) {
    return interaction.editReply(payload);
  }

  return interaction.reply(payload);
}

function isManager(member) {
  return !!member &&
    (
      member.permissions.has(
        PermissionFlagsBits.Administrator
      ) ||
      member.permissions.has(
        PermissionFlagsBits.ManageGuild
      )
    );
}

function isModerator(member) {
  return !!member &&
    (
      member.permissions.has(
        PermissionFlagsBits.Administrator
      ) ||
      member.permissions.has(
        PermissionFlagsBits.ManageGuild
      ) ||
      member.permissions.has(
        PermissionFlagsBits.ManageMessages
      ) ||
      member.permissions.has(
        PermissionFlagsBits.ModerateMembers
      )
    );
}

function isStaff(member) {
  if (!member) return false;

  const c = guildConfig(member.guild);

  return (
    isManager(member) ||
    (
      c.ticket.staffRoleId &&
      member.roles.cache.has(c.ticket.staffRoleId)
    )
  );
}

function isTrusted(guild, userId) {
  const c = guildConfig(guild);

  const member =
    guild.members.cache.get(userId);

  if (
    member?.permissions.has(
      PermissionFlagsBits.Administrator
    )
  ) {
    return true;
  }

  if (c.security.trustedMembers.includes(userId)) {
    return true;
  }

  if (c.security.trustedBots.includes(userId)) {
    return true;
  }

  if (
    c.security.trustedRole &&
    member?.roles.cache.has(c.security.trustedRole)
  ) {
    return true;
  }

  return false;
}

function parseDuration(input) {
  const match = String(input || "")
    .trim()
    .match(/^(\d+)\s*(s|m|h|d|w)$/i);

  if (!match) return null;

  const number = Number(match[1]);
  const unit = match[2].toLowerCase();

  const multiplier = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000
  }[unit];

  const ms = number * multiplier;

  if (ms <= 0 || ms > 28 * 24 * 60 * 60 * 1000) {
    return null;
  }

  return ms;
}

function canModerate(interaction, target) {
  const me = interaction.guild.members.me;

  if (!me || !target) return false;
  if (target.id === interaction.user.id) return false;
  if (target.id === interaction.guild.ownerId) return false;

  return (
    target.roles.highest.position <
      me.roles.highest.position &&
    target.roles.highest.position <
      interaction.member.roles.highest.position
  );
}

async function getLogChannel(guild, type) {
  const c = guildConfig(guild);

  const id =
    c.logs[type] ||
    c.logs.all;

  if (!id) return null;

  return guild.channels
    .fetch(id)
    .catch(() => null);
}

async function log(
  guild,
  type,
  title,
  fields = [],
  color = COLORS.primary
) {
  if (!guild) return;

  const channel =
    await getLogChannel(guild, type);

  if (!channel?.isTextBased()) return;

  const e = makeEmbed(
    title,
    "",
    color,
    guild,
    fields
  );

  await channel
    .send({ embeds: [e] })
    .catch(() => {});
}

async function commandLog(interaction) {
  if (!interaction.guild) return;

  await log(
    interaction.guild,
    "audit",
    "⚡ Command Executed",
    [
      field(
        "Command",
        `/${interaction.commandName}`
      ),
      field(
        "User",
        userTag(interaction.user)
      ),
      field(
        "Channel",
        interaction.channel
          ? `${interaction.channel} (${interaction.channel.id})`
          : "DM"
      )
    ],
    COLORS.primary
  );
}

/* =========================================================
   WARNINGS / PUNISHMENTS
   ========================================================= */

function addPunishment(
  guild,
  userId,
  type,
  reason,
  moderatorId,
  duration = null
) {
  const c = guildConfig(guild);

  if (!c.punishments[userId]) {
    c.punishments[userId] = [];
  }

  c.punishments[userId].push({
    type,
    reason,
    moderatorId,
    duration,
    timestamp: Date.now()
  });

  saveDB();
}

async function warnMember(
  member,
  reason,
  moderator
) {
  const c = guildConfig(member.guild);

  if (!c.warnings[member.id]) {
    c.warnings[member.id] = [];
  }

  c.warnings[member.id].push({
    reason,
    moderatorId: moderator.id,
    timestamp: Date.now()
  });

  const count =
    c.warnings[member.id].length;

  addPunishment(
    member.guild,
    member.id,
    "warn",
    reason,
    moderator.id
  );

  await log(
    member.guild,
    "moderation",
    "⚠️ Warning Issued",
    [
      field(
        "Member",
        userTag(member.user)
      ),
      field(
        "Moderator",
        userTag(moderator)
      ),
      field("Reason", reason),
      field("Warning Count", count)
    ],
    COLORS.warning
  );

  /* Escalation */
  if (
    count === 3 &&
    member.moderatable
  ) {
    await member
      .timeout(
        10 * 60 * 1000,
        "AkiyO warning escalation"
      )
      .catch(() => {});

    addPunishment(
      member.guild,
      member.id,
      "timeout",
      "3 warning escalation",
      moderator.id,
      600000
    );
  }

  if (
    count === 5 &&
    member.kickable
  ) {
    await member
      .kick("AkiyO warning escalation")
      .catch(() => {});

    addPunishment(
      member.guild,
      member.id,
      "kick",
      "5 warning escalation",
      moderator.id
    );
  }

  if (
    count >= 7 &&
    member.bannable
  ) {
    await member
      .ban({
        reason:
          "AkiyO warning escalation"
      })
      .catch(() => {});

    addPunishment(
      member.guild,
      member.id,
      "ban",
      "7+ warning escalation",
      moderator.id
    );
  }

  return count;
}

/* =========================================================
   AUTOMOD
   ========================================================= */

const spamMap = new Map();
const repeatMap = new Map();
const duplicateMap = new Map();

async function autoModAction(
  message,
  type,
  reason
) {
  const c =
    guildConfig(message.guild).automod;

  const action =
    c[type]?.action || "delete";

  await message
    .delete()
    .catch(() => {});

  const seconds =
    c.timeoutSeconds[type] || 60;

  if (
    action === "timeout" &&
    message.member?.moderatable
  ) {
    await message.member
      .timeout(
        seconds * 1000,
        `AkiyO AutoMod: ${reason}`
      )
      .catch(() => {});
  }

  if (
    action === "kick" &&
    message.member?.kickable
  ) {
    await message.member
      .kick(
        `AkiyO AutoMod: ${reason}`
      )
      .catch(() => {});
  }

  if (
    action === "ban" &&
    message.member?.bannable
  ) {
    await message.member
      .ban({
        reason:
          `AkiyO AutoMod: ${reason}`
      })
      .catch(() => {});
  }

  if (action === "warn") {
    await warnMember(
      message.member,
      `AutoMod: ${reason}`,
      client.user
    );
  }

  await log(
    message.guild,
    "automod",
    "🛡️ AutoMod Enforcement",
    [
      field(
        "User",
        userTag(message.author)
      ),
      field(
        "Channel",
        `${message.channel}`
      ),
      field("Detection", type),
      field("Reason", reason),
      field("Action", action)
    ],
    COLORS.danger
  );
}

async function runAutoMod(message) {
  if (
    !message.guild ||
    !message.member ||
    message.author.bot
  ) {
    return;
  }

  const c =
    guildConfig(message.guild).automod;

  if (!c.enabled) return;

  if (isStaff(message.member)) return;

  const text =
    message.content || "";

  const lower =
    text.toLowerCase();

  /* Bad words */
  if (
    c.badword.enabled &&
    c.badword.words.some(
      word =>
        word &&
        lower.includes(
          String(word).toLowerCase()
        )
    )
  ) {
    return autoModAction(
      message,
      "badword",
      "Blocked word detected"
    );
  }

  /* Discord invites */
  if (
    c.invite.enabled &&
    /(discord\.gg\/|discord\.com\/invite\/)/i.test(
      text
    )
  ) {
    return autoModAction(
      message,
      "invite",
      "Discord invite detected"
    );
  }

  /* Links */
  if (
    c.links.enabled &&
    /https?:\/\/\S+/i.test(text)
  ) {
    return autoModAction(
      message,
      "links",
      "External link detected"
    );
  }

  /* Mass mention */
  if (
    c.massMention.enabled &&
    (
      message.mentions.everyone ||
      message.mentions.users.size >=
        c.massMention.users ||
      message.mentions.roles.size >=
        c.massMention.roles
    )
  ) {
    return autoModAction(
      message,
      "massMention",
      "Mass mention detected"
    );
  }

  /* Caps */
  if (c.caps.enabled) {
    const letters =
      text.replace(/[^A-Za-z]/g, "");

    const caps =
      letters.replace(
        /[^A-Z]/g,
        ""
      ).length;

    if (
      letters.length >= 8 &&
      caps / letters.length * 100 >=
        c.caps.percent
    ) {
      return autoModAction(
        message,
        "caps",
        `Caps exceeded ${c.caps.percent}%`
      );
    }
  }

  const now = Date.now();
  const key =
    `${message.guild.id}:${message.author.id}`;

  /* Spam */
  if (c.spam.enabled) {
    const messages =
      (spamMap.get(key) || [])
        .filter(
          t =>
            now - t <
            c.spam.window
        );

    messages.push(now);

    spamMap.set(
      key,
      messages
    );

    if (
      messages.length >=
      c.spam.limit
    ) {
      spamMap.set(key, []);

      return autoModAction(
        message,
        "spam",
        `${messages.length} messages in ${c.spam.window / 1000}s`
      );
    }
  }

  /* Repeat */
  if (c.repeat.enabled) {
    const old =
      repeatMap.get(key);

    if (
      old &&
      old.text === text &&
      now - old.time < 30000
    ) {
      old.count++;
    } else {
      repeatMap.set(key, {
        text,
        count: 1,
        time: now
      });
      return;
    }

    repeatMap.set(key, {
      text,
      count: old.count,
      time: now
    });

    if (
      old.count >=
      c.repeat.limit
    ) {
      repeatMap.delete(key);

      return autoModAction(
        message,
        "repeat",
        `Repeated message ${old.count} times`
      );
    }
  }
}

/* =========================================================
   SECURITY / ANTI-NUKE
   ========================================================= */

const securityMap = new Map();

async function securityEvent(
  guild,
  event,
  executorId,
  details
) {
  const c =
    guildConfig(guild).security;

  if (!c.enabled) return;

  if (!executorId) return;

  if (
    isTrusted(
      guild,
      executorId
    )
  ) {
    return;
  }

  const limits = {
    ban: c.antiNuke.ban,
    kick: c.antiNuke.kick,
    channelDelete:
      c.antiNuke.channelDelete,
    channelCreate:
      c.antiNuke.channelCreate,
    roleDelete:
      c.antiNuke.roleDelete,
    roleCreate:
      c.antiNuke.roleCreate,
    webhook:
      c.antiNuke.webhook
  };

  const limit =
    limits[event] || 999;

  const key =
    `${guild.id}:${event}:${executorId}`;

  const now = Date.now();

  const arr =
    (securityMap.get(key) || [])
      .filter(
        x =>
          now - x < 30000
      );

  arr.push(now);

  securityMap.set(
    key,
    arr
  );

  if (arr.length < limit) {
    return;
  }

  securityMap.delete(key);

  await log(
    guild,
    "security",
    "🚨 Anti-Nuke Triggered",
    [
      field("Event", event),
      field(
        "Executor",
        userMention(executorId)
      ),
      field(
        "Count",
        arr.length
      ),
      field(
        "Threshold",
        limit
      ),
      field(
        "Details",
        details
      ),
      field(
        "Response",
        c.antiNuke.action
      )
    ],
    COLORS.danger
  );

  if (
    c.antiNuke.action ===
    "ban"
  ) {
    const member =
      await guild.members
        .fetch(executorId)
        .catch(() => null);

    if (member?.bannable) {
      await member
        .ban({
          reason:
            `AkiyO Anti-Nuke: ${event}`
        })
        .catch(() => {});
    }
  }

  if (
    c.antiNuke.action ===
    "kick"
  ) {
    const member =
      await guild.members
        .fetch(executorId)
        .catch(() => null);

    if (member?.kickable) {
      await member
        .kick(
          `AkiyO Anti-Nuke: ${event}`
        )
        .catch(() => {});
    }
  }
}

async function auditExecutor(
  guild,
  action,
  targetId
) {
  try {
    const logs =
      await guild.fetchAuditLogs({
        type: action,
        limit: 5
      });

    const entry =
      logs.entries.find(
        e =>
          !targetId ||
          e.targetId === targetId
      );

    return entry?.executorId || null;
  } catch {
    return null;
  }
}

/* =========================================================
   TICKETS
   ========================================================= */

function ticketKey(
  guildId,
  userId
) {
  return `${guildId}:${userId}`;
}

function findTicket(
  guild,
  userId
) {
  const records =
    guildConfig(guild).ticket.records;

  return (
    records[
      ticketKey(
        guild.id,
        userId
      )
    ] || null
  );
}

function findTicketByChannel(
  guild,
  channelId
) {
  const records =
    guildConfig(guild).ticket.records;

  return Object.values(records)
    .find(
      t =>
        t.channelId ===
          channelId &&
        t.status !==
          "deleted"
    ) || null;
}

function ticketButtons() {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(
          "akiyo_ticket_claim"
        )
        .setLabel("Claim")
        .setEmoji("🙋")
        .setStyle(
          ButtonStyle.Primary
        ),

      new ButtonBuilder()
        .setCustomId(
          "akiyo_ticket_close"
        )
        .setLabel("Close")
        .setEmoji("🔒")
        .setStyle(
          ButtonStyle.Secondary
        ),

      new ButtonBuilder()
        .setCustomId(
          "akiyo_ticket_lock"
        )
        .setLabel("Lock")
        .setEmoji("🔐")
        .setStyle(
          ButtonStyle.Secondary
        ),

      new ButtonBuilder()
        .setCustomId(
          "akiyo_ticket_transcript"
        )
        .setLabel("Transcript")
        .setEmoji("📄")
        .setStyle(
          ButtonStyle.Success
        )
    );
}

async function createTicket(
  guild,
  user
) {
  const c =
    guildConfig(guild);

  const existing =
    findTicket(
      guild,
      user.id
    );

  if (
    existing &&
    existing.status !==
      "closed" &&
    existing.status !==
      "deleted"
  ) {
    return existing;
  }

  if (!c.ticket.categoryId) {
    throw new Error(
      "Ticket category is not configured."
    );
  }

  const category =
    guild.channels.cache.get(
      c.ticket.categoryId
    );

  const staffRole =
    c.ticket.staffRoleId;

  const safeName =
    user.username
      .toLowerCase()
      .replace(
        /[^a-z0-9]/g,
        ""
      )
      .slice(0, 18) ||
    "user";

  const channel =
    await guild.channels.create({
      name:
        `ticket-${safeName}`,
      type:
        ChannelType.GuildText,
      parent:
        category?.id || null,

      topic:
        `AKIYO_TICKET:${user.id}`,

      permissionOverwrites: [
        {
          id:
            guild.roles.everyone.id,
          deny: [
            PermissionFlagsBits.ViewChannel
          ]
        },

        {
          id: user.id,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles
          ]
        },

        ...(staffRole
          ? [
              {
                id: staffRole,
                allow: [
                  PermissionFlagsBits.ViewChannel,
                  PermissionFlagsBits.SendMessages,
                  PermissionFlagsBits.ReadMessageHistory,
                  PermissionFlagsBits.AttachFiles
                ]
              }
            ]
          : [])
      ]
    });

  const record = {
    guildId:
      guild.id,
    channelId:
      channel.id,
    ownerId:
      user.id,
    status:
      "open",
    claimedBy:
      null,
    locked:
      false,
    createdAt:
      Date.now(),
    closedAt:
      null
  };

  c.ticket.records[
    ticketKey(
      guild.id,
      user.id
    )
  ] = record;

  saveDB();

  await channel.send({
    embeds: [
      makeEmbed(
        "🎫 AkiyO Support Ticket",
        "Welcome to your private support ticket.\n\nExplain your issue clearly and a support member will assist you.",
        COLORS.primary,
        guild,
        [
          field(
            "Ticket Owner",
            userTag(user)
          ),
          field(
            "Status",
            "🟢 Open"
          ),
          field(
            "Created",
            `<t:${Math.floor(
              Date.now() / 1000
            )}:F>`
          )
        ]
      )
    ],
    components: [
      ticketButtons()
    ]
  });

  await log(
    guild,
    "tickets",
    "🎫 Ticket Created",
    [
      field(
        "Owner",
        userTag(user)
      ),
      field(
        "Channel",
        `${channel}`
      ),
      field(
        "Status",
        "Open"
      )
    ],
    COLORS.primary
  );

  /* DM notification */
  try {
    await user.send({
      embeds: [
        makeEmbed(
          "🎫 Support Ticket Created",
          `Your support ticket has been created in **${guild.name}**.`,
          COLORS.success,
          guild,
          [
            field(
              "Channel",
              `${channel}`
            ),
            field(
              "Status",
              "🟢 Open"
            ),
            field(
              "DM Support",
              "Reply to this DM to contact support."
            )
          ]
        )
      ]
    });
  } catch {}

  return record;
}

async function closeTicket(
  guild,
  record,
  actor
) {
  record.status = "closed";
  record.closedAt =
    Date.now();
  record.locked = false;

  saveDB();

  const channel =
    await guild.channels
      .fetch(record.channelId)
      .catch(() => null);

  if (channel?.isTextBased()) {
    await channel
      .permissionOverwrites
      .edit(
        record.ownerId,
        {
          SendMessages: false
        }
      )
      .catch(() => {});
  }

  const owner =
    await client.users
      .fetch(record.ownerId)
      .catch(() => null);

  if (owner) {
    try {
      await owner.send({
        embeds: [
          makeEmbed(
            "🔒 Ticket Closed",
            `Your support ticket in **${guild.name}** has been closed.`,
            COLORS.warning,
            guild,
            [
              field(
                "Closed By",
                userTag(actor)
              )
            ]
          )
        ]
      });
    } catch {}
  }

  await log(
    guild,
    "tickets",
    "🔒 Ticket Closed",
    [
      field(
        "Owner",
        userMention(
          record.ownerId
        )
      ),
      field(
        "Channel",
        `${channel || record.channelId}`
      ),
      field(
        "Closed By",
        userTag(actor)
      )
    ],
    COLORS.warning
  );
}

async function ticketTranscript(
  channel
) {
  let messages = [];
  let before;

  for (
    let page = 0;
    page < 20;
    page++
  ) {
    const batch =
      await channel.messages
        .fetch({
          limit: 100,
          before
        })
        .catch(() => null);

    if (
      !batch ||
      batch.size === 0
    ) {
      break;
    }

    messages.push(
      ...batch.values()
    );

    before =
      batch.last().id;

    if (
      batch.size < 100
    ) {
      break;
    }
  }

  messages.reverse();

  const lines = [
    "AKIYO SUPPORT TRANSCRIPT",
    `Server: ${channel.guild.name}`,
    `Channel: #${channel.name}`,
    `Generated: ${new Date().toISOString()}`,
    ""
  ];

  for (const message of messages) {
    lines.push(
      `[${message.createdAt.toISOString()}] ${message.author.tag} (${message.author.id})`,
      message.content ||
        "[No text]",
      ...[
        ...message.attachments.values()
      ].map(
        a =>
          `Attachment: ${a.url}`
      ),
      ""
    );
  }

  return Buffer.from(
    lines.join("\n"),
    "utf8"
  );
}

/* =========================================================
   AI
   ========================================================= */

const aiHistory = new Map();

async function askAI(
  userId,
  prompt
) {
  if (!OPENAI_API_KEY) {
    return {
      error:
        "OPENAI_API_KEY is not configured."
    };
  }

  const history =
    aiHistory.get(userId) ||
    [];

  history.push({
    role: "user",
    content: prompt
  });

  while (
    history.length > 12
  ) {
    history.shift();
  }

  try {
    const response =
      await fetch(
        "https://api.openai.com/v1/responses",
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",
            Authorization:
              `Bearer ${OPENAI_API_KEY}`
          },

          body: JSON.stringify({
            model:
              OPENAI_MODEL,
            input:
              history
          })
        }
      );

    if (!response.ok) {
      return {
        error:
          `OpenAI HTTP ${response.status}`
      };
    }

    const data =
      await response.json();

    const text =
      data.output_text ||
      data.output
        ?.flatMap(
          x =>
            x.content || []
        )
        .map(
          x =>
            x.text || ""
        )
        .join("") ||
      "No response.";

    history.push({
      role:
        "assistant",
      content:
        text
    });

    aiHistory.set(
      userId,
      history
    );

    return {
      text
    };
  } catch (err) {
    return {
      error:
        err.message
    };
  }
}

/* =========================================================
   COMMANDS
   ========================================================= */

const commands = [];

function add(command) {
  commands.push(command);
}

/* ---------- GENERAL ---------- */

add(
  new SlashCommandBuilder()
    .setName("help")
    .setDescription(
      "Show all AkiyO commands and systems"
    )
);

add(
  new SlashCommandBuilder()
    .setName("botinfo")
    .setDescription(
      "Show AkiyO bot information"
    )
);

add(
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription(
      "Check bot latency"
    )
);

add(
  new SlashCommandBuilder()
    .setName("serverinfo")
    .setDescription(
      "Show server information"
    )
);

add(
  new SlashCommandBuilder()
    .setName("userinfo")
    .setDescription(
      "Show information about a member"
    )
    .addUserOption(o =>
      o.setName("user")
        .setDescription(
          "Member"
        )
        .setRequired(false)
    )
);

add(
  new SlashCommandBuilder()
    .setName("avatar")
    .setDescription(
      "Show a member avatar"
    )
    .addUserOption(o =>
      o.setName("user")
        .setDescription(
          "Member"
        )
        .setRequired(false)
    )
);

add(
  new SlashCommandBuilder()
    .setName("membercount")
    .setDescription(
      "Show server member count"
    )
);

add(
  new SlashCommandBuilder()
    .setName("roleinfo")
    .setDescription(
      "Show role information"
    )
    .addRoleOption(o =>
      o.setName("role")
        .setDescription(
          "Role"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("channelinfo")
    .setDescription(
      "Show channel information"
    )
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription(
          "Channel"
        )
        .setRequired(false)
    )
);

/* ---------- MODERATION ---------- */

add(
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription(
      "Warn a member"
    )
    .addUserOption(o =>
      o.setName("user")
        .setDescription(
          "Member"
        )
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription(
          "Reason"
        )
    )
);

add(
  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription(
      "View member warnings"
    )
    .addUserOption(o =>
      o.setName("user")
        .setDescription(
          "Member"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("clearwarnings")
    .setDescription(
      "Clear member warnings"
    )
    .addUserOption(o =>
      o.setName("user")
        .setDescription(
          "Member"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("punishments")
    .setDescription(
      "View punishment history"
    )
    .addUserOption(o =>
      o.setName("user")
        .setDescription(
          "Member"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription(
      "Timeout a member"
    )
    .addUserOption(o =>
      o.setName("user")
        .setDescription(
          "Member"
        )
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("duration")
        .setDescription(
          "30s, 10m, 2h, 1d"
        )
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription(
          "Reason"
        )
    )
);

add(
  new SlashCommandBuilder()
    .setName("untimeout")
    .setDescription(
      "Remove member timeout"
    )
    .addUserOption(o =>
      o.setName("user")
        .setDescription(
          "Member"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("kick")
    .setDescription(
      "Kick a member"
    )
    .addUserOption(o =>
      o.setName("user")
        .setDescription(
          "Member"
        )
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription(
          "Reason"
        )
    )
);

add(
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription(
      "Ban a member"
    )
    .addUserOption(o =>
      o.setName("user")
        .setDescription(
          "Member"
        )
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription(
          "Reason"
        )
    )
);

add(
  new SlashCommandBuilder()
    .setName("unban")
    .setDescription(
      "Unban a user"
    )
    .addStringOption(o =>
      o.setName("user_id")
        .setDescription(
          "User ID"
        )
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription(
          "Reason"
        )
    )
);

add(
  new SlashCommandBuilder()
    .setName("softban")
    .setDescription(
      "Ban and remove recent messages"
    )
    .addUserOption(o =>
      o.setName("user")
        .setDescription(
          "Member"
        )
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription(
          "Reason"
        )
    )
);

add(
  new SlashCommandBuilder()
    .setName("clear")
    .setDescription(
      "Delete recent messages"
    )
    .addIntegerOption(o =>
      o.setName("amount")
        .setDescription(
          "1-100"
        )
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("slowmode")
    .setDescription(
      "Set channel slowmode"
    )
    .addIntegerOption(o =>
      o.setName("seconds")
        .setDescription(
          "0-21600"
        )
        .setMinValue(0)
        .setMaxValue(21600)
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("nick")
    .setDescription(
      "Change member nickname"
    )
    .addUserOption(o =>
      o.setName("user")
        .setDescription(
          "Member"
        )
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("nickname")
        .setDescription(
          "Nickname"
        )
        .setRequired(true)
    )
);

/* ---------- AUTOMOD ---------- */

add(
  new SlashCommandBuilder()
    .setName("automod")
    .setDescription(
      "Configure AutoMod"
    )
    .addSubcommand(s =>
      s.setName("enable")
        .setDescription(
          "Enable AutoMod"
        )
    )
    .addSubcommand(s =>
      s.setName("disable")
        .setDescription(
          "Disable AutoMod"
        )
    )
    .addSubcommand(s =>
      s.setName("status")
        .setDescription(
          "Show AutoMod status"
        )
    )
);

add(
  new SlashCommandBuilder()
    .setName("automodspam")
    .setDescription(
      "Configure spam protection"
    )
    .addIntegerOption(o =>
      o.setName("limit")
        .setDescription(
          "Message limit"
        )
        .setMinValue(2)
        .setMaxValue(30)
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("window")
        .setDescription(
          "Window in milliseconds"
        )
        .setMinValue(1000)
        .setMaxValue(60000)
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("automodcaps")
    .setDescription(
      "Configure caps protection"
    )
    .addIntegerOption(o =>
      o.setName("percent")
        .setDescription(
          "Caps percentage"
        )
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("automodword")
    .setDescription(
      "Add an AutoMod blocked word"
    )
    .addStringOption(o =>
      o.setName("word")
        .setDescription(
          "Blocked word"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("automodunword")
    .setDescription(
      "Remove an AutoMod blocked word"
    )
    .addStringOption(o =>
      o.setName("word")
        .setDescription(
          "Word"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("automodwords")
    .setDescription(
      "List blocked AutoMod words"
    )
);

add(
  new SlashCommandBuilder()
    .setName("automodlinks")
    .setDescription(
      "Enable or disable link protection"
    )
    .addBooleanOption(o =>
      o.setName("enabled")
        .setDescription(
          "Enabled"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("automodinvites")
    .setDescription(
      "Enable or disable invite protection"
    )
    .addBooleanOption(o =>
      o.setName("enabled")
        .setDescription(
          "Enabled"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("automodmentions")
    .setDescription(
      "Configure mass mention protection"
    )
    .addIntegerOption(o =>
      o.setName("users")
        .setDescription(
          "User mention limit"
        )
        .setMinValue(1)
        .setMaxValue(30)
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("roles")
        .setDescription(
          "Role mention limit"
        )
        .setMinValue(1)
        .setMaxValue(30)
        .setRequired(true)
    )
);

/* ---------- SECURITY ---------- */

add(
  new SlashCommandBuilder()
    .setName("security")
    .setDescription(
      "Configure server security"
    )
    .addSubcommand(s =>
      s.setName("enable")
        .setDescription(
          "Enable security"
        )
    )
    .addSubcommand(s =>
      s.setName("disable")
        .setDescription(
          "Disable security"
        )
    )
    .addSubcommand(s =>
      s.setName("status")
        .setDescription(
          "Show security status"
        )
    )
);

add(
  new SlashCommandBuilder()
    .setName("antiraid")
    .setDescription(
      "Configure anti raid"
    )
    .addIntegerOption(o =>
      o.setName("joins")
        .setDescription(
          "Join threshold"
        )
        .setMinValue(2)
        .setMaxValue(100)
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("seconds")
        .setDescription(
          "Time window"
        )
        .setMinValue(1)
        .setMaxValue(300)
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("antinuke")
    .setDescription(
      "Configure anti nuke"
    )
    .addStringOption(o =>
      o.setName("action")
        .setDescription(
          "Response"
        )
        .addChoices(
          {
            name: "Alert",
            value: "alert"
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
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("trust")
    .setDescription(
      "Trust a member or bot"
    )
    .addUserOption(o =>
      o.setName("user")
        .setDescription(
          "User"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("untrust")
    .setDescription(
      "Remove trusted user"
    )
    .addUserOption(o =>
      o.setName("user")
        .setDescription(
          "User"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("trustedlist")
    .setDescription(
      "Show trusted users and bots"
    )
);

add(
  new SlashCommandBuilder()
    .setName("trustedrole")
    .setDescription(
      "Set trusted security role"
    )
    .addRoleOption(o =>
      o.setName("role")
        .setDescription(
          "Role"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("protectrole")
    .setDescription(
      "Protect a role"
    )
    .addRoleOption(o =>
      o.setName("role")
        .setDescription(
          "Role"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("unprotectrole")
    .setDescription(
      "Remove protected role"
    )
    .addRoleOption(o =>
      o.setName("role")
        .setDescription(
          "Role"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("protectchannel")
    .setDescription(
      "Protect a channel"
    )
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription(
          "Channel"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("unprotectchannel")
    .setDescription(
      "Remove protected channel"
    )
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription(
          "Channel"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("lockdown")
    .setDescription(
      "Lock or unlock the server"
    )
    .addBooleanOption(o =>
      o.setName("enabled")
        .setDescription(
          "Enable lockdown"
        )
        .setRequired(true)
    )
);

/* ---------- TICKETS ---------- */

add(
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription(
      "Create a support ticket"
    )
);

add(
  new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription(
      "Create support ticket panel"
    )
);

add(
  new SlashCommandBuilder()
    .setName("ticketsetup")
    .setDescription(
      "Configure ticket system"
    )
    .addChannelOption(o =>
      o.setName("category")
        .setDescription(
          "Ticket category"
        )
        .addChannelTypes(
          ChannelType.GuildCategory
        )
        .setRequired(true)
    )
    .addRoleOption(o =>
      o.setName("staffrole")
        .setDescription(
          "Ticket staff role"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("ticketclose")
    .setDescription(
      "Close current ticket"
    )
);

add(
  new SlashCommandBuilder()
    .setName("ticketreopen")
    .setDescription(
      "Reopen current ticket"
    )
);

add(
  new SlashCommandBuilder()
    .setName("ticketdelete")
    .setDescription(
      "Delete current ticket"
    )
);

add(
  new SlashCommandBuilder()
    .setName("ticketclaim")
    .setDescription(
      "Claim current ticket"
    )
);

add(
  new SlashCommandBuilder()
    .setName("ticketunclaim")
    .setDescription(
      "Unclaim current ticket"
    )
);

add(
  new SlashCommandBuilder()
    .setName("ticketlock")
    .setDescription(
      "Lock current ticket"
    )
);

add(
  new SlashCommandBuilder()
    .setName("ticketunlock")
    .setDescription(
      "Unlock current ticket"
    )
);

add(
  new SlashCommandBuilder()
    .setName("ticketadd")
    .setDescription(
      "Add member to ticket"
    )
    .addUserOption(o =>
      o.setName("user")
        .setDescription(
          "Member"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("ticketremove")
    .setDescription(
      "Remove member from ticket"
    )
    .addUserOption(o =>
      o.setName("user")
        .setDescription(
          "Member"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("ticketrename")
    .setDescription(
      "Rename current ticket"
    )
    .addStringOption(o =>
      o.setName("name")
        .setDescription(
          "New name"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("ticketinfo")
    .setDescription(
      "Show ticket information"
    )
);

add(
  new SlashCommandBuilder()
    .setName("ticketstats")
    .setDescription(
      "Show ticket statistics"
    )
);

add(
  new SlashCommandBuilder()
    .setName("transcript")
    .setDescription(
      "Generate ticket transcript"
    )
);

add(
  new SlashCommandBuilder()
    .setName("ticketreply")
    .setDescription(
      "Reply to ticket owner by DM"
    )
    .addStringOption(o =>
      o.setName("message")
        .setDescription(
          "Message"
        )
        .setRequired(true)
    )
);

/* ---------- WELCOME / ROLES ---------- */

add(
  new SlashCommandBuilder()
    .setName("autorole")
    .setDescription(
      "Set automatic member role"
    )
    .addRoleOption(o =>
      o.setName("role")
        .setDescription(
          "Role"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("autoroleoff")
    .setDescription(
      "Disable automatic role"
    )
);

add(
  new SlashCommandBuilder()
    .setName("welcome")
    .setDescription(
      "Configure welcome system"
    )
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription(
          "Welcome channel"
        )
        .addChannelTypes(
          ChannelType.GuildText
        )
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("message")
        .setDescription(
          "Welcome message"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("welcomeoff")
    .setDescription(
      "Disable welcome system"
    )
);

add(
  new SlashCommandBuilder()
    .setName("leave")
    .setDescription(
      "Configure leave messages"
    )
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription(
          "Leave channel"
        )
        .addChannelTypes(
          ChannelType.GuildText
        )
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("message")
        .setDescription(
          "Leave message"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("leaveoff")
    .setDescription(
      "Disable leave messages"
    )
);

add(
  new SlashCommandBuilder()
    .setName("verification")
    .setDescription(
      "Create verification panel"
    )
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription(
          "Verification channel"
        )
        .addChannelTypes(
          ChannelType.GuildText
        )
        .setRequired(true)
    )
    .addRoleOption(o =>
      o.setName("role")
        .setDescription(
          "Verified role"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("verificationoff")
    .setDescription(
      "Disable verification"
    )
);

/* ---------- REACTION ROLES ---------- */

add(
  new SlashCommandBuilder()
    .setName("reactionrole")
    .setDescription(
      "Add reaction role"
    )
    .addStringOption(o =>
      o.setName("message_id")
        .setDescription(
          "Message ID"
        )
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("emoji")
        .setDescription(
          "Emoji"
        )
        .setRequired(true)
    )
    .addRoleOption(o =>
      o.setName("role")
        .setDescription(
          "Role"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("reactionrole-remove")
    .setDescription(
      "Remove reaction role"
    )
    .addStringOption(o =>
      o.setName("message_id")
        .setDescription(
          "Message ID"
        )
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("emoji")
        .setDescription(
          "Emoji"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("reactionrole-list")
    .setDescription(
      "List reaction roles"
    )
);

/* ---------- ANNOUNCEMENT ---------- */

add(
  new SlashCommandBuilder()
    .setName("announce")
    .setDescription(
      "Send a server announcement"
    )
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription(
          "Announcement channel"
        )
        .addChannelTypes(
          ChannelType.GuildText
        )
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("message")
        .setDescription(
          "Announcement"
        )
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("title")
        .setDescription(
          "Title"
        )
    )
    .addBooleanOption(o =>
      o.setName("everyone")
        .setDescription(
          "Mention everyone"
        )
    )
);

/* ---------- LOGGING ---------- */

add(
  new SlashCommandBuilder()
    .setName("logsetup")
    .setDescription(
      "Set unified log channel"
    )
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription(
          "Log channel"
        )
        .addChannelTypes(
          ChannelType.GuildText
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("logdisable")
    .setDescription(
      "Disable unified logs"
    )
);

add(
  new SlashCommandBuilder()
    .setName("logstatus")
    .setDescription(
      "Show logging status"
    )
);

add(
  new SlashCommandBuilder()
    .setName("auditlog")
    .setDescription(
      "Show recent Discord audit events"
    )
);

add(
  new SlashCommandBuilder()
    .setName("auditclear")
    .setDescription(
      "Clear local audit data"
    )
);

/* ---------- CONFIG ---------- */

add(
  new SlashCommandBuilder()
    .setName("config")
    .setDescription(
      "Show complete server configuration"
    )
);

add(
  new SlashCommandBuilder()
    .setName("configstaff")
    .setDescription(
      "Set support staff role"
    )
    .addRoleOption(o =>
      o.setName("role")
        .setDescription(
          "Staff role"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("configreset")
    .setDescription(
      "Reset AkiyO server configuration"
    )
);

/* ---------- ACTIVITY ---------- */

add(
  new SlashCommandBuilder()
    .setName("activity")
    .setDescription(
      "Show staff activity"
    )
    .addUserOption(o =>
      o.setName("user")
        .setDescription(
          "Staff member"
        )
    )
);

add(
  new SlashCommandBuilder()
    .setName("activitysetup")
    .setDescription(
      "Configure staff activity"
    )
    .addIntegerOption(o =>
      o.setName("minutes")
        .setDescription(
          "Required minutes"
        )
        .setMinValue(1)
        .setMaxValue(10080)
        .setRequired(true)
    )
    .addRoleOption(o =>
      o.setName("role")
        .setDescription(
          "Staff role"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("activitycheck")
    .setDescription(
      "Check staff activity"
    )
);

/* ---------- AI ---------- */

add(
  new SlashCommandBuilder()
    .setName("ai")
    .setDescription(
      "Ask AkiyO AI"
    )
    .addStringOption(o =>
      o.setName("prompt")
        .setDescription(
          "Question"
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("aireset")
    .setDescription(
      "Reset your AI conversation"
    )
);

add(
  new SlashCommandBuilder()
    .setName("aiconfig")
    .setDescription(
      "Configure AI audit settings"
    )
    .addBooleanOption(o =>
      o.setName("admin_audit")
        .setDescription(
          "Send AI audit to admin"
        )
        .setRequired(true)
    )
);

/* =========================================================
   COMMAND HANDLER
   ========================================================= */

async function handleCommand(i) {
  const cmd =
    i.commandName;

  await commandLog(i);

  try {
    if (!i.guild) {
      if (
        cmd === "ai"
      ) {
        await i.deferReply({
          ephemeral: true
        });

        const result =
          await askAI(
            i.user.id,
            i.options.getString(
              "prompt"
            )
          );

        if (result.error) {
          return reply(
            i,
            "🤖 AI Error",
            result.error,
            COLORS.danger,
            [],
            { ephemeral: true }
          );
        }

        return reply(
          i,
          "🤖 AkiyO AI",
          result.text,
          COLORS.purple,
          [],
          { ephemeral: true }
        );
      }

      return reply(
        i,
        "🏠 Server Command Required",
        "This command must be used inside a server.",
        COLORS.warning,
        [],
        { ephemeral: true }
      );
    }

    const c =
      guildConfig(i.guild);

    /* =====================================================
       HELP
       ===================================================== */

    if (cmd === "help") {
      return reply(
        i,
        "📚 AkiyO Command Center",
        "AkiyO is an all-in-one Discord support, moderation, security and management system.",
        COLORS.primary,
        [
          field(
            "🎫 Ticket System",
            "/ticket • /ticketpanel • /ticketsetup • /ticketclose • /ticketreopen • /ticketdelete • /ticketclaim • /ticketunclaim • /ticketlock • /ticketunlock • /ticketadd • /ticketremove • /ticketrename • /ticketinfo • /ticketstats • /transcript • /ticketreply"
          ),

          field(
            "🛡️ Moderation",
            "/warn • /warnings • /clearwarnings • /punishments • /timeout • /untimeout • /kick • /ban • /unban • /softban • /clear • /slowmode • /nick"
          ),

          field(
            "🤖 AutoMod",
            "/automod • /automodspam • /automodcaps • /automodword • /automodunword • /automodwords • /automodlinks • /automodinvites • /automodmentions"
          ),

          field(
            "🔐 Security",
            "/security • /antiraid • /antinuke • /trust • /untrust • /trustedlist • /trustedrole • /protectrole • /unprotectrole • /protectchannel • /unprotectchannel • /lockdown"
          ),

          field(
            "👋 Member Systems",
            "/autorole • /autoroleoff • /welcome • /welcomeoff • /leave • /leaveoff • /verification • /verificationoff"
          ),

          field(
            "🎭 Reaction Roles",
            "/reactionrole • /reactionrole-remove • /reactionrole-list"
          ),

          field(
            "📋 Logs & Configuration",
            "/logsetup • /logdisable • /logstatus • /auditlog • /auditclear • /config • /configstaff • /configreset"
          ),

          field(
            "📢 Announcements",
            "/announce"
          ),

          field(
            "📊 Staff Activity",
            "/activity • /activitysetup • /activitycheck"
          ),

          field(
            "🤖 AI",
            "/ai • /aireset • /aiconfig"
          ),

          field(
            "ℹ️ General",
            "/botinfo • /ping • /serverinfo • /userinfo • /avatar • /membercount • /roleinfo • /channelinfo"
          )
        ]
      );
    }

    /* =====================================================
       GENERAL
       ===================================================== */

    if (cmd === "ping") {
      return reply(
        i,
        "🏓 Pong!",
        `Latency: **${client.ws.ping}ms**`,
        COLORS.success
      );
    }

    if (cmd === "botinfo") {
      return reply(
        i,
        "🤖 AkiyO Information",
        "Professional all-in-one Discord management bot.",
        COLORS.primary,
        [
          field(
            "Bot",
            userTag(client.user)
          ),
          field(
            "Guilds",
            client.guilds.cache.size,
            true
          ),
          field(
            "Commands",
            commands.length,
            true
          ),
          field(
            "Node.js",
            process.version,
            true
          ),
          field(
            "Uptime",
            `${Math.floor(
              process.uptime() / 3600
            )}h ${Math.floor(
              process.uptime() / 60
            ) % 60}m`,
            true
          ),
          field(
            "AI",
            OPENAI_API_KEY
              ? "Configured"
              : "Not configured",
            true
          )
        ]
      );
    }

    if (cmd === "serverinfo") {
      return reply(
        i,
        "🏠 Server Information",
        `Information about **${i.guild.name}**`,
        COLORS.primary,
        [
          field(
            "Owner",
            userMention(
              i.guild.ownerId
            )
          ),
          field(
            "Members",
            i.guild.memberCount
          ),
          field(
            "Channels",
            i.guild.channels.cache.size
          ),
          field(
            "Roles",
            i.guild.roles.cache.size
          ),
          field(
            "Created",
            `<t:${Math.floor(
              i.guild.createdTimestamp /
                1000
            )}:F>`
          ),
          field(
            "Server ID",
            i.guild.id
          )
        ]
      );
    }

    if (cmd === "membercount") {
      return reply(
        i,
        "👥 Member Count",
        `This server currently has **${i.guild.memberCount} members**.`,
        COLORS.success
      );
    }

    if (cmd === "userinfo") {
      const user =
        i.options.getUser(
          "user"
        ) || i.user;

      const member =
        await i.guild.members
          .fetch(user.id)
          .catch(() => null);

      return reply(
        i,
        "👤 User Information",
        `Information for **${user.tag}**`,
        COLORS.primary,
        [
          field(
            "User",
            userTag(user)
          ),
          field(
            "ID",
            user.id
          ),
          field(
            "Created",
            `<t:${Math.floor(
              user.createdTimestamp /
                1000
            )}:F>`
          ),
          field(
            "Joined",
            member?.joinedTimestamp
              ? `<t:${Math.floor(
                  member.joinedTimestamp /
                    1000
                )}:F>`
              : "Unknown"
          ),
          field(
            "Roles",
            member
              ? member.roles.cache
                  .filter(
                    r =>
                      r.id !==
                      i.guild.id
                  )
                  .map(
                    r =>
                      `${r}`
                  )
                  .join(", ") ||
                "None"
              : "Not in server"
          )
        ]
      );
    }

    if (cmd === "avatar") {
      const user =
        i.options.getUser(
          "user"
        ) || i.user;

      return reply(
        i,
        "🖼️ Avatar",
        `[Open avatar](${user.displayAvatarURL({
          size: 4096,
          extension: "png"
        })})`,
        COLORS.primary
      );
    }

    if (cmd === "roleinfo") {
      const role =
        i.options.getRole(
          "role"
        );

      return reply(
        i,
        "🎭 Role Information",
        `Information about ${role}`,
        COLORS.primary,
        [
          field(
            "Name",
            role.name
          ),
          field(
            "ID",
            role.id
          ),
          field(
            "Position",
            role.position
          ),
          field(
            "Members",
            role.members.size
          ),
          field(
            "Mentionable",
            role.mentionable
              ? "Yes"
              : "No"
          ),
          field(
            "Managed",
            role.managed
              ? "Yes"
              : "No"
          )
        ]
      );
    }

    if (cmd === "channelinfo") {
      const channel =
        i.options.getChannel(
          "channel"
        ) || i.channel;

      return reply(
        i,
        "📁 Channel Information",
        `Information about ${channel}`,
        COLORS.primary,
        [
          field(
            "Name",
            channel.name
          ),
          field(
            "ID",
            channel.id
          ),
          field(
            "Type",
            String(channel.type)
          ),
          field(
            "Parent",
            channel.parent
              ? `${channel.parent}`
              : "None"
          )
        ]
      );
    }

    /* =====================================================
       MODERATION
       ===================================================== */

    if (
      [
        "warn",
        "warnings",
        "clearwarnings",
        "punishments",
        "timeout",
        "untimeout",
        "kick",
        "ban",
        "unban",
        "softban",
        "clear",
        "slowmode",
        "nick"
      ].includes(cmd)
    ) {
      if (!isModerator(i.member)) {
        return reply(
          i,
          "🔒 Permission Required",
          "You do not have permission to use this moderation command.",
          COLORS.danger,
          [],
          { ephemeral: true }
        );
      }

      if (
        cmd === "warnings" ||
        cmd === "punishments"
      ) {
        const user =
          i.options.getUser(
            "user"
          );

        const records =
          cmd === "warnings"
            ? (
                c.warnings[
                  user.id
                ] || []
              )
            : (
                c.punishments[
                  user.id
                ] || []
              );

        const text =
          records
            .slice(-20)
            .reverse()
            .map(
              (x, n) =>
                `**${n + 1}.** ${x.type || "warn"} • ${safe(x.reason, 180)} • <@${x.moderatorId}> • <t:${Math.floor(
                  (
                    x.timestamp ||
                    x.time ||
                    Date.now()
                  ) / 1000
                )}:R>`
            )
            .join("\n") ||
          "No records.";

        return reply(
          i,
          cmd === "warnings"
            ? "⚠️ Warning History"
            : "📜 Punishment History",
          text,
          COLORS.primary,
          [
            field(
              "Member",
              userTag(user)
            ),
            field(
              "Records",
              records.length
            )
          ]
        );
      }

      if (cmd === "clearwarnings") {
        const user =
          i.options.getUser(
            "user"
          );

        c.warnings[user.id] = [];
        saveDB();

        return reply(
          i,
          "🧹 Warnings Cleared",
          `Warnings for ${user} have been cleared.`,
          COLORS.success
        );
      }

      if (cmd === "clear") {
        const amount =
          i.options.getInteger(
            "amount"
          );

        const deleted =
          await i.channel.bulkDelete(
            amount,
            true
          );

        await log(
          i.guild,
          "moderation",
          "🧹 Messages Cleared",
          [
            field(
              "Moderator",
              userTag(i.user)
            ),
            field(
              "Channel",
              `${i.channel}`
            ),
            field(
              "Deleted",
              deleted.size
            )
          ],
          COLORS.danger
        );

        return reply(
          i,
          "🧹 Messages Cleared",
          `Deleted **${deleted.size} messages**.`,
          COLORS.success
        );
      }

      if (cmd === "slowmode") {
        const seconds =
          i.options.getInteger(
            "seconds"
          );

        if (
          !i.channel.setRateLimitPerUser
        ) {
          return reply(
            i,
            "⚠️ Unsupported Channel",
            "Slowmode cannot be configured here.",
            COLORS.danger
          );
        }

        await i.channel.setRateLimitPerUser(
          seconds
        );

        return reply(
          i,
          "🐢 Slowmode Updated",
          `Slowmode is now **${seconds}s**.`,
          COLORS.success
        );
      }

      if (cmd === "nick") {
        const user =
          i.options.getUser(
            "user"
          );

        const member =
          await i.guild.members
            .fetch(user.id);

        if (
          !canModerate(
            i,
            member
          )
        ) {
          return reply(
            i,
            "⚠️ Hierarchy Protection",
            "AkiyO cannot modify this member.",
            COLORS.danger
          );
        }

        const nickname =
          i.options.getString(
            "nickname"
          );

        await member.setNickname(
          nickname
        );

        return reply(
          i,
          "✏️ Nickname Updated",
          `${user}'s nickname was changed.`,
          COLORS.success
        );
      }

      if (cmd === "unban") {
        const id =
          i.options.getString(
            "user_id"
          );

        const reason =
          i.options.getString(
            "reason"
          ) ||
          "No reason provided";

        await i.guild.members.unban(
          id,
          reason
        );

        addPunishment(
          i.guild,
          id,
          "unban",
          reason,
          i.user.id
        );

        return reply(
          i,
          "🔓 User Unbanned",
          `User ID **${id}** has been unbanned.`,
          COLORS.success
        );
      }

      const user =
        i.options.getUser(
          "user"
        );

      const member =
        await i.guild.members
          .fetch(user.id)
          .catch(() => null);

      if (!member) {
        return reply(
          i,
          "⚠️ Member Not Found",
          "The selected user is not currently in this server.",
          COLORS.danger
        );
      }

      if (
        !canModerate(
          i,
          member
        )
      ) {
        return reply(
          i,
          "⚠️ Hierarchy Protection",
          "AkiyO or your role cannot moderate this member.",
          COLORS.danger
        );
      }

      const reason =
        i.options.getString(
          "reason"
        ) ||
        "No reason provided";

      if (cmd === "warn") {
        const count =
          await warnMember(
            member,
            reason,
            i.user
          );

        try {
          await user.send({
            embeds: [
              makeEmbed(
                "⚠️ Warning Received",
                `You received a warning in **${i.guild.name}**.`,
                COLORS.warning,
                i.guild,
                [
                  field(
                    "Reason",
                    reason
                  ),
                  field(
                    "Warnings",
                    count
                  )
                ]
              )
            ]
          });
        } catch {}

        return reply(
          i,
          "⚠️ Warning Issued",
          `${user} has been warned.`,
          COLORS.success,
          [
            field(
              "Reason",
              reason
            ),
            field(
              "Warning Count",
              count
            )
          ]
        );
      }

      if (cmd === "timeout") {
        const duration =
          i.options.getString(
            "duration"
          );

        const ms =
          parseDuration(
            duration
          );

        if (!ms) {
          return reply(
            i,
            "⚠️ Invalid Duration",
            "Use `30s`, `10m`, `2h`, `1d` or `1w`. Maximum Discord timeout is 28 days.",
            COLORS.danger
          );
        }

        await member.timeout(
          ms,
          reason
        );

        addPunishment(
          i.guild,
          user.id,
          "timeout",
          reason,
          i.user.id,
          ms
        );

        return reply(
          i,
          "⏱️ Member Timed Out",
          `${user} has been timed out.`,
          COLORS.success,
          [
            field(
              "Duration",
              duration
            ),
            field(
              "Reason",
              reason
            )
          ]
        );
      }

      if (cmd === "untimeout") {
        await member.timeout(
          null,
          "AkiyO timeout removed"
        );

        return reply(
          i,
          "🔓 Timeout Removed",
          `${user} is no longer timed out.`,
          COLORS.success
        );
      }

      if (cmd === "kick") {
        await member.kick(
          reason
        );

        addPunishment(
          i.guild,
          user.id,
          "kick",
          reason,
          i.user.id
        );

        return reply(
          i,
          "👢 Member Kicked",
          `${user} has been kicked.`,
          COLORS.success
        );
      }

      if (
        cmd === "ban" ||
        cmd === "softban"
      ) {
        await member.ban({
          reason,
          deleteMessageSeconds:
            cmd === "softban"
              ? 86400
              : 0
        });

        addPunishment(
          i.guild,
          user.id,
          cmd,
          reason,
          i.user.id
        );

        return reply(
          i,
          cmd === "ban"
            ? "🔨 Member Banned"
            : "🔨 Softban Complete",
          `${user} has been ${cmd === "ban" ? "banned" : "softbanned"}.`,
          COLORS.success
        );
      }
    }

    /* =====================================================
       AUTOMOD
       ===================================================== */

    if (
      [
        "automod",
        "automodspam",
        "automodcaps",
        "automodword",
        "automodunword",
        "automodwords",
        "automodlinks",
        "automodinvites",
        "automodmentions"
      ].includes(cmd)
    ) {
      if (!isManager(i.member)) {
        return reply(
          i,
          "🔒 Permission Required",
          "Manage Server or Administrator is required.",
          COLORS.danger,
          [],
          { ephemeral: true }
        );
      }

      if (cmd === "automod") {
        const sub =
          i.options.getSubcommand();

        if (
          sub === "enable"
        ) {
          c.automod.enabled =
            true;
        }

        if (
          sub === "disable"
        ) {
          c.automod.enabled =
            false;
        }

        if (
          sub === "status"
        ) {
          return reply(
            i,
            "🤖 AutoMod Status",
            "Current AutoMod configuration.",
            c.automod.enabled
              ? COLORS.success
              : COLORS.warning,
            [
              field(
                "Status",
                c.automod.enabled
                  ? "🟢 Enabled"
                  : "🔴 Disabled"
              ),
              field(
                "Spam",
                `${c.automod.spam.limit} / ${c.automod.spam.window / 1000}s`
              ),
              field(
                "Caps",
                `${c.automod.caps.percent}%`
              ),
              field(
                "Blocked Words",
                c.automod.badword.words.length
              ),
              field(
                "Invites",
                c.automod.invite.enabled
                  ? "Enabled"
                  : "Disabled"
              ),
              field(
                "Links",
                c.automod.links.enabled
                  ? "Enabled"
                  : "Disabled"
              ),
              field(
                "Mass Mentions",
                c.automod.massMention.enabled
                  ? "Enabled"
                  : "Disabled"
              )
            ]
          );
        }

        saveDB();

        return reply(
          i,
          "🤖 AutoMod Updated",
          `AutoMod is now **${c.automod.enabled ? "enabled" : "disabled"}**.`,
          COLORS.success
        );
      }

      if (cmd === "automodspam") {
        c.automod.spam.limit =
          i.options.getInteger(
            "limit"
          );

        c.automod.spam.window =
          i.options.getInteger(
            "window"
          );

        saveDB();

        return reply(
          i,
          "🤖 Spam Protection Updated",
          "Spam detection configuration saved.",
          COLORS.success
        );
      }

      if (cmd === "automodcaps") {
        c.automod.caps.percent =
          i.options.getInteger(
            "percent"
          );

        saveDB();

        return reply(
          i,
          "🔠 Caps Protection Updated",
          `Caps threshold: **${c.automod.caps.percent}%**`,
          COLORS.success
        );
      }

      if (cmd === "automodword") {
        const word =
          i.options.getString(
            "word"
          ).trim();

        if (
          !c.automod.badword.words
            .includes(word)
        ) {
          c.automod.badword.words
            .push(word);
        }

        saveDB();

        return reply(
          i,
          "🚫 Blocked Word Added",
          `\`${word}\` has been added to AutoMod.`,
          COLORS.success
        );
      }

      if (cmd === "automodunword") {
        const word =
          i.options.getString(
            "word"
          ).trim();

        c.automod.badword.words =
          c.automod.badword.words
            .filter(
              x =>
                x.toLowerCase() !==
                word.toLowerCase()
            );

        saveDB();

        return reply(
          i,
          "🚫 Blocked Word Removed",
          `\`${word}\` has been removed.`,
          COLORS.success
        );
      }

      if (cmd === "automodwords") {
        return reply(
          i,
          "🚫 AutoMod Blocked Words",
          c.automod.badword.words
            .map(
              (x, n) =>
                `${n + 1}. \`${x}\``
            )
            .join("\n") ||
            "No blocked words configured.",
          COLORS.primary
        );
      }

      if (cmd === "automodlinks") {
        c.automod.links.enabled =
          i.options.getBoolean(
            "enabled"
          );

        saveDB();

        return reply(
          i,
          "🔗 Link Protection",
          `Link protection is now **${c.automod.links.enabled ? "enabled" : "disabled"}**.`,
          COLORS.success
        );
      }

      if (cmd === "automodinvites") {
        c.automod.invite.enabled =
          i.options.getBoolean(
            "enabled"
          );

        saveDB();

        return reply(
          i,
          "📨 Invite Protection",
          `Invite protection is now **${c.automod.invite.enabled ? "enabled" : "disabled"}**.`,
          COLORS.success
        );
      }

      if (cmd === "automodmentions") {
        c.automod.massMention.users =
          i.options.getInteger(
            "users"
          );

        c.automod.massMention.roles =
          i.options.getInteger(
            "roles"
          );

        saveDB();

        return reply(
          i,
          "📣 Mention Protection",
          "Mass mention limits updated.",
          COLORS.success
        );
      }
    }

    /* =====================================================
       SECURITY
       ===================================================== */

    if (
      [
        "security",
        "antiraid",
        "antinuke",
        "trust",
        "untrust",
        "trustedlist",
        "trustedrole",
        "protectrole",
        "unprotectrole",
        "protectchannel",
        "unprotectchannel",
        "lockdown"
      ].includes(cmd)
    ) {
      if (!isManager(i.member)) {
        return reply(
          i,
          "🔒 Permission Required",
          "Administrator or Manage Server is required.",
          COLORS.danger,
          [],
          { ephemeral: true }
        );
      }

      if (cmd === "security") {
        const sub =
          i.options.getSubcommand();

        if (
          sub === "enable"
        ) {
          c.security.enabled =
            true;
        }

        if (
          sub === "disable"
        ) {
          c.security.enabled =
            false;
        }

        if (
          sub === "status"
        ) {
          return reply(
            i,
            "🔐 Security Status",
            "AkiyO server security configuration.",
            COLORS.primary,
            [
              field(
                "Security",
                c.security.enabled
                  ? "🟢 Enabled"
                  : "🔴 Disabled"
              ),
              field(
                "Anti-Raid",
                c.security.antiRaid.enabled
                  ? "Enabled"
                  : "Disabled"
              ),
              field(
                "Anti-Nuke",
                c.security.antiNuke.enabled
                  ? "Enabled"
                  : "Disabled"
              ),
              field(
                "Trusted Members",
                c.security.trustedMembers.length
              ),
              field(
                "Trusted Bots",
                c.security.trustedBots.length
              ),
              field(
                "Protected Roles",
                c.security.protectedRoles.length
              ),
              field(
                "Protected Channels",
                c.security.protectedChannels.length
              ),
              field(
                "Lockdown",
                c.lockdown.enabled
                  ? "🔒 Active"
                  : "Open"
              )
            ]
          );
        }

        saveDB();

        return reply(
          i,
          "🔐 Security Updated",
          `Security is now **${c.security.enabled ? "enabled" : "disabled"}**.`,
          COLORS.success
        );
      }

      if (cmd === "antiraid") {
        c.security.antiRaid.joins =
          i.options.getInteger(
            "joins"
          );

        c.security.antiRaid.window =
          i.options.getInteger(
            "seconds"
          ) * 1000;

        saveDB();

        return reply(
          i,
          "🚨 Anti-Raid Updated",
          `Raid threshold: **${c.security.antiRaid.joins} joins / ${c.security.antiRaid.window / 1000}s**`,
          COLORS.success
        );
      }

      if (cmd === "antinuke") {
        c.security.antiNuke.action =
          i.options.getString(
            "action"
          );

        saveDB();

        return reply(
          i,
          "🛡️ Anti-Nuke Updated",
          `Anti-Nuke response: **${c.security.antiNuke.action}**`,
          COLORS.success
        );
      }

      if (cmd === "trust") {
        const user =
          i.options.getUser(
            "user"
          );

        if (
          user.bot
        ) {
          if (
            !c.security.trustedBots
              .includes(user.id)
          ) {
            c.security.trustedBots
              .push(user.id);
          }
        } else {
          if (
            !c.security.trustedMembers
              .includes(user.id)
          ) {
            c.security.trustedMembers
              .push(user.id);
          }
        }

        saveDB();

        return reply(
          i,
          "🛡️ Trusted",
          `${user} has been added to the trusted list.`,
          COLORS.success
        );
      }

      if (cmd === "untrust") {
        const user =
          i.options.getUser(
            "user"
          );

        c.security.trustedMembers =
          c.security.trustedMembers
            .filter(
              x =>
                x !== user.id
            );

        c.security.trustedBots =
          c.security.trustedBots
            .filter(
              x =>
                x !== user.id
            );

        saveDB();

        return reply(
          i,
          "🛡️ Trust Removed",
          `${user} is no longer trusted.`,
          COLORS.success
        );
      }

      if (cmd === "trustedlist") {
        return reply(
          i,
          "🛡️ Trusted Resources",
          "Current trusted members and bots.",
          COLORS.primary,
          [
            field(
              "Trusted Members",
              c.security.trustedMembers
                .map(
                  userMention
                )
                .join(", ") ||
                "None"
            ),
            field(
              "Trusted Bots",
              c.security.trustedBots
                .map(
                  userMention
                )
                .join(", ") ||
                "None"
            ),
            field(
              "Trusted Role",
              roleMention(
                c.security.trustedRole
              )
            )
          ]
        );
      }

      if (cmd === "trustedrole") {
        const role =
          i.options.getRole(
            "role"
          );

        c.security.trustedRole =
          role.id;

        saveDB();

        return reply(
          i,
          "🛡️ Trusted Role Updated",
          `${role} is now a trusted security role.`,
          COLORS.success
        );
      }

      if (
        cmd === "protectrole"
      ) {
        const role =
          i.options.getRole(
            "role"
          );

        if (
          !c.security.protectedRoles
            .includes(role.id)
        ) {
          c.security.protectedRoles
            .push(role.id);
        }

        saveDB();

        return reply(
          i,
          "🛡️ Role Protected",
          `${role} is now protected.`,
          COLORS.success
        );
      }

      if (
        cmd === "unprotectrole"
      ) {
        const role =
          i.options.getRole(
            "role"
          );

        c.security.protectedRoles =
          c.security.protectedRoles
            .filter(
              x =>
                x !== role.id
            );

        saveDB();

        return reply(
          i,
          "🛡️ Role Protection Removed",
          `${role} is no longer protected.`,
          COLORS.success
        );
      }

      if (
        cmd === "protectchannel"
      ) {
        const channel =
          i.options.getChannel(
            "channel"
          );

        if (
          !c.security.protectedChannels
            .includes(channel.id)
        ) {
          c.security.protectedChannels
            .push(channel.id);
        }

        saveDB();

        return reply(
          i,
          "🛡️ Channel Protected",
          `${channel} is now protected.`,
          COLORS.success
        );
      }

      if (
        cmd === "unprotectchannel"
      ) {
        const channel =
          i.options.getChannel(
            "channel"
          );

        c.security.protectedChannels =
          c.security.protectedChannels
            .filter(
              x =>
                x !== channel.id
            );

        saveDB();

        return reply(
          i,
          "🛡️ Channel Protection Removed",
          `${channel} is no longer protected.`,
          COLORS.success
        );
      }

      if (cmd === "lockdown") {
        const enabled =
          i.options.getBoolean(
            "enabled"
          );

        c.lockdown.enabled =
          enabled;

        saveDB();

        return reply(
          i,
          enabled
            ? "🔒 Server Lockdown Enabled"
            : "🔓 Server Lockdown Disabled",
          enabled
            ? "AkiyO lockdown mode is active."
            : "AkiyO lockdown mode has been disabled.",
          enabled
            ? COLORS.warning
            : COLORS.success
        );
      }
    }

    /* =====================================================
       TICKETS
       ===================================================== */

    if (
      [
        "ticket",
        "ticketpanel",
        "ticketsetup",
        "ticketclose",
        "ticketreopen",
        "ticketdelete",
        "ticketclaim",
        "ticketunclaim",
        "ticketlock",
        "ticketunlock",
        "ticketadd",
        "ticketremove",
        "ticketrename",
        "ticketinfo",
        "ticketstats",
        "transcript",
        "ticketreply"
      ].includes(cmd)
    ) {
      if (
        cmd === "ticket"
      ) {
        if (
          !c.ticket.enabled
        ) {
          return reply(
            i,
            "🎫 Tickets Disabled",
            "The ticket system is disabled.",
            COLORS.warning
          );
        }

        if (
          !c.ticket.categoryId
        ) {
          return reply(
            i,
            "🎫 Setup Required",
            "Run `/ticketsetup` first.",
            COLORS.warning
          );
        }

        const record =
          await createTicket(
            i.guild,
            i.user
          );

        return reply(
          i,
          "🎫 Ticket Ready",
          `Your ticket is ready: <#${record.channelId}>`,
          COLORS.success
        );
      }

      if (
        cmd === "ticketpanel"
      ) {
        if (
          !isManager(i.member)
        ) {
          return reply(
            i,
            "🔒 Permission Required",
            "Manage Server is required.",
            COLORS.danger
          );
        }

        const row =
          new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(
                  "akiyo_create_ticket"
                )
                .setLabel(
                  "Open Support Ticket"
                )
                .setEmoji("🎫")
                .setStyle(
                  ButtonStyle.Primary
                )
            );

        const message =
          await i.channel.send({
            embeds: [
              makeEmbed(
                "🎫 AkiyO Support Center",
                "Need help? Click the button below to create a private support ticket.",
                COLORS.primary,
                i.guild,
                [
                  field(
                    "Private",
                    "Only you and authorized staff can access the ticket."
                  ),
                  field(
                    "DM Support",
                    "You can also reply to AkiyO's ticket DM."
                  )
                ]
              )
            ],
            components: [
              row
            ]
          });

        c.ticket.panelChannelId =
          i.channel.id;

        c.ticket.panelMessageId =
          message.id;

        saveDB();

        return reply(
          i,
          "🎫 Ticket Panel Created",
          `Ticket panel published in ${i.channel}.`,
          COLORS.success
        );
      }

      if (
        cmd === "ticketsetup"
      ) {
        if (
          !isManager(i.member)
        ) {
          return reply(
            i,
            "🔒 Permission Required",
            "Manage Server is required.",
            COLORS.danger
          );
        }

        c.ticket.categoryId =
          i.options.getChannel(
            "category"
          ).id;

        c.ticket.staffRoleId =
          i.options.getRole(
            "staffrole"
          ).id;

        saveDB();

        return reply(
          i,
          "🎫 Ticket System Configured",
          "Ticket configuration has been saved.",
          COLORS.success,
          [
            field(
              "Category",
              channelMention(
                c.ticket.categoryId
              )
            ),
            field(
              "Staff Role",
              roleMention(
                c.ticket.staffRoleId
              )
            )
          ]
        );
      }

      if (
        cmd === "ticketstats"
      ) {
        if (
          !isStaff(i.member)
        ) {
          return reply(
            i,
            "🔒 Staff Required",
            "Only ticket staff can view ticket statistics.",
            COLORS.danger
          );
        }

        const records =
          Object.values(
            c.ticket.records
          );

        return reply(
          i,
          "📊 Ticket Statistics",
          "Current ticket workload.",
          COLORS.primary,
          [
            field(
              "Total",
              records.length,
              true
            ),
            field(
              "Open",
              records.filter(
                x =>
                  x.status ===
                  "open"
              ).length,
              true
            ),
            field(
              "Closed",
              records.filter(
                x =>
                  x.status ===
                  "closed"
              ).length,
              true
            ),
            field(
              "Deleted",
              records.filter(
                x =>
                  x.status ===
                  "deleted"
              ).length,
              true
            )
          ]
        );
      }

      const record =
        findTicketByChannel(
          i.guild,
          i.channel.id
        );

      if (
        !record &&
        cmd !==
          "ticketreply"
      ) {
        return reply(
          i,
          "🎫 Ticket Not Found",
          "This command must be used inside an AkiyO ticket.",
          COLORS.warning,
          [],
          { ephemeral: true }
        );
      }

      if (
        cmd ===
        "ticketreply"
      ) {
        if (
          !isStaff(i.member)
        ) {
          return reply(
            i,
            "🔒 Staff Required",
            "Only support staff can use ticket DM replies.",
            COLORS.danger
          );
        }

        if (!record) {
          return reply(
            i,
            "🎫 Ticket Not Found",
            "No ticket exists in this channel.",
            COLORS.warning
          );
        }

        const user =
          await client.users
            .fetch(
              record.ownerId
            )
            .catch(() => null);

        if (!user) {
          return reply(
            i,
            "⚠️ User Not Found",
            "Unable to contact the ticket owner.",
            COLORS.danger
          );
        }

        const message =
          i.options.getString(
            "message"
          );

        await user.send({
          embeds: [
            makeEmbed(
              "🎫 Support Staff Reply",
              message,
              COLORS.primary,
              i.guild,
              [
                field(
                  "Server",
                  i.guild.name
                ),
                field(
                  "Staff",
                  userTag(i.user)
                )
              ]
            )
          ]
        });

        return reply(
          i,
          "📩 DM Sent",
          "Your message was sent to the ticket owner.",
          COLORS.success
        );
      }

      if (
        !isStaff(i.member) &&
        i.user.id !==
          record.ownerId
      ) {
        return reply(
          i,
          "🔒 Ticket Access Denied",
          "You are not authorized to manage this ticket.",
          COLORS.danger,
          [],
          { ephemeral: true }
        );
      }

      if (
        cmd ===
        "ticketclose"
      ) {
        await closeTicket(
          i.guild,
          record,
          i.user
        );

        return reply(
          i,
          "🔒 Ticket Closed",
          "This ticket has been closed.",
          COLORS.warning
        );
      }

      if (
        cmd ===
        "ticketreopen"
      ) {
        if (
          !isStaff(i.member)
        ) {
          return reply(
            i,
            "🔒 Staff Required",
            "Only staff can reopen tickets.",
            COLORS.danger
          );
        }

        record.status =
          "open";

        record.closedAt =
          null;

        await i.channel
          .permissionOverwrites
          .edit(
            record.ownerId,
            {
              ViewChannel: true,
              SendMessages: true,
              ReadMessageHistory: true
            }
          );

        saveDB();

        return reply(
          i,
          "🔓 Ticket Reopened",
          "The ticket is active again.",
          COLORS.success
        );
      }

      if (
        cmd ===
        "ticketdelete"
      ) {
        if (
          !isStaff(i.member)
        ) {
          return reply(
            i,
            "🔒 Staff Required",
            "Only staff can delete tickets.",
            COLORS.danger
          );
        }

        record.status =
          "deleted";

        saveDB();

        await log(
          i.guild,
          "tickets",
          "🗑️ Ticket Deleted",
          [
            field(
              "Owner",
              userMention(
                record.ownerId
              )
            ),
            field(
              "Deleted By",
              userTag(i.user)
            )
          ],
          COLORS.danger
        );

        await i.channel
          .delete(
            "AkiyO ticket deleted"
          )
          .catch(() => {});

        return;
      }

      if (
        cmd ===
          "ticketclaim" ||
        cmd ===
          "ticketunclaim"
      ) {
        if (
          !isStaff(i.member)
        ) {
          return reply(
            i,
            "🔒 Staff Required",
            "Only staff can claim tickets.",
            COLORS.danger
          );
        }

        record.claimedBy =
          cmd ===
          "ticketclaim"
            ? i.user.id
            : null;

        saveDB();

        return reply(
          i,
          cmd ===
            "ticketclaim"
            ? "🙋 Ticket Claimed"
            : "↩️ Ticket Unclaimed",
          cmd ===
            "ticketclaim"
            ? "You are now assigned to this ticket."
            : "This ticket is available to staff.",
          COLORS.success
        );
      }

      if (
        cmd ===
          "ticketlock" ||
        cmd ===
          "ticketunlock"
      ) {
        if (
          !isStaff(i.member)
        ) {
          return reply(
            i,
            "🔒 Staff Required",
            "Only staff can lock tickets.",
            COLORS.danger
          );
        }

        record.locked =
          cmd ===
          "ticketlock";

        await i.channel
          .permissionOverwrites
          .edit(
            record.ownerId,
            {
              SendMessages:
                !record.locked
            }
          );

        saveDB();

        return reply(
          i,
          record.locked
            ? "🔐 Ticket Locked"
            : "🔓 Ticket Unlocked",
          record.locked
            ? "The ticket owner cannot send messages."
            : "The ticket owner can send messages again.",
          COLORS.success
        );
      }

      if (
        cmd ===
          "ticketadd" ||
        cmd ===
          "ticketremove"
      ) {
        if (
          !isStaff(i.member)
        ) {
          return reply(
            i,
            "🔒 Staff Required",
            "Only staff can manage ticket members.",
            COLORS.danger
          );
        }

        const user =
          i.options.getUser(
            "user"
          );

        if (
          cmd ===
          "ticketadd"
        ) {
          await i.channel
            .permissionOverwrites
            .edit(
              user.id,
              {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
              }
            );
        } else {
          await i.channel
            .permissionOverwrites
            .delete(
              user.id
            )
            .catch(() => {});
        }

        return reply(
          i,
          cmd ===
            "ticketadd"
            ? "👤 Member Added"
            : "👤 Member Removed",
          `${user} ticket access updated.`,
          COLORS.success
        );
      }

      if (
        cmd ===
        "ticketrename"
      ) {
        if (
          !isStaff(i.member)
        ) {
          return reply(
            i,
            "🔒 Staff Required",
            "Only staff can rename tickets.",
            COLORS.danger
          );
        }

        const name =
          i.options
            .getString(
              "name"
            )
            .replace(
              /[^a-zA-Z0-9-_]/g,
              "-"
            )
            .slice(
              0,
              90
            );

        await i.channel
          .setName(name);

        return reply(
          i,
          "✏️ Ticket Renamed",
          `Ticket renamed to **${name}**.`,
          COLORS.success
        );
      }

      if (
        cmd ===
        "ticketinfo"
      ) {
        return reply(
          i,
          "🎫 Ticket Information",
          "Current ticket details.",
          COLORS.primary,
          [
            field(
              "Owner",
              userMention(
                record.ownerId
              )
            ),
            field(
              "Status",
              record.status
            ),
            field(
              "Claimed By",
              record.claimedBy
                ? userMention(
                    record.claimedBy
                  )
                : "Nobody"
            ),
            field(
              "Locked",
              record.locked
                ? "Yes"
                : "No"
            ),
            field(
              "Created",
              `<t:${Math.floor(
                record.createdAt /
                  1000
              )}:F>`
            )
          ]
        );
      }

      if (
        cmd ===
        "transcript"
      ) {
        if (
          !isStaff(i.member)
        ) {
          return reply(
            i,
            "🔒 Staff Required",
            "Only staff can generate transcripts.",
            COLORS.danger
          );
        }

        const file =
          await ticketTranscript(
            i.channel
          );

        return i.reply({
          embeds: [
            makeEmbed(
              "📄 Ticket Transcript",
              "Transcript generated successfully.",
              COLORS.success,
              i.guild
            )
          ],
          files: [
            {
              attachment:
                file,
              name:
                `akiyo-ticket-${record.ownerId}.txt`
            }
          ]
        });
      }
    }

    /* =====================================================
       AUTOROLE / WELCOME / VERIFICATION
       ===================================================== */

    if (
      [
        "autorole",
        "autoroleoff",
        "welcome",
        "welcomeoff",
        "leave",
        "leaveoff",
        "verification",
        "verificationoff"
      ].includes(cmd)
    ) {
      if (
        !isManager(i.member)
      ) {
        return reply(
          i,
          "🔒 Permission Required",
          "Manage Server is required.",
          COLORS.danger
        );
      }

      if (
        cmd ===
        "autorole"
      ) {
        const role =
          i.options.getRole(
            "role"
          );

        if (
          role.position >=
          i.guild.members.me
            .roles.highest.position
        ) {
          return reply(
            i,
            "⚠️ Role Hierarchy",
            "AkiyO's highest role must be above the autorole.",
            COLORS.danger
          );
        }

        c.autorole.enabled =
          true;

        c.autorole.roleId =
          role.id;

        saveDB();

        return reply(
          i,
          "👤 Autorole Enabled",
          `New members will receive ${role}.`,
          COLORS.success
        );
      }

      if (
        cmd ===
        "autoroleoff"
      ) {
        c.autorole.enabled =
          false;

        saveDB();

        return reply(
          i,
          "👤 Autorole Disabled",
          "Automatic role assignment is disabled.",
          COLORS.warning
        );
      }

      if (
        cmd ===
        "welcome"
      ) {
        c.welcome.enabled =
          true;

        c.welcome.channelId =
          i.options.getChannel(
            "channel"
          ).id;

        c.welcome.message =
          i.options.getString(
            "message"
          );

        saveDB();

        return reply(
          i,
          "👋 Welcome System Enabled",
          "Welcome messages are now active.",
          COLORS.success,
          [
            field(
              "Channel",
              channelMention(
                c.welcome.channelId
              )
            ),
            field(
              "Placeholders",
              "{user} • {username} • {server} • {count}"
            )
          ]
        );
      }

      if (
        cmd ===
        "welcomeoff"
      ) {
        c.welcome.enabled =
          false;

        saveDB();

        return reply(
          i,
          "👋 Welcome Disabled",
          "Welcome messages have been disabled.",
          COLORS.warning
        );
      }

      if (
        cmd ===
        "leave"
      ) {
        c.leave.enabled =
          true;

        c.leave.channelId =
          i.options.getChannel(
            "channel"
          ).id;

        c.leave.message =
          i.options.getString(
            "message"
          );

        saveDB();

        return reply(
          i,
          "🚪 Leave System Enabled",
          "Leave messages are now active.",
          COLORS.success
        );
      }

      if (
        cmd ===
        "leaveoff"
      ) {
        c.leave.enabled =
          false;

        saveDB();

        return reply(
          i,
          "🚪 Leave System Disabled",
          "Leave messages have been disabled.",
          COLORS.warning
        );
      }

      if (
        cmd ===
        "verification"
      ) {
        const channel =
          i.options.getChannel(
            "channel"
          );

        const role =
          i.options.getRole(
            "role"
          );

        if (
          role.position >=
          i.guild.members.me
            .roles.highest.position
        ) {
          return reply(
            i,
            "⚠️ Role Hierarchy",
            "AkiyO cannot assign this verification role.",
            COLORS.danger
          );
        }

        const row =
          new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(
                  "akiyo_verify"
                )
                .setLabel(
                  "Verify"
                )
                .setEmoji("✅")
                .setStyle(
                  ButtonStyle.Success
                )
            );

        const message =
          await channel.send({
            embeds: [
              makeEmbed(
                "✅ Server Verification",
                "Click the button below to verify yourself.",
                COLORS.success,
                i.guild,
                [
                  field(
                    "Verified Role",
                    `${role}`
                  )
                ]
              )
            ],
            components: [
              row
            ]
          });

        c.verification.enabled =
          true;

        c.verification.channelId =
          channel.id;

        c.verification.roleId =
          role.id;

        c.verification.messageId =
          message.id;

        saveDB();

        return reply(
          i,
          "✅ Verification Setup Complete",
          `Verification panel created in ${channel}.`,
          COLORS.success
        );
      }

      if (
        cmd ===
        "verificationoff"
      ) {
        c.verification.enabled =
          false;

        saveDB();

        return reply(
          i,
          "✅ Verification Disabled",
          "Verification has been disabled.",
          COLORS.warning
        );
      }
    }

    /* =====================================================
       REACTION ROLES
       ===================================================== */

    if (
      [
        "reactionrole",
        "reactionrole-remove",
        "reactionrole-list"
      ].includes(cmd)
    ) {
      if (
        !isManager(i.member)
      ) {
        return reply(
          i,
          "🔒 Permission Required",
          "Manage Server is required.",
          COLORS.danger
        );
      }

      if (
        cmd ===
        "reactionrole-list"
      ) {
        const rows = [];

        for (
          const [
            messageId,
            mappings
          ] of Object.entries(
            c.reactionRoles
          )
        ) {
          for (
            const [
              key,
              mapping
            ] of Object.entries(
              mappings
            )
          ) {
            rows.push(
              `• ${mapping.emoji} → ${roleMention(mapping.roleId)} • Message: \`${messageId}\``
            );
          }
        }

        return reply(
          i,
          "🎭 Reaction Roles",
          rows.join("\n") ||
            "No reaction roles configured.",
          COLORS.primary
        );
      }

      const messageId =
        i.options.getString(
          "message_id"
        );

      const emoji =
        i.options.getString(
          "emoji"
        );

      const message =
        await i.channel.messages
          .fetch(
            messageId
          )
          .catch(() => null);

      if (!message) {
        return reply(
          i,
          "⚠️ Message Not Found",
          "The message must exist in the current channel.",
          COLORS.danger
        );
      }

      const custom =
        emoji.match(
          /^<a?:[^:>]+:(\d+)>$/
        );

      const key =
        custom
          ? custom[1]
          : emoji;

      if (
        cmd ===
        "reactionrole"
      ) {
        const role =
          i.options.getRole(
            "role"
          );

        if (
          role.position >=
          i.guild.members.me
            .roles.highest.position
        ) {
          return reply(
            i,
            "⚠️ Role Hierarchy",
            "AkiyO's role must be above the reaction role.",
            COLORS.danger
          );
        }

        c.reactionRoles[
          messageId
        ] ??= {};

        c.reactionRoles[
          messageId
        ][key] = {
          roleId:
            role.id,
          emoji
        };

        await message
          .react(emoji)
          .catch(() => {});

        saveDB();

        return reply(
          i,
          "🎭 Reaction Role Added",
          `${emoji} → ${role}`,
          COLORS.success
        );
      }

      delete c.reactionRoles[
        messageId
      ]?.[key];

      saveDB();

      return reply(
        i,
        "🎭 Reaction Role Removed",
        "Reaction role mapping removed.",
        COLORS.success
      );
    }

    /* =====================================================
       ANNOUNCEMENT
       ===================================================== */

    if (
      cmd ===
      "announce"
    ) {
      if (
        !isManager(i.member) &&
        !i.memberPermissions?.has(
          PermissionFlagsBits.ManageMessages
        )
      ) {
        return reply(
          i,
          "🔒 Permission Required",
          "Manage Messages or Manage Server is required.",
          COLORS.danger
        );
      }

      const channel =
        i.options.getChannel(
          "channel"
        );

      const message =
        i.options.getString(
          "message"
        );

      const title =
        i.options.getString(
          "title"
        ) ||
        "📢 Server Announcement";

      const everyone =
        i.options.getBoolean(
          "everyone"
        ) || false;

      const embed =
        makeEmbed(
          title,
          message,
          COLORS.primary,
          i.guild
        );

      await channel.send({
        content:
          everyone
            ? "@everyone"
            : undefined,

        allowedMentions:
          everyone
            ? {
                parse: [
                  "everyone"
                ]
              }
            : {
                parse: []
              },

        embeds: [
          embed
        ]
      });

      await log(
        i.guild,
        "announcements",
        "📢 Announcement Sent",
        [
          field(
            "Author",
            userTag(i.user)
          ),
          field(
            "Channel",
            `${channel}`
          ),
          field(
            "Title",
            title
          ),
          field(
            "Everyone",
            everyone
              ? "Yes"
              : "No"
          )
        ],
        COLORS.primary
      );

      return reply(
        i,
        "📢 Announcement Published",
        `Announcement sent to ${channel}.`,
        COLORS.success
      );
    }

    /* =====================================================
       LOGGING
       ===================================================== */

    if (
      [
        "logsetup",
        "logdisable",
        "logstatus",
        "auditlog",
        "auditclear"
      ].includes(cmd)
    ) {
      if (
        !isManager(i.member)
      ) {
        return reply(
          i,
          "🔒 Permission Required",
          "Manage Server is required.",
          COLORS.danger
        );
      }

      if (
        cmd ===
        "logsetup"
      ) {
        const channel =
          i.options.getChannel(
            "channel"
          );

        c.logs.all =
          channel.id;

        saveDB();

        return reply(
          i,
          "📋 Logging Enabled",
          `All AkiyO logs will be sent to ${channel}.`,
          COLORS.success
        );
      }

      if (
        cmd ===
        "logdisable"
      ) {
        c.logs.all =
          null;

        saveDB();

        return reply(
          i,
          "📋 Logging Disabled",
          "Unified logging has been disabled.",
          COLORS.warning
        );
      }

      if (
        cmd ===
        "logstatus"
      ) {
        return reply(
          i,
          "📋 Logging Status",
          c.logs.all
            ? `Unified logs: ${channelMention(c.logs.all)}`
            : "Unified logging is not configured.",
          c.logs.all
            ? COLORS.success
            : COLORS.warning
        );
      }

      if (
        cmd ===
        "auditclear"
      ) {
        return reply(
          i,
          "📜 Audit Log",
          "Discord's native audit log is managed by Discord. AkiyO's live audit events are sent to your configured log channel.",
          COLORS.primary
        );
      }

      if (
        cmd ===
        "auditlog"
      ) {
        const logs =
          await i.guild.fetchAuditLogs({
            limit: 10
          });

        const text =
          logs.entries
            .map(
              entry =>
                `• **${entry.action}** — ${entry.executor ? userTag(entry.executor) : "Unknown"} — <t:${Math.floor(entry.createdTimestamp / 1000)}:R>`
            )
            .join("\n") ||
          "No audit events.";

        return reply(
          i,
          "📜 Recent Audit Events",
          text,
          COLORS.primary
        );
      }
    }

    /* =====================================================
       CONFIG
       ===================================================== */

    if (
      [
        "config",
        "configstaff",
        "configreset"
      ].includes(cmd)
    ) {
      if (
        !isManager(i.member)
      ) {
        return reply(
          i,
          "🔒 Permission Required",
          "Manage Server is required.",
          COLORS.danger
        );
      }

      if (
        cmd ===
        "configstaff"
      ) {
        c.ticket.staffRoleId =
          i.options.getRole(
            "role"
          ).id;

        saveDB();

        return reply(
          i,
          "⚙️ Staff Role Updated",
          `Ticket staff role is now ${roleMention(c.ticket.staffRoleId)}.`,
          COLORS.success
        );
      }

      if (
        cmd ===
        "configreset"
      ) {
        db[i.guild.id] =
          clone(
            DEFAULT_GUILD
          );

        saveDB();

        return reply(
          i,
          "⚙️ Configuration Reset",
          "All AkiyO server configuration has been reset.",
          COLORS.warning
        );
      }

      return reply(
        i,
        "⚙️ AkiyO Configuration",
        "Complete server configuration summary.",
        COLORS.primary,
        [
          field(
            "Logs",
            c.logs.all
              ? channelMention(
                  c.logs.all
                )
              : "Not configured"
          ),
          field(
            "Ticket Category",
            c.ticket.categoryId
              ? channelMention(
                  c.ticket.categoryId
                )
              : "Not configured"
          ),
          field(
            "Ticket Staff",
            c.ticket.staffRoleId
              ? roleMention(
                  c.ticket.staffRoleId
                )
              : "Not configured"
          ),
          field(
            "AutoMod",
            c.automod.enabled
              ? "🟢 Enabled"
              : "🔴 Disabled"
          ),
          field(
            "Security",
            c.security.enabled
              ? "🟢 Enabled"
              : "🔴 Disabled"
          ),
          field(
            "Autorole",
            c.autorole.enabled
              ? roleMention(
                  c.autorole.roleId
                )
              : "Disabled"
          ),
          field(
            "Welcome",
            c.welcome.enabled
              ? channelMention(
                  c.welcome.channelId
                )
              : "Disabled"
          ),
          field(
            "Verification",
            c.verification.enabled
              ? "Enabled"
              : "Disabled"
          ),
          field(
            "AI",
            c.ai.enabled
              ? "Enabled"
              : "Disabled"
          )
        ]
      );
    }

    /* =====================================================
       ACTIVITY
       ===================================================== */

    if (
      [
        "activity",
        "activitysetup",
        "activitycheck"
      ].includes(cmd)
    ) {
      if (
        !isStaff(i.member)
      ) {
        return reply(
          i,
          "🔒 Staff Required",
          "Only staff can use the activity system.",
          COLORS.danger
        );
      }

      if (
        cmd ===
        "activitysetup"
      ) {
        c.activity.requiredMinutes =
          i.options.getInteger(
            "minutes"
          );

        c.activity.staffRoleId =
          i.options.getRole(
            "role"
          ).id;

        c.activity.enabled =
          true;

        saveDB();

        return reply(
          i,
          "📊 Activity System Configured",
          `Required activity: **${c.activity.requiredMinutes} minutes**.`,
          COLORS.success
        );
      }

      if (
        cmd ===
        "activitycheck"
      ) {
        c.activity.lastCheck =
          Date.now();

        saveDB();

        return reply(
          i,
          "📊 Activity Check",
          "Staff activity check has been recorded.",
          COLORS.success,
          [
            field(
              "Required",
              `${c.activity.requiredMinutes} minutes`
            ),
            field(
              "Checked",
              `<t:${Math.floor(
                Date.now() / 1000
              )}:F>`
            )
          ]
        );
      }

      const user =
        i.options.getUser(
          "user"
        ) || i.user;

      const data =
        c.activity.users[
          user.id
        ] || {
          minutes: 0,
          messages: 0,
          commands: 0
        };

      return reply(
        i,
        "📊 Staff Activity",
        `Activity information for ${user}.`,
        COLORS.primary,
        [
          field(
            "Minutes",
            data.minutes
          ),
          field(
            "Messages",
            data.messages
          ),
          field(
            "Commands",
            data.commands
          ),
          field(
            "Required",
            c.activity.requiredMinutes
          )
        ]
      );
    }

    /* =====================================================
       AI
       ===================================================== */

    if (
      cmd ===
      "aireset"
    ) {
      aiHistory.delete(
        i.user.id
      );

      return reply(
        i,
        "🤖 AI Reset",
        "Your private AkiyO AI conversation has been reset.",
        COLORS.purple,
        [],
        { ephemeral: true }
      );
    }

    if (
      cmd ===
      "aiconfig"
    ) {
      if (
        !isManager(i.member)
      ) {
        return reply(
          i,
          "🔒 Permission Required",
          "Manage Server is required.",
          COLORS.danger
        );
      }

      c.ai.adminAudit =
        i.options.getBoolean(
          "admin_audit"
        );

      c.ai.adminUserId =
        c.ai.adminAudit
          ? i.user.id
          : null;

      saveDB();

      return reply(
        i,
        "🤖 AI Audit Updated",
        `AI admin auditing is now **${c.ai.adminAudit ? "enabled" : "disabled"}**.`,
        COLORS.purple
      );
    }

    if (
      cmd ===
      "ai"
    ) {
      if (
        !c.ai.enabled
      ) {
        return reply(
          i,
          "🤖 AI Disabled",
          "AkiyO AI is disabled on this server.",
          COLORS.warning
        );
      }

      await i.deferReply();

      const prompt =
        i.options.getString(
          "prompt"
        );

      const result =
        await askAI(
          i.user.id,
          prompt
        );

      if (result.error) {
        return reply(
          i,
          "🤖 AI Error",
          result.error,
          COLORS.danger
        );
      }

      await log(
        i.guild,
        "ai",
        "🤖 AI Request",
        [
          field(
            "User",
            userTag(i.user)
          ),
          field(
            "Prompt",
            prompt
          ),
          field(
            "Model",
            OPENAI_MODEL
          )
        ],
        COLORS.purple
      );

      if (
        c.ai.adminAudit &&
        c.ai.adminUserId
      ) {
        const admin =
          await client.users
            .fetch(
              c.ai.adminUserId
            )
            .catch(
              () => null
            );

        if (admin) {
          await admin.send({
            embeds: [
              makeEmbed(
                "🤖 AkiyO AI Audit",
                "An AI request was made.",
                COLORS.purple,
                i.guild,
                [
                  field(
                    "User",
                    userTag(i.user)
                  ),
                  field(
                    "Prompt",
                    prompt
                  ),
                  field(
                    "Response",
                    result.text
                  )
                ]
              )
            ]
          }).catch(
            () => {}
          );
        }
      }

      return reply(
        i,
        "🤖 AkiyO AI",
        result.text,
        COLORS.purple
      );
    }

  } catch (error) {
    console.error(
      `/${cmd}`,
      error
    );

    await log(
      i.guild,
      "audit",
      "❌ Command Error",
      [
        field(
          "Command",
          `/${cmd}`
        ),
        field(
          "User",
          userTag(i.user)
        ),
        field(
          "Error",
          error.message ||
            String(error)
        )
      ],
      COLORS.danger
    ).catch(
      () => {}
    );

    return reply(
      i,
      "⚠️ Action Failed",
      "AkiyO could not complete this command. Check permissions, role hierarchy and configuration.",
      COLORS.danger,
      [
        field(
          "Technical Error",
          error.message ||
            "Unknown error"
        )
      ],
      { ephemeral: true }
    ).catch(
      () => {}
    );
  }
}

/* =========================================================
   BUTTONS
   ========================================================= */

client.on(
  "interactionCreate",
  async interaction => {
    if (!interaction.isButton()) {
      if (
        interaction.isChatInputCommand()
      ) {
        return handleCommand(
          interaction
        );
      }

      return;
    }

    try {
      if (
        interaction.customId ===
        "akiyo_create_ticket"
      ) {
        const c =
          guildConfig(
            interaction.guild
          );

        if (
          !c.ticket.categoryId
        ) {
          return reply(
            interaction,
            "🎫 Setup Required",
            "The ticket category has not been configured.",
            COLORS.warning,
            [],
            {
              ephemeral:
                true
            }
          );
        }

        const record =
          await createTicket(
            interaction.guild,
            interaction.user
          );

        return reply(
          interaction,
          "🎫 Ticket Created",
          `Your private ticket is ready: <#${record.channelId}>`,
          COLORS.success,
          [],
          {
            ephemeral:
              true
          }
        );
      }

      if (
        interaction.customId ===
        "akiyo_verify"
      ) {
        const c =
          guildConfig(
            interaction.guild
          );

        if (
          !c.verification.enabled
        ) {
          return reply(
            interaction,
            "⚠️ Verification Disabled",
            "Verification is currently disabled.",
            COLORS.warning,
            [],
            {
              ephemeral:
                true
            }
          );
        }

        const role =
          await interaction.guild.roles
            .fetch(
              c.verification.roleId
            )
            .catch(
              () => null
            );

        if (!role) {
          return reply(
            interaction,
            "⚠️ Role Missing",
            "The configured verification role no longer exists.",
            COLORS.danger,
            [],
            {
              ephemeral:
                true
            }
          );
        }

        const member =
          await interaction.guild.members
            .fetch(
              interaction.user.id
            );

        if (
          role.position >=
          interaction.guild
            .members.me
            .roles.highest.position
        ) {
          return reply(
            interaction,
            "⚠️ Role Hierarchy",
            "AkiyO cannot assign the verification role.",
            COLORS.danger,
            [],
            {
              ephemeral:
                true
            }
          );
        }

        await member.roles.add(
          role,
          "AkiyO Verification"
        );

        await log(
          interaction.guild,
          "verification",
          "✅ Member Verified",
          [
            field(
              "Member",
              userTag(
                interaction.user
              )
            ),
            field(
              "Role",
              `${role}`
            )
          ],
          COLORS.success
        );

        return reply(
          interaction,
          "✅ Verification Complete",
          "You have been successfully verified.",
          COLORS.success,
          [],
          {
            ephemeral:
              true
          }
        );
      }

      if (
        [
          "akiyo_ticket_claim",
          "akiyo_ticket_close",
          "akiyo_ticket_lock",
          "akiyo_ticket_transcript"
        ].includes(
          interaction.customId
        )
      ) {
        const record =
          findTicketByChannel(
            interaction.guild,
            interaction.channel.id
          );

        if (!record) {
          return reply(
            interaction,
            "🎫 Ticket Not Found",
            "Ticket record not found.",
            COLORS.danger,
            [],
            {
              ephemeral:
                true
            }
          );
        }

        if (
          !isStaff(
            interaction.member
          )
        ) {
          return reply(
            interaction,
            "🔒 Staff Required",
            "Only ticket staff can use this button.",
            COLORS.danger,
            [],
            {
              ephemeral:
                true
            }
          );
        }

        if (
          interaction.customId ===
          "akiyo_ticket_claim"
        ) {
          record.claimedBy =
            interaction.user.id;

          saveDB();

          return reply(
            interaction,
            "🙋 Ticket Claimed",
            "You are now assigned to this ticket.",
            COLORS.success,
            [],
            {
              ephemeral:
                true
            }
          );
        }

        if (
          interaction.customId ===
          "akiyo_ticket_close"
        ) {
          await closeTicket(
            interaction.guild,
            record,
            interaction.user
          );

          return reply(
            interaction,
            "🔒 Ticket Closed",
            "Ticket closed successfully.",
            COLORS.warning,
            [],
            {
              ephemeral:
                true
            }
          );
        }

        if (
          interaction.customId ===
          "akiyo_ticket_lock"
        ) {
          record.locked =
            !record.locked;

          await interaction.channel
            .permissionOverwrites
            .edit(
              record.ownerId,
              {
                SendMessages:
                  !record.locked
              }
            );

          saveDB();

          return reply(
            interaction,
            record.locked
              ? "🔐 Ticket Locked"
              : "🔓 Ticket Unlocked",
            record.locked
              ? "Ticket owner cannot send messages."
              : "Ticket owner can send messages.",
            COLORS.success,
            [],
            {
              ephemeral:
                true
            }
          );
        }

        if (
          interaction.customId ===
          "akiyo_ticket_transcript"
        ) {
          const file =
            await ticketTranscript(
              interaction.channel
            );

          return interaction.reply({
            embeds: [
              makeEmbed(
                "📄 Ticket Transcript",
                "Transcript generated successfully.",
                COLORS.success,
                interaction.guild
              )
            ],
            files: [
              {
                attachment:
                  file,
                name:
                  `akiyo-ticket-${record.ownerId}.txt`
              }
            ],
            ephemeral:
              true
          });
        }
      }
    } catch (error) {
      console.error(
        "Button error:",
        error
      );

      if (
        !interaction.replied &&
        !interaction.deferred
      ) {
        await reply(
          interaction,
          "⚠️ Action Failed",
          "The button action could not be completed.",
          COLORS.danger,
          [],
          {
            ephemeral:
              true
          }
        ).catch(
          () => {}
        );
      }
    }
  }
);

/* =========================================================
   MESSAGE SYSTEM
   ========================================================= */

client.on(
  "messageCreate",
  async message => {
    try {
      if (
        message.author.bot
      ) {
        return;
      }

      /* DM SUPPORT SYSTEM */
      if (
        !message.guild
      ) {
        for (
          const guild of client.guilds.cache.values()
        ) {
          const c =
            guildConfig(
              guild
            );

          if (
            !c.ticket.dmEnabled
          ) {
            continue;
          }

          const record =
            findTicket(
              guild,
              message.author.id
            );

          if (
            !record ||
            record.status !==
              "open"
          ) {
            continue;
          }

          const channel =
            await guild.channels
              .fetch(
                record.channelId
              )
              .catch(
                () => null
              );

          if (
            !channel?.isTextBased()
          ) {
            continue;
          }

          await channel.send({
            embeds: [
              makeEmbed(
                "📩 Ticket Owner DM",
                message.content ||
                  "[Attachment]",
                COLORS.primary,
                guild,
                [
                  field(
                    "User",
                    userTag(
                      message.author
                    )
                  ),
                  field(
                    "Reply",
                    "This message was received through AkiyO DM support."
                  )
                ]
              )
            ]
          });

          await log(
            guild,
            "tickets",
            "📩 Ticket DM Received",
            [
              field(
                "User",
                userTag(
                  message.author
                )
              ),
              field(
                "Ticket",
                `${channel}`
              ),
              field(
                "Message",
                message.content ||
                  "[Attachment]"
              )
            ],
            COLORS.primary
          );

          return;
        }

        return;
      }

      /* AUTOMOD */
      await runAutoMod(
        message
      );

      /* ACTIVITY */
      const c =
        guildConfig(
          message.guild
        );

      if (
        c.activity.enabled
      ) {
        const data =
          c.activity.users[
            message.author.id
          ] || {
            minutes: 0,
            messages: 0,
            commands: 0
          };

        data.messages++;

        c.activity.users[
          message.author.id
        ] = data;

        saveDB();
      }

      /* TICKET -> STAFF DM */
      const ticket =
        findTicketByChannel(
          message.guild,
          message.channel.id
        );

      if (
        ticket &&
        ticket.ownerId ===
          message.author.id &&
        ticket.claimedBy
      ) {
        const staff =
          await client.users
            .fetch(
              ticket.claimedBy
            )
            .catch(
              () => null
            );

        if (staff) {
          await staff.send({
            embeds: [
              makeEmbed(
                "🎫 Ticket Owner Message",
                message.content ||
                  "[Attachment]",
                COLORS.primary,
                message.guild,
                [
                  field(
                    "Owner",
                    userTag(
                      message.author
                    )
                  ),
                  field(
                    "Ticket",
                    `${message.channel}`
                  )
                ]
              )
            ]
          }).catch(
            () => {}
          );
        }
      }
    } catch (error) {
      console.error(
        "messageCreate:",
        error
      );
    }
  }
);

/* =========================================================
   MEMBER EVENTS
   ========================================================= */

const raidMap = new Map();

client.on(
  "guildMemberAdd",
  async member => {
    try {
      const c =
        guildConfig(
          member.guild
        );

      await log(
        member.guild,
        "members",
        "👋 Member Joined",
        [
          field(
            "Member",
            userTag(
              member.user
            )
          ),
          field(
            "ID",
            member.id
          ),
          field(
            "Account Created",
            `<t:${Math.floor(
              member.user.createdTimestamp /
                1000
            )}:R>`
          ),
          field(
            "Member Count",
            member.guild.memberCount
          )
        ],
        COLORS.success
      );

      /* AUTOROLE */
      if (
        c.autorole.enabled &&
        c.autorole.roleId
      ) {
        const role =
          await member.guild.roles
            .fetch(
              c.autorole.roleId
            )
            .catch(
              () => null
            );

        if (
          role &&
          role.position <
            member.guild.members.me
              .roles.highest.position
        ) {
          await member.roles
            .add(
              role,
              "AkiyO Autorole"
            )
            .catch(
              () => {}
            );
        }
      }

      /* WELCOME */
      if (
        c.welcome.enabled &&
        c.welcome.channelId
      ) {
        const channel =
          await member.guild.channels
            .fetch(
              c.welcome.channelId
            )
            .catch(
              () => null
            );

        if (
          channel?.isTextBased()
        ) {
          const text =
            c.welcome.message
              .replaceAll(
                "{user}",
                `${member}`
              )
              .replaceAll(
                "{username}",
                member.user.username
              )
              .replaceAll(
                "{server}",
                member.guild.name
              )
              .replaceAll(
                "{count}",
                String(
                  member.guild
                    .memberCount
                )
              );

          await channel.send({
            embeds: [
              makeEmbed(
                "👋 Welcome!",
                text,
                COLORS.success,
                member.guild
              )
            ]
          });
        }
      }

      /* ANTI RAID */
      if (
        c.security.enabled &&
        c.security.antiRaid.enabled
      ) {
        const now =
          Date.now();

        const key =
          member.guild.id;

        const arr =
          (raidMap.get(key) ||
            [])
            .filter(
              x =>
                now - x <
                c.security
                  .antiRaid
                  .window
            );

        arr.push(now);

        raidMap.set(
          key,
          arr
        );

        if (
          arr.length >=
          c.security
            .antiRaid
            .joins
        ) {
          await log(
            member.guild,
            "security",
            "🚨 Possible Raid Detected",
            [
              field(
                "Recent Joins",
                arr.length
              ),
              field(
                "Window",
                `${c.security.antiRaid.window / 1000}s`
              ),
              field(
                "Threshold",
                c.security
                  .antiRaid
                  .joins
              ),
              field(
                "Latest Member",
                userTag(
                  member.user
                )
              )
            ],
            COLORS.danger
          );

          raidMap.set(
            key,
            []
          );
        }
      }
    } catch (error) {
      console.error(
        "guildMemberAdd:",
        error
      );
    }
  }
);

client.on(
  "guildMemberRemove",
  async member => {
    const c =
      guildConfig(
        member.guild
      );

    await log(
      member.guild,
      "members",
      "🚪 Member Left",
      [
        field(
          "Member",
          userTag(
            member.user
          )
        ),
        field(
          "ID",
          member.id
        )
      ],
      COLORS.danger
    );

    if (
      c.leave.enabled &&
      c.leave.channelId
    ) {
      const channel =
        await member.guild.channels
          .fetch(
            c.leave.channelId
          )
          .catch(
            () => null
          );

      if (
        channel?.isTextBased()
      ) {
        const text =
          c.leave.message
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
              member.guild.name
            );

        await channel.send({
          embeds: [
            makeEmbed(
              "🚪 Member Left",
              text,
              COLORS.warning,
              member.guild
            )
          ]
        });
      }
    }
  }
);

/* =========================================================
   MESSAGE LOGS
   ========================================================= */

client.on(
  "messageDelete",
  async message => {
    if (
      !message.guild ||
      message.author?.bot
    ) {
      return;
    }

    await log(
      message.guild,
      "messages",
      "🗑️ Message Deleted",
      [
        field(
          "Author",
          message.author
            ? userTag(
                message.author
              )
            : "Unknown"
        ),
        field(
          "Channel",
          `${message.channel}`
        ),
        field(
          "Content",
          message.content ||
            "Content unavailable"
        )
      ],
      COLORS.danger
    );
  }
);

client.on(
  "messageUpdate",
  async (
    oldMessage,
    newMessage
  ) => {
    if (
      !newMessage.guild ||
      newMessage.author?.bot ||
      oldMessage.content ===
        newMessage.content
    ) {
      return;
    }

    await log(
      newMessage.guild,
      "messages",
      "✏️ Message Edited",
      [
        field(
          "Author",
          userTag(
            newMessage.author
          )
        ),
        field(
          "Channel",
          `${newMessage.channel}`
        ),
        field(
          "Before",
          oldMessage.content ||
            "Unavailable"
        ),
        field(
          "After",
          newMessage.content ||
            "Unavailable"
        )
      ],
      COLORS.warning
    );
  }
);

/* =========================================================
   CHANNEL / ROLE SECURITY
   ========================================================= */

client.on(
  "channelCreate",
  async channel => {
    if (!channel.guild)
      return;

    const executor =
      await auditExecutor(
        channel.guild,
        AuditLogEvent.ChannelCreate,
        channel.id
      );

    await securityEvent(
      channel.guild,
      "channelCreate",
      executor,
      `Created ${channel.name}`
    );

    await log(
      channel.guild,
      "channels",
      "📁 Channel Created",
      [
        field(
          "Channel",
          `${channel}`
        ),
        field(
          "Executor",
          executor
            ? userMention(
                executor
              )
            : "Unknown"
        )
      ],
      COLORS.success
    );
  }
);

client.on(
  "channelDelete",
  async channel => {
    if (!channel.guild)
      return;

    const executor =
      await auditExecutor(
        channel.guild,
        AuditLogEvent.ChannelDelete,
        channel.id
      );

    const c =
      guildConfig(
        channel.guild
      );

    if (
      c.security.protectedChannels
        .includes(
          channel.id
        ) &&
      executor &&
      !isTrusted(
        channel.guild,
        executor
      )
    ) {
      await log(
        channel.guild,
        "security",
        "🚨 Protected Channel Deleted",
        [
          field(
            "Channel",
            channel.name
          ),
          field(
            "Executor",
            userMention(
              executor
            )
          )
        ],
        COLORS.danger
      );
    }

    await securityEvent(
      channel.guild,
      "channelDelete",
      executor,
      `Deleted ${channel.name}`
    );

    await log(
      channel.guild,
      "channels",
      "🗑️ Channel Deleted",
      [
        field(
          "Channel",
          channel.name
        ),
        field(
          "Executor",
          executor
            ? userMention(
                executor
              )
            : "Unknown"
        )
      ],
      COLORS.danger
    );
  }
);

client.on(
  "roleCreate",
  async role => {
    const executor =
      await auditExecutor(
        role.guild,
        AuditLogEvent.RoleCreate,
        role.id
      );

    await securityEvent(
      role.guild,
      "roleCreate",
      executor,
      `Created role ${role.name}`
    );

    await log(
      role.guild,
      "roles",
      "➕ Role Created",
      [
        field(
          "Role",
          `${role}`
        ),
        field(
          "Executor",
          executor
            ? userMention(
                executor
              )
            : "Unknown"
        )
      ],
      COLORS.success
    );
  }
);

client.on(
  "roleDelete",
  async role => {
    const executor =
      await auditExecutor(
        role.guild,
        AuditLogEvent.RoleDelete,
        role.id
      );

    const c =
      guildConfig(
        role.guild
      );

    if (
      c.security.protectedRoles
        .includes(
          role.id
        ) &&
      executor &&
      !isTrusted(
        role.guild,
        executor
      )
    ) {
      await log(
        role.guild,
        "security",
        "🚨 Protected Role Deleted",
        [
          field(
            "Role",
            role.name
          ),
          field(
            "Executor",
            userMention(
              executor
            )
          )
        ],
        COLORS.danger
      );
    }

    await securityEvent(
      role.guild,
      "roleDelete",
      executor,
      `Deleted role ${role.name}`
    );

    await log(
      role.guild,
      "roles",
      "➖ Role Deleted",
      [
        field(
          "Role",
          role.name
        ),
        field(
          "Executor",
          executor
            ? userMention(
                executor
              )
            : "Unknown"
        )
      ],
      COLORS.danger
    );
  }
);

/* =========================================================
   WEBHOOK SECURITY
   ========================================================= */

client.on(
  "guildWebhooksUpdate",
  async channel => {
    if (!channel.guild)
      return;

    const executor =
      await auditExecutor(
        channel.guild,
        AuditLogEvent.WebhookCreate,
        null
      );

    await securityEvent(
      channel.guild,
      "webhook",
      executor,
      `Webhook activity in ${channel}`
    );

    await log(
      channel.guild,
      "security",
      "🔗 Webhook Activity",
      [
        field(
          "Channel",
          `${channel}`
        ),
        field(
          "Executor",
          executor
            ? userMention(
                executor
              )
            : "Unknown"
        )
      ],
      COLORS.warning
    );
  }
);

/* =========================================================
   BAN AUDIT
   ========================================================= */

client.on(
  "guildBanAdd",
  async ban => {
    const executor =
      await auditExecutor(
        ban.guild,
        AuditLogEvent.MemberBanAdd,
        ban.user.id
      );

    await securityEvent(
      ban.guild,
      "ban",
      executor,
      `Banned ${userTag(
        ban.user
      )}`
    );

    await log(
      ban.guild,
      "moderation",
      "🔨 Member Banned",
      [
        field(
          "Member",
          userTag(
            ban.user
          )
        ),
        field(
          "Executor",
          executor
            ? userMention(
                executor
              )
            : "Unknown"
        )
      ],
      COLORS.danger
    );
  }
);

client.on(
  "guildBanRemove",
  async ban => {
    await log(
      ban.guild,
      "moderation",
      "🔓 Member Unbanned",
      [
        field(
          "Member",
          userTag(
            ban.user
          )
        )
      ],
      COLORS.success
    );
  }
);

/* =========================================================
   REACTION ROLES
   ========================================================= */

client.on(
  "messageReactionAdd",
  async (
    reaction,
    user
  ) => {
    if (
      user.bot
    ) return;

    try {
      if (
        reaction.partial
      ) {
        await reaction.fetch();
      }

      const guild =
        reaction.message.guild;

      if (!guild)
        return;

      const mapping =
        guildConfig(
          guild
        ).reactionRoles[
          reaction.message.id
        ];

      if (!mapping)
        return;

      const key =
        reaction.emoji.id ||
        reaction.emoji.name;

      const rr =
        mapping[key];

      if (!rr)
        return;

      const member =
        await guild.members
          .fetch(
            user.id
          );

      const role =
        await guild.roles
          .fetch(
            rr.roleId
          );

      if (
        !role ||
        role.position >=
          guild.members.me
            .roles.highest.position
      ) {
        return;
      }

      await member.roles.add(
        role,
        "AkiyO Reaction Role"
      );
    } catch {}
  }
);

client.on(
  "messageReactionRemove",
  async (
    reaction,
    user
  ) => {
    if (
      user.bot
    ) return;

    try {
      if (
        reaction.partial
      ) {
        await reaction.fetch();
      }

      const guild =
        reaction.message.guild;

      if (!guild)
        return;

      const mapping =
        guildConfig(
          guild
        ).reactionRoles[
          reaction.message.id
        ];

      const key =
        reaction.emoji.id ||
        reaction.emoji.name;

      const rr =
        mapping?.[key];

      if (!rr)
        return;

      const member =
        await guild.members
          .fetch(
            user.id
          );

      const role =
        await guild.roles
          .fetch(
            rr.roleId
          );

      if (role) {
        await member.roles.remove(
          role,
          "AkiyO Reaction Role Removed"
        );
      }
    } catch {}
  }
);

/* =========================================================
   AUDIT LOG STREAM
   ========================================================= */

client.on(
  "guildAuditLogEntryCreate",
  async (
    entry,
    guild
  ) => {
    await log(
      guild,
      "audit",
      "📜 Discord Audit Event",
      [
        field(
          "Action",
          String(
            entry.action
          )
        ),
        field(
          "Executor",
          entry.executor
            ? userTag(
                entry.executor
              )
            : "Unknown"
        ),
        field(
          "Target",
          entry.targetId ||
            "Unknown"
        ),
        field(
          "Reason",
          entry.reason ||
            "No reason provided"
        )
      ],
      COLORS.primary
    );
  }
);

/* =========================================================
   READY / REGISTRATION
   ========================================================= */

client.once(
  "clientReady",
  async () => {
    console.log(
      `AkiyO online as ${client.user.tag}`
    );

    console.log(
      `Preparing ${commands.length} slash commands...`
    );

    try {
      const rest =
        new REST({
          version: "10"
        }).setToken(
          TOKEN
        );

      await rest.put(
        Routes.applicationCommands(
          CLIENT_ID
        ),
        {
          body:
            commands.map(
              command =>
                command.toJSON()
            )
        }
      );

      console.log(
        `SUCCESS: Registered ${commands.length} global slash commands.`
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
   ERROR HANDLERS
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

client.login(
  TOKEN
).catch(
  error => {
    console.error(
      "Discord login failed:",
      error
    );

    process.exit(1);
  }
);
