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
  REST,
  Routes
} = require("discord.js");

const fs = require("fs");
const path = require("path");

/* =========================================================
   ENVIRONMENT
========================================================= */

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const SERVER_ID = "1493700265499689154";
const SUPPORT_ADMIN_ROLE = "1542498406981959801";
const SUPPORT_LOG_CHANNEL = "1542500573000106024";

if (!TOKEN) {
  console.error("DISCORD_TOKEN is missing.");
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error("CLIENT_ID is missing.");
  process.exit(1);
}

/* =========================================================
   DATABASE
========================================================= */

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "database.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DEFAULT_DATA = {
  automod: {
    enabled: true,

    invites: true,
    spam: true,
    mentions: true,
    badwords: true,
    caps: true,
    repeated: true,

    spamLimit: 6,
    spamWindow: 7000,

    mentionLimit: 5,

    capsPercent: 75,

    repeatedLimit: 3,
    repeatedWindow: 15000,

    badWords: [],

    action: "delete_warn",

    logChannel: SUPPORT_LOG_CHANNEL
  },

  autotimeout: {
    enabled: true,
    duration: 3600000,
    threshold: 3
  },

  security: {
    enabled: true,

    antiRaid: true,
    raidLimit: 8,
    raidWindow: 10000,

    antiNuke: true,
    nukeLimit: 3,
    nukeWindow: 10000,

    newAccountProtection: true,
    newAccountDays: 3,

    logChannel: SUPPORT_LOG_CHANNEL
  },

  roleProtection: {
    enabled: true,

    protectEveryone: true,

    protectedRoles: [],

    timeoutDuration: 3600000,

    removeUnauthorizedRole: true,
    restoreProtectedRole: true
  },

  trusted: {
    users: [],
    bots: []
  },

  tickets: {
    enabled: true,

    categoryId: null,
    logChannel: SUPPORT_LOG_CHANNEL,

    counter: 0,

    records: {}
  },

  suggestions: {
    enabled: true,

    channelId: null,
    staffRoleId: SUPPORT_ADMIN_ROLE,

    counter: 0,
    records: {}
  },

  announcements: {
    enabled: true,

    channels: [],
    roles: [],

    history: []
  },

  logs: {
    automod: SUPPORT_LOG_CHANNEL,
    security: SUPPORT_LOG_CHANNEL,
    moderation: SUPPORT_LOG_CHANNEL,
    tickets: SUPPORT_LOG_CHANNEL,
    suggestions: SUPPORT_LOG_CHANNEL,
    announcements: SUPPORT_LOG_CHANNEL,
    members: SUPPORT_LOG_CHANNEL,
    messages: SUPPORT_LOG_CHANNEL,
    roles: SUPPORT_LOG_CHANNEL,
    channels: SUPPORT_LOG_CHANNEL,
    audit: SUPPORT_LOG_CHANNEL
  },

  warnings: {},

  punishments: [],

  statistics: {
    automod: 0,
    warnings: 0,
    punishments: 0,
    tickets: 0,
    raids: 0,
    securityEvents: 0
  }
};

let database = {};

function deepClone(object) {
  return JSON.parse(JSON.stringify(object));
}

function loadDatabase() {
  try {
    if (fs.existsSync(DB_FILE)) {
      database = JSON.parse(
        fs.readFileSync(DB_FILE, "utf8")
      );
    }
  } catch (error) {
    console.error(
      "Database load error:",
      error
    );

    database = {};
  }
}

function saveDatabase() {
  try {
    fs.writeFileSync(
      DB_FILE,
      JSON.stringify(database, null, 2)
    );
  } catch (error) {
    console.error(
      "Database save error:",
      error
    );
  }
}

function getGuildData(guildId) {
  if (!database[guildId]) {
    database[guildId] = deepClone(
      DEFAULT_DATA
    );

    saveDatabase();
  }

  return database[guildId];
}

loadDatabase();

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
    GatewayIntentBits.GuildModeration
  ],

  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User
  ]
});

/* =========================================================
   RUNTIME TRACKERS
========================================================= */

const spamTracker = new Map();
const joinTracker = new Map();
const nukeTracker = new Map();

/* =========================================================
   GENERAL HELPERS
========================================================= */

function shorten(text, max = 3900) {
  text = String(text || "");

  if (text.length <= max) {
    return text;
  }

  return (
    text.substring(0, max - 3) +
    "..."
  );
}

function makeEmbed(
  title,
  description,
  color = 0x5865f2
) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(
      shorten(description)
    )
    .setTimestamp();
}

function isStaff(member) {
  if (!member) return false;

  return (
    member.permissions.has(
      PermissionsBitField.Flags.Administrator
    ) ||
    member.permissions.has(
      PermissionsBitField.Flags.ManageGuild
    ) ||
    member.roles.cache.has(
      SUPPORT_ADMIN_ROLE
    )
  );
}

function isTrusted(guild, userId) {
  const data = getGuildData(
    guild.id
  );

  if (userId === guild.ownerId) {
    return true;
  }

  return (
    data.trusted.users.includes(userId) ||
    data.trusted.bots.includes(userId)
  );
}

function parseDuration(value) {
  if (!value) return null;

  const match = String(value)
    .trim()
    .toLowerCase()
    .match(/^(\d+)(s|m|h|d|w)$/);

  if (!match) return null;

  const amount = Number(match[1]);

  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
    w: 7 * 24 * 60 * 60 * 1000
  };

  return (
    amount *
    multipliers[match[2]]
  );
}

function formatDuration(ms) {
  if (!ms) return "0s";

  const units = [
    ["d", 86400000],
    ["h", 3600000],
    ["m", 60000],
    ["s", 1000]
  ];

  let remaining = ms;
  const result = [];

  for (const [name, size] of units) {
    if (remaining >= size) {
      const amount =
        Math.floor(
          remaining / size
        );

      remaining %= size;

      result.push(
        `${amount}${name}`
      );
    }
  }

  return result.join(" ") || "0s";
}

/* =========================================================
   LOGGING
========================================================= */

async function sendLog(
  guild,
  type,
  title,
  description,
  color = 0x5865f2
) {
  try {
    const data =
      getGuildData(guild.id);

    const channelId =
      data.logs[type] ||
      SUPPORT_LOG_CHANNEL;

    const channel =
      await guild.channels.fetch(
        channelId
      ).catch(() => null);

    if (
      !channel ||
      !channel.isTextBased()
    ) {
      return;
    }

    await channel.send({
      embeds: [
        makeEmbed(
          title,
          description,
          color
        )
      ]
    });
  } catch (error) {
    console.error(
      "Logging error:",
      error
    );
  }
}

/* =========================================================
   WARNING SYSTEM
========================================================= */

function addWarning(
  guild,
  userId,
  moderatorId,
  reason
) {
  const data =
    getGuildData(guild.id);

  if (!data.warnings[userId]) {
    data.warnings[userId] = [];
  }

  const warning = {
    id:
      `${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 7)}`,

    moderatorId,

    reason,

    timestamp: Date.now()
  };

  data.warnings[userId].push(
    warning
  );

  data.statistics.warnings++;

  saveDatabase();

  return {
    warning,
    count:
      data.warnings[userId].length
  };
}

function getWarnings(
  guild,
  userId
) {
  const data =
    getGuildData(guild.id);

  return (
    data.warnings[userId] || []
  );
}

/* =========================================================
   PUNISHMENT HISTORY
========================================================= */

function addPunishment(
  guild,
  type,
  userId,
  moderatorId,
  reason
) {
  const data =
    getGuildData(guild.id);

  data.punishments.push({
    id:
      `${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 7)}`,

    type,

    userId,

    moderatorId,

    reason,

    timestamp: Date.now()
  });

  data.statistics.punishments++;

  if (
    data.punishments.length >
    5000
  ) {
    data.punishments =
      data.punishments.slice(-5000);
  }

  saveDatabase();
}

/* =========================================================
   MEMBER MODERATION HELPERS
========================================================= */

async function applyTimeout(
  member,
  duration,
  reason
) {
  if (!member) {
    return false;
  }

  if (!member.moderatable) {
    return false;
  }

  const safeDuration =
    Math.min(
      Math.max(
        duration,
        1000
      ),
      2419200000
    );

  try {
    await member.timeout(
      safeDuration,
      reason
    );

    return true;
  } catch (error) {
    console.error(
      "Timeout error:",
      error
    );

    return false;
  }
}

/* =========================================================
   AUTO MODERATION
========================================================= */

async function executeAutoMod(
  message,
  reason
) {
  if (
    !message.guild ||
    !message.member
  ) {
    return;
  }

  const data =
    getGuildData(
      message.guild.id
    );

  data.statistics.automod++;

  const warning =
    addWarning(
      message.guild,
      message.author.id,
      client.user.id,
      reason
    );

  addPunishment(
    message.guild,
    "automod",
    message.author.id,
    client.user.id,
    reason
  );

  await message.delete()
    .catch(() => {});

  if (
    data.autotimeout.enabled &&
    warning.count >=
      data.autotimeout.threshold
  ) {
    await applyTimeout(
      message.member,
      data.autotimeout.duration,
      `AutoTimeout: ${reason}`
    );
  }

  await sendLog(
    message.guild,
    "automod",
    "🛡️ AutoMod Action",
    [
      `**User:** ${message.author}`,
      `**Reason:** ${reason}`,
      `**Warnings:** ${warning.count}`
    ].join("\n"),
    0xed4245
  );

  saveDatabase();
}

/* =========================================================
   AUTOMOD CHECKS
========================================================= */

function checkBadWord(
  content,
  words
) {
  const lower =
    content.toLowerCase();

  return words.find(
    word =>
      word &&
      lower.includes(
        word.toLowerCase()
      )
  );
}

function checkCaps(
  content,
  percent
) {
  const letters =
    content.replace(
      /[^a-zA-Z]/g,
      ""
    );

  if (letters.length < 8) {
    return false;
  }

  const upper =
    letters.replace(
      /[^A-Z]/g,
      ""
    );

  return (
    upper.length /
      letters.length >=
    percent / 100
  );
}

/* =========================================================
   SLASH COMMAND BUILDERS
========================================================= */

const commands = [];

/* ---------------- HELP ---------------- */

commands.push(
  new SlashCommandBuilder()
    .setName("help")
    .setDescription(
      "Show all bot systems and commands"
    )
);

/* ---------------- MODERATION ---------------- */

commands.push(
  new SlashCommandBuilder()
    .setName("warn")
    .setDescription(
      "Warn a member"
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription(
          "Member to warn"
        )
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription(
          "Reason"
        )
        .setRequired(true)
    )
);

commands.push(
  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription(
      "View warning history"
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription(
          "Member"
        )
        .setRequired(true)
    )
);

commands.push(
  new SlashCommandBuilder()
    .setName("punishments")
    .setDescription(
      "View punishment history"
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription(
          "Member"
        )
        .setRequired(true)
    )
);

commands.push(
  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription(
      "Timeout a member"
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription(
          "Member"
        )
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("duration")
        .setDescription(
          "Example: 1h, 30m, 2d"
        )
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription(
          "Reason"
        )
    )
);

commands.push(
  new SlashCommandBuilder()
    .setName("kick")
    .setDescription(
      "Kick a member"
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription(
          "Member"
        )
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription(
          "Reason"
        )
    )
);

commands.push(
  new SlashCommandBuilder()
    .setName("ban")
    .setDescription(
      "Ban a member"
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription(
          "Member"
        )
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription(
          "Reason"
        )
    )
);

commands.push(
  new SlashCommandBuilder()
    .setName("unban")
    .setDescription(
      "Unban a user"
    )
    .addStringOption(option =>
      option
        .setName("user_id")
        .setDescription(
          "Discord user ID"
        )
        .setRequired(true)
    )
);

/* ---------------- AUTOMOD ---------------- */

const automodCommand =
  new SlashCommandBuilder()
    .setName("automod")
    .setDescription(
      "Advanced AutoMod system"
    );

automodCommand
  .addSubcommand(command =>
    command
      .setName("status")
      .setDescription(
        "View AutoMod status"
      )
  )

  .addSubcommand(command =>
    command
      .setName("enable")
      .setDescription(
        "Enable AutoMod"
      )
  )

  .addSubcommand(command =>
    command
      .setName("disable")
      .setDescription(
        "Disable AutoMod"
      )
  )

  .addSubcommand(command =>
    command
      .setName("invites")
      .setDescription(
        "Configure invite protection"
      )
      .addBooleanOption(option =>
        option
          .setName("enabled")
          .setDescription(
            "Enabled"
          )
          .setRequired(true)
      )
  )

  .addSubcommand(command =>
    command
      .setName("spam")
      .setDescription(
        "Configure spam protection"
      )
      .addBooleanOption(option =>
        option
          .setName("enabled")
          .setDescription(
            "Enabled"
          )
          .setRequired(true)
      )
  )

  .addSubcommand(command =>
    command
      .setName("mentions")
      .setDescription(
        "Configure mass mention protection"
      )
      .addBooleanOption(option =>
        option
          .setName("enabled")
          .setDescription(
            "Enabled"
          )
          .setRequired(true)
      )
  )

  .addSubcommand(command =>
    command
      .setName("badwords")
      .setDescription(
        "Configure bad-word filtering"
      )
      .addBooleanOption(option =>
        option
          .setName("enabled")
          .setDescription(
            "Enabled"
          )
          .setRequired(true)
      )
  )

  .addSubcommand(command =>
    command
      .setName("caps")
      .setDescription(
        "Configure excessive caps protection"
      )
      .addBooleanOption(option =>
        option
          .setName("enabled")
          .setDescription(
            "Enabled"
          )
          .setRequired(true)


/* ---------------- AUTOTIMEOUT ---------------- */

const autoTimeoutCommand =
  new SlashCommandBuilder()
    .setName("autotimeout")
    .setDescription(
      "Automatic timeout configuration"
    );

autoTimeoutCommand
  .addSubcommand(command =>
    command
      .setName("status")
      .setDescription(
        "View AutoTimeout status"
      )
  )

  .addSubcommand(command =>
    command
      .setName("enable")
      .setDescription(
        "Enable AutoTimeout"
      )
  )

  .addSubcommand(command =>
    command
      .setName("disable")
      .setDescription(
        "Disable AutoTimeout"
      )
  )

  .addSubcommand(command =>
    command
      .setName("duration")
      .setDescription(
        "Set timeout duration"
      )
      .addStringOption(option =>
        option
          .setName("value")
          .setDescription(
            "Example: 1h"
          )
          .setRequired(true)
      )
  )

  .addSubcommand(command =>
    command
      .setName("threshold")
      .setDescription(
        "Set warning threshold"
      )
      .addIntegerOption(option =>
        option
          .setName("value")
          .setDescription(
            "Warning count"
          )
          .setRequired(true)
      )
  );

commands.push(
  autoTimeoutCommand
);

/* ---------------- SECURITY ---------------- */

const securityCommand =
  new SlashCommandBuilder()
    .setName("security")
    .setDescription(
      "Anti-Raid and Anti-Nuke security"
    );

securityCommand
  .addSubcommand(command =>
    command
      .setName("status")
      .setDescription(
        "View security status"
      )
  )

  .addSubcommand(command =>
    command
      .setName("enable")
      .setDescription(
        "Enable security"
      )
  )

  .addSubcommand(command =>
    command
      .setName("disable")
      .setDescription(
        "Disable security"
      )
  )

  .addSubcommand(command =>
    command
      .setName("antiraid")
      .setDescription(
        "Enable or disable Anti-Raid"
      )
      .addBooleanOption(option =>
        option
          .setName("enabled")
          .setDescription(
            "Enabled"
          )
          .setRequired(true)
      )
  )

  .addSubcommand(command =>
    command
      .setName("raid-limit")
      .setDescription(
        "Set raid join limit"
      )
      .addIntegerOption(option =>
        option
          .setName("value")
          .setDescription(
            "Join count"
          )
          .setRequired(true)
      )
  )

  .addSubcommand(command =>
    command
      .setName("antinuke")
      .setDescription(
        "Enable or disable Anti-Nuke"
      )
      .addBooleanOption(option =>
        option
          .setName("enabled")
          .setDescription(
            "Enabled"
          )
          .setRequired(true)
      )
  )

  .addSubcommand(command =>
    command
      .setName("nuke-limit")
      .setDescription(
        "Set Anti-Nuke limit"
      )
      .addIntegerOption(option =>
        option
          .setName("value")
          .setDescription(
            "Action count"
          )
          .setRequired(true)
      )
  )

  .addSubcommand(command =>
    command
      .setName("log")
      .setDescription(
        "Set security log channel"
      )
      .addChannelOption(option =>
        option
          .setName("channel")
          .setDescription(
            "Channel"
          )
          .setRequired(true)
      )
  );

commands.push(
  securityCommand
);

/* ---------------- ROLE PROTECTOR ---------------- */

const roleProtectCommand =
  new SlashCommandBuilder()
    .setName("roleprotect")
    .setDescription(
      "Protect important server roles"
    );

roleProtectCommand
  .addSubcommand(command =>
    command
      .setName("status")
      .setDescription(
        "View role protection status"
      )
  )

  .addSubcommand(command =>
    command
      .setName("enable")
      .setDescription(
        "Enable role protection"
      )
  )

  .addSubcommand(command =>
    command
      .setName("disable")
      .setDescription(
        "Disable role protection"
      )
  )

  .addSubcommand(command =>
    command
      .setName("protect")
      .setDescription(
        "Protect a role"
      )
      .addRoleOption(option =>
        option
          .setName("role")
          .setDescription(
            "Role to protect"
          )
          .setRequired(true)
      )
  )

  .addSubcommand(command =>
    command
      .setName("unprotect")
      .setDescription(
        "Remove role protection"
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

  .addSubcommand(command =>
    command
      .setName("list")
      .setDescription(
        "List protected roles"
      )
  )

  .addSubcommand(command =>
    command
      .setName("timeout")
      .setDescription(
        "Set unauthorized-role timeout"
      )
      .addStringOption(option =>
        option
          .setName("duration")
          .setDescription(
            "Example: 1h"
          )
          .setRequired(true)
      )
  );

commands.push(
  roleProtectCommand
);

/* ---------------- TICKET SYSTEM ---------------- */

const ticketCommand =
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription(
      "Full DM ticket system"
    );

ticketCommand
  .addSubcommand(command =>
    command
      .setName("setup")
      .setDescription(
        "Configure ticket system"
      )
      .addChannelOption(option =>
        option
          .setName("category")
          .setDescription(
            "Ticket category"
          )
      )
      .addChannelOption(option =>
        option
          .setName("log")
          .setDescription(
            "Ticket log channel"
          )
      )
  )

  .addSubcommand(command =>
    command
      .setName("status")
      .setDescription(
        "View ticket status"
      )
  )

  .addSubcommand(command =>
    command
      .setName("list")
      .setDescription(
        "List tickets"
      )
  )

  .addSubcommand(command =>
    command
      .setName("info")
      .setDescription(
        "View ticket information"
      )
      .addStringOption(option =>
        option
          .setName("id")
          .setDescription(
            "Ticket ID"
          )
          .setRequired(true)
      )
  )

  .addSubcommand(command =>
    command
      .setName("claim")
      .setDescription(
        "Claim a ticket"
      )
      .addStringOption(option =>
        option
          .setName("id")
          .setDescription(
            "Ticket ID"
          )
          .setRequired(true)
      )
  )

  .addSubcommand(command =>
    command
      .setName("unclaim")
      .setDescription(
        "Unclaim a ticket"
      )
      .addStringOption(option =>
        option
          .setName("id")
          .setDescription(
            "Ticket ID"
          )
          .setRequired(true)
      )
  )

  .addSubcommand(command =>
    command
      .setName("add")
      .setDescription(
        "Add member to ticket"
      )
      .addStringOption(option =>
        option
          .setName("id")
          .setDescription(
            "Ticket ID"
          )
          .setRequired(true)
      )
      .addUserOption(option =>
        option
          .setName("user")
          .setDescription(
            "User"
          )
          .setRequired(true)
      )
  )

  .addSubcommand(command =>
    command
      .setName("remove")
      .setDescription(
        "Remove member from ticket"
      )
      .addStringOption(option =>
        option
          .setName("id")
          .setDescription(
            "Ticket ID"
          )
          .setRequired(true)
      )
      .addUserOption(option =>
        option
          .setName("user")
          .setDescription(
            "User"
          )
          .setRequired(true)
      )
  )

  .addSubcommand(command =>
    command
      .setName("rename")
      .setDescription(
        "Rename ticket"
      )
      .addStringOption(option =>
        option
          .setName("id")
          .setDescription(
            "Ticket ID"
          )
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName("name")
          .setDescription(
            "New name"
          )
          .setRequired(true)
      )
  )

  .addSubcommand(command =>
    command
      .setName("close")
      .setDescription(
        "Close ticket"
      )
      .addStringOption(option =>
        option
          .setName("id")
          .setDescription(
            "Ticket ID"
          )
          .setRequired(true)
      )
  )

  .addSubcommand(command =>
    command
      .setName("reopen")
      .setDescription(
        "Reopen ticket"
      )
      .addStringOption(option =>
        option
          .setName("id")
          .setDescription(
            "Ticket ID"
          )
          .setRequired(true)
      )
  )

  .addSubcommand(command =>
    command
      .setName("delete")
      .setDescription(
        "Delete ticket"
      )
      .addStringOption(option =>
        option
          .setName("id")
          .setDescription(
            "Ticket ID"
          )
          .setRequired(true)
      )
  )

  .addSubcommand(command =>
    command
      .setName("transcript")
      .setDescription(
        "Create ticket transcript"
      )
      .addStringOption(option =>
        option
          .setName("id")
          .setDescription(
            "Ticket ID"
          )
          .setRequired(true)
      )
  );

commands.push(
  ticketCommand
);

/* =========================================================
   PART 1 ENDS HERE
   PART 2 WILL CONTINUE DIRECTLY AFTER THIS LINE.
========================================================= */

/* =========================================================
   PART 2/4
   COMMAND DEFINITIONS + SECURITY SYSTEMS
========================================================= */

/* ---------------- SUGGESTION SYSTEM ---------------- */

const suggestionCommand =
  new SlashCommandBuilder()
    .setName("suggest")
    .setDescription(
      "Submit a server suggestion"
    )
    .addStringOption(option =>
      option
        .setName("suggestion")
        .setDescription(
          "Your suggestion"
        )
        .setRequired(true)
    );

commands.push(suggestionCommand);

/* ---------------- ANNOUNCEMENT SYSTEM ---------------- */

const announcementCommand =
  new SlashCommandBuilder()
    .setName("announce")
    .setDescription(
      "Create an advanced announcement"
    )
    .addStringOption(option =>
      option
        .setName("title")
        .setDescription(
          "Announcement title"
        )
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("message")
        .setDescription(
          "Announcement message"
        )
        .setRequired(true)
    )
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription(
          "Announcement channel"
        )
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("image")
        .setDescription(
          "Image URL"
        )
    )
    .addRoleOption(option =>
      option
        .setName("role")
        .setDescription(
          "Role to mention"
        )
    )
    .addBooleanOption(option =>
      option
        .setName("everyone")
        .setDescription(
          "Mention @everyone"
        )
    );

/* ---------------- ANNOUNCEMENT CONFIG ---------------- */

const announcementConfigCommand =
  new SlashCommandBuilder()
    .setName("announcement")
    .setDescription(
      "Configure announcement system"
    );

announcementConfigCommand
  .addSubcommand(command =>
    command
      .setName("add-channel")
      .setDescription(
        "Add announcement channel"
      )
      .addChannelOption(option =>
        option
          .setName("channel")
          .setDescription(
            "Channel"
          )
          .setRequired(true)
      )
  )

  .addSubcommand(command =>
    command
      .setName("remove-channel")
      .setDescription(
        "Remove announcement channel"
      )
      .addChannelOption(option =>
        option
          .setName("channel")
          .setDescription(
            "Channel"
          )
          .setRequired(true)
      )
  )

  .addSubcommand(command =>
    command
      .setName("list-channels")
      .setDescription(
        "List announcement channels"
      )
  )

  .addSubcommand(command =>
    command
      .setName("add-role")
      .setDescription(
        "Add announcement role"
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

  .addSubcommand(command =>
    command
      .setName("remove-role")
      .setDescription(
        "Remove announcement role"
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

  .addSubcommand(command =>
    command
      .setName("list-roles")
      .setDescription(
        "List announcement roles"
      )
  );

/* ---------------- LOG CONFIG ---------------- */

const logCommand =
  new SlashCommandBuilder()
    .setName("logs")
    .setDescription(
      "Configure server logging"
    );

const logTypes = [
  "automod",
  "security",
  "moderation",
  "tickets",
  "suggestions",
  "announcements",
  "members",
  "messages",
  "roles",
  "channels",
  "audit"
];

for (const type of logTypes) {
  logCommand.addSubcommand(command =>
    command
      .setName(type)
      .setDescription(
        `Set ${type} log channel`
      )
      .addChannelOption(option =>
        option
          .setName("channel")
          .setDescription(
            "Log channel"
          )
          .setRequired(true)
      )
  );
}

logCommand.addSubcommand(command =>
  command
    .setName("status")
    .setDescription(
      "View logging configuration"
    )
);

commands.push(
  announcementCommand,
  announcementConfigCommand,
  logCommand
);

/* ---------------- TRUSTED USERS/BOTS ---------------- */

const trustedCommand =
  new SlashCommandBuilder()
    .setName("trusted")
    .setDescription(
      "Manage trusted users and bots"
    );

trustedCommand
  .addSubcommand(command =>
    command
      .setName("user-add")
      .setDescription(
        "Trust a user"
      )
      .addUserOption(option =>
        option
          .setName("user")
          .setDescription(
            "User"
          )
          .setRequired(true)
      )
  )

  .addSubcommand(command =>
    command
      .setName("user-remove")
      .setDescription(
        "Remove trusted user"
      )
      .addUserOption(option =>
        option
          .setName("user")
          .setDescription(
            "User"
          )
          .setRequired(true)
      )
  )

  .addSubcommand(command =>
    command
      .setName("bot-add")
      .setDescription(
        "Trust a bot"
      )
      .addUserOption(option =>
        option
          .setName("bot")
          .setDescription(
            "Bot"
          )
          .setRequired(true)
      )
  )

  .addSubcommand(command =>
    command
      .setName("bot-remove")
      .setDescription(
        "Remove trusted bot"
      )
      .addUserOption(option =>
        option
          .setName("bot")
          .setDescription(
            "Bot"
          )
          .setRequired(true)
      )
  )

  .addSubcommand(command =>
    command
      .setName("list")
      .setDescription(
        "List trusted users and bots"
      )
  );

commands.push(
  trustedCommand
);

/* ---------------- CONFIG ---------------- */

const configCommand =
  new SlashCommandBuilder()
    .setName("config")
    .setDescription(
      "View and configure the bot"
    );

configCommand
  .addSubcommand(command =>
    command
      .setName("status")
      .setDescription(
        "Show complete configuration"
      )
  )

  .addSubcommand(command =>
    command
      .setName("reset")
      .setDescription(
        "Reset configuration"
      )
  )

  .addSubcommand(command =>
    command
      .setName("set")
      .setDescription(
        "Set a configuration value"
      )
      .addStringOption(option =>
        option
          .setName("system")
          .setDescription(
            "System name"
          )
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName("key")
          .setDescription(
            "Configuration key"
          )
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName("value")
          .setDescription(
            "Value"
          )
          .setRequired(true)
      )
  );

commands.push(
  configCommand
);

/* ---------------- STATS ---------------- */

commands.push(
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription(
      "Show bot statistics"
    )
);

/* =========================================================
   COMMAND PERMISSION HELPER
========================================================= */

function requireStaff(interaction) {
  if (!interaction.guild) {
    return false;
  }

  return isStaff(
    interaction.member
  );
}

/* =========================================================
   ANTI-RAID
========================================================= */

async function handleMemberJoin(member) {
  const guild =
    member.guild;

  const data =
    getGuildData(
      guild.id
    );

  if (
    !data.security.enabled ||
    !data.security.antiRaid
  ) {
    return;
  }

  const now = Date.now();

  let joins =
    joinTracker.get(
      guild.id
    ) || [];

  joins = joins.filter(
    timestamp =>
      now - timestamp <=
      data.security.raidWindow
  );

  joins.push(now);

  joinTracker.set(
    guild.id,
    joins
  );

  if (
    joins.length >=
    data.security.raidLimit
  ) {
    data.statistics.raids++;

    await sendLog(
      guild,
      "security",
      "🚨 Possible Raid Detected",
      [
        `**Guild:** ${guild.name}`,
        `**Recent joins:** ${joins.length}`,
        `**Window:** ${data.security.raidWindow}ms`
      ].join("\n"),
      0xed4245
    );

    /*
      We do not automatically ban everyone.
      This prevents the security system from
      accidentally punishing legitimate members.
    */

    if (
      data.security.newAccountProtection
    ) {
      const accountAge =
        now -
        member.user.createdTimestamp;

      const minimumAge =
        data.security.newAccountDays *
        86400000;

      if (
        accountAge <
        minimumAge
      ) {
        if (
          member.moderatable
        ) {
          await member.timeout(
            3600000,
            "Anti-Raid: newly created account during raid detection"
          ).catch(() => {});
        }
      }
    }

    saveDatabase();
  }
}

/* =========================================================
   ROLE PROTECTOR
========================================================= */

function isProtectedRole(
  guild,
  role
) {
  const data =
    getGuildData(
      guild.id
    );

  if (
    !data.roleProtection.enabled
  ) {
    return false;
  }

  if (
    data.roleProtection.protectedRoles
      .includes(role.id)
  ) {
    return true;
  }

  /*
    @everyone role is automatically protected
    when protectEveryone is enabled.
  */

  if (
    data.roleProtection.protectEveryone &&
    role.id === guild.id
  ) {
    return true;
  }

  return false;
}

/* =========================================================
   ROLE UPDATE PROTECTION
========================================================= */

async function handleRoleUpdate(
  oldRole,
  newRole
) {
  const guild =
    newRole.guild;

  const data =
    getGuildData(
      guild.id
    );

  if (
    !data.roleProtection.enabled
  ) {
    return;
  }

  if (
    !isProtectedRole(
      guild,
      newRole
    )
  ) {
    return;
  }

  /*
    Protect important role permissions/settings.
  */

  const changed =
    oldRole.permissions.bitfield !==
      newRole.permissions.bitfield ||
    oldRole.name !==
      newRole.name ||
    oldRole.color !==
      newRole.color ||
    oldRole.hoist !==
      newRole.hoist ||
    oldRole.mentionable !==
      newRole.mentionable;

  if (!changed) {
    return;
  }

  /*
    Restore the protected role.
  */

  try {
    await newRole.edit({
      name: oldRole.name,
      permissions:
        oldRole.permissions,
      color: oldRole.color,
      hoist: oldRole.hoist,
      mentionable:
        oldRole.mentionable,
      reason:
        "Role Protector: unauthorized protected-role modification"
    });
  } catch (error) {
    console.error(
      "Protected role restore error:",
      error
    );
  }

  await sendLog(
    guild,
    "roles",
    "🛡️ Protected Role Restored",
    [
      `**Role:** ${newRole}`,
      `**Role ID:** ${newRole.id}`,
      `**Action:** Unauthorized modification detected`,
      `**Action taken:** Role restored`
    ].join("\n"),
    0xed4245
  );
}

/* =========================================================
   ROLE DELETE PROTECTION
========================================================= */

async function handleRoleDelete(role) {
  const guild =
    role.guild;

  const data =
    getGuildData(
      guild.id
    );

  if (
    !data.roleProtection.enabled
  ) {
    return;
  }

  if (
    !isProtectedRole(
      guild,
      role
    )
  ) {
    return;
  }

  /*
    Discord cannot restore the exact deleted
    role position perfectly without more audit
    information, so recreate the important
    properties.
  */

  try {
    const restored =
      await guild.roles.create({
        name: role.name,
        permissions:
          role.permissions,
        color: role.color,
        hoist: role.hoist,
        mentionable:
          role.mentionable,
        reason:
          "Role Protector: protected role deleted"
      });

    if (
      role.position >
      1
    ) {
      await restored.setPosition(
        Math.min(
          role.position,
          guild.roles.cache.size
        )
      ).catch(() => {});
    }

    /*
      Keep the restored role protected.
    */

    if (
      !data.roleProtection.protectedRoles
        .includes(restored.id)
    ) {
      data.roleProtection.protectedRoles.push(
        restored.id
      );
    }

    saveDatabase();

    await sendLog(
      guild,
      "roles",
      "🚨 Protected Role Restored",
      [
        `**Deleted role:** ${role.name}`,
        `**Action:** Role recreated`,
        `**New Role:** ${restored}`
      ].join("\n"),
      0xed4245
    );
  } catch (error) {
    console.error(
      "Role restoration error:",
      error
    );
  }
}

/* =========================================================
   CHANNEL DELETE PROTECTION
========================================================= */

async function handleChannelDelete(
  channel
) {
  const guild =
    channel.guild;

  if (!guild) {
    return;
  }

  const data =
    getGuildData(
      guild.id
    );

  if (
    !data.security.enabled ||
    !data.security.antiNuke
  ) {
    return;
  }

  const now =
    Date.now();

  let actions =
    nukeTracker.get(
      guild.id
    ) || [];

  actions = actions.filter(
    timestamp =>
      now - timestamp <=
      data.security.nukeWindow
  );

  actions.push(now);

  nukeTracker.set(
    guild.id,
    actions
  );

  if (
    actions.length >=
    data.security.nukeLimit
  ) {
    data.statistics.securityEvents++;

    await sendLog(
      guild,
      "security",
      "🚨 Anti-Nuke Triggered",
      [
        `**Event:** Multiple channel deletions`,
        `**Actions detected:** ${actions.length}`,
        `**Limit:** ${data.security.nukeLimit}`,
        `**Window:** ${data.security.nukeWindow}ms`
      ].join("\n"),
      0xed4245
    );

    saveDatabase();
  }
}

/* =========================================================
   MESSAGE AUTOMOD
========================================================= */

async function handleMessageAutoMod(
  message
) {
  if (
    !message.guild ||
    message.author.bot
  ) {
    return;
  }

  const data =
    getGuildData(
      message.guild.id
    );

  if (
    !data.automod.enabled
  ) {
    return;
  }

  /*
    Trusted users are ignored by AutoMod.
  */

  if (
    isTrusted(
      message.guild,
      message.author.id
    )
  ) {
    return;
  }

  const content =
    message.content || "";

  /* INVITE LINKS */

  if (
    data.automod.invites &&
    /(discord\.gg\/|discord\.com\/invite\/)/i
      .test(content)
  ) {
    await executeAutoMod(
      message,
      "Discord invite link"
    );

    return true;
  }

  /* MASS MENTIONS */

  if (
    data.automod.mentions &&
    message.mentions.users.size +
      message.mentions.roles.size >=
      data.automod.mentionLimit
  ) {
    await executeAutoMod(
      message,
      "Mass mentions"
    );

    return true;
  }

  /* BAD WORDS */

  if (
    data.automod.badwords
  ) {
    const matched =
      checkBadWord(
        content,
        data.automod.badWords
      );

    if (matched) {
      await executeAutoMod(
        message,
        `Blocked word: ${matched}`
      );

      return true;
    }
  }

  /* CAPS */

  if (
    data.automod.caps &&
    checkCaps(
      content,
      data.automod.capsPercent
    )
  ) {
    await executeAutoMod(
      message,
      "Excessive capital letters"
    );

    return true;
  }

  /* SPAM */

  if (
    data.automod.spam
  ) {
    const key =
      `${message.guild.id}:${message.author.id}`;

    const now =
      Date.now();

    let entries =
      spamTracker.get(
        key
      ) || [];

    entries =
      entries.filter(
        item =>
          now - item <=
          data.automod.spamWindow
      );

    entries.push(now);

    spamTracker.set(
      key,
      entries
    );

    if (
      entries.length >=
      data.automod.spamLimit
    ) {
      spamTracker.delete(key);

      await executeAutoMod(
        message,
        "Spam"
      );

      return true;
    }
  }

  /* REPEATED MESSAGES */

  if (
    data.automod.repeated
  ) {
    const key =
      `repeat:${message.guild.id}:${message.author.id}`;

    const now =
      Date.now();

    let entries =
      spamTracker.get(
        key
      ) || [];

    entries =
      entries.filter(
        item =>
          now - item.time <=
          data.automod.repeatedWindow
      );

    const normalized =
      content
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

    entries.push({
      text: normalized,
      time: now
    });

    spamTracker.set(
      key,
      entries
    );

    const repeated =
      entries.filter(
        item =>
          item.text ===
          normalized
      );

    if (
      repeated.length >=
      data.automod.repeatedLimit
    ) {
      spamTracker.delete(key);

      await executeAutoMod(
        message,
        "Repeated message"
      );

      return true;
    }
  }

  return false;
}

/* =========================================================
   PART 2 END
   PART 3 CONTINUES DIRECTLY AFTER THIS LINE.
========================================================= */

/* =========================================================
   PART 3/4
   FULL DM TICKET SYSTEM
   MODERATION
   SUGGESTIONS
========================================================= */

/* =========================================================
   TICKET HELPERS
========================================================= */

function getTicketById(guild, ticketId) {
  const data = getGuildData(guild.id);
  return data.tickets.records[ticketId] || null;
}

function getOpenTicketForUser(guild, userId) {
  const data = getGuildData(guild.id);

  return Object.values(data.tickets.records).find(
    ticket =>
      ticket.userId === userId &&
      ticket.status !== "deleted"
  );
}

async function getTicketChannel(guild, ticket) {
  if (!ticket || !ticket.channelId) {
    return null;
  }

  return guild.channels
    .fetch(ticket.channelId)
    .catch(() => null);
}

/* =========================================================
   CREATE DM TICKET
========================================================= */

async function createDMTicket(user) {
  const guild = await client.guilds
    .fetch(SERVER_ID)
    .catch(() => null);

  if (!guild) {
    throw new Error(
      "Configured server could not be found."
    );
  }

  const data = getGuildData(guild.id);

  const existing =
    getOpenTicketForUser(
      guild,
      user.id
    );

  if (existing) {
    return {
      existing: true,
      ticket: existing
    };
  }

  const category =
    data.tickets.categoryId
      ? await guild.channels
          .fetch(data.tickets.categoryId)
          .catch(() => null)
      : null;

  const channel =
    await guild.channels.create({
      name: `ticket-${String(
        data.tickets.counter + 1
      ).padStart(4, "0")}`,

      type: ChannelType.GuildText,

      parent:
        category &&
        category.type ===
          ChannelType.GuildCategory
          ? category.id
          : null,

      topic:
        `DM Ticket for ${user.tag} | ${user.id}`,

      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [
            PermissionsBitField.Flags.ViewChannel
          ]
        },
        {
          id: SUPPORT_ADMIN_ROLE,
          allow: [
            PermissionsBitField.Flags.ViewChannel,
            PermissionsBitField.Flags.SendMessages,
            PermissionsBitField.Flags.ReadMessageHistory
          ]
        }
      ]
    });

  data.tickets.counter++;

  const ticketId =
    `T-${String(
      data.tickets.counter
    ).padStart(4, "0")}`;

  const ticket = {
    id: ticketId,
    userId: user.id,
    userTag: user.tag,
    channelId: channel.id,
    status: "open",
    claimedBy: null,
    createdAt: Date.now(),
    closedAt: null,
    closedBy: null
  };

  data.tickets.records[ticketId] =
    ticket;

  data.statistics.tickets++;

  saveDatabase();

  const buttons =
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(
          `ticket_close:${ticketId}`
        )
        .setLabel("Close Ticket")
        .setEmoji("🔒")
        .setStyle(
          ButtonStyle.Danger
        ),

      new ButtonBuilder()
        .setCustomId(
          `ticket_claim:${ticketId}`
        )
        .setLabel("Claim")
        .setEmoji("🙋")
        .setStyle(
          ButtonStyle.Primary
        )
    );

  await channel.send({
    content:
      `<@&${SUPPORT_ADMIN_ROLE}>`,

    embeds: [
      makeEmbed(
        `🎫 Support Ticket ${ticketId}`,
        [
          `**User:** <@${user.id}>`,
          `**User ID:** \`${user.id}\``,
          "",
          "A new ticket has been created from Discord DMs.",
          "Staff members can claim or close this ticket.",
          "",
          "Please assist the user professionally."
        ].join("\n"),
        0x5865f2
      )
    ],

    components: [
      buttons
    ]
  });

  await sendLog(
    guild,
    "tickets",
    "🎫 Ticket Created",
    [
      `**Ticket:** ${ticketId}`,
      `**User:** ${user.tag}`,
      `**User ID:** ${user.id}`,
      `**Channel:** ${channel}`
    ].join("\n"),
    0x57f287
  );

  try {
    await user.send({
      embeds: [
        makeEmbed(
          "🎫 Support Ticket Created",
          [
            `Your ticket **${ticketId}** has been created.`,
            "",
            "Please send your issue or request here.",
            "A member of the support team will respond."
          ].join("\n"),
          0x57f287
        )
      ]
    });
  } catch {}

  return {
    existing: false,
    ticket
  };
}

/* =========================================================
   FORWARD DM TO TICKET
========================================================= */

async function forwardDMToTicket(message) {
  const guild = await client.guilds
    .fetch(SERVER_ID)
    .catch(() => null);

  if (!guild) {
    return;
  }

  const ticket =
    getOpenTicketForUser(
      guild,
      message.author.id
    );

  if (!ticket) {
    return;
  }

  if (
    ticket.status === "closed"
  ) {
    return;
  }

  const channel =
    await getTicketChannel(
      guild,
      ticket
    );

  if (!channel) {
    return;
  }

  const attachmentText =
    message.attachments.size
      ? "\n\n**Attachments:**\n" +
        message.attachments
          .map(
            attachment =>
              attachment.url
          )
          .join("\n")
      : "";

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setAuthor({
          name: `${message.author.tag} • DM`,
          iconURL:
            message.author.displayAvatarURL()
        })
        .setDescription(
          shorten(
            `${message.content || "*No text*"}${attachmentText}`,
            3900
          )
        )
        .setTimestamp()
    ]
  });

  await sendLog(
    guild,
    "tickets",
    "📩 DM Received",
    [
      `**Ticket:** ${ticket.id}`,
      `**User:** ${message.author.tag}`,
      `**Content:** ${shorten(
        message.content || "No text",
        800
      )}`
    ].join("\n")
  );
}

/* =========================================================
   SEND STAFF REPLY TO USER DM
========================================================= */

async function sendTicketReply(
  interaction,
  ticket
) {
  const user =
    await client.users
      .fetch(ticket.userId)
      .catch(() => null);

  if (!user) {
    return false;
  }

  const modalLike =
    interaction.options
      ? interaction.options.getString(
          "message"
        )
      : null;

  if (!modalLike) {
    return false;
  }

  try {
    await user.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0x57f287)
          .setAuthor({
            name:
              `${interaction.user.tag} • Support`,
            iconURL:
              interaction.user.displayAvatarURL()
          })
          .setDescription(
            shorten(
              modalLike,
              3900
            )
          )
          .setFooter({
            text:
              `Ticket ${ticket.id}`
          })
          .setTimestamp()
      ]
    });

    return true;
  } catch {
    return false;
  }
}

/* =========================================================
   TICKET CLOSE
========================================================= */

async function closeTicket(
  guild,
  ticket,
  closedBy
) {
  if (!ticket) {
    return false;
  }

  ticket.status = "closed";
  ticket.closedAt = Date.now();
  ticket.closedBy = closedBy;

  saveDatabase();

  const channel =
    await getTicketChannel(
      guild,
      ticket
    );

  if (channel) {
    await channel.send({
      embeds: [
        makeEmbed(
          "🔒 Ticket Closed",
          [
            `**Ticket:** ${ticket.id}`,
            `**Closed by:** <@${closedBy}>`,
            "",
            "This ticket is now closed."
          ].join("\n"),
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
      `**User:** <@${ticket.userId}>`,
      `**Closed by:** <@${closedBy}>`
    ].join("\n"),
    0xed4245
  );

  const user =
    await client.users
      .fetch(ticket.userId)
      .catch(() => null);

  if (user) {
    await user.send({
      embeds: [
        makeEmbed(
          `🔒 Ticket ${ticket.id} Closed`,
          "Your support ticket has been closed. You can send a new DM if you need further assistance.",
          0xed4245
        )
      ]
    }).catch(() => {});
  }

  return true;
}

/* =========================================================
   TICKET REOPEN
========================================================= */

async function reopenTicket(
  guild,
  ticket
) {
  if (!ticket) {
    return false;
  }

  ticket.status = "open";
  ticket.closedAt = null;
  ticket.closedBy = null;

  saveDatabase();

  const channel =
    await getTicketChannel(
      guild,
      ticket
    );

  if (channel) {
    await channel.send({
      embeds: [
        makeEmbed(
          "🔓 Ticket Reopened",
          `Ticket **${ticket.id}** has been reopened.`,
          0x57f287
        )
      ]
    }).catch(() => {});
  }

  return true;
}

/* =========================================================
   TICKET TRANSCRIPT
========================================================= */

async function createTranscript(
  guild,
  ticket
) {
  const channel =
    await getTicketChannel(
      guild,
      ticket
    );

  if (!channel) {
    return null;
  }

  let messages = [];

  try {
    let lastId;

    for (let i = 0; i < 10; i++) {
      const fetched =
        await channel.messages.fetch({
          limit: 100,
          before: lastId
        });

      if (!fetched.size) {
        break;
      }

      messages.push(
        ...Array.from(
          fetched.values()
        )
      );

      lastId =
        fetched.last().id;

      if (
        fetched.size < 100
      ) {
        break;
      }
    }
  } catch {}

  messages =
    messages.reverse();

  const lines = [
    `Ticket Transcript`,
    `Ticket: ${ticket.id}`,
    `User: ${ticket.userTag}`,
    `User ID: ${ticket.userId}`,
    `Created: ${new Date(
      ticket.createdAt
    ).toISOString()}`,
    "",
    "================================",
    ""
  ];

  for (const message of messages) {
    lines.push(
      `[${message.createdAt.toISOString()}] ${message.author.tag}: ${message.content || "[embed/attachment]"}`
    );
  }

  return lines.join("\n");
}

/* =========================================================
   MODERATION ESCALATION
========================================================= */

async function applyWarningEscalation(
  member,
  warningCount
) {
  if (!member) {
    return null;
  }

  /*
    3 warnings  -> 1 hour timeout
    5 warnings  -> 1 day timeout
    7 warnings  -> kick
    10 warnings -> ban
  */

  if (
    warningCount >= 10 &&
    member.bannable
  ) {
    await member.ban({
      reason:
        "Warning escalation: 10 warnings"
    }).catch(() => {});

    return "ban";
  }

  if (
    warningCount >= 7 &&
    member.kickable
  ) {
    await member.kick(
      "Warning escalation: 7 warnings"
    ).catch(() => {});

    return "kick";
  }

  if (
    warningCount >= 5
  ) {
    const result =
      await applyTimeout(
        member,
        86400000,
        "Warning escalation: 5 warnings"
      );

    if (result) {
      return "24h timeout";
    }
  }

  if (
    warningCount >= 3
  ) {
    const result =
      await applyTimeout(
        member,
        3600000,
        "Warning escalation: 3 warnings"
      );

    if (result) {
      return "1h timeout";
    }
  }

  return null;
}

/* =========================================================
   SUGGESTION CREATION
========================================================= */

async function createSuggestion(
  interaction
) {
  const guild =
    interaction.guild;

  const data =
    getGuildData(
      guild.id
    );

  const text =
    interaction.options.getString(
      "suggestion",
      true
    );

  data.suggestions.counter++;

  const suggestionId =
    `S-${String(
      data.suggestions.counter
    ).padStart(4, "0")}`;

  const suggestion = {
    id: suggestionId,
    userId: interaction.user.id,
    userTag: interaction.user.tag,
    text,
    status: "pending",
    createdAt: Date.now(),
    reviewedBy: null,
    reviewedAt: null
  };

  data.suggestions.records[
    suggestionId
  ] = suggestion;

  saveDatabase();

  let channel = null;

  if (
    data.suggestions.channelId
  ) {
    channel =
      await guild.channels
        .fetch(
          data.suggestions.channelId
        )
        .catch(() => null);
  }

  if (!channel) {
    channel =
      interaction.channel;
  }

  const row =
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(
          `suggest_approve:${suggestionId}`
        )
        .setLabel("Approve")
        .setEmoji("✅")
        .setStyle(
          ButtonStyle.Success
        ),

      new ButtonBuilder()
        .setCustomId(
          `suggest_decline:${suggestionId}`
        )
        .setLabel("Decline")
        .setEmoji("❌")
        .setStyle(
          ButtonStyle.Danger
        )
    );

  await channel.send({
    content:
      data.suggestions.staffRoleId
        ? `<@&${data.suggestions.staffRoleId}>`
        : undefined,

    embeds: [
      new EmbedBuilder()
        .setColor(0xfee75c)
        .setTitle(
          `💡 Suggestion ${suggestionId}`
        )
        .setDescription(
          shorten(text, 3800)
        )
        .addFields(
          {
            name: "Submitted by",
            value:
              `<@${interaction.user.id}>`
          },
          {
            name: "Status",
            value: "🟡 Pending"
          }
        )
        .setTimestamp()
    ],

    components: [row]
  });

  await interaction.reply({
    embeds: [
      makeEmbed(
        "💡 Suggestion Submitted",
        `Your suggestion has been submitted as **${suggestionId}**.`,
        0x57f287
      )
    ],
    ephemeral: true
  });

  await sendLog(
    guild,
    "suggestions",
    "💡 New Suggestion",
    [
      `**ID:** ${suggestionId}`,
      `**User:** ${interaction.user}`,
      `**Suggestion:** ${shorten(
        text,
        1000
      )}`
    ].join("\n"),
    0xfee75c
  );
}

/* =========================================================
   SUGGESTION REVIEW
========================================================= */

async function reviewSuggestion(
  interaction,
  approved
) {
  if (
    !requireStaff(interaction)
  ) {
    return interaction.reply({
      content:
        "❌ You do not have permission to review suggestions.",
      ephemeral: true
    });
  }

  const id =
    interaction.customId.split(
      ":"
    )[1];

  const data =
    getGuildData(
      interaction.guild.id
    );

  const suggestion =
    data.suggestions.records[id];

  if (!suggestion) {
    return interaction.reply({
      content:
        "❌ Suggestion not found.",
      ephemeral: true
    });
  }

  if (
    suggestion.status !==
    "pending"
  ) {
    return interaction.reply({
      content:
        `❌ This suggestion is already **${suggestion.status}**.`,
      ephemeral: true
    });
  }

  suggestion.status =
    approved
      ? "approved"
      : "declined";

  suggestion.reviewedBy =
    interaction.user.id;

  suggestion.reviewedAt =
    Date.now();

  saveDatabase();

  const oldMessage =
    interaction.message;

  const oldEmbed =
    oldMessage.embeds[0];

  const updatedEmbed =
    EmbedBuilder.from(
      oldEmbed
    )
      .setColor(
        approved
          ? 0x57f287
          : 0xed4245
      )
      .spliceFields(
        1,
        1,
        {
          name: "Status",
          value:
            approved
              ? "✅ Approved"
              : "❌ Declined"
        }
      )
      .addFields({
        name: "Reviewed by",
        value:
          `<@${interaction.user.id}>`
      });

  await interaction.update({
    embeds: [
      updatedEmbed
    ],
    components: []
  });

  const user =
    await client.users
      .fetch(
        suggestion.userId
      )
      .catch(() => null);

  if (user) {
    await user.send({
      embeds: [
        makeEmbed(
          `💡 Suggestion ${id}`,
          [
            `Your suggestion was **${suggestion.status}**.`,
            "",
            `**Suggestion:** ${suggestion.text}`,
            "",
            `Reviewed by: ${interaction.user.tag}`
          ].join("\n"),
          approved
            ? 0x57f287
            : 0xed4245
        )
      ]
    }).catch(() => {});
  }

  await sendLog(
    interaction.guild,
    "suggestions",
    approved
      ? "✅ Suggestion Approved"
      : "❌ Suggestion Declined",
    [
      `**ID:** ${id}`,
      `**User:** <@${suggestion.userId}>`,
      `**Reviewer:** ${interaction.user}`,
      `**Suggestion:** ${shorten(
        suggestion.text,
        800
      )}`
    ].join("\n"),
    approved
      ? 0x57f287
      : 0xed4245
  );
}

/* =========================================================
   TICKET BUTTON HANDLER
========================================================= */

async function handleTicketButton(
  interaction
) {
  const [action, ticketId] =
    interaction.customId.split(
      ":"
    );

  const ticket =
    getTicketById(
      interaction.guild,
      ticketId
    );

  if (!ticket) {
    return interaction.reply({
      content:
        "❌ Ticket not found.",
      ephemeral: true
    });
  }

  if (
    !requireStaff(interaction)
  ) {
    return interaction.reply({
      content:
        "❌ You do not have permission to manage tickets.",
      ephemeral: true
    });
  }

  if (
    action === "ticket_claim"
  ) {
    ticket.claimedBy =
      interaction.user.id;

    saveDatabase();

    await interaction.reply({
      content:
        `🙋 Ticket **${ticketId}** claimed by ${interaction.user}.`,
      ephemeral: false
    });

    await sendLog(
      interaction.guild,
      "tickets",
      "🙋 Ticket Claimed",
      [
        `**Ticket:** ${ticketId}`,
        `**Staff:** ${interaction.user}`
      ].join("\n")
    );

    return;
  }

  if (
    action === "ticket_close"
  ) {
    await interaction.reply({
      content:
        "🔒 Closing ticket...",
      ephemeral: true
    });

    await closeTicket(
      interaction.guild,
      ticket,
      interaction.user.id
    );

    return;
  }
}

/* =========================================================
   TICKET MESSAGE BUTTONS FOR USER
========================================================= */

async function createTicketPanel(
  channel
) {
  const row =
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(
          "create_dm_ticket"
        )
        .setLabel(
          "Open Support Ticket"
        )
        .setEmoji("🎫")
        .setStyle(
          ButtonStyle.Primary
        )
    );

  return channel.send({
    embeds: [
      makeEmbed(
        "🎫 Support Center",
        [
          "Need help from our support team?",
          "",
          "Click **Open Support Ticket** below.",
          "Your support conversation will be handled privately through DMs.",
          "",
          "Please provide a clear description of your issue."
        ].join("\n"),
        0x5865f2
      )
    ],
    components: [row]
  });
}

/* =========================================================
   ANNOUNCEMENT BUILDER
========================================================= */

async function sendAnnouncement(
  interaction
) {
  if (
    !requireStaff(interaction)
  ) {
    return interaction.reply({
      content:
        "❌ You do not have permission to create announcements.",
      ephemeral: true
    });
  }

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

  const channel =
    interaction.options.getChannel(
      "channel",
      true
    );

  const image =
    interaction.options.getString(
      "image"
    );

  const role =
    interaction.options.getRole(
      "role"
    );

  const everyone =
    interaction.options.getBoolean(
      "everyone"
    );

  const data =
    getGuildData(
      interaction.guild.id
    );

  if (
    !channel.isTextBased()
  ) {
    return interaction.reply({
      content:
        "❌ That is not a text channel.",
      ephemeral: true
    });
  }

  let content = "";

  if (everyone) {
    content += "@everyone ";
  }

  if (role) {
    content += `${role} `;
  }

  const embed =
    new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(title)
      .setDescription(
        shorten(message, 3900)
      )
      .setFooter({
        text:
          `Announcement • ${interaction.guild.name}`
      })
      .setTimestamp();

  if (image) {
    embed.setImage(image);
  }

  const row =
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(
          `announcement_info:${Date.now()}`
        )
        .setLabel("Announcement")
        .setEmoji("📢")
        .setStyle(
          ButtonStyle.Secondary
        )
        .setDisabled(true)
    );

  await channel.send({
    content:
      content || undefined,

    embeds: [embed],

    components: [row],

    allowedMentions: {
      parse:
        everyone
          ? ["everyone"]
          : [],
      roles:
        role
          ? [role.id]
          : []
    }
  });

  data.announcements.history.push({
    title,
    message,
    channelId: channel.id,
    roleId: role
      ? role.id
      : null,
    everyone: !!everyone,
    image: image || null,
    createdBy:
      interaction.user.id,
    timestamp: Date.now()
  });

  if (
    data.announcements.history.length >
    500
  ) {
    data.announcements.history =
      data.announcements.history.slice(
        -500
      );
  }

  saveDatabase();

  await interaction.reply({
    content:
      `📢 Announcement sent to ${channel}.`,
    ephemeral: true
  });

  await sendLog(
    interaction.guild,
    "announcements",
    "📢 Announcement Sent",
    [
      `**Channel:** ${channel}`,
      `**Created by:** ${interaction.user}`,
      `**Title:** ${title}`
    ].join("\n")
  );
}

/* =========================================================
   PART 3 END
   PART 4 WILL ADD:
   - ALL INTERACTION HANDLERS
   - ALL COMMAND EXECUTION
   - CONFIG COMMANDS
   - LOG COMMANDS
   - TRUSTED SYSTEM
   - ANNOUNCEMENT CONFIG
   - TICKET COMMAND EXECUTION
   - MEMBER/ROLE/CHANNEL/MESSAGE EVENTS
   - COMMAND REGISTRATION
   - FINAL READY EVENT
   - FINAL CLIENT LOGIN
========================================================= */
/* =========================================================
   PART 4/4 — FINAL
   COMMAND HANDLERS + EVENTS + REGISTRATION + LOGIN
========================================================= */

/* =========================================================
   MODERATION COMMANDS
========================================================= */

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
    .setDescription("View member warnings")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("punishments")
    .setDescription("View punishment history")
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
        .setDescription("Timeout duration")
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
    .addStringOption(o =>
      o.setName("reason")
        .setDescription("Reason")
    )


/* =========================================================
   SECURITY COMMAND
========================================================= */

const securityCommand =
  new SlashCommandBuilder()
    .setName("security")
    .setDescription("Configure server security");

securityCommand
  .addSubcommand(s =>
    s.setName("enable")
      .setDescription("Enable security")
  )
  .addSubcommand(s =>
    s.setName("disable")
      .setDescription("Disable security")
  )
  .addSubcommand(s =>
    s.setName("status")
      .setDescription("View security status")
  )
  .addSubcommand(s =>
    s.setName("antiraid")
      .setDescription("Configure anti-raid")
      .addBooleanOption(o =>
        o.setName("enabled")
          .setDescription("Enabled")
          .setRequired(true)
      )
  )
  .addSubcommand(s =>
    s.setName("antinuke")
      .setDescription("Configure anti-nuke")
      .addBooleanOption(o =>
        o.setName("enabled")
          .setDescription("Enabled")
          .setRequired(true)
      )
  )
  .addSubcommand(s =>
    s.setName("raidlimit")
      .setDescription("Set raid join limit")
      .addIntegerOption(o =>
        o.setName("limit")
          .setDescription("Join limit")
          .setMinValue(2)
          .setMaxValue(100)
          .setRequired(true)
      )
  )
  .addSubcommand(s =>
    s.setName("nukelimit")
      .setDescription("Set anti-nuke limit")
      .addIntegerOption(o =>
        o.setName("limit")
          .setDescription("Action limit")
          .setMinValue(2)
          .setMaxValue(50)
          .setRequired(true)
      )
  );

commands.push(securityCommand);

/* =========================================================
   ROLE PROTECTOR COMMAND
========================================================= */

const roleProtectionCommand =
  new SlashCommandBuilder()
    .setName("roleprotector")
    .setDescription("Configure Role Protector")
    .addSubcommand(s =>
      s.setName("enable")
        .setDescription("Enable Role Protector")
    )
    .addSubcommand(s =>
      s.setName("disable")
        .setDescription("Disable Role Protector")
    )
    .addSubcommand(s =>
      s.setName("status")
        .setDescription("View Role Protector")
    )
    .addSubcommand(s =>
      s.setName("protect")
        .setDescription("Protect a role")
        .addRoleOption(o =>
          o.setName("role")
            .setDescription("Role")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("unprotect")
        .setDescription("Remove protected role")
        .addRoleOption(o =>
          o.setName("role")
            .setDescription("Role")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("everyone")
        .setDescription("Protect @everyone")
        .addBooleanOption(o =>
          o.setName("enabled")
            .setDescription("Enabled")
            .setRequired(true)
        )
    );

commands.push(roleProtectionCommand);

/* =========================================================
   TICKET COMMANDS
========================================================= */

const ticketCommand =
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Manage ticket system")
    .addSubcommand(s =>
      s.setName("panel")
        .setDescription("Send ticket panel")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Channel")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("close")
        .setDescription("Close ticket")
    )
    .addSubcommand(s =>
      s.setName("reopen")
        .setDescription("Reopen ticket")
        .addStringOption(o =>
          o.setName("id")
            .setDescription("Ticket ID")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("reply")
        .setDescription("Reply to ticket user")
        .addStringOption(o =>
          o.setName("id")
            .setDescription("Ticket ID")
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName("message")
            .setDescription("Reply")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("info")
        .setDescription("View ticket information")
        .addStringOption(o =>
          o.setName("id")
            .setDescription("Ticket ID")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("transcript")
        .setDescription("Create ticket transcript")
        .addStringOption(o =>
          o.setName("id")
            .setDescription("Ticket ID")
            .setRequired(true)
        )
    );

commands.push(ticketCommand);

/* =========================================================
   AUTOTIMEOUT COMMAND
========================================================= */

const autotimeoutCommand =
  new SlashCommandBuilder()
    .setName("autotimeout")
    .setDescription("Configure automatic timeout")
    .addSubcommand(s =>
      s.setName("enable")
        .setDescription("Enable automatic timeout")
    )
    .addSubcommand(s =>
      s.setName("disable")
        .setDescription("Disable automatic timeout")
    )
    .addSubcommand(s =>
      s.setName("status")
        .setDescription("View automatic timeout")
    )
    .addSubcommand(s =>
      s.setName("duration")
        .setDescription("Set timeout duration")
        .addIntegerOption(o =>
          o.setName("minutes")
            .setDescription("Minutes")
            .setMinValue(1)
            .setMaxValue(40320)
            .setRequired(true)
        )
    );

commands.push(autotimeoutCommand);

/* =========================================================
   COMMAND EXECUTION
========================================================= */

async function executeCommand(interaction) {

  if (!interaction.guild) {
    return interaction.reply({
      content:
        "❌ This command can only be used inside a server.",
      ephemeral: true
    }).catch(() => {});
  }

  const data =
    getGuildData(
      interaction.guild.id
    );

  const name =
    interaction.commandName;

  /* STAFF CHECK */

  const staffCommands = [
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
    "ticket",
    "autotimeout",
    "config",
    "logs",
    "trusted",
    "announcement",
    "announce"
  ];

  if (
    staffCommands.includes(name) &&
    !requireStaff(interaction)
  ) {
    return interaction.reply({
      content:
        "❌ You do not have permission to use this command.",
      ephemeral: true
    });
  }

  /* ---------------- WARN ---------------- */

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
        await applyWarningEscalation(
          member,
          record.count
        );
    }

    await user.send({
      embeds: [
        makeEmbed(
          "⚠️ You Have Been Warned",
          [
            `**Server:** ${interaction.guild.name}`,
            `**Reason:** ${reason}`,
            `**Warnings:** ${record.count}`
          ].join("\n"),
          0xfee75c
        )
      ]
    }).catch(() => {});

    await interaction.reply({
      embeds: [
        makeEmbed(
          "⚠️ Warning Issued",
          [
            `**User:** ${user}`,
            `**Reason:** ${reason}`,
            `**Total warnings:** ${record.count}`,
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
      "⚠️ Warning Issued",
      [
        `**User:** ${user}`,
        `**Moderator:** ${interaction.user}`,
        `**Reason:** ${reason}`,
        `**Warnings:** ${record.count}`,
        escalation
          ? `**Escalation:** ${escalation}`
          : ""
      ].filter(Boolean).join("\n"),
      0xfee75c
    );

    return;
  }

  /* ---------------- WARNINGS ---------------- */

  if (name === "warnings") {
    const user =
      interaction.options.getUser(
        "user",
        true
      );

    const warnings =
      getWarnings(
        interaction.guild.id,
        user.id
      );

    const description =
      warnings.length
        ? warnings.map(
            (w, i) =>
              `**${i + 1}.** ${w.reason}\n` +
              `Moderator: <@${w.moderatorId}>\n` +
              `<t:${Math.floor(
                w.timestamp / 1000
              )}:R>`
          ).join("\n\n")
        : "No warnings found.";

    return interaction.reply({
      embeds: [
        makeEmbed(
          `⚠️ Warnings — ${user.tag}`,
          description,
          0xfee75c
        )
      ],
      ephemeral: true
    });
  }

  /* ---------------- PUNISHMENTS ---------------- */

  if (name === "punishments") {
    const user =
      interaction.options.getUser(
        "user",
        true
      );

    const history =
      getPunishments(
        interaction.guild.id,
        user.id
      );

    const description =
      history.length
        ? history.slice(-15).reverse()
            .map(
              p =>
                `**${p.type.toUpperCase()}** — ${p.reason}\n` +
                `Moderator: <@${p.moderatorId}>\n` +
                `<t:${Math.floor(
                  p.timestamp / 1000
                )}:R>`
            )
            .join("\n\n")
        : "No punishment history found.";

    return interaction.reply({
      embeds: [
        makeEmbed(
          `📋 Punishments — ${user.tag}`,
          description,
          0x5865f2
        )
      ],
      ephemeral: true
    });
  }

  /* ---------------- TIMEOUT ---------------- */

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

    if (!member) {
      return interaction.reply({
        content:
          "❌ Member is not in the server.",
        ephemeral: true
      });
    }

    if (
      !member.moderatable
    ) {
      return interaction.reply({
        content:
          "❌ I cannot timeout this member. Check my role position and permissions.",
        ephemeral: true
      });
    }

    const success =
      await applyTimeout(
        member,
        minutes * 60000,
        reason
      );

    if (!success) {
      return interaction.reply({
        content:
          "❌ Failed to timeout member.",
        ephemeral: true
      });
    }

    addPunishment(
      interaction.guild.id,
      user.id,
      "timeout",
      reason,
      interaction.user.id
    );

    await interaction.reply({
      content:
        `⏱️ ${user} has been timed out for **${minutes} minutes**.`
    });

    await sendLog(
      interaction.guild,
      "moderation",
      "⏱️ Member Timed Out",
      [
        `**User:** ${user}`,
        `**Moderator:** ${interaction.user}`,
        `**Duration:** ${minutes} minutes`,
        `**Reason:** ${reason}`
      ].join("\n"),
      0xfee75c
    );

    return;
  }

  /* ---------------- KICK ---------------- */

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

    await interaction.reply({
      content:
        `👢 ${user.tag} has been kicked.`
    });

    await sendLog(
      interaction.guild,
      "moderation",
      "👢 Member Kicked",
      [
        `**User:** ${user}`,
        `**Moderator:** ${interaction.user}`,
        `**Reason:** ${reason}`
      ].join("\n"),
      0xed4245
    );

    return;
  }

  /* ---------------- BAN ---------------- */

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

    const member =
      await interaction.guild.members
        .fetch(user.id)
        .catch(() => null);

    if (
      member &&
      !member.bannable
    ) {
      return interaction.reply({
        content:
          "❌ I cannot ban this member.",
        ephemeral: true
      });
    }

    await interaction.guild.members.ban(
      user.id,
      {
        reason
      }
    );

    addPunishment(
      interaction.guild.id,
      user.id,
      "ban",
      reason,
      interaction.user.id
    );

    await interaction.reply({
      content:
        `🔨 ${user.tag} has been banned.`
    });

    await sendLog(
      interaction.guild,
      "moderation",
      "🔨 Member Banned",
      [
        `**User:** ${user}`,
        `**Moderator:** ${interaction.user}`,
        `**Reason:** ${reason}`
      ].join("\n"),
      0xed4245
    );

    return;
  }

  /* ---------------- UNBAN ---------------- */

  if (name === "unban") {
    const userId =
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
      userId,
      reason
    );

    addPunishment(
      interaction.guild.id,
      userId,
      "unban",
      reason,
      interaction.user.id
    );

    return interaction.reply({
      content:
        `🔓 User \`${userId}\` has been unbanned.`
    });
  }

  /* =======================================================
     AUTOMOD
  ======================================================= */

  if (name === "automod") {
    const sub =
      interaction.options.getSubcommand();

    if (sub === "enable") {
      data.automod.enabled = true;
    }

    if (sub === "disable") {
      data.automod.enabled = false;
    }

    if (sub === "invites") {
      data.automod.invites =
        interaction.options.getBoolean(
          "enabled",
          true
        );
    }

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

    if (sub === "mentions") {
      data.automod.mentionLimit =
        interaction.options.getInteger(
          "limit",
          true
        );
    }

    if (sub === "caps") {
      data.automod.caps = true;

      data.automod.capsPercent =
        interaction.options.getInteger(
          "percent",
          true
        );
    }

    if (sub === "badwords") {
      data.automod.badwords =
        interaction.options.getBoolean(
          "enabled",
          true
        );
    }

    if (sub === "addword") {
      const word =
        interaction.options.getString(
          "word",
          true
        ).toLowerCase();

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
        interaction.options.getString(
          "word",
          true
        ).toLowerCase();

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

    saveDatabase();

    if (sub === "status") {
      return interaction.reply({
        embeds: [
          makeEmbed(
            "🛡️ AutoMod Status",
            [
              `Enabled: ${data.automod.enabled ? "🟢" : "🔴"}`,
              `Invite Protection: ${data.automod.invites ? "🟢" : "🔴"}`,
              `Spam Protection: ${data.automod.spam ? "🟢" : "🔴"}`,
              `Mass Mentions: ${data.automod.mentions ? "🟢" : "🔴"}`,
              `Caps Protection: ${data.automod.caps ? "🟢" : "🔴"}`,
              `Bad Words: ${data.automod.badwords ? "🟢" : "🔴"}`,
              `Repeated Messages: ${data.automod.repeated ? "🟢" : "🔴"}`,
              `Bad Words Count: ${data.automod.badWords.length}`,
              `Log Channel: ${data.logs.automod ? `<#${data.logs.automod}>` : "Not configured"}`
            ].join("\n"),
            0x5865f2
          )
        ],
        ephemeral: true
      });
    }

    return interaction.reply({
      content:
        `✅ AutoMod configuration updated.`,
      ephemeral: true
    });
  }

  /* =======================================================
     SECURITY
  ======================================================= */

  if (name === "security") {
    const sub =
      interaction.options.getSubcommand();

    if (sub === "enable")
      data.security.enabled = true;

    if (sub === "disable")
      data.security.enabled = false;

    if (sub === "antiraid") {
      data.security.antiRaid =
        interaction.options.getBoolean(
          "enabled",
          true
        );
    }

    if (sub === "antinuke") {
      data.security.antiNuke =
        interaction.options.getBoolean(
          "enabled",
          true
        );
    }

    if (sub === "raidlimit") {
      data.security.raidLimit =
        interaction.options.getInteger(
          "limit",
          true
        );
    }

    if (sub === "nukelimit") {
      data.security.nukeLimit =
        interaction.options.getInteger(
          "limit",
          true
        );
    }

    saveDatabase();

    if (sub === "status") {
      return interaction.reply({
        embeds: [
          makeEmbed(
            "🔐 Security Status",
            [
              `Security: ${data.security.enabled ? "🟢" : "🔴"}`,
              `Anti-Raid: ${data.security.antiRaid ? "🟢" : "🔴"}`,
              `Anti-Nuke: ${data.security.antiNuke ? "🟢" : "🔴"}`,
              `Raid Limit: ${data.security.raidLimit}`,
              `Nuke Limit: ${data.security.nukeLimit}`,
              `Trusted Users: ${data.trusted.users.length}`,
              `Trusted Bots: ${data.trusted.bots.length}`
            ].join("\n"),
            0x5865f2
          )
        ],
        ephemeral: true
      });
    }

    return interaction.reply({
      content:
        "✅ Security configuration updated.",
      ephemeral: true
    });
  }

  /* =======================================================
     ROLE PROTECTOR
  ======================================================= */

  if (name === "roleprotector") {
    const sub =
      interaction.options.getSubcommand();

    if (sub === "enable")
      data.roleProtection.enabled = true;

    if (sub === "disable")
      data.roleProtection.enabled = false;

    if (sub === "everyone") {
      data.roleProtection.protectEveryone =
        interaction.options.getBoolean(
          "enabled",
          true
        );
    }

    if (
      sub === "protect" ||
      sub === "unprotect"
    ) {
      const role =
        interaction.options.getRole(
          "role",
          true
        );

      if (sub === "protect") {
        if (
          !data.roleProtection.protectedRoles.includes(
            role.id
          )
        ) {
          data.roleProtection.protectedRoles.push(
            role.id
          );
        }
      } else {
        data.roleProtection.protectedRoles =
          data.roleProtection.protectedRoles
            .filter(
              id =>
                id !== role.id
            );
      }
    }

    saveDatabase();

    if (sub === "status") {
      return interaction.reply({
        embeds: [
          makeEmbed(
            "🛡️ Role Protector",
            [
              `Enabled: ${data.roleProtection.enabled ? "🟢" : "🔴"}`,
              `@everyone Protection: ${data.roleProtection.protectEveryone ? "🟢" : "🔴"}`,
              `Protected Roles: ${data.roleProtection.protectedRoles.length}`
            ].join("\n"),
            0x5865f2
          )
        ],
        ephemeral: true
      });
    }

    return interaction.reply({
      content:
        "✅ Role Protector configuration updated.",
      ephemeral: true
    });
  }

  /* =======================================================
     TICKETS
  ======================================================= */

  if (name === "ticket") {
    const sub =
      interaction.options.getSubcommand();

    if (sub === "panel") {
      const channel =
        interaction.options.getChannel(
          "channel",
          true
        );

      if (!channel.isTextBased()) {
        return interaction.reply({
          content:
            "❌ Select a text channel.",
          ephemeral: true
        });
      }

      await createTicketPanel(
        channel
      );

      data.tickets.panelChannelId =
        channel.id;

      saveDatabase();

      return interaction.reply({
        content:
          `🎫 Ticket panel sent to ${channel}.`,
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
            interaction.channel.id
        );

      if (!ticket) {
        return interaction.reply({
          content:
            "❌ This channel is not a ticket.",
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

    if (sub === "reopen") {
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

      await reopenTicket(
        interaction.guild,
        ticket
      );

      return interaction.reply({
        content:
          `🔓 Ticket ${id} reopened.`,
        ephemeral: true
      });
    }

    if (
      sub === "reply"
    ) {
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
        await client.users
          .fetch(ticket.userId)
          .catch(() => null);

      if (!user) {
        return interaction.reply({
          content:
            "❌ User could not be found.",
          ephemeral: true
        });
      }

      try {
        await user.send({
          embeds: [
            makeEmbed(
              `💬 Support Reply — ${id}`,
              message,
              0x57f287
            )
          ]
        });

        ticket.claimedBy =
          interaction.user.id;

        saveDatabase();

        return interaction.reply({
          content:
            `📩 Reply sent to ${user.tag}.`,
          ephemeral: true
        });
      } catch {
        return interaction.reply({
          content:
            "❌ Could not DM the user.",
          ephemeral: true
        });
      }
    }

    if (
      sub === "info"
    ) {
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
          makeEmbed(
            `🎫 Ticket ${id}`,
            [
              `User: <@${ticket.userId}>`,
              `Channel: ${ticket.channelId ? `<#${ticket.channelId}>` : "None"}`,
              `Status: ${ticket.status}`,
              `Claimed By: ${ticket.claimedBy ? `<@${ticket.claimedBy}>` : "Unclaimed"}`,
              `Created: <t:${Math.floor(ticket.createdAt / 1000)}:F>`,
              ticket.closedAt
                ? `Closed: <t:${Math.floor(ticket.closedAt / 1000)}:F>`
                : ""
            ].filter(Boolean).join("\n"),
            0x5865f2
          )
        ],
        ephemeral: true
      });
    }

    if (
      sub === "transcript"
    ) {
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

      const transcript =
        await createTranscript(
          interaction.guild,
          ticket
        );

      if (!transcript) {
        return interaction.reply({
          content:
            "❌ Could not create transcript.",
          ephemeral: true
        });
      }

      const buffer =
        Buffer.from(
          transcript,
          "utf8"
        );

      const attachment =
        new AttachmentBuilder(
          buffer,
          {
            name:
              `${id}-transcript.txt`
          }
        );

      return interaction.reply({
        content:
          `📄 Transcript for **${id}**`,
        files: [attachment],
        ephemeral: true
      });
    }
  }

  /* =======================================================
     AUTOTIMEOUT
  ======================================================= */

  if (name === "autotimeout") {
    const sub =
      interaction.options.getSubcommand();

    if (sub === "enable")
      data.autotimeout.enabled = true;

    if (sub === "disable")
      data.autotimeout.enabled = false;

    if (sub === "duration") {
      data.autotimeout.duration =
        interaction.options.getInteger(
          "minutes",
          true
        ) * 60000;
    }

    saveDatabase();

    if (sub === "status") {
      return interaction.reply({
        embeds: [
          makeEmbed(
            "⏱️ AutoTimeout",
            [
              `Enabled: ${data.autotimeout.enabled ? "🟢" : "🔴"}`,
              `Duration: ${Math.round(
                data.autotimeout.duration / 60000
              )} minutes`,
              `Triggers: spam, mass mentions, blocked links, bad words, caps and repeated messages`
            ].join("\n"),
            0x5865f2
          )
        ],
        ephemeral: true
      });
    }

    return interaction.reply({
      content:
        "✅ AutoTimeout configuration updated.",
      ephemeral: true
    });
  }

  /* =======================================================
     SUGGESTION
  ======================================================= */

  if (name === "suggest") {
    return createSuggestion(
      interaction
    );
  }

  /* =======================================================
     ANNOUNCEMENT
  ======================================================= */

  if (name === "announce") {
    return sendAnnouncement(
      interaction
    );
  }

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
          data.announcements.channels.push(
            channel.id
          );
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
            : "No announcement channels configured.",
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
          data.announcements.roles.push(
            role.id
          );
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
            : "No announcement roles configured.",
        ephemeral: true
      });
    }

    saveDatabase();

    return interaction.reply({
      content:
        "✅ Announcement configuration updated.",
      ephemeral: true
    });
  }

  /* =======================================================
     TRUSTED
  ======================================================= */

  if (
    name === "trusted"
  ) {
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
          data.trusted.users.push(
            user.id
          );
        }
      } else {
        data.trusted.users =
          data.trusted.users
            .filter(
              id =>
                id !== user.id
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
          data.trusted.bots.push(
            bot.id
          );
        }
      } else {
        data.trusted.bots =
          data.trusted.bots
            .filter(
              id =>
                id !== bot.id
            );
      }
    }

    if (
      sub === "list"
    ) {
      return interaction.reply({
        embeds: [
          makeEmbed(
            "🔐 Trusted Security List",
            [
              "**Trusted Users**",
              data.trusted.users.length
                ? data.trusted.users
                    .map(id => `<@${id}>`)
                    .join("\n")
                : "None",
              "",
              "**Trusted Bots**",
              data.trusted.bots.length
                ? data.trusted.bots
                    .map(id => `<@${id}>`)
                    .join("\n")
                : "None"
            ].join("\n"),
            0x57f287
          )
        ],
        ephemeral: true
      });
    }

    saveDatabase();

    return interaction.reply({
      content:
        "✅ Trusted list updated.",
      ephemeral: true
    });
  }

  /* =======================================================
     CONFIG
  ======================================================= */

  if (
    name === "config"
  ) {
    const sub =
      interaction.options.getSubcommand();

    if (
      sub === "status"
    ) {
      return interaction.reply({
        embeds: [
          makeEmbed(
            "⚙️ Complete Bot Configuration",
            [
              `AutoMod: ${data.automod.enabled ? "🟢" : "🔴"}`,
              `Security: ${data.security.enabled ? "🟢" : "🔴"}`,
              `Anti-Raid: ${data.security.antiRaid ? "🟢" : "🔴"}`,
              `Anti-Nuke: ${data.security.antiNuke ? "🟢" : "🔴"}`,
              `Role Protector: ${data.roleProtection.enabled ? "🟢" : "🔴"}`,
              `@everyone Protected: ${data.roleProtection.protectEveryone ? "🟢" : "🔴"}`,
              `AutoTimeout: ${data.autotimeout.enabled ? "🟢" : "🔴"}`,
              `Tickets: 🟢`,
              `Suggestions: 🟢`,
              `Trusted Users: ${data.trusted.users.length}`,
              `Trusted Bots: ${data.trusted.bots.length}`,
              `Warnings Stored: ${Object.keys(data.warnings).length}`,
              `Tickets Created: ${data.statistics.tickets}`,
              `Security Events: ${data.statistics.securityEvents}`
            ].join("\n"),
            0x5865f2
          )
        ],
        ephemeral: true
      });
    }

    if (
      sub === "reset"
    ) {
      database.guilds[
        interaction.guild.id
      ] =
        createDefaultGuildData();

      saveDatabase();

      return interaction.reply({
        content:
          "⚠️ Server configuration has been reset.",
        ephemeral: true
      });
    }

    if (
      sub === "set"
    ) {
      const system =
        interaction.options.getString(
          "system",
          true
        ).toLowerCase();

      const key =
        interaction.options.getString(
          "key",
          true
        );

      const value =
        interaction.options.getString(
          "value",
          true
        );

      const allowedSystems = [
        "automod",
        "security",
        "roleprotection",
        "autotimeout",
        "tickets",
        "suggestions",
        "announcements"
      ];

      if (
        !allowedSystems.includes(
          system
        )
      ) {
        return interaction.reply({
          content:
            "❌ Invalid system.",
          ephemeral: true
        });
      }

      let target =
        system ===
        "roleprotection"
          ? data.roleProtection
          : data[system];

      if (
        !target ||
        !(key in target)
      ) {
        return interaction.reply({
          content:
            "❌ Invalid configuration key.",
          ephemeral: true
        });
      }

      const old =
        target[key];

      if (
        typeof old ===
        "boolean"
      ) {
        target[key] =
          value.toLowerCase() ===
          "true";
      } else if (
        typeof old ===
        "number"
      ) {
        const number =
          Number(value);

        if (
          !Number.isFinite(
            number
          )
        ) {
          return interaction.reply({
            content:
              "❌ Value must be a number.",
            ephemeral: true
          });
        }

        target[key] =
          number;
      } else {
        target[key] =
          value;
      }

      saveDatabase();

      return interaction.reply({
        content:
          `✅ \`${system}.${key}\` updated.`,
        ephemeral: true
      });
    }
  }

  /* =======================================================
     LOG CONFIG
  ======================================================= */

  if (
    name === "logs"
  ) {
    const sub =
      interaction.options.getSubcommand();

    if (
      sub === "status"
    ) {
      const output =
        Object.entries(
          data.logs
        )
        .map(
          ([key, id]) =>
            `**${key}:** ${
              id
                ? `<#${id}>`
                : "Not configured"
            }`
        )
        .join("\n");

      return interaction.reply({
        embeds: [
          makeEmbed(
            "📋 Log Configuration",
            output,
            0x5865f2
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

    if (
      sub in data.logs
    ) {
      data.logs[sub] =
        channel.id;
    }

    saveDatabase();

    return interaction.reply({
      content:
        `✅ ${sub} log channel set to ${channel}.`,
      ephemeral: true
    });
  }

  /* =======================================================
     STATS
  ======================================================= */

  if (
    name === "stats"
  ) {
    return interaction.reply({
      embeds: [
        makeEmbed(
          "📊 Bot Statistics",
          [
            `Servers: ${client.guilds.cache.size}`,
            `Users cached: ${client.users.cache.size}`,
            `Tickets: ${data.statistics.tickets}`,
            `Warnings: ${data.statistics.warnings}`,
            `Punishments: ${data.statistics.punishments}`,
            `Security Events: ${data.statistics.securityEvents}`,
            `AutoMod Actions: ${data.statistics.automod}`
          ].join("\n"),
          0x5865f2
        )
      ]
    });
  }
}

/* =========================================================
   INTERACTION CREATE
========================================================= */

client.on(
  Events.InteractionCreate,
  async interaction => {

    try {

      if (
        interaction.isChatInputCommand()
      ) {
        await executeCommand(
          interaction
        );

        return;
      }

      if (
        interaction.isButton()
      ) {

        if (
          interaction.customId ===
          "create_dm_ticket"
        ) {
          const result =
            await createDMTicket(
              interaction.user
            );

          if (
            result.existing
          ) {
            return interaction.reply({
              content:
                `🎫 You already have an open ticket: **${result.ticket.id}**`,
              ephemeral: true
            });
          }

          return interaction.reply({
            content:
              `🎫 Your ticket **${result.ticket.id}** has been created. Please check your DMs.`,
            ephemeral: true
          });
        }

        if (
          interaction.customId.startsWith(
            "ticket_"
          )
        ) {
          await handleTicketButton(
            interaction
          );

          return;
        }

        if (
          interaction.customId.startsWith(
            "suggest_approve:"
          )
        ) {
          await reviewSuggestion(
            interaction,
            true
          );

          return;
        }

        if (
          interaction.customId.startsWith(
            "suggest_decline:"
          )
        ) {
          await reviewSuggestion(
            interaction,
            false
          );

          return;
        }
      }

    } catch (error) {

      console.error(
        "Interaction error:",
        error
      );

      if (
        interaction.replied ||
        interaction.deferred
      ) {
        await interaction.followUp({
          content:
            "❌ An unexpected error occurred.",
          ephemeral: true
        }).catch(() => {});
      } else {
        await interaction.reply({
          content:
            "❌ An unexpected error occurred.",
          ephemeral: true
        }).catch(() => {});
      }
    }
  }
);

/* =========================================================
   MESSAGE CREATE
========================================================= */

client.on(
  Events.MessageCreate,
  async message => {

    try {

      /* DM TICKETS */

      if (
        !message.guild
      ) {

        if (
          message.author.bot
        ) {
          return;
        }

        const guild =
          await client.guilds
            .fetch(SERVER_ID)
            .catch(() => null);

        if (!guild) {
          return;
        }

        const existing =
          getOpenTicketForUser(
            guild,
            message.author.id
          );

        if (!existing) {

          await createDMTicket(
            message.author
          );

        }

        await forwardDMToTicket(
          message
        );

        return;
      }

      /* AUTOMOD */

      await handleMessageAutoMod(
        message
      );

    } catch (error) {
      console.error(
        "Message handler error:",
        error
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

    try {
      await handleMemberJoin(
        member
      );
    } catch (error) {
      console.error(
        "Member join error:",
        error
      );
    }
  }
);

/* =========================================================
   ROLE UPDATE
========================================================= */

client.on(
  Events.GuildRoleUpdate,
  async (
    oldRole,
    newRole
  ) => {

    try {
      await handleRoleUpdate(
        oldRole,
        newRole
      );
    } catch (error) {
      console.error(
        "Role update error:",
        error
      );
    }
  }
);

/* =========================================================
   ROLE DELETE
========================================================= */

client.on(
  Events.GuildRoleDelete,
  async role => {

    try {
      await handleRoleDelete(
        role
      );
    } catch (error) {
      console.error(
        "Role delete error:",
        error
      );
    }
  }
);

/* =========================================================
   CHANNEL DELETE
========================================================= */

client.on(
  Events.ChannelDelete,
  async channel => {

    try {
      await handleChannelDelete(
        channel
      );
    } catch (error) {
      console.error(
        "Channel delete error:",
        error
      );
    }
  }
);

/* =========================================================
   MEMBER UPDATE LOGGING
========================================================= */

client.on(
  Events.GuildMemberUpdate,
  async (
    oldMember,
    newMember
  ) => {

    try {

      if (
        oldMember.roles.cache.size !==
        newMember.roles.cache.size
      ) {

        await sendLog(
          newMember.guild,
          "roles",
          "👤 Member Roles Updated",
          [
            `**Member:** ${newMember}`,
            `**Member ID:** ${newMember.id}`,
            `**Before:** ${oldMember.roles.cache.size - 1}`,
            `**After:** ${newMember.roles.cache.size - 1}`
          ].join("\n")
        );
      }

    } catch (error) {
      console.error(
        "Member update error:",
        error
      );
    }
  }
);

/* =========================================================
   MESSAGE DELETE LOG
========================================================= */

client.on(
  Events.MessageDelete,
  async message => {

    try {

      if (
        !message.guild ||
        message.author?.bot
      ) {
        return;
      }

      await sendLog(
        message.guild,
        "messages",
        "🗑️ Message Deleted",
        [
          `**Author:** ${message.author || "Unknown"}`,
          `**Channel:** ${message.channel}`,
          `**Content:** ${shorten(
            message.content || "Unknown",
            1000
          )}`
        ].join("\n")
      );

    } catch (error) {
      console.error(
        "Message delete error:",
        error
      );
    }
  }
);

/* =========================================================
   MESSAGE BULK DELETE LOG
========================================================= */

client.on(
  Events.MessageBulkDelete,
  async messages => {

    try {

      const first =
        messages.first();

      if (!first?.guild) {
        return;
      }

      await sendLog(
        first.guild,
        "messages",
        "🧹 Bulk Messages Deleted",
        [
          `**Channel:** ${first.channel}`,
          `**Messages:** ${messages.size}`
        ].join("\n"),
        0xed4245
      );

    } catch (error) {
      console.error(
        "Bulk delete error:",
        error
      );
    }
  }
);

/* =========================================================
   GUILD MEMBER REMOVE
========================================================= */

client.on(
  Events.GuildMemberRemove,
  async member => {

    try {

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

    } catch (error) {
      console.error(
        "Member remove error:",
        error
      );
    }
  }
);

/* =========================================================
   GUILD BAN ADD
========================================================= */

client.on(
  Events.GuildBanAdd,
  async ban => {

    try {

      await sendLog(
        ban.guild,
        "moderation",
        "🔨 Member Banned",
        [
          `**User:** ${ban.user.tag}`,
          `**ID:** ${ban.user.id}`
        ].join("\n"),
        0xed4245
      );

    } catch (error) {
      console.error(
        "Ban log error:",
        error
      );
    }
  }
);

/* =========================================================
   GUILD BAN REMOVE
========================================================= */

client.on(
  Events.GuildBanRemove,
  async ban => {

    try {

      await sendLog(
        ban.guild,
        "moderation",
        "🔓 Member Unbanned",
        [
          `**User:** ${ban.user.tag}`,
          `**ID:** ${ban.user.id}`
        ].join("\n"),
        0x57f287
      );

    } catch (error) {
      console.error(
        "Unban log error:",
        error
      );
    }
  }
);

/* =========================================================
   ERROR HANDLERS
========================================================= */

client.on(
  Events.Error,
  error => {
    console.error(
      "Discord client error:",
      error
    );
  }
);

client.on(
  Events.Warn,
  warning => {
    console.warn(
      "Discord warning:",
      warning
    );
  }
);

/* =========================================================
   READY + COMMAND REGISTRATION
========================================================= */

client.once(
  Events.ClientReady,
  async ready => {

    console.log(
      `✅ Logged in as ${ready.user.tag}`
    );

    console.log(
      `🌐 Servers: ${ready.guilds.cache.size}`
    );

    console.log(
      "🛡️ Advanced AutoMod: ONLINE"
    );

    console.log(
      "🔐 Security System: ONLINE"
    );

    console.log(
      "🎫 DM Ticket System: ONLINE"
    );

    console.log(
      "🛡️ Role Protector: ONLINE"
    );

    console.log(
      "⏱️ AutoTimeout: ONLINE"
    );

    console.log(
      "📢 Announcement System: ONLINE"
    );

    console.log(
      "📋 Logging System: ONLINE"
    );

    try {

      const guild =
        await client.guilds.fetch(
          SERVER_ID
        );

      /*
        Guild command registration makes commands
        appear quickly in your configured server.
      */

      await guild.commands.set(
        commands.map(
          command =>
            command.toJSON()
        )
      );

      console.log(
        `✅ ${commands.length} slash commands registered in ${guild.name}`
      );

    } catch (error) {

      console.error(
        "❌ Slash command registration failed:",
        error
      );
    }

    client.user.setPresence({
      activities: [
        {
          name:
            "🛡️ Protecting the server",
          type:
            ActivityType.Watching
        }
      ],
      status: "online"
    });
  }
);

/* =========================================================
   FINAL DATABASE SAVE
========================================================= */

setInterval(
  () => {
    try {
      saveDatabase();
    } catch (error) {
      console.error(
        "Database autosave error:",
        error
      );
    }
  },
  30000
);

/* =========================================================
   FINAL LOGIN
========================================================= */

if (!DISCORD_TOKEN) {
  console.error(
    "❌ DISCORD_TOKEN is missing."
  );

  process.exit(1);
}

client.login(
  DISCORD_TOKEN
).catch(error => {

  console.error(
    "❌ Discord login failed:",
    error
  );

  process.exit(1);
});
