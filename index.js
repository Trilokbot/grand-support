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
   Single-file full system
   discord.js 14.27.0
   Node.js 22.x
========================================================= */

/* =========================
   WEB SERVER
========================= */

const PORT = Number(process.env.PORT) || 10000;

http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain"
  });
  res.end("AKIYO BOT ONLINE");
}).listen(PORT, "0.0.0.0");

/* =========================
   ENVIRONMENT
========================= */

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const GUILD_ID = "1493700265499689154";
const SUPPORT_ROLE_ID = "1542498406981959801";
const SUPPORT_LOG_CHANNEL_ID = "1542500573000106024";

if (!TOKEN || !CLIENT_ID) {
  console.error("❌ DISCORD_TOKEN and CLIENT_ID are required.");
  process.exit(1);
}

/* =========================
   CLIENT
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
  fs.mkdirSync(DATA_DIR, {
    recursive: true
  });
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
    trustedBots: []
  },

  logs: Object.fromEntries(
    LOG_TYPES.map(type => [
      type,
      SUPPORT_LOG_CHANNEL_ID
    ])
  ),

  ticketCategoryId: null,
  suggestionsChannelId: null,

  warnings: {},
  punishments: {},

  guilds: {}
};

const GUILD_DEFAULT = {
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

  trusted: {
    roleId: null,
    members: [],
    bots: []
  },

  protectedRoles: [],
  protectedChannels: [],

  logs: Object.fromEntries(
    LOG_TYPES.map(type => [
      type,
      SUPPORT_LOG_CHANNEL_ID
    ])
  ),

  support: {
    categoryId: null,
    supportRoleId: SUPPORT_ROLE_ID
  }
};

function merge(target, source) {
  for (const key of Object.keys(source || {})) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key])
    ) {
      target[key] = merge(
        target[key] || {},
        source[key]
      );
    } else if (source[key] !== undefined) {
      target[key] = source[key];
    }
  }

  return target;
}

let config = JSON.parse(
  JSON.stringify(DEFAULT)
);

try {
  if (fs.existsSync(DATA_FILE)) {
    const saved = JSON.parse(
      fs.readFileSync(DATA_FILE, "utf8")
    );

    config = merge(config, saved);
  }
} catch (error) {
  console.error(
    "❌ Database load error:",
    error.message
  );
}

function save() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(config, null, 2)
    );
  } catch (error) {
    console.error(
      "❌ Database save error:",
      error.message
    );
  }
}

function gc(guild) {
  if (!guild) return null;

  const id = guild.id;

  if (!config.guilds[id]) {
    config.guilds[id] = JSON.parse(
      JSON.stringify(GUILD_DEFAULT)
    );
  }

  config.guilds[id] = merge(
    JSON.parse(
      JSON.stringify(GUILD_DEFAULT)
    ),
    config.guilds[id]
  );

  return config.guilds[id];
}

/* =========================
   MEMORY
========================= */

const tickets = new Map();
const claims = new Map();

const spamTracker = new Map();
const repeatTracker = new Map();

const securityTracker = new Map();
const raidTracker = new Map();

/* =========================
   HELPERS
========================= */

function field(name, value, inline = false) {
  return {
    name: String(name).slice(0, 256),
    value: String(value || "-").slice(0, 1024),
    inline
  };
}

function staff(member) {
  if (!member) return false;

  const c = gc(member.guild);

  return (
    member.permissions.has(
      PermissionFlagsBits.Administrator
    ) ||
    member.roles.cache.has(
      c.support.supportRoleId ||
      SUPPORT_ROLE_ID
    )
  );
}

function manager(member) {
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

function owner(userId) {
  const owners = new Set(
    (process.env.BOT_OWNER_IDS || "")
      .split(",")
      .map(x => x.trim())
      .filter(Boolean)
  );

  if (client.application?.owner?.id) {
    owners.add(
      client.application.owner.id
    );
  }

  if (client.application?.owner?.members) {
    for (const member of client.application.owner.members.values()) {
      owners.add(member.id);
    }
  }

  return owners.has(userId);
}

function botMember(guild) {
  return guild.members.me;
}

function canManageRole(guild, role) {
  const me = botMember(guild);

  if (!me || !role) return false;

  return role.position < me.roles.highest.position;
}

function trusted(guild, userId) {
  if (!guild || !userId) return false;

  const c = gc(guild);

  const member =
    guild.members.cache.get(userId);

  if (
    member?.permissions.has(
      PermissionFlagsBits.Administrator
    )
  ) {
    return true;
  }

  if (
    config.security.trustedUsers.includes(
      userId
    )
  ) {
    return true;
  }

  if (
    config.security.trustedBots.includes(
      userId
    )
  ) {
    return true;
  }

  if (
    c.trusted.members.includes(
      userId
    )
  ) {
    return true;
  }

  if (
    c.trusted.bots.includes(
      userId
    )
  ) {
    return true;
  }

  if (
    c.trusted.roleId &&
    member?.roles.cache.has(
      c.trusted.roleId
    )
  ) {
    return true;
  }

  return false;
}

async function getLogChannel(guild, type) {
  const c = gc(guild);

  const id =
    c.logs[type] ||
    config.logs[type] ||
    SUPPORT_LOG_CHANNEL_ID;

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
  color
) {
  if (!guild) return;

  const channel =
    await getLogChannel(
      guild,
      type
    );

  if (!channel?.isTextBased()) {
    return;
  }

  const embed =
    new EmbedBuilder()
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

function template(text, member) {
  return String(text)
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

/* =========================================================
   WARNINGS / PUNISHMENTS
========================================================= */

async function addWarning(
  member,
  reason,
  moderatorId
) {
  const guildId =
    member.guild.id;

  config.warnings[guildId] ??= {};
  config.warnings[guildId][member.id] ??= [];

  config.warnings[guildId][member.id].push({
    reason,
    moderatorId,
    time: Date.now()
  });

  await recordPunishment(
    member.guild,
    member.id,
    "warn",
    reason,
    moderatorId
  );

  save();

  return config.warnings[
    guildId
  ][member.id].length;
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

  config.punishments[
    guild.id
  ][userId].push({
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

async function autoPunish(
  message,
  type,
  reason
) {
  const member =
    message.member;

  const action =
    config.automod.actions[type] ||
    "delete";

  await message
    .delete()
    .catch(() => {});

  if (
    action === "timeout" &&
    member?.moderatable
  ) {
    const seconds =
      config.automod.timeoutSeconds[
        type
      ] || 60;

    await member
      .timeout(
        seconds * 1000,
        `AkiyO AutoMod: ${reason}`
      )
      .catch(() => {});
  }

  if (
    action === "warn" &&
    member
  ) {
    await addWarning(
      member,
      `AutoMod: ${reason}`,
      client.user.id
    );
  }

  await log(
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

async function runAutoMod(message) {
  if (
    !message.guild ||
    !message.member ||
    message.author.bot
  ) {
    return;
  }

  if (!config.automod.enabled) {
    return;
  }

  if (staff(message.member)) {
    return;
  }

  const content =
    message.content || "";

  const lower =
    content.toLowerCase();

  /* INVITE */

  if (
    config.automod.invite &&
    /discord(?:\.gg|\.com\/invite)\/[A-Za-z0-9-]+/i.test(
      content
    )
  ) {
    return autoPunish(
      message,
      "invite",
      "Discord invite link"
    );
  }

  /* MASS MENTION */

  if (
    config.automod.massMentions &&
    (
      message.mentions.everyone ||
      message.mentions.users.size >=
        config.automod.userMentionsLimit ||
      message.mentions.roles.size >=
        config.automod.roleMentionsLimit
    )
  ) {
    return autoPunish(
      message,
      "massmention",
      "Mass/excessive mentions"
    );
  }

  /* BAD WORD */

  for (
    const word of config.automod.badWords
  ) {
    if (
      word &&
      lower.includes(
        String(word).toLowerCase()
      )
    ) {
      return autoPunish(
        message,
        "badword",
        `Blocked word: ${word}`
      );
    }
  }

  /* CAPS */

  const letters =
    content.replace(
      /[^A-Za-z]/g,
      ""
    );

  if (letters.length >= 8) {
    const upper =
      letters.replace(
        /[^A-Z]/g,
        ""
      ).length;

    const percent =
      (upper / letters.length) * 100;

    if (
      percent >=
      config.automod.capsPercent
    ) {
      return autoPunish(
        message,
        "caps",
        "Excessive capital letters"
      );
    }
  }

  /* SPAM */

  const spamKey =
    `${message.guild.id}:${message.author.id}`;

  const now = Date.now();

  const spam =
    (
      spamTracker.get(spamKey) ||
      []
    ).filter(
      x =>
        now - x <
        config.automod.spamWindow
    );

  spam.push(now);

  spamTracker.set(
    spamKey,
    spam
  );

  if (
    spam.length >=
    config.automod.spamLimit
  ) {
    spamTracker.delete(
      spamKey
    );

    return autoPunish(
      message,
      "spam",
      `Spam detected: ${spam.length} messages`
    );
  }

  /* REPEATED MESSAGE */

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
    content &&
    now - old.time < 30000
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
    old.count >=
    config.automod.repeatedLimit
  ) {
    repeatTracker.delete(
      repeatKey
    );

    return autoPunish(
      message,
      "repeat",
      "Repeated message"
    );
  }
}

/* =========================================================
   ANTI-NUKE
========================================================= */

async function antiNuke(
  guild,
  event,
  executorId,
  targetId,
  description
) {
  if (
    !guild ||
    !executorId ||
    !config.security.enabled
  ) {
    return;
  }

  if (
    trusted(
      guild,
      executorId
    )
  ) {
    return;
  }

  const c = gc(guild);

  /* PROTECTED ROLE */

  if (
    event === "roleDelete" &&
    targetId &&
    c.protectedRoles.includes(
      targetId
    )
  ) {
    await log(
      guild,
      "security",
      "🚨 PROTECTED ROLE ATTACK",
      [
        field(
          "Executor",
          `<@${executorId}>`
        ),
        field(
          "Role",
          `<@&${targetId}>`
        )
      ],
      0xed4245
    );

    return;
  }

  /* PROTECTED CHANNEL */

  if (
    event === "channelDelete" &&
    targetId &&
    c.protectedChannels.includes(
      targetId
    )
  ) {
    await log(
      guild,
      "security",
      "🚨 PROTECTED CHANNEL ATTACK",
      [
        field(
          "Executor",
          `<@${executorId}>`
        ),
        field(
          "Channel",
          `<#${targetId}>`
        )
      ],
      0xed4245
    );

    return;
  }

  const key =
    `${guild.id}:${event}:${executorId}`;

  const now =
    Date.now();

  const actions =
    (
      securityTracker.get(
        key
      ) || []
    ).filter(
      x => now - x < 30000
    );

  actions.push(now);

  securityTracker.set(
    key,
    actions
  );

  const limits = {
    ban:
      config.security.massBan,

    kick:
      config.security.massKick,

    channelDelete:
      config.security.massChannelDelete,

    roleDelete:
      config.security.massRoleDelete,

    channelCreate:
      config.security.massChannelCreate,

    roleCreate:
      config.security.massRoleCreate
  };

  const limit =
    limits[event] || 999;

  if (
    actions.length >= limit
  ) {
    await log(
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
          actions.length
        ),
        field(
          "Details",
          description
        )
      ],
      0xed4245
    );

    securityTracker.delete(
      key
    );

    if (
      config.security.action ===
      "ban"
    ) {
      const member =
        await guild.members
          .fetch(executorId)
          .catch(() => null);

      if (
        member?.bannable
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
}

/* =========================================================
   TICKET SYSTEM
========================================================= */

function ticketForChannel(
  channelId
) {
  for (
    const [
      userId,
      ticket
    ] of tickets
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
        ),

      new ButtonBuilder()
        .setCustomId(
          "ticket_unlock"
        )
        .setLabel("Unlock")
        .setEmoji("🔓")
        .setStyle(
          ButtonStyle.Success
        )
    );
}

async function createTicket(user) {
  const guild =
    await client.guilds
      .fetch(GUILD_ID)
      .catch(() => null);

  if (!guild) {
    return null;
  }

  const existing =
    tickets.get(user.id);

  if (existing) {
    const old =
      await guild.channels
        .fetch(existing.channelId)
        .catch(() => null);

    if (old) {
      return old;
    }

    tickets.delete(
      user.id
    );
  }

  const c = gc(guild);

  const category =
    c.support.categoryId ||
    config.ticketCategoryId;

  const supportRole =
    c.support.supportRoleId ||
    SUPPORT_ROLE_ID;

  const cleanName =
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
        `ticket-${cleanName}`,

      type:
        ChannelType.GuildText,

      parent:
        category || undefined,

      topic:
        `TRILOK_TICKET:${user.id}`,

      permissionOverwrites: [
        {
          id:
            guild.roles.everyone.id,

          deny: [
            PermissionFlagsBits.ViewChannel
          ]
        },

        {
          id: supportRole,

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
    user.id,
    {
      channelId:
        channel.id,
      created:
        Date.now()
    }
  );

  await channel.send({
    content:
      `<@&${supportRole}>`,

    embeds: [
      new EmbedBuilder()
        .setTitle(
          "🎫 New Support Ticket"
        )
        .setDescription(
          `User: <@${user.id}>\n\nPlease assist the user.`
        )
        .setTimestamp()
    ],

    components: [
      ticketButtons()
    ]
  });

  await user
    .send(
      "🎫 Your support ticket has been created. Please send your message here."
    )
    .catch(() => {});

  await log(
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

async function transcript(channel) {
  const messages = [];

  let before;

  while (
    messages.length < 10000
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
      .map(m => {
        const attachments =
          [...m.attachments.values()]
            .map(x => x.url)
            .join("\n");

        return [
          `[${m.createdAt.toISOString()}] ${m.author.tag} (${m.author.id})`,
          m.content || "",
          attachments
        ].join("\n");
      })
      .join("\n\n");

  return Buffer.from(
    text,
    "utf8"
  );
}

async function closeTicket(
  userId,
  channel,
  closedBy
) {
  const guild =
    channel.guild;

  const file =
    await transcript(channel);

  const logChannel =
    await getLogChannel(
      guild,
      "tickets"
    );

  if (
    logChannel?.isTextBased()
  ) {
    await logChannel
      .send({
        content:
          `📄 Ticket transcript — <@${userId}>`,

        files: [
          {
            attachment:
              file,

            name:
              `ticket-${channel.id}.txt`
          }
        ]
      })
      .catch(() => {});
  }

  await channel
    .permissionOverwrites
    .edit(
      userId,
      {
        ViewChannel: true,
        SendMessages: false
      }
    )
    .catch(() => {});

  await channel
    .send(
      "🔒 **Ticket closed.** Use `/reopen` if you need to reopen it."
    )
    .catch(() => {});

  await log(
    guild,
    "tickets",
    "🔒 Ticket Closed",
    [
      field(
        "User",
        `<@${userId}>`
      ),
      field(
        "Closed By",
        closedBy.toString()
      )
    ]
  );
}

/* =========================================================
   COMMANDS
========================================================= */

const commands = [];

function add(command) {
  commands.push(
    command.toJSON()
  );
}

/* TICKETS */

add(
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription(
      "Create a support ticket."
    )
);

add(
  new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription(
      "Send the support ticket panel."
    )
);

add(
  new SlashCommandBuilder()
    .setName("ticketsetup")
    .setDescription(
      "Configure ticket category."
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
);

for (
  const command of [
    "close",
    "reopen",
    "delete",
    "claim",
    "unclaim",
    "lock",
    "unlock"
  ]
) {
  add(
    new SlashCommandBuilder()
      .setName(command)
      .setDescription(
        `${command} ticket.`
      )
  );
}

/* AUTOMOD */

add(
  new SlashCommandBuilder()
    .setName("automod")
    .setDescription(
      "Advanced AutoMod system."
    )

    .addSubcommand(s =>
      s.setName("enable")
        .setDescription(
          "Enable AutoMod."
        )
    )

    .addSubcommand(s =>
      s.setName("disable")
        .setDescription(
          "Disable AutoMod."
        )
    )

    .addSubcommand(s =>
      s.setName("status")
        .setDescription(
          "Show AutoMod status."
        )
    )

    .addSubcommand(s =>
      s.setName("config")
        .setDescription(
          "Configure AutoMod."
        )
        .addIntegerOption(o =>
          o.setName("spam_limit")
            .setDescription(
              "Spam message limit."
            )
            .setMinValue(3)
            .setMaxValue(30)
        )
        .addIntegerOption(o =>
          o.setName("timeout")
            .setDescription(
              "Auto timeout seconds."
            )
            .setMinValue(10)
            .setMaxValue(604800)
        )
        .addIntegerOption(o =>
          o.setName("caps_percent")
            .setDescription(
              "Caps percentage."
            )
            .setMinValue(50)
            .setMaxValue(100)
        )
    )

    .addSubcommand(s =>
      s.setName("badword")
        .setDescription(
          "Add a blocked word."
        )
        .addStringOption(o =>
          o.setName("word")
            .setDescription(
              "Word."
            )
            .setRequired(true)
        )
    )

    .addSubcommand(s =>
      s.setName("removebadword")
        .setDescription(
          "Remove a blocked word."
        )
        .addStringOption(o =>
          o.setName("word")
            .setDescription(
              "Word."
            )
            .setRequired(true)
        )
    )
);

/* SECURITY */

add(
  new SlashCommandBuilder()
    .setName("security")
    .setDescription(
      "Anti-Nuke and security system."
    )

    .addSubcommand(s =>
      s.setName("enable")
        .setDescription(
          "Enable security."
        )
    )

    .addSubcommand(s =>
      s.setName("disable")
        .setDescription(
          "Disable security."
        )
    )

    .addSubcommand(s =>
      s.setName("status")
        .setDescription(
          "Security status."
        )
    )

    .addSubcommand(s =>
      s.setName("trusted")
        .setDescription(
          "Add trusted user."
        )
        .addUserOption(o =>
          o.setName("user")
            .setDescription(
              "User."
            )
            .setRequired(true)
        )
    )

    .addSubcommand(s =>
      s.setName("untrusted")
        .setDescription(
          "Remove trusted user."
        )
        .addUserOption(o =>
          o.setName("user")
            .setDescription(
              "User."
            )
            .setRequired(true)
        )
    )

    .addSubcommand(s =>
      s.setName("trustedrole")
        .setDescription(
          "Set trusted role."
        )
        .addRoleOption(o =>
          o.setName("role")
            .setDescription(
              "Trusted role."
            )
            .setRequired(true)
        )
    )

    .addSubcommand(s =>
      s.setName("trustedmember")
        .setDescription(
          "Add trusted member."
        )
        .addUserOption(o =>
          o.setName("user")
            .setDescription(
              "Member."
            )
            .setRequired(true)
        )
    )

    .addSubcommand(s =>
      s.setName("untrustedmember")
        .setDescription(
          "Remove trusted member."
        )
        .addUserOption(o =>
          o.setName("user")
            .setDescription(
              "Member."
            )
            .setRequired(true)
        )
    )

    .addSubcommand(s =>
      s.setName("trustedbot")
        .setDescription(
          "Add trusted bot."
        )
        .addUserOption(o =>
          o.setName("user")
            .setDescription(
              "Bot."
            )
            .setRequired(true)
        )
    )

    .addSubcommand(s =>
      s.setName("untrustedbot")
        .setDescription(
          "Remove trusted bot."
        )
        .addUserOption(o =>
          o.setName("user")
            .setDescription(
              "Bot."
            )
            .setRequired(true)
        )
    )

    .addSubcommand(s =>
      s.setName("protectedrole")
        .setDescription(
          "Protect a role."
        )
        .addRoleOption(o =>
          o.setName("role")
            .setDescription(
              "Role."
            )
            .setRequired(true)
        )
    )

    .addSubcommand(s =>
      s.setName("unprotectedrole")
        .setDescription(
          "Remove protected role."
        )
        .addRoleOption(o =>
          o.setName("role")
            .setDescription(
              "Role."
            )
            .setRequired(true)
        )
    )

    .addSubcommand(s =>
      s.setName("protectedchannel")
        .setDescription(
          "Protect a channel."
        )
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription(
              "Channel."
            )
            .setRequired(true)
        )
    )

    .addSubcommand(s =>
      s.setName("unprotectedchannel")
        .setDescription(
          "Remove protected channel."
        )
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription(
              "Channel."
            )
            .setRequired(true)
        )
    )

    .addSubcommand(s =>
      s.setName("list")
        .setDescription(
          "List trusted/protected settings."
        )
    )
);

/* CONFIG */

add(
  new SlashCommandBuilder()
    .setName("config")
    .setDescription(
      "Configure bot systems."
    )

    .addSubcommand(s =>
      s.setName("log")
        .setDescription(
          "Set a log channel."
        )
        .addStringOption(o =>
          o.setName("type")
            .setDescription(
              "Log type."
            )
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
              "Log channel."
            )
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
    )

    .addSubcommand(s =>
      s.setName("suggestions")
        .setDescription(
          "Set suggestion channel."
        )
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription(
              "Channel."
            )
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
    )

    .addSubcommand(s =>
      s.setName("timeout")
        .setDescription(
          "Configure AutoMod timeout."
        )
        .addStringOption(o =>
          o.setName("type")
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
        .addIntegerOption(o =>
          o.setName("seconds")
            .setDescription(
              "Timeout seconds."
            )
            .setMinValue(10)
            .setMaxValue(604800)
            .setRequired(true)
        )
    )

    .addSubcommand(s =>
      s.setName("security")
        .setDescription(
          "Configure Anti-Nuke limits."
        )
        .addIntegerOption(o =>
          o.setName("mass_ban")
            .setDescription(
              "Mass ban limit."
            )
            .setMinValue(1)
            .setMaxValue(20)
        )
        .addIntegerOption(o =>
          o.setName("mass_kick")
            .setDescription(
              "Mass kick limit."
            )
            .setMinValue(1)
            .setMaxValue(20)
        )
        .addIntegerOption(o =>
          o.setName("mass_channel_delete")
            .setDescription(
              "Channel delete limit."
            )
            .setMinValue(1)
            .setMaxValue(20)
        )
        .addIntegerOption(o =>
          o.setName("mass_role_delete")
            .setDescription(
              "Role delete limit."
            )
            .setMinValue(1)
            .setMaxValue(20)
        )
    )
);

/* MODERATION */

add(
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription(
      "Warn a member."
    )
    .addUserOption(o =>
      o.setName("user")
        .setDescription(
          "Member."
        )
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription(
          "Reason."
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription(
      "Timeout a member."
    )
    .addUserOption(o =>
      o.setName("user")
        .setDescription(
          "Member."
        )
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription(
          "Reason."
        )
        .setRequired(true)
    )
    .addIntegerOption(o =>
      o.setName("seconds")
        .setDescription(
          "Timeout seconds."
        )
        .setMinValue(10)
        .setMaxValue(604800)
        .setRequired(true)
    )
);

for (
  const [name, description] of [
    ["kick", "Kick a member."],
    ["ban", "Ban a member."]
  ]
) {
  add(
    new SlashCommandBuilder()
      .setName(name)
      .setDescription(description)
      .addUserOption(o =>
        o.setName("user")
          .setDescription(
            "Member."
          )
          .setRequired(true)
      )
      .addStringOption(o =>
        o.setName("reason")
          .setDescription(
            "Reason."
          )
          .setRequired(true)
      )
  );
}

add(
  new SlashCommandBuilder()
    .setName("unban")
    .setDescription(
      "Unban a user."
    )
    .addStringOption(o =>
      o.setName("user_id")
        .setDescription(
          "User ID."
        )
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription(
          "Reason."
        )
        .setRequired(true)
    )
);

for (
  const name of [
    "warnings",
    "punishments"
  ]
) {
  add(
    new SlashCommandBuilder()
      .setName(name)
      .setDescription(
        `View ${name}.`
      )
      .addUserOption(o =>
        o.setName("user")
          .setDescription(
            "User."
          )
          .setRequired(true)
      )
  );
}

/* SUGGESTIONS */

add(
  new SlashCommandBuilder()
    .setName("suggest")
    .setDescription(
      "Create a suggestion."
    )
    .addStringOption(o =>
      o.setName("text")
        .setDescription(
          "Suggestion."
        )
        .setRequired(true)
    )
);

/* ANNOUNCEMENT */

add(
  new SlashCommandBuilder()
    .setName("announce")
    .setDescription(
      "Send a full announcement."
    )
    .addStringOption(o =>
      o.setName("message")
        .setDescription(
          "Announcement."
        )
        .setRequired(true)
    )
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription(
          "Channel."
        )
        .addChannelTypes(
          ChannelType.GuildText
        )
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("title")
        .setDescription(
          "Embed title."
        )
    )
    .addStringOption(o =>
      o.setName("footer")
        .setDescription(
          "Embed footer."
        )
    )
    .addStringOption(o =>
      o.setName("image")
        .setDescription(
          "Image URL."
        )
    )
    .addStringOption(o =>
      o.setName("thumbnail")
        .setDescription(
          "Thumbnail URL."
        )
    )
    .addBooleanOption(o =>
      o.setName("embed")
        .setDescription(
          "Use embed."
        )
    )
    .addBooleanOption(o =>
      o.setName("everyone")
        .setDescription(
          "Mention everyone."
        )
    )
    .addBooleanOption(o =>
      o.setName("here")
        .setDescription(
          "Mention here."
        )
    )
    .addRoleOption(o =>
      o.setName("role")
        .setDescription(
          "Mention role."
        )
    )
    .addUserOption(o =>
      o.setName("user")
        .setDescription(
          "Mention user."
        )
    )
);

/* AUTOROLE */

add(
  new SlashCommandBuilder()
    .setName("autorole")
    .setDescription(
      "Automatic role system."
    )
    .addSubcommand(s =>
      s.setName("set")
        .setDescription(
          "Set autorole."
        )
        .addRoleOption(o =>
          o.setName("role")
            .setDescription(
              "Role."
            )
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("disable")
        .setDescription(
          "Disable autorole."
        )
    )
    .addSubcommand(s =>
      s.setName("status")
        .setDescription(
          "Autorole status."
        )
    )
);

/* WELCOME */

add(
  new SlashCommandBuilder()
    .setName("welcome")
    .setDescription(
      "Welcome system."
    )
    .addSubcommand(s =>
      s.setName("set")
        .setDescription(
          "Configure welcome."
        )
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription(
              "Welcome channel."
            )
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName("message")
            .setDescription(
              "Welcome message."
            )
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("disable")
        .setDescription(
          "Disable welcome."
        )
    )
    .addSubcommand(s =>
      s.setName("status")
        .setDescription(
          "Welcome status."
        )
    )
);

/* VERIFICATION */

add(
  new SlashCommandBuilder()
    .setName("verification")
    .setDescription(
      "Verification system."
    )
    .addSubcommand(s =>
      s.setName("setup")
        .setDescription(
          "Setup verification."
        )
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription(
              "Verification channel."
            )
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
        .addRoleOption(o =>
          o.setName("role")
            .setDescription(
              "Verified role."
            )
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("disable")
        .setDescription(
          "Disable verification."
        )
    )
    .addSubcommand(s =>
      s.setName("status")
        .setDescription(
          "Verification status."
        )
    )
);

/* REACTION ROLES */

add(
  new SlashCommandBuilder()
    .setName("autoreactionrole")
    .setDescription(
      "Reaction role system."
    )
    .addSubcommand(s =>
      s.setName("add")
        .setDescription(
          "Add reaction role."
        )
        .addStringOption(o =>
          o.setName("message_id")
            .setDescription(
              "Message ID."
            )
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName("emoji")
            .setDescription(
              "Emoji."
            )
            .setRequired(true)
        )
        .addRoleOption(o =>
          o.setName("role")
            .setDescription(
              "Role."
            )
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("remove")
        .setDescription(
          "Remove reaction role."
        )
        .addStringOption(o =>
          o.setName("message_id")
            .setDescription(
              "Message ID."
            )
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName("emoji")
            .setDescription(
              "Emoji."
            )
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("list")
        .setDescription(
          "List reaction roles."
        )
    )
);

/* LEADERBOARD */

add(
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription(
      "Message leaderboard."
    )
    .addSubcommand(s =>
      s.setName("top")
        .setDescription(
          "Show leaderboard."
        )
    )
    .addSubcommand(s =>
      s.setName("reset")
        .setDescription(
          "Reset leaderboard."
        )
    )
    .addSubcommand(s =>
      s.setName("enable")
        .setDescription(
          "Enable leaderboard."
        )
    )
    .addSubcommand(s =>
      s.setName("disable")
        .setDescription(
          "Disable leaderboard."
        )
    )
    .addSubcommand(s =>
      s.setName("status")
        .setDescription(
          "Leaderboard status."
        )
    )
);

/* ADS */

add(
  new SlashCommandBuilder()
    .setName("ads")
    .setDescription(
      "Owner broadcast system."
    )
    .addSubcommand(s =>
      s.setName("set")
        .setDescription(
          "Set ad channel."
        )
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription(
              "Channel."
            )
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("message")
        .setDescription(
          "Set advertisement."
        )
        .addStringOption(o =>
          o.setName("text")
            .setDescription(
              "Advertisement."
            )
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("enable")
        .setDescription(
          "Enable ads."
        )
    )
    .addSubcommand(s =>
      s.setName("disable")
        .setDescription(
          "Disable ads."
        )
    )
    .addSubcommand(s =>
      s.setName("status")
        .setDescription(
          "Ads status."
        )
    )
    .addSubcommand(s =>
      s.setName("broadcast")
        .setDescription(
          "Broadcast to configured servers."
        )
    )
);

/* BOT INFO */

add(
  new SlashCommandBuilder()
    .setName("botinfo")
    .setDescription(
      "Show bot information."
    )
);

/* TICKET EXTRA */

add(
  new SlashCommandBuilder()
    .setName("ticketstats")
    .setDescription(
      "Ticket statistics."
    )
);

add(
  new SlashCommandBuilder()
    .setName("ticketadd")
    .setDescription(
      "Add user to ticket."
    )
    .addUserOption(o =>
      o.setName("user")
        .setDescription(
          "User."
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("ticketremove")
    .setDescription(
      "Remove user from ticket."
    )
    .addUserOption(o =>
      o.setName("user")
        .setDescription(
          "User."
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("ticketrename")
    .setDescription(
      "Rename ticket."
    )
    .addStringOption(o =>
      o.setName("name")
        .setDescription(
          "New name."
        )
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName("ticketinfo")
    .setDescription(
      "Ticket information."
    )
);

/* =========================================================
   REGISTER
========================================================= */

async function registerCommands() {
  const rest =
    new REST({
      version: "10"
    }).setToken(TOKEN);

  /*
    PUT replaces the guild command list.
    This prevents old duplicate commands from remaining.
  */

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
    `✅ Registered ${commands.length} unique slash commands.`
  );
}

/* =========================================================
   STAFF COMMANDS
========================================================= */

const STAFF_COMMANDS =
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

    "leaderboard",

    "ticketstats",
    "ticketadd",
    "ticketremove",
    "ticketrename",
    "ticketinfo"
  ]);

/* =========================================================
   MESSAGE SYSTEM
========================================================= */

client.on(
  "messageCreate",
  async message => {
    try {
      if (message.author.bot) {
        return;
      }

      /* DM SUPPORT */

      if (!message.guild) {
        const channel =
          await createTicket(
            message.author
          );

        if (!channel) {
          return;
        }

        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                "📩 User Message"
              )
              .setDescription(
                message.content ||
                "[Attachment]"
              )
              .setTimestamp()
          ]
        });

        return;
      }

      const c =
        gc(message.guild);

      /* TICKET STAFF → USER DM */

      const ticket =
        ticketForChannel(
          message.channel.id
        );

      if (
        ticket &&
        staff(message.member)
      ) {
        const user =
          await client.users
            .fetch(
              ticket.userId
            )
            .catch(() => null);

        if (user) {
          await user
            .send({
              embeds: [
                new EmbedBuilder()
                  .setTitle(
                    "💬 Support Team"
                  )
                  .setDescription(
                    message.content ||
                    "[Attachment]"
                  )
                  .setTimestamp()
              ]
            })
            .catch(() => {});
        }

        return;
      }

      /* LEADERBOARD */

      if (
        c.leaderboard.enabled
      ) {
        c.leaderboard.messages[
          message.author.id
        ] =
          (
            c.leaderboard.messages[
              message.author.id
            ] || 0
          ) + 1;

        if (
          c.leaderboard.messages[
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

    } catch (error) {
      console.error(
        "messageCreate:",
        error
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
      const c =
        gc(member.guild);

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
            .catch(() => null);

        if (
          role &&
          canManageRole(
            member.guild,
            role
          )
        ) {
          await member.roles
            .add(
              role,
              "AkiyO Autorole"
            )
            .catch(() => {});

          await log(
            member.guild,
            "members",
            "👤 Autorole Added",
            [
              field(
                "User",
                member.toString()
              ),
              field(
                "Role",
                role.toString()
              )
            ]
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
            .catch(() => null);

        if (
          channel?.isTextBased()
        ) {
          await channel
            .send(
              template(
                c.welcome.message,
                member
              )
            )
            .catch(() => {});

          await log(
            member.guild,
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
      }

      /* RAID DETECTION */

      const key =
        `join:${member.guild.id}`;

      const now =
        Date.now();

      const joins =
        (
          raidTracker.get(
            key
          ) || []
        ).filter(
          x =>
            now - x <
            config.security.raidWindow
        );

      joins.push(now);

      raidTracker.set(
        key,
        joins
      );

      if (
        joins.length >=
        config.security.raidJoinCount
      ) {
        await log(
          member.guild,
          "security",
          "🚨 Possible Raid Detected",
          [
            field(
              "Joins",
              joins.length
            ),
            field(
              "Window",
              `${config.security.raidWindow / 1000}s`
            )
          ],
          0xed4245
        );

        raidTracker.delete(
          key
        );
      }

    } catch (error) {
      console.error(
        "guildMemberAdd:",
        error
      );
    }
  }
);

/* =========================================================
   AUDIT / ANTI-NUKE EVENTS
========================================================= */

const AUDIT_EVENTS = [
  [
    "guildBanAdd",
    "ban",
    AuditLogEvent.MemberBanAdd,
    x =>
      `Banned ${x.user.tag}`,
    x => x.user.id
  ],

  [
    "channelDelete",
    "channelDelete",
    AuditLogEvent.ChannelDelete,
    x =>
      `Deleted channel #${x.name}`,
    x => x.id
  ],

  [
    "channelCreate",
    "channelCreate",
    AuditLogEvent.ChannelCreate,
    x =>
      `Created channel #${x.name}`,
    x => x.id
  ],

  [
    "roleDelete",
    "roleDelete",
    AuditLogEvent.RoleDelete,
    x =>
      `Deleted role ${x.name}`,
    x => x.id
  ],

  [
    "roleCreate",
    "roleCreate",
    AuditLogEvent.RoleCreate,
    x =>
      `Created role ${x.name}`,
    x => x.id
  ]
];

for (
  const [
    event,
    antiEvent,
    auditType,
    description,
    target
  ] of AUDIT_EVENTS
) {
  client.on(
    event,
    async object => {
      try {
        const guild =
          object.guild;

        if (!guild) return;

        const logs =
          await guild
            .fetchAuditLogs({
              type: auditType,
              limit: 1
            })
            .catch(() => null);

        const entry =
          logs?.entries.first();

        if (
          !entry ||
          Date.now() -
            entry.createdTimestamp >
            5000
        ) {
          return;
        }

        await log(
          guild,
          "audit",
          "📜 Audit Log",
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
                ? `${entry.executor.tag || entry.executor.username} (${entry.executor.id})`
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
                "None"
            )
          ]
        );

        await antiNuke(
          guild,
          antiEvent,
          entry.executor?.id,
          target(object),
          description(object)
        );

      } catch (error) {
        console.error(
          `${event}:`,
          error
        );
      }
    }
  );
}

/* MEMBER KICK */

client.on(
  "guildMemberRemove",
  async member => {
    try {
      const logs =
        await member.guild
          .fetchAuditLogs({
            type:
              AuditLogEvent.MemberKick,
            limit: 1
          })
          .catch(() => null);

      const entry =
        logs?.entries.first();

      if (
        entry &&
        entry.targetId ===
          member.id &&
        Date.now() -
          entry.createdTimestamp <
          5000
      ) {
        await antiNuke(
          member.guild,
          "kick",
          entry.executor?.id,
          member.id,
          `Kicked ${member.user.tag}`
        );
      }

      await log(
        member.guild,
        "members",
        "👋 Member Left",
        [
          field(
            "User",
            `${member.user.tag} (${member.id})`
          )
        ]
      );

    } catch (error) {
      console.error(
        "guildMemberRemove:",
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
              interaction.user
            );

          return interaction.reply({
            content:
              channel
                ? "🎫 Ticket created. Check your DMs."
                : "❌ Could not create ticket.",
            ephemeral: true
          });
        }

        /* VERIFICATION */

        if (
          interaction.customId ===
          "verify_user"
        ) {
          const c =
            gc(interaction.guild);

          if (
            !c.verification.enabled
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
                c.verification.roleId
              )
              .catch(() => null);

          if (!role) {
            return interaction.reply({
              content:
                "❌ Verification role no longer exists.",
              ephemeral: true
            });
          }

          if (
            !canManageRole(
              interaction.guild,
              role
            )
          ) {
            return interaction.reply({
              content:
                "❌ My highest role must be above the verification role.",
              ephemeral: true
            });
          }

          if (
            interaction.member.roles.cache.has(
              role.id
            )
          ) {
            return interaction.reply({
              content:
                "✅ You are already verified.",
              ephemeral: true
            });
          }

          await interaction.member.roles
            .add(
              role,
              "AkiyO Verification"
            );

          await log(
            interaction.guild,
            "verification",
            "✅ Member Verified",
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
              "✅ Verification successful!",
            ephemeral: true
          });
        }

        /* TICKET BUTTONS */

        if (
          !staff(
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
          ticketForChannel(
            interaction.channel.id
          );

        if (!ticket) {
          return interaction.reply({
            content:
              "❌ This is not a ticket.",
            ephemeral: true
          });
        }

        const uid =
          ticket.userId;

        if (
          interaction.customId ===
          "ticket_claim"
        ) {
          claims.set(
            interaction.channel.id,
            interaction.user.id
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
            uid,
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
              uid,
              {
                ViewChannel: true,
                SendMessages: false
              }
            );

          return interaction.reply(
            "🔐 Ticket locked."
          );
        }

        if (
          interaction.customId ===
          "ticket_unlock"
        ) {
          await interaction.channel
            .permissionOverwrites
            .edit(
              uid,
              {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
              }
            );

          return interaction.reply(
            "🔓 Ticket unlocked."
          );
        }

        if (
          interaction.customId ===
          "ticket_transcript"
        ) {
          const file =
            await transcript(
              interaction.channel
            );

          const channel =
            await getLogChannel(
              interaction.guild,
              "tickets"
            );

          if (
            channel?.isTextBased()
          ) {
            await channel.send({
              files: [
                {
                  attachment:
                    file,
                  name:
                    `ticket-${interaction.channel.id}.txt`
                }
              ]
            });
          }

          return interaction.reply({
            content:
              "✅ Transcript sent to ticket logs.",
            ephemeral: true
          });
        }

        return;
      }

      /* =========================
         SLASH COMMANDS
      ========================= */

      if (
        !interaction.isChatInputCommand()
      ) {
        return;
      }

      const command =
        interaction.commandName;

      if (
        STAFF_COMMANDS.has(
          command
        ) &&
        !staff(
          interaction.member
        )
      ) {
        return interaction.reply({
          content:
            "❌ You do not have permission to use this command.",
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
            interaction.user
          );

        return interaction.reply({
          content:
            channel
              ? "🎫 Check your DMs for your support ticket."
              : "❌ Could not create ticket.",
          ephemeral: true
        });
      }

      if (
        command === "ticketpanel"
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
        const c =
          gc(interaction.guild);

        c.support.categoryId =
          interaction.options
            .getChannel(
              "category"
            ).id;

        config.ticketCategoryId =
          c.support.categoryId;

        save();

        return interaction.reply(
          "✅ Ticket category saved."
        );
      }

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
          ticketForChannel(
            interaction.channel.id
          );

        if (!ticket) {
          return interaction.reply(
            "❌ This is not a ticket."
          );
        }

        const uid =
          ticket.userId;

        if (
          command === "close"
        ) {
          await interaction.reply(
            "🔒 Closing..."
          );

          return closeTicket(
            uid,
            interaction.channel,
            interaction.user
          );
        }

        if (
          command === "delete"
        ) {
          tickets.delete(uid);
          claims.delete(
            interaction.channel.id
          );

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
              uid,
              {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
              }
            );

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
              uid,
              {
                ViewChannel: true,
                SendMessages: false
              }
            );

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
              uid,
              {
                ViewChannel: true,
                SendMessages: true
              }
            );

          return interaction.reply(
            "🔓 Ticket unlocked."
          );
        }

        if (
          command === "claim"
        ) {
          claims.set(
            interaction.channel.id,
            interaction.user.id
          );

          return interaction.reply(
            `✅ Claimed by ${interaction.user}.`
          );
        }

        if (
          command === "unclaim"
        ) {
          claims.delete(
            interaction.channel.id
          );

          return interaction.reply(
            "✅ Ticket unclaimed."
          );
        }
      }

      /* =========================
         AUTOMOD
      ========================= */

      if (
        command === "automod"
      ) {
        const sub =
          interaction.options
            .getSubcommand();

        if (
          sub === "enable"
        ) {
          config.automod.enabled =
            true;
        }

        if (
          sub === "disable"
        ) {
          config.automod.enabled =
            false;
        }

        if (
          sub === "config"
        ) {
          const spam =
            interaction.options
              .getInteger(
                "spam_limit"
              );

          const timeout =
            interaction.options
              .getInteger(
                "timeout"
              );

          const caps =
            interaction.options
              .getInteger(
                "caps_percent"
              );

          if (
            spam !== null
          ) {
            config.automod.spamLimit =
              spam;
          }

          if (
            timeout !== null
          ) {
            for (
              const key of Object.keys(
                config.automod
                  .timeoutSeconds
              )
            ) {
              config.automod
                .timeoutSeconds[key] =
                timeout;
            }
          }

          if (
            caps !== null
          ) {
            config.automod.capsPercent =
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
              .toLowerCase();

          if (
            !config.automod.badWords.includes(
              word
            )
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
              .getString(
                "word"
              )
              .toLowerCase();

          config.automod.badWords =
            config.automod.badWords.filter(
              x => x !== word
            );
        }

        save();

        if (
          sub === "status"
        ) {
          return interaction.reply({
            content:
              `🛡️ **AutoMod Status**\n` +
              `Enabled: ${config.automod.enabled ? "ON" : "OFF"}\n` +
              `Spam Limit: ${config.automod.spamLimit}\n` +
              `Spam Window: ${config.automod.spamWindow}ms\n` +
              `Caps: ${config.automod.capsPercent}%\n` +
              `Bad Words: ${config.automod.badWords.length}`,
            ephemeral: true
          });
        }

        return interaction.reply(
          "✅ AutoMod configuration saved."
        );
      }

      /* =========================
         SECURITY
      ========================= */

      if (
        command === "security"
      ) {
        const sub =
          interaction.options
            .getSubcommand();

        const c =
          gc(interaction.guild);

        if (
          sub === "enable"
        ) {
          config.security.enabled =
            true;
        }

        if (
          sub === "disable"
        ) {
          config.security.enabled =
            false;
        }

        if (
          sub === "trusted"
        ) {
          const id =
            interaction.options
              .getUser(
                "user"
              ).id;

          if (
            !config.security.trustedUsers.includes(
              id
            )
          ) {
            config.security.trustedUsers.push(
              id
            );
          }
        }

        if (
          sub === "untrusted"
        ) {
          const id =
            interaction.options
              .getUser(
                "user"
              ).id;

          config.security.trustedUsers =
            config.security.trustedUsers.filter(
              x => x !== id
            );
        }

        if (
          sub === "trustedrole"
        ) {
          c.trusted.roleId =
            interaction.options
              .getRole(
                "role"
              ).id;
        }

        if (
          sub === "trustedmember"
        ) {
          const id =
            interaction.options
              .getUser(
                "user"
              ).id;

          if (
            !c.trusted.members.includes(
              id
            )
          ) {
            c.trusted.members.push(
              id
            );
          }
        }

        if (
          sub ===
          "untrustedmember"
        ) {
          const id =
            interaction.options
              .getUser(
                "user"
              ).id;

          c.trusted.members =
            c.trusted.members.filter(
              x => x !== id
            );
        }

        if (
          sub === "trustedbot"
        ) {
          const id =
            interaction.options
              .getUser(
                "user"
              ).id;

          if (
            !c.trusted.bots.includes(
              id
            )
          ) {
            c.trusted.bots.push(
              id
            );
          }
        }

        if (
          sub ===
          "untrustedbot"
        ) {
          const id =
            interaction.options
              .getUser(
                "user"
              ).id;

          c.trusted.bots =
            c.trusted.bots.filter(
              x => x !== id
            );
        }

        if (
          sub ===
          "protectedrole"
        ) {
          const id =
            interaction.options
              .getRole(
                "role"
              ).id;

          if (
            !c.protectedRoles.includes(
              id
            )
          ) {
            c.protectedRoles.push(
              id
            );
          }
        }

        if (
          sub ===
          "unprotectedrole"
        ) {
          const id =
            interaction.options
              .getRole(
                "role"
              ).id;

          c.protectedRoles =
            c.protectedRoles.filter(
              x => x !== id
            );
        }

        if (
          sub ===
          "protectedchannel"
        ) {
          const id =
            interaction.options
              .getChannel(
                "channel"
              ).id;

          if (
            !c.protectedChannels.includes(
              id
            )
          ) {
            c.protectedChannels.push(
              id
            );
          }
        }

        if (
          sub ===
          "unprotectedchannel"
        ) {
          const id =
            interaction.options
              .getChannel(
                "channel"
              ).id;

          c.protectedChannels =
            c.protectedChannels.filter(
              x => x !== id
            );
        }

        save();

        if (
          sub === "status"
        ) {
          return interaction.reply({
            content:
              `🔐 **Security Status**\n` +
              `Enabled: ${config.security.enabled ? "ON" : "OFF"}\n` +
              `Trusted Users: ${config.security.trustedUsers.length}\n` +
              `Trusted Bots: ${c.trusted.bots.length}\n` +
              `Trusted Members: ${c.trusted.members.length}\n` +
              `Trusted Role: ${c.trusted.roleId ? `<@&${c.trusted.roleId}>` : "None"}\n` +
              `Protected Roles: ${c.protectedRoles.length}\n` +
              `Protected Channels: ${c.protectedChannels.length}`,
            ephemeral: true
          });
        }

        if (
          sub === "list"
        ) {
          return interaction.reply({
            content:
              `🔐 **Trusted Users**\n${
                config.security.trustedUsers.map(
                  x => `<@${x}>`
                ).join(", ") ||
                "None"
              }\n\n` +

              `Trusted Members:\n${
                c.trusted.members.map(
                  x => `<@${x}>`
                ).join(", ") ||
                "None"
              }\n\n` +

              `Trusted Bots:\n${
                c.trusted.bots.map(
                  x => `<@${x}>`
                ).join(", ") ||
                "None"
              }\n\n` +

              `Protected Roles:\n${
                c.protectedRoles.map(
                  x => `<@&${x}>`
                ).join(", ") ||
                "None"
              }\n\n` +

              `Protected Channels:\n${
                c.protectedChannels.map(
                  x => `<#${x}>`
                ).join(", ") ||
                "None"
              }`,
            ephemeral: true
          });
        }

        return interaction.reply(
          "✅ Security configuration saved."
        );
      }

      /* =========================
         CONFIG
      ========================= */

      if (
        command === "config"
      ) {
        const sub =
          interaction.options
            .getSubcommand();

        if (
          sub === "log"
        ) {
          const type =
            interaction.options
              .getString(
                "type"
              );

          const channel =
            interaction.options
              .getChannel(
                "channel"
              );

          const c =
            gc(interaction.guild);

          c.logs[type] =
            channel.id;

          config.logs[type] =
            channel.id;

          save();

          await log(
            interaction.guild,
            "config",
            "⚙️ Log Configuration",
            [
              field(
                "Type",
                type
              ),
              field(
                "Channel",
                channel.toString()
              ),
              field(
                "Changed By",
                interaction.user.toString()
              )
            ]
          );

          return interaction.reply(
            `✅ ${type} logs configured to ${channel}.`
          );
        }

        if (
          sub === "suggestions"
        ) {
          config.suggestionsChannelId =
            interaction.options
              .getChannel(
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
            interaction.options
              .getString(
                "type"
              );

          const seconds =
            interaction.options
              .getInteger(
                "seconds"
              );

          config.automod
            .timeoutSeconds[
              type
            ] = seconds;

          save();

          return interaction.reply(
            `✅ ${type} AutoMod timeout set to ${seconds} seconds.`
          );
        }

        if (
          sub === "security"
        ) {
          for (
            const key of [
              "mass_ban",
              "mass_kick",
              "mass_channel_delete",
              "mass_role_delete"
            ]
          ) {
            const value =
              interaction.options
                .getInteger(
                  key
                );

            if (
              value !== null
            ) {
              config.security[
                key
              ] = value;
            }
          }

          save();

          return interaction.reply(
            "✅ Security thresholds saved."
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
          interaction.options
            .getString(
              "reason"
            );

        if (
          command === "unban"
        ) {
          const id =
            interaction.options
              .getString(
                "user_id"
              );

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

          await log(
            interaction.guild,
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
            `✅ ${id} unbanned.`
          );
        }

        const user =
          interaction.options
            .getUser(
              "user"
            );

        const member =
          await interaction.guild.members
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
          const total =
            await addWarning(
              member,
              reason,
              interaction.user.id
            );

          await log(
            interaction.guild,
            "moderation",
            "⚠️ Member Warned",
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
                total
              )
            ],
            0xfee75c
          );

          return interaction.reply(
            `⚠️ ${user} warned. Total warnings: ${total}`
          );
        }

        if (
          command === "timeout"
        ) {
          const seconds =
            interaction.options
              .getInteger(
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

          await recordPunishment(
            interaction.guild,
            user.id,
            "timeout",
            reason,
            interaction.user.id
          );

          await log(
            interaction.guild,
            "moderation",
            "⏱️ Member Timed Out",
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
                "Duration",
                `${seconds}s`
              ),
              field(
                "Reason",
                reason
              )
            ]
          );

          return interaction.reply(
            `⏱️ ${user} timed out for ${seconds} seconds.`
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

      /* =========================
         WARNINGS / PUNISHMENTS
      ========================= */

      if (
        command ===
          "warnings" ||
        command ===
          "punishments"
      ) {
        const user =
          interaction.options
            .getUser(
              "user"
            );

        const data =
          command ===
          "warnings"
            ? (
                config.warnings[
                  interaction.guild.id
                ]?.[user.id] ||
                []
              )
            : (
                config.punishments[
                  interaction.guild.id
                ]?.[user.id] ||
                []
              );

        const text =
          data.length
            ? data
                .slice(-10)
                .map(
                  (x, index) =>
                    `${index + 1}. **${x.type || "warn"}** — ${x.reason} — <t:${Math.floor(x.time / 1000)}:R>`
                )
                .join("\n")
            : "None";

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
                text
              )
              .setTimestamp()
          ],
          ephemeral: true
        });
      }

      /* =========================
         SUGGESTION
      ========================= */

      if (
        command === "suggest"
      ) {
        const text =
          interaction.options
            .getString(
              "text"
            );

        const channel =
          config.suggestionsChannelId
            ? await interaction.guild.channels
                .fetch(
                  config.suggestionsChannelId
                )
                .catch(() => null)
            : interaction.channel;

        if (
          !channel?.isTextBased()
        ) {
          return interaction.reply(
            "❌ Suggestion channel is not configured."
          );
        }

        const embed =
          new EmbedBuilder()
            .setTitle(
              "💡 New Suggestion"
            )
            .setDescription(
              text
            )
            .addFields(
              field(
                "Suggested By",
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

        await message.react(
          "👍"
        );

        await message.react(
          "👎"
        );

        await log(
          interaction.guild,
          "suggestion",
          "💡 Suggestion Created",
          [
            field(
              "Author",
              interaction.user.toString()
            ),
            field(
              "Suggestion",
              text
            ),
            field(
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

      /* =========================
         ANNOUNCE
      ========================= */

      if (
        command === "announce"
      ) {
        const channel =
          interaction.options
            .getChannel(
              "channel"
            );

        const message =
          interaction.options
            .getString(
              "message"
            );

        const title =
          interaction.options
            .getString(
              "title"
            );

        const footer =
          interaction.options
            .getString(
              "footer"
            );

        const image =
          interaction.options
            .getString(
              "image"
            );

        const thumbnail =
          interaction.options
            .getString(
              "thumbnail"
            );

        const useEmbed =
          interaction.options
            .getBoolean(
              "embed"
            );

        const everyone =
          interaction.options
            .getBoolean(
              "everyone"
            );

        const here =
          interaction.options
            .getBoolean(
              "here"
            );

        const role =
          interaction.options
            .getRole(
              "role"
            );

        const user =
          interaction.options
            .getUser(
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
          parse: [],
          roles: [],
          users: []
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
          allowedMentions.roles.push(
            role.id
          );
        }

        if (user) {
          allowedMentions.users.push(
            user.id
          );
        }

        const payload = {
          content:
            prefix + message,

          allowedMentions
        };

        if (
          useEmbed !== false ||
          title ||
          footer ||
          image ||
          thumbnail
        ) {
          const embed =
            new EmbedBuilder()
              .setDescription(
                message
              )
              .setTimestamp();

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

        await log(
          interaction.guild,
          "announcements",
          "📢 Announcement Sent",
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
        command === "autorole"
      ) {
        const sub =
          interaction.options
            .getSubcommand();

        const c =
          gc(interaction.guild);

        if (
          sub === "set"
        ) {
          const role =
            interaction.options
              .getRole(
                "role"
              );

          if (
            !canManageRole(
              interaction.guild,
              role
            )
          ) {
            return interaction.reply(
              "❌ My highest role must be above that role."
            );
          }

          c.autorole = {
            enabled: true,
            roleId: role.id
          };

          save();

          return interaction.reply(
            `✅ Autorole set to ${role}.`
          );
        }

        if (
          sub === "disable"
        ) {
          c.autorole.enabled =
            false;

          save();

          return interaction.reply(
            "✅ Autorole disabled."
          );
        }

        return interaction.reply({
          content:
            `👤 Autorole: ${
              c.autorole.enabled
                ? "ON"
                : "OFF"
            }\nRole: ${
              c.autorole.roleId
                ? `<@&${c.autorole.roleId}>`
                : "None"
            }`,
          ephemeral: true
        });
      }

      /* =========================
         WELCOME
      ========================= */

      if (
        command === "welcome"
      ) {
        const sub =
          interaction.options
            .getSubcommand();

        const c =
          gc(interaction.guild);

        if (
          sub === "set"
        ) {
          c.welcome = {
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

          save();

          return interaction.reply(
            "✅ Welcome system configured."
          );
        }

        if (
          sub === "disable"
        ) {
          c.welcome.enabled =
            false;

          save();

          return interaction.reply(
            "✅ Welcome system disabled."
          );
        }

        return interaction.reply({
          content:
            `👋 Welcome: ${
              c.welcome.enabled
                ? "ON"
                : "OFF"
            }\nChannel: ${
              c.welcome.channelId
                ? `<#${c.welcome.channelId}>`
                : "None"
            }\nMessage: ${c.welcome.message}`,
          ephemeral: true
        });
      }

      /* =========================
         VERIFICATION
      ========================= */

      if (
        command ===
        "verification"
      ) {
        const sub =
          interaction.options
            .getSubcommand();

        const c =
          gc(interaction.guild);

        if (
          sub === "setup"
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

          if (
            !canManageRole(
              interaction.guild,
              role
            )
          ) {
            return interaction.reply(
              "❌ My highest role must be above the verification role."
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
                  .setEmoji(
                    "✅"
                  )
                  .setStyle(
                    ButtonStyle.Success
                  )
              );

          const message =
            await channel.send({
              embeds: [
                new EmbedBuilder()
                  .setTitle(
                    "✅ Verification"
                  )
                  .setDescription(
                    "Click the button below to verify yourself."
                  )
                  .setTimestamp()
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

          return interaction.reply(
            "✅ Verification system configured."
          );
        }

        if (
          sub === "disable"
        ) {
          c.verification.enabled =
            false;

          save();

          return interaction.reply(
            "✅ Verification disabled."
          );
        }

        return interaction.reply({
          content:
            `✅ Verification: ${
              c.verification.enabled
                ? "ON"
                : "OFF"
            }\nRole: ${
              c.verification.roleId
                ? `<@&${c.verification.roleId}>`
                : "None"
            }\nChannel: ${
              c.verification.channelId
                ? `<#${c.verification.channelId}>`
                : "None"
            }`,
          ephemeral: true
        });
      }

      /* =========================
         REACTION ROLE
      ========================= */

      if (
        command ===
        "autoreactionrole"
      ) {
        const sub =
          interaction.options
            .getSubcommand();

        const c =
          gc(interaction.guild);

        if (
          sub === "add"
        ) {
          const messageId =
            interaction.options
              .getString(
                "message_id"
              );

          const emoji =
            interaction.options
              .getString(
                "emoji"
              );

          const role =
            interaction.options
              .getRole(
                "role"
              );

          if (
            !canManageRole(
              interaction.guild,
              role
            )
          ) {
            return interaction.reply(
              "❌ My highest role must be above that role."
            );
          }

          const message =
            await interaction.channel.messages
              .fetch(
                messageId
              )
              .catch(
                () => null
              );

          if (!message) {
            return interaction.reply(
              "❌ Message not found in this channel."
            );
          }

          c.reactionRoles[
            messageId
          ] ??= {};

          c.reactionRoles[
            messageId
          ][emoji] = {
            roleId:
              role.id
          };

          await message
            .react(
              emoji
            )
            .catch(() => {});

          save();

          await log(
            interaction.guild,
            "reactionRoles",
            "🎭 Reaction Role Added",
            [
              field(
                "Message",
                messageId
              ),
              field(
                "Emoji",
                emoji
              ),
              field(
                "Role",
                role.toString()
              )
            ]
          );

          return interaction.reply(
            `✅ ${emoji} → ${role}`
          );
        }

        if (
          sub === "remove"
        ) {
          const messageId =
            interaction.options
              .getString(
                "message_id"
              );

          const emoji =
            interaction.options
              .getString(
                "emoji"
              );

          if (
            c.reactionRoles[
              messageId
            ]
          ) {
            delete c.reactionRoles[
              messageId
            ][emoji];

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

          return interaction.reply(
            "✅ Reaction role removed."
          );
        }

        const result = [];

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
              emoji,
              data
            ] of Object.entries(
              mappings
            )
          ) {
            result.push(
              `${emoji} → <@&${data.roleId}> — Message: ${messageId}`
            );
          }
        }

        return interaction.reply({
          content:
            result.join("\n") ||
            "No reaction roles configured.",
          ephemeral: true
        });
      }

      /* =========================
         LEADERBOARD
      ========================= */

      if (
        command ===
        "leaderboard"
      ) {
        const sub =
          interaction.options
            .getSubcommand();

        const c =
          gc(interaction.guild);

        if (
          sub === "reset"
        ) {
          c.leaderboard.messages =
            {};

          save();

          return interaction.reply(
            "✅ Leaderboard reset."
          );
        }

        if (
          sub === "enable"
        ) {
          c.leaderboard.enabled =
            true;

          save();

          return interaction.reply(
            "✅ Leaderboard enabled."
          );
        }

        if (
          sub === "disable"
        ) {
          c.leaderboard.enabled =
            false;

          save();

          return interaction.reply(
            "✅ Leaderboard disabled."
          );
        }

        if (
          sub === "status"
        ) {
          return interaction.reply({
            content:
              `🏆 Leaderboard: ${
                c.leaderboard.enabled
                  ? "ON"
                  : "OFF"
              }\nTracked users: ${
                Object.keys(
                  c.leaderboard.messages
                ).length
              }`,
            ephemeral: true
          });
        }

        const top =
          Object.entries(
            c.leaderboard.messages
          )
            .sort(
              (a, b) =>
                b[1] - a[1]
            )
            .slice(0, 10);

        const text =
          top.length
            ? top
                .map(
                  ([id, count], i) =>
                    `${i + 1}. <@${id}> — **${count} messages**`
                )
                .join("\n")
            : "No messages yet.";

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                "🏆 Message Leaderboard"
              )
              .setDescription(
                text
              )
              .setTimestamp()
          ]
        });
      }

      /* =========================
         ADS
      ========================= */

      if (
        command === "ads"
      ) {
        if (
          !owner(
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
          interaction.options
            .getSubcommand();

        const c =
          gc(interaction.guild);

        if (
          sub === "set"
        ) {
          c.ads.channelId =
            interaction.options
              .getChannel(
                "channel"
              ).id;

          save();

          return interaction.reply(
            "✅ Ad channel configured."
          );
        }

        if (
          sub === "message"
        ) {
          c.ads.message =
            interaction.options
              .getString(
                "text"
              );

          save();

          return interaction.reply(
            "✅ Advertisement updated."
          );
        }

        if (
          sub === "enable"
        ) {
          c.ads.enabled =
            true;

          save();

          return interaction.reply(
            "✅ Ads enabled."
          );
        }

        if (
          sub === "disable"
        ) {
          c.ads.enabled =
            false;

          save();

          return interaction.reply(
            "✅ Ads disabled."
          );
        }

        if (
          sub === "status"
        ) {
          return interaction.reply({
            content:
              `📢 Ads: ${
                c.ads.enabled
                  ? "ON"
                  : "OFF"
              }\nChannel: ${
                c.ads.channelId
                  ? `<#${c.ads.channelId}>`
                  : "None"
              }\nMessage: ${c.ads.message}`,
            ephemeral: true
          });
        }

        if (
          sub === "broadcast"
        ) {
          let sent = 0;

          for (
            const guild of client.guilds.cache.values()
          ) {
            const settings =
              gc(guild);

            if (
              !settings.ads.enabled ||
              !settings.ads.channelId
            ) {
              continue;
            }

            const channel =
              await guild.channels
                .fetch(
                  settings.ads.channelId
                )
                .catch(() => null);

            if (
              channel?.isTextBased()
            ) {
              await channel
                .send(
                  settings.ads.message
                )
                .then(() => {
                  sent++;
                })
                .catch(() => {});
            }
          }

          return interaction.reply(
            `✅ Advertisement broadcast sent to ${sent} configured servers.`
          );
        }
      }

      /* =========================
         BOT INFO
      ========================= */

      if (
        command === "botinfo"
      ) {
        const users =
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
            new EmbedBuilder()
              .setTitle(
                "🤖 AkiyO Bot Information"
              )
              .addFields(
                field(
                  "Bot",
                  `${client.user.tag} (${client.user.id})`
                ),
                field(
                  "Guilds",
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
                  "Node.js",
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
                  `${days}d ${hours}h ${minutes}m`,
                  true
                )
              )
              .setTimestamp()
          ]
        });
      }

      /* =========================
         TICKET EXTRA COMMANDS
      ========================= */

      if (
        command ===
          "ticketstats" ||
        command ===
          "ticketadd" ||
        command ===
          "ticketremove" ||
        command ===
          "ticketrename" ||
        command ===
          "ticketinfo"
      ) {
        if (
          command ===
          "ticketstats"
        ) {
          return interaction.reply({
            content:
              `🎫 **Ticket Statistics**\nOpen tickets: ${tickets.size}`,
            ephemeral: true
          });
        }

        const ticket =
          ticketForChannel(
            interaction.channel.id
          );

        if (!ticket) {
          return interaction.reply(
            "❌ This is not a ticket."
          );
        }

        const uid =
          ticket.userId;

        if (
          command ===
          "ticketadd"
        ) {
          const user =
            interaction.options
              .getUser(
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

        if (
          command ===
          "ticketremove"
        ) {
          const user =
            interaction.options
              .getUser(
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

        if (
          command ===
          "ticketrename"
        ) {
          const name =
            interaction.options
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

          await interaction.channel
            .setName(
              name
            );

          return interaction.reply(
            `✅ Ticket renamed to ${name}.`
          );
        }

        return interaction.reply({
          content:
            `🎫 **Ticket Information**\nUser: <@${uid}>\nClaimed by: ${
              claims.get(
                interaction.channel.id
              )
                ? `<@${claims.get(
                    interaction.channel.id
                  )}>`
                : "Nobody"
            }\nChannel: ${interaction.channel}`,
          ephemeral: true
        });
      }

    } catch (error) {
      console.error(
        "interactionCreate:",
        error
      );

      if (
        !interaction.replied &&
        !interaction.deferred
      ) {
        await interaction
          .reply({
            content:
              "❌ An internal error occurred. Check the bot console.",
            ephemeral: true
          })
          .catch(() => {});
      }
    }
  }
);

/* =========================================================
   REACTION ROLES + SUGGESTIONS
========================================================= */

client.on(
  "messageReactionAdd",
  async (reaction, user) => {
    try {
      if (user.bot) {
        return;
      }

      if (
        reaction.partial
      ) {
        await reaction.fetch()
          .catch(() => {});
      }

      const guild =
        reaction.message.guild;

      if (!guild) {
        return;
      }

      const c =
        gc(guild);

      const emojiKey =
        reaction.emoji.id ||
        reaction.emoji.name;

      const mapping =
        c.reactionRoles?.[
          reaction.message.id
        ]?.[emojiKey];

      if (mapping) {
        const member =
          await guild.members
            .fetch(
              user.id
            )
            .catch(() => null);

        const role =
          await guild.roles
            .fetch(
              mapping.roleId
            )
            .catch(() => null);

        if (
          member &&
          role &&
          canManageRole(
            guild,
            role
          )
        ) {
          await member.roles
            .add(
              role,
              "AkiyO Reaction Role"
            )
            .catch(() => {});

          await log(
            guild,
            "reactionRoles",
            "🎭 Reaction Role Added",
            [
              field(
                "User",
                user.toString()
              ),
              field(
                "Role",
                role.toString()
              ),
              field(
                "Emoji",
                reaction.emoji.toString()
              )
            ]
          );
        }

        return;
      }

      /* SUGGESTION DECISION */

      if (
        !["👍", "👎"].includes(
          reaction.emoji.name
        )
      ) {
        return;
      }

      if (
        !config.suggestionsChannelId ||
        reaction.message.channel.id !==
          config.suggestionsChannelId
      ) {
        return;
      }

      const member =
        await guild.members
          .fetch(
            user.id
          )
          .catch(() => null);

      if (!staff(member)) {
        await reaction.users
          .remove(
            user.id
          )
          .catch(() => {});

        return;
      }

      const embed =
        reaction.message.embeds[0];

      if (
        !embed ||
        !embed.title?.includes(
          "Suggestion"
        )
      ) {
        return;
      }

      const decision =
        reaction.emoji.name ===
        "👍"
          ? "✅ APPROVED"
          : "❌ DECLINED";

      const updated =
        EmbedBuilder
          .from(embed)
          .setTitle(
            `${decision} • Suggestion`
          )
          .addFields(
            field(
              "Decision By",
              user.toString()
            )
          );

      await reaction.message.edit({
        embeds: [
          updated
        ]
      });

      await log(
        guild,
        "suggestion",
        decision,
        [
          field(
            "Decision By",
            user.toString()
          ),
          field(
            "Message",
            reaction.message.url
          )
        ]
      );

    } catch (error) {
      console.error(
        "messageReactionAdd:",
        error
      );
    }
  }
);

/* =========================================================
   REACTION REMOVE
========================================================= */

client.on(
  "messageReactionRemove",
  async (reaction, user) => {
    try {
      if (user.bot) {
        return;
      }

      if (
        reaction.partial
      ) {
        await reaction.fetch()
          .catch(() => {});
      }

      const guild =
        reaction.message.guild;

      if (!guild) {
        return;
      }

      const c =
        gc(guild);

      const emojiKey =
        reaction.emoji.id ||
        reaction.emoji.name;

      const mapping =
        c.reactionRoles?.[
          reaction.message.id
        ]?.[emojiKey];

      if (!mapping) {
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
            mapping.roleId
          )
          .catch(() => null);

      if (
        member &&
        role
      ) {
        await member.roles
          .remove(
            role,
            "AkiyO Reaction Role Removed"
          )
          .catch(() => {});

        await log(
          guild,
          "reactionRoles",
          "🎭 Reaction Role Removed",
          [
            field(
              "User",
              user.toString()
            ),
            field(
              "Role",
              role.toString()
            ),
            field(
              "Emoji",
              reaction.emoji.toString()
            )
          ]
        );
      }

    } catch (error) {
      console.error(
        "messageReactionRemove:",
        error
      );
    }
  }
);

/* =========================================================
   CHANNEL / ROLE / MEMBER / MESSAGE LOGS
========================================================= */

client.on(
  "messageDelete",
  async message => {
    try {
      if (!message.guild) return;
      if (message.author?.bot) return;

      await log(
        message.guild,
        "messages",
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
            message.channel?.toString() ||
              "Unknown"
          ),
          field(
            "Content",
            message.content ||
              "[No cached content]"
          )
        ]
      );
    } catch {}
  }
);

client.on(
  "messageUpdate",
  async (oldMessage, newMessage) => {
    try {
      if (!oldMessage.guild) return;
      if (oldMessage.author?.bot) return;

      if (
        oldMessage.content ===
        newMessage.content
      ) {
        return;
      }

      await log(
        oldMessage.guild,
        "messages",
        "✏️ Message Edited",
        [
          field(
            "Author",
            oldMessage.author
              ? `${oldMessage.author.tag} (${oldMessage.author.id})`
              : "Unknown"
          ),
          field(
            "Channel",
            oldMessage.channel?.toString() ||
              "Unknown"
          ),
          field(
            "Before",
            oldMessage.content ||
              "None"
          ),
          field(
            "After",
            newMessage.content ||
              "None"
          )
        ]
      );
    } catch {}
  }
);

client.on(
  "channelCreate",
  async channel => {
    if (!channel.guild) return;

    await log(
      channel.guild,
      "channels",
      "📁 Channel Created",
      [
        field(
          "Channel",
          channel.toString()
        ),
        field(
          "Name",
          channel.name
        ),
        field(
          "Type",
          channel.type
        )
      ]
    );
  }
);

client.on(
  "channelDelete",
  async channel => {
    if (!channel.guild) return;

    await log(
      channel.guild,
      "channels",
      "🗑️ Channel Deleted",
      [
        field(
          "Name",
          channel.name
        ),
        field(
          "ID",
          channel.id
        )
      ]
    );
  }
);

client.on(
  "roleCreate",
  async role => {
    await log(
      role.guild,
      "roles",
      "🎭 Role Created",
      [
        field(
          "Role",
          role.toString()
        ),
        field(
          "Name",
          role.name
        )
      ]
    );
  }
);

client.on(
  "roleDelete",
  async role => {
    await log(
      role.guild,
      "roles",
      "🗑️ Role Deleted",
      [
        field(
          "Role",
          role.name
        ),
        field(
          "ID",
          role.id
        )
      ]
    );
  }
);

client.on(
  "guildMemberUpdate",
  async (oldMember, newMember) => {
    try {
      const changes = [];

      if (
        oldMember.nickname !==
        newMember.nickname
      ) {
        changes.push(
          field(
            "Nickname",
            `${oldMember.nickname || "None"} → ${newMember.nickname || "None"}`
          )
        );
      }

      if (
        oldMember.roles.cache.size !==
        newMember.roles.cache.size
      ) {
        changes.push(
          field(
            "Roles",
            `${oldMember.roles.cache.size} → ${newMember.roles.cache.size}`
          )
        );
      }

      if (!changes.length) {
        return;
      }

      await log(
        newMember.guild,
        "members",
        "👤 Member Updated",
        [
          field(
            "Member",
            newMember.toString()
          ),
          ...changes
        ]
      );
    } catch {}
  }
);

/* =========================================================
   READY
========================================================= */

client.once(
  "clientReady",
  async () => {
    console.log(
      `🤖 Logged in as ${client.user.tag}`
    );

    try {
      await registerCommands();

      console.log(
        `✅ AkiyO online — ${commands.length} unique commands.`
      );

      console.log(
        "🛡️ AutoMod: READY"
      );

      console.log(
        "🔐 Anti-Nuke: READY"
      );

      console.log(
        "🎫 Ticket System: READY"
      );

      console.log(
        "🎭 Reaction Roles: READY"
      );

      console.log(
        "✅ Verification: READY"
      );

      console.log(
        "👤 Autorole: READY"
      );

      console.log(
        "👋 Welcome: READY"
      );

      console.log(
        "🏆 Leaderboard: READY"
      );

      console.log(
        "📢 Announcement System: READY"
      );

      console.log(
        "📜 Logging System: READY"
      );

    } catch (error) {
      console.error(
        "❌ Command registration error:",
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
      "Unhandled Rejection:",
      error
    );
  }
);

process.on(
  "uncaughtException",
  error => {
    console.error(
      "Uncaught Exception:",
      error
    );
  }
);

/* =========================================================
   LOGIN
========================================================= */

client.login(TOKEN)
  .catch(error => {
    console.error(
      "❌ Discord login failed:",
      error
    );
    process.exit(1);
  });
