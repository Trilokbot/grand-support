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

/* =========================
   AKIYO CONFIG
========================= */

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || "1542750606739898428";
const PORT = Number(process.env.PORT) || 10000;

if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN is missing.");
  process.exit(1);
}

/* =========================
   HEALTH SERVER
========================= */

http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("AkiyO Bot Online");
  })
  .listen(PORT, "0.0.0.0", () => {
    console.log(`🌐 Health server running on port ${PORT}`);
  });

/* =========================
   DISCORD CLIENT
========================= */

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildWebhooks,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User,
    Partials.Reaction
  ]
});

/* =========================
   DATABASE
========================= */

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "config.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DEFAULT_GUILD = {
  logs: {
    all: null
  },

  support: {
    categoryId: null,
    staffRoleId: null
  },

  automod: {
    enabled: true,
    spamLimit: 6,
    spamWindow: 5000,
    repeatedLimit: 3,
    capsPercent: 75,
    invite: true,
    massMentions: true,
    userMentionsLimit: 5,
    roleMentionsLimit: 5,
    badWords: [],

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
    action: "alert",

    raidJoinCount: 10,
    raidWindow: 10000,

    massBan: 3,
    massKick: 3,
    massChannelDelete: 3,
    massRoleDelete: 3,
    massChannelCreate: 5,
    massRoleCreate: 5,

    trustedMembers: [],
    trustedBots: [],
    trustedRoleId: null,

    protectedRoles: [],
    protectedChannels: []
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
    message: "Welcome {user} to {server}! You are member #{count}."
  },

  verification: {
    enabled: false,
    channelId: null,
    roleId: null,
    messageId: null
  },

  reactionRoles: {},

  tickets: {}
};

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

let config = {};

try {
  if (fs.existsSync(DATA_FILE)) {
    config = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  }
} catch (error) {
  console.error("Database read error:", error);
  config = {};
}

function getGuildConfig(guild) {
  if (!guild) return DEFAULT_GUILD;

  config[guild.id] = merge(
    JSON.parse(JSON.stringify(DEFAULT_GUILD)),
    config[guild.id] || {}
  );

  return config[guild.id];
}

function save() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(config, null, 2)
    );
  } catch (error) {
    console.error("Database save error:", error);
  }
}

/* =========================
   MEMORY
========================= */

const tickets = new Map();
const claims = new Map();

const spamTracker = new Map();
const repeatTracker = new Map();
const securityTracker = new Map();

/* =========================
   PROFESSIONAL UI
========================= */

const COLORS = {
  primary: 0x5865f2,
  success: 0x57f287,
  danger: 0xed4245,
  warning: 0xfee75c,
  info: 0x3498db,
  purple: 0x9b59b6,
  dark: 0x2b2d31
};

function field(name, value, inline = false) {
  return {
    name: String(name).slice(0, 256),
    value: String(value || "-").slice(0, 1024),
    inline
  };
}

function baseEmbed(guild, title, color = COLORS.primary) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setTimestamp()
    .setFooter({
      text: "AkiyO • Professional Discord Management"
    });

  if (guild) {
    embed.setAuthor({
      name: guild.name,
      iconURL: guild.iconURL({ dynamic: true }) || undefined
    });
  }

  return embed;
}

function successEmbed(guild, title, details = []) {
  return baseEmbed(guild, `✅ ${title}`, COLORS.success)
    .addFields(details);
}

function errorEmbed(guild, title, details = []) {
  return baseEmbed(guild, `❌ ${title}`, COLORS.danger)
    .addFields(details);
}

function infoEmbed(guild, title, details = []) {
  return baseEmbed(guild, `ℹ️ ${title}`, COLORS.info)
    .addFields(details);
}

function warningEmbed(guild, title, details = []) {
  return baseEmbed(guild, `⚠️ ${title}`, COLORS.warning)
    .addFields(details);
}

async function replySuccess(interaction, title, details = []) {
  return interaction.reply({
    embeds: [successEmbed(interaction.guild, title, details)],
    ephemeral: true
  });
}

async function replyError(interaction, title, details = []) {
  return interaction.reply({
    embeds: [errorEmbed(interaction.guild, title, details)],
    ephemeral: true
  });
}

/* =========================
   PERMISSIONS
========================= */

function isStaff(member) {
  if (!member) return false;

  const c = getGuildConfig(member.guild);

  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    (
      c.support.staffRoleId &&
      member.roles.cache.has(c.support.staffRoleId)
    )
  );
}

function isManager(member) {
  return (
    member &&
    (
      member.permissions.has(PermissionFlagsBits.Administrator) ||
      member.permissions.has(PermissionFlagsBits.ManageGuild)
    )
  );
}

function isTrusted(guild, userId) {
  const c = getGuildConfig(guild);
  const member = guild.members.cache.get(userId);

  if (!userId) return false;

  if (
    member?.permissions.has(PermissionFlagsBits.Administrator)
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
    c.security.trustedRoleId &&
    member?.roles.cache.has(c.security.trustedRoleId)
  ) {
    return true;
  }

  return false;
}

/* =========================
   UNIFIED LOG SYSTEM
========================= */

async function log(
  guild,
  category,
  title,
  fields = [],
  color = COLORS.info
) {
  try {
    if (!guild) return;

    const c = getGuildConfig(guild);

    if (!c.logs.all) return;

    const channel = await guild.channels
      .fetch(c.logs.all)
      .catch(() => null);

    if (!channel || !channel.isTextBased()) return;

    const embed = baseEmbed(guild, title, color);

    embed.addFields(
      field("Category", category, true),
      field("Event Time", `<t:${Math.floor(Date.now() / 1000)}:F>`, true),
      ...fields
    );

    await channel.send({
      embeds: [embed]
    }).catch(() => {});
  } catch (error) {
    console.error("Log error:", error);
  }
}

/* =========================
   COMMAND LOG
========================= */

async function commandLog(interaction) {
  await log(
    interaction.guild,
    "Command",
    "⚡ Command Executed",
    [
      field("Command", `/${interaction.commandName}`),
      field(
        "Executor",
        `${interaction.user.tag} (${interaction.user.id})`
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

/* =========================
   MODERATION DATABASE
========================= */

async function addPunishment(
  guild,
  userId,
  type,
  reason,
  moderatorId
) {
  config[guild.id] ??= JSON.parse(
    JSON.stringify(DEFAULT_GUILD)
  );

  config[guild.id].punishments ??= {};
  config[guild.id].punishments[userId] ??= [];

  config[guild.id].punishments[userId].push({
    type,
    reason,
    moderatorId,
    time: Date.now()
  });

  save();
}

async function addWarning(
  member,
  reason,
  moderatorId
) {
  const guild = member.guild;

  const c = getGuildConfig(guild);

  c.warnings[member.id] ??= [];

  c.warnings[member.id].push({
    reason,
    moderatorId,
    time: Date.now()
  });

  await addPunishment(
    guild,
    member.id,
    "warn",
    reason,
    moderatorId
  );

  const total = c.warnings[member.id].length;

  save();

  return total;
}

/* =========================
   TIME PARSER
========================= */

function parseDuration(input) {
  if (!input) return null;

  const match = String(input)
    .trim()
    .toLowerCase()
    .match(/^(\d+)(s|m|h|d)$/);

  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2];

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  return amount * multipliers[unit];
}

/* =========================
   AUTOMOD
========================= */

async function runAutoMod(message) {
  if (!message.guild) return;
  if (!message.member) return;
  if (message.author.bot) return;

  const c = getGuildConfig(message.guild);

  if (!c.automod.enabled) return;
  if (isStaff(message.member)) return;

  const content = message.content || "";
  const lower = content.toLowerCase();

  let type = null;
  let reason = null;

  /* Invite Protection */

  if (
    c.automod.invite &&
    /discord(?:\.gg|\.com\/invite)\/[A-Za-z0-9-]+/i.test(content)
  ) {
    type = "invite";
    reason = "Discord invite link detected";
  }

  /* Mass Mentions */

  else if (
    c.automod.massMentions &&
    (
      message.mentions.everyone ||
      message.mentions.users.size >= c.automod.userMentionsLimit ||
      message.mentions.roles.size >= c.automod.roleMentionsLimit
    )
  ) {
    type = "massmention";
    reason = "Excessive mentions detected";
  }

  /* Bad Words */

  else {
    for (const word of c.automod.badWords) {
      if (
        word &&
        lower.includes(String(word).toLowerCase())
      ) {
        type = "badword";
        reason = `Blocked word detected: ${word}`;
        break;
      }
    }
  }

  /* Caps */

  if (!type) {
    const letters = content.replace(/[^A-Za-z]/g, "");

    if (letters.length >= 8) {
      const upper = letters
        .replace(/[^A-Z]/g, "")
        .length;

      const percent =
        (upper / letters.length) * 100;

      if (percent >= c.automod.capsPercent) {
        type = "caps";
        reason = "Excessive capital letters";
      }
    }
  }

  /* Spam */

  const now = Date.now();

  const spamKey =
    `${message.guild.id}:${message.author.id}`;

  const spam = (
    spamTracker.get(spamKey) || []
  ).filter(
    timestamp =>
      now - timestamp < c.automod.spamWindow
  );

  spam.push(now);

  spamTracker.set(spamKey, spam);

  if (
    !type &&
    spam.length >= c.automod.spamLimit
  ) {
    type = "spam";
    reason =
      `Spam detected: ${spam.length} messages within ${c.automod.spamWindow / 1000}s`;

    spamTracker.delete(spamKey);
  }

  /* Repeated Messages */

  const repeatKey =
    `${message.guild.id}:${message.author.id}`;

  const previous =
    repeatTracker.get(repeatKey) || {
      content: "",
      count: 0,
      time: 0
    };

  if (
    previous.content === content &&
    now - previous.time < 30000
  ) {
    previous.count++;
  } else {
    previous.count = 1;
  }

  previous.content = content;
  previous.time = now;

  repeatTracker.set(repeatKey, previous);

  if (
    !type &&
    previous.count >= c.automod.repeatedLimit
  ) {
    type = "repeat";
    reason =
      `Repeated message detected ${previous.count} times`;

    repeatTracker.delete(repeatKey);
  }

  if (!type) return;

  const action =
    c.automod.actions[type] || "delete";

  await message.delete().catch(() => {});

  if (
    action === "timeout" &&
    message.member.moderatable
  ) {
    const duration =
      c.automod.timeoutSeconds[type] || 60;

    await message.member
      .timeout(
        duration * 1000,
        `AkiyO AutoMod: ${reason}`
      )
      .catch(() => {});
  }

  if (action === "warn") {
    await addWarning(
      message.member,
      `AutoMod: ${reason}`,
      client.user.id
    );
  }

  await log(
    message.guild,
    "AutoMod",
    "🛡️ AutoMod Action",
    [
      field(
        "User",
        `${message.author.tag} (${message.author.id})`
      ),
      field("Reason", reason),
      field("Action", action),
      field(
        "Channel",
        `${message.channel} (${message.channel.id})`
      )
    ],
    COLORS.danger
  );
}

/* =========================
   SECURITY
========================= */

async function securityEvent(
  guild,
  type,
  executorId,
  details
) {
  if (!guild || !executorId) return;

  const c = getGuildConfig(guild);

  if (!c.security.enabled) return;

  if (isTrusted(guild, executorId)) return;

  const key =
    `${guild.id}:${type}:${executorId}`;

  const now = Date.now();

  const list = (
    securityTracker.get(key) || []
  ).filter(
    timestamp => now - timestamp < 30000
  );

  list.push(now);

  securityTracker.set(key, list);

  const limits = {
    ban: c.security.massBan,
    kick: c.security.massKick,
    channelDelete: c.security.massChannelDelete,
    roleDelete: c.security.massRoleDelete,
    channelCreate: c.security.massChannelCreate,
    roleCreate: c.security.massRoleCreate
  };

  const limit = limits[type] || 999;

  if (list.length < limit) return;

  await log(
    guild,
    "Security",
    "🚨 Anti-Nuke Security Alert",
    [
      field("Executor", `<@${executorId}> (${executorId})`),
      field("Action", type),
      field("Detected Count", list.length),
      field("Threshold", limit),
      field("Details", details),
      field("Security Action", c.security.action)
    ],
    COLORS.danger
  );

  securityTracker.delete(key);

  if (c.security.action === "ban") {
    const member = await guild.members
      .fetch(executorId)
      .catch(() => null);

    if (member?.bannable) {
      await member.ban({
        reason: `AkiyO Anti-Nuke: ${type}`
      }).catch(() => {});
    }
  }

  if (c.security.action === "kick") {
    const member = await guild.members
      .fetch(executorId)
      .catch(() => null);

    if (member?.kickable) {
      await member.kick(
        `AkiyO Anti-Nuke: ${type}`
      ).catch(() => {});
    }
  }
}

/* =========================
   TICKETS
========================= */

function ticketButtons() {
  return new ActionRowBuilder().addComponents(
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
      .setCustomId("ticket_lock")
      .setLabel("Lock")
      .setEmoji("🔐")
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId("ticket_transcript")
      .setLabel("Transcript")
      .setEmoji("📄")
      .setStyle(ButtonStyle.Secondary)
  );
}

function ticketByChannel(channelId) {
  for (const [
    userId,
    ticket
  ] of tickets.entries()) {
    if (ticket.channelId === channelId) {
      return [userId, ticket];
    }
  }

  return null;
}

async function createTicket(user) {
  let selectedGuild = null;

  for (const guild of client.guilds.cache.values()) {
    const c = getGuildConfig(guild);

    if (
      c.support.categoryId &&
      c.support.staffRoleId
    ) {
      selectedGuild = guild;
      break;
    }
  }

  if (!selectedGuild) {
    try {
      await user.send(
        "❌ AkiyO support system is not configured yet. An administrator must configure the ticket category and staff role."
      );
    } catch {}

    return null;
  }

  const guild = selectedGuild;
  const c = getGuildConfig(guild);

  const existing = tickets.get(
    `${guild.id}:${user.id}`
  );

  if (existing) {
    const oldChannel = await guild.channels
      .fetch(existing.channelId)
      .catch(() => null);

    if (oldChannel) return oldChannel;

    tickets.delete(
      `${guild.id}:${user.id}`
    );
  }

  const role =
    await guild.roles
      .fetch(c.support.staffRoleId)
      .catch(() => null);

  if (!role) return null;

  const safeName =
    user.username
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 15) || "user";

  const channel =
    await guild.channels.create({
      name: `ticket-${safeName}`,
      type: ChannelType.GuildText,
      parent: c.support.categoryId || undefined,

      topic:
        `AKIYO_TICKET:${user.id}`,

      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [
            PermissionFlagsBits.ViewChannel
          ]
        },

        {
          id: role.id,
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

  tickets.set(
    `${guild.id}:${user.id}`,
    {
      guildId: guild.id,
      channelId: channel.id,
      ownerId: user.id,
      status: "open",
      claimedBy: null,
      locked: false,
      createdAt: Date.now()
    }
  );

  await channel.send({
    content: `<@&${role.id}>`,
    embeds: [
      baseEmbed(
        guild,
        "🎫 New AkiyO Support Ticket",
        COLORS.primary
      )
        .setDescription(
          "A new support request has been created."
        )
        .addFields(
          field(
            "Ticket Owner",
            `${user} (${user.id})`
          ),
          field(
            "Status",
            "🟢 Open",
            true
          ),
          field(
            "Created",
            `<t:${Math.floor(Date.now() / 1000)}:F>`,
            true
          ),
          field(
            "Instructions",
            "Please review the user's request and assist professionally."
          )
        )
    ],
    components: [ticketButtons()]
  });

  try {
    await user.send({
      embeds: [
        infoEmbed(
          guild,
          "Support Ticket Created",
          [
            field(
              "Server",
              guild.name
            ),
            field(
              "Ticket Channel",
              channel.name
            ),
            field(
              "Status",
              "🟢 Open"
            ),
            field(
              "Instructions",
              "Send your support messages here in DM and AkiyO will forward them to the support team."
            )
          ]
        )
      ]
    });
  } catch {}

  await log(
    guild,
    "Tickets",
    "🎫 Ticket Created",
    [
      field(
        "User",
        `${user.tag} (${user.id})`
      ),
      field(
        "Channel",
        `${channel} (${channel.id})`
      ),
      field(
        "Status",
        "Open"
      )
    ],
    COLORS.success
  );

  save();

  return channel;
}

/* =========================
   TRANSCRIPT
========================= */

async function createTranscript(channel) {
  const messages = [];
  let before;

  while (messages.length < 10000) {
    const batch =
      await channel.messages
        .fetch({
          limit: 100,
          before
        })
        .catch(() => null);

    if (!batch?.size) break;

    messages.push(...batch.values());

    before =
      batch.last().id;

    if (batch.size < 100) break;
  }

  messages.reverse();

  const text = messages
    .map(message => {
      const attachments =
        [...message.attachments.values()]
          .map(a => a.url)
          .join("\n");

      return [
        `[${message.createdAt.toISOString()}]`,
        `${message.author.tag} (${message.author.id})`,
        message.content || "[No text]",
        attachments
      ].join("\n");
    })
    .join("\n\n------------------------------\n\n");

  return Buffer.from(text, "utf8");
}

/* =========================
   WELCOME
========================= */

function formatWelcome(message, member) {
  return String(message)
    .replaceAll("{user}", member.toString())
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
      String(member.guild.memberCount)
    );
}

/* =========================
   REACTION ROLE
========================= */

function normalizeEmoji(raw) {
  const custom =
    String(raw).match(
      /^<a?:[^:>]+:(\d+)>$/
    );

  return custom
    ? custom[1]
    : raw;
}

function reactionKey(reaction) {
  return (
    reaction.emoji.id ||
    reaction.emoji.name ||
    null
  );
}

/* =========================
   SLASH COMMANDS
========================= */

const commands = [];

function addCommand(command) {
  commands.push(command.toJSON());
}

/* Ticket */

addCommand(
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription(
      "Open a professional support ticket."
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription(
      "Send the AkiyO support panel."
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName("ticketsetup")
    .setDescription(
      "Configure the ticket system."
    )
    .addChannelOption(option =>
      option
        .setName("category")
        .setDescription(
          "Ticket category"
        )
        .addChannelTypes(
          ChannelType.GuildCategory
        )
        .setRequired(true)
    )
    .addRoleOption(option =>
      option
        .setName("staff_role")
        .setDescription(
          "Ticket staff role"
        )
        .setRequired(true)
    )
);

/* Ticket management */

for (const command of [
  "close",
  "reopen",
  "delete",
  "claim",
  "unclaim",
  "lock",
  "unlock"
]) {
  addCommand(
    new SlashCommandBuilder()
      .setName(command)
      .setDescription(
        `${command} the current support ticket.`
      )
  );
}

addCommand(
  new SlashCommandBuilder()
    .setName("ticketadd")
    .setDescription(
      "Add a member to the ticket."
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
      "Remove a member from the ticket."
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
      "Rename the current ticket."
    )
    .addStringOption(option =>
      option
        .setName("name")
        .setDescription("New ticket name")
        .setRequired(true)
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName("ticketinfo")
    .setDescription(
      "Show ticket information."
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName("ticketstats")
    .setDescription(
      "Show ticket statistics."
    )
);

/* Log Setup */

addCommand(
  new SlashCommandBuilder()
    .setName("logsetup")
    .setDescription(
      "Configure the single unified AkiyO log channel."
    )
    .addSubcommand(sub =>
      sub
        .setName("all")
        .setDescription(
          "Set one channel for all AkiyO logs."
        )
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription(
              "Unified log channel"
            )
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("status")
        .setDescription(
          "Show the unified log configuration."
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("disable")
        .setDescription(
          "Disable unified logging."
        )
    )
);

/* AutoMod */

addCommand(
  new SlashCommandBuilder()
    .setName("automod")
    .setDescription(
      "Manage AkiyO AutoMod."
    )
    .addSubcommand(sub =>
      sub
        .setName("enable")
        .setDescription("Enable AutoMod.")
    )
    .addSubcommand(sub =>
      sub
        .setName("disable")
        .setDescription("Disable AutoMod.")
    )
    .addSubcommand(sub =>
      sub
        .setName("status")
        .setDescription(
          "View AutoMod status."
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("config")
        .setDescription(
          "Configure AutoMod."
        )
        .addIntegerOption(option =>
          option
            .setName("spam_limit")
            .setDescription(
              "Messages before spam detection."
            )
            .setMinValue(3)
            .setMaxValue(30)
        )
        .addIntegerOption(option =>
          option
            .setName("caps_percent")
            .setDescription(
              "Capital percentage."
            )
            .setMinValue(50)
            .setMaxValue(100)
        )
        .addIntegerOption(option =>
          option
            .setName("timeout")
            .setDescription(
              "Default AutoMod timeout seconds."
            )
            .setMinValue(10)
            .setMaxValue(2419200)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("badword")
        .setDescription(
          "Add a blocked word."
        )
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
        .setDescription(
          "Remove a blocked word."
        )
        .addStringOption(option =>
          option
            .setName("word")
            .setDescription("Word")
            .setRequired(true)
        )
    )
);

/* Security */

addCommand(
  new SlashCommandBuilder()
    .setName("security")
    .setDescription(
      "Manage AkiyO security and Anti-Nuke."
    )
    .addSubcommand(sub =>
      sub.setName("enable").setDescription("Enable security.")
    )
    .addSubcommand(sub =>
      sub.setName("disable").setDescription("Disable security.")
    )
    .addSubcommand(sub =>
      sub.setName("status").setDescription("View security status.")
    )
    .addSubcommand(sub =>
      sub
        .setName("action")
        .setDescription("Set Anti-Nuke action.")
        .addStringOption(option =>
          option
            .setName("type")
            .setDescription("Action")
            .setRequired(true)
            .addChoices(
              { name: "Alert", value: "alert" },
              { name: "Kick", value: "kick" },
              { name: "Ban", value: "ban" }
            )
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("trustedmember")
        .setDescription("Trust a member.")
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
        .setDescription("Remove trusted member.")
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
        .setDescription("Trust a bot.")
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
        .setDescription("Remove trusted bot.")
        .addUserOption(option =>
          option
            .setName("user")
            .setDescription("Bot")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("trustedrole")
        .setDescription("Set trusted role.")
        .addRoleOption(option =>
          option
            .setName("role")
            .setDescription("Role")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("protectedrole")
        .setDescription("Protect a role.")
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
        .setDescription("Unprotect a role.")
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
        .setDescription("Protect a channel.")
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
        .setDescription("Unprotect a channel.")
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
          "List trusted and protected settings."
        )
    )
);

/* Configuration */

addCommand(
  new SlashCommandBuilder()
    .setName("config")
    .setDescription(
      "Manage AkiyO server configuration."
    )
    .addSubcommand(sub =>
      sub
        .setName("view")
        .setDescription(
          "View server configuration."
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("staffrole")
        .setDescription(
          "Set support staff role."
        )
        .addRoleOption(option =>
          option
            .setName("role")
            .setDescription("Staff role")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("ticketcategory")
        .setDescription(
          "Set ticket category."
        )
        .addChannelOption(option =>
          option
            .setName("category")
            .setDescription("Category")
            .addChannelTypes(
              ChannelType.GuildCategory
            )
            .setRequired(true)
        )
    )
);

/* Moderation */

addCommand(
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member.")
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
        .setRequired(true)
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a member.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Member")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("duration")
        .setDescription("Example: 30s, 10m, 2h, 1d")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("Reason")
        .setRequired(true)
    )
);

for (const command of ["kick", "ban"]) {
  addCommand(
    new SlashCommandBuilder()
      .setName(command)
      .setDescription(
        `${command} a member.`
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
          .setRequired(true)
      )
  );
}

addCommand(
  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unban a user.")
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
        .setRequired(true)
    )
);

for (const command of [
  "warnings",
  "punishments"
]) {
  addCommand(
    new SlashCommandBuilder()
      .setName(command)
      .setDescription(
        `View ${command} history.`
      )
      .addUserOption(option =>
        option
          .setName("user")
          .setDescription("User")
          .setRequired(true)
      )
  );
}

/* Announcements */

addCommand(
  new SlashCommandBuilder()
    .setName("announce")
    .setDescription(
      "Send a professional announcement."
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
        .setDescription("Announcement")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("title")
        .setDescription("Optional title")
    )
    .addStringOption(option =>
      option
        .setName("footer")
        .setDescription("Optional footer")
    )
    .addBooleanOption(option =>
      option
        .setName("embed")
        .setDescription(
          "Send as embed."
        )
    )
    .addBooleanOption(option =>
      option
        .setName("everyone")
        .setDescription(
          "Mention @everyone."
        )
    )
    .addBooleanOption(option =>
      option
        .setName("here")
        .setDescription(
          "Mention @here."
        )
    )
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription(
          "Mention role."
        )
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription(
          "Mention user."
        )
    )
);

/* Autorole */

addCommand(
  new SlashCommandBuilder()
    .setName("autorole")
    .setDescription(
      "Manage automatic join roles."
    )
    .addSubcommand(sub =>
      sub
        .setName("set")
        .setDescription("Set autorole.")
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
        .setDescription("Disable autorole.")
    )
    .addSubcommand(sub =>
      sub
        .setName("status")
        .setDescription("View autorole.")
    )
);

/* Welcome */

addCommand(
  new SlashCommandBuilder()
    .setName("welcome")
    .setDescription(
      "Manage welcome system."
    )
    .addSubcommand(sub =>
      sub
        .setName("set")
        .setDescription("Configure welcome.")
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
              "Welcome message."
            )
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("disable")
        .setDescription("Disable welcome.")
    )
    .addSubcommand(sub =>
      sub
        .setName("status")
        .setDescription("View welcome.")
    )
);

/* Verification */

addCommand(
  new SlashCommandBuilder()
    .setName("verification")
    .setDescription(
      "Manage verification system."
    )
    .addSubcommand(sub =>
      sub
        .setName("setup")
        .setDescription("Setup verification.")
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription("Verification channel")
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName("role")
            .setDescription(
              "Verified role"
            )
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("disable")
        .setDescription(
          "Disable verification."
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("status")
        .setDescription(
          "View verification."
        )
    )
);

/* Reaction Roles */

addCommand(
  new SlashCommandBuilder()
    .setName("autoreactionrole")
    .setDescription(
      "Manage reaction roles."
    )
    .addSubcommand(sub =>
      sub
        .setName("add")
        .setDescription(
          "Create a reaction role."
        )
        .addStringOption(option =>
          option
            .setName("message_id")
            .setDescription(
              "Message ID"
            )
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("emoji")
            .setDescription(
              "Emoji"
            )
            .setRequired(true)
        )
        .addRoleOption(option =>
          option
            .setName("role")
            .setDescription(
              "Role"
            )
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("remove")
        .setDescription(
          "Remove a reaction role."
        )
        .addStringOption(option =>
          option
            .setName("message_id")
            .setDescription(
              "Message ID"
            )
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("emoji")
            .setDescription(
              "Emoji"
            )
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("list")
        .setDescription(
          "List reaction roles."
        )
    )
);

/* AI */

addCommand(
  new SlashCommandBuilder()
    .setName("ai")
    .setDescription(
      "AkiyO AI assistant."
    )
    .addSubcommand(sub =>
      sub
        .setName("ask")
        .setDescription(
          "Ask AkiyO AI."
        )
        .addStringOption(option =>
          option
            .setName("prompt")
            .setDescription(
              "Your question."
            )
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("reset")
        .setDescription(
          "Reset your AI conversation."
        )
    )
);

/* Utility */

addCommand(
  new SlashCommandBuilder()
    .setName("help")
    .setDescription(
      "View the AkiyO command center."
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName("botinfo")
    .setDescription(
      "View AkiyO information."
    )
);

/* =========================
   COMMAND PERMISSION LIST
========================= */

const STAFF_COMMANDS = new Set([
  "ticketpanel",
  "ticketsetup",
  "close",
  "reopen",
  "delete",
  "claim",
  "unclaim",
  "lock",
  "unlock",
  "ticketadd",
  "ticketremove",
  "ticketrename",
  "ticketinfo",
  "ticketstats",
  "logsetup",
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
  "announce",
  "autorole",
  "welcome",
  "verification",
  "autoreactionrole"
]);

/* =========================
   REGISTER COMMANDS
========================= */

async function registerCommands() {
  const rest =
    new REST({ version: "10" })
      .setToken(TOKEN);

  await rest.put(
    Routes.applicationCommands(CLIENT_ID),
    {
      body: commands
    }
  );

  console.log(
    `✅ Registered ${commands.length} global commands.`
  );
}

/* =========================
   MESSAGE EVENTS
========================= */

client.on(
  "messageCreate",
  async message => {
    try {
      if (message.author.bot) return;

      /* DM Ticket System */

      if (!message.guild) {
        let selected = null;

        for (const [
          key,
          ticket
        ] of tickets.entries()) {
          if (
            ticket.ownerId === message.author.id &&
            ticket.status === "open"
          ) {
            selected = ticket;
            break;
          }
        }

        if (!selected) {
          const channel =
            await createTicket(
              message.author
            );

          if (!channel) return;

          selected =
            [...tickets.values()]
              .find(
                ticket =>
                  ticket.ownerId ===
                  message.author.id
              );
        }

        if (!selected) return;

        const guild =
          client.guilds.cache.get(
            selected.guildId
          );

        if (!guild) return;

        const channel =
          await guild.channels
            .fetch(selected.channelId)
            .catch(() => null);

        if (!channel?.isTextBased()) return;

        await channel.send({
          embeds: [
            baseEmbed(
              guild,
              "📩 User Message",
              COLORS.info
            )
              .addFields(
                field(
                  "User",
                  `${message.author.tag} (${message.author.id})`
                ),
                field(
                  "Message",
                  message.content || "[Attachment]"
                )
              )
          ]
        });

        return;
      }

      /* Ticket Staff DM Forwarding */

      const ticket =
        ticketByChannel(
          message.channel.id
        );

      if (
        ticket &&
        isStaff(message.member)
      ) {
        const owner =
          await client.users
            .fetch(ticket[0])
            .catch(() => null);

        if (owner) {
          await owner.send({
            embeds: [
              baseEmbed(
                message.guild,
                "💬 Support Team Message",
                COLORS.info
              )
                .addFields(
                  field(
                    "Staff",
                    `${message.author.tag} (${message.author.id})`
                  ),
                  field(
                    "Message",
                    message.content || "[Attachment]"
                  ),
                  field(
                    "Ticket",
                    message.channel.name
                  )
                )
            ]
          }).catch(() => {});
        }

        return;
      }

      await runAutoMod(message);

      await log(
        message.guild,
        "Messages",
        "💬 Message Created",
        [
          field(
            "Author",
            `${message.author.tag} (${message.author.id})`
          ),
          field(
            "Channel",
            `${message.channel} (${message.channel.id})`
          ),
          field(
            "Content",
            message.content || "[Attachment]"
          )
        ],
        COLORS.info
      );
    } catch (error) {
      console.error(
        "messageCreate error:",
        error
      );
    }
  }
);

/* =========================
   MEMBER JOIN
========================= */

client.on(
  "guildMemberAdd",
  async member => {
    try {
      const guild =
        member.guild;

      const c =
        getGuildConfig(guild);

      /* Anti Bot */

      if (
        member.user.bot &&
        c.security.enabled &&
        !c.security.trustedBots.includes(
          member.id
        )
      ) {
        await log(
          guild,
          "Security",
          "🤖 Bot Added",
          [
            field(
              "Bot",
              `${member.user.tag} (${member.id})`
            ),
            field(
              "Action",
              "Untrusted bot detected"
            )
          ],
          COLORS.warning
        );
      }

      /* Autorole */

      if (
        c.autorole.enabled &&
        c.autorole.roleId
      ) {
        const role =
          await guild.roles
            .fetch(c.autorole.roleId)
            .catch(() => null);

        if (
          role &&
          guild.members.me &&
          role.position <
            guild.members.me.roles.highest.position
        ) {
          await member.roles
            .add(role, "AkiyO Autorole")
            .catch(() => {});

          await log(
            guild,
            "Members",
            "👤 Autorole Applied",
            [
              field(
                "Member",
                `${member.user.tag} (${member.id})`
              ),
              field(
                "Role",
                `${role} (${role.id})`
              )
            ],
            COLORS.success
          );
        }
      }

      /* Welcome */

      if (
        c.welcome.enabled &&
        c.welcome.channelId
      ) {
        const channel =
          await guild.channels
            .fetch(c.welcome.channelId)
            .catch(() => null);

        if (channel?.isTextBased()) {
          await channel.send(
            formatWelcome(
              c.welcome.message,
              member
            )
          ).catch(() => {});
        }

        await log(
          guild,
          "Welcome",
          "👋 Member Joined",
          [
            field(
              "Member",
              `${member.user.tag} (${member.id})`
            ),
            field(
              "Member Count",
              guild.memberCount
            )
          ],
          COLORS.success
        );
      }

      /* Raid Detection */

      const key =
        `raid:${guild.id}`;

      const now = Date.now();

      const joins = (
        securityTracker.get(key) || []
      ).filter(
        timestamp =>
          now - timestamp <
          c.security.raidWindow
      );

      joins.push(now);

      securityTracker.set(
        key,
        joins
      );

      if (
        c.security.enabled &&
        joins.length >=
        c.security.raidJoinCount
      ) {
        await log(
          guild,
          "Security",
          "🚨 Possible Raid Detected",
          [
            field(
              "Recent Joins",
              joins.length
            ),
            field(
              "Time Window",
              `${c.security.raidWindow / 1000}s`
            ),
            field(
              "Latest Member",
              `${member.user.tag} (${member.id})`
            )
          ],
          COLORS.danger
        );

        securityTracker.delete(key);
      }
    } catch (error) {
      console.error(
        "guildMemberAdd error:",
        error
      );
    }
  }
);

/* =========================
   MEMBER REMOVE / KICK
========================= */

client.on(
  "guildMemberRemove",
  async member => {
    try {
      const guild =
        member.guild;

      await log(
        guild,
        "Members",
        "👤 Member Left",
        [
          field(
            "Member",
            `${member.user.tag} (${member.id})`
          )
        ],
        COLORS.warning
      );

      const audit =
        await guild.fetchAuditLogs({
          type: AuditLogEvent.MemberKick,
          limit: 5
        }).catch(() => null);

      const entry =
        audit?.entries.find(
          item =>
            item.targetId === member.id &&
            Date.now() -
              item.createdTimestamp <
              5000
        );

      if (entry) {
        await securityEvent(
          guild,
          "kick",
          entry.executor?.id,
          `Member kicked: ${member.user.tag}`
        );

        await log(
          guild,
          "Moderation",
          "👢 Member Kicked",
          [
            field(
              "Target",
              `${member.user.tag} (${member.id})`
            ),
            field(
              "Executor",
              entry.executor
                ? `${entry.executor.tag} (${entry.executor.id})`
                : "Unknown"
            ),
            field(
              "Reason",
              entry.reason || "No reason provided"
            )
          ],
          COLORS.warning
        );
      }
    } catch (error) {
      console.error(
        "guildMemberRemove error:",
        error
      );
    }
  }
);

/* =========================
   MEMBER UPDATE
========================= */

client.on(
  "guildMemberUpdate",
  async (oldMember, newMember) => {
    try {
      if (
        oldMember.nickname !==
        newMember.nickname
      ) {
        await log(
          newMember.guild,
          "Members",
          "✏️ Nickname Updated",
          [
            field(
              "Member",
              `${newMember.user.tag} (${newMember.id})`
            ),
            field(
              "Before",
              oldMember.nickname || "None"
            ),
            field(
              "After",
              newMember.nickname || "None"
            )
          ],
          COLORS.info
        );
      }

      const oldRoles =
        new Set(oldMember.roles.cache.keys());

      const newRoles =
        new Set(newMember.roles.cache.keys());

      const added =
        [...newRoles].filter(
          id => !oldRoles.has(id)
        );

      const removed =
        [...oldRoles].filter(
          id => !newRoles.has(id)
        );

      if (added.length) {
        await log(
          newMember.guild,
          "Roles",
          "➕ Member Role Added",
          [
            field(
              "Member",
              `${newMember.user.tag} (${newMember.id})`
            ),
            field(
              "Roles",
              added
                .map(id => `<@&${id}>`)
                .join(", ")
            )
          ],
          COLORS.success
        );
      }

      if (removed.length) {
        await log(
          newMember.guild,
          "Roles",
          "➖ Member Role Removed",
          [
            field(
              "Member",
              `${newMember.user.tag} (${newMember.id})`
            ),
            field(
              "Roles",
              removed
                .map(id => `<@&${id}>`)
                .join(", ")
            )
          ],
          COLORS.warning
        );
      }
    } catch {}
  }
);

/* =========================
   MESSAGE DELETE
========================= */

client.on(
  "messageDelete",
  async message => {
    try {
      if (!message.guild) return;

      await log(
        message.guild,
        "Messages",
        "🗑️ Message Deleted",
        [
          field(
            "Author",
            message.author
              ? `${message.author.tag} (${message.author.id})`
              : "Unknown"
          ),
          field(
            "Channel",
            `${message.channel} (${message.channel.id})`
          ),
          field(
            "Content",
            message.content || "[Content unavailable]"
          )
        ],
        COLORS.danger
      );
    } catch {}
  }
);

/* =========================
   MESSAGE UPDATE
========================= */

client.on(
  "messageUpdate",
  async (oldMessage, newMessage) => {
    try {
      if (!newMessage.guild) return;

      if (
        oldMessage.content ===
        newMessage.content
      ) return;

      await log(
        newMessage.guild,
        "Messages",
        "✏️ Message Edited",
        [
          field(
            "Author",
            newMessage.author
              ? `${newMessage.author.tag} (${newMessage.author.id})`
              : "Unknown"
          ),
          field(
            "Channel",
            `${newMessage.channel} (${newMessage.channel.id})`
          ),
          field(
            "Before",
            oldMessage.content || "[Empty]"
          ),
          field(
            "After",
            newMessage.content || "[Empty]"
          )
        ],
        COLORS.info
      );
    } catch {}
  }
);

/* =========================
   CHANNEL EVENTS
========================= */

client.on(
  "channelCreate",
  async channel => {
    if (!channel.guild) return;

    await log(
      channel.guild,
      "Channels",
      "📁 Channel Created",
      [
        field(
          "Channel",
          `${channel} (${channel.id})`
        ),
        field(
          "Name",
          channel.name
        ),
        field(
          "Type",
          channel.type
        )
      ],
      COLORS.success
    );

    const audit =
      await channel.guild.fetchAuditLogs({
        type: AuditLogEvent.ChannelCreate,
        limit: 1
      }).catch(() => null);

    const entry =
      audit?.entries.first();

    if (
      entry &&
      Date.now() -
        entry.createdTimestamp <
        5000
    ) {
      await securityEvent(
        channel.guild,
        "channelCreate",
        entry.executor?.id,
        `Created channel #${channel.name}`
      );
    }
  }
);

client.on(
  "channelDelete",
  async channel => {
    if (!channel.guild) return;

    await log(
      channel.guild,
      "Channels",
      "🗑️ Channel Deleted",
      [
        field(
          "Channel",
          `${channel.name} (${channel.id})`
        )
      ],
      COLORS.danger
    );

    const audit =
      await channel.guild.fetchAuditLogs({
        type: AuditLogEvent.ChannelDelete,
        limit: 1
      }).catch(() => null);

    const entry =
      audit?.entries.first();

    if (
      entry &&
      Date.now() -
        entry.createdTimestamp <
        5000
    ) {
      await securityEvent(
        channel.guild,
        "channelDelete",
        entry.executor?.id,
        `Deleted channel #${channel.name}`
      );
    }
  }
);

/* =========================
   ROLE EVENTS
========================= */

client.on(
  "roleCreate",
  async role => {
    await log(
      role.guild,
      "Roles",
      "➕ Role Created",
      [
        field(
          "Role",
          `${role} (${role.id})`
        ),
        field(
          "Name",
          role.name
        )
      ],
      COLORS.success
    );

    const audit =
      await role.guild.fetchAuditLogs({
        type: AuditLogEvent.RoleCreate,
        limit: 1
      }).catch(() => null);

    const entry =
      audit?.entries.first();

    if (
      entry &&
      Date.now() -
        entry.createdTimestamp <
        5000
    ) {
      await securityEvent(
        role.guild,
        "roleCreate",
        entry.executor?.id,
        `Created role ${role.name}`
      );
    }
  }
);

client.on(
  "roleDelete",
  async role => {
    await log(
      role.guild,
      "Roles",
      "🗑️ Role Deleted",
      [
        field(
          "Role",
          `${role.name} (${role.id})`
        )
      ],
      COLORS.danger
    );

    const audit =
      await role.guild.fetchAuditLogs({
        type: AuditLogEvent.RoleDelete,
        limit: 1
      }).catch(() => null);

    const entry =
      audit?.entries.first();

    if (
      entry &&
      Date.now() -
        entry.createdTimestamp <
        5000
    ) {
      await securityEvent(
        role.guild,
        "roleDelete",
        entry.executor?.id,
        `Deleted role ${role.name}`
      );
    }
  }
);

client.on(
  "roleUpdate",
  async (oldRole, newRole) => {
    await log(
      newRole.guild,
      "Roles",
      "✏️ Role Updated",
      [
        field(
          "Role",
          `${newRole} (${newRole.id})`
        ),
        field(
          "Before",
          oldRole.name
        ),
        field(
          "After",
          newRole.name
        )
      ],
      COLORS.info
    );
  }
);

/* =========================
   WEBHOOK LOG
========================= */

client.on(
  "webhookUpdate",
  async channel => {
    if (!channel.guild) return;

    await log(
      channel.guild,
      "Security",
      "🔗 Webhook Updated",
      [
        field(
          "Channel",
          `${channel} (${channel.id})`
        ),
        field(
          "Details",
          "A webhook was created, deleted or updated."
        )
      ],
      COLORS.warning
    );
  }
);

/* =========================
   AUDIT LOG
========================= */

client.on(
  "guildAuditLogEntryCreate",
  async (entry, guild) => {
    try {
      await log(
        guild,
        "Audit",
        "📜 Audit Log Event",
        [
          field(
            "Action",
            String(entry.action)
          ),
          field(
            "Executor",
            entry.executor
              ? `${entry.executor.tag || entry.executor.username} (${entry.executor.id})`
              : "Unknown"
          ),
          field(
            "Target",
            entry.targetId || "Unknown"
          ),
          field(
            "Reason",
            entry.reason || "No reason provided"
          )
        ],
        COLORS.purple
      );
    } catch {}
  }
);

/* =========================
   INTERACTIONS
========================= */

client.on(
  "interactionCreate",
  async interaction => {
    try {
      /* BUTTONS */

      if (interaction.isButton()) {
        /* Create Ticket */

        if (
          interaction.customId ===
          "create_ticket"
        ) {
          const channel =
            await createTicket(
              interaction.user
            );

          if (!channel) {
            return replyError(
              interaction,
              "Ticket Creation Failed",
              [
                field(
                  "Reason",
                  "The support system is not configured correctly."
                )
              ]
            );
          }

          return replySuccess(
            interaction,
            "Ticket Created",
            [
              field(
                "Server",
                channel.guild.name
              ),
              field(
                "Ticket",
                `${channel} (${channel.id})`
              ),
              field(
                "Status",
                "🟢 Open"
              ),
              field(
                "Next Step",
                "Check your DMs to communicate with support."
              )
            ]
          );
        }

        /* Verification */

        if (
          interaction.customId ===
          "verify_user"
        ) {
          const c =
            getGuildConfig(
              interaction.guild
            );

          const role =
            await interaction.guild.roles
              .fetch(
                c.verification.roleId
              )
              .catch(() => null);

          if (!role) {
            return replyError(
              interaction,
              "Verification Failed",
              [
                field(
                  "Reason",
                  "The configured verification role no longer exists."
                )
              ]
            );
          }

          const me =
            interaction.guild.members.me;

          if (
            !me ||
            role.position >=
              me.roles.highest.position
          ) {
            return replyError(
              interaction,
              "Role Hierarchy Error",
              [
                field(
                  "Required",
                  "AkiyO's highest role must be above the verification role."
                ),
                field(
                  "Current Role",
                  `${role} (${role.id})`
                )
              ]
            );
          }

          await interaction.member.roles
            .add(
              role,
              "AkiyO Verification"
            )
            .catch(() => {});

          await log(
            interaction.guild,
            "Verification",
            "✅ Member Verified",
            [
              field(
                "User",
                `${interaction.user.tag} (${interaction.user.id})`
              ),
              field(
                "Role",
                `${role} (${role.id})`
              )
            ],
            COLORS.success
          );

          return replySuccess(
            interaction,
            "Verification Complete",
            [
              field(
                "User",
                interaction.user.toString()
              ),
              field(
                "Verified Role",
                role.toString()
              ),
              field(
                "Status",
                "Successfully verified."
              )
            ]
          );
        }

        /* Ticket Buttons */

        if (
          !isStaff(
            interaction.member
          )
        ) {
          return replyError(
            interaction,
            "Permission Denied",
            [
              field(
                "Required",
                "AkiyO Support Staff or Administrator"
              )
            ]
          );
        }

        const ticket =
          ticketByChannel(
            interaction.channel.id
          );

        if (!ticket) {
          return replyError(
            interaction,
            "Ticket Not Found",
            [
              field(
                "Channel",
                interaction.channel.name
              )
            ]
          );
        }

        const ownerId =
          ticket[0];

        if (
          interaction.customId ===
          "ticket_claim"
        ) {
          claims.set(
            interaction.channel.id,
            interaction.user.id
          );

          await log(
            interaction.guild,
            "Tickets",
            "🙋 Ticket Claimed",
            [
              field(
                "Ticket",
                interaction.channel.toString()
              ),
              field(
                "Claimed By",
                interaction.user.toString()
              )
            ],
            COLORS.success
          );

          return replySuccess(
            interaction,
            "Ticket Claimed",
            [
              field(
                "Staff Member",
                interaction.user.toString()
              ),
              field(
                "Status",
                "🟢 Claimed"
              )
            ]
          );
        }

        if (
          interaction.customId ===
          "ticket_close"
        ) {
          await interaction.deferReply({
            ephemeral: true
          });

          const transcript =
            await createTranscript(
              interaction.channel
            );

          await log(
            interaction.guild,
            "Tickets",
            "🔒 Ticket Closed",
            [
              field(
                "Owner",
                `<@${ownerId}>`
              ),
              field(
                "Closed By",
                interaction.user.toString()
              ),
              field(
                "Channel",
                interaction.channel.toString()
              )
            ],
            COLORS.warning
          );

          await interaction.channel
            .permissionOverwrites
            .edit(
              ownerId,
              {
                ViewChannel: true,
                SendMessages: false
              }
            )
            .catch(() => {});

          const record =
            [...tickets.entries()]
              .find(
                ([, value]) =>
                  value.channelId ===
                  interaction.channel.id
              );

          if (record) {
            record[1].status = "closed";
          }

          await interaction.channel.send({
            embeds: [
              warningEmbed(
                interaction.guild,
                "Ticket Closed",
                [
                  field(
                    "Closed By",
                    interaction.user.toString()
                  ),
                  field(
                    "Status",
                    "🔒 Closed"
                  ),
                  field(
                    "Reopen",
                    "Use `/reopen` if the ticket needs to be reopened."
                  )
                ]
              )
            ]
          });

          await interaction.editReply({
            embeds: [
              successEmbed(
                interaction.guild,
                "Ticket Closed",
                [
                  field(
                    "Status",
                    "🔒 Closed"
                  ),
                  field(
                    "Transcript",
                    "Ticket transcript generated successfully."
                  )
                ]
              )
            ]
          });

          return;
        }

        if (
          interaction.customId ===
          "ticket_lock"
        ) {
          await interaction.channel
            .permissionOverwrites
            .edit(
              ownerId,
              {
                ViewChannel: true,
                SendMessages: false
              }
            );

          const record =
            [...tickets.entries()]
              .find(
                ([, value]) =>
                  value.channelId ===
                  interaction.channel.id
              );

          if (record) {
            record[1].locked = true;
          }

          await log(
            interaction.guild,
            "Tickets",
            "🔐 Ticket Locked",
            [
              field(
                "Ticket",
                interaction.channel.toString()
              ),
              field(
                "Locked By",
                interaction.user.toString()
              )
            ],
            COLORS.warning
          );

          return replySuccess(
            interaction,
            "Ticket Locked",
            [
              field(
                "Status",
                "🔐 Locked"
              ),
              field(
                "User Access",
                "Sending messages disabled."
              )
            ]
          );
        }

        if (
          interaction.customId ===
          "ticket_transcript"
        ) {
          const transcript =
            await createTranscript(
              interaction.channel
            );

          await log(
            interaction.guild,
            "Tickets",
            "📄 Ticket Transcript Generated",
            [
              field(
                "Ticket",
                interaction.channel.toString()
              ),
              field(
                "Generated By",
                interaction.user.toString()
              )
            ],
            COLORS.info
          );

          const c =
            getGuildConfig(
              interaction.guild
            );

          const logChannel =
            c.logs.all
              ? await interaction.guild.channels
                  .fetch(c.logs.all)
                  .catch(() => null)
              : null;

          if (logChannel?.isTextBased()) {
            await logChannel.send({
              content:
                `📄 Ticket transcript • ${interaction.channel.name}`,
              files: [
                {
                  attachment: transcript,
                  name:
                    `ticket-${interaction.channel.id}.txt`
                }
              ]
            }).catch(() => {});
          }

          return replySuccess(
            interaction,
            "Transcript Generated",
            [
              field(
                "Ticket",
                interaction.channel.name
              ),
              field(
                "Log Channel",
                logChannel
                  ? logChannel.toString()
                  : "Not configured"
              )
            ]
          );
        }
      }

      /* SLASH COMMANDS */

      if (!interaction.isChatInputCommand()) {
        return;
      }

      await commandLog(
        interaction
      );

      const command =
        interaction.commandName;

      if (
        STAFF_COMMANDS.has(command) &&
        !isStaff(interaction.member)
      ) {
        return replyError(
          interaction,
          "Permission Denied",
          [
            field(
              "Required Permission",
              "AkiyO Staff / Manage Server / Administrator"
            ),
            field(
              "Command",
              `/${command}`
            )
          ]
        );
      }

      /* TICKET */

      if (
        command === "ticket"
      ) {
        const channel =
          await createTicket(
            interaction.user
          );

        if (!channel) {
          return replyError(
            interaction,
            "Ticket Creation Failed",
            [
              field(
                "Reason",
                "Ticket category and staff role must be configured first."
              ),
              field(
                "Administrator Action",
                "Use `/ticketsetup`."
              )
            ]
          );
        }

        return replySuccess(
          interaction,
          "Support Ticket Created",
          [
            field(
              "Server",
              channel.guild.name
            ),
            field(
              "Ticket",
              `${channel} (${channel.id})`
            ),
            field(
              "Status",
              "🟢 Open"
            ),
            field(
              "Communication",
              "Continue through your DMs with AkiyO."
            )
          ]
        );
      }

      /* TICKET PANEL */

      if (
        command ===
        "ticketpanel"
      ) {
        const embed =
          baseEmbed(
            interaction.guild,
            "🎫 AkiyO Support Center",
            COLORS.primary
          )
            .setDescription(
              "Need help? Open a private support ticket with the AkiyO support team."
            )
            .addFields(
              field(
                "How it works",
                "Click **Open Support Ticket** below."
              ),
              field(
                "Private",
                "Only you and authorized support staff can access your ticket."
              ),
              field(
                "Support",
                "Messages sent to AkiyO through DM can be forwarded to your ticket."
              )
            );

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
          embeds: [embed],
          components: [row]
        });

        return replySuccess(
          interaction,
          "Support Panel Sent",
          [
            field(
              "Channel",
              interaction.channel.toString()
            ),
            field(
              "Status",
              "Panel is now active."
            )
          ]
        );
      }

      /* TICKET SETUP */

      if (
        command ===
        "ticketsetup"
      ) {
        const category =
          interaction.options.getChannel(
            "category"
          );

        const role =
          interaction.options.getRole(
            "staff_role"
          );

        const c =
          getGuildConfig(
            interaction.guild
          );

        c.support.categoryId =
          category.id;

        c.support.staffRoleId =
          role.id;

        save();

        await log(
          interaction.guild,
          "Config",
          "⚙️ Ticket System Configured",
          [
            field(
              "Category",
              `${category} (${category.id})`
            ),
            field(
              "Staff Role",
              `${role} (${role.id})`
            ),
            field(
              "Configured By",
              interaction.user.toString()
            )
          ],
          COLORS.success
        );

        return replySuccess(
          interaction,
          "Ticket System Configured",
          [
            field(
              "Category",
              category.toString()
            ),
            field(
              "Staff Role",
              role.toString()
            ),
            field(
              "Status",
              "🟢 Ready"
            )
          ]
        );
      }

      /* LOG SETUP */

      if (
        command ===
        "logsetup"
      ) {
        const sub =
          interaction.options.getSubcommand();

        const c =
          getGuildConfig(
            interaction.guild
          );

        if (sub === "all") {
          const channel =
            interaction.options.getChannel(
              "channel"
            );

          const permissions =
            channel.permissionsFor(
              interaction.guild.members.me
            );

          if (
            !permissions?.has(
              PermissionFlagsBits.SendMessages
            ) ||
            !permissions?.has(
              PermissionFlagsBits.EmbedLinks
            )
          ) {
            return replyError(
              interaction,
              "Log Channel Permission Error",
              [
                field(
                  "Required",
                  "Send Messages + Embed Links"
                ),
                field(
                  "Channel",
                  channel.toString()
                )
              ]
            );
          }

          c.logs.all =
            channel.id;

          save();

          await replySuccess(
            interaction,
            "Unified Logging Enabled",
            [
              field(
                "Log Channel",
                `${channel} (${channel.id})`
              ),
              field(
                "Scope",
                "All AkiyO logs"
              ),
              field(
                "Status",
                "🟢 Active"
              )
            ]
          );

          await log(
            interaction.guild,
            "Config",
            "📋 Unified Log System Configured",
            [
              field(
                "Channel",
                `${channel} (${channel.id})`
              ),
              field(
                "Configured By",
                interaction.user.toString()
              ),
              field(
                "Coverage",
                "All AkiyO system logs"
              )
            ],
            COLORS.success
          );

          return;
        }

        if (sub === "status") {
          return interaction.reply({
            embeds: [
              infoEmbed(
                interaction.guild,
                "Unified Logging Status",
                [
                  field(
                    "Status",
                    c.logs.all
                      ? "🟢 Enabled"
                      : "🔴 Disabled"
                  ),
                  field(
                    "Channel",
                    c.logs.all
                      ? `<#${c.logs.all}>`
                      : "Not configured"
                  ),
                  field(
                    "Coverage",
                    "Members • Messages • Moderation • AutoMod • Security • Tickets • Roles • Channels • Verification • Welcome • Reactions • Announcements • Config • Audit"
                  )
                ]
              )
            ],
            ephemeral: true
          });
        }

        if (sub === "disable") {
          const old =
            c.logs.all;

          c.logs.all = null;

          save();

          return replySuccess(
            interaction,
            "Unified Logging Disabled",
            [
              field(
                "Previous Channel",
                old
                  ? `<#${old}>`
                  : "None"
              ),
              field(
                "Status",
                "🔴 Disabled"
              )
            ]
          );
        }
      }

      /* AUTOMOD */

      if (
        command ===
        "automod"
      ) {
        const sub =
          interaction.options.getSubcommand();

        const c =
          getGuildConfig(
            interaction.guild
          );

        if (sub === "enable") {
          c.automod.enabled = true;
          save();

          return replySuccess(
            interaction,
            "AutoMod Enabled",
            [
              field(
                "Status",
                "🟢 Active"
              )
            ]
          );
        }

        if (sub === "disable") {
          c.automod.enabled = false;
          save();

          return replySuccess(
            interaction,
            "AutoMod Disabled",
            [
              field(
                "Status",
                "🔴 Inactive"
              )
            ]
          );
        }

        if (sub === "status") {
          return interaction.reply({
            embeds: [
              infoEmbed(
                interaction.guild,
                "AutoMod Status",
                [
                  field(
                    "Status",
                    c.automod.enabled
                      ? "🟢 Enabled"
                      : "🔴 Disabled"
                  ),
                  field(
                    "Spam Limit",
                    c.automod.spamLimit,
                    true
                  ),
                  field(
                    "Spam Window",
                    `${c.automod.spamWindow / 1000}s`,
                    true
                  ),
                  field(
                    "Caps Threshold",
                    `${c.automod.capsPercent}%`,
                    true
                  ),
                  field(
                    "Repeated Messages",
                    c.automod.repeatedLimit,
                    true
                  ),
                  field(
                    "Blocked Words",
                    c.automod.badWords.length,
                    true
                  ),
                  field(
                    "Invite Protection",
                    c.automod.invite
                      ? "Enabled"
                      : "Disabled",
                    true
                  ),
                  field(
                    "Mass Mention Protection",
                    c.automod.massMentions
                      ? "Enabled"
                      : "Disabled",
                    true
                  )
                ]
              )
            ],
            ephemeral: true
          });
        }

        if (sub === "config") {
          const oldSpam =
            c.automod.spamLimit;

          const oldCaps =
            c.automod.capsPercent;

          const oldTimeout =
            c.automod.timeoutSeconds.spam;

          const spam =
            interaction.options.getInteger(
              "spam_limit"
            );

          const caps =
            interaction.options.getInteger(
              "caps_percent"
            );

          const timeout =
            interaction.options.getInteger(
              "timeout"
            );

          if (spam !== null) {
            c.automod.spamLimit =
              spam;
          }

          if (caps !== null) {
            c.automod.capsPercent =
              caps;
          }

          if (timeout !== null) {
            for (
              const key of Object.keys(
                c.automod.timeoutSeconds
              )
            ) {
              c.automod.timeoutSeconds[key] =
                timeout;
            }
          }

          save();

          return replySuccess(
            interaction,
            "AutoMod Configuration Updated",
            [
              field(
                "Spam Limit",
                `${oldSpam} → ${c.automod.spamLimit}`
              ),
              field(
                "Caps",
                `${oldCaps}% → ${c.automod.capsPercent}%`
              ),
              field(
                "Timeout",
                `${oldTimeout}s → ${c.automod.timeoutSeconds.spam}s`
              )
            ]
          );
        }

        if (
          sub === "badword"
        ) {
          const word =
            interaction.options
              .getString("word")
              .toLowerCase();

          if (
            !c.automod.badWords.includes(
              word
            )
          ) {
            c.automod.badWords.push(
              word
            );
          }

          save();

          return replySuccess(
            interaction,
            "Blocked Word Added",
            [
              field(
                "Word",
                `||${word}||`
              ),
              field(
                "Total Blocked Words",
                c.automod.badWords.length
              )
            ]
          );
        }

        if (
          sub ===
          "removebadword"
        ) {
          const word =
            interaction.options
              .getString("word")
              .toLowerCase();

          const existed =
            c.automod.badWords.includes(
              word
            );

          c.automod.badWords =
            c.automod.badWords.filter(
              item => item !== word
            );

          save();

          return replySuccess(
            interaction,
            "Blocked Word Updated",
            [
              field(
                "Word",
                `||${word}||`
              ),
              field(
                "Result",
                existed
                  ? "Removed successfully."
                  : "Word was not in the blocked list."
              )
            ]
          );
        }
      }

      /* SECURITY */

      if (
        command ===
        "security"
      ) {
        const sub =
          interaction.options.getSubcommand();

        const c =
          getGuildConfig(
            interaction.guild
          );

        if (sub === "enable") {
          c.security.enabled =
            true;

          save();

          return replySuccess(
            interaction,
            "Security Enabled",
            [
              field(
                "Status",
                "🟢 Active"
              )
            ]
          );
        }

        if (sub === "disable") {
          c.security.enabled =
            false;

          save();

          return replySuccess(
            interaction,
            "Security Disabled",
            [
              field(
                "Status",
                "🔴 Inactive"
              )
            ]
          );
        }

        if (sub === "status") {
          return interaction.reply({
            embeds: [
              infoEmbed(
                interaction.guild,
                "Security Status",
                [
                  field(
                    "Status",
                    c.security.enabled
                      ? "🟢 Enabled"
                      : "🔴 Disabled"
                  ),
                  field(
                    "Action",
                    c.security.action
                  ),
                  field(
                    "Raid Threshold",
                    `${c.security.raidJoinCount} joins / ${c.security.raidWindow / 1000}s`
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
                    "Trusted Role",
                    c.security.trustedRoleId
                      ? `<@&${c.security.trustedRoleId}>`
                      : "None"
                  ),
                  field(
                    "Protected Roles",
                    c.security.protectedRoles.length
                  ),
                  field(
                    "Protected Channels",
                    c.security.protectedChannels.length
                  )
                ]
              )
            ],
            ephemeral: true
          });
        }

        if (sub === "action") {
          const type =
            interaction.options.getString(
              "type"
            );

          const old =
            c.security.action;

          c.security.action =
            type;

          save();

          return replySuccess(
            interaction,
            "Security Action Updated",
            [
              field(
                "Before",
                old
              ),
              field(
                "After",
                type
              )
            ]
          );
        }

        if (
          sub ===
          "trustedmember"
        ) {
          const user =
            interaction.options.getUser(
              "user"
            );

          if (
            !c.security.trustedMembers.includes(
              user.id
            )
          ) {
            c.security.trustedMembers.push(
              user.id
            );
          }

          save();

          return replySuccess(
            interaction,
            "Trusted Member Added",
            [
              field(
                "User",
                `${user.tag} (${user.id})`
              )
            ]
          );
        }

        if (
          sub ===
          "untrustedmember"
        ) {
          const user =
            interaction.options.getUser(
              "user"
            );

          c.security.trustedMembers =
            c.security.trustedMembers.filter(
              id => id !== user.id
            );

          save();

          return replySuccess(
            interaction,
            "Trusted Member Removed",
            [
              field(
                "User",
                `${user.tag} (${user.id})`
              )
            ]
          );
        }

        if (
          sub ===
          "trustedbot"
        ) {
          const user =
            interaction.options.getUser(
              "user"
            );

          if (
            !c.security.trustedBots.includes(
              user.id
            )
          ) {
            c.security.trustedBots.push(
              user.id
            );
          }

          save();

          return replySuccess(
            interaction,
            "Trusted Bot Added",
            [
              field(
                "Bot",
                `${user.tag} (${user.id})`
              )
            ]
          );
        }

        if (
          sub ===
          "untrustedbot"
        ) {
          const user =
            interaction.options.getUser(
              "user"
            );

          c.security.trustedBots =
            c.security.trustedBots.filter(
              id => id !== user.id
            );

          save();

          return replySuccess(
            interaction,
            "Trusted Bot Removed",
            [
              field(
                "Bot",
                `${user.tag} (${user.id})`
              )
            ]
          );
        }

        if (
          sub ===
          "trustedrole"
        ) {
          const role =
            interaction.options.getRole(
              "role"
            );

          c.security.trustedRoleId =
            role.id;

          save();

          return replySuccess(
            interaction,
            "Trusted Role Updated",
            [
              field(
                "Role",
                `${role} (${role.id})`
              )
            ]
          );
        }

        if (
          sub ===
          "protectedrole"
        ) {
          const role =
            interaction.options.getRole(
              "role"
            );

          if (
            !c.security.protectedRoles.includes(
              role.id
            )
          ) {
            c.security.protectedRoles.push(
              role.id
            );
          }

          save();

          return replySuccess(
            interaction,
            "Role Protected",
            [
              field(
                "Role",
                `${role} (${role.id})`
              )
            ]
          );
        }

        if (
          sub ===
          "unprotectedrole"
        ) {
          const role =
            interaction.options.getRole(
              "role"
            );

          c.security.protectedRoles =
            c.security.protectedRoles.filter(
              id => id !== role.id
            );

          save();

          return replySuccess(
            interaction,
            "Role Protection Removed",
            [
              field(
                "Role",
                `${role} (${role.id})`
              )
            ]
          );
        }

        if (
          sub ===
          "protectedchannel"
        ) {
          const channel =
            interaction.options.getChannel(
              "channel"
            );

          if (
            !c.security.protectedChannels.includes(
              channel.id
            )
          ) {
            c.security.protectedChannels.push(
              channel.id
            );
          }

          save();

          return replySuccess(
            interaction,
            "Channel Protected",
            [
              field(
                "Channel",
                `${channel} (${channel.id})`
              )
            ]
          );
        }

        if (
          sub ===
          "unprotectedchannel"
        ) {
          const channel =
            interaction.options.getChannel(
              "channel"
            );

          c.security.protectedChannels =
            c.security.protectedChannels.filter(
              id => id !== channel.id
            );

          save();

          return replySuccess(
            interaction,
            "Channel Protection Removed",
            [
              field(
                "Channel",
                `${channel} (${channel.id})`
              )
            ]
          );
        }

        if (sub === "list") {
          return interaction.reply({
            embeds: [
              infoEmbed(
                interaction.guild,
                "Security Protection List",
                [
                  field(
                    "Trusted Members",
                    c.security.trustedMembers
                      .map(id => `<@${id}>`)
                      .join(", ") ||
                      "None"
                  ),
                  field(
                    "Trusted Bots",
                    c.security.trustedBots
                      .map(id => `<@${id}>`)
                      .join(", ") ||
                      "None"
                  ),
                  field(
                    "Trusted Role",
                    c.security.trustedRoleId
                      ? `<@&${c.security.trustedRoleId}>`
                      : "None"
                  ),
                  field(
                    "Protected Roles",
                    c.security.protectedRoles
                      .map(id => `<@&${id}>`)
                      .join(", ") ||
                      "None"
                  ),
                  field(
                    "Protected Channels",
                    c.security.protectedChannels
                      .map(id => `<#${id}>`)
                      .join(", ") ||
                      "None"
                  )
                ]
              )
            ],
            ephemeral: true
          });
        }
      }

      /* CONFIG */

      if (
        command ===
        "config"
      ) {
        const sub =
          interaction.options.getSubcommand();

        const c =
          getGuildConfig(
            interaction.guild
          );

        if (sub === "view") {
          return interaction.reply({
            embeds: [
              infoEmbed(
                interaction.guild,
                "⚙️ Server Configuration",
                [
                  field(
                    "Unified Logs",
                    c.logs.all
                      ? `<#${c.logs.all}>`
                      : "Not configured"
                  ),
                  field(
                    "Ticket Category",
                    c.support.categoryId
                      ? `<#${c.support.categoryId}>`
                      : "Not configured"
                  ),
                  field(
                    "Staff Role",
                    c.support.staffRoleId
                      ? `<@&${c.support.staffRoleId}>`
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
                      ? `<@&${c.autorole.roleId}>`
                      : "Disabled"
                  ),
                  field(
                    "Welcome",
                    c.welcome.enabled
                      ? `<#${c.welcome.channelId}>`
                      : "Disabled"
                  ),
                  field(
                    "Verification",
                    c.verification.enabled
                      ? `<@&${c.verification.roleId}>`
                      : "Disabled"
                  )
                ]
              )
            ],
            ephemeral: true
          });
        }

        if (
          sub ===
          "staffrole"
        ) {
          const role =
            interaction.options.getRole(
              "role"
            );

          const old =
            c.support.staffRoleId;

          c.support.staffRoleId =
            role.id;

          save();

          return replySuccess(
            interaction,
            "Staff Role Updated",
            [
              field(
                "Before",
                old
                  ? `<@&${old}>`
                  : "None"
              ),
              field(
                "After",
                role.toString()
              )
            ]
          );
        }

        if (
          sub ===
          "ticketcategory"
        ) {
          const category =
            interaction.options.getChannel(
              "category"
            );

          const old =
            c.support.categoryId;

          c.support.categoryId =
            category.id;

          save();

          return replySuccess(
            interaction,
            "Ticket Category Updated",
            [
              field(
                "Before",
                old
                  ? `<#${old}>`
                  : "None"
              ),
              field(
                "After",
                category.toString()
              )
            ]
          );
        }
      }

      /* MODERATION */

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
          interaction.options.getString(
            "reason"
          );

        if (
          command ===
          "unban"
        ) {
          const userId =
            interaction.options.getString(
              "user_id"
            );

          await interaction.guild.members
            .unban(
              userId,
              reason
            );

          await addPunishment(
            interaction.guild,
            userId,
            "unban",
            reason,
            interaction.user.id
          );

          await log(
            interaction.guild,
            "Moderation",
            "🔓 Member Unbanned",
            [
              field(
                "User ID",
                userId
              ),
              field(
                "Moderator",
                interaction.user.toString()
              ),
              field(
                "Reason",
                reason
              )
            ],
            COLORS.success
          );

          return replySuccess(
            interaction,
            "Member Unbanned",
            [
              field(
                "User ID",
                userId
              ),
              field(
                "Reason",
                reason
              )
            ]
          );
        }

        const user =
          interaction.options.getUser(
            "user"
          );

        const member =
          await interaction.guild.members
            .fetch(user.id)
            .catch(() => null);

        if (!member) {
          return replyError(
            interaction,
            "Member Not Found",
            [
              field(
                "User",
                `${user.tag} (${user.id})`
              )
            ]
          );
        }

        if (
          member.id ===
          interaction.user.id
        ) {
          return replyError(
            interaction,
            "Invalid Target",
            [
              field(
                "Reason",
                "You cannot moderate yourself."
              )
            ]
          );
        }

        if (
          member.id ===
          client.user.id
        ) {
          return replyError(
            interaction,
            "Invalid Target",
            [
              field(
                "Reason",
                "AkiyO cannot moderate itself."
              )
            ]
          );
        }

        if (
          interaction.member.roles.highest.position <=
          member.roles.highest.position &&
          !interaction.member.permissions.has(
            PermissionFlagsBits.Administrator
          )
        ) {
          return replyError(
            interaction,
            "Role Hierarchy Error",
            [
              field(
                "Reason",
                "Your highest role must be above the target's highest role."
              )
            ]
          );
        }

        if (
          command ===
          "warn"
        ) {
          const total =
            await addWarning(
              member,
              reason,
              interaction.user.id
            );

          let escalation =
            "No automatic escalation.";

          if (
            total >= 7 &&
            member.bannable
          ) {
            await member.ban({
              reason:
                `AkiyO Warning Escalation: ${reason}`
            }).catch(() => {});

            escalation =
              "7+ warnings → automatic ban.";
          } else if (
            total >= 5 &&
            member.kickable
          ) {
            await member.kick(
              `AkiyO Warning Escalation: ${reason}`
            ).catch(() => {});

            escalation =
              "5 warnings → automatic kick.";
          } else if (
            total >= 3 &&
            member.moderatable
          ) {
            await member.timeout(
              10 * 60 * 1000,
              `AkiyO Warning Escalation: ${reason}`
            ).catch(() => {});

            escalation =
              "3 warnings → 10 minute timeout.";
          }

          await log(
            interaction.guild,
            "Moderation",
            "⚠️ Member Warned",
            [
              field(
                "User",
                `${user.tag} (${user.id})`
              ),
              field(
                "Moderator",
                interaction.user.toString()
              ),
              field(
                "Reason",
                reason
              ),
              field(
                "Total Warnings",
                total
              ),
              field(
                "Escalation",
                escalation
              )
            ],
            COLORS.warning
          );

          return replySuccess(
            interaction,
            "Warning Issued",
            [
              field(
                "User",
                user.toString()
              ),
              field(
                "Reason",
                reason
              ),
              field(
                "Total Warnings",
                total
              ),
              field(
                "Escalation",
                escalation
              )
            ]
          );
        }

        if (
          command ===
          "timeout"
        ) {
          const duration =
            interaction.options.getString(
              "duration"
            );

          const milliseconds =
            parseDuration(
              duration
            );

          if (
            !milliseconds ||
            milliseconds >
              28 * 24 * 60 * 60 * 1000
          ) {
            return replyError(
              interaction,
              "Invalid Timeout Duration",
              [
                field(
                  "Examples",
                  "30s • 10m • 2h • 1d"
                ),
                field(
                  "Maximum",
                  "28 days"
                )
              ]
            );
          }

          if (
            !member.moderatable
          ) {
            return replyError(
              interaction,
              "Timeout Failed",
              [
                field(
                  "Reason",
                  "AkiyO cannot timeout this member. Check role hierarchy and permissions."
                )
              ]
            );
          }

          await member.timeout(
            milliseconds,
            reason
          );

          await addPunishment(
            interaction.guild,
            user.id,
            "timeout",
            reason,
            interaction.user.id
          );

          await log(
            interaction.guild,
            "Moderation",
            "⏱️ Member Timed Out",
            [
              field(
                "User",
                `${user.tag} (${user.id})`
              ),
              field(
                "Moderator",
                interaction.user.toString()
              ),
              field(
                "Duration",
                duration
              ),
              field(
                "Reason",
                reason
              )
            ],
            COLORS.warning
          );

          return replySuccess(
            interaction,
            "Member Timed Out",
            [
              field(
                "User",
                user.toString()
              ),
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

        if (
          command ===
          "kick"
        ) {
          if (!member.kickable) {
            return replyError(
              interaction,
              "Kick Failed",
              [
                field(
                  "Reason",
                  "AkiyO cannot kick this member."
                )
              ]
            );
          }

          await member.kick(
            reason
          );

          await addPunishment(
            interaction.guild,
            user.id,
            "kick",
            reason,
            interaction.user.id
          );

          await log(
            interaction.guild,
            "Moderation",
            "👢 Member Kicked",
            [
              field(
                "User",
                `${user.tag} (${user.id})`
              ),
              field(
                "Moderator",
                interaction.user.toString()
              ),
              field(
                "Reason",
                reason
              )
            ],
            COLORS.danger
          );

          return replySuccess(
            interaction,
            "Member Kicked",
            [
              field(
                "User",
                `${user.tag} (${user.id})`
              ),
              field(
                "Reason",
                reason
              )
            ]
          );
        }

        if (
          command ===
          "ban"
        ) {
          if (!member.bannable) {
            return replyError(
              interaction,
              "Ban Failed",
              [
                field(
                  "Reason",
                  "AkiyO cannot ban this member."
                )
              ]
            );
          }

          await member.ban({
            reason
          });

          await addPunishment(
            interaction.guild,
            user.id,
            "ban",
            reason,
            interaction.user.id
          );

          await log(
            interaction.guild,
            "Moderation",
            "🔨 Member Banned",
            [
              field(
                "User",
                `${user.tag} (${user.id})`
              ),
              field(
                "Moderator",
                interaction.user.toString()
              ),
              field(
                "Reason",
                reason
              )
            ],
            COLORS.danger
          );

          return replySuccess(
            interaction,
            "Member Banned",
            [
              field(
                "User",
                `${user.tag} (${user.id})`
              ),
              field(
                "Reason",
                reason
              )
            ]
          );
        }
      }

      /* WARNINGS / PUNISHMENTS */

      if (
        command ===
          "warnings" ||
        command ===
          "punishments"
      ) {
        const user =
          interaction.options.getUser(
            "user"
          );

        const c =
          getGuildConfig(
            interaction.guild
          );

        const list =
          command === "warnings"
            ? (
                c.warnings[user.id] ||
                []
              )
            : (
                c.punishments[user.id] ||
                []
              );

        const recent =
          list.slice(-15);

        const description =
          recent.length
            ? recent
                .map(
                  (item, index) =>
                    `**${index + 1}.** ${item.type || "warn"} • ${item.reason} • <t:${Math.floor(item.time / 1000)}:R>`
                )
                .join("\n")
            : "No records found.";

        return interaction.reply({
          embeds: [
            baseEmbed(
              interaction.guild,
              command === "warnings"
                ? "⚠️ Warning History"
                : "⚖️ Punishment History",
              command === "warnings"
                ? COLORS.warning
                : COLORS.info
            )
              .addFields(
                field(
                  "User",
                  `${user.tag} (${user.id})`
                ),
                field(
                  "Total Records",
                  list.length
                )
              )
              .setDescription(
                description
              )
          ],
          ephemeral: true
        });
      }

      /* ANNOUNCEMENT */

      if (
        command ===
        "announce"
      ) {
        const channel =
          interaction.options.getChannel(
            "channel"
          );

        const message =
          interaction.options.getString(
            "message"
          );

        const title =
          interaction.options.getString(
            "title"
          );

        const footer =
          interaction.options.getString(
            "footer"
          );

        const useEmbed =
          interaction.options.getBoolean(
            "embed"
          ) !== false;

        const everyone =
          interaction.options.getBoolean(
            "everyone"
          );

        const here =
          interaction.options.getBoolean(
            "here"
          );

        const role =
          interaction.options.getRole(
            "role"
          );

        const user =
          interaction.options.getUser(
            "user"
          );

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

        const allowedMentions = {
          parse: []
        };

        if (
          everyone ||
          here
        ) {
          allowedMentions.parse.push(
            "everyone"
          );
        }

        if (role) {
          allowedMentions.roles = [
            role.id
          ];
        }

        if (user) {
          allowedMentions.users = [
            user.id
          ];
        }

        const payload = {
          content,
          allowedMentions
        };

        if (useEmbed) {
          const embed =
            baseEmbed(
              interaction.guild,
              title ||
                "📢 Announcement",
              COLORS.primary
            )
              .setDescription(
                message
              );

          if (footer) {
            embed.setFooter({
              text: footer
            });
          }

          payload.content =
            content
              .replace(message, "")
              .trim();

          payload.embeds = [
            embed
          ];
        }

        await channel.send(
          payload
        );

        await log(
          interaction.guild,
          "Announcements",
          "📢 Announcement Sent",
          [
            field(
              "Channel",
              `${channel} (${channel.id})`
            ),
            field(
              "Author",
              interaction.user.toString()
            ),
            field(
              "Title",
              title || "None"
            ),
            field(
              "Content",
              message
            )
          ],
          COLORS.primary
        );

        return replySuccess(
          interaction,
          "Announcement Sent",
          [
            field(
              "Channel",
              channel.toString()
            ),
            field(
              "Author",
              interaction.user.toString()
            ),
            field(
              "Status",
              "Published successfully."
            )
          ]
        );
      }

      /* AUTOROLE */

      if (
        command ===
        "autorole"
      ) {
        const sub =
          interaction.options.getSubcommand();

        const c =
          getGuildConfig(
            interaction.guild
          );

        if (sub === "set") {
          const role =
            interaction.options.getRole(
              "role"
            );

          const me =
            interaction.guild.members.me;

          if (
            !me ||
            role.position >=
              me.roles.highest.position
          ) {
            return replyError(
              interaction,
              "Role Hierarchy Error",
              [
                field(
                  "Reason",
                  "AkiyO's highest role must be above the autorole."
                )
              ]
            );
          }

          c.autorole.enabled =
            true;

          c.autorole.roleId =
            role.id;

          save();

          return replySuccess(
            interaction,
            "Autorole Configured",
            [
              field(
                "Role",
                `${role} (${role.id})`
              ),
              field(
                "Status",
                "🟢 Enabled"
              )
            ]
          );
        }

        if (sub === "disable") {
          c.autorole.enabled =
            false;

          save();

          return replySuccess(
            interaction,
            "Autorole Disabled",
            [
              field(
                "Status",
                "🔴 Disabled"
              )
            ]
          );
        }

        return interaction.reply({
          embeds: [
            infoEmbed(
              interaction.guild,
              "Autorole Status",
              [
                field(
                  "Status",
                  c.autorole.enabled
                    ? "🟢 Enabled"
                    : "🔴 Disabled"
                ),
                field(
                  "Role",
                  c.autorole.roleId
                    ? `<@&${c.autorole.roleId}>`
                    : "None"
                )
              ]
            )
          ],
          ephemeral: true
        });
      }

      /* WELCOME */

      if (
        command ===
        "welcome"
      ) {
        const sub =
          interaction.options.getSubcommand();

        const c =
          getGuildConfig(
            interaction.guild
          );

        if (sub === "set") {
          const channel =
            interaction.options.getChannel(
              "channel"
            );

          const message =
            interaction.options.getString(
              "message"
            );

          c.welcome.enabled =
            true;

          c.welcome.channelId =
            channel.id;

          c.welcome.message =
            message;

          save();

          return replySuccess(
            interaction,
            "Welcome System Configured",
            [
              field(
                "Channel",
                channel.toString()
              ),
              field(
                "Message",
                message
              ),
              field(
                "Placeholders",
                "{user} • {username} • {server} • {count}"
              )
            ]
          );
        }

        if (sub === "disable") {
          c.welcome.enabled =
            false;

          save();

          return replySuccess(
            interaction,
            "Welcome System Disabled",
            [
              field(
                "Status",
                "🔴 Disabled"
              )
            ]
          );
        }

        return interaction.reply({
          embeds: [
            infoEmbed(
              interaction.guild,
              "Welcome Status",
              [
                field(
                  "Status",
                  c.welcome.enabled
                    ? "🟢 Enabled"
                    : "🔴 Disabled"
                ),
                field(
                  "Channel",
                  c.welcome.channelId
                    ? `<#${c.welcome.channelId}>`
                    : "None"
                ),
                field(
                  "Message",
                  c.welcome.message
                )
              ]
            )
          ],
          ephemeral: true
        });
      }

      /* VERIFICATION */

      if (
        command ===
        "verification"
      ) {
        const sub =
          interaction.options.getSubcommand();

        const c =
          getGuildConfig(
            interaction.guild
          );

        if (sub === "setup") {
          const channel =
            interaction.options.getChannel(
              "channel"
            );

          const role =
            interaction.options.getRole(
              "role"
            );

          const me =
            interaction.guild.members.me;

          if (
            !me ||
            role.position >=
              me.roles.highest.position
          ) {
            return replyError(
              interaction,
              "Role Hierarchy Error",
              [
                field(
                  "Reason",
                  "AkiyO's highest role must be above the verification role."
                )
              ]
            );
          }

          const row =
            new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId(
                    "verify_user"
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
                baseEmbed(
                  interaction.guild,
                  "✅ Server Verification",
                  COLORS.success
                )
                  .setDescription(
                    "Click the button below to verify your account."
                  )
                  .addFields(
                    field(
                      "Purpose",
                      "Verification grants the configured verified role."
                    ),
                    field(
                      "Status",
                      "🟢 Active"
                    )
                  )
              ],
              components: [row]
            });

          c.verification = {
            enabled: true,
            channelId:
              channel.id,
            roleId:
              role.id,
            messageId:
              message.id
          };

          save();

          return replySuccess(
            interaction,
            "Verification System Configured",
            [
              field(
                "Channel",
                channel.toString()
              ),
              field(
                "Verified Role",
                role.toString()
              ),
              field(
                "Panel Message",
                message.id
              )
            ]
          );
        }

        if (sub === "disable") {
          c.verification.enabled =
            false;

          save();

          return replySuccess(
            interaction,
            "Verification Disabled",
            [
              field(
                "Status",
                "🔴 Disabled"
              )
            ]
          );
        }

        return interaction.reply({
          embeds: [
            infoEmbed(
              interaction.guild,
              "Verification Status",
              [
                field(
                  "Status",
                  c.verification.enabled
                    ? "🟢 Enabled"
                    : "🔴 Disabled"
                ),
                field(
                  "Channel",
                  c.verification.channelId
                    ? `<#${c.verification.channelId}>`
                    : "None"
                ),
                field(
                  "Role",
                  c.verification.roleId
                    ? `<@&${c.verification.roleId}>`
                    : "None"
                )
              ]
            )
          ],
          ephemeral: true
        });
      }

      /* REACTION ROLES */

      if (
        command ===
        "autoreactionrole"
      ) {
        const sub =
          interaction.options.getSubcommand();

        const c =
          getGuildConfig(
            interaction.guild
          );

        if (sub === "add") {
          const messageId =
            interaction.options.getString(
              "message_id"
            );

          const emoji =
            interaction.options.getString(
              "emoji"
            );

          const role =
            interaction.options.getRole(
              "role"
            );

          const me =
            interaction.guild.members.me;

          if (
            !me ||
            role.position >=
              me.roles.highest.position
          ) {
            return replyError(
              interaction,
              "Role Hierarchy Error",
              [
                field(
                  "Reason",
                  "AkiyO's highest role must be above the reaction role."
                )
              ]
            );
          }

          const message =
            await interaction.channel.messages
              .fetch(messageId)
              .catch(() => null);

          if (!message) {
            return replyError(
              interaction,
              "Message Not Found",
              [
                field(
                  "Message ID",
                  messageId
                ),
                field(
                  "Channel",
                  interaction.channel.toString()
                )
              ]
            );
          }

          const key =
            normalizeEmoji(
              emoji
            );

          c.reactionRoles[messageId] ??= {};

          c.reactionRoles[
            messageId
          ][key] = {
            roleId:
              role.id
          };

          await message.react(
            emoji
          ).catch(() => {});

          save();

          await log(
            interaction.guild,
            "Reaction Roles",
            "🎭 Reaction Role Created",
            [
              field(
                "Message ID",
                messageId
              ),
              field(
                "Emoji",
                emoji
              ),
              field(
                "Role",
                `${role} (${role.id})`
              ),
              field(
                "Created By",
                interaction.user.toString()
              )
            ],
            COLORS.success
          );

          return replySuccess(
            interaction,
            "Reaction Role Created",
            [
              field(
                "Emoji",
                emoji
              ),
              field(
                "Role",
                role.toString()
              ),
              field(
                "Message",
                message.url
              )
            ]
          );
        }

        if (
          sub === "remove"
        ) {
          const messageId =
            interaction.options.getString(
              "message_id"
            );

          const emoji =
            interaction.options.getString(
              "emoji"
            );

          const key =
            normalizeEmoji(
              emoji
            );

          if (
            c.reactionRoles[
              messageId
            ]
          ) {
            delete c.reactionRoles[
              messageId
            ][key];

            if (
              Object.keys(
                c.reactionRoles[
                  messageId
                ]
              ).length === 0
            ) {
              delete c.reactionRoles[
                messageId
              ];
            }
          }

          save();

          return replySuccess(
            interaction,
            "Reaction Role Removed",
            [
              field(
                "Message ID",
                messageId
              ),
              field(
                "Emoji",
                emoji
              )
            ]
          );
        }

        const list = [];

        for (
          const [
            messageId,
            reactions
          ] of Object.entries(
            c.reactionRoles
          )
        ) {
          for (
            const [
              emoji,
              data
            ] of Object.entries(
              reactions
            )
          ) {
            list.push(
              `${emoji} → <@&${data.roleId}> • Message: ${messageId}`
            );
          }
        }

        return interaction.reply({
          embeds: [
            infoEmbed(
              interaction.guild,
              "🎭 Reaction Role Configuration",
              [
                field(
                  "Total",
                  list.length
                ),
                field(
                  "Configured Roles",
                  list.join("\n") ||
                    "No reaction roles configured."
                )
              ]
            )
          ],
          ephemeral: true
        });
      }

      /* AI */

      if (
        command ===
        "ai"
      ) {
        const sub =
          interaction.options.getSubcommand();

        const key =
          process.env.OPENAI_API_KEY;

        if (!key) {
          return replyError(
            interaction,
            "AI Unavailable",
            [
              field(
                "Reason",
                "OPENAI_API_KEY is not configured."
              ),
              field(
                "Setup",
                "Add OPENAI_API_KEY to your hosting environment."
              )
            ]
          );
        }

        global.aiHistory ??=
          new Map();

        const userKey =
          `${interaction.guild?.id || "dm"}:${interaction.user.id}`;

        if (sub === "reset") {
          global.aiHistory.delete(
            userKey
          );

          return replySuccess(
            interaction,
            "AI Conversation Reset",
            [
              field(
                "User",
                interaction.user.toString()
              ),
              field(
                "Status",
                "Previous conversation context cleared."
              )
            ]
          );
        }

        const prompt =
          interaction.options.getString(
            "prompt"
          );

        global.aiHistory.set(
          userKey,
          (
            global.aiHistory.get(
              userKey
            ) || []
          ).slice(-10)
        );

        const history =
          global.aiHistory.get(
            userKey
          );

        history.push({
          role: "user",
          content: prompt
        });

        await interaction.deferReply();

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
                    `Bearer ${key}`
                },
                body: JSON.stringify({
                  model:
                    process.env.OPENAI_MODEL ||
                    "gpt-5.5",
                  input:
                    history
                })
              }
            );

          const data =
            await response.json();

          if (!response.ok) {
            throw new Error(
              data?.error?.message ||
              "OpenAI API request failed."
            );
          }

          const answer =
            data.output_text ||
            data.output
              ?.map(
                item =>
                  item.content
                    ?.map(
                      content =>
                        content.text ||
                        ""
                    )
                    .join("") ||
                  ""
              )
              .join("") ||
            "No response.";

          history.push({
            role: "assistant",
            content: answer
          });

          global.aiHistory.set(
            userKey,
            history.slice(-12)
          );

          await interaction.editReply({
            embeds: [
              baseEmbed(
                interaction.guild,
                "🤖 AkiyO AI",
                COLORS.purple
              )
                .setDescription(
                  answer.slice(0, 4000)
                )
                .addFields(
                  field(
                    "User",
                    interaction.user.toString()
                  ),
                  field(
                    "Model",
                    process.env.OPENAI_MODEL ||
                      "gpt-5.5"
                  )
                )
            ]
          });

          await log(
            interaction.guild,
            "AI",
            "🤖 AI Request Completed",
            [
              field(
                "User",
                `${interaction.user.tag} (${interaction.user.id})`
              ),
              field(
                "Prompt",
                prompt
              )
            ],
            COLORS.purple
          );
        } catch (error) {
          console.error(
            "AI error:",
            error
          );

          await interaction.editReply({
            embeds: [
              errorEmbed(
                interaction.guild,
                "AI Request Failed",
                [
                  field(
                    "Error",
                    error.message
                  ),
                  field(
                    "Action",
                    "Check OPENAI_API_KEY, model configuration and API availability."
                  )
                ]
              )
            ]
          });
        }

        return;
      }

      /* HELP */

      if (
        command ===
        "help"
      ) {
        const embed =
          baseEmbed(
            interaction.guild,
            "📚 AkiyO Command Center",
            COLORS.primary
          )
            .setDescription(
              "A professional Discord management, support, moderation, security and automation system."
            )
            .addFields(
              field(
                "🎫 Support",
                "`/ticket` • `/ticketpanel` • `/ticketsetup` • `/close` • `/reopen` • `/claim` • `/unclaim` • `/lock` • `/unlock` • `/ticketadd` • `/ticketremove` • `/ticketrename` • `/ticketinfo` • `/ticketstats`"
              ),
              field(
                "🛡️ AutoMod",
                "`/automod enable` • `/automod disable` • `/automod status` • `/automod config` • `/automod badword` • `/automod removebadword`"
              ),
              field(
                "🔐 Security",
                "`/security enable` • `/security disable` • `/security status` • `/security action` • trusted/protected controls"
              ),
              field(
                "⚖️ Moderation",
                "`/warn` • `/timeout` • `/kick` • `/ban` • `/unban` • `/warnings` • `/punishments`"
              ),
              field(
                "⚙️ Configuration",
                "`/config view` • `/config staffrole` • `/config ticketcategory` • `/logsetup`"
              ),
              field(
                "👋 Community",
                "`/welcome` • `/autorole` • `/verification` • `/autoreactionrole`"
              ),
              field(
                "📢 Management",
                "`/announce`"
              ),
              field(
                "🤖 AI",
                "`/ai ask` • `/ai reset`"
              ),
              field(
                "ℹ️ Utility",
                "`/help` • `/botinfo`"
              )
            );

        return interaction.reply({
          embeds: [embed],
          ephemeral: true
        });
      }

      /* BOT INFO */

      if (
        command ===
        "botinfo"
      ) {
        const totalUsers =
          client.guilds.cache.reduce(
            (total, guild) =>
              total +
              (guild.memberCount || 0),
            0
          );

        const uptime =
          Math.floor(
            process.uptime()
          );

        const days =
          Math.floor(
            uptime / 86400
          );

        const hours =
          Math.floor(
            (uptime % 86400) /
              3600
          );

        const minutes =
          Math.floor(
            (uptime % 3600) /
              60
          );

        return interaction.reply({
          embeds: [
            baseEmbed(
              interaction.guild,
              "🤖 AkiyO Bot Information",
              COLORS.primary
            )
              .setThumbnail(
                client.user.displayAvatarURL()
              )
              .addFields(
                field(
                  "Bot",
                  `${client.user.tag} (${client.user.id})`
                ),
                field(
                  "Servers",
                  client.guilds.cache.size,
                  true
                ),
                field(
                  "Users",
                  totalUsers,
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
                  "Discord.js",
                  require("discord.js").version,
                  true
                ),
                field(
                  "Uptime",
                  `${days}d ${hours}h ${minutes}m`,
                  true
                ),
                field(
                  "Systems",
                  "Tickets • AutoMod • Security • Moderation • Logging • Welcome • Autorole • Verification • Reaction Roles • Announcements • AI"
                )
              )
          ]
        });
      }

      /* TICKET MANAGEMENT */

      if (
        [
          "close",
          "reopen",
          "delete",
          "claim",
          "unclaim",
          "lock",
          "unlock",
          "ticketadd",
          "ticketremove",
          "ticketrename",
          "ticketinfo",
          "ticketstats"
        ].includes(command)
      ) {
        if (
          command ===
          "ticketstats"
        ) {
          const open =
            [...tickets.values()]
              .filter(
                ticket =>
                  ticket.guildId ===
                    interaction.guild.id &&
                  ticket.status ===
                    "open"
              ).length;

          const closed =
            [...tickets.values()]
              .filter(
                ticket =>
                  ticket.guildId ===
                    interaction.guild.id &&
                  ticket.status ===
                    "closed"
              ).length;

          return interaction.reply({
            embeds: [
              infoEmbed(
                interaction.guild,
                "🎫 Ticket Statistics",
                [
                  field(
                    "Open Tickets",
                    open,
                    true
                  ),
                  field(
                    "Closed Tickets",
                    closed,
                    true
                  ),
                  field(
                    "Total",
                    open + closed,
                    true
                  )
                ]
              )
            ],
            ephemeral: true
          });
        }

        const ticket =
          ticketByChannel(
            interaction.channel.id
          );

        if (!ticket) {
          return replyError(
            interaction,
            "Ticket Not Found",
            [
              field(
                "Channel",
                interaction.channel.name
              ),
              field(
                "Reason",
                "This channel is not registered as an AkiyO ticket."
              )
            ]
          );
        }

        const ownerId =
          ticket[0];

        const record =
          [...tickets.entries()]
            .find(
              ([, value]) =>
                value.channelId ===
                interaction.channel.id
            );

        if (
          command ===
          "close"
        ) {
          await interaction.channel
            .permissionOverwrites
            .edit(
              ownerId,
              {
                ViewChannel: true,
                SendMessages: false
              }
            );

          if (record) {
            record[1].status =
              "closed";
          }

          save();

          await log(
            interaction.guild,
            "Tickets",
            "🔒 Ticket Closed",
            [
              field(
                "Owner",
                `<@${ownerId}>`
              ),
              field(
                "Closed By",
                interaction.user.toString()
              )
            ],
            COLORS.warning
          );

          return replySuccess(
            interaction,
            "Ticket Closed",
            [
              field(
                "Status",
                "🔒 Closed"
              ),
              field(
                "Owner",
                `<@${ownerId}>`
              )
            ]
          );
        }

        if (
          command ===
          "reopen"
        ) {
          await interaction.channel
            .permissionOverwrites
            .edit(
              ownerId,
              {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
              }
            );

          if (record) {
            record[1].status =
              "open";
            record[1].locked =
              false;
          }

          save();

          await log(
            interaction.guild,
            "Tickets",
            "🔓 Ticket Reopened",
            [
              field(
                "Owner",
                `<@${ownerId}>`
              ),
              field(
                "Reopened By",
                interaction.user.toString()
              )
            ],
            COLORS.success
          );

          return replySuccess(
            interaction,
            "Ticket Reopened",
            [
              field(
                "Status",
                "🟢 Open"
              )
            ]
          );
        }

        if (
          command ===
          "delete"
        ) {
          await log(
            interaction.guild,
            "Tickets",
            "🗑️ Ticket Deleted",
            [
              field(
                "Owner",
                `<@${ownerId}>`
              ),
              field(
                "Deleted By",
                interaction.user.toString()
              ),
              field(
                "Channel",
                interaction.channel.name
              )
            ],
            COLORS.danger
          );

          tickets.delete(
            `${interaction.guild.id}:${ownerId}`
          );

          await replySuccess(
            interaction,
            "Ticket Deleting",
            [
              field(
                "Status",
                "The ticket channel will now be deleted."
              )
            ]
          );

          return interaction.channel
            .delete()
            .catch(() => {});
        }

        if (
          command ===
          "claim"
        ) {
          claims.set(
            interaction.channel.id,
            interaction.user.id
          );

          if (record) {
            record[1].claimedBy =
              interaction.user.id;
          }

          save();

          return replySuccess(
            interaction,
            "Ticket Claimed",
            [
              field(
                "Claimed By",
                interaction.user.toString()
              ),
              field(
                "Status",
                "🟢 Claimed"
              )
            ]
          );
        }

        if (
          command ===
          "unclaim"
        ) {
          claims.delete(
            interaction.channel.id
          );

          if (record) {
            record[1].claimedBy =
              null;
          }

          save();

          return replySuccess(
            interaction,
            "Ticket Unclaimed",
            [
              field(
                "Status",
                "Available for another staff member."
              )
            ]
          );
        }

        if (
          command ===
          "lock"
        ) {
          await interaction.channel
            .permissionOverwrites
            .edit(
              ownerId,
              {
                ViewChannel: true,
                SendMessages: false
              }
            );

          if (record) {
            record[1].locked =
              true;
          }

          save();

          return replySuccess(
            interaction,
            "Ticket Locked",
            [
              field(
                "User Messaging",
                "Disabled"
              )
            ]
          );
        }

        if (
          command ===
          "unlock"
        ) {
          await interaction.channel
            .permissionOverwrites
            .edit(
              ownerId,
              {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
              }
            );

          if (record) {
            record[1].locked =
              false;
          }

          save();

          return replySuccess(
            interaction,
            "Ticket Unlocked",
            [
              field(
                "User Messaging",
                "Enabled"
              )
            ]
          );
        }

        if (
          command ===
          "ticketadd"
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

          await log(
            interaction.guild,
            "Tickets",
            "➕ User Added To Ticket",
            [
              field(
                "User",
                `${user.tag} (${user.id})`
              ),
              field(
                "Added By",
                interaction.user.toString()
              ),
              field(
                "Ticket",
                interaction.channel.toString()
              )
            ],
            COLORS.success
          );

          return replySuccess(
            interaction,
            "User Added",
            [
              field(
                "User",
                user.toString()
              ),
              field(
                "Access",
                "View + Send Messages"
              )
            ]
          );
        }

        if (
          command ===
          "ticketremove"
        ) {
          const user =
            interaction.options.getUser(
              "user"
            );

          await interaction.channel
            .permissionOverwrites
            .delete(
              user.id
            )
            .catch(() => {});

          return replySuccess(
            interaction,
            "User Removed",
            [
              field(
                "User",
                user.toString()
              ),
              field(
                "Access",
                "Removed from ticket."
              )
            ]
          );
        }

        if (
          command ===
          "ticketrename"
        ) {
          const name =
            interaction.options
              .getString("name")
              .replace(
                /[^a-zA-Z0-9-_]/g,
                "-"
              )
              .slice(0, 90);

          const old =
            interaction.channel.name;

          await interaction.channel
            .setName(name);

          await log(
            interaction.guild,
            "Tickets",
            "✏️ Ticket Renamed",
            [
              field(
                "Before",
                old
              ),
              field(
                "After",
                name
              ),
              field(
                "Changed By",
                interaction.user.toString()
              )
            ],
            COLORS.info
          );

          return replySuccess(
            interaction,
            "Ticket Renamed",
            [
              field(
                "Before",
                old
              ),
              field(
                "After",
                name
              )
            ]
          );
        }

        if (
          command ===
          "ticketinfo"
        ) {
          const claimed =
            claims.get(
              interaction.channel.id
            );

          return interaction.reply({
            embeds: [
              infoEmbed(
                interaction.guild,
                "🎫 Ticket Information",
                [
                  field(
                    "Owner",
                    `<@${ownerId}>`
                  ),
                  field(
                    "Status",
                    record?.[1]?.status ||
                      "Unknown"
                  ),
                  field(
                    "Claimed By",
                    claimed
                      ? `<@${claimed}>`
                      : "Nobody"
                  ),
                  field(
                    "Locked",
                    record?.[1]?.locked
                      ? "Yes"
                      : "No"
                  ),
                  field(
                    "Created",
                    record?.[1]?.createdAt
                      ? `<t:${Math.floor(record[1].createdAt / 1000)}:F>`
                      : "Unknown"
                  ),
                  field(
                    "Channel ID",
                    interaction.channel.id
                  )
                ]
              )
            ],
            ephemeral: true
          });
        }
      }
    } catch (error) {
      console.error(
        "Interaction error:",
        error
      );

      if (
        !interaction.replied &&
        !interaction.deferred
      ) {
        await interaction.reply({
          embeds: [
            errorEmbed(
              interaction.guild,
              "Internal Error",
              [
                field(
                  "Error",
                  error.message
                ),
                field(
                  "Action",
                  "Check the bot console for more details."
                )
              ]
            )
          ],
          ephemeral: true
        }).catch(() => {});
      } else {
        await interaction.editReply({
          embeds: [
            errorEmbed(
              interaction.guild,
              "Internal Error",
              [
                field(
                  "Error",
                  error.message
                )
              ]
            )
          ]
        }).catch(() => {});
      }
    }
  }
);

/* =========================
   REACTION ROLES
========================= */

client.on(
  "messageReactionAdd",
  async (reaction, user) => {
    try {
      if (user.bot) return;

      if (reaction.partial) {
        await reaction
          .fetch()
          .catch(() => {});
      }

      const message =
        reaction.message;

      const guild =
        message.guild;

      if (!guild) return;

      const c =
        getGuildConfig(
          guild
        );

      const key =
        reactionKey(
          reaction
        );

      const data =
        c.reactionRoles
          ?.[message.id]
          ?.[key];

      if (!data) return;

      const member =
        await guild.members
          .fetch(user.id)
          .catch(() => null);

      const role =
        await guild.roles
          .fetch(data.roleId)
          .catch(() => null);

      if (!member || !role) return;

      const me =
        guild.members.me;

      if (
        !me ||
        role.position >=
          me.roles.highest.position
      ) {
        await log(
          guild,
          "Reaction Roles",
          "❌ Reaction Role Failed",
          [
            field(
              "User",
              `${user.tag} (${user.id})`
            ),
            field(
              "Role",
              `${role?.name || "Unknown"} (${data.roleId})`
            ),
            field(
              "Reason",
              "Role hierarchy prevents AkiyO from assigning the role."
            )
          ],
          COLORS.danger
        );

        return;
      }

      await member.roles.add(
        role,
        "AkiyO Reaction Role"
      );

      await log(
        guild,
        "Reaction Roles",
        "🎭 Reaction Role Added",
        [
          field(
            "User",
            `${user.tag} (${user.id})`
          ),
          field(
            "Emoji",
            reaction.emoji.toString()
          ),
          field(
            "Role",
            `${role} (${role.id})`
          )
        ],
        COLORS.success
      );
    } catch (error) {
      console.error(
        "Reaction add error:",
        error
      );
    }
  }
);

client.on(
  "messageReactionRemove",
  async (reaction, user) => {
    try {
      if (user.bot) return;

      if (reaction.partial) {
        await reaction
          .fetch()
          .catch(() => {});
      }

      const message =
        reaction.message;

      const guild =
        message.guild;

      if (!guild) return;

      const c =
        getGuildConfig(
          guild
        );

      const key =
        reactionKey(
          reaction
        );

      const data =
        c.reactionRoles
          ?.[message.id]
          ?.[key];

      if (!data) return;

      const member =
        await guild.members
          .fetch(user.id)
          .catch(() => null);

      const role =
        await guild.roles
          .fetch(data.roleId)
          .catch(() => null);

      if (
        member &&
        role
      ) {
        await member.roles.remove(
          role,
          "AkiyO Reaction Role Removed"
        );

        await log(
          guild,
          "Reaction Roles",
          "🎭 Reaction Role Removed",
          [
            field(
              "User",
              `${user.tag} (${user.id})`
            ),
            field(
              "Emoji",
              reaction.emoji.toString()
            ),
            field(
              "Role",
              `${role} (${role.id})`
            )
          ],
          COLORS.warning
        );
      }
    } catch (error) {
      console.error(
        "Reaction remove error:",
        error
      );
    }
  }
);

/* =========================
   READY
========================= */

client.once(
  "clientReady",
  async () => {
    console.log(
      `🤖 Logged in as ${client.user.tag}`
    );

    console.log(
      `🏠 Connected to ${client.guilds.cache.size} servers`
    );

    try {
      await registerCommands();
    } catch (error) {
      console.error(
        "❌ Command registration failed:",
        error
      );
    }

    console.log(
      `🚀 AkiyO online with ${commands.length} commands.`
    );
  }
);

/* =========================
   ERROR HANDLERS
========================= */

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

/* =========================
   LOGIN
========================= */

client.login(TOKEN);
