const currency = new Intl.NumberFormat("ro-RO", { style: "currency", currency: "RON" });
let toastTimeout;

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
  document.querySelector("#balance-amount").textContent = currency.format(ledger.balanceCents / 100);
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
    amount.textContent = `${isDeposit ? "+" : "−"}${currency.format(tx.amountCents / 100)}`;
    row.append(details, amount);
    list.append(row);
  }
}

function renderBilant(bilant) {
  document.querySelector("#bilant-dep").textContent = currency.format(bilant.totalDepositsCents / 100);
  document.querySelector("#bilant-wd").textContent = currency.format(bilant.totalWithdrawalsCents / 100);
  document.querySelector("#bilant-profit").textContent = currency.format(bilant.profitCents / 100);
}

function memberRow({ discordId, displayName, callsign, role }, currentUser, onChanged) {
  const row = document.createElement("div");
  row.className = "member-row";
  const left = document.createElement("div");
  const name = document.createElement("div");
  name.textContent = `${displayName} · ${callsign} (${role})`;
  const id = document.createElement("div");
  id.className = "member-id";
  id.textContent = discordId;
  left.append(name, id);

  const controls = document.createElement("div");
  controls.style.display = "flex";
  controls.style.gap = "6px";
  const roleSelect = document.createElement("select");
  roleSelect.className = "role-select";
  for (const r of ["membru", "006", "005", "004", "003", "002", "001", "007"]) {
    const option = document.createElement("option");
    option.value = r;
    option.textContent = r === "membru" ? "Membru" : r;
    option.selected = r === role;
    roleSelect.append(option);
  }
  // doar 007 poate acorda roluri de director
  const isChief = currentUser.role === "007" || currentUser.isAdmin;
  if (!isChief) {
    for (const option of roleSelect.options) {
      if (["001", "002", "003", "004", "007"].includes(option.value) && option.value !== role) option.disabled = true;
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
  controls.append(roleSelect, removeButton);
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
    document.querySelector("#user-identity").textContent = `${user.displayName} · ${user.callsign} · ${user.role}`;
    const ledger = await api("/api/ledger");
    renderLedger(ledger);
    if (user.isDirector) {
      document.querySelector("#bilant-box").hidden = false;
      document.querySelector("#admin-panel").hidden = false;
      renderBilant(await api("/api/admin/bilant"));
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
        role: document.querySelector("#code-role").value
      })
    });
    event.currentTarget.reset();
    document.querySelector("#code-result").hidden = false;
    document.querySelector("#code-value").textContent = code.code;
    showToast("Cod generat. Dă-i persoanei codul.");
    loadAdminPanel({ role: document.querySelector("#user-identity").textContent.match(/\b00\d\b/)?.[0] || "membru", isAdmin: true });
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
    event.currentTarget.reset();
    renderLedger(ledger);
    showToast("Soldul a fost actualizat.");
  } catch (error) {
    showToast(error.message, true);
  } finally {
    button.disabled = false;
  }
});

for (const [formId, type, amountId, noteId] of [
  ["deposit-form", "deposit", "deposit-amount", "deposit-note"],
  ["withdrawal-form", "withdrawal", "withdrawal-amount", "withdrawal-note"]
]) {
  document.querySelector(`#${formId}`).addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const ledger = await api("/api/transactions", {
        method: "POST",
        body: JSON.stringify({
          type,
          amount: document.querySelector(`#${amountId}`).value,
          note: document.querySelector(`#${noteId}`).value
        })
      });
      event.currentTarget.reset();
      renderLedger(ledger);
      showToast(type === "deposit" ? "Suma a fost adăugată." : "Suma a fost scoasă.");
    } catch (error) {
      showToast(error.message, true);
    } finally {
      button.disabled = false;
    }
  });
}

loadDashboard().catch((error) => {
  showView("anonymous");
  showToast(error.message, true);
});
