"use strict";
(() => {
  const form = document.querySelector("#admin-setup-form");
  const message = document.querySelector("#setup-message");
  const button = document.querySelector("#create-admin");
  if (!form || !message || !button) return;

  form.addEventListener("submit", async event => {
    event.preventDefault();
    const data = new FormData(form);
    const password = String(data.get("password") || "");
    const confirmation = String(data.get("passwordConfirm") || "");
    if (password !== confirmation) {
      message.textContent = "Les deux mots de passe ne correspondent pas.";
      message.className = "notice error";
      message.hidden = false;
      return;
    }

    button.disabled = true;
    message.hidden = true;
    try {
      const response = await fetch("/api/setup/admin", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bootstrapToken: String(data.get("bootstrapToken") || ""),
          username: String(data.get("username") || ""),
          password
        })
      });
      const result = await response.json().catch(() => ({}));
      message.textContent = result.message || "La configuration a échoué. Vérifie le domaine HTTPS et les variables Vercel.";
      message.className = response.ok ? "notice success" : "notice error";
      message.hidden = false;
      if (response.ok) {
        form.hidden = true;
        const loginLink = document.createElement("a");
        loginLink.href = "/admin-login.html";
        loginLink.textContent = "Ouvrir la connexion administrateur";
        message.append(document.createElement("br"), loginLink);
      }
    } catch {
      message.textContent = "Impossible de joindre le serveur Vercel. Réessaie lorsque le déploiement et la base sont disponibles.";
      message.className = "notice error";
      message.hidden = false;
    } finally {
      button.disabled = false;
    }
  });
})();
