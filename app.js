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
    const el = e.target.closest('[data-soon]');
    if (!el) return;
    e.preventDefault();
    toast(el.getAttribute('data-soon') || 'Cette page arrive à une prochaine étape.');
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


  async function copy(text, msg) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement('textarea');
      t.value = text; t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy'); } catch { /* ignoré */ }
      t.remove();
    }
    toast(msg);
  }

  function guard() {
    if (!mem.get('rg_token')) { location.replace('login.html'); return false; }
    return true;
  }
  function onAuthError(err) {
    if (err.status === 401) { mem.set('rg_token', null); location.replace('login.html'); return true; }
    return false;
  }

  /* ---------- Équipe ---------- */
  async function pageTeam() {
    if (!guard()) return;
    try {
      const t = await api('/team');
      const link = location.origin + '/register.html?ref=' + t.referral_code;
      $('#code').textContent = t.referral_code;
      $('#link').value = link;
      (t.levels || [t.invited || 0, 0, 0]).forEach((n, i) => { const el = $('#lv' + (i + 1)); if (el) el.textContent = n; });
      $('#copy-code').addEventListener('click', () => copy(t.referral_code, 'Code copié'));
      $('#copy-link').addEventListener('click', () => copy(link, 'Lien copié'));
      $('#wa').href = 'https://wa.me/?text=' + encodeURIComponent('Rejoins-moi sur RANGERS : ' + link);
    } catch (err) {
      if (!onAuthError(err)) toast(err.message);
    }
  }

  /* ---------- Compte ---------- */
  async function pageAccount() {
    if (!guard()) return;
    bindPasswordToggles();
    const sup = $('#support');
    const supUrl = (window.RANGERS && window.RANGERS.SUPPORT_URL) || '';
    if (sup && /^https:\/\//.test(supUrl)) { sup.href = supUrl; sup.target = '_blank'; sup.rel = 'noopener'; sup.removeAttribute('data-soon'); }
    $('#logout').addEventListener('click', () => { mem.set('rg_token', null); location.href = 'login.html'; });
    try {
      const { user } = await api('/me');
      $('#phone').textContent = user.phone;
      const d = new Date(String(user.created_at).replace(' ', 'T') + 'Z');
      $('#since').textContent = isNaN(d) ? '–' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    } catch (err) {
      if (!onAuthError(err)) toast(err.message);
    }

    $('#form').addEventListener('submit', async (e) => {
      e.preventDefault();
      showError('');
      const current = $('#current').value;
      const password = $('#password').value;
      const confirm = $('#confirm').value;
      if (!current) return showError('Entre ton mot de passe actuel.');
      const pe = validPassword(password);
      if (pe) return showError(pe);
      if (password !== confirm) return showError('Les mots de passe ne correspondent pas.');
      const btn = $('#submit');
      btn.disabled = true;
      btn.textContent = 'Modification…';
      try {
        const data = await api('/change-password', { method: 'POST', body: { current, password, confirm } });
        mem.set('rg_token', data.token);
        $('#form').reset();
        toast('Mot de passe modifié');
      } catch (err) {
        if (!onAuthError(err)) showError(err.message);
      }
      btn.disabled = false;
      btn.textContent = 'Changer le mot de passe';
    });
  }

  // Fond vidéo : coupé si l'économie de données ou la réduction des animations est activée,
  // ou si le fichier est absent (le fond sombre reste).
  (function setupVideo() {
    const v = document.querySelector('.bg video');
    if (!v) return;
    const saveData = navigator.connection && navigator.connection.saveData;
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const drop = () => v.remove();
    if (saveData || reduce) return drop();
    v.addEventListener('error', drop, true);
    v.querySelector('source').addEventListener('error', drop);
    v.play && v.play().catch(() => {});
  })();


  /* ---------- Ambiance : vidéo en arrière-plan ---------- */
  const ICON_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M15.5 8.5a5 5 0 010 7"/><path d="M18.5 5.5a9 9 0 010 13"/></svg>';
  const ICON_OFF = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5L6 9H3v6h3l5 4V5z"/><path d="M22 9l-6 6"/><path d="M16 9l6 6"/></svg>';

  function addSoundButton(v) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'sound';
    const render = () => {
      btn.innerHTML = v.muted ? ICON_OFF : ICON_ON;
      btn.setAttribute('aria-pressed', String(!v.muted));
      btn.setAttribute('aria-label', v.muted ? 'Activer le son' : 'Couper le son');
    };
    // Si le membre avait activé le son, on le remet à son premier toucher (le navigateur l'exige)
    const resume = (e) => {
      if (e.target.closest && e.target.closest('.sound')) return;
      removeEventListener('pointerdown', resume);
      v.muted = false;
      v.play().catch(() => {});
      render();
    };
    btn.addEventListener('click', () => {
      removeEventListener('pointerdown', resume);
      v.muted = !v.muted;
      if (!v.muted) v.play().catch(() => {});
      mem.set('rg_sound', v.muted ? 'off' : 'on');
      render();
    });
    if (mem.get('rg_sound') === 'on') addEventListener('pointerdown', resume);
    render();
    document.body.appendChild(btn);
  }

  function buildAmbience(bg) {
    bg.insertAdjacentHTML('beforeend', '<i class="glow g1"></i><i class="glow g2"></i>');
    const box = document.createElement('div');
    box.className = 'trails';
    const n = innerWidth < 600 ? 9 : 16;
    const kinds = ['gold', 'gold', 'white', 'blue'];
    const r = (lo, hi) => lo + Math.random() * (hi - lo);
    for (let i = 0; i < n; i++) {
      const t = document.createElement('i');
      t.className = 'trail ' + kinds[i % kinds.length] + (Math.random() < 0.4 ? ' rev' : '');
      t.style.top = r(6, 94).toFixed(1) + '%';
      t.style.width = r(80, 240).toFixed(0) + 'px';
      t.style.height = (Math.random() < 0.25 ? 3 : 2) + 'px';
      t.style.opacity = r(0.25, 0.7).toFixed(2);
      t.style.animationDuration = r(7, 16).toFixed(1) + 's';
      t.style.animationDelay = '-' + r(0, 16).toFixed(1) + 's';
      box.appendChild(t);
    }
    bg.appendChild(box);
  }

  function initBackground() {
    const key = { register: 'register', login: 'login', home: 'inside', team: 'inside', account: 'inside' }[document.body.dataset.page];
    const bg = document.createElement('div');
    bg.className = 'bg';
    bg.setAttribute('aria-hidden', 'true');
    document.body.prepend(bg);
    buildAmbience(bg);

    const cfg = window.RANGERS || {};
    const src = (cfg.VIDEOS || {})[key];
    const conn = navigator.connection;
    const economy = (conn && conn.saveData) || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (cfg.USE_VIDEOS !== true || !src || economy) return;

    const v = document.createElement('video');
    v.className = 'bgvideo';
    v.src = src;
    v.muted = true;
    v.defaultMuted = true;
    v.loop = true;
    v.autoplay = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.setAttribute('playsinline', '');
    v.setAttribute('muted', '');
    // La vidéo n'est affichée que si une vraie image est dessinée
    const reveal = () => { if (v.videoWidth > 0) { v.classList.add('on'); bg.classList.add('has-video'); } };
    if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback(reveal);
    else v.addEventListener('playing', () => setTimeout(reveal, 400));
    v.addEventListener('error', () => v.remove());
    bg.appendChild(v);
    v.play().catch(() => {});
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) v.pause(); else v.play().catch(() => {});
    });
    if (key === 'inside') addSoundButton(v); // inscription et connexion : jamais de son
  }


  /* ---------- Historique ---------- */
  const TX_LABELS = { deposit: 'Dépôt', withdrawal: 'Retrait', fee: 'Frais', adjustment: 'Ajustement' };
  function txLabel(t) {
    if (t.type === 'reward') {
      if ((t.ref || '').startsWith('checkin:')) return 'Pointage';
      if ((t.ref || '').startsWith('wheel:')) return 'Roue de la chance';
      return 'Récompense';
    }
    return TX_LABELS[t.type] || 'Opération';
  }
  const EMPTY_MSG = {
    all: 'Aucune opération pour l’instant.',
    deposit: 'Aucun dépôt pour l’instant.',
    withdrawal: 'Aucun retrait pour l’instant.',
    checkin: 'Aucun pointage reçu pour l’instant.',
    wheel: 'Aucun gain de roue reçu pour l’instant.'
  };

  async function pageHistory() {
    if (!guard()) return;
    const list = $('#list');
    const empty = $('#empty');
    const chips = [...document.querySelectorAll('.chip')];

    async function load(filter) {
      chips.forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.f === filter)));
      list.innerHTML = '';
      empty.hidden = true;
      try {
        const { items } = await api('/history?filter=' + encodeURIComponent(filter));
        if (!items.length) { empty.textContent = EMPTY_MSG[filter]; empty.hidden = false; return; }
        items.forEach((t) => {
          const row = document.createElement('div');
          row.className = 'tx';
          const left = document.createElement('div');
          const title = document.createElement('div');
          title.className = 't';
          title.textContent = txLabel(t);
          const date = document.createElement('div');
          date.className = 'd';
          const d = new Date(String(t.created_at).replace(' ', 'T') + 'Z');
          date.textContent = isNaN(d) ? '' : d.toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
          left.append(title, date);
          const amt = document.createElement('div');
          amt.className = 'a ' + (t.amount > 0 ? 'pos' : 'neg');
          amt.textContent = (t.amount > 0 ? '+ ' : '− ') + fcfa(Math.abs(t.amount));
          row.append(left, amt);
          list.appendChild(row);
        });
      } catch (err) {
        if (!onAuthError(err)) toast(err.message);
      }
    }
    chips.forEach((c) => c.addEventListener('click', () => load(c.dataset.f)));
    load('all');
  }

  /* ---------- Avis ---------- */
  async function pageReviews() {
    if (!guard()) return;
    let rating = 0;
    const stars = [...document.querySelectorAll('.stars button')];
    const paint = () => stars.forEach((b) => b.classList.toggle('on', Number(b.dataset.v) <= rating));
    stars.forEach((b) => b.addEventListener('click', () => { rating = Number(b.dataset.v); paint(); }));

    async function load() {
      try {
        const d = await api('/reviews');
        $('#avg').textContent = d.count ? d.average.toFixed(1) + ' / 5' : '–';
        $('#count').textContent = d.count ? d.count + (d.count > 1 ? ' avis de membres' : ' avis de membre') : 'Aucun avis pour l’instant';
        if (d.mine && !$('#comment').value) { rating = d.mine.rating; $('#comment').value = d.mine.comment; paint(); }
        const list = $('#list');
        list.innerHTML = '';
        $('#empty').hidden = d.reviews.length > 0;
        d.reviews.forEach((r) => {
          const box = document.createElement('div');
          box.className = 'rev';
          const s = document.createElement('div');
          s.className = 'stars-s';
          s.textContent = '★'.repeat(r.rating) + '☆'.repeat(5 - r.rating);
          const c = document.createElement('p');
          c.textContent = r.comment;
          const w = document.createElement('div');
          w.className = 'who';
          w.textContent = r.author;
          box.append(s, c, w);
          list.appendChild(box);
        });
      } catch (err) {
        if (!onAuthError(err)) toast(err.message);
      }
    }

    $('#form').addEventListener('submit', async (e) => {
      e.preventDefault();
      showError('');
      const comment = $('#comment').value.trim();
      if (!rating) return showError('Choisis une note de 1 à 5 étoiles.');
      if (comment.length < 5) return showError('Écris un commentaire de 5 caractères minimum.');
      const btn = $('#submit');
      btn.disabled = true;
      try {
        await api('/reviews', { method: 'POST', body: { rating, comment } });
        toast('Merci pour ton avis !');
        await load();
      } catch (err) {
        if (!onAuthError(err)) showError(err.message);
      }
      btn.disabled = false;
    });
    load();
  }


  /* ---------- Logos des moyens de paiement ---------- */
  function fillLogo(el, method) {
    el.className = 'logo ' + (el.dataset.sm ? 'sm ' : '') + method; // carré de couleur si l'image manque
    el.innerHTML = '';
    const src = ((window.RANGERS && window.RANGERS.LOGOS) || {})[method];
    if (!src) return;
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('error', () => img.remove());
    img.src = src;
    el.appendChild(img);
  }

  /* ---------- Dépôt : étape 1 (montant + moyen de paiement) ---------- */
  async function pageDeposit() {
    if (!guard()) return;
    let cfg, me, dial = '';
    try {
      const [c, m, cs] = await Promise.all([api('/deposit-config'), api('/me'), api('/countries')]);
      cfg = c; me = m.user;
      dial = (cs.find((x) => x.code === me.country) || {}).dial || '';
    } catch (err) {
      if (!onAuthError(err)) showError(err.message);
      return;
    }
    const bal = $('#bal');
    bal.textContent = fcfa(me.balance);
    bal.closest('.balance').classList.remove('skeleton');
    $('#prefix').textContent = dial ? '+' + dial : '+';
    $('#range').textContent = 'Min ' + fcfa(cfg.min) + ' · Max ' + fcfa(cfg.max);

    const amountEl = $('#amount');
    const totalEl = $('#total');
    const digits = (v) => Number(String(v).replace(/\D/g, '')) || 0;
    let method = null;

    const presetBtns = cfg.presets.map((v) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'preset';
      b.dataset.v = v;
      b.textContent = new Intl.NumberFormat('fr-FR').format(v);
      b.addEventListener('click', () => { amountEl.value = v; sync(); });
      $('#presets').appendChild(b);
      return b;
    });
    function sync() {
      const n = digits(amountEl.value);
      amountEl.value = n ? new Intl.NumberFormat('fr-FR').format(n) : '';
      totalEl.textContent = fcfa(n);
      presetBtns.forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === n));
    }
    amountEl.addEventListener('input', sync);

    const mbox = $('#methods');
    if (!cfg.methods.length) {
      showError('Les dépôts ne sont pas encore ouverts. Réessaie bientôt.');
      $('#submit').disabled = true;
    }
    const mbtns = cfg.methods.map((m) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'method';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', 'false');
      b.innerHTML = '<span class="logo ' + m.id + '"></span><span class="mtxt"><b></b><small>Touche pour choisir ce moyen de paiement</small></span><span class="radio"></span>';
      $('b', b).textContent = m.label;
      fillLogo($('.logo', b), m.id);
      b.addEventListener('click', () => {
        method = m.id;
        mbtns.forEach((x) => x.setAttribute('aria-checked', String(x === b)));
      });
      mbox.appendChild(b);
      return b;
    });
    if (mbtns.length === 1) mbtns[0].click();

    $('#submit').addEventListener('click', async () => {
      showError('');
      const amount = digits(amountEl.value);
      const payer = $('#payer').value.trim();
      if (amount < cfg.min || amount > cfg.max) return showError('Le montant doit être entre ' + fcfa(cfg.min) + ' et ' + fcfa(cfg.max) + '.');
      if (!method) return showError('Choisis un moyen de paiement.');
      if (!payer) return showError('Entre le numéro avec lequel tu paies.');
      const btn = $('#submit');
      btn.disabled = true;
      btn.textContent = 'Création…';
      try {
        const { deposit } = await api('/deposits', { method: 'POST', body: { amount, method, payer_phone: payer } });
        location.href = 'depot-paiement.html?id=' + deposit.id;
      } catch (err) {
        if (!onAuthError(err)) showError(err.message);
        btn.disabled = false;
        btn.textContent = 'Confirmer';
      }
    });
  }

  /* ---------- Dépôt : étape 2 (instructions, minuteur, identifiant) ---------- */
  const DEP_STATUS = {
    pending: ['En attente de paiement', 'st-wait'],
    submitted: ['Vérification en cours', 'st-sent'],
    confirmed: ['Confirmé', 'st-ok'],
    rejected: ['Refusé', 'st-bad'],
    expired: ['Expiré', 'st-bad']
  };

  async function pageDepositPay() {
    if (!guard()) return;
    const id = new URLSearchParams(location.search).get('id');
    if (!/^\d+$/.test(id || '')) { location.replace('depot.html'); return; }
    let left = 0, tick = null, poll = null, current = null;
    const mmss = (s) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');

    function render(d) {
      current = d;
      const [txt, cls] = DEP_STATUS[d.status] || ['…', ''];
      const st = $('#status');
      st.textContent = txt;
      st.className = 'status ' + cls;
      $('#total').textContent = fcfa(d.amount);
      $('#mlabel').textContent = d.method_label;
      fillLogo($('#plogo'), d.method);
      $('#acclabel').textContent = d.method_label + ' · compte';
      $('#ref').textContent = d.reference;
      $('#payer').textContent = d.payer_phone;
      $('#paid').textContent = fcfa(d.confirmed_amount);

      const open = d.status === 'pending' || d.status === 'submitted';
      $('#step-pay').hidden = !open;
      if (d.pay_to) {
        $('#accnum').textContent = d.pay_to.number;
        $('#accname').textContent = d.pay_to.name || '–';
        $('#copy-num').onclick = () => copy(d.pay_to.number, 'Numéro copié');
        $('#copy-name').onclick = () => copy(d.pay_to.name || '', 'Nom copié');
      }
      $('#step-tx').hidden = !open;
      $('#txform').hidden = d.status !== 'pending';
      $('#txsent').hidden = d.status !== 'submitted';
      if (d.tx_id) $('#txval').textContent = d.tx_id + ' — ton paiement est en cours de vérification.';

      const fin = $('#final');
      const again = $('#again');
      fin.hidden = true; again.hidden = true;
      if (d.status === 'confirmed') { fin.textContent = 'Dépôt confirmé : ' + fcfa(d.amount) + ' ajoutés à ton solde.'; fin.hidden = false; }
      if (d.status === 'rejected') { fin.textContent = 'Ce dépôt a été refusé. Si tu as bien payé, contacte le service client avec la référence ' + d.reference + '.'; fin.hidden = false; again.hidden = false; }
      if (d.status === 'expired') { fin.textContent = 'Ce dépôt a expiré. Si tu as déjà payé, contacte le service client avec la référence ' + d.reference + '.'; fin.hidden = false; again.hidden = false; }

      clearInterval(tick);
      $('#timerline').hidden = d.status !== 'pending';
      if (d.status === 'pending') {
        left = d.seconds_left;
        $('#timer').textContent = mmss(left);
        tick = setInterval(() => {
          left = Math.max(0, left - 1);
          $('#timer').textContent = mmss(left);
          if (left === 0) { clearInterval(tick); load(); }
        }, 1000);
      }
    }

    async function load(manual) {
      try {
        const { deposit } = await api('/deposits/' + id);
        render(deposit);
        if (manual) toast('Statut actualisé');
      } catch (err) {
        if (onAuthError(err)) return;
        if (err.status === 404) { location.replace('depot.html'); return; }
        toast(err.message);
      }
    }

    $('#refresh').addEventListener('click', () => load(true));
    $('#tx').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/[^A-Za-z0-9_-]/g, ''); });
    $('#txform').addEventListener('submit', async (e) => {
      e.preventDefault();
      showError('');
      const tx = $('#tx').value.trim();
      if (tx.length < 6) return showError('Entre l’identifiant de transaction (6 caractères minimum).');
      const btn = $('#txsubmit');
      btn.disabled = true;
      try {
        const { deposit } = await api('/deposits/' + id + '/transaction', { method: 'POST', body: { tx_id: tx } });
        render(deposit);
        toast('Identifiant envoyé');
      } catch (err) {
        if (!onAuthError(err)) showError(err.message);
      }
      btn.disabled = false;
    });

    await load();
    poll = setInterval(() => { if (!document.hidden && current && (current.status === 'pending' || current.status === 'submitted')) load(); }, 30000);
  }

  /* ---------- Images (bannières) ---------- */
  function addBanner() {
    const page = document.body.dataset.page;
    const src = ((window.RANGERS && window.RANGERS.IMAGES) || {})[page];
    if (!src) return;
    const fig = document.createElement('figure');
    fig.className = 'banner';
    const img = new Image();
    img.alt = '';
    img.decoding = 'async';
    img.referrerPolicy = 'no-referrer';
    img.addEventListener('load', () => img.classList.add('on'));
    img.addEventListener('error', () => { img.remove(); fig.classList.add('fallback'); }); // lien cassé : fond décoratif
    img.src = src;
    fig.appendChild(img);

    if (page === 'register' || page === 'login') {
      const brand = document.querySelector('.hero .brand');
      if (brand) brand.after(fig);
    } else if (page === 'home') {
      const bar = document.querySelector('.topbar');
      if (bar) bar.after(fig);
    } else {
      const title = document.querySelector('h1.page');
      if (title) title.before(fig);
    }
  }

  addBanner();
  initBackground();

  const page = document.body.dataset.page;
  if (page === 'register') pageRegister();
  else if (page === 'login') pageLogin();
  else if (page === 'home') pageHome();
  else if (page === 'team') pageTeam();
  else if (page === 'account') pageAccount();
  else if (page === 'history') pageHistory();
  else if (page === 'reviews') pageReviews();
  else if (page === 'deposit') pageDeposit();
  else if (page === 'deposit-pay') pageDepositPay();
})();
