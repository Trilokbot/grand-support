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

// ======================================================
// AKIYO — FULL MULTI-SERVER DISCORD BOT
// ======================================================

const PORT = Number(process.env.PORT) || 10000;

http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/plain'
  });
  res.end('AKIYO BOT ONLINE');
}).listen(PORT, '0.0.0.0');

const TOKEN = process.env.DISCORD_TOKEN || process.env.TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || '1542750606739898428';

if (!TOKEN) {
  console.error('❌ Missing DISCORD_TOKEN environment variable.');
  process.exit(1);
}

// ======================================================
// DISCORD CLIENT
// ======================================================

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

// ======================================================
// DATABASE
// ======================================================

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'database.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, {
    recursive: true
  });
}

const LOG_TYPES = [
  'automod',
  'audit',
  'security',
  'suggestion',
  'moderation',
  'members',
  'messages',
  'channels',
  'roles',
  'tickets',
  'verification',
  'reactionRoles',
  'welcome',
  'leaderboard',
  'announcements',
  'config'
];

// ======================================================
// DEFAULT SERVER CONFIG
// ======================================================

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

    massWebhookCreate: 2,

    action: 'timeout',

    trustedUsers: [],
    trustedBots: [],
    trustedMembers: [],

    trustedRoleId: null,

    protectedRoles: [],
    protectedChannels: [],

    roleSnapshots: {},
    channelSnapshots: {},

    logChannelId: null
  },

  logs: Object.fromEntries(
    LOG_TYPES.map(x => [x, null])
  ),

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

    message:
      'Welcome {user} to {server}! You are member #{count}.'
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
    message: 'AkiyO announcement.',
    intervalMinutes: 60,
    _lastSent: 0
  },

  warnings: {},

  punishments: {},

  suggestions: {}
};

const DEFAULT_DB = {
  guilds: {},
  tickets: {},
  dmTickets: {},
  meta: {
    version: 2
  }
};

function clone(value) {
  return JSON.parse(
    JSON.stringify(value)
  );
}

function merge(a, b) {

  for (const [key, value] of Object.entries(b || {})) {

    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {

      a[key] = merge(
        a[key] || {},
        value
      );

    } else if (value !== undefined) {

      a[key] = value;

    }
  }

  return a;
}

let db = clone(DEFAULT_DB);

try {

  if (fs.existsSync(DATA_FILE)) {

    const saved =
      JSON.parse(
        fs.readFileSync(
          DATA_FILE,
          'utf8'
        )
      );

    db = merge(
      clone(DEFAULT_DB),
      saved
    );
  }

} catch (error) {

  console.error(
    'Database load error:',
    error.message
  );

  db = clone(DEFAULT_DB);
}

function save() {

  try {

    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify(
        db,
        null,
        2
      )
    );

  } catch (error) {

    console.error(
      'Database save error:',
      error.message
    );
  }
}

// ======================================================
// GET SERVER CONFIG
// ======================================================

function gc(guild) {

  if (!guild) return null;

  db.guilds[guild.id] =
    merge(
      clone(DEFAULT_GUILD),
      db.guilds[guild.id] || {}
    );

  return db.guilds[guild.id];
}

// ======================================================
// MEMORY TRACKERS
// ======================================================

const spamTracker = new Map();
const repeatTracker = new Map();

const securityTracker = new Map();
const raidTracker = new Map();

const claims = new Map();

const aiHistory = new Map();

// ======================================================
// HELPERS
// ======================================================

function field(
  name,
  value,
  inline = false
) {

  return {
    name: String(name).slice(0, 256),

    value:
      String(value ?? '-')
        .slice(0, 1024),

    inline
  };
}

function isStaff(member) {

  if (!member) return false;

  const c = gc(member.guild);

  return (
    member.permissions.has(
      PermissionFlagsBits.Administrator
    ) ||

    member.permissions.has(
      PermissionFlagsBits.ManageGuild
    ) ||

    (
      c.ticket.staffRoleId &&
      member.roles.cache.has(
        c.ticket.staffRoleId
      )
    )
  );
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

function botMember(guild) {

  return guild.members.me;
}

function botCanManageRole(
  guild,
  role
) {

  return !!role &&
    !!botMember(guild) &&
    role.position <
      botMember(guild)
        .roles.highest.position;
}

function isTrusted(
  guild,
  id
) {

  const c = gc(guild);

  const member =
    guild.members.cache.get(id);

  return !!(
    id &&

    (
      member?.permissions.has(
        PermissionFlagsBits.Administrator
      ) ||

      c.security.trustedUsers.includes(id) ||

      c.security.trustedBots.includes(id) ||

      c.security.trustedMembers.includes(id) ||

      (
        c.security.trustedRoleId &&
        member?.roles.cache.has(
          c.security.trustedRoleId
        )
      )
    )
  );
}

function ownerIds() {

  const set =
    new Set(
      (process.env.BOT_OWNER_IDS || '')
        .split(',')
        .map(x => x.trim())
        .filter(Boolean)
    );

  const owner =
    client.application?.owner;

  if (owner?.id) {
    set.add(owner.id);
  }

  if (owner?.members) {

    for (
      const [, member]
      of owner.members
    ) {

      set.add(member.id);

    }
  }

  return set;
}

function isBotOwner(id) {

  return ownerIds().has(id);
}

function fmtWelcome(
  text,
  member
) {

  return String(text)

    .replaceAll(
      '{user}',
      member.toString()
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
}

// ======================================================
// LOG SYSTEM
// ======================================================

async function sendLog(
  guild,
  type,
  title,
  fields = [],
  color = 0x5865f2
) {

  const c = gc(guild);

  const channelId =
    c.logs[type] ||
    c.logs.audit ||
    c.logs.security;

  if (!channelId) return;

  const channel =
    await guild.channels
      .fetch(channelId)
      .catch(() => null);

  if (!channel?.isTextBased()) {
    return;
  }

  const embed =
    new EmbedBuilder()
      .setTitle(title)
      .setColor(color)
      .setTimestamp();

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

// ======================================================
// PUNISHMENT DATABASE
// ======================================================

async function punishRecord(
  guild,
  userId,
  type,
  reason,
  moderatorId
) {

  const c = gc(guild);

  c.punishments[userId] ||= [];

  c.punishments[userId].push({
    type,
    reason,
    moderatorId,
    time: Date.now()
  });

  save();
}

// ======================================================
// WARNING SYSTEM
// ======================================================

async function addWarning(
  member,
  reason,
  moderatorId
) {

  const c = gc(member.guild);

  c.warnings[member.id] ||= [];

  c.warnings[member.id].push({
    reason,
    moderatorId,
    time: Date.now()
  });

  await punishRecord(
    member.guild,
    member.id,
    'warn',
    reason,
    moderatorId
  );

  const count =
    c.warnings[member.id].length;

  // 3 warnings = 10 minute timeout
  if (
    count === 3 &&
    member.moderatable
  ) {

    await member
      .timeout(
        10 * 60 * 1000,
        'Warning escalation: 3 warnings'
      )
      .catch(() => {});

    await punishRecord(
      member.guild,
      member.id,
      'timeout',
      'Warning escalation: 3 warnings',
      client.user.id
    );
  }

  // 5 warnings = kick
  else if (
    count === 5 &&
    member.kickable
  ) {

    await member
      .kick(
        'Warning escalation: 5 warnings'
      )
      .catch(() => {});

    await punishRecord(
      member.guild,
      member.id,
      'kick',
      'Warning escalation: 5 warnings',
      client.user.id
    );
  }

  // 7 warnings = ban
  else if (
    count >= 7 &&
    member.bannable
  ) {

    await member
      .ban({
        reason:
          'Warning escalation: 7+ warnings'
      })
      .catch(() => {});

    await punishRecord(
      member.guild,
      member.id,
      'ban',
      'Warning escalation: 7+ warnings',
      client.user.id
    );
  }

  save();

  return count;
}

// ======================================================
// DURATION PARSER
// ======================================================

function parseDuration(input) {

  const match =
    String(input || '')
      .trim()
      .match(
        /^(\d+)\s*(s|m|h|d|w)$/i
      );

  if (!match) {
    return null;
  }

  const number =
    Number(match[1]);

  const multiplier = {
    s: 1000,
    m: 60000,
    h: 3600000,
    d: 86400000,
    w: 604800000
  }[
    match[2].toLowerCase()
  ];

  const ms =
    number * multiplier;

  if (
    ms <= 0 ||
    ms > 28 * 86400000
  ) {
    return null;
  }

  return ms;
}

// ======================================================
// TICKET SYSTEM
// ======================================================

function ticketRecord(
  channelId
) {

  return db.tickets[channelId] || null;
}

function activeDmTicket(
  userId
) {

  const list =
    Array.isArray(
      db.dmTickets[userId]
    )
      ? db.dmTickets[userId]
      : [];

  for (
    let i = list.length - 1;
    i >= 0;
    i--
  ) {

    const ticket =
      db.tickets[
        list[i].channelId
      ];

    if (
      ticket &&
      ticket.status !== 'deleted'
    ) {

      return {
        ...list[i],
        ...ticket
      };
    }
  }

  return null;
}

function addDmMapping(
  userId,
  guildId,
  channelId
) {

  db.dmTickets[userId] ||= [];

  db.dmTickets[userId] =
    db.dmTickets[userId]
      .filter(
        x => db.tickets[x.channelId]
      );

  if (
    !db.dmTickets[userId]
      .some(
        x =>
          x.channelId === channelId
      )
  ) {

    db.dmTickets[userId].push({
      guildId,
      channelId
    });
  }
}

function removeDmMapping(
  userId,
  channelId
) {

  if (!db.dmTickets[userId]) {
    return;
  }

  db.dmTickets[userId] =
    db.dmTickets[userId]
      .filter(
        x =>
          x.channelId !== channelId
      );

  if (
    !db.dmTickets[userId].length
  ) {

    delete db.dmTickets[userId];

  }
}

function ticketButtons(
  closed = false
) {

  if (closed) {

    return new ActionRowBuilder()
      .addComponents(

        new ButtonBuilder()
          .setCustomId(
            'ticket_reopen'
          )
          .setLabel('Reopen')
          .setEmoji('🔓')
          .setStyle(
            ButtonStyle.Success
          ),

        new ButtonBuilder()
          .setCustomId(
            'ticket_delete'
          )
          .setLabel('Delete')
          .setEmoji('🗑️')
          .setStyle(
            ButtonStyle.Danger
          ),

        new ButtonBuilder()
          .setCustomId(
            'ticket_transcript'
          )
          .setLabel('Transcript')
          .setEmoji('📄')
          .setStyle(
            ButtonStyle.Secondary
          )
      );
  }

  return new ActionRowBuilder()
    .addComponents(

      new ButtonBuilder()
        .setCustomId(
          'ticket_claim'
        )
        .setLabel('Claim')
        .setEmoji('🙋')
        .setStyle(
          ButtonStyle.Primary
        ),

      new ButtonBuilder()
        .setCustomId(
          'ticket_close'
        )
        .setLabel('Close')
        .setEmoji('🔒')
        .setStyle(
          ButtonStyle.Danger
        ),

      new ButtonBuilder()
        .setCustomId(
          'ticket_lock'
        )
        .setLabel('Lock')
        .setEmoji('🔐')
        .setStyle(
          ButtonStyle.Secondary
        ),

      new ButtonBuilder()
        .setCustomId(
          'ticket_transcript'
        )
        .setLabel('Transcript')
        .setEmoji('📄')
        .setStyle(
          ButtonStyle.Secondary
        )
    );
}

// ======================================================
// CREATE TICKET
// ======================================================

async function createTicket(
  guild,
  user,
  reason = 'No reason provided'
) {

  const c = gc(guild);

  const existing =
    activeDmTicket(user.id);

  if (
    existing &&
    existing.guildId === guild.id
  ) {

    const old =
      await guild.channels
        .fetch(existing.channelId)
        .catch(() => null);

    if (old) {
      return old;
    }

    delete db.tickets[
      existing.channelId
    ];
  }

  if (!c.ticket.staffRoleId) {

    throw new Error(
      'Ticket staff role is not configured. Use /ticketsetup first.'
    );
  }

  const role =
    await guild.roles
      .fetch(
        c.ticket.staffRoleId
      )
      .catch(() => null);

  if (!role) {

    throw new Error(
      'Configured ticket staff role no longer exists.'
    );
  }

  const safeName =
    user.username
      .toLowerCase()
      .replace(
        /[^a-z0-9-]/g,
        ''
      )
      .slice(0, 18)
      ||
      'user';

  const channel =
    await guild.channels.create({

      name:
        `ticket-${safeName}`,

      type:
        ChannelType.GuildText,

      parent:
        c.ticket.categoryId ||
        undefined,

      topic:
        `AKIYO_TICKET|${user.id}|${guild.id}|${Date.now()}|open`,

      permissionOverwrites: [

        {
          id:
            guild.roles.everyone.id,

          deny: [
            PermissionFlagsBits.ViewChannel
          ]
        },

        {
          id:
            role.id,

          allow: [
            PermissionFlagsBits.ViewChannel,
            PermissionFlagsBits.SendMessages,
            PermissionFlagsBits.ReadMessageHistory,
            PermissionFlagsBits.AttachFiles
          ]
        },

        {
          id:
            user.id,

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

    guildId:
      guild.id,

    userId:
      user.id,

    channelId:
      channel.id,

    reason,

    createdAt:
      Date.now(),

    status:
      'open',

    claimedBy:
      null
  };

  addDmMapping(
    user.id,
    guild.id,
    channel.id
  );

  await channel.send({

    content:
      `${role} <@${user.id}>`,

    embeds: [

      new EmbedBuilder()

        .setTitle(
          '🎫 New AkiyO Support Ticket'
        )

        .setDescription(
          `**User:** <@${user.id}>\n` +
          `**Reason:** ${reason}`
        )

        .setTimestamp()

    ],

    components: [
      ticketButtons()
    ]
  });

  await user
    .send(
      `🎫 Your AkiyO support ticket was created in **${guild.name}**.\n\n` +
      `You can reply to this DM to contact the support team.`
    )
    .catch(() => {});

  await sendLog(
    guild,
    'tickets',
    '🎫 Ticket Created',
    [
      field(
        'User',
        `${user.tag} (${user.id})`
      ),

      field(
        'Channel',
        channel.toString()
      ),

      field(
        'Reason',
        reason
      )
    ],
    0x57f287
  );

  save();

  return channel;
}

// ======================================================
// CLOSE TICKET
// ======================================================

async function closeTicket(
  record,
  channel,
  by
) {

  record.status = 'closed';

  const user =
    await client.users
      .fetch(record.userId)
      .catch(() => null);

  await channel
    .permissionOverwrites
    .edit(
      record.userId,
      {
        ViewChannel: true,
        SendMessages: false,
        ReadMessageHistory: true
      }
    )
    .catch(() => {});

  removeDmMapping(
    record.userId,
    record.channelId
  );

  await channel
    .send({
      content:
        '🔒 **Ticket closed.** Staff can use `/reopen` to reopen it.',

      components: [
        ticketButtons(true)
      ]
    })
    .catch(() => {});

  if (user) {

    await user
      .send(
        `🔒 Your AkiyO ticket in **${channel.guild.name}** was closed.`
      )
      .catch(() => {});

  }

  await sendLog(
    channel.guild,
    'tickets',
    '🔒 Ticket Closed',
    [
      field(
        'User',
        `<@${record.userId}>`
      ),

      field(
        'Closed by',
        by.toString()
      )
    ]
  );

  save();
}

// ======================================================
// TRANSCRIPT
// ======================================================

async function ticketTranscript(
  channel
) {

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

    if (!batch?.size) {
      break;
    }

    messages.push(
      ...batch.values()
    );

    before =
      batch.last().id;

    if (batch.size < 100) {
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
            .map(
              attachment =>
                attachment.url
            )
            .join(' ');

        return (

          `[${message.createdAt.toISOString()}] ` +

          `${message.author.tag} ` +

          `(${message.author.id})\n` +

          `${message.content || ''}` +

          (
            attachments
              ? `\n${attachments}`
              : ''
          )

        );

      })
      .join('\n\n');

  return Buffer.from(
    text || 'No messages.',
    'utf8'
  );
}

// ======================================================
// DELETE TICKET
// ======================================================

async function deleteTicket(
  record,
  channel
) {

  removeDmMapping(
    record.userId,
    record.channelId
  );

  delete db.tickets[
    record.channelId
  ];

  claims.delete(
    record.channelId
  );

  save();

  await sendLog(
    channel.guild,
    'tickets',
    '🗑️ Ticket Deleted',
    [
      field(
        'User',
        `<@${record.userId}>`
      ),

      field(
        'Channel',
        channel.toString()
      )
    ]
  );

  await channel
    .delete()
    .catch(() => {});
}

// ======================================================
// AUTOMOD
// ======================================================

async function runAutomod(
  message
) {

  if (
    !message.guild ||
    !message.member ||
    message.author.bot
  ) {
    return;
  }

  const c =
    gc(message.guild);

  if (
    !c.automod.enabled ||
    isTrusted(
      message.guild,
      message.author.id
    ) ||
    isStaff(message.member)
  ) {
    return;
  }

  const text =
    message.content || '';

  const lower =
    text.toLowerCase();

  let type = null;
  let reason = null;

  // INVITE
  if (
    c.automod.invite &&
    /(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)[a-z0-9-]+/i
      .test(text)
  ) {

    type = 'invite';

    reason =
      'Discord invite link';
  }

  // MASS MENTIONS
  else if (
    c.automod.massMentions &&
    (
      message.mentions.everyone ||

      message.mentions.users.size >=
        c.automod.userMentionsLimit ||

      message.mentions.roles.size >=
        c.automod.roleMentionsLimit
    )
  ) {

    type =
      'massmention';

    reason =
      'Mass/excessive mentions';
  }

  else {

    const letters =
      text.replace(
        /[^A-Za-z]/g,
        ''
      );

    const upper =
      letters.replace(
        /[^A-Z]/g,
        ''
      ).length;

    // CAPS
    if (
      letters.length >= 8 &&
      (
        upper /
        letters.length
      ) *
      100 >=
      c.automod.capsPercent
    ) {

      type = 'caps';

      reason =
        'Excessive capital letters';
    }

    // BAD WORDS
    for (
      const word
      of c.automod.badWords
    ) {

      if (
        word &&
        lower.includes(
          String(word).toLowerCase()
        )
      ) {

        type =
          'badword';

        reason =
          `Blocked word: ${word}`;

        break;
      }
    }
  }

  const now =
    Date.now();

  const key =
    `${message.guild.id}:${message.author.id}`;

  // SPAM
  if (!type) {

    const arr =
      (
        spamTracker.get(key) ||
        []
      )
        .filter(
          time =>
            now - time <
            c.automod.spamWindow
        );

    arr.push(now);

    spamTracker.set(
      key,
      arr
    );

    if (
      arr.length >=
      c.automod.spamLimit
    ) {

      type =
        'spam';

      reason =
        `Spam: ${arr.length} messages in ${c.automod.spamWindow / 1000}s`;

      spamTracker.delete(key);
    }

    // REPEATED MESSAGE
    const previous =
      repeatTracker.get(key) ||
      {
        text: '',
        count: 0,
        time: 0
      };

    previous.count =
      previous.text === text &&
      now - previous.time <
        30000
        ? previous.count + 1
        : 1;

    previous.text =
      text;

    previous.time =
      now;

    repeatTracker.set(
      key,
      previous
    );

    if (
      !type &&
      previous.count >=
        c.automod.repeatedLimit
    ) {

      type =
        'repeat';

      reason =
        `Repeated message ${c.automod.repeatedLimit}+ times`;

      repeatTracker.delete(key);
    }
  }

  if (!type) {
    return;
  }

  const action =
    c.automod.actions[type] ||
    'delete';

  await message
    .delete()
    .catch(() => {});

  if (
    action === 'timeout' &&
    message.member.moderatable
  ) {

    await message.member
      .timeout(
        (
          c.automod.timeoutSeconds[type] ||
          60
        ) * 1000,

        `AutoMod: ${reason}`
      )
      .catch(() => {});
  }

  if (action === 'warn') {

    await addWarning(
      message.member,
      `AutoMod: ${reason}`,
      client.user.id
    );
  }

  await sendLog(
    message.guild,
    'automod',
    '🛡️ AutoMod Action',
    [
      field(
        'User',
        `${message.author.tag} (${message.author.id})`
      ),

      field(
        'Reason',
        reason
      ),

      field(
        'Action',
        action
      ),

      field(
        'Channel',
        message.channel.toString()
      )
    ],
    0xed4245
  );
}

// ======================================================
// ANTI-NUKE
// ======================================================

async function securityAction(
  guild,
  executorId,
  event,
  detail
) {

  const c =
    gc(guild);

  if (
    !c.security.enabled ||
    !executorId ||
    isTrusted(
      guild,
      executorId
    )
  ) {
    return;
  }

  const key =
    `${guild.id}:${event}:${executorId}`;

  const now =
    Date.now();

  const arr =
    (
      securityTracker.get(key) ||
      []
    )
      .filter(
        time =>
          now - time < 30000
      );

  arr.push(now);

  securityTracker.set(
    key,
    arr
  );

  const limits = {

    ban:
      c.security.massBan,

    kick:
      c.security.massKick,

    channelDelete:
      c.security.massChannelDelete,

    roleDelete:
      c.security.massRoleDelete,

    channelCreate:
      c.security.massChannelCreate,

    roleCreate:
      c.security.massRoleCreate,

    webhookCreate:
      c.security.massWebhookCreate
  };

  const limit =
    limits[event] ||
    999999;

  if (
    arr.length < limit
  ) {
    return;
  }

  securityTracker.delete(key);

  await sendLog(
    guild,
    'security',
    '🚨 Anti-Nuke Triggered',
    [
      field(
        'Executor',
        `<@${executorId}>`
      ),

      field(
        'Event',
        event
      ),

      field(
        'Count',
        arr.length
      ),

      field(
        'Details',
        detail
      )
    ],
    0xed4245
  );

  const member =
    await guild.members
      .fetch(executorId)
      .catch(() => null);

  if (
    !member ||
    !member.moderatable
  ) {
    return;
  }

  if (
    c.security.action === 'ban' &&
    member.bannable
  ) {

    await member
      .ban({
        reason:
          `AkiyO Anti-Nuke: ${event}`
      })
      .catch(() => {});
  }

  else if (
    c.security.action === 'kick' &&
    member.kickable
  ) {

    await member
      .kick(
        `AkiyO Anti-Nuke: ${event}`
      )
      .catch(() => {});
  }

  else if (
    c.security.action === 'timeout' &&
    member.moderatable
  ) {

    await member
      .timeout(
        60 * 60 * 1000,
        `AkiyO Anti-Nuke: ${event}`
      )
      .catch(() => {});
  }
}

// ======================================================
// SLASH COMMANDS
// ======================================================

const commands = [];

const addCommand = command =>
  commands.push(
    command.toJSON()
  );

// HELP

addCommand(
  new SlashCommandBuilder()
    .setName('help')
    .setDescription(
      'Show all AkiyO commands.'
    )
);

// TICKETS

addCommand(
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription(
      'Create a support ticket.'
    )
    .addStringOption(
      option =>
        option
          .setName('reason')
          .setDescription(
            'Reason for opening the ticket.'
          )
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName('ticketpanel')
    .setDescription(
      'Send the support ticket panel.'
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName('ticketsetup')
    .setDescription(
      'Configure the ticket system.'
    )

    .addChannelOption(
      option =>
        option
          .setName('category')
          .setDescription(
            'Ticket category.'
          )
          .addChannelTypes(
            ChannelType.GuildCategory
          )
          .setRequired(true)
    )

    .addRoleOption(
      option =>
        option
          .setName('staffrole')
          .setDescription(
            'Ticket staff role.'
          )
          .setRequired(true)
    )

    .addChannelOption(
      option =>
        option
          .setName('logchannel')
          .setDescription(
            'Ticket log channel.'
          )
          .addChannelTypes(
            ChannelType.GuildText
          )
    )
);

for (
  const name
  of [
    'close',
    'reopen',
    'delete',
    'claim',
    'unclaim',
    'lock',
    'unlock',
    'transcript'
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
    .setName('ticketstats')
    .setDescription(
      'Show ticket statistics.'
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName('ticketadd')
    .setDescription(
      'Add a user to this ticket.'
    )
    .addUserOption(
      option =>
        option
          .setName('user')
          .setDescription('User.')
          .setRequired(true)
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName('ticketremove')
    .setDescription(
      'Remove a user from this ticket.'
    )
    .addUserOption(
      option =>
        option
          .setName('user')
          .setDescription('User.')
          .setRequired(true)
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName('ticketrename')
    .setDescription(
      'Rename this ticket.'
    )
    .addStringOption(
      option =>
        option
          .setName('name')
          .setDescription(
            'New ticket name.'
          )
          .setRequired(true)
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName('ticketinfo')
    .setDescription(
      'Show ticket information.'
    )
);

// AUTOMOD

addCommand(
  new SlashCommandBuilder()
    .setName('automod')
    .setDescription(
      'Configure advanced AutoMod.'
    )

    .addSubcommand(
      sub =>
        sub
          .setName('enable')
          .setDescription(
            'Enable AutoMod.'
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('disable')
          .setDescription(
            'Disable AutoMod.'
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('status')
          .setDescription(
            'View AutoMod status.'
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('config')
          .setDescription(
            'Configure AutoMod.'
          )

          .addIntegerOption(
            option =>
              option
                .setName('spam_limit')
                .setDescription(
                  'Messages before spam action.'
                )
                .setMinValue(3)
                .setMaxValue(30)
          )

          .addIntegerOption(
            option =>
              option
                .setName('spam_window')
                .setDescription(
                  'Spam window in seconds.'
                )
                .setMinValue(2)
                .setMaxValue(30)
          )

          .addIntegerOption(
            option =>
              option
                .setName('caps_percent')
                .setDescription(
                  'Caps percentage.'
                )
                .setMinValue(50)
                .setMaxValue(100)
          )

          .addIntegerOption(
            option =>
              option
                .setName('timeout')
                .setDescription(
                  'Timeout seconds.'
                )
                .setMinValue(10)
                .setMaxValue(2419200)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('badword')
          .setDescription(
            'Add blocked word.'
          )
          .addStringOption(
            option =>
              option
                .setName('word')
                .setDescription('Word.')
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('removebadword')
          .setDescription(
            'Remove blocked word.'
          )
          .addStringOption(
            option =>
              option
                .setName('word')
                .setDescription('Word.')
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('invite')
          .setDescription(
            'Enable or disable invite filtering.'
          )
          .addBooleanOption(
            option =>
              option
                .setName('enabled')
                .setDescription(
                  'Enabled.'
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('mentions')
          .setDescription(
            'Set user mention limit.'
          )
          .addIntegerOption(
            option =>
              option
                .setName('limit')
                .setDescription('Limit.')
                .setMinValue(1)
                .setMaxValue(30)
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('log')
          .setDescription(
            'Set AutoMod log channel.'
          )
          .addChannelOption(
            option =>
              option
                .setName('channel')
                .setDescription(
                  'Channel.'
                )
                .addChannelTypes(
                  ChannelType.GuildText
                )
                .setRequired(true)
          )
    )
);

// SECURITY

addCommand(
  new SlashCommandBuilder()
    .setName('security')
    .setDescription(
      'Configure Anti-Nuke security.'
    )

    .addSubcommand(
      sub =>
        sub
          .setName('enable')
          .setDescription(
            'Enable security.'
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('disable')
          .setDescription(
            'Disable security.'
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('status')
          .setDescription(
            'View security status.'
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('action')
          .setDescription(
            'Set security punishment.'
          )
          .addStringOption(
            option =>
              option
                .setName('type')
                .setDescription(
                  'Action.'
                )
                .setRequired(true)
                .addChoices(
                  {
                    name: 'Alert',
                    value: 'alert'
                  },
                  {
                    name: 'Timeout',
                    value: 'timeout'
                  },
                  {
                    name: 'Kick',
                    value: 'kick'
                  },
                  {
                    name: 'Ban',
                    value: 'ban'
                  }
                )
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('trusteduser')
          .setDescription(
            'Add trusted user.'
          )
          .addUserOption(
            option =>
              option
                .setName('user')
                .setDescription('User.')
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('untrusteduser')
          .setDescription(
            'Remove trusted user.'
          )
          .addUserOption(
            option =>
              option
                .setName('user')
                .setDescription('User.')
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('trustedbot')
          .setDescription(
            'Add trusted bot.'
          )
          .addUserOption(
            option =>
              option
                .setName('user')
                .setDescription('Bot.')
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('untrustedbot')
          .setDescription(
            'Remove trusted bot.'
          )
          .addUserOption(
            option =>
              option
                .setName('user')
                .setDescription('Bot.')
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('trustedrole')
          .setDescription(
            'Set trusted role.'
          )
          .addRoleOption(
            option =>
              option
                .setName('role')
                .setDescription('Role.')
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('protectedrole')
          .setDescription(
            'Protect a role.'
          )
          .addRoleOption(
            option =>
              option
                .setName('role')
                .setDescription('Role.')
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('unprotectedrole')
          .setDescription(
            'Unprotect a role.'
          )
          .addRoleOption(
            option =>
              option
                .setName('role')
                .setDescription('Role.')
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('protectedchannel')
          .setDescription(
            'Protect a channel.'
          )
          .addChannelOption(
            option =>
              option
                .setName('channel')
                .setDescription(
                  'Channel.'
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('unprotectedchannel')
          .setDescription(
            'Unprotect a channel.'
          )
          .addChannelOption(
            option =>
              option
                .setName('channel')
                .setDescription(
                  'Channel.'
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('raid')
          .setDescription(
            'Set raid join limit.'
          )
          .addIntegerOption(
            option =>
              option
                .setName('limit')
                .setDescription(
                  'Joins in the time window.'
                )
                .setMinValue(2)
                .setMaxValue(100)
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('log')
          .setDescription(
            'Set security log channel.'
          )
          .addChannelOption(
            option =>
              option
                .setName('channel')
                .setDescription(
                  'Channel.'
                )
                .addChannelTypes(
                  ChannelType.GuildText
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('list')
          .setDescription(
            'List security settings.'
          )
    )
);

// CONFIG

addCommand(
  new SlashCommandBuilder()
    .setName('config')
    .setDescription(
      'Configure AkiyO for this server.'
    )

    .addSubcommand(
      sub =>
        sub
          .setName('view')
          .setDescription(
            'View configuration.'
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('log')
          .setDescription(
            'Set a log channel.'
          )

          .addStringOption(
            option =>
              option
                .setName('type')
                .setDescription(
                  'Log type.'
                )
                .setRequired(true)
                .addChoices(
                  ...LOG_TYPES.map(
                    x => ({
                      name: x,
                      value: x
                    })
                  )
                )
          )

          .addChannelOption(
            option =>
              option
                .setName('channel')
                .setDescription(
                  'Channel.'
                )
                .addChannelTypes(
                  ChannelType.GuildText
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('staffrole')
          .setDescription(
            'Set ticket staff role.'
          )
          .addRoleOption(
            option =>
              option
                .setName('role')
                .setDescription('Role.')
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('ticketcategory')
          .setDescription(
            'Set ticket category.'
          )
          .addChannelOption(
            option =>
              option
                .setName('channel')
                .setDescription(
                  'Category.'
                )
                .addChannelTypes(
                  ChannelType.GuildCategory
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('suggestions')
          .setDescription(
            'Set suggestion channel.'
          )
          .addChannelOption(
            option =>
              option
                .setName('channel')
                .setDescription(
                  'Channel.'
                )
                .addChannelTypes(
                  ChannelType.GuildText
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('timeout')
          .setDescription(
            'Set AutoMod timeout.'
          )

          .addStringOption(
            option =>
              option
                .setName('type')
                .setDescription(
                  'Rule type.'
                )
                .setRequired(true)
                .addChoices(
                  ...[
                    'spam',
                    'invite',
                    'badword',
                    'caps',
                    'repeat',
                    'massmention'
                  ].map(
                    x => ({
                      name: x,
                      value: x
                    })
                  )
                )
          )

          .addIntegerOption(
            option =>
              option
                .setName('seconds')
                .setDescription(
                  'Seconds.'
                )
                .setMinValue(10)
                .setMaxValue(2419200)
                .setRequired(true)
          )
    )
);

// MODERATION

for (
  const [name, description]
  of [
    ['warn', 'Warn a member.'],
    ['kick', 'Kick a member.'],
    ['ban', 'Ban a member.']
  ]
) {

  addCommand(
    new SlashCommandBuilder()
      .setName(name)
      .setDescription(description)

      .addUserOption(
        option =>
          option
            .setName('user')
            .setDescription(
              'Member.'
            )
            .setRequired(true)
      )

      .addStringOption(
        option =>
          option
            .setName('reason')
            .setDescription(
              'Reason.'
            )
            .setRequired(true)
      )
  );
}

addCommand(
  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription(
      'Timeout a member.'
    )

    .addUserOption(
      option =>
        option
          .setName('user')
          .setDescription(
            'Member.'
          )
          .setRequired(true)
    )

    .addStringOption(
      option =>
        option
          .setName('duration')
          .setDescription(
            'Examples: 30s, 10m, 2h, 1d.'
          )
          .setRequired(true)
    )

    .addStringOption(
      option =>
        option
          .setName('reason')
          .setDescription(
            'Reason.'
          )
          .setRequired(true)
    )
);

addCommand(
  new SlashCommandBuilder()
    .setName('unban')
    .setDescription(
      'Unban a user.'
    )

    .addStringOption(
      option =>
        option
          .setName('user_id')
          .setDescription(
            'User ID.'
          )
          .setRequired(true)
    )

    .addStringOption(
      option =>
        option
          .setName('reason')
          .setDescription(
            'Reason.'
          )
          .setRequired(true)
    )
);

for (
  const name
  of [
    'warnings',
    'punishments'
  ]
) {

  addCommand(
    new SlashCommandBuilder()
      .setName(name)
      .setDescription(
        `View ${name}.`
      )

      .addUserOption(
        option =>
          option
            .setName('user')
            .setDescription(
              'User.'
            )
            .setRequired(true)
      )
  );
}

// SUGGESTION

addCommand(
  new SlashCommandBuilder()
    .setName('suggest')
    .setDescription(
      'Create a suggestion.'
    )

    .addStringOption(
      option =>
        option
          .setName('text')
          .setDescription(
            'Suggestion.'
          )
          .setRequired(true)
    )
);

// ANNOUNCE

addCommand(
  new SlashCommandBuilder()
    .setName('announce')
    .setDescription(
      'Send an announcement.'
    )

    .addStringOption(
      option =>
        option
          .setName('message')
          .setDescription(
            'Message.'
          )
          .setRequired(true)
    )

    .addChannelOption(
      option =>
        option
          .setName('channel')
          .setDescription(
            'Channel.'
          )
          .addChannelTypes(
            ChannelType.GuildText
          )
          .setRequired(true)
    )

    .addStringOption(
      option =>
        option
          .setName('title')
          .setDescription(
            'Title.'
          )
    )

    .addStringOption(
      option =>
        option
          .setName('footer')
          .setDescription(
            'Footer.'
          )
    )

    .addBooleanOption(
      option =>
        option
          .setName('embed')
          .setDescription(
            'Use embed.'
          )
    )

    .addBooleanOption(
      option =>
        option
          .setName('everyone')
          .setDescription(
            'Mention everyone.'
          )
    )

    .addBooleanOption(
      option =>
        option
          .setName('here')
          .setDescription(
            'Mention here.'
          )
    )

    .addRoleOption(
      option =>
        option
          .setName('role')
          .setDescription(
            'Mention role.'
          )
    )

    .addUserOption(
      option =>
        option
          .setName('user')
          .setDescription(
            'Mention user.'
          )
    )
);

// AUTOROLE

addCommand(
  new SlashCommandBuilder()
    .setName('autorole')
    .setDescription(
      'Configure join autorole.'
    )

    .addSubcommand(
      sub =>
        sub
          .setName('set')
          .setDescription(
            'Set role.'
          )
          .addRoleOption(
            option =>
              option
                .setName('role')
                .setDescription(
                  'Role.'
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('disable')
          .setDescription(
            'Disable.'
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('status')
          .setDescription(
            'Status.'
          )
    )
);

// WELCOME

addCommand(
  new SlashCommandBuilder()
    .setName('welcome')
    .setDescription(
      'Configure welcome messages.'
    )

    .addSubcommand(
      sub =>
        sub
          .setName('set')
          .setDescription(
            'Set welcome.'
          )

          .addChannelOption(
            option =>
              option
                .setName('channel')
                .setDescription(
                  'Channel.'
                )
                .addChannelTypes(
                  ChannelType.GuildText
                )
                .setRequired(true)
          )

          .addStringOption(
            option =>
              option
                .setName('message')
                .setDescription(
                  'Welcome message.'
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('disable')
          .setDescription(
            'Disable.'
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('status')
          .setDescription(
            'Status.'
          )
    )
);

// VERIFICATION

addCommand(
  new SlashCommandBuilder()
    .setName('verification')
    .setDescription(
      'Configure verification.'
    )

    .addSubcommand(
      sub =>
        sub
          .setName('setup')
          .setDescription(
            'Setup verification.'
          )

          .addChannelOption(
            option =>
              option
                .setName('channel')
                .setDescription(
                  'Channel.'
                )
                .addChannelTypes(
                  ChannelType.GuildText
                )
                .setRequired(true)
          )

          .addRoleOption(
            option =>
              option
                .setName('role')
                .setDescription(
                  'Verified role.'
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('disable')
          .setDescription(
            'Disable.'
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('status')
          .setDescription(
            'Status.'
          )
    )
);

// REACTION ROLES

addCommand(
  new SlashCommandBuilder()
    .setName('autoreactionrole')
    .setDescription(
      'Configure reaction roles.'
    )

    .addSubcommand(
      sub =>
        sub
          .setName('add')
          .setDescription(
            'Add reaction role.'
          )

          .addStringOption(
            option =>
              option
                .setName('message_id')
                .setDescription(
                  'Message ID.'
                )
                .setRequired(true)
          )

          .addStringOption(
            option =>
              option
                .setName('emoji')
                .setDescription(
                  'Emoji.'
                )
                .setRequired(true)
          )

          .addRoleOption(
            option =>
              option
                .setName('role')
                .setDescription(
                  'Role.'
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('remove')
          .setDescription(
            'Remove reaction role.'
          )

          .addStringOption(
            option =>
              option
                .setName('message_id')
                .setDescription(
                  'Message ID.'
                )
                .setRequired(true)
          )

          .addStringOption(
            option =>
              option
                .setName('emoji')
                .setDescription(
                  'Emoji.'
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('list')
          .setDescription(
            'List reaction roles.'
          )
    )
);

// LEADERBOARD

addCommand(
  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription(
      'Message leaderboard.'
    )

    .addSubcommand(
      sub =>
        sub
          .setName('top')
          .setDescription(
            'Top users.'
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('reset')
          .setDescription(
            'Reset.'
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('enable')
          .setDescription(
            'Enable.'
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('disable')
          .setDescription(
            'Disable.'
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('status')
          .setDescription(
            'Status.'
          )
    )
);

// ADS

addCommand(
  new SlashCommandBuilder()
    .setName('ads')
    .setDescription(
      'Configure owner advertisements.'
    )

    .addSubcommand(
      sub =>
        sub
          .setName('set')
          .setDescription(
            'Set ad channel.'
          )
          .addChannelOption(
            option =>
              option
                .setName('channel')
                .setDescription(
                  'Channel.'
                )
                .addChannelTypes(
                  ChannelType.GuildText
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('message')
          .setDescription(
            'Set ad message.'
          )
          .addStringOption(
            option =>
              option
                .setName('text')
                .setDescription(
                  'Advertisement.'
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('interval')
          .setDescription(
            'Set interval.'
          )
          .addIntegerOption(
            option =>
              option
                .setName('minutes')
                .setDescription(
                  'Minutes.'
                )
                .setMinValue(10)
                .setMaxValue(10080)
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('enable')
          .setDescription(
            'Enable.'
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('disable')
          .setDescription(
            'Disable.'
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('status')
          .setDescription(
            'Status.'
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('broadcast')
          .setDescription(
            'Broadcast now.'
          )
    )
);

// BOT INFO

addCommand(
  new SlashCommandBuilder()
    .setName('botinfo')
    .setDescription(
      'Show AkiyO information.'
    )
);

// AI

addCommand(
  new SlashCommandBuilder()
    .setName('ai')
    .setDescription(
      'Chat with AkiyO AI.'
    )

    .addSubcommand(
      sub =>
        sub
          .setName('ask')
          .setDescription(
            'Ask AI.'
          )
          .addStringOption(
            option =>
              option
                .setName('prompt')
                .setDescription(
                  'Prompt.'
                )
                .setRequired(true)
          )
    )

    .addSubcommand(
      sub =>
        sub
          .setName('reset')
          .setDescription(
            'Reset your AI conversation.'
          )
    )
);

// ======================================================
// STAFF COMMANDS
// ======================================================

const STAFF_COMMANDS = new Set([

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

  'ticketstats',
  'ticketadd',
  'ticketremove',
  'ticketrename',
  'ticketinfo',

  'automod',
  'security',
  'config',

  'warn',
  'timeout',
  'kick',
  'ban',
  'unban',

  'warnings',
  'punishments',

  'suggest',
  'announce',

  'autorole',
  'welcome',
  'verification',
  'autoreactionrole',
  'leaderboard'
]);

// ======================================================
// GLOBAL COMMAND REGISTRATION
// ======================================================

async function registerCommands() {

  const rest =
    new REST({
      version: '10'
    })
      .setToken(TOKEN);

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

// ======================================================
// READY
// ======================================================

client.once(
  'clientReady',
  async () => {

    console.log(
      `✅ Logged in as ${client.user.tag}`
    );

    console.log(
      `🌐 Servers: ${client.guilds.cache.size}`
    );

    try {

      await registerCommands();

    } catch (error) {

      console.error(
        '❌ Command registration:',
        error
      );
    }

    // Remove dead ticket records
    for (
      const [channelId, ticket]
      of Object.entries(db.tickets)
    ) {

      if (
        !client.guilds.cache.has(
          ticket.guildId
        )
      ) {

        delete db.tickets[channelId];

        continue;
      }

      const guild =
        client.guilds.cache.get(
          ticket.guildId
        );

      const channel =
        await guild.channels
          .fetch(channelId)
          .catch(() => null);

      if (!channel) {

        delete db.tickets[channelId];

      }
    }

    save();

    console.log(
      `🤖 AkiyO online — ${commands.length} commands.`
    );
  }
);

// ======================================================
// GUILD CREATE
// ======================================================

client.on(
  'guildCreate',
  guild => {

    gc(guild);

    save();

    console.log(
      `➕ Joined server: ${guild.name} (${guild.id})`
    );
  }
);

// ======================================================
// GUILD DELETE
// ======================================================

client.on(
  'guildDelete',
  guild => {

    delete db.guilds[
      guild.id
    ];

    save();

  }
);

// ======================================================
// MESSAGE SYSTEM
// ======================================================

client.on(
  'messageCreate',
  async message => {

    if (message.author.bot) {
      return;
    }

    try {

      // ------------------------------
      // DM
      // ------------------------------

      if (!message.guild) {

        const ticket =
          activeDmTicket(
            message.author.id
          );

        if (!ticket) {

          await message.author
            .send(
              '❌ You do not have an active AkiyO ticket.\n' +
              'Open `/ticket` in the server where you need support.'
            )
            .catch(() => {});

          return;
        }

        const guild =
          client.guilds.cache.get(
            ticket.guildId
          );

        const channel =
          guild
            ? await guild.channels
                .fetch(
                  ticket.channelId
                )
                .catch(() => null)
            : null;

        if (!channel?.isTextBased()) {
          return;
        }

        const content =
          message.content ||
          '[Attachment]';

        const files =
          [
            ...message.attachments.values()
          ].map(
            attachment => ({
              attachment:
                attachment.url,

              name:
                attachment.name ||
                'attachment'
            })
          );

        await channel.send({

          embeds: [

            new EmbedBuilder()

              .setTitle(
                '📩 User Message'
              )

              .setDescription(
                content.slice(0, 4000)
              )

              .setFooter({
                text:
                  message.author.tag
              })

              .setTimestamp()
          ],

          files

        }).catch(() => {});

        return;
      }

      // ------------------------------
      // SERVER
      // ------------------------------

      const c =
        gc(message.guild);

      const ticket =
        ticketRecord(
          message.channel.id
        );

      // Staff message inside ticket
      if (
        ticket &&
        ticket.status !== 'closed' &&
        isStaff(message.member)
      ) {

        const user =
          await client.users
            .fetch(ticket.userId)
            .catch(() => null);

        if (user) {

          await user
            .send({

              embeds: [

                new EmbedBuilder()

                  .setTitle(
                    '💬 AkiyO Support Team'
                  )

                  .setDescription(
                    (
                      message.content ||
                      '[Attachment]'
                    ).slice(0, 4000)
                  )

                  .setFooter({
                    text:
                      message.guild.name
                  })

                  .setTimestamp()

              ],

              files:
                [
                  ...message.attachments.values()
                ].map(
                  attachment => ({
                    attachment:
                      attachment.url,

                    name:
                      attachment.name ||
                      'attachment'
                  })
                )

            })
            .catch(() => {});
        }

        return;
      }

      // Leaderboard
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

      await runAutomod(
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

// ======================================================
// MEMBER JOIN
// ======================================================

client.on(
  'guildMemberAdd',
  async member => {

    try {

      const c =
        gc(member.guild);

      // AUTOROLE
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
          botCanManageRole(
            member.guild,
            role
          )
        ) {

          await member.roles
            .add(
              role,
              'AkiyO autorole'
            )
            .catch(() => {});
        }

        await sendLog(
          member.guild,
          'members',
          '👤 Member Joined',
          [
            field(
              'User',
              `${member.user.tag} (${member.id})`
            ),

            field(
              'Autorole',
              role
                ? role.toString()
                : 'Not configured'
            )
          ]
        );
      }

      // WELCOME
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
              fmtWelcome(
                c.welcome.message,
                member
              )
            )
            .catch(() => {});
        }

        await sendLog(
          member.guild,
          'welcome',
          '👋 Welcome',
          [
            field(
              'User',
              member.toString()
            )
          ]
        );
      }

      // ANTI RAID
      if (
        c.security.enabled
      ) {

        const now =
          Date.now();

        const joins =
          (
            raidTracker.get(
              member.guild.id
            ) || []
          )
            .filter(
              time =>
                now - time <
                c.security.raidWindow
            );

        joins.push(now);

        raidTracker.set(
          member.guild.id,
          joins
        );

        if (
          joins.length >=
          c.security.raidJoinCount
        ) {

          await sendLog(
            member.guild,
            'security',
            '🚨 Possible Raid',
            [
              field(
                'Joins',
                joins.length
              ),

              field(
                'Window',
                `${c.security.raidWindow / 1000}s`
              )
            ],
            0xed4245
          );

          raidTracker.set(
            member.guild.id,
            []
          );

          if (
            c.security.action ===
            'timeout'
          ) {

            const members =
              await member.guild.members
                .fetch({
                  limit: 25
                })
                .catch(() => null);

            if (members) {

              for (
                const [, m]
                of members
              ) {

                if (
                  m.joinedTimestamp &&
                  Date.now() -
                    m.joinedTimestamp <
                    c.security.raidWindow &&
                  m.moderatable
                ) {

                  await m
                    .timeout(
                      10 * 60 * 1000,
                      'AkiyO Anti-Raid'
                    )
                    .catch(() => {});
                }
              }
            }
          }
        }
      }

    } catch (error) {

      console.error(
        'guildMemberAdd:',
        error
      );
    }
  }
);

// ======================================================
// AUDIT LOG ANTI-NUKE
// ======================================================

const AUDIT_EVENTS = [

  [
    'guildBanAdd',
    AuditLogEvent.MemberBanAdd,
    'ban',
    x =>
      `Banned ${x.user.tag}`
  ],

  [
    'channelDelete',
    AuditLogEvent.ChannelDelete,
    'channelDelete',
    x =>
      `Deleted #${x.name}`
  ],

  [
    'channelCreate',
    AuditLogEvent.ChannelCreate,
    'channelCreate',
    x =>
      `Created #${x.name}`
  ],

  [
    'roleDelete',
    AuditLogEvent.RoleDelete,
    'roleDelete',
    x =>
      `Deleted @${x.name}`
  ],

  [
    'roleCreate',
    AuditLogEvent.RoleCreate,
    'roleCreate',
    x =>
      `Created @${x.name}`
  ]
];

for (
  const [
    eventName,
    auditType,
    securityType,
    detail
  ]
  of AUDIT_EVENTS
) {

  client.on(
    eventName,
    async item => {

      try {

        const guild =
          item.guild;

        if (!guild) {
          return;
        }

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
          entry &&
          Date.now() -
            entry.createdTimestamp <
            5000
        ) {

          await securityAction(
            guild,
            entry.executor?.id,
            securityType,
            detail(item)
          );
        }

      } catch (error) {

        console.error(
          eventName,
          error
        );
      }
    }
  );
}

// ======================================================
// KICK DETECTION
// ======================================================

client.on(
  'guildMemberRemove',
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
        entry.targetId === member.id &&
        Date.now() -
          entry.createdTimestamp <
          5000
      ) {

        await securityAction(
          member.guild,
          entry.executor?.id,
          'kick',
          `Kicked ${member.user.tag}`
        );
      }

    } catch (error) {

      console.error(
        'memberRemove:',
        error
      );
    }
  }
);

// ======================================================
// WEBHOOK PROTECTION
// ======================================================

client.on(
  'webhookUpdate',
  async channel => {

    try {

      const guild =
        channel.guild;

      const c =
        gc(guild);

      if (
        !c.security.enabled
      ) {
        return;
      }

      const logs =
        await guild
          .fetchAuditLogs({
            type:
              AuditLogEvent.WebhookCreate,
            limit: 1
          })
          .catch(() => null);

      const entry =
        logs?.entries.first();

      if (
        !entry ||
        Date.now() -
          entry.createdTimestamp >=
          5000
      ) {
        return;
      }

      if (
        !isTrusted(
          guild,
          entry.executor?.id
        )
      ) {

        const hooks =
          await channel
            .fetchWebhooks()
            .catch(() => null);

        const created =
          hooks?.get(
            entry.targetId
          );

        if (created) {

          await created
            .delete(
              'AkiyO Anti-Webhook'
            )
            .catch(() => {});
        }
      }

      await securityAction(
        guild,
        entry.executor?.id,
        'webhookCreate',
        `Webhook created in #${channel.name}`
      );

    } catch (error) {

      console.error(
        'webhookUpdate:',
        error
      );
    }
  }
);

// ======================================================
// GLOBAL AUDIT LOGGER
// ======================================================

client.on(
  'guildAuditLogEntryCreate',
  async (
    entry,
    guild
  ) => {

    try {

      await sendLog(
        guild,
        'audit',
        '📜 Audit Log',
        [
          field(
            'Action',
            entry.action
          ),

          field(
            'Executor',
            entry.executor
              ? `${entry.executor.tag || entry.executor.username} (${entry.executor.id})`
              : 'Unknown'
          ),

          field(
            'Target',
            entry.targetId ||
              'Unknown'
          ),

          field(
            'Reason',
            entry.reason ||
              'None'
          )
        ]
      );

    } catch (error) {

      console.error(
        'audit:',
        error
      );
    }
  }
);

// ======================================================
// REACTION ROLES
// ======================================================

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

      const c =
        gc(guild);

      const emojiKey =
        reaction.emoji.id ||
        reaction.emoji.name;

      const rr =
        c.reactionRoles
          ?.[reaction.message.id]
          ?.[emojiKey];

      if (!rr) {
        return;
      }

      const member =
        await guild.members
          .fetch(user.id)
          .catch(() => null);

      const role =
        await guild.roles
          .fetch(rr.roleId)
          .catch(() => null);

      if (
        member &&
        role &&
        botCanManageRole(
          guild,
          role
        )
      ) {

        await member.roles
          .add(
            role,
            'AkiyO reaction role'
          )
          .catch(() => {});
      }

    } catch (error) {

      console.error(
        'reactionAdd:',
        error
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

      const c =
        gc(guild);

      const emojiKey =
        reaction.emoji.id ||
        reaction.emoji.name;

      const rr =
        c.reactionRoles
          ?.[reaction.message.id]
          ?.[emojiKey];

      if (!rr) {
        return;
      }

      const member =
        await guild.members
          .fetch(user.id)
          .catch(() => null);

      const role =
        await guild.roles
          .fetch(rr.roleId)
          .catch(() => null);

      if (
        member &&
        role
      ) {

        await member.roles
          .remove(
            role,
            'AkiyO reaction role removed'
          )
          .catch(() => {});
      }

    } catch (error) {

      console.error(
        'reactionRemove:',
        error
      );
    }
  }
);

// ======================================================
// MAIN INTERACTION HANDLER
// ======================================================

client.on(
  'interactionCreate',
  async interaction => {

    try {

      // ==================================================
      // BUTTONS
      // ==================================================

      if (
        interaction.isButton()
      ) {

        // CREATE TICKET
        if (
          interaction.customId ===
          'create_ticket'
        ) {

          if (!interaction.guild) {

            return interaction.reply({
              content:
                '❌ Use this button inside a server.',
              ephemeral: true
            });
          }

          try {

            await createTicket(
              interaction.guild,
              interaction.user,
              'Opened from ticket panel'
            );

            return interaction.reply({
              content:
                '🎫 Ticket created. Check your DMs.',
              ephemeral: true
            });

          } catch (error) {

            return interaction.reply({
              content:
                `❌ ${error.message}`,
              ephemeral: true
            });
          }
        }

        // VERIFY
        if (
          interaction.customId ===
          'verify_user'
        ) {

          const c =
            gc(interaction.guild);

          const role =
            await interaction.guild.roles
              .fetch(
                c.verification.roleId
              )
              .catch(() => null);

          if (!role) {

            return interaction.reply({
              content:
                '❌ Verification role is missing.',
              ephemeral: true
            });
          }

          if (
            !botCanManageRole(
              interaction.guild,
              role
            )
          ) {

            return interaction.reply({
              content:
                '❌ My highest role must be above the verified role.',
              ephemeral: true
            });
          }

          await interaction.member.roles
            .add(
              role,
              'AkiyO verification'
            )
            .catch(() => {});

          await sendLog(
            interaction.guild,
            'verification',
            '✅ User Verified',
            [
              field(
                'User',
                interaction.user.toString()
              ),

              field(
                'Role',
                role.toString()
              )
            ],
            0x57f287
          );

          return interaction.reply({
            content:
              '✅ You are verified!',
            ephemeral: true
          });
        }

        // SUGGESTION
        if (
          interaction.customId ===
            'suggest_approve' ||
          interaction.customId ===
            'suggest_decline'
        ) {

          if (
            !interaction.guild ||
            !isStaff(
              interaction.member
            )
          ) {

            return interaction.reply({
              content:
                '❌ Staff only.',
              ephemeral: true
            });
          }

          const c =
            gc(interaction.guild);

          const suggestion =
            c.suggestions[
              interaction.message.id
            ];

          if (!suggestion) {

            return interaction.reply({
              content:
                '❌ Suggestion record not found.',
              ephemeral: true
            });
          }

          if (
            suggestion.status !==
            'pending'
          ) {

            return interaction.reply({
              content:
                `❌ Already ${suggestion.status}.`,
              ephemeral: true
            });
          }

          suggestion.status =
            interaction.customId ===
            'suggest_approve'
              ? 'approved'
              : 'declined';

          const oldEmbed =
            interaction.message
              .embeds[0];

          const embed =
            oldEmbed
              ? EmbedBuilder.from(
                  oldEmbed
                )
              : new EmbedBuilder()
                  .setDescription(
                    suggestion.text
                  );

          embed
            .setTitle(
              suggestion.status ===
              'approved'
                ? '✅ Suggestion Approved'
                : '❌ Suggestion Declined'
            )
            .addFields(
              field(
                'Decision by',
                interaction.user.toString()
              )
            );

          await interaction.message
            .edit({
              embeds: [embed],
              components: []
            });

          save();

          await interaction.reply({
            content:
              `✅ Suggestion ${suggestion.status}.`,
            ephemeral: true
          });

          await sendLog(
            interaction.guild,
            'suggestion',
            '💡 Suggestion Decision',
            [
              field(
                'Status',
                suggestion.status
              ),

              field(
                'By',
                interaction.user.toString()
              )
            ]
          );

          return;
        }

        // TICKET BUTTONS

        if (
          !interaction.guild ||
          !isStaff(
            interaction.member
          )
        ) {

          return interaction.reply({
            content:
              '❌ Staff only.',
            ephemeral: true
          });
        }

        const ticket =
          ticketRecord(
            interaction.channel?.id
          );

        if (!ticket) {

          return interaction.reply({
            content:
              '❌ This is not an AkiyO ticket.',
            ephemeral: true
          });
        }

        if (
          interaction.customId ===
          'ticket_claim'
        ) {

          ticket.claimedBy =
            interaction.user.id;

          claims.set(
            ticket.channelId,
            interaction.user.id
          );

          save();

          return interaction.reply(
            `✅ Ticket claimed by ${interaction.user}.`
          );
        }

        if (
          interaction.customId ===
          'ticket_close'
        ) {

          await interaction.reply(
            '🔒 Closing ticket...'
          );

          return closeTicket(
            ticket,
            interaction.channel,
            interaction.user
          );
        }

        if (
          interaction.customId ===
          'ticket_reopen'
        ) {

          ticket.status =
            'open';

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

          addDmMapping(
            ticket.userId,
            ticket.guildId,
            ticket.channelId
          );

          save();

          return interaction.reply(
            '🔓 Ticket reopened.'
          );
        }

        if (
          interaction.customId ===
          'ticket_delete'
        ) {

          await interaction.reply(
            '🗑️ Deleting ticket...'
          );

          return deleteTicket(
            ticket,
            interaction.channel
          );
        }

        if (
          interaction.customId ===
          'ticket_lock'
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
            );

          return interaction.reply(
            '🔐 Ticket locked.'
          );
        }

        if (
          interaction.customId ===
          'ticket_transcript'
        ) {

          const transcript =
            await ticketTranscript(
              interaction.channel
            );

          const c =
            gc(interaction.guild);

          const logChannel =
            await interaction.guild.channels
              .fetch(
                c.ticket.logChannelId ||
                c.logs.tickets ||
                c.logs.audit
              )
              .catch(() => null);

          if (
            logChannel?.isTextBased()
          ) {

            await logChannel.send({
              content:
                `📄 Ticket transcript — <@${ticket.userId}>`,

              files: [
                {
                  attachment:
                    transcript,

                  name:
                    `ticket-${ticket.channelId}.txt`
                }
              ]
            });
          }

          return interaction.reply({
            content:
              '✅ Transcript sent to ticket logs.',
            ephemeral: true
          });
        }

        return;
      }

      // ==================================================
      // SLASH COMMANDS
      // ==================================================

      if (
        !interaction.isChatInputCommand()
      ) {
        return;
      }

      if (!interaction.guild) {

        return interaction.reply({
          content:
            '❌ This command is available in servers only.',
          ephemeral: true
        });
      }

      const guild =
        interaction.guild;

      const c =
        gc(guild);

      const cmd =
        interaction.commandName;

      if (
        STAFF_COMMANDS.has(cmd) &&
        !isStaff(
          interaction.member
        )
      ) {

        return interaction.reply({
          content:
            '❌ You do not have permission to use this command.',
          ephemeral: true
        });
      }

      // ==================================================
      // HELP
      // ==================================================

      if (cmd === 'help') {

        return interaction.reply({

          embeds: [

            new EmbedBuilder()

              .setTitle(
                '🤖 AkiyO Commands'
              )

              .setDescription(
                commands
                  .map(
                    command =>
                      `**/${command.name}** — ${command.description}`
                  )
                  .join('\n')
                  .slice(0, 4096)
              )

              .setFooter({
                text:
                  'Every configuration is independent per server.'
              })

          ]

        });
      }

      // ==================================================
      // TICKET
      // ==================================================

      if (cmd === 'ticket') {

        try {

          await createTicket(
            guild,
            interaction.user,
            interaction.options
              .getString('reason') ||
            'No reason provided'
          );

          return interaction.reply({
            content:
              '🎫 Check your DMs.',
            ephemeral: true
          });

        } catch (error) {

          return interaction.reply({
            content:
              `❌ ${error.message}`,
            ephemeral: true
          });
        }
      }

      // ==================================================
      // TICKET PANEL
      // ==================================================

      if (
        cmd ===
        'ticketpanel'
      ) {

        await interaction.channel
          .send({

            embeds: [

              new EmbedBuilder()

                .setTitle(
                  '🎫 AkiyO Support Center'
                )

                .setDescription(
                  'Click the button below to open a private support ticket.'
                )

            ],

            components: [

              new ActionRowBuilder()
                .addComponents(

                  new ButtonBuilder()
                    .setCustomId(
                      'create_ticket'
                    )
                    .setLabel(
                      'Open Support Ticket'
                    )
                    .setEmoji('🎫')
                    .setStyle(
                      ButtonStyle.Primary
                    )

                )
            ]
          });

        return interaction.reply({
          content:
            '✅ Ticket panel sent.',
          ephemeral: true
        });
      }

      // ==================================================
      // TICKET SETUP
      // ==================================================

      if (
        cmd ===
        'ticketsetup'
      ) {

        c.ticket.categoryId =
          interaction.options
            .getChannel(
              'category'
            ).id;

        c.ticket.staffRoleId =
          interaction.options
            .getRole(
              'staffrole'
            ).id;

        const logChannel =
          interaction.options
            .getChannel(
              'logchannel'
            );

        if (logChannel) {

          c.ticket.logChannelId =
            logChannel.id;

          c.logs.tickets =
            logChannel.id;
        }

        save();

        return interaction.reply(
          '✅ Ticket system configured for this server.'
        );
      }

      // ==================================================
      // BASIC TICKET COMMANDS
      // ==================================================

      if (
        [
          'close',
          'reopen',
          'delete',
          'claim',
          'unclaim',
          'lock',
          'unlock',
          'transcript'
        ].includes(cmd)
      ) {

        const ticket =
          ticketRecord(
            interaction.channel.id
          );

        if (!ticket) {

          return interaction.reply({
            content:
              '❌ This channel is not a ticket.',
            ephemeral: true
          });
        }

        if (cmd === 'close') {

          await interaction.reply(
            '🔒 Closing ticket...'
          );

          return closeTicket(
            ticket,
            interaction.channel,
            interaction.user
          );
        }

        if (cmd === 'reopen') {

          ticket.status =
            'open';

          await interaction.channel
            .permissionOverwrites
            .edit(
              ticket.userId,
              {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
              }
            );

          addDmMapping(
            ticket.userId,
            ticket.guildId,
            ticket.channelId
          );

          save();

          return interaction.reply(
            '🔓 Ticket reopened.'
          );
        }

        if (cmd === 'delete') {

          await interaction.reply(
            '🗑️ Deleting ticket...'
          );

          return deleteTicket(
            ticket,
            interaction.channel
          );
        }

        if (cmd === 'claim') {

          ticket.claimedBy =
            interaction.user.id;

          claims.set(
            ticket.channelId,
            interaction.user.id
          );

          save();

          return interaction.reply(
            `✅ Ticket claimed by ${interaction.user}.`
          );
        }

        if (cmd === 'unclaim') {

          ticket.claimedBy =
            null;

          claims.delete(
            ticket.channelId
          );

          save();

          return interaction.reply(
            '✅ Ticket unclaimed.'
          );
        }

        if (cmd === 'lock') {

          await interaction.channel
            .permissionOverwrites
            .edit(
              ticket.userId,
              {
                ViewChannel: true,
                SendMessages: false,
                ReadMessageHistory: true
              }
            );

          return interaction.reply(
            '🔐 Ticket locked.'
          );
        }

        if (cmd === 'unlock') {

          await interaction.channel
            .permissionOverwrites
            .edit(
              ticket.userId,
              {
                ViewChannel: true,
                SendMessages: true,
                ReadMessageHistory: true
              }
            );

          if (
            ticket.status ===
            'closed'
          ) {

            ticket.status =
              'open';

            addDmMapping(
              ticket.userId,
              ticket.guildId,
              ticket.channelId
            );

            save();
          }

          return interaction.reply(
            '🔓 Ticket unlocked.'
          );
        }

        if (cmd === 'transcript') {

          const transcript =
            await ticketTranscript(
              interaction.channel
            );

          const logChannel =
            await guild.channels
              .fetch(
                c.ticket.logChannelId ||
                c.logs.tickets ||
                c.logs.audit
              )
              .catch(() => null);

          if (
            logChannel?.isTextBased()
          ) {

            await logChannel.send({

              content:
                `📄 Transcript — <@${ticket.userId}>`,

              files: [

                {
                  attachment:
                    transcript,

                  name:
                    `ticket-${ticket.channelId}.txt`
                }

              ]
            });
          }

          return interaction.reply({
            content:
              '✅ Transcript generated.',
            ephemeral: true
          });
        }
      }

      // ==================================================
      // TICKET STATS
      // ==================================================

      if (
        cmd ===
        'ticketstats'
      ) {

        const tickets =
          Object.values(
            db.tickets
          )
            .filter(
              ticket =>
                ticket.guildId ===
                guild.id &&
                ticket.status !==
                'deleted'
            );

        return interaction.reply(
          `🎫 **Ticket Statistics**\n\n` +

          `Open: **${
            tickets.filter(
              x =>
                x.status ===
                'open'
            ).length
          }**\n` +

          `Closed: **${
            tickets.filter(
              x =>
                x.status ===
                'closed'
            ).length
          }**\n` +

          `Total: **${tickets.length}**`
        );
      }

      // ==================================================
      // TICKET MANAGEMENT
      // ==================================================

      if (
        [
          'ticketadd',
          'ticketremove',
          'ticketrename',
          'ticketinfo'
        ].includes(cmd)
      ) {

        const ticket =
          ticketRecord(
            interaction.channel.id
          );

        if (!ticket) {

          return interaction.reply({
            content:
              '❌ This is not a ticket.',
            ephemeral: true
          });
        }

        if (
          cmd ===
          'ticketadd'
        ) {

          const user =
            interaction.options
              .getUser('user');

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
          cmd ===
          'ticketremove'
        ) {

          const user =
            interaction.options
              .getUser('user');

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
          cmd ===
          'ticketrename'
        ) {

          const name =
            interaction.options
              .getString(
                'name'
              )
              .replace(
                /[^a-zA-Z0-9-_]/g,
                '-'
              )
              .slice(
                0,
                90
              ) ||
              `ticket-${ticket.userId}`;

          await interaction.channel
            .setName(name);

          return interaction.reply(
            `✅ Ticket renamed to **${name}**.`
          );
        }

        return interaction.reply({

          embeds: [

            new EmbedBuilder()

              .setTitle(
                '🎫 Ticket Information'
              )

              .addFields(

                field(
                  'User',
                  `<@${ticket.userId}>`
                ),

                field(
                  'Status',
                  ticket.status
                ),

                field(
                  'Reason',
                  ticket.reason
                ),

                field(
                  'Created',
                  `<t:${Math.floor(ticket.createdAt / 1000)}:R>`
                ),

                field(
                  'Claimed by',
                  ticket.claimedBy
                    ? `<@${ticket.claimedBy}>`
                    : 'Nobody'
                )
              )

          ],

          ephemeral: true

        });
      }

      // ==================================================
      // AUTOMOD
      // ==================================================

      if (
        cmd ===
        'automod'
      ) {

        const sub =
          interaction.options
            .getSubcommand();

        if (
          sub ===
          'enable'
        ) {

          c.automod.enabled =
            true;
        }

        if (
          sub ===
          'disable'
        ) {

          c.automod.enabled =
            false;
        }

        if (
          sub ===
          'config'
        ) {

          const spam =
            interaction.options
              .getInteger(
                'spam_limit'
              );

          const window =
            interaction.options
              .getInteger(
                'spam_window'
              );

          const caps =
            interaction.options
              .getInteger(
                'caps_percent'
              );

          const timeout =
            interaction.options
              .getInteger(
                'timeout'
              );

          if (
            spam !== null
          ) {

            c.automod.spamLimit =
              spam;
          }

          if (
            window !== null
          ) {

            c.automod.spamWindow =
              window * 1000;
          }

          if (
            caps !== null
          ) {

            c.automod.capsPercent =
              caps;
          }

          if (
            timeout !== null
          ) {

            for (
              const key
              of Object.keys(
                c.automod.timeoutSeconds
              )
            ) {

              c.automod.timeoutSeconds[
                key
              ] =
                timeout;
            }
          }
        }

        if (
          sub ===
          'badword'
        ) {

          const word =
            interaction.options
              .getString(
                'word'
              )
              .trim()
              .toLowerCase();

          if (
            word &&
            !c.automod.badWords
              .includes(word)
          ) {

            c.automod.badWords
              .push(word);
          }
        }

        if (
          sub ===
          'removebadword'
        ) {

          const word =
            interaction.options
              .getString(
                'word'
              )
              .trim()
              .toLowerCase();

          c.automod.badWords =
            c.automod.badWords
              .filter(
                x => x !== word
              );
        }

        if (
          sub ===
          'invite'
        ) {

          c.automod.invite =
            interaction.options
              .getBoolean(
                'enabled'
              );
        }

        if (
          sub ===
          'mentions'
        ) {

          c.automod.userMentionsLimit =
            interaction.options
              .getInteger(
                'limit'
              );
        }

        if (
          sub ===
          'log'
        ) {

          c.automod.logChannelId =
            interaction.options
              .getChannel(
                'channel'
              ).id;

          c.logs.automod =
            c.automod.logChannelId;
        }

        save();

        if (
          sub ===
          'status'
        ) {

          return interaction.reply(

            `🛡️ **AutoMod ${c.automod.enabled ? 'ON' : 'OFF'}**\n\n` +

            `Spam: **${c.automod.spamLimit}/${c.automod.spamWindow / 1000}s**\n` +

            `Caps: **${c.automod.capsPercent}%**\n` +

            `Bad words: **${c.automod.badWords.length}**\n` +

            `Invites: **${c.automod.invite ? 'ON' : 'OFF'}**\n` +

            `Mention limit: **${c.automod.userMentionsLimit}**`
          );
        }

        return interaction.reply(
          '🛡️ AutoMod updated for this server.'
        );
      }

      // ==================================================
      // SECURITY
      // ==================================================

      if (
        cmd ===
        'security'
      ) {

        const sub =
          interaction.options
            .getSubcommand();

        if (
          sub ===
          'enable'
        ) {

          c.security.enabled =
            true;
        }

        if (
          sub ===
          'disable'
        ) {

          c.security.enabled =
            false;
        }

        if (
          sub ===
          'action'
        ) {

          c.security.action =
            interaction.options
              .getString(
                'type'
              );
        }

        if (
          sub ===
          'trusteduser'
        ) {

          const id =
            interaction.options
              .getUser(
                'user'
              ).id;

          if (
            !c.security.trustedUsers
              .includes(id)
          ) {

            c.security.trustedUsers
              .push(id);
          }
        }

        if (
          sub ===
          'untrusteduser'
        ) {

          const id =
            interaction.options
              .getUser(
                'user'
              ).id;

          c.security.trustedUsers =
            c.security.trustedUsers
              .filter(
                x => x !== id
              );
        }

        if (
          sub ===
          'trustedbot'
        ) {

          const id =
            interaction.options
              .getUser(
                'user'
              ).id;

          if (
            !c.security.trustedBots
              .includes(id)
          ) {

            c.security.trustedBots
              .push(id);
          }
        }

        if (
          sub ===
          'untrustedbot'
        ) {

          const id =
            interaction.options
              .getUser(
                'user'
              ).id;

          c.security.trustedBots =
            c.security.trustedBots
              .filter(
                x => x !== id
              );
        }

        if (
          sub ===
          'trustedrole'
        ) {

          c.security.trustedRoleId =
            interaction.options
              .getRole(
                'role'
              ).id;
        }

        if (
          sub ===
          'protectedrole'
        ) {

          const role =
            interaction.options
              .getRole(
                'role'
              );

          if (
            !c.security.protectedRoles
              .includes(role.id)
          ) {

            c.security.protectedRoles
              .push(role.id);
          }

          c.security.roleSnapshots[
            role.id
          ] = {

            name:
              role.name,

            color:
              role.hexColor,

            hoist:
              role.hoist,

            mentionable:
              role.mentionable,

            permissions:
              role.permissions
                .bitfield
                .toString(),

            position:
              role.position
          };
        }

        if (
          sub ===
          'unprotectedrole'
        ) {

          const id =
            interaction.options
              .getRole(
                'role'
              ).id;

          c.security.protectedRoles =
            c.security.protectedRoles
              .filter(
                x => x !== id
              );

          delete c.security
            .roleSnapshots[id];
        }

        if (
          sub ===
          'protectedchannel'
        ) {

          const channel =
            interaction.options
              .getChannel(
                'channel'
              );

          if (
            !c.security.protectedChannels
              .includes(channel.id)
          ) {

            c.security.protectedChannels
              .push(channel.id);
          }

          c.security.channelSnapshots[
            channel.id
          ] = {

            name:
              channel.name,

            type:
              channel.type,

            parentId:
              channel.parentId,

            topic:
              channel.topic || null
          };
        }

        if (
          sub ===
          'unprotectedchannel'
        ) {

          const id =
            interaction.options
              .getChannel(
                'channel'
              ).id;

          c.security.protectedChannels =
            c.security.protectedChannels
              .filter(
                x => x !== id
              );

          delete c.security
            .channelSnapshots[id];
        }

        if (
          sub ===
          'raid'
        ) {

          c.security.raidJoinCount =
            interaction.options
              .getInteger(
                'limit'
              );
        }

        if (
          sub ===
          'log'
        ) {

          c.security.logChannelId =
            interaction.options
              .getChannel(
                'channel'
              ).id;

          c.logs.security =
            c.security.logChannelId;
        }

        save();

        if (
          sub ===
          'status'
        ) {

          return interaction.reply(

            `🔐 **Security ${c.security.enabled ? 'ON' : 'OFF'}**\n\n` +

            `Action: **${c.security.action}**\n` +

            `Trusted users: **${c.security.trustedUsers.length}**\n` +

            `Trusted bots: **${c.security.trustedBots.length}**\n` +

            `Protected roles: **${c.security.protectedRoles.length}**\n` +

            `Protected channels: **${c.security.protectedChannels.length}**\n` +

            `Raid limit: **${c.security.raidJoinCount}**`
          );
        }

        if (
          sub ===
          'list'
        ) {

          return interaction.reply(

            `👤 Trusted users:\n${
              c.security.trustedUsers
                .map(
                  id =>
                    `<@${id}>`
                )
                .join(', ') ||
              'None'
            }\n\n` +

            `🤖 Trusted bots:\n${
              c.security.trustedBots
                .map(
                  id =>
                    `<@${id}>`
                )
                .join(', ') ||
              'None'
            }\n\n` +

            `🛡️ Protected roles:\n${
              c.security.protectedRoles
                .map(
                  id =>
                    `<@&${id}>`
                )
                .join(', ') ||
              'None'
            }\n\n` +

            `🔐 Protected channels:\n${
              c.security.protectedChannels
                .map(
                  id =>
                    `<#${id}>`
                )
                .join(', ') ||
              'None'
            }`
          );
        }

        return interaction.reply(
          '🔐 Security updated for this server.'
        );
      }

      // ==================================================
      // CONFIG
      // ==================================================

      if (
        cmd ===
        'config'
      ) {

        const sub =
          interaction.options
            .getSubcommand();

        if (
          sub ===
          'view'
        ) {

          return interaction.reply({

            embeds: [

              new EmbedBuilder()

                .setTitle(
                  `⚙️ AkiyO Configuration — ${guild.name}`
                )

                .addFields(

                  field(
                    'Ticket category',
                    c.ticket.categoryId
                      ? `<#${c.ticket.categoryId}>`
                      : 'Not set'
                  ),

                  field(
                    'Ticket staff role',
                    c.ticket.staffRoleId
                      ? `<@&${c.ticket.staffRoleId}>`
                      : 'Not set'
                  ),

                  field(
                    'Ticket logs',
                    c.ticket.logChannelId
                      ? `<#${c.ticket.logChannelId}>`
                      : 'Not set'
                  ),

                  field(
                    'Suggestions',
                    c.suggestionsChannelId
                      ? `<#${c.suggestionsChannelId}>`
                      : 'Not set'
                  ),

                  field(
                    'AutoMod',
                    c.automod.enabled
                      ? 'ON'
                      : 'OFF'
                  ),

                  field(
                    'Security',
                    c.security.enabled
                      ? 'ON'
                      : 'OFF'
                  )
                )
            ]

          });
        }

        if (
          sub ===
          'log'
        ) {

          c.logs[
            interaction.options
              .getString(
                'type'
              )
          ] =
            interaction.options
              .getChannel(
                'channel'
              ).id;
        }

        if (
          sub ===
          'staffrole'
        ) {

          c.ticket.staffRoleId =
            interaction.options
              .getRole(
                'role'
              ).id;
        }

        if (
          sub ===
          'ticketcategory'
        ) {

          c.ticket.categoryId =
            interaction.options
              .getChannel(
                'channel'
              ).id;
        }

        if (
          sub ===
          'suggestions'
        ) {

          c.suggestionsChannelId =
            interaction.options
              .getChannel(
                'channel'
              ).id;
        }

        if (
          sub ===
          'timeout'
        ) {

          c.automod.timeoutSeconds[
            interaction.options
              .getString(
                'type'
              )
          ] =
            interaction.options
              .getInteger(
                'seconds'
              );
        }

        save();

        return interaction.reply(
          '⚙️ Configuration saved for this server.'
        );
      }

      // ==================================================
      // MODERATION
      // ==================================================

      if (
        [
          'warn',
          'timeout',
          'kick',
          'ban',
          'unban'
        ].includes(cmd)
      ) {

        // UNBAN
        if (
          cmd ===
          'unban'
        ) {

          const id =
            interaction.options
              .getString(
                'user_id'
              );

          const reason =
            interaction.options
              .getString(
                'reason'
              );

          await guild.members
            .unban(
              id,
              reason
            );

          await punishRecord(
            guild,
            id,
            'unban',
            reason,
            interaction.user.id
          );

          await sendLog(
            guild,
            'moderation',
            '🔓 User Unbanned',
            [
              field(
                'User ID',
                id
              ),

              field(
                'Moderator',
                interaction.user.toString()
              ),

              field(
                'Reason',
                reason
              )
            ],
            0x57f287
          );

          return interaction.reply(
            `✅ **${id}** unbanned.`
          );
        }

        const user =
          interaction.options
            .getUser(
              'user'
            );

        const member =
          await guild.members
            .fetch(user.id)
            .catch(() => null);

        if (!member) {

          return interaction.reply(
            '❌ Member not found.'
          );
        }

        if (
          member.id ===
          interaction.user.id
        ) {

          return interaction.reply(
            '❌ You cannot moderate yourself.'
          );
        }

        if (
          member.id ===
          guild.ownerId
        ) {

          return interaction.reply(
            '❌ You cannot moderate the server owner.'
          );
        }

        // WARN
        if (
          cmd ===
          'warn'
        ) {

          const reason =
            interaction.options
              .getString(
                'reason'
              );

          const count =
            await addWarning(
              member,
              reason,
              interaction.user.id
            );

          await sendLog(
            guild,
            'moderation',
            '⚠️ Warning',
            [
              field(
                'User',
                user.toString()
              ),

              field(
                'Moderator',
                interaction.user.toString()
              ),

              field(
                'Reason',
                reason
              ),

              field(
                'Total warnings',
                count
              )
            ],
            0xfee75c
          );

          return interaction.reply(
            `⚠️ Warned ${user}. Total warnings: **${count}**`
          );
        }

        // TIMEOUT
        if (
          cmd ===
          'timeout'
        ) {

          const duration =
            interaction.options
              .getString(
                'duration'
              );

          const ms =
            parseDuration(
              duration
            );

          if (!ms) {

            return interaction.reply(
              '❌ Invalid duration. Use `30s`, `10m`, `2h`, `1d`. Maximum is 28 days.'
            );
          }

          if (
            !member.moderatable
          ) {

            return interaction.reply(
              '❌ I cannot timeout this member.'
            );
          }

          const reason =
            interaction.options
              .getString(
                'reason'
              );

          await member
            .timeout(
              ms,
              reason
            );

          await punishRecord(
            guild,
            user.id,
            'timeout',
            reason,
            interaction.user.id
          );

          return interaction.reply(
            `⏱️ ${user} timed out for **${duration}**.`
          );
        }

        // KICK
        if (
          cmd ===
          'kick'
        ) {

          const reason =
            interaction.options
              .getString(
                'reason'
              );

          if (
            !member.kickable
          ) {

            return interaction.reply(
              '❌ I cannot kick this member.'
            );
          }

          await member.kick(
            reason
          );

          await punishRecord(
            guild,
            user.id,
            'kick',
            reason,
            interaction.user.id
          );

          return interaction.reply(
            `👢 **${user.tag}** kicked.`
          );
        }

        // BAN
        if (
          cmd ===
          'ban'
        ) {

          const reason =
            interaction.options
              .getString(
                'reason'
              );

          if (
            !member.bannable
          ) {

            return interaction.reply(
              '❌ I cannot ban this member.'
            );
          }

          await member.ban({
            reason
          });

          await punishRecord(
            guild,
            user.id,
            'ban',
            reason,
            interaction.user.id
          );

          return interaction.reply(
            `🔨 **${user.tag}** banned.`
          );
        }
      }

      // ==================================================
      // WARNINGS / PUNISHMENTS
      // ==================================================

      if (
        cmd ===
        'warnings' ||
        cmd ===
        'punishments'
      ) {

        const user =
          interaction.options
            .getUser(
              'user'
            );

        const list =
          cmd === 'warnings'
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

        return interaction.reply({

          embeds: [

            new EmbedBuilder()

              .setTitle(
                cmd === 'warnings'
                  ? '⚠️ Warnings'
                  : '⚖️ Punishments'
              )

              .setDescription(

                list.length

                  ? list
                      .slice(-10)
                      .map(
                        (item, index) =>
                          `${index + 1}. **${item.type || 'warn'}** — ${item.reason} — <t:${Math.floor(item.time / 1000)}:R>`
                      )
                      .join('\n')

                  : 'None'
              )
          ],

          ephemeral: true
        });
      }

      // ==================================================
      // SUGGESTIONS
      // ==================================================

      if (
        cmd ===
        'suggest'
      ) {

        const channel =
          c.suggestionsChannelId

            ? await guild.channels
                .fetch(
                  c.suggestionsChannelId
                )
                .catch(() => null)

            : interaction.channel;

        if (
          !channel?.isTextBased()
        ) {

          return interaction.reply(
            '❌ Suggestion channel is not configured.'
          );
        }

        const text =
          interaction.options
            .getString(
              'text'
            );

        const row =
          new ActionRowBuilder()
            .addComponents(

              new ButtonBuilder()
                .setCustomId(
                  'suggest_approve'
                )
                .setLabel(
                  'Approve'
                )
                .setEmoji('👍')
                .setStyle(
                  ButtonStyle.Success
                ),

              new ButtonBuilder()
                .setCustomId(
                  'suggest_decline'
                )
                .setLabel(
                  'Decline'
                )
                .setEmoji('👎')
                .setStyle(
                  ButtonStyle.Danger
                )
            );

        const message =
          await channel.send({

            embeds: [

              new EmbedBuilder()

                .setTitle(
                  '💡 New Suggestion'
                )

                .setDescription(
                  text
                )

                .addFields(
                  field(
                    'Suggested by',
                    interaction.user.toString()
                  )
                )

                .setTimestamp()
            ],

            components: [
              row
            ]
          });

        c.suggestions[
          message.id
        ] = {

          userId:
            interaction.user.id,

          text,

          status:
            'pending',

          createdAt:
            Date.now()
        };

        save();

        return interaction.reply({
          content:
            `✅ Suggestion posted: ${message.url}`,
          ephemeral: true
        });
      }

      // ==================================================
      // ANNOUNCEMENT
      // ==================================================

      if (
        cmd ===
        'announce'
      ) {

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

        let prefix = '';

        if (
          interaction.options
            .getBoolean(
              'everyone'
            )
        ) {

          prefix +=
            '@everyone ';
        }

        if (
          interaction.options
            .getBoolean(
              'here'
            )
        ) {

          prefix +=
            '@here ';
        }

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

          roles:
            role
              ? [role.id]
              : [],

          users:
            user
              ? [user.id]
              : []
        };

        if (
          interaction.options
            .getBoolean(
              'everyone'
            ) ||
          interaction.options
            .getBoolean(
              'here'
            )
        ) {

          allowedMentions.parse = [
            'everyone'
          ];
        }

        const title =
          interaction.options
            .getString(
              'title'
            );

        const footer =
          interaction.options
            .getString(
              'footer'
            );

        const useEmbed =
          interaction.options
            .getBoolean(
              'embed'
            ) !== false ||
          title ||
          footer;

        const payload = {

          content:
            prefix + message,

          allowedMentions

        };

        if (useEmbed) {

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
              text:
                footer
            });
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
          'announcements',
          '📢 Announcement Sent',
          [
            field(
              'Channel',
              channel.toString()
            ),

            field(
              'Author',
              interaction.user.toString()
            )
          ]
        );

        return interaction.reply({
          content:
            '✅ Announcement sent.',
          ephemeral: true
        });
      }

      // ==================================================
      // AUTOROLE
      // ==================================================

      if (
        cmd ===
        'autorole'
      ) {

        const sub =
          interaction.options
            .getSubcommand();

        if (
          sub ===
          'set'
        ) {

          const role =
            interaction.options
              .getRole(
                'role'
              );

          if (
            !botCanManageRole(
              guild,
              role
            )
          ) {

            return interaction.reply(
              '❌ My highest role must be above that role.'
            );
          }

          c.autorole = {

            enabled:
              true,

            roleId:
              role.id
          };
        }

        if (
          sub ===
          'disable'
        ) {

          c.autorole.enabled =
            false;
        }

        save();

        if (
          sub ===
          'status'
        ) {

          return interaction.reply(

            `👤 Autorole: **${
              c.autorole.enabled
                ? 'ON'
                : 'OFF'
            }** ` +

            (
              c.autorole.roleId
                ? `<@&${c.autorole.roleId}>`
                : ''
            )
          );
        }

        return interaction.reply(
          '✅ Autorole updated.'
        );
      }

      // ==================================================
      // WELCOME
      // ==================================================

      if (
        cmd ===
        'welcome'
      ) {

        const sub =
          interaction.options
            .getSubcommand();

        if (
          sub ===
          'set'
        ) {

          c.welcome = {

            enabled:
              true,

            channelId:
              interaction.options
                .getChannel(
                  'channel'
                ).id,

            message:
              interaction.options
                .getString(
                  'message'
                )
          };
        }

        if (
          sub ===
          'disable'
        ) {

          c.welcome.enabled =
            false;
        }

        save();

        if (
          sub ===
          'status'
        ) {

          return interaction.reply(

            `👋 Welcome: **${
              c.welcome.enabled
                ? 'ON'
                : 'OFF'
            }** ` +

            (
              c.welcome.channelId
                ? `<#${c.welcome.channelId}>`
                : ''
            )
          );
        }

        return interaction.reply(
          '✅ Welcome updated.'
        );
      }

      // ==================================================
      // VERIFICATION
      // ==================================================

      if (
        cmd ===
        'verification'
      ) {

        const sub =
          interaction.options
            .getSubcommand();

        if (
          sub ===
          'setup'
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
            !botCanManageRole(
              guild,
              role
            )
          ) {

            return interaction.reply(
              '❌ My highest role must be above the verified role.'
            );
          }

          const message =
            await channel.send({

              embeds: [

                new EmbedBuilder()

                  .setTitle(
                    '✅ Verification'
                  )

                  .setDescription(
                    'Click the button below to verify.'
                  )

              ],

              components: [

                new ActionRowBuilder()
                  .addComponents(

                    new ButtonBuilder()
                      .setCustomId(
                        'verify_user'
                      )
                      .setLabel(
                        'Verify'
                      )
                      .setEmoji('✅')
                      .setStyle(
                        ButtonStyle.Success
                      )
                  )
              ]
            });

          c.verification = {

            enabled:
              true,

            channelId:
              channel.id,

            roleId:
              role.id,

            messageId:
              message.id
          };
        }

        if (
          sub ===
          'disable'
        ) {

          c.verification.enabled =
            false;
        }

        save();

        if (
          sub ===
          'status'
        ) {

          return interaction.reply(

            `✅ Verification: **${
              c.verification.enabled
                ? 'ON'
                : 'OFF'
            }** ` +

            (
              c.verification.roleId
                ? `<@&${c.verification.roleId}>`
                : ''
            )
          );
        }

        return interaction.reply(
          '✅ Verification updated.'
        );
      }

      // ==================================================
      // REACTION ROLES
      // ==================================================

      if (
        cmd ===
        'autoreactionrole'
      ) {

        const sub =
          interaction.options
            .getSubcommand();

        if (
          sub ===
          'add'
        ) {

          const messageId =
            interaction.options
              .getString(
                'message_id'
              );

          const emoji =
            interaction.options
              .getString(
                'emoji'
              );

          const role =
            interaction.options
              .getRole(
                'role'
              );

          const message =
            await interaction.channel
              .messages
              .fetch(
                messageId
              )
              .catch(() => null);

          if (!message) {

            return interaction.reply(
              '❌ Message not found in this channel.'
            );
          }

          if (
            !botCanManageRole(
              guild,
              role
            )
          ) {

            return interaction.reply(
              '❌ My highest role must be above that role.'
            );
          }

          c.reactionRoles[
            messageId
          ] ||= {};

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

          return interaction.reply(
            `✅ ${emoji} → ${role}`
          );
        }

        if (
          sub ===
          'remove'
        ) {

          const messageId =
            interaction.options
              .getString(
                'message_id'
              );

          const emoji =
            interaction.options
              .getString(
                'emoji'
              );

          if (
            c.reactionRoles[
              messageId
            ]
          ) {

            delete c.reactionRoles[
              messageId
            ][emoji];
          }

          save();

          return interaction.reply(
            '✅ Reaction role removed.'
          );
        }

        const output = [];

        for (
          const [
            messageId,
            roles
          ]
          of Object.entries(
            c.reactionRoles
          )
        ) {

          for (
            const [
              emoji,
              data
            ]
            of Object.entries(
              roles
            )
          ) {

            output.push(
              `${emoji} → <@&${data.roleId}> — ${messageId}`
            );
          }
        }

        return interaction.reply(
          output.join('\n') ||
          'No reaction roles.'
        );
      }

      // ==================================================
      // LEADERBOARD
      // ==================================================

      if (
        cmd ===
        'leaderboard'
      ) {

        const sub =
          interaction.options
            .getSubcommand();

        if (
          sub ===
          'reset'
        ) {

          c.leaderboard.messages =
            {};
        }

        if (
          sub ===
          'enable'
        ) {

          c.leaderboard.enabled =
            true;
        }

        if (
          sub ===
          'disable'
        ) {

          c.leaderboard.enabled =
            false;
        }

        save();

        if (
          sub ===
          'top' ||
          sub ===
          'status'
        ) {

          const list =
            Object.entries(
              c.leaderboard.messages
            )
              .sort(
                (a, b) =>
                  b[1] - a[1]
              )
              .slice(
                0,
                10
              );

          return interaction.reply({

            embeds: [

              new EmbedBuilder()

                .setTitle(
                  '🏆 Message Leaderboard'
                )

                .setDescription(

                  list.length

                    ? list
                        .map(
                          (
                            [
                              id,
                              count
                            ],
                            index
                          ) =>
                            `${index + 1}. <@${id}> — **${count}** messages`
                        )
                        .join('\n')

                    : 'No messages yet.'
                )

            ]

          });
        }

        return interaction.reply(
          '📊 Leaderboard updated.'
        );
      }

      // ==================================================
      // ADS
      // ==================================================

      if (
        cmd ===
        'ads'
      ) {

        if (
          !isBotOwner(
            interaction.user.id
          )
        ) {

          return interaction.reply({
            content:
              '❌ Bot owner only.',
            ephemeral: true
          });
        }

        const sub =
          interaction.options
            .getSubcommand();

        if (
          sub ===
          'set'
        ) {

          c.ads.channelId =
            interaction.options
              .getChannel(
                'channel'
              ).id;
        }

        if (
          sub ===
          'message'
        ) {

          c.ads.message =
            interaction.options
              .getString(
                'text'
              );
        }

        if (
          sub ===
          'interval'
        ) {

          c.ads.intervalMinutes =
            interaction.options
              .getInteger(
                'minutes'
              );
        }

        if (
          sub ===
          'enable'
        ) {

          c.ads.enabled =
            true;
        }

        if (
          sub ===
          'disable'
        ) {

          c.ads.enabled =
            false;
        }

        if (
          sub ===
          'status'
        ) {

          return interaction.reply(

            `📢 Ads: **${
              c.ads.enabled
                ? 'ON'
                : 'OFF'
            }**\n` +

            `Channel: ${
              c.ads.channelId
                ? `<#${c.ads.channelId}>`
                : 'None'
            }\n` +

            `Interval: **${c.ads.intervalMinutes} minutes**\n` +

            `Message: ${c.ads.message}`
          );
        }

        if (
          sub ===
          'broadcast'
        ) {

          let sent = 0;

          for (
            const guild
            of client.guilds.cache.values()
          ) {

            const serverConfig =
              gc(guild);

            if (
              !serverConfig.ads.enabled ||
              !serverConfig.ads.channelId
            ) {
              continue;
            }

            const channel =
              await guild.channels
                .fetch(
                  serverConfig.ads.channelId
                )
                .catch(() => null);

            if (
              channel?.isTextBased()
            ) {

              await channel
                .send(
                  serverConfig.ads.message
                )
                .catch(() => {});

              sent++;
            }
          }

          return interaction.reply(
            `✅ Broadcast sent to ${sent} configured servers.`
          );
        }

        save();

        return interaction.reply(
          '📢 Ads updated.'
        );
      }

      // ==================================================
      // BOT INFO
      // ==================================================

      if (
        cmd ===
        'botinfo'
      ) {

        const users =
          client.guilds.cache
            .reduce(
              (total, guild) =>
                total +
                (
                  guild.memberCount ||
                  0
                ),
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
                '🤖 AkiyO Bot Info'
              )

              .addFields(

                field(
                  'Bot',
                  `${client.user.tag} (${client.user.id})`
                ),

                field(
                  'Servers',
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
                  'Node',
                  process.version,
                  true
                ),

                field(
                  'discord.js',
                  require(
                    'discord.js'
                  ).version,
                  true
                ),

                field(
                  'Uptime',
                  `${Math.floor(uptime / 86400)}d ` +
                  `${Math.floor((uptime % 86400) / 3600)}h ` +
                  `${Math.floor((uptime % 3600) / 60)}m`,
                  true
                )
              )
          ]
        });
      }

      // ==================================================
      // AI
      // ==================================================

      if (
        cmd ===
        'ai'
      ) {

        const sub =
          interaction.options
            .getSubcommand();

        if (
          sub ===
          'reset'
        ) {

          aiHistory.delete(
            interaction.user.id
          );

          return interaction.reply({
            content:
              '🧠 AI conversation reset.',
            ephemeral: true
          });
        }

        const apiKey =
          process.env.OPENAI_API_KEY;

        if (!apiKey) {

          return interaction.reply({
            content:
              '❌ AI is not configured. Add OPENAI_API_KEY to your hosting environment variables.',
            ephemeral: true
          });
        }

        await interaction
          .deferReply();

        const prompt =
          interaction.options
            .getString(
              'prompt'
            );

        const history =
          aiHistory.get(
            interaction.user.id
          ) || [];

        history.push({

          role:
            'user',

          content:
            prompt
        });

        while (
          history.length > 12
        ) {

          history.shift();
        }

        const response =
          await fetch(
            'https://api.openai.com/v1/responses',
            {

              method:
                'POST',

              headers: {

                'Content-Type':
                  'application/json',

                Authorization:
                  `Bearer ${apiKey}`
              },

              body:
                JSON.stringify({

                  model:
                    process.env.OPENAI_MODEL ||
                    'gpt-5.5',

                  instructions:
                    'You are AkiyO AI, a helpful Discord assistant. Keep answers concise and useful.',

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
            `OpenAI HTTP ${response.status}`
          );
        }

        const answer =
          String(
            data.output_text ||

            data.output
              ?.flatMap(
                x =>
                  x.content || []
              )
              .filter(
                x =>
                  x.type ===
                  'output_text'
              )
              .map(
                x =>
                  x.text
              )
              .join('\n') ||

            'I could not generate a response.'
          ).trim();

        history.push({

          role:
            'assistant',

          content:
            answer
        });

        while (
          history.length > 12
        ) {

          history.shift();
        }

        aiHistory.set(
          interaction.user.id,
          history
        );

        return interaction.editReply(
          answer.slice(
            0,
            1900
          )
        );
      }

    } catch (error) {

      console.error(
        'interactionCreate:',
        error
      );

      if (
        !interaction.replied &&
        !interaction.deferred
      ) {

        await interaction
          .reply({
            content:
              `❌ ${error.message || 'Internal error.'}`,
            ephemeral: true
          })
          .catch(() => {});

      } else if (
        interaction.deferred
      ) {

        await interaction
          .editReply(
            `❌ ${error.message || 'Internal error.'}`
          )
          .catch(() => {});
      }
    }
  }
);

// ======================================================
// PERIODIC ADS
// ======================================================

setInterval(
  async () => {

    for (
      const guild
      of client.guilds.cache.values()
    ) {

      try {

        const c =
          gc(guild);

        if (
          !c.ads.enabled ||
          !c.ads.channelId
        ) {
          continue;
        }

        if (
          Date.now() -
            (c.ads._lastSent || 0) <
          c.ads.intervalMinutes *
            60000
        ) {
          continue;
        }

        const channel =
          await guild.channels
            .fetch(
              c.ads.channelId
            )
            .catch(() => null);

        if (
          channel?.isTextBased()
        ) {

          await channel
            .send(
              c.ads.message
            )
            .catch(() => {});

          c.ads._lastSent =
            Date.now();

          save();
        }

      } catch (error) {

        console.error(
          'Ads:',
          error
        );
      }
    }

  },
  60000
);

// ======================================================
// ERROR HANDLING
// ======================================================

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

// ======================================================
// LOGIN
// ======================================================

client.login(
  TOKEN
)
.catch(
  error => {

    console.error(
      '❌ Discord login failed:',
      error
    );

    process.exit(1);
  }
);
