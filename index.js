require("dotenv").config();

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
  Collection
} = require("discord.js");

const fs = require("fs");
const path = require("path");

// ===============================
// CONFIG
// ===============================

const TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;

const GUILD_ID = "1493700265499689154";
const SUPPORT_ROLE_ID = "1542498406981959801";
const SUPPORT_LOG_CHANNEL_ID = "1542500573000106024";

if (!TOKEN || !CLIENT_ID) {
  console.error("Missing DISCORD_TOKEN or CLIENT_ID in Render Environment Variables.");
  process.exit(1);
}

// ===============================
// STORAGE
// ===============================

const dataDir = path.join(__dirname, "data");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const files = {
  tickets: path.join(dataDir, "tickets.json"),
  config: path.join(dataDir, "config.json"),
  warnings: path.join(dataDir, "warnings.json"),
  schedules: path.join(dataDir, "schedules.json"),
  security: path.join(dataDir, "security.json")
};

function ensureFile(file, fallback) {
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, JSON.stringify(fallback, null, 2));
  }
}

ensureFile(files.tickets, {});
ensureFile(files.config, {});
ensureFile(files.warnings, {});
ensureFile(files.schedules, []);
ensureFile(files.security, {});

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// ===============================
// CLIENT
// ===============================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.GuildModeration
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User]
});

// ===============================
// COMMANDS
// ===============================

const commands = [

  // TICKET
  new SlashCommandBuilder()
    .setName("ticket")
    .setDescription("Create a support ticket from Discord or DM."),

  new SlashCommandBuilder()
    .setName("ticketpanel")
    .setDescription("Send the DM ticket panel.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("ticketsetup")
    .setDescription("Configure the ticket system.")
    .addChannelOption(o =>
      o.setName("category")
        .setDescription("Ticket category")
        .addChannelTypes(ChannelType.GuildCategory)
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  new SlashCommandBuilder()
    .setName("close")
    .setDescription("Close the current ticket."),

  new SlashCommandBuilder()
    .setName("claim")
    .setDescription("Claim the current ticket."),

  new SlashCommandBuilder()
    .setName("unclaim")
    .setDescription("Unclaim the current ticket."),

  new SlashCommandBuilder()
    .setName("add")
    .setDescription("Add a member to the ticket.")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member to add")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("remove")
    .setDescription("Remove a member from the ticket.")
    .addUserOption(o =>
      o.setName("user")
        .setDescription("Member to remove")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("transcript")
    .setDescription("Create a transcript of the ticket."),

  new SlashCommandBuilder()
    .setName("ticketstats")
    .setDescription("Show ticket statistics."),

  // AUTOMOD
  new SlashCommandBuilder()
    .setName("automod")
    .setDescription("AutoMod controls.")
    .addSubcommand(s =>
      s.setName("setup")
        .setDescription("Enable AutoMod.")
    )
    .addSubcommand(s =>
      s.setName("enable")
        .setDescription("Enable AutoMod.")
    )
    .addSubcommand(s =>
      s.setName("disable")
        .setDescription("Disable AutoMod.")
    )
    .addSubcommand(s =>
      s.setName("status")
        .setDescription("Show AutoMod status.")
    )
    .addSubcommand(s =>
      s.setName("config")
        .setDescription("Configure AutoMod.")
        .addIntegerOption(o =>
          o.setName("spam_limit")
            .setDescription("Messages allowed within 5 seconds")
            .setMinValue(3)
            .setMaxValue(20)
            .setRequired(false)
        )
        .addIntegerOption(o =>
          o.setName("timeout")
            .setDescription("Timeout duration in seconds")
            .setMinValue(10)
            .setMaxValue(604800)
            .setRequired(false)
        )
    ),

  // SECURITY
  new SlashCommandBuilder()
    .setName("security")
    .setDescription("Security controls.")
    .addSubcommand(s =>
      s.setName("setup")
        .setDescription("Enable security protection.")
    )
    .addSubcommand(s =>
      s.setName("enable")
        .setDescription("Enable security.")
    )
    .addSubcommand(s =>
      s.setName("disable")
        .setDescription("Disable security.")
    )
    .addSubcommand(s =>
      s.setName("status")
        .setDescription("Show security status.")
    ),

  // ANNOUNCEMENTS
  new SlashCommandBuilder()
    .setName("announce")
    .setDescription("Announcement system.")
    .addSubcommand(s =>
      s.setName("send")
        .setDescription("Send an announcement.")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Announcement channel")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName("message")
            .setDescription("Announcement message")
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("embed")
        .setDescription("Send an embed announcement.")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Announcement channel")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName("title")
            .setDescription("Embed title")
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName("message")
            .setDescription("Embed description")
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName("color")
            .setDescription("Hex color, example: #5865F2")
            .setRequired(false)
        )
    )
    .addSubcommand(s =>
      s.setName("schedule")
        .setDescription("Schedule an announcement.")
        .addChannelOption(o =>
          o.setName("channel")
            .setDescription("Announcement channel")
            .addChannelTypes(ChannelType.GuildText)
            .setRequired(true)
        )
        .addStringOption(o =>
          o.setName("message")
            .setDescription("Announcement message")
            .setRequired(true)
        )
        .addIntegerOption(o =>
          o.setName("minutes")
            .setDescription("Minutes from now")
            .setMinValue(1)
            .setMaxValue(10080)
            .setRequired(true)
        )
    )
    .addSubcommand(s =>
      s.setName("list")
        .setDescription("List scheduled announcements.")
    )
    .addSubcommand(s =>
      s.setName("cancel")
        .setDescription("Cancel a scheduled announcement.")
        .addStringOption(o =>
          o.setName("id")
            .setDescription("Schedule ID")
            .setRequired(true)
        )
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)

].map(command => command.toJSON());

// ===============================
// HELPERS
// ===============================

function isSupport(member) {
  if (!member) return false;

  return (
    member.permissions?.has(PermissionFlagsBits.Administrator) ||
    member.roles?.cache?.has(SUPPORT_ROLE_ID)
  );
}

function getConfig() {
  return readJSON(files.config, {});
}

function saveConfig(data) {
  writeJSON(files.config, data);
}

function getGuildConfig(guildId) {
  const data = getConfig();

  if (!data[guildId]) {
    data[guildId] = {
      ticketCategory: null,
      automod: {
        enabled: true,
        spamLimit: 6,
        timeout: 60,
        invites: true,
        mentions: true,
        duplicate: true
      },
      security: {
        enabled: true,
        antiRaid: true,
        antiMassMention: true,
        antiWebhook: true,
        antiDangerousRoles: true
      }
    };

    saveConfig(data);
  }

  return data[guildId];
}

function saveGuildConfig(guildId, config) {
  const data = getConfig();
  data[guildId] = config;
  saveConfig(data);
}

async function sendLog(guild, title, description) {
  try {
    const channel = await guild.channels.fetch(SUPPORT_LOG_CHANNEL_ID);

    if (!channel || !channel.isTextBased()) return;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("Log error:", error.message);
  }
}

function getTicketByChannel(channelId) {
  const tickets = readJSON(files.tickets, {});

  for (const [userId, ticket] of Object.entries(tickets)) {
    if (ticket.channelId === channelId) {
      return { userId, ticket };
    }
  }

  return null;
}

// ===============================
// REGISTER COMMANDS
// ===============================

async function registerCommands() {
  const rest = new REST({ version: "10" }).setToken(TOKEN);

  console.log("Registering slash commands...");

  await rest.put(
    Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
    { body: commands }
  );

  console.log("Slash commands registered.");
}

// ===============================
// READY
// ===============================

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);

  try {
    await registerCommands();
  } catch (error) {
    console.error("Command registration error:", error);
  }

  console.log("DM Ticket + AutoMod + Security + Announcement Bot is online.");
});

// ===============================
// DM TICKET SYSTEM
// ===============================

async function createTicket(user) {
  const guild = await client.guilds.fetch(GUILD_ID);
  const member = await guild.members.fetch(user.id).catch(() => null);

  const tickets = readJSON(files.tickets, {});

  if (tickets[user.id]) {
    const oldChannel = await guild.channels
      .fetch(tickets[user.id].channelId)
      .catch(() => null);

    if (oldChannel) {
      return oldChannel;
    }

    delete tickets[user.id];
    writeJSON(files.tickets, tickets);
  }

  const config = getGuildConfig(GUILD_ID);

  const category = config.ticketCategory
    ? await guild.channels.fetch(config.ticketCategory).catch(() => null)
    : null;

  const channelName =
    `ticket-${user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 15)}-${user.id.slice(-4)}`;

  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: SUPPORT_ROLE_ID,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ]
    }
  ];

  if (member) {
    permissionOverwrites.push({
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ]
    });
  }

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: category?.type === ChannelType.GuildCategory ? category.id : undefined,
    permissionOverwrites
  });

  tickets[user.id] = {
    channelId: channel.id,
    createdAt: Date.now(),
    claimedBy: null
  };

  writeJSON(files.tickets, tickets);

  const embed = new EmbedBuilder()
    .setTitle("🎫 Support Ticket")
    .setDescription(
      `Hello <@${user.id}>!\n\n` +
      `Your support ticket has been created.\n` +
      `A support member will assist you shortly.\n\n` +
      `You can continue replying to the bot DM while your ticket is open.`
    )
    .setTimestamp();

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("ticket_close")
      .setLabel("Close Ticket")
      .setStyle(ButtonStyle.Danger)
  );

  await channel.send({
    content: `<@&${SUPPORT_ROLE_ID}>`,
    embeds: [embed],
    components: [buttons]
  });

  await user.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("🎫 Ticket Created")
        .setDescription(
          "Your support ticket has been created successfully.\n\n" +
          "Send your messages here and our support team will receive them."
        )
        .setTimestamp()
    ]
  }).catch(() => {});

  await sendLog(
    guild,
    "🎫 Ticket Created",
    `User: <@${user.id}>\nChannel: ${channel}`
  );

  return channel;
}

// ===============================
// DM MESSAGE HANDLER
// ===============================

client.on("messageCreate", async message => {
  try {
    if (message.author.bot) return;

    // DM MESSAGE
    if (!message.guild) {
      const tickets = readJSON(files.tickets, {});
      const ticket = tickets[message.author.id];

      if (!ticket) {
        const channel = await createTicket(message.author);
        await channel.send(
          `**New message from ${message.author.tag}:**\n${message.content || "[Attachment]"}`
        );
        return;
      }

      const channel = await client.channels
        .fetch(ticket.channelId)
        .catch(() => null);

      if (!channel) {
        delete tickets[message.author.id];
        writeJSON(files.tickets, tickets);

        const newChannel = await createTicket(message.author);

        await newChannel.send(
          `**New message from ${message.author.tag}:**\n${message.content || "[Attachment]"}`
        );

        return;
      }

      await channel.send(
        `**${message.author.tag}:**\n${message.content || "[Attachment]"}`
      );

      return;
    }

    // GUILD AUTOMOD
    await handleAutoMod(message);

  } catch (error) {
    console.error("Message error:", error);
  }
});

// ===============================
// STAFF REPLY -> USER DM
// ===============================

client.on("messageCreate", async message => {
  try {
    if (!message.guild || message.author.bot) return;

    const ticketInfo = getTicketByChannel(message.channel.id);

    if (!ticketInfo) return;

    if (!isSupport(message.member)) return;

    const user = await client.users
      .fetch(ticketInfo.userId)
      .catch(() => null);

    if (!user) return;

    await user.send(
      `**Support — ${message.author.tag}:**\n${message.content || "[Attachment]"}`
    ).catch(() => {});
  } catch (error) {
    console.error("Ticket DM error:", error);
  }
});

// ===============================
// AUTOMOD
// ===============================

const spamMap = new Map();

async function handleAutoMod(message) {
  if (!message.guild || message.author.bot) return;

  const config = getGuildConfig(message.guild.id);

  if (!config.automod?.enabled) return;

  // Don't moderate administrators/support
  if (
    message.member.permissions.has(PermissionFlagsBits.Administrator) ||
    message.member.roles.cache.has(SUPPORT_ROLE_ID)
  ) {
    return;
  }

  const content = message.content || "";

  // INVITE FILTER
  if (
    config.automod.invites &&
    /(discord\.gg\/|discord\.com\/invite\/)/i.test(content)
  ) {
    await message.delete().catch(() => {});

    await warnUser(
      message.member,
      "Discord invite link",
      config.automod.timeout
    );

    return;
  }

  // MASS MENTION
  if (
    config.automod.mentions &&
    (message.mentions.everyone ||
      message.mentions.users.size >= 5 ||
      message.mentions.roles.size >= 5)
  ) {
    await message.delete().catch(() => {});

    await warnUser(
      message.member,
      "Mass mention",
      config.automod.timeout
    );

    return;
  }

  // SPAM
  const now = Date.now();

  if (!spamMap.has(message.author.id)) {
    spamMap.set(message.author.id, []);
  }

  const timestamps = spamMap.get(message.author.id);

  timestamps.push(now);

  const recent = timestamps.filter(t => now - t <= 5000);

  spamMap.set(message.author.id, recent);

  if (recent.length >= config.automod.spamLimit) {
    spamMap.set(message.author.id, []);

    await message.delete().catch(() => {});

    await warnUser(
      message.member,
      "Spam/flood",
      config.automod.timeout
    );
  }
}

async function warnUser(member, reason, timeoutSeconds) {
  const warnings = readJSON(files.warnings, {});

  if (!warnings[member.id]) {
    warnings[member.id] = [];
  }

  warnings[member.id].push({
    reason,
    time: Date.now()
  });

  writeJSON(files.warnings, warnings);

  if (member.moderatable) {
    await member.timeout(
      timeoutSeconds * 1000,
      `AutoMod: ${reason}`
    ).catch(() => {});
  }

  await sendLog(
    member.guild,
    "🛡️ AutoMod Action",
    `User: <@${member.id}>\nReason: ${reason}\nTimeout: ${timeoutSeconds}s`
  );
}

// ===============================
// SECURITY
// ===============================

const joinTracker = new Map();

client.on("guildMemberAdd", async member => {
  try {
    if (member.guild.id !== GUILD_ID) return;

    const config = getGuildConfig(member.guild.id);

    if (!config.security?.enabled) return;
    if (!config.security.antiRaid) return;

    const now = Date.now();

    if (!joinTracker.has(member.guild.id)) {
      joinTracker.set(member.guild.id, []);
    }

    const joins = joinTracker.get(member.guild.id);

    joins.push(now);

    const recent = joins.filter(t => now - t <= 10000);

    joinTracker.set(member.guild.id, recent);

    if (recent.length >= 10) {
      await sendLog(
        member.guild,
        "🚨 Possible Raid Detected",
        `10 or more members joined within approximately 10 seconds.`
      );
    }
  } catch (error) {
    console.error("Security join error:", error);
  }
});

// Role/channel/webhook/bot changes are logged through audit-log events.

client.on("guildAuditLogEntryCreate", async (entry, guild) => {
  try {
    if (guild.id !== GUILD_ID) return;

    const config = getGuildConfig(guild.id);

    if (!config.security?.enabled) return;

    const dangerousActions = [
      10, // CHANNEL_CREATE
      11, // CHANNEL_UPDATE
      12, // CHANNEL_DELETE
      30, // ROLE_CREATE
      31, // ROLE_UPDATE
      32, // ROLE_DELETE
      50, // BOT_ADD
      52, // WEBHOOK_CREATE
      53, // WEBHOOK_UPDATE
      54  // WEBHOOK_DELETE
    ];

    if (dangerousActions.includes(entry.action)) {
      await sendLog(
        guild,
        "🔐 Security Alert",
        `Action: \`${entry.action}\`\nExecutor: <@${entry.executorId || "Unknown"}>\nTarget: ${entry.targetId || "Unknown"}`
      );
    }
  } catch (error) {
    console.error("Security audit error:", error);
  }
});

// ===============================
// SLASH COMMANDS
// ===============================

client.on("interactionCreate", async interaction => {
  try {

    // BUTTONS
    if (interaction.isButton()) {

      if (interaction.customId === "ticket_close") {
        const info = getTicketByChannel(interaction.channel.id);

        if (!info) {
          return interaction.reply({
            content: "This is not an active ticket.",
            ephemeral: true
          });
        }

        if (!isSupport(interaction.member)) {
          return interaction.reply({
            content: "You don't have permission to close this ticket.",
            ephemeral: true
          });
        }

        await interaction.reply("Closing ticket...");

        const tickets = readJSON(files.tickets, {});
        delete tickets[info.userId];
        writeJSON(files.tickets, tickets);

        const user = await client.users
          .fetch(info.userId)
          .catch(() => null);

        if (user) {
          await user.send(
            "🎫 Your support ticket has been closed. You can DM me again to create a new ticket."
          ).catch(() => {});
        }

        await sendLog(
          interaction.guild,
          "🎫 Ticket Closed",
          `User: <@${info.userId}>\nClosed by: ${interaction.user}`
        );

        setTimeout(() => {
          interaction.channel.delete().catch(() => {});
        }, 1500);

        return;
      }
    }

    if (!interaction.isChatInputCommand()) return;

    const command = interaction.commandName;

    // ===========================
    // TICKET
    // ===========================

    if (command === "ticket") {
      if (!interaction.guild) {
        await interaction.reply("Please DM the bot to create a ticket.");
        return;
      }

      const channel = await createTicket(interaction.user);

      await interaction.reply({
        content: `Your ticket is ready: ${channel}`,
        ephemeral: true
      });

      return;
    }

    if (command === "ticketpanel") {
      if (!isSupport(interaction.member)) {
        return interaction.reply({
          content: "You don't have permission.",
          ephemeral: true
        });
      }

      const embed = new EmbedBuilder()
        .setTitle("🎫 Support Center")
        .setDescription(
          "Need help?\n\n" +
          "Send a **DM to this bot** to automatically create a private support ticket.\n\n" +
          "Our support team will receive your message."
        )
        .setTimestamp();

      await interaction.channel.send({
        embeds: [embed]
      });

      await interaction.reply({
        content: "Ticket panel sent.",
        ephemeral: true
      });

      return;
    }

    if (command === "ticketsetup") {
      if (!isSupport(interaction.member)) {
        return interaction.reply({
          content: "You don't have permission.",
          ephemeral: true
        });
      }

      const category = interaction.options.getChannel("category");

      const config = getGuildConfig(interaction.guild.id);
      config.ticketCategory = category.id;

      saveGuildConfig(interaction.guild.id, config);

      await interaction.reply(
        `✅ Ticket category set to ${category}.`
      );

      return;
    }

    // ===========================
    // TICKET MANAGEMENT
    // ===========================

    if (
      ["close", "claim", "unclaim", "add", "remove", "transcript"]
        .includes(command)
    ) {
      if (!interaction.guild) return;

      const info = getTicketByChannel(interaction.channel.id);

      if (!info) {
        return interaction.reply({
          content: "This channel is not an active ticket.",
          ephemeral: true
        });
      }

      if (!isSupport(interaction.member)) {
        return interaction.reply({
          content: "You don't have permission.",
          ephemeral: true
        });
      }

      if (command === "claim") {
        const tickets = readJSON(files.tickets, {});
        tickets[info.userId].claimedBy = interaction.user.id;
        writeJSON(files.tickets, tickets);

        await interaction.reply(
          `✅ Ticket claimed by ${interaction.user}.`
        );

        return;
      }

      if (command === "unclaim") {
        const tickets = readJSON(files.tickets, {});
        tickets[info.userId].claimedBy = null;
        writeJSON(files.tickets, tickets);

        await interaction.reply("✅ Ticket unclaimed.");
        return;
      }

      if (command === "add") {
        const user = interaction.options.getUser("user");

        await interaction.channel.permissionOverwrites.edit(
          user.id,
          {
            ViewChannel: true,
            SendMessages: true,
            ReadMessageHistory: true
          }
        );

        await interaction.reply(
          `✅ Added ${user} to the ticket.`
        );

        return;
      }

      if (command === "remove") {
        const user = interaction.options.getUser("user");

        await interaction.channel.permissionOverwrites.delete(
          user.id
        ).catch(() => {});

        await interaction.reply(
          `✅ Removed ${user} from the ticket.`
        );

        return;
      }

      if (command === "transcript") {
        const messages = await interaction.channel.messages.fetch({
          limit: 100
        });

        const sorted = [...messages.values()].reverse();

        let transcript =
          `Ticket Transcript\n` +
          `Channel: ${interaction.channel.name}\n` +
          `Created: ${new Date().toISOString()}\n\n`;

        for (const msg of sorted) {
          transcript +=
            `[${msg.createdAt.toISOString()}] ` +
            `${msg.author.tag}: ` +
            `${msg.content || "[Attachment]"}\n`;
        }

        const transcriptFile = path.join(
          dataDir,
          `transcript-${interaction.channel.id}.txt`
        );

        fs.writeFileSync(transcriptFile, transcript);

        await interaction.reply({
          content: "📄 Transcript created.",
          files: [transcriptFile]
        });

        return;
      }

      if (command === "close") {
        await interaction.reply("Closing ticket...");

        const tickets = readJSON(files.tickets, {});
        delete tickets[info.userId];
        writeJSON(files.tickets, tickets);

        const user = await client.users
          .fetch(info.userId)
          .catch(() => null);

        if (user) {
          await user.send(
            "🎫 Your support ticket has been closed."
          ).catch(() => {});
        }

        await sendLog(
          interaction.guild,
          "🎫 Ticket Closed",
          `User: <@${info.userId}>\nClosed by: ${interaction.user}`
        );

        setTimeout(() => {
          interaction.channel.delete().catch(() => {});
        }, 1000);

        return;
      }
    }

    if (command === "ticketstats") {
      if (!isSupport(interaction.member)) {
        return interaction.reply({
          content: "You don't have permission.",
          ephemeral: true
        });
      }

      const tickets = readJSON(files.tickets, {});
      const count = Object.keys(tickets).length;

      const claimed = Object.values(tickets)
        .filter(t => t.claimedBy).length;

      const embed = new EmbedBuilder()
        .setTitle("🎫 Ticket Statistics")
        .addFields(
          {
            name: "Open Tickets",
            value: String(count),
            inline: true
          },
          {
            name: "Claimed",
            value: String(claimed),
            inline: true
          },
          {
            name: "Unclaimed",
            value: String(count - claimed),
            inline: true
          }
        )
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
      return;
    }

    // ===========================
    // AUTOMOD COMMANDS
    // ===========================

    if (command === "automod") {
      if (!isSupport(interaction.member)) {
        return interaction.reply({
          content: "You don't have permission.",
          ephemeral: true
        });
      }

      const sub = interaction.options.getSubcommand();
      const config = getGuildConfig(interaction.guild.id);

      if (sub === "setup" || sub === "enable") {
        config.automod.enabled = true;
        saveGuildConfig(interaction.guild.id, config);

        await interaction.reply("🛡️ AutoMod enabled.");
        return;
      }

      if (sub === "disable") {
        config.automod.enabled = false;
        saveGuildConfig(interaction.guild.id, config);

        await interaction.reply("🛡️ AutoMod disabled.");
        return;
      }

      if (sub === "status") {
        const a = config.automod;

        const embed = new EmbedBuilder()
          .setTitle("🛡️ AutoMod Status")
          .addFields(
            {
              name: "Enabled",
              value: a.enabled ? "Yes" : "No",
              inline: true
            },
            {
              name: "Spam Limit",
              value: String(a.spamLimit),
              inline: true
            },
            {
              name: "Timeout",
              value: `${a.timeout}s`,
              inline: true
            },
            {
              name: "Invite Filter",
              value: a.invites ? "Enabled" : "Disabled",
              inline: true
            },
            {
              name: "Mention Protection",
              value: a.mentions ? "Enabled" : "Disabled",
              inline: true
            }
          );

        await interaction.reply({ embeds: [embed] });
        return;
      }

      if (sub === "config") {
        const spam = interaction.options.getInteger("spam_limit");
        const timeout = interaction.options.getInteger("timeout");

        if (spam !== null) config.automod.spamLimit = spam;
        if (timeout !== null) config.automod.timeout = timeout;

        saveGuildConfig(interaction.guild.id, config);

        await interaction.reply("✅ AutoMod configuration updated.");
        return;
      }
    }

    // ===========================
    // SECURITY COMMANDS
    // ===========================

    if (command === "security") {
      if (!isSupport(interaction.member)) {
        return interaction.reply({
          content: "You don't have permission.",
          ephemeral: true
        });
      }

      const sub = interaction.options.getSubcommand();
      const config = getGuildConfig(interaction.guild.id);

      if (sub === "setup" || sub === "enable") {
        config.security.enabled = true;
        saveGuildConfig(interaction.guild.id, config);

        await interaction.reply("🔐 Security system enabled.");
        return;
      }

      if (sub === "disable") {
        config.security.enabled = false;
        saveGuildConfig(interaction.guild.id, config);

        await interaction.reply("🔐 Security system disabled.");
        return;
      }

      if (sub === "status") {
        const s = config.security;

        const embed = new EmbedBuilder()
          .setTitle("🔐 Security Status")
          .addFields(
            {
              name: "Enabled",
              value: s.enabled ? "Yes" : "No",
              inline: true
            },
            {
              name: "Anti-Raid",
              value: s.antiRaid ? "Enabled" : "Disabled",
              inline: true
            },
            {
              name: "Mass Mention",
              value: s.antiMassMention ? "Enabled" : "Disabled",
              inline: true
            },
            {
              name: "Webhook Protection",
              value: s.antiWebhook ? "Enabled" : "Disabled",
              inline: true
            }
          );

        await interaction.reply({ embeds: [embed] });
        return;
      }
    }

    // ===========================
    // ANNOUNCEMENTS
    // ===========================

    if (command === "announce") {
      if (!isSupport(interaction.member)) {
        return interaction.reply({
          content: "You don't have permission.",
          ephemeral: true
        });
      }

      const sub = interaction.options.getSubcommand();

      if (sub === "send") {
        const channel = interaction.options.getChannel("channel");
        const message = interaction.options.getString("message");

        await channel.send({
          content: message,
          allowedMentions: {
            parse: ["users", "roles"]
          }
        });

        await interaction.reply({
          content: `📢 Announcement sent to ${channel}.`,
          ephemeral: true
        });

        await sendLog(
          interaction.guild,
          "📢 Announcement Sent",
          `Channel: ${channel}\nBy: ${interaction.user}`
        );

        return;
      }

      if (sub === "embed") {
        const channel = interaction.options.getChannel("channel");
        const title = interaction.options.getString("title");
        const message = interaction.options.getString("message");
        const color =
          interaction.options.getString("color") || "#5865F2";

        const embed = new EmbedBuilder()
          .setTitle(title)
          .setDescription(message)
          .setColor(color)
          .setFooter({
            text: `Announcement by ${interaction.user.tag}`
          })
          .setTimestamp();

        await channel.send({
          embeds: [embed]
        });

        await interaction.reply({
          content: `📢 Embed announcement sent to ${channel}.`,
          ephemeral: true
        });

        return;
      }

      if (sub === "schedule") {
        const channel = interaction.options.getChannel("channel");
        const message = interaction.options.getString("message");
        const minutes = interaction.options.getInteger("minutes");

        const schedules = readJSON(files.schedules, []);

        const id =
          Date.now().toString(36) +
          Math.random().toString(36).slice(2, 6);

        schedules.push({
          id,
          guildId: interaction.guild.id,
          channelId: channel.id,
          message,
          executeAt: Date.now() + minutes * 60000,
          createdBy: interaction.user.id
        });

        writeJSON(files.schedules, schedules);

        await interaction.reply({
          content:
            `✅ Announcement scheduled.\n` +
            `ID: \`${id}\`\n` +
            `Time: ${minutes} minute(s) from now.`,
          ephemeral: true
        });

        return;
      }

      if (sub === "list") {
        const schedules = readJSON(files.schedules, [])
          .filter(s => s.guildId === interaction.guild.id);

        if (!schedules.length) {
          await interaction.reply("No scheduled announcements.");
          return;
        }

        const text = schedules
          .map(
            s =>
              `\`${s.id}\` — <#${s.channelId}> — <t:${Math.floor(
                s.executeAt / 1000
              )}:R>`
          )
          .join("\n");

        await interaction.reply({
          content: `📢 Scheduled announcements:\n${text}`,
          ephemeral: true
        });

        return;
      }

      if (sub === "cancel") {
        const id = interaction.options.getString("id");

        const schedules = readJSON(files.schedules, []);

        const index = schedules.findIndex(
          s =>
            s.id === id &&
            s.guildId === interaction.guild.id
        );

        if (index === -1) {
          await interaction.reply({
            content: "Schedule not found.",
            ephemeral: true
          });
          return;
        }

        schedules.splice(index, 1);
        writeJSON(files.schedules, schedules);

        await interaction.reply({
          content: "✅ Scheduled announcement cancelled.",
          ephemeral: true
        });

        return;
      }
    }

  } catch (error) {
    console.error("Interaction error:", error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "An unexpected error occurred.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

// ===============================
// SCHEDULED ANNOUNCEMENTS
// ===============================

setInterval(async () => {
  try {
    const schedules = readJSON(files.schedules, []);
    const now = Date.now();

    const due = schedules.filter(
      schedule => schedule.executeAt <= now
    );

    const remaining = schedules.filter(
      schedule => schedule.executeAt > now
    );

    writeJSON(files.schedules, remaining);

    for (const schedule of due) {
      try {
        const channel = await client.channels
          .fetch(schedule.channelId)
          .catch(() => null);

        if (!channel || !channel.isTextBased()) continue;

        await channel.send({
          content: schedule.message
        });

        const guild = await client.guilds
          .fetch(schedule.guildId)
          .catch(() => null);

        if (guild) {
          await sendLog(
            guild,
            "📢 Scheduled Announcement Sent",
            `Channel: ${channel}\nSchedule ID: \`${schedule.id}\``
          );
        }
      } catch (error) {
        console.error("Scheduled announcement error:", error);
      }
    }

  } catch (error) {
    console.error("Scheduler error:", error);
  }
}, 15000);

// ===============================
// ERROR HANDLING
// ===============================

process.on("unhandledRejection", error => {
  console.error("Unhandled rejection:", error);
});

process.on("uncaughtException", error => {
  console.error("Uncaught exception:", error);
});

// ===============================
// LOGIN
// ===============================

client.login(TOKEN);
