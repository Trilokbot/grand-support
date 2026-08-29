const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  ActivityType,
  Events,
  AttachmentBuilder
} = require("discord.js");

const fs = require("fs");
const path = require("path");

/* =========================================================
   ENVIRONMENT
========================================================= */

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const SERVER_ID = "1493700265499689154";
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
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.DirectMessageReactions
  ],
  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User
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

let db = {
  guilds: {}
};

function saveDB() {
  try {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify(db, null, 2)
    );
  } catch (err) {
    console.error("Database save error:", err);
  }
}

function loadDB() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(
        DB_FILE,
        "utf8"
      );

      db = JSON.parse(raw);

      if (!db.guilds) {
        db.guilds = {};
      }
    }
  } catch (err) {
    console.error("Database load error:", err);
    db = { guilds: {} };
  }
}

loadDB();

/* =========================================================
   DEFAULT CONFIG
========================================================= */

function defaultGuild() {
  return {
    automod: {
      enabled: true,
      invites: true,
      spam: true,
      mentions: true,
      caps: true,
      repeated: true,
      badwords: true,

      spamLimit: 5,
      spamWindow: 7000,
      mentionLimit: 5,
      capsPercent: 75,

      badWords: [
        "badword1",
        "badword2"
      ],

      punishment: "timeout",
      timeoutMinutes: 5,

      ignoredChannels: [],
      ignoredRoles: []
    },

    autotimeout: {
      enabled: true,
      duration: 5,
      spam: true,
      invites: true,
      mentions: true,
      badwords: true,
      caps: true,
      repeated: true
    },

    security: {
      enabled: true,
      antiRaid: true,
      antiNuke: true,

      raidLimit: 8,
      raidWindow: 10000,

      nukeLimit: 3,
      nukeWindow: 10000,

      lockdown: false
    },

    roleProtection: {
      enabled: true,
      protectEveryone: true,

      protectedRoles: [
        SUPPORT_ADMIN_ROLE_ID
      ],

      timeoutMinutes: 60
    },

    trusted: {
      users: [],
      bots: []
    },

    logs: {
      automod: SUPPORT_LOG_CHANNEL_ID,
      security: SUPPORT_LOG_CHANNEL_ID,
      moderation: SUPPORT_LOG_CHANNEL_ID,
      audit: SUPPORT_LOG_CHANNEL_ID,
      tickets: SUPPORT_LOG_CHANNEL_ID,
      suggestions: SUPPORT_LOG_CHANNEL_ID,
      announcements: SUPPORT_LOG_CHANNEL_ID,
      members: SUPPORT_LOG_CHANNEL_ID,
      messages: SUPPORT_LOG_CHANNEL_ID,
      roles: SUPPORT_LOG_CHANNEL_ID
    },

    tickets: {
      panelChannelId: null,
      categoryId: null,
      records: {},
      counter: 0
    },

    suggestions: {
      channelId: null
    },

    announcements: {
      channels: [],
      roles: []
    },

    warnings: {},
    punishments: {},

    statistics: {
      warnings: 0,
      punishments: 0,
      automod: 0,
      securityEvents: 0,
      tickets: 0,
      suggestions: 0
    }
  };
}

function getGuildData(guildId) {
  if (!db.guilds[guildId]) {
    db.guilds[guildId] = defaultGuild();
    saveDB();
  }

  return db.guilds[guildId];
}

/* =========================================================
   HELPERS
========================================================= */

function embed(
  title,
  description,
  color = 0x5865f2
) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();
}

function shorten(text, length = 1000) {
  if (!text) return "";
  return text.length > length
    ? text.slice(0, length) + "..."
    : text;
}

function isOwner(interaction) {
  return interaction.user.id ===
    interaction.guild.ownerId;
}

function isStaff(interaction) {
  if (!interaction.member) return false;

  if (isOwner(interaction)) {
    return true;
  }

  return (
    interaction.member.roles.cache.has(
      SUPPORT_ADMIN_ROLE_ID
    ) ||
    interaction.member.permissions.has(
      PermissionsBitField.Flags.Administrator
    )
  );
}

function requireStaff(interaction) {
  return isStaff(interaction);
}

function isTrusted(guildData, userId) {
  return guildData.trusted.users.includes(
    userId
  );
}

function isTrustedBot(guildData, userId) {
  return guildData.trusted.bots.includes(
    userId
  );
}

async function sendLog(
  guild,
  type,
  title,
  description,
  color = 0x5865f2
) {
  try {
    const data = getGuildData(guild.id);
    const channelId = data.logs[type];

    if (!channelId) return;

    const channel =
      await guild.channels.fetch(channelId)
        .catch(() => null);

    if (!channel || !channel.isTextBased()) {
      return;
    }

    await channel.send({
      embeds: [
        embed(
          title,
          description,
          color
        )
      ]
    });
  } catch (err) {
    console.error("Log error:", err);
  }
}

/* =========================================================
   MODERATION DATABASE
========================================================= */

function addWarning(
  guildId,
  userId,
  reason,
  moderatorId
) {
  if (!db.guilds[guildId].warnings[userId]) {
    db.guilds[guildId].warnings[userId] = [];
  }

  const record = {
    id: Date.now().toString(),
    reason,
    moderatorId,
    timestamp: Date.now()
  };

  db.guilds[guildId].warnings[userId].push(
    record
  );

  db.guilds[guildId].statistics.warnings++;

  saveDB();

  return record;
}

function getWarnings(guildId, userId) {
  return (
    db.guilds[guildId]?.warnings[userId] || []
  );
}

function addPunishment(
  guildId,
  userId,
  type,
  reason,
  moderatorId
) {
  if (!db.guilds[guildId].punishments[userId]) {
    db.guilds[guildId].punishments[userId] = [];
  }

  db.guilds[guildId].punishments[userId].push({
    id: Date.now().toString(),
    type,
    reason,
    moderatorId,
    timestamp: Date.now()
  });

  db.guilds[guildId].statistics.punishments++;

  saveDB();
}

function getPunishments(guildId, userId) {
  return (
    db.guilds[guildId]?.punishments[userId] ||
    []
  );
}

/* =========================================================
   TIMEOUT
========================================================= */

async function timeoutMember(
  member,
  minutes,
  reason
) {
  try {
    if (!member.moderatable) {
      return false;
    }

    await member.timeout(
      Math.min(
        minutes * 60 * 1000,
        28 * 24 * 60 * 60 * 1000
      ),
      reason
    );

    return true;
  } catch (err) {
    console.error("Timeout error:", err);
    return false;
  }
}

/* =========================================================
   WARNING ESCALATION
========================================================= */

async function warningEscalation(
  member,
  count
) {
  if (count === 3) {
    if (
      await timeoutMember(
        member,
        10,
        "Automatic warning escalation"
      )
    ) {
      return "10 minute timeout";
    }
  }

  if (count === 5) {
    if (
      await timeoutMember(
        member,
        30,
        "Automatic warning escalation"
      )
    ) {
      return "30 minute timeout";
    }
  }

  if (count >= 7) {
    if (member.bannable) {
      await member.ban({
        reason:
          "Automatic warning escalation"
      });

      return "Automatic ban";
    }
  }

  return null;
}

/* =========================================================
   AUTOMOD TRACKERS
========================================================= */

const messageTracker = new Map();
const joinTracker = new Map();
const actionTracker = new Map();

/* =========================================================
   AUTOMOD
========================================================= */

function hasInvite(text) {
  return /(?:discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\//i
    .test(text);
}

function capsPercentage(text) {
  const letters =
    text.match(/[A-Za-z]/g) || [];

  if (!letters.length) return 0;

  const caps =
    letters.filter(c =>
      c === c.toUpperCase()
    ).length;

  return (
    caps / letters.length
  ) * 100;
}

function containsBadWord(
  text,
  words
) {
  const lower = text.toLowerCase();

  return words.some(word =>
    lower.includes(word.toLowerCase())
  );
}

async function autoTimeout(
  message,
  reason
) {
  const data =
    getGuildData(message.guild.id);

  if (!data.autotimeout.enabled) {
    return;
  }

  const member = message.member;

  if (!member || member.permissions.has(
    PermissionsBitField.Flags.Administrator
  )) {
    return;
  }

  if (!member.moderatable) {
    return;
  }

  await timeoutMember(
    member,
    data.autotimeout.duration,
    reason
  );

  data.statistics.automod++;

  saveDB();

  await sendLog(
    message.guild,
    "automod",
    "⏱️ AutoTimeout",
    [
      `**User:** ${member}`,
      `**Reason:** ${reason}`,
      `**Duration:** ${data.autotimeout.duration} minutes`
    ].join("\n"),
    0xfee75c
  );
}

async function handleAutoMod(
  message
) {
  if (
    !message.guild ||
    message.author.bot
  ) {
    return;
  }

  const data =
    getGuildData(message.guild.id);

  if (!data.automod.enabled) {
    return;
  }

  if (
    data.automod.ignoredChannels
      .includes(message.channel.id)
  ) {
    return;
  }

  const ignoredRole =
    message.member?.roles.cache.some(
      role =>
        data.automod.ignoredRoles
          .includes(role.id)
    );

  if (ignoredRole) {
    return;
  }

  const content =
    message.content || "";

  /* INVITE */

  if (
    data.automod.invites &&
    hasInvite(content) &&
    !isTrusted(
      data,
      message.author.id
    )
  ) {
    await message.delete().catch(() => {});

    await autoTimeout(
      message,
      "Discord invite link"
    );

    return;
  }

  /* MASS MENTIONS */

  const mentions =
    message.mentions.users.size +
    message.mentions.roles.size;

  if (
    data.automod.mentions &&
    mentions >= data.automod.mentionLimit
  ) {
    await message.delete().catch(() => {});

    await autoTimeout(
      message,
      "Mass mentions"
    );

    return;
  }

  /* BAD WORDS */

  if (
    data.automod.badwords &&
    containsBadWord(
      content,
      data.automod.badWords
    )
  ) {
    await message.delete().catch(() => {});

    await autoTimeout(
      message,
      "Blocked word"
    );

    return;
  }

  /* CAPS */

  if (
    data.automod.caps &&
    content.length >= 8 &&
    capsPercentage(content) >=
      data.automod.capsPercent
  ) {
    await message.delete().catch(() => {});

    await autoTimeout(
      message,
      "Excessive capital letters"
    );

    return;
  }

  /* REPEATED MESSAGE */

  if (data.automod.repeated) {
    const key =
      `${message.guild.id}:${message.author.id}`;

    const old =
      messageTracker.get(key);

    if (
      old &&
      old.content === content &&
      Date.now() - old.time < 10000
    ) {
      await message.delete().catch(() => {});

      await autoTimeout(
        message,
        "Repeated message spam"
      );

      return;
    }

    messageTracker.set(key, {
      content,
      time: Date.now()
    });
  }

  /* SPAM */

  if (data.automod.spam) {
    const key =
      `${message.guild.id}:${message.author.id}`;

    let list =
      messageTracker.get(
        `${key}:spam`
      ) || [];

    list = list.filter(
      timestamp =>
        Date.now() - timestamp <=
        data.automod.spamWindow
    );

    list.push(Date.now());

    messageTracker.set(
      `${key}:spam`,
      list
    );

    if (
      list.length >=
      data.automod.spamLimit
    ) {
      await autoTimeout(
        message,
        "Message spam"
      );

      messageTracker.delete(
        `${key}:spam`
      );
    }
  }
}

/* =========================================================
   ANTI RAID
========================================================= */

async function handleMemberJoin(member) {
  const data =
    getGuildData(member.guild.id);

  if (
    !data.security.enabled ||
    !data.security.antiRaid
  ) {
    return;
  }

  const key =
    member.guild.id;

  let joins =
    joinTracker.get(key) || [];

  joins = joins.filter(
    timestamp =>
      Date.now() - timestamp <=
      data.security.raidWindow
  );

  joins.push(Date.now());

  joinTracker.set(
    key,
    joins
  );

  if (
    joins.length >=
    data.security.raidLimit
  ) {
    data.security.lockdown = true;
    data.statistics.securityEvents++;

    saveDB();

    await sendLog(
      member.guild,
      "security",
      "🚨 RAID DETECTED",
      [
        `**Joins:** ${joins.length}`,
        `**Window:** ${data.security.raidWindow / 1000}s`,
        "**Action:** Security lockdown enabled"
      ].join("\n"),
      0xed4245
    );
  }

  await sendLog(
    member.guild,
    "members",
    "📥 Member Joined",
    [
      `**User:** ${member.user.tag}`,
      `**ID:** ${member.id}`,
      `**Account:** <t:${Math.floor(
        member.user.createdTimestamp / 1000
      )}:R>`
    ].join("\n"),
    0x57f287
  );
}

/* =========================================================
   ROLE PROTECTOR
========================================================= */

async function punishUnauthorizedRoleActor(
  guild,
  userId,
  reason
) {
  const data =
    getGuildData(guild.id);

  if (
    isTrusted(data, userId)
  ) {
    return;
  }

  const member =
    await guild.members
      .fetch(userId)
      .catch(() => null);

  if (!member) return;

  if (
    member.permissions.has(
      PermissionsBitField.Flags.Administrator
    )
  ) {
    return;
  }

  await timeoutMember(
    member,
    data.roleProtection.timeoutMinutes,
    reason
  );

  await sendLog(
    guild,
    "security",
    "🛡️ ROLE PROTECTOR TRIGGERED",
    [
      `**User:** ${member}`,
      `**Action:** 1 hour timeout`,
      `**Reason:** ${reason}`
    ].join("\n"),
    0xed4245
  );
}

async function handleRoleUpdate(
  oldRole,
  newRole
) {
  const guild =
    newRole.guild;

  const data =
    getGuildData(guild.id);

  if (
    !data.roleProtection.enabled
  ) {
    return;
  }

  if (
    oldRole.name ===
      newRole.name &&
    oldRole.permissions.bitfield ===
      newRole.permissions.bitfield &&
    oldRole.color ===
      newRole.color &&
    oldRole.position ===
      newRole.position
  ) {
    return;
  }

  const audit =
    await guild.fetchAuditLogs({
      type: 31,
      limit: 5
    }).catch(() => null);

  const entry =
    audit?.entries.find(
      e =>
        e.target?.id ===
        newRole.id &&
        Date.now() - e.createdTimestamp <
          15000
    );

  if (!entry) return;

  const actor =
    entry.executor;

  if (
    !actor ||
    actor.id === client.user.id ||
    isTrusted(data, actor.id) ||
    isTrustedBot(data, actor.id)
  ) {
    return;
  }

  const protectedRole =
    data.roleProtection.protectedRoles
      .includes(newRole.id);

  if (
    newRole.id === guild.id &&
    data.roleProtection.protectEveryone
  ) {
    await punishUnauthorizedRoleActor(
      guild,
      actor.id,
      "Unauthorized @everyone role modification"
    );

    return;
  }

  if (protectedRole) {
    await punishUnauthorizedRoleActor(
      guild,
      actor.id,
      `Unauthorized protected role modification: ${newRole.name}`
    );
  }

  await sendLog(
    guild,
    "roles",
    "🛡️ Role Updated",
    [
      `**Role:** ${newRole}`,
      `**Changed By:** ${actor}`,
      `**Protected:** ${protectedRole ? "Yes" : "No"}`
    ].join("\n")
  );
}

async function handleRoleDelete(role) {
  const guild = role.guild;

  const data =
    getGuildData(guild.id);

  if (
    !data.roleProtection.enabled
  ) {
    return;
  }

  const protectedRole =
    data.roleProtection.protectedRoles
      .includes(role.id);

  if (!protectedRole) {
    return;
  }

  const audit =
    await guild.fetchAuditLogs({
      type: 32,
      limit: 5
    }).catch(() => null);

  const entry =
    audit?.entries.find(
      e =>
        e.target?.id === role.id &&
        Date.now() - e.createdTimestamp <
          15000
    );

  if (!entry) return;

  const actor =
    entry.executor;

  if (
    !actor ||
    actor.id === client.user.id ||
    isTrusted(data, actor.id)
  ) {
    return;
  }

  await punishUnauthorizedRoleActor(
    guild,
    actor.id,
    `Unauthorized deletion of protected role: ${role.name}`
  );
}

/* =========================================================
   CHANNEL / NUKE PROTECTION
========================================================= */

async function handleChannelDelete(channel) {
  if (!channel.guild) return;

  const guild =
    channel.guild;

  const data =
    getGuildData(guild.id);

  if (
    !data.security.enabled ||
    !data.security.antiNuke
  ) {
    return;
  }

  const audit =
    await guild.fetchAuditLogs({
      type: 12,
      limit: 5
    }).catch(() => null);

  const entry =
    audit?.entries.find(
      e =>
        e.target?.id === channel.id &&
        Date.now() - e.createdTimestamp <
          15000
    );

  if (!entry) return;

  const actor =
    entry.executor;

  if (
    !actor ||
    actor.id === client.user.id ||
    isTrusted(data, actor.id) ||
    isTrustedBot(data, actor.id)
  ) {
    return;
  }

  const key =
    `${guild.id}:${actor.id}:channelDelete`;

  let actions =
    actionTracker.get(key) || [];

  actions = actions.filter(
    t =>
      Date.now() - t <=
      data.security.nukeWindow
  );

  actions.push(Date.now());

  actionTracker.set(
    key,
    actions
  );

  data.statistics.securityEvents++;

  if (
    actions.length >=
    data.security.nukeLimit
  ) {
    const member =
      await guild.members
        .fetch(actor.id)
        .catch(() => null);

    if (
      member &&
      member.moderatable
    ) {
      await member.timeout(
        60 * 60 * 1000,
        "Anti-Nuke protection"
      ).catch(() => {});
    }

    data.security.lockdown = true;

    await sendLog(
      guild,
      "security",
      "☢️ ANTI-NUKE TRIGGERED",
      [
        `**Actor:** ${actor}`,
        `**Action:** Channel deletion`,
        `**Count:** ${actions.length}`,
        "**Punishment:** 1 hour timeout",
        "**Lockdown:** Enabled"
      ].join("\n"),
      0xed4245
    );

    actionTracker.delete(key);
  }

  saveDB();
}

/* =========================================================
   TICKET SYSTEM
========================================================= */

function ticketId(data) {
  data.tickets.counter++;

  return (
    "TICKET-" +
    String(data.tickets.counter)
      .padStart(5, "0")
  );
}

function findOpenTicket(
  data,
  userId
) {
  return Object.values(
    data.tickets.records
  ).find(
    t =>
      t.userId === userId &&
      t.status === "open"
  );
}

async function createTicketPanel(channel) {
  const row =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            "ticket_create"
          )
          .setLabel(
            "Create Support Ticket"
          )
          .setEmoji("🎫")
          .setStyle(
            ButtonStyle.Primary
          )
      );

  await channel.send({
    embeds: [
      embed(
        "🎫 Support Center",
        [
          "Need help?",
          "",
          "Press the button below to open a support ticket.",
          "",
          "• Your ticket is private",
          "• Support staff will assist you",
          "• Do not spam multiple tickets"
        ].join("\n"),
        0x5865f2
      )
    ],
    components: [row]
  });
}

async function createDMTicket(
  user
) {
  const guild =
    await client.guilds
      .fetch(SERVER_ID)
      .catch(() => null);

  if (!guild) {
    throw new Error(
      "Configured server not found."
    );
  }

  const data =
    getGuildData(guild.id);

  const existing =
    findOpenTicket(
      data,
      user.id
    );

  if (existing) {
    return {
      existing: true,
      ticket: existing
    };
  }

  const id =
    ticketId(data);

  const record = {
    id,
    userId: user.id,
    channelId: null,
    status: "open",
    claimedBy: null,
    createdAt: Date.now(),
    closedAt: null
  };

  data.tickets.records[id] =
    record;

  data.statistics.tickets++;

  saveDB();

  let category = null;

  if (
    data.tickets.categoryId
  ) {
    category =
      guild.channels.cache.get(
        data.tickets.categoryId
      );
  }

  const channel =
    await guild.channels.create({
      name:
        `ticket-${data.tickets.counter}`,
      type: ChannelType.GuildText,
      parent:
        category?.type ===
        ChannelType.GuildCategory
          ? category.id
          : null,
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
          id:
            SUPPORT_ADMIN_ROLE_ID,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory
          ]
        }
      ]
    });

  record.channelId =
    channel.id;

  saveDB();

  const row =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `ticket_close:${id}`
          )
          .setLabel("Close")
          .setEmoji("🔒")
          .setStyle(
            ButtonStyle.Danger
          ),
        new ButtonBuilder()
          .setCustomId(
            `ticket_claim:${id}`
          )
          .setLabel("Claim")
          .setEmoji("🙋")
          .setStyle(
            ButtonStyle.Success
          )
      );

  await channel.send({
    content:
      `<@&${SUPPORT_ADMIN_ROLE_ID}>`,
    embeds: [
      embed(
        `🎫 ${id}`,
        [
          `**User:** <@${user.id}>`,
          "",
          "A new DM support ticket has been created.",
          "",
          "Staff can claim the ticket and reply to the user."
        ].join("\n"),
        0x5865f2
      )
    ],
    components: [row]
  });

  await user.send({
    embeds: [
      embed(
        "🎫 Support Ticket Created",
        [
          `Your ticket **${id}** has been created.`,
          "",
          "Send your message here and our support team will receive it."
        ].join("\n"),
        0x57f287
      )
    ]
  }).catch(() => {});

  await sendLog(
    guild,
    "tickets",
    "🎫 Ticket Created",
    [
      `**Ticket:** ${id}`,
      `**User:** <@${user.id}>`,
      `**Channel:** ${channel}`
    ].join("\n"),
    0x57f287
  );

  return {
    existing: false,
    ticket: record
  };
}

async function closeTicket(
  guild,
  ticket,
  closerId
) {
  const data =
    getGuildData(guild.id);

  ticket.status = "closed";
  ticket.closedAt = Date.now();

  saveDB();

  const channel =
    await guild.channels
      .fetch(ticket.channelId)
      .catch(() => null);

  if (channel) {
    await channel.send({
      embeds: [
        embed(
          "🔒 Ticket Closed",
          `Closed by <@${closerId}>.`,
          0xed4245
        )
      ]
    }).catch(() => {});

    await channel.permissionOverwrites
      .edit(
        ticket.userId,
        {
          SendMessages: false
        }
      )
      .catch(() => {});
  }

  const user =
    await client.users
      .fetch(ticket.userId)
      .catch(() => null);

  if (user) {
    await user.send({
      embeds: [
        embed(
          "🔒 Ticket Closed",
          `Your support ticket **${ticket.id}** has been closed.`,
          0xed4245
        )
      ]
    }).catch(() => {});
  }

  await sendLog(
    guild,
    "tickets",
    "🔒 Ticket Closed",
    [
      `**Ticket:** ${ticket.id}`,
      `**Closed By:** <@${closerId}>`
    ].join("\n"),
    0xed4245
  );
}

async function forwardDM(
  message
) {
  const guild =
    await client.guilds
      .fetch(SERVER_ID)
      .catch(() => null);

  if (!guild) return;

  const data =
    getGuildData(guild.id);

  let ticket =
    findOpenTicket(
      data,
      message.author.id
    );

  if (!ticket) {
    const result =
      await createDMTicket(
        message.author
      );

    ticket =
      result.ticket;
  }

  const channel =
    await guild.channels
      .fetch(ticket.channelId)
      .catch(() => null);

  if (!channel) return;

  await channel.send({
    embeds: [
      embed(
        `📩 DM — ${message.author.tag}`,
        shorten(
          message.content ||
          "(Attachment/empty message)",
          4000
        ),
        0x5865f2
      )
    ]
  });

  if (
    message.attachments.size
  ) {
    for (
      const attachment of
      message.attachments.values()
    ) {
      await channel.send({
        content:
          attachment.url
      }).catch(() => {});
    }
  }
}

/* =========================================================
   TICKET BUTTONS
========================================================= */

async function handleTicketButton(
  interaction
) {
  const [action, id] =
    interaction.customId.split(":");

  const data =
    getGuildData(
      interaction.guild.id
    );

  if (
    action === "ticket_create"
  ) {
    const result =
      await createDMTicket(
        interaction.user
      );

    return interaction.reply({
      content:
        result.existing
          ? `🎫 You already have **${result.ticket.id}**.`
          : `🎫 Your ticket **${result.ticket.id}** has been created. Check your DMs.`,
      ephemeral: true
    });
  }

  const ticket =
    data.tickets.records[id];

  if (!ticket) {
    return interaction.reply({
      content:
        "❌ Ticket not found.",
      ephemeral: true
    });
  }

  if (
    action === "ticket_close"
  ) {
    if (!isStaff(interaction)) {
      return interaction.reply({
        content:
          "❌ Staff only.",
        ephemeral: true
      });
    }

    await closeTicket(
      interaction.guild,
      ticket,
      interaction.user.id
    );

    return interaction.reply({
      content:
        "🔒 Ticket closed.",
      ephemeral: true
    });
  }

  if (
    action === "ticket_claim"
  ) {
    if (!isStaff(interaction)) {
      return interaction.reply({
        content:
          "❌ Staff only.",
        ephemeral: true
      });
    }

    ticket.claimedBy =
      interaction.user.id;

    saveDB();

    await interaction.channel.send({
      embeds: [
        embed(
          "🙋 Ticket Claimed",
          `Claimed by ${interaction.user}.`,
          0x57f287
        )
      ]
    });

    return interaction.reply({
      content:
        "✅ Ticket claimed.",
      ephemeral: true
    });
  }
}

/* =========================================================
   SUGGESTIONS
========================================================= */

async function submitSuggestion(
  interaction
) {
  const text =
    interaction.options.getString(
      "text",
      true
    );

  const data =
    getGuildData(
      interaction.guild.id
    );

  const channel =
    data.suggestions.channelId
      ? await interaction.guild.channels
          .fetch(
            data.suggestions.channelId
          )
          .catch(() => null)
      : interaction.channel;

  if (
    !channel ||
    !channel.isTextBased()
  ) {
    return interaction.reply({
      content:
        "❌ Suggestion channel is not configured.",
      ephemeral: true
    });
  }

  const row =
    new ActionRowBuilder()
      .addComponents(
        new ButtonBuilder()
          .setCustomId(
            `suggest_approve:${interaction.user.id}`
          )
          .setLabel("Approve")
          .setEmoji("✅")
          .setStyle(
            ButtonStyle.Success
          ),
        new ButtonBuilder()
          .setCustomId(
            `suggest_decline:${interaction.user.id}`
          )
          .setLabel("Decline")
          .setEmoji("❌")
          .setStyle(
            ButtonStyle.Danger
          )
      );

  await channel.send({
    embeds: [
      embed(
        "💡 New Suggestion",
        [
          `**From:** ${interaction.user}`,
          "",
          text,
          "",
          "Status: 🟡 Pending"
        ].join("\n"),
        0xfee75c
      )
    ],
    components: [row]
  });

  data.statistics.suggestions++;

  saveDB();

  return interaction.reply({
    content:
      "✅ Your suggestion has been submitted.",
    ephemeral: true
  });
}

async function reviewSuggestion(
  interaction,
  approved
) {
  if (!isStaff(interaction)) {
    return interaction.reply({
      content:
        "❌ Staff only.",
      ephemeral: true
    });
  }

  const message =
    interaction.message;

  const old =
    message.embeds[0];

  const description =
    old?.description || "";

  const cleaned =
    description.replace(
      /Status: .*$/m,
      `Status: ${approved ? "🟢 Approved" : "🔴 Declined"}`
    );

  await message.edit({
    embeds: [
      EmbedBuilder.from(old)
        .setDescription(
          cleaned
        )
        .setColor(
          approved
            ? 0x57f287
            : 0xed4245
        )
    ],
    components: []
  });

  await interaction.reply({
    content:
      approved
        ? "✅ Suggestion approved."
        : "❌ Suggestion declined.",
    ephemeral: true
  });

  await sendLog(
    interaction.guild,
    "suggestions",
    approved
      ? "✅ Suggestion Approved"
      : "❌ Suggestion Declined",
    `Reviewed by ${interaction.user}.`,
    approved
      ? 0x57f287
      : 0xed4245
  );
}

/* =========================================================
   ANNOUNCEMENTS
========================================================= */

async function announcement(
  interaction
) {
  const title =
    interaction.options.getString(
      "title",
      true
    );

  const message =
    interaction.options.getString(
      "message",
      true
    );

  const image =
    interaction.options.getString(
      "image"
    );

  const mention =
    interaction.options.getString(
      "mention"
    ) || "";

  const data =
    getGuildData(
      interaction.guild.id
    );

  const channels =
    data.announcements.channels
      .map(id =>
        interaction.guild.channels
          .cache.get(id)
      )
      .filter(
        c =>
          c &&
          c.isTextBased()
      );

  if (!channels.length) {
    channels.push(
      interaction.channel
    );
  }

  const roleMention =
    data.announcements.roles.length
      ? data.announcements.roles
          .map(id => `<@&${id}>`)
          .join(" ")
      : "";

  const content =
    [
      mention,
      roleMention
    ]
      .filter(Boolean)
      .join(" ");

  const e =
    embed(
      `📢 ${title}`,
      message,
      0x5865f2
    )
      .setFooter({
        text:
          `Announcement by ${interaction.user.tag}`
      });

  if (image) {
    e.setImage(image);
  }

  for (
    const channel of channels
  ) {
    await channel.send({
      content,
      embeds: [e]
    }).catch(() => {});
  }

  return interaction.reply({
    content:
      `✅ Announcement sent to ${channels.length} channel(s).`,
    ephemeral: true
  });
}

/* =========================================================
   COMMANDS
========================================================= */

const commands = [];

/* HELP */

commands.push(
  new SlashCommandBuilder()
    .setName("help")
    .setDescription(
      "Show all bot systems and commands"
    )
);

/* STATS */

commands.push(
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription(
      "Show bot statistics"
    )
);

/* MODERATION */

commands.push(
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member")
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
    .setDescription("View warnings")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("punishments")
    .setDescription(
      "View punishment history"
    )
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
      o.setName("minutes")
        .setDescription("Minutes")
        .setMinValue(1)
        .setMaxValue(40320)
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason")
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
    ),

  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unban a user")
    .addStringOption(o =>
      o.setName("userid")
        .setDescription("User ID")
        .setRequired(true)
    )
);

/* AUTOMOD */

const automodCmd =
  new SlashCommandBuilder()
    .setName("automod")
    .setDescription(
      "Configure Advanced AutoMod"
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
      s.setName("status")
        .setDescription("View AutoMod")
    )
    .addSubcommand(s =>
      s.setName("invites")
        .setDescription("Configure invite protection")
        .addBooleanOption(o =>
          o.setName("enabled")
            .setDescription("Enabled")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("spam")
        .setDescription("Configure spam")
        .addIntegerOption(o =>
          o.setName("limit")
            .setDescription("Messages")
            .setMinValue(2)
            .setMaxValue(30)
            .setRequired(true)
        )
        .addIntegerOption(o =>
          o.setName("window")
            .setDescription("Seconds")
            .setMinValue(1)
            .setMaxValue(60)
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("mentions")
        .setDescription("Configure mass mentions")
        .addIntegerOption(o =>
          o.setName("limit")
            .setDescription("Limit")
            .setMinValue(2)
            .setMaxValue(50)
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("caps")
        .setDescription("Configure caps")
        .addIntegerOption(o =>
          o.setName("percent")
            .setDescription("Percentage")
            .setMinValue(50)
            .setMaxValue(100)
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("badwords")
        .setDescription("Enable bad words")
        .addBooleanOption(o =>
          o.setName("enabled")
            .setDescription("Enabled")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("addword")
        .setDescription("Add blocked word")
        .addStringOption(o =>
          o.setName("word")
            .setDescription("Word")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("removeword")
        .setDescription("Remove blocked word")
        .addStringOption(o =>
          o.setName("word")
            .setDescription("Word")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("log")
        .setDescription("Set AutoMod log")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Channel")
            .setRequired(true)
        )
    );

commands.push(automodCmd);

/* SECURITY */

const securityCmd =
  new SlashCommandBuilder()
    .setName("security")
    .setDescription(
      "Configure Security"
    )
    .addSubcommand(s =>
      s.setName("enable")
        .setDescription("Enable")
    )
    .addSubcommand(s =>
      s.setName("disable")
        .setDescription("Disable")
    )
    .addSubcommand(s =>
      s.setName("status")
        .setDescription("Status")
    )
    .addSubcommand(s =>
      s.setName("antiraid")
        .setDescription("Anti-Raid")
        .addBooleanOption(o =>
          o.setName("enabled")
            .setDescription("Enabled")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("antinuke")
        .setDescription("Anti-Nuke")
        .addBooleanOption(o =>
          o.setName("enabled")
            .setDescription("Enabled")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("raidlimit")
        .setDescription("Raid limit")
        .addIntegerOption(o =>
          o.setName("limit")
            .setDescription("Limit")
            .setMinValue(2)
            .setMaxValue(100)
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("nukelimit")
        .setDescription("Nuke limit")
        .addIntegerOption(o =>
          o.setName("limit")
            .setDescription("Limit")
            .setMinValue(2)
            .setMaxValue(50)
            .setRequired(true)
        )
    );

commands.push(securityCmd);

/* ROLE PROTECTOR */

const roleProtectorCmd =
  new SlashCommandBuilder()
    .setName("roleprotector")
    .setDescription(
      "Configure Role Protector"
    )
    .addSubcommand(s =>
      s.setName("enable")
        .setDescription("Enable")
    )
    .addSubcommand(s =>
      s.setName("disable")
        .setDescription("Disable")
    )
    .addSubcommand(s =>
      s.setName("status")
        .setDescription("Status")
    )
    .addSubcommand(s =>
      s.setName("protect")
        .setDescription("Protect role")
        .addRoleOption(o =>
          o.setName("role")
            .setDescription("Role")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("unprotect")
        .setDescription("Unprotect role")
        .addRoleOption(o =>
          o.setName("role")
            .setDescription("Role")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("everyone")
        .setDescription(
          "Protect @everyone"
        )
        .addBooleanOption(o =>
          o.setName("enabled")
            .setDescription("Enabled")
            .setRequired(true)
        )
    );

commands.push(roleProtectorCmd);

/* AUTOTIMEOUT */

const autoTimeoutCmd =
  new SlashCommandBuilder()
    .setName("autotimeout")
    .setDescription(
      "Configure AutoTimeout"
    )
    .addSubcommand(s =>
      s.setName("enable")
        .setDescription("Enable")
    )
    .addSubcommand(s =>
      s.setName("disable")
        .setDescription("Disable")
    )
    .addSubcommand(s =>
      s.setName("status")
        .setDescription("Status")
    )
    .addSubcommand(s =>
      s.setName("duration")
        .setDescription("Set duration")
        .addIntegerOption(o =>
          o.setName("minutes")
            .setDescription("Minutes")
            .setMinValue(1)
            .setMaxValue(40320)
            .setRequired(true)
        )
    );

commands.push(autoTimeoutCmd);

/* TICKETS */

const ticketCmd =
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription(
      "Ticket system"
    )
    .addSubcommand(s =>
      s.setName("panel")
        .setDescription("Create ticket panel")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Channel")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("close")
        .setDescription("Close current ticket")
    )
    .addSubcommand(s =>
      s.setName("info")
        .setDescription("Ticket information")
        .addStringOption(o =>
          o.setName("id")
            .setDescription("Ticket ID")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("reply")
        .setDescription("Reply to ticket")
        .addStringOption(o =>
          o.setName("id")
            .setDescription("Ticket ID")
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName("message")
            .setDescription("Message")
            .setRequired(true)
        )
    );

commands.push(ticketCmd);

/* SUGGEST */

commands.push(
  new SlashCommandBuilder()
    .setName("suggest")
    .setDescription(
      "Submit a suggestion"
    )
    .addStringOption(o =>
      o.setName("text")
        .setDescription("Suggestion")
        .setRequired(true)
    )
);

/* ANNOUNCEMENT */

commands.push(
  new SlashCommandBuilder()
    .setName("announce")
    .setDescription(
      "Send an announcement"
    )
    .addStringOption(o =>
      o.setName("title")
        .setDescription("Title")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("message")
        .setDescription("Message")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("image")
        .setDescription("Image URL")
    )
    .addStringOption(o =>
      o.setName("mention")
        .setDescription("Mention text")
    )
);

/* ANNOUNCEMENT CONFIG */

commands.push(
  new SlashCommandBuilder()
    .setName("announcement")
    .setDescription(
      "Configure announcements"
    )
    .addSubcommand(s =>
      s.setName("add-channel")
        .setDescription("Add channel")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Channel")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("remove-channel")
        .setDescription("Remove channel")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Channel")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("list-channels")
        .setDescription("List channels")
    )
    .addSubcommand(s =>
      s.setName("add-role")
        .setDescription("Add mention role")
        .addRoleOption(o =>
          o.setName("role")
            .setDescription("Role")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("remove-role")
        .setDescription("Remove mention role")
        .addRoleOption(o =>
          o.setName("role")
            .setDescription("Role")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("list-roles")
        .setDescription("List roles")
    )
);

/* TRUSTED */

commands.push(
  new SlashCommandBuilder()
    .setName("trusted")
    .setDescription(
      "Trusted security system"
    )
    .addSubcommand(s =>
      s.setName("user-add")
        .setDescription("Trust user")
        .addUserOption(o =>
          o.setName("user")
            .setDescription("User")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("user-remove")
        .setDescription("Remove trusted user")
        .addUserOption(o =>
          o.setName("user")
            .setDescription("User")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("bot-add")
        .setDescription("Trust bot")
        .addUserOption(o =>
          o.setName("bot")
            .setDescription("Bot")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("bot-remove")
        .setDescription("Remove trusted bot")
        .addUserOption(o =>
          o.setName("bot")
            .setDescription("Bot")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("list")
        .setDescription("List trusted accounts")
    )
);

/* LOGS */

commands.push(
  new SlashCommandBuilder()
    .setName("logs")
    .setDescription(
      "Configure log channels"
    )
    .addSubcommand(s =>
      s.setName("status")
        .setDescription("View logs")
    )
    .addSubcommand(s =>
      s.setName("automod")
        .setDescription("Set AutoMod log")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Channel")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("security")
        .setDescription("Set security log")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Channel")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("audit")
        .setDescription("Set audit log")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Channel")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("moderation")
        .setDescription("Set moderation log")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Channel")
            .setRequired(true)
        )
    )
);

/* CONFIG */

commands.push(
  new SlashCommandBuilder()
    .setName("config")
    .setDescription(
      "Complete configuration"
    )
    .addSubcommand(s =>
      s.setName("status")
        .setDescription("View configuration")
    )
    .addSubcommand(s =>
      s.setName("reset")
        .setDescription("Reset configuration")
    )
);

/* =========================================================
   COMMAND HANDLER
========================================================= */

client.on(
  Events.InteractionCreate,
  async interaction => {

    try {

      /* BUTTONS */

      if (interaction.isButton()) {

        if (
          interaction.customId ===
          "ticket_create"
        ) {
          const result =
            await createDMTicket(
              interaction.user
            );

          return interaction.reply({
            content:
              result.existing
                ? `🎫 You already have **${result.ticket.id}**.`
                : `🎫 Ticket **${result.ticket.id}** created. Check your DMs.`,
            ephemeral: true
          });
        }

        if (
          interaction.customId.startsWith(
            "ticket_"
          )
        ) {
          return handleTicketButton(
            interaction
          );
        }

        if (
          interaction.customId.startsWith(
            "suggest_approve:"
          )
        ) {
          return reviewSuggestion(
            interaction,
            true
          );
        }

        if (
          interaction.customId.startsWith(
            "suggest_decline:"
          )
        ) {
          return reviewSuggestion(
            interaction,
            false
          );
        }

        return;
      }

      if (
        !interaction.isChatInputCommand()
      ) {
        return;
      }

      if (
        !interaction.guild
      ) {
        return interaction.reply({
          content:
            "❌ This command must be used in a server.",
          ephemeral: true
        });
      }

      const data =
        getGuildData(
          interaction.guild.id
        );

      const name =
        interaction.commandName;

      const staffOnly = [
        "warn",
        "warnings",
        "punishments",
        "timeout",
        "kick",
        "ban",
        "unban",
        "automod",
        "security",
        "roleprotector",
        "autotimeout",
        "ticket",
        "announcement",
        "announce",
        "trusted",
        "logs",
        "config"
      ];

      if (
        staffOnly.includes(name) &&
        !requireStaff(interaction)
      ) {
        return interaction.reply({
          content:
            "❌ You need Support Staff/Admin permission.",
          ephemeral: true
        });
      }

      /* HELP */

      if (name === "help") {

        return interaction.reply({
          embeds: [
            embed(
              "🤖 Complete Bot Commands",
              [
                "**🎫 Tickets**",
                "`/ticket panel` `/ticket close` `/ticket info` `/ticket reply`",
                "",
                "**🛡️ AutoMod**",
                "`/automod enable` `/automod disable` `/automod status`",
                "`/automod invites` `/automod spam` `/automod mentions`",
                "`/automod caps` `/automod badwords` `/automod addword` `/automod removeword` `/automod log`",
                "",
                "**⏱️ AutoTimeout**",
                "`/autotimeout enable` `/autotimeout disable` `/autotimeout status` `/autotimeout duration`",
                "",
                "**🔐 Security**",
                "`/security enable` `/security disable` `/security status`",
                "`/security antiraid` `/security antinuke` `/security raidlimit` `/security nukelimit`",
                "",
                "**🛡️ Role Protector**",
                "`/roleprotector enable` `/roleprotector disable` `/roleprotector status`",
                "`/roleprotector protect` `/roleprotector unprotect` `/roleprotector everyone`",
                "",
                "**⚠️ Moderation**",
                "`/warn` `/warnings` `/punishments` `/timeout` `/kick` `/ban` `/unban`",
                "",
                "**💡 Suggestions**",
                "`/suggest`",
                "",
                "**📢 Announcements**",
                "`/announce` `/announcement`",
                "",
                "**🔒 Trusted Security**",
                "`/trusted`",
                "",
                "**📋 Logging**",
                "`/logs`",
                "",
                "**⚙️ Configuration**",
                "`/config status` `/config reset`",
                "",
                "**📊 Statistics**",
                "`/stats`"
              ].join("\n"),
              0x5865f2
            )
          ],
          ephemeral: true
        });
      }

      /* STATS */

      if (name === "stats") {

        return interaction.reply({
          embeds: [
            embed(
              "📊 Bot Statistics",
              [
                `Servers: ${client.guilds.cache.size}`,
                `Users: ${client.users.cache.size}`,
                `Tickets: ${data.statistics.tickets}`,
                `Suggestions: ${data.statistics.suggestions}`,
                `Warnings: ${data.statistics.warnings}`,
                `Punishments: ${data.statistics.punishments}`,
                `AutoMod Actions: ${data.statistics.automod}`,
                `Security Events: ${data.statistics.securityEvents}`
              ].join("\n")
            )
          ]
        });
      }

      /* WARN */

      if (name === "warn") {

        const user =
          interaction.options.getUser(
            "user",
            true
          );

        const reason =
          interaction.options.getString(
            "reason",
            true
          );

        const member =
          await interaction.guild.members
            .fetch(user.id)
            .catch(() => null);

        const record =
          addWarning(
            interaction.guild.id,
            user.id,
            reason,
            interaction.user.id
          );

        let escalation = null;

        if (member) {
          escalation =
            await warningEscalation(
              member,
              getWarnings(
                interaction.guild.id,
                user.id
              ).length
            );
        }

        await user.send({
          embeds: [
            embed(
              "⚠️ Warning",
              [
                `**Server:** ${interaction.guild.name}`,
                `**Reason:** ${reason}`,
                `**Warnings:** ${getWarnings(
                  interaction.guild.id,
                  user.id
                ).length}`
              ].join("\n"),
              0xfee75c
            )
          ]
        }).catch(() => {});

        await interaction.reply({
          embeds: [
            embed(
              "⚠️ Warning Issued",
              [
                `**User:** ${user}`,
                `**Reason:** ${reason}`,
                `**Warning ID:** ${record.id}`,
                escalation
                  ? `**Escalation:** ${escalation}`
                  : ""
              ].filter(Boolean).join("\n"),
              0xfee75c
            )
          ]
        });

        await sendLog(
          interaction.guild,
          "moderation",
          "⚠️ Warning",
          [
            `**User:** ${user}`,
            `**Moderator:** ${interaction.user}`,
            `**Reason:** ${reason}`
          ].join("\n"),
          0xfee75c
        );

        return;
      }

      /* WARNINGS */

      if (name === "warnings") {

        const user =
          interaction.options.getUser(
            "user",
            true
          );

        const list =
          getWarnings(
            interaction.guild.id,
            user.id
          );

        return interaction.reply({
          embeds: [
            embed(
              `⚠️ Warnings — ${user.tag}`,
              list.length
                ? list.map(
                    (w, i) =>
                      `**${i + 1}.** ${w.reason}\nModerator: <@${w.moderatorId}>\n<t:${Math.floor(w.timestamp / 1000)}:R>`
                  ).join("\n\n")
                : "No warnings found.",
              0xfee75c
            )
          ],
          ephemeral: true
        });
      }

      /* PUNISHMENTS */

      if (name === "punishments") {

        const user =
          interaction.options.getUser(
            "user",
            true
          );

        const list =
          getPunishments(
            interaction.guild.id,
            user.id
          );

        return interaction.reply({
          embeds: [
            embed(
              `📋 Punishments — ${user.tag}`,
              list.length
                ? list.slice(-20).reverse()
                    .map(
                      p =>
                        `**${p.type.toUpperCase()}** — ${p.reason}\nModerator: <@${p.moderatorId}>\n<t:${Math.floor(p.timestamp / 1000)}:R>`
                    ).join("\n\n")
                : "No punishment history found.",
              0x5865f2
            )
          ],
          ephemeral: true
        });
      }

      /* TIMEOUT */

      if (name === "timeout") {

        const user =
          interaction.options.getUser(
            "user",
            true
          );

        const minutes =
          interaction.options.getInteger(
            "minutes",
            true
          );

        const reason =
          interaction.options.getString(
            "reason"
          ) ||
          "No reason provided";

        const member =
          await interaction.guild.members
            .fetch(user.id)
            .catch(() => null);

        if (
          !member ||
          !member.moderatable
        ) {
          return interaction.reply({
            content:
              "❌ I cannot timeout this member.",
            ephemeral: true
          });
        }

        await timeoutMember(
          member,
          minutes,
          reason
        );

        addPunishment(
          interaction.guild.id,
          user.id,
          "timeout",
          reason,
          interaction.user.id
        );

        return interaction.reply({
          content:
            `⏱️ ${user.tag} timed out for ${minutes} minute(s).`
        });
      }

      /* KICK */

      if (name === "kick") {

        const user =
          interaction.options.getUser(
            "user",
            true
          );

        const reason =
          interaction.options.getString(
            "reason"
          ) ||
          "No reason provided";

        const member =
          await interaction.guild.members
            .fetch(user.id)
            .catch(() => null);

        if (
          !member ||
          !member.kickable
        ) {
          return interaction.reply({
            content:
              "❌ I cannot kick this member.",
            ephemeral: true
          });
        }

        await member.kick(reason);

        addPunishment(
          interaction.guild.id,
          user.id,
          "kick",
          reason,
          interaction.user.id
        );

        return interaction.reply({
          content:
            `👢 ${user.tag} has been kicked.`
        });
      }

      /* BAN */

      if (name === "ban") {

        const user =
          interaction.options.getUser(
            "user",
            true
          );

        const reason =
          interaction.options.getString(
            "reason"
          ) ||
          "No reason provided";

        await interaction.guild.members.ban(
          user.id,
          { reason }
        );

        addPunishment(
          interaction.guild.id,
          user.id,
          "ban",
          reason,
          interaction.user.id
        );

        return interaction.reply({
          content:
            `🔨 ${user.tag} has been banned.`
        });
      }

      /* UNBAN */

      if (name === "unban") {

        const id =
          interaction.options.getString(
            "userid",
            true
          );

        const reason =
          interaction.options.getString(
            "reason"
          ) ||
          "No reason provided";

        await interaction.guild.members.unban(
          id,
          reason
        );

        addPunishment(
          interaction.guild.id,
          id,
          "unban",
          reason,
          interaction.user.id
        );

        return interaction.reply({
          content:
            `🔓 ${id} has been unbanned.`
        });
      }

      /* AUTOMOD */

      if (name === "automod") {

        const sub =
          interaction.options.getSubcommand();

        if (sub === "enable")
          data.automod.enabled = true;

        if (sub === "disable")
          data.automod.enabled = false;

        if (sub === "invites")
          data.automod.invites =
            interaction.options.getBoolean(
              "enabled",
              true
            );

        if (sub === "spam") {
          data.automod.spamLimit =
            interaction.options.getInteger(
              "limit",
              true
            );

          data.automod.spamWindow =
            interaction.options.getInteger(
              "window",
              true
            ) * 1000;
        }

        if (sub === "mentions")
          data.automod.mentionLimit =
            interaction.options.getInteger(
              "limit",
              true
            );

        if (sub === "caps")
          data.automod.capsPercent =
            interaction.options.getInteger(
              "percent",
              true
            );

        if (sub === "badwords")
          data.automod.badwords =
            interaction.options.getBoolean(
              "enabled",
              true
            );

        if (sub === "addword") {
          const word =
            interaction.options
              .getString(
                "word",
                true
              )
              .toLowerCase();

          if (
            !data.automod.badWords.includes(
              word
            )
          ) {
            data.automod.badWords.push(
              word
            );
          }
        }

        if (sub === "removeword") {
          const word =
            interaction.options
              .getString(
                "word",
                true
              )
              .toLowerCase();

          data.automod.badWords =
            data.automod.badWords.filter(
              w => w !== word
            );
        }

        if (sub === "log") {
          const channel =
            interaction.options.getChannel(
              "channel",
              true
            );

          data.logs.automod =
            channel.id;
        }

        saveDB();

        if (sub === "status") {
          return interaction.reply({
            embeds: [
              embed(
                "🛡️ AutoMod Status",
                [
                  `Enabled: ${data.automod.enabled ? "🟢" : "🔴"}`,
                  `Invites: ${data.automod.invites ? "🟢" : "🔴"}`,
                  `Spam: ${data.automod.spam ? "🟢" : "🔴"}`,
                  `Mentions: ${data.automod.mentions ? "🟢" : "🔴"}`,
                  `Caps: ${data.automod.caps ? "🟢" : "🔴"}`,
                  `Bad Words: ${data.automod.badwords ? "🟢" : "🔴"}`,
                  `Repeated: ${data.automod.repeated ? "🟢" : "🔴"}`,
                  `Log: ${data.logs.automod ? `<#${data.logs.automod}>` : "None"}`
                ].join("\n")
              )
            ],
            ephemeral: true
          });
        }

        return interaction.reply({
          content:
            "✅ AutoMod updated.",
          ephemeral: true
        });
      }

      /* SECURITY */

      if (name === "security") {

        const sub =
          interaction.options.getSubcommand();

        if (sub === "enable")
          data.security.enabled = true;

        if (sub === "disable")
          data.security.enabled = false;

        if (sub === "antiraid")
          data.security.antiRaid =
            interaction.options.getBoolean(
              "enabled",
              true
            );

        if (sub === "antinuke")
          data.security.antiNuke =
            interaction.options.getBoolean(
              "enabled",
              true
            );

        if (sub === "raidlimit")
          data.security.raidLimit =
            interaction.options.getInteger(
              "limit",
              true
            );

        if (sub === "nukelimit")
          data.security.nukeLimit =
            interaction.options.getInteger(
              "limit",
              true
            );

        saveDB();

        if (sub === "status") {
          return interaction.reply({
            embeds: [
              embed(
                "🔐 Security Status",
                [
                  `Enabled: ${data.security.enabled ? "🟢" : "🔴"}`,
                  `Anti-Raid: ${data.security.antiRaid ? "🟢" : "🔴"}`,
                  `Anti-Nuke: ${data.security.antiNuke ? "🟢" : "🔴"}`,
                  `Raid Limit: ${data.security.raidLimit}`,
                  `Nuke Limit: ${data.security.nukeLimit}`,
                  `Lockdown: ${data.security.lockdown ? "🔴" : "🟢"}`
                ].join("\n")
              )
            ],
            ephemeral: true
          });
        }

        return interaction.reply({
          content:
            "✅ Security updated.",
          ephemeral: true
        });
      }

      /* ROLE PROTECTOR */

      if (
        name === "roleprotector"
      ) {

        const sub =
          interaction.options.getSubcommand();

        if (sub === "enable")
          data.roleProtection.enabled =
            true;

        if (sub === "disable")
          data.roleProtection.enabled =
            false;

        if (sub === "everyone")
          data.roleProtection.protectEveryone =
            interaction.options.getBoolean(
              "enabled",
              true
            );

        if (
          sub === "protect" ||
          sub === "unprotect"
        ) {
          const role =
            interaction.options.getRole(
              "role",
              true
            );

          if (
            sub === "protect"
          ) {
            if (
              !data.roleProtection.protectedRoles
                .includes(role.id)
            ) {
              data.roleProtection.protectedRoles
                .push(role.id);
            }
          } else {
            data.roleProtection
              .protectedRoles =
              data.roleProtection
                .protectedRoles.filter(
                  id => id !== role.id
                );
          }
        }

        saveDB();

        if (sub === "status") {
          return interaction.reply({
            embeds: [
              embed(
                "🛡️ Role Protector",
                [
                  `Enabled: ${data.roleProtection.enabled ? "🟢" : "🔴"}`,
                  `@everyone: ${data.roleProtection.protectEveryone ? "🟢" : "🔴"}`,
                  `Protected Roles: ${data.roleProtection.protectedRoles.length}`,
                  `Unauthorized punishment: ${data.roleProtection.timeoutMinutes} hour`
                ].join("\n")
              )
            ],
            ephemeral: true
          });
        }

        return interaction.reply({
          content:
            "✅ Role Protector updated.",
          ephemeral: true
        });
      }

      /* AUTOTIMEOUT */

      if (
        name === "autotimeout"
      ) {

        const sub =
          interaction.options.getSubcommand();

        if (sub === "enable")
          data.autotimeout.enabled =
            true;

        if (sub === "disable")
          data.autotimeout.enabled =
            false;

        if (sub === "duration")
          data.autotimeout.duration =
            interaction.options.getInteger(
              "minutes",
              true
            );

        saveDB();

        if (sub === "status") {
          return interaction.reply({
            embeds: [
              embed(
                "⏱️ AutoTimeout",
                [
                  `Enabled: ${data.autotimeout.enabled ? "🟢" : "🔴"}`,
                  `Duration: ${data.autotimeout.duration} minutes`,
                  "Triggers: spam, invites, mentions, bad words, caps and repeated messages"
                ].join("\n")
              )
            ],
            ephemeral: true
          });
        }

        return interaction.reply({
          content:
            "✅ AutoTimeout updated.",
          ephemeral: true
        });
      }

      /* TICKETS */

      if (name === "ticket") {

        const sub =
          interaction.options.getSubcommand();

        if (sub === "panel") {
          const channel =
            interaction.options.getChannel(
              "channel",
              true
            );

          await createTicketPanel(
            channel
          );

          data.tickets.panelChannelId =
            channel.id;

          saveDB();

          return interaction.reply({
            content:
              `🎫 Ticket panel created in ${channel}.`,
            ephemeral: true
          });
        }

        if (sub === "close") {

          const ticket =
            Object.values(
              data.tickets.records
            ).find(
              t =>
                t.channelId ===
                  interaction.channel.id &&
                t.status === "open"
            );

          if (!ticket) {
            return interaction.reply({
              content:
                "❌ This isn't an open ticket.",
              ephemeral: true
            });
          }

          await closeTicket(
            interaction.guild,
            ticket,
            interaction.user.id
          );

          return interaction.reply({
            content:
              "🔒 Ticket closed.",
            ephemeral: true
          });
        }

        if (sub === "info") {

          const id =
            interaction.options.getString(
              "id",
              true
            );

          const ticket =
            data.tickets.records[id];

          if (!ticket) {
            return interaction.reply({
              content:
                "❌ Ticket not found.",
              ephemeral: true
            });
          }

          return interaction.reply({
            embeds: [
              embed(
                `🎫 ${ticket.id}`,
                [
                  `User: <@${ticket.userId}>`,
                  `Channel: <#${ticket.channelId}>`,
                  `Status: ${ticket.status}`,
                  `Claimed: ${ticket.claimedBy ? `<@${ticket.claimedBy}>` : "No"}`,
                  `Created: <t:${Math.floor(ticket.createdAt / 1000)}:F>`
                ].join("\n")
              )
            ],
            ephemeral: true
          });
        }

        if (sub === "reply") {

          const id =
            interaction.options.getString(
              "id",
              true
            );

          const message =
            interaction.options.getString(
              "message",
              true
            );

          const ticket =
            data.tickets.records[id];

          if (!ticket) {
            return interaction.reply({
              content:
                "❌ Ticket not found.",
              ephemeral: true
            });
          }

          const user =
            await client.users.fetch(
              ticket.userId
            ).catch(() => null);

          if (!user) {
            return interaction.reply({
              content:
                "❌ User not found.",
              ephemeral: true
            });
          }

          await user.send({
            embeds: [
              embed(
                `💬 Support Reply — ${id}`,
                message,
                0x57f287
              )
            ]
          });

          return interaction.reply({
            content:
              "📩 Reply sent.",
            ephemeral: true
          });
        }
      }

      /* SUGGEST */

      if (name === "suggest") {
        return submitSuggestion(
          interaction
        );
      }

      /* ANNOUNCE */

      if (name === "announce") {
        return announcement(
          interaction
        );
      }

      /* ANNOUNCEMENT CONFIG */

      if (
        name === "announcement"
      ) {

        const sub =
          interaction.options.getSubcommand();

        if (
          sub === "add-channel" ||
          sub === "remove-channel"
        ) {
          const channel =
            interaction.options.getChannel(
              "channel",
              true
            );

          if (
            sub === "add-channel"
          ) {
            if (
              !data.announcements.channels
                .includes(channel.id)
            ) {
              data.announcements.channels
                .push(channel.id);
            }
          } else {
            data.announcements.channels =
              data.announcements.channels
                .filter(
                  id =>
                    id !== channel.id
                );
          }
        }

        if (
          sub === "list-channels"
        ) {
          return interaction.reply({
            content:
              data.announcements.channels.length
                ? data.announcements.channels
                    .map(id => `<#${id}>`)
                    .join("\n")
                : "No channels configured.",
            ephemeral: true
          });
        }

        if (
          sub === "add-role" ||
          sub === "remove-role"
        ) {
          const role =
            interaction.options.getRole(
              "role",
              true
            );

          if (
            sub === "add-role"
          ) {
            if (
              !data.announcements.roles
                .includes(role.id)
            ) {
              data.announcements.roles
                .push(role.id);
            }
          } else {
            data.announcements.roles =
              data.announcements.roles
                .filter(
                  id =>
                    id !== role.id
                );
          }
        }

        if (
          sub === "list-roles"
        ) {
          return interaction.reply({
            content:
              data.announcements.roles.length
                ? data.announcements.roles
                    .map(id => `<@&${id}>`)
                    .join("\n")
                : "No roles configured.",
            ephemeral: true
          });
        }

        saveDB();

        return interaction.reply({
          content:
            "✅ Announcement configuration updated.",
          ephemeral: true
        });
      }

      /* TRUSTED */

      if (name === "trusted") {

        const sub =
          interaction.options.getSubcommand();

        if (
          sub === "user-add" ||
          sub === "user-remove"
        ) {
          const user =
            interaction.options.getUser(
              "user",
              true
            );

          if (
            sub === "user-add"
          ) {
            if (
              !data.trusted.users
                .includes(user.id)
            ) {
              data.trusted.users
                .push(user.id);
            }
          } else {
            data.trusted.users =
              data.trusted.users.filter(
                id => id !== user.id
              );
          }
        }

        if (
          sub === "bot-add" ||
          sub === "bot-remove"
        ) {
          const bot =
            interaction.options.getUser(
              "bot",
              true
            );

          if (
            sub === "bot-add"
          ) {
            if (
              !data.trusted.bots
                .includes(bot.id)
            ) {
              data.trusted.bots
                .push(bot.id);
            }
          } else {
            data.trusted.bots =
              data.trusted.bots.filter(
                id => id !== bot.id
              );
          }
        }

        if (sub === "list") {
          return interaction.reply({
            embeds: [
              embed(
                "🔐 Trusted Accounts",
                [
                  "**Users:**",
                  data.trusted.users.length
                    ? data.trusted.users
                        .map(
                          id => `<@${id}>`
                        ).join("\n")
                    : "None",
                  "",
                  "**Bots:**",
                  data.trusted.bots.length
                    ? data.trusted.bots
                        .map(
                          id => `<@${id}>`
                        ).join("\n")
                    : "None"
                ].join("\n")
              )
            ],
            ephemeral: true
          });
        }

        saveDB();

        return interaction.reply({
          content:
            "✅ Trusted list updated.",
          ephemeral: true
        });
      }

      /* LOGS */

      if (name === "logs") {

        const sub =
          interaction.options.getSubcommand();

        if (sub === "status") {
          return interaction.reply({
            embeds: [
              embed(
                "📋 Log Channels",
                Object.entries(
                  data.logs
                )
                  .map(
                    ([key, id]) =>
                      `**${key}:** ${id ? `<#${id}>` : "None"}`
                  )
                  .join("\n")
              )
            ],
            ephemeral: true
          });
        }

        const channel =
          interaction.options.getChannel(
            "channel",
            true
          );

        data.logs[sub] =
          channel.id;

        saveDB();

        return interaction.reply({
          content:
            `✅ ${sub} log channel configured.`,
          ephemeral: true
        });
      }

      /* CONFIG */

      if (name === "config") {

        const sub =
          interaction.options.getSubcommand();

        if (sub === "status") {
          return interaction.reply({
            embeds: [
              embed(
                "⚙️ Complete Configuration",
                [
                  `AutoMod: ${data.automod.enabled ? "🟢" : "🔴"}`,
                  `AutoTimeout: ${data.autotimeout.enabled ? "🟢" : "🔴"}`,
                  `Anti-Raid: ${data.security.antiRaid ? "🟢" : "🔴"}`,
                  `Anti-Nuke: ${data.security.antiNuke ? "🟢" : "🔴"}`,
                  `Role Protector: ${data.roleProtection.enabled ? "🟢" : "🔴"}`,
                  `@everyone Protection: ${data.roleProtection.protectEveryone ? "🟢" : "🔴"}`,
                  `Tickets: 🟢`,
                  `Suggestions: 🟢`,
                  `Trusted Users: ${data.trusted.users.length}`,
                  `Trusted Bots: ${data.trusted.bots.length}`,
                  `Protected Roles: ${data.roleProtection.protectedRoles.length}`
                ].join("\n")
              )
            ],
            ephemeral: true
          });
        }

        if (sub === "reset") {
          db.guilds[
            interaction.guild.id
          ] = defaultGuild();

          saveDB();

          return interaction.reply({
            content:
              "⚠️ Server configuration reset.",
            ephemeral: true
          });
        }
      }

    } catch (err) {

      console.error(
        "Interaction error:",
        err
      );

      if (
        !interaction.replied &&
        !interaction.deferred
      ) {
        await interaction.reply({
          content:
            "❌ An error occurred while processing this command.",
          ephemeral: true
        }).catch(() => {});
      }
    }
  }
);

/* =========================================================
   MESSAGE EVENTS
========================================================= */

client.on(
  Events.MessageCreate,
  async message => {

    try {

      if (!message.guild) {

        if (
          !message.author.bot
        ) {
          await forwardDM(
            message
          );
        }

        return;
      }

      await handleAutoMod(
        message
      );

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
  Events.GuildMemberAdd,
  async member => {
    await handleMemberJoin(
      member
    ).catch(err =>
      console.error(
        "Join handler:",
        err
      )
    );
  }
);

/* =========================================================
   ROLE EVENTS
========================================================= */

client.on(
  Events.GuildRoleUpdate,
  async (
    oldRole,
    newRole
  ) => {
    await handleRoleUpdate(
      oldRole,
      newRole
    ).catch(err =>
      console.error(
        "Role update:",
        err
      )
    );
  }
);

client.on(
  Events.GuildRoleDelete,
  async role => {
    await handleRoleDelete(
      role
    ).catch(err =>
      console.error(
        "Role delete:",
        err
      )
    );
  }
);

/* =========================================================
   CHANNEL EVENTS
========================================================= */

client.on(
  Events.ChannelDelete,
  async channel => {
    await handleChannelDelete(
      channel
    ).catch(err =>
      console.error(
        "Channel delete:",
        err
      )
    );
  }
);

/* =========================================================
   MESSAGE LOGS
========================================================= */

client.on(
  Events.MessageDelete,
  async message => {

    if (!message.guild) return;

    await sendLog(
      message.guild,
      "messages",
      "🗑️ Message Deleted",
      [
        `**Channel:** ${message.channel}`,
        `**Author:** ${message.author || "Unknown"}`,
        `**Content:** ${shorten(
          message.content,
          1000
        ) || "Unknown"}`
      ].join("\n"),
      0xed4245
    );
  }
);

/* =========================================================
   MEMBER LEAVE
========================================================= */

client.on(
  Events.GuildMemberRemove,
  async member => {

    await sendLog(
      member.guild,
      "members",
      "👋 Member Left",
      [
        `**User:** ${member.user.tag}`,
        `**ID:** ${member.id}`
      ].join("\n"),
      0xed4245
    );
  }
);

/* =========================================================
   BAN LOGS
========================================================= */

client.on(
  Events.GuildBanAdd,
  async ban => {

    await sendLog(
      ban.guild,
      "moderation",
      "🔨 Member Banned",
      `**User:** ${ban.user.tag}\n**ID:** ${ban.user.id}`,
      0xed4245
    );
  }
);

client.on(
  Events.GuildBanRemove,
  async ban => {

    await sendLog(
      ban.guild,
      "moderation",
      "🔓 Member Unbanned",
      `**User:** ${ban.user.tag}\n**ID:** ${ban.user.id}`,
      0x57f287
    );
  }
);

/* =========================================================
   READY
========================================================= */

client.once(
  Events.ClientReady,
  async ready => {

    console.log(
      `✅ Logged in as ${ready.user.tag}`
    );

    console.log(
      `📡 Connected to ${ready.guilds.cache.size} server(s)`
    );

    console.log(
      `📋 Registering ${commands.length} slash commands...`
    );

    try {

      const guild =
        await client.guilds.fetch(
          SERVER_ID
        );

      await guild.commands.set(
        commands.map(
          command =>
            command.toJSON()
        )
      );

      console.log(
        `✅ ${commands.length} slash commands registered in ${guild.name}`
      );

    } catch (err) {

      console.error(
        "❌ Slash command registration error:",
        err
      );
    }

    client.user.setPresence({
      activities: [
        {
          name:
            "🛡️ Server Protection",
          type:
            ActivityType.Watching
        }
      ],
      status: "online"
    });

    console.log(
      "🎫 DM Ticket System: ONLINE"
    );

    console.log(
      "🛡️ Advanced AutoMod: ONLINE"
    );

    console.log(
      "⏱️ AutoTimeout: ONLINE"
    );

    console.log(
      "🔐 Anti-Raid: ONLINE"
    );

    console.log(
      "☢️ Anti-Nuke: ONLINE"
    );

    console.log(
      "🛡️ Role Protector: ONLINE"
    );

    console.log(
      "📢 Announcement System: ONLINE"
    );

    console.log(
      "💡 Suggestion System: ONLINE"
    );

    console.log(
      "📋 Logging System: ONLINE"
    );

    console.log(
      "💾 Persistent Database: ONLINE"
    );
  }
);

/* =========================================================
   AUTOSAVE
========================================================= */

setInterval(
  saveDB,
  30000
);

/* =========================================================
   ERROR HANDLING
========================================================= */

client.on(
  Events.Error,
  error => {
    console.error(
      "Discord Client Error:",
      error
    );
  }
);

client.on(
  Events.Warn,
  warning => {
    console.warn(
      "Discord Warning:",
      warning
    );
  }
);

/* =========================================================
   LOGIN
========================================================= */

client.login(
  TOKEN
).catch(err => {

  console.error(
    "❌ Discord login failed:",
    err
  );

  process.exit(1);
});
