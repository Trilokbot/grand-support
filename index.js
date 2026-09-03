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
const http = require("http");

/* =========================
   ENVIRONMENT
========================= */

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || "1542750606739898428";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5.5";

if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN is missing.");
  process.exit(1);
}

/* =========================
   BOT-HOSTING WEB SERVER
========================= */

const PORT = Number(process.env.PORT) || 10000;

http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain"
  });
  res.end("AkiyO Bot Online");
}).listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

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

const LOG_TYPES = [
  "automod",
  "audit",
  "security",
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
    action: "alert",
    trustedUsers: [],
    trustedBots: [],
    trustedMembers: [],
    trustedRoleId: null,
    protectedRoles: [],
    protectedChannels: []
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

  warnings: {},
  punishments: {},
  suggestions: {}
};

let db = {
  guilds: {},
  tickets: {},
  meta: {
    version: 1
  }
};

try {
  if (fs.existsSync(DATA_FILE)) {
    db = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  }
} catch (err) {
  console.error("❌ Database load error:", err);
}

function save() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  } catch (err) {
    console.error("❌ Database save error:", err);
  }
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function merge(target, source) {
  for (const key of Object.keys(source || {})) {
    if (
      source[key] &&
      typeof source[key] === "object" &&
      !Array.isArray(source[key])
    ) {
      target[key] = merge(target[key] || {}, source[key]);
    } else {
      target[key] = source[key];
    }
  }

  return target;
}

function guildConfig(guild) {
  if (!db.guilds[guild.id]) {
    db.guilds[guild.id] = clone(DEFAULT_GUILD);
  }

  db.guilds[guild.id] = merge(
    clone(DEFAULT_GUILD),
    db.guilds[guild.id]
  );

  for (const type of LOG_TYPES) {
    if (!db.guilds[guild.id].logs[type]) {
      db.guilds[guild.id].logs[type] = null;
    }
  }

  return db.guilds[guild.id];
}

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

function isStaff(member) {
  if (!member) return false;

  const c = guildConfig(member.guild);

  return (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild) ||
    (
      c.ticket.staffRoleId &&
      member.roles.cache.has(c.ticket.staffRoleId)
    )
  );
}

function isOwner(id) {
  const owners = new Set(
    (process.env.BOT_OWNER_IDS || "")
      .split(",")
      .map(x => x.trim())
      .filter(Boolean)
  );

  const owner = client.application?.owner;

  if (owner?.id) {
    owners.add(owner.id);
  }

  if (owner?.members) {
    for (const member of owner.members.values()) {
      owners.add(member.id);
    }
  }

  return owners.has(id);
}

function isTrusted(guild, userId) {
  const c = guildConfig(guild);
  const member = guild.members.cache.get(userId);

  return (
    member?.permissions.has(PermissionFlagsBits.Administrator) ||
    c.security.trustedUsers.includes(userId) ||
    c.security.trustedBots.includes(userId) ||
    c.security.trustedMembers.includes(userId) ||
    (
      c.security.trustedRoleId &&
      member?.roles.cache.has(c.security.trustedRoleId)
    )
  );
}

async function sendLog(guild, type, title, fields = [], color) {
  try {
    const c = guildConfig(guild);
    const channelId = c.logs[type];

    if (!channelId) return;

    const channel = await guild.channels.fetch(channelId).catch(() => null);

    if (!channel?.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setTimestamp();

    if (color) embed.setColor(color);

    if (fields.length) {
      embed.addFields(fields.slice(0, 25));
    }

    await channel.send({
      embeds: [embed]
    }).catch(() => {});
  } catch (err) {
    console.error("Log error:", err);
  }
}

/* =========================
   MODERATION
========================= */

async function addPunishment(guild, userId, type, reason, moderator) {
  if (!db.guilds[guild.id]) guildConfig(guild);

  db.guilds[guild.id].punishments[userId] ||= [];

  db.guilds[guild.id].punishments[userId].push({
    type,
    reason,
    moderator,
    time: Date.now()
  });

  save();
}

async function addWarning(member, reason, moderator) {
  const guild = member.guild;

  guildConfig(guild).warnings[member.id] ||= [];

  guildConfig(guild).warnings[member.id].push({
    reason,
    moderator,
    time: Date.now()
  });

  await addPunishment(
    guild,
    member.id,
    "warn",
    reason,
    moderator
  );

  const count = guildConfig(guild).warnings[member.id].length;

  /* Warning escalation */

  if (count >= 7) {
    if (member.bannable) {
      await member.ban({
        reason: "Automatic punishment: 7 warnings"
      }).catch(() => {});
      await addPunishment(
        guild,
        member.id,
        "auto-ban",
        "Reached 7 warnings",
        client.user.id
      );
    }
  } else if (count >= 5) {
    if (member.kickable) {
      await member.kick(
        "Automatic punishment: 5 warnings"
      ).catch(() => {});
      await addPunishment(
        guild,
        member.id,
        "auto-kick",
        "Reached 5 warnings",
        client.user.id
      );
    }
  } else if (count >= 3) {
    if (member.moderatable) {
      await member.timeout(
        10 * 60 * 1000,
        "Automatic punishment: 3 warnings"
      ).catch(() => {});
      await addPunishment(
        guild,
        member.id,
        "auto-timeout",
        "Reached 3 warnings",
        client.user.id
      );
    }
  }

  save();

  return count;
}

/* =========================
   AUTOMOD
========================= */

const spamTracker = new Map();
const repeatTracker = new Map();

async function runAutoMod(message) {
  if (!message.guild || !message.member) return;
  if (message.author.bot) return;
  if (isStaff(message.member)) return;

  const c = guildConfig(message.guild);

  if (!c.automod.enabled) return;

  const content = message.content || "";
  const lower = content.toLowerCase();

  let type = null;
  let reason = null;

  if (
    c.automod.invite &&
    /discord(?:\.gg|\.com\/invite)\/[a-z0-9-]+/i.test(content)
  ) {
    type = "invite";
    reason = "Discord invite link";
  }

  if (
    !type &&
    c.automod.massMentions &&
    (
      message.mentions.everyone ||
      message.mentions.users.size >= c.automod.userMentionsLimit ||
      message.mentions.roles.size >= c.automod.roleMentionsLimit
    )
  ) {
    type = "massmention";
    reason = "Excessive mentions";
  }

  if (!type) {
    for (const word of c.automod.badWords) {
      if (
        word &&
        lower.includes(String(word).toLowerCase())
      ) {
        type = "badword";
        reason = `Blocked word: ${word}`;
        break;
      }
    }
  }

  if (!type) {
    const letters = content.replace(/[^A-Za-z]/g, "");

    if (letters.length >= 8) {
      const caps =
        letters.replace(/[^A-Z]/g, "").length /
        letters.length *
        100;

      if (caps >= c.automod.capsPercent) {
        type = "caps";
        reason = "Excessive capital letters";
      }
    }
  }

  const now = Date.now();

  const spamKey = `${message.guild.id}:${message.author.id}`;

  const spam = (
    spamTracker.get(spamKey) || []
  ).filter(
    time => now - time < c.automod.spamWindow
  );

  spam.push(now);
  spamTracker.set(spamKey, spam);

  if (
    !type &&
    spam.length >= c.automod.spamLimit
  ) {
    type = "spam";
    reason = `Spam detected: ${spam.length} messages`;
    spamTracker.delete(spamKey);
  }

  const repeatKey = `${message.guild.id}:${message.author.id}`;

  const old = repeatTracker.get(repeatKey);

  if (
    old &&
    old.content === content &&
    now - old.time < 30000
  ) {
    old.count++;
    old.time = now;
  } else {
    repeatTracker.set(repeatKey, {
      content,
      count: 1,
      time: now
    });
  }

  const repeated = repeatTracker.get(repeatKey);

  if (
    !type &&
    repeated &&
    repeated.count >= c.automod.repeatedLimit
  ) {
    type = "repeat";
    reason = "Repeated message spam";
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
    const seconds =
      c.automod.timeoutSeconds[type] || 60;

    await message.member.timeout(
      seconds * 1000,
      `AutoMod: ${reason}`
    ).catch(() => {});
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
      field("Channel", message.channel.toString())
    ],
    0xed4245
  );
}

/* =========================
   TICKETS
========================= */

function ticketForUser(userId, guildId) {
  return Object.values(db.tickets).find(
    ticket =>
      ticket.userId === userId &&
      ticket.guildId === guildId &&
      ticket.closed !== true
  );
}

function ticketForChannel(channelId) {
  return db.tickets[channelId];
}

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

async function createTicket(guild, user) {
  const c = guildConfig(guild);

  const existing = ticketForUser(user.id, guild.id);

  if (existing) {
    const oldChannel =
      await guild.channels.fetch(existing.channelId).catch(() => null);

    if (oldChannel) {
      return oldChannel;
    }

    delete db.tickets[existing.channelId];
  }

  if (!c.ticket.staffRoleId) {
    return null;
  }

  const staffRole =
    await guild.roles.fetch(c.ticket.staffRoleId).catch(() => null);

  if (!staffRole) return null;

  const channel = await guild.channels.create({
    name:
      `ticket-${user.username}`
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "")
        .slice(0, 20) || "ticket",

    type: ChannelType.GuildText,

    parent: c.ticket.categoryId || undefined,

    topic: `AKIYO_TICKET:${user.id}`,

    permissionOverwrites: [
      {
        id: guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel]
      },
      {
        id: staffRole.id,
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

  db.tickets[channel.id] = {
    channelId: channel.id,
    guildId: guild.id,
    userId: user.id,
    closed: false,
    claimedBy: null,
    createdAt: Date.now()
  };

  save();

  await channel.send({
    content: `<@&${staffRole.id}>`,
    embeds: [
      new EmbedBuilder()
        .setTitle("🎫 New Support Ticket")
        .setDescription(
          `**User:** <@${user.id}>\n\nPlease assist the user.`
        )
        .setTimestamp()
    ],
    components: [ticketButtons()]
  });

  await user.send(
    `🎫 Your support ticket has been created in **${guild.name}**.\n\nSend your messages here in DM and the support team will receive them.`
  ).catch(() => {});

  await sendLog(
    guild,
    "tickets",
    "🎫 Ticket Created",
    [
      field("User", `${user.tag} (${user.id})`),
      field("Channel", channel.toString())
    ],
    0x57f287
  );

  return channel;
}

async function createTranscript(channel) {
  const messages = [];

  let before;

  while (messages.length < 5000) {
    const batch =
      await channel.messages.fetch({
        limit: 100,
        before
      }).catch(() => null);

    if (!batch?.size) break;

    messages.push(...batch.values());

    before = batch.last().id;

    if (batch.size < 100) break;
  }

  messages.reverse();

  const text = messages.map(message => {
    return [
      `[${message.createdAt.toISOString()}]`,
      `${message.author.tag} (${message.author.id})`,
      message.content || "[No text]",
      ...message.attachments.map(a => a.url),
      ""
    ].join("\n");
  }).join("\n");

  return Buffer.from(text, "utf8");
}

async function closeTicket(channel) {
  const ticket = ticketForChannel(channel.id);

  if (!ticket) return;

  const transcript = await createTranscript(channel);
  const guild = channel.guild;
  const c = guildConfig(guild);

  if (c.ticket.logChannelId) {
    const logChannel =
      await guild.channels.fetch(c.ticket.logChannelId).catch(() => null);

    if (logChannel?.isTextBased()) {
      await logChannel.send({
        content: `📄 Ticket transcript — <@${ticket.userId}>`,
        files: [
          {
            attachment: transcript,
            name: `ticket-${channel.id}.txt`
          }
        ]
      }).catch(() => {});
    }
  }

  await channel.permissionOverwrites.edit(
    ticket.userId,
    {
      ViewChannel: true,
      SendMessages: false
    }
  ).catch(() => {});

  ticket.closed = true;

  save();

  await channel.send(
    "🔒 **Ticket closed.** Staff can use `/reopen` if required."
  ).catch(() => {});

  await sendLog(
    guild,
    "tickets",
    "🔒 Ticket Closed",
    [
      field("User", `<@${ticket.userId}>`),
      field("Channel", channel.toString())
    ]
  );
}

/* =========================
   COMMANDS
========================= */

const commands = [];

const addCommand = command => {
  commands.push(command.toJSON());
};

/* Help */

addCommand(
  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show AkiyO commands.")
);

/* Bot info */

addCommand(
  new SlashCommandBuilder()
    .setName("botinfo")
    .setDescription("Show bot information.")
);

/* Tickets */

addCommand(
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Create a support ticket.")
);

addCommand(
  new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription("Send the ticket panel.")
);

addCommand(
  new SlashCommandBuilder()
    .setName("ticketsetup")
    .setDescription("Configure the ticket system.")
    .addChannelOption(o =>
      o.setName("category")
        .setDescription("Ticket category.")
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true)
    )
    .addRoleOption(o =>
      o.setName("staffrole")
        .setDescription("Ticket staff role.")
        .setRequired(true)
    )
);

for (const name of [
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
      .setName(name)
      .setDescription(`${name} the current ticket.`)
  );
}

addCommand(
  new SlashCommandBuilder()
    .setName("ticketstats")
    .setDescription("Show ticket statistics.")
);

addCommand(
  new SlashCommandBuilder()
    .setName("ticketadd")
    .setDescription("Add a user to a ticket.")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User.")
        .setRequired(true)
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName("ticketremove")
    .setDescription("Remove a user from a ticket.")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("User.")
        .setRequired(true)
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName("ticketrename")
    .setDescription("Rename the ticket.")
    .addStringOption(o =>
      o.setName("name")
        .setDescription("New name.")
        .setRequired(true)
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName("ticketinfo")
    .setDescription("Show ticket information.")
);

/* AutoMod */

addCommand(
  new SlashCommandBuilder()
    .setName("automod")
    .setDescription("Configure AutoMod.")
    .addSubcommand(s =>
      s.setName("enable").setDescription("Enable AutoMod.")
    )
    .addSubcommand(s =>
      s.setName("disable").setDescription("Disable AutoMod.")
    )
    .addSubcommand(s =>
      s.setName("status").setDescription("Show AutoMod status.")
    )
    .addSubcommand(s =>
      s.setName("badword")
        .setDescription("Add a blocked word.")
        .addStringOption(o =>
          o.setName("word")
            .setDescription("Word.")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("removebadword")
        .setDescription("Remove a blocked word.")
        .addStringOption(o =>
          o.setName("word")
            .setDescription("Word.")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("config")
        .setDescription("Configure AutoMod.")
        .addIntegerOption(o =>
          o.setName("spam_limit")
            .setDescription("Spam limit.")
            .setMinValue(3)
            .setMaxValue(30)
        )
        .addIntegerOption(o =>
          o.setName("timeout")
            .setDescription("Timeout seconds.")
            .setMinValue(10)
            .setMaxValue(604800)
        )
        .addIntegerOption(o =>
          o.setName("caps_percent")
            .setDescription("Caps percentage.")
            .setMinValue(50)
            .setMaxValue(100)
        )
    )
);

/* Security */

addCommand(
  new SlashCommandBuilder()
    .setName("security")
    .setDescription("Configure Anti-Nuke security.")
    .addSubcommand(s =>
      s.setName("enable").setDescription("Enable security.")
    )
    .addSubcommand(s =>
      s.setName("disable").setDescription("Disable security.")
    )
    .addSubcommand(s =>
      s.setName("status").setDescription("Security status.")
    )
    .addSubcommand(s =>
      s.setName("trusted")
        .setDescription("Trust a user.")
        .addUserOption(o =>
          o.setName("user")
            .setDescription("User.")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("untrusted")
        .setDescription("Remove trusted user.")
        .addUserOption(o =>
          o.setName("user")
            .setDescription("User.")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("trustedrole")
        .setDescription("Set trusted role.")
        .addRoleOption(o =>
          o.setName("role")
            .setDescription("Role.")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("protectedrole")
        .setDescription("Protect a role.")
        .addRoleOption(o =>
          o.setName("role")
            .setDescription("Role.")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("protectedchannel")
        .setDescription("Protect a channel.")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Channel.")
            .setRequired(true)
        )
    )
);

/* Config */

addCommand(
  new SlashCommandBuilder()
    .setName("config")
    .setDescription("Configure AkiyO.")
    .addSubcommand(s =>
      s.setName("log")
        .setDescription("Set a log channel.")
        .addStringOption(o =>
          o.setName("type")
            .setDescription("Log type.")
            .setRequired(true)
            .addChoices(
              ...LOG_TYPES.map(type => ({
                name: type,
                value: type
              }))
            )
        )
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Channel.")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("suggestions")
        .setDescription("Set suggestion channel.")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Channel.")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
    )
);

/* Moderation */

for (const [name, description] of [
  ["warn", "Warn a member."],
  ["timeout", "Timeout a member."],
  ["kick", "Kick a member."],
  ["ban", "Ban a member."]
]) {
  addCommand(
    new SlashCommandBuilder()
      .setName(name)
      .setDescription(description)
      .addUserOption(o =>
        o.setName("user")
          .setDescription("Member.")
          .setRequired(true)
      )
      .addStringOption(o =>
        o.setName("reason")
          .setDescription("Reason.")
          .setRequired(true)
      )
      .addIntegerOption(o =>
        o.setName("seconds")
          .setDescription("Timeout seconds.")
          .setMinValue(10)
          .setMaxValue(2419200)
          .setRequired(name === "timeout")
      )
  );
}

addCommand(
  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unban a user.")
    .addStringOption(o =>
      o.setName("user_id")
        .setDescription("User ID.")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason.")
        .setRequired(true)
    )
);

for (const name of ["warnings", "punishments"]) {
  addCommand(
    new SlashCommandBuilder()
      .setName(name)
      .setDescription(`View ${name}.`)
      .addUserOption(o =>
        o.setName("user")
          .setDescription("User.")
          .setRequired(true)
      )
  );
}

/* Suggestions */

addCommand(
  new SlashCommandBuilder()
    .setName("suggest")
    .setDescription("Create a suggestion.")
    .addStringOption(o =>
      o.setName("text")
        .setDescription("Suggestion.")
        .setRequired(true)
    )
);

/* Announcement */

addCommand(
  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Send an announcement.")
    .addChannelOption(o =>
      o.setName("channel")
        .setDescription("Channel.")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("message")
        .setDescription("Message.")
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName("title")
        .setDescription("Embed title.")
    )
    .addBooleanOption(o =>
      o.setName("everyone")
        .setDescription("Mention everyone.")
    )
);

/* Autorole */

addCommand(
  new SlashCommandBuilder()
    .setName("autorole")
    .setDescription("Configure autorole.")
    .addSubcommand(s =>
      s.setName("set")
        .setDescription("Set autorole.")
        .addRoleOption(o =>
          o.setName("role")
            .setDescription("Role.")
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
    )
);

/* Welcome */

addCommand(
  new SlashCommandBuilder()
    .setName("welcome")
    .setDescription("Configure welcome.")
    .addSubcommand(s =>
      s.setName("set")
        .setDescription("Set welcome.")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Channel.")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName("message")
            .setDescription("Message.")
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
    )
);

/* Verification */

addCommand(
  new SlashCommandBuilder()
    .setName("verification")
    .setDescription("Configure verification.")
    .addSubcommand(s =>
      s.setName("setup")
        .setDescription("Setup verification.")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Channel.")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addRoleOption(o =>
          o.setName("role")
            .setDescription("Verified role.")
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
    )
);

/* Leaderboard */

addCommand(
  new SlashCommandBuilder()
    .setName("leaderboard")
    .setDescription("Message leaderboard.")
    .addSubcommand(s =>
      s.setName("top").setDescription("Show leaderboard.")
    )
    .addSubcommand(s =>
      s.setName("reset").setDescription("Reset leaderboard.")
    )
    .addSubcommand(s =>
      s.setName("enable").setDescription("Enable leaderboard.")
    )
    .addSubcommand(s =>
      s.setName("disable").setDescription("Disable leaderboard.")
    )
);

/* AI */

addCommand(
  new SlashCommandBuilder()
    .setName("ai")
    .setDescription("Talk with AkiyO AI.")
    .addSubcommand(s =>
      s.setName("ask")
        .setDescription("Ask AI.")
        .addStringOption(o =>
          o.setName("prompt")
            .setDescription("Your question.")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("reset")
        .setDescription("Reset your AI conversation.")
    )
);

/* =========================
   REGISTER GLOBAL COMMANDS
========================= */

async function registerCommands() {
  const rest = new REST({ version: "10" })
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
   MESSAGE SYSTEM
========================= */

const aiHistory = new Map();

client.on("messageCreate", async message => {
  try {
    if (message.author.bot) return;

    /* DM → active ticket */

    if (!message.guild) {
      const ticket = Object.values(db.tickets).find(
        t =>
          t.userId === message.author.id &&
          t.closed !== true
      );

      if (!ticket) {
        await message.author.send(
          "❌ You don't have an active support ticket."
        ).catch(() => {});
        return;
      }

      const guild =
        client.guilds.cache.get(ticket.guildId);

      if (!guild) return;

      const channel =
        await guild.channels.fetch(ticket.channelId)
          .catch(() => null);

      if (!channel?.isTextBased()) return;

      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("📩 User Message")
            .setDescription(
              message.content || "[Attachment]"
            )
            .setFooter({
              text: message.author.tag
            })
            .setTimestamp()
        ]
      }).catch(() => {});

      return;
    }

    const c = guildConfig(message.guild);

    /* Ticket staff → user DM */

    const ticket = ticketForChannel(message.channel.id);

    if (
      ticket &&
      isStaff(message.member)
    ) {
      const user =
        await client.users.fetch(ticket.userId)
          .catch(() => null);

      if (user) {
        await user.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("💬 Support Team")
              .setDescription(
                message.content || "[Attachment]"
              )
              .setTimestamp()
          ]
        }).catch(() => {});
      }

      return;
    }

    /* Leaderboard */

    if (c.leaderboard.enabled) {
      c.leaderboard.messages[message.author.id] =
        (c.leaderboard.messages[message.author.id] || 0) + 1;

      if (
        c.leaderboard.messages[message.author.id] % 10 === 0
      ) {
        save();
      }
    }

    await runAutoMod(message);

  } catch (err) {
    console.error("messageCreate:", err);
  }
});

/* =========================
   MEMBER JOIN
========================= */

client.on("guildMemberAdd", async member => {
  try {
    const c = guildConfig(member.guild);

    if (
      c.autorole.enabled &&
      c.autorole.roleId
    ) {
      const role =
        await member.guild.roles.fetch(c.autorole.roleId)
          .catch(() => null);

      if (
        role &&
        role.position <
        member.guild.members.me.roles.highest.position
      ) {
        await member.roles.add(
          role,
          "AkiyO Autorole"
        ).catch(() => {});
      }

      await sendLog(
        member.guild,
        "members",
        "👤 Autorole",
        [
          field("User", member.toString()),
          field("Role", role?.toString() || "Missing")
        ]
      );
    }

    if (
      c.welcome.enabled &&
      c.welcome.channelId
    ) {
      const channel =
        await member.guild.channels.fetch(
          c.welcome.channelId
        ).catch(() => null);

      if (channel?.isTextBased()) {
        const text =
          c.welcome.message
            .replaceAll("{user}", member.toString())
            .replaceAll("{username}", member.user.username)
            .replaceAll("{server}", member.guild.name)
            .replaceAll(
              "{count}",
              String(member.guild.memberCount)
            );

        await channel.send(text).catch(() => {});
      }
    }

  } catch (err) {
    console.error("guildMemberAdd:", err);
  }
});

/* =========================
   SECURITY AUDIT
========================= */

const securityTracker = new Map();

async function securityAction(
  guild,
  type,
  executorId,
  details
) {
  if (!executorId) return;

  const c = guildConfig(guild);

  if (!c.security.enabled) return;

  if (isTrusted(guild, executorId)) return;

  const key = `${guild.id}:${type}:${executorId}`;

  const now = Date.now();

  const list = (
    securityTracker.get(key) || []
  ).filter(
    time => now - time < 30000
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

  await sendLog(
    guild,
    "security",
    "🚨 Anti-Nuke Alert",
    [
      field("Executor", `<@${executorId}>`),
      field("Action", type),
      field("Count", list.length),
      field("Details", details)
    ],
    0xed4245
  );

  if (c.security.action === "ban") {
    const member =
      await guild.members.fetch(executorId)
        .catch(() => null);

    if (member?.bannable) {
      await member.ban({
        reason: `AkiyO Anti-Nuke: ${type}`
      }).catch(() => {});
    }
  }

  securityTracker.delete(key);
}

client.on(
  "guildAuditLogEntryCreate",
  async (entry, guild) => {
    try {
      await sendLog(
        guild,
        "audit",
        "📜 Audit Log",
        [
          field("Action", entry.action),
          field(
            "Executor",
            entry.executor
              ? `${entry.executor.tag || entry.executor.username} (${entry.executor.id})`
              : "Unknown"
          ),
          field("Target", entry.targetId || "Unknown"),
          field("Reason", entry.reason || "None")
        ]
      );
    } catch (err) {
      console.error("audit:", err);
    }
  }
);

/* =========================
   INTERACTIONS
========================= */

client.on("interactionCreate", async interaction => {
  try {

    /* =====================
       BUTTONS
    ===================== */

    if (interaction.isButton()) {

      if (interaction.customId === "create_ticket") {
        if (!interaction.guild) {
          return interaction.reply({
            content: "❌ Use this button inside a server.",
            ephemeral: true
          });
        }

        const channel =
          await createTicket(
            interaction.guild,
            interaction.user
          );

        if (!channel) {
          return interaction.reply({
            content:
              "❌ Ticket system isn't configured. Ask an administrator to run `/ticketsetup`.",
            ephemeral: true
          });
        }

        return interaction.reply({
          content:
            "🎫 Ticket created! Check your DMs.",
          ephemeral: true
        });
      }

      if (
        interaction.customId === "verify_user"
      ) {
        if (!interaction.guild) return;

        const c = guildConfig(interaction.guild);

        const role =
          await interaction.guild.roles.fetch(
            c.verification.roleId
          ).catch(() => null);

        if (!role) {
          return interaction.reply({
            content: "❌ Verification role missing.",
            ephemeral: true
          });
        }

        if (
          role.position >=
          interaction.guild.members.me.roles.highest.position
        ) {
          return interaction.reply({
            content:
              "❌ My bot role must be above the verification role.",
            ephemeral: true
          });
        }

        await interaction.member.roles.add(
          role,
          "AkiyO Verification"
        ).catch(() => {});

        await sendLog(
          interaction.guild,
          "verification",
          "✅ User Verified",
          [
            field(
              "User",
              interaction.user.toString()
            ),
            field("Role", role.toString())
          ],
          0x57f287
        );

        return interaction.reply({
          content: "✅ You are verified!",
          ephemeral: true
        });
      }

      const ticket = ticketForChannel(
        interaction.channel?.id
      );

      if (!ticket) {
        return interaction.reply({
          content: "❌ This isn't a ticket.",
          ephemeral: true
        });
      }

      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content: "❌ Staff only.",
          ephemeral: true
        });
      }

      if (
        interaction.customId === "ticket_claim"
      ) {
        ticket.claimedBy = interaction.user.id;
        save();

        return interaction.reply(
          `✅ Ticket claimed by ${interaction.user}.`
        );
      }

      if (
        interaction.customId === "ticket_close"
      ) {
        await interaction.reply("🔒 Closing ticket...");
        return closeTicket(interaction.channel);
      }

      if (
        interaction.customId === "ticket_lock"
      ) {
        await interaction.channel.permissionOverwrites.edit(
          ticket.userId,
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
        interaction.customId === "ticket_transcript"
      ) {
        const transcript =
          await createTranscript(
            interaction.channel
          );

        const c =
          guildConfig(interaction.guild);

        if (c.ticket.logChannelId) {
          const logChannel =
            await interaction.guild.channels.fetch(
              c.ticket.logChannelId
            ).catch(() => null);

          if (logChannel?.isTextBased()) {
            await logChannel.send({
              files: [
                {
                  attachment: transcript,
                  name:
                    `ticket-${interaction.channel.id}.txt`
                }
              ]
            }).catch(() => {});
          }
        }

        return interaction.reply({
          content:
            "✅ Transcript sent to ticket logs.",
          ephemeral: true
        });
      }

      return;
    }

    if (!interaction.isChatInputCommand()) return;

    if (!interaction.guild) {
      return interaction.reply({
        content:
          "❌ This command must be used inside a server.",
        ephemeral: true
      });
    }

    const command =
      interaction.commandName;

    const staffCommands = new Set([
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
      "ticketrename",
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
      "announce",
      "autorole",
      "welcome",
      "verification",
      "leaderboard"
    ]);

    if (
      staffCommands.has(command) &&
      !isStaff(interaction.member)
    ) {
      return interaction.reply({
        content: "❌ You do not have permission.",
        ephemeral: true
      });
    }

    /* =====================
       HELP
    ===================== */

    if (command === "help") {
      const embed = new EmbedBuilder()
        .setTitle("🤖 AkiyO Commands")
        .setDescription(
          [
            "**🎫 Tickets**",
            "`/ticket` `/ticketpanel` `/ticketsetup`",
            "`/close` `/reopen` `/delete` `/claim` `/lock`",
            "",
            "**🛡️ Security**",
            "`/automod` `/security` `/config`",
            "",
            "**⚖️ Moderation**",
            "`/warn` `/timeout` `/kick` `/ban` `/unban`",
            "`/warnings` `/punishments`",
            "",
            "**⚙️ Systems**",
            "`/suggest` `/announce` `/autorole`",
            "`/welcome` `/verification` `/leaderboard`",
            "",
            "**🤖 AI**",
            "`/ai ask` `/ai reset`"
          ].join("\n")
        )
        .setTimestamp();

      return interaction.reply({
        embeds: [embed],
        ephemeral: true
      });
    }

    /* =====================
       BOT INFO
    ===================== */

    if (command === "botinfo") {
      const users =
        client.guilds.cache.reduce(
          (total, guild) =>
            total + (guild.memberCount || 0),
          0
        );

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🤖 AkiyO")
            .setDescription(
              "A powerful multi-server Discord support and management bot."
            )
            .addFields(
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
                "Discord.js",
                require("discord.js").version,
                true
              )
            )
            .setTimestamp()
        ]
      });
    }

    /* =====================
       TICKET
    ===================== */

    if (command === "ticket") {
      const channel =
        await createTicket(
          interaction.guild,
          interaction.user
        );

      if (!channel) {
        return interaction.reply({
          content:
            "❌ Ticket system isn't configured. Use `/ticketsetup` first.",
          ephemeral: true
        });
      }

      return interaction.reply({
        content:
          "🎫 Your ticket has been created. Check your DMs.",
        ephemeral: true
      });
    }

    if (command === "ticketpanel") {
      const row =
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId("create_ticket")
            .setLabel("Open Support Ticket")
            .setEmoji("🎫")
            .setStyle(ButtonStyle.Primary)
        );

      await interaction.channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle("🎫 AkiyO Support Center")
            .setDescription(
              "Need help? Click the button below to create a private support ticket."
            )
        ],
        components: [row]
      });

      return interaction.reply({
        content: "✅ Ticket panel sent.",
        ephemeral: true
      });
    }

    if (command === "ticketsetup") {
      const category =
        interaction.options.getChannel("category");

      const staffRole =
        interaction.options.getRole("staffrole");

      const c =
        guildConfig(interaction.guild);

      c.ticket.categoryId = category.id;
      c.ticket.staffRoleId = staffRole.id;

      save();

      return interaction.reply(
        "✅ Ticket system configured for this server."
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
        return interaction.reply({
          content: "❌ This isn't a ticket.",
          ephemeral: true
        });
      }

      if (command === "close") {
        await interaction.reply(
          "🔒 Closing ticket..."
        );

        return closeTicket(
          interaction.channel
        );
      }

      if (command === "reopen") {
        ticket.closed = false;

        await interaction.channel.permissionOverwrites.edit(
          ticket.userId,
          {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
          }
        );

        save();

        return interaction.reply(
          "🔓 Ticket reopened."
        );
      }

      if (command === "delete") {
        delete db.tickets[interaction.channel.id];
        save();

        await interaction.reply(
          "🗑️ Deleting ticket..."
        );

        return interaction.channel.delete()
          .catch(() => {});
      }

      if (command === "claim") {
        ticket.claimedBy =
          interaction.user.id;

        save();

        return interaction.reply(
          `✅ Claimed by ${interaction.user}.`
        );
      }

      if (command === "unclaim") {
        ticket.claimedBy = null;
        save();

        return interaction.reply(
          "✅ Ticket unclaimed."
        );
      }

      if (command === "lock") {
        await interaction.channel.permissionOverwrites.edit(
          ticket.userId,
          {
            ViewChannel: true,
            SendMessages: false
          }
        );

        return interaction.reply(
          "🔐 Ticket locked."
        );
      }

      if (command === "unlock") {
        await interaction.channel.permissionOverwrites.edit(
          ticket.userId,
          {
            ViewChannel: true,
            SendMessages: true
          }
        );

        return interaction.reply(
          "🔓 Ticket unlocked."
        );
      }
    }

    if (command === "ticketstats") {
      const total =
        Object.values(db.tickets).filter(
          t => t.guildId === interaction.guild.id
        ).length;

      return interaction.reply(
        `🎫 Tickets in this server: **${total}**`
      );
    }

    if (command === "ticketadd") {
      const ticket =
        ticketForChannel(
          interaction.channel.id
        );

      if (!ticket) {
        return interaction.reply(
          "❌ Not a ticket."
        );
      }

      const user =
        interaction.options.getUser("user");

      await interaction.channel.permissionOverwrites.edit(
        user.id,
        {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true
        }
      );

      return interaction.reply(
        `✅ Added ${user} to the ticket.`
      );
    }

    if (command === "ticketremove") {
      const ticket =
        ticketForChannel(
          interaction.channel.id
        );

      if (!ticket) {
        return interaction.reply(
          "❌ Not a ticket."
        );
      }

      const user =
        interaction.options.getUser("user");

      await interaction.channel.permissionOverwrites
        .delete(user.id)
        .catch(() => {});

      return interaction.reply(
        `✅ Removed ${user} from the ticket.`
      );
    }

    if (command === "ticketrename") {
      const ticket =
        ticketForChannel(
          interaction.channel.id
        );

      if (!ticket) {
        return interaction.reply(
          "❌ Not a ticket."
        );
      }

      const name =
        interaction.options
          .getString("name")
          .replace(/[^a-zA-Z0-9-_]/g, "-")
          .slice(0, 90);

      await interaction.channel.setName(name);

      return interaction.reply(
        `✅ Ticket renamed to **${name}**.`
      );
    }

    if (command === "ticketinfo") {
      const ticket =
        ticketForChannel(
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
            .setTitle("🎫 Ticket Information")
            .addFields(
              field(
                "User",
                `<@${ticket.userId}>`
              ),
              field(
                "Status",
                ticket.closed
                  ? "Closed"
                  : "Open"
              ),
              field(
                "Claimed By",
                ticket.claimedBy
                  ? `<@${ticket.claimedBy}>`
                  : "Nobody"
              )
            )
        ]
      });
    }

    /* =====================
       AUTOMOD
    ===================== */

    if (command === "automod") {
      const c =
        guildConfig(interaction.guild);

      const sub =
        interaction.options.getSubcommand();

      if (sub === "enable") {
        c.automod.enabled = true;
      }

      if (sub === "disable") {
        c.automod.enabled = false;
      }

      if (sub === "badword") {
        const word =
          interaction.options
            .getString("word")
            .toLowerCase();

        if (!c.automod.badWords.includes(word)) {
          c.automod.badWords.push(word);
        }
      }

      if (sub === "removebadword") {
        const word =
          interaction.options
            .getString("word")
            .toLowerCase();

        c.automod.badWords =
          c.automod.badWords.filter(
            x => x !== word
          );
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
          c.automod.spamLimit = spam;
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

        if (caps !== null) {
          c.automod.capsPercent = caps;
        }
      }

      save();

      if (sub === "status") {
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("🛡️ AutoMod Status")
              .addFields(
                field(
                  "Enabled",
                  c.automod.enabled
                    ? "Yes"
                    : "No",
                  true
                ),
                field(
                  "Spam Limit",
                  c.automod.spamLimit,
                  true
                ),
                field(
                  "Caps",
                  `${c.automod.capsPercent}%`,
                  true
                ),
                field(
                  "Bad Words",
                  c.automod.badWords.length,
                  true
                )
              )
          ]
        });
      }

      return interaction.reply(
        "✅ AutoMod configuration updated."
      );
    }

    /* =====================
       SECURITY
    ===================== */

    if (command === "security") {
      const c =
        guildConfig(interaction.guild);

      const sub =
        interaction.options.getSubcommand();

      if (sub === "enable") {
        c.security.enabled = true;
      }

      if (sub === "disable") {
        c.security.enabled = false;
      }

      if (sub === "trusted") {
        const user =
          interaction.options.getUser("user");

        if (!c.security.trustedUsers.includes(user.id)) {
          c.security.trustedUsers.push(user.id);
        }
      }

      if (sub === "untrusted") {
        const user =
          interaction.options.getUser("user");

        c.security.trustedUsers =
          c.security.trustedUsers.filter(
            id => id !== user.id
          );
      }

      if (sub === "trustedrole") {
        c.security.trustedRoleId =
          interaction.options.getRole("role").id;
      }

      if (sub === "protectedrole") {
        const id =
          interaction.options.getRole("role").id;

        if (!c.security.protectedRoles.includes(id)) {
          c.security.protectedRoles.push(id);
        }
      }

      if (sub === "protectedchannel") {
        const id =
          interaction.options.getChannel("channel").id;

        if (!c.security.protectedChannels.includes(id)) {
          c.security.protectedChannels.push(id);
        }
      }

      save();

      if (sub === "status") {
        return interaction.reply(
          [
            `🔐 Security: **${c.security.enabled ? "ON" : "OFF"}**`,
            `Trusted users: **${c.security.trustedUsers.length}**`,
            `Protected roles: **${c.security.protectedRoles.length}**`,
            `Protected channels: **${c.security.protectedChannels.length}**`
          ].join("\n")
        );
      }

      return interaction.reply(
        "🔐 Security configuration updated."
      );
    }

    /* =====================
       CONFIG
    ===================== */

    if (command === "config") {
      const c =
        guildConfig(interaction.guild);

      const sub =
        interaction.options.getSubcommand();

      if (sub === "log") {
        const type =
          interaction.options.getString("type");

        const channel =
          interaction.options.getChannel("channel");

        c.logs[type] = channel.id;
      }

      if (sub === "suggestions") {
        c.suggestionsChannelId =
          interaction.options.getChannel(
            "channel"
          ).id;
      }

      save();

      return interaction.reply(
        "⚙️ Configuration saved for this server."
      );
    }

    /* =====================
       MODERATION
    ===================== */

    if (
      ["warn", "timeout", "kick", "ban"]
        .includes(command)
    ) {
      const user =
        interaction.options.getUser("user");

      const reason =
        interaction.options.getString("reason");

      const member =
        await interaction.guild.members
          .fetch(user.id)
          .catch(() => null);

      if (!member) {
        return interaction.reply(
          "❌ Member not found."
        );
      }

      if (command === "warn") {
        const count =
          await addWarning(
            member,
            reason,
            interaction.user.id
          );

        await sendLog(
          interaction.guild,
          "moderation",
          "⚠️ Warning",
          [
            field("User", user.toString()),
            field(
              "Moderator",
              interaction.user.toString()
            ),
            field("Reason", reason),
            field("Total Warnings", count)
          ],
          0xfee75c
        );

        return interaction.reply(
          `⚠️ ${user} warned. Total warnings: **${count}**`
        );
      }

      if (command === "timeout") {
        const seconds =
          interaction.options.getInteger(
            "seconds"
          );

        if (!member.moderatable) {
          return interaction.reply(
            "❌ I cannot timeout this member."
          );
        }

        await member.timeout(
          seconds * 1000,
          reason
        );

        await addPunishment(
          interaction.guild,
          user.id,
          "timeout",
          reason,
          interaction.user.id
        );

        return interaction.reply(
          `⏱️ ${user} timed out for **${seconds} seconds**.`
        );
      }

      if (command === "kick") {
        if (!member.kickable) {
          return interaction.reply(
            "❌ I cannot kick this member."
          );
        }

        await member.kick(reason);

        await addPunishment(
          interaction.guild,
          user.id,
          "kick",
          reason,
          interaction.user.id
        );

        return interaction.reply(
          `👢 **${user.tag}** kicked.`
        );
      }

      if (command === "ban") {
        if (!member.bannable) {
          return interaction.reply(
            "❌ I cannot ban this member."
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

        return interaction.reply(
          `🔨 **${user.tag}** banned.`
        );
      }
    }

    if (command === "unban") {
      const id =
        interaction.options.getString("user_id");

      const reason =
        interaction.options.getString("reason");

      await interaction.guild.members.unban(
        id,
        reason
      );

      await addPunishment(
        interaction.guild,
        id,
        "unban",
        reason,
        interaction.user.id
      );

      return interaction.reply(
        `✅ **${id}** unbanned.`
      );
    }

    if (
      command === "warnings" ||
      command === "punishments"
    ) {
      const user =
        interaction.options.getUser("user");

      const c =
        guildConfig(interaction.guild);

      const data =
        command === "warnings"
          ? c.warnings[user.id] || []
          : c.punishments[user.id] || [];

      const text =
        data.length
          ? data
              .slice(-10)
              .map(
                (x, i) =>
                  `${i + 1}. **${x.type || "warn"}** — ${x.reason} — <t:${Math.floor(x.time / 1000)}:R>`
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
        ],
        ephemeral: true
      });
    }

    /* =====================
       SUGGESTIONS
    ===================== */

    if (command === "suggest") {
      const c =
        guildConfig(interaction.guild);

      const text =
        interaction.options.getString("text");

      const channel =
        c.suggestionsChannelId
          ? await interaction.guild.channels
              .fetch(c.suggestionsChannelId)
              .catch(() => null)
          : null;

      if (!channel?.isTextBased()) {
        return interaction.reply({
          content:
            "❌ Suggestion channel isn't configured.",
          ephemeral: true
        });
      }

      const message =
        await channel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle("💡 New Suggestion")
              .setDescription(text)
              .addFields(
                field(
                  "Suggested By",
                  interaction.user.toString()
                )
              )
              .setTimestamp()
          ],
          components: [
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
            )
          ]
        });

      return interaction.reply({
        content:
          `✅ Suggestion posted: ${message.url}`,
        ephemeral: true
      });
    }

    /* =====================
       ANNOUNCEMENT
    ===================== */

    if (command === "announce") {
      const channel =
        interaction.options.getChannel("channel");

      const message =
        interaction.options.getString("message");

      const title =
        interaction.options.getString("title");

      const everyone =
        interaction.options.getBoolean("everyone");

      const payload = {
        allowedMentions: {
          parse: everyone
            ? ["everyone"]
            : []
        }
      };

      if (title) {
        payload.embeds = [
          new EmbedBuilder()
            .setTitle(title)
            .setDescription(message)
            .setTimestamp()
        ];
      } else {
        payload.content = message;
      }

      if (everyone && !title) {
        payload.content =
          `@everyone ${message}`;
      }

      await channel.send(payload);

      return interaction.reply({
        content: "✅ Announcement sent.",
        ephemeral: true
      });
    }

    /* =====================
       AUTOROLE
    ===================== */

    if (command === "autorole") {
      const c =
        guildConfig(interaction.guild);

      const sub =
        interaction.options.getSubcommand();

      if (sub === "set") {
        const role =
          interaction.options.getRole("role");

        if (
          role.position >=
          interaction.guild.members.me.roles.highest.position
        ) {
          return interaction.reply(
            "❌ My role must be above that role."
          );
        }

        c.autorole = {
          enabled: true,
          roleId: role.id
        };
      }

      if (sub === "disable") {
        c.autorole.enabled = false;
      }

      save();

      if (sub === "status") {
        return interaction.reply(
          `👤 Autorole: **${c.autorole.enabled ? "ON" : "OFF"}**\nRole: ${
            c.autorole.roleId
              ? `<@&${c.autorole.roleId}>`
              : "None"
          }`
        );
      }

      return interaction.reply(
        "✅ Autorole updated."
      );
    }

    /* =====================
       WELCOME
    ===================== */

    if (command === "welcome") {
      const c =
        guildConfig(interaction.guild);

      const sub =
        interaction.options.getSubcommand();

      if (sub === "set") {
        c.welcome = {
          enabled: true,
          channelId:
            interaction.options
              .getChannel("channel").id,
          message:
            interaction.options
              .getString("message")
        };
      }

      if (sub === "disable") {
        c.welcome.enabled = false;
      }

      save();

      if (sub === "status") {
        return interaction.reply(
          `👋 Welcome: **${c.welcome.enabled ? "ON" : "OFF"}**`
        );
      }

      return interaction.reply(
        "✅ Welcome system updated."
      );
    }

    /* =====================
       VERIFICATION
    ===================== */

    if (command === "verification") {
      const c =
        guildConfig(interaction.guild);

      const sub =
        interaction.options.getSubcommand();

      if (sub === "setup") {
        const channel =
          interaction.options.getChannel("channel");

        const role =
          interaction.options.getRole("role");

        if (
          role.position >=
          interaction.guild.members.me.roles.highest.position
        ) {
          return interaction.reply(
            "❌ My role must be above the verification role."
          );
        }

        const row =
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("verify_user")
              .setLabel("Verify")
              .setEmoji("✅")
              .setStyle(ButtonStyle.Success)
          );

        const message =
          await channel.send({
            embeds: [
              new EmbedBuilder()
                .setTitle("✅ Verification")
                .setDescription(
                  "Click the button below to verify yourself."
                )
            ],
            components: [row]
          });

        c.verification = {
          enabled: true,
          channelId: channel.id,
          roleId: role.id,
          messageId: message.id
        };
      }

      if (sub === "disable") {
        c.verification.enabled = false;
      }

      save();

      if (sub === "status") {
        return interaction.reply(
          `✅ Verification: **${
            c.verification.enabled
              ? "ON"
              : "OFF"
          }**`
        );
      }

      return interaction.reply(
        "✅ Verification updated."
      );
    }

    /* =====================
       LEADERBOARD
    ===================== */

    if (command === "leaderboard") {
      const c =
        guildConfig(interaction.guild);

      const sub =
        interaction.options.getSubcommand();

      if (sub === "reset") {
        c.leaderboard.messages = {};
        save();

        return interaction.reply(
          "🧹 Leaderboard reset."
        );
      }

      if (sub === "enable") {
        c.leaderboard.enabled = true;
        save();

        return interaction.reply(
          "🏆 Leaderboard enabled."
        );
      }

      if (sub === "disable") {
        c.leaderboard.enabled = false;
        save();

        return interaction.reply(
          "🏆 Leaderboard disabled."
        );
      }

      const top =
        Object.entries(
          c.leaderboard.messages
        )
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle("🏆 Message Leaderboard")
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

    /* =====================
       AI
    ===================== */

    if (command === "ai") {
      const sub =
        interaction.options.getSubcommand();

      if (sub === "reset") {
        aiHistory.delete(interaction.user.id);

        return interaction.reply({
          content:
            "🧹 Your AI conversation has been reset.",
          ephemeral: true
        });
      }

      if (!OPENAI_API_KEY) {
        return interaction.reply({
          content:
            "❌ AI is not configured. Add `OPENAI_API_KEY` to Bot-Hosting environment variables.",
          ephemeral: true
        });
      }

      const prompt =
        interaction.options.getString("prompt");

      await interaction.deferReply();

      const history =
        aiHistory.get(interaction.user.id) || [];

      history.push({
        role: "user",
        content: prompt
      });

      const response =
        await fetch(
          "https://api.openai.com/v1/responses",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization":
                `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
              model: OPENAI_MODEL,
              input: history.slice(-10)
            })
          }
        );

      if (!response.ok) {
        const error =
          await response.text();

        console.error(
          "OpenAI error:",
          error
        );

        return interaction.editReply(
          "❌ AI request failed."
        );
      }

      const data =
        await response.json();

      const answer =
        data.output_text ||
        "I couldn't generate a response.";

      history.push({
        role: "assistant",
        content: answer
      });

      aiHistory.set(
        interaction.user.id,
        history.slice(-10)
      );

      return interaction.editReply(
        answer.slice(0, 4000)
      );
    }

  } catch (err) {
    console.error(
      "❌ Interaction error:",
      err
    );

    if (
      interaction.deferred &&
      !interaction.replied
    ) {
      await interaction.editReply(
        "❌ An internal error occurred."
      ).catch(() => {});
    } else if (
      !interaction.replied
    ) {
      await interaction.reply({
        content:
          "❌ An internal error occurred.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

/* =========================
   REACTION ROLES
========================= */

client.on(
  "messageReactionAdd",
  async (reaction, user) => {
    try {
      if (user.bot) return;

      if (reaction.partial) {
        await reaction.fetch();
      }

      const guild =
        reaction.message.guild;

      if (!guild) return;

      const c =
        guildConfig(guild);

      const messageRoles =
        c.reactionRoles?.[
          reaction.message.id
        ];

      if (!messageRoles) return;

      const key =
        reaction.emoji.id ||
        reaction.emoji.name;

      const data =
        messageRoles[key];

      if (!data) return;

      const member =
        await guild.members.fetch(
          user.id
        ).catch(() => null);

      const role =
        await guild.roles.fetch(
          data.roleId
        ).catch(() => null);

      if (
        member &&
        role &&
        role.position <
        guild.members.me.roles.highest.position
      ) {
        await member.roles.add(
          role,
          "AkiyO Reaction Role"
        ).catch(() => {});
      }

    } catch (err) {
      console.error(
        "Reaction role:",
        err
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
      `✅ Logged in as ${client.user.tag}`
    );

    console.log(
      `🏠 Connected to ${client.guilds.cache.size} servers`
    );

    try {
      await registerCommands();
    } catch (err) {
      console.error(
        "❌ Command registration failed:",
        err
      );
    }

    console.log(
      `🤖 AkiyO online — ${commands.length} commands`
    );
  }
);

/* =========================
   ERROR PROTECTION
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
});

/* =========================
   LOGIN
========================= */

client.login(TOKEN);
