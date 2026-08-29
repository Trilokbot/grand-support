'use strict';

const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  REST,
  Routes,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ChannelType,
  AuditLogEvent
} = require('discord.js');

/* =========================================================
   ENVIRONMENT
========================================================= */

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN) {
  console.error('DISCORD_TOKEN is missing.');
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error('CLIENT_ID is missing.');
  process.exit(1);
}

/* =========================================================
   YOUR SERVER CONFIG
========================================================= */

const GUILD_ID = '1493700265499689154';

const SUPPORT_ADMIN_ROLE_ID = '1542498406981959801';
const SUPPORT_LOG_CHANNEL_ID = '1542500573000106024';

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
   PERSISTENT CONFIG
   Simple JSON file - no extra npm package required.
========================================================= */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'config.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let database = {
  guilds: {}
};

function loadDatabase() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      database = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (error) {
    console.error('Database load error:', error);
  }
}

function saveDatabase() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(database, null, 2));
  } catch (error) {
    console.error('Database save error:', error);
  }
}

function defaultGuildConfig() {
  return {
    automod: {
      enabled: true,
      invites: true,
      spam: true,
      massMentions: true,
      badWords: true,
      caps: true,
      repeatedMessages: true,
      maxMentions: 5,
      spamLimit: 6,
      spamWindow: 5000,
      capsPercent: 75,
      repeatedLimit: 3,
      punishment: 'timeout',
      timeoutSeconds: 60,
      logChannel: null,
      badWords: [
        'badword1',
        'badword2'
      ]
    },

    security: {
      enabled: true,
      antiRaid: true,
      raidJoinLimit: 8,
      raidWindow: 10000,
      raidTimeout: true,
      raidTimeoutSeconds: 3600,

      antiNuke: true,
      maxChannelDeletes: 3,
      maxRoleDeletes: 3,
      maxChannelCreates: 8,
      maxRoleCreates: 8,
      actionWindow: 10000,

      roleProtection: true,
      protectedRoles: [],
      protectEveryone: true,

      trustedUsers: [],
      trustedBots: []
    },

    tickets: {
      enabled: true,
      categoryId: null,
      supportRoleId: SUPPORT_ADMIN_ROLE_ID,
      logChannelId: SUPPORT_LOG_CHANNEL_ID,
      welcomeMessage:
        'Thank you for contacting support. A staff member will assist you shortly.'
    },

    announcements: {
      enabled: true,
      channels: [],
      defaultChannel: null
    },

    moderation: {
      warnEscalation: true,
      warnTimeoutAt: 3,
      warnKickAt: 5,
      warnBanAt: 7
    },

    logs: {
      enabled: true,
      channelId: SUPPORT_LOG_CHANNEL_ID
    }
  };
}

function getGuildConfig(guildId) {
  if (!database.guilds[guildId]) {
    database.guilds[guildId] = defaultGuildConfig();
    saveDatabase();
  }

  return database.guilds[guildId];
}

loadDatabase();

/* =========================================================
   MEMORY
========================================================= */

const messageTracker = new Map();
const raidTracker = new Map();
const securityActions = new Map();
const openTickets = new Map();

/* =========================================================
   HELPERS
========================================================= */

function isStaff(member) {
  if (!member) return false;

  return (
    member.permissions.has(PermissionsBitField.Flags.Administrator) ||
    member.roles.cache.has(SUPPORT_ADMIN_ROLE_ID)
  );
}

function isTrusted(guild, userId) {
  const config = getGuildConfig(guild.id);

  if (userId === guild.ownerId) return true;

  if (config.security.trustedUsers.includes(userId)) return true;

  return false;
}

function isTrustedBot(guild, user) {
  const config = getGuildConfig(guild.id);

  return (
    user.bot &&
    config.security.trustedBots.includes(user.id)
  );
}

function canModerate(executor, target) {
  if (!executor || !target) return false;

  if (target.id === executor.guild.ownerId) return false;

  return executor.roles.highest.comparePositionTo(target.roles.highest) > 0;
}

async function sendLog(guild, title, description, color = 0x5865F2) {
  const config = getGuildConfig(guild.id);

  if (!config.logs.enabled) return;

  const channelId =
    config.logs.channelId ||
    config.tickets.logChannelId ||
    SUPPORT_LOG_CHANNEL_ID;

  const channel = guild.channels.cache.get(channelId);

  if (!channel || !channel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp();

  try {
    await channel.send({ embeds: [embed] });
  } catch {}
}

async function sendAutoModLog(guild, title, description) {
  const config = getGuildConfig(guild.id);

  const channelId =
    config.automod.logChannel ||
    config.logs.channelId ||
    SUPPORT_LOG_CHANNEL_ID;

  const channel = guild.channels.cache.get(channelId);

  if (!channel || !channel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setTitle(`🛡️ ${title}`)
    .setDescription(description)
    .setColor(0xED4245)
    .setTimestamp();

  try {
    await channel.send({ embeds: [embed] });
  } catch {}
}

async function timeoutMember(member, seconds, reason) {
  if (!member.moderatable) return false;

  try {
    await member.timeout(seconds * 1000, reason);
    return true;
  } catch {
    return false;
  }
}

async function punishMember(member, type, reason, duration = 60) {
  if (!member) return false;

  if (type === 'timeout') {
    return timeoutMember(member, duration, reason);
  }

  if (type === 'kick') {
    if (!member.kickable) return false;
    await member.kick(reason);
    return true;
  }

  if (type === 'ban') {
    if (!member.bannable) return false;
    await member.ban({ reason });
    return true;
  }

  return false;
}

/* =========================================================
   SLASH COMMANDS
========================================================= */

const commands = [

  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Open the DM support ticket system'),

  new SlashCommandBuilder()
    .setName('close-ticket')
    .setDescription('Close the current ticket'),

  new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Configure AutoMod')
    .addSubcommand(sub =>
      sub.setName('enable')
        .setDescription('Enable AutoMod')
    )
    .addSubcommand(sub =>
      sub.setName('disable')
        .setDescription('Disable AutoMod')
    )
    .addSubcommand(sub =>
      sub.setName('status')
        .setDescription('Show AutoMod status')
    )
    .addSubcommand(sub =>
      sub.setName('logchannel')
        .setDescription('Set AutoMod log channel')
        .addChannelOption(opt =>
          opt.setName('channel')
            .setDescription('Log channel')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand(sub =>
      sub.setName('invites')
        .setDescription('Enable/disable invite protection')
        .addBooleanOption(opt =>
          opt.setName('enabled')
            .setDescription('Enabled')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('spam')
        .setDescription('Enable/disable spam protection')
        .addBooleanOption(opt =>
          opt.setName('enabled')
            .setDescription('Enabled')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('mentions')
        .setDescription('Enable/disable mass mention protection')
        .addBooleanOption(opt =>
          opt.setName('enabled')
            .setDescription('Enabled')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('badwords')
        .setDescription('Enable/disable bad word protection')
        .addBooleanOption(opt =>
          opt.setName('enabled')
            .setDescription('Enabled')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('caps')
        .setDescription('Enable/disable caps protection')
        .addBooleanOption(opt =>
          opt.setName('enabled')
            .setDescription('Enabled')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('repeated')
        .setDescription('Enable/disable repeated message protection')
        .addBooleanOption(opt =>
          opt.setName('enabled')
            .setDescription('Enabled')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('punishment')
        .setDescription('Set AutoMod punishment')
        .addStringOption(opt =>
          opt.setName('type')
            .setDescription('Punishment')
            .setRequired(true)
            .addChoices(
              { name: 'Timeout', value: 'timeout' },
              { name: 'Kick', value: 'kick' },
              { name: 'Ban', value: 'ban' }
            )
        )
    ),

  new SlashCommandBuilder()
    .setName('security')
    .setDescription('Configure server security')
    .addSubcommand(sub =>
      sub.setName('status')
        .setDescription('Show security status')
    )
    .addSubcommand(sub =>
      sub.setName('enable')
        .setDescription('Enable security')
    )
    .addSubcommand(sub =>
      sub.setName('disable')
        .setDescription('Disable security')
    )
    .addSubcommand(sub =>
      sub.setName('antiraid')
        .setDescription('Configure anti-raid')
        .addBooleanOption(opt =>
          opt.setName('enabled')
            .setDescription('Enabled')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('antinuke')
        .setDescription('Configure anti-nuke')
        .addBooleanOption(opt =>
          opt.setName('enabled')
            .setDescription('Enabled')
            .setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Warn a member')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('Member')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('reason')
        .setDescription('Reason')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('warnings')
    .setDescription('View member warnings')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('Member')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout a member')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('Member')
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName('minutes')
        .setDescription('Minutes')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(40320)
    )
    .addStringOption(opt =>
      opt.setName('reason')
        .setDescription('Reason')
    ),

  new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('Member')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('reason')
        .setDescription('Reason')
    ),

  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('Member')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('reason')
        .setDescription('Reason')
    ),

  new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Unban a user')
    .addStringOption(opt =>
      opt.setName('userid')
        .setDescription('User ID')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('reason')
        .setDescription('Reason')
    ),

  new SlashCommandBuilder()
    .setName('punishments')
    .setDescription('View punishment history')
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('Member')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('suggest')
    .setDescription('Create a suggestion')
    .addStringOption(opt =>
      opt.setName('suggestion')
        .setDescription('Your suggestion')
        .setRequired(true)
        .setMaxLength(1000)
    ),

  new SlashCommandBuilder()
    .setName('config')
    .setDescription('View or configure the bot')
    .addSubcommand(sub =>
      sub.setName('status')
        .setDescription('Show configuration')
    )
    .addSubcommand(sub =>
      sub.setName('logs')
        .setDescription('Set general log channel')
        .addChannelOption(opt =>
          opt.setName('channel')
            .setDescription('Log channel')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand(sub =>
      sub.setName('support-role')
        .setDescription('Set support role')
        .addRoleOption(opt =>
          opt.setName('role')
            .setDescription('Support role')
            .setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName('trust')
    .setDescription('Manage trusted users and bots')
    .addSubcommand(sub =>
      sub.setName('user-add')
        .setDescription('Trust a user')
        .addUserOption(opt =>
          opt.setName('user')
            .setDescription('User')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('user-remove')
        .setDescription('Remove trusted user')
        .addUserOption(opt =>
          opt.setName('user')
            .setDescription('User')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('bot-add')
        .setDescription('Trust a bot')
        .addUserOption(opt =>
          opt.setName('bot')
            .setDescription('Bot')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('bot-remove')
        .setDescription('Remove trusted bot')
        .addUserOption(opt =>
          opt.setName('bot')
            .setDescription('Bot')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List trusted users and bots')
    ),

  new SlashCommandBuilder()
    .setName('role-protect')
    .setDescription('Configure protected roles')
    .addSubcommand(sub =>
      sub.setName('add')
        .setDescription('Protect a role')
        .addRoleOption(opt =>
          opt.setName('role')
            .setDescription('Role')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('remove')
        .setDescription('Remove protected role')
        .addRoleOption(opt =>
          opt.setName('role')
            .setDescription('Role')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('list')
        .setDescription('List protected roles')
    )
    .addSubcommand(sub =>
      sub.setName('everyone')
        .setDescription('Enable/disable @everyone protection')
        .addBooleanOption(opt =>
          opt.setName('enabled')
            .setDescription('Enabled')
            .setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName('autotimeout')
    .setDescription('Configure automatic timeout')
    .addSubcommand(sub =>
      sub.setName('status')
        .setDescription('Show auto-timeout settings')
    )
    .addSubcommand(sub =>
      sub.setName('set')
        .setDescription('Set timeout duration')
        .addIntegerOption(opt =>
          opt.setName('seconds')
            .setDescription('Timeout seconds')
            .setRequired(true)
            .setMinValue(1)
            .setMaxValue(2419200)
        )
    )
    .addSubcommand(sub =>
      sub.setName('spam')
        .setDescription('Set spam timeout duration')
        .addIntegerOption(opt =>
          opt.setName('seconds')
            .setDescription('Seconds')
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub.setName('raid')
        .setDescription('Set raid timeout duration')
        .addIntegerOption(opt =>
          opt.setName('seconds')
            .setDescription('Seconds')
            .setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName('announcement')
    .setDescription('Advanced announcement system')
    .addSubcommand(sub =>
      sub.setName('send')
        .setDescription('Send announcement')
        .addChannelOption(opt =>
          opt.setName('channel')
            .setDescription('Announcement channel')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
        .addStringOption(opt =>
          opt.setName('title')
            .setDescription('Title')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('message')
            .setDescription('Message')
            .setRequired(true)
        )
        .addStringOption(opt =>
          opt.setName('image')
            .setDescription('Image URL')
            .setRequired(false)
        )
        .addStringOption(opt =>
          opt.setName('mention')
            .setDescription('Mention')
            .setRequired(false)
            .addChoices(
              { name: 'No mention', value: 'none' },
              { name: '@everyone', value: 'everyone' },
              { name: '@here', value: 'here' }
            )
        )
    )
    .addSubcommand(sub =>
      sub.setName('channel-add')
        .setDescription('Add announcement channel')
        .addChannelOption(opt =>
          opt.setName('channel')
            .setDescription('Channel')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand(sub =>
      sub.setName('channel-remove')
        .setDescription('Remove announcement channel')
        .addChannelOption(opt =>
          opt.setName('channel')
            .setDescription('Channel')
            .setRequired(true)
            .addChannelTypes(ChannelType.GuildText)
        )
    )
    .addSubcommand(sub =>
      sub.setName('channels')
        .setDescription('List announcement channels')
    ),

  new SlashCommandBuilder()
    .setName('audit')
    .setDescription('View recent audit activity')
    .addIntegerOption(opt =>
      opt.setName('limit')
        .setDescription('Number of entries')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(20)
    ),

  new SlashCommandBuilder()
    .setName('help')
    .setDescription('Show all bot commands')

].map(command => command.toJSON());

/* =========================================================
   REGISTER COMMANDS
========================================================= */

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);

  try {
    console.log('Registering slash commands...');

    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );

    console.log(`Registered ${commands.length} slash commands.`);
  } catch (error) {
    console.error('Slash command registration error:', error);
  }
}

/* =========================================================
   READY
========================================================= */

client.once('ready', async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`Guild ID: ${GUILD_ID}`);

  await registerCommands();

  client.user.setPresence({
    activities: [
      {
        name: 'DM Support • AutoMod • Security',
        type: 3
      }
    ],
    status: 'online'
  });
});

/* =========================================================
   DM TICKET SYSTEM
========================================================= */

async function createTicketFromDM(message) {
  if (message.author.bot) return;

  const guild = client.guilds.cache.get(GUILD_ID);

  if (!guild) return;

  const config = getGuildConfig(guild.id);

  if (!config.tickets.enabled) return;

  if (openTickets.has(message.author.id)) {
    const existingChannel = guild.channels.cache.get(
      openTickets.get(message.author.id)
    );

    if (existingChannel) {
      await existingChannel.send({
        content:
          `📩 **New DM from ${message.author.tag}:**\n${message.content || '(attachment)'}`
      });
      return;
    }

    openTickets.delete(message.author.id);
  }

  let category = null;

  if (config.tickets.categoryId) {
    category = guild.channels.cache.get(config.tickets.categoryId);
  }

  const channelName =
    `ticket-${message.author.username}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .slice(0, 80);

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category?.id || null,
    topic: `DM Ticket • ${message.author.id}`
  });

  openTickets.set(message.author.id, channel.id);

  await channel.permissionOverwrites.create(
    message.author.id,
    {
      ViewChannel: false
    }
  );

  const supportRole = guild.roles.cache.get(
    config.tickets.supportRoleId || SUPPORT_ADMIN_ROLE_ID
  );

  if (supportRole) {
    await channel.permissionOverwrites.create(
      supportRole.id,
      {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      }
    );
  }

  const embed = new EmbedBuilder()
    .setTitle('🎫 New DM Ticket')
    .setDescription(
      `A new support ticket was opened by **${message.author.tag}**.\n\n` +
      `**User ID:** \`${message.author.id}\`\n\n` +
      `**First message:**\n${message.content || '(attachment)'}`
    )
    .setColor(0x5865F2)
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_close')
      .setLabel('Close Ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: supportRole ? `<@&${supportRole.id}>` : undefined,
    embeds: [embed],
    components: [row]
  });

  try {
    await message.author.send(
      config.tickets.welcomeMessage
    );
  } catch {}

  await sendLog(
    guild,
    '🎫 Ticket Created',
    `Ticket created for **${message.author.tag}**.`,
    0x57F287
  );
}

async function relayTicketMessage(message) {
  if (message.author.bot) return;

  if (!message.guild) return;

  if (!message.channel.name?.startsWith('ticket-')) return;

  const topic = message.channel.topic || '';

  const match = topic.match(/DM Ticket • (\d+)/);

  if (!match) return;

  const userId = match[1];

  const user = await client.users.fetch(userId).catch(() => null);

  if (!user) return;

  try {
    const embed = new EmbedBuilder()
      .setTitle(`💬 Support Reply — ${message.guild.name}`)
      .setDescription(
        message.content || '(attachment)'
      )
      .setFooter({
        text: `Staff: ${message.author.tag}`
      })
      .setTimestamp();

    await user.send({
      embeds: [embed]
    });
  } catch {}
}

/* =========================================================
   AUTOMOD
========================================================= */

function containsInvite(content) {
  return /(?:discord\.gg|discord\.com\/invite|discordapp\.com\/invite)\//i.test(
    content
  );
}

function hasMassMentions(message, limit) {
  const total =
    message.mentions.users.size +
    message.mentions.roles.size;

  return total >= limit || message.mentions.everyone;
}

function hasTooManyCaps(content, percentage) {
  const letters = content.match(/[A-Za-z]/g);

  if (!letters || letters.length < 8) return false;

  const upper = content.match(/[A-Z]/g) || [];

  return (upper.length / letters.length) * 100 >= percentage;
}

function hasBadWord(content, badWords) {
  const lower = content.toLowerCase();

  return badWords.some(word =>
    lower.includes(String(word).toLowerCase())
  );
}

function isRepeatedMessage(message, config) {
  const userId = message.author.id;

  if (!messageTracker.has(userId)) {
    messageTracker.set(userId, []);
  }

  const list = messageTracker.get(userId);

  const now = Date.now();

  list.push({
    content: message.content,
    time: now
  });

  while (
    list.length &&
    now - list[0].time > 15000
  ) {
    list.shift();
  }

  const same = list.filter(
    x => x.content === message.content
  );

  return same.length >= config.automod.repeatedLimit;
}

function isSpamming(message, config) {
  const userId = message.author.id;

  if (!messageTracker.has(`spam:${userId}`)) {
    messageTracker.set(`spam:${userId}`, []);
  }

  const list = messageTracker.get(`spam:${userId}`);

  const now = Date.now();

  list.push(now);

  while (
    list.length &&
    now - list[0] > config.automod.spamWindow
  ) {
    list.shift();
  }

  return list.length >= config.automod.spamLimit;
}

async function handleAutoMod(message) {
  if (!message.guild) return;
  if (message.author.bot) return;

  const config = getGuildConfig(message.guild.id);

  if (!config.automod.enabled) return;

  const member = message.member;

  if (!member) return;

  if (
    isStaff(member) ||
    isTrusted(message.guild, message.author.id)
  ) {
    return;
  }

  let violation = null;

  if (
    config.automod.invites &&
    containsInvite(message.content)
  ) {
    violation = 'Discord invite link';
  }

  if (
    !violation &&
    config.automod.massMentions &&
    hasMassMentions(
      message,
      config.automod.maxMentions
    )
  ) {
    violation = 'Mass mentions';
  }

  if (
    !violation &&
    config.automod.badWords &&
    hasBadWord(
      message.content,
      config.automod.badWords
    )
  ) {
    violation = 'Blocked word';
  }

  if (
    !violation &&
    config.automod.caps &&
    hasTooManyCaps(
      message.content,
      config.automod.capsPercent
    )
  ) {
    violation = 'Excessive caps';
  }

  if (
    !violation &&
    config.automod.repeatedMessages &&
    isRepeatedMessage(message, config)
  ) {
    violation = 'Repeated messages';
  }

  if (
    !violation &&
    config.automod.spam &&
    isSpamming(message, config)
  ) {
    violation = 'Spam';
  }

  if (!violation) return;

  try {
    await message.delete();
  } catch {}

  const punishment = config.automod.punishment;

  await punishMember(
    member,
    punishment,
    `AutoMod: ${violation}`,
    config.automod.timeoutSeconds
  );

  await sendAutoModLog(
    message.guild,
    'AutoMod Action',
    `**User:** ${message.author.tag}\n` +
    `**ID:** ${message.author.id}\n` +
    `**Reason:** ${violation}\n` +
    `**Punishment:** ${punishment}`
  );
}

/* =========================================================
   ANTI RAID
========================================================= */

async function handleAntiRaid(member) {
  const guild = member.guild;
  const config = getGuildConfig(guild.id);

  if (!config.security.enabled) return;
  if (!config.security.antiRaid) return;

  if (isTrusted(guild, member.id)) return;

  const now = Date.now();

  if (!raidTracker.has(guild.id)) {
    raidTracker.set(guild.id, []);
  }

  const list = raidTracker.get(guild.id);

  list.push(now);

  while (
    list.length &&
    now - list[0] > config.security.raidWindow
  ) {
    list.shift();
  }

  if (
    list.length >=
    config.security.raidJoinLimit
  ) {
    await sendLog(
      guild,
      '🚨 Possible Raid Detected',
      `**${list.length} members** joined within the configured raid window.`,
      0xED4245
    );

    if (config.security.raidTimeout) {
      await timeoutMember(
        member,
        config.automod.timeoutSeconds,
        'Anti-Raid protection'
      );
    }
  }
}

/* =========================================================
   SECURITY ACTION TRACKER
========================================================= */

function recordSecurityAction(guildId, executorId, action) {
  const config = getGuildConfig(guildId);

  const key = `${guildId}:${executorId}:${action}`;

  if (!securityActions.has(key)) {
    securityActions.set(key, []);
  }

  const list = securityActions.get(key);

  const now = Date.now();

  list.push(now);

  while (
    list.length &&
    now - list[0] >
      config.security.actionWindow
  ) {
    list.shift();
  }

  return list.length;
}

async function punishUnauthorizedExecutor(
  guild,
  executor,
  reason
) {
  if (!executor) return;

  if (
    isTrusted(guild, executor.id) ||
    isTrustedBot(guild, executor)
  ) {
    return;
  }

  const member =
    guild.members.cache.get(executor.id) ||
    await guild.members.fetch(executor.id).catch(() => null);

  if (!member) return;

  if (
    member.id === guild.ownerId ||
    member.permissions.has(
      PermissionsBitField.Flags.Administrator
    )
  ) {
    return;
  }

  if (member.moderatable) {
    await timeoutMember(
      member,
      3600,
      `Security protection: ${reason}`
    );
  }

  await sendLog(
    guild,
    '🔐 Security Protection',
    `Unauthorized action detected.\n\n` +
    `**Executor:** ${executor.tag || executor.id}\n` +
    `**Reason:** ${reason}\n` +
    `**Action:** 1-hour timeout`,
    0xED4245
  );
}

/* =========================================================
   ROLE PROTECTION
========================================================= */

async function handleRoleUpdate(oldRole, newRole) {
  const guild = newRole.guild;
  const config = getGuildConfig(guild.id);

  if (!config.security.enabled) return;
  if (!config.security.roleProtection) return;

  const protectedRole =
    config.security.protectedRoles.includes(newRole.id);

  const everyoneRole =
    newRole.id === guild.id &&
    config.security.protectEveryone;

  if (!protectedRole && !everyoneRole) return;

  const audit = await guild.fetchAuditLogs({
    type: AuditLogEvent.RoleUpdate,
    limit: 5
  }).catch(() => null);

  const entry = audit?.entries.find(
    e =>
      e.target?.id === newRole.id &&
      Date.now() - e.createdTimestamp < 10000
  );

  if (!entry) return;

  const executor = entry.executor;

  if (
    !executor ||
    isTrusted(guild, executor.id)
  ) {
    return;
  }

  try {
    await newRole.edit({
      name: oldRole.name,
      permissions: oldRole.permissions,
      color: oldRole.color,
      hoist: oldRole.hoist,
      mentionable: oldRole.mentionable
    });
  } catch {}

  await punishUnauthorizedExecutor(
    guild,
    executor,
    `Unauthorized protected role modification: ${newRole.name}`
  );
}

async function handleRoleCreate(role) {
  const guild = role.guild;
  const config = getGuildConfig(guild.id);

  if (!config.security.enabled) return;
  if (!config.security.antiNuke) return;

  const count = recordSecurityAction(
    guild.id,
    'global',
    'role-create'
  );

  if (count <= config.security.maxRoleCreates) return;

  const audit = await guild.fetchAuditLogs({
    type: AuditLogEvent.RoleCreate,
    limit: 5
  }).catch(() => null);

  const entry = audit?.entries.find(
    e =>
      e.target?.id === role.id &&
      Date.now() - e.createdTimestamp < 10000
  );

  if (!entry) return;

  const executor = entry.executor;

  if (
    !executor ||
    isTrusted(guild, executor.id)
  ) {
    return;
  }

  try {
    await role.delete('Anti-Nuke protection');
  } catch {}

  await punishUnauthorizedExecutor(
    guild,
    executor,
    'Excessive role creation'
  );
}

/* =========================================================
   CHANNEL SECURITY
========================================================= */

async function handleChannelCreate(channel) {
  if (!channel.guild) return;

  const guild = channel.guild;
  const config = getGuildConfig(guild.id);

  if (!config.security.enabled) return;
  if (!config.security.antiNuke) return;

  const count = recordSecurityAction(
    guild.id,
    'global',
    'channel-create'
  );

  if (
    count <= config.security.maxChannelCreates
  ) {
    return;
  }

  const audit = await guild.fetchAuditLogs({
    type: AuditLogEvent.ChannelCreate,
    limit: 5
  }).catch(() => null);

  const entry = audit?.entries.find(
    e =>
      e.target?.id === channel.id &&
      Date.now() - e.createdTimestamp < 10000
  );

  if (!entry) return;

  const executor = entry.executor;

  if (
    !executor ||
    isTrusted(guild, executor.id)
  ) {
    return;
  }

  try {
    await channel.delete(
      'Anti-Nuke protection'
    );
  } catch {}

  await punishUnauthorizedExecutor(
    guild,
    executor,
    'Excessive channel creation'
  );
}

async function handleChannelDelete(channel) {
  if (!channel.guild) return;

  const guild = channel.guild;
  const config = getGuildConfig(guild.id);

  if (!config.security.enabled) return;
  if (!config.security.antiNuke) return;

  const count = recordSecurityAction(
    guild.id,
    'global',
    'channel-delete'
  );

  if (
    count <= config.security.maxChannelDeletes
  ) {
    return;
  }

  const audit = await guild.fetchAuditLogs({
    type: AuditLogEvent.ChannelDelete,
    limit: 5
  }).catch(() => null);

  const entry = audit?.entries.find(
    e =>
      e.target?.id === channel.id &&
      Date.now() - e.createdTimestamp < 10000
  );

  if (!entry) return;

  const executor = entry.executor;

  if (
    !executor ||
    isTrusted(guild, executor.id)
  ) {
    return;
  }

  await punishUnauthorizedExecutor(
    guild,
    executor,
    'Excessive channel deletion'
  );
}

/* =========================================================
   PUNISHMENT DATABASE
========================================================= */

function getModerationData(guildId) {
  const config = getGuildConfig(guildId);

  if (!config.moderationData) {
    config.moderationData = {
      warnings: {},
      punishments: {}
    };

    saveDatabase();
  }

  return config.moderationData;
}

function addWarning(guildId, userId, moderatorId, reason) {
  const data = getModerationData(guildId);

  if (!data.warnings[userId]) {
    data.warnings[userId] = [];
  }

  const warning = {
    id: Date.now().toString(),
    moderatorId,
    reason,
    timestamp: new Date().toISOString()
  };

  data.warnings[userId].push(warning);

  saveDatabase();

  return warning;
}

function addPunishment(
  guildId,
  userId,
  moderatorId,
  type,
  reason
) {
  const data = getModerationData(guildId);

  if (!data.punishments[userId]) {
    data.punishments[userId] = [];
  }

  const punishment = {
    id: Date.now().toString(),
    moderatorId,
    type,
    reason,
    timestamp: new Date().toISOString()
  };

  data.punishments[userId].push(punishment);

  saveDatabase();

  return punishment;
}

/* =========================================================
   COMMAND HANDLER
========================================================= */

client.on('interactionCreate', async interaction => {

  try {

    /* ---------------- BUTTONS ---------------- */

    if (interaction.isButton()) {

      if (interaction.customId === 'ticket_close') {

        if (!interaction.channel?.name?.startsWith('ticket-')) {
          return interaction.reply({
            content: '❌ This is not a ticket channel.',
            ephemeral: true
          });
        }

        if (!isStaff(interaction.member)) {
          return interaction.reply({
            content: '❌ You do not have permission.',
            ephemeral: true
          });
        }

        const topic =
          interaction.channel.topic || '';

        const match =
          topic.match(/DM Ticket • (\d+)/);

        if (match) {
          openTickets.delete(match[1]);

          const user =
            await client.users.fetch(match[1])
              .catch(() => null);

          if (user) {
            await user.send(
              '🔒 Your support ticket has been closed.'
            ).catch(() => {});
          }
        }

        await interaction.reply(
          '🔒 Closing ticket...'
        );

        await sendLog(
          interaction.guild,
          '🔒 Ticket Closed',
          `Ticket closed by **${interaction.user.tag}**.`
        );

        setTimeout(() => {
          interaction.channel.delete().catch(() => {});
        }, 1500);

        return;
      }

      if (
        interaction.customId.startsWith('suggest_')
      ) {

        if (!isStaff(interaction.member)) {
          return interaction.reply({
            content:
              '❌ Only staff can process suggestions.',
            ephemeral: true
          });
        }

        const [, action, id] =
          interaction.customId.split('_');

        const status =
          action === 'approve'
            ? 'Approved'
            : 'Declined';

        const embed =
          interaction.message.embeds[0];

        const updated =
          EmbedBuilder.from(embed)
            .setColor(
              action === 'approve'
                ? 0x57F287
                : 0xED4245
            )
            .addFields({
              name: 'Status',
              value:
                `${status} by ${interaction.user}`
            });

        await interaction.update({
          embeds: [updated],
          components: []
        });

        await sendLog(
          interaction.guild,
          `💡 Suggestion ${status}`,
          `Suggestion ID: ${id}\n` +
          `Processed by: ${interaction.user.tag}`
        );

        return;
      }
    }

    /* ---------------- SLASH COMMANDS ---------------- */

    if (!interaction.isChatInputCommand()) {
      return;
    }

    const guild =
      interaction.guild;

    if (!guild) {
      return interaction.reply({
        content:
          '❌ This command can only be used in the server.',
        ephemeral: true
      });
    }

    const config =
      getGuildConfig(guild.id);

    /* ================= TICKET ================= */

    if (interaction.commandName === 'ticket') {

      await interaction.reply({
        content:
          '📩 Send me a DM and your support ticket will be created automatically.',
        ephemeral: true
      });

      return;
    }

    if (
      interaction.commandName ===
      'close-ticket'
    ) {

      if (
        !interaction.channel?.name?.startsWith(
          'ticket-'
        )
      ) {
        return interaction.reply({
          content:
            '❌ This command can only be used in a ticket channel.',
          ephemeral: true
        });
      }

      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content:
            '❌ You do not have permission.',
          ephemeral: true
        });
      }

      const match =
        (interaction.channel.topic || '')
          .match(/DM Ticket • (\d+)/);

      if (match) {
        openTickets.delete(match[1]);

        const user =
          await client.users.fetch(match[1])
            .catch(() => null);

        if (user) {
          await user.send(
            '🔒 Your support ticket has been closed.'
          ).catch(() => {});
        }
      }

      await interaction.reply(
        '🔒 Closing ticket...'
      );

      setTimeout(() => {
        interaction.channel.delete().catch(() => {});
      }, 1000);

      return;
    }

    /* ================= AUTOMOD ================= */

    if (
      interaction.commandName ===
      'automod'
    ) {

      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content:
            '❌ Staff only.',
          ephemeral: true
        });
      }

      const sub =
        interaction.options.getSubcommand();

      if (sub === 'enable') {
        config.automod.enabled = true;
        saveDatabase();

        return interaction.reply(
          '🛡️ AutoMod enabled.'
        );
      }

      if (sub === 'disable') {
        config.automod.enabled = false;
        saveDatabase();

        return interaction.reply(
          '🛡️ AutoMod disabled.'
        );
      }

      if (sub === 'status') {

        const embed =
          new EmbedBuilder()
            .setTitle('🛡️ AutoMod Status')
            .setColor(0x5865F2)
            .addFields(
              {
                name: 'System',
                value:
                  config.automod.enabled
                    ? '🟢 Enabled'
                    : '🔴 Disabled'
              },
              {
                name: 'Invite Links',
                value:
                  String(config.automod.invites),
                inline: true
              },
              {
                name: 'Spam',
                value:
                  String(config.automod.spam),
                inline: true
              },
              {
                name: 'Mass Mentions',
                value:
                  String(config.automod.massMentions),
                inline: true
              },
              {
                name: 'Bad Words',
                value:
                  String(config.automod.badWords),
                inline: true
              },
              {
                name: 'Caps',
                value:
                  String(config.automod.caps),
                inline: true
              },
              {
                name: 'Repeated',
                value:
                  String(config.automod.repeatedMessages),
                inline: true
              },
              {
                name: 'Punishment',
                value:
                  config.automod.punishment,
                inline: true
              }
            );

        return interaction.reply({
          embeds: [embed]
        });
      }

      const boolMap = {
        invites: 'invites',
        spam: 'spam',
        mentions: 'massMentions',
        badwords: 'badWords',
        caps: 'caps',
        repeated: 'repeatedMessages'
      };

      if (boolMap[sub]) {

        config.automod[
          boolMap[sub]
        ] =
          interaction.options.getBoolean(
            'enabled'
          );

        saveDatabase();

        return interaction.reply(
          `🛡️ ${sub} is now **${
            config.automod[boolMap[sub]]
              ? 'enabled'
              : 'disabled'
          }**.`
        );
      }

      if (sub === 'logchannel') {

        const channel =
          interaction.options.getChannel(
            'channel'
          );

        config.automod.logChannel =
          channel.id;

        saveDatabase();

        return interaction.reply(
          `📝 AutoMod log channel set to ${channel}.`
        );
      }

      if (sub === 'punishment') {

        config.automod.punishment =
          interaction.options.getString(
            'type'
          );

        saveDatabase();

        return interaction.reply(
          `🛡️ AutoMod punishment set to **${config.automod.punishment}**.`
        );
      }
    }

    /* ================= SECURITY ================= */

    if (
      interaction.commandName ===
      'security'
    ) {

      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content:
            '❌ Staff only.',
          ephemeral: true
        });
      }

      const sub =
        interaction.options.getSubcommand();

      if (sub === 'status') {

        const embed =
          new EmbedBuilder()
            .setTitle('🔐 Security Status')
            .setColor(0x5865F2)
            .addFields(
              {
                name: 'Security',
                value:
                  config.security.enabled
                    ? '🟢 Enabled'
                    : '🔴 Disabled'
              },
              {
                name: 'Anti-Raid',
                value:
                  config.security.antiRaid
                    ? '🟢'
                    : '🔴',
                inline: true
              },
              {
                name: 'Anti-Nuke',
                value:
                  config.security.antiNuke
                    ? '🟢'
                    : '🔴',
                inline: true
              },
              {
                name: 'Role Protection',
                value:
                  config.security.roleProtection
                    ? '🟢'
                    : '🔴',
                inline: true
              }
            );

        return interaction.reply({
          embeds: [embed]
        });
      }

      if (sub === 'enable') {
        config.security.enabled = true;
        saveDatabase();

        return interaction.reply(
          '🔐 Security enabled.'
        );
      }

      if (sub === 'disable') {
        config.security.enabled = false;
        saveDatabase();

        return interaction.reply(
          '🔐 Security disabled.'
        );
      }

      if (sub === 'antiraid') {
        config.security.antiRaid =
          interaction.options.getBoolean(
            'enabled'
          );

        saveDatabase();

        return interaction.reply(
          `🚨 Anti-Raid ${
            config.security.antiRaid
              ? 'enabled'
              : 'disabled'
          }.`
        );
      }

      if (sub === 'antinuke') {
        config.security.antiNuke =
          interaction.options.getBoolean(
            'enabled'
          );

        saveDatabase();

        return interaction.reply(
          `💣 Anti-Nuke ${
            config.security.antiNuke
              ? 'enabled'
              : 'disabled'
          }.`
        );
      }
    }

    /* ================= WARN ================= */

    if (
      interaction.commandName ===
      'warn'
    ) {

      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content:
            '❌ Staff only.',
          ephemeral: true
        });
      }

      const user =
        interaction.options.getUser(
          'user'
        );

      const member =
        await guild.members.fetch(
          user.id
        ).catch(() => null);

      if (!member) {
        return interaction.reply({
          content:
            '❌ Member not found.',
          ephemeral: true
        });
      }

      if (
        !canModerate(
          interaction.member,
          member
        )
      ) {
        return interaction.reply({
          content:
            '❌ You cannot moderate this member.',
          ephemeral: true
        });
      }

      const reason =
        interaction.options.getString(
          'reason'
        ) || 'No reason provided';

      const warning =
        addWarning(
          guild.id,
          user.id,
          interaction.user.id,
          reason
        );

      addPunishment(
        guild.id,
        user.id,
        interaction.user.id,
        'warn',
        reason
      );

      const data =
        getModerationData(guild.id);

      const count =
        data.warnings[user.id].length;

      if (
        config.moderation.warnEscalation
      ) {

        if (
          count >=
          config.moderation.warnBanAt
        ) {
          await punishMember(
            member,
            'ban',
            'Warning escalation'
          );
        } else if (
          count >=
          config.moderation.warnKickAt
        ) {
          await punishMember(
            member,
            'kick',
            'Warning escalation'
          );
        } else if (
          count >=
          config.moderation.warnTimeoutAt
        ) {
          await punishMember(
            member,
            'timeout',
            'Warning escalation',
            3600
          );
        }
      }

      await sendLog(
        guild,
        '⚠️ Member Warned',
        `**User:** ${user.tag}\n` +
        `**Moderator:** ${interaction.user.tag}\n` +
        `**Reason:** ${reason}\n` +
        `**Total warnings:** ${count}`
      );

      await interaction.reply(
        `⚠️ ${user} warned successfully. Total warnings: **${count}**.`
      );

      return;
    }

    /* ================= WARNINGS ================= */

    if (
      interaction.commandName ===
      'warnings'
    ) {

      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content:
            '❌ Staff only.',
          ephemeral: true
        });
      }

      const user =
        interaction.options.getUser(
          'user'
        );

      const data =
        getModerationData(guild.id);

      const warnings =
        data.warnings[user.id] || [];

      if (!warnings.length) {
        return interaction.reply(
          `📋 ${user} has no warnings.`
        );
      }

      const text =
        warnings
          .slice(-10)
          .map(
            (w, i) =>
              `**${i + 1}.** ${w.reason}\n` +
              `Moderator: <@${w.moderatorId}>\n` +
              `Date: ${new Date(w.timestamp).toLocaleString()}`
          )
          .join('\n\n');

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(`📋 Warnings — ${user.tag}`)
            .setDescription(text)
            .setColor(0xFEE75C)
        ]
      });
    }

    /* ================= TIMEOUT ================= */

    if (
      interaction.commandName ===
      'timeout'
    ) {

      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content:
            '❌ Staff only.',
          ephemeral: true
        });
      }

      const user =
        interaction.options.getUser(
          'user'
        );

      const member =
        await guild.members.fetch(
          user.id
        ).catch(() => null);

      if (!member) {
        return interaction.reply(
          '❌ Member not found.'
        );
      }

      if (
        !canModerate(
          interaction.member,
          member
        )
      ) {
        return interaction.reply({
          content:
            '❌ You cannot moderate this member.',
          ephemeral: true
        });
      }

      const minutes =
        interaction.options.getInteger(
          'minutes'
        );

      const reason =
        interaction.options.getString(
          'reason'
        ) || 'No reason provided';

      const success =
        await timeoutMember(
          member,
          minutes * 60,
          reason
        );

      if (!success) {
        return interaction.reply(
          '❌ Unable to timeout this member.'
        );
      }

      addPunishment(
        guild.id,
        user.id,
        interaction.user.id,
        'timeout',
        reason
      );

      await sendLog(
        guild,
        '⏱️ Member Timed Out',
        `**User:** ${user.tag}\n` +
        `**Moderator:** ${interaction.user.tag}\n` +
        `**Duration:** ${minutes} minutes\n` +
        `**Reason:** ${reason}`
      );

      return interaction.reply(
        `⏱️ ${user} timed out for **${minutes} minutes**.`
      );
    }

    /* ================= KICK ================= */

    if (
      interaction.commandName ===
      'kick'
    ) {

      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content:
            '❌ Staff only.',
          ephemeral: true
        });
      }

      const user =
        interaction.options.getUser(
          'user'
        );

      const member =
        await guild.members.fetch(
          user.id
        ).catch(() => null);

      if (!member) {
        return interaction.reply(
          '❌ Member not found.'
        );
      }

      if (
        !canModerate(
          interaction.member,
          member
        )
      ) {
        return interaction.reply({
          content:
            '❌ You cannot kick this member.',
          ephemeral: true
        });
      }

      const reason =
        interaction.options.getString(
          'reason'
        ) || 'No reason provided';

      if (!member.kickable) {
        return interaction.reply(
          '❌ I cannot kick this member.'
        );
      }

      await member.kick(reason);

      addPunishment(
        guild.id,
        user.id,
        interaction.user.id,
        'kick',
        reason
      );

      await sendLog(
        guild,
        '👢 Member Kicked',
        `**User:** ${user.tag}\n` +
        `**Moderator:** ${interaction.user.tag}\n` +
        `**Reason:** ${reason}`
      );

      return interaction.reply(
        `👢 ${user.tag} has been kicked.`
      );
    }

    /* ================= BAN ================= */

    if (
      interaction.commandName ===
      'ban'
    ) {

      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content:
            '❌ Staff only.',
          ephemeral: true
        });
      }

      const user =
        interaction.options.getUser(
          'user'
        );

      const member =
        await guild.members.fetch(
          user.id
        ).catch(() => null);

      if (
        member &&
        !canModerate(
          interaction.member,
          member
        )
      ) {
        return interaction.reply({
          content:
            '❌ You cannot ban this member.',
          ephemeral: true
        });
      }

      const reason =
        interaction.options.getString(
          'reason'
        ) || 'No reason provided';

      try {
        await guild.members.ban(
          user.id,
          { reason }
        );
      } catch {
        return interaction.reply(
          '❌ Unable to ban this user.'
        );
      }

      addPunishment(
        guild.id,
        user.id,
        interaction.user.id,
        'ban',
        reason
      );

      await sendLog(
        guild,
        '🔨 Member Banned',
        `**User:** ${user.tag}\n` +
        `**Moderator:** ${interaction.user.tag}\n` +
        `**Reason:** ${reason}`
      );

      return interaction.reply(
        `🔨 ${user.tag} has been banned.`
      );
    }

    /* ================= UNBAN ================= */

    if (
      interaction.commandName ===
      'unban'
    ) {

      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content:
            '❌ Staff only.',
          ephemeral: true
        });
      }

      const userId =
        interaction.options.getString(
          'userid'
        );

      const reason =
        interaction.options.getString(
          'reason'
        ) || 'No reason provided';

      try {
        await guild.members.unban(
          userId,
          reason
        );
      } catch {
        return interaction.reply(
          '❌ Unable to unban this user.'
        );
      }

      addPunishment(
        guild.id,
        userId,
        interaction.user.id,
        'unban',
        reason
      );

      await sendLog(
        guild,
        '🔓 Member Unbanned',
        `**User ID:** ${userId}\n` +
        `**Moderator:** ${interaction.user.tag}\n` +
        `**Reason:** ${reason}`
      );

      return interaction.reply(
        `🔓 \`${userId}\` has been unbanned.`
      );
    }

    /* ================= PUNISHMENTS ================= */

    if (
      interaction.commandName ===
      'punishments'
    ) {

      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content:
            '❌ Staff only.',
          ephemeral: true
        });
      }

      const user =
        interaction.options.getUser(
          'user'
        );

      const data =
        getModerationData(guild.id);

      const punishments =
        data.punishments[user.id] || [];

      if (!punishments.length) {
        return interaction.reply(
          `📋 ${user} has no punishment history.`
        );
      }

      const text =
        punishments
          .slice(-10)
          .map(
            (p, i) =>
              `**${i + 1}.** ${p.type.toUpperCase()}\n` +
              `Reason: ${p.reason}\n` +
              `Moderator: <@${p.moderatorId}>\n` +
              `Date: ${new Date(p.timestamp).toLocaleString()}`
          )
          .join('\n\n');

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle(
              `📋 Punishments — ${user.tag}`
            )
            .setDescription(text)
            .setColor(0xED4245)
        ]
      });
    }

    /* ================= SUGGEST ================= */

    if (
      interaction.commandName ===
      'suggest'
    ) {

      const suggestion =
        interaction.options.getString(
          'suggestion'
        );

      const id =
        Date.now()
          .toString()
          .slice(-8);

      const embed =
        new EmbedBuilder()
          .setTitle('💡 New Suggestion')
          .setDescription(suggestion)
          .addFields({
            name: 'Submitted by',
            value:
              `${interaction.user}\n\`${interaction.user.id}\``
          })
          .setFooter({
            text: `Suggestion ID: ${id}`
          })
          .setColor(0x5865F2)
          .setTimestamp();

      const row =
        new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder()
              .setCustomId(
                `suggest_approve_${id}`
              )
              .setLabel('Approve')
              .setEmoji('✅')
              .setStyle(ButtonStyle.Success),

            new ButtonBuilder()
              .setCustomId(
                `suggest_decline_${id}`
              )
              .setLabel('Decline')
              .setEmoji('❌')
              .setStyle(ButtonStyle.Danger)
          );

      await interaction.reply({
        embeds: [embed],
        components: [row]
      });

      return;
    }

    /* ================= CONFIG ================= */

    if (
      interaction.commandName ===
      'config'
    ) {

      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content:
            '❌ Staff only.',
          ephemeral: true
        });
      }

      const sub =
        interaction.options.getSubcommand();

      if (sub === 'status') {

        const embed =
          new EmbedBuilder()
            .setTitle('⚙️ Bot Configuration')
            .setColor(0x5865F2)
            .addFields(
              {
                name: 'AutoMod',
                value:
                  config.automod.enabled
                    ? '🟢 Enabled'
                    : '🔴 Disabled'
              },
              {
                name: 'Security',
                value:
                  config.security.enabled
                    ? '🟢 Enabled'
                    : '🔴 Disabled'
              },
              {
                name: 'Anti-Raid',
                value:
                  config.security.antiRaid
                    ? '🟢 Enabled'
                    : '🔴 Disabled'
              },
              {
                name: 'Anti-Nuke',
                value:
                  config.security.antiNuke
                    ? '🟢 Enabled'
                    : '🔴 Disabled'
              },
              {
                name: 'Ticket System',
                value:
                  config.tickets.enabled
                    ? '🟢 Enabled'
                    : '🔴 Disabled'
              },
              {
                name: 'Log Channel',
                value:
                  config.logs.channelId
                    ? `<#${config.logs.channelId}>`
                    : 'Not configured'
              },
              {
                name: 'Support Role',
                value:
                  `<@&${config.tickets.supportRoleId}>`
              }
            );

        return interaction.reply({
          embeds: [embed]
        });
      }

      if (sub === 'logs') {

        const channel =
          interaction.options.getChannel(
            'channel'
          );

        config.logs.channelId =
          channel.id;

        saveDatabase();

        return interaction.reply(
          `📝 General log channel set to ${channel}.`
        );
      }

      if (sub === 'support-role') {

        const role =
          interaction.options.getRole(
            'role'
          );

        config.tickets.supportRoleId =
          role.id;

        saveDatabase();

        return interaction.reply(
          `🎫 Support role set to ${role}.`
        );
      }
    }

    /* ================= TRUST ================= */

    if (
      interaction.commandName ===
      'trust'
    ) {

      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content:
            '❌ Staff only.',
          ephemeral: true
        });
      }

      const sub =
        interaction.options.getSubcommand();

      if (sub === 'user-add') {

        const user =
          interaction.options.getUser(
            'user'
          );

        if (
          !config.security.trustedUsers.includes(
            user.id
          )
        ) {
          config.security.trustedUsers.push(
            user.id
          );
        }

        saveDatabase();

        return interaction.reply(
          `🤝 ${user} added to trusted users.`
        );
      }

      if (sub === 'user-remove') {

        const user =
          interaction.options.getUser(
            'user'
          );

        config.security.trustedUsers =
          config.security.trustedUsers.filter(
            id => id !== user.id
          );

        saveDatabase();

        return interaction.reply(
          `🤝 ${user} removed from trusted users.`
        );
      }

      if (sub === 'bot-add') {

        const bot =
          interaction.options.getUser(
            'bot'
          );

        if (!bot.bot) {
          return interaction.reply(
            '❌ That user is not a bot.'
          );
        }

        if (
          !config.security.trustedBots.includes(
            bot.id
          )
        ) {
          config.security.trustedBots.push(
            bot.id
          );
        }

        saveDatabase();

        return interaction.reply(
          `🤖 ${bot} added to trusted bots.`
        );
      }

      if (sub === 'bot-remove') {

        const bot =
          interaction.options.getUser(
            'bot'
          );

        config.security.trustedBots =
          config.security.trustedBots.filter(
            id => id !== bot.id
          );

        saveDatabase();

        return interaction.reply(
          `🤖 ${bot} removed from trusted bots.`
        );
      }

      if (sub === 'list') {

        const users =
          config.security.trustedUsers.length
            ? config.security.trustedUsers
                .map(id => `<@${id}>`)
                .join('\n')
            : 'None';

        const bots =
          config.security.trustedBots.length
            ? config.security.trustedBots
                .map(id => `<@${id}>`)
                .join('\n')
            : 'None';

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle('🤝 Trusted Security List')
              .addFields(
                {
                  name: 'Trusted Users',
                  value: users
                },
                {
                  name: 'Trusted Bots',
                  value: bots
                }
              )
              .setColor(0x57F287)
          ]
        });
      }
    }

    /* ================= ROLE PROTECT ================= */

    if (
      interaction.commandName ===
      'role-protect'
    ) {

      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content:
            '❌ Staff only.',
          ephemeral: true
        });
      }

      const sub =
        interaction.options.getSubcommand();

      if (sub === 'add') {

        const role =
          interaction.options.getRole(
            'role'
          );

        if (
          !config.security.protectedRoles.includes(
            role.id
          )
        ) {
          config.security.protectedRoles.push(
            role.id
          );
        }

        saveDatabase();

        return interaction.reply(
          `🛡️ ${role} is now protected.`
        );
      }

      if (sub === 'remove') {

        const role =
          interaction.options.getRole(
            'role'
          );

        config.security.protectedRoles =
          config.security.protectedRoles.filter(
            id => id !== role.id
          );

        saveDatabase();

        return interaction.reply(
          `🛡️ ${role} removed from protected roles.`
        );
      }

      if (sub === 'list') {

        const roles =
          config.security.protectedRoles.length
            ? config.security.protectedRoles
                .map(id => `<@&${id}>`)
                .join('\n')
            : 'None';

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle('🛡️ Protected Roles')
              .setDescription(roles)
              .addFields({
                name: '@everyone Protection',
                value:
                  config.security.protectEveryone
                    ? '🟢 Enabled'
                    : '🔴 Disabled'
              })
              .setColor(0x5865F2)
          ]
        });
      }

      if (sub === 'everyone') {

        config.security.protectEveryone =
          interaction.options.getBoolean(
            'enabled'
          );

        saveDatabase();

        return interaction.reply(
          `🛡️ @everyone protection ${
            config.security.protectEveryone
              ? 'enabled'
              : 'disabled'
          }.`
        );
      }
    }

    /* ================= AUTOTIMEOUT ================= */

    if (
      interaction.commandName ===
      'autotimeout'
    ) {

      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content:
            '❌ Staff only.',
          ephemeral: true
        });
      }

      const sub =
        interaction.options.getSubcommand();

      if (sub === 'status') {

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle('⏱️ Auto-Timeout Configuration')
              .addFields(
                {
                  name: 'Default',
                  value:
                    `${config.automod.timeoutSeconds}s`
                },
                {
                  name: 'Raid',
                  value:
                    `${config.security.raidTimeout ? config.automod.timeoutSeconds : 0}s`
                }
              )
              .setColor(0x5865F2)
          ]
        });
      }

      if (sub === 'set') {

        config.automod.timeoutSeconds =
          interaction.options.getInteger(
            'seconds'
          );

        saveDatabase();

        return interaction.reply(
          `⏱️ Default AutoMod timeout set to **${config.automod.timeoutSeconds} seconds**.`
        );
      }

      if (sub === 'spam') {

        config.automod.timeoutSeconds =
          interaction.options.getInteger(
            'seconds'
          );

        saveDatabase();

        return interaction.reply(
          `⏱️ Spam timeout set to **${config.automod.timeoutSeconds} seconds**.`
        );
      }

      if (sub === 'raid') {

        config.security.raidTimeoutSeconds =
          interaction.options.getInteger(
            'seconds'
          );

        saveDatabase();

        return interaction.reply(
          `🚨 Raid timeout set to **${config.security.raidTimeoutSeconds} seconds**.`
        );
      }
    }

    /* ================= ANNOUNCEMENTS ================= */

    if (
      interaction.commandName ===
      'announcement'
    ) {

      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content:
            '❌ Staff only.',
          ephemeral: true
        });
      }

      const sub =
        interaction.options.getSubcommand();

      if (sub === 'send') {

        const channel =
          interaction.options.getChannel(
            'channel'
          );

        const title =
          interaction.options.getString(
            'title'
          );

        const message =
          interaction.options.getString(
            'message'
          );

        const image =
          interaction.options.getString(
            'image'
          );

        const mention =
          interaction.options.getString(
            'mention'
          ) || 'none';

        const embed =
          new EmbedBuilder()
            .setTitle(title)
            .setDescription(message)
            .setColor(0x5865F2)
            .setFooter({
              text:
                `Announcement • ${guild.name}`
            })
            .setTimestamp();

        if (image) {
          embed.setImage(image);
        }

        let content;

        if (mention === 'everyone') {
          content = '@everyone';
        }

        if (mention === 'here') {
          content = '@here';
        }

        await channel.send({
          content,
          embeds: [embed],
          allowedMentions:
            mention === 'none'
              ? { parse: [] }
              : { parse: [mention] }
        });

        return interaction.reply({
          content:
            `📢 Announcement sent to ${channel}.`,
          ephemeral: true
        });
      }

      if (sub === 'channel-add') {

        const channel =
          interaction.options.getChannel(
            'channel'
          );

        if (
          !config.announcements.channels.includes(
            channel.id
          )
        ) {
          config.announcements.channels.push(
            channel.id
          );
        }

        saveDatabase();

        return interaction.reply(
          `📢 ${channel} added to announcement channels.`
        );
      }

      if (sub === 'channel-remove') {

        const channel =
          interaction.options.getChannel(
            'channel'
          );

        config.announcements.channels =
          config.announcements.channels.filter(
            id => id !== channel.id
          );

        saveDatabase();

        return interaction.reply(
          `📢 ${channel} removed from announcement channels.`
        );
      }

      if (sub === 'channels') {

        const channels =
          config.announcements.channels.length
            ? config.announcements.channels
                .map(id => `<#${id}>`)
                .join('\n')
            : 'No configured channels.';

        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle(
                '📢 Announcement Channels'
              )
              .setDescription(channels)
              .setColor(0x5865F2)
          ]
        });
      }
    }

    /* ================= AUDIT ================= */

    if (
      interaction.commandName ===
      'audit'
    ) {

      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content:
            '❌ Staff only.',
          ephemeral: true
        });
      }

      const limit =
        interaction.options.getInteger(
          'limit'
        ) || 10;

      const logs =
        await guild.fetchAuditLogs({
          limit
        }).catch(() => null);

      if (!logs) {
        return interaction.reply(
          '❌ Unable to read audit logs.'
        );
      }

      const text =
        logs.entries
          .map(
            entry =>
              `**${entry.action}** — ` +
              `${entry.executor?.tag || entry.executor?.id || 'Unknown'}\n` +
              `Target: ${entry.target?.id || 'Unknown'}`
          )
          .join('\n\n')
          .slice(0, 3900);

      return interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setTitle('🧾 Recent Audit Log')
            .setDescription(
              text || 'No entries found.'
            )
            .setColor(0x5865F2)
        ]
      });
    }

    /* ================= HELP ================= */

    if (
      interaction.commandName ===
      'help'
    ) {

      const embed =
        new EmbedBuilder()
          .setTitle('🤖 Bot Command Center')
          .setDescription(
            'Complete command list'
          )
          .setColor(0x5865F2)
          .addFields(
            {
              name: '🎫 Tickets',
              value:
                '`/ticket`\n`/close-ticket`'
            },
            {
              name: '🛡️ AutoMod',
              value:
                '`/automod enable`\n' +
                '`/automod disable`\n' +
                '`/automod status`\n' +
                '`/automod logchannel`\n' +
                '`/automod invites`\n' +
                '`/automod spam`\n' +
                '`/automod mentions`\n' +
                '`/automod badwords`\n' +
                '`/automod caps`\n' +
                '`/automod repeated`\n' +
                '`/automod punishment`'
            },
            {
              name: '🔐 Security',
              value:
                '`/security status`\n' +
                '`/security enable`\n' +
                '`/security disable`\n' +
                '`/security antiraid`\n' +
                '`/security antinuke`'
            },
            {
              name: '⚖️ Moderation',
              value:
                '`/warn`\n' +
                '`/warnings`\n' +
                '`/timeout`\n' +
                '`/kick`\n' +
                '`/ban`\n' +
                '`/unban`\n' +
                '`/punishments`'
            },
            {
              name: '🛡️ Protection',
              value:
                '`/role-protect add`\n' +
                '`/role-protect remove`\n' +
                '`/role-protect list`\n' +
                '`/role-protect everyone`\n' +
                '`/trust user-add`\n' +
                '`/trust user-remove`\n' +
                '`/trust bot-add`\n' +
                '`/trust bot-remove`\n' +
                '`/trust list`'
            },
            {
              name: '📢 Announcements',
              value:
                '`/announcement send`\n' +
                '`/announcement channel-add`\n' +
                '`/announcement channel-remove`\n' +
                '`/announcement channels`'
            },
            {
              name: '⚙️ Configuration',
              value:
                '`/config status`\n' +
                '`/config logs`\n' +
                '`/config support-role`\n' +
                '`/autotimeout status`\n' +
                '`/autotimeout set`\n' +
                '`/autotimeout spam`\n' +
                '`/autotimeout raid`'
            },
            {
              name: '💡 Community',
              value:
                '`/suggest`'
            },
            {
              name: '🧾 Logs',
              value:
                '`/audit`'
            }
          );

      return interaction.reply({
        embeds: [embed]
      });
    }

  } catch (error) {

    console.error(
      'Interaction error:',
      error
    );

    if (!interaction.replied &&
        !interaction.deferred) {

      await interaction.reply({
        content:
          '❌ An internal error occurred.',
        ephemeral: true
      }).catch(() => {});
    }
  }
});

/* =========================================================
   MESSAGE EVENTS
========================================================= */

client.on('messageCreate', async message => {

  try {

    if (!message.guild) {

      if (
        message.author.bot
      ) {
        return;
      }

      await createTicketFromDM(
        message
      );

      return;
    }

    await relayTicketMessage(
      message
    );

    await handleAutoMod(
      message
    );

  } catch (error) {
    console.error(
      'Message event error:',
      error
    );
  }
});

/* =========================================================
   MEMBER JOIN
========================================================= */

client.on('guildMemberAdd', async member => {

  try {
    if (
      member.guild.id !==
      GUILD_ID
    ) {
      return;
    }

    await handleAntiRaid(
      member
    );

  } catch (error) {
    console.error(
      'Member join error:',
      error
    );
  }
});

/* =========================================================
   ROLE EVENTS
========================================================= */

client.on(
  'roleUpdate',
  async (oldRole, newRole) => {
    await handleRoleUpdate(
      oldRole,
      newRole
    ).catch(console.error);
  }
);

client.on(
  'roleCreate',
  async role => {
    await handleRoleCreate(
      role
    ).catch(console.error);
  }
);

/* =========================================================
   CHANNEL EVENTS
========================================================= */

client.on(
  'channelCreate',
  async channel => {
    await handleChannelCreate(
      channel
    ).catch(console.error);
  }
);

client.on(
  'channelDelete',
  async channel => {
    await handleChannelDelete(
      channel
    ).catch(console.error);
  }
);

/* =========================================================
   ERROR HANDLING
========================================================= */

client.on(
  'error',
  error => {
    console.error(
      'Discord client error:',
      error
    );
  }
);

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

/* =========================================================
   LOGIN
========================================================= */

client.login(TOKEN);
