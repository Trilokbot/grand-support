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
   AKIYO DISCORD BOT
   Multi-server edition
   Node.js 22
   discord.js 14.27.0
========================================================= */

/* =========================
   ENVIRONMENT
========================= */

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN || !CLIENT_ID) {
  console.error("❌ Missing DISCORD_TOKEN or CLIENT_ID.");
  process.exit(1);
}

/* =========================
   WEB SERVER
   Required by some hosts
========================= */

const PORT = Number(process.env.PORT) || 10000;

http
  .createServer((req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/plain"
    });

    res.end("AKIYO BOT ONLINE");
  })
  .listen(PORT, "0.0.0.0");

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

/* =========================================================
   DATABASE
========================================================= */

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "config.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const LOG_TYPES = [
  "automod",
  "audit",
  "security",
  "suggestion",
  "moderation",
  "members",
  "messages",
  "channels",
  "roles",
  "tickets",
  "verification",
  "reactionRoles",
  "welcome",
  "leaderboard",
  "announcements",
  "config"
];

function createDefaultGuild() {
  return {
    automod: {
      enabled: true,

      spamLimit: 6,
      spamWindow: 5000,

      repeatedLimit: 3,
      repeatedWindow: 30000,

      capsPercent: 75,

      badWords: [],

      invite: true,
      massMentions: true,

      userMentionsLimit: 5,
      roleMentionsLimit: 5,

      actions: {
        spam: "timeout",
        invite: "delete",
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
      massChannelCreate: 5,

      massRoleDelete: 3,
      massRoleCreate: 5,

      action: "alert",

      trustedUsers: [],
      trustedBots: [],

      trustedMembers: [],
      trustedRoleId: null,

      protectedRoles: [],
      protectedChannels: []
    },

    logs: Object.fromEntries(
      LOG_TYPES.map(type => [type, null])
    ),

    tickets: {
      categoryId: null,
      supportRoleId: null,
      enabled: true
    },

    suggestions: {
      channelId: null
    },

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
      message: "AkiyO announcement."
    },

    warnings: {},
    punishments: {},

    ticketsData: {}
  };
}

let db = {
  guilds: {},
  dmTickets: {}
};

try {
  if (fs.existsSync(DATA_FILE)) {
    const loaded = JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8")
    );

    if (loaded && typeof loaded === "object") {
      db = {
        guilds: loaded.guilds || {},
        dmTickets: loaded.dmTickets || {}
      };
    }
  }
} catch (err) {
  console.error("❌ Database load error:", err.message);
}

function getGuildConfig(guildId) {
  if (!db.guilds[guildId]) {
    db.guilds[guildId] = createDefaultGuild();
    save();
  }

  return db.guilds[guildId];
}

function save() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(db, null, 2)
    );
  } catch (err) {
    console.error("❌ Database save error:", err.message);
  }
}

/* =========================================================
   MEMORY
========================================================= */

const spamTracker = new Map();
const repeatTracker = new Map();
const securityTracker = new Map();
const ticketClaims = new Map();

/* =========================================================
   HELPERS
========================================================= */

function field(name, value, inline = false) {
  return {
    name: String(name).slice(0, 256),
    value: String(value || "-").slice(0, 1024),
    inline
  };
}

function isManager(member) {
  if (!member) return false;

  return (
    member.permissions.has(
      PermissionFlagsBits.Administrator
    ) ||
    member.permissions.has(
      PermissionFlagsBits.ManageGuild
    )
  );
}

function isStaff(member) {
  if (!member || !member.guild) return false;

  const cfg = getGuildConfig(member.guild.id);

  return (
    member.permissions.has(
      PermissionFlagsBits.Administrator
    ) ||
    (
      cfg.tickets.supportRoleId &&
      member.roles.cache.has(
        cfg.tickets.supportRoleId
      )
    )
  );
}

function isOwner(userId) {
  const owners = String(
    process.env.BOT_OWNER_IDS || ""
  )
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);

  if (owners.includes(userId)) return true;

  const owner = client.application?.owner;

  if (owner?.id === userId) return true;

  if (owner?.members?.has(userId)) {
    return true;
  }

  return false;
}

function isTrusted(guild, userId) {
  const cfg = getGuildConfig(guild.id);
  const member = guild.members.cache.get(userId);

  if (
    member?.permissions.has(
      PermissionFlagsBits.Administrator
    )
  ) {
    return true;
  }

  if (cfg.security.trustedUsers.includes(userId)) {
    return true;
  }

  if (cfg.security.trustedBots.includes(userId)) {
    return true;
  }

  if (cfg.security.trustedMembers.includes(userId)) {
    return true;
  }

  if (
    cfg.security.trustedRoleId &&
    member?.roles.cache.has(
      cfg.security.trustedRoleId
    )
  ) {
    return true;
  }

  return false;
}

async function getLogChannel(guild, type) {
  const cfg = getGuildConfig(guild.id);

  const channelId = cfg.logs[type];

  if (!channelId) return null;

  return guild.channels
    .fetch(channelId)
    .catch(() => null);
}

async function sendLog(
  guild,
  type,
  title,
  fields = [],
  color
) {
  const channel = await getLogChannel(
    guild,
    type
  );

  if (!channel || !channel.isTextBased()) {
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setTimestamp();

  if (color) {
    embed.setColor(color);
  }

  if (fields.length) {
    embed.addFields(
      fields.slice(0, 25)
    );
  }

  await channel
    .send({
      embeds: [embed]
    })
    .catch(() => {});
}

function formatWelcome(message, member) {
  return String(message)
    .replaceAll(
      "{user}",
      member.toString()
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
      String(member.guild.memberCount)
    );
}

function cleanChannelName(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 90) || "ticket";
}

/* =========================================================
   WARNINGS / PUNISHMENTS
========================================================= */

async function addWarning(
  member,
  reason,
  moderatorId
) {
  const guildId = member.guild.id;

  const cfg = getGuildConfig(
    guildId
  );

  cfg.warnings[member.id] ||= [];

  cfg.warnings[member.id].push({
    reason,
    moderatorId,
    time: Date.now()
  });

  cfg.punishments[member.id] ||= [];

  cfg.punishments[member.id].push({
    type: "warn",
    reason,
    moderatorId,
    time: Date.now()
  });

  save();

  return cfg.warnings[member.id].length;
}

async function addPunishment(
  guild,
  userId,
  type,
  reason,
  moderatorId
) {
  const cfg = getGuildConfig(
    guild.id
  );

  cfg.punishments[userId] ||= [];

  cfg.punishments[userId].push({
    type,
    reason,
    moderatorId,
    time: Date.now()
  });

  save();
}

/* =========================================================
   AUTOMOD
========================================================= */

async function runAutoMod(message) {
  if (
    !message.guild ||
    !message.member ||
    message.author.bot
  ) {
    return;
  }

  const cfg = getGuildConfig(
    message.guild.id
  );

  if (!cfg.automod.enabled) {
    return;
  }

  if (isStaff(message.member)) {
    return;
  }

  const content = message.content || "";
  const lower = content.toLowerCase();

  let type = null;
  let reason = null;

  /* INVITE */

  if (
    cfg.automod.invite &&
    /discord(?:\.gg|\.com\/invite)\/[A-Za-z0-9-]+/i.test(
      content
    )
  ) {
    type = "invite";
    reason = "Discord invite link";
  }

  /* MASS MENTIONS */

  else if (
    cfg.automod.massMentions &&
    (
      message.mentions.everyone ||
      message.mentions.users.size >=
        cfg.automod.userMentionsLimit ||
      message.mentions.roles.size >=
        cfg.automod.roleMentionsLimit
    )
  ) {
    type = "massmention";
    reason = "Mass/excessive mentions";
  }

  /* CAPS */

  else {
    const letters = content.replace(
      /[^A-Za-z]/g,
      ""
    );

    if (
      letters.length >= 8
    ) {
      const upper =
        letters.replace(
          /[^A-Z]/g,
          ""
        ).length;

      const percent =
        (upper / letters.length) * 100;

      if (
        percent >=
        cfg.automod.capsPercent
      ) {
        type = "caps";
        reason =
          "Excessive capital letters";
      }
    }

    /* BAD WORDS */

    if (!type) {
      for (
        const word of
        cfg.automod.badWords
      ) {
        if (
          word &&
          lower.includes(
            String(word).toLowerCase()
          )
        ) {
          type = "badword";
          reason =
            `Blocked word: ${word}`;
          break;
        }
      }
    }
  }

  /* SPAM + REPEAT */

  if (!type) {
    const now = Date.now();

    const spamKey =
      `${message.guild.id}:${message.author.id}`;

    let spam =
      spamTracker.get(spamKey) || [];

    spam = spam.filter(
      timestamp =>
        now -
        timestamp <
        cfg.automod.spamWindow
    );

    spam.push(now);

    spamTracker.set(
      spamKey,
      spam
    );

    if (
      spam.length >=
      cfg.automod.spamLimit
    ) {
      type = "spam";

      reason =
        `Spam: ${spam.length} messages in ${cfg.automod.spamWindow / 1000}s`;

      spamTracker.set(
        spamKey,
        []
      );
    }

    const repeatKey =
      `${message.guild.id}:${message.author.id}`;

    const old =
      repeatTracker.get(
        repeatKey
      ) || {
        content: "",
        count: 0,
        time: 0
      };

    if (
      old.content === content &&
      now - old.time <
        cfg.automod.repeatedWindow
    ) {
      old.count++;
    } else {
      old.count = 1;
    }

    old.content = content;
    old.time = now;

    repeatTracker.set(
      repeatKey,
      old
    );

    if (
      !type &&
      old.count >=
        cfg.automod.repeatedLimit
    ) {
      type = "repeat";

      reason =
        `Repeated message ${cfg.automod.repeatedLimit}+ times`;

      repeatTracker.delete(
        repeatKey
      );
    }
  }

  if (!type) {
    return;
  }

  const action =
    cfg.automod.actions[type] ||
    "delete";

  await message.delete()
    .catch(() => {});

  if (
    action === "timeout" &&
    message.member.moderatable
  ) {
    const seconds =
      cfg.automod.timeoutSeconds[type] ||
      60;

    await message.member
      .timeout(
        seconds * 1000,
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

  await sendLog(
    message.guild,
    "automod",
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
        message.channel.toString()
      )
    ],
    0xed4245
  );
}

/* =========================================================
   SECURITY
========================================================= */

async function securityCheck(
  guild,
  event,
  executorId,
  details
) {
  if (!guild || !executorId) {
    return;
  }

  const cfg =
    getGuildConfig(guild.id);

  if (!cfg.security.enabled) {
    return;
  }

  if (
    isTrusted(
      guild,
      executorId
    )
  ) {
    return;
  }

  const key =
    `${guild.id}:${event}:${executorId}`;

  const now = Date.now();

  let entries =
    securityTracker.get(key) ||
    [];

  entries = entries.filter(
    x => now - x < 30000
  );

  entries.push(now);

  securityTracker.set(
    key,
    entries
  );

  const limits = {
    ban: cfg.security.massBan,
    kick: cfg.security.massKick,
    channelDelete:
      cfg.security.massChannelDelete,
    channelCreate:
      cfg.security.massChannelCreate,
    roleDelete:
      cfg.security.massRoleDelete,
    roleCreate:
      cfg.security.massRoleCreate
  };

  const limit =
    limits[event] || 999999;

  if (
    entries.length < limit
  ) {
    return;
  }

  securityTracker.delete(
    key
  );

  await sendLog(
    guild,
    "security",
    "🚨 Anti-Nuke Alert",
    [
      field(
        "Executor",
        `<@${executorId}>`
      ),
      field(
        "Event",
        event
      ),
      field(
        "Count",
        entries.length
      ),
      field(
        "Details",
        details
      ),
      field(
        "Action",
        cfg.security.action
      )
    ],
    0xed4245
  );

  if (
    cfg.security.action ===
    "ban"
  ) {
    const member =
      await guild.members
        .fetch(executorId)
        .catch(() => null);

    if (
      member &&
      member.bannable
    ) {
      await member
        .ban({
          reason:
            `AkiyO Anti-Nuke: ${event}`
        })
        .catch(() => {});
    }
  }
}

/* =========================================================
   AUDIT LOG EXECUTOR
========================================================= */

async function getRecentExecutor(
  guild,
  type,
  targetId
) {
  const logs =
    await guild.fetchAuditLogs({
      type,
      limit: 5
    }).catch(() => null);

  if (!logs) {
    return null;
  }

  const entry =
    logs.entries.find(
      x =>
        (!targetId ||
          x.targetId === targetId) &&
        Date.now() -
          x.createdTimestamp <
          10000
    );

  return entry || null;
}

/* =========================================================
   TICKETS
========================================================= */

function ticketButtons() {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(
          "ticket_claim"
        )
        .setLabel("Claim")
        .setEmoji("🙋")
        .setStyle(
          ButtonStyle.Primary
        ),

      new ButtonBuilder()
        .setCustomId(
          "ticket_close"
        )
        .setLabel("Close")
        .setEmoji("🔒")
        .setStyle(
          ButtonStyle.Danger
        ),

      new ButtonBuilder()
        .setCustomId(
          "ticket_transcript"
        )
        .setLabel("Transcript")
        .setEmoji("📄")
        .setStyle(
          ButtonStyle.Secondary
        ),

      new ButtonBuilder()
        .setCustomId(
          "ticket_lock"
        )
        .setLabel("Lock")
        .setEmoji("🔐")
        .setStyle(
          ButtonStyle.Secondary
        )
    );
}

async function createTicket(
  guild,
  user
) {
  if (!guild) {
    return null;
  }

  const cfg =
    getGuildConfig(
      guild.id
    );

  if (!cfg.tickets.enabled) {
    return null;
  }

  /* Existing ticket */

  const existing =
    cfg.ticketsData[user.id];

  if (existing) {
    const oldChannel =
      await guild.channels
        .fetch(existing.channelId)
        .catch(() => null);

    if (oldChannel) {
      db.dmTickets[user.id] = {
        guildId: guild.id,
        channelId: oldChannel.id
      };

      save();

      return oldChannel;
    }

    delete cfg.ticketsData[user.id];
  }

  let parent = null;

  if (
    cfg.tickets.categoryId
  ) {
    parent =
      await guild.channels
        .fetch(
          cfg.tickets.categoryId
        )
        .catch(() => null);
  }

  const botMember =
    guild.members.me;

  if (!botMember) {
    return null;
  }

  let supportRole = null;

  if (
    cfg.tickets.supportRoleId
  ) {
    supportRole =
      await guild.roles
        .fetch(
          cfg.tickets.supportRoleId
        )
        .catch(() => null);
  }

  const overwrites = [
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
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles
      ]
    },

    {
      id: botMember.id,

      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ManageChannels
      ]
    }
  ];

  if (supportRole) {
    overwrites.push({
      id: supportRole.id,

      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles
      ]
    });
  }

  const channel =
    await guild.channels.create({
      name:
        `ticket-${cleanChannelName(user.username).slice(0, 15)}`,

      type:
        ChannelType.GuildText,

      parent:
        parent?.type ===
        ChannelType.GuildCategory
          ? parent.id
          : undefined,

      topic:
        `AKIYO_TICKET:${user.id}:${guild.id}`,

      permissionOverwrites:
        overwrites
    });

  cfg.ticketsData[user.id] = {
    channelId: channel.id,
    userId: user.id,
    createdAt: Date.now(),
    closed: false
  };

  db.dmTickets[user.id] = {
    guildId: guild.id,
    channelId: channel.id
  };

  save();

  const mention =
    supportRole
      ? `<@&${supportRole.id}>`
      : "";

  await channel.send({
    content: mention,

    embeds: [
      new EmbedBuilder()
        .setTitle(
          "🎫 New AkiyO Support Ticket"
        )
        .setDescription(
          `User: <@${user.id}>\n\n` +
          `Support staff can reply here.\n` +
          `Messages from the user will be forwarded to their DMs.`
        )
        .setTimestamp()
    ],

    components: [
      ticketButtons()
    ]
  });

  await user.send(
    `🎫 **Your support ticket has been created.**\n\n` +
    `You can now send your messages here and our support team will receive them.`
  ).catch(() => {});

  await sendLog(
    guild,
    "tickets",
    "🎫 Ticket Created",
    [
      field(
        "User",
        `${user.tag} (${user.id})`
      ),
      field(
        "Channel",
        channel.toString()
      )
    ],
    0x57f287
  );

  return channel;
}

function getTicketByChannel(
  guild,
  channelId
) {
  if (!guild) return null;

  const cfg =
    getGuildConfig(
      guild.id
    );

  for (
    const [userId, ticket]
    of Object.entries(
      cfg.ticketsData
    )
  ) {
    if (
      ticket.channelId ===
      channelId
    ) {
      return {
        userId,
        ticket
      };
    }
  }

  return null;
}

async function makeTranscript(
  channel
) {
  const messages = [];

  let before;

  while (
    messages.length <
    10000
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
      !batch.size
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

  const text =
    messages
      .map(message => {
        const attachments =
          [
            ...message.attachments.values()
          ]
            .map(x => x.url)
            .join("\n");

        return (
          `[${message.createdAt.toISOString()}] ` +
          `${message.author.tag} (${message.author.id})\n` +
          `${message.content || ""}\n` +
          `${attachments}\n`
        );
      })
      .join("\n");

  return Buffer.from(
    text,
    "utf8"
  );
}

async function closeTicket(
  guild,
  userId,
  channel,
  closedBy
) {
  const cfg =
    getGuildConfig(
      guild.id
    );

  const ticket =
    cfg.ticketsData[userId];

  if (!ticket) {
    return;
  }

  const transcript =
    await makeTranscript(
      channel
    );

  const log =
    await getLogChannel(
      guild,
      "tickets"
    );

  if (
    log &&
    log.isTextBased()
  ) {
    await log.send({
      content:
        `📄 Ticket transcript — <@${userId}>`,

      files: [
        {
          attachment:
            transcript,

          name:
            `ticket-${channel.id}.txt`
        }
      ]
    }).catch(() => {});
  }

  await channel.permissionOverwrites
    .edit(
      userId,
      {
        ViewChannel: true,
        SendMessages: false,
        ReadMessageHistory: true
      }
    )
    .catch(() => {});

  ticket.closed = true;

  save();

  await channel.send(
    "🔒 **Ticket closed.**\n\nUse `/reopen` if the ticket needs to be reopened."
  );

  await sendLog(
    guild,
    "tickets",
    "🔒 Ticket Closed",
    [
      field(
        "User",
        `<@${userId}>`
      ),
      field(
        "Closed by",
        closedBy.toString()
      )
    ]
  );
}

/* =========================================================
   SLASH COMMANDS
========================================================= */

const commands = [];

function addCommand(command) {
  commands.push(
    command.toJSON()
  );
}

/* HELP */

addCommand(
  new SlashCommandBuilder()
    .setName("help")
    .setDescription(
      "Show all AkiyO commands."
    )
);

/* TICKETS */

addCommand(
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription(
      "Create a support ticket."
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription(
      "Send the ticket panel."
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName("ticketsetup")
    .setDescription(
      "Configure the ticket system."
    )
    .addChannelOption(
      o =>
        o
          .setName("category")
          .setDescription(
            "Ticket category."
          )
          .addChannelTypes(
            ChannelType.GuildCategory
          )
          .setRequired(true)
    )
    .addRoleOption(
      o =>
        o
          .setName("support_role")
          .setDescription(
            "Support staff role."
          )
          .setRequired(false)
    )
);

for (
  const name of [
    "close",
    "reopen",
    "delete",
    "claim",
    "unclaim",
    "lock",
    "unlock"
  ]
) {
  addCommand(
    new SlashCommandBuilder()
      .setName(name)
      .setDescription(
        `${name} the current ticket.`
      )
  );
}

addCommand(
  new SlashCommandBuilder()
    .setName("ticketadd")
    .setDescription(
      "Add a user to the ticket."
    )
    .addUserOption(
      o =>
        o
          .setName("user")
          .setDescription("User.")
          .setRequired(true)
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName("ticketremove")
    .setDescription(
      "Remove a user from the ticket."
    )
    .addUserOption(
      o =>
        o
          .setName("user")
          .setDescription("User.")
          .setRequired(true)
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName("ticketrename")
    .setDescription(
      "Rename the ticket."
    )
    .addStringOption(
      o =>
        o
          .setName("name")
          .setDescription("New name.")
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

/* AUTOMOD */

addCommand(
  new SlashCommandBuilder()
    .setName("automod")
    .setDescription(
      "Advanced AutoMod."
    )
    .addSubcommand(
      s =>
        s
          .setName("enable")
          .setDescription("Enable AutoMod.")
    )
    .addSubcommand(
      s =>
        s
          .setName("disable")
          .setDescription("Disable AutoMod.")
    )
    .addSubcommand(
      s =>
        s
          .setName("status")
          .setDescription("Show AutoMod status.")
    )
    .addSubcommand(
      s =>
        s
          .setName("config")
          .setDescription(
            "Configure AutoMod."
          )
          .addIntegerOption(
            o =>
              o
                .setName("spam_limit")
                .setDescription(
                  "Messages required for spam."
                )
                .setMinValue(3)
                .setMaxValue(30)
          )
          .addIntegerOption(
            o =>
              o
                .setName("timeout")
                .setDescription(
                  "Default timeout seconds."
                )
                .setMinValue(10)
                .setMaxValue(604800)
          )
          .addIntegerOption(
            o =>
              o
                .setName("caps_percent")
                .setDescription(
                  "Caps percentage."
                )
                .setMinValue(50)
                .setMaxValue(100)
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("badword")
          .setDescription(
            "Add a blocked word."
          )
          .addStringOption(
            o =>
              o
                .setName("word")
                .setDescription("Word.")
                .setRequired(true)
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("removebadword")
          .setDescription(
            "Remove a blocked word."
          )
          .addStringOption(
            o =>
              o
                .setName("word")
                .setDescription("Word.")
                .setRequired(true)
          )
);

/* SECURITY */

addCommand(
  new SlashCommandBuilder()
    .setName("security")
    .setDescription(
      "Anti-Nuke security."
    )
    .addSubcommand(
      s =>
        s
          .setName("enable")
          .setDescription("Enable security.")
    )
    .addSubcommand(
      s =>
        s
          .setName("disable")
          .setDescription(
            "Disable security."
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("status")
          .setDescription(
            "Security status."
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("trusted")
          .setDescription(
            "Trust a user."
          )
          .addUserOption(
            o =>
              o
                .setName("user")
                .setDescription("User.")
                .setRequired(true)
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("untrusted")
          .setDescription(
            "Remove trusted user."
          )
          .addUserOption(
            o =>
              o
                .setName("user")
                .setDescription("User.")
                .setRequired(true)
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("trustedbot")
          .setDescription(
            "Trust a bot."
          )
          .addUserOption(
            o =>
              o
                .setName("user")
                .setDescription("Bot.")
                .setRequired(true)
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("untrustedbot")
          .setDescription(
            "Remove trusted bot."
          )
          .addUserOption(
            o =>
              o
                .setName("user")
                .setDescription("Bot.")
                .setRequired(true)
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("trustedrole")
          .setDescription(
            "Set trusted role."
          )
          .addRoleOption(
            o =>
              o
                .setName("role")
                .setDescription("Role.")
                .setRequired(true)
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("trustedmember")
          .setDescription(
            "Trust a server member."
          )
          .addUserOption(
            o =>
              o
                .setName("user")
                .setDescription("User.")
                .setRequired(true)
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("untrustedmember")
          .setDescription(
            "Remove trusted member."
          )
          .addUserOption(
            o =>
              o
                .setName("user")
                .setDescription("User.")
                .setRequired(true)
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("protectedrole")
          .setDescription(
            "Protect a role."
          )
          .addRoleOption(
            o =>
              o
                .setName("role")
                .setDescription("Role.")
                .setRequired(true)
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("unprotectedrole")
          .setDescription(
            "Unprotect a role."
          )
          .addRoleOption(
            o =>
              o
                .setName("role")
                .setDescription("Role.")
                .setRequired(true)
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("protectedchannel")
          .setDescription(
            "Protect a channel."
          )
          .addChannelOption(
            o =>
              o
                .setName("channel")
                .setDescription("Channel.")
                .addChannelTypes(
                  ChannelType.GuildText,
                  ChannelType.GuildAnnouncement
                )
                .setRequired(true)
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("unprotectedchannel")
          .setDescription(
            "Remove protected channel."
          )
          .addChannelOption(
            o =>
              o
                .setName("channel")
                .setDescription("Channel.")
                .addChannelTypes(
                  ChannelType.GuildText,
                  ChannelType.GuildAnnouncement
                )
                .setRequired(true)
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("list")
          .setDescription(
            "List security settings."
          )
    )
);

/* CONFIG */

addCommand(
  new SlashCommandBuilder()
    .setName("config")
    .setDescription(
      "Configure AkiyO."
    )
    .addSubcommand(
      s =>
        s
          .setName("log")
          .setDescription(
            "Set a log channel."
          )
          .addStringOption(
            o =>
              o
                .setName("type")
                .setDescription("Log type.")
                .setRequired(true)
                .addChoices(
                  ...LOG_TYPES.map(x => ({
                    name: x,
                    value: x
                  }))
                )
          )
          .addChannelOption(
            o =>
              o
                .setName("channel")
                .setDescription(
                  "Log channel."
                )
                .addChannelTypes(
                  ChannelType.GuildText,
                  ChannelType.GuildAnnouncement
                )
                .setRequired(true)
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("suggestions")
          .setDescription(
            "Set suggestion channel."
          )
          .addChannelOption(
            o =>
              o
                .setName("channel")
                .setDescription(
                  "Suggestion channel."
                )
                .addChannelTypes(
                  ChannelType.GuildText,
                  ChannelType.GuildAnnouncement
                )
                .setRequired(true)
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("timeout")
          .setDescription(
            "Set AutoMod timeout."
          )
          .addStringOption(
            o =>
              o
                .setName("type")
                .setDescription(
                  "AutoMod type."
                )
                .setRequired(true)
                .addChoices(
                  ...[
                    "spam",
                    "invite",
                    "badword",
                    "caps",
                    "repeat",
                    "massmention"
                  ].map(x => ({
                    name: x,
                    value: x
                  }))
                )
          )
          .addIntegerOption(
            o =>
              o
                .setName("seconds")
                .setDescription(
                  "Timeout seconds."
                )
                .setMinValue(10)
                .setMaxValue(604800)
                .setRequired(true)
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("security")
          .setDescription(
            "Configure security limits."
          )
          .addIntegerOption(
            o =>
              o
                .setName("mass_ban")
                .setDescription(
                  "Mass bans."
                )
                .setMinValue(1)
                .setMaxValue(20)
          )
          .addIntegerOption(
            o =>
              o
                .setName("mass_kick")
                .setDescription(
                  "Mass kicks."
                )
                .setMinValue(1)
                .setMaxValue(20)
          )
          .addIntegerOption(
            o =>
              o
                .setName(
                  "mass_channel_delete"
                )
                .setDescription(
                  "Channel deletes."
                )
                .setMinValue(1)
                .setMaxValue(20)
          )
          .addIntegerOption(
            o =>
              o
                .setName(
                  "mass_channel_create"
                )
                .setDescription(
                  "Channel creates."
                )
                .setMinValue(1)
                .setMaxValue(20)
          )
          .addIntegerOption(
            o =>
              o
                .setName(
                  "mass_role_delete"
                )
                .setDescription(
                  "Role deletes."
                )
                .setMinValue(1)
                .setMaxValue(20)
          )
          .addIntegerOption(
            o =>
              o
                .setName(
                  "mass_role_create"
                )
                .setDescription(
                  "Role creates."
                )
                .setMinValue(1)
                .setMaxValue(20)
          )
    )
);

/* MODERATION */

for (
  const [name, description] of [
    ["warn", "Warn a member."],
    ["timeout", "Timeout a member."],
    ["kick", "Kick a member."],
    ["ban", "Ban a member."]
  ]
) {
  const command =
    new SlashCommandBuilder()
      .setName(name)
      .setDescription(
        description
      )
      .addUserOption(
        o =>
          o
            .setName("user")
            .setDescription("Member.")
            .setRequired(true)
      )
      .addStringOption(
        o =>
          o
            .setName("reason")
            .setDescription("Reason.")
            .setRequired(true)
      );

  if (name === "timeout") {
    command.addIntegerOption(
      o =>
        o
          .setName("seconds")
          .setDescription(
            "Timeout seconds."
          )
          .setMinValue(10)
          .setMaxValue(604800)
          .setRequired(true)
    );
  }

  addCommand(command);
}

addCommand(
  new SlashCommandBuilder()
    .setName("unban")
    .setDescription(
      "Unban a user."
    )
    .addStringOption(
      o =>
        o
          .setName("user_id")
          .setDescription(
            "User ID."
          )
          .setRequired(true)
    )
    .addStringOption(
      o =>
        o
          .setName("reason")
          .setDescription("Reason.")
          .setRequired(true)
    )
);

for (
  const name of [
    "warnings",
    "punishments"
  ]
) {
  addCommand(
    new SlashCommandBuilder()
      .setName(name)
      .setDescription(
        `View ${name}.`
      )
      .addUserOption(
        o =>
          o
            .setName("user")
            .setDescription("User.")
            .setRequired(true)
      )
  );
}

/* SUGGESTIONS */

addCommand(
  new SlashCommandBuilder()
    .setName("suggest")
    .setDescription(
      "Create a suggestion."
    )
    .addStringOption(
      o =>
        o
          .setName("text")
          .setDescription(
            "Suggestion."
          )
          .setRequired(true)
    )
);

/* ANNOUNCEMENTS */

addCommand(
  new SlashCommandBuilder()
    .setName("announce")
    .setDescription(
      "Send an announcement."
    )
    .addStringOption(
      o =>
        o
          .setName("message")
          .setDescription("Message.")
          .setRequired(true)
    )
    .addChannelOption(
      o =>
        o
          .setName("channel")
          .setDescription(
            "Target channel."
          )
          .addChannelTypes(
            ChannelType.GuildText,
            ChannelType.GuildAnnouncement
          )
          .setRequired(true)
    )
    .addStringOption(
      o =>
        o
          .setName("title")
          .setDescription(
            "Embed title."
          )
    )
    .addStringOption(
      o =>
        o
          .setName("footer")
          .setDescription("Footer.")
    )
    .addStringOption(
      o =>
        o
          .setName("image")
          .setDescription(
            "Image URL."
          )
    )
    .addStringOption(
      o =>
        o
          .setName("thumbnail")
          .setDescription(
            "Thumbnail URL."
          )
    )
    .addBooleanOption(
      o =>
        o
          .setName("embed")
          .setDescription(
            "Use embed."
          )
    )
    .addBooleanOption(
      o =>
        o
          .setName("everyone")
          .setDescription(
            "Mention everyone."
          )
    )
    .addBooleanOption(
      o =>
        o
          .setName("here")
          .setDescription(
            "Mention here."
          )
    )
    .addRoleOption(
      o =>
        o
          .setName("role")
          .setDescription(
            "Mention role."
          )
    )
    .addUserOption(
      o =>
        o
          .setName("user")
          .setDescription(
            "Mention user."
          )
    )
);

/* AUTOROLE */

addCommand(
  new SlashCommandBuilder()
    .setName("autorole")
    .setDescription(
      "Automatic member role."
    )
    .addSubcommand(
      s =>
        s
          .setName("set")
          .setDescription(
            "Set autorole."
          )
          .addRoleOption(
            o =>
              o
                .setName("role")
                .setDescription("Role.")
                .setRequired(true)
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("disable")
          .setDescription(
            "Disable autorole."
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("status")
          .setDescription(
            "Autorole status."
          )
    )
);

/* WELCOME */

addCommand(
  new SlashCommandBuilder()
    .setName("welcome")
    .setDescription(
      "Welcome system."
    )
    .addSubcommand(
      s =>
        s
          .setName("set")
          .setDescription(
            "Configure welcome."
          )
          .addChannelOption(
            o =>
              o
                .setName("channel")
                .setDescription("Channel.")
                .addChannelTypes(
                  ChannelType.GuildText
                )
                .setRequired(true)
          )
          .addStringOption(
            o =>
              o
                .setName("message")
                .setDescription(
                  "Welcome message."
                )
                .setRequired(true)
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("disable")
          .setDescription(
            "Disable welcome."
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("status")
          .setDescription(
            "Welcome status."
          )
    )
);

/* VERIFICATION */

addCommand(
  new SlashCommandBuilder()
    .setName("verification")
    .setDescription(
      "Verification system."
    )
    .addSubcommand(
      s =>
        s
          .setName("setup")
          .setDescription(
            "Setup verification."
          )
          .addChannelOption(
            o =>
              o
                .setName("channel")
                .setDescription(
                  "Verification channel."
                )
                .addChannelTypes(
                  ChannelType.GuildText
                )
                .setRequired(true)
          )
          .addRoleOption(
            o =>
              o
                .setName("role")
                .setDescription(
                  "Verified role."
                )
                .setRequired(true)
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("disable")
          .setDescription(
            "Disable verification."
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("status")
          .setDescription(
            "Verification status."
          )
    )
);

/* REACTION ROLES */

addCommand(
  new SlashCommandBuilder()
    .setName("autoreactionrole")
    .setDescription(
      "Reaction role system."
    )
    .addSubcommand(
      s =>
        s
          .setName("add")
          .setDescription(
            "Add reaction role."
          )
          .addStringOption(
            o =>
              o
                .setName("message_id")
                .setDescription(
                  "Message ID."
                )
                .setRequired(true)
          )
          .addStringOption(
            o =>
              o
                .setName("emoji")
                .setDescription(
                  "Emoji."
                )
                .setRequired(true)
          )
          .addRoleOption(
            o =>
              o
                .setName("role")
                .setDescription("Role.")
                .setRequired(true)
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("remove")
          .setDescription(
            "Remove reaction role."
          )
          .addStringOption(
            o =>
              o
                .setName("message_id")
                .setDescription(
                  "Message ID."
                )
                .setRequired(true)
          )
          .addStringOption(
            o =>
              o
                .setName("emoji")
                .setDescription(
                  "Emoji."
                )
                .setRequired(true)
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("list")
          .setDescription(
            "List reaction roles."
          )
    )
);

/* LEADERBOARD */

addCommand(
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription(
      "Message leaderboard."
    )
    .addSubcommand(
      s =>
        s
          .setName("top")
          .setDescription(
            "Show top users."
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("reset")
          .setDescription(
            "Reset leaderboard."
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("enable")
          .setDescription(
            "Enable leaderboard."
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("disable")
          .setDescription(
            "Disable leaderboard."
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("status")
          .setDescription(
            "Leaderboard status."
          )
    )
);

/* ADS */

addCommand(
  new SlashCommandBuilder()
    .setName("ads")
    .setDescription(
      "Owner advertisement system."
    )
    .addSubcommand(
      s =>
        s
          .setName("set")
          .setDescription(
            "Set advertisement channel."
          )
          .addChannelOption(
            o =>
              o
                .setName("channel")
                .setDescription(
                  "Channel."
                )
                .addChannelTypes(
                  ChannelType.GuildText
                )
                .setRequired(true)
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("message")
          .setDescription(
            "Set advertisement."
          )
          .addStringOption(
            o =>
              o
                .setName("text")
                .setDescription("Text.")
                .setRequired(true)
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("enable")
          .setDescription(
            "Enable ads."
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("disable")
          .setDescription(
            "Disable ads."
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("status")
          .setDescription(
            "Ad status."
          )
    )
    .addSubcommand(
      s =>
        s
          .setName("broadcast")
          .setDescription(
            "Broadcast advertisement."
          )
    )
);

/* BOT INFO */

addCommand(
  new SlashCommandBuilder()
    .setName("botinfo")
    .setDescription(
      "Show AkiyO information."
    )
);

/* =========================================================
   STAFF COMMANDS
========================================================= */

const staffCommands =
  new Set([
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
    "welcome",
    "verification",
    "autoreactionrole",
    "leaderboard"
  ]);

/* =========================================================
   REGISTER GLOBAL COMMANDS
========================================================= */

async function registerCommands() {
  const rest =
    new REST({
      version: "10"
    }).setToken(TOKEN);

  await rest.put(
    Routes.applicationCommands(
      CLIENT_ID
    ),
    {
      body: commands
    }
  );

  console.log(
    `✅ Registered ${commands.length} GLOBAL slash commands.`
  );
}

/* =========================================================
   MESSAGE CREATE
========================================================= */

client.on(
  "messageCreate",
  async message => {
    if (message.author.bot) {
      return;
    }

    try {
      /* =========================
         DM MESSAGE
      ========================= */

      if (!message.guild) {
        const mapping =
          db.dmTickets[
            message.author.id
          ];

        if (!mapping) {
          return;
        }

        const guild =
          client.guilds.cache.get(
            mapping.guildId
          );

        if (!guild) {
          return;
        }

        const channel =
          await guild.channels
            .fetch(
              mapping.channelId
            )
            .catch(() => null);

        if (
          !channel ||
          !channel.isTextBased()
        ) {
          return;
        }

        const embed =
          new EmbedBuilder()
            .setTitle(
              "📩 User Message"
            )
            .setDescription(
              message.content ||
              "[Attachment]"
            )
            .addFields(
              field(
                "User",
                `${message.author.tag} (${message.author.id})`
              )
            )
            .setTimestamp();

        if (
          message.attachments.size
        ) {
          embed.addFields(
            field(
              "Attachments",
              [
                ...message.attachments.values()
              ]
                .map(x => x.url)
                .join("\n")
            )
          );
        }

        await channel.send({
          embeds: [embed]
        });

        return;
      }

      /* =========================
         SERVER MESSAGE
      ========================= */

      const cfg =
        getGuildConfig(
          message.guild.id
        );

      const ticket =
        getTicketByChannel(
          message.guild,
          message.channel.id
        );

      /* STAFF TICKET REPLY */

      if (
        ticket &&
        isStaff(message.member)
      ) {
        const user =
          await client.users
            .fetch(
              ticket.userId
            )
            .catch(() => null);

        if (user) {
          await user.send({
            embeds: [
              new EmbedBuilder()
                .setTitle(
                  "💬 Support Team"
                )
                .setDescription(
                  message.content ||
                  "📎 Attachment"
                )
                .setFooter({
                  text:
                    `Support • ${message.guild.name}`
                })
                .setTimestamp()
            ],

            files: [
              ...message.attachments.values()
            ].map(a => ({
              attachment: a.url
            }))
          }).catch(() => {});
        }

        return;
      }

      /* LEADERBOARD */

      if (
        cfg.leaderboard.enabled
      ) {
        cfg.leaderboard.messages[
          message.author.id
        ] =
          (
            cfg.leaderboard.messages[
              message.author.id
            ] || 0
          ) + 1;

        if (
          cfg.leaderboard.messages[
            message.author.id
          ] % 10 === 0
        ) {
          save();
        }
      }

      /* AUTOMOD */

      await runAutoMod(
        message
      );
    } catch (err) {
      console.error(
        "messageCreate:",
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
      const guild =
        member.guild;

      const cfg =
        getGuildConfig(
          guild.id
        );

      /* AUTOROLE */

      if (
        cfg.autorole.enabled &&
        cfg.autorole.roleId
      ) {
        const role =
          await guild.roles
            .fetch(
              cfg.autorole.roleId
            )
            .catch(() => null);

        if (
          role &&
          role.position <
            guild.members.me
              .roles.highest.position
        ) {
          await member.roles
            .add(
              role,
              "AkiyO Autorole"
            )
            .catch(() => {});
        }

        await sendLog(
          guild,
          "members",
          "👤 Autorole",
          [
            field(
              "User",
              member.toString()
            ),
            field(
              "Role",
              role
                ? role.toString()
                : "Unknown"
            )
          ]
        );
      }

      /* WELCOME */

      if (
        cfg.welcome.enabled &&
        cfg.welcome.channelId
      ) {
        const channel =
          await guild.channels
            .fetch(
              cfg.welcome.channelId
            )
            .catch(() => null);

        if (
          channel &&
          channel.isTextBased()
        ) {
          await channel.send(
            formatWelcome(
              cfg.welcome.message,
              member
            )
          ).catch(() => {});
        }

        await sendLog(
          guild,
          "welcome",
          "👋 Member Joined",
          [
            field(
              "User",
              member.toString()
            )
          ]
        );
      }

      /* ANTI RAID */

      if (
        cfg.security.enabled
      ) {
        const key =
          `join:${guild.id}`;

        const now =
          Date.now();

        let joins =
          securityTracker.get(
            key
          ) || [];

        joins =
          joins.filter(
            x =>
              now - x <
              cfg.security.raidWindow
          );

        joins.push(now);

        securityTracker.set(
          key,
          joins
        );

        if (
          joins.length >=
          cfg.security.raidJoinCount
        ) {
          await sendLog(
            guild,
            "security",
            "🚨 Possible Raid",
            [
              field(
                "Joins",
                joins.length
              ),
              field(
                "Window",
                `${cfg.security.raidWindow / 1000}s`
              )
            ],
            0xed4245
          );

          securityTracker.delete(
            key
          );
        }
      }
    } catch (err) {
      console.error(
        "guildMemberAdd:",
        err
      );
    }
  }
);

/* =========================================================
   MEMBER REMOVE / KICK DETECTION
========================================================= */

client.on(
  "guildMemberRemove",
  async member => {
    try {
      const entry =
        await getRecentExecutor(
          member.guild,
          AuditLogEvent.MemberKick,
          member.id
        );

      if (entry) {
        await securityCheck(
          member.guild,
          "kick",
          entry.executor?.id,
          `Kicked ${member.user.tag}`
        );

        await sendLog(
          member.guild,
          "members",
          "👢 Member Kicked",
          [
            field(
              "User",
              `${member.user.tag} (${member.id})`
            ),
            field(
              "Executor",
              entry.executor
                ? entry.executor.toString()
                : "Unknown"
            ),
            field(
              "Reason",
              entry.reason || "None"
            )
          ]
        );
      }
    } catch (err) {
      console.error(
        "guildMemberRemove:",
        err
      );
    }
  }
);

/* =========================================================
   BAN DETECTION
========================================================= */

client.on(
  "guildBanAdd",
  async ban => {
    try {
      const entry =
        await getRecentExecutor(
          ban.guild,
          AuditLogEvent.MemberBanAdd,
          ban.user.id
        );

      if (entry) {
        await securityCheck(
          ban.guild,
          "ban",
          entry.executor?.id,
          `Banned ${ban.user.tag}`
        );
      }

      await sendLog(
        ban.guild,
        "members",
        "🔨 Member Banned",
        [
          field(
            "User",
            `${ban.user.tag} (${ban.user.id})`
          ),
          field(
            "Executor",
            entry?.executor
              ? entry.executor.toString()
              : "Unknown"
          ),
          field(
            "Reason",
            entry?.reason || "None"
          )
        ]
      );
    } catch (err) {
      console.error(
        "guildBanAdd:",
        err
      );
    }
  }
);

/* =========================================================
   CHANNEL / ROLE SECURITY
========================================================= */

client.on(
  "channelCreate",
  async channel => {
    try {
      const guild =
        channel.guild;

      const entry =
        await getRecentExecutor(
          guild,
          AuditLogEvent.ChannelCreate,
          channel.id
        );

      if (entry) {
        await securityCheck(
          guild,
          "channelCreate",
          entry.executor?.id,
          `Created channel #${channel.name}`
        );
      }

      await sendLog(
        guild,
        "channels",
        "📁 Channel Created",
        [
          field(
            "Channel",
            `#${channel.name}`
          ),
          field(
            "Executor",
            entry?.executor
              ? entry.executor.toString()
              : "Unknown"
          )
        ]
      );
    } catch (err) {
      console.error(
        "channelCreate:",
        err
      );
    }
  }
);

client.on(
  "channelDelete",
  async channel => {
    try {
      const guild =
        channel.guild;

      const cfg =
        getGuildConfig(
          guild.id
        );

      if (
        cfg.security.protectedChannels
          .includes(channel.id)
      ) {
        await sendLog(
          guild,
          "security",
          "🚨 Protected Channel Deleted",
          [
            field(
              "Channel",
              `#${channel.name}`
            )
          ],
          0xed4245
        );
      }

      const entry =
        await getRecentExecutor(
          guild,
          AuditLogEvent.ChannelDelete,
          channel.id
        );

      if (entry) {
        await securityCheck(
          guild,
          "channelDelete",
          entry.executor?.id,
          `Deleted channel #${channel.name}`
        );
      }

      await sendLog(
        guild,
        "channels",
        "🗑️ Channel Deleted",
        [
          field(
            "Channel",
            `#${channel.name}`
          ),
          field(
            "Executor",
            entry?.executor
              ? entry.executor.toString()
              : "Unknown"
          )
        ]
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
  "roleCreate",
  async role => {
    try {
      const entry =
        await getRecentExecutor(
          role.guild,
          AuditLogEvent.RoleCreate,
          role.id
        );

      if (entry) {
        await securityCheck(
          role.guild,
          "roleCreate",
          entry.executor?.id,
          `Created role ${role.name}`
        );
      }

      await sendLog(
        role.guild,
        "roles",
        "🟢 Role Created",
        [
          field(
            "Role",
            role.toString()
          ),
          field(
            "Executor",
            entry?.executor
              ? entry.executor.toString()
              : "Unknown"
          )
        ]
      );
    } catch (err) {
      console.error(
        "roleCreate:",
        err
      );
    }
  }
);

client.on(
  "roleDelete",
  async role => {
    try {
      const cfg =
        getGuildConfig(
          role.guild.id
        );

      if (
        cfg.security.protectedRoles
          .includes(role.id)
      ) {
        await sendLog(
          role.guild,
          "security",
          "🚨 Protected Role Deleted",
          [
            field(
              "Role",
              role.name
            )
          ],
          0xed4245
        );
      }

      const entry =
        await getRecentExecutor(
          role.guild,
          AuditLogEvent.RoleDelete,
          role.id
        );

      if (entry) {
        await securityCheck(
          role.guild,
          "roleDelete",
          entry.executor?.id,
          `Deleted role ${role.name}`
        );
      }

      await sendLog(
        role.guild,
        "roles",
        "🔴 Role Deleted",
        [
          field(
            "Role",
            role.name
          ),
          field(
            "Executor",
            entry?.executor
              ? entry.executor.toString()
              : "Unknown"
          )
        ]
      );
    } catch (err) {
      console.error(
        "roleDelete:",
        err
      );
    }
  }
);

/* =========================================================
   WEBHOOK SECURITY
========================================================= */

client.on(
  "webhookUpdate",
  async channel => {
    try {
      const guild =
        channel.guild;

      const entry =
        await getRecentExecutor(
          guild,
          AuditLogEvent.WebhookCreate
        );

      if (entry) {
        await securityCheck(
          guild,
          "webhook",
          entry.executor?.id,
          `Webhook activity in #${channel.name}`
        );
      }

      await sendLog(
        guild,
        "security",
        "🔗 Webhook Activity",
        [
          field(
            "Channel",
            channel.toString()
          ),
          field(
            "Executor",
            entry?.executor
              ? entry.executor.toString()
              : "Unknown"
          )
        ]
      );
    } catch (err) {
      console.error(
        "webhookUpdate:",
        err
      );
    }
  }
);

/* =========================================================
   AUDIT LOG
========================================================= */

client.on(
  "guildAuditLogEntryCreate",
  async (entry, guild) => {
    try {
      await sendLog(
        guild,
        "audit",
        "📜 Audit Log",
        [
          field(
            "Action",
            entry.action
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
            entry.reason || "None"
          )
        ]
      );
    } catch (err) {
      console.error(
        "audit:",
        err
      );
    }
  }
);

/* =========================================================
   INTERACTION CREATE
========================================================= */

client.on(
  "interactionCreate",
  async interaction => {
    try {
      /* =========================
         BUTTONS
      ========================= */

      if (
        interaction.isButton()
      ) {
        /* CREATE TICKET */

        if (
          interaction.customId ===
          "create_ticket"
        ) {
          const channel =
            await createTicket(
              interaction.guild,
              interaction.user
            );

          if (!channel) {
            return interaction.reply({
              content:
                "❌ Ticket system is not configured or enabled.",
              ephemeral: true
            });
          }

          return interaction.reply({
            content:
              "🎫 Ticket created. Check your DMs.",
            ephemeral: true
          });
        }

        /* VERIFICATION */

        if (
          interaction.customId ===
          "verify_user"
        ) {
          const cfg =
            getGuildConfig(
              interaction.guild.id
            );

          if (
            !cfg.verification.enabled
          ) {
            return interaction.reply({
              content:
                "❌ Verification is disabled.",
              ephemeral: true
            });
          }

          const role =
            await interaction.guild.roles
              .fetch(
                cfg.verification.roleId
              )
              .catch(() => null);

          if (!role) {
            return interaction.reply({
              content:
                "❌ Verification role is missing.",
              ephemeral: true
            });
          }

          if (
            role.position >=
            interaction.guild
              .members.me
              .roles.highest.position
          ) {
            return interaction.reply({
              content:
                "❌ My highest role must be above the verified role.",
              ephemeral: true
            });
          }

          await interaction.member.roles
            .add(
              role,
              "AkiyO Verification"
            )
            .catch(() => {});

          await sendLog(
            interaction.guild,
            "verification",
            "✅ User Verified",
            [
              field(
                "User",
                interaction.user.toString()
              ),
              field(
                "Role",
                role.toString()
              )
            ],
            0x57f287
          );

          return interaction.reply({
            content:
              "✅ You are verified!",
            ephemeral: true
          });
        }

        /* SUGGESTION APPROVE */

        if (
          interaction.customId
            .startsWith(
              "suggest_approve:"
            )
        ) {
          if (
            !isStaff(
              interaction.member
            )
          ) {
            return interaction.reply({
              content:
                "❌ Staff only.",
              ephemeral: true
            });
          }

          const message =
            await interaction.channel.messages
              .fetch(
                interaction.customId.split(":")[1]
              )
              .catch(() => null);

          if (!message) {
            return interaction.reply({
              content:
                "❌ Suggestion message not found.",
              ephemeral: true
            });
          }

          const old =
            message.embeds[0];

          const embed =
            old
              ? EmbedBuilder.from(old)
              : new EmbedBuilder();

          embed
            .setColor(0x57f287)
            .setFooter({
              text:
                `✅ Approved by ${interaction.user.tag}`
            });

          await message.edit({
            embeds: [embed],
            components: []
          }).catch(() => {});

          await sendLog(
            interaction.guild,
            "suggestion",
            "✅ Suggestion Approved",
            [
              field(
                "Moderator",
                interaction.user.toString()
              )
            ],
            0x57f287
          );

          return interaction.reply({
            content:
              "✅ Suggestion approved.",
            ephemeral: true
          });
        }

        /* SUGGESTION DECLINE */

        if (
          interaction.customId
            .startsWith(
              "suggest_decline:"
            )
        ) {
          if (
            !isStaff(
              interaction.member
            )
          ) {
            return interaction.reply({
              content:
                "❌ Staff only.",
              ephemeral: true
            });
          }

          const message =
            await interaction.channel.messages
              .fetch(
                interaction.customId.split(":")[1]
              )
              .catch(() => null);

          if (!message) {
            return interaction.reply({
              content:
                "❌ Suggestion message not found.",
              ephemeral: true
            });
          }

          const old =
            message.embeds[0];

          const embed =
            old
              ? EmbedBuilder.from(old)
              : new EmbedBuilder();

          embed
            .setColor(0xed4245)
            .setFooter({
              text:
                `❌ Declined by ${interaction.user.tag}`
            });

          await message.edit({
            embeds: [embed],
            components: []
          }).catch(() => {});

          await sendLog(
            interaction.guild,
            "suggestion",
            "❌ Suggestion Declined",
            [
              field(
                "Moderator",
                interaction.user.toString()
              )
            ],
            0xed4245
          );

          return interaction.reply({
            content:
              "❌ Suggestion declined.",
            ephemeral: true
          });
        }

        /* TICKET BUTTONS */

        if (
          !isStaff(
            interaction.member
          )
        ) {
          return interaction.reply({
            content:
              "❌ Staff only.",
            ephemeral: true
          });
        }

        const ticket =
          getTicketByChannel(
            interaction.guild,
            interaction.channel.id
          );

        if (!ticket) {
          return interaction.reply({
            content:
              "❌ This is not a ticket.",
            ephemeral: true
          });
        }

        const userId =
          ticket.userId;

        if (
          interaction.customId ===
          "ticket_claim"
        ) {
          ticketClaims.set(
            interaction.channel.id,
            interaction.user.id
          );

          return interaction.reply(
            `🙋 Ticket claimed by ${interaction.user}.`
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
            interaction.guild,
            userId,
            interaction.channel,
            interaction.user
          );
        }

        if (
          interaction.customId ===
          "ticket_lock"
        ) {
          await interaction.channel
            .permissionOverwrites
            .edit(
              userId,
              {
                ViewChannel: true,
                SendMessages: false,
                ReadMessageHistory: true
              }
            )
            .catch(() => {});

          return interaction.reply(
            "🔐 Ticket locked."
          );
        }

        if (
          interaction.customId ===
          "ticket_transcript"
        ) {
          const transcript =
            await makeTranscript(
              interaction.channel
            );

          const log =
            await getLogChannel(
              interaction.guild,
              "tickets"
            );

          if (
            log &&
            log.isTextBased()
          ) {
            await log.send({
              content:
                `📄 Ticket transcript — <@${userId}>`,
              files: [
                {
                  attachment:
                    transcript,
                  name:
                    `ticket-${interaction.channel.id}.txt`
                }
              ]
            });
          }

          return interaction.reply({
            content:
              "✅ Transcript sent to the ticket logs.",
            ephemeral: true
          });
        }
      }

      /* =========================
         CHAT COMMANDS
      ========================= */

      if (
        !interaction.isChatInputCommand()
      ) {
        return;
      }

      const command =
        interaction.commandName;

      /* DM */

      if (
        !interaction.guild
      ) {
        return;
      }

      /* STAFF CHECK */

      if (
        staffCommands.has(
          command
        ) &&
        !isStaff(
          interaction.member
        )
      ) {
        return interaction.reply({
          content:
            "❌ You do not have permission to use this command.",
          ephemeral: true
        });
      }

      const guild =
        interaction.guild;

      const cfg =
        getGuildConfig(
          guild.id
        );

      /* =========================
         HELP
      ========================= */

      if (
        command === "help"
      ) {
        const embed =
          new EmbedBuilder()
            .setTitle(
              "🤖 AkiyO Commands"
            )
            .setDescription(
              [
                "🎫 **Tickets**",
                "`/ticket` `/ticketpanel` `/ticketsetup`",
                "`/close` `/reopen` `/delete` `/claim` `/unclaim`",
                "`/lock` `/unlock` `/ticketadd` `/ticketremove`",
                "`/ticketrename` `/ticketinfo` `/ticketstats`",
                "",
                "🛡️ **Protection**",
                "`/automod` `/security` `/config`",
                "",
                "⚖️ **Moderation**",
                "`/warn` `/timeout` `/kick` `/ban` `/unban`",
                "`/warnings` `/punishments`",
                "",
                "💡 **Community**",
                "`/suggest` `/announce` `/welcome`",
                "`/verification` `/autorole` `/autoreactionrole`",
                "`/leaderboard`",
                "",
                "🤖 **Bot**",
                "`/botinfo` `/ads` `/help`"
              ].join("\n")
            )
            .setFooter({
              text:
                "AkiyO • Multi-server Discord Bot"
            });

        return interaction.reply({
          embeds: [embed],
          ephemeral: true
        });
      }

      /* =========================
         TICKET
      ========================= */

      if (
        command === "ticket"
      ) {
        const channel =
          await createTicket(
            guild,
            interaction.user
          );

        if (!channel) {
          return interaction.reply({
            content:
              "❌ Ticket system is disabled or not configured.",
            ephemeral: true
          });
        }

        return interaction.reply({
          content:
            "🎫 Check your DMs. Your ticket has been created.",
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

        await interaction.channel
          .send({
            embeds: [
              new EmbedBuilder()
                .setTitle(
                  "🎫 AkiyO Support Center"
                )
                .setDescription(
                  "Click the button below to open a private support ticket."
                )
                .setTimestamp()
            ],
            components: [row]
          });

        return interaction.reply({
          content:
            "✅ Ticket panel sent.",
          ephemeral: true
        });
      }

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
            "support_role"
          );

        cfg.tickets.categoryId =
          category.id;

        if (role) {
          cfg.tickets.supportRoleId =
            role.id;
        }

        save();

        return interaction.reply(
          "✅ Ticket system configuration saved for this server."
        );
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
          "unlock"
        ].includes(command)
      ) {
        const ticket =
          getTicketByChannel(
            guild,
            interaction.channel.id
          );

        if (!ticket) {
          return interaction.reply({
            content:
              "❌ This is not a ticket.",
            ephemeral: true
          });
        }

        if (
          command === "close"
        ) {
          await interaction.reply(
            "🔒 Closing ticket..."
          );

          return closeTicket(
            guild,
            ticket.userId,
            interaction.channel,
            interaction.user
          );
        }

        if (
          command === "delete"
        ) {
          delete cfg.ticketsData[
            ticket.userId
          ];

          delete db.dmTickets[
            ticket.userId
          ];

          ticketClaims.delete(
            interaction.channel.id
          );

          save();

          await interaction.reply(
            "🗑️ Deleting ticket..."
          );

          return interaction.channel
            .delete()
            .catch(() => {});
        }

        if (
          command === "reopen"
        ) {
          await interaction.channel
            .permissionOverwrites
            .edit(
              ticket.userId,
              {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
              }
            )
            .catch(() => {});

          cfg.ticketsData[
            ticket.userId
          ].closed = false;

          save();

          return interaction.reply(
            "🔓 Ticket reopened."
          );
        }

        if (
          command === "lock"
        ) {
          await interaction.channel
            .permissionOverwrites
            .edit(
              ticket.userId,
              {
                ViewChannel: true,
                SendMessages: false,
                ReadMessageHistory: true
              }
            )
            .catch(() => {});

          return interaction.reply(
            "🔐 Ticket locked."
          );
        }

        if (
          command === "unlock"
        ) {
          await interaction.channel
            .permissionOverwrites
            .edit(
              ticket.userId,
              {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
              }
            )
            .catch(() => {});

          return interaction.reply(
            "🔓 Ticket unlocked."
          );
        }

        if (
          command === "claim"
        ) {
          ticketClaims.set(
            interaction.channel.id,
            interaction.user.id
          );

          return interaction.reply(
            `🙋 Claimed by ${interaction.user}.`
          );
        }

        if (
          command === "unclaim"
        ) {
          ticketClaims.delete(
            interaction.channel.id
          );

          return interaction.reply(
            "✅ Ticket unclaimed."
          );
        }
      }

      /* TICKET ADD */

      if (
        command ===
        "ticketadd"
      ) {
        const ticket =
          getTicketByChannel(
            guild,
            interaction.channel.id
          );

        if (!ticket) {
          return interaction.reply(
            "❌ Not a ticket."
          );
        }

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
          `✅ Added ${user} to the ticket.`
        );
      }

      /* TICKET REMOVE */

      if (
        command ===
        "ticketremove"
      ) {
        const ticket =
          getTicketByChannel(
            guild,
            interaction.channel.id
          );

        if (!ticket) {
          return interaction.reply(
            "❌ Not a ticket."
          );
        }

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

        return interaction.reply(
          `✅ Removed ${user} from the ticket.`
        );
      }

      /* TICKET RENAME */

      if (
        command ===
        "ticketrename"
      ) {
        const ticket =
          getTicketByChannel(
            guild,
            interaction.channel.id
          );

        if (!ticket) {
          return interaction.reply(
            "❌ Not a ticket."
          );
        }

        const name =
          cleanChannelName(
            interaction.options.getString(
              "name"
            )
          );

        await interaction.channel
          .setName(name);

        return interaction.reply(
          `✅ Ticket renamed to **${name}**.`
        );
      }

      /* TICKET INFO */

      if (
        command ===
        "ticketinfo"
      ) {
        const ticket =
          getTicketByChannel(
            guild,
            interaction.channel.id
          );

        if (!ticket) {
          return interaction.reply(
            "❌ Not a ticket."
          );
        }

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                "🎫 Ticket Information"
              )
              .addFields(
                field(
                  "User",
                  `<@${ticket.userId}>`
                ),
                field(
                  "Claimed By",
                  ticketClaims.get(
                    interaction.channel.id
                  )
                    ? `<@${ticketClaims.get(interaction.channel.id)}>`
                    : "Nobody"
                ),
                field(
                  "Status",
                  ticket.ticket.closed
                    ? "🔒 Closed"
                    : "🟢 Open"
                ),
                field(
                  "Created",
                  `<t:${Math.floor(ticket.ticket.createdAt / 1000)}:R>`
                )
              )
          ],
          ephemeral: true
        });
      }

      /* TICKET STATS */

      if (
        command ===
        "ticketstats"
      ) {
        const tickets =
          Object.values(
            cfg.ticketsData
          );

        const open =
          tickets.filter(
            x => !x.closed
          ).length;

        const closed =
          tickets.filter(
            x => x.closed
          ).length;

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                "🎫 Ticket Statistics"
              )
              .addFields(
                field(
                  "Open",
                  open,
                  true
                ),
                field(
                  "Closed",
                  closed,
                  true
                ),
                field(
                  "Total",
                  tickets.length,
                  true
                )
              )
          ]
        });
      }

      /* =========================
         AUTOMOD
      ========================= */

      if (
        command ===
        "automod"
      ) {
        const sub =
          interaction.options.getSubcommand();

        if (
          sub === "enable"
        ) {
          cfg.automod.enabled =
            true;
        }

        if (
          sub === "disable"
        ) {
          cfg.automod.enabled =
            false;
        }

        if (
          sub === "config"
        ) {
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
            cfg.automod.spamLimit =
              spam;
          }

          if (
            timeout !== null
          ) {
            for (
              const type of Object.keys(
                cfg.automod.timeoutSeconds
              )
            ) {
              cfg.automod.timeoutSeconds[
                type
              ] = timeout;
            }
          }

          if (caps !== null) {
            cfg.automod.capsPercent =
              caps;
          }
        }

        if (
          sub === "badword"
        ) {
          const word =
            interaction.options
              .getString(
                "word"
              )
              .toLowerCase()
              .trim();

          if (
            !cfg.automod.badWords
              .includes(word)
          ) {
            cfg.automod.badWords.push(
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
              .getString(
                "word"
              )
              .toLowerCase()
              .trim();

          cfg.automod.badWords =
            cfg.automod.badWords
              .filter(
                x => x !== word
              );
        }

        save();

        if (
          sub === "status"
        ) {
          return interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setTitle(
                  "🛡️ AutoMod Status"
                )
                .addFields(
                  field(
                    "Enabled",
                    cfg.automod.enabled
                      ? "ON"
                      : "OFF",
                    true
                  ),
                  field(
                    "Spam Limit",
                    cfg.automod.spamLimit,
                    true
                  ),
                  field(
                    "Caps",
                    `${cfg.automod.capsPercent}%`,
                    true
                  ),
                  field(
                    "Bad Words",
                    cfg.automod.badWords.length,
                    true
                  ),
                  field(
                    "Invite Protection",
                    cfg.automod.invite
                      ? "ON"
                      : "OFF",
                    true
                  ),
                  field(
                    "Mass Mentions",
                    cfg.automod.massMentions
                      ? "ON"
                      : "OFF",
                    true
                  )
                )
            ]
          });
        }

        return interaction.reply(
          "✅ AutoMod configuration updated for this server."
        );
      }

      /* =========================
         SECURITY
      ========================= */

      if (
        command ===
        "security"
      ) {
        const sub =
          interaction.options.getSubcommand();

        if (
          sub === "enable"
        ) {
          cfg.security.enabled =
            true;
        }

        if (
          sub === "disable"
        ) {
          cfg.security.enabled =
            false;
        }

        if (
          sub === "trusted"
        ) {
          const user =
            interaction.options.getUser(
              "user"
            );

          if (
            !cfg.security.trustedUsers
              .includes(user.id)
          ) {
            cfg.security.trustedUsers.push(
              user.id
            );
          }
        }

        if (
          sub === "untrusted"
        ) {
          const user =
            interaction.options.getUser(
              "user"
            );

          cfg.security.trustedUsers =
            cfg.security.trustedUsers
              .filter(
                x => x !== user.id
              );
        }

        if (
          sub === "trustedbot"
        ) {
          const user =
            interaction.options.getUser(
              "user"
            );

          if (
            !cfg.security.trustedBots
              .includes(user.id)
          ) {
            cfg.security.trustedBots.push(
              user.id
            );
          }
        }

        if (
          sub ===
          "untrustedbot"
        ) {
          const user =
            interaction.options.getUser(
              "user"
            );

          cfg.security.trustedBots =
            cfg.security.trustedBots
              .filter(
                x => x !== user.id
              );
        }

        if (
          sub ===
          "trustedrole"
        ) {
          cfg.security.trustedRoleId =
            interaction.options.getRole(
              "role"
            ).id;
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
            !cfg.security.trustedMembers
              .includes(user.id)
          ) {
            cfg.security.trustedMembers.push(
              user.id
            );
          }
        }

        if (
          sub ===
          "untrustedmember"
        ) {
          const user =
            interaction.options.getUser(
              "user"
            );

          cfg.security.trustedMembers =
            cfg.security.trustedMembers
              .filter(
                x => x !== user.id
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
            !cfg.security.protectedRoles
              .includes(role.id)
          ) {
            cfg.security.protectedRoles.push(
              role.id
            );
          }
        }

        if (
          sub ===
          "unprotectedrole"
        ) {
          const role =
            interaction.options.getRole(
              "role"
            );

          cfg.security.protectedRoles =
            cfg.security.protectedRoles
              .filter(
                x => x !== role.id
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
            !cfg.security.protectedChannels
              .includes(channel.id)
          ) {
            cfg.security.protectedChannels.push(
              channel.id
            );
          }
        }

        if (
          sub ===
          "unprotectedchannel"
        ) {
          const channel =
            interaction.options.getChannel(
              "channel"
            );

          cfg.security.protectedChannels =
            cfg.security.protectedChannels
              .filter(
                x => x !== channel.id
              );
        }

        save();

        if (
          sub === "status"
        ) {
          return interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setTitle(
                  "🔐 Security Status"
                )
                .addFields(
                  field(
                    "Enabled",
                    cfg.security.enabled
                      ? "ON"
                      : "OFF",
                    true
                  ),
                  field(
                    "Trusted Users",
                    cfg.security.trustedUsers.length,
                    true
                  ),
                  field(
                    "Trusted Bots",
                    cfg.security.trustedBots.length,
                    true
                  ),
                  field(
                    "Trusted Members",
                    cfg.security.trustedMembers.length,
                    true
                  ),
                  field(
                    "Protected Roles",
                    cfg.security.protectedRoles.length,
                    true
                  ),
                  field(
                    "Protected Channels",
                    cfg.security.protectedChannels.length,
                    true
                  )
                )
            ]
          });
        }

        if (
          sub === "list"
        ) {
          return interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setTitle(
                  "🔐 Security Lists"
                )
                .setDescription(
                  [
                    `**Trusted Users:** ${cfg.security.trustedUsers.map(x => `<@${x}>`).join(", ") || "None"}`,
                    `**Trusted Bots:** ${cfg.security.trustedBots.map(x => `<@${x}>`).join(", ") || "None"}`,
                    `**Trusted Members:** ${cfg.security.trustedMembers.map(x => `<@${x}>`).join(", ") || "None"}`,
                    `**Trusted Role:** ${cfg.security.trustedRoleId ? `<@&${cfg.security.trustedRoleId}>` : "None"}`,
                    `**Protected Roles:** ${cfg.security.protectedRoles.map(x => `<@&${x}>`).join(", ") || "None"}`,
                    `**Protected Channels:** ${cfg.security.protectedChannels.map(x => `<#${x}>`).join(", ") || "None"}`
                  ].join("\n")
                )
            ],
            ephemeral: true
          });
        }

        return interaction.reply(
          "🔐 Security configuration updated."
        );
      }

      /* =========================
         CONFIG
      ========================= */

      if (
        command ===
        "config"
      ) {
        const sub =
          interaction.options.getSubcommand();

        if (
          sub === "log"
        ) {
          const type =
            interaction.options.getString(
              "type"
            );

          const channel =
            interaction.options.getChannel(
              "channel"
            );

          cfg.logs[type] =
            channel.id;

          save();

          return interaction.reply(
            `✅ **${type}** logs will now use ${channel}.`
          );
        }

        if (
          sub ===
          "suggestions"
        ) {
          cfg.suggestions.channelId =
            interaction.options.getChannel(
              "channel"
            ).id;

          save();

          return interaction.reply(
            "✅ Suggestion channel configured."
          );
        }

        if (
          sub === "timeout"
        ) {
          const type =
            interaction.options.getString(
              "type"
            );

          const seconds =
            interaction.options.getInteger(
              "seconds"
            );

          cfg.automod.timeoutSeconds[
            type
          ] = seconds;

          save();

          return interaction.reply(
            `✅ AutoMod **${type}** timeout set to **${seconds}s**.`
          );
        }

        if (
          sub === "security"
        ) {
          const values = [
            ["mass_ban", "massBan"],
            ["mass_kick", "massKick"],
            [
              "mass_channel_delete",
              "massChannelDelete"
            ],
            [
              "mass_channel_create",
              "massChannelCreate"
            ],
            [
              "mass_role_delete",
              "massRoleDelete"
            ],
            [
              "mass_role_create",
              "massRoleCreate"
            ]
          ];

          for (
            const [option, key]
            of values
          ) {
            const value =
              interaction.options.getInteger(
                option
              );

            if (
              value !== null
            ) {
              cfg.security[key] =
                value;
            }
          }

          save();

          return interaction.reply(
            "✅ Security thresholds updated."
          );
        }
      }

      /* =========================
         MODERATION
      ========================= */

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
          command === "unban"
        ) {
          const id =
            interaction.options.getString(
              "user_id"
            );

          await guild.members
            .unban(
              id,
              reason
            )
            .catch(err => {
              throw new Error(
                `Could not unban user: ${err.message}`
              );
            });

          await addPunishment(
            guild,
            id,
            "unban",
            reason,
            interaction.user.id
          );

          await sendLog(
            guild,
            "moderation",
            "🔓 User Unbanned",
            [
              field(
                "User ID",
                id
              ),
              field(
                "Moderator",
                interaction.user.toString()
              ),
              field(
                "Reason",
                reason
              )
            ]
          );

          return interaction.reply(
            `✅ **${id}** has been unbanned.`
          );
        }

        const user =
          interaction.options.getUser(
            "user"
          );

        const member =
          await guild.members
            .fetch(
              user.id
            )
            .catch(() => null);

        if (!member) {
          return interaction.reply(
            "❌ Member not found."
          );
        }

        if (
          command === "warn"
        ) {
          const count =
            await addWarning(
              member,
              reason,
              interaction.user.id
            );

          /* ESCALATION */

          if (
            count >= 5 &&
            member.moderatable
          ) {
            await member.timeout(
              86400000,
              "AkiyO warning escalation"
            ).catch(() => {});
          }

          if (
            count >= 3 &&
            member.moderatable
          ) {
            await member.timeout(
              3600000,
              "AkiyO warning escalation"
            ).catch(() => {});
          }

          await sendLog(
            guild,
            "moderation",
            "⚠️ Warning",
            [
              field(
                "User",
                user.toString()
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
                count
              )
            ],
            0xfee75c
          );

          return interaction.reply(
            `⚠️ ${user} warned. Total warnings: **${count}**.`
          );
        }

        if (
          command ===
          "timeout"
        ) {
          const seconds =
            interaction.options.getInteger(
              "seconds"
            );

          if (
            !member.moderatable
          ) {
            return interaction.reply(
              "❌ I cannot timeout this member."
            );
          }

          await member.timeout(
            seconds * 1000,
            reason
          );

          await addPunishment(
            guild,
            user.id,
            "timeout",
            reason,
            interaction.user.id
          );

          return interaction.reply(
            `⏱️ ${user} timed out for **${seconds}s**.`
          );
        }

        if (
          command === "kick"
        ) {
          if (
            !member.kickable
          ) {
            return interaction.reply(
              "❌ I cannot kick this member."
            );
          }

          await member.kick(
            reason
          );

          await addPunishment(
            guild,
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
          command === "ban"
        ) {
          if (
            !member.bannable
          ) {
            return interaction.reply(
              "❌ I cannot ban this member."
            );
          }

          await member.ban({
            reason
          });

          await addPunishment(
            guild,
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

        const list =
          command ===
          "warnings"
            ? cfg.warnings[user.id] ||
              []
            : cfg.punishments[user.id] ||
              [];

        const description =
          list.length
            ? list
                .slice(-10)
                .map(
                  (item, index) =>
                    `${index + 1}. **${item.type || "warn"}** — ${item.reason} — <t:${Math.floor(item.time / 1000)}:R>`
                )
                .join("\n")
            : "None.";

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                command ===
                  "warnings"
                  ? "⚠️ Warning History"
                  : "⚖️ Punishment History"
              )
              .setDescription(
                description
              )
          ],
          ephemeral: true
        });
      }

      /* =========================
         SUGGESTION
      ========================= */

      if (
        command ===
        "suggest"
      ) {
        const text =
          interaction.options.getString(
            "text"
          );

        const channel =
          cfg.suggestions.channelId
            ? await guild.channels
                .fetch(
                  cfg.suggestions.channelId
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

        const message =
          await channel.send({
            embeds: [
              new EmbedBuilder()
                .setTitle(
                  "💡 New Suggestion"
                )
                .setDescription(
                  text
                )
                .addFields(
                  field(
                    "Suggested by",
                    interaction.user.toString()
                  )
                )
                .setColor(0x5865f2)
                .setTimestamp()
            ]
          });

        const row =
          new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(
                  `suggest_approve:${message.id}`
                )
                .setLabel("Approve")
                .setEmoji("✅")
                .setStyle(
                  ButtonStyle.Success
                ),

              new ButtonBuilder()
                .setCustomId(
                  `suggest_decline:${message.id}`
                )
                .setLabel("Decline")
                .setEmoji("❌")
                .setStyle(
                  ButtonStyle.Danger
                )
            );

        await message.edit({
          components: [row]
        });

        return interaction.reply({
          content:
            `✅ Suggestion posted: ${message.url}`,
          ephemeral: true
        });
      }

      /* =========================
         ANNOUNCE
      ========================= */

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

        const image =
          interaction.options.getString(
            "image"
          );

        const thumbnail =
          interaction.options.getString(
            "thumbnail"
          );

        const useEmbed =
          interaction.options.getBoolean(
            "embed"
          );

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

        let prefix = "";

        if (everyone) {
          prefix +=
            "@everyone ";
        }

        if (here) {
          prefix +=
            "@here ";
        }

        if (role) {
          prefix +=
            `${role} `;
        }

        if (user) {
          prefix +=
            `${user} `;
        }

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
          content:
            prefix + message,
          allowedMentions
        };

        if (
          useEmbed ||
          title ||
          footer ||
          image ||
          thumbnail
        ) {
          const embed =
            new EmbedBuilder()
              .setDescription(
                message
              );

          if (title) {
            embed.setTitle(
              title
            );
          }

          if (footer) {
            embed.setFooter({
              text: footer
            });
          }

          if (image) {
            embed.setImage(
              image
            );
          }

          if (thumbnail) {
            embed.setThumbnail(
              thumbnail
            );
          }

          payload.content =
            prefix;

          payload.embeds = [
            embed
          ];
        }

        await channel.send(
          payload
        );

        await sendLog(
          guild,
          "announcements",
          "📢 Announcement",
          [
            field(
              "Channel",
              channel.toString()
            ),
            field(
              "Author",
              interaction.user.toString()
            )
          ]
        );

        return interaction.reply({
          content:
            "✅ Announcement sent.",
          ephemeral: true
        });
      }

      /* =========================
         AUTOROLE
      ========================= */

      if (
        command ===
        "autorole"
      ) {
        const sub =
          interaction.options.getSubcommand();

        if (
          sub === "set"
        ) {
          const role =
            interaction.options.getRole(
              "role"
            );

          if (
            role.position >=
            guild.members.me
              .roles.highest.position
          ) {
            return interaction.reply(
              "❌ My highest role must be above that role."
            );
          }

          cfg.autorole = {
            enabled: true,
            roleId: role.id
          };
        }

        if (
          sub === "disable"
        ) {
          cfg.autorole.enabled =
            false;
        }

        save();

        if (
          sub === "status"
        ) {
          return interaction.reply(
            `👤 Autorole: **${cfg.autorole.enabled ? "ON" : "OFF"}**\n` +
            `Role: ${
              cfg.autorole.roleId
                ? `<@&${cfg.autorole.roleId}>`
                : "None"
            }`
          );
        }

        return interaction.reply(
          "✅ Autorole updated."
        );
      }

      /* =========================
         WELCOME
      ========================= */

      if (
        command ===
        "welcome"
      ) {
        const sub =
          interaction.options.getSubcommand();

        if (
          sub === "set"
        ) {
          cfg.welcome = {
            enabled: true,
            channelId:
              interaction.options.getChannel(
                "channel"
              ).id,
            message:
              interaction.options.getString(
                "message"
              )
          };
        }

        if (
          sub === "disable"
        ) {
          cfg.welcome.enabled =
            false;
        }

        save();

        if (
          sub === "status"
        ) {
          return interaction.reply(
            `👋 Welcome: **${cfg.welcome.enabled ? "ON" : "OFF"}**\n` +
            `Channel: ${
              cfg.welcome.channelId
                ? `<#${cfg.welcome.channelId}>`
                : "None"
            }`
          );
        }

        return interaction.reply(
          "✅ Welcome system updated."
        );
      }

      /* =========================
         VERIFICATION
      ========================= */

      if (
        command ===
        "verification"
      ) {
        const sub =
          interaction.options.getSubcommand();

        if (
          sub === "setup"
        ) {
          const channel =
            interaction.options.getChannel(
              "channel"
            );

          const role =
            interaction.options.getRole(
              "role"
            );

          if (
            role.position >=
            guild.members.me
              .roles.highest.position
          ) {
            return interaction.reply(
              "❌ My highest role must be above the verified role."
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
                new EmbedBuilder()
                  .setTitle(
                    "✅ Server Verification"
                  )
                  .setDescription(
                    "Click the button below to verify yourself."
                  )
              ],
              components: [row]
            });

          cfg.verification = {
            enabled: true,
            channelId:
              channel.id,
            roleId:
              role.id,
            messageId:
              message.id
          };
        }

        if (
          sub === "disable"
        ) {
          cfg.verification.enabled =
            false;
        }

        save();

        if (
          sub === "status"
        ) {
          return interaction.reply(
            `✅ Verification: **${cfg.verification.enabled ? "ON" : "OFF"}**\n` +
            `Role: ${
              cfg.verification.roleId
                ? `<@&${cfg.verification.roleId}>`
                : "None"
            }`
          );
        }

        return interaction.reply(
          "✅ Verification updated."
        );
      }

      /* =========================
         REACTION ROLES
      ========================= */

      if (
        command ===
        "autoreactionrole"
      ) {
        const sub =
          interaction.options.getSubcommand();

        if (
          sub === "add"
        ) {
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

          if (
            role.position >=
            guild.members.me
              .roles.highest.position
          ) {
            return interaction.reply(
              "❌ My highest role must be above that role."
            );
          }

          cfg.reactionRoles[
            messageId
          ] ||= {};

          cfg.reactionRoles[
            messageId
          ][emoji] = {
            roleId: role.id
          };

          await message.react(
            emoji
          ).catch(() => {});

          save();

          return interaction.reply(
            `✅ Reaction role added: ${emoji} → ${role}`
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

          if (
            cfg.reactionRoles[
              messageId
            ]
          ) {
            delete cfg.reactionRoles[
              messageId
            ][emoji];
          }

          save();

          return interaction.reply(
            "✅ Reaction role removed."
          );
        }

        const list = [];

        for (
          const [
            messageId,
            reactions
          ] of Object.entries(
            cfg.reactionRoles
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
              `${emoji} → <@&${data.roleId}> — ${messageId}`
            );
          }
        }

        return interaction.reply(
          list.join("\n") ||
          "No reaction roles configured."
        );
      }

      /* =========================
         LEADERBOARD
      ========================= */

      if (
        command ===
        "leaderboard"
      ) {
        const sub =
          interaction.options.getSubcommand();

        if (
          sub === "reset"
        ) {
          cfg.leaderboard.messages =
            {};

          save();

          return interaction.reply(
            "🏆 Leaderboard reset."
          );
        }

        if (
          sub === "enable"
        ) {
          cfg.leaderboard.enabled =
            true;

          save();

          return interaction.reply(
            "🏆 Leaderboard enabled."
          );
        }

        if (
          sub === "disable"
        ) {
          cfg.leaderboard.enabled =
            false;

          save();

          return interaction.reply(
            "🏆 Leaderboard disabled."
          );
        }

        if (
          sub === "status"
        ) {
          return interaction.reply(
            `🏆 Leaderboard: **${cfg.leaderboard.enabled ? "ON" : "OFF"}**`
          );
        }

        const top =
          Object.entries(
            cfg.leaderboard.messages
          )
            .sort(
              (a, b) =>
                b[1] - a[1]
            )
            .slice(0, 10);

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                "🏆 Message Leaderboard"
              )
              .setDescription(
                top.length
                  ? top
                      .map(
                        ([id, count], index) =>
                          `**${index + 1}.** <@${id}> — **${count}** messages`
                      )
                      .join("\n")
                  : "No messages yet."
              )
          ]
        });
      }

      /* =========================
         ADS
      ========================= */

      if (
        command ===
        "ads"
      ) {
        if (
          !isOwner(
            interaction.user.id
          )
        ) {
          return interaction.reply({
            content:
              "❌ Owner only.",
            ephemeral: true
          });
        }

        const sub =
          interaction.options.getSubcommand();

        if (
          sub === "set"
        ) {
          cfg.ads.channelId =
            interaction.options.getChannel(
              "channel"
            ).id;

          save();

          return interaction.reply(
            "📢 Advertisement channel saved."
          );
        }

        if (
          sub === "message"
        ) {
          cfg.ads.message =
            interaction.options.getString(
              "text"
            );

          save();

          return interaction.reply(
            "📢 Advertisement message saved."
          );
        }

        if (
          sub === "enable"
        ) {
          cfg.ads.enabled =
            true;

          save();

          return interaction.reply(
            "📢 Ads enabled."
          );
        }

        if (
          sub === "disable"
        ) {
          cfg.ads.enabled =
            false;

          save();

          return interaction.reply(
            "📢 Ads disabled."
          );
        }

        if (
          sub === "status"
        ) {
          return interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setTitle(
                  "📢 Advertisement Status"
                )
                .addFields(
                  field(
                    "Enabled",
                    cfg.ads.enabled
                      ? "ON"
                      : "OFF"
                  ),
                  field(
                    "Channel",
                    cfg.ads.channelId
                      ? `<#${cfg.ads.channelId}>`
                      : "None"
                  ),
                  field(
                    "Message",
                    cfg.ads.message
                  )
                )
            ],
            ephemeral: true
          });
        }

        if (
          sub === "broadcast"
        ) {
          let sent = 0;

          for (
            const targetGuild
            of client.guilds.cache.values()
          ) {
            const targetCfg =
              getGuildConfig(
                targetGuild.id
              );

            if (
              !targetCfg.ads.enabled ||
              !targetCfg.ads.channelId
            ) {
              continue;
            }

            const channel =
              await targetGuild.channels
                .fetch(
                  targetCfg.ads.channelId
                )
                .catch(() => null);

            if (
              channel &&
              channel.isTextBased()
            ) {
              await channel
                .send(
                  targetCfg.ads.message
                )
                .catch(() => {});

              sent++;
            }
          }

          return interaction.reply(
            `📢 Advertisement broadcast sent to **${sent}** configured servers.`
          );
        }
      }

      /* =========================
         BOT INFO
      ========================= */

      if (
        command ===
        "botinfo"
      ) {
        const users =
          client.guilds.cache.reduce(
            (total, g) =>
              total +
              (g.memberCount || 0),
            0
          );

        const uptime =
          Math.floor(
            process.uptime()
          );

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                "🤖 AkiyO Bot Information"
              )
              .setDescription(
                "A powerful multi-server Discord support, moderation and security bot."
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
                  users,
                  true
                ),
                field(
                  "Commands",
                  commands.length,
                  true
                ),
                field(
                  "Node",
                  process.version,
                  true
                ),
                field(
                  "discord.js",
                  require("discord.js").version,
                  true
                ),
                field(
                  "Uptime",
                  `${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
                  true
                )
              )
              .setTimestamp()
          ]
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

      const guild =
        reaction.message.guild;

      if (!guild) return;

      const cfg =
        getGuildConfig(
          guild.id
        );

      const emojiKey =
        reaction.emoji.id ||
        reaction.emoji.name;

      const reactionData =
        cfg.reactionRoles?.[
          reaction.message.id
        ]?.[emojiKey];

      if (!reactionData) {
        return;
      }

      const member =
        await guild.members
          .fetch(
            user.id
          )
          .catch(() => null);

      const role =
        await guild.roles
          .fetch(
            reactionData.roleId
          )
          .catch(() => null);

      if (
        member &&
        role &&
        role.position <
          guild.members.me
            .roles.highest.position
      ) {
        await member.roles
          .add(
            role,
            "AkiyO Reaction Role"
          )
          .catch(() => {});
      }
    } catch (err) {
      console.error(
        "reactionAdd:",
        err
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

      const guild =
        reaction.message.guild;

      if (!guild) return;

      const cfg =
        getGuildConfig(
          guild.id
        );

      const emojiKey =
        reaction.emoji.id ||
        reaction.emoji.name;

      const reactionData =
        cfg.reactionRoles?.[
          reaction.message.id
        ]?.[emojiKey];

      if (!reactionData) {
        return;
      }

      const member =
        await guild.members
          .fetch(
            user.id
          )
          .catch(() => null);

      const role =
        await guild.roles
          .fetch(
            reactionData.roleId
          )
          .catch(() => null);

      if (
        member &&
        role
      ) {
        await member.roles
          .remove(
            role,
            "AkiyO Reaction Role"
          )
          .catch(() => {});
      }
    } catch (err) {
      console.error(
        "reactionRemove:",
        err
      );
    }
  }
);

/* =========================================================
   READY
========================================================= */

client.once(
  "clientReady",
  async () => {
    console.log(
      `✅ Logged in as ${client.user.tag}`
    );

    console.log(
      `🌐 Connected to ${client.guilds.cache.size} servers.`
    );

    try {
      await registerCommands();
    } catch (err) {
      console.error(
        "❌ Slash command registration error:",
        err
      );
    }

    console.log(
      `🤖 AkiyO online — ${commands.length} global commands.`
    );
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
