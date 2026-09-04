'use strict';

/*
===========================================================
                     AKIYO DISCORD BOT
===========================================================

Version: 8.0.0
discord.js: 14.27.0
Node.js: 20+

SYSTEMS
-----------------------------------------------------------
✓ Multi-server / per-guild configuration
✓ Persistent JSON database
✓ Support tickets
✓ Ticket panel
✓ Ticket claim / unclaim
✓ Ticket close / reopen / delete
✓ Ticket lock / unlock
✓ Ticket add / remove
✓ Ticket rename / info / stats
✓ Ticket transcripts
✓ DM support system
✓ AutoMod
✓ Bad words
✓ Caps protection
✓ Repeated-message protection
✓ Spam/flood protection
✓ Discord invite protection
✓ Mass mention protection
✓ Warning system
✓ Punishment history
✓ Warning escalation
✓ Timeout / kick / ban / unban
✓ Suggestions
✓ Suggestion approve / decline
✓ Security / Anti-Raid
✓ Anti-Nuke
✓ Anti-webhook
✓ Anti-bot protection
✓ Protected roles
✓ Protected channels
✓ Trusted users
✓ Trusted bots
✓ Trusted role
✓ Audit logging
✓ Welcome system
✓ Autorole
✓ Verification
✓ Reaction roles
✓ Leaderboard
✓ Announcements
✓ Ads system
✓ AI system
✓ Configuration system
✓ Error handling
✓ Render/Bot-Hosting HTTP server
===========================================================
*/

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
    AttachmentBuilder,
    AuditLogEvent,
    Events
} = require('discord.js');

/* =========================================================
   ENVIRONMENT
========================================================= */

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID || '1542750606739898428';
const OWNER_IDS = (process.env.BOT_OWNER_IDS || '')
    .split(',')
    .map(x => x.trim())
    .filter(Boolean);

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5.5';

if (!TOKEN) {
    console.error('❌ Missing DISCORD_TOKEN environment variable.');
    process.exit(1);
}

/* =========================================================
   HTTP SERVER
========================================================= */

const PORT = Number(process.env.PORT) || 10000;

http.createServer((req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/plain; charset=utf-8'
    });

    res.end('AkiyO Bot Online');
}).listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 HTTP server running on port ${PORT}`);
});

/* =========================================================
   DISCORD CLIENT
========================================================= */

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

/* =========================================================
   DATABASE
========================================================= */

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'config.json');

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
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

const DEFAULT_CONFIG = {
    global: {
        createdAt: Date.now()
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

        action: 'alert',

        trustedUsers: [],
        trustedBots: [],

        trustedRoleId: null,

        protectedRoles: [],
        protectedChannels: []
    },

    guilds: {}
};

function defaultGuild() {
    return {
        staffRoleId: null,

        support: {
            categoryId: null,
            supportRoleId: null
        },

        tickets: {
            enabled: true,
            counter: 0,
            records: {}
        },

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

        logs: Object.fromEntries(
            LOG_TYPES.map(type => [type, null])
        ),

        warnings: {},
        punishments: {},

        suggestions: {
            channelId: null,
            records: {}
        },

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

        leaderboard: {
            enabled: true,
            messages: {}
        },

        ads: {
            enabled: false,
            channelId: null,
            message: 'AkiyO announcement.',
            intervalMinutes: 60
        }
    };
}

function mergeObjects(base, extra) {
    for (const key of Object.keys(extra || {})) {
        if (
            extra[key] &&
            typeof extra[key] === 'object' &&
            !Array.isArray(extra[key])
        ) {
            base[key] = mergeObjects(base[key] || {}, extra[key]);
        } else if (extra[key] !== undefined) {
            base[key] = extra[key];
        }
    }

    return base;
}

let database = {};

try {
    if (fs.existsSync(DATA_FILE)) {
        database = JSON.parse(
            fs.readFileSync(DATA_FILE, 'utf8')
        );
    }
} catch (error) {
    console.error('❌ Database read error:', error);
    database = {};
}

database = mergeObjects(
    JSON.parse(JSON.stringify(DEFAULT_CONFIG)),
    database
);

function getGuildConfig(guild) {
    if (!guild) return null;

    if (!database.guilds[guild.id]) {
        database.guilds[guild.id] = defaultGuild();
        saveDatabase();
    }

    database.guilds[guild.id] = mergeObjects(
        defaultGuild(),
        database.guilds[guild.id]
    );

    return database.guilds[guild.id];
}

function saveDatabase() {
    try {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(database, null, 2)
        );
    } catch (error) {
        console.error('❌ Database save error:', error);
    }
}

/* =========================================================
   MEMORY
========================================================= */

const spamTracker = new Map();
const repeatTracker = new Map();
const raidTracker = new Map();
const securityActions = new Map();
const aiHistory = new Map();

/* =========================================================
   HELPERS
========================================================= */

function isGuildInteraction(interaction) {
    return Boolean(interaction.guild);
}

function isOwner(userId) {
    return OWNER_IDS.includes(userId);
}

async function isApplicationOwner(userId) {
    if (isOwner(userId)) return true;

    try {
        const app = await client.application?.fetch();
        return app?.owner?.id === userId;
    } catch {
        return false;
    }
}

function isManager(member) {
    if (!member) return false;

    return (
        member.permissions.has(PermissionFlagsBits.Administrator) ||
        member.permissions.has(PermissionFlagsBits.ManageGuild)
    );
}

function isStaff(member) {
    if (!member) return false;

    const config = getGuildConfig(member.guild);

    return (
        member.permissions.has(PermissionFlagsBits.Administrator) ||
        (
            config.staffRoleId &&
            member.roles.cache.has(config.staffRoleId)
        ) ||
        (
            config.support.supportRoleId &&
            member.roles.cache.has(config.support.supportRoleId)
        )
    );
}

function isTrusted(guild, userId) {
    if (!guild) return false;

    const config = getGuildConfig(guild);
    const member = guild.members.cache.get(userId);

    if (
        member?.permissions.has(
            PermissionFlagsBits.Administrator
        )
    ) {
        return true;
    }

    if (
        database.security.trustedUsers.includes(userId) ||
        database.security.trustedBots.includes(userId)
    ) {
        return true;
    }

    if (
        config.security?.trustedUsers?.includes(userId) ||
        config.security?.trustedBots?.includes(userId)
    ) {
        return true;
    }

    if (
        config.security?.trustedRoleId &&
        member?.roles.cache.has(
            config.security.trustedRoleId
        )
    ) {
        return true;
    }

    return false;
}

function canManageTarget(executor, target) {
    if (!executor || !target) return false;

    if (executor.id === target.id) return false;

    if (target.id === target.guild.ownerId) return false;

    if (
        executor.id !== target.guild.ownerId &&
        target.roles.highest.position >=
        executor.roles.highest.position
    ) {
        return false;
    }

    return true;
}

function parseDuration(input) {
    if (!input) return null;

    const match = String(input)
        .trim()
        .toLowerCase()
        .match(/^(\d+)\s*(s|m|h|d)$/);

    if (!match) return null;

    const amount = Number(match[1]);
    const unit = match[2];

    const multipliers = {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000
    };

    const duration = amount * multipliers[unit];

    if (duration <= 0 || duration > 28 * 24 * 60 * 60 * 1000) {
        return null;
    }

    return duration;
}

function percentCaps(text) {
    const letters = text.match(/[A-Za-z]/g);

    if (!letters || letters.length < 5) {
        return 0;
    }

    const upper = letters.filter(
        x => x === x.toUpperCase()
    ).length;

    return Math.round(
        (upper / letters.length) * 100
    );
}

function escapeRegex(text) {
    return String(text).replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
    );
}

function replaceWelcome(text, member) {
    return String(text)
        .replaceAll('{user}', `<@${member.id}>`)
        .replaceAll('{username}', member.user.username)
        .replaceAll('{server}', member.guild.name)
        .replaceAll(
            '{count}',
            String(member.guild.memberCount)
        );
}

function reactionKey(reaction) {
    return reaction.emoji.id ||
        reaction.emoji.name ||
        null;
}

function normalizeEmoji(raw) {
    const custom = String(raw).match(
        /^<a?:[^:>]+:(\d+)>$/
    );

    return custom ? custom[1] : String(raw);
}

function field(name, value, inline = false) {
    return {
        name: String(name).slice(0, 256),
        value: String(value || '-').slice(0, 1024),
        inline
    };
}

/* =========================================================
   LOGGING
========================================================= */

async function sendLog(
    guild,
    type,
    title,
    fields = [],
    color
) {
    try {
        if (!guild) return;

        const config = getGuildConfig(guild);
        const channelId = config.logs[type];

        if (!channelId) return;

        const channel =
            await guild.channels.fetch(channelId)
                .catch(() => null);

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

        await channel.send({
            embeds: [embed]
        }).catch(() => {});
    } catch (error) {
        console.error('Log error:', error);
    }
}

/* =========================================================
   MODERATION DATABASE
========================================================= */

function addPunishment(
    guild,
    userId,
    type,
    reason,
    moderatorId,
    duration = null
) {
    const config = getGuildConfig(guild);

    config.punishments[userId] ??= [];

    config.punishments[userId].push({
        type,
        reason,
        moderatorId,
        duration,
        timestamp: Date.now()
    });

    if (
        config.punishments[userId].length > 100
    ) {
        config.punishments[userId] =
            config.punishments[userId].slice(-100);
    }

    saveDatabase();
}

async function addWarning(
    member,
    moderator,
    reason
) {
    const config = getGuildConfig(member.guild);

    config.warnings[member.id] ??= [];

    config.warnings[member.id].push({
        reason,
        moderatorId: moderator.id,
        timestamp: Date.now()
    });

    addPunishment(
        member.guild,
        member.id,
        'warn',
        reason,
        moderator.id
    );

    const count =
        config.warnings[member.id].length;

    if (count >= 7) {
        if (canManageTarget(moderator, member)) {
            await member.ban({
                reason: `Warning escalation: ${count} warnings`
            }).catch(() => {});
        }

        addPunishment(
            member.guild,
            member.id,
            'ban',
            `Warning escalation: ${count} warnings`,
            moderator.id
        );

        return {
            count,
            escalation: 'ban'
        };
    }

    if (count >= 5) {
        if (canManageTarget(moderator, member)) {
            await member.kick(
                `Warning escalation: ${count} warnings`
            ).catch(() => {});
        }

        addPunishment(
            member.guild,
            member.id,
            'kick',
            `Warning escalation: ${count} warnings`,
            moderator.id
        );

        return {
            count,
            escalation: 'kick'
        };
    }

    if (count >= 3) {
        if (canManageTarget(moderator, member)) {
            await member.timeout(
                10 * 60 * 1000,
                `Warning escalation: ${count} warnings`
            ).catch(() => {});
        }

        addPunishment(
            member.guild,
            member.id,
            'timeout',
            `Warning escalation: ${count} warnings`,
            moderator.id,
            600000
        );

        return {
            count,
            escalation: '10 minute timeout'
        };
    }

    saveDatabase();

    return {
        count,
        escalation: null
    };
}

/* =========================================================
   TICKET HELPERS
========================================================= */

function getTicketByChannel(guild, channelId) {
    const config = getGuildConfig(guild);

    return Object.values(
        config.tickets.records
    ).find(
        ticket => ticket.channelId === channelId
    );
}

function getActiveTicket(guild, userId) {
    const config = getGuildConfig(guild);

    return Object.values(
        config.tickets.records
    ).find(
        ticket =>
            ticket.ownerId === userId &&
            ticket.status !== 'deleted'
    );
}

function getTicket(guild, ticketId) {
    const config = getGuildConfig(guild);

    return config.tickets.records[String(ticketId)];
}

function ticketButtons(ticket) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`ticket_claim_${ticket.id}`)
            .setLabel('Claim')
            .setStyle(ButtonStyle.Primary),

        new ButtonBuilder()
            .setCustomId(`ticket_close_${ticket.id}`)
            .setLabel('Close')
            .setStyle(ButtonStyle.Danger),

        new ButtonBuilder()
            .setCustomId(`ticket_lock_${ticket.id}`)
            .setLabel('Lock')
            .setStyle(ButtonStyle.Secondary),

        new ButtonBuilder()
            .setCustomId(`ticket_transcript_${ticket.id}`)
            .setLabel('Transcript')
            .setStyle(ButtonStyle.Secondary)
    );
}

async function createTicket(guild, user) {
    const config = getGuildConfig(guild);

    const existing =
        getActiveTicket(guild, user.id);

    if (existing) {
        return {
            error: 'You already have an active ticket.'
        };
    }

    config.tickets.counter++;

    const id = config.tickets.counter;

    const category =
        config.support.categoryId
            ? await guild.channels.fetch(
                config.support.categoryId
            ).catch(() => null)
            : null;

    const permissionOverwrites = [
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

    const staffRole =
        config.support.supportRoleId ||
        config.staffRoleId;

    if (staffRole) {
        permissionOverwrites.push({
            id: staffRole,
            allow: [
                'ViewChannel',
                'SendMessages',
                'ReadMessageHistory',
                'AttachFiles',
                'ManageMessages'
            ]
        });
    }

    let channel;

    try {
        channel = await guild.channels.create({
            name: `ticket-${id}`,
            type: ChannelType.GuildText,
            parent:
                category?.type === ChannelType.GuildCategory
                    ? category.id
                    : undefined,
            permissionOverwrites
        });
    } catch (error) {
        console.error('Ticket create error:', error);

        return {
            error:
                'I could not create the ticket. Check my Manage Channels permission and ticket configuration.'
        };
    }

    const ticket = {
        id,
        guildId: guild.id,
        channelId: channel.id,
        ownerId: user.id,
        ownerTag: user.tag,
        status: 'open',
        claimedBy: null,
        locked: false,
        createdAt: Date.now(),
        closedAt: null
    };

    config.tickets.records[String(id)] =
        ticket;

    saveDatabase();

    const embed = new EmbedBuilder()
        .setTitle(`🎫 Support Ticket #${id}`)
        .setDescription(
            `Welcome <@${user.id}>!\n\n` +
            `Please explain your issue and our support team will assist you.`
        )
        .addFields(
            field('Status', '🟢 Open', true),
            field('User', `<@${user.id}>`, true)
        )
        .setTimestamp();

    await channel.send({
        content: staffRole
            ? `<@&${staffRole}>`
            : undefined,
        embeds: [embed],
        components: [
            ticketButtons(ticket)
        ],
        allowedMentions: {
            roles: staffRole ? [staffRole] : []
        }
    });

    await sendLog(
        guild,
        'tickets',
        '🎫 Ticket Created',
        [
            field('Ticket', `#${id}`),
            field('User', `${user.tag} (${user.id})`),
            field('Channel', `${channel}`)
        ]
    );

    try {
        await user.send(
            `🎫 Your AkiyO support ticket has been created in **${guild.name}**: ${channel}`
        );
    } catch {}

    return {
        ticket,
        channel
    };
}

/* =========================================================
   AUTOMOD
========================================================= */

async function performAutoMod(
    message,
    type,
    reason
) {
    const config = getGuildConfig(
        message.guild
    );

    const action =
        config.automod.actions[type] ||
        'delete';

    try {
        if (
            action === 'delete' ||
            action === 'timeout' ||
            action === 'warn'
        ) {
            await message.delete().catch(() => {});
        }

        const member =
            message.member ||
            await message.guild.members
                .fetch(message.author.id)
                .catch(() => null);

        if (!member) return;

        if (
            action === 'timeout' &&
            !member.permissions.has(
                PermissionFlagsBits.Administrator
            )
        ) {
            const seconds =
                config.automod.timeoutSeconds[type] ||
                60;

            await member.timeout(
                seconds * 1000,
                `AkiyO AutoMod: ${reason}`
            ).catch(() => {});

            addPunishment(
                message.guild,
                member.id,
                'automod-timeout',
                reason,
                client.user.id,
                seconds * 1000
            );
        }

        if (action === 'warn') {
            await addWarning(
                member,
                client.user,
                `AutoMod: ${reason}`
            );
        }

        await sendLog(
            message.guild,
            'automod',
            '🛡️ AutoMod Action',
            [
                field('User', `${message.author.tag}`),
                field('Reason', reason),
                field('Action', action)
            ]
        );
    } catch (error) {
        console.error('AutoMod error:', error);
    }
}

async function handleAutoMod(message) {
    if (!message.guild) return;
    if (message.author.bot) return;

    const config = getGuildConfig(
        message.guild
    );

    if (!config.automod.enabled) return;

    if (isStaff(message.member)) return;

    const content = message.content || '';

    const lower = content.toLowerCase();

    if (
        config.automod.invite &&
        /(?:discord\.gg\/|discord(?:app)?\.com\/invite\/)/i
            .test(content)
    ) {
        return performAutoMod(
            message,
            'invite',
            'Discord invite link'
        );
    }

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
        return performAutoMod(
            message,
            'massmention',
            'Mass mention'
        );
    }

    if (
        config.automod.badWords.length
    ) {
        for (const word of config.automod.badWords) {
            if (
                word &&
                new RegExp(
                    `\\b${escapeRegex(word)}\\b`,
                    'i'
                ).test(lower)
            ) {
                return performAutoMod(
                    message,
                    'badword',
                    'Prohibited word'
                );
            }
        }
    }

    if (
        percentCaps(content) >=
        config.automod.capsPercent
    ) {
        return performAutoMod(
            message,
            'caps',
            'Excessive capital letters'
        );
    }

    const userKey =
        `${message.guild.id}:${message.author.id}`;

    const now = Date.now();

    let spam =
        spamTracker.get(userKey) || [];

    spam = spam.filter(
        timestamp =>
            now - timestamp <
            config.automod.spamWindow
    );

    spam.push(now);

    spamTracker.set(
        userKey,
        spam
    );

    if (
        spam.length >=
        config.automod.spamLimit
    ) {
        spamTracker.delete(userKey);

        return performAutoMod(
            message,
            'spam',
            'Spam/flood detected'
        );
    }

    let repeated =
        repeatTracker.get(userKey) || [];

    repeated = repeated.filter(
        item =>
            now - item.time < 30000
    );

    repeated.push({
        content: lower,
        time: now
    });

    repeatTracker.set(
        userKey,
        repeated
    );

    const sameCount =
        repeated.filter(
            item => item.content === lower
        ).length;

    if (
        sameCount >=
        config.automod.repeatedLimit
    ) {
        repeatTracker.delete(userKey);

        return performAutoMod(
            message,
            'repeat',
            'Repeated messages'
        );
    }
}

/* =========================================================
   SECURITY
========================================================= */

async function securityAction(
    guild,
    executorId,
    action,
    targetId,
    reason
) {
    const config = getGuildConfig(guild);

    if (!config.security.enabled) return;

    if (isTrusted(guild, executorId)) {
        return;
    }

    const member =
        await guild.members.fetch(
            executorId
        ).catch(() => null);

    if (
        member?.permissions.has(
            PermissionFlagsBits.Administrator
        )
    ) {
        return;
    }

    await sendLog(
        guild,
        'security',
        '🚨 Security Alert',
        [
            field('Executor', `<@${executorId}>`),
            field('Action', action),
            field('Target', targetId || 'Unknown'),
            field('Reason', reason)
        ]
    );

    const securityMode =
        config.security.action;

    if (securityMode === 'ban') {
        if (
            member &&
            member.id !== guild.ownerId &&
            canManageTarget(
                guild.members.me,
                member
            )
        ) {
            await member.ban({
                reason:
                    `AkiyO Anti-Nuke: ${reason}`
            }).catch(() => {});
        }
    }

    if (securityMode === 'kick') {
        if (
            member &&
            member.id !== guild.ownerId &&
            canManageTarget(
                guild.members.me,
                member
            )
        ) {
            await member.kick(
                `AkiyO Security: ${reason}`
            ).catch(() => {});
        }
    }
}

function securityCounter(
    guildId,
    executorId,
    action,
    threshold
) {
    const key =
        `${guildId}:${executorId}:${action}`;

    const now = Date.now();

    let data =
        securityActions.get(key) || {
            count: 0,
            first: now
        };

    if (
        now - data.first >
        30000
    ) {
        data = {
            count: 0,
            first: now
        };
    }

    data.count++;

    securityActions.set(
        key,
        data
    );

    return data.count >= threshold;
}

/* =========================================================
   SLASH COMMAND BUILDERS
========================================================= */

const commands = [

    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all AkiyO commands'),

    new SlashCommandBuilder()
        .setName('botinfo')
        .setDescription('Show bot information'),

    /* TICKETS */

    new SlashCommandBuilder()
        .setName('ticket')
        .setDescription('Create a support ticket'),

    new SlashCommandBuilder()
        .setName('ticketpanel')
        .setDescription('Send a ticket panel'),

    new SlashCommandBuilder()
        .setName('ticketsetup')
        .setDescription('Configure ticket system')
        .addChannelOption(o =>
            o.setName('category')
                .setDescription('Ticket category')
                .addChannelTypes(
                    ChannelType.GuildCategory
                )
                .setRequired(false)
        )
        .addRoleOption(o =>
            o.setName('staffrole')
                .setDescription('Ticket staff role')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('close')
        .setDescription('Close the current ticket'),

    new SlashCommandBuilder()
        .setName('reopen')
        .setDescription('Reopen a ticket'),

    new SlashCommandBuilder()
        .setName('delete')
        .setDescription('Delete a ticket'),

    new SlashCommandBuilder()
        .setName('claim')
        .setDescription('Claim a ticket'),

    new SlashCommandBuilder()
        .setName('unclaim')
        .setDescription('Unclaim a ticket'),

    new SlashCommandBuilder()
        .setName('lock')
        .setDescription('Lock a ticket'),

    new SlashCommandBuilder()
        .setName('unlock')
        .setDescription('Unlock a ticket'),

    new SlashCommandBuilder()
        .setName('ticketadd')
        .setDescription('Add a member to ticket')
        .addUserOption(o =>
            o.setName('user')
                .setDescription('User')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('ticketremove')
        .setDescription('Remove a member from ticket')
        .addUserOption(o =>
            o.setName('user')
                .setDescription('User')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('ticketrename')
        .setDescription('Rename current ticket')
        .addStringOption(o =>
            o.setName('name')
                .setDescription('New name')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('ticketinfo')
        .setDescription('Show ticket information'),

    new SlashCommandBuilder()
        .setName('ticketstats')
        .setDescription('Show ticket statistics'),

    new SlashCommandBuilder()
        .setName('transcript')
        .setDescription('Create a ticket transcript'),

    /* AUTOMOD */

    new SlashCommandBuilder()
        .setName('automod')
        .setDescription('Configure AutoMod')
        .addSubcommand(s =>
            s.setName('enable')
                .setDescription('Enable AutoMod')
        )
        .addSubcommand(s =>
            s.setName('disable')
                .setDescription('Disable AutoMod')
        )
        .addSubcommand(s =>
            s.setName('status')
                .setDescription('View AutoMod status')
        )
        .addSubcommand(s =>
            s.setName('config')
                .setDescription('Configure AutoMod')
                .addStringOption(o =>
                    o.setName('setting')
                        .setDescription('Setting')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Spam Limit', value: 'spamLimit' },
                            { name: 'Spam Window', value: 'spamWindow' },
                            { name: 'Repeated Limit', value: 'repeatedLimit' },
                            { name: 'Caps Percent', value: 'capsPercent' },
                            { name: 'Invite Protection', value: 'invite' },
                            { name: 'Mass Mention', value: 'massMentions' }
                        )
                )
                .addStringOption(o =>
                    o.setName('value')
                        .setDescription('Value')
                        .setRequired(true)
                )
        )
        .addSubcommand(s =>
            s.setName('badword')
                .setDescription('Add bad word')
                .addStringOption(o =>
                    o.setName('word')
                        .setDescription('Word')
                        .setRequired(true)
                )
        )
        .addSubcommand(s =>
            s.setName('removebadword')
                .setDescription('Remove bad word')
                .addStringOption(o =>
                    o.setName('word')
                        .setDescription('Word')
                        .setRequired(true)
                )
        ),

    /* SECURITY */

    new SlashCommandBuilder()
        .setName('security')
        .setDescription('Configure security')
        .addSubcommand(s =>
            s.setName('enable')
                .setDescription('Enable security')
        )
        .addSubcommand(s =>
            s.setName('disable')
                .setDescription('Disable security')
        )
        .addSubcommand(s =>
            s.setName('status')
                .setDescription('Security status')
        )
        .addSubcommand(s =>
            s.setName('action')
                .setDescription('Security action')
                .addStringOption(o =>
                    o.setName('value')
                        .setDescription('Action')
                        .setRequired(true)
                        .addChoices(
                            { name: 'Alert', value: 'alert' },
                            { name: 'Kick', value: 'kick' },
                            { name: 'Ban', value: 'ban' }
                        )
                )
        )
        .addSubcommand(s =>
            s.setName('trusted')
                .setDescription('Add trusted user')
                .addUserOption(o =>
                    o.setName('user')
                        .setDescription('User')
                        .setRequired(true)
                )
        )
        .addSubcommand(s =>
            s.setName('untrusted')
                .setDescription('Remove trusted user')
                .addUserOption(o =>
                    o.setName('user')
                        .setDescription('User')
                        .setRequired(true)
                )
        )
        .addSubcommand(s =>
            s.setName('trustedrole')
                .setDescription('Set trusted role')
                .addRoleOption(o =>
                    o.setName('role')
                        .setDescription('Role')
                        .setRequired(true)
                )
        )
        .addSubcommand(s =>
            s.setName('untrustedrole')
                .setDescription('Remove trusted role')
        )
        .addSubcommand(s =>
            s.setName('trustedmember')
                .setDescription('Add trusted member')
                .addUserOption(o =>
                    o.setName('user')
                        .setDescription('Member')
                        .setRequired(true)
                )
        )
        .addSubcommand(s =>
            s.setName('untrustedmember')
                .setDescription('Remove trusted member')
                .addUserOption(o =>
                    o.setName('user')
                        .setDescription('Member')
                        .setRequired(true)
                )
        )
        .addSubcommand(s =>
            s.setName('trustedbot')
                .setDescription('Trust a bot')
                .addUserOption(o =>
                    o.setName('user')
                        .setDescription('Bot')
                        .setRequired(true)
                )
        )
        .addSubcommand(s =>
            s.setName('untrustedbot')
                .setDescription('Untrust a bot')
                .addUserOption(o =>
                    o.setName('user')
                        .setDescription('Bot')
                        .setRequired(true)
                )
        )
        .addSubcommand(s =>
            s.setName('protectedrole')
                .setDescription('Protect a role')
                .addRoleOption(o =>
                    o.setName('role')
                        .setDescription('Role')
                        .setRequired(true)
                )
        )
        .addSubcommand(s =>
            s.setName('unprotectedrole')
                .setDescription('Remove protected role')
                .addRoleOption(o =>
                    o.setName('role')
                        .setDescription('Role')
                        .setRequired(true)
                )
        )
        .addSubcommand(s =>
            s.setName('protectedchannel')
                .setDescription('Protect channel')
                .addChannelOption(o =>
                    o.setName('channel')
                        .setDescription('Channel')
                        .setRequired(true)
                )
        )
        .addSubcommand(s =>
            s.setName('unprotectedchannel')
                .setDescription('Unprotect channel')
                .addChannelOption(o =>
                    o.setName('channel')
                        .setDescription('Channel')
                        .setRequired(true)
                )
        )
        .addSubcommand(s =>
            s.setName('list')
                .setDescription('List security configuration')
        )
        .addSubcommand(s =>
            s.setName('log')
                .setDescription('Set security log')
                .addChannelOption(o =>
                    o.setName('channel')
                        .setDescription('Log channel')
                        .setRequired(true)
                )
        ),

    /* CONFIG */

    new SlashCommandBuilder()
        .setName('config')
        .setDescription('Configure AkiyO')
        .addSubcommand(s =>
            s.setName('view')
                .setDescription('View configuration')
        )
        .addSubcommand(s =>
            s.setName('log')
                .setDescription('Set a log channel')
                .addStringOption(o =>
                    o.setName('type')
                        .setDescription('Log type')
                        .setRequired(true)
                        .addChoices(
                            ...LOG_TYPES.map(x => ({
                                name: x,
                                value: x
                            }))
                        )
                )
                .addChannelOption(o =>
                    o.setName('channel')
                        .setDescription('Channel')
                        .setRequired(true)
                )
        )
        .addSubcommand(s =>
            s.setName('staffrole')
                .setDescription('Set staff role')
                .addRoleOption(o =>
                    o.setName('role')
                        .setDescription('Role')
                        .setRequired(true)
                )
        )
        .addSubcommand(s =>
            s.setName('ticketcategory')
                .setDescription('Set ticket category')
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
            s.setName('suggestions')
                .setDescription('Set suggestion channel')
                .addChannelOption(o =>
                    o.setName('channel')
                        .setDescription('Channel')
                        .setRequired(true)
                )
        ),

    /* MODERATION */

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
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('warnings')
        .setDescription('View warnings')
        .addUserOption(o =>
            o.setName('user')
                .setDescription('Member')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('punishments')
        .setDescription('View punishment history')
        .addUserOption(o =>
            o.setName('user')
                .setDescription('Member')
                .setRequired(true)
        ),

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
                .setDescription('Example: 10m, 1h, 1d')
                .setRequired(true)
        )
        .addStringOption(o =>
            o.setName('reason')
                .setDescription('Reason')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('untimeout')
        .setDescription('Remove timeout')
        .addUserOption(o =>
            o.setName('user')
                .setDescription('Member')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('kick')
        .setDescription('Kick member')
        .addUserOption(o =>
            o.setName('user')
                .setDescription('Member')
                .setRequired(true)
        )
        .addStringOption(o =>
            o.setName('reason')
                .setDescription('Reason')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('Ban member')
        .addUserOption(o =>
            o.setName('user')
                .setDescription('Member')
                .setRequired(true)
        )
        .addStringOption(o =>
            o.setName('reason')
                .setDescription('Reason')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('unban')
        .setDescription('Unban user')
        .addStringOption(o =>
            o.setName('user_id')
                .setDescription('User ID')
                .setRequired(true)
        ),

    /* SUGGESTIONS */

    new SlashCommandBuilder()
        .setName('suggest')
        .setDescription('Create suggestion')
        .addStringOption(o =>
            o.setName('text')
                .setDescription('Suggestion')
                .setRequired(true)
        ),

    /* ANNOUNCEMENT */

    new SlashCommandBuilder()
        .setName('announce')
        .setDescription('Send announcement')
        .addChannelOption(o =>
            o.setName('channel')
                .setDescription('Channel')
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
                .setRequired(false)
        )
        .addStringOption(o =>
            o.setName('footer')
                .setDescription('Footer')
                .setRequired(false)
        )
        .addBooleanOption(o =>
            o.setName('embed')
                .setDescription('Use embed')
                .setRequired(false)
        )
        .addBooleanOption(o =>
            o.setName('everyone')
                .setDescription('Mention everyone')
                .setRequired(false)
        ),

    /* AUTOROLE */

    new SlashCommandBuilder()
        .setName('autorole')
        .setDescription('Configure autorole')
        .addSubcommand(s =>
            s.setName('set')
                .setDescription('Set autorole')
                .addRoleOption(o =>
                    o.setName('role')
                        .setDescription('Role')
                        .setRequired(true)
                )
        )
        .addSubcommand(s =>
            s.setName('disable')
                .setDescription('Disable autorole')
        )
        .addSubcommand(s =>
            s.setName('status')
                .setDescription('Autorole status')
        ),

    /* WELCOME */

    new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('Configure welcome system')
        .addSubcommand(s =>
            s.setName('set')
                .setDescription('Set welcome')
                .addChannelOption(o =>
                    o.setName('channel')
                        .setDescription('Channel')
                        .setRequired(true)
                )
                .addStringOption(o =>
                    o.setName('message')
                        .setDescription('Welcome message')
                        .setRequired(true)
                )
        )
        .addSubcommand(s =>
            s.setName('disable')
                .setDescription('Disable welcome')
        )
        .addSubcommand(s =>
            s.setName('status')
                .setDescription('Welcome status')
        ),

    /* VERIFICATION */

    new SlashCommandBuilder()
        .setName('verification')
        .setDescription('Configure verification')
        .addSubcommand(s =>
            s.setName('setup')
                .setDescription('Setup verification')
                .addChannelOption(o =>
                    o.setName('channel')
                        .setDescription('Channel')
                        .setRequired(true)
                )
                .addRoleOption(o =>
                    o.setName('role')
                        .setDescription('Verification role')
                        .setRequired(true)
                )
        )
        .addSubcommand(s =>
            s.setName('disable')
                .setDescription('Disable verification')
        )
        .addSubcommand(s =>
            s.setName('status')
                .setDescription('Verification status')
        ),

    /* REACTION ROLE */

    new SlashCommandBuilder()
        .setName('autoreactionrole')
        .setDescription('Reaction role system')
        .addSubcommand(s =>
            s.setName('add')
                .setDescription('Add reaction role')
                .addStringOption(o =>
                    o.setName('message_id')
                        .setDescription('Message ID')
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
                .setDescription('Remove reaction role')
                .addStringOption(o =>
                    o.setName('message_id')
                        .setDescription('Message ID')
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
                .setDescription('List reaction roles')
        ),

    /* LEADERBOARD */

    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Message leaderboard')
        .addSubcommand(s =>
            s.setName('top')
                .setDescription('Show leaderboard')
        )
        .addSubcommand(s =>
            s.setName('reset')
                .setDescription('Reset leaderboard')
        )
        .addSubcommand(s =>
            s.setName('enable')
                .setDescription('Enable leaderboard')
        )
        .addSubcommand(s =>
            s.setName('disable')
                .setDescription('Disable leaderboard')
        )
        .addSubcommand(s =>
            s.setName('status')
                .setDescription('Leaderboard status')
        ),

    /* ADS */

    new SlashCommandBuilder()
        .setName('ads')
        .setDescription('Owner advertisement system')
        .addSubcommand(s =>
            s.setName('set')
                .setDescription('Set ad channel')
                .addChannelOption(o =>
                    o.setName('channel')
                        .setDescription('Channel')
                        .setRequired(true)
                )
        )
        .addSubcommand(s =>
            s.setName('message')
                .setDescription('Set ad message')
                .addStringOption(o =>
                    o.setName('text')
                        .setDescription('Message')
                        .setRequired(true)
                )
        )
        .addSubcommand(s =>
            s.setName('interval')
                .setDescription('Set interval')
                .addIntegerOption(o =>
                    o.setName('minutes')
                        .setDescription('Minutes')
                        .setMinValue(1)
                        .setRequired(true)
                )
        )
        .addSubcommand(s =>
            s.setName('enable')
                .setDescription('Enable ads')
        )
        .addSubcommand(s =>
            s.setName('disable')
                .setDescription('Disable ads')
        )
        .addSubcommand(s =>
            s.setName('status')
                .setDescription('Ad status')
        )
        .addSubcommand(s =>
            s.setName('broadcast')
                .setDescription('Send ad now')
        ),

    /* AI */

    new SlashCommandBuilder()
        .setName('ai')
        .setDescription('AkiyO AI')
        .addSubcommand(s =>
            s.setName('ask')
                .setDescription('Ask AkiyO AI')
                .addStringOption(o =>
                    o.setName('prompt')
                        .setDescription('Question')
                        .setRequired(true)
                )
        )
        .addSubcommand(s =>
            s.setName('reset')
                .setDescription('Reset your AI conversation')
        )

].map(command => command.toJSON());

/* =========================================================
   COMMAND REGISTRATION
========================================================= */

async function registerCommands() {
    const rest = new REST({
        version: '10'
    }).setToken(TOKEN);

    try {
        await rest.put(
            Routes.applicationCommands(
                CLIENT_ID
            ),
            {
                body: commands
            }
        );

        console.log(
            `✅ Registered ${commands.length} global slash commands.`
        );
    } catch (error) {
        console.error(
            '❌ Slash command registration error:',
            error
        );
    }
}

/* =========================================================
   COMMAND HANDLER
========================================================= */

async function handleCommand(interaction) {

    if (!interaction.guild) {
        if (
            interaction.commandName === 'ai'
        ) {
            return handleAI(
                interaction
            );
        }

        return interaction.reply({
            content:
                '❌ This command must be used inside a server.',
            ephemeral: true
        });
    }

    const guild = interaction.guild;
    const member =
        await guild.members.fetch(
            interaction.user.id
        ).catch(() => interaction.member);

    const config =
        getGuildConfig(guild);

    const command =
        interaction.commandName;

    /* =====================================================
       HELP
    ===================================================== */

    if (command === 'help') {
        const embed = new EmbedBuilder()
            .setTitle('🤖 AkiyO Help')
            .setDescription(
                'Advanced Discord support, moderation, security and utility bot.'
            )
            .addFields(
                field(
                    '🎫 Tickets',
                    '`/ticket` `/ticketpanel` `/ticketsetup` `/close` `/reopen` `/claim` `/unclaim` `/lock` `/unlock` `/ticketadd` `/ticketremove` `/ticketrename` `/ticketinfo` `/ticketstats` `/transcript`'
                ),
                field(
                    '🛡️ AutoMod',
                    '`/automod enable` `/automod disable` `/automod status` `/automod config` `/automod badword`'
                ),
                field(
                    '🔐 Security',
                    '`/security enable` `/security disable` `/security status` `/security trusted` `/security protectedrole` `/security protectedchannel`'
                ),
                field(
                    '🔨 Moderation',
                    '`/warn` `/warnings` `/punishments` `/timeout` `/untimeout` `/kick` `/ban` `/unban`'
                ),
                field(
                    '⚙️ Utility',
                    '`/config` `/announce` `/autorole` `/welcome` `/verification` `/autoreactionrole` `/leaderboard` `/ads` `/ai`'
                )
            )
            .setFooter({
                text: 'AkiyO • Advanced Discord Bot'
            })
            .setTimestamp();

        return interaction.reply({
            embeds: [embed],
            ephemeral: true
        });
    }

    /* =====================================================
       BOTINFO
    ===================================================== */

    if (command === 'botinfo') {
        const embed = new EmbedBuilder()
            .setTitle('🤖 AkiyO')
            .setDescription(
                'Advanced multi-server Discord bot.'
            )
            .addFields(
                field(
                    'Servers',
                    client.guilds.cache.size,
                    true
                ),
                field(
                    'Users',
                    client.guilds.cache.reduce(
                        (total, g) =>
                            total + (g.memberCount || 0),
                        0
                    ),
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
                    '14.27.0',
                    true
                )
            )
            .setTimestamp();

        return interaction.reply({
            embeds: [embed]
        });
    }

    /* =====================================================
       TICKET
    ===================================================== */

    if (command === 'ticket') {
        const result =
            await createTicket(
                guild,
                interaction.user
            );

        if (result.error) {
            return interaction.reply({
                content: `❌ ${result.error}`,
                ephemeral: true
            });
        }

        return interaction.reply({
            content:
                `🎫 Ticket created: ${result.channel}`,
            ephemeral: true
        });
    }

    if (command === 'ticketpanel') {
        if (!isManager(member)) {
            return interaction.reply({
                content:
                    '❌ Manager permission required.',
                ephemeral: true
            });
        }

        const embed = new EmbedBuilder()
            .setTitle('🎫 AkiyO Support')
            .setDescription(
                'Need help? Click the button below to create a private support ticket.'
            )
            .setTimestamp();

        const row =
            new ActionRowBuilder()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(
                            'create_ticket'
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
            embeds: [embed],
            components: [row]
        });

        return interaction.reply({
            content:
                '✅ Ticket panel sent.',
            ephemeral: true
        });
    }

    if (command === 'ticketsetup') {
        if (!isManager(member)) {
            return interaction.reply({
                content:
                    '❌ Manager permission required.',
                ephemeral: true
            });
        }

        const category =
            interaction.options.getChannel(
                'category'
            );

        const role =
            interaction.options.getRole(
                'staffrole'
            );

        if (category) {
            config.support.categoryId =
                category.id;
        }

        if (role) {
            config.support.supportRoleId =
                role.id;
        }

        saveDatabase();

        return interaction.reply({
            content:
                '✅ Ticket configuration updated.',
            ephemeral: true
        });
    }

    /* =====================================================
       CURRENT TICKET COMMANDS
    ===================================================== */

    const ticketCommands = [
        'close',
        'reopen',
        'delete',
        'claim',
        'unclaim',
        'lock',
        'unlock',
        'ticketadd',
        'ticketremove',
        'ticketrename',
        'ticketinfo',
        'transcript'
    ];

    if (ticketCommands.includes(command)) {

        const ticket =
            getTicketByChannel(
                guild,
                interaction.channel.id
            );

        if (!ticket) {
            return interaction.reply({
                content:
                    '❌ This channel is not an AkiyO ticket.',
                ephemeral: true
            });
        }

        const staffOnly = [
            'claim',
            'unclaim',
            'lock',
            'unlock',
            'ticketadd',
            'ticketremove',
            'ticketrename',
            'transcript',
            'delete'
        ];

        if (
            staffOnly.includes(command) &&
            !isStaff(member)
        ) {
            return interaction.reply({
                content:
                    '❌ Support staff only.',
                ephemeral: true
            });
        }

        if (
            command === 'close'
        ) {
            if (
                ticket.ownerId !== interaction.user.id &&
                !isStaff(member)
            ) {
                return interaction.reply({
                    content:
                        '❌ You cannot close this ticket.',
                    ephemeral: true
                });
            }

            ticket.status = 'closed';
            ticket.closedAt = Date.now();

            await interaction.channel.permissionOverwrites.edit(
                ticket.ownerId,
                {
                    SendMessages: false
                }
            ).catch(() => {});

            saveDatabase();

            await sendLog(
                guild,
                'tickets',
                '🔴 Ticket Closed',
                [
                    field(
                        'Ticket',
                        `#${ticket.id}`
                    ),
                    field(
                        'Closed By',
                        interaction.user.tag
                    )
                ]
            );

            return interaction.reply({
                content:
                    '🔴 Ticket closed.',
                components: [
                    new ActionRowBuilder()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(
                                    `ticket_reopen_${ticket.id}`
                                )
                                .setLabel(
                                    'Reopen'
                                )
                                .setStyle(
                                    ButtonStyle.Success
                                ),
                            new ButtonBuilder()
                                .setCustomId(
                                    `ticket_delete_${ticket.id}`
                                )
                                .setLabel(
                                    'Delete'
                                )
                                .setStyle(
                                    ButtonStyle.Danger
                                )
                        )
                ]
            });
        }

        if (
            command === 'reopen'
        ) {
            ticket.status = 'open';
            ticket.closedAt = null;

            await interaction.channel.permissionOverwrites.edit(
                ticket.ownerId,
                {
                    SendMessages: true
                }
            ).catch(() => {});

            saveDatabase();

            return interaction.reply({
                content:
                    '🟢 Ticket reopened.'
            });
        }

        if (
            command === 'delete'
        ) {
            ticket.status = 'deleted';

            saveDatabase();

            await sendLog(
                guild,
                'tickets',
                '🗑️ Ticket Deleted',
                [
                    field(
                        'Ticket',
                        `#${ticket.id}`
                    ),
                    field(
                        'Deleted By',
                        interaction.user.tag
                    )
                ]
            );

            await interaction.reply({
                content:
                    '🗑️ Deleting ticket...'
            });

            return interaction.channel
                .delete()
                .catch(() => {});
        }

        if (
            command === 'claim'
        ) {
            ticket.claimedBy =
                interaction.user.id;

            saveDatabase();

            return interaction.reply({
                content:
                    `✅ Ticket claimed by ${interaction.user}.`
            });
        }

        if (
            command === 'unclaim'
        ) {
            ticket.claimedBy = null;

            saveDatabase();

            return interaction.reply({
                content:
                    '✅ Ticket unclaimed.'
            });
        }

        if (
            command === 'lock'
        ) {
            ticket.locked = true;

            await interaction.channel.permissionOverwrites.edit(
                ticket.ownerId,
                {
                    SendMessages: false
                }
            ).catch(() => {});

            saveDatabase();

            return interaction.reply({
                content:
                    '🔒 Ticket locked.'
            });
        }

        if (
            command === 'unlock'
        ) {
            ticket.locked = false;

            await interaction.channel.permissionOverwrites.edit(
                ticket.ownerId,
                {
                    SendMessages: true
                }
            ).catch(() => {});

            saveDatabase();

            return interaction.reply({
                content:
                    '🔓 Ticket unlocked.'
            });
        }

        if (
            command === 'ticketadd'
        ) {
            const user =
                interaction.options.getUser(
                    'user'
                );

            await interaction.channel.permissionOverwrites.edit(
                user.id,
                {
                    ViewChannel: true,
                    SendMessages: true,
                    ReadMessageHistory: true
                }
            );

            return interaction.reply({
                content:
                    `✅ Added ${user}.`
            });
        }

        if (
            command === 'ticketremove'
        ) {
            const user =
                interaction.options.getUser(
                    'user'
                );

            await interaction.channel.permissionOverwrites.delete(
                user.id
            ).catch(() => {});

            return interaction.reply({
                content:
                    `✅ Removed ${user}.`
            });
        }

        if (
            command === 'ticketrename'
        ) {
            const name =
                interaction.options.getString(
                    'name'
                );

            await interaction.channel
                .setName(
                    name
                        .toLowerCase()
                        .replace(/[^a-z0-9-_]/g, '-')
                        .slice(0, 90)
                );

            return interaction.reply({
                content:
                    '✅ Ticket renamed.'
            });
        }

        if (
            command === 'ticketinfo'
        ) {
            const embed =
                new EmbedBuilder()
                    .setTitle(
                        `🎫 Ticket #${ticket.id}`
                    )
                    .addFields(
                        field(
                            'Owner',
                            `<@${ticket.ownerId}>`,
                            true
                        ),
                        field(
                            'Status',
                            ticket.status,
                            true
                        ),
                        field(
                            'Claimed By',
                            ticket.claimedBy
                                ? `<@${ticket.claimedBy}>`
                                : 'Unclaimed',
                            true
                        ),
                        field(
                            'Locked',
                            ticket.locked
                                ? 'Yes'
                                : 'No',
                            true
                        )
                    )
                    .setTimestamp();

            return interaction.reply({
                embeds: [embed]
            });
        }

        if (
            command === 'transcript'
        ) {
            const messages =
                await interaction.channel.messages
                    .fetch({
                        limit: 100
                    });

            const sorted =
                [...messages.values()]
                    .reverse();

            let text =
                `AKIYO TICKET TRANSCRIPT\n` +
                `Ticket #${ticket.id}\n` +
                `Guild: ${guild.name}\n\n`;

            for (const msg of sorted) {
                text +=
                    `[${msg.createdAt.toISOString()}] ` +
                    `${msg.author.tag}: ` +
                    `${msg.content || '[attachment/embed]'}\n`;
            }

            const buffer =
                Buffer.from(
                    text,
                    'utf8'
                );

            const attachment =
                new AttachmentBuilder(
                    buffer,
                    {
                        name:
                            `ticket-${ticket.id}.txt`
                    }
                );

            await sendLog(
                guild,
                'tickets',
                '📄 Ticket Transcript',
                [
                    field(
                        'Ticket',
                        `#${ticket.id}`
                    ),
                    field(
                        'Generated By',
                        interaction.user.tag
                    )
                ]
            );

            return interaction.reply({
                content:
                    '📄 Transcript generated.',
                files: [attachment],
                ephemeral: true
            });
        }
    }

    /* =====================================================
       TICKET STATS
    ===================================================== */

    if (
        command === 'ticketstats'
    ) {
        if (!isStaff(member)) {
            return interaction.reply({
                content:
                    '❌ Support staff only.',
                ephemeral: true
            });
        }

        const tickets =
            Object.values(
                config.tickets.records
            );

        const open =
            tickets.filter(
                x => x.status === 'open'
            ).length;

        const closed =
            tickets.filter(
                x => x.status === 'closed'
            ).length;

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(
                        '🎫 Ticket Statistics'
                    )
                    .addFields(
                        field(
                            'Total',
                            tickets.length,
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
                    )
            ],
            ephemeral: true
        });
    }

    /* =====================================================
       AUTOMOD
    ===================================================== */

    if (
        command === 'automod'
    ) {
        if (!isManager(member)) {
            return interaction.reply({
                content:
                    '❌ Manager permission required.',
                ephemeral: true
            });
        }

        const sub =
            interaction.options.getSubcommand();

        if (sub === 'enable') {
            config.automod.enabled = true;
            saveDatabase();

            return interaction.reply({
                content:
                    '🛡️ AutoMod enabled.'
            });
        }

        if (sub === 'disable') {
            config.automod.enabled = false;
            saveDatabase();

            return interaction.reply({
                content:
                    '🛡️ AutoMod disabled.'
            });
        }

        if (sub === 'status') {
            return interaction.reply({
                content:
                    `🛡️ AutoMod: **${config.automod.enabled ? 'ON' : 'OFF'}**\n` +
                    `Spam: ${config.automod.spamLimit}\n` +
                    `Repeated: ${config.automod.repeatedLimit}\n` +
                    `Caps: ${config.automod.capsPercent}%\n` +
                    `Invites: ${config.automod.invite ? 'ON' : 'OFF'}\n` +
                    `Mass Mentions: ${config.automod.massMentions ? 'ON' : 'OFF'}`,
                ephemeral: true
            });
        }

        if (sub === 'config') {
            const setting =
                interaction.options.getString(
                    'setting'
                );

            const value =
                interaction.options.getString(
                    'value'
                );

            if (
                ['invite', 'massMentions']
                    .includes(setting)
            ) {
                config.automod[setting] =
                    value.toLowerCase() === 'true' ||
                    value === '1' ||
                    value === 'on';
            } else {
                const number =
                    Number(value);

                if (
                    !Number.isFinite(number) ||
                    number < 1
                ) {
                    return interaction.reply({
                        content:
                            '❌ Invalid value.',
                        ephemeral: true
                    });
                }

                config.automod[setting] =
                    number;
            }

            saveDatabase();

            return interaction.reply({
                content:
                    `✅ AutoMod ${setting} updated.`
            });
        }

        if (
            sub === 'badword'
        ) {
            const word =
                interaction.options.getString(
                    'word'
                ).toLowerCase();

            if (
                !config.automod.badWords
                    .includes(word)
            ) {
                config.automod.badWords.push(
                    word
                );
            }

            saveDatabase();

            return interaction.reply({
                content:
                    `✅ Added \`${word}\` to bad words.`
            });
        }

        if (
            sub === 'removebadword'
        ) {
            const word =
                interaction.options.getString(
                    'word'
                ).toLowerCase();

            config.automod.badWords =
                config.automod.badWords.filter(
                    x => x !== word
                );

            saveDatabase();

            return interaction.reply({
                content:
                    `✅ Removed \`${word}\`.`
            });
        }
    }

    /* =====================================================
       SECURITY
    ===================================================== */

    if (
        command === 'security'
    ) {
        if (!isManager(member)) {
            return interaction.reply({
                content:
                    '❌ Manager permission required.',
                ephemeral: true
            });
        }

        const sub =
            interaction.options.getSubcommand();

        if (sub === 'enable') {
            config.security.enabled = true;
            saveDatabase();

            return interaction.reply({
                content:
                    '🔐 Security enabled.'
            });
        }

        if (sub === 'disable') {
            config.security.enabled = false;
            saveDatabase();

            return interaction.reply({
                content:
                    '🔐 Security disabled.'
            });
        }

        if (sub === 'status') {
            return interaction.reply({
                content:
                    `🔐 Security: **${config.security.enabled ? 'ON' : 'OFF'}**\n` +
                    `Action: **${config.security.action}**\n` +
                    `Trusted users: ${config.security.trustedUsers.length}\n` +
                    `Trusted bots: ${config.security.trustedBots.length}\n` +
                    `Protected roles: ${config.security.protectedRoles.length}\n` +
                    `Protected channels: ${config.security.protectedChannels.length}`,
                ephemeral: true
            });
        }

        if (sub === 'action') {
            config.security.action =
                interaction.options.getString(
                    'value'
                );

            saveDatabase();

            return interaction.reply({
                content:
                    `✅ Security action set to **${config.security.action}**.`
            });
        }

        if (
            sub === 'trusted' ||
            sub === 'trustedmember'
        ) {
            const user =
                interaction.options.getUser(
                    'user'
                );

            if (
                !config.security.trustedUsers
                    .includes(user.id)
            ) {
                config.security.trustedUsers
                    .push(user.id);
            }

            saveDatabase();

            return interaction.reply({
                content:
                    `✅ ${user} added to trusted users.`
            });
        }

        if (
            sub === 'untrusted' ||
            sub === 'untrustedmember'
        ) {
            const user =
                interaction.options.getUser(
                    'user'
                );

            config.security.trustedUsers =
                config.security.trustedUsers
                    .filter(
                        id => id !== user.id
                    );

            saveDatabase();

            return interaction.reply({
                content:
                    `✅ ${user} removed from trusted users.`
            });
        }

        if (
            sub === 'trustedbot'
        ) {
            const user =
                interaction.options.getUser(
                    'user'
                );

            if (
                !config.security.trustedBots
                    .includes(user.id)
            ) {
                config.security.trustedBots
                    .push(user.id);
            }

            saveDatabase();

            return interaction.reply({
                content:
                    `✅ ${user} added as trusted bot.`
            });
        }

        if (
            sub === 'untrustedbot'
        ) {
            const user =
                interaction.options.getUser(
                    'user'
                );

            config.security.trustedBots =
                config.security.trustedBots
                    .filter(
                        id => id !== user.id
                    );

            saveDatabase();

            return interaction.reply({
                content:
                    `✅ ${user} removed from trusted bots.`
            });
        }

        if (
            sub === 'trustedrole'
        ) {
            const role =
                interaction.options.getRole(
                    'role'
                );

            config.security.trustedRoleId =
                role.id;

            saveDatabase();

            return interaction.reply({
                content:
                    `✅ ${role} is now trusted.`
            });
        }

        if (
            sub === 'untrustedrole'
        ) {
            config.security.trustedRoleId =
                null;

            saveDatabase();

            return interaction.reply({
                content:
                    '✅ Trusted role removed.'
            });
        }

        if (
            sub === 'protectedrole'
        ) {
            const role =
                interaction.options.getRole(
                    'role'
                );

            if (
                !config.security.protectedRoles
                    .includes(role.id)
            ) {
                config.security.protectedRoles
                    .push(role.id);
            }

            saveDatabase();

            return interaction.reply({
                content:
                    `🛡️ ${role} is now protected.`
            });
        }

        if (
            sub === 'unprotectedrole'
        ) {
            const role =
                interaction.options.getRole(
                    'role'
                );

            config.security.protectedRoles =
                config.security.protectedRoles
                    .filter(
                        id => id !== role.id
                    );

            saveDatabase();

            return interaction.reply({
                content:
                    `✅ ${role} is no longer protected.`
            });
        }

        if (
            sub === 'protectedchannel'
        ) {
            const channel =
                interaction.options.getChannel(
                    'channel'
                );

            if (
                !config.security.protectedChannels
                    .includes(channel.id)
            ) {
                config.security.protectedChannels
                    .push(channel.id);
            }

            saveDatabase();

            return interaction.reply({
                content:
                    `🛡️ ${channel} is now protected.`
            });
        }

        if (
            sub === 'unprotectedchannel'
        ) {
            const channel =
                interaction.options.getChannel(
                    'channel'
                );

            config.security.protectedChannels =
                config.security.protectedChannels
                    .filter(
                        id => id !== channel.id
                    );

            saveDatabase();

            return interaction.reply({
                content:
                    `✅ ${channel} is no longer protected.`
            });
        }

        if (
            sub === 'list'
        ) {
            return interaction.reply({
                content:
                    `🔐 **Security Configuration**\n\n` +
                    `Trusted users: ${config.security.trustedUsers.map(id => `<@${id}>`).join(', ') || 'None'}\n` +
                    `Trusted bots: ${config.security.trustedBots.map(id => `<@${id}>`).join(', ') || 'None'}\n` +
                    `Trusted role: ${config.security.trustedRoleId ? `<@&${config.security.trustedRoleId}>` : 'None'}\n` +
                    `Protected roles: ${config.security.protectedRoles.map(id => `<@&${id}>`).join(', ') || 'None'}\n` +
                    `Protected channels: ${config.security.protectedChannels.map(id => `<#${id}>`).join(', ') || 'None'}`,
                ephemeral: true
            });
        }

        if (
            sub === 'log'
        ) {
            const channel =
                interaction.options.getChannel(
                    'channel'
                );

            config.logs.security =
                channel.id;

            saveDatabase();

            return interaction.reply({
                content:
                    `✅ Security log set to ${channel}.`
            });
        }
    }

    /* =====================================================
       CONFIG
    ===================================================== */

    if (
        command === 'config'
    ) {
        if (!isManager(member)) {
            return interaction.reply({
                content:
                    '❌ Manager permission required.',
                ephemeral: true
            });
        }

        const sub =
            interaction.options.getSubcommand();

        if (
            sub === 'view'
        ) {
            return interaction.reply({
                content:
                    `⚙️ **AkiyO Configuration**\n\n` +
                    `Staff Role: ${config.staffRoleId ? `<@&${config.staffRoleId}>` : 'Not set'}\n` +
                    `Ticket Category: ${config.support.categoryId ? `<#${config.support.categoryId}>` : 'Not set'}\n` +
                    `Ticket Staff: ${config.support.supportRoleId ? `<@&${config.support.supportRoleId}>` : 'Not set'}\n` +
                    `Suggestions: ${config.suggestions.channelId ? `<#${config.suggestions.channelId}>` : 'Not set'}\n` +
                    `AutoMod: ${config.automod.enabled ? 'ON' : 'OFF'}\n` +
                    `Security: ${config.security.enabled ? 'ON' : 'OFF'}`,
                ephemeral: true
            });
        }

        if (
            sub === 'log'
        ) {
            const type =
                interaction.options.getString(
                    'type'
                );

            const channel =
                interaction.options.getChannel(
                    'channel'
                );

            config.logs[type] =
                channel.id;

            saveDatabase();

            return interaction.reply({
                content:
                    `✅ ${type} log set to ${channel}.`
            });
        }

        if (
            sub === 'staffrole'
        ) {
            const role =
                interaction.options.getRole(
                    'role'
                );

            config.staffRoleId =
                role.id;

            saveDatabase();

            return interaction.reply({
                content:
                    `✅ Staff role set to ${role}.`
            });
        }

        if (
            sub === 'ticketcategory'
        ) {
            const channel =
                interaction.options.getChannel(
                    'channel'
                );

            config.support.categoryId =
                channel.id;

            saveDatabase();

            return interaction.reply({
                content:
                    `✅ Ticket category set to ${channel}.`
            });
        }

        if (
            sub === 'suggestions'
        ) {
            const channel =
                interaction.options.getChannel(
                    'channel'
                );

            config.suggestions.channelId =
                channel.id;

            saveDatabase();

            return interaction.reply({
                content:
                    `✅ Suggestion channel set to ${channel}.`
            });
        }
    }

    /* =====================================================
       MODERATION
    ===================================================== */

    const moderationCommands = [
        'warn',
        'warnings',
        'punishments',
        'timeout',
        'untimeout',
        'kick',
        'ban',
        'unban'
    ];

    if (
        moderationCommands.includes(command)
    ) {
        if (!isStaff(member)) {
            return interaction.reply({
                content:
                    '❌ Staff permission required.',
                ephemeral: true
            });
        }

        if (
            command === 'unban'
        ) {
            const id =
                interaction.options.getString(
                    'user_id'
                );

            await guild.members.unban(
                id,
                `Unban by ${interaction.user.tag}`
            ).catch(() => null);

            return interaction.reply({
                content:
                    '🔓 Unban request completed.'
            });
        }

        const user =
            interaction.options.getUser(
                'user'
            );

        const target =
            await guild.members.fetch(
                user.id
            ).catch(() => null);

        if (!target) {
            return interaction.reply({
                content:
                    '❌ Member not found.',
                ephemeral: true
            });
        }

        if (
            !canManageTarget(
                member,
                target
            )
        ) {
            return interaction.reply({
                content:
                    '❌ You cannot moderate this member because of role hierarchy.',
                ephemeral: true
            });
        }

        if (
            command === 'warnings'
        ) {
            const records =
                config.warnings[target.id] ||
                [];

            if (!records.length) {
                return interaction.reply({
                    content:
                        `✅ ${target.user.tag} has no warnings.`,
                    ephemeral: true
                });
            }

            const text =
                records
                    .slice(-15)
                    .map(
                        (x, i) =>
                            `${i + 1}. ${x.reason} • <@${x.moderatorId}> • <t:${Math.floor(x.timestamp / 1000)}:R>`
                    )
                    .join('\n');

            return interaction.reply({
                content:
                    `⚠️ **Warnings for ${target.user.tag}**\n${text}`,
                ephemeral: true
            });
        }

        if (
            command === 'punishments'
        ) {
            const records =
                config.punishments[target.id] ||
                [];

            if (!records.length) {
                return interaction.reply({
                    content:
                        `✅ ${target.user.tag} has no punishment history.`,
                    ephemeral: true
                });
            }

            const text =
                records
                    .slice(-20)
                    .map(
                        x =>
                            `• **${x.type}** — ${x.reason} — <t:${Math.floor(x.timestamp / 1000)}:R>`
                    )
                    .join('\n');

            return interaction.reply({
                content:
                    `🔨 **Punishments for ${target.user.tag}**\n${text}`,
                ephemeral: true
            });
        }

        if (
            command === 'warn'
        ) {
            const reason =
                interaction.options.getString(
                    'reason'
                ) ||
                'No reason provided';

            const result =
                await addWarning(
                    target,
                    interaction.user,
                    reason
                );

            await sendLog(
                guild,
                'moderation',
                '⚠️ Member Warned',
                [
                    field(
                        'User',
                        `${target.user.tag}`
                    ),
                    field(
                        'Moderator',
                        interaction.user.tag
                    ),
                    field(
                        'Reason',
                        reason
                    ),
                    field(
                        'Warning Count',
                        result.count
                    ),
                    field(
                        'Escalation',
                        result.escalation || 'None'
                    )
                ]
            );

            try {
                await target.send(
                    `⚠️ You were warned in **${guild.name}**.\nReason: ${reason}`
                );
            } catch {}

            return interaction.reply({
                content:
                    `⚠️ ${target.user.tag} warned. Warning count: ${result.count}.`
            });
        }

        if (
            command === 'timeout'
        ) {
            const duration =
                parseDuration(
                    interaction.options.getString(
                        'duration'
                    )
                );

            if (!duration) {
                return interaction.reply({
                    content:
                        '❌ Invalid duration. Examples: `30s`, `10m`, `2h`, `1d`. Maximum 28 days.',
                    ephemeral: true
                });
            }

            const reason =
                interaction.options.getString(
                    'reason'
                ) ||
                'No reason provided';

            await target.timeout(
                duration,
                reason
            );

            addPunishment(
                guild,
                target.id,
                'timeout',
                reason,
                interaction.user.id,
                duration
            );

            await sendLog(
                guild,
                'moderation',
                '⏱️ Member Timed Out',
                [
                    field(
                        'User',
                        target.user.tag
                    ),
                    field(
                        'Moderator',
                        interaction.user.tag
                    ),
                    field(
                        'Duration',
                        `${Math.round(duration / 1000)} seconds`
                    ),
                    field(
                        'Reason',
                        reason
                    )
                ]
            );

            return interaction.reply({
                content:
                    `⏱️ ${target.user.tag} timed out.`
            });
        }

        if (
            command === 'untimeout'
        ) {
            await target.timeout(
                null,
                `Timeout removed by ${interaction.user.tag}`
            );

            addPunishment(
                guild,
                target.id,
                'untimeout',
                'Timeout removed',
                interaction.user.id
            );

            return interaction.reply({
                content:
                    `🔓 Timeout removed from ${target.user.tag}.`
            });
        }

        if (
            command === 'kick'
        ) {
            const reason =
                interaction.options.getString(
                    'reason'
                ) ||
                'No reason provided';

            await target.kick(
                reason
            );

            addPunishment(
                guild,
                target.id,
                'kick',
                reason,
                interaction.user.id
            );

            return interaction.reply({
                content:
                    `👢 ${target.user.tag} kicked.`
            });
        }

        if (
            command === 'ban'
        ) {
            const reason =
                interaction.options.getString(
                    'reason'
                ) ||
                'No reason provided';

            await target.ban({
                reason
            });

            addPunishment(
                guild,
                target.id,
                'ban',
                reason,
                interaction.user.id
            );

            return interaction.reply({
                content:
                    `🔨 ${target.user.tag} banned.`
            });
        }
    }

    /* =====================================================
       SUGGESTION
    ===================================================== */

    if (
        command === 'suggest'
    ) {
        const channelId =
            config.suggestions.channelId;

        if (!channelId) {
            return interaction.reply({
                content:
                    '❌ Suggestion channel has not been configured.',
                ephemeral: true
            });
        }

        const channel =
            await guild.channels.fetch(
                channelId
            ).catch(() => null);

        if (!channel?.isTextBased()) {
            return interaction.reply({
                content:
                    '❌ Suggestion channel is invalid.',
                ephemeral: true
            });
        }

        const text =
            interaction.options.getString(
                'text'
            );

        const id =
            `${Date.now()}`;

        const embed =
            new EmbedBuilder()
                .setTitle('💡 New Suggestion')
                .setDescription(text)
                .addFields(
                    field(
                        'Author',
                        `${interaction.user}`,
                        true
                    ),
                    field(
                        'Status',
                        '🟡 Pending',
                        true
                    )
                )
                .setTimestamp();

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

        const msg =
            await channel.send({
                embeds: [embed],
                components: [row]
            });

        config.suggestions.records[id] = {
            id,
            messageId: msg.id,
            channelId: channel.id,
            userId: interaction.user.id,
            text,
            status: 'pending',
            createdAt: Date.now()
        };

        saveDatabase();

        return interaction.reply({
            content:
                '✅ Suggestion submitted.',
            ephemeral: true
        });
    }

    /* =====================================================
       ANNOUNCEMENT
    ===================================================== */

    if (
        command === 'announce'
    ) {
        if (!isManager(member)) {
            return interaction.reply({
                content:
                    '❌ Manager permission required.',
                ephemeral: true
            });
        }

        const channel =
            interaction.options.getChannel(
                'channel'
            );

        const message =
            interaction.options.getString(
                'message'
            );

        const title =
            interaction.options.getString(
                'title'
            );

        const footer =
            interaction.options.getString(
                'footer'
            );

        const useEmbed =
            interaction.options.getBoolean(
                'embed'
            ) ?? true;

        const everyone =
            interaction.options.getBoolean(
                'everyone'
            ) ?? false;

        if (
            !channel?.isTextBased()
        ) {
            return interaction.reply({
                content:
                    '❌ Invalid channel.',
                ephemeral: true
            });
        }

        if (useEmbed) {
            const embed =
                new EmbedBuilder()
                    .setDescription(
                        message
                    )
                    .setTimestamp();

            if (title) {
                embed.setTitle(title);
            }

            if (footer) {
                embed.setFooter({
                    text: footer
                });
            }

            await channel.send({
                content:
                    everyone
                        ? '@everyone'
                        : undefined,
                embeds: [embed],
                allowedMentions: {
                    parse:
                        everyone
                            ? ['everyone']
                            : []
                }
            });
        } else {
            await channel.send({
                content:
                    everyone
                        ? `@everyone ${message}`
                        : message,
                allowedMentions: {
                    parse:
                        everyone
                            ? ['everyone']
                            : []
                }
            });
        }

        await sendLog(
            guild,
            'announcements',
            '📢 Announcement Sent',
            [
                field(
                    'Channel',
                    `${channel}`
                ),
                field(
                    'By',
                    interaction.user.tag
                )
            ]
        );

        return interaction.reply({
            content:
                '✅ Announcement sent.',
            ephemeral: true
        });
    }

    /* =====================================================
       AUTOROLE
    ===================================================== */

    if (
        command === 'autorole'
    ) {
        if (!isManager(member)) {
            return interaction.reply({
                content:
                    '❌ Manager permission required.',
                ephemeral: true
            });
        }

        const sub =
            interaction.options.getSubcommand();

        if (
            sub === 'set'
        ) {
            const role =
                interaction.options.getRole(
                    'role'
                );

            if (
                guild.members.me &&
                role.position >=
                guild.members.me.roles.highest.position
            ) {
                return interaction.reply({
                    content:
                        '❌ My bot role must be higher than the autorole.',
                    ephemeral: true
                });
            }

            config.autorole.enabled = true;
            config.autorole.roleId =
                role.id;

            saveDatabase();

            return interaction.reply({
                content:
                    `✅ Autorole set to ${role}.`
            });
        }

        if (
            sub === 'disable'
        ) {
            config.autorole.enabled = false;

            saveDatabase();

            return interaction.reply({
                content:
                    '✅ Autorole disabled.'
            });
        }

        return interaction.reply({
            content:
                `🤖 Autorole: ${config.autorole.enabled ? 'ON' : 'OFF'}\nRole: ${config.autorole.roleId ? `<@&${config.autorole.roleId}>` : 'None'}`,
            ephemeral: true
        });
    }

    /* =====================================================
       WELCOME
    ===================================================== */

    if (
        command === 'welcome'
    ) {
        if (!isManager(member)) {
            return interaction.reply({
                content:
                    '❌ Manager permission required.',
                ephemeral: true
            });
        }

        const sub =
            interaction.options.getSubcommand();

        if (
            sub === 'set'
        ) {
            config.welcome.enabled = true;

            config.welcome.channelId =
                interaction.options.getChannel(
                    'channel'
                ).id;

            config.welcome.message =
                interaction.options.getString(
                    'message'
                );

            saveDatabase();

            return interaction.reply({
                content:
                    '✅ Welcome system configured.'
            });
        }

        if (
            sub === 'disable'
        ) {
            config.welcome.enabled = false;

            saveDatabase();

            return interaction.reply({
                content:
                    '✅ Welcome disabled.'
            });
        }

        return interaction.reply({
            content:
                `👋 Welcome: ${config.welcome.enabled ? 'ON' : 'OFF'}\nChannel: ${config.welcome.channelId ? `<#${config.welcome.channelId}>` : 'None'}\nMessage: ${config.welcome.message}`,
            ephemeral: true
        });
    }

    /* =====================================================
       VERIFICATION
    ===================================================== */

    if (
        command === 'verification'
    ) {
        if (!isManager(member)) {
            return interaction.reply({
                content:
                    '❌ Manager permission required.',
                ephemeral: true
            });
        }

        const sub =
            interaction.options.getSubcommand();

        if (
            sub === 'setup'
        ) {
            const channel =
                interaction.options.getChannel(
                    'channel'
                );

            const role =
                interaction.options.getRole(
                    'role'
                );

            if (
                guild.members.me &&
                role.position >=
                guild.members.me.roles.highest.position
            ) {
                return interaction.reply({
                    content:
                        '❌ My bot role must be higher than the verification role.',
                    ephemeral: true
                });
            }

            const embed =
                new EmbedBuilder()
                    .setTitle(
                        '✅ Verification'
                    )
                    .setDescription(
                        'Click the button below to verify yourself.'
                    );

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
                            .setEmoji('✅')
                            .setStyle(
                                ButtonStyle.Success
                            )
                    );

            const msg =
                await channel.send({
                    embeds: [embed],
                    components: [row]
                });

            config.verification = {
                enabled: true,
                channelId: channel.id,
                roleId: role.id,
                messageId: msg.id
            };

            saveDatabase();

            return interaction.reply({
                content:
                    '✅ Verification system configured.'
            });
        }

        if (
            sub === 'disable'
        ) {
            config.verification.enabled =
                false;

            saveDatabase();

            return interaction.reply({
                content:
                    '✅ Verification disabled.'
            });
        }

        return interaction.reply({
            content:
                `Verification: ${config.verification.enabled ? 'ON' : 'OFF'}\nRole: ${config.verification.roleId ? `<@&${config.verification.roleId}>` : 'None'}`,
            ephemeral: true
        });
    }

    /* =====================================================
       REACTION ROLE
    ===================================================== */

    if (
        command === 'autoreactionrole'
    ) {
        if (!isManager(member)) {
            return interaction.reply({
                content:
                    '❌ Manager permission required.',
                ephemeral: true
            });
        }

        const sub =
            interaction.options.getSubcommand();

        if (
            sub === 'add'
        ) {
            const messageId =
                interaction.options.getString(
                    'message_id'
                );

            const rawEmoji =
                interaction.options.getString(
                    'emoji'
                );

            const role =
                interaction.options.getRole(
                    'role'
                );

            const key =
                normalizeEmoji(
                    rawEmoji
                );

            if (
                guild.members.me &&
                role.position >=
                guild.members.me.roles.highest.position
            ) {
                return interaction.reply({
                    content:
                        '❌ My bot role must be higher than this role.',
                    ephemeral: true
                });
            }

            const channel =
                interaction.channel;

            const message =
                await channel.messages.fetch(
                    messageId
                ).catch(() => null);

            if (!message) {
                return interaction.reply({
                    content:
                        '❌ Message not found in this channel.',
                    ephemeral: true
                });
            }

            try {
                await message.react(
                    rawEmoji
                );
            } catch (error) {
                console.error(
                    'Reaction add error:',
                    error
                );

                return interaction.reply({
                    content:
                        '❌ I could not add that reaction. Check emoji permissions.',
                    ephemeral: true
                });
            }

            config.reactionRoles[
                messageId
            ] ??= {};

            config.reactionRoles[
                messageId
            ][key] = {
                emoji: rawEmoji,
                roleId: role.id
            };

            saveDatabase();

            return interaction.reply({
                content:
                    `✅ Reaction role added: ${rawEmoji} → ${role}`,
                ephemeral: true
            });
        }

        if (
            sub === 'remove'
        ) {
            const messageId =
                interaction.options.getString(
                    'message_id'
                );

            const rawEmoji =
                interaction.options.getString(
                    'emoji'
                );

            const key =
                normalizeEmoji(
                    rawEmoji
                );

            if (
                config.reactionRoles[
                    messageId
                ]
            ) {
                delete config.reactionRoles[
                    messageId
                ][key];
            }

            saveDatabase();

            return interaction.reply({
                content:
                    '✅ Reaction role removed.',
                ephemeral: true
            });
        }

        if (
            sub === 'list'
        ) {
            const entries = [];

            for (
                const [messageId, reactions]
                of Object.entries(
                    config.reactionRoles
                )
            ) {
                for (
                    const [emoji, data]
                    of Object.entries(
                        reactions
                    )
                ) {
                    entries.push(
                        `${messageId} • ${data.emoji} → <@&${data.roleId}>`
                    );
                }
            }

            return interaction.reply({
                content:
                    entries.length
                        ? entries.join('\n').slice(
                            0,
                            1900
                        )
                        : 'No reaction roles configured.',
                ephemeral: true
            });
        }
    }

    /* =====================================================
       LEADERBOARD
    ===================================================== */

    if (
        command === 'leaderboard'
    ) {
        const sub =
            interaction.options.getSubcommand();

        if (
            ['reset', 'enable', 'disable']
                .includes(sub) &&
            !isManager(member)
        ) {
            return interaction.reply({
                content:
                    '❌ Manager permission required.',
                ephemeral: true
            });
        }

        if (
            sub === 'enable'
        ) {
            config.leaderboard.enabled =
                true;

            saveDatabase();

            return interaction.reply({
                content:
                    '🏆 Leaderboard enabled.'
            });
        }

        if (
            sub === 'disable'
        ) {
            config.leaderboard.enabled =
                false;

            saveDatabase();

            return interaction.reply({
                content:
                    '🏆 Leaderboard disabled.'
            });
        }

        if (
            sub === 'reset'
        ) {
            config.leaderboard.messages = {};

            saveDatabase();

            return interaction.reply({
                content:
                    '✅ Leaderboard reset.'
            });
        }

        if (
            sub === 'status'
        ) {
            return interaction.reply({
                content:
                    `🏆 Leaderboard: ${config.leaderboard.enabled ? 'ON' : 'OFF'}`,
                ephemeral: true
            });
        }

        const entries =
            Object.entries(
                config.leaderboard.messages
            )
            .sort(
                (a, b) => b[1] - a[1]
            )
            .slice(0, 10);

        if (!entries.length) {
            return interaction.reply({
                content:
                    '🏆 No leaderboard data yet.'
            });
        }

        const text =
            entries
                .map(
                    ([id, count], index) =>
                        `**${index + 1}.** <@${id}> — **${count}** messages`
                )
                .join('\n');

        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setTitle(
                        '🏆 AkiyO Leaderboard'
                    )
                    .setDescription(text)
                    .setTimestamp()
            ]
        });
    }

    /* =====================================================
       ADS
    ===================================================== */

    if (
        command === 'ads'
    ) {
        if (
            !(await isApplicationOwner(
                interaction.user.id
            ))
        ) {
            return interaction.reply({
                content:
                    '❌ Bot owner only.',
                ephemeral: true
            });
        }

        const sub =
            interaction.options.getSubcommand();

        if (
            sub === 'set'
        ) {
            config.ads.channelId =
                interaction.options.getChannel(
                    'channel'
                ).id;

            saveDatabase();

            return interaction.reply({
                content:
                    '✅ Ad channel configured.'
            });
        }

        if (
            sub === 'message'
        ) {
            config.ads.message =
                interaction.options.getString(
                    'text'
                );

            saveDatabase();

            return interaction.reply({
                content:
                    '✅ Ad message updated.'
            });
        }

        if (
            sub === 'interval'
        ) {
            config.ads.intervalMinutes =
                interaction.options.getInteger(
                    'minutes'
                );

            saveDatabase();

            return interaction.reply({
                content:
                    '✅ Ad interval updated.'
            });
        }

        if (
            sub === 'enable'
        ) {
            config.ads.enabled = true;

            saveDatabase();

            return interaction.reply({
                content:
                    '✅ Ads enabled.'
            });
        }

        if (
            sub === 'disable'
        ) {
            config.ads.enabled = false;

            saveDatabase();

            return interaction.reply({
                content:
                    '✅ Ads disabled.'
            });
        }

        if (
            sub === 'status'
        ) {
            return interaction.reply({
                content:
                    `📢 Ads: ${config.ads.enabled ? 'ON' : 'OFF'}\n` +
                    `Channel: ${config.ads.channelId ? `<#${config.ads.channelId}>` : 'None'}\n` +
                    `Interval: ${config.ads.intervalMinutes} minutes`,
                ephemeral: true
            });
        }

        if (
            sub === 'broadcast'
        ) {
            if (!config.ads.channelId) {
                return interaction.reply({
                    content:
                        '❌ Ad channel not configured.',
                    ephemeral: true
                });
            }

            const channel =
                await guild.channels.fetch(
                    config.ads.channelId
                ).catch(() => null);

            if (!channel?.isTextBased()) {
                return interaction.reply({
                    content:
                        '❌ Invalid ad channel.',
                    ephemeral: true
                });
            }

            await channel.send(
                config.ads.message
            );

            return interaction.reply({
                content:
                    '✅ Ad broadcasted.'
            });
        }
    }

    /* =====================================================
       AI
    ===================================================== */

    if (
        command === 'ai'
    ) {
        return handleAI(
            interaction
        );
    }
}

/* =========================================================
   AI HANDLER
========================================================= */

async function handleAI(
    interaction
) {
    if (!OPENAI_API_KEY) {
        return interaction.reply({
            content:
                '❌ AI is not configured. Add `OPENAI_API_KEY` to the bot environment variables.',
            ephemeral: true
        });
    }

    const sub =
        interaction.options.getSubcommand();

    const key =
        `${interaction.guild?.id || 'dm'}:${interaction.user.id}`;

    if (
        sub === 'reset'
    ) {
        aiHistory.delete(key);

        return interaction.reply({
            content:
                '🧠 Your AI conversation has been reset.',
            ephemeral: true
        });
    }

    const prompt =
        interaction.options.getString(
            'prompt'
        );

    if (!prompt) {
        return interaction.reply({
            content:
                '❌ Please provide a prompt.',
            ephemeral: true
        });
    }

    await interaction.deferReply();

    let history =
        aiHistory.get(key) || [];

    history.push({
        role: 'user',
        content: prompt
    });

    history =
        history.slice(-10);

    try {
        const response =
            await fetch(
                'https://api.openai.com/v1/responses',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type':
                            'application/json',
                        'Authorization':
                            `Bearer ${OPENAI_API_KEY}`
                    },
                    body: JSON.stringify({
                        model:
                            OPENAI_MODEL,
                        input:
                            history
                    })
                }
            );

        const data =
            await response.json();

        if (!response.ok) {
            console.error(
                'OpenAI error:',
                data
            );

            return interaction.editReply(
                '❌ AI request failed. Check your OpenAI API key/model.'
            );
        }

        const answer =
            data.output_text ||
            data.output?.flatMap(
                x => x.content || []
            )
            ?.map(
                x => x.text || ''
            )
            ?.join('') ||
            'No response received.';

        history.push({
            role: 'assistant',
            content: answer
        });

        aiHistory.set(
            key,
            history.slice(-10)
        );

        return interaction.editReply(
            answer.slice(0, 1900)
        );
    } catch (error) {
        console.error(
            'AI error:',
            error
        );

        return interaction.editReply(
            '❌ AI service error.'
        );
    }
}

/* =========================================================
   BUTTON HANDLER
========================================================= */

async function handleButton(
    interaction
) {
    if (!interaction.isButton()) {
        return false;
    }

    /* CREATE TICKET */

    if (
        interaction.customId ===
        'create_ticket'
    ) {
        if (!interaction.guild) {
            return true;
        }

        const result =
            await createTicket(
                interaction.guild,
                interaction.user
            );

        if (result.error) {
            await interaction.reply({
                content:
                    `❌ ${result.error}`,
                ephemeral: true
            });

            return true;
        }

        await interaction.reply({
            content:
                `🎫 Ticket created: ${result.channel}`,
            ephemeral: true
        });

        return true;
    }

    /* VERIFY */

    if (
        interaction.customId ===
        'verify_member'
    ) {
        if (!interaction.guild) {
            return true;
        }

        const config =
            getGuildConfig(
                interaction.guild
            );

        if (
            !config.verification.enabled ||
            !config.verification.roleId
        ) {
            await interaction.reply({
                content:
                    '❌ Verification is not configured.',
                ephemeral: true
            });

            return true;
        }

        const role =
            await interaction.guild.roles.fetch(
                config.verification.roleId
            ).catch(() => null);

        if (!role) {
            await interaction.reply({
                content:
                    '❌ Verification role not found.',
                ephemeral: true
            });

            return true;
        }

        if (
            interaction.guild.members.me &&
            role.position >=
            interaction.guild.members.me.roles.highest.position
        ) {
            await interaction.reply({
                content:
                    '❌ Bot role is below the verification role.',
                ephemeral: true
            });

            return true;
        }

        await interaction.member.roles.add(
            role,
            'AkiyO verification'
        ).catch(() => null);

        await interaction.reply({
            content:
                '✅ You are verified.',
            ephemeral: true
        });

        await sendLog(
            interaction.guild,
            'verification',
            '✅ Member Verified',
            [
                field(
                    'User',
                    interaction.user.tag
                ),
                field(
                    'Role',
                    role.name
                )
            ]
        );

        return true;
    }

    /* SUGGESTION */

    if (
        interaction.customId.startsWith(
            'suggest_'
        )
    ) {
        if (!interaction.guild) {
            return true;
        }

        if (
            !isStaff(
                interaction.member
            )
        ) {
            await interaction.reply({
                content:
                    '❌ Staff only.',
                ephemeral: true
            });

            return true;
        }

        const parts =
            interaction.customId.split(
                '_'
            );

        const action =
            parts[1];

        const id =
            parts[2];

        const config =
            getGuildConfig(
                interaction.guild
            );

        const suggestion =
            config.suggestions.records[id];

        if (!suggestion) {
            await interaction.reply({
                content:
                    '❌ Suggestion record not found.',
                ephemeral: true
            });

            return true;
        }

        if (
            suggestion.status !==
            'pending'
        ) {
            await interaction.reply({
                content:
                    '❌ This suggestion has already been processed.',
                ephemeral: true
            });

            return true;
        }

        suggestion.status =
            action === 'approve'
                ? 'approved'
                : 'declined';

        suggestion.moderatorId =
            interaction.user.id;

        saveDatabase();

        const embed =
            new EmbedBuilder()
                .setTitle(
                    '💡 Suggestion'
                )
                .setDescription(
                    suggestion.text
                )
                .addFields(
                    field(
                        'Author',
                        `<@${suggestion.userId}>`,
                        true
                    ),
                    field(
                        'Status',
                        action === 'approve'
                            ? '🟢 Approved'
                            : '🔴 Declined',
                        true
                    ),
                    field(
                        'Moderator',
                        interaction.user.tag,
                        true
                    )
                )
                .setTimestamp();

        await interaction.message.edit({
            embeds: [embed],
            components: []
        }).catch(() => {});

        await interaction.reply({
            content:
                action === 'approve'
                    ? '✅ Suggestion approved.'
                    : '❌ Suggestion declined.',
            ephemeral: true
        });

        await sendLog(
            interaction.guild,
            'suggestion',
            '💡 Suggestion Updated',
            [
                field(
                    'Suggestion',
                    suggestion.text
                ),
                field(
                    'Status',
                    suggestion.status
                ),
                field(
                    'Moderator',
                    interaction.user.tag
                )
            ]
        );

        return true;
    }

    /* TICKET BUTTON */

    if (
        interaction.customId.startsWith(
            'ticket_'
        )
    ) {
        if (!interaction.guild) {
            return true;
        }

        const parts =
            interaction.customId.split(
                '_'
            );

        const action =
            parts[1];

        const ticketId =
            parts[2];

        const ticket =
            getTicket(
                interaction.guild,
                ticketId
            );

        if (!ticket) {
            await interaction.reply({
                content:
                    '❌ Ticket not found.',
                ephemeral: true
            });

            return true;
        }

        const staff =
            isStaff(
                interaction.member
            );

        if (
            ['claim', 'lock', 'transcript']
                .includes(action) &&
            !staff
        ) {
            await interaction.reply({
                content:
                    '❌ Support staff only.',
                ephemeral: true
            });

            return true;
        }

        if (
            action === 'claim'
        ) {
            ticket.claimedBy =
                interaction.user.id;

            saveDatabase();

            await interaction.reply({
                content:
                    `✅ Ticket claimed by ${interaction.user}.`
            });

            return true;
        }

        if (
            action === 'close'
        ) {
            if (
                ticket.ownerId !==
                interaction.user.id &&
                !staff
            ) {
                await interaction.reply({
                    content:
                        '❌ You cannot close this ticket.',
                    ephemeral: true
                });

                return true;
            }

            ticket.status =
                'closed';

            ticket.closedAt =
                Date.now();

            await interaction.channel.permissionOverwrites.edit(
                ticket.ownerId,
                {
                    SendMessages: false
                }
            ).catch(() => {});

            saveDatabase();

            await interaction.reply({
                content:
                    '🔴 Ticket closed.'
            });

            return true;
        }

        if (
            action === 'lock'
        ) {
            ticket.locked = true;

            await interaction.channel.permissionOverwrites.edit(
                ticket.ownerId,
                {
                    SendMessages: false
                }
            ).catch(() => {});

            saveDatabase();

            await interaction.reply({
                content:
                    '🔒 Ticket locked.'
            });

            return true;
        }

        if (
            action === 'transcript'
        ) {
            const messages =
                await interaction.channel.messages
                    .fetch({
                        limit: 100
                    });

            const sorted =
                [...messages.values()]
                    .reverse();

            let text =
                `AKIYO TICKET #${ticket.id}\n\n`;

            for (
                const message of sorted
            ) {
                text +=
                    `[${message.createdAt.toISOString()}] ${message.author.tag}: ${message.content || '[attachment]'}\n`;
            }

            const attachment =
                new AttachmentBuilder(
                    Buffer.from(
                        text,
                        'utf8'
                    ),
                    {
                        name:
                            `ticket-${ticket.id}.txt`
                    }
                );

            await interaction.reply({
                content:
                    '📄 Transcript',
                files: [attachment],
                ephemeral: true
            });

            return true;
        }

        if (
            action === 'reopen'
        ) {
            ticket.status =
                'open';

            ticket.closedAt =
                null;

            await interaction.channel.permissionOverwrites.edit(
                ticket.ownerId,
                {
                    SendMessages: true
                }
            ).catch(() => {});

            saveDatabase();

            await interaction.reply({
                content:
                    '🟢 Ticket reopened.'
            });

            return true;
        }

        if (
            action === 'delete'
        ) {
            if (!staff) {
                await interaction.reply({
                    content:
                        '❌ Staff only.',
                    ephemeral: true
                });

                return true;
            }

            ticket.status =
                'deleted';

            saveDatabase();

            await interaction.reply({
                content:
                    '🗑️ Deleting ticket...'
            });

            await interaction.channel
                .delete()
                .catch(() => {});

            return true;
        }
    }

    return false;
}

/* =========================================================
   MESSAGE CREATE
========================================================= */

client.on(
    Events.MessageCreate,
    async message => {
        if (message.author.bot) {
            return;
        }

        try {

            /* DM → TICKET */

            if (!message.guild) {

                let found = null;
                let foundGuild = null;

                for (
                    const guild of client.guilds.cache.values()
                ) {
                    const ticket =
                        getActiveTicket(
                            guild,
                            message.author.id
                        );

                    if (ticket) {
                        found = ticket;
                        foundGuild = guild;
                        break;
                    }
                }

                if (!found || !foundGuild) {
                    return;
                }

                const channel =
                    await foundGuild.channels.fetch(
                        found.channelId
                    ).catch(() => null);

                if (!channel?.isTextBased()) {
                    return;
                }

                const files = [];

                for (
                    const attachment
                    of message.attachments.values()
                ) {
                    files.push({
                        attachment:
                            attachment.url,
                        name:
                            attachment.name ||
                            'attachment'
                    });
                }

                await channel.send({
                    content:
                        `📩 **${message.author.tag}:**\n${message.content || ''}`,
                    files
                }).catch(() => {});

                return;
            }

            /* LEADERBOARD */

            const config =
                getGuildConfig(
                    message.guild
                );

            if (
                config.leaderboard.enabled
            ) {
                config.leaderboard.messages[
                    message.author.id
                ] =
                    (
                        config.leaderboard.messages[
                            message.author.id
                        ] || 0
                    ) + 1;

                if (
                    Math.random() < 0.05
                ) {
                    saveDatabase();
                }
            }

            /* TICKET STAFF → DM */

            const ticket =
                getTicketByChannel(
                    message.guild,
                    message.channel.id
                );

            if (
                ticket &&
                isStaff(message.member)
            ) {
                try {
                    const user =
                        await client.users.fetch(
                            ticket.ownerId
                        );

                    if (
                        message.content ||
                        message.attachments.size
                    ) {
                        await user.send({
                            content:
                                `📩 **Support Team:**\n${message.content || ''}`,
                            files:
                                [...message.attachments.values()]
                                    .map(
                                        a => ({
                                            attachment:
                                                a.url,
                                            name:
                                                a.name ||
                                                'attachment'
                                        })
                                    )
                        });
                    }
                } catch {}
            }

            /* AUTOMOD */

            await handleAutoMod(
                message
            );

        } catch (error) {
            console.error(
                'MessageCreate error:',
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
            const config =
                getGuildConfig(
                    member.guild
                );

            /* RAID */

            const key =
                member.guild.id;

            const now =
                Date.now();

            let joins =
                raidTracker.get(key) || [];

            joins =
                joins.filter(
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
                config.security.enabled &&
                joins.length >=
                config.security.raidJoinCount
            ) {
                await sendLog(
                    member.guild,
                    'security',
                    '🚨 Possible Raid Detected',
                    [
                        field(
                            'Recent Joins',
                            joins.length
                        ),
                        field(
                            'Window',
                            `${config.security.raidWindow}ms`
                        )
                    ]
                );
            }

            /* AUTOROLE */

            if (
                config.autorole.enabled &&
                config.autorole.roleId
            ) {
                const role =
                    await member.guild.roles.fetch(
                        config.autorole.roleId
                    ).catch(() => null);

                if (
                    role &&
                    member.guild.members.me &&
                    role.position <
                    member.guild.members.me.roles.highest.position
                ) {
                    await member.roles.add(
                        role,
                        'AkiyO Autorole'
                    ).catch(
                        error =>
                            console.error(
                                'Autorole error:',
                                error
                            )
                    );
                }
            }

            /* WELCOME */

            if (
                config.welcome.enabled &&
                config.welcome.channelId
            ) {
                const channel =
                    await member.guild.channels.fetch(
                        config.welcome.channelId
                    ).catch(() => null);

                if (
                    channel?.isTextBased()
                ) {
                    await channel.send(
                        replaceWelcome(
                            config.welcome.message,
                            member
                        )
                    ).catch(() => {});
                }
            }

            await sendLog(
                member.guild,
                'members',
                '👋 Member Joined',
                [
                    field(
                        'User',
                        `${member.user.tag}`
                    ),
                    field(
                        'ID',
                        member.id
                    )
                ]
            );

        } catch (error) {
            console.error(
                'GuildMemberAdd error:',
                error
            );
        }
    }
);

/* =========================================================
   MEMBER LEAVE
========================================================= */

client.on(
    Events.GuildMemberRemove,
    async member => {
        try {
            await sendLog(
                member.guild,
                'members',
                '👋 Member Left',
                [
                    field(
                        'User',
                        member.user?.tag ||
                        member.id
                    ),
                    field(
                        'ID',
                        member.id
                    )
                ]
            );
        } catch {}
    }
);

/* =========================================================
   REACTION ADD
========================================================= */

client.on(
    Events.MessageReactionAdd,
    async (
        reaction,
        user
    ) => {
        if (user.bot) return;

        try {
            if (
                reaction.partial
            ) {
                await reaction.fetch();
            }

            const guild =
                reaction.message.guild;

            if (!guild) return;

            const config =
                getGuildConfig(guild);

            const rules =
                config.reactionRoles[
                    reaction.message.id
                ];

            if (!rules) return;

            const key =
                reactionKey(
                    reaction
                );

            const rule =
                rules[key];

            if (!rule) return;

            const member =
                await guild.members.fetch(
                    user.id
                );

            const role =
                await guild.roles.fetch(
                    rule.roleId
                ).catch(() => null);

            if (!role) {
                await sendLog(
                    guild,
                    'reactionRoles',
                    '❌ Reaction Role Failed',
                    [
                        field(
                            'User',
                            user.tag
                        ),
                        field(
                            'Role ID',
                            rule.roleId
                        )
                    ]
                );

                return;
            }

            if (
                guild.members.me &&
                role.position >=
                guild.members.me.roles.highest.position
            ) {
                await sendLog(
                    guild,
                    'reactionRoles',
                    '❌ Reaction Role Hierarchy Error',
                    [
                        field(
                            'Role',
                            role.name
                        )
                    ]
                );

                return;
            }

            await member.roles.add(
                role,
                'AkiyO Reaction Role'
            ).catch(
                error =>
                    console.error(
                        'Reaction role add:',
                        error
                    )
            );

        } catch (error) {
            console.error(
                'Reaction add error:',
                error
            );
        }
    }
);

/* =========================================================
   REACTION REMOVE
========================================================= */

client.on(
    Events.MessageReactionRemove,
    async (
        reaction,
        user
    ) => {
        if (user.bot) return;

        try {
            if (
                reaction.partial
            ) {
                await reaction.fetch();
            }

            const guild =
                reaction.message.guild;

            if (!guild) return;

            const config =
                getGuildConfig(guild);

            const rules =
                config.reactionRoles[
                    reaction.message.id
                ];

            if (!rules) return;

            const key =
                reactionKey(
                    reaction
                );

            const rule =
                rules[key];

            if (!rule) return;

            const member =
                await guild.members.fetch(
                    user.id
                ).catch(() => null);

            if (!member) return;

            await member.roles.remove(
                rule.roleId,
                'AkiyO Reaction Role'
            ).catch(
                error =>
                    console.error(
                        'Reaction role remove:',
                        error
                    )
            );

        } catch (error) {
            console.error(
                'Reaction remove error:',
                error
            );
        }
    }
);

/* =========================================================
   AUDIT LOG / ANTI-NUKE
========================================================= */

client.on(
    Events.GuildAuditLogEntryCreate,
    async (
        auditLogEntry,
        guild
    ) => {
        try {
            const config =
                getGuildConfig(
                    guild
                );

            if (
                !config.security.enabled
            ) {
                return;
            }

            const executorId =
                auditLogEntry.executorId;

            const targetId =
                auditLogEntry.targetId;

            if (!executorId) {
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

            let actionName =
                'Unknown';

            let threshold =
                null;

            switch (
                auditLogEntry.action
            ) {
                case AuditLogEvent.MemberBanAdd:
                    actionName = 'ban';
                    threshold =
                        config.security.massBan;
                    break;

                case AuditLogEvent.MemberKick:
                    actionName = 'kick';
                    threshold =
                        config.security.massKick;
                    break;

                case AuditLogEvent.ChannelDelete:
                    actionName =
                        'channel_delete';
                    threshold =
                        config.security.massChannelDelete;
                    break;

                case AuditLogEvent.ChannelCreate:
                    actionName =
                        'channel_create';
                    threshold =
                        config.security.massChannelCreate;
                    break;

                case AuditLogEvent.RoleDelete:
                    actionName =
                        'role_delete';
                    threshold =
                        config.security.massRoleDelete;
                    break;

                case AuditLogEvent.RoleCreate:
                    actionName =
                        'role_create';
                    threshold =
                        config.security.massRoleCreate;
                    break;

                case AuditLogEvent.WebhookCreate:
                case AuditLogEvent.WebhookDelete:
                case AuditLogEvent.WebhookUpdate:
                    actionName =
                        'webhook';
                    threshold = 1;
                    break;

                case AuditLogEvent.BotAdd:
                    actionName =
                        'bot_add';
                    threshold = 1;
                    break;

                default:
                    return;
            }

            await sendLog(
                guild,
                'audit',
                '📋 Audit Log Event',
                [
                    field(
                        'Action',
                        actionName
                    ),
                    field(
                        'Executor',
                        `<@${executorId}>`
                    ),
                    field(
                        'Target',
                        targetId || 'Unknown'
                    )
                ]
            );

            if (
                securityCounter(
                    guild.id,
                    executorId,
                    actionName,
                    threshold
                )
            ) {
                await securityAction(
                    guild,
                    executorId,
                    actionName,
                    targetId,
                    `Security threshold reached: ${actionName}`
                );
            }

            /* PROTECTED ROLE */

            if (
                actionName ===
                    'role_delete' &&
                targetId &&
                config.security.protectedRoles
                    .includes(targetId)
            ) {
                await securityAction(
                    guild,
                    executorId,
                    actionName,
                    targetId,
                    'Protected role deleted'
                );
            }

            /* PROTECTED CHANNEL */

            if (
                actionName ===
                    'channel_delete' &&
                targetId &&
                config.security.protectedChannels
                    .includes(targetId)
            ) {
                await securityAction(
                    guild,
                    executorId,
                    actionName,
                    targetId,
                    'Protected channel deleted'
                );
            }

        } catch (error) {
            console.error(
                'Audit log error:',
                error
            );
        }
    }
);

/* =========================================================
   INTERACTION CREATE
========================================================= */

client.on(
    Events.InteractionCreate,
    async interaction => {
        try {

            if (
                await handleButton(
                    interaction
                )
            ) {
                return;
            }

            if (
                interaction.isChatInputCommand()
            ) {
                if (
                    interaction.commandName ===
                    'ai'
                ) {
                    await handleAI(
                        interaction
                    );

                    return;
                }

                await handleCommand(
                    interaction
                );
            }

        } catch (error) {
            console.error(
                'Interaction error:',
                error
            );

            try {
                if (
                    interaction.deferred
                ) {
                    await interaction.editReply(
                        '❌ Something went wrong while processing the command.'
                    );
                } else if (
                    interaction.replied
                ) {
                    await interaction.followUp({
                        content:
                            '❌ Something went wrong.',
                        ephemeral: true
                    });
                } else {
                    await interaction.reply({
                        content:
                            '❌ Something went wrong.',
                        ephemeral: true
                    });
                }
            } catch {}
        }
    }
);

/* =========================================================
   ADS LOOP
========================================================= */

setInterval(
    async () => {
        try {
            for (
                const guild
                of client.guilds.cache.values()
            ) {
                const config =
                    getGuildConfig(
                        guild
                    );

                if (
                    !config.ads.enabled ||
                    !config.ads.channelId
                ) {
                    continue;
                }

                const channel =
                    await guild.channels.fetch(
                        config.ads.channelId
                    ).catch(() => null);

                if (
                    !channel?.isTextBased()
                ) {
                    continue;
                }

                await channel.send(
                    config.ads.message
                ).catch(() => {});
            }
        } catch (error) {
            console.error(
                'Ads loop error:',
                error
            );
        }
    },
    60 * 1000
);

/* =========================================================
   DATABASE AUTOSAVE
========================================================= */

setInterval(
    () => {
        saveDatabase();
    },
    60 * 1000
);

/* =========================================================
   READY
========================================================= */

client.once(
    Events.ClientReady,
    async () => {
        console.log(
            `🤖 AkiyO Online as ${client.user.tag}`
        );

        console.log(
            `🌐 Servers: ${client.guilds.cache.size}`
        );

        console.log(
            `📦 Commands: ${commands.length}`
        );

        await registerCommands();

        console.log(
            '🎫 Ticket system ready'
        );

        console.log(
            '🛡️ AutoMod ready'
        );

        console.log(
            '🔐 Security system ready'
        );

        console.log(
            '🔨 Moderation system ready'
        );

        console.log(
            '🏆 Leaderboard ready'
        );

        console.log(
            '🎭 Reaction roles ready'
        );

        console.log(
            '🤖 AkiyO is fully operational.'
        );
    }
);

/* =========================================================
   ERROR HANDLERS
========================================================= */

process.on(
    'unhandledRejection',
    error => {
        console.error(
            '❌ Unhandled rejection:',
            error
        );
    }
);

process.on(
    'uncaughtException',
    error => {
        console.error(
            '❌ Uncaught exception:',
            error
        );
    }
);

/* =========================================================
   LOGIN
========================================================= */

client.login(TOKEN)
    .then(() => {
        console.log(
            '🔑 Discord login successful.'
        );
    })
    .catch(error => {
        console.error(
            '❌ Discord login failed:',
            error
        );

        process.exit(1);
    });
