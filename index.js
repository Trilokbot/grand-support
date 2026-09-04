'use strict';

/*
===========================================================
                    AKIYO DISCORD BOT
===========================================================

Single-file multi-server Discord bot.

SYSTEMS:
• Help
• Bot info
• AI
• Tickets
• DM tickets
• Ticket panel
• Ticket claim/unclaim
• Ticket close/reopen
• Ticket lock/unlock
• Ticket add/remove
• Ticket rename/info/stats
• Ticket transcripts
• AutoMod
• Spam protection
• Repeated-message protection
• Bad-word protection
• Caps protection
• Invite protection
• Mass mention protection
• Moderation
• Warn / timeout / kick / ban / unban
• Warning history
• Punishment history
• Warning escalation
• Anti-raid
• Anti-nuke
• Anti-webhook
• Anti-bot
• Trusted users
• Trusted bots
• Trusted members
• Trusted role
• Protected roles
• Protected channels
• Audit logs
• Logging
• Suggestions
• Suggestion approve/decline
• Autorole
• Welcome
• Verification
• FULL reaction roles
• Unicode/custom reaction roles
• Leaderboard
• Announcements
• Owner advertisements
• Persistent JSON database
• Health server
• Multi-server configuration
===========================================================
*/

const fs = require('fs');
const path = require('path');
const http = require('http');

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
   ENVIRONMENT
========================================================= */

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

if (!TOKEN) {
    console.error('Missing DISCORD_TOKEN environment variable.');
    process.exit(1);
}

if (!CLIENT_ID) {
    console.error('Missing CLIENT_ID environment variable.');
    process.exit(1);
}

const PORT = Number(process.env.PORT) || 10000;

/* =========================================================
   HEALTH SERVER
========================================================= */

http.createServer((req, res) => {
    res.writeHead(200, {
        'Content-Type': 'text/plain'
    });

    res.end('AkiyO Bot Online');
}).listen(PORT, '0.0.0.0', () => {
    console.log(`Health server listening on port ${PORT}`);
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

const DEFAULT_GUILD = {
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
            spam: 'timeout',
            invite: 'delete',
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

        action: 'alert',

        raidJoinCount: 10,
        raidWindow: 10000,

        massBan: 3,
        massKick: 3,

        massChannelDelete: 3,
        massChannelCreate: 5,

        massRoleDelete: 3,
        massRoleCreate: 5,

        massWebhookCreate: 2,

        trustedUsers: [],
        trustedBots: [],
        trustedMembers: [],

        trustedRoleId: null,

        protectedRoles: [],
        protectedChannels: [],

        logChannelId: null
    },

    logs: Object.fromEntries(
        LOG_TYPES.map(type => [type, null])
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
        intervalMinutes: 60
    },

    warnings: {},

    punishments: {},

    suggestions: {},

    tickets: {}
};

const DEFAULT_DATABASE = {
    guilds: {},
    dmTickets: {},
    meta: {
        version: 10
    }
};

function clone(object) {
    return JSON.parse(JSON.stringify(object));
}

function mergeObjects(target, source) {
    for (const key of Object.keys(source || {})) {

        if (
            source[key] &&
            typeof source[key] === 'object' &&
            !Array.isArray(source[key])
        ) {
            target[key] = mergeObjects(
                target[key] || {},
                source[key]
            );
        } else if (source[key] !== undefined) {
            target[key] = source[key];
        }
    }

    return target;
}

function loadDatabase() {
    try {

        if (!fs.existsSync(DATA_FILE)) {
            return clone(DEFAULT_DATABASE);
        }

        const raw = fs.readFileSync(
            DATA_FILE,
            'utf8'
        );

        return mergeObjects(
            clone(DEFAULT_DATABASE),
            JSON.parse(raw)
        );

    } catch (error) {

        console.error(
            'Database load error:',
            error
        );

        return clone(DEFAULT_DATABASE);
    }
}

let db = loadDatabase();

function saveDatabase() {

    try {

        const temporary =
            DATA_FILE + '.tmp';

        fs.writeFileSync(
            temporary,
            JSON.stringify(db, null, 2)
        );

        fs.renameSync(
            temporary,
            DATA_FILE
        );

    } catch (error) {

        console.error(
            'Database save error:',
            error
        );
    }
}

/* =========================================================
   GUILD CONFIG
========================================================= */

function getGuildConfig(guild) {

    if (!guild) {
        return null;
    }

    if (!db.guilds[guild.id]) {
        db.guilds[guild.id] =
            clone(DEFAULT_GUILD);
    }

    db.guilds[guild.id] =
        mergeObjects(
            clone(DEFAULT_GUILD),
            db.guilds[guild.id]
        );

    return db.guilds[guild.id];
}

/* =========================================================
   MEMORY
========================================================= */

const spamTracker = new Map();
const repeatTracker = new Map();
const securityTracker = new Map();
const raidTracker = new Map();

const ticketCache = new Map();
const ticketClaims = new Map();

const aiHistory = new Map();

/* =========================================================
   UTILITIES
========================================================= */

function field(name, value, inline = false) {

    return {
        name: String(name).slice(0, 256),
        value: String(value ?? '-').slice(0, 1024),
        inline
    };
}

function isGuildInteraction(interaction) {
    return Boolean(interaction.guild);
}

function isStaff(member) {

    if (!member) {
        return false;
    }

    const config =
        getGuildConfig(member.guild);

    if (
        member.permissions.has(
            PermissionFlagsBits.Administrator
        )
    ) {
        return true;
    }

    if (
        member.permissions.has(
            PermissionFlagsBits.ManageGuild
        )
    ) {
        return true;
    }

    if (
        config.ticket.staffRoleId &&
        member.roles.cache.has(
            config.ticket.staffRoleId
        )
    ) {
        return true;
    }

    return false;
}

function isManager(member) {

    return Boolean(
        member &&
        (
            member.permissions.has(
                PermissionFlagsBits.Administrator
            ) ||
            member.permissions.has(
                PermissionFlagsBits.ManageGuild
            )
        )
    );
}

function botMember(guild) {

    return guild.members.me;
}

function botCanManageRole(guild, role) {

    const me = botMember(guild);

    if (!me || !role) {
        return false;
    }

    return (
        role.position <
        me.roles.highest.position
    );
}

function canModerateTarget(executor, target) {

    if (!executor || !target) {
        return false;
    }

    if (target.id === executor.id) {
        return false;
    }

    if (
        target.id === target.guild.ownerId
    ) {
        return false;
    }

    if (
        executor.id !== target.guild.ownerId &&
        target.roles.highest.position >=
        executor.roles.highest.position
    ) {
        return false;
    }

    return true;
}

/* =========================================================
   OWNER
========================================================= */

function getConfiguredOwners() {

    return new Set(
        String(
            process.env.BOT_OWNER_IDS || ''
        )
            .split(',')
            .map(x => x.trim())
            .filter(Boolean)
    );
}

function isBotOwner(userId) {

    const owners =
        getConfiguredOwners();

    if (owners.has(userId)) {
        return true;
    }

    const owner =
        client.application?.owner;

    if (owner?.id === userId) {
        return true;
    }

    if (owner?.members?.has(userId)) {
        return true;
    }

    return false;
}

/* =========================================================
   TRUST / SECURITY
========================================================= */

function isTrusted(guild, userId) {

    const config =
        getGuildConfig(guild);

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
        config.security.trustedUsers
            .includes(userId)
    ) {
        return true;
    }

    if (
        config.security.trustedBots
            .includes(userId)
    ) {
        return true;
    }

    if (
        config.security.trustedMembers
            .includes(userId)
    ) {
        return true;
    }

    if (
        config.security.trustedRoleId &&
        member?.roles.cache.has(
            config.security.trustedRoleId
        )
    ) {
        return true;
    }

    return false;
}

/* =========================================================
   LOGGING
========================================================= */

async function sendLog(
    guild,
    type,
    title,
    fields = [],
    color = null
) {

    try {

        const config =
            getGuildConfig(guild);

        const channelId =
            config.logs[type] ||
            config.security.logChannelId ||
            config.automod.logChannelId ||
            config.ticket.logChannelId;

        if (!channelId) {
            return;
        }

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

        await channel.send({
            embeds: [embed]
        }).catch(() => {});

    } catch (error) {

        console.error(
            'Logging error:',
            error.message
        );
    }
}

/* =========================================================
   WARNINGS / PUNISHMENTS
========================================================= */

async function addPunishment(
    guild,
    userId,
    type,
    reason,
    moderatorId
) {

    if (!db.guilds[guild.id]) {
        getGuildConfig(guild);
    }

    const config =
        db.guilds[guild.id];

    config.punishments[userId] ??= [];

    config.punishments[userId].push({
        type,
        reason,
        moderatorId,
        time: Date.now()
    });

    saveDatabase();
}

async function addWarning(
    member,
    reason,
    moderatorId
) {

    const guild =
        member.guild;

    const config =
        getGuildConfig(guild);

    config.warnings[member.id] ??= [];

    config.warnings[member.id].push({
        reason,
        moderatorId,
        time: Date.now()
    });

    await addPunishment(
        guild,
        member.id,
        'warn',
        reason,
        moderatorId
    );

    const count =
        config.warnings[member.id].length;

    /*
       ESCALATION

       3 warnings -> 10 min timeout
       5 warnings -> kick
       7 warnings -> ban
    */

    if (
        count >= 7 &&
        member.bannable
    ) {

        await member.ban({
            reason:
                'Automatic warning escalation: 7+ warnings'
        }).catch(() => {});

        await addPunishment(
            guild,
            member.id,
            'auto-ban',
            '7+ warnings',
            client.user.id
        );

    } else if (
        count >= 5 &&
        member.kickable
    ) {

        await member.kick(
            'Automatic warning escalation: 5+ warnings'
        ).catch(() => {});

        await addPunishment(
            guild,
            member.id,
            'auto-kick',
            '5+ warnings',
            client.user.id
        );

    } else if (
        count >= 3 &&
        member.moderatable
    ) {

        await member.timeout(
            10 * 60 * 1000,
            'Automatic warning escalation: 3+ warnings'
        ).catch(() => {});

        await addPunishment(
            guild,
            member.id,
            'auto-timeout',
            '3+ warnings',
            client.user.id
        );
    }

    saveDatabase();

    return count;
}

/* =========================================================
   AUTOMOD
========================================================= */

async function executeAutoMod(
    message,
    type,
    reason
) {

    const config =
        getGuildConfig(
            message.guild
        );

    const action =
        config.automod.actions[type] ||
        'delete';

    if (
        action === 'delete' ||
        action === 'timeout' ||
        action === 'warn'
    ) {

        await message.delete()
            .catch(() => {});
    }

    if (
        action === 'timeout' &&
        message.member?.moderatable
    ) {

        const seconds =
            config.automod
                .timeoutSeconds[type] ||
            60;

        await message.member
            .timeout(
                seconds * 1000,
                `AutoMod: ${reason}`
            )
            .catch(() => {});
    }

    if (
        action === 'warn' &&
        message.member
    ) {

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

async function runAutoMod(message) {

    if (
        !message.guild ||
        !message.member ||
        message.author.bot
    ) {
        return;
    }

    const config =
        getGuildConfig(
            message.guild
        );

    if (!config.automod.enabled) {
        return;
    }

    if (isStaff(message.member)) {
        return;
    }

    const content =
        message.content || '';

    const lower =
        content.toLowerCase();

    /*
    INVITES
    */

    if (
        config.automod.invite &&
        /(?:discord\.gg|discord(?:app)?\.com\/invite)\/[A-Za-z0-9-]+/i
            .test(content)
    ) {

        return executeAutoMod(
            message,
            'invite',
            'Discord invite link'
        );
    }

    /*
    MASS MENTIONS
    */

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

        return executeAutoMod(
            message,
            'massmention',
            'Excessive mentions'
        );
    }

    /*
    BAD WORDS
    */

    for (
        const word of config.automod.badWords
    ) {

        if (
            word &&
            lower.includes(
                String(word).toLowerCase()
            )
        ) {

            return executeAutoMod(
                message,
                'badword',
                `Blocked word: ${word}`
            );
        }
    }

    /*
    CAPS
    */

    const letters =
        content.replace(
            /[^A-Za-z]/g,
            ''
        );

    if (letters.length >= 8) {

        const uppercase =
            letters.replace(
                /[^A-Z]/g,
                ''
            ).length;

        const percentage =
            uppercase /
            letters.length *
            100;

        if (
            percentage >=
            config.automod.capsPercent
        ) {

            return executeAutoMod(
                message,
                'caps',
                'Excessive capital letters'
            );
        }
    }

    /*
    SPAM
    */

    const spamKey =
        `${message.guild.id}:${message.author.id}`;

    const now =
        Date.now();

    let spam =
        spamTracker.get(spamKey) || [];

    spam =
        spam.filter(
            timestamp =>
                now - timestamp <
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

        return executeAutoMod(
            message,
            'spam',
            `Spam detected: ${spam.length} messages`
        );
    }

    /*
    REPEATED MESSAGES
    */

    const repeatKey =
        `${message.guild.id}:${message.author.id}`;

    const previous =
        repeatTracker.get(
            repeatKey
        );

    if (
        previous &&
        previous.content === content &&
        now - previous.time <
            config.automod.repeatedWindow
    ) {

        previous.count++;

    } else {

        repeatTracker.set(
            repeatKey,
            {
                content,
                count: 1,
                time: now
            }
        );

        return;
    }

    const current =
        repeatTracker.get(
            repeatKey
        );

    if (
        current.count >=
        config.automod.repeatedLimit
    ) {

        repeatTracker.delete(
            repeatKey
        );

        return executeAutoMod(
            message,
            'repeat',
            `Repeated message ${current.count} times`
        );
    }
}

/* =========================================================
   EMOJI NORMALIZATION
========================================================= */

function normalizeReactionEmoji(input) {

    const value =
        String(input).trim();

    /*
       <:name:123>
       <a:name:123>
    */

    const custom =
        value.match(
            /^<a?:[^:>]+:(\d+)>$/
        );

    if (custom) {

        return {
            key: custom[1],
            type: 'custom',
            value
        };
    }

    /*
       Raw custom emoji ID
    */

    if (
        /^\d{15,25}$/.test(value)
    ) {

        return {
            key: value,
            type: 'custom',
            value
        };
    }

    /*
       Unicode emoji
    */

    return {
        key: value,
        type: 'unicode',
        value
    };
}

function reactionKey(reaction) {

    if (
        reaction.emoji.id
    ) {

        return reaction.emoji.id;
    }

    return reaction.emoji.name;
}

/* =========================================================
   REACTION ROLE ADD
========================================================= */

async function addReactionRole(
    interaction
) {

    const config =
        getGuildConfig(
            interaction.guild
        );

    const messageId =
        interaction.options.getString(
            'message_id'
        );

    const emojiInput =
        interaction.options.getString(
            'emoji'
        );

    const role =
        interaction.options.getRole(
            'role'
        );

    if (!role) {
        return interaction.reply({
            content:
                '❌ Role not found.',
            ephemeral: true
        });
    }

    if (
        role.id ===
        interaction.guild.id
    ) {
        return interaction.reply({
            content:
                '❌ Invalid role.',
            ephemeral: true
        });
    }

    const me =
        botMember(
            interaction.guild
        );

    if (!me) {
        return interaction.reply({
            content:
                '❌ I cannot find my member.',
            ephemeral: true
        });
    }

    if (
        !me.permissions.has(
            PermissionFlagsBits.ManageRoles
        )
    ) {
        return interaction.reply({
            content:
                '❌ I need **Manage Roles** permission.',
            ephemeral: true
        });
    }

    if (
        role.position >=
        me.roles.highest.position
    ) {
        return interaction.reply({
            content:
                '❌ My highest role must be above the reaction role.',
            ephemeral: true
        });
    }

    const emoji =
        normalizeReactionEmoji(
            emojiInput
        );

    let message =
        await interaction.channel.messages
            .fetch(messageId)
            .catch(() => null);

    if (!message) {

        /*
           Try fetching through the channel cache
           if the command channel doesn't contain it.
        */

        return interaction.reply({
            content:
                '❌ Message not found in this channel. Make sure the message ID is correct and the bot can view the channel.',
            ephemeral: true
        });
    }

    /*
       Verify custom emoji exists
    */

    if (emoji.type === 'custom') {

        const customEmoji =
            interaction.guild.emojis.cache.get(
                emoji.key
            );

        if (!customEmoji) {

            return interaction.reply({
                content:
                    '❌ Custom emoji not found in this server.',
                ephemeral: true
            });
        }
    }

    try {

        await message.react(
            emoji.value
        );

    } catch (error) {

        return interaction.reply({
            content:
                `❌ I could not react with that emoji.\n\`${error.message.slice(0, 150)}\``,
            ephemeral: true
        });
    }

    config.reactionRoles[messageId] ??= {};

    /*
       IMPORTANT:
       Store normalized key, NOT the full custom emoji string.
    */

    config.reactionRoles[messageId][
        emoji.key
    ] = {
        roleId: role.id,
        emoji: emoji.value,
        type: emoji.type,
        createdBy: interaction.user.id,
        createdAt: Date.now()
    };

    saveDatabase();

    await sendLog(
        interaction.guild,
        'reactionRoles',
        '🎭 Reaction Role Added',
        [
            field(
                'Message',
                messageId
            ),
            field(
                'Emoji',
                emoji.value
            ),
            field(
                'Role',
                role.toString()
            ),
            field(
                'Added by',
                interaction.user.toString()
            )
        ],
        0x5865f2
    );

    return interaction.reply({
        content:
            `✅ Reaction role created.\n\n${emoji.value} → ${role}`,
        ephemeral: true
    });
}

/* =========================================================
   REACTION ROLE REMOVE
========================================================= */

async function removeReactionRole(
    interaction
) {

    const config =
        getGuildConfig(
            interaction.guild
        );

    const messageId =
        interaction.options.getString(
            'message_id'
        );

    const emojiInput =
        interaction.options.getString(
            'emoji'
        );

    const emoji =
        normalizeReactionEmoji(
            emojiInput
        );

    if (
        !config.reactionRoles[messageId]
    ) {

        return interaction.reply({
            content:
                '❌ No reaction roles are configured on that message.',
            ephemeral: true
        });
    }

    const entry =
        config.reactionRoles[
            messageId
        ][emoji.key];

    if (!entry) {

        return interaction.reply({
            content:
                '❌ That emoji is not configured for this message.',
            ephemeral: true
        });
    }

    delete config.reactionRoles[
        messageId
    ][emoji.key];

    if (
        Object.keys(
            config.reactionRoles[
                messageId
            ]
        ).length === 0
    ) {

        delete config.reactionRoles[
            messageId
        ];
    }

    saveDatabase();

    await sendLog(
        interaction.guild,
        'reactionRoles',
        '🗑️ Reaction Role Removed',
        [
            field(
                'Message',
                messageId
            ),
            field(
                'Emoji',
                entry.emoji
            ),
            field(
                'Removed by',
                interaction.user.toString()
            )
        ]
    );

    return interaction.reply({
        content:
            '✅ Reaction role removed.',
        ephemeral: true
    });
}

/* =========================================================
   REACTION ROLE LIST
========================================================= */

async function listReactionRoles(
    interaction
) {

    const config =
        getGuildConfig(
            interaction.guild
        );

    const lines = [];

    for (
        const [messageId, entries]
        of Object.entries(
            config.reactionRoles
        )
    ) {

        for (
            const [key, entry]
            of Object.entries(entries)
        ) {

            lines.push(
                `${entry.emoji} → <@&${entry.roleId}> — \`${messageId}\``
            );
        }
    }

    if (!lines.length) {

        return interaction.reply({
            content:
                'No reaction roles configured.',
            ephemeral: true
        });
    }

    return interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setTitle(
                    '🎭 Reaction Roles'
                )
                .setDescription(
                    lines.join('\n').slice(
                        0,
                        4000
                    )
                )
        ],
        ephemeral: true
    });
}

/* =========================================================
   TICKET HELPERS
========================================================= */

function ticketButtonRow() {

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

function findTicketByChannel(
    guildId,
    channelId
) {

    const guild =
        db.guilds[guildId];

    if (!guild) {
        return null;
    }

    for (
        const [userId, ticket]
        of Object.entries(
            guild.tickets || {}
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

async function createTicket(
    guild,
    user
) {

    const config =
        getGuildConfig(guild);

    /*
       Prevent duplicate tickets
    */

    for (
        const ticket
        of Object.values(
            config.tickets
        )
    ) {

        if (
            ticket.userId === user.id &&
            ticket.status !== 'deleted'
        ) {

            const existing =
                await guild.channels.fetch(
                    ticket.channelId
                ).catch(() => null);

            if (existing) {
                return existing;
            }
        }
    }

    const category =
        config.ticket.categoryId
            ? await guild.channels.fetch(
                config.ticket.categoryId
            ).catch(() => null)
            : null;

    const staffRole =
        config.ticket.staffRoleId
            ? await guild.roles.fetch(
                config.ticket.staffRoleId
            ).catch(() => null)
            : null;

    if (!staffRole) {

        throw new Error(
            'Ticket staff role is not configured.'
        );
    }

    const channelName =
        `ticket-${user.username}`
            .toLowerCase()
            .replace(
                /[^a-z0-9-]/g,
                ''
            )
            .slice(0, 20) ||
        'ticket';

    const channel =
        await guild.channels.create({

            name:
                `${channelName}-${String(Date.now()).slice(-4)}`,

            type:
                ChannelType.GuildText,

            parent:
                category?.type ===
                ChannelType.GuildCategory
                    ? category.id
                    : undefined,

            topic:
                `AKIYO_TICKET:${user.id}`,

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
                        staffRole.id,

                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.AttachFiles,
                        PermissionFlagsBits.EmbedLinks
                    ]
                },

                {
                    id:
                        user.id,

                    allow: [
                        PermissionFlagsBits.ViewChannel,
                        PermissionFlagsBits.SendMessages,
                        PermissionFlagsBits.ReadMessageHistory,
                        PermissionFlagsBits.AttachFiles,
                        PermissionFlagsBits.EmbedLinks
                    ]
                }
            ]
        });

    config.tickets[user.id] = {
        userId: user.id,
        channelId: channel.id,
        guildId: guild.id,
        status: 'open',
        createdAt: Date.now(),
        claimedBy: null
    };

    db.dmTickets[user.id] = {
        guildId: guild.id,
        channelId: channel.id
    };

    saveDatabase();

    const embed =
        new EmbedBuilder()
            .setTitle(
                '🎫 New Support Ticket'
            )
            .setDescription(
                `Hello ${user}!\n\n` +
                `A support team member will assist you shortly.\n\n` +
                `You can also reply to this ticket through DM.`
            )
            .setTimestamp();

    await channel.send({
        content:
            `<@&${staffRole.id}>`,
        embeds: [embed],
        components: [
            ticketButtonRow()
        ]
    });

    await user.send(
        `🎫 Your support ticket has been created in **${guild.name}**.\n\n` +
        `You can reply to me here and your message will be forwarded to the support ticket.`
    ).catch(() => {});

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
            )
        ],
        0x57f287
    );

    return channel;
}

/* =========================================================
   TICKET TRANSCRIPT
========================================================= */

async function createTranscript(
    channel
) {

    const messages = [];

    let before;

    while (
        messages.length < 10000
    ) {

        const batch =
            await channel.messages.fetch({
                limit: 100,
                before
            }).catch(() => null);

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

    const output =
        messages.map(message => {

            const attachments =
                [
                    ...message.attachments.values()
                ]
                    .map(
                        attachment =>
                            attachment.url
                    )
                    .join('\n');

            return [
                `[${message.createdAt.toISOString()}]`,
                `${message.author.tag} (${message.author.id})`,
                message.content || '',
                attachments
            ].join('\n');

        }).join('\n\n');

    return Buffer.from(
        output,
        'utf8'
    );
}

/* =========================================================
   CLOSE TICKET
========================================================= */

async function closeTicket(
    guild,
    channel,
    closedBy
) {

    const found =
        findTicketByChannel(
            guild.id,
            channel.id
        );

    if (!found) {
        return false;
    }

    const config =
        getGuildConfig(guild);

    const transcript =
        await createTranscript(
            channel
        );

    const logChannel =
        config.ticket.logChannelId
            ? await guild.channels.fetch(
                config.ticket.logChannelId
            ).catch(() => null)
            : null;

    if (
        logChannel?.isTextBased()
    ) {

        await logChannel.send({
            content:
                `📄 Ticket transcript — <@${found.userId}>`,
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
            found.userId,
            {
                ViewChannel: true,
                SendMessages: false
            }
        )
        .catch(() => {});

    config.tickets[
        found.userId
    ].status = 'closed';

    config.tickets[
        found.userId
    ].closedAt = Date.now();

    saveDatabase();

    await channel.send(
        '🔒 **Ticket closed.**\nA staff member can reopen it if required.'
    ).catch(() => {});

    await sendLog(
        guild,
        'tickets',
        '🔒 Ticket Closed',
        [
            field(
                'User',
                `<@${found.userId}>`
            ),
            field(
                'Closed by',
                closedBy.toString()
            )
        ]
    );

    return true;
}

/* =========================================================
   RESTORE TICKETS
========================================================= */

async function restoreTickets() {

    for (
        const guild of client.guilds.cache.values()
    ) {

        const config =
            getGuildConfig(guild);

        for (
            const [userId, ticket]
            of Object.entries(
                config.tickets || {}
            )
        ) {

            if (
                ticket.status ===
                'deleted'
            ) {
                continue;
            }

            const channel =
                await guild.channels.fetch(
                    ticket.channelId
                ).catch(() => null);

            if (!channel) {
                continue;
            }

            ticketCache.set(
                `${guild.id}:${channel.id}`,
                ticket
            );

            db.dmTickets[userId] = {
                guildId: guild.id,
                channelId: channel.id
            };
        }
    }

    saveDatabase();

    console.log(
        'Ticket database restored.'
    );
}

/* =========================================================
   SLASH COMMANDS
========================================================= */

const commands = [];

function registerCommand(command) {
    commands.push(
        command.toJSON()
    );
}

/* HELP */

registerCommand(
    new SlashCommandBuilder()
        .setName('help')
        .setDescription(
            'Show AkiyO commands.'
        )
);

/* BOT INFO */

registerCommand(
    new SlashCommandBuilder()
        .setName('botinfo')
        .setDescription(
            'Show bot information.'
        )
);

/* TICKETS */

registerCommand(
    new SlashCommandBuilder()
        .setName('ticket')
        .setDescription(
            'Create a support ticket.'
        )
);

registerCommand(
    new SlashCommandBuilder()
        .setName('ticketpanel')
        .setDescription(
            'Send the ticket panel.'
        )
);

registerCommand(
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
                    .setRequired(false)
        )
);

for (
    const name of [
        'close',
        'reopen',
        'delete',
        'claim',
        'unclaim',
        'lock',
        'unlock'
    ]
) {

    registerCommand(
        new SlashCommandBuilder()
            .setName(name)
            .setDescription(
                `${name} current ticket.`
            )
    );
}

registerCommand(
    new SlashCommandBuilder()
        .setName('ticketadd')
        .setDescription(
            'Add a user to a ticket.'
        )
        .addUserOption(
            option =>
                option
                    .setName('user')
                    .setDescription(
                        'User to add.'
                    )
                    .setRequired(true)
        )
);

registerCommand(
    new SlashCommandBuilder()
        .setName('ticketremove')
        .setDescription(
            'Remove a user from a ticket.'
        )
        .addUserOption(
            option =>
                option
                    .setName('user')
                    .setDescription(
                        'User to remove.'
                    )
                    .setRequired(true)
        )
);

registerCommand(
    new SlashCommandBuilder()
        .setName('ticketrename')
        .setDescription(
            'Rename a ticket.'
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

registerCommand(
    new SlashCommandBuilder()
        .setName('ticketinfo')
        .setDescription(
            'Show ticket information.'
        )
);

registerCommand(
    new SlashCommandBuilder()
        .setName('ticketstats')
        .setDescription(
            'Show ticket statistics.'
        )
);

/* AUTOMOD */

registerCommand(
    new SlashCommandBuilder()
        .setName('automod')
        .setDescription(
            'Configure AutoMod.'
        )
        .addSubcommand(
            s =>
                s.setName('enable')
                    .setDescription(
                        'Enable AutoMod.'
                    )
        )
        .addSubcommand(
            s =>
                s.setName('disable')
                    .setDescription(
                        'Disable AutoMod.'
                    )
        )
        .addSubcommand(
            s =>
                s.setName('status')
                    .setDescription(
                        'Show AutoMod status.'
                    )
        )
        .addSubcommand(
            s =>
                s.setName('config')
                    .setDescription(
                        'Configure AutoMod.'
                    )
                    .addIntegerOption(
                        o =>
                            o.setName(
                                'spam_limit'
                            )
                                .setDescription(
                                    'Messages allowed.'
                                )
                                .setMinValue(3)
                                .setMaxValue(30)
                        )
                    .addIntegerOption(
                        o =>
                            o.setName(
                                'spam_window'
                            )
                                .setDescription(
                                    'Spam window in seconds.'
                                )
                                .setMinValue(1)
                                .setMaxValue(60)
                        )
                    .addIntegerOption(
                        o =>
                            o.setName(
                                'caps_percent'
                            )
                                .setDescription(
                                    'Caps percentage.'
                                )
                                .setMinValue(50)
                                .setMaxValue(100)
                        )
        )
        .addSubcommand(
            s =>
                s.setName('badword')
                    .setDescription(
                        'Add a blocked word.'
                    )
                    .addStringOption(
                        o =>
                            o.setName('word')
                                .setDescription(
                                    'Blocked word.'
                                )
                                .setRequired(true)
                    )
        )
        .addSubcommand(
            s =>
                s.setName('removebadword')
                    .setDescription(
                        'Remove a blocked word.'
                    )
                    .addStringOption(
                        o =>
                            o.setName('word')
                                .setDescription(
                                    'Word.'
                                )
                                .setRequired(true)
                    )
        )
);

/* SECURITY */

registerCommand(
    new SlashCommandBuilder()
        .setName('security')
        .setDescription(
            'Configure security and anti-nuke.'
        )
        .addSubcommand(
            s =>
                s.setName('enable')
                    .setDescription(
                        'Enable security.'
                    )
        )
        .addSubcommand(
            s =>
                s.setName('disable')
                    .setDescription(
                        'Disable security.'
                    )
        )
        .addSubcommand(
            s =>
                s.setName('status')
                    .setDescription(
                        'Security status.'
                    )
        )
        .addSubcommand(
            s =>
                s.setName('action')
                    .setDescription(
                        'Set anti-nuke action.'
                    )
                    .addStringOption(
                        o =>
                            o.setName('action')
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
                                        name: 'Ban',
                                        value: 'ban'
                                    }
                                )
                    )
        )
        .addSubcommand(
            s =>
                s.setName('trusted')
                    .setDescription(
                        'Add trusted user.'
                    )
                    .addUserOption(
                        o =>
                            o.setName('user')
                                .setDescription(
                                    'User.'
                                )
                                .setRequired(true)
                    )
        )
        .addSubcommand(
            s =>
                s.setName('untrusted')
                    .setDescription(
                        'Remove trusted user.'
                    )
                    .addUserOption(
                        o =>
                            o.setName('user')
                                .setDescription(
                                    'User.'
                                )
                                .setRequired(true)
                    )
        )
        .addSubcommand(
            s =>
                s.setName('trustedmember')
                    .setDescription(
                        'Add trusted member.'
                    )
                    .addUserOption(
                        o =>
                            o.setName('user')
                                .setDescription(
                                    'Member.'
                                )
                                .setRequired(true)
                    )
        )
        .addSubcommand(
            s =>
                s.setName('untrustedmember')
                    .setDescription(
                        'Remove trusted member.'
                    )
                    .addUserOption(
                        o =>
                            o.setName('user')
                                .setDescription(
                                    'Member.'
                                )
                                .setRequired(true)
                    )
        )
        .addSubcommand(
            s =>
                s.setName('trustedbot')
                    .setDescription(
                        'Trust a bot.'
                    )
                    .addUserOption(
                        o =>
                            o.setName('user')
                                .setDescription(
                                    'Bot.'
                                )
                                .setRequired(true)
                    )
        )
        .addSubcommand(
            s =>
                s.setName('untrustedbot')
                    .setDescription(
                        'Untrust a bot.'
                    )
                    .addUserOption(
                        o =>
                            o.setName('user')
                                .setDescription(
                                    'Bot.'
                                )
                                .setRequired(true)
                    )
        )
        .addSubcommand(
            s =>
                s.setName('trustedrole')
                    .setDescription(
                        'Set trusted role.'
                    )
                    .addRoleOption(
                        o =>
                            o.setName('role')
                                .setDescription(
                                    'Role.'
                                )
                                .setRequired(true)
                    )
        )
        .addSubcommand(
            s =>
                s.setName('protectedrole')
                    .setDescription(
                        'Protect a role.'
                    )
                    .addRoleOption(
                        o =>
                            o.setName('role')
                                .setDescription(
                                    'Role.'
                                )
                                .setRequired(true)
                    )
        )
        .addSubcommand(
            s =>
                s.setName('unprotectedrole')
                    .setDescription(
                        'Unprotect a role.'
                    )
                    .addRoleOption(
                        o =>
                            o.setName('role')
                                .setDescription(
                                    'Role.'
                                )
                                .setRequired(true)
                    )
        )
        .addSubcommand(
            s =>
                s.setName('protectedchannel')
                    .setDescription(
                        'Protect a channel.'
                    )
                    .addChannelOption(
                        o =>
                            o.setName('channel')
                                .setDescription(
                                    'Channel.'
                                )
                                .setRequired(true)
                    )
        )
        .addSubcommand(
            s =>
                s.setName('unprotectedchannel')
                    .setDescription(
                        'Unprotect a channel.'
                    )
                    .addChannelOption(
                        o =>
                            o.setName('channel')
                                .setDescription(
                                    'Channel.'
                                )
                                .setRequired(true)
                    )
        )
        .addSubcommand(
            s =>
                s.setName('list')
                    .setDescription(
                        'List security settings.'
                    )
        )
);

/* CONFIG */

registerCommand(
    new SlashCommandBuilder()
        .setName('config')
        .setDescription(
            'Server configuration.'
        )
        .addSubcommand(
            s =>
                s.setName('log')
                    .setDescription(
                        'Set a log channel.'
                    )
                    .addStringOption(
                        o =>
                            o.setName('type')
                                .setDescription(
                                    'Log type.'
                                )
                                .setRequired(true)
                                .addChoices(
                                    ...LOG_TYPES.map(
                                        type => ({
                                            name: type,
                                            value: type
                                        })
                                    )
                                )
                    )
                    .addChannelOption(
                        o =>
                            o.setName('channel')
                                .setDescription(
                                    'Log channel.'
                                )
                                .addChannelTypes(
                                    ChannelType.GuildText
                                )
                                .setRequired(true)
                    )
        )
        .addSubcommand(
            s =>
                s.setName('suggestions')
                    .setDescription(
                        'Set suggestion channel.'
                    )
                    .addChannelOption(
                        o =>
                            o.setName('channel')
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
            s =>
                s.setName('timeout')
                    .setDescription(
                        'Set AutoMod timeout.'
                    )
                    .addStringOption(
                        o =>
                            o.setName('type')
                                .setDescription(
                                    'AutoMod type.'
                                )
                                .setRequired(true)
                                .addChoices(
                                    'spam',
                                    'invite',
                                    'badword',
                                    'caps',
                                    'repeat',
                                    'massmention'
                                )
                    )
                    .addIntegerOption(
                        o =>
                            o.setName('seconds')
                                .setDescription(
                                    'Timeout seconds.'
                                )
                                .setMinValue(10)
                                .setMaxValue(2419200)
                                .setRequired(true)
                    )
        )
        .addSubcommand(
            s =>
                s.setName('security')
                    .setDescription(
                        'Set security thresholds.'
                    )
                    .addIntegerOption(
                        o =>
                            o.setName('mass_ban')
                                .setDescription(
                                    'Mass bans.'
                                )
                                .setMinValue(1)
                                .setMaxValue(50)
                    )
                    .addIntegerOption(
                        o =>
                            o.setName('mass_kick')
                                .setDescription(
                                    'Mass kicks.'
                                )
                                .setMinValue(1)
                                .setMaxValue(50)
                    )
                    .addIntegerOption(
                        o =>
                            o.setName(
                                'mass_channel_delete'
                            )
                                .setDescription(
                                    'Channel deletes.'
                                )
                                .setMinValue(1)
                                .setMaxValue(50)
                    )
                    .addIntegerOption(
                        o =>
                            o.setName(
                                'mass_channel_create'
                            )
                                .setDescription(
                                    'Channel creates.'
                                )
                                .setMinValue(1)
                                .setMaxValue(50)
                    )
                    .addIntegerOption(
                        o =>
                            o.setName(
                                'mass_role_delete'
                            )
                                .setDescription(
                                    'Role deletes.'
                                )
                                .setMinValue(1)
                                .setMaxValue(50)
                    )
                    .addIntegerOption(
                        o =>
                            o.setName(
                                'mass_role_create'
                            )
                                .setDescription(
                                    'Role creates.'
                                )
                                .setMinValue(1)
                                .setMaxValue(50)
                    )
        )
);

/* MODERATION */

registerCommand(
    new SlashCommandBuilder()
        .setName('warn')
        .setDescription(
            'Warn a member.'
        )
        .addUserOption(
            o =>
                o.setName('user')
                    .setDescription(
                        'Member.'
                    )
                    .setRequired(true)
        )
        .addStringOption(
            o =>
                o.setName('reason')
                    .setDescription(
                        'Reason.'
                    )
                    .setRequired(true)
        )
);

registerCommand(
    new SlashCommandBuilder()
        .setName('timeout')
        .setDescription(
            'Timeout a member.'
        )
        .addUserOption(
            o =>
                o.setName('user')
                    .setDescription(
                        'Member.'
                    )
                    .setRequired(true)
        )
        .addIntegerOption(
            o =>
                o.setName('seconds')
                    .setDescription(
                        'Seconds.'
                    )
                    .setMinValue(10)
                    .setMaxValue(2419200)
                    .setRequired(true)
        )
        .addStringOption(
            o =>
                o.setName('reason')
                    .setDescription(
                        'Reason.'
                    )
                    .setRequired(true)
        )
);

for (
    const [name, description]
    of [
        [
            'kick',
            'Kick a member.'
        ],
        [
            'ban',
            'Ban a member.'
        ]
    ]
) {

    registerCommand(
        new SlashCommandBuilder()
            .setName(name)
            .setDescription(
                description
            )
            .addUserOption(
                o =>
                    o.setName('user')
                        .setDescription(
                            'Member.'
                        )
                        .setRequired(true)
            )
            .addStringOption(
                o =>
                    o.setName('reason')
                        .setDescription(
                            'Reason.'
                        )
                        .setRequired(true)
            )
    );
}

registerCommand(
    new SlashCommandBuilder()
        .setName('unban')
        .setDescription(
            'Unban a user.'
        )
        .addStringOption(
            o =>
                o.setName('user_id')
                    .setDescription(
                        'User ID.'
                    )
                    .setRequired(true)
        )
        .addStringOption(
            o =>
                o.setName('reason')
                    .setDescription(
                        'Reason.'
                    )
                    .setRequired(true)
        )
);

for (
    const name of [
        'warnings',
        'punishments'
    ]
) {

    registerCommand(
        new SlashCommandBuilder()
            .setName(name)
            .setDescription(
                `View ${name}.`
            )
            .addUserOption(
                o =>
                    o.setName('user')
                        .setDescription(
                            'User.'
                        )
                        .setRequired(true)
            )
    );
}

/* SUGGESTIONS */

registerCommand(
    new SlashCommandBuilder()
        .setName('suggest')
        .setDescription(
            'Create a suggestion.'
        )
        .addStringOption(
            o =>
                o.setName('text')
                    .setDescription(
                        'Suggestion.'
                    )
                    .setRequired(true)
                    .setMaxLength(2000)
        )
);

/* ANNOUNCEMENTS */

registerCommand(
    new SlashCommandBuilder()
        .setName('announce')
        .setDescription(
            'Send an announcement.'
        )
        .addChannelOption(
            o =>
                o.setName('channel')
                    .setDescription(
                        'Channel.'
                    )
                    .addChannelTypes(
                        ChannelType.GuildText
                    )
                    .setRequired(true)
        )
        .addStringOption(
            o =>
                o.setName('message')
                    .setDescription(
                        'Message.'
                    )
                    .setRequired(true)
        )
        .addStringOption(
            o =>
                o.setName('title')
                    .setDescription(
                        'Embed title.'
                    )
        )
        .addStringOption(
            o =>
                o.setName('footer')
                    .setDescription(
                        'Footer.'
                    )
        )
        .addStringOption(
            o =>
                o.setName('image')
                    .setDescription(
                        'Image URL.'
                    )
        )
        .addStringOption(
            o =>
                o.setName('thumbnail')
                    .setDescription(
                        'Thumbnail URL.'
                    )
        )
        .addBooleanOption(
            o =>
                o.setName('embed')
                    .setDescription(
                        'Use embed.'
                    )
        )
        .addBooleanOption(
            o =>
                o.setName('everyone')
                    .setDescription(
                        'Mention everyone.'
                    )
        )
        .addBooleanOption(
            o =>
                o.setName('here')
                    .setDescription(
                        'Mention here.'
                    )
        )
        .addRoleOption(
            o =>
                o.setName('role')
                    .setDescription(
                        'Mention role.'
                    )
        )
        .addUserOption(
            o =>
                o.setName('user')
                    .setDescription(
                        'Mention user.'
                    )
        )
);

/* AUTOROLE */

registerCommand(
    new SlashCommandBuilder()
        .setName('autorole')
        .setDescription(
            'Configure autorole.'
        )
        .addSubcommand(
            s =>
                s.setName('set')
                    .setDescription(
                        'Set autorole.'
                    )
                    .addRoleOption(
                        o =>
                            o.setName('role')
                                .setDescription(
                                    'Role.'
                                )
                                .setRequired(true)
                    )
        )
        .addSubcommand(
            s =>
                s.setName('disable')
                    .setDescription(
                        'Disable autorole.'
                    )
        )
        .addSubcommand(
            s =>
                s.setName('status')
                    .setDescription(
                        'Autorole status.'
                    )
        )
);

/* WELCOME */

registerCommand(
    new SlashCommandBuilder()
        .setName('welcome')
        .setDescription(
            'Configure welcome.'
        )
        .addSubcommand(
            s =>
                s.setName('set')
                    .setDescription(
                        'Set welcome.'
                    )
                    .addChannelOption(
                        o =>
                            o.setName('channel')
                                .setDescription(
                                    'Channel.'
                                )
                                .addChannelTypes(
                                    ChannelType.GuildText
                                )
                                .setRequired(true)
                    )
                    .addStringOption(
                        o =>
                            o.setName('message')
                                .setDescription(
                                    'Welcome message.'
                                )
                                .setRequired(true)
                    )
        )
        .addSubcommand(
            s =>
                s.setName('disable')
                    .setDescription(
                        'Disable welcome.'
                    )
        )
        .addSubcommand(
            s =>
                s.setName('status')
                    .setDescription(
                        'Welcome status.'
                    )
        )
);

/* VERIFICATION */

registerCommand(
    new SlashCommandBuilder()
        .setName('verification')
        .setDescription(
            'Configure verification.'
        )
        .addSubcommand(
            s =>
                s.setName('setup')
                    .setDescription(
                        'Setup verification.'
                    )
                    .addChannelOption(
                        o =>
                            o.setName('channel')
                                .setDescription(
                                    'Verification channel.'
                                )
                                .addChannelTypes(
                                    ChannelType.GuildText
                                )
                                .setRequired(true)
                    )
                    .addRoleOption(
                        o =>
                            o.setName('role')
                                .setDescription(
                                    'Verified role.'
                                )
                                .setRequired(true)
                    )
        )
        .addSubcommand(
            s =>
                s.setName('disable')
                    .setDescription(
                        'Disable verification.'
                    )
        )
        .addSubcommand(
            s =>
                s.setName('status')
                    .setDescription(
                        'Verification status.'
                    )
        )
);

/* REACTION ROLES */

registerCommand(
    new SlashCommandBuilder()
        .setName('autoreactionrole')
        .setDescription(
            'Configure reaction roles.'
        )
        .addSubcommand(
            s =>
                s.setName('add')
                    .setDescription(
                        'Add a reaction role.'
                    )
                    .addStringOption(
                        o =>
                            o.setName(
                                'message_id'
                            )
                                .setDescription(
                                    'Message ID.'
                                )
                                .setRequired(true)
                    )
                    .addStringOption(
                        o =>
                            o.setName('emoji')
                                .setDescription(
                                    'Emoji.'
                                )
                                .setRequired(true)
                    )
                    .addRoleOption(
                        o =>
                            o.setName('role')
                                .setDescription(
                                    'Role.'
                                )
                                .setRequired(true)
                    )
        )
        .addSubcommand(
            s =>
                s.setName('remove')
                    .setDescription(
                        'Remove reaction role.'
                    )
                    .addStringOption(
                        o =>
                            o.setName(
                                'message_id'
                            )
                                .setDescription(
                                    'Message ID.'
                                )
                                .setRequired(true)
                    )
                    .addStringOption(
                        o =>
                            o.setName('emoji')
                                .setDescription(
                                    'Emoji.'
                                )
                                .setRequired(true)
                    )
        )
        .addSubcommand(
            s =>
                s.setName('list')
                    .setDescription(
                        'List reaction roles.'
                    )
        )
);

/* LEADERBOARD */

registerCommand(
    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription(
            'Message leaderboard.'
        )
        .addSubcommand(
            s =>
                s.setName('top')
                    .setDescription(
                        'Top members.'
                    )
        )
        .addSubcommand(
            s =>
                s.setName('reset')
                    .setDescription(
                        'Reset leaderboard.'
                    )
        )
        .addSubcommand(
            s =>
                s.setName('enable')
                    .setDescription(
                        'Enable leaderboard.'
                    )
        )
        .addSubcommand(
            s =>
                s.setName('disable')
                    .setDescription(
                        'Disable leaderboard.'
                    )
        )
        .addSubcommand(
            s =>
                s.setName('status')
                    .setDescription(
                        'Leaderboard status.'
                    )
        )
);

/* ADS */

registerCommand(
    new SlashCommandBuilder()
        .setName('ads')
        .setDescription(
            'Owner advertisement system.'
        )
        .addSubcommand(
            s =>
                s.setName('set')
                    .setDescription(
                        'Set advertisement channel.'
                    )
                    .addChannelOption(
                        o =>
                            o.setName('channel')
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
            s =>
                s.setName('message')
                    .setDescription(
                        'Set advertisement.'
                    )
                    .addStringOption(
                        o =>
                            o.setName('text')
                                .setDescription(
                                    'Advertisement.'
                                )
                                .setRequired(true)
                    )
        )
        .addSubcommand(
            s =>
                s.setName('interval')
                    .setDescription(
                        'Set advertisement interval.'
                    )
                    .addIntegerOption(
                        o =>
                            o.setName('minutes')
                                .setDescription(
                                    'Minutes.'
                                )
                                .setMinValue(1)
                                .setMaxValue(10080)
                                .setRequired(true)
                    )
        )
        .addSubcommand(
            s =>
                s.setName('enable')
                    .setDescription(
                        'Enable ads.'
                    )
        )
        .addSubcommand(
            s =>
                s.setName('disable')
                    .setDescription(
                        'Disable ads.'
                    )
        )
        .addSubcommand(
            s =>
                s.setName('status')
                    .setDescription(
                        'Ad status.'
                    )
        )
        .addSubcommand(
            s =>
                s.setName('broadcast')
                    .setDescription(
                        'Broadcast now.'
                    )
        )
);

/* AI */

registerCommand(
    new SlashCommandBuilder()
        .setName('ai')
        .setDescription(
            'AI assistant.'
        )
        .addSubcommand(
            s =>
                s.setName('ask')
                    .setDescription(
                        'Ask AI.'
                    )
                    .addStringOption(
                        o =>
                            o.setName('prompt')
                                .setDescription(
                                    'Question.'
                                )
                                .setRequired(true)
                                .setMaxLength(4000)
                    )
        )
        .addSubcommand(
            s =>
                s.setName('reset')
                    .setDescription(
                        'Reset AI conversation.'
                    )
        )
);

/* =========================================================
   COMMAND PERMISSIONS
========================================================= */

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
    'ticketadd',
    'ticketremove',
    'ticketrename',
    'ticketinfo',
    'ticketstats',
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

/* =========================================================
   COMMAND REGISTRATION
========================================================= */

async function registerCommands() {

    const rest =
        new REST({
            version: '10'
        }).setToken(
            TOKEN
        );

    await rest.put(
        Routes.applicationCommands(
            CLIENT_ID
        ),
        {
            body: commands
        }
    );

    console.log(
        `Registered ${commands.length} global slash commands.`
    );
}

/* =========================================================
   MESSAGE CREATE
========================================================= */

client.on(
    'messageCreate',
    async message => {

        try {

            if (message.author.bot) {
                return;
            }

            /*
            DM TICKETS
            */

            if (!message.guild) {

                const mapping =
                    db.dmTickets[
                        message.author.id
                    ];

                if (!mapping) {

                    /*
                       If there is exactly one guild
                       configured for tickets, use it.
                    */

                    const candidates = [];

                    for (
                        const guild
                        of client.guilds.cache.values()
                    ) {

                        const config =
                            getGuildConfig(guild);

                        if (
                            config.ticket.categoryId &&
                            config.ticket.staffRoleId
                        ) {
                            candidates.push(
                                guild
                            );
                        }
                    }

                    if (
                        candidates.length === 1
                    ) {

                        try {

                            const channel =
                                await createTicket(
                                    candidates[0],
                                    message.author
                                );

                            await channel.send({
                                embeds: [
                                    new EmbedBuilder()
                                        .setTitle(
                                            '📩 User Message'
                                        )
                                        .setDescription(
                                            message.content ||
                                            '[Attachment]'
                                        )
                                        .setTimestamp()
                                ]
                            });

                        } catch (error) {

                            await message.author.send(
                                '❌ I could not create a ticket. Please contact the server staff.'
                            ).catch(() => {});
                        }

                    } else {

                        await message.author.send(
                            '❌ I cannot determine which server your DM ticket belongs to. Please use `/ticket` in the server you need support from.'
                        ).catch(() => {});
                    }

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
                    await guild.channels.fetch(
                        mapping.channelId
                    ).catch(() => null);

                if (
                    !channel ||
                    !channel.isTextBased()
                ) {
                    return;
                }

                await channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle(
                                '📩 User DM'
                            )
                            .setDescription(
                                message.content ||
                                '[Attachment]'
                            )
                            .setFooter({
                                text:
                                    `${message.author.tag} • ${message.author.id}`
                            })
                            .setTimestamp()
                    ]
                });

                return;
            }

            /*
            LEADERBOARD
            */

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
                    config.leaderboard.messages[
                        message.author.id
                    ] % 10 === 0
                ) {
                    saveDatabase();
                }
            }

            /*
            TICKET STAFF → USER DM
            */

            const ticket =
                findTicketByChannel(
                    message.guild.id,
                    message.channel.id
                );

            if (
                ticket &&
                isStaff(message.member)
            ) {

                const user =
                    await client.users.fetch(
                        ticket.userId
                    ).catch(() => null);

                if (user) {

                    await user.send({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle(
                                    '💬 Support Team'
                                )
                                .setDescription(
                                    message.content ||
                                    '[Attachment]'
                                )
                                .setTimestamp()
                        ]
                    }).catch(() => {});
                }
            }

            /*
            AUTOMOD
            */

            await runAutoMod(
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

/* =========================================================
   MEMBER JOIN
========================================================= */

client.on(
    'guildMemberAdd',
    async member => {

        try {

            const config =
                getGuildConfig(
                    member.guild
                );

            /*
            AUTOROLE
            */

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
                    botCanManageRole(
                        member.guild,
                        role
                    )
                ) {

                    await member.roles.add(
                        role,
                        'AkiyO Autorole'
                    ).catch(() => {});

                    await sendLog(
                        member.guild,
                        'members',
                        '👤 Autorole',
                        [
                            field(
                                'User',
                                member.toString()
                            ),
                            field(
                                'Role',
                                role.toString()
                            )
                        ]
                    );
                }
            }

            /*
            WELCOME
            */

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

                    const text =
                        config.welcome.message
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

                    await channel.send(
                        text
                    ).catch(() => {});
                }

                await sendLog(
                    member.guild,
                    'welcome',
                    '👋 Member Joined',
                    [
                        field(
                            'User',
                            `${member.user.tag} (${member.id})`
                        )
                    ]
                );
            }

            /*
            ANTI RAID
            */

            if (
                config.security.enabled
            ) {

                const key =
                    member.guild.id;

                const now =
                    Date.now();

                let joins =
                    raidTracker.get(
                        key
                    ) || [];

                joins =
                    joins.filter(
                        x =>
                            now - x.time <
                            config.security.raidWindow
                    );

                joins.push({
                    time: now,
                    userId: member.id
                });

                raidTracker.set(
                    key,
                    joins
                );

                if (
                    joins.length >=
                    config.security.raidJoinCount
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
                                `${config.security.raidWindow / 1000}s`
                            )
                        ],
                        0xed4245
                    );

                    /*
                       Do not mass-ban innocent users automatically.
                       Log the raid and optionally timeout newly joined
                       members if security action is ban.
                    */

                    if (
                        config.security.action ===
                        'ban'
                    ) {

                        for (
                            const entry
                            of joins.slice(
                                -config.security.raidJoinCount
                            )
                        ) {

                            const joined =
                                await member.guild.members.fetch(
                                    entry.userId
                                ).catch(() => null);

                            if (
                                joined &&
                                joined.bannable &&
                                !isTrusted(
                                    member.guild,
                                    joined.id
                                )
                            ) {

                                await joined.ban({
                                    reason:
                                        'AkiyO anti-raid protection'
                                }).catch(() => {});
                            }
                        }
                    }

                    raidTracker.delete(
                        key
                    );
                }
            }

            /*
            ANTI BOT
            */

            if (
                member.user.bot &&
                config.security.enabled &&
                !config.security.trustedBots.includes(
                    member.id
                )
            ) {

                await sendLog(
                    member.guild,
                    'security',
                    '🤖 Bot Added',
                    [
                        field(
                            'Bot',
                            `${member.user.tag} (${member.id})`
                        )
                    ],
                    0xffa500
                );
            }

        } catch (error) {

            console.error(
                'guildMemberAdd:',
                error
            );
        }
    }
);

/* =========================================================
   ANTI-NUKE
========================================================= */

async function securityAction(
    guild,
    type,
    executorId,
    detail
) {

    const config =
        getGuildConfig(guild);

    if (
        !config.security.enabled ||
        !executorId ||
        isTrusted(
            guild,
            executorId
        )
    ) {
        return;
    }

    const limits = {

        ban:
            config.security.massBan,

        kick:
            config.security.massKick,

        channelDelete:
            config.security.massChannelDelete,

        channelCreate:
            config.security.massChannelCreate,

        roleDelete:
            config.security.massRoleDelete,

        roleCreate:
            config.security.massRoleCreate,

        webhookCreate:
            config.security.massWebhookCreate
    };

    const limit =
        limits[type] || 999;

    const key =
        `${guild.id}:${type}:${executorId}`;

    const now =
        Date.now();

    let actions =
        securityTracker.get(
            key
        ) || [];

    actions =
        actions.filter(
            timestamp =>
                now - timestamp <
                30000
        );

    actions.push(now);

    securityTracker.set(
        key,
        actions
    );

    if (
        actions.length < limit
    ) {
        return;
    }

    securityTracker.delete(
        key
    );

    await sendLog(
        guild,
        'security',
        '🚨 Anti-Nuke Triggered',
        [
            field(
                'Executor',
                `<@${executorId}> (${executorId})`
            ),
            field(
                'Action',
                type
            ),
            field(
                'Count',
                actions.length
            ),
            field(
                'Details',
                detail
            )
        ],
        0xed4245
    );

    if (
        config.security.action ===
        'ban'
    ) {

        const member =
            await guild.members.fetch(
                executorId
            ).catch(() => null);

        if (
            member &&
            member.bannable &&
            !isTrusted(
                guild,
                executorId
            )
        ) {

            await member.ban({
                reason:
                    `AkiyO Anti-Nuke: ${type}`
            }).catch(() => {});
        }
    }
}

/* =========================================================
   AUDIT LOG EVENT
========================================================= */

client.on(
    'guildAuditLogEntryCreate',
    async (entry, guild) => {

        try {

            const executorId =
                entry.executorId;

            /*
            FULL AUDIT LOG
            */

            await sendLog(
                guild,
                'audit',
                '📜 Audit Log',
                [
                    field(
                        'Action',
                        String(
                            entry.action
                        )
                    ),
                    field(
                        'Executor',
                        entry.executor
                            ? `${entry.executor.tag || entry.executor.username} (${executorId})`
                            : executorId || 'Unknown'
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

            /*
            ANTI-NUKE
            */

            const action =
                entry.action;

            if (
                action ===
                AuditLogEvent.MemberBanAdd
            ) {

                await securityAction(
                    guild,
                    'ban',
                    executorId,
                    `Banned ${entry.targetId || 'unknown'}`
                );
            }

            if (
                action ===
                AuditLogEvent.MemberKick
            ) {

                await securityAction(
                    guild,
                    'kick',
                    executorId,
                    `Kicked ${entry.targetId || 'unknown'}`
                );
            }

            if (
                action ===
                AuditLogEvent.ChannelDelete
            ) {

                await securityAction(
                    guild,
                    'channelDelete',
                    executorId,
                    `Deleted channel ${entry.targetId || 'unknown'}`
                );
            }

            if (
                action ===
                AuditLogEvent.ChannelCreate
            ) {

                await securityAction(
                    guild,
                    'channelCreate',
                    executorId,
                    `Created channel ${entry.targetId || 'unknown'}`
                );
            }

            if (
                action ===
                AuditLogEvent.RoleDelete
            ) {

                await securityAction(
                    guild,
                    'roleDelete',
                    executorId,
                    `Deleted role ${entry.targetId || 'unknown'}`
                );
            }

            if (
                action ===
                AuditLogEvent.RoleCreate
            ) {

                await securityAction(
                    guild,
                    'roleCreate',
                    executorId,
                    `Created role ${entry.targetId || 'unknown'}`
                );
            }

            if (
                action ===
                AuditLogEvent.WebhookCreate
            ) {

                await securityAction(
                    guild,
                    'webhookCreate',
                    executorId,
                    `Created webhook ${entry.targetId || 'unknown'}`
                );
            }

            /*
            ANTI BOT
            */

            if (
                action ===
                AuditLogEvent.BotAdd
            ) {

                if (
                    !isTrusted(
                        guild,
                        executorId
                    )
                ) {

                    const target =
                        entry.targetId;

                    const bot =
                        target
                            ? await guild.members.fetch(
                                target
                            ).catch(() => null)
                            : null;

                    if (
                        bot &&
                        bot.user.bot
                    ) {

                        await sendLog(
                            guild,
                            'security',
                            '🚨 Unauthorized Bot Added',
                            [
                                field(
                                    'Executor',
                                    `<@${executorId}>`
                                ),
                                field(
                                    'Bot',
                                    bot.toString()
                                )
                            ],
                            0xed4245
                        );

                        /*
                           Only remove the bot when configured
                           for destructive security action.
                        */

                        const config =
                            getGuildConfig(
                                guild
                            );

                        if (
                            config.security.action ===
                            'ban' &&
                            bot.kickable
                        ) {

                            await bot.kick(
                                'AkiyO Anti-Bot Protection'
                            ).catch(() => {});
                        }
                    }
                }
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
   CHANNEL DELETE / ROLE DELETE
   PROTECTED OBJECT ALERTS
========================================================= */

client.on(
    'channelDelete',
    async channel => {

        try {

            if (!channel.guild) {
                return;
            }

            const config =
                getGuildConfig(
                    channel.guild
                );

            if (
                config.security.protectedChannels
                    .includes(channel.id)
            ) {

                await sendLog(
                    channel.guild,
                    'security',
                    '🛡️ Protected Channel Deleted',
                    [
                        field(
                            'Channel ID',
                            channel.id
                        ),
                        field(
                            'Channel',
                            channel.name || 'Unknown'
                        )
                    ],
                    0xed4245
                );
            }

        } catch (error) {

            console.error(
                'channelDelete:',
                error
            );
        }
    }
);

client.on(
    'roleDelete',
    async role => {

        try {

            const config =
                getGuildConfig(
                    role.guild
                );

            if (
                config.security.protectedRoles
                    .includes(role.id)
            ) {

                await sendLog(
                    role.guild,
                    'security',
                    '🛡️ Protected Role Deleted',
                    [
                        field(
                            'Role',
                            `${role.name} (${role.id})`
                        )
                    ],
                    0xed4245
                );
            }

        } catch (error) {

            console.error(
                'roleDelete:',
                error
            );
        }
    }
);

/* =========================================================
   WEBHOOK UPDATE
========================================================= */

client.on(
    'webhookUpdate',
    async channel => {

        try {

            if (!channel.guild) {
                return;
            }

            const config =
                getGuildConfig(
                    channel.guild
                );

            if (
                !config.security.enabled
            ) {
                return;
            }

            const logs =
                await channel.guild
                    .fetchAuditLogs({
                        type:
                            AuditLogEvent.WebhookCreate,
                        limit: 1
                    })
                    .catch(() => null);

            const entry =
                logs?.entries.first();

            if (
                entry &&
                Date.now() -
                    entry.createdTimestamp <
                    10000
            ) {

                await securityAction(
                    channel.guild,
                    'webhookCreate',
                    entry.executorId,
                    `Webhook created/updated in #${channel.name}`
                );
            }

        } catch (error) {

            console.error(
                'webhookUpdate:',
                error
            );
        }
    }
);

/* =========================================================
   REACTION ROLE ADD
========================================================= */

client.on(
    'messageReactionAdd',
    async (reaction, user) => {

        try {

            if (user.bot) {
                return;
            }

            if (reaction.partial) {
                await reaction.fetch();
            }

            if (reaction.message.partial) {
                await reaction.message.fetch();
            }

            const guild =
                reaction.message.guild;

            if (!guild) {
                return;
            }

            const config =
                getGuildConfig(guild);

            const key =
                reactionKey(
                    reaction
                );

            const entry =
                config.reactionRoles
                    ?.[
                        reaction.message.id
                    ]
                    ?.[
                        key
                    ];

            /*
            THIS IS THE IMPORTANT FIX:

            Custom emoji:
            <:name:id>

            is stored using:
            id

            Reaction lookup uses:
            reaction.emoji.id
            */

            if (!entry) {
                return;
            }

            const member =
                await guild.members.fetch(
                    user.id
                ).catch(() => null);

            if (!member) {
                return;
            }

            const role =
                await guild.roles.fetch(
                    entry.roleId
                ).catch(() => null);

            if (!role) {

                await sendLog(
                    guild,
                    'reactionRoles',
                    '❌ Reaction Role Missing',
                    [
                        field(
                            'Role ID',
                            entry.roleId
                        ),
                        field(
                            'Message',
                            reaction.message.id
                        )
                    ],
                    0xed4245
                );

                return;
            }

            const me =
                botMember(guild);

            if (!me) {
                return;
            }

            if (
                !me.permissions.has(
                    PermissionFlagsBits.ManageRoles
                )
            ) {

                await sendLog(
                    guild,
                    'reactionRoles',
                    '❌ Missing Manage Roles',
                    [
                        field(
                            'Role',
                            role.toString()
                        )
                    ],
                    0xed4245
                );

                return;
            }

            if (
                role.position >=
                me.roles.highest.position
            ) {

                await sendLog(
                    guild,
                    'reactionRoles',
                    '❌ Role Hierarchy Error',
                    [
                        field(
                            'Role',
                            role.toString()
                        ),
                        field(
                            'Bot Highest Role',
                            me.roles.highest.toString()
                        )
                    ],
                    0xed4245
                );

                return;
            }

            if (
                member.roles.cache.has(
                    role.id
                )
            ) {
                return;
            }

            await member.roles.add(
                role,
                'AkiyO Reaction Role'
            );

            await sendLog(
                guild,
                'reactionRoles',
                '🎭 Reaction Role Added',
                [
                    field(
                        'User',
                        member.toString()
                    ),
                    field(
                        'Emoji',
                        entry.emoji
                    ),
                    field(
                        'Role',
                        role.toString()
                    )
                ],
                0x57f287
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
   REACTION ROLE REMOVE
========================================================= */

client.on(
    'messageReactionRemove',
    async (reaction, user) => {

        try {

            if (user.bot) {
                return;
            }

            if (reaction.partial) {
                await reaction.fetch();
            }

            if (reaction.message.partial) {
                await reaction.message.fetch();
            }

            const guild =
                reaction.message.guild;

            if (!guild) {
                return;
            }

            const config =
                getGuildConfig(guild);

            const key =
                reactionKey(
                    reaction
                );

            const entry =
                config.reactionRoles
                    ?.[
                        reaction.message.id
                    ]
                    ?.[
                        key
                    ];

            if (!entry) {
                return;
            }

            const member =
                await guild.members.fetch(
                    user.id
                ).catch(() => null);

            const role =
                await guild.roles.fetch(
                    entry.roleId
                ).catch(() => null);

            if (
                !member ||
                !role
            ) {
                return;
            }

            if (
                member.roles.cache.has(
                    role.id
                )
            ) {

                await member.roles.remove(
                    role,
                    'AkiyO Reaction Role Removed'
                ).catch(() => {});
            }

            await sendLog(
                guild,
                'reactionRoles',
                '🎭 Reaction Role Removed',
                [
                    field(
                        'User',
                        member.toString()
                    ),
                    field(
                        'Emoji',
                        entry.emoji
                    ),
                    field(
                        'Role',
                        role.toString()
                    )
                ]
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
   INTERACTIONS
========================================================= */

client.on(
    'interactionCreate',
    async interaction => {

        try {

            /*
            BUTTONS
            */

            if (
                interaction.isButton()
            ) {

                /*
                CREATE TICKET
                */

                if (
                    interaction.customId ===
                    'create_ticket'
                ) {

                    if (
                        !interaction.guild
                    ) {

                        return interaction.reply({
                            content:
                                '❌ This button must be used inside a server.',
                            ephemeral: true
                        });
                    }

                    try {

                        const channel =
                            await createTicket(
                                interaction.guild,
                                interaction.user
                            );

                        return interaction.reply({
                            content:
                                `🎫 Ticket created: ${channel}`,
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

                /*
                VERIFICATION
                */

                if (
                    interaction.customId ===
                    'verify_user'
                ) {

                    const config =
                        getGuildConfig(
                            interaction.guild
                        );

                    const role =
                        await interaction.guild.roles.fetch(
                            config.verification.roleId
                        ).catch(() => null);

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
                                '❌ My highest role must be above the verification role.',
                            ephemeral: true
                        });
                    }

                    await interaction.member.roles.add(
                        role,
                        'AkiyO Verification'
                    );

                    await sendLog(
                        interaction.guild,
                        'verification',
                        '✅ Member Verified',
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

                /*
                TICKET BUTTONS
                */

                if (
                    !interaction.guild
                ) {
                    return;
                }

                if (
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
                    findTicketByChannel(
                        interaction.guild.id,
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
                    interaction.customId ===
                    'ticket_claim'
                ) {

                    ticketClaims.set(
                        interaction.channel.id,
                        interaction.user.id
                    );

                    db.guilds[
                        interaction.guild.id
                    ].tickets[
                        ticket.userId
                    ].claimedBy =
                        interaction.user.id;

                    saveDatabase();

                    return interaction.reply(
                        `🙋 Ticket claimed by ${interaction.user}.`
                    );
                }

                if (
                    interaction.customId ===
                    'ticket_close'
                ) {

                    await interaction.reply(
                        '🔒 Closing ticket...'
                    );

                    await closeTicket(
                        interaction.guild,
                        interaction.channel,
                        interaction.user
                    );

                    return;
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
                                SendMessages: false
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
                        await createTranscript(
                            interaction.channel
                        );

                    const config =
                        getGuildConfig(
                            interaction.guild
                        );

                    const logChannel =
                        config.ticket.logChannelId
                            ? await interaction.guild.channels.fetch(
                                config.ticket.logChannelId
                            ).catch(() => null)
                            : null;

                    if (
                        logChannel?.isTextBased()
                    ) {

                        await logChannel.send({
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
                            '✅ Transcript sent to the ticket log channel.',
                        ephemeral: true
                    });
                }

                return;
            }

            /*
            SLASH COMMANDS
            */

            if (
                !interaction.isChatInputCommand()
            ) {
                return;
            }

            const command =
                interaction.commandName;

            /*
            GUILD ONLY
            */

            const guildCommands =
                command !== 'botinfo' &&
                command !== 'help' &&
                command !== 'ai';

            if (
                guildCommands &&
                !isGuildInteraction(
                    interaction
                )
            ) {

                return interaction.reply({
                    content:
                        '❌ This command must be used inside a server.',
                    ephemeral: true
                });
            }

            /*
            STAFF CHECK
            */

            if (
                STAFF_COMMANDS.has(command) &&
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

            /*
            HELP
            */

            if (
                command === 'help'
            ) {

                const embed =
                    new EmbedBuilder()
                        .setTitle(
                            '🤖 AkiyO Help'
                        )
                        .setDescription(
                            [
                                '**🎫 Tickets**',
                                '`/ticket` `/ticketpanel` `/ticketsetup`',
                                '`/close` `/reopen` `/delete` `/claim` `/unclaim`',
                                '`/lock` `/unlock` `/ticketadd` `/ticketremove`',
                                '`/ticketrename` `/ticketinfo` `/ticketstats`',
                                '',
                                '**🛡️ Security**',
                                '`/automod` `/security` `/config`',
                                '',
                                '**⚖️ Moderation**',
                                '`/warn` `/timeout` `/kick` `/ban` `/unban`',
                                '`/warnings` `/punishments`',
                                '',
                                '**🎭 Community**',
                                '`/suggest` `/welcome` `/autorole` `/verification`',
                                '`/autoreactionrole` `/leaderboard`',
                                '',
                                '**📢 Utility**',
                                '`/announce` `/botinfo` `/help` `/ai`'
                            ].join('\n')
                        )
                        .setTimestamp();

                return interaction.reply({
                    embeds: [embed],
                    ephemeral: true
                });
            }

            /*
            BOT INFO
            */

            if (
                command === 'botinfo'
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

                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle(
                                '🤖 AkiyO Bot'
                            )
                            .addFields(
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

            /*
            AI
            */

            if (
                command === 'ai'
            ) {

                const sub =
                    interaction.options.getSubcommand();

                const key =
                    process.env.OPENAI_API_KEY;

                if (
                    sub === 'reset'
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

                if (!key) {

                    return interaction.reply({
                        content:
                            '❌ AI is not configured. Add `OPENAI_API_KEY` to the bot environment.',
                        ephemeral: true
                    });
                }

                const prompt =
                    interaction.options.getString(
                        'prompt'
                    );

                await interaction.deferReply();

                const history =
                    aiHistory.get(
                        interaction.user.id
                    ) || [];

                history.push({
                    role: 'user',
                    content: prompt
                });

                const model =
                    process.env.OPENAI_MODEL ||
                    'gpt-5.5';

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
                                        `Bearer ${key}`
                                },
                                body:
                                    JSON.stringify({
                                        model,
                                        input:
                                            history.slice(-12)
                                    })
                            }
                        );

                    const data =
                        await response.json();

                    if (!response.ok) {

                        throw new Error(
                            data?.error?.message ||
                            `HTTP ${response.status}`
                        );
                    }

                    const answer =
                        data.output_text ||
                        data.output
                            ?.flatMap(
                                item =>
                                    item.content || []
                            )
                            ?.map(
                                item =>
                                    item.text || ''
                            )
                            ?.join(' ') ||
                        'No response received.';

                    history.push({
                        role: 'assistant',
                        content: answer
                    });

                    aiHistory.set(
                        interaction.user.id,
                        history.slice(-12)
                    );

                    return interaction.editReply(
                        answer.slice(
                            0,
                            1900
                        )
                    );

                } catch (error) {

                    return interaction.editReply(
                        `❌ AI error: ${error.message.slice(0, 500)}`
                    );
                }
            }

            /*
            TICKET
            */

            if (
                command === 'ticket'
            ) {

                try {

                    const channel =
                        await createTicket(
                            interaction.guild,
                            interaction.user
                        );

                    return interaction.reply({
                        content:
                            `🎫 Ticket created: ${channel}`,
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

            /*
            TICKET PANEL
            */

            if (
                command === 'ticketpanel'
            ) {

                await interaction.channel.send({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle(
                                '🎫 AkiyO Support Center'
                            )
                            .setDescription(
                                'Need help? Click the button below to open a private support ticket.'
                            )
                            .setTimestamp()
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

            /*
            TICKET SETUP
            */

            if (
                command === 'ticketsetup'
            ) {

                const config =
                    getGuildConfig(
                        interaction.guild
                    );

                const category =
                    interaction.options.getChannel(
                        'category'
                    );

                const staffRole =
                    interaction.options.getRole(
                        'staffrole'
                    );

                const logChannel =
                    interaction.options.getChannel(
                        'logchannel'
                    );

                config.ticket.categoryId =
                    category.id;

                config.ticket.staffRoleId =
                    staffRole.id;

                if (logChannel) {
                    config.ticket.logChannelId =
                        logChannel.id;
                }

                saveDatabase();

                return interaction.reply(
                    '✅ Ticket system configured for this server.'
                );
            }

            /*
            CURRENT TICKET COMMANDS
            */

            if (
                [
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
                    'ticketinfo'
                ].includes(command)
            ) {

                const found =
                    findTicketByChannel(
                        interaction.guild.id,
                        interaction.channel.id
                    );

                if (!found) {

                    return interaction.reply({
                        content:
                            '❌ This is not a ticket.',
                        ephemeral: true
                    });
                }

                const config =
                    getGuildConfig(
                        interaction.guild
                    );

                if (
                    command === 'close'
                ) {

                    await interaction.reply(
                        '🔒 Closing ticket...'
                    );

                    await closeTicket(
                        interaction.guild,
                        interaction.channel,
                        interaction.user
                    );

                    return;
                }

                if (
                    command === 'delete'
                ) {

                    config.tickets[
                        found.userId
                    ].status = 'deleted';

                    saveDatabase();

                    await interaction.reply(
                        '🗑️ Deleting ticket...'
                    );

                    await sendLog(
                        interaction.guild,
                        'tickets',
                        '🗑️ Ticket Deleted',
                        [
                            field(
                                'User',
                                `<@${found.userId}>`
                            ),
                            field(
                                'Deleted by',
                                interaction.user.toString()
                            )
                        ]
                    );

                    return interaction.channel.delete()
                        .catch(() => {});
                }

                if (
                    command === 'reopen'
                ) {

                    await interaction.channel
                        .permissionOverwrites
                        .edit(
                            found.userId,
                            {
                                ViewChannel: true,
                                SendMessages: true,
                                ReadMessageHistory: true
                            }
                        );

                    config.tickets[
                        found.userId
                    ].status = 'open';

                    saveDatabase();

                    return interaction.reply(
                        '🔓 Ticket reopened.'
                    );
                }

                if (
                    command === 'lock'
                ) {

                    await interaction.channel
                        .permissionOverwrites
                        .edit(
                            found.userId,
                            {
                                ViewChannel: true,
                                SendMessages: false
                            }
                        );

                    return interaction.reply(
                        '🔐 Ticket locked.'
                    );
                }

                if (
                    command === 'unlock'
                ) {

                    await interaction.channel
                        .permissionOverwrites
                        .edit(
                            found.userId,
                            {
                                ViewChannel: true,
                                SendMessages: true,
                                ReadMessageHistory: true
                            }
                        );

                    return interaction.reply(
                        '🔓 Ticket unlocked.'
                    );
                }

                if (
                    command === 'claim'
                ) {

                    ticketClaims.set(
                        interaction.channel.id,
                        interaction.user.id
                    );

                    config.tickets[
                        found.userId
                    ].claimedBy =
                        interaction.user.id;

                    saveDatabase();

                    return interaction.reply(
                        `🙋 Ticket claimed by ${interaction.user}.`
                    );
                }

                if (
                    command === 'unclaim'
                ) {

                    ticketClaims.delete(
                        interaction.channel.id
                    );

                    config.tickets[
                        found.userId
                    ].claimedBy = null;

                    saveDatabase();

                    return interaction.reply(
                        '✅ Ticket unclaimed.'
                    );
                }

                if (
                    command === 'ticketadd'
                ) {

                    const user =
                        interaction.options.getUser(
                            'user'
                        );

                    await interaction.channel
                        .permissionOverwrites
                        .edit(
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

                if (
                    command === 'ticketremove'
                ) {

                    const user =
                        interaction.options.getUser(
                            'user'
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
                    command === 'ticketrename'
                ) {

                    const name =
                        interaction.options
                            .getString('name')
                            .replace(
                                /[^a-zA-Z0-9-_]/g,
                                '-'
                            )
                            .slice(0, 90);

                    await interaction.channel
                        .setName(
                            name
                        );

                    return interaction.reply(
                        `✅ Ticket renamed to \`${name}\`.`
                    );
                }

                if (
                    command === 'ticketinfo'
                ) {

                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle(
                                    '🎫 Ticket Information'
                                )
                                .addFields(
                                    field(
                                        'Owner',
                                        `<@${found.userId}>`
                                    ),
                                    field(
                                        'Status',
                                        config.tickets[
                                            found.userId
                                        ].status
                                    ),
                                    field(
                                        'Claimed By',
                                        config.tickets[
                                            found.userId
                                        ].claimedBy
                                            ? `<@${config.tickets[found.userId].claimedBy}>`
                                            : 'Nobody'
                                    ),
                                    field(
                                        'Created',
                                        `<t:${Math.floor(config.tickets[found.userId].createdAt / 1000)}:F>`
                                    )
                                )
                        ],
                        ephemeral: true
                    });
                }
            }

            /*
            TICKET STATS
            */

            if (
                command === 'ticketstats'
            ) {

                const config =
                    getGuildConfig(
                        interaction.guild
                    );

                const values =
                    Object.values(
                        config.tickets
                    );

                const open =
                    values.filter(
                        x => x.status === 'open'
                    ).length;

                const closed =
                    values.filter(
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
                                    'Open',
                                    open,
                                    true
                                ),
                                field(
                                    'Closed',
                                    closed,
                                    true
                                ),
                                field(
                                    'Total',
                                    values.length,
                                    true
                                )
                            )
                    ]
                });
            }

            /*
            AUTOMOD
            */

            if (
                command === 'automod'
            ) {

                const config =
                    getGuildConfig(
                        interaction.guild
                    );

                const sub =
                    interaction.options.getSubcommand();

                if (
                    sub === 'enable'
                ) {
                    config.automod.enabled =
                        true;
                }

                if (
                    sub === 'disable'
                ) {
                    config.automod.enabled =
                        false;
                }

                if (
                    sub === 'config'
                ) {

                    const spamLimit =
                        interaction.options.getInteger(
                            'spam_limit'
                        );

                    const spamWindow =
                        interaction.options.getInteger(
                            'spam_window'
                        );

                    const caps =
                        interaction.options.getInteger(
                            'caps_percent'
                        );

                    if (
                        spamLimit !== null
                    ) {
                        config.automod.spamLimit =
                            spamLimit;
                    }

                    if (
                        spamWindow !== null
                    ) {
                        config.automod.spamWindow =
                            spamWindow * 1000;
                    }

                    if (
                        caps !== null
                    ) {
                        config.automod.capsPercent =
                            caps;
                    }
                }

                if (
                    sub === 'badword'
                ) {

                    const word =
                        interaction.options
                            .getString(
                                'word'
                            )
                            .toLowerCase();

                    if (
                        !config.automod.badWords
                            .includes(word)
                    ) {

                        config.automod.badWords
                            .push(word);
                    }
                }

                if (
                    sub === 'removebadword'
                ) {

                    const word =
                        interaction.options
                            .getString(
                                'word'
                            )
                            .toLowerCase();

                    config.automod.badWords =
                        config.automod.badWords
                            .filter(
                                x => x !== word
                            );
                }

                saveDatabase();

                if (
                    sub === 'status'
                ) {

                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle(
                                    '🛡️ AutoMod Status'
                                )
                                .addFields(
                                    field(
                                        'Enabled',
                                        config.automod.enabled
                                            ? 'ON'
                                            : 'OFF',
                                        true
                                    ),
                                    field(
                                        'Spam Limit',
                                        config.automod.spamLimit,
                                        true
                                    ),
                                    field(
                                        'Caps',
                                        `${config.automod.capsPercent}%`,
                                        true
                                    ),
                                    field(
                                        'Bad Words',
                                        config.automod.badWords.length,
                                        true
                                    ),
                                    field(
                                        'Invite Protection',
                                        config.automod.invite
                                            ? 'ON'
                                            : 'OFF',
                                        true
                                    ),
                                    field(
                                        'Mass Mention',
                                        config.automod.massMentions
                                            ? 'ON'
                                            : 'OFF',
                                        true
                                    )
                                )
                        ],
                        ephemeral: true
                    });
                }

                return interaction.reply(
                    '✅ AutoMod configuration saved.'
                );
            }

            /*
            SECURITY
            */

            if (
                command === 'security'
            ) {

                const config =
                    getGuildConfig(
                        interaction.guild
                    );

                const sub =
                    interaction.options.getSubcommand();

                if (
                    sub === 'enable'
                ) {
                    config.security.enabled =
                        true;
                }

                if (
                    sub === 'disable'
                ) {
                    config.security.enabled =
                        false;
                }

                if (
                    sub === 'action'
                ) {

                    config.security.action =
                        interaction.options.getString(
                            'action'
                        );
                }

                if (
                    sub === 'trusted' ||
                    sub === 'untrusted'
                ) {

                    const id =
                        interaction.options
                            .getUser('user')
                            .id;

                    if (
                        sub === 'trusted'
                    ) {

                        if (
                            !config.security
                                .trustedUsers
                                .includes(id)
                        ) {
                            config.security
                                .trustedUsers
                                .push(id);
                        }

                    } else {

                        config.security
                            .trustedUsers =
                            config.security
                                .trustedUsers
                                .filter(
                                    x => x !== id
                                );
                    }
                }

                if (
                    sub === 'trustedmember' ||
                    sub === 'untrustedmember'
                ) {

                    const id =
                        interaction.options
                            .getUser('user')
                            .id;

                    if (
                        sub === 'trustedmember'
                    ) {

                        if (
                            !config.security
                                .trustedMembers
                                .includes(id)
                        ) {

                            config.security
                                .trustedMembers
                                .push(id);
                        }

                    } else {

                        config.security
                            .trustedMembers =
                            config.security
                                .trustedMembers
                                .filter(
                                    x => x !== id
                                );
                    }
                }

                if (
                    sub === 'trustedbot' ||
                    sub === 'untrustedbot'
                ) {

                    const id =
                        interaction.options
                            .getUser('user')
                            .id;

                    if (
                        sub === 'trustedbot'
                    ) {

                        if (
                            !config.security
                                .trustedBots
                                .includes(id)
                        ) {

                            config.security
                                .trustedBots
                                .push(id);
                        }

                    } else {

                        config.security
                            .trustedBots =
                            config.security
                                .trustedBots
                                .filter(
                                    x => x !== id
                                );
                    }
                }

                if (
                    sub === 'trustedrole'
                ) {

                    config.security
                        .trustedRoleId =
                        interaction.options
                            .getRole('role')
                            .id;
                }

                if (
                    sub === 'protectedrole' ||
                    sub === 'unprotectedrole'
                ) {

                    const id =
                        interaction.options
                            .getRole('role')
                            .id;

                    if (
                        sub === 'protectedrole'
                    ) {

                        if (
                            !config.security
                                .protectedRoles
                                .includes(id)
                        ) {

                            config.security
                                .protectedRoles
                                .push(id);
                        }

                    } else {

                        config.security
                            .protectedRoles =
                            config.security
                                .protectedRoles
                                .filter(
                                    x => x !== id
                                );
                    }
                }

                if (
                    sub === 'protectedchannel' ||
                    sub === 'unprotectedchannel'
                ) {

                    const id =
                        interaction.options
                            .getChannel('channel')
                            .id;

                    if (
                        sub === 'protectedchannel'
                    ) {

                        if (
                            !config.security
                                .protectedChannels
                                .includes(id)
                        ) {

                            config.security
                                .protectedChannels
                                .push(id);
                        }

                    } else {

                        config.security
                            .protectedChannels =
                            config.security
                                .protectedChannels
                                .filter(
                                    x => x !== id
                                );
                    }
                }

                saveDatabase();

                if (
                    sub === 'status'
                ) {

                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle(
                                    '🔐 Security Status'
                                )
                                .addFields(
                                    field(
                                        'Enabled',
                                        config.security.enabled
                                            ? 'ON'
                                            : 'OFF',
                                        true
                                    ),
                                    field(
                                        'Action',
                                        config.security.action,
                                        true
                                    ),
                                    field(
                                        'Trusted Users',
                                        config.security.trustedUsers.length,
                                        true
                                    ),
                                    field(
                                        'Trusted Bots',
                                        config.security.trustedBots.length,
                                        true
                                    ),
                                    field(
                                        'Trusted Members',
                                        config.security.trustedMembers.length,
                                        true
                                    ),
                                    field(
                                        'Protected Roles',
                                        config.security.protectedRoles.length,
                                        true
                                    ),
                                    field(
                                        'Protected Channels',
                                        config.security.protectedChannels.length,
                                        true
                                    )
                                )
                        ],
                        ephemeral: true
                    });
                }

                if (
                    sub === 'list'
                ) {

                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle(
                                    '🔐 Security Configuration'
                                )
                                .setDescription(
                                    [
                                        `**Trusted users:** ${config.security.trustedUsers.map(id => `<@${id}>`).join(', ') || 'None'}`,
                                        `**Trusted bots:** ${config.security.trustedBots.map(id => `<@${id}>`).join(', ') || 'None'}`,
                                        `**Trusted members:** ${config.security.trustedMembers.map(id => `<@${id}>`).join(', ') || 'None'}`,
                                        `**Trusted role:** ${config.security.trustedRoleId ? `<@&${config.security.trustedRoleId}>` : 'None'}`,
                                        `**Protected roles:** ${config.security.protectedRoles.map(id => `<@&${id}>`).join(', ') || 'None'}`,
                                        `**Protected channels:** ${config.security.protectedChannels.map(id => `<#${id}>`).join(', ') || 'None'}`
                                    ].join('\n')
                                )
                        ],
                        ephemeral: true
                    });
                }

                return interaction.reply(
                    '🔐 Security configuration saved.'
                );
            }

            /*
            CONFIG
            */

            if (
                command === 'config'
            ) {

                const config =
                    getGuildConfig(
                        interaction.guild
                    );

                const sub =
                    interaction.options.getSubcommand();

                if (
                    sub === 'log'
                ) {

                    const type =
                        interaction.options
                            .getString(
                                'type'
                            );

                    const channel =
                        interaction.options
                            .getChannel(
                                'channel'
                            );

                    config.logs[type] =
                        channel.id;
                }

                if (
                    sub === 'suggestions'
                ) {

                    config.suggestionsChannelId =
                        interaction.options
                            .getChannel(
                                'channel'
                            )
                            .id;
                }

                if (
                    sub === 'timeout'
                ) {

                    const type =
                        interaction.options
                            .getString(
                                'type'
                            );

                    const seconds =
                        interaction.options
                            .getInteger(
                                'seconds'
                            );

                    config.automod
                        .timeoutSeconds[type] =
                        seconds;
                }

                if (
                    sub === 'security'
                ) {

                    const mapping = [
                        [
                            'mass_ban',
                            'massBan'
                        ],
                        [
                            'mass_kick',
                            'massKick'
                        ],
                        [
                            'mass_channel_delete',
                            'massChannelDelete'
                        ],
                        [
                            'mass_channel_create',
                            'massChannelCreate'
                        ],
                        [
                            'mass_role_delete',
                            'massRoleDelete'
                        ],
                        [
                            'mass_role_create',
                            'massRoleCreate'
                        ]
                    ];

                    for (
                        const [option, key]
                        of mapping
                    ) {

                        const value =
                            interaction.options
                                .getInteger(
                                    option
                                );

                        if (
                            value !== null
                        ) {

                            config.security[key] =
                                value;
                        }
                    }
                }

                saveDatabase();

                return interaction.reply(
                    '⚙️ Configuration saved.'
                );
            }

            /*
            MODERATION
            */

            if (
                [
                    'warn',
                    'timeout',
                    'kick',
                    'ban',
                    'unban'
                ].includes(command)
            ) {

                const reason =
                    interaction.options
                        .getString(
                            'reason'
                        );

                if (
                    command === 'unban'
                ) {

                    const id =
                        interaction.options
                            .getString(
                                'user_id'
                            );

                    await interaction.guild.members
                        .unban(
                            id,
                            reason
                        );

                    await addPunishment(
                        interaction.guild,
                        id,
                        'unban',
                        reason,
                        interaction.user.id
                    );

                    return interaction.reply(
                        `✅ <@${id}> unbanned.`
                    );
                }

                const user =
                    interaction.options
                        .getUser(
                            'user'
                        );

                const member =
                    await interaction.guild.members
                        .fetch(
                            user.id
                        )
                        .catch(() => null);

                if (!member) {

                    return interaction.reply({
                        content:
                            '❌ Member not found.',
                        ephemeral: true
                    });
                }

                if (
                    !canModerateTarget(
                        interaction.member,
                        member
                    )
                ) {

                    return interaction.reply({
                        content:
                            '❌ You cannot moderate this member because of role hierarchy.',
                        ephemeral: true
                    });
                }

                if (
                    command === 'warn'
                ) {

                    const count =
                        await addWarning(
                            member,
                            reason,
                            interaction.user.id
                        );

                    await sendLog(
                        interaction.guild,
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
                                'Total Warnings',
                                count
                            )
                        ],
                        0xfee75c
                    );

                    return interaction.reply(
                        `⚠️ ${user} warned. Total warnings: **${count}**`
                    );
                }

                if (
                    command === 'timeout'
                ) {

                    const seconds =
                        interaction.options
                            .getInteger(
                                'seconds'
                            );

                    if (
                        !member.moderatable
                    ) {

                        return interaction.reply({
                            content:
                                '❌ I cannot timeout this member.',
                            ephemeral: true
                        });
                    }

                    await member.timeout(
                        seconds * 1000,
                        reason
                    );

                    await addPunishment(
                        interaction.guild,
                        user.id,
                        'timeout',
                        reason,
                        interaction.user.id
                    );

                    return interaction.reply(
                        `⏱️ ${user} timed out for **${seconds} seconds**.`
                    );
                }

                if (
                    command === 'kick'
                ) {

                    if (
                        !member.kickable
                    ) {

                        return interaction.reply({
                            content:
                                '❌ I cannot kick this member.',
                            ephemeral: true
                        });
                    }

                    await member.kick(
                        reason
                    );

                    await addPunishment(
                        interaction.guild,
                        user.id,
                        'kick',
                        reason,
                        interaction.user.id
                    );

                    return interaction.reply(
                        `👢 ${user.tag} kicked.`
                    );
                }

                if (
                    command === 'ban'
                ) {

                    if (
                        !member.bannable
                    ) {

                        return interaction.reply({
                            content:
                                '❌ I cannot ban this member.',
                            ephemeral: true
                        });
                    }

                    await member.ban({
                        reason
                    });

                    await addPunishment(
                        interaction.guild,
                        user.id,
                        'ban',
                        reason,
                        interaction.user.id
                    );

                    return interaction.reply(
                        `🔨 ${user.tag} banned.`
                    );
                }
            }

            /*
            WARNINGS / PUNISHMENTS
            */

            if (
                command === 'warnings' ||
                command === 'punishments'
            ) {

                const user =
                    interaction.options
                        .getUser(
                            'user'
                        );

                const config =
                    getGuildConfig(
                        interaction.guild
                    );

                const records =
                    command === 'warnings'
                        ? (
                            config.warnings[
                                user.id
                            ] || []
                        )
                        : (
                            config.punishments[
                                user.id
                            ] || []
                        );

                const description =
                    records.length
                        ? records
                            .slice(-15)
                            .map(
                                (record, index) =>
                                    `**${index + 1}.** ${record.type || 'warn'} — ${record.reason || 'No reason'} — <t:${Math.floor(record.time / 1000)}:R>`
                            )
                            .join('\n')
                        : 'No records.';

                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle(
                                command === 'warnings'
                                    ? '⚠️ Warnings'
                                    : '⚖️ Punishments'
                            )
                            .setDescription(
                                description
                            )
                    ],
                    ephemeral: true
                });
            }

            /*
            SUGGESTIONS
            */

            if (
                command === 'suggest'
            ) {

                const config =
                    getGuildConfig(
                        interaction.guild
                    );

                const text =
                    interaction.options
                        .getString(
                            'text'
                        );

                const channel =
                    config.suggestionsChannelId
                        ? await interaction.guild.channels
                            .fetch(
                                config.suggestionsChannelId
                            )
                            .catch(() => null)
                        : null;

                if (
                    !channel?.isTextBased()
                ) {

                    return interaction.reply({
                        content:
                            '❌ Suggestion channel is not configured. Use `/config suggestions` first.',
                        ephemeral: true
                    });
                }

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
                                    ),
                                    field(
                                        'Status',
                                        '🟡 Pending'
                                    )
                                )
                                .setTimestamp()
                        ],
                        components: [
                            new ActionRowBuilder()
                                .addComponents(
                                    new ButtonBuilder()
                                        .setCustomId(
                                            'suggest_approve'
                                        )
                                        .setLabel(
                                            'Approve'
                                        )
                                        .setEmoji('✅')
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
                                        .setEmoji('❌')
                                        .setStyle(
                                            ButtonStyle.Danger
                                        )
                                ]
                        ]
                    });

                config.suggestions[
                    message.id
                ] = {
                    messageId: message.id,
                    userId:
                        interaction.user.id,
                    text,
                    status: 'pending',
                    createdAt: Date.now()
                };

                saveDatabase();

                return interaction.reply({
                    content:
                        `✅ Suggestion posted: ${message.url}`,
                    ephemeral: true
                });
            }

            /*
            SUGGESTION BUTTONS
            */

            /*
               Handled separately below because buttons return
               before slash command processing.
            */

            /*
            ANNOUNCE
            */

            if (
                command === 'announce'
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

                const image =
                    interaction.options
                        .getString(
                            'image'
                        );

                const thumbnail =
                    interaction.options
                        .getString(
                            'thumbnail'
                        );

                const useEmbed =
                    interaction.options
                        .getBoolean(
                            'embed'
                        );

                let prefix = '';

                const everyone =
                    interaction.options
                        .getBoolean(
                            'everyone'
                        );

                const here =
                    interaction.options
                        .getBoolean(
                            'here'
                        );

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

                if (everyone) {
                    prefix +=
                        '@everyone ';
                }

                if (here) {
                    prefix +=
                        '@here ';
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
                    allowedMentions.parse
                        .push('everyone');
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
                    interaction.guild,
                    'announcements',
                    '📢 Announcement',
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

            /*
            AUTOROLE
            */

            if (
                command === 'autorole'
            ) {

                const config =
                    getGuildConfig(
                        interaction.guild
                    );

                const sub =
                    interaction.options
                        .getSubcommand();

                if (
                    sub === 'set'
                ) {

                    const role =
                        interaction.options
                            .getRole(
                                'role'
                            );

                    if (
                        !botCanManageRole(
                            interaction.guild,
                            role
                        )
                    ) {

                        return interaction.reply({
                            content:
                                '❌ My highest role must be above that role.',
                            ephemeral: true
                        });
                    }

                    config.autorole.enabled =
                        true;

                    config.autorole.roleId =
                        role.id;
                }

                if (
                    sub === 'disable'
                ) {

                    config.autorole.enabled =
                        false;
                }

                saveDatabase();

                if (
                    sub === 'status'
                ) {

                    return interaction.reply({
                        content:
                            `👤 Autorole: ${config.autorole.enabled ? 'ON' : 'OFF'}\nRole: ${config.autorole.roleId ? `<@&${config.autorole.roleId}>` : 'None'}`,
                        ephemeral: true
                    });
                }

                return interaction.reply(
                    '✅ Autorole configuration saved.'
                );
            }

            /*
            WELCOME
            */

            if (
                command === 'welcome'
            ) {

                const config =
                    getGuildConfig(
                        interaction.guild
                    );

                const sub =
                    interaction.options
                        .getSubcommand();

                if (
                    sub === 'set'
                ) {

                    config.welcome = {
                        enabled: true,
                        channelId:
                            interaction.options
                                .getChannel(
                                    'channel'
                                )
                                .id,
                        message:
                            interaction.options
                                .getString(
                                    'message'
                                )
                    };
                }

                if (
                    sub === 'disable'
                ) {

                    config.welcome.enabled =
                        false;
                }

                saveDatabase();

                if (
                    sub === 'status'
                ) {

                    return interaction.reply({
                        content:
                            `👋 Welcome: ${config.welcome.enabled ? 'ON' : 'OFF'}\nChannel: ${config.welcome.channelId ? `<#${config.welcome.channelId}>` : 'None'}\nMessage: ${config.welcome.message}`,
                        ephemeral: true
                    });
                }

                return interaction.reply(
                    '✅ Welcome configuration saved.'
                );
            }

            /*
            VERIFICATION
            */

            if (
                command === 'verification'
            ) {

                const config =
                    getGuildConfig(
                        interaction.guild
                    );

                const sub =
                    interaction.options
                        .getSubcommand();

                if (
                    sub === 'setup'
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
                            interaction.guild,
                            role
                        )
                    ) {

                        return interaction.reply({
                            content:
                                '❌ My highest role must be above the verification role.',
                            ephemeral: true
                        });
                    }

                    const row =
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
                            );

                    const message =
                        await channel.send({
                            embeds: [
                                new EmbedBuilder()
                                    .setTitle(
                                        '✅ Server Verification'
                                    )
                                    .setDescription(
                                        'Click the button below to verify yourself.'
                                    )
                            ],
                            components: [
                                row
                            ]
                        });

                    config.verification = {
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
                    sub === 'disable'
                ) {

                    config.verification.enabled =
                        false;
                }

                saveDatabase();

                if (
                    sub === 'status'
                ) {

                    return interaction.reply({
                        content:
                            `✅ Verification: ${config.verification.enabled ? 'ON' : 'OFF'}\nChannel: ${config.verification.channelId ? `<#${config.verification.channelId}>` : 'None'}\nRole: ${config.verification.roleId ? `<@&${config.verification.roleId}>` : 'None'}`,
                        ephemeral: true
                    });
                }

                return interaction.reply(
                    '✅ Verification configuration saved.'
                );
            }

            /*
            REACTION ROLES
            */

            if (
                command ===
                'autoreactionrole'
            ) {

                const sub =
                    interaction.options
                        .getSubcommand();

                if (
                    sub === 'add'
                ) {

                    return addReactionRole(
                        interaction
                    );
                }

                if (
                    sub === 'remove'
                ) {

                    return removeReactionRole(
                        interaction
                    );
                }

                return listReactionRoles(
                    interaction
                );
            }

            /*
            LEADERBOARD
            */

            if (
                command ===
                'leaderboard'
            ) {

                const config =
                    getGuildConfig(
                        interaction.guild
                    );

                const sub =
                    interaction.options
                        .getSubcommand();

                if (
                    sub === 'reset'
                ) {

                    config.leaderboard.messages =
                        {};

                    saveDatabase();

                    return interaction.reply(
                        '🗑️ Leaderboard reset.'
                    );
                }

                if (
                    sub === 'enable'
                ) {

                    config.leaderboard.enabled =
                        true;

                    saveDatabase();

                    return interaction.reply(
                        '📊 Leaderboard enabled.'
                    );
                }

                if (
                    sub === 'disable'
                ) {

                    config.leaderboard.enabled =
                        false;

                    saveDatabase();

                    return interaction.reply(
                        '📊 Leaderboard disabled.'
                    );
                }

                if (
                    sub === 'status'
                ) {

                    return interaction.reply({
                        content:
                            `📊 Leaderboard: ${config.leaderboard.enabled ? 'ON' : 'OFF'}`,
                        ephemeral: true
                    });
                }

                const top =
                    Object.entries(
                        config.leaderboard.messages
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
                                '🏆 Message Leaderboard'
                            )
                            .setDescription(
                                top.length
                                    ? top.map(
                                        ([id, count], index) =>
                                            `${index + 1}. <@${id}> — **${count}** messages`
                                    ).join('\n')
                                    : 'No messages yet.'
                            )
                    ]
                });
            }

            /*
            ADS
            */

            if (
                command === 'ads'
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

                const config =
                    getGuildConfig(
                        interaction.guild
                    );

                const sub =
                    interaction.options
                        .getSubcommand();

                if (
                    sub === 'set'
                ) {

                    config.ads.channelId =
                        interaction.options
                            .getChannel(
                                'channel'
                            )
                            .id;
                }

                if (
                    sub === 'message'
                ) {

                    config.ads.message =
                        interaction.options
                            .getString(
                                'text'
                            );
                }

                if (
                    sub === 'interval'
                ) {

                    config.ads.intervalMinutes =
                        interaction.options
                            .getInteger(
                                'minutes'
                            );
                }

                if (
                    sub === 'enable'
                ) {

                    config.ads.enabled =
                        true;
                }

                if (
                    sub === 'disable'
                ) {

                    config.ads.enabled =
                        false;
                }

                if (
                    sub === 'status'
                ) {

                    return interaction.reply({
                        content:
                            `📢 Ads: ${config.ads.enabled ? 'ON' : 'OFF'}\nChannel: ${config.ads.channelId ? `<#${config.ads.channelId}>` : 'None'}\nInterval: ${config.ads.intervalMinutes} minutes\nMessage: ${config.ads.message}`,
                        ephemeral: true
                    });
                }

                if (
                    sub === 'broadcast'
                ) {

                    let sent = 0;

                    for (
                        const guild
                        of client.guilds.cache.values()
                    ) {

                        const targetConfig =
                            getGuildConfig(
                                guild
                            );

                        if (
                            !targetConfig.ads.enabled ||
                            !targetConfig.ads.channelId
                        ) {
                            continue;
                        }

                        const channel =
                            await guild.channels.fetch(
                                targetConfig.ads.channelId
                            ).catch(() => null);

                        if (
                            channel?.isTextBased()
                        ) {

                            await channel.send(
                                targetConfig.ads.message
                            ).catch(() => {});

                            sent++;
                        }
                    }

                    return interaction.reply(
                        `📢 Advertisement broadcast sent to ${sent} servers.`
                    );
                }

                saveDatabase();

                return interaction.reply(
                    '📢 Advertisement configuration saved.'
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

                await interaction.reply({
                    content:
                        '❌ An internal error occurred. Check the bot console.',
                    ephemeral: true
                }).catch(() => {});

            } else if (
                interaction.deferred
            ) {

                await interaction.editReply({
                    content:
                        '❌ An internal error occurred. Check the bot console.'
                }).catch(() => {});
            }
        }
    }
);

/* =========================================================
   SUGGESTION BUTTONS
========================================================= */

client.on(
    'interactionCreate',
    async interaction => {

        try {

            if (
                !interaction.isButton()
            ) {
                return;
            }

            if (
                interaction.customId !==
                    'suggest_approve' &&
                interaction.customId !==
                    'suggest_decline'
            ) {
                return;
            }

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

            const config =
                getGuildConfig(
                    interaction.guild
                );

            const suggestion =
                config.suggestions[
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
                        '❌ This suggestion has already been decided.',
                    ephemeral: true
                });
            }

            const approved =
                interaction.customId ===
                'suggest_approve';

            suggestion.status =
                approved
                    ? 'approved'
                    : 'declined';

            suggestion.decidedBy =
                interaction.user.id;

            suggestion.decidedAt =
                Date.now();

            const oldEmbed =
                interaction.message.embeds[0];

            const newEmbed =
                EmbedBuilder.from(
                    oldEmbed
                );

            newEmbed.spliceFields(
                1,
                1,
                field(
                    'Status',
                    approved
                        ? '🟢 Approved'
                        : '🔴 Declined'
                ),
                field(
                    'Decision by',
                    interaction.user.toString()
                )
            );

            await interaction.message.edit({
                embeds: [
                    newEmbed
                ],
                components: []
            });

            saveDatabase();

            await sendLog(
                interaction.guild,
                'suggestion',
                approved
                    ? '✅ Suggestion Approved'
                    : '❌ Suggestion Declined',
                [
                    field(
                        'Suggested by',
                        `<@${suggestion.userId}>`
                    ),
                    field(
                        'Moderator',
                        interaction.user.toString()
                    ),
                    field(
                        'Suggestion',
                        suggestion.text
                    )
                ],
                approved
                    ? 0x57f287
                    : 0xed4245
            );

            return interaction.reply({
                content:
                    approved
                        ? '✅ Suggestion approved.'
                        : '❌ Suggestion declined.',
                ephemeral: true
            });

        } catch (error) {

            console.error(
                'Suggestion button:',
                error
            );
        }
    }
);

/* =========================================================
   ADS SCHEDULER
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

                /*
                   Last send timestamp is stored inside config.
                */

                const now =
                    Date.now();

                const interval =
                    config.ads.intervalMinutes *
                    60 *
                    1000;

                if (
                    config.ads.lastSent &&
                    now -
                        config.ads.lastSent <
                        interval
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

                config.ads.lastSent =
                    now;

                saveDatabase();
            }

        } catch (error) {

            console.error(
                'Ads scheduler:',
                error
            );
        }

    },
    60 * 1000
);

/* =========================================================
   GUILD JOIN
========================================================= */

client.on(
    'guildCreate',
    guild => {

        try {

            getGuildConfig(
                guild
            );

            saveDatabase();

            console.log(
                `Joined guild: ${guild.name} (${guild.id})`
            );

        } catch (error) {

            console.error(
                'guildCreate:',
                error
            );
        }
    }
);

/* =========================================================
   READY
========================================================= */

client.once(
    'clientReady',
    async () => {

        console.log(
            `Logged in as ${client.user.tag}`
        );

        console.log(
            `AkiyO is connected to ${client.guilds.cache.size} servers.`
        );

        console.log(
            `Commands: ${commands.length}`
        );

        try {

            await registerCommands();

        } catch (error) {

            console.error(
                'Command registration error:',
                error
            );
        }

        await restoreTickets();

        console.log(
            'AkiyO is fully online.'
        );
    }
);

/* =========================================================
   ERROR HANDLING
========================================================= */

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

process.on(
    'SIGTERM',
    () => {

        console.log(
            'SIGTERM received. Saving database.'
        );

        saveDatabase();

        client.destroy();

        process.exit(0);
    }
);

process.on(
    'SIGINT',
    () => {

        console.log(
            'SIGINT received. Saving database.'
        );

        saveDatabase();

        client.destroy();

        process.exit(0);
    }
);

/* =========================================================
   LOGIN
========================================================= */

client.login(
    TOKEN
);
