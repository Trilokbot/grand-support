// ============================================================
// AKIYO DISCORD BOT
// Node.js 22.x
// discord.js 14.27.0
// SINGLE FILE VERSION
// ============================================================

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

// ============================================================
// WEB SERVER - RENDER / OTHER HOSTING
// ============================================================

const PORT = Number(process.env.PORT) || 10000;

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("AKIYO BOT ONLINE");
}).listen(PORT, "0.0.0.0", () => {
  console.log(`Web server running on port ${PORT}`);
});

// ============================================================
// ENVIRONMENT
// ============================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const GUILD_ID = "1493700265499689154";
const SUPPORT_ROLE_ID = "1542498406981959801";
const SUPPORT_LOG_CHANNEL_ID = "1542500573000106024";

// Optional:
// BOT_OWNER_IDS=123456789,987654321
const ENV_OWNER_IDS = (process.env.BOT_OWNER_IDS || "")
  .split(",")
  .map(x => x.trim())
  .filter(Boolean);

if (!TOKEN || !CLIENT_ID) {
  console.error("DISCORD_TOKEN and CLIENT_ID are required.");
  process.exit(1);
}

// ============================================================
// CLIENT
// ============================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildWebhooks
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User,
    Partials.Reaction
  ]
});

// ============================================================
// DATABASE
// ============================================================

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "config.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DEFAULT = {
  automod: {
    enabled: true,
    spamLimit: 6,
    spamWindow: 5000,
    repeatedLimit: 3,
    capsPercent: 75,
    badWords: [],
    invite: true,
    massMentions: true,
    roleMentionsLimit: 5,
    userMentionsLimit: 5,

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
    }
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
    action: "alert",

    trustedUsers: [],
    trustedBots: [],
    trustedRoleId: null,

    protectedRoles: [],
    protectedChannels: []
  },

  logs: {
    automod: SUPPORT_LOG_CHANNEL_ID,
    audit: SUPPORT_LOG_CHANNEL_ID,
    security: SUPPORT_LOG_CHANNEL_ID,
    suggestion: SUPPORT_LOG_CHANNEL_ID,
    moderation: SUPPORT_LOG_CHANNEL_ID,
    members: SUPPORT_LOG_CHANNEL_ID,
    messages: SUPPORT_LOG_CHANNEL_ID,
    channels: SUPPORT_LOG_CHANNEL_ID,
    roles: SUPPORT_LOG_CHANNEL_ID,
    tickets: SUPPORT_LOG_CHANNEL_ID,
    verification: SUPPORT_LOG_CHANNEL_ID,
    reactionRoles: SUPPORT_LOG_CHANNEL_ID,
    welcome: SUPPORT_LOG_CHANNEL_ID,
    leaderboard: SUPPORT_LOG_CHANNEL_ID,
    announcements: SUPPORT_LOG_CHANNEL_ID,
    config: SUPPORT_LOG_CHANNEL_ID
  },

  ticketCategoryId: null,
  suggestionsChannelId: null,

  warnings: {},
  punishments: {},

  autorole: {
    enabled: false,
    roleId: null
  },

  verification: {
    enabled: false,
    channelId: null,
    roleId: null,
    messageId: null
  },

  welcome: {
    enabled: false,
    channelId: null,
    message: "Welcome {user} to **{server}**! You are member #{count}."
  },

  reactionRoles: {},

  leaderboard: {
    enabled: true,
    users: {}
  },

  ads: {
    enabled: false,
    channelId: null,
    message: ""
  }
};

function deepMerge(a, b) {
  for (const key of Object.keys(b || {})) {
    if (
      b[key] &&
      typeof b[key] === "object" &&
      !Array.isArray(b[key])
    ) {
      a[key] = deepMerge(a[key] || {}, b[key]);
    } else if (b[key] !== undefined) {
      a[key] = b[key];
    }
  }
  return a;
}

let config = JSON.parse(JSON.stringify(DEFAULT));

try {
  if (fs.existsSync(DATA_FILE)) {
    config = deepMerge(
      config,
      JSON.parse(fs.readFileSync(DATA_FILE, "utf8"))
    );
  }
} catch (err) {
  console.error("Database load error:", err.message);
}

function save() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(config, null, 2)
    );
  } catch (err) {
    console.error("Database save error:", err.message);
  }
}

// ============================================================
// RUNTIME MAPS
// ============================================================

const tickets = new Map();
const spamTracker = new Map();
const repeatTracker = new Map();
const recentSecurity = new Map();

// ============================================================
// HELPERS
// ============================================================

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function f(name, value, inline = false) {
  return {
    name: String(name).slice(0, 256),
    value: String(value || "-").slice(0, 1024),
    inline
  };
}

function isStaff(member) {
  return !!member && (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.roles.cache.has(SUPPORT_ROLE_ID) ||
    (
      config.security.trustedRoleId &&
      member.roles.cache.has(config.security.trustedRoleId)
    )
  );
}

function isManager(member) {
  return !!member &&
    (
      member.permissions.has(PermissionFlagsBits.ManageGuild) ||
      member.permissions.has(PermissionFlagsBits.Administrator)
    );
}

function ownerOnly(userId) {
  if (ENV_OWNER_IDS.includes(userId)) return true;

  return !!(
    client.application &&
    client.application.owner &&
    (
      client.application.owner.id === userId ||
      client.application.owner.members?.has?.(userId)
    )
  );
}

function trusted(guild, userId) {
  if (!userId) return true;

  if (config.security.trustedUsers.includes(userId)) {
    return true;
  }

  const member = guild.members.cache.get(userId);

  if (
    member?.permissions.has(PermissionFlagsBits.Administrator)
  ) {
    return true;
  }

  if (
    config.security.trustedRoleId &&
    member?.roles.cache.has(config.security.trustedRoleId)
  ) {
    return true;
  }

  return false;
}

function isTrustedBot(guild, userId) {
  return config.security.trustedBots.includes(userId);
}

async function getLogChannel(guild, type = "audit") {
  const id =
    config.logs[type] ||
    SUPPORT_LOG_CHANNEL_ID;

  return guild.channels.fetch(id).catch(() => null);
}

async function logEmbed(
  guild,
  type,
  title,
  fields = [],
  color = 0x5865f2
) {
  const channel = await getLogChannel(guild, type);

  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setTimestamp();

  if (fields.length) {
    embed.addFields(fields.slice(0, 25));
  }

  await channel.send({
    embeds: [embed]
  }).catch(() => {});
}

function template(text, member) {
  return String(text)
    .replaceAll("{user}", member.toString())
    .replaceAll("{username}", member.user.username)
    .replaceAll("{server}", member.guild.name)
    .replaceAll("{count}", String(member.guild.memberCount));
}

async function giveRole(member, roleId, reason) {
  const role =
    member.guild.roles.cache.get(roleId) ||
    await member.guild.roles.fetch(roleId).catch(() => null);

  if (!role) return false;
  if (role.managed) return false;

  const me = member.guild.members.me;

  if (!me) return false;

  if (role.position >= me.roles.highest.position) {
    return false;
  }

  if (member.roles.cache.has(role.id)) {
    return true;
  }

  return member.roles.add(role, reason)
    .then(() => true)
    .catch(() => false);
}

// ============================================================
// WARNINGS / PUNISHMENTS
// ============================================================

async function addWarning(member, reason, moderatorId) {
  const guildId = member.guild.id;

  config.warnings[guildId] ??= {};
  config.warnings[guildId][member.id] ??= [];

  config.warnings[guildId][member.id].push({
    reason,
    moderatorId,
    time: Date.now()
  });

  config.punishments[guildId] ??= {};
  config.punishments[guildId][member.id] ??= [];

  config.punishments[guildId][member.id].push({
    type: "warn",
    reason,
    moderatorId,
    time: Date.now()
  });

  save();

  return config.warnings[guildId][member.id].length;
}

async function recordPunishment(
  guild,
  userId,
  type,
  reason,
  moderatorId
) {
  config.punishments[guild.id] ??= {};
  config.punishments[guild.id][userId] ??= [];

  config.punishments[guild.id][userId].push({
    type,
    reason,
    moderatorId,
    time: Date.now()
  });

  save();

  await logEmbed(
    guild,
    "moderation",
    "⚖️ Punishment Recorded",
    [
      f("User", `<@${userId}>`),
      f("Type", type),
      f("Reason", reason),
      f("Moderator", `<@${moderatorId}>`)
    ],
    0xed4245
  );
}

// ============================================================
// AUTOMOD
// ============================================================

async function punishAuto(message, type, reason) {
  const member = message.member;

  if (!member) return;

  const action =
    config.automod.actions[type] || "delete";

  await message.delete().catch(() => {});

  if (
    action === "timeout" &&
    member.moderatable
  ) {
    const seconds =
      config.automod.timeoutSeconds[type] || 60;

    await member.timeout(
      seconds * 1000,
      `AutoMod: ${reason}`
    ).catch(() => {});
  }

  if (action === "warn") {
    await addWarning(
      member,
      `AutoMod: ${reason}`,
      client.user.id
    );
  }

  await logEmbed(
    message.guild,
    "automod",
    "🛡️ AutoMod Action",
    [
      f(
        "User",
        `${member.user.tag} (${member.id})`
      ),
      f("Reason", reason),
      f("Action", action),
      f("Channel", message.channel.toString())
    ],
    0xed4245
  );
}

async function runAutoMod(message) {
  if (
    !config.automod.enabled ||
    !message.guild ||
    !message.member ||
    isStaff(message.member)
  ) {
    return;
  }

  const content = message.content || "";

  if (
    config.automod.invite &&
    /discord(?:\.gg|\.com\/invite)\/[A-Za-z0-9-]+/i.test(content)
  ) {
    return punishAuto(
      message,
      "invite",
      "Discord invite link"
    );
  }

  const userMentions =
    message.mentions.users.size;

  const roleMentions =
    message.mentions.roles.size;

  if (
    config.automod.massMentions &&
    (
      message.mentions.everyone ||
      userMentions >= config.automod.userMentionsLimit ||
      roleMentions >= config.automod.roleMentionsLimit
    )
  ) {
    return punishAuto(
      message,
      "massmention",
      "Mass/excessive mentions"
    );
  }

  const letters =
    content.replace(/[^A-Za-z]/g, "");

  if (letters.length >= 8) {
    const upper =
      letters.replace(/[^A-Z]/g, "").length;

    const percent =
      (upper / letters.length) * 100;

    if (
      percent >= config.automod.capsPercent
    ) {
      return punishAuto(
        message,
        "caps",
        "Excessive capital letters"
      );
    }
  }

  const lower =
    content.toLowerCase();

  for (const word of config.automod.badWords) {
    if (
      word &&
      lower.includes(String(word).toLowerCase())
    ) {
      return punishAuto(
        message,
        "badword",
        `Blocked word: ${word}`
      );
    }
  }

  const now = Date.now();

  const spam =
    (spamTracker.get(message.author.id) || [])
      .filter(
        time =>
          now - time <
          config.automod.spamWindow
      );

  spam.push(now);

  spamTracker.set(
    message.author.id,
    spam
  );

  if (
    spam.length >=
    config.automod.spamLimit
  ) {
    spamTracker.set(
      message.author.id,
      []
    );

    return punishAuto(
      message,
      "spam",
      `Spam: ${spam.length} messages`
    );
  }

  const key = message.author.id;

  const previous =
    repeatTracker.get(key) || {
      content: "",
      count: 0,
      time: now
    };

  if (
    content &&
    previous.content === content &&
    now - previous.time < 30000
  ) {
    previous.count++;
  } else {
    previous.count = 1;
  }

  previous.content = content;
  previous.time = now;

  repeatTracker.set(key, previous);

  if (
    previous.count >=
    config.automod.repeatedLimit
  ) {
    repeatTracker.delete(key);

    return punishAuto(
      message,
      "repeat",
      "Repeated message"
    );
  }
}

// ============================================================
// ANTI NUKE
// ============================================================

async function securityAlert(
  guild,
  title,
  details
) {
  await logEmbed(
    guild,
    "security",
    title,
    [f("Details", details)],
    0xed4245
  );
}

async function antiNuke(
  guild,
  event,
  executorId,
  detail
) {
  if (!executorId) return;

  if (
    !config.security.enabled ||
    trusted(guild, executorId) ||
    isTrustedBot(guild, executorId)
  ) {
    return;
  }

  const protectedRole =
    event === "roleDelete" &&
    config.security.protectedRoles.includes(
      detail.roleId
    );

  const protectedChannel =
    event === "channelDelete" &&
    config.security.protectedChannels.includes(
      detail.channelId
    );

  const key =
    `${event}:${executorId}`;

  const now = Date.now();

  const arr =
    (recentSecurity.get(key) || [])
      .filter(t => now - t < 30000);

  arr.push(now);

  recentSecurity.set(key, arr);

  const limits = {
    ban: config.security.massBan,
    kick: config.security.massKick,
    channelDelete:
      config.security.massChannelDelete,
    roleDelete:
      config.security.massRoleDelete,
    channelCreate:
      config.security.massChannelCreate,
    roleCreate:
      config.security.massRoleCreate
  };

  const threshold =
    limits[event] || 999;

  if (
    arr.length >= threshold ||
    protectedRole ||
    protectedChannel
  ) {
    await securityAlert(
      guild,
      "🚨 Anti-Nuke Security Alert",
      `${detail.text || detail}
Executor: <@${executorId}>
Detected: ${arr.length} ${event} actions.`
    );

    recentSecurity.delete(key);

    if (
      config.security.action === "ban"
    ) {
      const member =
        await guild.members.fetch(
          executorId
        ).catch(() => null);

      if (member?.bannable) {
        await member.ban({
          reason:
            `Anti-Nuke: ${event}`
        }).catch(() => {});
      }
    }
  }
}

// ============================================================
// AUDIT EVENTS
// ============================================================

async function auditLog(
  guild,
  title,
  fields,
  color
) {
  await logEmbed(
    guild,
    "audit",
    title,
    fields,
    color
  );
}

client.on(
  "guildAuditLogEntryCreate",
  async (entry, guild) => {
    const actor = entry.executor;

    await auditLog(
      guild,
      "📜 Audit Log",
      [
        f("Action", String(entry.action)),
        f(
          "Executor",
          actor
            ? `${actor.tag || actor.username} (${actor.id})`
            : "Unknown"
        ),
        f(
          "Target",
          entry.targetId || "Unknown"
        ),
        f(
          "Reason",
          entry.reason || "No reason"
        )
      ]
    );
  }
);

// ============================================================
// TICKETS / SUPPORT
// ============================================================

async function transcript(channel) {
  const messages = [];
  let before;

  while (messages.length < 10000) {
    const batch =
      await channel.messages.fetch({
        limit: 100,
        before
      }).catch(() => null);

    if (!batch?.size) break;

    messages.push(...batch.values());

    before =
      batch.last().id;

    if (batch.size < 100) break;
  }

  messages.reverse();

  return Buffer.from(
    messages
      .map(message =>
        `[${message.createdAt.toISOString()}] ` +
        `${message.author.tag} (${message.author.id})\n` +
        `${message.content || ""}\n` +
        `${[
          ...message.attachments.values()
        ].map(a => a.url).join("\n")}\n`
      )
      .join("\n"),
    "utf8"
  );
}

function ticketButtons() {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId("ticket_claim")
        .setLabel("Claim")
        .setEmoji("🙋")
        .setStyle(ButtonStyle.Primary),

      new ButtonBuilder()
        .setCustomId("ticket_close")
        .setLabel("Close")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId("ticket_transcript")
        .setLabel("Transcript")
        .setEmoji("📄")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("ticket_lock")
        .setLabel("Lock")
        .setEmoji("🔐")
        .setStyle(ButtonStyle.Secondary)
    );
}

async function createTicket(user) {
  const guild =
    await client.guilds.fetch(GUILD_ID);

  const old =
    tickets.get(user.id);

  if (old) {
    const existing =
      await guild.channels.fetch(
        old.channelId
      ).catch(() => null);

    if (existing) {
      return existing;
    }

    tickets.delete(user.id);
  }

  const parent =
    config.ticketCategoryId
      ? await guild.channels.fetch(
          config.ticketCategoryId
        ).catch(() => null)
      : null;

  const safeName =
    user.username
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 15) ||
    "user";

  const channel =
    await guild.channels.create({
      name: `ticket-${safeName}`,
      type: ChannelType.GuildText,

      parent:
        parent?.type === ChannelType.GuildCategory
          ? parent.id
          : undefined,

      topic:
        `TRILOK_TICKET:${user.id}`,

      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [
            PermissionFlagsBits.ViewChannel
          ]
        },
        {
          id: SUPPORT_ROLE_ID,
          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles
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
        }
      ]
    });

  tickets.set(user.id, {
    channelId: channel.id,
    status: "open",
    locked: false,
    claimedBy: null,
    createdAt: Date.now()
  });

  await channel.send({
    content:
      `<@&${SUPPORT_ROLE_ID}>`,

    embeds: [
      new EmbedBuilder()
        .setTitle("🎫 New Support Ticket")
        .setDescription(
          `User: <@${user.id}>\n\n` +
          `A private support ticket has been created.`
        )
        .addFields(
          f("Status", "Open", true),
          f("Priority", "Normal", true)
        )
        .setTimestamp()
    ],

    components: [
      ticketButtons()
    ]
  });

  await user.send(
    "🎫 **Your support ticket has been created.**\n" +
    "Send your messages here and our support team will assist you."
  ).catch(() => {});

  await logEmbed(
    guild,
    "tickets",
    "🎫 Ticket Created",
    [
      f(
        "User",
        `${user.tag} (${user.id})`
      ),
      f(
        "Channel",
        channel.toString()
      )
    ],
    0x57f287
  );

  return channel;
}

function ticketByChannel(channelId) {
  for (const [userId, ticket] of tickets) {
    if (ticket.channelId === channelId) {
      return [userId, ticket];
    }
  }

  return null;
}

async function closeTicket(
  userId,
  channel,
  by
) {
  const ticket =
    tickets.get(userId);

  if (!ticket) return;

  const tr =
    await transcript(channel);

  const log =
    await getLogChannel(
      channel.guild,
      "tickets"
    );

  if (log?.isTextBased()) {
    await log.send({
      content:
        `Ticket transcript — <@${userId}>`,
      files: [
        {
          attachment: tr,
          name:
            `ticket-${channel.id}.txt`
        }
      ]
    }).catch(() => {});
  }

  ticket.status = "closed";

  await channel.permissionOverwrites
    .edit(
      userId,
      {
        SendMessages: false,
        ViewChannel: true
      }
    )
    .catch(() => {});

  await channel.send(
    "🔒 **Ticket closed.**\nUse `/reopen` if you need to reopen it."
  );

  await logEmbed(
    channel.guild,
    "tickets",
    "🔒 Ticket Closed",
    [
      f("User", `<@${userId}>`),
      f("Closed by", `<@${by.id}>`)
    ]
  );

  save();
}

// ============================================================
// AUTOROLE
// ============================================================

async function setupAutorole(member) {
  if (!config.autorole.enabled) return;
  if (!config.autorole.roleId) return;

  const success =
    await giveRole(
      member,
      config.autorole.roleId,
      "Automatic role"
    );

  await logEmbed(
    member.guild,
    "members",
    success
      ? "🎭 Autorole Added"
      : "⚠️ Autorole Failed",
    [
      f("Member", `${member.user.tag} (${member.id})`),
      f("Role", `<@&${config.autorole.roleId}>`)
    ],
    success
      ? 0x57f287
      : 0xed4245
  );
}

// ============================================================
// WELCOME
// ============================================================

async function sendWelcome(member) {
  if (!config.welcome.enabled) return;
  if (!config.welcome.channelId) return;

  const channel =
    await member.guild.channels.fetch(
      config.welcome.channelId
    ).catch(() => null);

  if (!channel?.isTextBased()) return;

  const message =
    template(
      config.welcome.message,
      member
    );

  await channel.send({
    content: message
  }).catch(() => {});

  await logEmbed(
    member.guild,
    "welcome",
    "👋 Welcome Message Sent",
    [
      f("Member", member.toString()),
      f("Channel", channel.toString())
    ],
    0x57f287
  );
}

// ============================================================
// VERIFICATION
// ============================================================

function verificationButton() {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId("verify_member")
        .setLabel("Verify")
        .setEmoji("✅")
        .setStyle(ButtonStyle.Success)
    );
}

async function sendVerificationPanel(
  guild,
  channel
) {
  if (!config.verification.roleId) {
    return false;
  }

  const message =
    await channel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle("🛡️ Verification")
          .setDescription(
            "Click the button below to verify yourself and receive access to the server."
          )
          .setFooter({
            text: "AkiyO Security"
          })
          .setTimestamp()
      ],
      components: [
        verificationButton()
      ]
    });

  config.verification.enabled = true;
  config.verification.channelId = channel.id;
  config.verification.messageId = message.id;

  save();

  await logEmbed(
    guild,
    "verification",
    "🛡️ Verification Panel Created",
    [
      f("Channel", channel.toString()),
      f("Role", `<@&${config.verification.roleId}>`)
    ],
    0x57f287
  );

  return true;
}

// ============================================================
// REACTION ROLES
// ============================================================

function reactionKey(channelId, messageId) {
  return `${channelId}:${messageId}`;
}

async function reactionRoleAdd(
  reaction,
  user,
  remove = false
) {
  if (user.bot) return;

  const key =
    reactionKey(
      reaction.message.channel.id,
      reaction.message.id
    );

  const data =
    config.reactionRoles[key];

  if (!data) return;

  const emoji =
    reaction.emoji.id
      ? `<:${reaction.emoji.name}:${reaction.emoji.id}>`
      : reaction.emoji.name;

  let roleId = null;

  for (const item of data) {
    if (item.emoji === emoji) {
      roleId = item.roleId;
      break;
    }

    if (
      !reaction.emoji.id &&
      item.emoji === reaction.emoji.name
    ) {
      roleId = item.roleId;
      break;
    }
  }

  if (!roleId) return;

  const guild =
    reaction.message.guild;

  if (!guild) return;

  const member =
    await guild.members.fetch(
      user.id
    ).catch(() => null);

  if (!member) return;

  const role =
    await guild.roles.fetch(
      roleId
    ).catch(() => null);

  if (!role) return;

  if (
    role.managed ||
    role.position >=
      guild.members.me.roles.highest.position
  ) {
    return;
  }

  if (remove) {
    await member.roles.remove(
      role,
      "Reaction role removed"
    ).catch(() => {});
  } else {
    await member.roles.add(
      role,
      "Reaction role added"
    ).catch(() => {});
  }

  await logEmbed(
    guild,
    "reactionRoles",
    remove
      ? "➖ Reaction Role Removed"
      : "➕ Reaction Role Added",
    [
      f("User", member.toString()),
      f("Role", role.toString()),
      f("Emoji", emoji)
    ],
    remove
      ? 0xed4245
      : 0x57f287
  );
}

// ============================================================
// LEADERBOARD
// ============================================================

function leaderboardUser(guildId, userId) {
  config.leaderboard.users[guildId] ??= {};

  config.leaderboard.users[guildId][userId] ??= {
    messages: 0
  };

  return config.leaderboard.users[guildId][userId];
}

function updateLeaderboard(message) {
  if (!config.leaderboard.enabled) return;
  if (!message.guild) return;
  if (message.author.bot) return;

  const user =
    leaderboardUser(
      message.guild.id,
      message.author.id
    );

  user.messages++;

  if (
    user.messages % 10 === 0
  ) {
    save();
  }
}

function leaderboardText(guild) {
  const users =
    config.leaderboard.users[guild.id] || {};

  const entries =
    Object.entries(users)
      .sort(
        (a, b) =>
          (b[1].messages || 0) -
          (a[1].messages || 0)
      )
      .slice(0, 10);

  if (!entries.length) {
    return "No leaderboard data yet.";
  }

  return entries
    .map(
      ([id, data], index) =>
        `**${index + 1}.** <@${id}> — **${data.messages || 0}** messages`
    )
    .join("\n");
}

// ============================================================
// OWNER ADS
// ============================================================

async function broadcastAd() {
  if (!config.ads.enabled) {
    return {
      sent: 0,
      skipped: 0
    };
  }

  let sent = 0;
  let skipped = 0;

  for (const guild of client.guilds.cache.values()) {
    if (!config.ads.channelId) {
      skipped++;
      continue;
    }

    const channel =
      await guild.channels.fetch(
        config.ads.channelId
      ).catch(() => null);

    if (!channel?.isTextBased()) {
      skipped++;
      continue;
    }

    await channel.send({
      content: config.ads.message
    }).then(() => {
      sent++;
    }).catch(() => {
      skipped++;
    });
  }

  return {
    sent,
    skipped
  };
}

// ============================================================
// COMMANDS
// ============================================================

const commands = [

  // ---------------- TICKETS ----------------

  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Create a support ticket."),

  new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription("Send support panel."),

  new SlashCommandBuilder()
    .setName("ticketsetup")
    .setDescription("Set ticket category.")
    .addChannelOption(o =>
      o
        .setName("category")
        .setDescription("Ticket category")
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("close")
    .setDescription("Close ticket."),

  new SlashCommandBuilder()
    .setName("reopen")
    .setDescription("Reopen ticket."),

  new SlashCommandBuilder()
    .setName("delete")
    .setDescription("Delete ticket."),

  new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Claim ticket."),

  new SlashCommandBuilder()
    .setName("unclaim")
    .setDescription("Unclaim ticket."),

  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Lock ticket."),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Unlock ticket."),

  new SlashCommandBuilder()
    .setName("ticketstats")
    .setDescription("View ticket statistics."),

  new SlashCommandBuilder()
    .setName("ticketadd")
    .setDescription("Add a member to this ticket.")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ticketremove")
    .setDescription("Remove a member from this ticket.")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ticketinfo")
    .setDescription("View ticket information."),

  // ---------------- AUTOMOD ----------------

  new SlashCommandBuilder()
    .setName("automod")
    .setDescription("Advanced AutoMod.")
    .addSubcommand(s =>
      s.setName("enable")
        .setDescription("Enable AutoMod.")
    )
    .addSubcommand(s =>
      s.setName("disable")
        .setDescription("Disable AutoMod.")
    )
    .addSubcommand(s =>
      s.setName("status")
        .setDescription("View AutoMod status.")
    )
    .addSubcommand(s =>
      s.setName("config")
        .setDescription("Configure AutoMod.")
        .addIntegerOption(o =>
          o.setName("spam_limit")
            .setDescription("Spam limit")
            .setMinValue(3)
            .setMaxValue(30)
        )
        .addIntegerOption(o =>
          o.setName("timeout")
            .setDescription("Timeout seconds")
            .setMinValue(10)
            .setMaxValue(604800)
        )
        .addIntegerOption(o =>
          o.setName("caps_percent")
            .setDescription("Caps percentage")
            .setMinValue(50)
            .setMaxValue(100)
        )
    )
    .addSubcommand(s =>
      s.setName("badword")
        .setDescription("Add blocked word.")
        .addStringOption(o =>
          o.setName("word")
            .setDescription("Word")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("removebadword")
        .setDescription("Remove blocked word.")
        .addStringOption(o =>
          o.setName("word")
            .setDescription("Word")
            .setRequired(true)
        )
    ),

  // ---------------- SECURITY ----------------

  new SlashCommandBuilder()
    .setName("security")
    .setDescription("Anti-Nuke security.")
    .addSubcommand(s =>
      s.setName("enable")
        .setDescription("Enable security.")
    )
    .addSubcommand(s =>
      s.setName("disable")
        .setDescription("Disable security.")
    )
    .addSubcommand(s =>
      s.setName("status")
        .setDescription("Security status.")
    )
    .addSubcommand(s =>
      s.setName("trusted")
        .setDescription("Add trusted user.")
        .addUserOption(o =>
          o.setName("user")
            .setDescription("User")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("untrusted")
        .setDescription("Remove trusted user.")
        .addUserOption(o =>
          o.setName("user")
            .setDescription("User")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("trustedrole")
        .setDescription("Set trusted role.")
        .addRoleOption(o =>
          o.setName("role")
            .setDescription("Trusted role")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("removetrustedrole")
        .setDescription("Remove trusted role.")
    )
    .addSubcommand(s =>
      s.setName("trustedmember")
        .setDescription("Add trusted member.")
        .addUserOption(o =>
          o.setName("user")
            .setDescription("User")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("untrustedmember")
        .setDescription("Remove trusted member.")
        .addUserOption(o =>
          o.setName("user")
            .setDescription("User")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("trustedbot")
        .setDescription("Add trusted bot.")
        .addUserOption(o =>
          o.setName("user")
            .setDescription("Bot")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("untrustedbot")
        .setDescription("Remove trusted bot.")
        .addUserOption(o =>
          o.setName("user")
            .setDescription("Bot")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("protectedrole")
        .setDescription("Protect a role.")
        .addRoleOption(o =>
          o.setName("role")
            .setDescription("Role")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("unprotectedrole")
        .setDescription("Unprotect a role.")
        .addRoleOption(o =>
          o.setName("role")
            .setDescription("Role")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("protectedchannel")
        .setDescription("Protect a channel.")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Channel")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("unprotectedchannel")
        .setDescription("Unprotect channel.")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Channel")
            .setRequired(true)
        )
    ),

  // ---------------- CONFIG ----------------

  new SlashCommandBuilder()
    .setName("config")
    .setDescription("Configure bot.")
    .addSubcommand(s =>
      s.setName("log")
        .setDescription("Set log channel.")
        .addStringOption(o =>
          o.setName("type")
            .setDescription("Log type")
            .setRequired(true)
            .addChoices(
              { name: "AutoMod", value: "automod" },
              { name: "Audit", value: "audit" },
              { name: "Security", value: "security" },
              { name: "Suggestion", value: "suggestion" },
              { name: "Moderation", value: "moderation" },
              { name: "Members", value: "members" },
              { name: "Messages", value: "messages" },
              { name: "Channels", value: "channels" },
              { name: "Roles", value: "roles" },
              { name: "Tickets", value: "tickets" },
              { name: "Verification", value: "verification" },
              { name: "Reaction Roles", value: "reactionRoles" },
              { name: "Welcome", value: "welcome" },
              { name: "Leaderboard", value: "leaderboard" },
              { name: "Announcements", value: "announcements" },
              { name: "Config", value: "config" }
            )
        )
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Log channel")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("suggestions")
        .setDescription("Set suggestion channel.")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Channel")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("timeout")
        .setDescription("Set AutoMod timeout.")
        .addStringOption(o =>
          o.setName("type")
            .setDescription("Violation")
            .setRequired(true)
            .addChoices(
              { name: "Spam", value: "spam" },
              { name: "Invite", value: "invite" },
              { name: "Bad Word", value: "badword" },
              { name: "Caps", value: "caps" },
              { name: "Repeat", value: "repeat" },
              { name: "Mass Mention", value: "massmention" }
            )
        )
        .addIntegerOption(o =>
          o.setName("seconds")
            .setDescription("Seconds")
            .setMinValue(10)
            .setMaxValue(604800)
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("security")
        .setDescription("Set security limits.")
        .addIntegerOption(o =>
          o.setName("mass_ban")
            .setDescription("Mass ban limit")
            .setMinValue(1)
            .setMaxValue(20)
        )
        .addIntegerOption(o =>
          o.setName("mass_kick")
            .setDescription("Mass kick limit")
            .setMinValue(1)
            .setMaxValue(20)
        )
        .addIntegerOption(o =>
          o.setName("mass_channel_delete")
            .setDescription("Channel delete limit")
            .setMinValue(1)
            .setMaxValue(20)
        )
        .addIntegerOption(o =>
          o.setName("mass_role_delete")
            .setDescription("Role delete limit")
            .setMinValue(1)
            .setMaxValue(20)
        )
    ),

  // ---------------- MODERATION ----------------

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
    .setName("timeout")
    .setDescription("Timeout member.")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("seconds")
        .setDescription("Seconds")
        .setMinValue(10)
        .setMaxValue(604800)
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick member.")
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
    .setName("ban")
    .setDescription("Ban member.")
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
    .setName("unban")
    .setDescription("Unban user.")
    .addStringOption(o =>
      o.setName("user_id")
        .setDescription("User ID")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("View warnings.")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("punishments")
    .setDescription("View punishments.")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User")
        .setRequired(true)
    ),

  // ---------------- SUGGESTIONS ----------------

  new SlashCommandBuilder()
    .setName("suggest")
    .setDescription("Create suggestion.")
    .addStringOption(o =>
      o.setName("text")
        .setDescription("Suggestion")
        .setRequired(true)
    ),

  // ---------------- ANNOUNCEMENT ----------------

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Send advanced announcement.")
    .addStringOption(o =>
      o.setName("message")
        .setDescription("Announcement message")
        .setRequired(true)
    )
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Target channel")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("title")
        .setDescription("Embed title")
    )
    .addStringOption(o =>
      o.setName("footer")
        .setDescription("Embed footer")
    )
    .addStringOption(o =>
      o.setName("image")
        .setDescription("Image URL")
    )
    .addStringOption(o =>
      o.setName("thumbnail")
        .setDescription("Thumbnail URL")
    )
    .addBooleanOption(o =>
      o.setName("everyone")
        .setDescription("Mention everyone")
    )
    .addBooleanOption(o =>
      o.setName("here")
        .setDescription("Mention here")
    )
    .addRoleOption(o =>
      o.setName("role")
        .setDescription("Role to mention")
    )
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User to mention")
    ),

  // ---------------- AUTOROLE ----------------

  new SlashCommandBuilder()
    .setName("autorole")
    .setDescription("Automatic role system.")
    .addSubcommand(s =>
      s.setName("setup")
        .setDescription("Set automatic role.")
        .addRoleOption(o =>
          o.setName("role")
            .setDescription("Role")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("disable")
        .setDescription("Disable autorole.")
    )
    .addSubcommand(s =>
      s.setName("status")
        .setDescription("Autorole status.")
    ),

  // ---------------- VERIFICATION ----------------

  new SlashCommandBuilder()
    .setName("verification")
    .setDescription("Verification system.")
    .addSubcommand(s =>
      s.setName("setup")
        .setDescription("Setup verification.")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Verification channel")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addRoleOption(o =>
          o.setName("role")
            .setDescription("Verified role")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("disable")
        .setDescription("Disable verification.")
    )
    .addSubcommand(s =>
      s.setName("status")
        .setDescription("Verification status.")
    ),

  // ---------------- WELCOME ----------------

  new SlashCommandBuilder()
    .setName("welcome")
    .setDescription("Welcome system.")
    .addSubcommand(s =>
      s.setName("setup")
        .setDescription("Setup welcome.")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Welcome channel")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName("message")
            .setDescription("Welcome message")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("disable")
        .setDescription("Disable welcome.")
    )
    .addSubcommand(s =>
      s.setName("status")
        .setDescription("Welcome status.")
    ),

  // ---------------- REACTION ROLE ----------------

  new SlashCommandBuilder()
    .setName("reactionrole")
    .setDescription("Reaction role system.")
    .addSubcommand(s =>
      s.setName("add")
        .setDescription("Add reaction role.")
        .addStringOption(o =>
          o.setName("message_id")
            .setDescription("Message ID")
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName("emoji")
            .setDescription("Emoji")
            .setRequired(true)
        )
        .addRoleOption(o =>
          o.setName("role")
            .setDescription("Role")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("remove")
        .setDescription("Remove reaction role.")
        .addStringOption(o =>
          o.setName("message_id")
            .setDescription("Message ID")
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName("emoji")
            .setDescription("Emoji")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("list")
        .setDescription("List reaction roles.")
    ),

  // ---------------- LEADERBOARD ----------------

  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Activity leaderboard.")
    .addSubcommand(s =>
      s.setName("view")
        .setDescription("View leaderboard.")
    )
    .addSubcommand(s =>
      s.setName("enable")
        .setDescription("Enable leaderboard.")
    )
    .addSubcommand(s =>
      s.setName("disable")
        .setDescription("Disable leaderboard.")
    )
    .addSubcommand(s =>
      s.setName("reset")
        .setDescription("Reset leaderboard.")
    )
    .addSubcommand(s =>
      s.setName("status")
        .setDescription("Leaderboard status.")
    ),

  // ---------------- OWNER ADS ----------------

  new SlashCommandBuilder()
    .setName("ads")
    .setDescription("Owner advertisement system.")
    .addSubcommand(s =>
      s.setName("setup")
        .setDescription("Set advertisement channel.")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Advertisement channel")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("message")
        .setDescription("Set advertisement message.")
        .addStringOption(o =>
          o.setName("text")
            .setDescription("Advertisement")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("enable")
        .setDescription("Enable ads.")
    )
    .addSubcommand(s =>
      s.setName("disable")
        .setDescription("Disable ads.")
    )
    .addSubcommand(s =>
      s.setName("broadcast")
        .setDescription("Broadcast advertisement.")
    )
    .addSubcommand(s =>
      s.setName("status")
        .setDescription("Advertisement status.")
    ),

  // ---------------- BOT INFO ----------------

  new SlashCommandBuilder()
    .setName("botinfo")
    .setDescription("View bot information.")

].map(command => command.toJSON());

// ============================================================
// REGISTER COMMANDS
// ============================================================

async function registerCommands() {
  const rest =
    new REST({ version: "10" })
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
    `Registered ${commands.length} slash commands.`
  );
}

// ============================================================
// MEMBER JOIN
// ============================================================

client.on(
  "guildMemberAdd",
  async member => {
    try {
      // Original raid detection preserved
      if (
        member.guild.id === GUILD_ID &&
        config.security.enabled
      ) {
        const now = Date.now();

        const arr =
          (
            recentSecurity.get(
              `join:${member.guild.id}`
            ) || []
          ).filter(
            t =>
              now - t <
              config.security.raidWindow
          );

        arr.push(now);

        recentSecurity.set(
          `join:${member.guild.id}`,
          arr
        );

        if (
          arr.length >=
          config.security.raidJoinCount
        ) {
          await securityAlert(
            member.guild,
            "🚨 Possible Raid Detected",
            `${arr.length} members joined within ` +
            `${config.security.raidWindow / 1000} seconds.`
          );

          recentSecurity.delete(
            `join:${member.guild.id}`
          );
        }
      }

      await setupAutorole(member);
      await sendWelcome(member);

      await logEmbed(
        member.guild,
        "members",
        "📥 Member Joined",
        [
          f(
            "Member",
            `${member.user.tag} (${member.id})`
          ),
          f(
            "Account Created",
            `<t:${Math.floor(
              member.user.createdTimestamp / 1000
            )}:R>`
          )
        ],
        0x57f287
      );

    } catch (err) {
      console.error(
        "guildMemberAdd:",
        err
      );
    }
  }
);

// ============================================================
// BAN
// ============================================================

client.on(
  "guildBanAdd",
  async ban => {
    try {
      const logs =
        await ban.guild.fetchAuditLogs({
          type: AuditLogEvent.MemberBanAdd,
          limit: 1
        }).catch(() => null);

      const entry =
        logs?.entries.first();

      if (
        entry &&
        Date.now() -
          entry.createdTimestamp <
          5000
      ) {
        antiNuke(
          ban.guild,
          "ban",
          entry.executor?.id,
          {
            text:
              `Banned ${ban.user.tag}`
          }
        );
      }

      await logEmbed(
        ban.guild,
        "members",
        "🔨 Member Banned",
        [
          f(
            "User",
            `${ban.user.tag} (${ban.user.id})`
          ),
          f(
            "Executor",
            entry?.executor
              ? `${entry.executor.tag || entry.executor.username} (${entry.executor.id})`
              : "Unknown"
          )
        ],
        0xed4245
      );

    } catch (err) {
      console.error(
        "guildBanAdd:",
        err
      );
    }
  }
);

// ============================================================
// KICK
// ============================================================

client.on(
  "guildMemberRemove",
  async member => {
    try {
      const logs =
        await member.guild.fetchAuditLogs({
          type: AuditLogEvent.MemberKick,
          limit: 1
        }).catch(() => null);

      const entry =
        logs?.entries.first();

      if (
        entry &&
        entry.targetId === member.id &&
        Date.now() -
          entry.createdTimestamp <
          5000
      ) {
        antiNuke(
          member.guild,
          "kick",
          entry.executor?.id,
          {
            text:
              `Kicked ${member.user.tag}`
          }
        );
      }

      await logEmbed(
        member.guild,
        "members",
        "📤 Member Left",
        [
          f(
            "Member",
            `${member.user.tag} (${member.id})`
          )
        ],
        0xed4245
      );

    } catch (err) {
      console.error(
        "guildMemberRemove:",
        err
      );
    }
  }
);

// ============================================================
// CHANNEL EVENTS
// ============================================================

client.on(
  "channelDelete",
  async channel => {
    if (!channel.guild) return;

    try {
      const logs =
        await channel.guild.fetchAuditLogs({
          type: AuditLogEvent.ChannelDelete,
          limit: 1
        }).catch(() => null);

      const entry =
        logs?.entries.first();

      if (
        entry &&
        Date.now() -
          entry.createdTimestamp <
          5000
      ) {
        antiNuke(
          channel.guild,
          "channelDelete",
          entry.executor?.id,
          {
            text:
              `Deleted channel #${channel.name}`,
            channelId: channel.id
          }
        );
      }

      await logEmbed(
        channel.guild,
        "channels",
        "🗑️ Channel Deleted",
        [
          f("Channel", `#${channel.name}`),
          f("ID", channel.id),
          f(
            "Executor",
            entry?.executor
              ? `${entry.executor.tag || entry.executor.username} (${entry.executor.id})`
              : "Unknown"
          )
        ],
        0xed4245
      );

    } catch (err) {
      console.error(
        "channelDelete:",
        err
      );
    }
  }
);

client.on(
  "channelCreate",
  async channel => {
    if (!channel.guild) return;

    try {
      const logs =
        await channel.guild.fetchAuditLogs({
          type: AuditLogEvent.ChannelCreate,
          limit: 1
        }).catch(() => null);

      const entry =
        logs?.entries.first();

      if (
        entry &&
        Date.now() -
          entry.createdTimestamp <
          5000
      ) {
        antiNuke(
          channel.guild,
          "channelCreate",
          entry.executor?.id,
          {
            text:
              `Created channel #${channel.name}`
          }
        );
      }

      await logEmbed(
        channel.guild,
        "channels",
        "📁 Channel Created",
        [
          f("Channel", `#${channel.name}`),
          f("ID", channel.id),
          f(
            "Executor",
            entry?.executor
              ? `${entry.executor.tag || entry.executor.username} (${entry.executor.id})`
              : "Unknown"
          )
        ],
        0x57f287
      );

    } catch (err) {
      console.error(
        "channelCreate:",
        err
      );
    }
  }
);

// ============================================================
// ROLE EVENTS
// ============================================================

client.on(
  "roleDelete",
  async role => {
    try {
      const logs =
        await role.guild.fetchAuditLogs({
          type: AuditLogEvent.RoleDelete,
          limit: 1
        }).catch(() => null);

      const entry =
        logs?.entries.first();

      if (
        entry &&
        Date.now() -
          entry.createdTimestamp <
          5000
      ) {
        antiNuke(
          role.guild,
          "roleDelete",
          entry.executor?.id,
          {
            text:
              `Deleted role ${role.name}`,
            roleId: role.id
          }
        );
      }

      await logEmbed(
        role.guild,
        "roles",
        "🗑️ Role Deleted",
        [
          f("Role", role.name),
          f("ID", role.id)
        ],
        0xed4245
      );

    } catch (err) {
      console.error(
        "roleDelete:",
        err
      );
    }
  }
);

client.on(
  "roleCreate",
  async role => {
    try {
      const logs =
        await role.guild.fetchAuditLogs({
          type: AuditLogEvent.RoleCreate,
          limit: 1
        }).catch(() => null);

      const entry =
        logs?.entries.first();

      if (
        entry &&
        Date.now() -
          entry.createdTimestamp <
          5000
      ) {
        antiNuke(
          role.guild,
          "roleCreate",
          entry.executor?.id,
          {
            text:
              `Created role ${role.name}`
          }
        );
      }

      await logEmbed(
        role.guild,
        "roles",
        "➕ Role Created",
        [
          f("Role", role.name),
          f("ID", role.id)
        ],
        0x57f287
      );

    } catch (err) {
      console.error(
        "roleCreate:",
        err
      );
    }
  }
);

// ============================================================
// MESSAGE SYSTEM
// ============================================================

client.on(
  "messageCreate",
  async message => {
    if (message.author.bot) return;

    try {

      // ---------------- DM TICKET ----------------

      if (!message.guild) {
        let ticket =
          tickets.get(
            message.author.id
          );

        if (!ticket) {
          await createTicket(
            message.author
          );

          ticket =
            tickets.get(
              message.author.id
            );
        }

        if (!ticket) return;

        const channel =
          await client.channels.fetch(
            ticket.channelId
          ).catch(() => null);

        if (!channel) return;

        if (ticket.locked) {
          await message.author.send(
            "🔒 Your support ticket is currently locked."
          ).catch(() => {});

          return;
        }

        const embed =
          new EmbedBuilder()
            .setTitle("📩 User Message")
            .setDescription(
              message.content ||
              "[Attachment]"
            )
            .setFooter({
              text: "AkiyO Support System"
            })
            .setTimestamp();

        if (message.attachments.size) {
          embed.addFields(
            f(
              "Attachments",
              [
                ...message.attachments.values()
              ]
                .map(a => a.url)
                .join("\n")
            )
          );
        }

        await channel.send({
          embeds: [embed]
        });

        return;
      }

      // ---------------- TICKET STAFF REPLY ----------------

      const found =
        ticketByChannel(
          message.channel.id
        );

      if (
        found &&
        isStaff(message.member)
      ) {
        const [userId] =
          found;

        const user =
          await client.users.fetch(
            userId
          ).catch(() => null);

        if (user) {
          await user.send({
            embeds: [
              new EmbedBuilder()
                .setTitle("💬 Support Team")
                .setDescription(
                  message.content ||
                  "📎 Attachment"
                )
                .setFooter({
                  text:
                    "Official AkiyO Support Team"
                })
                .setTimestamp()
            ],

            files:
              [
                ...message.attachments.values()
              ].map(a => ({
                attachment: a.url
              }))
          }).catch(() => {});
        }

        return;
      }

      // ---------------- LEADERBOARD ----------------

      updateLeaderboard(message);

      // ---------------- AUTOMOD ----------------

      await runAutoMod(message);

      // ---------------- MESSAGE LOG ----------------

      if (
        !message.author.bot &&
        message.content
      ) {
        await logEmbed(
          message.guild,
          "messages",
          "💬 Message",
          [
            f(
              "User",
              `${message.author.tag} (${message.author.id})`
            ),
            f(
              "Channel",
              message.channel.toString()
            ),
            f(
              "Content",
              message.content
            )
          ],
          0x5865f2
        );
      }

    } catch (err) {
      console.error(
        "messageCreate:",
        err
      );
    }
  }
);

// ============================================================
// MESSAGE DELETE LOG
// ============================================================

client.on(
  "messageDelete",
  async message => {
    if (!message.guild) return;
    if (message.author?.bot) return;

    await logEmbed(
      message.guild,
      "messages",
      "🗑️ Message Deleted",
      [
        f(
          "Author",
          message.author
            ? `${message.author.tag} (${message.author.id})`
            : "Unknown"
        ),
        f(
          "Channel",
          message.channel?.toString() ||
          "Unknown"
        ),
        f(
          "Content",
          message.content ||
          "[Unavailable]"
        )
      ],
      0xed4245
    );
  }
);

// ============================================================
// REACTION ADD
// ============================================================

client.on(
  "messageReactionAdd",
  async (reaction, user) => {
    try {
      if (reaction.partial) {
        await reaction.fetch().catch(() => {});
      }

      if (user.bot) return;

      // Suggestion system
      if (
        config.suggestionsChannelId &&
        reaction.message.channel.id ===
          config.suggestionsChannelId &&
        ["👍", "👎"].includes(
          reaction.emoji.name
        )
      ) {
        const member =
          await reaction.message.guild.members
            .fetch(user.id)
            .catch(() => null);

        if (!isStaff(member)) {
          await reaction.users
            .remove(user.id)
            .catch(() => {});

          return;
        }

        const embed =
          reaction.message.embeds[0];

        if (
          !embed?.title?.includes(
            "Suggestion"
          )
        ) {
          return;
        }

        const status =
          reaction.emoji.name === "👍"
            ? "✅ APPROVED"
            : "❌ DECLINED";

        const updated =
          EmbedBuilder.from(embed)
            .setTitle(
              `${status} • Suggestion`
            )
            .addFields(
              f(
                "Decision by",
                user.toString()
              )
            );

        await reaction.message.edit({
          embeds: [updated]
        });

        await logEmbed(
          reaction.message.guild,
          "suggestion",
          status,
          [
            f(
              "Decision by",
              `${user.tag} (${user.id})`
            ),
            f(
              "Message",
              reaction.message.url
            )
          ]
        );

        return;
      }

      // Reaction roles
      await reactionRoleAdd(
        reaction,
        user,
        false
      );

    } catch (err) {
      console.error(
        "messageReactionAdd:",
        err
      );
    }
  }
);

// ============================================================
// REACTION REMOVE
// ============================================================

client.on(
  "messageReactionRemove",
  async (reaction, user) => {
    try {
      if (reaction.partial) {
        await reaction.fetch().catch(() => {});
      }

      await reactionRoleAdd(
        reaction,
        user,
        true
      );

    } catch (err) {
      console.error(
        "messageReactionRemove:",
        err
      );
    }
  }
);

// ============================================================
// INTERACTIONS
// ============================================================

client.on(
  "interactionCreate",
  async interaction => {
    try {

      // ======================================================
      // BUTTONS
      // ======================================================

      if (interaction.isButton()) {

        // ---------------- VERIFICATION ----------------

        if (
          interaction.customId ===
          "verify_member"
        ) {
          if (!interaction.guild) {
            return interaction.reply({
              content:
                "❌ This button can only be used in a server.",
              ephemeral: true
            });
          }

          const roleId =
            config.verification.roleId;

          if (!roleId) {
            return interaction.reply({
              content:
                "❌ Verification is not configured.",
              ephemeral: true
            });
          }

          const success =
            await giveRole(
              interaction.member,
              roleId,
              "Server verification"
            );

          if (!success) {
            return interaction.reply({
              content:
                "❌ I cannot add the verification role. Check my role hierarchy and Manage Roles permission.",
              ephemeral: true
            });
          }

          await logEmbed(
            interaction.guild,
            "verification",
            "✅ Member Verified",
            [
              f(
                "Member",
                `${interaction.user.tag} (${interaction.user.id})`
              ),
              f(
                "Role",
                `<@&${roleId}>`
              )
            ],
            0x57f287
          );

          return interaction.reply({
            content:
              "✅ You are now verified!",
            ephemeral: true
          });
        }

        // ---------------- CREATE TICKET ----------------

        if (
          interaction.customId ===
          "create_ticket"
        ) {
          await createTicket(
            interaction.user
          );

          return interaction.reply({
            content:
              "🎫 Ticket created. Check your DMs.",
            ephemeral: true
          });
        }

        // ---------------- STAFF TICKET BUTTONS ----------------

        if (!isStaff(interaction.member)) {
          return interaction.reply({
            content:
              "❌ Staff only.",
            ephemeral: true
          });
        }

        const found =
          ticketByChannel(
            interaction.channel.id
          );

        if (!found) {
          return interaction.reply({
            content:
              "❌ This is not a ticket.",
            ephemeral: true
          });
        }

        const [userId, ticket] =
          found;

        if (
          interaction.customId ===
          "ticket_claim"
        ) {
          ticket.claimedBy =
            interaction.user.id;

          save();

          await logEmbed(
            interaction.guild,
            "tickets",
            "🙋 Ticket Claimed",
            [
              f(
                "Ticket User",
                `<@${userId}>`
              ),
              f(
                "Claimed by",
                interaction.user.toString()
              )
            ]
          );

          return interaction.reply(
            `✅ Ticket claimed by ${interaction.user}.`
          );
        }

        if (
          interaction.customId ===
          "ticket_close"
        ) {
          await interaction.reply(
            "🔒 Closing ticket..."
          );

          return closeTicket(
            userId,
            interaction.channel,
            interaction.user
          );
        }

        if (
          interaction.customId ===
          "ticket_lock"
        ) {
          ticket.locked = true;

          await interaction.channel
            .permissionOverwrites
            .edit(
              userId,
              {
                SendMessages: false,
                ViewChannel: true
              }
            )
            .catch(() => {});

          save();

          return interaction.reply(
            "🔐 Ticket locked."
          );
        }

        if (
          interaction.customId ===
          "ticket_transcript"
        ) {
          const tr =
            await transcript(
              interaction.channel
            );

          const log =
            await getLogChannel(
              interaction.guild,
              "tickets"
            );

          if (log?.isTextBased()) {
            await log.send({
              content:
                `Transcript — <@${userId}>`,
              files: [
                {
                  attachment: tr,
                  name:
                    `ticket-${interaction.channel.id}.txt`
                }
              ]
            });
          }

          return interaction.reply({
            content:
              "✅ Transcript sent to support logs.",
            ephemeral: true
          });
        }

        return;
      }

      // ======================================================
      // CHAT INPUT
      // ======================================================

      if (!interaction.isChatInputCommand()) {
        return;
      }

      const command =
        interaction.commandName;

      const staffCommands = [
        "ticketpanel",
        "ticketsetup",
        "close",
        "reopen",
        "delete",
        "claim",
        "unclaim",
        "lock",
        "unlock",
        "ticketstats",
        "ticketadd",
        "ticketremove",
        "ticketinfo",
        "automod",
        "security",
        "config",
        "warn",
        "timeout",
        "kick",
        "ban",
        "unban",
        "warnings",
        "punishments",
        "suggest",
        "announce",
        "autorole",
        "verification",
        "welcome",
        "reactionrole",
        "leaderboard"
      ];

      if (
        staffCommands.includes(command) &&
        !isStaff(interaction.member)
      ) {
        return interaction.reply({
          content:
            "❌ You do not have permission.",
          ephemeral: true
        });
      }

      // ======================================================
      // TICKET
      // ======================================================

      if (command === "ticket") {
        await createTicket(
          interaction.user
        );

        return interaction.reply({
          content:
            "🎫 Check your DMs.",
          ephemeral: true
        });
      }

      if (
        command ===
        "ticketpanel"
      ) {
        const row =
          new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(
                  "create_ticket"
                )
                .setLabel(
                  "Open Support Ticket"
                )
                .setEmoji("🎫")
                .setStyle(
                  ButtonStyle.Primary
                )
            );

        await interaction.channel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                "🎫 AkiyO Support Center"
              )
              .setDescription(
                "Need help? Click the button below to open a private support ticket."
              )
              .setColor(0x5865f2)
              .setTimestamp()
          ],
          components: [row]
        });

        return interaction.reply({
          content:
            "✅ Support panel sent.",
          ephemeral: true
        });
      }

      if (
        [
          "ticketsetup",
          "close",
          "reopen",
          "delete",
          "claim",
          "unclaim",
          "lock",
          "unlock",
          "ticketstats",
          "ticketadd",
          "ticketremove",
          "ticketinfo"
        ].includes(command)
      ) {

        if (
          command ===
          "ticketsetup"
        ) {
          config.ticketCategoryId =
            interaction.options
              .getChannel(
                "category"
              ).id;

          save();

          return interaction.reply(
            "✅ Ticket category saved."
          );
        }

        const found =
          ticketByChannel(
            interaction.channel.id
          );

        if (!found) {
          return interaction.reply({
            content:
              "❌ This is not a ticket.",
            ephemeral: true
          });
        }

        const [userId, ticket] =
          found;

        if (
          command === "close"
        ) {
          await interaction.reply(
            "🔒 Closing..."
          );

          return closeTicket(
            userId,
            interaction.channel,
            interaction.user
          );
        }

        if (
          command === "reopen"
        ) {
          ticket.status = "open";
          ticket.locked = false;

          await interaction.channel
            .permissionOverwrites
            .edit(
              userId,
              {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
              }
            )
            .catch(() => {});

          save();

          return interaction.reply(
            "🔓 Ticket reopened."
          );
        }

        if (
          command === "delete"
        ) {
          await interaction.reply(
            "🗑️ Deleting ticket..."
          );

          tickets.delete(userId);

          await logEmbed(
            interaction.guild,
            "tickets",
            "🗑️ Ticket Deleted",
            [
              f(
                "User",
                `<@${userId}>`
              ),
              f(
                "Deleted by",
                interaction.user.toString()
              )
            ]
          );

          return interaction.channel
            .delete()
            .catch(() => {});
        }

        if (
          command === "lock"
        ) {
          ticket.locked = true;

          await interaction.channel
            .permissionOverwrites
            .edit(
              userId,
              {
                ViewChannel: true,
                SendMessages: false
              }
            );

          save();

          return interaction.reply(
            "🔐 Ticket locked."
          );
        }

        if (
          command === "unlock"
        ) {
          ticket.locked = false;

          await interaction.channel
            .permissionOverwrites
            .edit(
              userId,
              {
                ViewChannel: true,
                SendMessages: true
              }
            );

          save();

          return interaction.reply(
            "🔓 Ticket unlocked."
          );
        }

        if (
          command === "claim"
        ) {
          ticket.claimedBy =
            interaction.user.id;

          save();

          return interaction.reply(
            `🙋 Ticket claimed by ${interaction.user}.`
          );
        }

        if (
          command === "unclaim"
        ) {
          ticket.claimedBy = null;

          save();

          return interaction.reply(
            "✅ Ticket unclaimed."
          );
        }

        if (
          command === "ticketadd"
        ) {
          const user =
            interaction.options.getUser(
              "user"
            );

          await interaction.channel
            .permissionOverwrites
            .edit(
              user.id,
              {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true,
                AttachFiles: true
              }
            );

          return interaction.reply(
            `✅ Added ${user} to this ticket.`
          );
        }

        if (
          command === "ticketremove"
        ) {
          const user =
            interaction.options.getUser(
              "user"
            );

          await interaction.channel
            .permissionOverwrites
            .delete(user.id)
            .catch(() => {});

          return interaction.reply(
            `✅ Removed ${user} from this ticket.`
          );
        }

        if (
          command === "ticketinfo"
        ) {
          return interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setTitle(
                  "🎫 Ticket Information"
                )
                .addFields(
                  f(
                    "User",
                    `<@${userId}>`,
                    true
                  ),
                  f(
                    "Status",
                    ticket.status || "open",
                    true
                  ),
                  f(
                    "Locked",
                    String(!!ticket.locked),
                    true
                  ),
                  f(
                    "Claimed By",
                    ticket.claimedBy
                      ? `<@${ticket.claimedBy}>`
                      : "Nobody",
                    true
                  )
                )
                .setTimestamp()
            ],
            ephemeral: true
          });
        }

        if (
          command === "ticketstats"
        ) {
          let open = 0;
          let closed = 0;

          for (const ticketData of tickets.values()) {
            if (
              ticketData.status ===
              "closed"
            ) closed++;
            else open++;
          }

          return interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setTitle(
                  "🎫 Support Statistics"
                )
                .addFields(
                  f("Open Tickets", open, true),
                  f("Closed Tickets", closed, true),
                  f(
                    "Total",
                    open + closed,
                    true
                  )
                )
                .setTimestamp()
            ],
            ephemeral: true
          });
        }
      }

      // ======================================================
      // AUTOMOD
      // ======================================================

      if (
        command ===
        "automod"
      ) {
        const sub =
          interaction.options.getSubcommand();

        if (sub === "enable") {
          config.automod.enabled = true;
        }

        if (sub === "disable") {
          config.automod.enabled = false;
        }

        if (sub === "config") {
          const spam =
            interaction.options.getInteger(
              "spam_limit"
            );

          const timeout =
            interaction.options.getInteger(
              "timeout"
            );

          const caps =
            interaction.options.getInteger(
              "caps_percent"
            );

          if (spam !== null) {
            config.automod.spamLimit =
              spam;
          }

          if (timeout !== null) {
            for (
              const key of Object.keys(
                config.automod.timeoutSeconds
              )
            ) {
              config.automod.timeoutSeconds[key] =
                timeout;
            }
          }

          if (caps !== null) {
            config.automod.capsPercent =
              caps;
          }
        }

        if (sub === "badword") {
          const word =
            interaction.options
              .getString("word")
              .toLowerCase();

          if (
            !config.automod.badWords
              .includes(word)
          ) {
            config.automod.badWords.push(
              word
            );
          }
        }

        if (
          sub ===
          "removebadword"
        ) {
          const word =
            interaction.options
              .getString("word")
              .toLowerCase();

          config.automod.badWords =
            config.automod.badWords
              .filter(
                x => x !== word
              );
        }

        save();

        if (sub === "status") {
          return interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setTitle(
                  "🛡️ AutoMod Status"
                )
                .addFields(
                  f(
                    "Enabled",
                    String(
                      config.automod.enabled
                    ),
                    true
                  ),
                  f(
                    "Spam Limit",
                    config.automod.spamLimit,
                    true
                  ),
                  f(
                    "Caps",
                    `${config.automod.capsPercent}%`,
                    true
                  ),
                  f(
                    "Bad Words",
                    config.automod.badWords.length,
                    true
                  ),
                  f(
                    "Invite Protection",
                    String(
                      config.automod.invite
                    ),
                    true
                  ),
                  f(
                    "Mass Mention",
                    String(
                      config.automod.massMentions
                    ),
                    true
                  )
                )
                .setTimestamp()
            ],
            ephemeral: true
          });
        }

        return interaction.reply(
          `🛡️ AutoMod ${sub} completed.`
        );
      }

      // ======================================================
      // SECURITY
      // ======================================================

      if (
        command ===
        "security"
      ) {
        const sub =
          interaction.options.getSubcommand();

        if (sub === "enable") {
          config.security.enabled = true;
        }

        if (sub === "disable") {
          config.security.enabled = false;
        }

        if (sub === "trusted") {
          const id =
            interaction.options
              .getUser("user").id;

          if (
            !config.security.trustedUsers
              .includes(id)
          ) {
            config.security.trustedUsers
              .push(id);
          }
        }

        if (sub === "untrusted") {
          const id =
            interaction.options
              .getUser("user").id;

          config.security.trustedUsers =
            config.security.trustedUsers
              .filter(x => x !== id);
        }

        if (
          sub ===
          "trustedrole"
        ) {
          config.security.trustedRoleId =
            interaction.options
              .getRole("role").id;
        }

        if (
          sub ===
          "removetrustedrole"
        ) {
          config.security.trustedRoleId =
            null;
        }

        if (
          sub ===
          "trustedmember"
        ) {
          const id =
            interaction.options
              .getUser("user").id;

          if (
            !config.security.trustedUsers
              .includes(id)
          ) {
            config.security.trustedUsers
              .push(id);
          }
        }

        if (
          sub ===
          "untrustedmember"
        ) {
          const id =
            interaction.options
              .getUser("user").id;

          config.security.trustedUsers =
            config.security.trustedUsers
              .filter(x => x !== id);
        }

        if (
          sub ===
          "trustedbot"
        ) {
          const id =
            interaction.options
              .getUser("user").id;

          if (
            !config.security.trustedBots
              .includes(id)
          ) {
            config.security.trustedBots
              .push(id);
          }
        }

        if (
          sub ===
          "untrustedbot"
        ) {
          const id =
            interaction.options
              .getUser("user").id;

          config.security.trustedBots =
            config.security.trustedBots
              .filter(x => x !== id);
        }

        if (
          sub ===
          "protectedrole"
        ) {
          const id =
            interaction.options
              .getRole("role").id;

          if (
            !config.security.protectedRoles
              .includes(id)
          ) {
            config.security.protectedRoles
              .push(id);
          }
        }

        if (
          sub ===
          "unprotectedrole"
        ) {
          const id =
            interaction.options
              .getRole("role").id;

          config.security.protectedRoles =
            config.security.protectedRoles
              .filter(x => x !== id);
        }

        if (
          sub ===
          "protectedchannel"
        ) {
          const id =
            interaction.options
              .getChannel("channel").id;

          if (
            !config.security.protectedChannels
              .includes(id)
          ) {
            config.security.protectedChannels
              .push(id);
          }
        }

        if (
          sub ===
          "unprotectedchannel"
        ) {
          const id =
            interaction.options
              .getChannel("channel").id;

          config.security.protectedChannels =
            config.security.protectedChannels
              .filter(x => x !== id);
        }

        save();

        if (sub === "status") {
          return interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setTitle(
                  "🔐 Security Status"
                )
                .addFields(
                  f(
                    "Enabled",
                    String(
                      config.security.enabled
                    ),
                    true
                  ),
                  f(
                    "Trusted Users",
                    config.security.trustedUsers.length,
                    true
                  ),
                  f(
                    "Trusted Bots",
                    config.security.trustedBots.length,
                    true
                  ),
                  f(
                    "Trusted Role",
                    config.security.trustedRoleId
                      ? `<@&${config.security.trustedRoleId}>`
                      : "None",
                    true
                  ),
                  f(
                    "Protected Roles",
                    config.security.protectedRoles.length,
                    true
                  ),
                  f(
                    "Protected Channels",
                    config.security.protectedChannels.length,
                    true
                  )
                )
                .setTimestamp()
            ],
            ephemeral: true
          });
        }

        return interaction.reply(
          `🔐 Security ${sub} completed.`
        );
      }

      // ======================================================
      // CONFIG
      // ======================================================

      if (
        command ===
        "config"
      ) {
        const sub =
          interaction.options.getSubcommand();

        if (sub === "log") {
          const type =
            interaction.options
              .getString("type");

          const channel =
            interaction.options
              .getChannel("channel");

          config.logs[type] =
            channel.id;
        }

        if (
          sub ===
          "suggestions"
        ) {
          config.suggestionsChannelId =
            interaction.options
              .getChannel("channel").id;
        }

        if (
          sub ===
          "timeout"
        ) {
          const type =
            interaction.options
              .getString("type");

          const seconds =
            interaction.options
              .getInteger("seconds");

          config.automod.timeoutSeconds[type] =
            seconds;
        }

        if (
          sub ===
          "security"
        ) {
          const values = [
            "mass_ban",
            "mass_kick",
            "mass_channel_delete",
            "mass_role_delete"
          ];

          for (const key of values) {
            const value =
              interaction.options
                .getInteger(key);

            if (value !== null) {
              const clean =
                key.replaceAll(
                  "-",
                  ""
                );

              config.security[clean] =
                value;
            }
          }
        }

        save();

        await logEmbed(
          interaction.guild,
          "config",
          "⚙️ Configuration Changed",
          [
            f(
              "Changed by",
              interaction.user.toString()
            ),
            f(
              "Section",
              sub
            )
          ]
        );

        return interaction.reply(
          "✅ Configuration saved."
        );
      }

      // ======================================================
      // MODERATION
      // ======================================================

      if (
        [
          "warn",
          "timeout",
          "kick",
          "ban",
          "unban"
        ].includes(command)
      ) {
        const reason =
          interaction.options
            .getString("reason");

        if (command === "unban") {
          const id =
            interaction.options
              .getString("user_id");

          await interaction.guild.members
            .unban(
              id,
              reason
            );

          await recordPunishment(
            interaction.guild,
            id,
            "unban",
            reason,
            interaction.user.id
          );

          return interaction.reply(
            `✅ ${id} unbanned.`
          );
        }

        const user =
          interaction.options
            .getUser("user");

        const member =
          await interaction.guild.members
            .fetch(user.id)
            .catch(() => null);

        if (!member) {
          return interaction.reply({
            content:
              "❌ Member not found.",
            ephemeral: true
          });
        }

        if (
          command ===
          "warn"
        ) {
          const count =
            await addWarning(
              member,
              reason,
              interaction.user.id
            );

          await logEmbed(
            interaction.guild,
            "moderation",
            "⚠️ Member Warned",
            [
              f(
                "User",
                `${user.tag} (${user.id})`
              ),
              f(
                "Moderator",
                interaction.user.toString()
              ),
              f(
                "Reason",
                reason
              ),
              f(
                "Total Warnings",
                count
              )
            ],
            0xfee75c
          );

          return interaction.reply(
            `⚠️ Warned ${user}. Total warnings: ${count}`
          );
        }

        if (
          command ===
          "timeout"
        ) {
          const seconds =
            interaction.options
              .getInteger(
                "seconds"
              );

          if (!member.moderatable) {
            return interaction.reply({
              content:
                "❌ I cannot timeout this member.",
              ephemeral: true
            });
          }

          await member.timeout(
            seconds * 1000,
            reason
          );

          await recordPunishment(
            interaction.guild,
            user.id,
            "timeout",
            reason,
            interaction.user.id
          );

          return interaction.reply(
            `⏱️ ${user} timed out for ${seconds} seconds.`
          );
        }

        if (
          command ===
          "kick"
        ) {
          if (!member.kickable) {
            return interaction.reply({
              content:
                "❌ I cannot kick this member.",
              ephemeral: true
            });
          }

          await member.kick(reason);

          await recordPunishment(
            interaction.guild,
            user.id,
            "kick",
            reason,
            interaction.user.id
          );

          return interaction.reply(
            `👢 ${user.tag} kicked.`
          );
        }

        if (
          command ===
          "ban"
        ) {
          if (!member.bannable) {
            return interaction.reply({
              content:
                "❌ I cannot ban this member.",
              ephemeral: true
            });
          }

          await member.ban({
            reason
          });

          await recordPunishment(
            interaction.guild,
            user.id,
            "ban",
            reason,
            interaction.user.id
          );

          return interaction.reply(
            `🔨 ${user.tag} banned.`
          );
        }
      }

      // ======================================================
      // WARNINGS / PUNISHMENTS
      // ======================================================

      if (
        command ===
        "warnings" ||
        command ===
        "punishments"
      ) {
        const user =
          interaction.options
            .getUser("user");

        const data =
          command === "warnings"
            ? (
                config.warnings[
                  interaction.guild.id
                ]?.[user.id] || []
              )
            : (
                config.punishments[
                  interaction.guild.id
                ]?.[user.id] || []
              );

        const text =
          data.length
            ? data
                .slice(-15)
                .map(
                  (item, index) =>
                    `${index + 1}. ` +
                    `${item.type || "warn"} — ` +
                    `${item.reason} — ` +
                    `<t:${Math.floor(
                      item.time / 1000
                    )}:R>`
                )
                .join("\n")
            : "None";

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                command === "warnings"
                  ? "⚠️ Warnings"
                  : "⚖️ Punishments"
              )
              .setDescription(text)
              .setTimestamp()
          ],
          ephemeral: true
        });
      }

      // ======================================================
      // SUGGESTIONS
      // ======================================================

      if (
        command ===
        "suggest"
      ) {
        const text =
          interaction.options
            .getString("text");

        const channel =
          config.suggestionsChannelId
            ? await interaction.guild.channels
                .fetch(
                  config.suggestionsChannelId
                )
                .catch(() => null)
            : interaction.channel;

        if (!channel?.isTextBased()) {
          return interaction.reply({
            content:
              "❌ Suggestion channel is not configured.",
            ephemeral: true
          });
        }

        const embed =
          new EmbedBuilder()
            .setTitle(
              "💡 New Suggestion"
            )
            .setDescription(text)
            .addFields(
              f(
                "Suggested by",
                interaction.user.toString()
              )
            )
            .setFooter({
              text:
                "👍 Approve • 👎 Decline"
            })
            .setTimestamp();

        const message =
          await channel.send({
            embeds: [embed]
          });

        await message.react("👍");
        await message.react("👎");

        await logEmbed(
          interaction.guild,
          "suggestion",
          "💡 Suggestion Created",
          [
            f(
              "Author",
              interaction.user.toString()
            ),
            f(
              "Suggestion",
              text
            ),
            f(
              "Message",
              message.url
            )
          ]
        );

        return interaction.reply({
          content:
            `✅ Suggestion posted: ${message.url}`,
          ephemeral: true
        });
      }

      // ======================================================
      // ANNOUNCEMENT
      // ======================================================

      if (
        command ===
        "announce"
      ) {
        const channel =
          interaction.options
            .getChannel("channel");

        const message =
          interaction.options
            .getString("message");

        const title =
          interaction.options
            .getString("title");

        const footer =
          interaction.options
            .getString("footer");

        const image =
          interaction.options
            .getString("image");

        const thumbnail =
          interaction.options
            .getString("thumbnail");

        const everyone =
          interaction.options
            .getBoolean("everyone") ||
          false;

        const here =
          interaction.options
            .getBoolean("here") ||
          false;

        const role =
          interaction.options
            .getRole("role");

        const user =
          interaction.options
            .getUser("user");

        let content = "";

        if (everyone) {
          content += "@everyone ";
        }

        if (here) {
          content += "@here ";
        }

        if (role) {
          content += `${role} `;
        }

        if (user) {
          content += `${user} `;
        }

        content += message;

        const embed =
          new EmbedBuilder()
            .setDescription(message)
            .setTimestamp();

        if (title) {
          embed.setTitle(title);
        }

        if (footer) {
          embed.setFooter({
            text: footer
          });
        }

        if (image) {
          embed.setImage(image);
        }

        if (thumbnail) {
          embed.setThumbnail(
            thumbnail
          );
        }

        await channel.send({
          content: content.trim(),
          embeds: [
            embed
          ],
          allowedMentions: {
            parse: [
              ...(everyone
                ? ["everyone"]
                : [])
            ],
            roles:
              role
                ? [role.id]
                : [],
            users:
              user
                ? [user.id]
                : []
          }
        });

        await logEmbed(
          interaction.guild,
          "announcements",
          "📢 Announcement Sent",
          [
            f(
              "Channel",
              channel.toString()
            ),
            f(
              "Sent by",
              interaction.user.toString()
            ),
            f(
              "Message",
              message
            )
          ],
          0x5865f2
        );

        return interaction.reply({
          content:
            "✅ Announcement sent.",
          ephemeral: true
        });
      }

      // ======================================================
      // AUTOROLE
      // ======================================================

      if (
        command ===
        "autorole"
      ) {
        const sub =
          interaction.options.getSubcommand();

        if (sub === "setup") {
          const role =
            interaction.options
              .getRole("role");

          const me =
            interaction.guild.members.me;

          if (
            role.managed ||
            role.position >=
              me.roles.highest.position
          ) {
            return interaction.reply({
              content:
                "❌ That role is above my highest role. Move my bot role above it.",
              ephemeral: true
            });
          }

          config.autorole.enabled =
            true;

          config.autorole.roleId =
            role.id;

          save();

          return interaction.reply(
            `✅ Autorole enabled: ${role}`
          );
        }

        if (sub === "disable") {
          config.autorole.enabled =
            false;

          save();

          return interaction.reply(
            "✅ Autorole disabled."
          );
        }

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                "🎭 Autorole Status"
              )
              .addFields(
                f(
                  "Enabled",
                  String(
                    config.autorole.enabled
                  ),
                  true
                ),
                f(
                  "Role",
                  config.autorole.roleId
                    ? `<@&${config.autorole.roleId}>`
                    : "None",
                  true
                )
              )
              .setTimestamp()
          ],
          ephemeral: true
        });
      }

      // ======================================================
      // VERIFICATION
      // ======================================================

      if (
        command ===
        "verification"
      ) {
        const sub =
          interaction.options.getSubcommand();

        if (sub === "setup") {
          const channel =
            interaction.options
              .getChannel("channel");

          const role =
            interaction.options
              .getRole("role");

          const me =
            interaction.guild.members.me;

          if (
            role.managed ||
            role.position >=
              me.roles.highest.position
          ) {
            return interaction.reply({
              content:
                "❌ The verified role must be below my highest role.",
              ephemeral: true
            });
          }

          config.verification.roleId =
            role.id;

          config.verification.enabled =
            true;

          save();

          const success =
            await sendVerificationPanel(
              interaction.guild,
              channel
            );

          return interaction.reply(
            success
              ? "✅ Verification panel created."
              : "❌ Could not create verification panel."
          );
        }

        if (sub === "disable") {
          config.verification.enabled =
            false;

          save();

          return interaction.reply(
            "✅ Verification disabled."
          );
        }

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                "🛡️ Verification Status"
              )
              .addFields(
                f(
                  "Enabled",
                  String(
                    config.verification.enabled
                  ),
                  true
                ),
                f(
                  "Role",
                  config.verification.roleId
                    ? `<@&${config.verification.roleId}>`
                    : "None",
                  true
                ),
                f(
                  "Channel",
                  config.verification.channelId
                    ? `<#${config.verification.channelId}>`
                    : "None",
                  true
                )
              )
              .setTimestamp()
          ],
          ephemeral: true
        });
      }

      // ======================================================
      // WELCOME
      // ======================================================

      if (
        command ===
        "welcome"
      ) {
        const sub =
          interaction.options.getSubcommand();

        if (sub === "setup") {
          config.welcome.enabled =
            true;

          config.welcome.channelId =
            interaction.options
              .getChannel("channel").id;

          config.welcome.message =
            interaction.options
              .getString("message");

          save();

          return interaction.reply(
            "✅ Welcome system configured."
          );
        }

        if (sub === "disable") {
          config.welcome.enabled =
            false;

          save();

          return interaction.reply(
            "✅ Welcome system disabled."
          );
        }

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                "👋 Welcome Status"
              )
              .addFields(
                f(
                  "Enabled",
                  String(
                    config.welcome.enabled
                  ),
                  true
                ),
                f(
                  "Channel",
                  config.welcome.channelId
                    ? `<#${config.welcome.channelId}>`
                    : "None",
                  true
                ),
                f(
                  "Message",
                  config.welcome.message
                )
              )
              .setTimestamp()
          ],
          ephemeral: true
        });
      }

      // ======================================================
      // REACTION ROLE
      // ======================================================

      if (
        command ===
        "reactionrole"
      ) {
        const sub =
          interaction.options.getSubcommand();

        if (sub === "add") {
          const messageId =
            interaction.options
              .getString("message_id");

          const emoji =
            interaction.options
              .getString("emoji");

          const role =
            interaction.options
              .getRole("role");

          const me =
            interaction.guild.members.me;

          if (
            role.managed ||
            role.position >=
              me.roles.highest.position
          ) {
            return interaction.reply({
              content:
                "❌ That role is above my bot role.",
              ephemeral: true
            });
          }

          const key =
            reactionKey(
              interaction.channel.id,
              messageId
            );

          config.reactionRoles[key] ??= [];

          if (
            config.reactionRoles[key]
              .some(
                x => x.emoji === emoji
              )
          ) {
            return interaction.reply({
              content:
                "❌ That emoji is already configured.",
              ephemeral: true
            });
          }

          config.reactionRoles[key].push({
            emoji,
            roleId: role.id
          });

          save();

          const message =
            await interaction.channel.messages
              .fetch(messageId)
              .catch(() => null);

          if (!message) {
            return interaction.reply({
              content:
                "⚠️ Saved, but I couldn't find that message in this channel.",
              ephemeral: true
            });
          }

          await message.react(emoji)
            .catch(() => {});

          await logEmbed(
            interaction.guild,
            "reactionRoles",
            "🎭 Reaction Role Added",
            [
              f(
                "Message",
                message.url
              ),
              f(
                "Emoji",
                emoji
              ),
              f(
                "Role",
                role.toString()
              )
            ],
            0x57f287
          );

          return interaction.reply(
            "✅ Reaction role configured."
          );
        }

        if (sub === "remove") {
          const messageId =
            interaction.options
              .getString("message_id");

          const emoji =
            interaction.options
              .getString("emoji");

          const key =
            reactionKey(
              interaction.channel.id,
              messageId
            );

          if (
            !config.reactionRoles[key]
          ) {
            return interaction.reply(
              "❌ No reaction roles configured for that message."
            );
          }

          config.reactionRoles[key] =
            config.reactionRoles[key]
              .filter(
                x => x.emoji !== emoji
              );

          if (
            !config.reactionRoles[key].length
          ) {
            delete config.reactionRoles[key];
          }

          save();

          return interaction.reply(
            "✅ Reaction role removed."
          );
        }

        const list = [];

        for (
          const [key, values]
          of Object.entries(
            config.reactionRoles
          )
        ) {
          for (const value of values) {
            list.push(
              `\`${key}\` — ${value.emoji} → <@&${value.roleId}>`
            );
          }
        }

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                "🎭 Reaction Roles"
              )
              .setDescription(
                list.length
                  ? list.slice(0, 30).join("\n")
                  : "No reaction roles configured."
              )
              .setTimestamp()
          ],
          ephemeral: true
        });
      }

      // ======================================================
      // LEADERBOARD
      // ======================================================

      if (
        command ===
        "leaderboard"
      ) {
        const sub =
          interaction.options.getSubcommand();

        if (sub === "enable") {
          config.leaderboard.enabled =
            true;

          save();

          return interaction.reply(
            "🏆 Leaderboard enabled."
          );
        }

        if (sub === "disable") {
          config.leaderboard.enabled =
            false;

          save();

          return interaction.reply(
            "🏆 Leaderboard disabled."
          );
        }

        if (sub === "reset") {
          config.leaderboard.users[
            interaction.guild.id
          ] = {};

          save();

          await logEmbed(
            interaction.guild,
            "leaderboard",
            "🏆 Leaderboard Reset",
            [
              f(
                "Reset by",
                interaction.user.toString()
              )
            ]
          );

          return interaction.reply(
            "✅ Leaderboard reset."
          );
        }

        if (sub === "status") {
          return interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setTitle(
                  "🏆 Leaderboard Status"
                )
                .addFields(
                  f(
                    "Enabled",
                    String(
                      config.leaderboard.enabled
                    ),
                    true
                  )
                )
                .setTimestamp()
            ],
            ephemeral: true
          });
        }

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                "🏆 Activity Leaderboard"
              )
              .setDescription(
                leaderboardText(
                  interaction.guild
                )
              )
              .setTimestamp()
          ]
        });
      }

      // ======================================================
      // OWNER ADS
      // ======================================================

      if (
        command ===
        "ads"
      ) {
        if (
          !ownerOnly(
            interaction.user.id
          )
        ) {
          return interaction.reply({
            content:
              "❌ Bot owner only.",
            ephemeral: true
          });
        }

        const sub =
          interaction.options.getSubcommand();

        if (sub === "setup") {
          config.ads.channelId =
            interaction.options
              .getChannel("channel").id;

          save();

          return interaction.reply(
            "✅ Advertisement channel saved."
          );
        }

        if (sub === "message") {
          config.ads.message =
            interaction.options
              .getString("text");

          save();

          return interaction.reply(
            "✅ Advertisement message saved."
          );
        }

        if (sub === "enable") {
          config.ads.enabled = true;

          save();

          return interaction.reply(
            "✅ Advertisement system enabled."
          );
        }

        if (sub === "disable") {
          config.ads.enabled = false;

          save();

          return interaction.reply(
            "✅ Advertisement system disabled."
          );
        }

        if (sub === "broadcast") {
          const result =
            await broadcastAd();

          await logEmbed(
            interaction.guild,
            "announcements",
            "📢 Owner Advertisement Broadcast",
            [
              f("Sent", result.sent),
              f("Skipped", result.skipped),
              f(
                "Owner",
                interaction.user.toString()
              )
            ]
          );

          return interaction.reply({
            content:
              `✅ Advertisement broadcast complete.\nSent: ${result.sent}\nSkipped: ${result.skipped}`,
            ephemeral: true
          });
        }

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                "📢 Advertisement Status"
              )
              .addFields(
                f(
                  "Enabled",
                  String(
                    config.ads.enabled
                  ),
                  true
                ),
                f(
                  "Channel",
                  config.ads.channelId
                    ? `<#${config.ads.channelId}>`
                    : "None",
                  true
                ),
                f(
                  "Message",
                  config.ads.message ||
                  "None"
                )
              )
              .setTimestamp()
          ],
          ephemeral: true
        });
      }

      // ======================================================
      // BOT INFO
      // ======================================================

      if (
        command ===
        "botinfo"
      ) {
        if (
          !ownerOnly(
            interaction.user.id
          )
        ) {
          return interaction.reply({
            content:
              "❌ Bot owner only.",
            ephemeral: true
          });
        }

        let totalUsers = 0;

        for (
          const guild
          of client.guilds.cache.values()
        ) {
          totalUsers +=
            guild.memberCount || 0;
        }

        const uptime =
          Math.floor(
            process.uptime()
          );

        const hours =
          Math.floor(
            uptime / 3600
          );

        const minutes =
          Math.floor(
            (uptime % 3600) / 60
          );

        const seconds =
          uptime % 60;

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                "🤖 AkiyO Bot Information"
              )
              .addFields(
                f(
                  "Bot",
                  `${client.user.tag}`
                ),
                f(
                  "Bot ID",
                  client.user.id
                ),
                f(
                  "Guilds",
                  client.guilds.cache.size,
                  true
                ),
                f(
                  "Users",
                  totalUsers,
                  true
                ),
                f(
                  "Commands",
                  commands.length,
                  true
                ),
                f(
                  "Uptime",
                  `${hours}h ${minutes}m ${seconds}s`,
                  true
                ),
                f(
                  "Node.js",
                  process.version,
                  true
                ),
                f(
                  "discord.js",
                  require("discord.js").version,
                  true
                )
              )
              .setTimestamp()
          ],
          ephemeral: true
        });
      }

    } catch (err) {
      console.error(
        "interactionCreate:",
        err
      );

      if (
        !interaction.replied &&
        !interaction.deferred
      ) {
        await interaction.reply({
          content:
            "❌ An internal error occurred. Check the bot console.",
          ephemeral: true
        }).catch(() => {});
      }
    }
  }
);

// ============================================================
// READY
// ============================================================

client.once(
  "clientReady",
  async () => {
    console.log(
      `Logged in as ${client.user.tag}`
    );

    console.log(
      `Guilds: ${client.guilds.cache.size}`
    );

    try {
      await registerCommands();
    } catch (err) {
      console.error(
        "Command registration:",
        err
      );
    }

    console.log(
      "======================================"
    );

    console.log(
      "AKIYO DISCORD BOT ONLINE"
    );

    console.log(
      "DM Tickets: ON"
    );

    console.log(
      "AutoMod: ON"
    );

    console.log(
      "Anti-Nuke: ON"
    );

    console.log(
      "Autorole: READY"
    );

    console.log(
      "Verification: READY"
    );

    console.log(
      "Reaction Roles: READY"
    );

    console.log(
      "Welcome: READY"
    );

    console.log(
      "Leaderboard: READY"
    );

    console.log(
      "Announcements: READY"
    );

    console.log(
      "Full Logging: READY"
    );

    console.log(
      "======================================"
    );
  }
);

// ============================================================
// ERROR HANDLERS
// ============================================================

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
});

// ============================================================
// LOGIN
// ============================================================

client.login(TOKEN);
