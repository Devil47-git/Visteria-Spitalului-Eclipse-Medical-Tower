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
  balance.textContent = balance.classList.contains("concealed") ? "••" : balance.dataset.value;
  const list = document.querySelector("#history-list");
  list.replaceChildren();
  document.querySelector("#empty-state").hidden = ledger.transactions.length > 0;
  for (const tx of ledger.transactions) {
    const isDeposit = tx.type === "deposit";
    const row = document.createElement("div");
    row.className = "tx-row";
    const details = document.createElement("div");
    const title = document.createElement("div");
    title.textContent = tx.note || (isDeposit ? "Adăugare" : "Retragere");
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
  document.querySelector("#settings-bilant-dep").textContent = currency(bilant.totalDepositsCents);
  document.querySelector("#settings-bilant-wd").textContent = currency(bilant.totalWithdrawalsCents);
  document.querySelector("#settings-bilant-profit").textContent = currency(bilant.profitCents);
}

function memberRow({ discordId, displayName, callsign, role, isHr }, currentUser, onChanged) {
  const row = document.createElement("div");
  row.className = "member-row";
  const left = document.createElement("div");
  const name = document.createElement("div");
  const roleLabels = { "001": "Director General", "002": "Director adjunct", "003": "Director adjunct", "004": "Director adjunct", "005": "Medic Inspector", "006": "Medic Inspector", "007": "Medic Inspector", "008": "Medic Inspector", "009": "Medic Chirurg", "010": "Medic Chirurg", "011": "Medic Chirurg", "012": "Medic Chirurg" };
  name.textContent = `${displayName} · ${callsign} · ${roleLabels[role] ? `${role} — ${roleLabels[role]}` : "Membru"}${isHr ? " · Șef HR" : ""}`;
  const id = document.createElement("div");
  id.className = "member-id";
  id.textContent = discordId;
  left.append(name, id);

  const controls = document.createElement("div");
  controls.style.display = "flex";
  controls.style.gap = "6px";
  const isChief = currentUser.isHr || currentUser.isAdmin;
  const roleSelect = document.createElement("select");
  roleSelect.className = "role-select";
  const roles = ["membru", ...Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(3, "0"))];
  const labels = { "001": "001 — Director General", "002": "002 — Director adjunct", "003": "003 — Director adjunct", "004": "004 — Director adjunct", "005": "005 — Medic Inspector", "006": "006 — Medic Inspector", "007": "007 — Medic Inspector", "008": "008 — Medic Inspector", "009": "009 — Medic Chirurg", "010": "010 — Medic Chirurg", "011": "011 — Medic Chirurg", "012": "012 — Medic Chirurg" };
  for (const r of roles) {
    const option = document.createElement("option");
    option.value = r;
    option.textContent = labels[r] || "Membru";
    option.selected = r === role;
    roleSelect.append(option);
  }
  if (!isChief) {
    for (const option of roleSelect.options) {
      if (["001", "002", "003", "004"].includes(option.value) && option.value !== role) option.disabled = true;
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
  hrCheck.disabled = !isChief;
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
    const [{ users }, { codes }] = await Promise.all([api("/api/admin/access"), api("/api/admin/codes")]);

    const members = document.querySelector("#member-list");
    members.replaceChildren();
    document.querySelector("#members-empty").hidden = users.length > 0;
    for (const member of users) members.append(memberRow(member, user, refresh));

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
      if (!code.usedAt && code.active) {
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
        row.append(left);
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

  if (session.stage === "authorized") {
    const user = session.user;
    currentUser = user;
    const roleTitles = { "001": "Director General", "002": "Director adjunct", "003": "Director adjunct", "004": "Director adjunct", "005": "Medic Inspector", "006": "Medic Inspector", "007": "Medic Inspector", "008": "Medic Inspector", "009": "Medic Chirurg", "010": "Medic Chirurg", "011": "Medic Chirurg", "012": "Medic Chirurg" };
    document.querySelector("#user-identity").textContent = `${user.displayName} · ${user.callsign} · ${roleTitles[user.role] ? `${user.role} — ${roleTitles[user.role]}` : "Membru"}${user.isHr ? " · Șef HR" : ""}`;
    document.querySelector("#settings-open").hidden = !user.isDirector;
    document.querySelector("#bilant-toggle").hidden = !user.isDirector;
    const ledger = await api("/api/ledger");
    renderLedger(ledger);
    if (user.isDirector) {
      document.querySelector("#admin-panel").hidden = false;
      await loadAdminPanel(user);
    }
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get("error") === "oauth") showToast("Autentificarea Discord nu a putut fi finalizată.", true);
  if (params.has("error") || params.has("pending")) history.replaceState({}, "", "/");
}

async function logout() {
  try {
    await api("/api/logout", { method: "POST" });
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
  button.textContent = button.classList.contains("concealed") ? "••" : button.dataset.value;
});

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
    showToast("Cod generat. Dă-i persoanei codul.");
    await loadAdminPanel(currentUser);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
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
