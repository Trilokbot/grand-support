const http = require('http');
const fs = require('fs');
const path = require('path');

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

/* =========================================================
   AKIYO
   Professional Discord Support • Moderation • Security
   ========================================================= */

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || '1542750606739898428';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.5';
const PORT = Number(process.env.PORT || 10000);

if (!TOKEN) {
  console.error('❌ Missing DISCORD_TOKEN environment variable.');
  process.exit(1);
}

/* ========================= HEALTH SERVER ========================= */

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('AKIYO BOT ONLINE');
}).listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 Health server listening on ${PORT}`);
});

/* ========================= CLIENT ========================= */

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

/* ========================= DATABASE ========================= */

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'config.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const clone = obj => JSON.parse(JSON.stringify(obj));

function merge(a, b) {
  for (const key of Object.keys(b || {})) {
    if (
      b[key] &&
      typeof b[key] === 'object' &&
      !Array.isArray(b[key])
    ) {
      a[key] = merge(a[key] || {}, b[key]);
    } else if (b[key] !== undefined) {
      a[key] = b[key];
    }
  }
  return a;
}

const GDEFAULT = {
  logs: {
    all: null
  },

  support: {
    categoryId: null,
    staffRoleId: null,
    ticketLogChannelId: null
  },

  automod: {
    enabled: true,
    spamLimit: 6,
    spamWindow: 5000,
    repeatedLimit: 3,
    capsPercent: 75,
    userMentionsLimit: 5,
    roleMentionsLimit: 5,
    badWords: [],
    invites: true,
    links: false,
    massMentions: true,

    actions: {
      spam: 'timeout',
      invite: 'timeout',
      badword: 'delete',
      caps: 'delete',
      repeat: 'timeout',
      massmention: 'timeout'
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

    action: 'alert',

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
    message: 'Welcome {user} to {server}! You are member #{count}.'
  },

  verification: {
    enabled: false,
    channelId: null,
    roleId: null,
    messageId: null
  },

  reactionRoles: {},

  tickets: {
    records: {},
    panelChannelId: null,
    panelMessageId: null
  },

  ai: {
    enabled: true
  },

  audit: {
    history: []
  },

  configVersion: 2
};

let db = {};

try {
  db = fs.existsSync(DATA_FILE)
    ? JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
    : {};
} catch {
  db = {};
}

function gc(guild) {
  if (!db[guild.id]) {
    db[guild.id] = clone(GDEFAULT);
  } else {
    db[guild.id] = merge(clone(GDEFAULT), db[guild.id]);
  }

  return db[guild.id];
}

function save() {
  try {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(db, null, 2)
    );
  } catch (e) {
    console.error('Database save error:', e.message);
  }
}

/* ========================= UI ========================= */

const LOG_COLORS = {
  automod: 0xED4245,
  security: 0xFEE75C,
  moderation: 0xED4245,
  tickets: 0x5865F2,
  members: 0x57F287,
  messages: 0x5865F2,
  channels: 0x5865F2,
  roles: 0xEB459E,
  verification: 0x57F287,
  reactionRoles: 0xFEE75C,
  welcome: 0x57F287,
  announcements: 0x5865F2,
  config: 0xEB459E,
  audit: 0x5865F2,
  system: 0x5865F2,
  ai: 0x9B59B6
};

function safe(value, max = 1024) {
  return String(value ?? '-')
    .replace(/\u0000/g, '')
    .slice(0, max) || '-';
}

function field(name, value, inline = false) {
  return {
    name: safe(name, 256),
    value: safe(value, 1024),
    inline
  };
}

function tagOf(user) {
  if (!user) return 'Unknown';
  return `${user.tag || user.username || 'Unknown'} (${user.id})`;
}

function mention(id, type = 'user') {
  if (!id) return 'None';
  return type === 'role'
    ? `<@&${id}>`
    : `<@${id}>`;
}

function embed(title, description, color = 0x5865F2, guild = null) {
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

  e.setFooter({
    text: 'AkiyO • Professional Discord Management'
  });

  return e;
}

function result(
  title,
  description,
  color,
  guild,
  fields = []
) {
  const e = embed(
    title,
    description,
    color,
    guild
  );

  if (fields.length) {
    e.addFields(fields.slice(0, 25));
  }

  return e;
}

/*
  IMPORTANT LOADING FIX:
  If interaction was already deferred, edit it.
  Otherwise reply normally.
*/

async function reply(
  interaction,
  title,
  description,
  color = 0x57F287,
  fields = [],
  extra = {}
) {
  const payload = {
    embeds: [
      result(
        title,
        description,
        color,
        interaction.guild,
        fields
      )
    ],
    ...extra
  };

  if (interaction.deferred) {
    return interaction.editReply(payload);
  }

  if (interaction.replied) {
    return interaction.followUp(payload);
  }

  return interaction.reply(payload);
}

async function editReply(
  interaction,
  title,
  description,
  color = 0x57F287,
  fields = [],
  extra = {}
) {
  return interaction.editReply({
    embeds: [
      result(
        title,
        description,
        color,
        interaction.guild,
        fields
      )
    ],
    ...extra
  });
}

/* ========================= LOGGING ========================= */

async function logChannel(guild) {
  if (!guild) return null;

  const id = gc(guild).logs.all;

  if (!id) return null;

  return guild.channels.fetch(id).catch(() => null);
}

async function log(
  guild,
  type,
  title,
  fields = [],
  color
) {
  if (!guild) return;

  try {
    const ch = await logChannel(guild);

    if (!ch?.isTextBased()) return;

    const e = result(
      title,
      '',
      color || LOG_COLORS[type] || 0x5865F2,
      guild,
      fields
    );

    await ch.send({
      embeds: [e]
    }).catch(() => {});
  } catch (e) {
    console.error('Log error:', e.message);
  }
}

/*
  IMPORTANT:
  Command logging NEVER blocks the command response.
*/

function commandLog(interaction) {
  if (!interaction.guild) return;

  const options =
    (interaction.options?.data || [])
      .map(o => {
        const value =
          o.value ??
          o.user?.id ??
          o.channel?.id ??
          o.role?.id ??
          '';

        return `${o.name}: ${safe(value, 180)}`;
      })
      .join('\n') || 'No options';

  log(
    interaction.guild,
    'audit',
    '⚡ Command Executed',
    [
      field(
        'Command',
        `/${interaction.commandName}`
      ),
      field(
        'User',
        tagOf(interaction.user)
      ),
      field(
        'Channel',
        interaction.channel
          ? `${interaction.channel} (${interaction.channel.id})`
          : 'DM'
      ),
      field(
        'Options',
        options
      )
    ],
    0x5865F2
  ).catch(() => {});
}

/* ========================= PERMISSIONS ========================= */

function memberIsManager(member) {
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

function memberIsStaff(member) {
  if (!member) return false;

  const c = gc(member.guild);

  return (
    memberIsManager(member) ||
    (
      c.support.staffRoleId &&
      member.roles.cache.has(
        c.support.staffRoleId
      )
    )
  );
}

function trusted(guild, id) {
  const c = gc(guild);
  const member = guild.members.cache.get(id);

  return !!(
    member?.permissions.has(
      PermissionFlagsBits.Administrator
    ) ||
    c.security.trustedMembers.includes(id) ||
    c.security.trustedBots.includes(id) ||
    (
      c.security.trustedRoleId &&
      member?.roles.cache.has(
        c.security.trustedRoleId
      )
    )
  );
}

function canAct(interaction, target) {
  const me = interaction.guild.members.me;

  if (!me || !target) return false;

  if (target.id === interaction.user.id) {
    return false;
  }

  if (target.id === interaction.guild.ownerId) {
    return false;
  }

  return (
    target.roles.highest.position <
      me.roles.highest.position &&
    target.roles.highest.position <
      interaction.member.roles.highest.position
  );
}

/* ========================= DURATION ========================= */

function parseDuration(input) {
  const m = String(input || '')
    .trim()
    .match(/^(\d+)\s*(s|m|h|d)$/i);

  if (!m) return null;

  const n = Number(m[1]);
  const unit = m[2].toLowerCase();

  const multiplier = {
    s: 1000,
    m: 60000,
    h: 3600000,
    d: 86400000
  }[unit];

  const ms = n * multiplier;

  if (
    ms <= 0 ||
    ms > 28 * 86400000
  ) {
    return null;
  }

  return ms;
}

function actionDuration(guild, type) {
  return (
    gc(guild).automod.timeoutSeconds[type] ||
    60
  ) * 1000;
}

/* ========================= MODERATION ========================= */

async function recordPunishment(
  guild,
  userId,
  type,
  reason,
  moderatorId,
  duration = null
) {
  const c = gc(guild);

  c.punishments[userId] ??= [];

  c.punishments[userId].push({
    type,
    reason,
    moderatorId,
    time: Date.now(),
    duration
  });

  if (c.punishments[userId].length > 100) {
    c.punishments[userId] =
      c.punishments[userId].slice(-100);
  }

  save();
}

async function doWarn(
  member,
  reason,
  moderator
) {
  const c = gc(member.guild);

  c.warnings[member.id] ??= [];

  c.warnings[member.id].push({
    reason,
    moderatorId: moderator.id,
    time: Date.now()
  });

  const count =
    c.warnings[member.id].length;

  await recordPunishment(
    member.guild,
    member.id,
    'warn',
    reason,
    moderator.id
  );

  await log(
    member.guild,
    'moderation',
    '⚠️ Member Warned',
    [
      field(
        'Member',
        tagOf(member.user)
      ),
      field(
        'Moderator',
        tagOf(moderator)
      ),
      field(
        'Reason',
        reason
      ),
      field(
        'Warning Count',
        count
      )
    ],
    0xFEE75C
  );

  if (
    count === 3 &&
    member.moderatable
  ) {
    await member.timeout(
      10 * 60000,
      'Warning escalation: 3 warnings'
    ).catch(() => {});

    await recordPunishment(
      member.guild,
      member.id,
      'timeout',
      'Warning escalation: 3 warnings',
      moderator.id,
      600000
    );
  }

  if (
    count === 5 &&
    member.kickable
  ) {
    await member.kick(
      'Warning escalation: 5 warnings'
    ).catch(() => {});

    await recordPunishment(
      member.guild,
      member.id,
      'kick',
      'Warning escalation: 5 warnings',
      moderator.id
    );
  }

  if (
    count >= 7 &&
    member.bannable
  ) {
    await member.ban({
      reason:
        'Warning escalation: 7+ warnings'
    }).catch(() => {});

    await recordPunishment(
      member.guild,
      member.id,
      'ban',
      'Warning escalation: 7+ warnings',
      moderator.id
    );
  }

  return count;
}

/* ========================= AUTOMOD ========================= */

const spamTracker = new Map();
const repeatTracker = new Map();
const raidTracker = new Map();
const securityTracker = new Map();

function exemptAutoMod(member) {
  return memberIsStaff(member);
}

async function runAutoMod(message) {
  if (
    !message.guild ||
    !message.member ||
    message.author.bot
  ) return;

  const c =
    gc(message.guild).automod;

  if (
    !c.enabled ||
    exemptAutoMod(message.member)
  ) {
    return;
  }

  const text = message.content || '';
  const lower = text.toLowerCase();

  let type = null;
  let reason = '';

  if (
    c.invites &&
    /(discord\.gg\/|discord\.com\/invite\/)/i
      .test(text)
  ) {
    type = 'invite';
    reason = 'Discord invite link detected';
  }

  if (
    !type &&
    c.massMentions &&
    (
      message.mentions.everyone ||
      message.mentions.users.size >=
        c.userMentionsLimit ||
      message.mentions.roles.size >=
        c.roleMentionsLimit
    )
  ) {
    type = 'massmention';
    reason = 'Excessive mentions detected';
  }

  if (
    !type &&
    c.badWords.some(
      word =>
        word &&
        lower.includes(
          String(word).toLowerCase()
        )
    )
  ) {
    type = 'badword';
    reason = 'Blocked word detected';
  }

  if (
    !type &&
    c.capsPercent > 0
  ) {
    const letters =
      text.replace(/[^A-Za-z]/g, '');

    const caps =
      letters.replace(/[^A-Z]/g, '')
        .length;

    if (
      letters.length >= 8 &&
      (caps / letters.length) * 100 >=
        c.capsPercent
    ) {
      type = 'caps';
      reason =
        `Capitalization exceeded ${c.capsPercent}%`;
    }
  }

  const now = Date.now();
  const sid =
    `${message.guild.id}:${message.author.id}`;

  const spam =
    (spamTracker.get(sid) || [])
      .filter(
        t => now - t < c.spamWindow
      );

  spam.push(now);
  spamTracker.set(sid, spam);

  if (
    !type &&
    spam.length >= c.spamLimit
  ) {
    type = 'spam';
    reason =
      `${spam.length} messages within ${c.spamWindow / 1000}s`;

    spamTracker.set(sid, []);
  }

  const repeat =
    repeatTracker.get(sid) || {
      text: '',
      count: 0,
      time: 0
    };

  repeat.count =
    repeat.text === text &&
    now - repeat.time < 30000
      ? repeat.count + 1
      : 1;

  repeat.text = text;
  repeat.time = now;

  repeatTracker.set(sid, repeat);

  if (
    !type &&
    repeat.count >= c.repeatedLimit
  ) {
    type = 'repeat';
    reason =
      `Same message repeated ${repeat.count} times`;

    repeatTracker.delete(sid);
  }

  if (!type) return;

  const action =
    c.actions[type] || 'delete';

  await message.delete().catch(() => {});

  if (
    action === 'timeout' &&
    message.member.moderatable
  ) {
    await message.member.timeout(
      actionDuration(
        message.guild,
        type
      ),
      `AkiyO AutoMod: ${reason}`
    ).catch(() => {});
  }

  if (action === 'warn') {
    await doWarn(
      message.member,
      `AutoMod: ${reason}`,
      client.user
    );
  }

  await log(
    message.guild,
    'automod',
    '🛡️ AutoMod Enforcement',
    [
      field(
        'User',
        tagOf(message.author)
      ),
      field(
        'Channel',
        `${message.channel} (${message.channel.id})`
      ),
      field(
        'Detection',
        type
      ),
      field(
        'Reason',
        reason
      ),
      field(
        'Action',
        action
      )
    ],
    0xED4245
  );
}

/* ========================= SECURITY ========================= */

async function securityEvent(
  guild,
  event,
  executorId,
  detail
) {
  const c = gc(guild);

  if (
    !c.security.enabled ||
    !executorId ||
    trusted(guild, executorId)
  ) {
    return;
  }

  const key =
    `${guild.id}:${event}:${executorId}`;

  const now = Date.now();

  const arr =
    (securityTracker.get(key) || [])
      .filter(
        t => now - t < 30000
      );

  arr.push(now);
  securityTracker.set(key, arr);

  const limits = {
    ban: c.security.massBan,
    kick: c.security.massKick,
    channelDelete:
      c.security.massChannelDelete,
    roleDelete:
      c.security.massRoleDelete,
    channelCreate:
      c.security.massChannelCreate,
    roleCreate:
      c.security.massRoleCreate
  };

  const limit =
    limits[event] || 999;

  if (arr.length < limit) {
    return;
  }

  securityTracker.delete(key);

  await log(
    guild,
    'security',
    '🚨 Anti-Nuke Threshold Triggered',
    [
      field(
        'Event',
        event
      ),
      field(
        'Executor',
        mention(executorId)
      ),
      field(
        'Count',
        arr.length
      ),
      field(
        'Threshold',
        limit
      ),
      field(
        'Details',
        detail
      ),
      field(
        'Configured Response',
        c.security.action
      )
    ],
    0xED4245
  );

  if (
    c.security.action === 'ban'
  ) {
    const member =
      await guild.members
        .fetch(executorId)
        .catch(() => null);

    if (member?.bannable) {
      await member.ban({
        reason:
          `AkiyO Anti-Nuke: ${event}`
      }).catch(() => {});
    }
  }
}

async function findAuditExecutor(
  guild,
  action,
  targetId
) {
  try {
    if (
      !guild.members.me?.permissions.has(
        PermissionFlagsBits.ViewAuditLog
      )
    ) {
      return null;
    }

    const logs =
      await guild.fetchAuditLogs({
        type: action,
        limit: 10
      });

    const entry =
      logs.entries.find(
        e =>
          (!targetId ||
            e.targetId === targetId) &&
          Date.now() -
            e.createdTimestamp <
            15000
      );

    return entry?.executorId || null;
  } catch {
    return null;
  }
}

/* ========================= TICKETS ========================= */

function ticketKey(
  guildId,
  userId
) {
  return `${guildId}:${userId}`;
}

function getTicket(
  guild,
  userId
) {
  return gc(guild)
    .tickets
    .records[
      ticketKey(guild.id, userId)
    ] || null;
}

function ticketByChannel(
  guild,
  channelId
) {
  const records =
    gc(guild).tickets.records;

  return Object.values(records)
    .find(
      t =>
        t.channelId === channelId &&
        t.status !== 'deleted'
    ) || null;
}

function ticketButtons() {
  return new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId(
          'akiyo_ticket_claim'
        )
        .setLabel('Claim')
        .setEmoji('🙋')
        .setStyle(
          ButtonStyle.Primary
        ),

      new ButtonBuilder()
        .setCustomId(
          'akiyo_ticket_close'
        )
        .setLabel('Close')
        .setEmoji('🔒')
        .setStyle(
          ButtonStyle.Secondary
        ),

      new ButtonBuilder()
        .setCustomId(
          'akiyo_ticket_lock'
        )
        .setLabel('Lock')
        .setEmoji('🔐')
        .setStyle(
          ButtonStyle.Secondary
        ),

      new ButtonBuilder()
        .setCustomId(
          'akiyo_ticket_transcript'
        )
        .setLabel('Transcript')
        .setEmoji('📄')
        .setStyle(
          ButtonStyle.Success
        )
    );
}

async function createTicket(
  guild,
  user
) {
  const c = gc(guild);

  const existing =
    getTicket(guild, user.id);

  if (
    existing &&
    existing.status !== 'closed' &&
    existing.status !== 'deleted'
  ) {
    return existing;
  }

  const category =
    c.support.categoryId
      ? guild.channels.cache.get(
          c.support.categoryId
        )
      : null;

  const staffRole =
    c.support.staffRoleId;

  const channel =
    await guild.channels.create({
      name:
        `ticket-${user.username
          .toLowerCase()
          .replace(/[^a-z0-9]/g, '')
          .slice(0, 18) || 'user'}`,

      type:
        ChannelType.GuildText,

      parent:
        category?.id || null,

      topic:
        `AKIYO_TICKET:${user.id}`,

      permissionOverwrites: [
        {
          id: guild.roles.everyone.id,
          deny: [
            'ViewChannel'
          ]
        },

        {
          id: user.id,
          allow: [
            'ViewChannel',
            'SendMessages',
            'ReadMessageHistory',
            'AttachFiles'
          ]
        },

        ...(staffRole
          ? [{
              id: staffRole,
              allow: [
                'ViewChannel',
                'SendMessages',
                'ReadMessageHistory',
                'AttachFiles'
              ]
            }]
          : [])
      ]
    });

  const record = {
    guildId: guild.id,
    channelId: channel.id,
    ownerId: user.id,
    status: 'open',
    claimedBy: null,
    locked: false,
    createdAt: Date.now(),
    closedAt: null
  };

  c.tickets.records[
    ticketKey(guild.id, user.id)
  ] = record;

  save();

  await channel.send({
    embeds: [
      result(
        '🎫 AkiyO Support Ticket',
        'Welcome to your support ticket.\n\nPlease explain your issue clearly and wait for a support member. Your messages will be handled privately.',
        0x5865F2,
        guild,
        [
          field(
            'Ticket Owner',
            tagOf(user)
          ),
          field(
            'Status',
            '🟢 Open'
          ),
          field(
            'Created',
            `<t:${Math.floor(Date.now() / 1000)}:F>`
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
    'tickets',
    '🎫 Ticket Created',
    [
      field(
        'Owner',
        tagOf(user)
      ),
      field(
        'Channel',
        `${channel} (${channel.id})`
      ),
      field(
        'Status',
        'Open'
      )
    ]
  );

  try {
    await user.send({
      embeds: [
        result(
          '🎫 Support Ticket Created',
          `Your support ticket has been created in **${guild.name}**.`,
          0x57F287,
          guild,
          [
            field(
              'Channel',
              `${channel}`
            ),
            field(
              'Status',
              'Open'
            )
          ]
        )
      ]
    });
  } catch {}

  return record;
}

async function ticketTranscript(
  channel
) {
  const messages = [];
  let before;

  for (let i = 0; i < 10; i++) {
    const batch =
      await channel.messages
        .fetch({
          limit: 100,
          before
        })
        .catch(() => null);

    if (!batch?.size) break;

    messages.push(
      ...batch.values()
    );

    before =
      batch.last().id;

    if (batch.size < 100) break;
  }

  messages.reverse();

  const lines = [
    'AkiyO Support Transcript',
    `Server: ${channel.guild.name}`,
    `Channel: #${channel.name}`,
    `Generated: ${new Date().toISOString()}`,
    ''
  ];

  for (const m of messages) {
    lines.push(
      `[${m.createdAt.toISOString()}] ${m.author.tag} (${m.author.id})`,
      m.content || '[No text]'
    );

    for (
      const attachment
      of m.attachments.values()
    ) {
      lines.push(
        `Attachment: ${attachment.url}`
      );
    }

    lines.push('');
  }

  return Buffer.from(
    lines.join('\n'),
    'utf8'
  );
}

async function closeTicket(
  guild,
  record,
  actor
) {
  record.status = 'closed';
  record.closedAt = Date.now();
  record.locked = false;

  save();

  const ch =
    await guild.channels
      .fetch(record.channelId)
      .catch(() => null);

  if (ch?.isTextBased()) {
    await ch.permissionOverwrites
      .edit(
        record.ownerId,
        {
          SendMessages: false
        }
      )
      .catch(() => {});
  }

  await log(
    guild,
    'tickets',
    '🔒 Ticket Closed',
    [
      field(
        'Owner',
        mention(record.ownerId)
      ),
      field(
        'Channel',
        `${ch || record.channelId}`
      ),
      field(
        'Closed By',
        tagOf(actor)
      ),
      field(
        'Status',
        'Closed'
      )
    ]
  );
}

/* ========================= COMMANDS ========================= */

const commands = [];

function add(command) {
  commands.push(command);
  return command;
}

add(
  new SlashCommandBuilder()
    .setName('help')
    .setDescription(
      'Open the AkiyO professional command center'
    )
);

add(
  new SlashCommandBuilder()
    .setName('botinfo')
    .setDescription(
      'View AkiyO system information'
    )
);

add(
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription(
      'Check AkiyO response latency'
    )
);

add(
  new SlashCommandBuilder()
    .setName('logsetup')
    .setDescription(
      'Configure unified server logging'
    )
    .addSubcommand(s =>
      s.setName('all')
        .setDescription(
          'Send all AkiyO logs to one channel'
        )
        .addChannelOption(o =>
          o.setName('channel')
            .setDescription(
              'Log channel'
            )
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('status')
        .setDescription(
          'View logging status'
        )
    )
    .addSubcommand(s =>
      s.setName('disable')
        .setDescription(
          'Disable unified logging'
        )
    )
);

/* ========================= TICKETS ========================= */

add(
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription(
      'Create a private support ticket'
    )
);

add(
  new SlashCommandBuilder()
    .setName('ticketpanel')
    .setDescription(
      'Create a professional support panel'
    )
);

add(
  new SlashCommandBuilder()
    .setName('ticketsetup')
    .setDescription(
      'Configure ticket system'
    )
    .addSubcommand(s =>
      s.setName('category')
        .setDescription(
          'Set ticket category'
        )
        .addChannelOption(o =>
          o.setName('channel')
            .setDescription(
              'Ticket category'
            )
            .addChannelTypes(
              ChannelType.GuildCategory
            )
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('staffrole')
        .setDescription(
          'Set ticket staff role'
        )
        .addRoleOption(o =>
          o.setName('role')
            .setDescription(
              'Staff role'
            )
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('logchannel')
        .setDescription(
          'Set ticket log channel'
        )
        .addChannelOption(o =>
          o.setName('channel')
            .setDescription(
              'Ticket log channel'
            )
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('status')
        .setDescription(
          'View ticket configuration'
        )
    )
);

for (
  const [name, description] of [
    ['close', 'Close a ticket'],
    ['reopen', 'Reopen a ticket'],
    ['delete', 'Delete a ticket'],
    ['claim', 'Claim a ticket'],
    ['unclaim', 'Release ticket claim'],
    ['lock', 'Lock a ticket'],
    ['unlock', 'Unlock a ticket'],
    ['transcript', 'Generate ticket transcript'],
    ['ticketinfo', 'View ticket information'],
    ['ticketstats', 'View ticket statistics']
  ]
) {
  add(
    new SlashCommandBuilder()
      .setName(name)
      .setDescription(description)
  );
}

add(
  new SlashCommandBuilder()
    .setName('ticketadd')
    .setDescription(
      'Add a member to the ticket'
    )
    .addUserOption(o =>
      o.setName('user')
        .setDescription('Member')
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName('ticketremove')
    .setDescription(
      'Remove a member from the ticket'
    )
    .addUserOption(o =>
      o.setName('user')
        .setDescription('Member')
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName('ticketrename')
    .setDescription(
      'Rename the current ticket'
    )
    .addStringOption(o =>
      o.setName('name')
        .setDescription(
          'New ticket name'
        )
        .setRequired(true)
    )
);

/* ========================= MODERATION ========================= */

add(
  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a member')
    .addUserOption(o =>
      o.setName('user')
        .setDescription('Member')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('reason')
        .setDescription('Reason')
    )
);

add(
  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout a member')
    .addUserOption(o =>
      o.setName('user')
        .setDescription('Member')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('duration')
        .setDescription(
          '30s, 10m, 2h or 1d'
        )
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('reason')
        .setDescription('Reason')
    )
);

add(
  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member')
    .addUserOption(o =>
      o.setName('user')
        .setDescription('Member')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('reason')
        .setDescription('Reason')
    )
);

add(
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member')
    .addUserOption(o =>
      o.setName('user')
        .setDescription('Member')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('reason')
        .setDescription('Reason')
    )
);

add(
  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user')
    .addStringOption(o =>
      o.setName('user_id')
        .setDescription('User ID')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('reason')
        .setDescription('Reason')
    )
);

add(
  new SlashCommandBuilder()
    .setName('warnings')
    .setDescription(
      'View warning history'
    )
    .addUserOption(o =>
      o.setName('user')
        .setDescription('Member')
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName('punishments')
    .setDescription(
      'View punishment history'
    )
    .addUserOption(o =>
      o.setName('user')
        .setDescription('Member')
        .setRequired(true)
    )
);

add(
  new SlashCommandBuilder()
    .setName('clear')
    .setDescription(
      'Delete recent messages'
    )
    .addIntegerOption(o =>
      o.setName('amount')
        .setDescription('1-100')
        .setMinValue(1)
        .setMaxValue(100)
        .setRequired(true)
    )
);

/* ========================= AUTOMOD ========================= */

add(
  new SlashCommandBuilder()
    .setName('automod')
    .setDescription(
      'Configure advanced AutoMod'
    )
    .addSubcommand(s =>
      s.setName('enable')
        .setDescription(
          'Enable AutoMod'
        )
    )
    .addSubcommand(s =>
      s.setName('disable')
        .setDescription(
          'Disable AutoMod'
        )
    )
    .addSubcommand(s =>
      s.setName('status')
        .setDescription(
          'View AutoMod status'
        )
    )
    .addSubcommand(s =>
      s.setName('config')
        .setDescription(
          'View AutoMod configuration'
        )
    )
    .addSubcommand(s =>
      s.setName('badword')
        .setDescription(
          'Add blocked word'
        )
        .addStringOption(o =>
          o.setName('word')
            .setDescription('Word')
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('removebadword')
        .setDescription(
          'Remove blocked word'
        )
        .addStringOption(o =>
          o.setName('word')
            .setDescription('Word')
            .setRequired(true)
        )
    )
);

/* ========================= AUTOTIMEOUT ========================= */

add(
  new SlashCommandBuilder()
    .setName('autotimeout')
    .setDescription(
      'Configure automatic timeout'
    )
    .addSubcommand(s =>
      s.setName('enable')
        .setDescription(
          'Enable automatic timeout'
        )
    )
    .addSubcommand(s =>
      s.setName('disable')
        .setDescription(
          'Disable automatic timeout'
        )
    )
    .addSubcommand(s =>
      s.setName('status')
        .setDescription(
          'View automatic timeout status'
        )
    )
    .addSubcommand(s =>
      s.setName('config')
        .setDescription(
          'View timeout configuration'
        )
    )
);

/* ========================= SECURITY ========================= */

add(
  new SlashCommandBuilder()
    .setName('security')
    .setDescription(
      'Configure Anti-Nuke security'
    )
    .addSubcommand(s =>
      s.setName('enable')
        .setDescription(
          'Enable security'
        )
    )
    .addSubcommand(s =>
      s.setName('disable')
        .setDescription(
          'Disable security'
        )
    )
    .addSubcommand(s =>
      s.setName('status')
        .setDescription(
          'View security status'
        )
    )
    .addSubcommand(s =>
      s.setName('action')
        .setDescription(
          'Set security response'
        )
        .addStringOption(o =>
          o.setName('mode')
            .setDescription(
              'Response mode'
            )
            .addChoices(
              {
                name: 'Alert',
                value: 'alert'
              },
              {
                name: 'Ban',
                value: 'ban'
              }
            )
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('trustedmember')
        .setDescription(
          'Trust a member'
        )
        .addUserOption(o =>
          o.setName('user')
            .setDescription('Member')
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('untrustedmember')
        .setDescription(
          'Remove trusted member'
        )
        .addUserOption(o =>
          o.setName('user')
            .setDescription('Member')
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('trustedbot')
        .setDescription(
          'Trust a bot'
        )
        .addUserOption(o =>
          o.setName('user')
            .setDescription('Bot')
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('untrustedbot')
        .setDescription(
          'Remove trusted bot'
        )
        .addUserOption(o =>
          o.setName('user')
            .setDescription('Bot')
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('trustedrole')
        .setDescription(
          'Set trusted role'
        )
        .addRoleOption(o =>
          o.setName('role')
            .setDescription('Role')
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('untrustedrole')
        .setDescription(
          'Clear trusted role'
        )
    )
    .addSubcommand(s =>
      s.setName('protectedrole')
        .setDescription(
          'Protect a role'
        )
        .addRoleOption(o =>
          o.setName('role')
            .setDescription('Role')
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('unprotectedrole')
        .setDescription(
          'Unprotect a role'
        )
        .addRoleOption(o =>
          o.setName('role')
            .setDescription('Role')
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('protectedchannel')
        .setDescription(
          'Protect a channel'
        )
        .addChannelOption(o =>
          o.setName('channel')
            .setDescription('Channel')
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('unprotectedchannel')
        .setDescription(
          'Unprotect a channel'
        )
        .addChannelOption(o =>
          o.setName('channel')
            .setDescription('Channel')
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('list')
        .setDescription(
          'View security lists'
        )
    )
    .addSubcommand(s =>
      s.setName('raid')
        .setDescription(
          'View raid protection'
        )
    )
);

/* ========================= AUDIT ========================= */

add(
  new SlashCommandBuilder()
    .setName('auditlog')
    .setDescription(
      'View AkiyO audit activity'
    )
    .addSubcommand(s =>
      s.setName('recent')
        .setDescription(
          'View recent audit events'
        )
    )
    .addSubcommand(s =>
      s.setName('status')
        .setDescription(
          'View audit status'
        )
    )
    .addSubcommand(s =>
      s.setName('clear')
        .setDescription(
          'Clear stored audit history'
        )
    )
);

/* ========================= CONFIG ========================= */

add(
  new SlashCommandBuilder()
    .setName('config')
    .setDescription(
      'Manage server configuration'
    )
    .addSubcommand(s =>
      s.setName('view')
        .setDescription(
          'View configuration'
        )
    )
    .addSubcommand(s =>
      s.setName('staffrole')
        .setDescription(
          'Set support staff role'
        )
        .addRoleOption(o =>
          o.setName('role')
            .setDescription('Role')
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('ticketcategory')
        .setDescription(
          'Set ticket category'
        )
        .addChannelOption(o =>
          o.setName('channel')
            .setDescription('Category')
            .addChannelTypes(
              ChannelType.GuildCategory
            )
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('timeout')
        .setDescription(
          'Set AutoMod timeout'
        )
        .addIntegerOption(o =>
          o.setName('seconds')
            .setDescription(
              'Timeout seconds'
            )
            .setMinValue(1)
            .setMaxValue(2419200)
            .setRequired(true)
        )
    )
);

/* ========================= AUTOROLE ========================= */

add(
  new SlashCommandBuilder()
    .setName('autorole')
    .setDescription(
      'Configure automatic role'
    )
    .addSubcommand(s =>
      s.setName('set')
        .setDescription(
          'Set autorole'
        )
        .addRoleOption(o =>
          o.setName('role')
            .setDescription('Role')
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('disable')
        .setDescription(
          'Disable autorole'
        )
    )
    .addSubcommand(s =>
      s.setName('status')
        .setDescription(
          'View autorole'
        )
    )
);

/* ========================= WELCOME ========================= */

add(
  new SlashCommandBuilder()
    .setName('welcome')
    .setDescription(
      'Configure welcome system'
    )
    .addSubcommand(s =>
      s.setName('set')
        .setDescription(
          'Set welcome channel and message'
        )
        .addChannelOption(o =>
          o.setName('channel')
            .setDescription('Channel')
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('message')
            .setDescription(
              'Welcome message'
            )
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('disable')
        .setDescription(
          'Disable welcome'
        )
    )
    .addSubcommand(s =>
      s.setName('status')
        .setDescription(
          'View welcome status'
        )
    )
);

/* ========================= VERIFICATION ========================= */

add(
  new SlashCommandBuilder()
    .setName('verification')
    .setDescription(
      'Configure verification'
    )
    .addSubcommand(s =>
      s.setName('setup')
        .setDescription(
          'Create verification panel'
        )
        .addChannelOption(o =>
          o.setName('channel')
            .setDescription('Channel')
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
        .addRoleOption(o =>
          o.setName('role')
            .setDescription(
              'Verified role'
            )
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('disable')
        .setDescription(
          'Disable verification'
        )
    )
    .addSubcommand(s =>
      s.setName('status')
        .setDescription(
          'View verification status'
        )
    )
);

/* ========================= REACTION ROLES ========================= */

add(
  new SlashCommandBuilder()
    .setName('autoreactionrole')
    .setDescription(
      'Configure reaction roles'
    )
    .addSubcommand(s =>
      s.setName('add')
        .setDescription(
          'Add reaction role'
        )
        .addStringOption(o =>
          o.setName('message_id')
            .setDescription(
              'Message ID'
            )
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('emoji')
            .setDescription('Emoji')
            .setRequired(true)
        )
        .addRoleOption(o =>
          o.setName('role')
            .setDescription('Role')
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('remove')
        .setDescription(
          'Remove reaction role'
        )
        .addStringOption(o =>
          o.setName('message_id')
            .setDescription(
              'Message ID'
            )
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName('emoji')
            .setDescription('Emoji')
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('list')
        .setDescription(
          'List reaction roles'
        )
    )
);

/* ========================= ANNOUNCEMENTS ========================= */

add(
  new SlashCommandBuilder()
    .setName('announce')
    .setDescription(
      'Send a professional announcement'
    )
    .addChannelOption(o =>
      o.setName('channel')
        .setDescription('Channel')
        .addChannelTypes(
          ChannelType.GuildText
        )
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('message')
        .setDescription('Message')
        .setRequired(true)
    )
    .addStringOption(o =>
      o.setName('title')
        .setDescription('Title')
    )
    .addStringOption(o =>
      o.setName('footer')
        .setDescription('Footer')
    )
    .addBooleanOption(o =>
      o.setName('everyone')
        .setDescription(
          'Mention everyone'
        )
    )
);

/* ========================= AI ========================= */

add(
  new SlashCommandBuilder()
    .setName('ai')
    .setDescription(
      'Use AkiyO AI'
    )
    .addSubcommand(s =>
      s.setName('ask')
        .setDescription(
          'Ask AkiyO AI'
        )
        .addStringOption(o =>
          o.setName('prompt')
            .setDescription(
              'Question'
            )
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName('reset')
        .setDescription(
          'Reset AI conversation'
        )
    )
);

/* ========================= AI ========================= */

const aiHistory = new Map();

async function aiAsk(
  userId,
  prompt
) {
  if (!OPENAI_API_KEY) {
    return {
      error:
        'AI is not configured. Add OPENAI_API_KEY to the bot environment.'
    };
  }

  const history =
    aiHistory.get(userId) || [];

  history.push({
    role: 'user',
    content: prompt
  });

  while (history.length > 12) {
    history.shift();
  }

  try {
    const response =
      await fetch(
        'https://api.openai.com/v1/responses',
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',

            Authorization:
              `Bearer ${OPENAI_API_KEY}`
          },

          body: JSON.stringify({
            model: OPENAI_MODEL,
            input: history
          })
        }
      );

    if (!response.ok) {
      return {
        error:
          `AI service returned HTTP ${response.status}.`
      };
    }

    const data =
      await response.json();

    const text =
      data.output_text ||
      data.output
        ?.flatMap(
          x => x.content || []
        )
        .map(
          x => x.text || ''
        )
        .join('') ||
      'No response generated.';

    history.push({
      role: 'assistant',
      content: text
    });

    aiHistory.set(
      userId,
      history
    );

    return {
      text
    };
  } catch (e) {
    return {
      error:
        `AI connection failed: ${e.message}`
    };
  }
}

/* ========================= HELP ========================= */

function helpEmbed(guild) {
  return result(
    '📚 AkiyO Command Center',
    'A professional Discord management, support, moderation, security and automation system.',
    0x5865F2,
    guild,
    [
      field(
        '🎫 Support & Tickets',
        '`/ticket` • `/ticketpanel` • `/ticketsetup` • `/close` • `/reopen` • `/delete` • `/claim` • `/unclaim` • `/lock` • `/unlock` • `/transcript` • `/ticketadd` • `/ticketremove` • `/ticketrename` • `/ticketinfo` • `/ticketstats`'
      ),

      field(
        '🛡️ Moderation',
        '`/warn` • `/warnings` • `/punishments` • `/timeout` • `/kick` • `/ban` • `/unban` • `/clear`'
      ),

      field(
        '🤖 AutoMod',
        '`/automod enable` • `/automod disable` • `/automod status` • `/automod config` • `/automod badword` • `/automod removebadword` • `/autotimeout`'
      ),

      field(
        '🔐 Security',
        '`/security enable` • `/security disable` • `/security status` • `/security action` • trusted members/bots/roles • protected roles/channels • raid protection'
      ),

      field(
        '📋 Logging & Audit',
        '`/logsetup all` • `/logsetup status` • `/logsetup disable` • `/auditlog recent` • `/auditlog status` • `/auditlog clear`'
      ),

      field(
        '⚙️ Server Systems',
        '`/config` • `/autorole` • `/welcome` • `/verification` • `/autoreactionrole`'
      ),

      field(
        '📢 Communication',
        '`/announce` • `/help` • `/botinfo` • `/ping`'
      ),

      field(
        '🧠 AI',
        '`/ai ask` • `/ai reset`'
      )
    ]
  );
}

/* ========================= INTERACTION ========================= */

async function handleInteraction(i) {
  if (!i.isChatInputCommand()) {
    return;
  }

  const cmd = i.commandName;

  /*
    CRITICAL LOADING FIX:
    Acknowledge immediately.
    Command logging runs separately.
  */

  if (!i.deferred && !i.replied) {
    await i.deferReply().catch(() => {});
  }

  commandLog(i);

  try {
    /* ================= HELP ================= */

    if (cmd === 'help') {
      return editReply(
        i,
        '📚 AkiyO Command Center',
        'Select a command from the list below. Every system is designed for professional server management.',
        0x5865F2,
        [
          field(
            '🎫 Support',
            '`/ticket` • `/ticketpanel` • `/ticketsetup` • ticket controls • transcripts'
          ),
          field(
            '🛡️ Moderation',
            '`/warn` • `/timeout` • `/kick` • `/ban` • `/unban` • `/clear` • history'
          ),
          field(
            '🤖 AutoMod',
            '`/automod` • `/autotimeout` • bad words • spam • repeat • caps • invites • mentions'
          ),
          field(
            '🔐 Security',
            '`/security` • trusted users/bots/roles • protected channels/roles • raid protection'
          ),
          field(
            '📋 Logging',
            '`/logsetup` • `/auditlog` • unified server activity logging'
          ),
          field(
            '⚙️ Systems',
            '`/config` • `/autorole` • `/welcome` • `/verification` • `/autoreactionrole`'
          ),
          field(
            '📢 Utility',
            '`/announce` • `/botinfo` • `/ping` • `/ai`'
          )
        ]
      );
    }

    /* ================= PING ================= */

    if (cmd === 'ping') {
      return editReply(
        i,
        '🏓 AkiyO Ping',
        'AkiyO is online and responding normally.',
        0x57F287,
        [
          field(
            'WebSocket',
            `${client.ws.ping}ms`,
            true
          ),
          field(
            'Uptime',
            `${Math.floor(process.uptime() / 60)} minutes`,
            true
          ),
          field(
            'Status',
            '🟢 Operational',
            true
          )
        ]
      );
    }

    /* ================= BOT INFO ================= */

    if (cmd === 'botinfo') {
      const users =
        client.guilds.cache.reduce(
          (n, g) =>
            n + (g.memberCount || 0),
          0
        );

      return editReply(
        i,
        '🤖 AkiyO System Information',
        'Professional multi-server Discord support, moderation, security and logging system.',
        0x5865F2,
        [
          field(
            'Bot',
            tagOf(client.user)
          ),
          field(
            'Guilds',
            client.guilds.cache.size,
            true
          ),
          field(
            'Users',
            users,
            true
          ),
          field(
            'Commands',
            commands.length,
            true
          ),
          field(
            'Node.js',
            process.version,
            true
          ),
          field(
            'discord.js',
            require('discord.js').version,
            true
          ),
          field(
            'Latency',
            `${client.ws.ping}ms`,
            true
          )
        ]
      );
    }

    /* ================= LOG SETUP ================= */

    if (cmd === 'logsetup') {
      if (!memberIsManager(i.member)) {
        return editReply(
          i,
          '🔒 Permission Required',
          'You need **Manage Server** or **Administrator** to change logging.',
          0xED4245
        );
      }

      const c = gc(i.guild);
      const s = i.options.getSubcommand();

      if (s === 'all') {
        const ch =
          i.options.getChannel(
            'channel'
          );

        const me =
          i.guild.members.me;

        if (
          !me.permissionsIn(ch)
            .has(
              PermissionFlagsBits.SendMessages
            ) ||
          !me.permissionsIn(ch)
            .has(
              PermissionFlagsBits.EmbedLinks
            )
        ) {
          return editReply(
            i,
            '⚠️ Logging Setup Failed',
            'AkiyO needs **Send Messages** and **Embed Links** in the selected channel.',
            0xED4245
          );
        }

        const previous =
          c.logs.all;

        c.logs.all = ch.id;
        save();

        await log(
          i.guild,
          'config',
          '📋 Unified Logging Configured',
          [
            field(
              'Channel',
              `${ch} (${ch.id})`
            ),
            field(
              'Configured By',
              tagOf(i.user)
            ),
            field(
              'Previous Channel',
              previous
                ? `<#${previous}>`
                : 'None'
            ),
            field(
              'Status',
              '🟢 Active'
            )
          ],
          0x57F287
        );

        return editReply(
          i,
          '📋 Unified Logging Enabled',
          'All supported AkiyO logs will now be sent to this single channel.',
          0x57F287,
          [
            field(
              'Log Channel',
              `${ch} (${ch.id})`
            ),
            field(
              'Scope',
              'All server logs'
            ),
            field(
              'Status',
              '🟢 Active'
            )
          ]
        );
      }

      if (s === 'disable') {
        const old =
          c.logs.all;

        c.logs.all = null;
        save();

        return editReply(
          i,
          '📋 Unified Logging Disabled',
          'The unified all-logs destination has been disabled.',
          0xFEE75C,
          [
            field(
              'Previous Channel',
              old
                ? `<#${old}>`
                : 'None'
            ),
            field(
              'Changed By',
              tagOf(i.user)
            )
          ]
        );
      }

      const id =
        c.logs.all;

      const ch =
        id
          ? await i.guild.channels
              .fetch(id)
              .catch(() => null)
          : null;

      return editReply(
        i,
        '📋 Unified Logging Status',
        id && ch
          ? 'All configured AkiyO logs are routed to the selected channel.'
          : 'No unified log channel is configured.',
        id && ch
          ? 0x57F287
          : 0xFEE75C,
        [
          field(
            'Channel',
            ch
              ? `${ch} (${ch.id})`
              : 'Not configured'
          ),
          field(
            'Health',
            ch?.isTextBased()
              ? '🟢 Ready'
              : '🔴 Unavailable'
          ),
          field(
            'Per Server',
            'Yes'
          )
        ]
      );
    }

    /* ================= TICKET ================= */

    if (
      [
        'ticket',
        'ticketpanel',
        'ticketsetup',
        'close',
        'reopen',
        'delete',
        'claim',
        'unclaim',
        'lock',
        'unlock',
        'transcript',
        'ticketadd',
        'ticketremove',
        'ticketrename',
        'ticketinfo',
        'ticketstats'
      ].includes(cmd)
    ) {
      const c = gc(i.guild);

      if (cmd === 'ticket') {
        if (!c.support.categoryId) {
          return editReply(
            i,
            '🎫 Ticket Setup Required',
            'This server has not configured a ticket category yet.\n\nUse `/ticketsetup category` first.',
            0xFEE75C
          );
        }

        const r =
          await createTicket(
            i.guild,
            i.user
          );

        return editReply(
          i,
          '🎫 Support Ticket Ready',
          `Your private support ticket is ready: <#${r.channelId}>`,
          0x57F287,
          [
            field(
              'Status',
              r.status === 'open'
                ? '🟢 Open'
                : '🟡 Existing'
            ),
            field(
              'Owner',
              tagOf(i.user)
            ),
            field(
              'Channel',
              `<#${r.channelId}> (${r.channelId})`
            )
          ]
        );
      }

      if (cmd === 'ticketpanel') {
        if (!memberIsManager(i.member)) {
          return editReply(
            i,
            '🔒 Permission Required',
            'Manage Server or Administrator is required.',
            0xED4245
          );
        }

        const row =
          new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(
                  'akiyo_create_ticket'
                )
                .setLabel(
                  'Open Support Ticket'
                )
                .setEmoji('🎫')
                .setStyle(
                  ButtonStyle.Primary
                )
            );

        const msg =
          await i.channel.send({
            embeds: [
              result(
                '🎫 AkiyO Support Center',
                'Need help? Click **Open Support Ticket** below to create a private support channel.',
                0x5865F2,
                i.guild,
                [
                  field(
                    'Support',
                    'Private staff-assisted support'
                  ),
                  field(
                    'Access',
                    'Only the ticket owner and authorized staff can view it'
                  )
                ]
              )
            ],
            components: [row]
          });

        c.tickets.panelChannelId =
          i.channel.id;

        c.tickets.panelMessageId =
          msg.id;

        save();

        return editReply(
          i,
          '🎫 Ticket Panel Published',
          'The professional support panel has been created successfully.',
          0x57F287,
          [
            field(
              'Channel',
              `${i.channel}`
            ),
            field(
              'Message ID',
              msg.id
            ),
            field(
              'Status',
              '🟢 Active'
            )
          ]
        );
      }

      if (cmd === 'ticketsetup') {
        if (!memberIsManager(i.member)) {
          return editReply(
            i,
            '🔒 Permission Required',
            'Manage Server or Administrator is required.',
            0xED4245
          );
        }

        const s =
          i.options.getSubcommand();

        if (s === 'category') {
          const ch =
            i.options.getChannel(
              'channel'
            );

          c.support.categoryId =
            ch.id;

          save();

          return editReply(
            i,
            '⚙️ Ticket Category Updated',
            'New tickets will be created inside the selected category.',
            0x57F287,
            [
              field(
                'Category',
                `${ch} (${ch.id})`
              ),
              field(
                'Updated By',
                tagOf(i.user)
              )
            ]
          );
        }

        if (s === 'staffrole') {
          const role =
            i.options.getRole('role');

          c.support.staffRoleId =
            role.id;

          save();

          return editReply(
            i,
            '⚙️ Ticket Staff Role Updated',
            'Members with this role can manage support tickets.',
            0x57F287,
            [
              field(
                'Staff Role',
                mention(
                  role.id,
                  'role'
                )
              ),
              field(
                'Updated By',
                tagOf(i.user)
              )
            ]
          );
        }

        if (s === 'logchannel') {
          const ch =
            i.options.getChannel(
              'channel'
            );

          c.support.ticketLogChannelId =
            ch.id;

          save();

          return editReply(
            i,
            '⚙️ Ticket Log Channel Updated',
            'Ticket-specific logging configuration has been saved.',
            0x57F287,
            [
              field(
                'Channel',
                `${ch} (${ch.id})`
              )
            ]
          );
        }

        return editReply(
          i,
          '🎫 Ticket System Status',
          'Current ticket configuration.',
          0x5865F2,
          [
            field(
              'Category',
              c.support.categoryId
                ? `<#${c.support.categoryId}>`
                : 'Not configured'
            ),
            field(
              'Staff Role',
              c.support.staffRoleId
                ? mention(
                    c.support.staffRoleId,
                    'role'
                  )
                : 'Not configured'
            ),
            field(
              'Ticket Logs',
              c.support.ticketLogChannelId
                ? `<#${c.support.ticketLogChannelId}>`
                : 'Not configured'
            )
          ]
        );
      }

      const record =
        ticketByChannel(
          i.guild,
          i.channel.id
        );

      if (cmd === 'ticketstats') {
        const all =
          Object.values(
            c.tickets.records
          );

        const open =
          all.filter(
            x => x.status === 'open'
          ).length;

        const closed =
          all.filter(
            x => x.status === 'closed'
          ).length;

        return editReply(
          i,
          '📊 Ticket Statistics',
          'Current support workload for this server.',
          0x5865F2,
          [
            field(
              'Total',
              all.length,
              true
            ),
            field(
              'Open',
              open,
              true
            ),
            field(
              'Closed',
              closed,
              true
            )
          ]
        );
      }

      if (!record) {
        return editReply(
          i,
          '🎫 Ticket Not Found',
          'This command must be used inside an active AkiyO ticket.',
          0xFEE75C
        );
      }

      if (
        !memberIsStaff(i.member) &&
        i.user.id !== record.ownerId
      ) {
        return editReply(
          i,
          '🔒 Ticket Access Denied',
          'You are not authorized to manage this ticket.',
          0xED4245
        );
      }

      if (cmd === 'close') {
        await closeTicket(
          i.guild,
          record,
          i.user
        );

        return editReply(
          i,
          '🔒 Ticket Closed',
          'This ticket is now closed.',
          0xFEE75C,
          [
            field(
              'Closed By',
              tagOf(i.user)
            ),
            field(
              'Owner',
              mention(record.ownerId)
            ),
            field(
              'Status',
              '🔴 Closed'
            )
          ]
        );
      }

      if (cmd === 'reopen') {
        if (!memberIsStaff(i.member)) {
          return editReply(
            i,
            '🔒 Staff Required',
            'Only support staff can reopen a ticket.',
            0xED4245
          );
        }

        record.status = 'open';
        record.closedAt = null;

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

        save();

        await log(
          i.guild,
          'tickets',
          '🔓 Ticket Reopened',
          [
            field(
              'Owner',
              mention(record.ownerId)
            ),
            field(
              'Channel',
              `${i.channel}`
            ),
            field(
              'Reopened By',
              tagOf(i.user)
            )
          ],
          0x57F287
        );

        return editReply(
          i,
          '🔓 Ticket Reopened',
          'The ticket is active again.',
          0x57F287,
          [
            field(
              'Owner',
              mention(record.ownerId)
            ),
            field(
              'Status',
              '🟢 Open'
            )
          ]
        );
      }

      if (cmd === 'delete') {
        if (!memberIsStaff(i.member)) {
          return editReply(
            i,
            '🔒 Staff Required',
            'Only support staff can delete tickets.',
            0xED4245
          );
        }

        const ch = i.channel;

        record.status = 'deleted';
        save();

        await log(
          i.guild,
          'tickets',
          '🗑️ Ticket Deleted',
          [
            field(
              'Owner',
              mention(record.ownerId)
            ),
            field(
              'Channel',
              `${ch}`
            ),
            field(
              'Deleted By',
              tagOf(i.user)
            )
          ],
          0xED4245
        );

        await ch.delete(
          'AkiyO ticket deleted'
        ).catch(() => {});

        return;
      }

      if (
        cmd === 'claim' ||
        cmd === 'unclaim'
      ) {
        if (!memberIsStaff(i.member)) {
          return editReply(
            i,
            '🔒 Staff Required',
            'Only support staff can manage ticket claims.',
            0xED4245
          );
        }

        record.claimedBy =
          cmd === 'claim'
            ? i.user.id
            : null;

        save();

        return editReply(
          i,
          cmd === 'claim'
            ? '🙋 Ticket Claimed'
            : '↩️ Ticket Unclaimed',
          cmd === 'claim'
            ? 'You are now assigned to this ticket.'
            : 'The ticket is available for other staff.',
          0x57F287,
          [
            field(
              'Assigned Staff',
              record.claimedBy
                ? mention(
                    record.claimedBy
                  )
                : 'Nobody'
            )
          ]
        );
      }

      if (
        cmd === 'lock' ||
        cmd === 'unlock'
      ) {
        if (!memberIsStaff(i.member)) {
          return editReply(
            i,
            '🔒 Staff Required',
            'Only support staff can change ticket locks.',
            0xED4245
          );
        }

        record.locked =
          cmd === 'lock';

        await i.channel
          .permissionOverwrites
          .edit(
            record.ownerId,
            {
              SendMessages:
                !record.locked
            }
          );

        save();

        return editReply(
          i,
          record.locked
            ? '🔐 Ticket Locked'
            : '🔓 Ticket Unlocked',
          record.locked
            ? 'The ticket owner can no longer send messages.'
            : 'The ticket owner can send messages again.',
          0x57F287,
          [
            field(
              'Status',
              record.locked
                ? '🔐 Locked'
                : '🔓 Unlocked'
            )
          ]
        );
      }

      if (cmd === 'transcript') {
        if (!memberIsStaff(i.member)) {
          return editReply(
            i,
            '🔒 Staff Required',
            'Only support staff can generate transcripts.',
            0xED4245
          );
        }

        const file =
          await ticketTranscript(
            i.channel
          );

        await i.editReply({
          embeds: [
            result(
              '📄 Ticket Transcript',
              'Transcript generated successfully.',
              0x57F287,
              i.guild,
              [
                field(
                  'Ticket Owner',
                  mention(record.ownerId)
                ),
                field(
                  'Generated By',
                  tagOf(i.user)
                ),
                field(
                  'Status',
                  '🟢 Generated'
                )
              ]
            )
          ],
          files: [
            {
              attachment: file,
              name:
                `akiyo-ticket-${record.ownerId}.txt`
            }
          ]
        });

        await log(
          i.guild,
          'tickets',
          '📄 Ticket Transcript Generated',
          [
            field(
              'Channel',
              `${i.channel}`
            ),
            field(
              'Owner',
              mention(record.ownerId)
            ),
            field(
              'Generated By',
              tagOf(i.user)
            )
          ],
          0x57F287
        );

        return;
      }

      if (
        cmd === 'ticketadd' ||
        cmd === 'ticketremove'
      ) {
        if (!memberIsStaff(i.member)) {
          return editReply(
            i,
            '🔒 Staff Required',
            'Only support staff can manage ticket members.',
            0xED4245
          );
        }

        const user =
          i.options.getUser('user');

        if (cmd === 'ticketadd') {
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
            .delete(user.id)
            .catch(() => {});
        }

        return editReply(
          i,
          cmd === 'ticketadd'
            ? '👤 Member Added'
            : '👤 Member Removed',
          cmd === 'ticketadd'
            ? `${user} can now access this ticket.`
            : `${user} can no longer access this ticket.`,
          0x57F287,
          [
            field(
              'Member',
              tagOf(user)
            ),
            field(
              'Changed By',
              tagOf(i.user)
            )
          ]
        );
      }

      if (cmd === 'ticketrename') {
        if (!memberIsStaff(i.member)) {
          return editReply(
            i,
            '🔒 Staff Required',
            'Only support staff can rename tickets.',
            0xED4245
          );
        }

        const old =
          i.channel.name;

        const name =
          i.options
            .getString('name')
            .replace(
              /[^a-zA-Z0-9-_]/g,
              '-'
            )
            .slice(0, 90);

        await i.channel.setName(name);

        return editReply(
          i,
          '✏️ Ticket Renamed',
          'Ticket channel name updated successfully.',
          0x57F287,
          [
            field(
              'Before',
              old
            ),
            field(
              'After',
              name
            ),
            field(
              'Changed By',
              tagOf(i.user)
            )
          ]
        );
      }

      if (cmd === 'ticketinfo') {
        return editReply(
          i,
          '🎫 Ticket Information',
          'Detailed information for this ticket.',
          0x5865F2,
          [
            field(
              'Owner',
              mention(record.ownerId)
            ),
            field(
              'Channel',
              `${i.channel} (${i.channel.id})`
            ),
            field(
              'Status',
              record.status
            ),
            field(
              'Claimed By',
              record.claimedBy
                ? mention(
                    record.claimedBy
                  )
                : 'Nobody'
            ),
            field(
              'Locked',
              record.locked
                ? 'Yes'
                : 'No'
            ),
            field(
              'Created',
              `<t:${Math.floor(record.createdAt / 1000)}:F>`
            )
          ]
        );
      }
    }

    /* ================= MODERATION ================= */

    if (
      [
        'warn',
        'timeout',
        'kick',
        'ban',
        'unban',
        'warnings',
        'punishments',
        'clear'
      ].includes(cmd)
    ) {
      if (
        !i.memberPermissions?.has(
          PermissionFlagsBits.ModerateMembers
        ) &&
        !memberIsManager(i.member)
      ) {
        return editReply(
          i,
          '🔒 Permission Required',
          'You need the appropriate moderation permission for this command.',
          0xED4245
        );
      }

      if (
        cmd === 'warnings' ||
        cmd === 'punishments'
      ) {
        const user =
          i.options.getUser('user');

        const c = gc(i.guild);

        const arr =
          cmd === 'warnings'
            ? (
                c.warnings[user.id] ||
                []
              )
            : (
                c.punishments[user.id] ||
                []
              );

        const lines =
          arr
            .slice(-15)
            .reverse()
            .map(
              (x, n) =>
                `**${n + 1}.** ${x.type || 'warn'} • ${safe(x.reason, 180)} • <@${x.moderatorId}> • <t:${Math.floor(x.time / 1000)}:R>`
            )
            .join('\n') ||
          'No records found.';

        return editReply(
          i,
          cmd === 'warnings'
            ? '⚠️ Warning History'
            : '📜 Punishment History',
          lines,
          0x5865F2,
          [
            field(
              'Member',
              tagOf(user)
            ),
            field(
              'Total Records',
              arr.length
            )
          ]
        );
      }

      if (cmd === 'clear') {
        const amount =
          i.options.getInteger(
            'amount'
          );

        const deleted =
          await i.channel
            .bulkDelete(
              amount,
              true
            )
            .catch(() => null);

        await log(
          i.guild,
          'moderation',
          '🧹 Messages Cleared',
          [
            field(
              'Channel',
              `${i.channel}`
            ),
            field(
              'Requested',
              amount
            ),
            field(
              'Deleted',
              deleted?.size || 0
            ),
            field(
              'Moderator',
              tagOf(i.user)
            )
          ],
          0xED4245
        );

        return editReply(
          i,
          '🧹 Messages Cleared',
          `Successfully removed **${deleted?.size || 0}** messages.`,
          0x57F287,
          [
            field(
              'Channel',
              `${i.channel}`
            ),
            field(
              'Requested',
              amount
            ),
            field(
              'Deleted',
              deleted?.size || 0
            )
          ]
        );
      }

      if (cmd === 'unban') {
        const id =
          i.options.getString(
            'user_id'
          );

        const reason =
          i.options.getString(
            'reason'
          ) ||
          'No reason provided';

        await i.guild.members
          .unban(
            id,
            reason
          );

        await recordPunishment(
          i.guild,
          id,
          'unban',
          reason,
          i.user.id
        );

        return editReply(
          i,
          '🔓 User Unbanned',
          'The user has been successfully unbanned.',
          0x57F287,
          [
            field(
              'User ID',
              id
            ),
            field(
              'Moderator',
              tagOf(i.user)
            ),
            field(
              'Reason',
              reason
            )
          ]
        );
      }

      const user =
        i.options.getUser('user');

      const member =
        await i.guild.members
          .fetch(user.id)
          .catch(() => null);

      if (!member) {
        return editReply(
          i,
          '⚠️ Member Not Found',
          'The selected user is not currently in this server.',
          0xED4245
        );
      }

      if (!canAct(i, member)) {
        return editReply(
          i,
          '⚠️ Hierarchy Protection',
          'AkiyO or your role cannot moderate this member.',
          0xED4245,
          [
            field(
              'Target',
              tagOf(user)
            ),
            field(
              'Target Role',
              member.roles.highest.name
            ),
            field(
              'Your Role',
              i.member.roles.highest.name
            )
          ]
        );
      }

      const reason =
        i.options.getString(
          'reason'
        ) ||
        'No reason provided';

      if (cmd === 'warn') {
        const count =
          await doWarn(
            member,
            reason,
            i.user
          );

        try {
          await user.send({
            embeds: [
              result(
                '⚠️ You Received a Warning',
                `You have received a moderation warning in **${i.guild.name}**.`,
                0xFEE75C,
                i.guild,
                [
                  field(
                    'Reason',
                    reason
                  ),
                  field(
                    'Warning Count',
                    count
                  ),
                  field(
                    'Moderator',
                    tagOf(i.user)
                  )
                ]
              )
            ]
          });
        } catch {}

        return editReply(
          i,
          '⚠️ Warning Issued',
          'The warning has been recorded in the member history.',
          0x57F287,
          [
            field(
              'Member',
              tagOf(user)
            ),
            field(
              'Reason',
              reason
            ),
            field(
              'Warning Count',
              count
            ),
            field(
              'Escalation',
              '3 → Timeout • 5 → Kick • 7+ → Ban'
            )
          ]
        );
      }

      if (cmd === 'timeout') {
        const duration =
          i.options.getString(
            'duration'
          );

        const ms =
          parseDuration(
            duration
          );

        if (!ms) {
          return editReply(
            i,
            '⚠️ Invalid Duration',
            'Use `30s`, `10m`, `2h`, or `1d`. Maximum is 28 days.',
            0xED4245
          );
        }

        await member.timeout(
          ms,
          reason
        );

        await recordPunishment(
          i.guild,
          user.id,
          'timeout',
          reason,
          i.user.id,
          ms
        );

        try {
          await user.send({
            embeds: [
              result(
                '⏱️ You Were Timed Out',
                `You have been timed out in **${i.guild.name}**.`,
                0xED4245,
                i.guild,
                [
                  field(
                    'Duration',
                    duration
                  ),
                  field(
                    'Reason',
                    reason
                  ),
                  field(
                    'Moderator',
                    tagOf(i.user)
                  )
                ]
              )
            ]
          });
        } catch {}

        return editReply(
          i,
          '⏱️ Timeout Applied',
          'The member has been successfully timed out.',
          0x57F287,
          [
            field(
              'Member',
              tagOf(user)
            ),
            field(
              'Duration',
              duration
            ),
            field(
              'Reason',
              reason
            )
          ]
        );
      }

      if (cmd === 'kick') {
        await member.kick(reason);

        await recordPunishment(
          i.guild,
          user.id,
          'kick',
          reason,
          i.user.id
        );

        return editReply(
          i,
          '👢 Member Kicked',
          'The member has been removed from the server.',
          0x57F287,
          [
            field(
              'Member',
              tagOf(user)
            ),
            field(
              'Reason',
              reason
            ),
            field(
              'Moderator',
              tagOf(i.user)
            )
          ]
        );
      }

      if (cmd === 'ban') {
        await member.ban({
          reason
        });

        await recordPunishment(
          i.guild,
          user.id,
          'ban',
          reason,
          i.user.id
        );

        return editReply(
          i,
          '🔨 Member Banned',
          'The member has been permanently banned.',
          0x57F287,
          [
            field(
              'Member',
              tagOf(user)
            ),
            field(
              'Reason',
              reason
            ),
            field(
              'Moderator',
              tagOf(i.user)
            )
          ]
        );
      }
    }

    /* ================= AUTOMOD ================= */

    if (cmd === 'automod') {
      if (!memberIsManager(i.member)) {
        return editReply(
          i,
          '🔒 Permission Required',
          'Manage Server or Administrator is required.',
          0xED4245
        );
      }

      const c =
        gc(i.guild).automod;

      const s =
        i.options.getSubcommand();

      if (s === 'enable') {
        c.enabled = true;
        save();

        return editReply(
          i,
          '🤖 AutoMod Enabled',
          'AkiyO AutoMod protection is now active.',
          0x57F287,
          [
            field(
              'Status',
              '🟢 Enabled'
            ),
            field(
              'Changed By',
              tagOf(i.user)
            )
          ]
        );
      }

      if (s === 'disable') {
        c.enabled = false;
        save();

        return editReply(
          i,
          '🤖 AutoMod Disabled',
          'AkiyO AutoMod protection has been disabled.',
          0xFEE75C,
          [
            field(
              'Status',
              '🔴 Disabled'
            ),
            field(
              'Changed By',
              tagOf(i.user)
            )
          ]
        );
      }

      if (s === 'badword') {
        const word =
          i.options
            .getString('word')
            .trim();

        if (
          !c.badWords
            .some(
              x =>
                x.toLowerCase() ===
                word.toLowerCase()
            )
        ) {
          c.badWords.push(word);
        }

        save();

        return editReply(
          i,
          '🤖 AutoMod Word Added',
          'The word has been added to the blocked-word list.',
          0x57F287,
          [
            field(
              'Word',
              word
            ),
            field(
              'Total Blocked Words',
              c.badWords.length
            )
          ]
        );
      }

      if (s === 'removebadword') {
        const word =
          i.options
            .getString('word')
            .trim();

        const before =
          c.badWords.length;

        c.badWords =
          c.badWords.filter(
            x =>
              x.toLowerCase() !==
              word.toLowerCase()
          );

        save();

        return editReply(
          i,
          '🤖 AutoMod Word Removed',
          before === c.badWords.length
            ? 'That word was not found in the blocked-word list.'
            : 'The word was removed successfully.',
          before === c.badWords.length
            ? 0xFEE75C
            : 0x57F287,
          [
            field(
              'Word',
              word
            ),
            field(
              'Remaining',
              c.badWords.length
            )
          ]
        );
      }

      return editReply(
        i,
        s === 'status'
          ? '🤖 AutoMod Status'
          : '🤖 AutoMod Configuration',
        'Current AkiyO AutoMod settings.',
        c.enabled
          ? 0x57F287
          : 0xFEE75C,
        [
          field(
            'Status',
            c.enabled
              ? '🟢 Enabled'
              : '🔴 Disabled'
          ),
          field(
            'Spam',
            `${c.spamLimit} messages / ${c.spamWindow / 1000}s`
          ),
          field(
            'Repeated Messages',
            c.repeatedLimit
          ),
          field(
            'Caps Threshold',
            `${c.capsPercent}%`
          ),
          field(
            'Bad Words',
            c.badWords.length
          ),
          field(
            'Invite Filter',
            c.invites
              ? 'Enabled'
              : 'Disabled'
          ),
          field(
            'Mass Mentions',
            c.massMentions
              ? 'Enabled'
              : 'Disabled'
          )
        ]
      );
    }

    /* ================= AUTOTIMEOUT ================= */

    if (cmd === 'autotimeout') {
      if (!memberIsManager(i.member)) {
        return editReply(
          i,
          '🔒 Permission Required',
          'Manage Server or Administrator is required.',
          0xED4245
        );
      }

      const s =
        i.options.getSubcommand();

      const c =
        gc(i.guild).automod;

      return editReply(
        i,
        '⏱️ AutoTimeout',
        s === 'enable'
          ? 'Automatic timeout protection is controlled by AutoMod enforcement.'
          : s === 'disable'
            ? 'Automatic timeout actions can be disabled through AutoMod configuration.'
            : 'Current automatic timeout configuration.',
        0x5865F2,
        [
          field(
            'Spam',
            `${c.timeoutSeconds.spam}s`
          ),
          field(
            'Invite',
            `${c.timeoutSeconds.invite}s`
          ),
          field(
            'Repeat',
            `${c.timeoutSeconds.repeat}s`
          ),
          field(
            'Mass Mention',
            `${c.timeoutSeconds.massmention}s`
          ),
          field(
            'Status',
            c.enabled
              ? '🟢 Active'
              : '🔴 Disabled'
          )
        ]
      );
    }

    /* ================= SECURITY ================= */

    if (cmd === 'security') {
      if (!memberIsManager(i.member)) {
        return editReply(
          i,
          '🔒 Permission Required',
          'Manage Server or Administrator is required.',
          0xED4245
        );
      }

      const c =
        gc(i.guild).security;

      const s =
        i.options.getSubcommand();

      if (s === 'enable') {
        c.enabled = true;
        save();
      }

      if (s === 'disable') {
        c.enabled = false;
        save();
      }

      if (s === 'action') {
        c.action =
          i.options.getString(
            'mode'
          );

        save();
      }

      const user =
        s.includes('member') ||
        s.includes('bot')
          ? i.options.getUser('user')
          : null;

      const role =
        s.includes('role')
          ? i.options.getRole('role')
          : null;

      const channel =
        s.includes('channel')
          ? i.options.getChannel(
              'channel'
            )
          : null;

      if (s === 'trustedmember') {
        if (
          !c.trustedMembers.includes(
            user.id
          )
        ) {
          c.trustedMembers.push(
            user.id
          );
        }
      }

      if (s === 'untrustedmember') {
        c.trustedMembers =
          c.trustedMembers.filter(
            x => x !== user.id
          );
      }

      if (s === 'trustedbot') {
        if (
          !c.trustedBots.includes(
            user.id
          )
        ) {
          c.trustedBots.push(
            user.id
          );
        }
      }

      if (s === 'untrustedbot') {
        c.trustedBots =
          c.trustedBots.filter(
            x => x !== user.id
          );
      }

      if (s === 'trustedrole') {
        c.trustedRoleId =
          role.id;
      }

      if (s === 'untrustedrole') {
        c.trustedRoleId = null;
      }

      if (s === 'protectedrole') {
        if (
          !c.protectedRoles.includes(
            role.id
          )
        ) {
          c.protectedRoles.push(
            role.id
          );
        }
      }

      if (s === 'unprotectedrole') {
        c.protectedRoles =
          c.protectedRoles.filter(
            x => x !== role.id
          );
      }

      if (s === 'protectedchannel') {
        if (
          !c.protectedChannels.includes(
            channel.id
          )
        ) {
          c.protectedChannels.push(
            channel.id
          );
        }
      }

      if (s === 'unprotectedchannel') {
        c.protectedChannels =
          c.protectedChannels.filter(
            x => x !== channel.id
          );
      }

      save();

      if (s === 'list') {
        return editReply(
          i,
          '🔐 Security Trust & Protection',
          'Current trusted and protected resources.',
          0x5865F2,
          [
            field(
              'Trusted Members',
              c.trustedMembers
                .map(
                  x => mention(x)
                )
                .join(', ') ||
                'None'
            ),
            field(
              'Trusted Bots',
              c.trustedBots
                .map(
                  x => mention(x)
                )
                .join(', ') ||
                'None'
            ),
            field(
              'Trusted Role',
              c.trustedRoleId
                ? mention(
                    c.trustedRoleId,
                    'role'
                  )
                : 'None'
            ),
            field(
              'Protected Roles',
              c.protectedRoles
                .map(
                  x =>
                    mention(
                      x,
                      'role'
                    )
                )
                .join(', ') ||
                'None'
            ),
            field(
              'Protected Channels',
              c.protectedChannels
                .map(
                  x => `<#${x}>`
                )
                .join(', ') ||
                'None'
            )
          ]
        );
      }

      if (s === 'raid') {
        return editReply(
          i,
          '🚨 Raid Protection',
          'Current anti-raid configuration.',
          0xFEE75C,
          [
            field(
              'Enabled',
              c.enabled
                ? 'Yes'
                : 'No'
            ),
            field(
              'Join Threshold',
              `${c.raidJoinCount} joins`
            ),
            field(
              'Join Window',
              `${c.raidWindow / 1000}s`
            ),
            field(
              'Response',
              c.action
            )
          ]
        );
      }

      return editReply(
        i,
        '🔐 Security Configuration',
        'AkiyO security configuration has been processed.',
        c.enabled
          ? 0x57F287
          : 0xFEE75C,
        [
          field(
            'Status',
            c.enabled
              ? '🟢 Enabled'
              : '🔴 Disabled'
          ),
          field(
            'Response',
            c.action
          ),
          field(
            'Trusted Members',
            c.trustedMembers.length
          ),
          field(
            'Trusted Bots',
            c.trustedBots.length
          ),
          field(
            'Protected Roles',
            c.protectedRoles.length
          ),
          field(
            'Protected Channels',
            c.protectedChannels.length
          )
        ]
      );
    }

    /* ================= AUDIT ================= */

    if (cmd === 'auditlog') {
      if (!memberIsManager(i.member)) {
        return editReply(
          i,
          '🔒 Permission Required',
          'Manage Server or Administrator is required.',
          0xED4245
        );
      }

      const c = gc(i.guild);
      const s =
        i.options.getSubcommand();

      if (s === 'clear') {
        c.audit.history = [];
        save();

        return editReply(
          i,
          '🧹 Audit History Cleared',
          'AkiyO stored audit history has been cleared.',
          0x57F287,
          [
            field(
              'Cleared By',
              tagOf(i.user)
            ),
            field(
              'Status',
              '🟢 Complete'
            )
          ]
        );
      }

      if (s === 'status') {
        return editReply(
          i,
          '📋 Audit System Status',
          'AkiyO audit monitoring is operational.',
          0x57F287,
          [
            field(
              'Permission',
              i.guild.members.me?.permissions.has(
                PermissionFlagsBits.ViewAuditLog
              )
                ? '🟢 View Audit Log'
                : '🔴 Missing View Audit Log'
            ),
            field(
              'Stored Events',
              c.audit.history.length
            ),
            field(
              'Storage Limit',
              500
            )
          ]
        );
      }

      const history =
        c.audit.history
          .slice(-15)
          .reverse();

      const lines =
        history.map(
          (x, n) =>
            `**${n + 1}.** ${safe(x.action, 80)} • ${safe(x.executorId || 'Unknown', 30)} • ${safe(x.targetId || 'Unknown', 30)} • <t:${Math.floor((x.createdAt || Date.now()) / 1000)}:R>`
        ).join('\n') ||
        'No audit events stored yet.';

      return editReply(
        i,
        '📋 Recent Audit Activity',
        lines,
        0x5865F2,
        [
          field(
            'Events',
            history.length
          ),
          field(
            'Tracking',
            'Discord audit gateway'
          )
        ]
      );
    }

    /* ================= CONFIG ================= */

    if (cmd === 'config') {
      if (!memberIsManager(i.member)) {
        return editReply(
          i,
          '🔒 Permission Required',
          'Manage Server or Administrator is required.',
          0xED4245
        );
      }

      const c = gc(i.guild);
      const s =
        i.options.getSubcommand();

      if (s === 'view') {
        return editReply(
          i,
          '⚙️ Server Configuration',
          'AkiyO configuration summary for this server.',
          0x5865F2,
          [
            field(
              'Unified Logs',
              c.logs.all
                ? `<#${c.logs.all}>`
                : 'Not configured'
            ),
            field(
              'Staff Role',
              c.support.staffRoleId
                ? mention(
                    c.support.staffRoleId,
                    'role'
                  )
                : 'Not configured'
            ),
            field(
              'Ticket Category',
              c.support.categoryId
                ? `<#${c.support.categoryId}>`
                : 'Not configured'
            ),
            field(
              'AutoMod',
              c.automod.enabled
                ? '🟢 Enabled'
                : '🔴 Disabled'
            ),
            field(
              'Security',
              c.security.enabled
                ? '🟢 Enabled'
                : '🔴 Disabled'
            ),
            field(
              'Autorole',
              c.autorole.enabled
                ? mention(
                    c.autorole.roleId,
                    'role'
                  )
                : 'Disabled'
            ),
            field(
              'Welcome',
              c.welcome.enabled
                ? `<#${c.welcome.channelId}>`
                : 'Disabled'
            ),
            field(
              'Verification',
              c.verification.enabled
                ? '🟢 Enabled'
                : 'Disabled'
            )
          ]
        );
      }

      if (s === 'staffrole') {
        c.support.staffRoleId =
          i.options.getRole(
            'role'
          ).id;
      }

      if (s === 'ticketcategory') {
        c.support.categoryId =
          i.options.getChannel(
            'channel'
          ).id;
      }

      if (s === 'timeout') {
        c.automod.timeoutSeconds.spam =
          i.options.getInteger(
            'seconds'
          );
      }

      save();

      return editReply(
        i,
        '⚙️ Configuration Updated',
        'The selected server setting has been saved successfully.',
        0x57F287,
        [
          field(
            'Setting',
            s
          ),
          field(
            'Updated By',
            tagOf(i.user)
          ),
          field(
            'Status',
            '🟢 Applied'
          )
        ]
      );
    }

    /* ================= AUTOROLE ================= */

    if (cmd === 'autorole') {
      if (!memberIsManager(i.member)) {
        return editReply(
          i,
          '🔒 Permission Required',
          'Manage Server or Administrator is required.',
          0xED4245
        );
      }

      const c =
        gc(i.guild).autorole;

      const s =
        i.options.getSubcommand();

      if (s === 'set') {
        const role =
          i.options.getRole('role');

        if (
          role.position >=
          i.guild.members.me
            .roles.highest.position
        ) {
          return editReply(
            i,
            '⚠️ Role Hierarchy',
            'AkiyO needs its highest role above the autorole.',
            0xED4245
          );
        }

        c.enabled = true;
        c.roleId = role.id;

        save();

        return editReply(
          i,
          '👤 Autorole Enabled',
          'New members will receive the selected role.',
          0x57F287,
          [
            field(
              'Role',
              mention(
                role.id,
                'role'
              )
            ),
            field(
              'Updated By',
              tagOf(i.user)
            )
          ]
        );
      }

      if (s === 'disable') {
        c.enabled = false;
        save();

        return editReply(
          i,
          '👤 Autorole Disabled',
          'Automatic role assignment has been disabled.',
          0xFEE75C,
          [
            field(
              'Status',
              '🔴 Disabled'
            )
          ]
        );
      }

      return editReply(
        i,
        '👤 Autorole Status',
        'Current autorole configuration.',
        c.enabled
          ? 0x57F287
          : 0xFEE75C,
        [
          field(
            'Status',
            c.enabled
              ? '🟢 Enabled'
              : '🔴 Disabled'
          ),
          field(
            'Role',
            c.roleId
              ? mention(
                  c.roleId,
                  'role'
                )
              : 'None'
          )
        ]
      );
    }

    /* ================= WELCOME ================= */

    if (cmd === 'welcome') {
      if (!memberIsManager(i.member)) {
        return editReply(
          i,
          '🔒 Permission Required',
          'Manage Server or Administrator is required.',
          0xED4245
        );
      }

      const c =
        gc(i.guild).welcome;

      const s =
        i.options.getSubcommand();

      if (s === 'set') {
        c.enabled = true;

        c.channelId =
          i.options.getChannel(
            'channel'
          ).id;

        c.message =
          i.options.getString(
            'message'
          );

        save();

        return editReply(
          i,
          '👋 Welcome System Updated',
          'Welcome messages are now active.',
          0x57F287,
          [
            field(
              'Channel',
              `<#${c.channelId}>`
            ),
            field(
              'Message',
              c.message
            ),
            field(
              'Placeholders',
              '{user} • {username} • {displayname} • {server} • {count} • {id} • {created} • {joined}'
            )
          ]
        );
      }

      if (s === 'disable') {
        c.enabled = false;
        save();

        return editReply(
          i,
          '👋 Welcome Disabled',
          'Welcome messages have been disabled.',
          0xFEE75C
        );
      }

      return editReply(
        i,
        '👋 Welcome Status',
        'Current welcome configuration.',
        c.enabled
          ? 0x57F287
          : 0xFEE75C,
        [
          field(
            'Status',
            c.enabled
              ? '🟢 Enabled'
              : '🔴 Disabled'
          ),
          field(
            'Channel',
            c.channelId
              ? `<#${c.channelId}>`
              : 'None'
          ),
          field(
            'Message',
            c.message
          )
        ]
      );
    }

    /* ================= VERIFICATION ================= */

    if (cmd === 'verification') {
      if (!memberIsManager(i.member)) {
        return editReply(
          i,
          '🔒 Permission Required',
          'Manage Server or Administrator is required.',
          0xED4245
        );
      }

      const c =
        gc(i.guild).verification;

      const s =
        i.options.getSubcommand();

      if (s === 'setup') {
        const channel =
          i.options.getChannel(
            'channel'
          );

        const role =
          i.options.getRole('role');

        if (
          role.position >=
          i.guild.members.me
            .roles.highest.position
        ) {
          return editReply(
            i,
            '⚠️ Role Hierarchy',
            'AkiyO cannot assign this verification role because it is above or equal to the bot role.',
            0xED4245
          );
        }

        const row =
          new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(
                  'akiyo_verify'
                )
                .setLabel('Verify')
                .setEmoji('✅')
                .setStyle(
                  ButtonStyle.Success
                )
            );

        const msg =
          await channel.send({
            embeds: [
              result(
                '✅ Server Verification',
                'Click the button below to receive the verified role.',
                0x57F287,
                i.guild,
                [
                  field(
                    'Verified Role',
                    mention(
                      role.id,
                      'role'
                    )
                  ),
                  field(
                    'System',
                    'AkiyO Verification'
                  )
                ]
              )
            ],
            components: [row]
          });

        c.enabled = true;
        c.channelId = channel.id;
        c.roleId = role.id;
        c.messageId = msg.id;

        save();

        return editReply(
          i,
          '✅ Verification Setup Complete',
          'The verification panel has been published successfully.',
          0x57F287,
          [
            field(
              'Channel',
              `${channel}`
            ),
            field(
              'Verified Role',
              mention(
                role.id,
                'role'
              )
            ),
            field(
              'Message ID',
              msg.id
            ),
            field(
              'Status',
              '🟢 Active'
            )
          ]
        );
      }

      if (s === 'disable') {
        c.enabled = false;
        save();

        return editReply(
          i,
          '✅ Verification Disabled',
          'The verification system has been disabled.',
          0xFEE75C
        );
      }

      return editReply(
        i,
        '✅ Verification Status',
        'Current verification configuration.',
        c.enabled
          ? 0x57F287
          : 0xFEE75C,
        [
          field(
            'Status',
            c.enabled
              ? '🟢 Enabled'
              : '🔴 Disabled'
          ),
          field(
            'Channel',
            c.channelId
              ? `<#${c.channelId}>`
              : 'None'
          ),
          field(
            'Role',
            c.roleId
              ? mention(
                  c.roleId,
                  'role'
                )
              : 'None'
          )
        ]
      );
    }

    /* ================= REACTION ROLES ================= */

    if (cmd === 'autoreactionrole') {
      if (!memberIsManager(i.member)) {
        return editReply(
          i,
          '🔒 Permission Required',
          'Manage Server or Administrator is required.',
          0xED4245
        );
      }

      const c =
        gc(i.guild);

      const s =
        i.options.getSubcommand();

      if (s === 'list') {
        const rows = [];

        for (
          const [messageId, map]
          of Object.entries(
            c.reactionRoles
          )
        ) {
          for (
            const [key, x]
            of Object.entries(map)
          ) {
            rows.push(
              `• Message \`${messageId}\` • ${x.emoji || key} → ${mention(x.roleId, 'role')}`
            );
          }
        }

        return editReply(
          i,
          '🎭 Reaction Role Configuration',
          rows.join('\n') ||
            'No reaction roles configured.',
          0x5865F2,
          [
            field(
              'Entries',
              rows.length
            )
          ]
        );
      }

      const messageId =
        i.options.getString(
          'message_id'
        );

      const raw =
        i.options.getString(
          'emoji'
        );

      const role =
        i.options.getRole('role');

      const custom =
        raw.match(
          /^<a?:[^:>]+:(\d+)>$/
        );

      const key =
        custom
          ? custom[1]
          : raw;

      const msg =
        await i.channel.messages
          .fetch(messageId)
          .catch(() => null);

      if (!msg) {
        return editReply(
          i,
          '⚠️ Message Not Found',
          'The specified message must exist in the current channel.',
          0xED4245
        );
      }

      if (
        role.position >=
        i.guild.members.me
          .roles.highest.position
      ) {
        return editReply(
          i,
          '⚠️ Role Hierarchy',
          'AkiyO cannot manage this role because it is above the bot role.',
          0xED4245
        );
      }

      if (s === 'add') {
        c.reactionRoles[
          messageId
        ] ??= {};

        c.reactionRoles[
          messageId
        ][key] = {
          roleId: role.id,
          emoji: raw
        };

        await msg
          .react(raw)
          .catch(() => {});

        save();

        return editReply(
          i,
          '🎭 Reaction Role Added',
          'The reaction-role mapping is now active.',
          0x57F287,
          [
            field(
              'Emoji',
              raw
            ),
            field(
              'Role',
              mention(
                role.id,
                'role'
              )
            ),
            field(
              'Message ID',
              messageId
            )
          ]
        );
      }

      delete c.reactionRoles[
        messageId
      ]?.[key];

      save();

      return editReply(
        i,
        '🎭 Reaction Role Removed',
        'The reaction-role mapping has been removed.',
        0x57F287,
        [
          field(
            'Emoji',
            raw
          ),
          field(
            'Message ID',
            messageId
          )
        ]
      );
    }

    /* ================= ANNOUNCE ================= */

    if (cmd === 'announce') {
      if (
        !i.memberPermissions?.has(
          PermissionFlagsBits.ManageMessages
        ) &&
        !memberIsManager(i.member)
      ) {
        return editReply(
          i,
          '🔒 Permission Required',
          'Manage Messages or Manage Server is required.',
          0xED4245
        );
      }

      const channel =
        i.options.getChannel(
          'channel'
        );

      const message =
        i.options.getString(
          'message'
        );

      const title =
        i.options.getString(
          'title'
        ) ||
        '📢 Server Announcement';

      const footer =
        i.options.getString(
          'footer'
        ) ||
        'AkiyO • Announcements';

      const everyone =
        i.options.getBoolean(
          'everyone'
        ) || false;

      const e =
        result(
          title,
          message,
          0x5865F2,
          i.guild
        );

      e.setFooter({
        text: footer
      });

      await channel.send({
        content:
          everyone
            ? '@everyone'
            : undefined,

        allowedMentions:
          everyone
            ? {
                parse: [
                  'everyone'
                ]
              }
            : {
                parse: []
              },

        embeds: [e]
      });

      return editReply(
        i,
        '📢 Announcement Published',
        'Your announcement was sent successfully.',
        0x57F287,
        [
          field(
            'Channel',
            `${channel}`
          ),
          field(
            'Title',
            title
          ),
          field(
            'Everyone',
            everyone
              ? 'Yes'
              : 'No'
          ),
          field(
            'Published By',
            tagOf(i.user)
          )
        ]
      );
    }

    /* ================= AI ================= */

    if (cmd === 'ai') {
      const s =
        i.options.getSubcommand();

      if (s === 'reset') {
        aiHistory.delete(
          i.user.id
        );

        return editReply(
          i,
          '🤖 AI Conversation Reset',
          'Your AkiyO AI conversation history has been cleared.',
          0x9B59B6,
          [
            field(
              'User',
              tagOf(i.user)
            ),
            field(
              'Status',
              '🟢 Reset'
            )
          ]
        );
      }

      const prompt =
        i.options.getString(
          'prompt'
        );

      const r =
        await aiAsk(
          i.user.id,
          prompt
        );

      if (r.error) {
        return editReply(
          i,
          '🤖 AI Unavailable',
          r.error,
          0xED4245,
          [
            field(
              'Model',
              OPENAI_MODEL
            )
          ]
        );
      }

      await log(
        i.guild,
        'ai',
        '🤖 AI Request',
        [
          field(
            'User',
            tagOf(i.user)
          ),
          field(
            'Prompt',
            prompt
          ),
          field(
            'Model',
            OPENAI_MODEL
          ),
          field(
            'Status',
            'Completed'
          )
        ],
        0x9B59B6
      );

      return editReply(
        i,
        '🤖 AkiyO AI',
        r.text,
        0x9B59B6,
        [
          field(
            'Model',
            OPENAI_MODEL
          ),
          field(
            'Requested By',
            tagOf(i.user)
          )
        ]
      );
    }

  } catch (error) {
    console.error(
      `/${cmd}:`,
      error
    );

    if (i.guild) {
      log(
        i.guild,
        'system',
        '❌ Command Error',
        [
          field(
            'Command',
            `/${cmd}`
          ),
          field(
            'User',
            tagOf(i.user)
          ),
          field(
            'Error',
            error.message ||
              String(error)
          )
        ],
        0xED4245
      ).catch(() => {});
    }

    const description =
      'AkiyO could not complete this action. Check permissions, configuration and target hierarchy, then try again.';

    if (
      i.deferred ||
      i.replied
    ) {
      return editReply(
        i,
        '⚠️ Action Failed',
        description,
        0xED4245,
        [
          field(
            'Command',
            `/${cmd}`
          ),
          field(
            'Technical Detail',
            error.message ||
              'Unknown error'
          )
        ]
      ).catch(() => {});
    }

    return reply(
      i,
      '⚠️ Action Failed',
      description,
      0xED4245,
      [
        field(
          'Command',
          `/${cmd}`
        ),
        field(
          'Technical Detail',
          error.message ||
            'Unknown error'
        )
      ],
      {
        ephemeral: true
      }
    ).catch(() => {});
  }
}

/* ========================= BUTTONS ========================= */

client.on(
  'interactionCreate',
  async interaction => {

    if (!interaction.isButton()) {
      return handleInteraction(
        interaction
      );
    }

    try {

      /* ================= CREATE TICKET ================= */

      if (
        interaction.customId ===
        'akiyo_create_ticket'
      ) {
        await interaction.deferReply({
          ephemeral: true
        });

        const c =
          gc(interaction.guild);

        if (!c.support.categoryId) {
          return editReply(
            interaction,
            '🎫 Ticket Setup Required',
            'This server has not configured a ticket category.',
            0xFEE75C
          );
        }

        const r =
          await createTicket(
            interaction.guild,
            interaction.user
          );

        return editReply(
          interaction,
          '🎫 Ticket Created',
          `Your private ticket is ready: <#${r.channelId}>`,
          0x57F287,
          [
            field(
              'Status',
              '🟢 Open'
            ),
            field(
              'Owner',
              tagOf(
                interaction.user
              )
            )
          ]
        );
      }

      /* ================= VERIFY ================= */

      if (
        interaction.customId ===
        'akiyo_verify'
      ) {
        await interaction.deferReply({
          ephemeral: true
        });

        const c =
          gc(
            interaction.guild
          ).verification;

        if (
          !c.enabled ||
          !c.roleId
        ) {
          return editReply(
            interaction,
            '⚠️ Verification Unavailable',
            'Verification is not currently configured.',
            0xED4245
          );
        }

        const member =
          await interaction.guild.members
            .fetch(
              interaction.user.id
            );

        const role =
          await interaction.guild.roles
            .fetch(c.roleId)
            .catch(() => null);

        if (!role) {
          return editReply(
            interaction,
            '⚠️ Role Missing',
            'The configured verification role no longer exists.',
            0xED4245
          );
        }

        if (
          role.position >=
          interaction.guild.members
            .me.roles.highest.position
        ) {
          return editReply(
            interaction,
            '⚠️ Role Hierarchy',
            'AkiyO cannot assign this role.',
            0xED4245
          );
        }

        await member.roles.add(
          role,
          'AkiyO Verification'
        );

        await log(
          interaction.guild,
          'verification',
          '✅ Member Verified',
          [
            field(
              'Member',
              tagOf(
                interaction.user
              )
            ),
            field(
              'Role',
              mention(
                role.id,
                'role'
              )
            ),
            field(
              'Status',
              'Success'
            )
          ],
          0x57F287
        );

        return editReply(
          interaction,
          '✅ Verification Complete',
          'You have been successfully verified.',
          0x57F287,
          [
            field(
              'Verified Role',
              mention(
                role.id,
                'role'
              )
            ),
            field(
              'Member',
              tagOf(
                interaction.user
              )
            )
          ]
        );
      }

      /* ================= TICKET BUTTONS ================= */

      if (
        [
          'akiyo_ticket_claim',
          'akiyo_ticket_close',
          'akiyo_ticket_lock',
          'akiyo_ticket_transcript'
        ].includes(
          interaction.customId
        )
      ) {
        await interaction.deferReply({
          ephemeral: true
        });

        const record =
          ticketByChannel(
            interaction.guild,
            interaction.channel.id
          );

        if (!record) {
          return editReply(
            interaction,
            '🎫 Ticket Not Found',
            'This ticket record no longer exists.',
            0xED4245
          );
        }

        if (
          !memberIsStaff(
            interaction.member
          )
        ) {
          return editReply(
            interaction,
            '🔒 Staff Required',
            'Only support staff can use this ticket action.',
            0xED4245
          );
        }

        if (
          interaction.customId ===
          'akiyo_ticket_claim'
        ) {
          record.claimedBy =
            interaction.user.id;

          save();

          return editReply(
            interaction,
            '🙋 Ticket Claimed',
            'You are now assigned to this ticket.',
            0x57F287,
            [
              field(
                'Assigned Staff',
                mention(
                  interaction.user.id
                )
              )
            ]
          );
        }

        if (
          interaction.customId ===
          'akiyo_ticket_close'
        ) {
          await closeTicket(
            interaction.guild,
            record,
            interaction.user
          );

          return editReply(
            interaction,
            '🔒 Ticket Closed',
            'The ticket has been closed successfully.',
            0xFEE75C,
            [
              field(
                'Closed By',
                tagOf(
                  interaction.user
                )
              ),
              field(
                'Status',
                '🔴 Closed'
              )
            ]
          );
        }

        if (
          interaction.customId ===
          'akiyo_ticket_lock'
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

          save();

          return editReply(
            interaction,
            record.locked
              ? '🔐 Ticket Locked'
              : '🔓 Ticket Unlocked',
            record.locked
              ? 'The ticket owner can no longer send messages.'
              : 'The ticket owner can send messages again.',
            0x57F287,
            [
              field(
                'Status',
                record.locked
                  ? 'Locked'
                  : 'Unlocked'
              )
            ]
          );
        }

        if (
          interaction.customId ===
          'akiyo_ticket_transcript'
        ) {
          const file =
            await ticketTranscript(
              interaction.channel
            );

          return interaction.editReply({
            embeds: [
              result(
                '📄 Ticket Transcript',
                'Transcript generated successfully.',
                0x57F287,
                interaction.guild,
                [
                  field(
                    'Owner',
                    mention(
                      record.ownerId
                    )
                  ),
                  field(
                    'Generated By',
                    tagOf(
                      interaction.user
                    )
                  )
                ]
              )
            ],
            files: [
              {
                attachment: file,
                name:
                  `akiyo-ticket-${record.ownerId}.txt`
              }
            ]
          });
        }
      }

    } catch (error) {
      console.error(
        'Button error:',
        error
      );

      const payload =
        result(
          '⚠️ Action Failed',
          'AkiyO could not complete this button action.',
          0xED4245,
          interaction.guild,
          [
            field(
              'Technical Detail',
              error.message ||
                'Unknown error'
            )
          ]
        );

      if (
        interaction.deferred ||
        interaction.replied
      ) {
        await interaction
          .editReply({
            embeds: [payload]
          })
          .catch(() => {});
      } else {
        await interaction
          .reply({
            embeds: [payload],
            ephemeral: true
          })
          .catch(() => {});
      }
    }
  }
);

/* ========================= MESSAGE EVENTS ========================= */

client.on(
  'messageCreate',
  async message => {
    try {
      if (message.author.bot) {
        return;
      }

      if (message.guild) {

        await runAutoMod(
          message
        );

        const record =
          ticketByChannel(
            message.guild,
            message.channel.id
          );

        if (
          record &&
          record.ownerId ===
            message.author.id &&
          record.status ===
            'open' &&
          record.claimedBy
        ) {
          const staff =
            await client.users
              .fetch(
                record.claimedBy
              )
              .catch(() => null);

          if (staff) {
            await staff.send({
              embeds: [
                result(
                  '🎫 Ticket Owner Message',
                  `A new message was received in **#${message.channel.name}**.`,
                  0x5865F2,
                  message.guild,
                  [
                    field(
                      'Owner',
                      tagOf(
                        message.author
                      )
                    ),
                    field(
                      'Message',
                      message.content ||
                        '[Attachment]'
                    ),
                    field(
                      'Ticket',
                      `${message.channel}`
                    )
                  ]
                )
              ]
            }).catch(() => {});
          }
        }

      } else {

        const user =
          message.author;

        for (
          const guild
          of client.guilds.cache.values()
        ) {
          const ticket =
            getTicket(
              guild,
              user.id
            );

          if (
            ticket &&
            ticket.status ===
              'open'
          ) {
            const ch =
              await guild.channels
                .fetch(
                  ticket.channelId
                )
                .catch(() => null);

            if (ch?.isTextBased()) {
              await ch.send({
                embeds: [
                  result(
                    '📩 User DM Reply',
                    'A ticket owner replied by direct message.',
                    0x5865F2,
                    guild,
                    [
                      field(
                        'User',
                        tagOf(user)
                      ),
                      field(
                        'Message',
                        message.content ||
                          '[Attachment]'
                      )
                    ]
                  )
                ]
              }).catch(() => {});
            }
          }
        }
      }

    } catch (e) {
      console.error(
        'messageCreate:',
        e.message
      );
    }
  }
);

/* ========================= MESSAGE DELETE ========================= */

client.on(
  'messageDelete',
  async message => {
    if (
      !message.guild ||
      message.author?.bot
    ) {
      return;
    }

    await log(
      message.guild,
      'messages',
      '🗑️ Message Deleted',
      [
        field(
          'Author',
          message.author
            ? tagOf(
                message.author
              )
            : 'Unknown'
        ),
        field(
          'Channel',
          `${message.channel} (${message.channel.id})`
        ),
        field(
          'Content',
          message.content ||
            'Content unavailable'
        ),
        field(
          'Attachments',
          message.attachments?.size ||
            0
        )
      ],
      0xED4245
    );
  }
);

/* ========================= MESSAGE EDIT ========================= */

client.on(
  'messageUpdate',
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
      'messages',
      '✏️ Message Edited',
      [
        field(
          'Author',
          tagOf(
            newMessage.author
          )
        ),
        field(
          'Channel',
          `${newMessage.channel} (${newMessage.channel.id})`
        ),
        field(
          'Before',
          oldMessage.content ||
            'Unavailable'
        ),
        field(
          'After',
          newMessage.content ||
            'Unavailable'
        )
      ],
      0xFEE75C
    );
  }
);

/* ========================= MEMBER JOIN ========================= */

client.on(
  'guildMemberAdd',
  async member => {
    const c =
      gc(member.guild);

    await log(
      member.guild,
      'members',
      '👋 Member Joined',
      [
        field(
          'Member',
          tagOf(member.user)
        ),
        field(
          'ID',
          member.id
        ),
        field(
          'Account Created',
          `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`
        ),
        field(
          'Member Count',
          member.guild.memberCount
        )
      ],
      0x57F287
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
          .catch(() => null);

      if (
        role &&
        role.position <
          member.guild.members.me
            .roles.highest.position
      ) {
        await member.roles
          .add(
            role,
            'AkiyO Autorole'
          )
          .catch(() => {});
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

      if (channel?.isTextBased()) {
        let text =
          c.welcome.message;

        text =
          text.replaceAll(
            '{user}',
            `${member}`
          );

        text =
          text.replaceAll(
            '{username}',
            member.user.username
          );

        text =
          text.replaceAll(
            '{displayname}',
            member.displayName
          );

        text =
          text.replaceAll(
            '{server}',
            member.guild.name
          );

        text =
          text.replaceAll(
            '{count}',
            String(
              member.guild.memberCount
            )
          );

        text =
          text.replaceAll(
            '{id}',
            member.id
          );

        text =
          text.replaceAll(
            '{created}',
            `<t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`
          );

        text =
          text.replaceAll(
            '{joined}',
            `<t:${Math.floor((member.joinedTimestamp || Date.now()) / 1000)}:R>`
          );

        await channel.send({
          embeds: [
            result(
              '👋 Welcome!',
              text,
              0x57F287,
              member.guild,
              [
                field(
                  'Member',
                  tagOf(
                    member.user
                  )
                ),
                field(
                  'Member Count',
                  member.guild.memberCount
                )
              ]
            )
          ]
        }).catch(() => {});
      }
    }

    /* RAID */

    const now = Date.now();

    const key =
      member.guild.id;

    const arr =
      (raidTracker.get(key) || [])
        .filter(
          t =>
            now -
              t <
            c.security.raidWindow
        );

    arr.push(now);

    raidTracker.set(
      key,
      arr
    );

    if (
      c.security.enabled &&
      arr.length >=
        c.security.raidJoinCount
    ) {
      await log(
        member.guild,
        'security',
        '🚨 Possible Raid Detected',
        [
          field(
            'Recent Joins',
            arr.length
          ),
          field(
            'Window',
            `${c.security.raidWindow / 1000}s`
          ),
          field(
            'Threshold',
            c.security.raidJoinCount
          ),
          field(
            'Latest Member',
            tagOf(
              member.user
            )
          )
        ],
        0xED4245
      );

      raidTracker.set(
        key,
        []
      );
    }
  }
);

/* ========================= MEMBER LEAVE ========================= */

client.on(
  'guildMemberRemove',
  async member => {
    await log(
      member.guild,
      'members',
      '🚪 Member Left',
      [
        field(
          'Member',
          tagOf(member.user)
        ),
        field(
          'ID',
          member.id
        ),
        field(
          'Joined',
          member.joinedTimestamp
            ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>`
            : 'Unknown'
        )
      ],
      0xED4245
    );
  }
);

/* ========================= MEMBER UPDATE ========================= */

client.on(
  'guildMemberUpdate',
  async (
    oldMember,
    newMember
  ) => {

    const added =
      newMember.roles.cache
        .filter(
          r =>
            !oldMember.roles.cache.has(
              r.id
            )
        )
        .map(
          r => `${r}`
        )
        .join(', ') ||
      'None';

    const removed =
      oldMember.roles.cache
        .filter(
          r =>
            !newMember.roles.cache.has(
              r.id
            )
        )
        .map(
          r => `${r}`
        )
        .join(', ') ||
      'None';

    const nicknameChanged =
      oldMember.nickname !==
      newMember.nickname;

    if (
      added !== 'None' ||
      removed !== 'None' ||
      nicknameChanged
    ) {
      await log(
        newMember.guild,
        'members',
        '🔄 Member Updated',
        [
          field(
            'Member',
            tagOf(
              newMember.user
            )
          ),
          field(
            'Roles Added',
            added
          ),
          field(
            'Roles Removed',
            removed
          ),
          field(
            'Nickname',
            `${oldMember.nickname || oldMember.user.username} → ${newMember.nickname || newMember.user.username}`
          )
        ],
        0x5865F2
      );
    }
  }
);

/* ========================= CHANNEL CREATE ========================= */

client.on(
  'channelCreate',
  async channel => {
    if (!channel.guild) {
      return;
    }

    const executor =
      await findAuditExecutor(
        channel.guild,
        AuditLogEvent.ChannelCreate,
        channel.id
      );

    await securityEvent(
      channel.guild,
      'channelCreate',
      executor,
      `Created ${channel.name} (${channel.id})`
    );

    await log(
      channel.guild,
      'channels',
      '📁 Channel Created',
      [
        field(
          'Channel',
          `${channel} (${channel.id})`
        ),
        field(
          'Type',
          String(channel.type)
        ),
        field(
          'Category',
          channel.parent
            ? `${channel.parent}`
            : 'None'
        ),
        field(
          'Executor',
          executor
            ? mention(executor)
            : 'Unknown'
        )
      ],
      0x57F287
    );
  }
);

/* ========================= CHANNEL DELETE ========================= */

client.on(
  'channelDelete',
  async channel => {
    if (!channel.guild) {
      return;
    }

    const executor =
      await findAuditExecutor(
        channel.guild,
        AuditLogEvent.ChannelDelete,
        channel.id
      );

    const c =
      gc(channel.guild);

    if (
      c.security.protectedChannels
        .includes(channel.id) &&
      executor &&
      !trusted(
        channel.guild,
        executor
      )
    ) {
      await log(
        channel.guild,
        'security',
        '🚨 Protected Channel Deleted',
        [
          field(
            'Channel',
            `#${channel.name} (${channel.id})`
          ),
          field(
            'Executor',
            mention(executor)
          ),
          field(
            'Protection',
            'Triggered'
          )
        ],
        0xED4245
      );
    }

    await securityEvent(
      channel.guild,
      'channelDelete',
      executor,
      `Deleted #${channel.name} (${channel.id})`
    );

    await log(
      channel.guild,
      'channels',
      '🗑️ Channel Deleted',
      [
        field(
          'Channel',
          `#${channel.name} (${channel.id})`
        ),
        field(
          'Type',
          String(channel.type)
        ),
        field(
          'Executor',
          executor
            ? mention(executor)
            : 'Unknown'
        )
      ],
      0xED4245
    );
  }
);

/* ========================= ROLE CREATE ========================= */

client.on(
  'roleCreate',
  async role => {
    const executor =
      await findAuditExecutor(
        role.guild,
        AuditLogEvent.RoleCreate,
        role.id
      );

    await securityEvent(
      role.guild,
      'roleCreate',
      executor,
      `Created ${role.name} (${role.id})`
    );

    await log(
      role.guild,
      'roles',
      '➕ Role Created',
      [
        field(
          'Role',
          `${role} (${role.id})`
        ),
        field(
          'Position',
          role.position
        ),
        field(
          'Executor',
          executor
            ? mention(executor)
            : 'Unknown'
        )
      ],
      0x57F287
    );
  }
);

/* ========================= ROLE DELETE ========================= */

client.on(
  'roleDelete',
  async role => {
    const executor =
      await findAuditExecutor(
        role.guild,
        AuditLogEvent.RoleDelete,
        role.id
      );

    const c =
      gc(role.guild);

    if (
      c.security.protectedRoles
        .includes(role.id) &&
      executor &&
      !trusted(
        role.guild,
        executor
      )
    ) {
      await log(
        role.guild,
        'security',
        '🚨 Protected Role Deleted',
        [
          field(
            'Role',
            `${role.name} (${role.id})`
          ),
          field(
            'Executor',
            mention(executor)
          ),
          field(
            'Protection',
            'Triggered'
          )
        ],
        0xED4245
      );
    }

    await securityEvent(
      role.guild,
      'roleDelete',
      executor,
      `Deleted ${role.name} (${role.id})`
    );

    await log(
      role.guild,
      'roles',
      '➖ Role Deleted',
      [
        field(
          'Role',
          `${role.name} (${role.id})`
        ),
        field(
          'Position',
          role.position
        ),
        field(
          'Executor',
          executor
            ? mention(executor)
            : 'Unknown'
        )
      ],
      0xED4245
    );
  }
);

/* ========================= BANS ========================= */

client.on(
  'guildBanAdd',
  async ban => {
    const executor =
      await findAuditExecutor(
        ban.guild,
        AuditLogEvent.MemberBanAdd,
        ban.user.id
      );

    await securityEvent(
      ban.guild,
      'ban',
      executor,
      `Banned ${tagOf(ban.user)}`
    );

    await log(
      ban.guild,
      'moderation',
      '🔨 Member Banned',
      [
        field(
          'Member',
          tagOf(ban.user)
        ),
        field(
          'Executor',
          executor
            ? mention(executor)
            : 'Unknown'
        )
      ],
      0xED4245
    );
  }
);

client.on(
  'guildBanRemove',
  async ban => {
    const executor =
      await findAuditExecutor(
        ban.guild,
        AuditLogEvent.MemberBanRemove,
        ban.user.id
      );

    await log(
      ban.guild,
      'moderation',
      '🔓 Member Unbanned',
      [
        field(
          'Member',
          tagOf(ban.user)
        ),
        field(
          'Executor',
          executor
            ? mention(executor)
            : 'Unknown'
        )
      ],
      0x57F287
    );
  }
);

/* ========================= WEBHOOK ========================= */

client.on(
  'guildWebhookUpdate',
  async channel => {
    if (!channel.guild) {
      return;
    }

    await log(
      channel.guild,
      'security',
      '🔗 Webhook Update Detected',
      [
        field(
          'Channel',
          `${channel}`
        ),
        field(
          'Security',
          'Webhook activity detected. Review audit logs if unexpected.'
        )
      ],
      0xFEE75C
    );
  }
);

/* ========================= AUDIT LOG EVENT ========================= */

client.on(
  'guildAuditLogEntryCreate',
  async (
    entry,
    guild
  ) => {
    try {
      const c =
        gc(guild);

      const event = {
        id: entry.id,
        action: String(
          entry.action
        ),
        executorId:
          entry.executorId ||
          null,
        targetId:
          entry.targetId ||
          null,
        reason:
          entry.reason ||
          'No reason provided',
        changes:
          entry.changes || [],
        createdAt:
          entry.createdTimestamp ||
          Date.now()
      };

      const exists =
        c.audit.history.some(
          x => x.id === event.id
        );

      if (!exists) {
        c.audit.history.push(
          event
        );
      }

      if (
        c.audit.history.length >
        500
      ) {
        c.audit.history =
          c.audit.history.slice(
            -500
          );
      }

      save();

      await log(
        guild,
        'audit',
        '📜 Discord Audit Event',
        [
          field(
            'Action',
            event.action
          ),
          field(
            'Executor',
            event.executorId
              ? mention(
                  event.executorId
                )
              : 'Unknown'
          ),
          field(
            'Target ID',
            event.targetId ||
              'Unknown'
          ),
          field(
            'Reason',
            event.reason
          ),
          field(
            'Event ID',
            event.id
          ),
          field(
            'Changes',
            event.changes
              ?.map(
                x =>
                  `${x.key}: ${safe(x.old, 100)} → ${safe(x.new, 100)}`
              )
              .join('\n') ||
              'None'
          )
        ],
        0x5865F2
      );

    } catch (e) {
      console.error(
        'Audit event:',
        e.message
      );
    }
  }
);

/* ========================= REACTION ROLE ADD ========================= */

client.on(
  'messageReactionAdd',
  async (
    reaction,
    user
  ) => {
    if (user.bot) {
      return;
    }

    try {
      if (reaction.partial) {
        await reaction.fetch();
      }

      const guild =
        reaction.message.guild;

      if (!guild) {
        return;
      }

      const map =
        gc(guild)
          .reactionRoles?.[
            reaction.message.id
          ];

      const key =
        reaction.emoji.id ||
        reaction.emoji.name;

      const rr =
        map?.[key];

      if (!rr) {
        return;
      }

      const member =
        await guild.members
          .fetch(user.id);

      const role =
        await guild.roles
          .fetch(rr.roleId);

      if (
        role &&
        role.position <
          guild.members.me
            .roles.highest.position
      ) {
        await member.roles.add(
          role,
          'AkiyO Reaction Role'
        );

        await log(
          guild,
          'reactionRoles',
          '🎭 Reaction Role Assigned',
          [
            field(
              'User',
              tagOf(user)
            ),
            field(
              'Role',
              mention(
                role.id,
                'role'
              )
            ),
            field(
              'Message ID',
              reaction.message.id
            ),
            field(
              'Emoji',
              rr.emoji
            )
          ],
          0x57F287
        );
      }

    } catch (e) {
      console.error(
        'Reaction add:',
        e.message
      );
    }
  }
);

/* ========================= REACTION ROLE REMOVE ========================= */

client.on(
  'messageReactionRemove',
  async (
    reaction,
    user
  ) => {
    if (user.bot) {
      return;
    }

    try {
      if (reaction.partial) {
        await reaction.fetch();
      }

      const guild =
        reaction.message.guild;

      if (!guild) {
        return;
      }

      const rr =
        gc(guild)
          .reactionRoles?.[
            reaction.message.id
          ]?.[
            reaction.emoji.id ||
              reaction.emoji.name
          ];

      if (!rr) {
        return;
      }

      const member =
        await guild.members
          .fetch(user.id);

      const role =
        await guild.roles
          .fetch(rr.roleId);

      if (role) {
        await member.roles.remove(
          role,
          'AkiyO Reaction Role Removed'
        );
      }

    } catch {}
  }
);

/* ========================= READY ========================= */

client.once(
  'clientReady',
  async () => {
    console.log(
      `✅ AkiyO online as ${client.user.tag}`
    );

    console.log(
      `📊 Connected to ${client.guilds.cache.size} server(s)`
    );

    try {
      const rest =
        new REST({
          version: '10'
        }).setToken(TOKEN);

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
        `✅ Registered ${commands.length} global commands.`
      );

    } catch (e) {
      console.error(
        '❌ Command registration error:',
        e
      );
    }
  }
);

/* ========================= PROCESS SAFETY ========================= */

process.on(
  'unhandledRejection',
  error => {
    console.error(
      'Unhandled rejection:',
      error
    );
  }
);

process.on(
  'uncaughtException',
  error => {
    console.error(
      'Uncaught exception:',
      error
    );
  }
);

/* ========================= LOGIN ========================= */

client.login(TOKEN)
  .then(() => {
    console.log(
      '🔐 Discord login successful.'
    );
  })
  .catch(error => {
    console.error(
      '❌ Discord login failed:',
      error
    );

    process.exit(1);
  });
