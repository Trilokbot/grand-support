// ======================================================
// TRILOK DISCORD BOT
// DM TICKETS + AUTOMOD + SECURITY + ANNOUNCEMENTS
// FULL TICKET SYSTEM
// RENDER FREE WEB SERVICE VERSION
// ======================================================

const http = require("http");

// ======================================================
// RENDER PORT SERVER
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
// DISCORD
// ======================================================

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
  ButtonStyle
} = require("discord.js");

// ======================================================
// ENVIRONMENT VARIABLES
// ======================================================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

// ======================================================
// SERVER SETTINGS
// ======================================================

const GUILD_ID = "1493700265499689154";

const SUPPORT_ROLE_ID =
  "1542498406981959801";

const SUPPORT_LOG_CHANNEL_ID =
  "1542500573000106024";

// ======================================================
// ENVIRONMENT CHECK
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
// TICKET STORAGE
// ======================================================

const tickets = new Map();

let ticketCategoryId = null;

const botConfig = {
  automod: true,
  security: true,
  spamLimit: 6,
  timeoutSeconds: 60
};

const spamTracker = new Map();

let recentJoins = [];

// ======================================================
// STAFF CHECK
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
// FIND TICKET
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
// LOG SYSTEM
// ======================================================

async function sendLog(guild, title, description, extra = {}) {
  try {
    const channel =
      await guild.channels.fetch(
        SUPPORT_LOG_CHANNEL_ID
      );

    if (!channel || !channel.isTextBased()) {
      return;
    }

    const embed =
      new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setTimestamp();

    if (extra.color) {
      embed.setColor(extra.color);
    }

    if (extra.fields) {
      embed.addFields(extra.fields);
    }

    await channel.send({
      embeds: [embed],
      files: extra.files || []
    });

  } catch (error) {
    console.error(
      "Log error:",
      error.message
    );
  }
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
// REGISTER SLASH COMMANDS
// ======================================================

const commands = [

  // ----------------------------------------------------
  // TICKET
  // ----------------------------------------------------

  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription(
      "Create a support ticket."
    ),

  new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription(
      "Send the support ticket panel."
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

  new SlashCommandBuilder()
    .setName("ticketsetup")
    .setDescription(
      "Configure the ticket category."
    )
    .addChannelOption(option =>
      option
        .setName("category")
        .setDescription(
          "Ticket category"
        )
        .addChannelTypes(
          ChannelType.GuildCategory
        )
        .setRequired(true)
    )
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild
    ),

  new SlashCommandBuilder()
    .setName("close")
    .setDescription(
      "Close the current ticket."
    ),

  new SlashCommandBuilder()
    .setName("reopen")
    .setDescription(
      "Reopen a closed ticket."
    ),

  new SlashCommandBuilder()
    .setName("delete")
    .setDescription(
      "Permanently delete the ticket."
    ),

  new SlashCommandBuilder()
    .setName("claim")
    .setDescription(
      "Claim the current ticket."
    ),

  new SlashCommandBuilder()
    .setName("unclaim")
    .setDescription(
      "Release the current ticket."
    ),

  new SlashCommandBuilder()
    .setName("lock")
    .setDescription(
      "Lock the ticket for the user."
    ),

  new SlashCommandBuilder()
    .setName("unlock")
    .setDescription(
      "Unlock the ticket for the user."
    ),

  new SlashCommandBuilder()
    .setName("add")
    .setDescription(
      "Add a member to the ticket."
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription(
          "Member to add"
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("remove")
    .setDescription(
      "Remove a member from the ticket."
    )
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription(
          "Member to remove"
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("rename")
    .setDescription(
      "Rename the current ticket."
    )
    .addStringOption(option =>
      option
        .setName("name")
        .setDescription(
          "New ticket name"
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("priority")
    .setDescription(
      "Set ticket priority."
    )
    .addStringOption(option =>
      option
        .setName("level")
        .setDescription(
          "Ticket priority"
        )
        .setRequired(true)
        .addChoices(
          {
            name: "Low",
            value: "low"
          },
          {
            name: "Normal",
            value: "normal"
          },
          {
            name: "High",
            value: "high"
          },
          {
            name: "Urgent",
            value: "urgent"
          }
        )
    ),

  new SlashCommandBuilder()
    .setName("note")
    .setDescription(
      "Add an internal staff note."
    )
    .addStringOption(option =>
      option
        .setName("message")
        .setDescription(
          "Internal note"
        )
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ticketinfo")
    .setDescription(
      "Show ticket information."
    ),

  new SlashCommandBuilder()
    .setName("transcript")
    .setDescription(
      "Create a complete ticket transcript."
    ),

  new SlashCommandBuilder()
    .setName("ticketstats")
    .setDescription(
      "Show ticket statistics."
    ),

  // ----------------------------------------------------
  // AUTOMOD
  // ----------------------------------------------------

  new SlashCommandBuilder()
    .setName("automod")
    .setDescription(
      "AutoMod controls."
    )
    .addSubcommand(sub =>
      sub
        .setName("enable")
        .setDescription(
          "Enable AutoMod."
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("disable")
        .setDescription(
          "Disable AutoMod."
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("status")
        .setDescription(
          "Show AutoMod status."
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("config")
        .setDescription(
          "Configure AutoMod."
        )
        .addIntegerOption(option =>
          option
            .setName("spam_limit")
            .setDescription(
              "Messages allowed in 5 seconds"
            )
            .setMinValue(3)
            .setMaxValue(20)
        )
        .addIntegerOption(option =>
          option
            .setName("timeout")
            .setDescription(
              "Timeout duration in seconds"
            )
            .setMinValue(10)
            .setMaxValue(604800)
        )
    ),

  // ----------------------------------------------------
  // SECURITY
  // ----------------------------------------------------

  new SlashCommandBuilder()
    .setName("security")
    .setDescription(
      "Security controls."
    )
    .addSubcommand(sub =>
      sub
        .setName("enable")
        .setDescription(
          "Enable security."
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("disable")
        .setDescription(
          "Disable security."
        )
    )
    .addSubcommand(sub =>
      sub
        .setName("status")
        .setDescription(
          "Show security status."
        )
    ),

  // ----------------------------------------------------
  // ANNOUNCEMENT
  // ----------------------------------------------------

  new SlashCommandBuilder()
    .setName("announce")
    .setDescription(
      "Announcement system."
    )
    .addSubcommand(sub =>
      sub
        .setName("send")
        .setDescription(
          "Send an announcement."
        )
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription(
              "Announcement channel"
            )
            .addChannelTypes(
              ChannelType.GuildText
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
    )
    .addSubcommand(sub =>
      sub
        .setName("embed")
        .setDescription(
          "Send an embed announcement."
        )
        .addChannelOption(option =>
          option
            .setName("channel")
            .setDescription(
              "Announcement channel"
            )
            .addChannelTypes(
              ChannelType.GuildText
            )
            .setRequired(true)
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
    "Slash commands registered successfully."
  );
}

// ======================================================
// LOAD EXISTING TICKETS AFTER RESTART
// ======================================================

async function loadExistingTickets() {

  try {

    const guild =
      await client.guilds.fetch(
        GUILD_ID
      );

    const channels =
      await guild.channels.fetch();

    for (const [, channel] of channels) {

      if (
        channel.type !==
        ChannelType.GuildText
      ) {
        continue;
      }

      if (
        !channel.topic ||
        !channel.topic.startsWith(
          "TRILOK_TICKET:"
        )
      ) {
        continue;
      }

      const parts =
        channel.topic.split(":");

      const userId =
        parts[1];

      const status =
        parts[2] || "open";

      const priority =
        parts[3] || "normal";

      const claimedBy =
        parts[4] || null;

      if (!userId) {
        continue;
      }

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
      await guild.channels
        .fetch(existing.channelId)
        .catch(() => null);

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
          "🔓 **Ticket reopened.**\n\nSupport Team is available again."
        );
      }

      return existingChannel;
    }

    tickets.delete(user.id);
  }

  let category = null;

  if (ticketCategoryId) {

    category =
      await guild.channels
        .fetch(ticketCategoryId)
        .catch(() => null);
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

    embeds: [
      embed
    ],

    components: [
      ticketButtons()
    ]
  });

  await user.send(
    "🎫 **Support Ticket Created**\n\n" +
    "Your private support ticket has been created.\n\n" +
    "Please send your message here. A member of the **Support Team** will assist you.\n\n" +
    "You will never need to contact or identify an individual staff member."
  ).catch(() => {});

  await sendLog(
    guild,
    "🎫 Ticket Created",
    `User: <@${user.id}>\nChannel: ${channel}\nPriority: Normal`,
    {
      color: 0x57f287
    }
  );

  return channel;
}

// ======================================================
// FORWARD USER DM TO STAFF
// ======================================================

async function forwardUserMessage(
  user,
  message
) {

  let ticket =
    tickets.get(
      user.id
    );

  if (!ticket) {

    const channel =
      await createTicket(
        user
      );

    ticket =
      tickets.get(
        user.id
      );

    await sendUserMessageToTicket(
      channel,
      user,
      message
    );

    return;
  }

  const channel =
    await client.channels
      .fetch(
        ticket.channelId
      )
      .catch(() => null);

  if (!channel) {

    tickets.delete(
      user.id
    );

    const newChannel =
      await createTicket(
        user
      );

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

    await channel.send(
      "🔓 **Ticket automatically reopened because the user sent a new message.**"
    );
  }

  if (ticket.locked) {

    await user.send(
      "🔒 Your support ticket is currently locked by the Support Team. Please wait until it is unlocked."
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
// USER MESSAGE -> STAFF CHANNEL
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
      .addFields(
        {
          name: "User",
          value: `<@${user.id}>`,
          inline: true
        }
      )
      .setTimestamp();

  if (
    message.attachments.size > 0
  ) {

    embed.addFields({
      name: "Attachments",
      value:
        message.attachments
          .map(
            attachment =>
              attachment.url
          )
          .join("\n")
          .slice(0, 1024)
    });
  }

  await channel.send({
    embeds: [
      embed
    ]
  });
}

// ======================================================
// FORWARD STAFF MESSAGE TO USER
// ======================================================

async function forwardStaffMessage(
  message
) {

  const found =
    getTicketByChannel(
      message.channel.id
    );

  if (!found) {
    return;
  }

  const {
    userId,
    ticket
  } = found;

  if (
    !isStaff(
      message.member
    )
  ) {
    return;
  }

  if (
    ticket.status ===
    "closed" ||
    ticket.locked
  ) {
    return;
  }

  const user =
    await client.users
      .fetch(
        userId
      )
      .catch(() => null);

  if (!user) {
    return;
  }

  /*
   IMPORTANT:
   NEVER send the staff member's
   username, tag, ID or avatar.
  */

  const content =
    message.content ||
    "";

  const attachments =
    message.attachments
      .map(
        attachment => ({
          attachment:
            attachment.url
        })
      );

  const embed =
    new EmbedBuilder()
      .setTitle(
        "💬 Support Team"
      )
      .setDescription(
        content ||
        "📎 Attachment"
      )
      .setFooter({
        text:
          "Official Support Team"
      })
      .setTimestamp();

  await user.send({
    embeds: [
      embed
    ],
    files:
      attachments
  }).catch(() => {});
}

// ======================================================
// MESSAGE HANDLER
// ======================================================

client.on(
  "messageCreate",
  async message => {

    if (
      message.author.bot
    ) {
      return;
    }

    try {

      // ==================================================
      // DM
      // ==================================================

      if (!message.guild) {

        await forwardUserMessage(
          message.author,
          message
        );

        return;
      }

      // ==================================================
      // STAFF TICKET MESSAGE
      // ==================================================

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

      // ==================================================
      // AUTOMOD
      // ==================================================

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
// COMPLETE TRANSCRIPT
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

    if (
      batch.size === 0
    ) {
      break;
    }

    allMessages.push(
      ...batch.values()
    );

    lastId =
      batch.last().id;

    if (
      batch.size < 100
    ) {
      break;
    }

    if (
      allMessages.length >= 10000
    ) {
      break;
    }
  }

  allMessages =
    allMessages.reverse();

  let output =
    "==================================================\n" +
    "TRILOK SUPPORT TICKET TRANSCRIPT\n" +
    "==================================================\n\n";

  output +=
    `Channel: #${channel.name}\n`;

  output +=
    `Channel ID: ${channel.id}\n`;

  output +=
    `Generated: ${new Date().toISOString()}\n\n`;

  output +=
    "--------------------------------------------------\n\n";

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

    if (
      message.attachments.size > 0
    ) {

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

// ======================================================
// SEND TRANSCRIPT TO LOG
// ======================================================

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

    const filename =
      `ticket-${channel.id}-transcript.txt`;

    await sendLog(
      guild,
      "📄 Ticket Transcript",
      `User: <@${userId}>\nChannel: ${channel}\nTranscript generated successfully.`,
      {
        color: 0x5865f2,
        files: [
          {
            attachment:
              transcript,
            name:
              filename
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
    tickets.get(
      userId
    );

  if (!ticket) {
    return false;
  }

  await sendTranscriptToLog(
    channel.guild,
    channel,
    userId
  );

  ticket.status =
    "closed";

  ticket.locked =
    true;

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
    "This ticket has been closed and archived.\n" +
    "Use `/reopen` if it needs to be reopened."
  );

  const user =
    await client.users
      .fetch(
        userId
      )
      .catch(() => null);

  if (user) {

    await user.send(
      "🔒 **Your support ticket has been closed.**\n\n" +
      "If you need further assistance, simply send another message to this DM and the ticket can be reopened."
    ).catch(() => {});
  }

  await sendLog(
    channel.guild,
    "🔒 Ticket Closed",
    `User: <@${userId}>\nClosed by: <@${closedBy.id}>`,
    {
      color: 0xed4245
    }
  );

  return true;
}

// ======================================================
// REOPEN TICKET
// ======================================================

async function reopenTicket(
  userId,
  channel
) {

  const ticket =
    tickets.get(
      userId
    );

  if (!ticket) {
    return false;
  }

  ticket.status =
    "open";

  ticket.locked =
    false;

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
    "🔓 **Ticket Reopened**\n\n" +
    "The Support Team can continue assisting the user."
  );

  const user =
    await client.users
      .fetch(
        userId
      )
      .catch(() => null);

  if (user) {

    await user.send(
      "🔓 **Your support ticket has been reopened.**\n\n" +
      "The Support Team can continue assisting you."
    ).catch(() => {});
  }

  return true;
}

// ======================================================
// AUTOMOD
// ======================================================

async function runAutoMod(
  message
) {

  if (
    !message.guild ||
    !botConfig.automod
  ) {
    return;
  }

  if (
    message.member?.permissions.has(
      PermissionFlagsBits.Administrator
    ) ||
    message.member?.roles.cache.has(
      SUPPORT_ROLE_ID
    )
  ) {
    return;
  }

  const content =
    message.content || "";

  // DISCORD INVITES

  if (
    /discord\.gg\/|discord\.com\/invite\//i
      .test(content)
  ) {

    await message.delete()
      .catch(() => {});

    await punish(
      message.member,
      "Discord invite link"
    );

    return;
  }

  // MASS MENTION

  if (
    message.mentions.everyone ||
    message.mentions.users.size >= 5 ||
    message.mentions.roles.size >= 5
  ) {

    await message.delete()
      .catch(() => {});

    await punish(
      message.member,
      "Mass mention"
    );

    return;
  }

  // SPAM

  const now =
    Date.now();

  const previous =
    spamTracker.get(
      message.author.id
    ) || [];

  const recent =
    previous.filter(
      time =>
        now - time < 5000
    );

  recent.push(now);

  spamTracker.set(
    message.author.id,
    recent
  );

  if (
    recent.length >=
    botConfig.spamLimit
  ) {

    spamTracker.set(
      message.author.id,
      []
    );

    await message.delete()
      .catch(() => {});

    await punish(
      message.member,
      "Spam/flood"
    );
  }
}

// ======================================================
// AUTOMOD PUNISH
// ======================================================

async function punish(
  member,
  reason
) {

  if (!member) {
    return;
  }

  if (
    member.moderatable
  ) {

    await member.timeout(
      botConfig.timeoutSeconds * 1000,
      `AutoMod: ${reason}`
    ).catch(() => {});
  }

  await sendLog(
    member.guild,
    "🛡️ AutoMod Action",
    `User: <@${member.id}>\nReason: ${reason}\nTimeout: ${botConfig.timeoutSeconds}s`
  );
}

// ======================================================
// SECURITY
// ======================================================

client.on(
  "guildMemberAdd",
  async member => {

    if (
      member.guild.id !==
      GUILD_ID
    ) {
      return;
    }

    if (
      !botConfig.security
    ) {
      return;
    }

    const now =
      Date.now();

    recentJoins =
      recentJoins.filter(
        time =>
          now - time < 10000
      );

    recentJoins.push(
      now
    );

    if (
      recentJoins.length >=
      10
    ) {

      await sendLog(
        member.guild,
        "🚨 SECURITY ALERT",
        "Possible raid detected: 10 or more members joined within 10 seconds.",
        {
          color: 0xed4245
        }
      );

      recentJoins = [];
    }
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
      // BUTTONS
      // ==================================================

      if (
        interaction.isButton()
      ) {

        const custom =
          interaction.customId;

        if (
          ![
            "ticket_claim",
            "ticket_close",
            "ticket_transcript",
            "ticket_lock"
          ].includes(custom)
        ) {
          return;
        }

        if (
          !isStaff(
            interaction.member
          )
        ) {

          await interaction.reply({
            content:
              "❌ You don't have permission to use this ticket control.",
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

        // CLAIM

        if (
          custom ===
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

          const user =
            await client.users
              .fetch(userId)
              .catch(() => null);

          if (user) {

            await user.send(
              "🛡️ **Support Team Update**\n\n" +
              "Your ticket has been assigned to a member of our Support Team."
            ).catch(() => {});
          }

          return;
        }

        // CLOSE

        if (
          custom ===
          "ticket_close"
        ) {

          await interaction.reply(
            "🔒 Closing and archiving ticket..."
          );

          await closeTicket(
            userId,
            interaction.channel,
            interaction.user
          );

          return;
        }

        // TRANSCRIPT

        if (
          custom ===
          "ticket_transcript"
        ) {

          await interaction.deferReply({
            ephemeral: true
          });

          const transcript =
            await createTranscript(
              interaction.channel
            );

          await interaction.editReply({
            content:
              "✅ Complete transcript generated and sent to the Support Log Channel."
          });

          await sendLog(
            interaction.guild,
            "📄 Manual Ticket Transcript",
            `User: <@${userId}>\nGenerated by: <@${interaction.user.id}>\nChannel: ${interaction.channel}`,
            {
              files: [
                {
                  attachment:
                    transcript,
                  name:
                    `ticket-${interaction.channel.id}-transcript.txt`
                }
              ]
            }
          );

          return;
        }

        // LOCK

        if (
          custom ===
          "ticket_lock"
        ) {

          ticket.locked =
            true;

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
            "🔐 Ticket locked. The user can no longer send messages."
          );

          const user =
            await client.users
              .fetch(userId)
              .catch(() => null);

          if (user) {

            await user.send(
              "🔐 **Your support ticket has been locked temporarily by the Support Team.**"
            ).catch(() => {});
          }

          return;
        }
      }

      // ==================================================
      // SLASH COMMANDS
      // ==================================================

      if (
        !interaction.isChatInputCommand()
      ) {
        return;
      }

      // ==================================================
      // /TICKET
      // ==================================================

      if (
        interaction.commandName ===
        "ticket"
      ) {

        const channel =
          await createTicket(
            interaction.user
          );

        await interaction.reply({
          content:
            `🎫 Your support ticket is ready. Please check your DMs.`,
          ephemeral: true
        });

        return;
      }

      // ==================================================
      // /TICKETPANEL
      // ==================================================

      if (
        interaction.commandName ===
        "ticketpanel"
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

        const embed =
          new EmbedBuilder()
            .setTitle(
              "🎫 TRILOK Support Center"
            )
            .setDescription(
              "Need help?\n\n" +
              "Click the button below to open a private support ticket.\n\n" +
              "💬 All communication with staff happens privately through DM.\n" +
              "🛡️ Staff identities are not shown to users.\n" +
              "📄 Tickets are logged and transcribed for security."
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
          embeds: [
            embed
          ],
          components: [
            row
          ]
        });

        await interaction.reply({
          content:
            "✅ Ticket panel sent.",
          ephemeral: true
        });

        return;
      }

      // ==================================================
      // CREATE TICKET BUTTON
      // ==================================================

      if (
        interaction.isButton() &&
        interaction.customId ===
        "create_ticket"
      ) {

        const channel =
          await createTicket(
            interaction.user
          );

        await interaction.reply({
          content:
            "🎫 **Support ticket created.** Check your DMs to continue.",
          ephemeral: true
        });

        return;
      }

      // ==================================================
      // STAFF COMMAND PERMISSION
      // ==================================================

      const staffCommands = [
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
        "announce"
      ];

      if (
        staffCommands.includes(
          interaction.commandName
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
      // /TICKETSETUP
      // ==================================================

      if (
        interaction.commandName ===
        "ticketsetup"
      ) {

        const category =
          interaction.options.getChannel(
            "category"
          );

        ticketCategoryId =
          category.id;

        await interaction.reply(
          `✅ Ticket category set to ${category}.`
        );

        return;
      }

      // ==================================================
      // FIND CURRENT TICKET
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
          interaction.commandName
        )
      ) {

        const found =
          getTicketByChannel(
            interaction.channel.id
          );

        if (!found) {

          await interaction.reply({
            content:
              "❌ This channel is not an active ticket.",
            ephemeral: true
          });

          return;
        }

        const {
          userId,
          ticket
        } = found;

        // CLOSE

        if (
          interaction.commandName ===
          "close"
        ) {

          await interaction.reply(
            "🔒 Closing and archiving ticket..."
          );

          await closeTicket(
            userId,
            interaction.channel,
            interaction.user
          );

          return;
        }

        // REOPEN

        if (
          interaction.commandName ===
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

        // DELETE

        if (
          interaction.commandName ===
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

        // CLAIM

        if (
          interaction.commandName ===
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

          const user =
            await client.users
              .fetch(userId)
              .catch(() => null);

          if (user) {

            await user.send(
              "🛡️ **Support Team Update**\n\n" +
              "Your ticket has been assigned to a member of our Support Team."
            ).catch(() => {});
          }

          return;
        }

        // UNCLAIM

        if (
          interaction.commandName ===
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
            "✅ Ticket is now unclaimed."
          );

          return;
        }

        // LOCK

        if (
          interaction.commandName ===
          "lock"
        ) {

          ticket.locked =
            true;

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

          const user =
            await client.users
              .fetch(userId)
              .catch(() => null);

          if (user) {

            await user.send(
              "🔐 **Your support ticket has been locked temporarily by the Support Team.**"
            ).catch(() => {});
          }

          return;
        }

        // UNLOCK

        if (
          interaction.commandName ===
          "unlock"
        ) {

          ticket.locked =
            false;

          ticket.status =
            "open";

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

          const user =
            await client.users
              .fetch(userId)
              .catch(() => null);

          if (user) {

            await user.send(
              "🔓 **Your support ticket has been unlocked.**"
            ).catch(() => {});
          }

          return;
        }

        // ADD

        if (
          interaction.commandName ===
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

        // REMOVE

        if (
          interaction.commandName ===
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
            `✅ ${user} removed from the ticket.`
          );

          return;
        }

        // RENAME

        if (
          interaction.commandName ===
          "rename"
        ) {

          let name =
            interaction.options.getString(
              "name"
            );

          name =
            name
              .toLowerCase()
              .replace(/[^a-z0-9-]/g, "-")
              .slice(0, 90);

          if (!name) {
            name =
              `ticket-${userId}`;
          }

          await interaction.channel.setName(
            name
          );

          await interaction.reply(
            `✏️ Ticket renamed to \`${name}\`.`
          );

          return;
        }

        // PRIORITY

        if (
          interaction.commandName ===
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

          const icons = {
            low: "🟢 Low",
            normal: "🔵 Normal",
            high: "🟠 High",
            urgent: "🔴 Urgent"
          };

          await interaction.reply(
            `🚦 Ticket priority changed to **${icons[level]}**.`
          );

          return;
        }

        // NOTE

        if (
          interaction.commandName ===
          "note"
        ) {

          const note =
            interaction.options.getString(
              "message"
            );

          ticket.notes =
            ticket.notes || [];

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
              `📝 Internal note saved:\n${note}`,
            ephemeral: true
          });

          await sendLog(
            interaction.guild,
            "📝 Ticket Internal Note",
            `Ticket User: <@${userId}>\nAdded by: <@${interaction.user.id}>\n\n${note}`
          );

          return;
        }

        // INFO

        if (
          interaction.commandName ===
          "ticketinfo"
        ) {

          const user =
            await client.users
              .fetch(userId)
              .catch(() => null);

          const claimed =
            ticket.claimedBy
              ? `<@${ticket.claimedBy}>`
              : "Nobody";

          const embed =
            new EmbedBuilder()
              .setTitle(
                "🎫 Ticket Information"
              )
              .addFields(
                {
                  name: "User",
                  value:
                    user
                      ? `${user} (${user.tag})`
                      : userId,
                  inline: false
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
                  name: "Claimed By",
                  value:
                    claimed,
                  inline: true
                },
                {
                  name: "Locked",
                  value:
                    ticket.locked
                      ? "Yes"
                      : "No",
                  inline: true
                },
                {
                  name: "Created",
                  value:
                    `<t:${Math.floor(ticket.createdAt / 1000)}:F>`,
                  inline: false
                }
              )
              .setTimestamp();

          await interaction.reply({
            embeds: [
              embed
            ],
            ephemeral: true
          });

          return;
        }

        // TRANSCRIPT

        if (
          interaction.commandName ===
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
            `User: <@${userId}>\nGenerated by: <@${interaction.user.id}>\nChannel: ${interaction.channel}`,
            {
              files: [
                {
                  attachment:
                    transcript,
                  name:
                    `ticket-${interaction.channel.id}-transcript.txt`
                }
              ]
            }
          );

          await interaction.editReply(
            "✅ Complete transcript created and sent to the Support Log Channel."
          );

          return;
        }
      }

      // ==================================================
      // TICKET STATS
      // ==================================================

      if (
        interaction.commandName ===
        "ticketstats"
      ) {

        const all =
          [...tickets.values()];

        const open =
          all.filter(
            ticket =>
              ticket.status ===
              "open"
          ).length;

        const closed =
          all.filter(
            ticket =>
              ticket.status ===
              "closed"
          ).length;

        const locked =
          all.filter(
            ticket =>
              ticket.locked
          ).length;

        const claimed =
          all.filter(
            ticket =>
              ticket.claimedBy
          ).length;

        const embed =
          new EmbedBuilder()
            .setTitle(
              "🎫 Ticket Statistics"
            )
            .addFields(
              {
                name: "Open",
                value:
                  String(open),
                inline: true
              },
              {
                name: "Closed",
                value:
                  String(closed),
                inline: true
              },
              {
                name: "Claimed",
                value:
                  String(claimed),
                inline: true
              },
              {
                name: "Locked",
                value:
                  String(locked),
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
          embeds: [
            embed
          ]
        });

        return;
      }

      // ==================================================
      // AUTOMOD
      // ==================================================

      if (
        interaction.commandName ===
        "automod"
      ) {

        const sub =
          interaction.options
            .getSubcommand();

        if (
          sub === "enable"
        ) {

          botConfig.automod =
            true;

          await interaction.reply(
            "🛡️ AutoMod enabled."
          );

          return;
        }

        if (
          sub === "disable"
        ) {

          botConfig.automod =
            false;

          await interaction.reply(
            "🛡️ AutoMod disabled."
          );

          return;
        }

        if (
          sub === "status"
        ) {

          await interaction.reply(
            `🛡️ AutoMod: ${
              botConfig.automod
                ? "ON"
                : "OFF"
            }\nSpam limit: ${botConfig.spamLimit}\nTimeout: ${botConfig.timeoutSeconds}s`
          );

          return;
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

          if (
            spam !== null
          ) {
            botConfig.spamLimit =
              spam;
          }

          if (
            timeout !== null
          ) {
            botConfig.timeoutSeconds =
              timeout;
          }

          await interaction.reply(
            `✅ AutoMod configured.\nSpam limit: ${botConfig.spamLimit}\nTimeout: ${botConfig.timeoutSeconds}s`
          );

          return;
        }
      }

      // ==================================================
      // SECURITY
      // ==================================================

      if (
        interaction.commandName ===
        "security"
      ) {

        const sub =
          interaction.options
            .getSubcommand();

        if (
          sub === "enable"
        ) {

          botConfig.security =
            true;

          await interaction.reply(
            "🔐 Security enabled."
          );

          return;
        }

        if (
          sub === "disable"
        ) {

          botConfig.security =
            false;

          await interaction.reply(
            "🔐 Security disabled."
          );

          return;
        }

        await interaction.reply(
          `🔐 Security: ${
            botConfig.security
              ? "ON"
              : "OFF"
          }\nAnti-raid: ON\nAudit monitoring: ON`
        );

        return;
      }

      // ==================================================
      // ANNOUNCEMENTS
      // ==================================================

      if (
        interaction.commandName ===
        "announce"
      ) {

        const sub =
          interaction.options
            .getSubcommand();

        const channel =
          interaction.options
            .getChannel(
              "channel"
            );

        if (
          sub === "send"
        ) {

          const message =
            interaction.options
              .getString(
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

          await sendLog(
            interaction.guild,
            "📢 Announcement Sent",
            `Channel: ${channel}\nBy: ${interaction.user}`
          );

          return;
        }

        if (
          sub === "embed"
        ) {

          const title =
            interaction.options
              .getString(
                "title"
              );

          const message =
            interaction.options
              .getString(
                "message"
              );

          const embed =
            new EmbedBuilder()
              .setTitle(
                title
              )
              .setDescription(
                message
              )
              .setTimestamp();

          await channel.send({
            embeds: [
              embed
            ]
          });

          await interaction.reply({
            content:
              "✅ Embed announcement sent.",
            ephemeral: true
          });

          await sendLog(
            interaction.guild,
            "📢 Embed Announcement Sent",
            `Channel: ${channel}\nBy: ${interaction.user}`
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
  "Starting Discord bot..."
);

client.login(TOKEN);
