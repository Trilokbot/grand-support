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
} = require('discord.js');

const fs = require('fs');
const path = require('path');
const http = require('http');

// ============================================================
// AkiyO - All-in-one Discord Support, Moderation & Security Bot
// Node.js 24.x / discord.js 14.27.0
// ============================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || '1542750606739898428';

const OWNER_IDS = new Set(
  (process.env.BOT_OWNER_IDS || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
);

const OPENAI_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.5';

const PORT = Number(process.env.PORT) || 10000;

if (!TOKEN) {
  console.error('ERROR: DISCORD_TOKEN is missing.');
  process.exit(1);
}

// ============================================================
// DATABASE
// ============================================================

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'config.json');

fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULT_GUILD = {
  staffRoleId: null,
  ticketCategoryId: null,
  ticketPanelChannelId: null,
  suggestionChannelId: null,

  autoroleId: null,

  welcome: {
    enabled: false,
    channelId: null,
    message: 'Welcome {user} to {server}! You are member #{count}.'
  },

  verification: {
    enabled: false,
    channelId: null,
    roleId: null
  },

  logs: {
    automod: null,
    audit: null,
    security: null,
    suggestion: null,
    moderation: null,
    members: null,
    messages: null,
    channels: null,
    roles: null,
    tickets: null,
    verification: null,
    reactionRoles: null,
    welcome: null,
    leaderboard: null,
    announcements: null,
    config: null
  },

  automod: {
    enabled: false,
    badWords: [],
    caps: true,
    repeated: true,
    invites: true,
    massMentions: true,
    spam: true,
    spamLimit: 6,
    spamWindow: 7000,
    repeatedLimit: 3,
    action: 'timeout',
    timeoutSeconds: 60,
    ignoredRoleIds: [],
    ignoredChannelIds: []
  },

  security: {
    enabled: false,
    action: 'kick',
    raidEnabled: true,
    raidLimit: 8,
    raidWindow: 10000,
    massActionLimit: 4,
    massActionWindow: 10000,
    trustedUserIds: [],
    trustedBotIds: [],
    trustedRoleIds: [],
    protectedRoleIds: [],
    protectedChannelIds: [],
    logEnabled: true
  },

  ticket: {
    enabled: true,
    counter: 0,
    maxOpenPerUser: 1
  },

  suggestions: {
    enabled: true
  },

  leaderboard: {
    enabled: false,
    channelId: null,
    messageId: null,
    counts: {}
  },

  ads: {
    enabled: false,
    message: '',
    intervalMinutes: 60,
    channelIds: []
  },

  reactionRoles: [],

  warnings: {},

  punishments: [],

  tickets: {},

  suggestionsData: {},

  audit: {
    enabled: true
  }
};

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function deepMerge(base, extra) {
  if (
    !extra ||
    typeof extra !== 'object' ||
    Array.isArray(extra)
  ) {
    return clone(base);
  }

  const out = clone(base);

  for (const [key, value] of Object.entries(extra)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      out[key] &&
      typeof out[key] === 'object' &&
      !Array.isArray(out[key])
    ) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }

  return out;
}

let db = {};

try {
  db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} catch {
  db = {};
}

function gc(guildId) {
  if (!db[guildId]) {
    db[guildId] = clone(DEFAULT_GUILD);
  } else {
    db[guildId] = deepMerge(DEFAULT_GUILD, db[guildId]);
  }

  return db[guildId];
}

function save() {
  const tmp = `${DB_FILE}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(db, null, 2)
  );

  fs.renameSync(tmp, DB_FILE);
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

// ============================================================
// PERMISSIONS / HELPERS
// ============================================================

function isOwner(userId) {
  return OWNER_IDS.has(userId);
}

function isManager(member) {
  return !!member && (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    member.permissions.has(PermissionFlagsBits.ManageGuild)
  );
}

function isStaff(member, cfg) {
  return !!member && (
    member.permissions.has(PermissionFlagsBits.Administrator) ||
    isManager(member) ||
    (
      cfg.staffRoleId &&
      member.roles.cache.has(cfg.staffRoleId)
    )
  );
}

function hasHigherRole(actor, target) {
  if (!actor || !target || !actor.guild) {
    return false;
  }

  if (actor.id === actor.guild.ownerId) {
    return true;
  }

  return actor.roles.highest.position >
    target.roles.highest.position;
}

function botCanAct(guild, target) {
  const me = guild.members.me;

  return !!me &&
    !!target &&
    me.id !== target.id &&
    me.roles.highest.position >
      target.roles.highest.position;
}

function trusted(member, cfg) {
  if (!member) {
    return false;
  }

  if (
    cfg.security.trustedUserIds.includes(member.id)
  ) {
    return true;
  }

  if (
    member.roles?.cache?.some(role =>
      cfg.security.trustedRoleIds.includes(role.id)
    )
  ) {
    return true;
  }

  if (
    member.user?.bot &&
    cfg.security.trustedBotIds.includes(member.id)
  ) {
    return true;
  }

  return false;
}

function logChannel(guild, type) {
  const cfg = gc(guild.id);
  const id = cfg.logs[type];

  return id
    ? guild.channels.cache.get(id)
    : null;
}

async function sendLog(
  guild,
  type,
  text,
  color = null
) {
  try {
    const channel = logChannel(guild, type);

    if (
      !channel ||
      !channel.isTextBased()
    ) {
      return;
    }

    const embed = new EmbedBuilder()
      .setDescription(String(text).slice(0, 4000))
      .setTimestamp();

    if (color) {
      embed.setColor(color);
    }

    await channel.send({
      embeds: [embed]
    });
  } catch (error) {
    console.error(
      'sendLog:',
      error.message
    );
  }
}

function fmtUser(id) {
  return id
    ? `<@${id}>`
    : 'Unknown';
}

function truncate(value, length = 1000) {
  return String(value ?? '')
    .slice(0, length);
}

function roleMention(id) {
  return id
    ? `<@&${id}>`
    : 'Not set';
}

function channelMention(id) {
  return id
    ? `<#${id}>`
    : 'Not set';
}

function safeName(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 80) || 'ticket';
}

function parseDuration(input) {
  const match = String(input || '')
    .trim()
    .match(/^(\d+)\s*(s|m|h|d)$/i);

  if (!match) {
    return null;
  }

  const multiplier = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400
  }[match[2].toLowerCase()];

  const seconds =
    Number(match[1]) * multiplier;

  if (
    !Number.isFinite(seconds) ||
    seconds < 1 ||
    seconds > 2419200
  ) {
    return null;
  }

  return seconds;
}

function humanDuration(seconds) {
  if (seconds % 86400 === 0) {
    return `${seconds / 86400}d`;
  }

  if (seconds % 3600 === 0) {
    return `${seconds / 3600}h`;
  }

  if (seconds % 60 === 0) {
    return `${seconds / 60}m`;
  }

  return `${seconds}s`;
}

function ticketForChannel(cfg, channelId) {
  return Object.values(cfg.tickets)
    .find(ticket =>
      ticket.channelId === channelId &&
      ticket.status !== 'deleted'
    ) || null;
}

function activeTicketForUser(cfg, userId) {
  return Object.values(cfg.tickets)
    .find(ticket =>
      ticket.ownerId === userId &&
      ticket.status !== 'deleted'
    ) || null;
}

// ============================================================
// MODERATION
// ============================================================

async function punish(
  member,
  type,
  reason,
  issuer
) {
  const guild = member.guild;

  if (!botCanAct(guild, member)) {
    return {
      ok: false,
      message:
        'I cannot act on that member because of role hierarchy.'
    };
  }

  if (
    issuer &&
    !hasHigherRole(issuer, member) &&
    issuer.id !== guild.ownerId
  ) {
    return {
      ok: false,
      message:
        'You cannot moderate a member with an equal or higher role.'
    };
  }

  try {
    if (type === 'timeout') {
      await member.timeout(
        Math.min(
          2419200,
          Number(reason.seconds)
        ) * 1000,
        reason.text
      );
    }

    if (type === 'kick') {
      await member.kick(reason.text);
    }

    if (type === 'ban') {
      await member.ban({
        reason: reason.text,
        deleteMessageSeconds: 86400
      });
    }

    const cfg = gc(guild.id);

    cfg.punishments.push({
      id:
        `${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 7)}`,

      guildId: guild.id,
      userId: member.id,
      moderatorId:
        issuer?.id || client.user.id,

      type,
      reason: reason.text || '',
      at: Date.now()
    });

    save();

    await sendLog(
      guild,
      'moderation',
      `**${type.toUpperCase()}** ${fmtUser(member.id)}
by ${fmtUser(issuer?.id || client.user.id)}
Reason: ${truncate(reason.text || 'No reason')}`
    );

    return {
      ok: true,
      message: `${type} completed.`
    };
  } catch (error) {
    return {
      ok: false,
      message:
        `Action failed: ${error.message}`
    };
  }
}

async function addWarning(
  guild,
  userId,
  moderatorId,
  reason
) {
  const cfg = gc(guild.id);

  if (!cfg.warnings[userId]) {
    cfg.warnings[userId] = [];
  }

  const warning = {
    id:
      `${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)}`,

    moderatorId,
    reason: reason || 'No reason',
    at: Date.now()
  };

  cfg.warnings[userId].push(warning);

  save();

  const count =
    cfg.warnings[userId].length;

  let escalation =
    'No automatic escalation.';

  const member =
    await guild.members
      .fetch(userId)
      .catch(() => null);

  if (
    member &&
    botCanAct(guild, member)
  ) {
    try {
      if (count >= 7) {
        await member.ban({
          reason:
            `Warning escalation: ${count} warnings`,
          deleteMessageSeconds: 86400
        });

        escalation =
          '7+ warnings → banned.';
      } else if (count >= 5) {
        await member.kick(
          `Warning escalation: ${count} warnings`
        );

        escalation =
          '5 warnings → kicked.';
      } else if (count >= 3) {
        await member.timeout(
          10 * 60 * 1000,
          `Warning escalation: ${count} warnings`
        );

        escalation =
          '3 warnings → 10 minute timeout.';
      }
    } catch (error) {
      escalation =
        `Escalation failed: ${error.message}`;
    }
  }

  await sendLog(
    guild,
    'moderation',
    `**WARN** ${fmtUser(userId)}
by ${fmtUser(moderatorId)}
Reason: ${truncate(reason || 'No reason')}
Warnings: **${count}**
${escalation}`
  );

  return {
    warning,
    count,
    escalation
  };
}

// ============================================================
// HELP
// ============================================================

function commandHelp() {
  return [
    '**AkiyO Commands**',

    '🎫 `/ticket`, `/ticketpanel`, `/ticketsetup`, `/close`, `/reopen`, `/delete`, `/claim`, `/unclaim`, `/lock`, `/unlock`, `/ticketadd`, `/ticketremove`, `/ticketrename`, `/ticketinfo`, `/ticketstats`, `/transcript`',

    '🤖 `/automod` — enable / disable / status / config / badword / removebadword',

    '🛡️ `/security` — enable / disable / status / action / raid / log / trusted / protected controls',

    '⚠️ `/warn`, `/timeout`, `/kick`, `/ban`, `/unban`, `/warnings`, `/punishments`',

    '💡 `/suggest` — create / list',

    '📢 `/announce`',

    '👋 `/welcome`',

    '🔐 `/verification`',

    '🎭 `/autorole`',

    '🎨 `/autoreactionrole`',

    '🏆 `/leaderboard`',

    '📣 `/ads`',

    '⚙️ `/config`',

    '🤖 `/ai ask`, `/ai reset`',

    'ℹ️ `/help`, `/botinfo`'
  ].join('\n');
}

// ============================================================
// SLASH COMMANDS
// ============================================================

const commands = [];

function addCommand(command) {
  commands.push(
    command.setDMPermission(false)
  );
}

addCommand(
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all AkiyO commands')
);

addCommand(
  new SlashCommandBuilder()
    .setName('botinfo')
    .setDescription('Show bot information')
);

addCommand(
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Create a support ticket')
    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Ticket reason')
        .setRequired(false)
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName('ticketpanel')
    .setDescription('Send a ticket panel here')
);

addCommand(
  new SlashCommandBuilder()
    .setName('ticketsetup')
    .setDescription('Configure ticket system')

    .addChannelOption(option =>
      option
        .setName('category')
        .setDescription('Ticket category')
        .addChannelTypes(
          ChannelType.GuildCategory
        )
        .setRequired(false)
    )

    .addRoleOption(option =>
      option
        .setName('staffrole')
        .setDescription('Staff role')
        .setRequired(false)
    )

    .addChannelOption(option =>
      option
        .setName('logchannel')
        .setDescription('Ticket log channel')
        .addChannelTypes(
          ChannelType.GuildText
        )
        .setRequired(false)
    )

    .addChannelOption(option =>
      option
        .setName('panelchannel')
        .setDescription('Default panel channel')
        .addChannelTypes(
          ChannelType.GuildText
        )
        .setRequired(false)
    )
);

for (
  const [name, description] of [
    ['close', 'Close the current ticket'],
    ['reopen', 'Reopen the current ticket'],
    ['delete', 'Delete the current ticket'],
    ['claim', 'Claim the current ticket'],
    ['unclaim', 'Unclaim the current ticket'],
    ['lock', 'Lock the current ticket'],
    ['unlock', 'Unlock the current ticket'],
    ['transcript', 'Create a ticket transcript'],
    ['ticketstats', 'Show ticket statistics']
  ]
) {
  addCommand(
    new SlashCommandBuilder()
      .setName(name)
      .setDescription(description)
  );
}

addCommand(
  new SlashCommandBuilder()
    .setName('ticketadd')
    .setDescription('Add a member to the current ticket')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User')
        .setRequired(true)
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName('ticketremove')
    .setDescription('Remove a member from the current ticket')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('User')
        .setRequired(true)
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName('ticketrename')
    .setDescription('Rename current ticket')
    .addStringOption(option =>
      option
        .setName('name')
        .setDescription('New name')
        .setRequired(true)
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName('ticketinfo')
    .setDescription('Show current ticket information')
);

// ============================================================
// AUTOMOD COMMAND
// ============================================================

addCommand(
  new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Configure AutoMod')

    .addSubcommand(sub =>
      sub
        .setName('enable')
        .setDescription('Enable AutoMod')
    )

    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('Disable AutoMod')
    )

    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Show AutoMod status')
    )

    .addSubcommand(sub =>
      sub
        .setName('config')
        .setDescription('Configure AutoMod')

        .addIntegerOption(option =>
          option
            .setName('spamlimit')
            .setDescription('Messages in spam window')
            .setMinValue(2)
            .setMaxValue(20)
        )

        .addIntegerOption(option =>
          option
            .setName('window')
            .setDescription('Spam window milliseconds')
            .setMinValue(1000)
            .setMaxValue(60000)
        )

        .addStringOption(option =>
          option
            .setName('action')
            .setDescription('Action')
            .addChoices(
              {
                name: 'delete',
                value: 'delete'
              },
              {
                name: 'timeout',
                value: 'timeout'
              },
              {
                name: 'warn',
                value: 'warn'
              }
            )
        )

        .addIntegerOption(option =>
          option
            .setName('timeout')
            .setDescription('Timeout seconds')
            .setMinValue(1)
            .setMaxValue(2419200)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('badword')
        .setDescription('Add a bad word')
        .addStringOption(option =>
          option
            .setName('word')
            .setDescription('Word')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('removebadword')
        .setDescription('Remove a bad word')
        .addStringOption(option =>
          option
            .setName('word')
            .setDescription('Word')
            .setRequired(true)
        )
    )
);

// ============================================================
// SECURITY COMMAND
// ============================================================

addCommand(
  new SlashCommandBuilder()
    .setName('security')
    .setDescription('Configure server security')

    .addSubcommand(sub =>
      sub
        .setName('enable')
        .setDescription('Enable security')
    )

    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('Disable security')
    )

    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Show security status')
    )

    .addSubcommand(sub =>
      sub
        .setName('action')
        .setDescription('Set security action')
        .addStringOption(option =>
          option
            .setName('action')
            .setDescription('Action')
            .setRequired(true)
            .addChoices(
              {
                name: 'kick',
                value: 'kick'
              },
              {
                name: 'ban',
                value: 'ban'
              },
              {
                name: 'log',
                value: 'log'
              }
            )
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('raid')
        .setDescription('Configure anti-raid')

        .addBooleanOption(option =>
          option
            .setName('enabled')
            .setDescription('Enabled')
            .setRequired(true)
        )

        .addIntegerOption(option =>
          option
            .setName('limit')
            .setDescription('Join limit')
            .setMinValue(2)
            .setMaxValue(100)
        )

        .addIntegerOption(option =>
          option
            .setName('window')
            .setDescription('Window milliseconds')
            .setMinValue(1000)
            .setMaxValue(120000)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('log')
        .setDescription('Set security log channel')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Log channel')
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('trusted')
        .setDescription('Trust a user')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('User')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('untrusted')
        .setDescription('Untrust a user')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('User')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('trustedrole')
        .setDescription('Trust a role')
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('Role')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('untrustedrole')
        .setDescription('Untrust a role')
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('Role')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('trustedmember')
        .setDescription('Trust a member')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('Member')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('untrustedmember')
        .setDescription('Untrust a member')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('Member')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('trustedbot')
        .setDescription('Trust a bot')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('Bot')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('untrustedbot')
        .setDescription('Untrust a bot')
        .addUserOption(option =>
          option
            .setName('user')
            .setDescription('Bot')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('protectedrole')
        .setDescription('Protect a role')
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('Role')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('unprotectedrole')
        .setDescription('Unprotect a role')
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('Role')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('protectedchannel')
        .setDescription('Protect a channel')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Channel')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('unprotectedchannel')
        .setDescription('Unprotect a channel')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Channel')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('List trusted and protected items')
    )
);

// ============================================================
// CONFIG
// ============================================================

addCommand(
  new SlashCommandBuilder()
    .setName('config')
    .setDescription('Configure AkiyO')

    .addSubcommand(sub =>
      sub
        .setName('view')
        .setDescription('View configuration')
    )

    .addSubcommand(sub =>
      sub
        .setName('log')
        .setDescription('Set a log channel')

        .addStringOption(option =>
          option
            .setName('type')
            .setDescription('Log type')
            .setRequired(true)
            .addChoices(
              ...Object.keys(
                DEFAULT_GUILD.logs
              ).map(type => ({
                name: type,
                value: type
              }))
            )
        )

        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Channel')
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('staffrole')
        .setDescription('Set staff role')
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('Role')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('ticketcategory')
        .setDescription('Set ticket category')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Category')
            .addChannelTypes(
              ChannelType.GuildCategory
            )
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('suggestions')
        .setDescription('Set suggestion channel')
        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Channel')
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('timeout')
        .setDescription('Set AutoMod timeout')
        .addIntegerOption(option =>
          option
            .setName('seconds')
            .setDescription('Seconds')
            .setMinValue(1)
            .setMaxValue(2419200)
            .setRequired(true)
        )
    )
);

// ============================================================
// MODERATION
// ============================================================

addCommand(
  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a member')

    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Member')
        .setRequired(true)
    )

    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason')
        .setRequired(false)
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout a member')

    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Member')
        .setRequired(true)
    )

    .addStringOption(option =>
      option
        .setName('duration')
        .setDescription('30s, 10m, 2h, 1d')
        .setRequired(true)
    )

    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason')
        .setRequired(false)
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member')

    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Member')
        .setRequired(true)
    )

    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason')
        .setRequired(false)
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member')

    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Member')
        .setRequired(true)
    )

    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason')
        .setRequired(false)
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user')

    .addStringOption(option =>
      option
        .setName('user')
        .setDescription('User ID')
        .setRequired(true)
    )

    .addStringOption(option =>
      option
        .setName('reason')
        .setDescription('Reason')
        .setRequired(false)
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('View member warnings')

    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Member')
        .setRequired(true)
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName('punishments')
    .setDescription('View punishment history')

    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Member')
        .setRequired(true)
    )
);

// ============================================================
// SUGGESTIONS
// ============================================================

addCommand(
  new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Suggestions')

    .addSubcommand(sub =>
      sub
        .setName('create')
        .setDescription('Create a suggestion')
        .addStringOption(option =>
          option
            .setName('text')
            .setDescription('Suggestion')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('List recent suggestions')
    )
);

// ============================================================
// ANNOUNCEMENT
// ============================================================

addCommand(
  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Send an announcement')

    .addChannelOption(option =>
      option
        .setName('channel')
        .setDescription('Target channel')
        .addChannelTypes(
          ChannelType.GuildText
        )
        .setRequired(true)
    )

    .addStringOption(option =>
      option
        .setName('message')
        .setDescription('Message')
        .setRequired(true)
    )

    .addStringOption(option =>
      option
        .setName('title')
        .setDescription('Embed title')
        .setRequired(false)
    )

    .addStringOption(option =>
      option
        .setName('footer')
        .setDescription('Footer')
        .setRequired(false)
    )

    .addBooleanOption(option =>
      option
        .setName('embed')
        .setDescription('Use embed')
        .setRequired(false)
    )

    .addBooleanOption(option =>
      option
        .setName('everyone')
        .setDescription('Mention everyone')
        .setRequired(false)
    )

    .addRoleOption(option =>
      option
        .setName('role')
        .setDescription('Mention role')
        .setRequired(false)
    )

    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('Mention user')
        .setRequired(false)
    )
);

// ============================================================
// AUTOROLE
// ============================================================

addCommand(
  new SlashCommandBuilder()
    .setName('autorole')
    .setDescription('Configure automatic role')

    .addSubcommand(sub =>
      sub
        .setName('set')
        .setDescription('Set role')
        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('Role')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('Disable')
    )

    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Status')
    )
);

// ============================================================
// WELCOME
// ============================================================

addCommand(
  new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Configure welcome system')

    .addSubcommand(sub =>
      sub
        .setName('set')
        .setDescription('Set welcome')

        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Channel')
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )

        .addStringOption(option =>
          option
            .setName('message')
            .setDescription('Message')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('Disable')
    )

    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Status')
    )
);

// ============================================================
// VERIFICATION
// ============================================================

addCommand(
  new SlashCommandBuilder()
    .setName('verification')
    .setDescription('Configure verification')

    .addSubcommand(sub =>
      sub
        .setName('setup')
        .setDescription('Setup')

        .addChannelOption(option =>
          option
            .setName('channel')
            .setDescription('Channel')
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )

        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('Verified role')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('Disable')
    )

    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Status')
    )
);

// ============================================================
// REACTION ROLES
// ============================================================

addCommand(
  new SlashCommandBuilder()
    .setName('autoreactionrole')
    .setDescription('Reaction roles')

    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Add reaction role')

        .addStringOption(option =>
          option
            .setName('message_id')
            .setDescription('Message ID')
            .setRequired(true)
        )

        .addStringOption(option =>
          option
            .setName('emoji')
            .setDescription('Emoji or custom emoji')
            .setRequired(true)
        )

        .addRoleOption(option =>
          option
            .setName('role')
            .setDescription('Role')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove reaction role')

        .addStringOption(option =>
          option
            .setName('message_id')
            .setDescription('Message ID')
            .setRequired(true)
        )

        .addStringOption(option =>
          option
            .setName('emoji')
            .setDescription('Emoji')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('list')
        .setDescription('List reaction roles')
    )
);

// ============================================================
// LEADERBOARD
// ============================================================

addCommand(
  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Message leaderboard')

    .addSubcommand(sub =>
      sub
        .setName('top')
        .setDescription('Show top users')

        .addIntegerOption(option =>
          option
            .setName('limit')
            .setDescription('Number')
            .setMinValue(1)
            .setMaxValue(20)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('reset')
        .setDescription('Reset leaderboard')
    )

    .addSubcommand(sub =>
      sub
        .setName('enable')
        .setDescription('Enable')
    )

    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('Disable')
    )

    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Status')
    )
);

// ============================================================
// ADS
// ============================================================

addCommand(
  new SlashCommandBuilder()
    .setName('ads')
    .setDescription('Owner advertisement system')

    .addSubcommand(sub =>
      sub
        .setName('set')
        .setDescription('Set ad message')
        .addStringOption(option =>
          option
            .setName('message')
            .setDescription('Message')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('message')
        .setDescription('Set ad message')
        .addStringOption(option =>
          option
            .setName('message')
            .setDescription('Message')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('interval')
        .setDescription('Set interval')
        .addIntegerOption(option =>
          option
            .setName('minutes')
            .setDescription('Minutes')
            .setMinValue(1)
            .setMaxValue(10080)
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('enable')
        .setDescription('Enable')
    )

    .addSubcommand(sub =>
      sub
        .setName('disable')
        .setDescription('Disable')
    )

    .addSubcommand(sub =>
      sub
        .setName('status')
        .setDescription('Status')
    )

    .addSubcommand(sub =>
      sub
        .setName('broadcast')
        .setDescription('Broadcast now')
    )
);

// ============================================================
// AI
// ============================================================

addCommand(
  new SlashCommandBuilder()
    .setName('ai')
    .setDescription('AI assistant')

    .addSubcommand(sub =>
      sub
        .setName('ask')
        .setDescription('Ask AI')
        .addStringOption(option =>
          option
            .setName('prompt')
            .setDescription('Prompt')
            .setRequired(true)
        )
    )

    .addSubcommand(sub =>
      sub
        .setName('reset')
        .setDescription('Reset your AI memory')
    )
);

// ============================================================
// COMMAND REGISTRATION
// ============================================================

async function registerCommands() {
  const rest = new REST({
    version: '10'
  }).setToken(TOKEN);

  console.log(
    `Registering ${commands.length} global slash commands...`
  );

  await rest.put(
    Routes.applicationCommands(CLIENT_ID),
    {
      body: commands.map(command =>
        command.toJSON()
      )
    }
  );

  console.log(
    'Global slash commands registered.'
  );
}

// ============================================================
// INTERACTION HELPERS
// ============================================================

async function requireGuild(interaction) {
  if (!interaction.guild) {
    await interaction.reply({
      content:
        'This command can only be used in a server.',
      ephemeral: true
    });

    return false;
  }

  return true;
}

async function requireManager(interaction) {
  if (!isManager(interaction.member)) {
    await interaction.reply({
      content:
        'You need Manage Server or Administrator.',
      ephemeral: true
    });

    return false;
  }

  return true;
}

async function requireStaff(interaction) {
  const cfg =
    gc(interaction.guild.id);

  if (
    !isStaff(
      interaction.member,
      cfg
    )
  ) {
    await interaction.reply({
      content:
        'You need the configured staff role or moderation permissions.',
      ephemeral: true
    });

    return false;
  }

  return true;
}

async function currentTicket(interaction) {
  const cfg =
    gc(interaction.guild.id);

  const ticket =
    ticketForChannel(
      cfg,
      interaction.channelId
    );

  if (!ticket) {
    await interaction.reply({
      content:
        'This channel is not a ticket.',
      ephemeral: true
    });

    return null;
  }

  return ticket;
}

function ticketButtons(ticket) {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_claim')
        .setLabel(
          ticket.claimedBy
            ? 'Unclaim'
            : 'Claim'
        )
        .setStyle(
          ButtonStyle.Primary
        ),

      new ButtonBuilder()
        .setCustomId('ticket_close')
        .setLabel('Close')
        .setStyle(
          ButtonStyle.Secondary
        ),

      new ButtonBuilder()
        .setCustomId('ticket_lock')
        .setLabel(
          ticket.locked
            ? 'Unlock'
            : 'Lock'
        )
        .setStyle(
          ButtonStyle.Secondary
        ),

      new ButtonBuilder()
        .setCustomId(
          'ticket_transcript'
        )
        .setLabel('Transcript')
        .setStyle(
          ButtonStyle.Success
        )
    );
}

// ============================================================
// TICKET CREATION
// ============================================================

async function createTicket(
  guild,
  user,
  reason = 'Support'
) {
  const cfg = gc(guild.id);

  if (!cfg.ticket.enabled) {
    throw new Error(
      'Ticket system is disabled.'
    );
  }

  const existing =
    activeTicketForUser(
      cfg,
      user.id
    );

  if (existing) {
    return guild.channels.cache.get(
      existing.channelId
    ) || null;
  }

  const category =
    cfg.ticketCategoryId
      ? guild.channels.cache.get(
          cfg.ticketCategoryId
        )
      : null;

  const staffRole =
    cfg.staffRoleId
      ? guild.roles.cache.get(
          cfg.staffRoleId
        )
      : null;

  cfg.ticket.counter++;

  const name =
    `ticket-${String(
      cfg.ticket.counter
    ).padStart(4, '0')}-${safeName(
      user.username
    )}`.slice(0, 100);

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: ['ViewChannel']
    },

    {
      id: user.id,
      allow: [
        'ViewChannel',
        'SendMessages',
        'ReadMessageHistory',
        'AttachFiles'
      ]
    }
  ];

  if (staffRole) {
    overwrites.push({
      id: staffRole.id,
      allow: [
        'ViewChannel',
        'SendMessages',
        'ReadMessageHistory',
        'AttachFiles',
        'ManageMessages'
      ]
    });
  }

  const channel =
    await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: category?.id || undefined,

      topic:
        `AKIYO_TICKET|${user.id}|${Date.now()}`,

      permissionOverwrites:
        overwrites
    });

  const ticket = {
    id:
      `${guild.id}-${user.id}-${Date.now()}`,

    guildId: guild.id,
    channelId: channel.id,
    ownerId: user.id,

    status: 'open',

    claimedBy: null,

    locked: false,

    reason,

    createdAt: Date.now(),

    closedAt: null
  };

  cfg.tickets[ticket.id] =
    ticket;

  save();

  const embed =
    new EmbedBuilder()
      .setTitle(
        'AkiyO Support Ticket'
      )
      .setDescription(
        `Hello ${user}, a staff member will assist you soon.\n\n**Reason:** ${truncate(reason, 1000)}`
      )
      .setTimestamp();

  await channel.send({
    content: staffRole
      ? `${user} ${roleMention(
          staffRole.id
        )}`
      : `${user}`,

    embeds: [embed],

    components: [
      ticketButtons(ticket)
    ]
  });

  await sendLog(
    guild,
    'tickets',
    `Ticket created: <#${channel.id}> by ${fmtUser(user.id)}.`
  );

  return channel;
}

// ============================================================
// CLOSE TICKET
// ============================================================

async function closeTicket(
  guild,
  ticket,
  actor
) {
  const channel =
    guild.channels.cache.get(
      ticket.channelId
    );

  if (!channel) {
    return false;
  }

  ticket.status = 'closed';
  ticket.closedAt = Date.now();
  ticket.locked = true;

  const member =
    guild.members.cache.get(
      ticket.ownerId
    );

  await channel.permissionOverwrites
    .edit(
      ticket.ownerId,
      {
        SendMessages: false
      }
    )
    .catch(() => {});

  if (member) {
    await member.send(
      `Your AkiyO ticket in **${guild.name}** has been closed.`
    ).catch(() => {});
  }

  await channel.send({
    content:
      `🔒 Ticket closed by ${actor}.`,

    components: [
      new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setCustomId(
              'ticket_reopen'
            )
            .setLabel('Reopen')
            .setStyle(
              ButtonStyle.Success
            ),

          new ButtonBuilder()
            .setCustomId(
              'ticket_delete'
            )
            .setLabel('Delete')
            .setStyle(
              ButtonStyle.Danger
            )
        )
    ]
  }).catch(() => {});

  save();

  await sendLog(
    guild,
    'tickets',
    `Ticket closed: <#${channel.id}> by ${fmtUser(actor.id)}.`
  );

  return true;
}

// ============================================================
// TRANSCRIPT
// ============================================================

async function makeTranscript(
  channel,
  ticket
) {
  const lines = [
    'AkiyO Ticket Transcript',

    `Guild: ${channel.guild.name}`,

    `Channel: #${channel.name}`,

    `Owner: ${ticket.ownerId}`,

    `Created: ${new Date(
      ticket.createdAt
    ).toISOString()}`,

    ''
  ];

  let before;

  for (let page = 0; page < 20; page++) {
    const options = {
      limit: 100
    };

    if (before) {
      options.before = before;
    }

    const collection =
      await channel.messages
        .fetch(options)
        .catch(() => null);

    if (
      !collection ||
      !collection.size
    ) {
      break;
    }

    const messages =
      [...collection.values()]
        .sort(
          (a, b) =>
            a.createdTimestamp -
            b.createdTimestamp
        );

    for (const message of messages) {
      lines.push(
        `[${new Date(
          message.createdTimestamp
        ).toISOString()}] ${message.author.tag}: ${message.content || '[embed/attachment]'}`
      );
    }

    before =
      collection.last()?.id;

    if (collection.size < 100) {
      break;
    }
  }

  return Buffer.from(
    lines.join('\n'),
    'utf8'
  );
}

// ============================================================
// INTERACTION HANDLER
// ============================================================

client.on(
  'interactionCreate',
  async interaction => {
    try {
      if (interaction.isButton()) {
        return handleButton(
          interaction
        );
      }

      if (
        !interaction.isChatInputCommand()
      ) {
        return;
      }

      if (
        !await requireGuild(
          interaction
        )
      ) {
        return;
      }

      const cfg =
        gc(interaction.guild.id);

      const name =
        interaction.commandName;

      // --------------------------------------------------------
      // HELP
      // --------------------------------------------------------

      if (name === 'help') {
        return interaction.reply({
          content: commandHelp(),
          ephemeral: true
        });
      }

      // --------------------------------------------------------
      // BOT INFO
      // --------------------------------------------------------

      if (name === 'botinfo') {
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle('AkiyO')
              .setDescription(
                'Advanced multi-server Discord support, moderation and security bot.'
              )
              .addFields(
                {
                  name: 'Servers',
                  value:
                    String(
                      client.guilds.cache.size
                    ),
                  inline: true
                },
                {
                  name: 'Commands',
                  value:
                    String(
                      commands.length
                    ),
                  inline: true
                },
                {
                  name: 'Node',
                  value:
                    process.version,
                  inline: true
                }
              )
              .setTimestamp()
          ]
        });
      }

      // --------------------------------------------------------
      // TICKET
      // --------------------------------------------------------

      if (name === 'ticket') {
        const channel =
          await createTicket(
            interaction.guild,
            interaction.user,
            interaction.options.getString(
              'reason'
            ) || 'Support'
          );

        return interaction.reply({
          content: channel
            ? `Your ticket is ready: ${channel}`
            : 'You already have an active ticket.',
          ephemeral: true
        });
      }

      // --------------------------------------------------------
      // TICKET PANEL
      // --------------------------------------------------------

      if (
        name === 'ticketpanel'
      ) {
        if (
          !await requireManager(
            interaction
          )
        ) {
          return;
        }

        const row =
          new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(
                  'ticket_create'
                )
                .setLabel(
                  'Create Ticket'
                )
                .setEmoji('🎫')
                .setStyle(
                  ButtonStyle.Primary
                )
            );

        await interaction.channel.send({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                'AkiyO Support'
              )
              .setDescription(
                'Need help? Click **Create Ticket** below.'
              )
              .setTimestamp()
          ],

          components: [row]
        });

        return interaction.reply({
          content:
            'Ticket panel sent.',
          ephemeral: true
        });
      }

      // --------------------------------------------------------
      // TICKET SETUP
      // --------------------------------------------------------

      if (
        name === 'ticketsetup'
      ) {
        if (
          !await requireManager(
            interaction
          )
        ) {
          return;
        }

        const category =
          interaction.options.getChannel(
            'category'
          );

        const role =
          interaction.options.getRole(
            'staffrole'
          );

        const log =
          interaction.options.getChannel(
            'logchannel'
          );

        const panel =
          interaction.options.getChannel(
            'panelchannel'
          );

        if (category) {
          cfg.ticketCategoryId =
            category.id;
        }

        if (role) {
          cfg.staffRoleId =
            role.id;
        }

        if (log) {
          cfg.logs.tickets =
            log.id;
        }

        if (panel) {
          cfg.ticketPanelChannelId =
            panel.id;
        }

        save();

        return interaction.reply({
          content:
            `Ticket setup saved.\nCategory: ${channelMention(cfg.ticketCategoryId)}\nStaff: ${roleMention(cfg.staffRoleId)}\nLogs: ${channelMention(cfg.logs.tickets)}\nPanel: ${channelMention(cfg.ticketPanelChannelId)}`
        });
      }

      // --------------------------------------------------------
      // TICKET COMMANDS
      // --------------------------------------------------------

      const ticketCommands = [
        'close',
        'reopen',
        'delete',
        'claim',
        'unclaim',
        'lock',
        'unlock',
        'transcript',
        'ticketstats',
        'ticketadd',
        'ticketremove',
        'ticketrename',
        'ticketinfo'
      ];

      if (
        ticketCommands.includes(name)
      ) {
        if (
          name === 'ticketstats'
        ) {
          const all =
            Object.values(
              cfg.tickets
            );

          const open =
            all.filter(
              ticket =>
                ticket.status === 'open'
            ).length;

          const closed =
            all.filter(
              ticket =>
                ticket.status === 'closed'
            ).length;

          return interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setTitle(
                  'Ticket Statistics'
                )
                .addFields(
                  {
                    name: 'Total',
                    value: String(
                      all.length
                    ),
                    inline: true
                  },
                  {
                    name: 'Open',
                    value: String(
                      open
                    ),
                    inline: true
                  },
                  {
                    name: 'Closed',
                    value: String(
                      closed
                    ),
                    inline: true
                  }
                )
            ]
          });
        }

        const ticket =
          await currentTicket(
            interaction
          );

        if (!ticket) {
          return;
        }

        if (
          name === 'ticketinfo'
        ) {
          return interaction.reply({
            embeds: [
              new EmbedBuilder()
                .setTitle(
                  'Ticket Info'
                )
                .addFields(
                  {
                    name: 'Owner',
                    value:
                      fmtUser(
                        ticket.ownerId
                      ),
                    inline: true
                  },
                  {
                    name: 'Status',
                    value:
                      ticket.status,
                    inline: true
                  },
                  {
                    name: 'Claimed',
                    value:
                      fmtUser(
                        ticket.claimedBy
                      ),
                    inline: true
                  },
                  {
                    name: 'Locked',
                    value:
                      String(
                        ticket.locked
                      ),
                    inline: true
                  },
                  {
                    name: 'Reason',
                    value:
                      truncate(
                        ticket.reason,
                        1024
                      )
                  }
                )
            ],
            ephemeral: true
          });
        }

        const staffRequired = [
          'close',
          'reopen',
          'delete',
          'claim',
          'unclaim',
          'lock',
          'unlock',
          'transcript'
        ].includes(name);

        if (
          staffRequired &&
          !isStaff(
            interaction.member,
            cfg
          )
        ) {
          return interaction.reply({
            content:
              'Staff only.',
            ephemeral: true
          });
        }

        if (name === 'close') {
          await closeTicket(
            interaction.guild,
            ticket,
            interaction.user
          );

          return interaction.reply({
            content:
              'Ticket closed.',
            ephemeral: true
          });
        }

        if (name === 'reopen') {
          ticket.status = 'open';
          ticket.locked = false;

          await interaction.channel
            .permissionOverwrites
            .edit(
              ticket.ownerId,
              {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
              }
            )
            .catch(() => {});

          save();

          return interaction.reply({
            content:
              'Ticket reopened.',
            ephemeral: true
          });
        }

        if (name === 'delete') {
          ticket.status =
            'deleted';

          save();

          await sendLog(
            interaction.guild,
            'tickets',
            `Ticket deleted by ${fmtUser(interaction.user.id)}: <#${interaction.channelId}>`
          );

          await interaction.reply({
            content:
              'Deleting ticket...',
            ephemeral: true
          });

          return interaction.channel
            .delete()
            .catch(() => {});
        }

        if (
          name === 'claim' ||
          name === 'unclaim'
        ) {
          ticket.claimedBy =
            name === 'claim'
              ? interaction.user.id
              : null;

          save();

          return interaction.reply({
            content:
              name === 'claim'
                ? `Ticket claimed by ${interaction.user}.`
                : 'Ticket unclaimed.',
            ephemeral: false
          });
        }

        if (
          name === 'lock' ||
          name === 'unlock'
        ) {
          ticket.locked =
            name === 'lock';

          await interaction.channel
            .permissionOverwrites
            .edit(
              ticket.ownerId,
              {
                SendMessages:
                  !ticket.locked
              }
            )
            .catch(() => {});

          save();

          return interaction.reply({
            content:
              ticket.locked
                ? 'Ticket locked.'
                : 'Ticket unlocked.',
            ephemeral: true
          });
        }

        if (
          name === 'transcript'
        ) {
          const buffer =
            await makeTranscript(
              interaction.channel,
              ticket
            );

          const log =
            logChannel(
              interaction.guild,
              'tickets'
            );

          if (log) {
            await log.send({
              content:
                `Transcript for <#${interaction.channelId}>`,

              files: [
                {
                  attachment: buffer,
                  name:
                    `${safeName(interaction.channel.name)}.txt`
                }
              ]
            }).catch(() => {});
          }

          return interaction.reply({
            content: log
              ? 'Transcript sent to ticket logs.'
              : 'Ticket log channel is not configured.',
            ephemeral: true
          });
        }

        if (
          name === 'ticketadd' ||
          name === 'ticketremove'
        ) {
          const user =
            interaction.options.getUser(
              'user'
            );

          await interaction.channel
            .permissionOverwrites
            .edit(
              user.id,
              name === 'ticketadd'
                ? {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true
                  }
                : {
                    ViewChannel: false
                  }
            );

          return interaction.reply({
            content:
              name === 'ticketadd'
                ? `Added ${user}.`
                : `Removed ${user}.`,
            ephemeral: true
          });
        }

        if (
          name === 'ticketrename'
        ) {
          await interaction.channel.setName(
            safeName(
              interaction.options.getString(
                'name'
              )
            )
          );

          return interaction.reply({
            content:
              'Ticket renamed.',
            ephemeral: true
          });
        }
      }

      // --------------------------------------------------------
      // AUTOMOD
      // --------------------------------------------------------

      if (name === 'automod') {
        if (
          !await requireManager(
            interaction
          )
        ) {
          return;
        }

        const subcommand =
          interaction.options.getSubcommand();

        if (
          subcommand === 'enable'
        ) {
          cfg.automod.enabled =
            true;
        }

        else if (
          subcommand === 'disable'
        ) {
          cfg.automod.enabled =
            false;
        }

        else if (
          subcommand === 'status'
        ) {
          return interaction.reply({
            content:
              `AutoMod: **${cfg.automod.enabled ? 'ON' : 'OFF'}**\nBad words: ${cfg.automod.badWords.length}\nSpam: ${cfg.automod.spamLimit} msgs/${cfg.automod.spamWindow}ms\nAction: ${cfg.automod.action}`,
            ephemeral: true
          });
        }

        else if (
          subcommand === 'badword'
        ) {
          const word =
            interaction.options
              .getString('word')
              .toLowerCase();

          if (
            !cfg.automod.badWords
              .includes(word)
          ) {
            cfg.automod.badWords
              .push(word);
          }
        }

        else if (
          subcommand ===
          'removebadword'
        ) {
          const word =
            interaction.options
              .getString('word')
              .toLowerCase();

          cfg.automod.badWords =
            cfg.automod.badWords
              .filter(
                value =>
                  value !== word
              );
        }

        else if (
          subcommand === 'config'
        ) {
          const limit =
            interaction.options.getInteger(
              'spamlimit'
            );

          const window =
            interaction.options.getInteger(
              'window'
            );

          const action =
            interaction.options.getString(
              'action'
            );

          const timeout =
            interaction.options.getInteger(
              'timeout'
            );

          if (limit) {
            cfg.automod.spamLimit =
              limit;
          }

          if (window) {
            cfg.automod.spamWindow =
              window;
          }

          if (action) {
            cfg.automod.action =
              action;
          }

          if (timeout) {
            cfg.automod.timeoutSeconds =
              timeout;
          }
        }

        save();

        return interaction.reply({
          content:
            `AutoMod ${subcommand} saved.`,
          ephemeral: true
        });
      }

      // --------------------------------------------------------
      // SECURITY
      // --------------------------------------------------------

      if (name === 'security') {
        if (
          !await requireManager(
            interaction
          )
        ) {
          return;
        }

        const subcommand =
          interaction.options.getSubcommand();

        if (
          subcommand === 'enable'
        ) {
          cfg.security.enabled =
            true;
        }

        else if (
          subcommand === 'disable'
        ) {
          cfg.security.enabled =
            false;
        }

        else if (
          subcommand === 'status'
        ) {
          return interaction.reply({
            content:
              `Security: **${cfg.security.enabled ? 'ON' : 'OFF'}**\nRaid: ${cfg.security.raidEnabled ? 'ON' : 'OFF'}\nTrusted users: ${cfg.security.trustedUserIds.length}\nTrusted bots: ${cfg.security.trustedBotIds.length}\nProtected roles: ${cfg.security.protectedRoleIds.length}\nProtected channels: ${cfg.security.protectedChannelIds.length}\nAction: ${cfg.security.action}`,
            ephemeral: true
          });
        }

        else if (
          subcommand === 'action'
        ) {
          cfg.security.action =
            interaction.options.getString(
              'action'
            );
        }

        else if (
          subcommand === 'raid'
        ) {
          const enabled =
            interaction.options.getBoolean(
              'enabled'
            );

          const limit =
            interaction.options.getInteger(
              'limit'
            );

          const window =
            interaction.options.getInteger(
              'window'
            );

          cfg.security.raidEnabled =
            enabled;

          if (limit) {
            cfg.security.raidLimit =
              limit;
          }

          if (window) {
            cfg.security.raidWindow =
              window;
          }
        }

        else if (
          subcommand === 'log'
        ) {
          cfg.logs.security =
            interaction.options
              .getChannel(
                'channel'
              ).id;
        }

        else if (
          [
            'trusted',
            'untrusted',
            'trustedmember',
            'untrustedmember',
            'trustedbot',
            'untrustedbot'
          ].includes(subcommand)
        ) {
          const id =
            interaction.options
              .getUser('user')
              .id;

          const key =
            subcommand.includes(
              'bot'
            )
              ? 'trustedBotIds'
              : 'trustedUserIds';

          const adding =
            subcommand.startsWith(
              'trusted'
            );

          if (
            adding &&
            !cfg.security[key]
              .includes(id)
          ) {
            cfg.security[key]
              .push(id);
          }

          if (!adding) {
            cfg.security[key] =
              cfg.security[key]
                .filter(
                  value =>
                    value !== id
                );
          }
        }

        else if (
          [
            'trustedrole',
            'untrustedrole'
          ].includes(subcommand)
        ) {
          const id =
            interaction.options
              .getRole('role')
              .id;

          const adding =
            subcommand ===
            'trustedrole';

          if (
            adding &&
            !cfg.security
              .trustedRoleIds
              .includes(id)
          ) {
            cfg.security
              .trustedRoleIds
              .push(id);
          }

          if (!adding) {
            cfg.security
              .trustedRoleIds =
              cfg.security
                .trustedRoleIds
                .filter(
                  value =>
                    value !== id
                );
          }
        }

        else if (
          [
            'protectedrole',
            'unprotectedrole'
          ].includes(subcommand)
        ) {
          const id =
            interaction.options
              .getRole('role')
              .id;

          const adding =
            subcommand ===
            'protectedrole';

          if (
            adding &&
            !cfg.security
              .protectedRoleIds
              .includes(id)
          ) {
            cfg.security
              .protectedRoleIds
              .push(id);
          }

          if (!adding) {
            cfg.security
              .protectedRoleIds =
              cfg.security
                .protectedRoleIds
                .filter(
                  value =>
                    value !== id
                );
          }
        }

        else if (
          [
            'protectedchannel',
            'unprotectedchannel'
          ].includes(subcommand)
        ) {
          const id =
            interaction.options
              .getChannel('channel')
              .id;

          const adding =
            subcommand ===
            'protectedchannel';

          if (
            adding &&
            !cfg.security
              .protectedChannelIds
              .includes(id)
          ) {
            cfg.security
              .protectedChannelIds
              .push(id);
          }

          if (!adding) {
            cfg.security
              .protectedChannelIds =
              cfg.security
                .protectedChannelIds
                .filter(
                  value =>
                    value !== id
                );
          }
        }

        else if (
          subcommand === 'list'
        ) {
          return interaction.reply({
            content:
              `Trusted users: ${cfg.security.trustedUserIds.map(fmtUser).join(', ') || 'None'}\nTrusted roles: ${cfg.security.trustedRoleIds.map(roleMention).join(', ') || 'None'}\nTrusted bots: ${cfg.security.trustedBotIds.map(fmtUser).join(', ') || 'None'}\nProtected roles: ${cfg.security.protectedRoleIds.map(roleMention).join(', ') || 'None'}\nProtected channels: ${cfg.security.protectedChannelIds.map(channelMention).join(', ') || 'None'}`,
            ephemeral: true
          });
        }

        save();

        return interaction.reply({
          content:
            `Security ${subcommand} saved.`,
          ephemeral: true
        });
      }

      // --------------------------------------------------------
      // CONFIG
      // --------------------------------------------------------

      if (name === 'config') {
        if (
          !await requireManager(
            interaction
          )
        ) {
          return;
        }

        const subcommand =
          interaction.options.getSubcommand();

        if (
          subcommand === 'view'
        ) {
          return interaction.reply({
            content:
              `Staff: ${roleMention(cfg.staffRoleId)}\nTicket category: ${channelMention(cfg.ticketCategoryId)}\nSuggestion channel: ${channelMention(cfg.suggestionChannelId)}\nAutoMod: ${cfg.automod.enabled ? 'ON' : 'OFF'}\nSecurity: ${cfg.security.enabled ? 'ON' : 'OFF'}`,
            ephemeral: true
          });
        }

        if (
          subcommand === 'log'
        ) {
          const type =
            interaction.options.getString(
              'type'
            );

          cfg.logs[type] =
            interaction.options
              .getChannel(
                'channel'
              ).id;
        }

        if (
          subcommand ===
          'staffrole'
        ) {
          cfg.staffRoleId =
            interaction.options
              .getRole('role')
              .id;
        }

        if (
          subcommand ===
          'ticketcategory'
        ) {
          cfg.ticketCategoryId =
            interaction.options
              .getChannel(
                'channel'
              ).id;
        }

        if (
          subcommand ===
          'suggestions'
        ) {
          cfg.suggestionChannelId =
            interaction.options
              .getChannel(
                'channel'
              ).id;
        }

        if (
          subcommand === 'timeout'
        ) {
          cfg.automod
            .timeoutSeconds =
            interaction.options
              .getInteger(
                'seconds'
              );
        }

        save();

        return interaction.reply({
          content:
            'Configuration saved.',
          ephemeral: true
        });
      }

      // --------------------------------------------------------
      // MODERATION
      // --------------------------------------------------------

      if (
        [
          'warn',
          'timeout',
          'kick',
          'ban',
          'unban',
          'warnings',
          'punishments'
        ].includes(name)
      ) {
        if (
          !await requireStaff(
            interaction
          )
        ) {
          return;
        }

        const user =
          interaction.options
            .getUser('user');

        if (
          name === 'warnings'
        ) {
          const warnings =
            cfg.warnings[user.id] ||
            [];

          return interaction.reply({
            content:
              warnings.length
                ? warnings
                    .map(
                      (warning, index) =>
                        `**${index + 1}.** ${warning.reason} — ${fmtUser(warning.moderatorId)} — <t:${Math.floor(warning.at / 1000)}:R>`
                    )
                    .join('\n')
                : 'No warnings.',

            ephemeral: true
          });
        }

        if (
          name === 'punishments'
        ) {
          const punishments =
            cfg.punishments
              .filter(
                punishment =>
                  punishment.userId ===
                  user.id
              );

          return interaction.reply({
            content:
              punishments.length
                ? punishments
                    .slice(-20)
                    .map(
                      punishment =>
                        `**${punishment.type}** — ${punishment.reason} — ${fmtUser(punishment.moderatorId)} — <t:${Math.floor(punishment.at / 1000)}:R>`
                    )
                    .join('\n')
                : 'No punishments.',

            ephemeral: true
          });
        }

        if (
          name === 'unban'
        ) {
          if (
            interaction.member.id !==
              interaction.guild.ownerId &&
            !interaction.member.permissions
              .has(
                PermissionFlagsBits.BanMembers
              ) &&
            !interaction.member.permissions
              .has(
                PermissionFlagsBits.Administrator
              )
          ) {
            return interaction.reply({
              content:
                'You need Ban Members or Administrator.',
              ephemeral: true
            });
          }

          try {
            const reason =
              interaction.options
                .getString(
                  'reason'
                ) ||
              'No reason';

            await interaction.guild
              .members.unban(
                user.id,
                reason
              );

            cfg.punishments.push({
              id:
                `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,

              guildId:
                interaction.guild.id,

              userId:
                user.id,

              moderatorId:
                interaction.user.id,

              type: 'unban',

              reason,

              at: Date.now()
            });

            save();

            await sendLog(
              interaction.guild,
              'moderation',
              `**UNBAN** ${fmtUser(user.id)} by ${fmtUser(interaction.user.id)}
Reason: ${truncate(reason)}`
            );

            return interaction.reply({
              content:
                'User unbanned.',
              ephemeral: true
            });
          } catch (error) {
            return interaction.reply({
              content:
                `Unban failed: ${error.message}`,
              ephemeral: true
            });
          }
        }

        const member =
          await interaction.guild
            .members
            .fetch(user.id)
            .catch(() => null);

        if (!member) {
          return interaction.reply({
            content:
              'Member is not in this server.',
            ephemeral: true
          });
        }

        if (
          name === 'warn'
        ) {
          if (
            !hasHigherRole(
              interaction.member,
              member
            ) &&
            interaction.member.id !==
              interaction.guild.ownerId
          ) {
            return interaction.reply({
              content:
                'You cannot warn this member.',
              ephemeral: true
            });
          }

          const result =
            await addWarning(
              interaction.guild,
              user.id,
              interaction.user.id,
              interaction.options
                .getString(
                  'reason'
                ) ||
                'No reason'
            );

          return interaction.reply({
            content:
              `Warning added. Total: ${result.count}. ${result.escalation}`,
            ephemeral: true
          });
        }

        const reason =
          interaction.options
            .getString(
              'reason'
            ) ||
          'No reason';

        let result;

        if (
          name === 'timeout'
        ) {
          const duration =
            parseDuration(
              interaction.options
                .getString(
                  'duration'
                )
            );

          if (!duration) {
            return interaction.reply({
              content:
                'Invalid duration. Use 30s, 10m, 2h or 1d. Maximum 28d.',
              ephemeral: true
            });
          }

          result =
            await punish(
              member,
              'timeout',
              {
                seconds:
                  duration,
                text:
                  reason
              },
              interaction.member
            );
        } else {
          result =
            await punish(
              member,
              name,
              {
                text:
                  reason
              },
              interaction.member
            );
        }

        return interaction.reply({
          content:
            result.message,
          ephemeral: true
        });
      }

      // --------------------------------------------------------
      // SUGGESTIONS
      // --------------------------------------------------------

      if (
        name === 'suggest'
      ) {
        const subcommand =
          interaction.options.getSubcommand();

        if (
          subcommand === 'create'
        ) {
          const channel =
            cfg.suggestionChannelId
              ? interaction.guild.channels
                  .cache.get(
                    cfg.suggestionChannelId
                  )
              : null;

          if (!channel) {
            return interaction.reply({
              content:
                'Suggestion channel is not configured.',
              ephemeral: true
            });
          }

          const id =
            `${Date.now()}-${interaction.user.id}`;

          cfg.suggestionsData[id] = {
            id,
            userId:
              interaction.user.id,

            text:
              interaction.options
                .getString(
                  'text'
                ),

            status:
              'pending',

            createdAt:
              Date.now()
          };

          save();

          const row =
            new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId(
                    `suggest_approve_${id}`
                  )
                  .setLabel(
                    'Approve'
                  )
                  .setStyle(
                    ButtonStyle.Success
                  ),

                new ButtonBuilder()
                  .setCustomId(
                    `suggest_decline_${id}`
                  )
                  .setLabel(
                    'Decline'
                  )
                  .setStyle(
                    ButtonStyle.Danger
                  )
              );

          const message =
            await channel.send({
              embeds: [
                new EmbedBuilder()
                  .setTitle(
                    '💡 Suggestion'
                  )
                  .setDescription(
                    cfg.suggestionsData[id]
                      .text
                  )
                  .addFields(
                    {
                      name: 'Author',
                      value:
                        String(
                          interaction.user
                        )
                    },
                    {
                      name: 'Status',
                      value:
                        'Pending'
                    }
                  )
                  .setTimestamp()
              ],

              components: [row]
            });

          cfg.suggestionsData[id]
            .messageId =
            message.id;

          save();

          return interaction.reply({
            content:
              `Suggestion submitted in ${channel}.`,
            ephemeral: true
          });
        }

        if (
          subcommand === 'list'
        ) {
          const suggestions =
            Object.values(
              cfg.suggestionsData
            )
              .slice(-10)
              .reverse();

          return interaction.reply({
            content:
              suggestions.length
                ? suggestions
                    .map(
                      suggestion =>
                        `**${suggestion.status}** — ${suggestion.text}`
                    )
                    .join('\n')
                : 'No suggestions.',

            ephemeral: true
          });
        }
      }

      // --------------------------------------------------------
      // ANNOUNCE
      // --------------------------------------------------------

      if (
        name === 'announce'
      ) {
        if (
          !await requireManager(
            interaction
          )
        ) {
          return;
        }

        const channel =
          interaction.options
            .getChannel(
              'channel'
            );

        const message =
          interaction.options
            .getString(
              'message'
            );

        const useEmbed =
          interaction.options
            .getBoolean(
              'embed'
            ) !== false;

        const everyone =
          interaction.options
            .getBoolean(
              'everyone'
            ) === true;

        const role =
          interaction.options
            .getRole(
              'role'
            );

        const user =
          interaction.options
            .getUser(
              'user'
            );

        let prefix = '';

        if (everyone) {
          prefix += '@everyone ';
        }

        if (role) {
          prefix += `${role} `;
        }

        if (user) {
          prefix += `${user} `;
        }

        const payload =
          useEmbed
            ? {
                content:
                  prefix ||
                  undefined,

                embeds: [
                  new EmbedBuilder()
                    .setTitle(
                      interaction.options
                        .getString(
                          'title'
                        ) ||
                      'Announcement'
                    )

                    .setDescription(
                      message
                    )

                    .setFooter({
                      text:
                        interaction.options
                          .getString(
                            'footer'
                          ) ||
                        'AkiyO'
                    })

                    .setTimestamp()
                ],

                allowedMentions: {
                  parse:
                    everyone
                      ? ['everyone']
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
              }
            : {
                content:
                  `${prefix}${message}`,

                allowedMentions: {
                  parse:
                    everyone
                      ? ['everyone']
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

        await channel.send(
          payload
        );

        await sendLog(
          interaction.guild,
          'announcements',
          `Announcement sent by ${fmtUser(interaction.user.id)} to <#${channel.id}>`
        );

        return interaction.reply({
          content:
            'Announcement sent.',
          ephemeral: true
        });
      }

      // --------------------------------------------------------
      // AUTOROLE
      // --------------------------------------------------------

      if (
        name === 'autorole'
      ) {
        if (
          !await requireManager(
            interaction
          )
        ) {
          return;
        }

        const subcommand =
          interaction.options.getSubcommand();

        if (
          subcommand === 'set'
        ) {
          const role =
            interaction.options
              .getRole(
                'role'
              );

          if (
            !interaction.guild
              .members.me
              .permissions
              .has(
                PermissionFlagsBits.ManageRoles
              ) ||
            interaction.guild
              .members.me
              .roles.highest
              .position <=
              role.position
          ) {
            return interaction.reply({
              content:
                'I cannot assign that role. Check Manage Roles and hierarchy.',
              ephemeral: true
            });
          }

          cfg.autoroleId =
            role.id;
        }

        else if (
          subcommand === 'disable'
        ) {
          cfg.autoroleId =
            null;
        }

        else {
          return interaction.reply({
            content:
              `AutoRole: ${roleMention(cfg.autoroleId)}`,
            ephemeral: true
          });
        }

        save();

        return interaction.reply({
          content:
            'AutoRole saved.',
          ephemeral: true
        });
      }

      // --------------------------------------------------------
      // WELCOME
      // --------------------------------------------------------

      if (
        name === 'welcome'
      ) {
        if (
          !await requireManager(
            interaction
          )
        ) {
          return;
        }

        const subcommand =
          interaction.options.getSubcommand();

        if (
          subcommand === 'set'
        ) {
          cfg.welcome.enabled =
            true;

          cfg.welcome.channelId =
            interaction.options
              .getChannel(
                'channel'
              ).id;

          cfg.welcome.message =
            interaction.options
              .getString(
                'message'
              );
        }

        else if (
          subcommand === 'disable'
        ) {
          cfg.welcome.enabled =
            false;
        }

        else {
          return interaction.reply({
            content:
              `Welcome: ${cfg.welcome.enabled ? 'ON' : 'OFF'}\nChannel: ${channelMention(cfg.welcome.channelId)}\nMessage: ${cfg.welcome.message}`,
            ephemeral: true
          });
        }

        save();

        return interaction.reply({
          content:
            'Welcome settings saved.',
          ephemeral: true
        });
      }

      // --------------------------------------------------------
      // VERIFICATION
      // --------------------------------------------------------

      if (
        name === 'verification'
      ) {
        if (
          !await requireManager(
            interaction
          )
        ) {
          return;
        }

        const subcommand =
          interaction.options.getSubcommand();

        if (
          subcommand === 'setup'
        ) {
          const channel =
            interaction.options
              .getChannel(
                'channel'
              );

          const role =
            interaction.options
              .getRole(
                'role'
              );

          if (
            interaction.guild
              .members.me
              .roles.highest
              .position <=
            role.position
          ) {
            return interaction.reply({
              content:
                'My role must be above the verification role.',
              ephemeral: true
            });
          }

          cfg.verification = {
            enabled: true,
            channelId:
              channel.id,
            roleId:
              role.id
          };

          const row =
            new ActionRowBuilder()
              .addComponents(
                new ButtonBuilder()
                  .setCustomId(
                    'verify_member'
                  )
                  .setLabel(
                    'Verify'
                  )
                  .setStyle(
                    ButtonStyle.Success
                  )
              );

          await channel.send({
            embeds: [
              new EmbedBuilder()
                .setTitle(
                  'Verification'
                )
                .setDescription(
                  'Click the button below to verify.'
                )
                .setTimestamp()
            ],

            components: [row]
          });
        }

        else if (
          subcommand === 'disable'
        ) {
          cfg.verification.enabled =
            false;
        }

        else {
          return interaction.reply({
            content:
              `Verification: ${cfg.verification.enabled ? 'ON' : 'OFF'}\nRole: ${roleMention(cfg.verification.roleId)}\nChannel: ${channelMention(cfg.verification.channelId)}`,
            ephemeral: true
          });
        }

        save();

        return interaction.reply({
          content:
            'Verification settings saved.',
          ephemeral: true
        });
      }

      // --------------------------------------------------------
      // REACTION ROLES
      // --------------------------------------------------------

      if (
        name ===
        'autoreactionrole'
      ) {
        if (
          !await requireManager(
            interaction
          )
        ) {
          return;
        }

        const subcommand =
          interaction.options.getSubcommand();

        if (
          subcommand === 'list'
        ) {
          return interaction.reply({
            content:
              cfg.reactionRoles.length
                ? cfg.reactionRoles
                    .map(
                      reactionRole =>
                        `Message ${reactionRole.messageId} | ${reactionRole.emoji} → ${roleMention(reactionRole.roleId)}`
                    )
                    .join('\n')
                : 'No reaction roles.',

            ephemeral: true
          });
        }

        const messageId =
          interaction.options
            .getString(
              'message_id'
            );

        const rawEmoji =
          interaction.options
            .getString(
              'emoji'
            );

        const customEmoji =
          rawEmoji.match(
            /^<a?:[^:>]+:(\d+)>$/
          );

        const key =
          customEmoji
            ? customEmoji[1]
            : rawEmoji;

        if (
          subcommand === 'add'
        ) {
          const role =
            interaction.options
              .getRole(
                'role'
              );

          if (
            interaction.guild
              .members.me
              .roles.highest
              .position <=
            role.position
          ) {
            return interaction.reply({
              content:
                'My role must be above that role.',
              ephemeral: true
            });
          }

          const message =
            await interaction.channel
              .messages
              .fetch(
                messageId
              )
              .catch(
                () => null
              );

          if (!message) {
            return interaction.reply({
              content:
                'Message not found in this channel.',
              ephemeral: true
            });
          }

          if (
            !cfg.reactionRoles.some(
              item =>
                item.messageId ===
                  messageId &&
                item.emoji === key
            )
          ) {
            cfg.reactionRoles.push({
              messageId,
              emoji: key,
              roleId:
                role.id
            });

            await message
              .react(
                rawEmoji
              )
              .catch(() => {});
          }

          save();

          return interaction.reply({
            content:
              'Reaction role added.',
            ephemeral: true
          });
        }

        if (
          subcommand === 'remove'
        ) {
          const before =
            cfg.reactionRoles.length;

          cfg.reactionRoles =
            cfg.reactionRoles
              .filter(
                item =>
                  !(
                    item.messageId ===
                      messageId &&
                    item.emoji ===
                      key
                  )
              );

          save();

          return interaction.reply({
            content:
              before ===
              cfg.reactionRoles.length
                ? 'Not found.'
                : 'Removed.',

            ephemeral: true
          });
        }
      }

      // --------------------------------------------------------
      // LEADERBOARD
      // --------------------------------------------------------

      if (
        name === 'leaderboard'
      ) {
        const subcommand =
          interaction.options.getSubcommand();

        if (
          subcommand === 'top'
        ) {
          const limit =
            interaction.options
              .getInteger(
                'limit'
              ) || 10;

          const rows =
            Object.entries(
              cfg.leaderboard.counts
            )
              .sort(
                (a, b) =>
                  b[1] - a[1]
              )
              .slice(
                0,
                limit
              );

          return interaction.reply({
            content:
              rows.length
                ? rows
                    .map(
                      ([id, count], index) =>
                        `**${index + 1}.** ${fmtUser(id)} — ${count} messages`
                    )
                    .join('\n')
                : 'No messages counted yet.'
          });
        }

        if (
          !await requireManager(
            interaction
          )
        ) {
          return;
        }

        if (
          subcommand === 'reset'
        ) {
          cfg.leaderboard.counts =
            {};
        }

        if (
          subcommand === 'enable'
        ) {
          cfg.leaderboard.enabled =
            true;
        }

        if (
          subcommand === 'disable'
        ) {
          cfg.leaderboard.enabled =
            false;
        }

        if (
          subcommand === 'status'
        ) {
          return interaction.reply({
            content:
              `Leaderboard: ${cfg.leaderboard.enabled ? 'ON' : 'OFF'}`,
            ephemeral: true
          });
        }

        save();

        return interaction.reply({
          content:
            'Leaderboard saved.',
          ephemeral: true
        });
      }

      // --------------------------------------------------------
      // ADS
      // --------------------------------------------------------

      if (
        name === 'ads'
      ) {
        if (
          !isOwner(
            interaction.user.id
          )
        ) {
          return interaction.reply({
            content:
              'Owner only.',
            ephemeral: true
          });
        }

        const subcommand =
          interaction.options.getSubcommand();

        if (
          subcommand === 'set' ||
          subcommand === 'message'
        ) {
          cfg.ads.message =
            interaction.options
              .getString(
                'message'
              );
        }

        else if (
          subcommand === 'interval'
        ) {
          cfg.ads.intervalMinutes =
            interaction.options
              .getInteger(
                'minutes'
              );
        }

        else if (
          subcommand === 'enable'
        ) {
          cfg.ads.enabled =
            true;
        }

        else if (
          subcommand === 'disable'
        ) {
          cfg.ads.enabled =
            false;
        }

        else if (
          subcommand === 'status'
        ) {
          return interaction.reply({
            content:
              `Ads: ${cfg.ads.enabled ? 'ON' : 'OFF'}\nInterval: ${cfg.ads.intervalMinutes} min\nMessage: ${cfg.ads.message || 'Not set'}`,
            ephemeral: true
          });
        }

        else if (
          subcommand === 'broadcast'
        ) {
          await broadcastAd(
            interaction.guild,
            cfg
          );

          return interaction.reply({
            content:
              'Advertisement broadcast attempted.',
            ephemeral: true
          });
        }

        save();

        return interaction.reply({
          content:
            'Ads saved.',
          ephemeral: true
        });
      }

      // --------------------------------------------------------
      // AI
      // --------------------------------------------------------

      if (
        name === 'ai'
      ) {
        const subcommand =
          interaction.options.getSubcommand();

        if (
          subcommand === 'reset'
        ) {
          aiHistory.delete(
            interaction.user.id
          );

          return interaction.reply({
            content:
              'Your AI conversation has been reset.',
            ephemeral: true
          });
        }

        if (!OPENAI_KEY) {
          return interaction.reply({
            content:
              'AI is not configured. Add OPENAI_API_KEY to the hosting environment.',
            ephemeral: true
          });
        }

        await interaction.deferReply();

        const prompt =
          interaction.options
            .getString(
              'prompt'
            );

        let history =
          aiHistory.get(
            interaction.user.id
          ) || [];

        history.push({
          role: 'user',
          content: prompt
        });

        history =
          history.slice(-12);

        try {
          const response =
            await fetch(
              'https://api.openai.com/v1/responses',
              {
                method: 'POST',

                headers: {
                  Authorization:
                    `Bearer ${OPENAI_KEY}`,

                  'Content-Type':
                    'application/json'
                },

                body: JSON.stringify({
                  model:
                    OPENAI_MODEL,

                  input:
                    history.map(
                      item => ({
                        role:
                          item.role,

                        content:
                          item.content
                      })
                    )
                })
              }
            );

          const data =
            await response.json();

          if (!response.ok) {
            throw new Error(
              data.error?.message ||
              `OpenAI HTTP ${response.status}`
            );
          }

          const text =
            data.output_text ||
            data.output
              ?.flatMap(
                item =>
                  item.content || []
              )
              .filter(
                item =>
                  item.type ===
                  'output_text'
              )
              .map(
                item =>
                  item.text
              )
              .join('') ||
            'No response.';

          history.push({
            role: 'assistant',
            content: text
          });

          aiHistory.set(
            interaction.user.id,
            history.slice(-12)
          );

          return interaction.editReply(
            truncate(
              text,
              1900
            )
          );
        } catch (error) {
          return interaction.editReply(
            `AI error: ${error.message}`
          );
        }
      }
    } catch (error) {
      console.error(
        'interaction error:',
        error
      );

      const message =
        `An error occurred: ${error.message}`;

      if (
        interaction.deferred ||
        interaction.replied
      ) {
        await interaction
          .editReply({
            content: message
          })
          .catch(() => {});
      } else {
        await interaction
          .reply({
            content: message,
            ephemeral: true
          })
          .catch(() => {});
      }
    }
  }
);

// ============================================================
// BUTTONS
// ============================================================

async function handleButton(
  interaction
) {
  try {
    if (!interaction.guild) {
      return interaction.reply({
        content:
          'This button only works in a server.',
        ephemeral: true
      });
    }

    const cfg =
      gc(interaction.guild.id);

    // --------------------------------------------------------
    // CREATE TICKET
    // --------------------------------------------------------

    if (
      interaction.customId ===
      'ticket_create'
    ) {
      const channel =
        await createTicket(
          interaction.guild,
          interaction.user,
          'Support'
        );

      return interaction.reply({
        content:
          channel
            ? `Ticket created: ${channel}`
            : 'You already have an active ticket.',
        ephemeral: true
      });
    }

    // --------------------------------------------------------
    // VERIFICATION
    // --------------------------------------------------------

    if (
      interaction.customId ===
      'verify_member'
    ) {
      if (
        !cfg.verification.enabled
      ) {
        return interaction.reply({
          content:
            'Verification is disabled.',
          ephemeral: true
        });
      }

      const role =
        interaction.guild.roles.cache.get(
          cfg.verification.roleId
        );

      if (!role) {
        return interaction.reply({
          content:
            'Verification role no longer exists.',
          ephemeral: true
        });
      }

      if (
        interaction.guild.members.me
          .roles.highest.position <=
        role.position
      ) {
        return interaction.reply({
          content:
            'Bot role hierarchy prevents verification.',
          ephemeral: true
        });
      }

      await interaction.member
        .roles
        .add(role);

      await sendLog(
        interaction.guild,
        'verification',
        `${fmtUser(interaction.user.id)} verified.`
      );

      return interaction.reply({
        content:
          '✅ You are verified!',
        ephemeral: true
      });
    }

    // --------------------------------------------------------
    // TICKET CLAIM / CLOSE / LOCK
    // --------------------------------------------------------

    if (
      [
        'ticket_claim',
        'ticket_close',
        'ticket_lock'
      ].includes(
        interaction.customId
      )
    ) {
      if (
        !isStaff(
          interaction.member,
          cfg
        )
      ) {
        return interaction.reply({
          content:
            'Staff only.',
          ephemeral: true
        });
      }

      const ticket =
        ticketForChannel(
          cfg,
          interaction.channelId
        );

      if (!ticket) {
        return interaction.reply({
          content:
            'Not a ticket.',
          ephemeral: true
        });
      }

      if (
        interaction.customId ===
        'ticket_claim'
      ) {
        ticket.claimedBy =
          ticket.claimedBy
            ? null
            : interaction.user.id;

        save();

        return interaction.reply({
          content:
            ticket.claimedBy
              ? `Claimed by ${interaction.user}.`
              : 'Unclaimed.',
          ephemeral: false
        });
      }

      if (
        interaction.customId ===
        'ticket_close'
      ) {
        await closeTicket(
          interaction.guild,
          ticket,
          interaction.user
        );

        return interaction.reply({
          content:
            'Closed.',
          ephemeral: true
        });
      }

      ticket.locked =
        !ticket.locked;

      await interaction.channel
        .permissionOverwrites
        .edit(
          ticket.ownerId,
          {
            SendMessages:
              !ticket.locked
          }
        )
        .catch(() => {});

      save();

      return interaction.reply({
        content:
          ticket.locked
            ? 'Locked.'
            : 'Unlocked.',
        ephemeral: true
      });
    }

    // --------------------------------------------------------
    // TICKET TRANSCRIPT
    // --------------------------------------------------------

    if (
      interaction.customId ===
      'ticket_transcript'
    ) {
      if (
        !isStaff(
          interaction.member,
          cfg
        )
      ) {
        return interaction.reply({
          content:
            'Staff only.',
          ephemeral: true
        });
      }

      const ticket =
        ticketForChannel(
          cfg,
          interaction.channelId
        );

      if (!ticket) {
        return interaction.reply({
          content:
            'Not a ticket.',
          ephemeral: true
        });
      }

      const buffer =
        await makeTranscript(
          interaction.channel,
          ticket
        );

      const channel =
        logChannel(
          interaction.guild,
          'tickets'
        );

      if (channel) {
        await channel.send({
          files: [
            {
              attachment: buffer,
              name:
                `${safeName(interaction.channel.name)}.txt`
            }
          ]
        }).catch(() => {});
      }

      return interaction.reply({
        content:
          channel
            ? 'Transcript sent.'
            : 'Ticket logs not configured.',
        ephemeral: true
      });
    }

    // --------------------------------------------------------
    // REOPEN
    // --------------------------------------------------------

    if (
      interaction.customId ===
      'ticket_reopen'
    ) {
      if (
        !isStaff(
          interaction.member,
          cfg
        )
      ) {
        return interaction.reply({
          content:
            'Staff only.',
          ephemeral: true
        });
      }

      const ticket =
        ticketForChannel(
          cfg,
          interaction.channelId
        );

      if (!ticket) {
        return interaction.reply({
          content:
            'Not a ticket.',
          ephemeral: true
        });
      }

      ticket.status = 'open';
      ticket.locked = false;

      await interaction.channel
        .permissionOverwrites
        .edit(
          ticket.ownerId,
          {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
          }
        )
        .catch(() => {});

      save();

      return interaction.reply({
        content:
          'Ticket reopened.',
        ephemeral: true
      });
    }

    // --------------------------------------------------------
    // DELETE
    // --------------------------------------------------------

    if (
      interaction.customId ===
      'ticket_delete'
    ) {
      if (
        !isStaff(
          interaction.member,
          cfg
        )
      ) {
        return interaction.reply({
          content:
            'Staff only.',
          ephemeral: true
        });
      }

      const ticket =
        ticketForChannel(
          cfg,
          interaction.channelId
        );

      if (ticket) {
        ticket.status =
          'deleted';

        save();
      }

      await interaction.reply({
        content:
          'Deleting...',
        ephemeral: true
      });

      return interaction.channel
        .delete()
        .catch(() => {});
    }

    // --------------------------------------------------------
    // SUGGESTION BUTTONS
    // --------------------------------------------------------

    if (
      interaction.customId
        .startsWith(
          'suggest_'
        )
    ) {
      if (
        !isStaff(
          interaction.member,
          cfg
        )
      ) {
        return interaction.reply({
          content:
            'Staff only.',
          ephemeral: true
        });
      }

      const parts =
        interaction.customId
          .split('_');

      const action =
        parts[1];

      const id =
        parts
          .slice(2)
          .join('_');

      const suggestion =
        cfg.suggestionsData[id];

      if (!suggestion) {
        return interaction.reply({
          content:
            'Suggestion not found.',
          ephemeral: true
        });
      }

      suggestion.status =
        action === 'approve'
          ? 'approved'
          : 'declined';

      suggestion.moderatorId =
        interaction.user.id;

      suggestion.decidedAt =
        Date.now();

      save();

      const embed =
        new EmbedBuilder()
          .setTitle(
            '💡 Suggestion'
          )
          .setDescription(
            suggestion.text
          )
          .addFields(
            {
              name: 'Author',
              value:
                fmtUser(
                  suggestion.userId
                )
            },
            {
              name: 'Status',
              value:
                suggestion.status
            },
            {
              name: 'Moderator',
              value:
                fmtUser(
                  interaction.user.id
                )
            }
          )
          .setTimestamp();

      await interaction.message
        .edit({
          embeds: [embed],
          components: []
        })
        .catch(() => {});

      await sendLog(
        interaction.guild,
        'suggestion',
        `Suggestion ${suggestion.status}: ${truncate(suggestion.text, 1000)} by ${fmtUser(interaction.user.id)}`
      );

      return interaction.reply({
        content:
          `Suggestion ${suggestion.status}.`,
        ephemeral: true
      });
    }
  } catch (error) {
    console.error(
      'button error:',
      error
    );

    if (
      interaction.replied ||
      interaction.deferred
    ) {
      return interaction
        .editReply({
          content:
            `Error: ${error.message}`
        })
        .catch(() => {});
    }

    return interaction.reply({
      content:
        `Error: ${error.message}`,
      ephemeral: true
    }).catch(() => {});
  }
}

// ============================================================
// TRACKERS
// ============================================================

const spamTracker =
  new Map();

const repeatTracker =
  new Map();

const raidTracker =
  new Map();

const auditTracker =
  new Map();

const aiHistory =
  new Map();

// ============================================================
// AUTOMOD
// ============================================================

function reactionKey(reaction) {
  return (
    reaction.emoji.id ||
    reaction.emoji.name ||
    null
  );
}

function automodIgnored(
  member,
  channel,
  cfg
) {
  return !!member && (
    trusted(
      member,
      cfg
    ) ||

    cfg.automod
      .ignoredRoleIds
      .some(
        id =>
          member.roles.cache.has(
            id
          )
      ) ||

    cfg.automod
      .ignoredChannelIds
      .includes(
        channel.id
      )
  );
}

async function automodMessage(
  message
) {
  if (
    !message.guild ||
    message.author.bot ||
    !message.member
  ) {
    return false;
  }

  const cfg =
    gc(message.guild.id);

  if (
    !cfg.automod.enabled ||
    automodIgnored(
      message.member,
      message.channel,
      cfg
    )
  ) {
    return false;
  }

  const content =
    message.content || '';

  const lower =
    content.toLowerCase();

  let reason = null;

  // INVITES
  if (
    cfg.automod.invites &&
    /(discord\.gg\/|discord(?:app)?\.com\/invite\/)/i
      .test(content)
  ) {
    reason =
      'Discord invite link';
  }

  // MASS MENTIONS
  if (
    cfg.automod.massMentions &&
    (
      message.mentions.everyone ||
      message.mentions.users.size +
        message.mentions.roles.size >= 5
    )
  ) {
    reason =
      'Mass mentions';
  }

  // BAD WORDS
  if (
    cfg.automod.badWords.some(
      word =>
        word &&
        lower.includes(word)
    )
  ) {
    reason =
      'Blocked word';
  }

  // CAPS
  const letters =
    content.replace(
      /[^a-zA-Z]/g,
      ''
    );

  if (
    cfg.automod.caps &&
    letters.length >= 8
  ) {
    const caps =
      [...letters]
        .filter(
          character =>
            character ===
            character.toUpperCase()
        )
        .length;

    if (
      caps / letters.length >=
      0.75
    ) {
      reason =
        'Excessive caps';
    }
  }

  // SPAM
  const key =
    `${message.guild.id}:${message.author.id}`;

  const now =
    Date.now();

  let spam =
    spamTracker.get(key) || [];

  spam =
    spam.filter(
      timestamp =>
        now - timestamp <
        cfg.automod.spamWindow
    );

  spam.push(now);

  spamTracker.set(
    key,
    spam
  );

  if (
    cfg.automod.spam &&
    spam.length >=
      cfg.automod.spamLimit
  ) {
    reason =
      'Spam/flood';
  }

  // REPEATED
  let repeated =
    repeatTracker.get(key) || {
      text: '',
      count: 0,
      at: 0
    };

  if (
    repeated.text === lower &&
    now - repeated.at < 30000
  ) {
    repeated.count++;
  } else {
    repeated = {
      text: lower,
      count: 1,
      at: now
    };
  }

  repeated.at = now;

  repeatTracker.set(
    key,
    repeated
  );

  if (
    cfg.automod.repeated &&
    repeated.count >=
      cfg.automod.repeatedLimit
  ) {
    reason =
      'Repeated messages';
  }

  if (!reason) {
    return false;
  }

  await message.delete()
    .catch(() => {});

  await sendLog(
    message.guild,
    'automod',
    `AutoMod action on ${fmtUser(message.author.id)}: **${reason}**
Channel: ${message.channel}
Content: ${truncate(content, 500)}`
  );

  try {
    if (
      cfg.automod.action ===
      'timeout'
    ) {
      if (
        botCanAct(
          message.guild,
          message.member
        )
      ) {
        await message.member
          .timeout(
            cfg.automod
              .timeoutSeconds *
              1000,
            `AutoMod: ${reason}`
          );
      }
    }

    else if (
      cfg.automod.action ===
      'warn'
    ) {
      await addWarning(
        message.guild,
        message.author.id,
        client.user.id,
        `AutoMod: ${reason}`
      );
    }
  } catch (error) {
    console.error(
      'automod action:',
      error.message
    );
  }

  return true;
}

// ============================================================
// MESSAGE CREATE
// ============================================================

client.on(
  'messageCreate',
  async message => {
    try {
      // DM → TICKET
      if (
        message.channel.isDMBased()
      ) {
        if (
          message.author.bot
        ) {
          return;
        }

        let sent = 0;

        for (
          const guild of
            client.guilds.cache.values()
        ) {
          const cfg =
            gc(guild.id);

          const ticket =
            Object.values(
              cfg.tickets
            ).find(
              item =>
                item.ownerId ===
                  message.author.id &&
                item.status ===
                  'open'
            );

          if (!ticket) {
            continue;
          }

          const channel =
            guild.channels.cache.get(
              ticket.channelId
            );

          if (!channel) {
            continue;
          }

          await channel.send({
            content:
              `📩 **${message.author.tag} via DM:**\n${truncate(message.content, 1900)}`,

            files:
              message.attachments.map(
                attachment =>
                  attachment.url
              )
          }).catch(() => {});

          sent++;
        }

        if (!sent) {
          await message.author
            .send(
              'I could not find an active AkiyO support ticket for you.'
            )
            .catch(() => {});
        }

        return;
      }

      if (
        message.author.bot ||
        !message.guild
      ) {
        return;
      }

      const cfg =
        gc(message.guild.id);

      // LEADERBOARD
      if (
        cfg.leaderboard.enabled
      ) {
        cfg.leaderboard
          .counts[
            message.author.id
          ] =
          (
            cfg.leaderboard
              .counts[
                message.author.id
              ] || 0
          ) + 1;

        save();
      }

      // STAFF MESSAGE → USER DM
      const ticket =
        ticketForChannel(
          cfg,
          message.channelId
        );

      if (
        ticket &&
        ticket.status === 'open' &&
        message.author.id !==
          ticket.ownerId
      ) {
        const owner =
          await client.users
            .fetch(
              ticket.ownerId
            )
            .catch(
              () => null
            );

        if (owner) {
          await owner
            .send(
              `📩 **${message.guild.name} / #${message.channel.name} — ${message.author.tag}:**\n${truncate(message.content, 1800)}`
            )
            .catch(() => {});
        }
      }

      // AUTOMOD
      await automodMessage(
        message
      );
    } catch (error) {
      console.error(
        'messageCreate:',
        error
      );
    }
  }
);

// ============================================================
// REACTION ROLES
// ============================================================

client.on(
  'messageReactionAdd',
  async (
    reaction,
    user
  ) => {
    try {
      if (
        user.bot ||
        !reaction.message.guild
      ) {
        return;
      }

      const guild =
        reaction.message.guild;

      const cfg =
        gc(guild.id);

      const key =
        reactionKey(
          reaction
        );

      const reactionRole =
        cfg.reactionRoles.find(
          item =>
            item.messageId ===
              reaction.message.id &&
            item.emoji === key
        );

      if (!reactionRole) {
        return;
      }

      const role =
        guild.roles.cache.get(
          reactionRole.roleId
        );

      if (
        !role ||
        guild.members.me
          .roles.highest
          .position <=
          role.position
      ) {
        return;
      }

      const member =
        await guild.members
          .fetch(
            user.id
          );

      await member.roles
        .add(role);

      await sendLog(
        guild,
        'reactionRoles',
        `${fmtUser(user.id)} received ${roleMention(role.id)} from reaction.`
      );
    } catch (error) {
      console.error(
        'reaction add:',
        error.message
      );
    }
  }
);

client.on(
  'messageReactionRemove',
  async (
    reaction,
    user
  ) => {
    try {
      if (
        user.bot ||
        !reaction.message.guild
      ) {
        return;
      }

      const guild =
        reaction.message.guild;

      const cfg =
        gc(guild.id);

      const key =
        reactionKey(
          reaction
        );

      const reactionRole =
        cfg.reactionRoles.find(
          item =>
            item.messageId ===
              reaction.message.id &&
            item.emoji === key
        );

      if (!reactionRole) {
        return;
      }

      const role =
        guild.roles.cache.get(
          reactionRole.roleId
        );

      if (!role) {
        return;
      }

      const member =
        await guild.members
          .fetch(
            user.id
          );

      await member.roles
        .remove(role);

      await sendLog(
        guild,
        'reactionRoles',
        `${fmtUser(user.id)} lost ${roleMention(role.id)} after removing reaction.`
      );
    } catch (error) {
      console.error(
        'reaction remove:',
        error.message
      );
    }
  }
);

// ============================================================
// MEMBER JOIN
// ============================================================

client.on(
  'guildMemberAdd',
  async member => {
    try {
      const cfg =
        gc(member.guild.id);

      const now =
        Date.now();

      const key =
        member.guild.id;

      let joins =
        raidTracker.get(key) ||
        [];

      joins =
        joins.filter(
          timestamp =>
            now - timestamp <
            cfg.security.raidWindow
        );

      joins.push(now);

      raidTracker.set(
        key,
        joins
      );

      if (
        cfg.security.enabled &&
        cfg.security.raidEnabled &&
        joins.length >=
          cfg.security.raidLimit
      ) {
        await sendLog(
          member.guild,
          'security',
          `🚨 Possible raid detected: **${joins.length} joins** in ${cfg.security.raidWindow}ms.`
        );
      }

      // AUTOROLE
      if (
        cfg.autoroleId
      ) {
        const role =
          member.guild.roles.cache.get(
            cfg.autoroleId
          );

        if (
          role &&
          member.guild.members.me
            .roles.highest
            .position >
            role.position
        ) {
          await member.roles
            .add(role)
            .catch(
              error =>
                console.error(
                  'autorole:',
                  error.message
                )
            );
        }
      }

      // WELCOME
      if (
        cfg.welcome.enabled &&
        cfg.welcome.channelId
      ) {
        const channel =
          member.guild.channels.cache.get(
            cfg.welcome.channelId
          );

        if (channel) {
          const text =
            cfg.welcome.message
              .replaceAll(
                '{user}',
                String(member)
              )
              .replaceAll(
                '{username}',
                member.user.username
              )
              .replaceAll(
                '{server}',
                member.guild.name
              )
              .replaceAll(
                '{count}',
                String(
                  member.guild.memberCount
                )
              );

          await channel.send({
            content: text
          }).catch(() => {});
        }
      }

      await sendLog(
        member.guild,
        'members',
        `Member joined: ${member.user.tag} (${member.id}).`
      );
    } catch (error) {
      console.error(
        'guildMemberAdd:',
        error
      );
    }
  }
);

// ============================================================
// MEMBER LEAVE
// ============================================================

client.on(
  'guildMemberRemove',
  member =>
    sendLog(
      member.guild,
      'members',
      `Member left: ${member.user?.tag || member.id} (${member.id}).`
    )
);

// ============================================================
// AUDIT LOG / SECURITY
// ============================================================

client.on(
  'guildAuditLogEntryCreate',
  async (
    entry,
    guild
  ) => {
    try {
      const cfg =
        gc(guild.id);

      if (
        cfg.audit.enabled
      ) {
        await sendLog(
          guild,
          'audit',
          `Audit action **${entry.action}**
Executor: ${fmtUser(entry.executorId)}
Target: ${fmtUser(entry.targetId)}`
        );
      }

      if (
        !cfg.security.enabled
      ) {
        return;
      }

      const executor =
        entry.executorId
          ? await guild.members
              .fetch(
                entry.executorId
              )
              .catch(
                () => null
              )
          : null;

      if (
        !executor ||
        executor.id ===
          client.user.id ||
        isOwner(executor.id) ||
        trusted(
          executor,
          cfg
        )
      ) {
        return;
      }

      const destructive =
        new Set([
          AuditLogEvent.MemberBanAdd,
          AuditLogEvent.MemberKick,
          AuditLogEvent.ChannelDelete,
          AuditLogEvent.ChannelCreate,
          AuditLogEvent.RoleDelete,
          AuditLogEvent.RoleCreate,
          AuditLogEvent.WebhookCreate,
          AuditLogEvent.BotAdd
        ]);

      if (
        !destructive.has(
          entry.action
        )
      ) {
        return;
      }

      const targetId =
        entry.targetId;

      // PROTECTED ROLE
      if (
        entry.action ===
          AuditLogEvent.RoleDelete &&
        targetId &&
        cfg.security
          .protectedRoleIds
          .includes(
            targetId
          )
      ) {
        await takeSecurityAction(
          guild,
          executor,
          `Protected role deleted: ${targetId}`,
          cfg
        );

        return;
      }

      // PROTECTED CHANNEL
      if (
        (
          entry.action ===
            AuditLogEvent.ChannelDelete ||
          entry.action ===
            AuditLogEvent.ChannelCreate
        ) &&
        targetId &&
        cfg.security
          .protectedChannelIds
          .includes(
            targetId
          )
      ) {
        await takeSecurityAction(
          guild,
          executor,
          `Protected channel action: ${targetId}`,
          cfg
        );

        return;
      }

      const key =
        `${guild.id}:${executor.id}`;

      const now =
        Date.now();

      let actions =
        auditTracker.get(key) ||
        [];

      actions =
        actions.filter(
          timestamp =>
            now - timestamp <
            cfg.security
              .massActionWindow
        );

      actions.push(now);

      auditTracker.set(
        key,
        actions
      );

      if (
        actions.length >=
        cfg.security
          .massActionLimit
      ) {
        await takeSecurityAction(
          guild,
          executor,
          `Mass destructive audit activity (${actions.length} actions)`,
          cfg
        );
      }

      // UNTRUSTED BOT
      if (
        entry.action ===
        AuditLogEvent.BotAdd
      ) {
        const bot =
          targetId
            ? await guild.members
                .fetch(
                  targetId
                )
                .catch(
                  () => null
                )
            : null;

        if (
          bot?.user?.bot &&
          !cfg.security
            .trustedBotIds
            .includes(
              bot.id
            )
        ) {
          await takeSecurityAction(
            guild,
            executor,
            `Untrusted bot added: ${bot.user.tag}`,
            cfg
          );
        }
      }
    } catch (error) {
      console.error(
        'audit:',
        error.message
      );
    }
  }
);

async function takeSecurityAction(
  guild,
  member,
  reason,
  cfg
) {
  await sendLog(
    guild,
    'security',
    `🛡️ Security triggered for ${fmtUser(member.id)}
${reason}
Action: **${cfg.security.action}**`
  );

  try {
    if (
      cfg.security.action ===
      'ban'
    ) {
      if (
        botCanAct(
          guild,
          member
        )
      ) {
        await member.ban({
          reason:
            `AkiyO Security: ${reason}`,
          deleteMessageSeconds:
            86400
        });
      }
    }

    else if (
      cfg.security.action ===
      'kick'
    ) {
      if (
        botCanAct(
          guild,
          member
        )
      ) {
        await member.kick(
          `AkiyO Security: ${reason}`
        );
      }
    }
  } catch (error) {
    console.error(
      'security action:',
      error.message
    );
  }
}

// ============================================================
// ADS
// ============================================================

async function broadcastAd(
  guild,
  cfg
) {
  if (!cfg.ads.message) {
    return;
  }

  let channels = [];

  if (
    cfg.ads.channelIds.length
  ) {
    channels =
      cfg.ads.channelIds
        .map(
          id =>
            guild.channels.cache.get(
              id
            )
        )
        .filter(Boolean);
  } else {
    channels =
      guild.channels.cache
        .filter(
          channel =>
            channel.type ===
              ChannelType.GuildText &&
            channel.isTextBased()
        )
        .first(3);
  }

  for (
    const channel of
      Array.from(
        channels || []
      )
  ) {
    await channel.send({
      content:
        cfg.ads.message,

      allowedMentions: {
        parse: []
      }
    }).catch(() => {});
  }
}

setInterval(
  async () => {
    for (
      const guild of
        client.guilds.cache.values()
    ) {
      const cfg =
        gc(guild.id);

      if (
        !cfg.ads.enabled ||
        !cfg.ads.message
      ) {
        continue;
      }

      if (
        !globalThis.__akiyoAds
      ) {
        globalThis.__akiyoAds =
          {};
      }

      const key =
        guild.id;

      const now =
        Date.now();

      if (
        !globalThis
          .__akiyoAds[key] ||
        now -
          globalThis
            .__akiyoAds[key] >=
          cfg.ads
            .intervalMinutes *
            60000
      ) {
        globalThis
          .__akiyoAds[key] =
          now;

        await broadcastAd(
          guild,
          cfg
        );
      }
    }
  },
  60000
);

// ============================================================
// HTTP SERVER
// ============================================================

const server =
  http.createServer(
    (request, response) => {
      response.writeHead(
        200,
        {
          'Content-Type':
            'text/plain'
        }
      );

      response.end(
        'AkiyO is online.'
      );
    }
  );

server.listen(
  PORT,
  '0.0.0.0',
  () =>
    console.log(
      `HTTP server listening on ${PORT}`
    )
);

// ============================================================
// STARTUP
// ============================================================

client.once(
  'ready',
  async () => {
    console.log(
      `AkiyO logged in as ${client.user.tag}`
    );

    console.log(
      `Serving ${client.guilds.cache.size} guild(s).`
    );

    for (
      const guild of
        client.guilds.cache.values()
    ) {
      gc(guild.id);
    }

    save();

    try {
      await registerCommands();
    } catch (error) {
      console.error(
        'Slash command registration failed:',
        error
      );
    }
  }
);

client.on(
  'error',
  error =>
    console.error(
      'Discord client error:',
      error
    )
);

process.on(
  'unhandledRejection',
  error =>
    console.error(
      'Unhandled rejection:',
      error
    )
);

process.on(
  'uncaughtException',
  error =>
    console.error(
      'Uncaught exception:',
      error
    )
);

// ============================================================
// LOGIN
// ============================================================

client.login(
  TOKEN
).catch(
  error => {
    console.error(
      'Discord login failed:',
      error
    );

    process.exit(1);
  }
);
