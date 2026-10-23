(() => {
  const API = (window.RANGERS && window.RANGERS.API_URL) || '/api';
  const $ = (s, r = document) => r.querySelector(s);

  const mem = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* stockage bloqué */ } }
  };

  class ApiError extends Error { constructor(m, s) { super(m); this.status = s; } }

  async function api(path, { method = 'GET', body } = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const t = mem.get('rg_token');
    if (t) headers.Authorization = 'Bearer ' + t;
    let res;
    try {
      res = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch {
      throw new ApiError('Serveur injoignable. Vérifie ta connexion puis réessaie.', 0);
    }
    let data = {};
    try { data = await res.json(); } catch { /* réponse vide */ }
    if (!res.ok) throw new ApiError(data.error || 'Une erreur est survenue.', res.status);
    return data;
  }

  const fcfa = (n) => new Intl.NumberFormat('fr-FR').format(n) + ' FCFA';

  let toastTimer;
  function toast(msg) {
    const el = $('#toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  function showError(msg) {
    const box = $('#error');
    if (!box) return;
    box.textContent = msg || '';
    box.classList.toggle('show', !!msg);
  }

  // Pages à venir : le lien reste dans la barre, avec un message
  document.addEventListener('click', (e) => {
    const a = e.target.closest('[data-soon]');
    if (!a) return;
    e.preventDefault();
    toast('Cette page arrive à une prochaine étape.');
  });

  function bindPasswordToggles() {
    document.querySelectorAll('.pw').forEach((box) => {
      const input = $('input', box);
      const btn = $('.toggle', box);
      btn.addEventListener('click', () => {
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        btn.textContent = show ? 'Masquer' : 'Afficher';
        btn.setAttribute('aria-pressed', String(show));
      });
    });
  }

  async function loadCountries() {
    const select = $('#country');
    const prefix = $('#prefix');
    let list;
    try {
      list = await api('/countries');
    } catch (e) {
      showError(e.message);
      select.innerHTML = '<option value="">Indisponible</option>';
      return null;
    }
    select.innerHTML = list.map((c) => `<option value="${c.code}">${c.flag} ${c.name}</option>`).join('');
    const saved = mem.get('rg_country');
    if (saved && list.some((c) => c.code === saved)) select.value = saved;
    const sync = () => {
      const c = list.find((x) => x.code === select.value);
      prefix.textContent = c ? '+' + c.dial : '+';
      mem.set('rg_country', select.value);
    };
    select.addEventListener('change', sync);
    sync();
    return list;
  }

  function validPassword(p) {
    if (p.length < 8) return 'Le mot de passe doit contenir au moins 8 caractères.';
    if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
    return null;
  }

  /* ---------- Inscription ---------- */
  async function pageRegister() {
    bindPasswordToggles();
    const params = new URLSearchParams(location.search);
    const fromLink = (params.get('ref') || '').trim().toUpperCase();
    if (/^[A-Z0-9]{4,12}$/.test(fromLink)) mem.set('rg_ref', fromLink);
    const refInput = $('#ref');
    refInput.value = mem.get('rg_ref') || '';
    refInput.addEventListener('input', () => { refInput.value = refInput.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });

    await loadCountries();

    $('#form').addEventListener('submit', async (e) => {
      e.preventDefault();
      showError('');
      const country = $('#country').value;
      const phone = $('#phone').value.trim();
      const password = $('#password').value;
      const confirm = $('#confirm').value;
      if (!country) return showError('Choisis ton pays.');
      if (!phone) return showError('Entre ton numéro de téléphone.');
      const pe = validPassword(password);
      if (pe) return showError(pe);
      if (password !== confirm) return showError('Les mots de passe ne correspondent pas.');

      const btn = $('#submit');
      btn.disabled = true;
      btn.textContent = 'Création du compte…';
      try {
        const data = await api('/register', { method: 'POST', body: { country, phone, password, confirm, ref: refInput.value.trim() } });
        mem.set('rg_token', data.token);
        mem.set('rg_ref', null);
        location.href = 'index.html';
      } catch (err) {
        showError(err.message);
        btn.disabled = false;
        btn.textContent = 'Créer mon compte';
      }
    });
  }

  /* ---------- Connexion ---------- */
  async function pageLogin() {
    bindPasswordToggles();
    if (mem.get('rg_token')) { location.replace('index.html'); return; }
    await loadCountries();

    $('#form').addEventListener('submit', async (e) => {
      e.preventDefault();
      showError('');
      const country = $('#country').value;
      const phone = $('#phone').value.trim();
      const password = $('#password').value;
      if (!country || !phone || !password) return showError('Entre ton pays, ton numéro et ton mot de passe.');

      const btn = $('#submit');
      btn.disabled = true;
      btn.textContent = 'Connexion…';
      try {
        const data = await api('/login', { method: 'POST', body: { country, phone, password } });
        mem.set('rg_token', data.token);
        location.href = 'index.html';
      } catch (err) {
        showError(err.message);
        btn.disabled = false;
        btn.textContent = 'Se connecter';
      }
    });
  }

  /* ---------- Accueil ---------- */
  async function pageHome() {
    if (!mem.get('rg_token')) { location.replace('login.html'); return; }
    $('#logout').addEventListener('click', () => { mem.set('rg_token', null); location.href = 'login.html'; });
    try {
      const { user } = await api('/me');
      $('#phone').textContent = user.phone;
      const amount = $('#amount');
      amount.textContent = fcfa(user.balance);
      amount.closest('.balance').classList.remove('skeleton');
    } catch (err) {
      if (err.status === 401) { mem.set('rg_token', null); location.replace('login.html'); return; }
      toast(err.message);
    }
  }

  const page = document.body.dataset.page;
  if (page === 'register') pageRegister();
  else if (page === 'login') pageLogin();
  else if (page === 'home') pageHome();
})();
