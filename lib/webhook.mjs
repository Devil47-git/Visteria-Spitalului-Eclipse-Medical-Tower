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

function formatRon(cents) {
  return new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON" }).format(cents / 100);
}

export async function sendTransactionWebhook({ type, amountCents, note, actor, callsign, discordId, balanceCents }) {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.warn("DISCORD_WEBHOOK_URL nu este setat — notificarea a fost omisă.");
    return;
  }
  const isDeposit = type === "deposit";
  const embed = {
    title: `${isDeposit ? "🟢 Adăugare" : "🔴 Retragere"} în Visteria Spital`,
    color: isDeposit ? 0x57f287 : 0xed4245,
    fields: [
      { name: "Efectuat de", value: `<@${discordId}> (${actor} · ${callsign})`, inline: false },
      { name: "Sumă", value: formatRon(amountCents), inline: true },
      { name: "Nou sold", value: formatRon(balanceCents), inline: true },
      { name: "Motiv", value: note || "—", inline: false }
    ],
    footer: { text: `Visteria Eclipse • ${getRomanianDateTime()}` },
    timestamp: new Date().toISOString()
  };
  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ embeds: [embed], allowed_mentions: { parse: ["users"] } })
    });
    if (!response.ok) {
      console.error(`Discord webhook a răspuns cu ${response.status}.`);
    }
  } catch (error) {
    console.error("Discord webhook a eșuat:", error);
  }
}
