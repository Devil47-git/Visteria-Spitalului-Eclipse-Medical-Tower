import { canDeleteAccessCode, sortAccessEntriesByCallsign } from "/admin-utils.mjs";

const currency = (cents) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
let toastTimeout;
let currentLedger;
let currentUser;
let transactionType = "deposit";

function showToast(message, isError = false) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.hidden = false;
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => { toast.hidden = true; }, 4200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers }
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Cererea nu a putut fi finalizată.");
  return body;
}

function showView(stage) {
  document.querySelector("#auth-view").hidden = stage !== "anonymous";
  document.querySelector("#pending-view").hidden = stage !== "pending";
  document.querySelector("#dashboard-view").hidden = stage !== "authorized";
}

function renderLedger(ledger) {
  currentLedger = ledger;
  const balance = document.querySelector("#balance-amount");
  balance.dataset.value = currency(ledger.balanceCents);
  balance.textContent = balance.classList.contains("concealed") ? balance.dataset.value : balance.dataset.value;
  const list = document.querySelector("#history-list");
  list.replaceChildren();
  document.querySelector("#empty-state").hidden = ledger.transactions.length > 0;
  document.querySelector("#history-count").textContent = `${ledger.transactions.length} înregistrări`;
  for (const tx of ledger.transactions) {
    const isDeposit = tx.type === "deposit";
    const row = document.createElement("div");
    row.className = "tx-row";
    const details = document.createElement("div");
    const title = document.createElement("div");
    title.textContent = [isDeposit ? "Adăugare" : "Retragere", tx.note].filter(Boolean).join(" · ");
    const meta = document.createElement("div");
    meta.className = "tx-meta";
    meta.textContent = `${new Date(tx.createdAt).toLocaleString("ro-RO", { dateStyle: "short", timeStyle: "short" })} · ${tx.actor} · ${tx.callsign}`;
    details.append(title, meta);
    const amount = document.createElement("span");
    amount.className = `tx-amount ${isDeposit ? "deposit" : "withdrawal"}`;
    amount.textContent = `${isDeposit ? "+" : "−"}${currency(tx.amountCents)}`;
    row.append(details, amount);
    list.append(row);
  }
}

function renderBilant(bilant) {
  const net = bilant.netCents ?? bilant.profitCents;
  document.querySelector("#settings-bilant-dep").textContent = currency(bilant.totalDepositsCents);
  document.querySelector("#settings-bilant-wd").textContent = currency(bilant.totalWithdrawalsCents);
  document.querySelector("#settings-bilant-profit").textContent = `${net < 0 ? "-" : ""}${currency(Math.abs(net))}`;
  if (bilant.periodStart && bilant.periodEnd && bilant.calculatedAt) {
    const date = (value) => new Date(value).toLocaleDateString("ro-RO", { timeZone: "Europe/Bucharest" });
    const time = new Date(bilant.calculatedAt).toLocaleString("ro-RO", { timeZone: "Europe/Bucharest" });
    document.querySelector("#settings-bilant-period").textContent = `Perioadă: ${date(bilant.periodStart)} - ${date(bilant.periodEnd)} · Calculat la ${time}`;
  } else {
    document.querySelector("#settings-bilant-period").textContent = "";
  }
}

function memberRow({ discordId, displayName, callsign, role, roleLabel, isHr, pendingCode }, currentUser, onChanged, roles) {
  const row = document.createElement("div");
  row.className = "member-row whitelist-row";
  const left = document.createElement("div");
  left.title = discordId;
  const name = document.createElement("div");
  const selectedRole = roles.find((item) => item.code === role);
  const displayedCallsign = /^\d{3}$/.test(role) || selectedRole && role !== "membru" ? `M-${role}` : callsign;
  const displayedRole = role === "membru" ? "Retired" : selectedRole?.label || roleLabel || `${role} — Grad eliminat`;
  name.textContent = `${displayName} · ${displayedCallsign} · ${displayedRole}${pendingCode ? " · COD ÎN AȘTEPTARE" : ""}`;
  if (pendingCode) name.classList.add("pending-access");
  const id = document.createElement("div");
  id.className = "member-id";
  id.textContent = discordId;
  left.append(name, id);
  if (pendingCode) {
    const hint = document.createElement("div");
    hint.className = "member-id pending-hint";
    hint.textContent = "Profil în așteptarea codului — nu are acces la visterie încă";
    left.append(hint);
  }

  const controls = document.createElement("div");
  controls.style.display = "flex";
  controls.style.gap = "6px";
  const isChief = currentUser.isHr || currentUser.isAdmin || currentUser.role === "001";
  const roleSelect = document.createElement("select");
  roleSelect.className = "role-select";
  for (const item of roles) {
    const option = document.createElement("option");
    option.value = item.code;
    option.textContent = item.label;
    option.selected = item.code === role;
    roleSelect.append(option);
  }
  if (role && !roles.some((item) => item.code === role)) {
    const legacyOption = document.createElement("option");
    legacyOption.value = role;
    legacyOption.textContent = `${role} — Grad eliminat`;
    legacyOption.selected = true;
    legacyOption.disabled = true;
    roleSelect.append(legacyOption);
  }
  if (pendingCode || (!currentUser.isHr && !currentUser.isAdmin)) {
    for (const option of roleSelect.options) {
      if (option.value !== role) option.disabled = true;
    }
  }
  roleSelect.addEventListener("change", async () => {
    try {
      await api("/api/admin/access/role", { method: "POST", body: JSON.stringify({ discordId, role: roleSelect.value }) });
      showToast(`Rol actualizat: ${roleSelect.value}.`);
      onChanged();
    } catch (error) {
      showToast(error.message, true);
      roleSelect.value = role;
    }
  });

  const hrLabel = document.createElement("label");
  hrLabel.className = "member-id";
  const hrCheck = document.createElement("input");
  hrCheck.type = "checkbox";
  hrCheck.checked = Boolean(isHr);
  hrCheck.disabled = pendingCode || !isChief;
  hrCheck.title = "Funcția separată de Șef HR";
  hrCheck.addEventListener("change", async () => {
    try {
      await api("/api/admin/access/hr", { method: "POST", body: JSON.stringify({ discordId, enabled: hrCheck.checked }) });
      showToast("Funcția HR a fost actualizată.");
      onChanged();
    } catch (error) {
      showToast(error.message, true);
      hrCheck.checked = !hrCheck.checked;
    }
  });
  hrLabel.append(hrCheck, document.createTextNode(" HR"));

  const removeButton = document.createElement("button");
  removeButton.className = "btn btn-small btn-danger";
  removeButton.type = "button";
  removeButton.textContent = "Scoate acces";
  removeButton.disabled = pendingCode || discordId === currentUser.discordId
    || (isHr && currentUser.role !== "001" && !currentUser.isHr && !currentUser.isAdmin);
  removeButton.addEventListener("click", async () => {
    removeButton.disabled = true;
    try {
      await api("/api/admin/access", { method: "DELETE", body: JSON.stringify({ discordId }) });
      showToast("Accesul a fost revocat.");
      onChanged();
    } catch (error) {
      showToast(error.message, true);
      removeButton.disabled = false;
    }
  });
  controls.append(roleSelect, hrLabel, removeButton);
  row.append(left, controls);
  return row;
}

async function loadAdminPanel(user) {
  const panel = document.querySelector("#admin-panel");
  panel.hidden = false;
  const refresh = async () => {
    const [{ users: accessEntries, roles: serverRoles }, { codes }, { bilants }] = await Promise.all([api("/api/admin/access"), api("/api/admin/codes"), api("/api/admin/bilants/saved")]);
    const roles = [{ code: "membru", label: "Retired", rank: 999 }, ...serverRoles].sort((a, b) => a.rank - b.rank || a.code.localeCompare(b.code));
    const roleSelect = document.querySelector("#code-role");
    roleSelect.replaceChildren(...roles.map(({ code, label }) => {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = label;
      return option;
    }));
    const users = sortAccessEntriesByCallsign([...new Map(accessEntries.map((entry) => [entry.discordId, entry])).values()], roles);

    const members = document.querySelector("#member-list");
    members.replaceChildren();
    document.querySelector("#members-empty").hidden = users.length > 0;
    for (const member of users) members.append(memberRow(member, user, refresh, roles));

    const roleList = document.querySelector("#role-list");
    roleList.replaceChildren();
    for (const role of serverRoles.filter((item) => !["membru", ...Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(3, "0"))].includes(item.code))) {
      const row = document.createElement("div");
      row.className = "member-row";
      const text = document.createElement("span");
      text.textContent = `${role.code} — ${role.label} · ordine ${role.rank}`;
      const remove = document.createElement("button");
      remove.className = "btn btn-small btn-danger";
      remove.type = "button";
      remove.textContent = "Șterge";
      remove.disabled = !user.isHr && !user.isAdmin;
      remove.addEventListener("click", async () => {
        if (!window.confirm(`Ștergi gradul ${role.code} — ${role.label}? Membrii cu acest grad vor avea nevoie să fie reasignați.`)) return;
        try {
          await api("/api/admin/roles", { method: "DELETE", body: JSON.stringify({ code: role.code }) });
          showToast("Gradul a fost șters.");
          refresh();
        } catch (error) { showToast(error.message, true); }
      });
      row.append(text, remove);
      roleList.append(row);
    }
    document.querySelector("#role-form").hidden = !user.isHr && !user.isAdmin;

    const savedBilants = document.querySelector("#saved-bilants");
    savedBilants.replaceChildren();
    document.querySelector("#saved-bilants-empty").hidden = bilants.length > 0;
    for (const bilant of bilants) {
      const row = document.createElement("div");
      row.className = "member-row";
      const date = new Date(bilant.calculatedAt).toLocaleString("ro-RO", { dateStyle: "short", timeStyle: "short" });
      const text = document.createElement("span");
      text.textContent = `${date} · scos ${currency(bilant.totalWithdrawalsCents)} · adăugat ${currency(bilant.totalDepositsCents)} · net ${currency(bilant.netCents)}`;
      const selectButton = document.createElement("button");
      selectButton.type = "button";
      selectButton.className = "btn btn-small";
      selectButton.textContent = "Vezi";
      selectButton.addEventListener("click", () => {
        renderBilant(bilant);
        document.querySelector("#settings-bilant").hidden = false;
        document.querySelector("#settings-bilant").scrollIntoView({ block: "nearest" });
      });
      row.append(text, selectButton);
      savedBilants.append(row);
    }

    const codesList = document.querySelector("#codes-list");
    codesList.replaceChildren();
    document.querySelector("#codes-empty").hidden = codes.length > 0;
    for (const code of codes) {
      const row = document.createElement("div");
      row.className = "member-row";
      const left = document.createElement("div");
      const codeLine = document.createElement("div");
      codeLine.textContent = code.code;
      if (!code.usedAt && code.active) codeLine.style.color = "var(--accent)";
      const meta = document.createElement("div");
      meta.className = "member-id";
      meta.textContent = `Pentru ${code.discordId} · ${code.usedAt ? "folosit" : code.active ? "nefolosit" : "dezactivat"}`;
      left.append(codeLine, meta);
      if (!canDeleteAccessCode(code)) {
        const revokeButton = document.createElement("button");
        revokeButton.className = "btn btn-small";
        revokeButton.type = "button";
        revokeButton.textContent = "Dezactivează";
        revokeButton.addEventListener("click", async () => {
          try {
            await api("/api/admin/codes/revoke", { method: "POST", body: JSON.stringify({ code: code.code }) });
            showToast("Cod dezactivat.");
            refresh();
          } catch (error) {
            showToast(error.message, true);
          }
        });
        row.append(left, revokeButton);
      } else {
        const deleteButton = document.createElement("button");
        deleteButton.className = "btn btn-small btn-danger";
        deleteButton.type = "button";
        deleteButton.textContent = "Șterge";
        deleteButton.setAttribute("aria-label", `Șterge codul ${code.code}`);
        deleteButton.addEventListener("click", async () => {
          if (!window.confirm(`Ștergi definitiv codul ${code.code}?`)) return;
          deleteButton.disabled = true;
          try {
            await api("/api/admin/codes", { method: "DELETE", body: JSON.stringify({ code: code.code }) });
            showToast("Cod șters.");
            await refresh();
          } catch (error) {
            showToast(error.message, true);
            deleteButton.disabled = false;
          }
        });
        row.append(left, deleteButton);
      }
      codesList.append(row);
    }
  };
  await refresh();
}

async function loadDashboard() {
  const session = await api("/api/session");
  showView(session.stage);

  if (session.stage === "pending") {
    document.querySelector("#pending-name").textContent = session.displayName;
  }
  if (session.stage === "anonymous") {
    document.querySelector("#user-identity").textContent = "";
    document.querySelector("#settings-open").hidden = true;
    document.querySelector("#bilant-action-row").hidden = true;
  }

  if (session.stage === "authorized") {
    const user = session.user;
    currentUser = user;
    if (!liveRefreshTimer) liveRefreshTimer = setInterval(() => {
      if (currentUser && !document.hidden) refreshLedger();
    }, 5000);
    const identity = document.querySelector("#user-identity");
    const roleText = user.roleLabel || (user.role === "membru" ? "Retired" : user.role);
    const callsign = /^\d{3}$/.test(user.role) || user.roleLabel ? `M-${user.role}` : user.callsign;
    identity.textContent = `${user.displayName} · ${callsign} · ${roleText}`;
    identity.title = identity.textContent;
    document.querySelector("#settings-open").hidden = !user.isDirector;
    document.querySelector("#bilant-action-row").hidden = !user.isDirector;
    const ledger = await api("/api/ledger");
    renderLedger(ledger);
  } else {
    currentUser = undefined;
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get("error") === "oauth") showToast("Autentificarea Discord nu a putut fi finalizată.", true);
  if (params.get("error") === "unauthorized") showToast("Contul nu are acces. Cere unui director un cod emis pentru Discord ID-ul tău.", true);
  if (params.has("error") || params.has("pending")) history.replaceState({}, "", "/");
}

async function logout() {
  try {
    await api("/api/logout", { method: "POST" });
    currentUser = undefined;
    if (liveRefreshTimer) clearInterval(liveRefreshTimer);
    showView("anonymous");
  } catch (error) {
    showToast(error.message, true);
  }
}

document.querySelector("#logout-button").addEventListener("click", logout);
document.querySelector("#pending-logout").addEventListener("click", logout);

document.querySelector("#balance-amount").addEventListener("click", (event) => {
  const button = event.currentTarget;
  button.classList.toggle("concealed");
  button.textContent = button.dataset.value;
});

let liveRefreshTimer;
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && currentUser) refreshLedger();
});

async function refreshLedger() {
  if (!currentUser) return;
  try {
    const ledger = await api("/api/ledger");
    const newestId = ledger.transactions[0]?.id;
    const previousId = currentLedger?.transactions[0]?.id;
    renderLedger(ledger);
    if (newestId && previousId && newestId !== previousId) {
      document.querySelector("#live-update").hidden = false;
      clearTimeout(window.liveUpdateTimeout);
      window.liveUpdateTimeout = setTimeout(() => { document.querySelector("#live-update").hidden = true; }, 2800);
    }
  } catch (error) { if (error.message) console.warn("Ledger refresh failed", error.message); }
}

window.addEventListener("beforeunload", () => clearInterval(liveRefreshTimer));

document.querySelector("#settings-open").addEventListener("click", async () => {
  document.querySelector("#settings-dialog").showModal();
  try {
    await loadAdminPanel(currentUser);
  } catch (error) { showToast(error.message, true); }
});
document.querySelector("#settings-close").addEventListener("click", () => document.querySelector("#settings-dialog").close());
document.querySelector("#settings-dialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) event.currentTarget.close();
});
document.querySelector("#bilant-toggle").addEventListener("click", async () => {
  document.querySelector("#admin-panel").hidden = false;
  document.querySelector("#settings-dialog").showModal();
  const box = document.querySelector("#settings-bilant");
  box.hidden = false;
  try {
    renderBilant(await api("/api/admin/bilant"));
    document.querySelector("#settings-bilant").scrollIntoView({ block: "nearest" });
  } catch (error) { showToast(error.message, true); }
});
document.querySelector("#bilant-open").addEventListener("click", async () => {
  const box = document.querySelector("#settings-bilant");
  box.hidden = !box.hidden;
  if (!box.hidden) {
    try { renderBilant(await api("/api/admin/bilant")); }
    catch (error) { showToast(error.message, true); }
  }
});

document.querySelector("#clear-history").addEventListener("click", async (event) => {
  if (!window.confirm("Atenție: această acțiune va șterge definitiv tranzacțiile și bilanțurile salvate și va reseta soldul la zero. Whitelist-ul și codurile de acces vor rămâne. Continui?")) return;
  const confirmation = window.prompt('Pentru confirmare, scrie RESETARE:');
  if (confirmation !== "RESETARE") {
    showToast("Ștergerea a fost anulată.");
    return;
  }
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const { ledger } = await api("/api/admin/history", {
      method: "DELETE",
      body: JSON.stringify({ confirm: confirmation })
    });
    renderLedger(ledger);
    showToast("Datele financiare au fost resetate. Whitelist-ul și codurile au fost păstrate.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#bilant-save").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try {
    const { bilant, discordSent } = await api("/api/admin/bilants/save", { method: "POST", body: JSON.stringify({}) });
    renderBilant(bilant);
    await loadAdminPanel(currentUser);
    showToast(discordSent ? "Bilanț salvat pe site și trimis pe Discord." : "Bilanț salvat pe site. Discord webhook nu a putut primi mesajul.", !discordSent);
  } catch (error) { showToast(error.message, true); }
  finally { button.disabled = false; }
});

document.querySelector("#deposit-open").addEventListener("click", () => openTransaction("deposit"));
document.querySelector("#withdrawal-open").addEventListener("click", () => openTransaction("withdrawal"));
document.querySelector("#transaction-cancel").addEventListener("click", closeTransaction);
document.querySelector("#transaction-close").addEventListener("click", closeTransaction);
document.querySelector("#transaction-dialog").addEventListener("click", (event) => {
  if (event.target === event.currentTarget) closeTransaction();
});

function openTransaction(type) {
  transactionType = type;
  document.querySelector("#transaction-title").textContent = type === "deposit" ? "Adaugă bani" : "Scoate bani";
  document.querySelector("#transaction-callsign-label").textContent = type === "deposit" ? "Callsign-ul de la cine adaugă" : "Callsign-ul pentru cine scot";
  document.querySelector("#transaction-confirm").className = type === "deposit" ? "btn btn-primary" : "btn btn-danger";
  document.querySelector("#transaction-confirm").textContent = type === "deposit" ? "Confirmă adăugarea" : "Confirmă retragerea";
  document.querySelector("#transaction-dialog").showModal();
}
function closeTransaction() {
  document.querySelector("#transaction-dialog").close();
  document.querySelector("#transaction-form").reset();
}

document.querySelector("#redeem-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    await api("/api/access-code/redeem", {
      method: "POST",
      body: JSON.stringify({ code: document.querySelector("#redeem-code").value })
    });
    window.location.reload();
  } catch (error) {
    showToast(error.message, true);
    button.disabled = false;
  }
});

document.querySelector("#code-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const code = await api("/api/admin/codes", {
      method: "POST",
      body: JSON.stringify({
        discordId: document.querySelector("#code-discord-id").value,
        displayName: document.querySelector("#code-display-name").value,
        callsign: document.querySelector("#code-callsign").value,
        role: document.querySelector("#code-role").value,
        isHr: document.querySelector("#code-is-hr").checked
      })
    });
    document.querySelector("#code-form").reset();
    document.querySelector("#code-result").hidden = false;
    document.querySelector("#code-value").textContent = code.code;
    showToast(`Cod generat pentru Discord ID ${code.discordId}. Trimite-i codul; trebuie să intre cu acel cont și să-l introducă.`);
    await loadAdminPanel(currentUser);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#role-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    await api("/api/admin/roles", { method: "POST", body: JSON.stringify({
      code: document.querySelector("#role-code").value,
      label: document.querySelector("#role-label").value,
      rank: document.querySelector("#role-rank").value
    }) });
    event.currentTarget.reset();
    showToast("Gradul a fost adăugat.");
    await loadAdminPanel(currentUser);
  } catch (error) { showToast(error.message, true); }
  finally { button.disabled = false; }
});

document.querySelector("#code-copy").addEventListener("click", () => {
  navigator.clipboard.writeText(document.querySelector("#code-value").textContent)
    .then(() => showToast("Cod copiat."))
    .catch(() => showToast("Copierea a eșuat.", true));
});

document.querySelector("#balance-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  button.disabled = true;
  try {
    const { ledger } = await api("/api/admin/balance", {
      method: "POST",
      body: JSON.stringify({ mode: "set", amount: document.querySelector("#balance-amount-input").value })
    });
    renderLedger(ledger);
    document.querySelector("#balance-form").reset();
    showToast("Soldul a fost actualizat.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#transaction-callsign").addEventListener("input", (event) => {
  event.currentTarget.value = event.currentTarget.value.replace(/\D/g, "").slice(0, 3);
});
document.querySelector("#code-callsign").addEventListener("input", (event) => {
  event.currentTarget.value = event.currentTarget.value.replace(/\D/g, "").slice(0, 3);
});

document.querySelector("#transaction-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = document.querySelector("#transaction-confirm");
  button.disabled = true;
  try {
    const amount = document.querySelector("#transaction-amount").value;
    const callsign = `M-${document.querySelector("#transaction-callsign").value.trim().replace(/^M-/i, "")}`;
    const reason = document.querySelector("#transaction-reason").value;
    const ledger = await api("/api/transactions", {
      method: "POST",
      body: JSON.stringify({ type: transactionType, amount, targetCallsign: callsign, reason })
    });
    renderLedger(ledger);
    if (currentUser?.isDirector) {
      try { renderBilant(await api("/api/admin/bilant")); } catch { /* main action succeeded */ }
    }
    closeTransaction();
    showToast(transactionType === "deposit" ? "Suma a fost adăugată." : "Suma a fost scoasă.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

loadDashboard().catch((error) => {
  showView("anonymous");
  showToast(error.message, true);
});
