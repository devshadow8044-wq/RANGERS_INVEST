"use strict";
(() => {
  const state = { csrf: "", authenticated: false, member: false, user: null, me: null, countries: [], methods: {} };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const page = document.body.dataset.page || "home";
  const countryNames = { SN: "Sénégal", ML: "Mali", CI: "Côte d’Ivoire", BJ: "Bénin" };
  const labels = {
    pending: "En attente de validation", active: "Compte actif", locked: "Compte bloqué",
    approved: "Validé", rejected: "Refusé", processing: "En cours de traitement", paid: "Payé",
    draft: "Brouillon", published: "Publié", paused: "Suspendu"
  };
  const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const formatMoney = value => value == null || value === "" || !Number.isFinite(Number(value))
    ? "Non disponible"
    : `${new Intl.NumberFormat("fr-FR").format(Number(value))} XOF`;
  const formatDate = value => {
    if (!value) return "Date non disponible";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(date);
  };

  async function request(url, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const headers = { ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };
    if (method !== "GET" && method !== "HEAD") headers["X-CSRF-Token"] = state.csrf;
    let response;
    try { response = await fetch(url, { ...options, method, headers, credentials: "same-origin" }); }
    catch { throw new Error("Le serveur du site est injoignable. Vérifiez que le projet complet a été déployé sur Vercel."); }
    const contentType = response.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");
    const data = isJson ? await response.json() : null;
    if (!response.ok) {
      const message = data?.message || (response.status === 404 && !isJson
        ? "Le serveur API est introuvable (404). Dans Vercel, la racine du projet doit contenir index.js, package.json, vercel.json et server/ — ne choisissez pas public/ comme racine."
        : !isJson ? `Réponse serveur inattendue (HTTP ${response.status}).` : "Une erreur est survenue.");
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function showMessage(target, text, kind = "warning") {
    const element = typeof target === "string" ? $(target) : target;
    if (!element) return;
    element.className = `notice ${kind}`;
    element.textContent = text;
    element.hidden = false;
  }
  function setText(selector, value) {
    $$(selector).forEach(element => { element.textContent = value ?? "Non disponible"; });
  }
  function statusLabel(value) { return labels[value] || value || "Statut indisponible"; }

  function renderAuth() {
    $$("[data-signed-out]").forEach(element => { element.hidden = state.member; });
    $$("[data-signed-in]").forEach(element => { element.hidden = !state.member; });
    const user = state.me?.user || state.user;
    if (user) {
      setText("[data-user-name]", user.username || user.phone || "Compte RANGERS INVEST");
      setText("[data-user-phone]", user.phone || "Téléphone non renseigné");
      setText("[data-user-country]", countryNames[user.country] || user.country || "Pays non renseigné");
      setText("[data-user-status]", statusLabel(user.status));
      setText("[data-account-status]", statusLabel(user.status));
      setText("[data-balance]", formatMoney(state.me?.balanceXof));
      setText("[data-reserved]", formatMoney(state.me?.reservedXof));
      setText("[data-available]", formatMoney(state.me?.availableXof));
      setText("[data-revenue]", formatMoney(state.me?.revenueXof));
      $$('[data-user-level]').forEach(element => {
        element.hidden = !user.level;
        if (user.level) element.textContent = user.level;
      });
    }
    const active = state.member && user?.status === "active";
    $$('[data-form="deposit"] button[type="submit"], [data-form="withdraw"] button[type="submit"]').forEach(button => {
      button.disabled = !active;
    });
    $$('[data-financial-status]').forEach(element => {
      element.hidden = active;
      if (!active) element.textContent = state.member
        ? "Votre compte doit être activé par l’administrateur avant toute demande financière."
        : "Connectez-vous pour continuer.";
    });
  }

  function renderCountrySelects() {
    $$('[data-country]').forEach(select => {
      const previous = select.value;
      select.replaceChildren(...state.countries.map(code => new Option(countryNames[code] || code, code)));
      if (previous && state.countries.includes(previous)) select.value = previous;
    });
  }

  function fillPaymentMethods() {
    $$('[data-payment-methods]').forEach(select => {
      const methods = state.member && state.me?.user?.country ? (state.methods[state.me.user.country] || []) : [];
      const options = methods.length
        ? [new Option("Choisir une méthode", ""), ...methods.map(method => new Option(method, method))]
        : [new Option(state.member ? "Aucune méthode disponible pour ce pays" : "Connectez-vous pour afficher les méthodes", "")];
      select.replaceChildren(...options);
    });
  }

  async function renderProducts() {
    const container = $("[data-products]");
    if (!container) return;
    try {
      const result = await request("/api/products");
      const products = result?.products || [];
      if (!products.length) {
        container.innerHTML = '<div class="empty"><strong>Aucune offre publiée</strong>Les offres paraîtront ici après validation de leurs conditions.</div>';
        return;
      }
      container.innerHTML = products.map(product => {
        const terms = [
          product.minXof != null && product.maxXof != null ? `${formatMoney(product.minXof)} à ${formatMoney(product.maxXof)}` : "",
          product.durationDays ? `Durée : ${product.durationDays} jours` : "",
          product.returnMethod ? `Modalités : ${product.returnMethod}` : "",
          product.feesDescription ? `Frais : ${product.feesDescription}` : "",
          product.withdrawalTerms ? `Retrait : ${product.withdrawalTerms}` : ""
        ].filter(Boolean);
        return `<article class="product-card"><div class="product-body"><h2>${escapeHtml(product.name || "Produit")}</h2><p class="subtle">${escapeHtml(product.description || "")}</p>${terms.map(term => `<p class="row-meta">${escapeHtml(term)}</p>`).join("")}<p class="notice warning">${escapeHtml(product.riskDisclosure || "Consultez les risques et conditions avant toute décision.")}</p></div></article>`;
      }).join("");
    } catch (error) { showMessage("[data-global-message]", error.message, "error"); }
  }

  async function renderTeam() {
    const container = $("[data-team]");
    if (!container || !state.member) return;
    try {
      const data = await request("/api/team");
      const referrals = Array.isArray(data?.referrals) ? data.referrals : [];
      const members = referrals.length
        ? `<ul class="list">${referrals.map(member => `<li><strong>${escapeHtml(member.phone || "Membre")}</strong><div class="row-meta">${escapeHtml(countryNames[member.country] || member.country || "")} · ${escapeHtml(statusLabel(member.status))}</div></li>`).join("")}</ul>`
        : '<div class="empty">Aucun membre associé pour le moment.</div>';
      container.innerHTML = `
        <section class="team-card lv1"><h2>Niveau 1</h2><p>Première ligne de votre réseau. Conditions de commission non définies.</p></section>
        <section class="team-card lv2"><h2>Niveau 2</h2><p>Deuxième ligne de votre réseau. Conditions de commission non définies.</p></section>
        <section class="team-card lv3"><h2>Niveau 3</h2><p>Troisième ligne de votre réseau. Conditions de commission non définies.</p></section>
        <article class="card"><h2 class="section-heading">Code d’invitation</h2>${data?.inviteCode ? `<div class="codebox">${escapeHtml(data.inviteCode)}</div>` : '<p class="subtle">Code indisponible.</p>'}<p class="subtle">Membres associés : ${escapeHtml(data?.count ?? referrals.length)}</p></article>
        <article class="card"><h2 class="section-heading">Membres de votre équipe</h2>${members}</article>`;
    } catch (error) { showMessage("[data-global-message]", error.message, "error"); }
  }

  async function renderHistory() {
    const container = $("[data-history]");
    if (!container || !state.member) return;
    try {
      const data = await request("/api/history");
      const items = Array.isArray(data?.items) ? data.items : [];
      container.innerHTML = items.length ? items.map(item => `
        <div class="history-row"><div><div class="row-label">${escapeHtml(item.type || "Opération")} · ${escapeHtml(item.provider || "")}</div>
        <div class="row-meta">${escapeHtml(formatDate(item.createdAt))}${item.reference ? ` · ${escapeHtml(item.reference)}` : ""}</div></div>
        <div class="history-amount"><strong class="price">${escapeHtml(formatMoney(item.amountXof))}</strong><span class="badge">${escapeHtml(statusLabel(item.status))}</span></div></div>`).join("")
        : '<div class="empty"><strong>Aucune opération à afficher</strong>Votre historique apparaîtra ici après une demande.</div>';
    } catch (error) { showMessage("[data-global-message]", error.message, "error"); }
  }

  const overviewLabels = {
    totalUsers: "Comptes au total", pendingUsers: "Comptes en attente",
    activeUsers: "Comptes actifs", pendingDeposits: "Dépôts en attente",
    pendingWithdrawals: "Retraits en attente"
  };
  let adminProducts = [];
  function adminCard(title, item, actionMarkup = "") {
    const id = escapeHtml(item.id);
    const details = [item.phone, countryNames[item.country] || item.country, item.provider,
      item.reference ? `Réf. ${item.reference}` : "", item.recipientPhone ? `Destinataire ${item.recipientPhone}` : ""]
      .filter(Boolean).map(escapeHtml).join(" · ");
    return `<article class="card admin-record"><div class="row"><div><div class="row-label">${escapeHtml(item.phone || item.username || item.reference || title)}</div><div class="row-meta">${escapeHtml(statusLabel(item.status))} · ${escapeHtml(formatDate(item.createdAt))}</div></div>${item.amountXof != null ? `<strong class="price">${escapeHtml(formatMoney(item.amountXof))}</strong>` : ""}</div>${details ? `<p class="row-meta">${details}</p>` : ""}${actionMarkup}</article>`;
  }

  async function renderAdmin() {
    const container = $("[data-admin-content]");
    if (!container) return;
    if (!state.authenticated || state.user?.role !== "admin") {
      container.innerHTML = '<div class="empty"><strong>Accès administrateur requis</strong>Connectez-vous avec le compte administrateur.</div>';
      return;
    }
    const productForm = $('[data-form="product"]');
    const productPanel = $("[data-admin-products]");
    if (productForm) productForm.hidden = false;
    if (productPanel) productPanel.hidden = false;
    try {
      const [overview, usersResult, depositsResult, withdrawalsResult, auditResult, productsResult] = await Promise.all(
        ["overview", "users", "deposits", "withdrawals", "audit", "products"].map(name => request(`/api/admin/${name}`))
      );
      const users = usersResult?.users || [];
      const deposits = depositsResult?.deposits || [];
      const withdrawals = withdrawalsResult?.withdrawals || [];
      const auditRows = auditResult?.audit || [];
      adminProducts = productsResult?.products || [];
      const productCards = adminProducts.length ? adminProducts.map(product => `<article class="card admin-record"><div class="row"><div><div class="row-label">${escapeHtml(product.name)}</div><div class="row-meta">${escapeHtml(statusLabel(product.status))}${product.minXof ? ` · ${escapeHtml(formatMoney(product.minXof))} à ${escapeHtml(formatMoney(product.maxXof))}` : ""}</div></div><button class="button light" type="button" data-edit-product="${escapeHtml(product.id)}">Modifier</button></div></article>`).join("") : '<article class="card empty">Aucun produit enregistré.</article>';
      const userCards = users.length ? users.map(user => adminCard("Compte", user, `
        <div class="admin-actions"><button class="button" data-admin-status="active" data-id="${escapeHtml(user.id)}">Activer</button>
        <button class="button light" data-admin-status="pending" data-id="${escapeHtml(user.id)}">En attente</button>
        <button class="button danger" data-admin-status="locked" data-id="${escapeHtml(user.id)}">Bloquer</button></div>`)).join("") : '<div class="card empty">Aucun compte à afficher.</div>';
      const depositCards = deposits.length ? deposits.map(item => {
        if (item.status !== "pending") return adminCard("Dépôt", item);
        const id = escapeHtml(item.id);
        return adminCard("Dépôt", item, `<label class="field admin-note">Note de vérification (preuve ou référence confirmée)<input data-note="${id}" maxlength="500" required></label><div class="admin-actions"><button class="button" data-review="deposit" data-action="approve" data-id="${id}">Valider après vérification</button><button class="button light" data-review="deposit" data-action="reject" data-id="${id}">Refuser</button></div>`);
      }).join("") : '<div class="card empty">Aucune demande de dépôt.</div>';
      const withdrawalCards = withdrawals.length ? withdrawals.map(item => {
        if (!["pending", "processing"].includes(item.status)) return adminCard("Retrait", item);
        const id = escapeHtml(item.id);
        const actions = item.status === "pending"
          ? `<label class="field admin-note">Note de traitement<input data-note="${id}" maxlength="500"></label><div class="admin-actions"><button class="button light" data-review="withdrawal" data-action="processing" data-id="${id}">Marquer en traitement</button><button class="button danger" data-review="withdrawal" data-action="reject" data-id="${id}">Refuser</button></div>`
          : `<label class="field admin-note">Référence de paiement exécuté<input data-reference="${id}" maxlength="160" required></label><label class="field admin-note">Note de traitement<input data-note="${id}" maxlength="500"></label><div class="admin-actions"><button class="button" data-review="withdrawal" data-action="paid" data-id="${id}">Confirmer le paiement réel</button><button class="button danger" data-review="withdrawal" data-action="reject" data-id="${id}">Refuser</button></div>`;
        return adminCard("Retrait", item, actions);
      }).join("") : '<div class="card empty">Aucune demande de retrait.</div>';
      container.innerHTML = `
        <h2 class="section-heading">Produits enregistrés</h2>${productCards}
        <h2 class="section-heading">Vue d’ensemble</h2><div class="metric-grid">${Object.entries(overviewLabels).map(([key, label]) => `<article class="metric-card"><span>${label}</span><strong>${escapeHtml(overview?.[key] ?? "—")}</strong></article>`).join("")}</div>
        <h2 class="section-heading">Comptes</h2>${userCards}
        <h2 class="section-heading">Dépôts à examiner</h2>${depositCards}
        <h2 class="section-heading">Retraits à examiner</h2>${withdrawalCards}
        <h2 class="section-heading">Journal d’audit</h2><article class="card">${auditRows.length ? auditRows.map(row => `<div class="row"><span>${escapeHtml(row.action || "Événement")}</span><span class="row-meta">${escapeHtml(formatDate(row.createdAt))}</span></div>`).join("") : '<div class="empty">Aucune entrée à afficher.</div>'}</article>`;
    } catch (error) { showMessage("[data-global-message]", error.message, "error"); }
  }

  function formFields(form, names) {
    const values = {};
    names.forEach(name => {
      const input = $(`[name="${name}"]`, form);
      if (input) values[name] = input.type === "checkbox" ? input.checked : input.value.trim();
    });
    return values;
  }
  function bindForm(form, handler) {
    form.addEventListener("submit", async event => {
      event.preventDefault();
      const submit = $("button[type=submit]", form);
      if (submit) submit.disabled = true;
      try { await handler(form); }
      catch (error) { showMessage($("[data-message]", form) || "[data-global-message]", error.message, "error"); }
      finally {
        if (submit && !(form.matches('[data-form="deposit"], [data-form="withdraw"]') && state.me?.user?.status !== "active")) submit.disabled = false;
      }
    });
  }

  $$('[data-form="register"]').forEach(form => bindForm(form, async current => {
    const body = formFields(current, ["country", "phone", "password", "inviteCode"]);
    body.acknowledged = $("[name=acknowledged]", current)?.checked === true;
    if (body.password.length < 12) throw new Error("Le mot de passe doit contenir au moins 12 caractères.");
    if (body.password !== $("[name=confirmPassword]", current)?.value) throw new Error("Les mots de passe ne correspondent pas.");
    if (!body.acknowledged) throw new Error("Veuillez confirmer la vérification du compte.");
    await request("/api/auth/register", { method: "POST", body: JSON.stringify(body) });
    showMessage($("[data-message]", current), "Inscription reçue. Votre compte est en attente de validation.", "success");
    current.reset();
  }));
  $$('[data-form="login"]').forEach(form => bindForm(form, async current => {
    await request("/api/auth/login", { method: "POST", body: JSON.stringify(formFields(current, ["country", "phone", "password"])) });
    location.href = "/index.html";
  }));
  $$('[data-form="admin-login"]').forEach(form => bindForm(form, async current => {
    await request("/api/auth/admin-login", { method: "POST", body: JSON.stringify(formFields(current, ["username", "password"])) });
    location.href = "/admin.html";
  }));
  $$('[data-form="deposit"]').forEach(form => bindForm(form, async current => {
    if (state.me?.user?.status !== "active") throw new Error("Un compte actif est nécessaire.");
    const body = formFields(current, ["amountXof", "provider", "reference"]);
    body.amountXof = Number(body.amountXof);
    await request("/api/deposits", { method: "POST", body: JSON.stringify(body) });
    showMessage($("[data-message]", current), "Demande enregistrée pour vérification. Le solde n’est pas crédité avant validation.", "success");
    current.reset();
  }));
  $$('[data-form="withdraw"]').forEach(form => bindForm(form, async current => {
    if (state.me?.user?.status !== "active") throw new Error("Un compte actif est nécessaire.");
    const body = formFields(current, ["amountXof", "provider", "recipientPhone"]);
    body.amountXof = Number(body.amountXof);
    body.idempotencyKey = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await request("/api/withdrawals", { method: "POST", body: JSON.stringify(body) });
    showMessage($("[data-message]", current), "Demande enregistrée. Son traitement réel reste à confirmer.", "success");
    current.reset();
  }));
  $$('[data-form="change-password"]').forEach(form => bindForm(form, async current => {
    const body = formFields(current, ["currentPassword", "newPassword"]);
    if (body.newPassword !== $("[name=confirmPassword]", current)?.value) throw new Error("Les nouveaux mots de passe ne correspondent pas.");
    if (body.newPassword.length < 12) throw new Error("Le mot de passe doit contenir au moins 12 caractères.");
    await request("/api/auth/change-password", { method: "POST", body: JSON.stringify(body) });
    showMessage($("[data-message]", current), "Mot de passe modifié. Veuillez vous reconnecter.", "success");
    current.reset();
  }));
  $$('[data-form="product"]').forEach(form => bindForm(form, async current => {
    const body = formFields(current, ["id", "name", "description", "minXof", "maxXof", "durationDays", "feesDescription", "withdrawalTerms", "riskDisclosure", "returnMethod", "legalApprovalReference", "imageUrl", "status"]);
    const id = body.id;
    delete body.id;
    ["minXof", "maxXof", "durationDays"].forEach(key => { body[key] = body[key] === "" ? null : Number(body[key]); });
    if (body.status === "published" && !window.confirm("Publier cette offre la rendra visible aux utilisateurs. Confirmez-vous que ses conditions et sa référence de validation ont été vérifiées ?")) return;
    const result = id
      ? await request(`/api/admin/products/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body) })
      : await request("/api/admin/products", { method: "POST", body: JSON.stringify(body) });
    showMessage("[data-global-message]", result.message || "Produit enregistré.", "success");
    current.reset();
    await renderAdmin();
  }));

  $$('[data-logout]').forEach(button => button.addEventListener("click", async () => {
    try {
      await request("/api/auth/logout", { method: "POST", body: "{}" });
      location.href = state.user?.role === "admin" ? "/admin-login.html" : "/login.html";
    } catch (error) { showMessage("[data-global-message]", error.message, "error"); }
  }));

  document.addEventListener("click", async event => {
    const statusButton = event.target.closest("[data-admin-status]");
    if (statusButton) {
      statusButton.disabled = true;
      try {
        await request(`/api/admin/users/${encodeURIComponent(statusButton.dataset.id)}/status`, {
          method: "POST", body: JSON.stringify({ status: statusButton.dataset.adminStatus })
        });
        await renderAdmin();
      } catch (error) { showMessage("[data-global-message]", error.message, "error"); statusButton.disabled = false; }
      return;
    }
    const editProductButton = event.target.closest("[data-edit-product]");
    if (editProductButton) {
      const product = adminProducts.find(item => item.id === editProductButton.dataset.editProduct);
      const form = $('[data-form="product"]');
      if (!product || !form) return;
      Object.entries(product).forEach(([key, value]) => {
        const field = form.elements.namedItem(key);
        if (field && "value" in field) field.value = value ?? "";
      });
      form.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (event.target.closest("[data-reset-product]") ) {
      const form = $('[data-form="product"]');
      if (form) form.reset();
      return;
    }
    const reviewButton = event.target.closest("[data-review]");
    if (!reviewButton) return;
    const id = reviewButton.dataset.id;
    const kind = reviewButton.dataset.review;
    const action = reviewButton.dataset.action;
    const note = $(`[data-note="${CSS.escape(id)}"]`)?.value?.trim() || "";
    const body = { action, note };
    if (kind === "deposit" && !note) return showMessage("[data-global-message]", "Ajoutez la preuve ou la raison de la décision.", "error");
    if (kind === "withdrawal" && action === "reject" && !note) return showMessage("[data-global-message]", "Ajoutez la raison du refus.", "error");
    if (kind === "withdrawal" && action === "paid") {
      body.reference = $(`[data-reference="${CSS.escape(id)}"]`)?.value?.trim() || "";
      if (body.reference.length < 3) return showMessage("[data-global-message]", "Saisissez la référence du paiement réellement exécuté.", "error");
    }
    reviewButton.disabled = true;
    try {
      await request(`/api/admin/${kind === "deposit" ? "deposits" : "withdrawals"}/${encodeURIComponent(id)}/review`, {
        method: "POST", body: JSON.stringify(body)
      });
      await renderAdmin();
    } catch (error) { showMessage("[data-global-message]", error.message, "error"); reviewButton.disabled = false; }
  });

  async function initialize() {
    const bootstrap = await request("/api/bootstrap");
    state.csrf = bootstrap?.csrfToken || "";
    state.authenticated = Boolean(bootstrap?.authenticated);
    state.user = bootstrap?.user || null;
    state.member = state.authenticated && state.user?.role === "user";
    state.countries = bootstrap?.countries || ["SN", "ML", "CI", "BJ"];
    state.methods = bootstrap?.paymentMethods || {};
    renderCountrySelects();
    if (bootstrap?.authEnabled === false) {
      $$('[data-form="login"], [data-form="register"], [data-form="admin-login"]').forEach(form => { form.hidden = true; });
      $$('[data-auth-unavailable]').forEach(message => { message.hidden = false; });
    }
    if (state.member) state.me = await request("/api/me");
    else if (state.authenticated && state.user?.role === "admin") state.me = { user: state.user };
    renderAuth();
    fillPaymentMethods();
    if (page === "products") await renderProducts();
    if (page === "team") await renderTeam();
    if (page === "history") await renderHistory();
    if (page === "admin") await renderAdmin();
  }
  initialize().catch(error => showMessage("[data-global-message]", error.message || "Impossible de contacter le service.", "error"));
})();
