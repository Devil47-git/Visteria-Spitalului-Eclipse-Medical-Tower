export function getRomanianDateTime() {
  return new Date().toLocaleString("ro-RO", {
    timeZone: "Europe/Bucharest",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function formatDollars(cents) {
  return `$${Math.round(Number(cents) / 100).toLocaleString("en-US")}`;
}

function formatSignedDollars(cents) {
  const value = Math.round(Math.abs(Number(cents)) / 100).toLocaleString("en-US");
  return `${Number(cents) < 0 ? "-" : ""}$${value}`;
}

function webhookIdentity() {
  const base = process.env.APP_URL || (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  const avatarUrl = process.env.DISCORD_WEBHOOK_AVATAR_URL?.trim()
    || (base ? `${base.replace(/\/$/, "")}/hr.png` : "");
  const avatarDataUri = process.env.DISCORD_WEBHOOK_AVATAR_DATA_URI?.trim();
  return {
    username: "LOGURI Visterie",
    ...(avatarDataUri ? { avatar: avatarDataUri } : avatarUrl ? { avatar_url: avatarUrl } : {})
  };
}

export async function sendTransactionWebhook({ type, amountCents, reason, targetCallsign, discordId }) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("DISCORD_WEBHOOK_URL nu este setat — notificarea a fost omisă.");
    return;
  }
  const isDeposit = type === "deposit";
  const embed = {
    title: `${isDeposit ? "🟢 Adăugare" : "🔴 Retragere"} în Visterie Spital`,
    color: isDeposit ? 0x57f287 : 0xed4245,
    fields: [
      { name: "Efectuat de", value: `<@${discordId}>`, inline: false },
      { name: type === "deposit" ? "De la callsign" : "Pentru callsign", value: targetCallsign, inline: false },
      { name: "Sumă", value: formatDollars(amountCents), inline: false },
      { name: "Motiv", value: reason || "—", inline: false }
    ],
    footer: { text: `Visterie Eclipse • ${getRomanianDateTime()}` },
    timestamp: new Date().toISOString()
  };
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...webhookIdentity(), embeds: [embed], allowed_mentions: { parse: ["users"] } })
    });
    if (!response.ok) {
      console.error(`Discord webhook a răspuns cu ${response.status}.`);
    }
  } catch (error) {
    console.error("Discord webhook a eșuat:", error);
  }
}

function formatBilantDate(value) {
  return new Date(value).toLocaleString("ro-RO", {
    timeZone: "Europe/Bucharest",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  });
}

export async function sendBilantWebhook(bilant) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) return false;
  const embed = {
    title: "📊 BILANȚ VISTERIE",
    color: 0x5865f2,
    description: [
      "💸 Bani scoși din visterie",
      formatDollars(bilant.totalWithdrawalsCents),
      "💰 Bani adăugați în visterie",
      formatDollars(bilant.totalDepositsCents),
      "💵 Bani pe minus",
      formatSignedDollars(bilant.netCents),
      "",
      "Perioadă calculată",
      `${new Date(bilant.periodStart).toLocaleDateString("ro-RO", { timeZone: "Europe/Bucharest" })} - ${new Date(bilant.periodEnd).toLocaleDateString("ro-RO", { timeZone: "Europe/Bucharest" })}`,
      `Calcul efectuat la ${formatBilantDate(bilant.calculatedAt)}`
    ].join("\n"),
    footer: { text: "LOGURI Visterie" },
    timestamp: bilant.calculatedAt
  };
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...webhookIdentity(),
        embeds: [{
          title: "📊 BILANȚ VISTERIE",
          description: [
            "💸 Bani scoși din visterie",
            formatDollars(bilant.totalWithdrawalsCents),
            "💰 Bani adăugați în visterie",
            formatDollars(bilant.totalDepositsCents),
            "💵 Bani pe minus",
            formatSignedDollars(bilant.netCents),
            "Perioadă calculată",
            `${new Date(bilant.periodStart).toLocaleDateString("ro-RO", { timeZone: "Europe/Bucharest" })} - ${new Date(bilant.periodEnd).toLocaleDateString("ro-RO", { timeZone: "Europe/Bucharest" })}`,
            `Calcul efectuat la ${formatBilantDate(bilant.calculatedAt)}`
          ].join("\n"),
          color: 0x5865f2,
          footer: { text: "LOGURI Visterie" },
          timestamp: bilant.calculatedAt
        }],
        allowed_mentions: { parse: [] }
      })
    });
    return response.ok;
  } catch (error) {
    console.error("Discord bilant webhook failed:", error);
    return false;
  }
}
