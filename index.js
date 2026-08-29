// ======================================================
// TRILOK DISCORD BOT v4.0
// DM TICKETS + AUTOMOD + SECURITY + AUDIT LOGS
// MASS TAG PROTECTION + PUNISHMENTS + SUGGESTIONS
// ANNOUNCEMENTS
// ======================================================

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

// ======================================================
// WEB SERVER
// ======================================================

const PORT = Number(process.env.PORT) || 10000;

const webServer = http.createServer((req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8"
  });

  res.end("TRILOK BOT ONLINE");
});

webServer.listen(PORT, "0.0.0.0", () => {
  console.log(`WEB SERVER READY ON PORT ${PORT}`);
});

// ======================================================
// ENVIRONMENT
// ======================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const GUILD_ID = "1493700265499689154";

const SUPPORT_ROLE_ID = "1542498406981959801";

const SUPPORT_LOG_CHANNEL_ID = "1542500573000106024";

// ======================================================
// CHECK ENVIRONMENT
// ======================================================

if (!TOKEN) {
  console.error("DISCORD_TOKEN is missing.");
  process.exit(1);
}

if (!CLIENT_ID) {
  console.error("CLIENT_ID is missing.");
  process.exit(1);
}

// ======================================================
// DATA STORAGE
// ======================================================

const DATA_DIR = path.join(__dirname, "data");
const CONFIG_FILE = path.join(DATA_DIR, "config.json");
const WARN_FILE = path.join(DATA_DIR, "warnings.json");

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadJSON(file, fallback) {
  try {
    if (!fs.existsSync(file)) {
      fs.writeFileSync(
        file,
        JSON.stringify(fallback, null, 2)
      );
      return fallback;
    }

    return JSON.parse(
      fs.readFileSync(file, "utf8")
    );
  } catch (error) {
    console.error(`Could not load ${file}:`, error);
    return fallback;
  }
}

function saveJSON(file, data) {
  try {
    fs.writeFileSync(
      file,
      JSON.stringify(data, null, 2)
    );
  } catch (error) {
    console.error(`Could not save ${file}:`, error);
  }
}

// ======================================================
// DEFAULT CONFIG
// ======================================================

const defaultConfig = {
  automod: {
    enabled: true,
    spamLimit: 6,
    spamWindow: 5000,

    timeout: {
      spam: 60,
      massTag: 300,
      invite: 60,
      badWord: 300,
      caps: 30,
      repeat: 60
    },

    inviteFilter: true,
    massTagProtection: true,
    badWordFilter: true,
    capsProtection: true,
    repeatProtection: true,

    badWords: []
  },

  security: {
    enabled: true,

    antiNuke: true,

    massBanLimit: 3,
    massKickLimit: 3,
    massChannelDeleteLimit: 3,
    massRoleDeleteLimit: 3,
    massChannelCreateLimit: 5,
    massRoleCreateLimit: 5,

    action: "ban",

    trustedUsers: [],
    trustedBots: []
  },

  logs: {
    automod: SUPPORT_LOG_CHANNEL_ID,
    security: SUPPORT_LOG_CHANNEL_ID,
    audit: SUPPORT_LOG_CHANNEL_ID,
    punishment: SUPPORT_LOG_CHANNEL_ID,
    suggestions: SUPPORT_LOG_CHANNEL_ID
  },

  suggestions: {
    enabled: true,
    channelId: null,
    staffOnlyDecision: true
  },

  tickets: {
    categoryId: null
  }
};

let config = loadJSON(
  CONFIG_FILE,
  defaultConfig
);

let warnings = loadJSON(
  WARN_FILE,
  {}
);

// ======================================================
// MERGE DEFAULT CONFIG
// ======================================================

function mergeDefaults(target, defaults) {
  for (const key of Object.keys(defaults)) {
    if (
      typeof defaults[key] === "object" &&
      defaults[key] !== null &&
      !Array.isArray(defaults[key])
    ) {
      if (
        typeof target[key] !== "object" ||
        target[key] === null ||
        Array.isArray(target[key])
      ) {
        target[key] = {};
      }

      mergeDefaults(
        target[key],
        defaults[key]
      );
    } else if (
      target[key] === undefined
    ) {
      target[key] = defaults[key];
    }
  }

  return target;
}

config = mergeDefaults(
  config,
  defaultConfig
);

saveJSON(
  CONFIG_FILE,
  config
);

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
    GatewayIntentBits.GuildModeration
  ],

  partials: [
    Partials.Channel,
    Partials.Message,
    Partials.User
  ]
});

// ======================================================
// MEMORY
// ======================================================

const tickets = new Map();

const spamTracker = new Map();

const recentJoins = [];

const securityTracker = new Map();

// ======================================================
// STAFF
// ======================================================

function isStaff(member) {
  if (!member) return false;

  return (
    member.permissions.has(
      PermissionFlagsBits.Administrator
    ) ||
    member.roles.cache.has(
      SUPPORT_ROLE_ID
    )
  );
}

// ======================================================
// LOG CHANNEL
// ======================================================

async function getLogChannel(guild, type = "audit") {
  try {
    const channelId =
      config.logs[type] ||
      SUPPORT_LOG_CHANNEL_ID;

    const channel =
      await guild.channels.fetch(channelId)
        .catch(() => null);

    if (
      channel &&
      channel.isTextBased()
    ) {
      return channel;
    }

    return null;
  } catch {
    return null;
  }
}

// ======================================================
// LOG SYSTEM
// ======================================================

async function sendLog(
  guild,
  title,
  description,
  options = {}
) {
  try {
    const channel =
      await getLogChannel(
        guild,
        options.type || "audit"
      );

    if (!channel) return;

    const embed =
      new EmbedBuilder()
        .setTitle(title)
        .setDescription(
          description.slice(0, 4096)
        )
        .setTimestamp();

    if (options.color) {
      embed.setColor(options.color);
    }

    if (options.fields) {
      embed.addFields(
        options.fields.slice(0, 25)
      );
    }

    await channel.send({
      embeds: [embed],
      files: options.files || []
    });
  } catch (error) {
    console.error(
      "Log error:",
      error.message
    );
  }
}

// ======================================================
// GET TICKET
// ======================================================

function getTicketByChannel(channelId) {
  for (const [userId, ticket] of tickets) {
    if (ticket.channelId === channelId) {
      return {
        userId,
        ticket
      };
    }
  }

  return null;
}

// ======================================================
// TICKET BUTTONS
// ======================================================

function ticketButtons() {
  return new ActionRowBuilder()
    .addComponents(
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

// ======================================================
// COMMANDS
// ======================================================

const commands = [

  // ---------------- TICKETS ----------------

  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Create a support ticket."),

  new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription("Send the support ticket panel.")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

  new SlashCommandBuilder()
    .setName("ticketsetup")
    .setDescription("Configure the ticket category.")
    .addChannelOption(option =>
      option
        .setName("category")
        .setDescription("Ticket category")
        .addChannelTypes(
          ChannelType.GuildCategory
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("close")
    .setDescription("Close the current ticket."),

  new SlashCommandBuilder()
    .setName("reopen")
    .setDescription("Reopen the current ticket."),

  new SlashCommandBuilder()
    .setName("delete")
    .setDescription("Delete the current ticket."),

  new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Claim the current ticket."),

  new SlashCommandBuilder()
    .setName("unclaim")
    .setDescription("Release the current ticket."),

  new SlashCommandBuilder()
    .setName("lock")
    .setDescription("Lock the current ticket."),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription("Unlock the current ticket."),

  new SlashCommandBuilder()
    .setName("add")
    .setDescription("Add a member to the ticket.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Member")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a member from the ticket.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Member")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("rename")
    .setDescription("Rename the current ticket.")
    .addStringOption(option =>
      option
        .setName("name")
        .setDescription("New name")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("priority")
    .setDescription("Set ticket priority.")
    .addStringOption(option =>
      option
        .setName("level")
        .setDescription("Priority")
        .setRequired(true)
        .addChoices(
          { name: "Low", value: "low" },
          { name: "Normal", value: "normal" },
          { name: "High", value: "high" },
          { name: "Urgent", value: "urgent" }
        )
    ),

  new SlashCommandBuilder()
    .setName("note")
    .setDescription("Add an internal ticket note.")
    .addStringOption(option =>
      option
        .setName("message")
        .setDescription("Note")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ticketinfo")
    .setDescription("Show ticket information."),

  new SlashCommandBuilder()
    .setName("transcript")
    .setDescription("Create a ticket transcript."),

  new SlashCommandBuilder()
    .setName("ticketstats")
    .setDescription("Show ticket statistics."),

  // ---------------- AUTOMOD ----------------

  new SlashCommandBuilder()
    .setName("automod")
    .setDescription("AutoMod controls.")
    .addSubcommand(sub =>
      sub
        .setName("enable")
        .setDescription("Enable AutoMod.")
    )
    .addSubcommand(sub =>
      sub
        .setName("disable")
        .setDescription("Disable AutoMod.")
    )
    .addSubcommand(sub =>
      sub
        .setName("status")
        .setDescription("Show AutoMod settings.")
    )
    .addSubcommand(sub =>
      sub
        .setName("config")
        .setDescription("Edit AutoMod.")
        .addIntegerOption(option =>
          option
            .setName("spam_limit")
            .setDescription("Messages allowed")
            .setMinValue(3)
            .setMaxValue(20)
        )
        .addIntegerOption(option =>
          option
            .setName("timeout")
            .setDescription("Default spam timeout seconds")
            .setMinValue(10)
            .setMaxValue(604800)
        )
    ),

  // ---------------- SECURITY ----------------

  new SlashCommandBuilder()
    .setName("security")
    .setDescription("Server security controls.")
    .addSubcommand(sub =>
      sub
        .setName("enable")
        .setDescription("Enable security.")
    )
    .addSubcommand(sub =>
      sub
        .setName("disable")
        .setDescription("Disable security.")
    )
    .addSubcommand(sub =>
      sub
        .setName("status")
        .setDescription("Show security status.")
    ),

  // ---------------- CONFIG ----------------

  new SlashCommandBuilder()
    .setName("config")
    .setDescription("Bot configuration.")
    .addSubcommand(sub =>
      sub
        .setName("view")
        .setDescription("View configuration.")
    )
    .addSubcommand(sub =>
      sub
        .setName("logchannel")
        .setDescription("Set a log channel.")
        .addStringOption(option =>
          option
            .setName("type")
            .setDescription("Log type")
            .setRequired(true)
            .addChoices(
              {
                name: "AutoMod",
                value: "automod"
              },
              {
                name: "Security",
                value: "security"
              },
              {
                name: "Audit",
                value: "audit"
              },
              {
                name: "Punishment",
                value: "punishment"
              },
              {
                name: "Suggestions",
                value: "suggestions"
              }
            )
        )
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription("Channel")
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
    ),

  // ---------------- PUNISHMENTS ----------------

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Member")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("Reason")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("View member warnings.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Member")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("clearwarnings")
    .setDescription("Clear member warnings.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Member")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a member.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Member")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("seconds")
        .setDescription("Duration")
        .setMinValue(10)
        .setMaxValue(2419200)
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("Reason")
    ),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Member")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("Reason")
    ),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member.")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("Member")
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName("reason")
        .setDescription("Reason")
    ),

  new SlashCommandBuilder()
    .setName("unban")
    .setDescription("Unban a user.")
    .addStringOption(option =>
      option
        .setName("user_id")
        .setDescription("User ID")
        .setRequired(true)
    ),

  // ---------------- SUGGESTIONS ----------------

  new SlashCommandBuilder()
    .setName("suggest")
    .setDescription("Submit a suggestion.")
    .addStringOption(option =>
      option
        .setName("suggestion")
        .setDescription("Your suggestion")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("suggestionchannel")
    .setDescription("Set the suggestion channel.")
    .addChannelOption(option =>
      option
        .setName("channel")
        .setDescription("Suggestion channel")
        .addChannelTypes(
          ChannelType.GuildText
        )
        .setRequired(true)
    ),

  // ---------------- ANNOUNCEMENTS ----------------

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Announcement system.")
    .addSubcommand(sub =>
      sub
        .setName("send")
        .setDescription("Send an announcement.")
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription("Channel")
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("message")
            .setDescription("Message")
            .setRequired(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("embed")
        .setDescription("Send an embed announcement.")
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription("Channel")
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("title")
            .setDescription("Title")
            .setRequired(true)
        )
        .addStringOption(option =>
          option
            .setName("message")
            .setDescription("Message")
            .setRequired(true)
        )
    )

].map(command => command.toJSON());

// ======================================================
// REGISTER COMMANDS
// ======================================================

async function registerCommands() {
  const rest =
    new REST({
      version: "10"
    }).setToken(TOKEN);

  console.log(
    "Registering slash commands..."
  );

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
    `Registered ${commands.length} slash commands.`
  );
}

// ======================================================
// TICKET STORAGE
// ======================================================

async function loadExistingTickets() {
  try {
    const guild =
      await client.guilds.fetch(
        GUILD_ID
      );

    const channels =
      await guild.channels.fetch();

    for (
      const [, channel]
      of channels
    ) {
      if (
        channel.type !==
        ChannelType.GuildText
      ) continue;

      if (
        !channel.topic ||
        !channel.topic.startsWith(
          "TRILOK_TICKET:"
        )
      ) continue;

      const parts =
        channel.topic.split(":");

      const userId = parts[1];

      const status =
        parts[2] || "open";

      const priority =
        parts[3] || "normal";

      const claimedBy =
        parts[4] || null;

      if (!userId) continue;

      tickets.set(
        userId,
        {
          channelId: channel.id,
          claimedBy:
            claimedBy === "none"
              ? null
              : claimedBy,
          createdAt:
            channel.createdTimestamp ||
            Date.now(),
          status,
          priority,
          locked:
            status === "locked",
          notes: []
        }
      );
    }

    console.log(
      `Loaded ${tickets.size} ticket(s).`
    );
  } catch (error) {
    console.error(
      "Ticket restore error:",
      error
    );
  }
}

// ======================================================
// SAVE TICKET TOPIC
// ======================================================

async function saveTicketTopic(
  channel,
  userId,
  ticket
) {
  const status =
    ticket.locked
      ? "locked"
      : ticket.status;

  await channel.setTopic(
    `TRILOK_TICKET:${userId}:${status}:${ticket.priority}:${ticket.claimedBy || "none"}`
  ).catch(() => {});
}

// ======================================================
// CREATE TICKET
// ======================================================

async function createTicket(user) {
  const guild =
    await client.guilds.fetch(
      GUILD_ID
    );

  const existing =
    tickets.get(user.id);

  if (existing) {
    const existingChannel =
      await guild.channels.fetch(
        existing.channelId
      ).catch(() => null);

    if (existingChannel) {
      if (
        existing.status ===
        "closed"
      ) {
        existing.status = "open";
        existing.locked = false;

        await existingChannel.permissionOverwrites.edit(
          user.id,
          {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
          }
        );

        await saveTicketTopic(
          existingChannel,
          user.id,
          existing
        );

        await existingChannel.send(
          "🔓 **Ticket reopened.**"
        );
      }

      return existingChannel;
    }

    tickets.delete(user.id);
  }

  let category = null;

  if (
    config.tickets.categoryId
  ) {
    category =
      await guild.channels.fetch(
        config.tickets.categoryId
      ).catch(() => null);
  }

  const username =
    user.username
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 15) ||
    "user";

  const channel =
    await guild.channels.create({
      name:
        `ticket-${username}`,

      type:
        ChannelType.GuildText,

      parent:
        category?.type ===
        ChannelType.GuildCategory
          ? category.id
          : undefined,

      topic:
        `TRILOK_TICKET:${user.id}:open:normal:none`,

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
            SUPPORT_ROLE_ID,

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

  const ticket = {
    channelId: channel.id,
    claimedBy: null,
    createdAt: Date.now(),
    status: "open",
    priority: "normal",
    locked: false,
    notes: []
  };

  tickets.set(
    user.id,
    ticket
  );

  const embed =
    new EmbedBuilder()
      .setTitle(
        "🎫 New Support Ticket"
      )
      .setDescription(
        `**User:** <@${user.id}>\n\n` +
        "A new private support ticket has been created.\n\n" +
        "Use the controls below to manage this ticket."
      )
      .addFields(
        {
          name: "Priority",
          value: "🟢 Normal",
          inline: true
        },
        {
          name: "Status",
          value: "🟢 Open",
          inline: true
        },
        {
          name: "Claimed",
          value: "No",
          inline: true
        }
      )
      .setTimestamp();

  await channel.send({
    content:
      `<@&${SUPPORT_ROLE_ID}>`,
    embeds: [embed],
    components: [ticketButtons()]
  });

  await user.send(
    "🎫 **Support Ticket Created**\n\n" +
    "Your private support ticket has been created.\n\n" +
    "Please send your message here. A member of the **Support Team** will assist you."
  ).catch(() => {});

  await sendLog(
    guild,
    "🎫 Ticket Created",
    `User: <@${user.id}>\nChannel: ${channel}\nPriority: Normal`,
    {
      type: "audit",
      color: 0x57f287
    }
  );

  return channel;
}

// ======================================================
// DM -> STAFF
// ======================================================

async function forwardUserMessage(
  user,
  message
) {
  let ticket =
    tickets.get(user.id);

  if (!ticket) {
    const channel =
      await createTicket(user);

    await sendUserMessageToTicket(
      channel,
      user,
      message
    );

    return;
  }

  const channel =
    await client.channels.fetch(
      ticket.channelId
    ).catch(() => null);

  if (!channel) {
    tickets.delete(user.id);

    const newChannel =
      await createTicket(user);

    await sendUserMessageToTicket(
      newChannel,
      user,
      message
    );

    return;
  }

  if (
    ticket.status ===
    "closed"
  ) {
    ticket.status = "open";
    ticket.locked = false;

    await channel.permissionOverwrites.edit(
      user.id,
      {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true
      }
    );

    await saveTicketTopic(
      channel,
      user.id,
      ticket
    );
  }

  if (ticket.locked) {
    await user.send(
      "🔒 Your support ticket is currently locked."
    ).catch(() => {});
    return;
  }

  await sendUserMessageToTicket(
    channel,
    user,
    message
  );
}

// ======================================================
// USER MESSAGE -> TICKET
// ======================================================

async function sendUserMessageToTicket(
  channel,
  user,
  message
) {
  const embed =
    new EmbedBuilder()
      .setTitle("📩 User Message")
      .setDescription(
        message.content ||
        "[No text content]"
      )
      .addFields({
        name: "User",
        value: `<@${user.id}>`,
        inline: true
      })
      .setTimestamp();

  if (
    message.attachments.size
  ) {
    embed.addFields({
      name: "Attachments",
      value:
        message.attachments
          .map(a => a.url)
          .join("\n")
          .slice(0, 1024)
    });
  }

  await channel.send({
    embeds: [embed]
  });
}

// ======================================================
// STAFF -> USER
// ======================================================

async function forwardStaffMessage(
  message
) {
  const found =
    getTicketByChannel(
      message.channel.id
    );

  if (!found) return;

  const {
    userId,
    ticket
  } = found;

  if (
    !isStaff(
      message.member
    )
  ) return;

  if (
    ticket.status ===
    "closed" ||
    ticket.locked
  ) return;

  const user =
    await client.users.fetch(
      userId
    ).catch(() => null);

  if (!user) return;

  const embed =
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
          "Official Support Team"
      })
      .setTimestamp();

  const files =
    message.attachments.map(
      attachment => ({
        attachment:
          attachment.url
      })
    );

  await user.send({
    embeds: [embed],
    files
  }).catch(() => {});
}

// ======================================================
// TRANSCRIPT
// ======================================================

async function createTranscript(
  channel
) {
  let allMessages = [];

  let lastId = null;

  while (true) {
    const options = {
      limit: 100
    };

    if (lastId) {
      options.before = lastId;
    }

    const batch =
      await channel.messages.fetch(
        options
      );

    if (!batch.size) break;

    allMessages.push(
      ...batch.values()
    );

    lastId =
      batch.last().id;

    if (
      batch.size < 100 ||
      allMessages.length >= 10000
    ) break;
  }

  allMessages.reverse();

  let output =
    "TRILOK SUPPORT TICKET TRANSCRIPT\n" +
    "================================\n\n";

  output +=
    `Channel: #${channel.name}\n`;

  output +=
    `Channel ID: ${channel.id}\n`;

  output +=
    `Generated: ${new Date().toISOString()}\n\n`;

  for (
    const message
    of allMessages
  ) {
    output +=
      `[${message.createdAt.toISOString()}] ` +
      `${message.author.tag} (${message.author.id})\n`;

    if (message.content) {
      output +=
        `${message.content}\n`;
    }

    if (message.attachments.size) {
      output +=
        "Attachments:\n";

      for (
        const attachment
        of message.attachments.values()
      ) {
        output +=
          `- ${attachment.url}\n`;
      }
    }

    output += "\n";
  }

  return Buffer.from(
    output,
    "utf8"
  );
}

async function sendTranscriptToLog(
  guild,
  channel,
  userId
) {
  try {
    const transcript =
      await createTranscript(
        channel
      );

    await sendLog(
      guild,
      "📄 Ticket Transcript",
      `User: <@${userId}>\nChannel: ${channel}`,
      {
        type: "audit",
        color: 0x5865f2,
        files: [
          {
            attachment: transcript,
            name:
              `ticket-${channel.id}.txt`
          }
        ]
      }
    );

    return true;
  } catch (error) {
    console.error(
      "Transcript error:",
      error
    );

    return false;
  }
}

// ======================================================
// CLOSE TICKET
// ======================================================

async function closeTicket(
  userId,
  channel,
  closedBy
) {
  const ticket =
    tickets.get(userId);

  if (!ticket) return false;

  await sendTranscriptToLog(
    channel.guild,
    channel,
    userId
  );

  ticket.status = "closed";
  ticket.locked = true;

  await channel.permissionOverwrites.edit(
    userId,
    {
      ViewChannel: true,
      SendMessages: false,
      ReadMessageHistory: true
    }
  ).catch(() => {});

  await saveTicketTopic(
    channel,
    userId,
    ticket
  );

  await channel.send(
    "🔒 **Ticket Closed**\n\n" +
    "Use `/reopen` if this ticket needs to be reopened."
  );

  await sendLog(
    channel.guild,
    "🔒 Ticket Closed",
    `User: <@${userId}>\nClosed by: <@${closedBy.id}>`,
    {
      type: "audit",
      color: 0xed4245
    }
  );

  return true;
}

// ======================================================
// REOPEN
// ======================================================

async function reopenTicket(
  userId,
  channel
) {
  const ticket =
    tickets.get(userId);

  if (!ticket) return false;

  ticket.status = "open";
  ticket.locked = false;

  await channel.permissionOverwrites.edit(
    userId,
    {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true
    }
  ).catch(() => {});

  await saveTicketTopic(
    channel,
    userId,
    ticket
  );

  await channel.send(
    "🔓 **Ticket Reopened**"
  );

  return true;
}

// ======================================================
// AUTOMOD
// ======================================================

function isProtectedMember(member) {
  if (!member) return false;

  return (
    member.permissions.has(
      PermissionFlagsBits.Administrator
    ) ||
    member.roles.cache.has(
      SUPPORT_ROLE_ID
    )
  );
}

function containsBadWord(content) {
  const words =
    config.automod.badWords || [];

  return words.some(
    word =>
      word &&
      content
        .toLowerCase()
        .includes(
          String(word).toLowerCase()
        )
  );
}

async function autoPunish(
  member,
  reason,
  type
) {
  if (!member) return;

  const duration =
    config.automod.timeout[type] ||
    60;

  let action =
    `Timeout: ${duration}s`;

  if (member.moderatable) {
    await member.timeout(
      duration * 1000,
      `AutoMod: ${reason}`
    ).catch(() => {});
  }

  await sendLog(
    member.guild,
    "🛡️ AutoMod Action",
    `User: <@${member.id}>\nReason: ${reason}\nAction: ${action}`,
    {
      type: "automod",
      color: 0xfee75c
    }
  );
}

async function runAutoMod(message) {
  if (
    !message.guild ||
    !config.automod.enabled
  ) return;

  if (
    isProtectedMember(
      message.member
    )
  ) return;

  const content =
    message.content || "";

  // INVITES

  if (
    config.automod.inviteFilter &&
    /discord\.gg\/|discord\.com\/invite\//i
      .test(content)
  ) {
    await message.delete().catch(() => {});

    await autoPunish(
      message.member,
      "Discord invite link",
      "invite"
    );

    return;
  }

  // BAD WORDS

  if (
    config.automod.badWordFilter &&
    containsBadWord(content)
  ) {
    await message.delete().catch(() => {});

    await autoPunish(
      message.member,
      "Blocked word",
      "badWord"
    );

    return;
  }

  // MASS TAG

  if (
    config.automod.massTagProtection &&
    (
      message.mentions.everyone ||
      message.mentions.users.size >= 5 ||
      message.mentions.roles.size >= 3
    )
  ) {
    await message.delete().catch(() => {});

    await autoPunish(
      message.member,
      "Mass mention",
      "massTag"
    );

    return;
  }

  // CAPS

  if (
    config.automod.capsProtection &&
    content.length >= 12
  ) {
    const letters =
      content.replace(
        /[^a-zA-Z]/g,
        ""
      );

    if (letters.length >= 10) {
      const upper =
        letters.replace(
          /[^A-Z]/g,
          ""
        ).length;

      if (
        upper / letters.length >=
        0.8
      ) {
        await message.delete()
          .catch(() => {});

        await autoPunish(
          message.member,
          "Excessive capital letters",
          "caps"
        );

        return;
      }
    }
  }

  // REPEATED MESSAGE

  if (
    config.automod.repeatProtection &&
    content.length >= 3
  ) {
    const key =
      `${message.author.id}:${content.toLowerCase()}`;

    const count =
      spamTracker.get(key) || 0;

    spamTracker.set(
      key,
      count + 1
    );

    setTimeout(() => {
      spamTracker.delete(key);
    }, 10000);

    if (count + 1 >= 3) {
      await message.delete()
        .catch(() => {});

      spamTracker.delete(key);

      await autoPunish(
        message.member,
        "Repeated message",
        "repeat"
      );

      return;
    }
  }

  // SPAM

  const now = Date.now();

  const key =
    `spam:${message.author.id}`;

  const previous =
    spamTracker.get(key) || [];

  const recent =
    previous.filter(
      time =>
        now - time <
        config.automod.spamWindow
    );

  recent.push(now);

  spamTracker.set(
    key,
    recent
  );

  if (
    recent.length >=
    config.automod.spamLimit
  ) {
    spamTracker.set(
      key,
      []
    );

    await message.delete()
      .catch(() => {});

    await autoPunish(
      message.member,
      "Spam/flood",
      "spam"
    );
  }
}

// ======================================================
// SECURITY TRACKING
// ======================================================

function trackSecurity(
  guildId,
  userId,
  type
) {
  const key =
    `${guildId}:${userId}:${type}`;

  const now =
    Date.now();

  const data =
    securityTracker.get(key) || [];

  const recent =
    data.filter(
      time =>
        now - time < 10000
    );

  recent.push(now);

  securityTracker.set(
    key,
    recent
  );

  return recent.length;
}

function securityLimit(type) {
  return (
    config.security[
      `${type}Limit`
    ] || 3
  );
}

function isTrusted(userId) {
  return (
    userId === client.user?.id ||
    config.security.trustedUsers.includes(
      userId
    ) ||
    config.security.trustedBots.includes(
      userId
    )
  );
}

// ======================================================
// AUDIT / ANTI-NUKE
// ======================================================

async function inspectAudit(
  guild,
  type,
  target
) {
  if (
    !config.security.enabled ||
    !config.security.antiNuke
  ) return;

  try {
    const logs =
      await guild.fetchAuditLogs({
        type,
        limit: 1
      });

    const entry =
      logs.entries.first();

    if (!entry) return;

    if (
      Date.now() -
      entry.createdTimestamp >
      10000
    ) return;

    const executor =
      entry.executor;

    if (!executor) return;

    if (
      isTrusted(
        executor.id
      )
    ) return;

    const count =
      trackSecurity(
        guild.id,
        executor.id,
        auditTypeName(type)
      );

    const limit =
      securityLimit(
        auditTypeName(type)
      );

    await sendLog(
      guild,
      "🔐 Security Activity",
      `Executor: <@${executor.id}>\nAction: ${auditTypeName(type)}\nCount: ${count}/${limit}\nTarget: ${target || "Unknown"}`,
      {
        type: "security",
        color: 0xed4245
      }
    );

    if (
      count >= limit
    ) {
      await punishNuker(
        guild,
        executor,
        type
      );
    }
  } catch (error) {
    console.error(
      "Security audit error:",
      error.message
    );
  }
}

function auditTypeName(type) {
  switch (type) {
    case AuditLogEvent.MemberBanAdd:
      return "massBan";

    case AuditLogEvent.MemberKick:
      return "massKick";

    case AuditLogEvent.ChannelDelete:
      return "massChannelDelete";

    case AuditLogEvent.RoleDelete:
      return "massRoleDelete";

    case AuditLogEvent.ChannelCreate:
      return "massChannelCreate";

    case AuditLogEvent.RoleCreate:
      return "massRoleCreate";

    default:
      return "security";
  }
}

async function punishNuker(
  guild,
  executor,
  auditType
) {
  const member =
    await guild.members.fetch(
      executor.id
    ).catch(() => null);

  if (!member) return;

  await sendLog(
    guild,
    "🚨 ANTI-NUKE ACTIVATED",
    `User: <@${executor.id}>\nReason: Excessive ${auditTypeName(auditType)} activity.\nConfigured action: ${config.security.action}`,
    {
      type: "security",
      color: 0xed4245
    }
  );

  if (
    config.security.action ===
    "ban"
  ) {
    if (
      member.bannable
    ) {
      await member.ban({
        reason:
          "Anti-Nuke protection"
      }).catch(() => {});
    }
  } else if (
    config.security.action ===
    "kick"
  ) {
    if (
      member.kickable
    ) {
      await member.kick(
        "Anti-Nuke protection"
      ).catch(() => {});
    }
  } else if (
    config.security.action ===
    "timeout"
  ) {
    if (
      member.moderatable
    ) {
      await member.timeout(
        86400000,
        "Anti-Nuke protection"
      ).catch(() => {});
    }
  }
}

// ======================================================
// SECURITY EVENTS
// ======================================================

client.on(
  "channelDelete",
  async channel => {
    if (
      channel.guild?.id !==
      GUILD_ID
    ) return;

    await inspectAudit(
      channel.guild,
      AuditLogEvent.ChannelDelete,
      `#${channel.name}`
    );
  }
);

client.on(
  "channelCreate",
  async channel => {
    if (
      channel.guild?.id !==
      GUILD_ID
    ) return;

    await inspectAudit(
      channel.guild,
      AuditLogEvent.ChannelCreate,
      `#${channel.name}`
    );
  }
);

client.on(
  "roleDelete",
  async role => {
    if (
      role.guild?.id !==
      GUILD_ID
    ) return;

    await inspectAudit(
      role.guild,
      AuditLogEvent.RoleDelete,
      role.name
    );
  }
);

client.on(
  "roleCreate",
  async role => {
    if (
      role.guild?.id !==
      GUILD_ID
    ) return;

    await inspectAudit(
      role.guild,
      AuditLogEvent.RoleCreate,
      role.name
    );
  }
);

client.on(
  "guildBanAdd",
  async ban => {
    if (
      ban.guild.id !==
      GUILD_ID
    ) return;

    await inspectAudit(
      ban.guild,
      AuditLogEvent.MemberBanAdd,
      `<@${ban.user.id}>`
    );
  }
);

client.on(
  "guildMemberRemove",
  async member => {
    if (
      member.guild.id !==
      GUILD_ID
    ) return;

    await inspectAudit(
      member.guild,
      AuditLogEvent.MemberKick,
      `<@${member.id}>`
    );
  }
);

// ======================================================
// RAID DETECTION
// ======================================================

client.on(
  "guildMemberAdd",
  async member => {
    if (
      member.guild.id !==
      GUILD_ID
    ) return;

    if (
      !config.security.enabled
    ) return;

    const now =
      Date.now();

    while (
      recentJoins.length &&
      now - recentJoins[0] >
        10000
    ) {
      recentJoins.shift();
    }

    recentJoins.push(now);

    if (
      recentJoins.length >=
      10
    ) {
      await sendLog(
        member.guild,
        "🚨 RAID ALERT",
        "10 or more members joined within 10 seconds.",
        {
          type: "security",
          color: 0xed4245
        }
      );

      recentJoins.length = 0;
    }
  }
);

// ======================================================
// MESSAGE HANDLER
// ======================================================

client.on(
  "messageCreate",
  async message => {
    if (
      message.author.bot
    ) return;

    try {
      // DM

      if (!message.guild) {
        await forwardUserMessage(
          message.author,
          message
        );

        return;
      }

      // STAFF TICKET

      const ticket =
        getTicketByChannel(
          message.channel.id
        );

      if (
        ticket &&
        isStaff(
          message.member
        )
      ) {
        await forwardStaffMessage(
          message
        );

        return;
      }

      // AUTOMOD

      await runAutoMod(
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

// ======================================================
// READY
// ======================================================

client.once(
  "clientReady",
  async () => {
    console.log(
      `Logged in as ${client.user.tag}`
    );

    try {
      await registerCommands();

      await loadExistingTickets();
    } catch (error) {
      console.error(
        "Startup error:",
        error
      );
    }

    console.log(
      "TRILOK Discord Bot is online."
    );
  }
);

// ======================================================
// INTERACTIONS
// ======================================================

client.on(
  "interactionCreate",
  async interaction => {
    try {

      // ==================================================
      // CREATE TICKET BUTTON
      // ==================================================

      if (
        interaction.isButton() &&
        interaction.customId ===
        "create_ticket"
      ) {
        await createTicket(
          interaction.user
        );

        await interaction.reply({
          content:
            "🎫 **Support ticket created.** Check your DMs.",
          ephemeral: true
        });

        return;
      }

      // ==================================================
      // SUGGESTION BUTTONS
      // ==================================================

      if (
        interaction.isButton() &&
        (
          interaction.customId ===
          "suggest_approve" ||
          interaction.customId ===
          "suggest_decline"
        )
      ) {
        if (
          config.suggestions.staffOnlyDecision &&
          !isStaff(
            interaction.member
          )
        ) {
          await interaction.reply({
            content:
              "❌ Only Support/Management staff can decide suggestions.",
            ephemeral: true
          });

          return;
        }

        const approved =
          interaction.customId ===
          "suggest_approve";

        const oldEmbed =
          interaction.message.embeds[0];

        const embed =
          EmbedBuilder.from(
            oldEmbed
          );

        embed.setTitle(
          approved
            ? "💡 Suggestion — APPROVED"
            : "💡 Suggestion — DECLINED"
        );

        embed.addFields({
          name: "Decision",
          value:
            `${approved ? "✅ Approved" : "❌ Declined"} by ${interaction.user}`,
          inline: false
        });

        const disabledRow =
          new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(
                  "suggest_approve"
                )
                .setLabel("Approve")
                .setEmoji("👍")
                .setStyle(
                  ButtonStyle.Success
                )
                .setDisabled(true),

              new ButtonBuilder()
                .setCustomId(
                  "suggest_decline"
                )
                .setLabel("Decline")
                .setEmoji("👎")
                .setStyle(
                  ButtonStyle.Danger
                )
                .setDisabled(true)
            );

        await interaction.update({
          embeds: [embed],
          components: [disabledRow]
        });

        await sendLog(
          interaction.guild,
          approved
            ? "💡 Suggestion Approved"
            : "💡 Suggestion Declined",
          `Suggestion message: ${interaction.message.url}\nDecision by: <@${interaction.user.id}>`,
          {
            type: "suggestions",
            color:
              approved
                ? 0x57f287
                : 0xed4245
          }
        );

        return;
      }

      // ==================================================
      // TICKET BUTTONS
      // ==================================================

      if (
        interaction.isButton() &&
        [
          "ticket_claim",
          "ticket_close",
          "ticket_transcript",
          "ticket_lock"
        ].includes(
          interaction.customId
        )
      ) {
        if (
          !isStaff(
            interaction.member
          )
        ) {
          await interaction.reply({
            content:
              "❌ You don't have permission.",
            ephemeral: true
          });

          return;
        }

        const found =
          getTicketByChannel(
            interaction.channel.id
          );

        if (!found) {
          await interaction.reply({
            content:
              "❌ This is not a ticket.",
            ephemeral: true
          });

          return;
        }

        const {
          userId,
          ticket
        } = found;

        if (
          interaction.customId ===
          "ticket_claim"
        ) {
          ticket.claimedBy =
            interaction.user.id;

          await saveTicketTopic(
            interaction.channel,
            userId,
            ticket
          );

          await interaction.reply(
            `✅ Ticket claimed by ${interaction.user}.`
          );

          return;
        }

        if (
          interaction.customId ===
          "ticket_close"
        ) {
          await interaction.reply(
            "🔒 Closing ticket..."
          );

          await closeTicket(
            userId,
            interaction.channel,
            interaction.user
          );

          return;
        }

        if (
          interaction.customId ===
          "ticket_transcript"
        ) {
          await interaction.deferReply({
            ephemeral: true
          });

          const transcript =
            await createTranscript(
              interaction.channel
            );

          await sendLog(
            interaction.guild,
            "📄 Manual Ticket Transcript",
            `User: <@${userId}>\nGenerated by: <@${interaction.user.id}>`,
            {
              type: "audit",
              files: [
                {
                  attachment:
                    transcript,
                  name:
                    `ticket-${interaction.channel.id}.txt`
                }
              ]
            }
          );

          await interaction.editReply(
            "✅ Transcript sent to the log channel."
          );

          return;
        }

        if (
          interaction.customId ===
          "ticket_lock"
        ) {
          ticket.locked = true;

          await interaction.channel.permissionOverwrites.edit(
            userId,
            {
              ViewChannel: true,
              SendMessages: false,
              ReadMessageHistory: true
            }
          );

          await saveTicketTopic(
            interaction.channel,
            userId,
            ticket
          );

          await interaction.reply(
            "🔐 Ticket locked."
          );

          return;
        }
      }

      // ==================================================
      // SLASH COMMANDS
      // ==================================================

      if (
        !interaction.isChatInputCommand()
      ) return;

      const command =
        interaction.commandName;

      // ==================================================
      // STAFF COMMANDS
      // ==================================================

      const staffCommands = [
        "ticketpanel",
        "ticketsetup",
        "close",
        "reopen",
        "delete",
        "claim",
        "unclaim",
        "lock",
        "unlock",
        "add",
        "remove",
        "rename",
        "priority",
        "note",
        "ticketinfo",
        "transcript",
        "ticketstats",
        "automod",
        "security",
        "config",
        "warn",
        "warnings",
        "clearwarnings",
        "timeout",
        "kick",
        "ban",
        "unban",
        "suggestionchannel",
        "announce"
      ];

      if (
        staffCommands.includes(
          command
        ) &&
        !isStaff(
          interaction.member
        )
      ) {
        await interaction.reply({
          content:
            "❌ You don't have permission.",
          ephemeral: true
        });

        return;
      }

      // ==================================================
      // /TICKET
      // ==================================================

      if (
        command ===
        "ticket"
      ) {
        await createTicket(
          interaction.user
        );

        await interaction.reply({
          content:
            "🎫 Ticket created. Check your DMs.",
          ephemeral: true
        });

        return;
      }

      // ==================================================
      // /TICKETPANEL
      // ==================================================

      if (
        command ===
        "ticketpanel"
      ) {
        const embed =
          new EmbedBuilder()
            .setTitle(
              "🎫 TRILOK Support Center"
            )
            .setDescription(
              "Need help?\n\n" +
              "Click below to open a private support ticket.\n\n" +
              "🛡️ Staff identities are not shown to users.\n" +
              "📄 Tickets are logged and transcribed."
            )
            .setTimestamp();

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
          embeds: [embed],
          components: [row]
        });

        await interaction.reply({
          content:
            "✅ Ticket panel sent.",
          ephemeral: true
        });

        return;
      }

      // ==================================================
      // TICKET SETUP
      // ==================================================

      if (
        command ===
        "ticketsetup"
      ) {
        const category =
          interaction.options.getChannel(
            "category"
          );

        config.tickets.categoryId =
          category.id;

        saveJSON(
          CONFIG_FILE,
          config
        );

        await interaction.reply(
          `✅ Ticket category set to ${category}.`
        );

        return;
      }

      // ==================================================
      // CURRENT TICKET COMMANDS
      // ==================================================

      const ticketCommands = [
        "close",
        "reopen",
        "delete",
        "claim",
        "unclaim",
        "lock",
        "unlock",
        "add",
        "remove",
        "rename",
        "priority",
        "note",
        "ticketinfo",
        "transcript"
      ];

      if (
        ticketCommands.includes(
          command
        )
      ) {
        const found =
          getTicketByChannel(
            interaction.channel.id
          );

        if (!found) {
          await interaction.reply({
            content:
              "❌ This is not an active ticket.",
            ephemeral: true
          });

          return;
        }

        const {
          userId,
          ticket
        } = found;

        if (
          command ===
          "close"
        ) {
          await interaction.reply(
            "🔒 Closing ticket..."
          );

          await closeTicket(
            userId,
            interaction.channel,
            interaction.user
          );

          return;
        }

        if (
          command ===
          "reopen"
        ) {
          await reopenTicket(
            userId,
            interaction.channel
          );

          await interaction.reply(
            "🔓 Ticket reopened."
          );

          return;
        }

        if (
          command ===
          "delete"
        ) {
          await interaction.reply(
            "🗑️ Deleting ticket..."
          );

          await sendTranscriptToLog(
            interaction.guild,
            interaction.channel,
            userId
          );

          tickets.delete(
            userId
          );

          setTimeout(() => {
            interaction.channel
              .delete()
              .catch(() => {});
          }, 1000);

          return;
        }

        if (
          command ===
          "claim"
        ) {
          ticket.claimedBy =
            interaction.user.id;

          await saveTicketTopic(
            interaction.channel,
            userId,
            ticket
          );

          await interaction.reply(
            `✅ Ticket claimed by ${interaction.user}.`
          );

          return;
        }

        if (
          command ===
          "unclaim"
        ) {
          ticket.claimedBy =
            null;

          await saveTicketTopic(
            interaction.channel,
            userId,
            ticket
          );

          await interaction.reply(
            "✅ Ticket unclaimed."
          );

          return;
        }

        if (
          command ===
          "lock"
        ) {
          ticket.locked = true;

          await interaction.channel.permissionOverwrites.edit(
            userId,
            {
              ViewChannel: true,
              SendMessages: false,
              ReadMessageHistory: true
            }
          );

          await saveTicketTopic(
            interaction.channel,
            userId,
            ticket
          );

          await interaction.reply(
            "🔐 Ticket locked."
          );

          return;
        }

        if (
          command ===
          "unlock"
        ) {
          ticket.locked = false;
          ticket.status = "open";

          await interaction.channel.permissionOverwrites.edit(
            userId,
            {
              ViewChannel: true,
              SendMessages: true,
              ReadMessageHistory: true
            }
          );

          await saveTicketTopic(
            interaction.channel,
            userId,
            ticket
          );

          await interaction.reply(
            "🔓 Ticket unlocked."
          );

          return;
        }

        if (
          command ===
          "add"
        ) {
          const user =
            interaction.options.getUser(
              "user"
            );

          await interaction.channel.permissionOverwrites.edit(
            user.id,
            {
              ViewChannel: true,
              SendMessages: true,
              ReadMessageHistory: true
            }
          );

          await interaction.reply(
            `✅ ${user} added to the ticket.`
          );

          return;
        }

        if (
          command ===
          "remove"
        ) {
          const user =
            interaction.options.getUser(
              "user"
            );

          if (
            user.id ===
            userId
          ) {
            await interaction.reply({
              content:
                "❌ You cannot remove the ticket owner.",
              ephemeral: true
            });

            return;
          }

          await interaction.channel.permissionOverwrites
            .delete(
              user.id
            )
            .catch(() => {});

          await interaction.reply(
            `✅ ${user} removed.`
          );

          return;
        }

        if (
          command ===
          "rename"
        ) {
          let name =
            interaction.options.getString(
              "name"
            );

          name =
            name
              .toLowerCase()
              .replace(
                /[^a-z0-9-]/g,
                "-"
              )
              .slice(0, 90);

          await interaction.channel.setName(
            name
          );

          await interaction.reply(
            `✏️ Ticket renamed to \`${name}\`.`
          );

          return;
        }

        if (
          command ===
          "priority"
        ) {
          const level =
            interaction.options.getString(
              "level"
            );

          ticket.priority =
            level;

          await saveTicketTopic(
            interaction.channel,
            userId,
            ticket
          );

          await interaction.reply(
            `🚦 Priority changed to **${level}**.`
          );

          return;
        }

        if (
          command ===
          "note"
        ) {
          const note =
            interaction.options.getString(
              "message"
            );

          ticket.notes.push({
            author:
              interaction.user.id,
            message:
              note,
            createdAt:
              Date.now()
          });

          await interaction.reply({
            content:
              "📝 Internal note saved.",
            ephemeral: true
          });

          await sendLog(
            interaction.guild,
            "📝 Ticket Note",
            `Ticket user: <@${userId}>\nStaff: <@${interaction.user.id}>\n\n${note}`,
            {
              type: "audit"
            }
          );

          return;
        }

        if (
          command ===
          "ticketinfo"
        ) {
          const embed =
            new EmbedBuilder()
              .setTitle(
                "🎫 Ticket Information"
              )
              .addFields(
                {
                  name: "User",
                  value:
                    `<@${userId}>`,
                  inline: true
                },
                {
                  name: "Status",
                  value:
                    ticket.status,
                  inline: true
                },
                {
                  name: "Priority",
                  value:
                    ticket.priority,
                  inline: true
                },
                {
                  name: "Claimed",
                  value:
                    ticket.claimedBy
                      ? `<@${ticket.claimedBy}>`
                      : "Nobody",
                  inline: true
                },
                {
                  name: "Locked",
                  value:
                    ticket.locked
                      ? "Yes"
                      : "No",
                  inline: true
                }
              )
              .setTimestamp();

          await interaction.reply({
            embeds: [embed],
            ephemeral: true
          });

          return;
        }

        if (
          command ===
          "transcript"
        ) {
          await interaction.deferReply({
            ephemeral: true
          });

          const transcript =
            await createTranscript(
              interaction.channel
            );

          await sendLog(
            interaction.guild,
            "📄 Ticket Transcript",
            `User: <@${userId}>\nGenerated by: <@${interaction.user.id}>`,
            {
              type: "audit",
              files: [
                {
                  attachment:
                    transcript,
                  name:
                    `ticket-${interaction.channel.id}.txt`
                }
              ]
            }
          );

          await interaction.editReply(
            "✅ Transcript sent to the log channel."
          );

          return;
        }
      }

      // ==================================================
      // TICKET STATS
      // ==================================================

      if (
        command ===
        "ticketstats"
      ) {
        const all =
          [...tickets.values()];

        const open =
          all.filter(
            x =>
              x.status ===
              "open"
          ).length;

        const closed =
          all.filter(
            x =>
              x.status ===
              "closed"
          ).length;

        const locked =
          all.filter(
            x =>
              x.locked
          ).length;

        const claimed =
          all.filter(
            x =>
              x.claimedBy
          ).length;

        const embed =
          new EmbedBuilder()
            .setTitle(
              "🎫 Ticket Statistics"
            )
            .addFields(
              {
                name: "Open",
                value: String(open),
                inline: true
              },
              {
                name: "Closed",
                value: String(closed),
                inline: true
              },
              {
                name: "Claimed",
                value: String(claimed),
                inline: true
              },
              {
                name: "Locked",
                value: String(locked),
                inline: true
              },
              {
                name: "Total",
                value:
                  String(all.length),
                inline: true
              }
            )
            .setTimestamp();

        await interaction.reply({
          embeds: [embed]
        });

        return;
      }

      // ==================================================
      // AUTOMOD COMMAND
      // ==================================================

      if (
        command ===
        "automod"
      ) {
        const sub =
          interaction.options.getSubcommand();

        if (
          sub ===
          "enable"
        ) {
          config.automod.enabled =
            true;

          saveJSON(
            CONFIG_FILE,
            config
          );

          await interaction.reply(
            "🛡️ AutoMod enabled."
          );

          return;
        }

        if (
          sub ===
          "disable"
        ) {
          config.automod.enabled =
            false;

          saveJSON(
            CONFIG_FILE,
            config
          );

          await interaction.reply(
            "🛡️ AutoMod disabled."
          );

          return;
        }

        if (
          sub ===
          "status"
        ) {
          await interaction.reply(
            `🛡️ AutoMod: **${config.automod.enabled ? "ON" : "OFF"}**\n` +
            `Spam limit: **${config.automod.spamLimit}**\n` +
            `Spam timeout: **${config.automod.timeout.spam}s**\n` +
            `Mass-tag protection: **${config.automod.massTagProtection ? "ON" : "OFF"}**\n` +
            `Invite filter: **${config.automod.inviteFilter ? "ON" : "OFF"}**\n` +
            `Bad-word filter: **${config.automod.badWordFilter ? "ON" : "OFF"}**`
          );

          return;
        }

        if (
          sub ===
          "config"
        ) {
          const spam =
            interaction.options.getInteger(
              "spam_limit"
            );

          const timeout =
            interaction.options.getInteger(
              "timeout"
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
            config.automod.timeout.spam =
              timeout;
          }

          saveJSON(
            CONFIG_FILE,
            config
          );

          await interaction.reply(
            `✅ AutoMod updated.\nSpam limit: ${config.automod.spamLimit}\nSpam timeout: ${config.automod.timeout.spam}s`
          );

          return;
        }
      }

      // ==================================================
      // SECURITY COMMAND
      // ==================================================

      if (
        command ===
        "security"
      ) {
        const sub =
          interaction.options.getSubcommand();

        if (
          sub ===
          "enable"
        ) {
          config.security.enabled =
            true;

          saveJSON(
            CONFIG_FILE,
            config
          );

          await interaction.reply(
            "🔐 Server security enabled."
          );

          return;
        }

        if (
          sub ===
          "disable"
        ) {
          config.security.enabled =
            false;

          saveJSON(
            CONFIG_FILE,
            config
          );

          await interaction.reply(
            "🔐 Server security disabled."
          );

          return;
        }

        await interaction.reply(
          `🔐 Security: **${config.security.enabled ? "ON" : "OFF"}**\nAnti-Nuke: **${config.security.antiNuke ? "ON" : "OFF"}**\nMass ban limit: **${config.security.massBanLimit}**\nMass kick limit: **${config.security.massKickLimit}**\nMass channel delete limit: **${config.security.massChannelDeleteLimit}**\nMass role delete limit: **${config.security.massRoleDeleteLimit}**`
        );

        return;
      }

      // ==================================================
      // CONFIG
      // ==================================================

      if (
        command ===
        "config"
      ) {
        const sub =
          interaction.options.getSubcommand();

        if (
          sub ===
          "view"
        ) {
          const embed =
            new EmbedBuilder()
              .setTitle(
                "⚙️ Bot Configuration"
              )
              .addFields(
                {
                  name: "AutoMod",
                  value:
                    config.automod.enabled
                      ? "🟢 Enabled"
                      : "🔴 Disabled",
                  inline: true
                },
                {
                  name: "Security",
                  value:
                    config.security.enabled
                      ? "🟢 Enabled"
                      : "🔴 Disabled",
                  inline: true
                },
                {
                  name: "Suggestions",
                  value:
                    config.suggestions.enabled
                      ? "🟢 Enabled"
                      : "🔴 Disabled",
                  inline: true
                },
                {
                  name: "Audit Log",
                  value:
                    `<#${config.logs.audit}>`,
                  inline: true
                },
                {
                  name: "AutoMod Log",
                  value:
                    `<#${config.logs.automod}>`,
                  inline: true
                },
                {
                  name: "Security Log",
                  value:
                    `<#${config.logs.security}>`,
                  inline: true
                },
                {
                  name: "Suggestion Log",
                  value:
                    `<#${config.logs.suggestions}>`,
                  inline: true
                }
              )
              .setTimestamp();

          await interaction.reply({
            embeds: [embed],
            ephemeral: true
          });

          return;
        }

        if (
          sub ===
          "logchannel"
        ) {
          const type =
            interaction.options.getString(
              "type"
            );

          const channel =
            interaction.options.getChannel(
              "channel"
            );

          config.logs[type] =
            channel.id;

          saveJSON(
            CONFIG_FILE,
            config
          );

          await interaction.reply(
            `✅ **${type}** log channel set to ${channel}.`
          );

          return;
        }
      }

      // ==================================================
      // WARN
      // ==================================================

      if (
        command ===
        "warn"
      ) {
        const user =
          interaction.options.getUser(
            "user"
          );

        const reason =
          interaction.options.getString(
            "reason"
          );

        if (
          user.id ===
          interaction.user.id
        ) {
          await interaction.reply({
            content:
              "❌ You cannot warn yourself.",
            ephemeral: true
          });

          return;
        }

        if (!warnings[user.id]) {
          warnings[user.id] = [];
        }

        warnings[user.id].push({
          reason,
          moderator:
            interaction.user.id,
          timestamp:
            Date.now()
        });

        saveJSON(
          WARN_FILE,
          warnings
        );

        const count =
          warnings[user.id].length;

        await user.send(
          `⚠️ You received a warning in **${interaction.guild.name}**.\nReason: ${reason}`
        ).catch(() => {});

        await interaction.reply(
          `⚠️ ${user} warned.\nReason: **${reason}**\nTotal warnings: **${count}**`
        );

        await sendLog(
          interaction.guild,
          "⚠️ Member Warned",
          `User: <@${user.id}>\nModerator: <@${interaction.user.id}>\nReason: ${reason}\nTotal warnings: ${count}`,
          {
            type: "punishment",
            color: 0xfee75c
          }
        );

        return;
      }

      // ==================================================
      // WARNINGS
      // ==================================================

      if (
        command ===
        "warnings"
      ) {
        const user =
          interaction.options.getUser(
            "user"
          );

        const list =
          warnings[user.id] || [];

        if (!list.length) {
          await interaction.reply(
            `📋 ${user} has no warnings.`
          );

          return;
        }

        const text =
          list
            .slice(-10)
            .map(
              (item, index) =>
                `**${index + 1}.** ${item.reason} — <@${item.moderator}>`
            )
            .join("\n");

        await interaction.reply({
          content:
            `📋 Warnings for ${user}\n\n${text}`,
          ephemeral: true
        });

        return;
      }

      // ==================================================
      // CLEAR WARNINGS
      // ==================================================

      if (
        command ===
        "clearwarnings"
      ) {
        const user =
          interaction.options.getUser(
            "user"
          );

        delete warnings[user.id];

        saveJSON(
          WARN_FILE,
          warnings
        );

        await interaction.reply(
          `✅ Warnings cleared for ${user}.`
        );

        await sendLog(
          interaction.guild,
          "🧹 Warnings Cleared",
          `User: <@${user.id}>\nBy: <@${interaction.user.id}>`,
          {
            type: "punishment"
          }
        );

        return;
      }

      // ==================================================
      // TIMEOUT
      // ==================================================

      if (
        command ===
        "timeout"
      ) {
        const user =
          interaction.options.getUser(
            "user"
          );

        const seconds =
          interaction.options.getInteger(
            "seconds"
          );

        const reason =
          interaction.options.getString(
            "reason"
          ) ||
          "No reason provided";

        const member =
          await interaction.guild.members.fetch(
            user.id
          ).catch(() => null);

        if (
          !member ||
          !member.moderatable
        ) {
          await interaction.reply({
            content:
              "❌ I cannot timeout this member.",
            ephemeral: true
          });

          return;
        }

        await member.timeout(
          seconds * 1000,
          reason
        );

        await interaction.reply(
          `⏱️ ${user} timed out for **${seconds} seconds**.\nReason: ${reason}`
        );

        await sendLog(
          interaction.guild,
          "⏱️ Member Timeout",
          `User: <@${user.id}>\nModerator: <@${interaction.user.id}>\nDuration: ${seconds}s\nReason: ${reason}`,
          {
            type: "punishment",
            color: 0xfee75c
          }
        );

        return;
      }

      // ==================================================
      // KICK
      // ==================================================

      if (
        command ===
        "kick"
      ) {
        const user =
          interaction.options.getUser(
            "user"
          );

        const reason =
          interaction.options.getString(
            "reason"
          ) ||
          "No reason provided";

        const member =
          await interaction.guild.members.fetch(
            user.id
          ).catch(() => null);

        if (
          !member ||
          !member.kickable
        ) {
          await interaction.reply({
            content:
              "❌ I cannot kick this member.",
            ephemeral: true
          });

          return;
        }

        await member.kick(
          reason
        );

        await interaction.reply(
          `👢 ${user} kicked.\nReason: ${reason}`
        );

        await sendLog(
          interaction.guild,
          "👢 Member Kicked",
          `User: <@${user.id}>\nModerator: <@${interaction.user.id}>\nReason: ${reason}`,
          {
            type: "punishment",
            color: 0xed4245
          }
        );

        return;
      }

      // ==================================================
      // BAN
      // ==================================================

      if (
        command ===
        "ban"
      ) {
        const user =
          interaction.options.getUser(
            "user"
          );

        const reason =
          interaction.options.getString(
            "reason"
          ) ||
          "No reason provided";

        const member =
          await interaction.guild.members.fetch(
            user.id
          ).catch(() => null);

        if (
          !member ||
          !member.bannable
        ) {
          await interaction.reply({
            content:
              "❌ I cannot ban this member.",
            ephemeral: true
          });

          return;
        }

        await member.ban({
          reason
        });

        await interaction.reply(
          `🔨 ${user} banned.\nReason: ${reason}`
        );

        await sendLog(
          interaction.guild,
          "🔨 Member Banned",
          `User: <@${user.id}>\nModerator: <@${interaction.user.id}>\nReason: ${reason}`,
          {
            type: "punishment",
            color: 0xed4245
          }
        );

        return;
      }

      // ==================================================
      // UNBAN
      // ==================================================

      if (
        command ===
        "unban"
      ) {
        const userId =
          interaction.options.getString(
            "user_id"
          );

        await interaction.guild.members.unban(
          userId
        );

        await interaction.reply(
          `✅ User \`${userId}\` unbanned.`
        );

        await sendLog(
          interaction.guild,
          "🔓 User Unbanned",
          `User ID: ${userId}\nBy: <@${interaction.user.id}>`,
          {
            type: "punishment"
          }
        );

        return;
      }

      // ==================================================
      // SUGGESTION
      // ==================================================

      if (
        command ===
        "suggest"
      ) {
        if (
          !config.suggestions.enabled
        ) {
          await interaction.reply({
            content:
              "❌ Suggestions are currently disabled.",
            ephemeral: true
          });

          return;
        }

        const text =
          interaction.options.getString(
            "suggestion"
          );

        let channel = null;

        if (
          config.suggestions.channelId
        ) {
          channel =
            await interaction.guild.channels.fetch(
              config.suggestions.channelId
            ).catch(() => null);
        }

        if (!channel) {
          channel =
            interaction.channel;
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
              {
                name: "Submitted by",
                value:
                  `<@${interaction.user.id}>`,
                inline: true
              },
              {
                name: "Status",
                value:
                  "🟡 Pending",
                inline: true
              }
            )
            .setTimestamp();

        const row =
          new ActionRowBuilder()
            .addComponents(
              new ButtonBuilder()
                .setCustomId(
                  "suggest_approve"
                )
                .setLabel(
                  "Approve"
                )
                .setEmoji("👍")
                .setStyle(
                  ButtonStyle.Success
                ),

              new ButtonBuilder()
                .setCustomId(
                  "suggest_decline"
                )
                .setLabel(
                  "Decline"
                )
                .setEmoji("👎")
                .setStyle(
                  ButtonStyle.Danger
                )
            );

        await channel.send({
          embeds: [embed],
          components: [row]
        });

        await interaction.reply({
          content:
            `✅ Your suggestion has been submitted in ${channel}.`,
          ephemeral: true
        });

        return;
      }

      // ==================================================
      // SUGGESTION CHANNEL
      // ==================================================

      if (
        command ===
        "suggestionchannel"
      ) {
        const channel =
          interaction.options.getChannel(
            "channel"
          );

        config.suggestions.channelId =
          channel.id;

        saveJSON(
          CONFIG_FILE,
          config
        );

        await interaction.reply(
          `✅ Suggestion channel set to ${channel}.`
        );

        return;
      }

      // ==================================================
      // ANNOUNCEMENTS
      // ==================================================

      if (
        command ===
        "announce"
      ) {
        const sub =
          interaction.options.getSubcommand();

        const channel =
          interaction.options.getChannel(
            "channel"
          );

        if (
          sub ===
          "send"
        ) {
          const message =
            interaction.options.getString(
              "message"
            );

          await channel.send({
            content:
              message
          });

          await interaction.reply({
            content:
              "✅ Announcement sent.",
            ephemeral: true
          });

          return;
        }

        if (
          sub ===
          "embed"
        ) {
          const title =
            interaction.options.getString(
              "title"
            );

          const message =
            interaction.options.getString(
              "message"
            );

          const embed =
            new EmbedBuilder()
              .setTitle(title)
              .setDescription(message)
              .setTimestamp();

          await channel.send({
            embeds: [embed]
          });

          await interaction.reply({
            content:
              "✅ Embed announcement sent.",
            ephemeral: true
          });

          return;
        }
      }

    } catch (error) {
      console.error(
        "Interaction error:",
        error
      );

      if (
        !interaction.replied &&
        !interaction.deferred
      ) {
        await interaction.reply({
          content:
            "❌ An internal error occurred.",
          ephemeral: true
        }).catch(() => {});
      }
    }
  }
);

// ======================================================
// AUDIT LOG EVENTS
// ======================================================

client.on(
  "guildMemberUpdate",
  async (oldMember, newMember) => {
    if (
      oldMember.guild.id !==
      GUILD_ID
    ) return;

    const oldTimeout =
      oldMember.communicationDisabledUntilTimestamp;

    const newTimeout =
      newMember.communicationDisabledUntilTimestamp;

    if (
      oldTimeout !==
      newTimeout
    ) {
      await sendLog(
        newMember.guild,
        "📜 Member Timeout Updated",
        `Member: <@${newMember.id}>\nPrevious: ${oldTimeout ? `<t:${Math.floor(oldTimeout / 1000)}:F>` : "None"}\nNew: ${newTimeout ? `<t:${Math.floor(newTimeout / 1000)}:F>` : "None"}`,
        {
          type: "audit"
        }
      );
    }

    if (
      !oldMember.roles.cache.equals(
        newMember.roles.cache
      )
    ) {
      await sendLog(
        newMember.guild,
        "📜 Member Roles Updated",
        `Member: <@${newMember.id}>`,
        {
          type: "audit"
        }
      );
    }
  }
);

client.on(
  "messageDelete",
  async message => {
    if (
      !message.guild ||
      message.author?.bot
    ) return;

    await sendLog(
      message.guild,
      "🗑️ Message Deleted",
      `Author: <@${message.author?.id || "Unknown"}>\nChannel: ${message.channel}\nContent: ${(message.content || "[No content]").slice(0, 1500)}`,
      {
        type: "audit"
      }
    );
  }
);

client.on(
  "messageUpdate",
  async (oldMessage, newMessage) => {
    if (
      !newMessage.guild ||
      newMessage.author?.bot
    ) return;

    if (
      oldMessage.content ===
      newMessage.content
    ) return;

    await sendLog(
      newMessage.guild,
      "✏️ Message Edited",
      `Author: <@${newMessage.author?.id || "Unknown"}>\nChannel: ${newMessage.channel}\nBefore: ${(oldMessage.content || "[No content]").slice(0, 700)}\nAfter: ${(newMessage.content || "[No content]").slice(0, 700)}`,
      {
        type: "audit"
      }
    );
  }
);

// ======================================================
// ERROR HANDLING
// ======================================================

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

// ======================================================
// LOGIN
// ======================================================

console.log(
  "Starting TRILOK Discord Bot..."
);

client.login(
  TOKEN
);
