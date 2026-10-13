// Serveur de la Coopérative Renaissance : sert le site et expose l'API.
const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const db = require('./db');

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const BASE_MEMBRES = Number(process.env.BASE_MEMBRES || 120);

const DOMAINES = ['Agro-pastoral', 'Assainissement', 'Les deux'];
const MOYENS = ['Mobile Money', 'Orange Money', 'Virement', 'Espèces'];
const VOLETS = ['general', 'agro-pastoral', 'assainissement'];
const STATUTS = {
  adhesions: ['en_attente', 'validee', 'refusee'],
  dons: ['promesse', 'recu', 'annule'],
};

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(express.json({ limit: '20kb' }));
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  next();
});

/* ---------- Outils ---------- */

function clean(value, max = 200) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEL_RE = /^[+0-9][0-9 .-]{7,18}$/;

function makeRef(prefix) {
  const year = new Date().getFullYear();
  return `${prefix}-${year}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function bad(res, message) {
  return res.status(400).json({ ok: false, error: message });
}

// Limite simple anti-abus : N envois par IP sur une fenêtre de temps.
function rateLimit({ max, windowMs }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [ip, list] of hits) {
      const recent = list.filter((t) => now - t < windowMs);
      if (recent.length) hits.set(ip, recent); else hits.delete(ip);
    }
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    const list = (hits.get(req.ip) || []).filter((t) => now - t < windowMs);
    if (list.length >= max) {
      return res.status(429).json({ ok: false, error: 'Trop de demandes. Merci de réessayer dans quelques minutes.' });
    }
    list.push(now);
    hits.set(req.ip, list);
    next();
  };
}

// Champ piège invisible : les robots le remplissent, les humains non.
function honeypot(req, res, next) {
  if (req.body && req.body.site_web) return res.json({ ok: true, ref: 'OK' });
  next();
}

const publicLimit = rateLimit({ max: 15, windowMs: 10 * 60 * 1000 });

/* ---------- API publique ---------- */

app.get('/api/stats', (req, res) => {
  const validees = db.prepare("SELECT COUNT(*) AS n FROM adhesions WHERE statut = 'validee'").get().n;
  const dons = db.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(montant), 0) AS total FROM dons WHERE statut = 'recu'").get();
  const actions = db.prepare('SELECT COUNT(*) AS n FROM actualites').get().n;
  res.json({
    membres: BASE_MEMBRES + validees,
    donateurs: dons.n,
    totalDons: dons.total,
    actions,
  });
});

app.get('/api/actualites', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 6, 50);
  const rows = db.prepare('SELECT id, titre, contenu, volet, created_at FROM actualites ORDER BY created_at DESC, id DESC LIMIT ?').all(limit);
  res.json(rows);
});

app.post('/api/adhesions', publicLimit, honeypot, (req, res) => {
  const nom = clean(req.body.nom, 120);
  const tel = clean(req.body.tel, 30);
  const email = clean(req.body.email, 160);
  const domaine = clean(req.body.domaine, 40);
  const message = clean(req.body.message, 2000);

  if (nom.length < 2) return bad(res, 'Merci d\'indiquer votre nom complet.');
  if (!TEL_RE.test(tel)) return bad(res, 'Le numéro de téléphone semble invalide.');
  if (email && !EMAIL_RE.test(email)) return bad(res, 'L\'adresse e-mail semble invalide.');
  if (!DOMAINES.includes(domaine)) return bad(res, 'Domaine d\'intérêt invalide.');

  const ref = makeRef('ADH');
  db.prepare('INSERT INTO adhesions (ref, nom, tel, email, domaine, message) VALUES (?, ?, ?, ?, ?, ?)')
    .run(ref, nom, tel, email || null, domaine, message || null);
  res.status(201).json({ ok: true, ref });
});

// Suivi d'une demande : la référence ET le téléphone doivent correspondre.
app.post('/api/adhesions/suivi', publicLimit, (req, res) => {
  const ref = clean(req.body.ref, 30).toUpperCase();
  const tel = clean(req.body.tel, 30).replace(/\D/g, '');
  const row = db.prepare('SELECT ref, nom, tel, domaine, statut, created_at FROM adhesions WHERE ref = ?').get(ref);
  if (!row || row.tel.replace(/\D/g, '') !== tel) {
    return res.status(404).json({ ok: false, error: 'Aucune demande trouvée avec ces informations.' });
  }
  res.json({ ok: true, ref: row.ref, prenom: row.nom.split(' ')[0], domaine: row.domaine, statut: row.statut, created_at: row.created_at });
});

app.post('/api/dons', publicLimit, honeypot, (req, res) => {
  const nom = clean(req.body.nom, 120);
  const tel = clean(req.body.tel, 30);
  const email = clean(req.body.email, 160);
  const moyen = clean(req.body.moyen, 40);
  const montant = Number(req.body.montant);

  if (nom.length < 2) return bad(res, 'Merci d\'indiquer votre nom.');
  if (!TEL_RE.test(tel)) return bad(res, 'Le numéro de téléphone semble invalide.');
  if (email && !EMAIL_RE.test(email)) return bad(res, 'L\'adresse e-mail semble invalide.');
  if (!MOYENS.includes(moyen)) return bad(res, 'Moyen de paiement invalide.');
  if (!Number.isFinite(montant) || montant < 1 || montant > 100000) return bad(res, 'Montant invalide.');

  const ref = makeRef('DON');
  db.prepare('INSERT INTO dons (ref, nom, tel, email, montant, moyen) VALUES (?, ?, ?, ?, ?, ?)')
    .run(ref, nom, tel, email || null, Math.round(montant * 100) / 100, moyen);
  res.status(201).json({ ok: true, ref });
});

app.post('/api/messages', publicLimit, honeypot, (req, res) => {
  const nom = clean(req.body.nom, 120);
  const email = clean(req.body.email, 160);
  const sujet = clean(req.body.sujet, 200);
  const message = clean(req.body.message, 4000);

  if (nom.length < 2) return bad(res, 'Merci d\'indiquer votre nom.');
  if (!EMAIL_RE.test(email)) return bad(res, 'L\'adresse e-mail semble invalide.');
  if (message.length < 5) return bad(res, 'Votre message est un peu court.');

  db.prepare('INSERT INTO messages (nom, email, sujet, message) VALUES (?, ?, ?, ?)')
    .run(nom, email, sujet || null, message);
  res.status(201).json({ ok: true });
});

app.post('/api/newsletter', publicLimit, honeypot, (req, res) => {
  const email = clean(req.body.email, 160).toLowerCase();
  if (!EMAIL_RE.test(email)) return bad(res, 'L\'adresse e-mail semble invalide.');
  db.prepare('INSERT OR IGNORE INTO newsletter (email) VALUES (?)').run(email);
  res.status(201).json({ ok: true });
});

/* ---------- Espace d'administration ---------- */

const sessions = new Map(); // token -> date d'expiration
const SESSION_MS = 8 * 60 * 60 * 1000;
const loginLimit = rateLimit({ max: 10, windowMs: 15 * 60 * 1000 });

function samePassword(given) {
  const a = crypto.createHash('sha256').update(String(given)).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

app.post('/api/admin/login', loginLimit, (req, res) => {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ ok: false, error: 'Espace de gestion désactivé : définissez ADMIN_PASSWORD sur le serveur.' });
  }
  if (!samePassword(req.body.password || '')) {
    return res.status(401).json({ ok: false, error: 'Mot de passe incorrect.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_MS);
  res.json({ ok: true, token });
});

function requireAdmin(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer /, '');
  const exp = sessions.get(token);
  if (!exp || exp < Date.now()) {
    sessions.delete(token);
    return res.status(401).json({ ok: false, error: 'Session expirée, reconnectez-vous.' });
  }
  next();
}

const admin = express.Router();
admin.use(requireAdmin);

admin.post('/logout', (req, res) => {
  sessions.delete((req.get('authorization') || '').replace(/^Bearer /, ''));
  res.json({ ok: true });
});

admin.get('/overview', (req, res) => {
  res.json({
    adhesions: db.prepare('SELECT * FROM adhesions ORDER BY id DESC').all(),
    dons: db.prepare('SELECT * FROM dons ORDER BY id DESC').all(),
    messages: db.prepare('SELECT * FROM messages ORDER BY id DESC').all(),
    actualites: db.prepare('SELECT * FROM actualites ORDER BY id DESC').all(),
    newsletter: db.prepare('SELECT * FROM newsletter ORDER BY id DESC').all(),
  });
});

admin.patch('/adhesions/:id', (req, res) => {
  const statut = req.body.statut;
  if (!STATUTS.adhesions.includes(statut)) return bad(res, 'Statut invalide.');
  db.prepare('UPDATE adhesions SET statut = ? WHERE id = ?').run(statut, Number(req.params.id));
  res.json({ ok: true });
});

admin.patch('/dons/:id', (req, res) => {
  const statut = req.body.statut;
  if (!STATUTS.dons.includes(statut)) return bad(res, 'Statut invalide.');
  db.prepare('UPDATE dons SET statut = ? WHERE id = ?').run(statut, Number(req.params.id));
  res.json({ ok: true });
});

admin.patch('/messages/:id', (req, res) => {
  db.prepare('UPDATE messages SET lu = ? WHERE id = ?').run(req.body.lu ? 1 : 0, Number(req.params.id));
  res.json({ ok: true });
});

admin.post('/actualites', (req, res) => {
  const titre = clean(req.body.titre, 160);
  const contenu = clean(req.body.contenu, 4000);
  const volet = VOLETS.includes(req.body.volet) ? req.body.volet : 'general';
  if (titre.length < 3 || contenu.length < 10) return bad(res, 'Titre ou contenu trop court.');
  const info = db.prepare('INSERT INTO actualites (titre, contenu, volet) VALUES (?, ?, ?)').run(titre, contenu, volet);
  res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
});

const DELETABLE = ['adhesions', 'dons', 'messages', 'actualites', 'newsletter'];

admin.delete('/:table/:id', (req, res) => {
  const { table } = req.params;
  if (!DELETABLE.includes(table)) return res.status(404).json({ ok: false });
  db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(Number(req.params.id));
  res.json({ ok: true });
});

admin.get('/export/:table', (req, res) => {
  const { table } = req.params;
  if (!DELETABLE.includes(table)) return res.status(404).json({ ok: false });
  const rows = db.prepare(`SELECT * FROM ${table} ORDER BY id`).all();
  const cols = rows.length ? Object.keys(rows[0]) : [];
  const cell = (v) => {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // évite l'injection de formules dans Excel
    return `"${s.replace(/"/g, '""')}"`;
  };
  const csv = [cols.join(';'), ...rows.map((r) => cols.map((c) => cell(r[c])).join(';'))].join('\r\n');
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${table}.csv"`,
  });
  res.send('﻿' + csv);
});

app.use('/api/admin', admin);
app.use('/api', (req, res) => res.status(404).json({ ok: false, error: 'Introuvable.' }));

/* ---------- Pages ---------- */

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ ok: false, error: 'Erreur du serveur.' });
});

app.listen(PORT, () => {
  console.log(`Coopérative Renaissance en ligne sur http://localhost:${PORT}`);
  if (!ADMIN_PASSWORD) console.warn('ADMIN_PASSWORD non défini : l\'espace /admin est désactivé.');
});
