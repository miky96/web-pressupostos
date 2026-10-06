#!/usr/bin/env node
/**
 * Embolcall de la CLI de Firebase perquè el compte i el projecte surtin de .env.local
 * (no del repo) i no es pugui desplegar mai amb un altre compte (p.ex. el de feina).
 *
 *   node scripts/firebase.mjs deploy --only hosting     → --project i --account de .env.local
 *   node scripts/firebase.mjs emulators:start ...       → projecte demo, sense compte
 *   node scripts/firebase.mjs login:add                 → tal qual
 *   A GitHub Actions: --project de les variables del repo i credencials del compte de servei
 *
 * També genera firestore.rules a partir de firestore.rules.template amb ALLOWED_EMAILS.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO_PROJECT_ID = 'demo-pressupostos';

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

/** Parser mínim de .env (KEY=valor, # comentaris). Les variables d'entorn ja definides manen. */
function loadEnv(file) {
  const env = {};
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return { ...env, ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k in env || k.startsWith('FIREBASE_') || k.startsWith('VITE_FIREBASE_') || k === 'ALLOWED_EMAILS')) };
}

function parseEmails(value) {
  const emails = (value ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  for (const e of emails) if (!/^[^\s@'"\\]+@[^\s@'"\\]+\.[^\s@'"\\]+$/.test(e)) fail(`ALLOWED_EMAILS conté un correu no vàlid: "${e}"`);
  return emails;
}

function writeRules(emails) {
  const template = readFileSync(join(root, 'firestore.rules.template'), 'utf8');
  if (!template.includes('ALLOWED_EMAILS_PLACEHOLDER')) fail('firestore.rules.template no conté ALLOWED_EMAILS_PLACEHOLDER');
  const list = `[${emails.map((e) => `'${e}'`).join(', ')}]`;
  const header = "// FITXER GENERAT per scripts/firebase.mjs a partir de firestore.rules.template. No l'editis.";
  const rules = template.replace('ALLOWED_EMAILS_PLACEHOLDER', list).replace(/^(rules_version = '2';)/m, `$1\n${header}`);
  writeFileSync(join(root, 'firestore.rules'), rules);
}

function firebaseBin() {
  try {
    const require = createRequire(join(root, 'package.json'));
    const pkgPath = require.resolve('firebase-tools/package.json');
    const bin = JSON.parse(readFileSync(pkgPath, 'utf8')).bin;
    return join(dirname(pkgPath), typeof bin === 'string' ? bin : bin.firebase);
  } catch {
    fail('No trobo firebase-tools. Executa: npm install -D firebase-tools');
  }
}

const args = process.argv.slice(2);
const command = args[0] ?? '';
const env = loadEnv(join(root, '.env.local'));
const childEnv = { ...process.env };
let extra = [];

if (command.startsWith('login') || command === 'logout' || command === '--help' || command === '') {
  // comandes de compte: tal qual
} else if (command.startsWith('emulators:')) {
  const emails = parseEmails(env.ALLOWED_EMAILS);
  if (emails.length === 0) console.warn('⚠ ALLOWED_EMAILS buit a .env.local: a dev:emu cap usuari podrà llegir dades.');
  writeRules(emails);
  extra = ['--project', DEMO_PROJECT_ID];
} else if (process.env.GITHUB_ACTIONS === 'true') {
  // GitHub Actions: s'autentica amb el compte de servei (GOOGLE_APPLICATION_CREDENTIALS), sense --account.
  const project = env.VITE_FIREBASE_PROJECT_ID;
  const emails = parseEmails(env.ALLOWED_EMAILS);
  if (!project) fail('Falta la variable VITE_FIREBASE_PROJECT_ID (GitHub → Settings → Secrets and variables → Actions → Variables)');
  if (emails.length === 0) fail('Falta el secret ALLOWED_EMAILS');
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) fail('Falten les credencials del compte de servei (secret FIREBASE_SERVICE_ACCOUNT)');
  writeRules(emails);
  extra = ['--project', project, '--non-interactive'];
  console.log(`→ firebase ${command} · projecte ${project} · compte de servei (CI)`);
} else {
  const project = env.VITE_FIREBASE_PROJECT_ID;
  const account = env.FIREBASE_ACCOUNT;
  const emails = parseEmails(env.ALLOWED_EMAILS);
  if (!project) fail('Falta VITE_FIREBASE_PROJECT_ID a .env.local');
  if (!account) fail('Falta FIREBASE_ACCOUNT a .env.local (el compte de Google amb què es desplega)');
  if (emails.length === 0) fail('Falta ALLOWED_EMAILS a .env.local (correus que poden fer servir l\'app, separats per comes)');

  const rcPath = join(root, '.firebaserc');
  if (existsSync(rcPath)) {
    const rcProject = JSON.parse(readFileSync(rcPath, 'utf8')).projects?.default;
    if (rcProject && rcProject !== project) fail(`.firebaserc apunta a "${rcProject}" però .env.local a "${project}". Fes-los coincidir.`);
  }
  // Aquestes variables tenen prioritat sobre --account: si venen d'un altre projecte, desplegaríem amb un altre compte.
  for (const k of ['GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_TOKEN']) {
    if (childEnv[k]) {
      console.warn(`⚠ Ignoro ${k} (definida a l'entorn) per desplegar amb ${account}.`);
      delete childEnv[k];
    }
  }
  writeRules(emails);
  extra = ['--project', project, '--account', account];
  console.log(`→ firebase ${command} · projecte ${project} · compte ${account}`);
}

const result = spawnSync(process.execPath, [firebaseBin(), ...args, ...extra], { stdio: 'inherit', env: childEnv, cwd: root });
process.exit(result.status ?? 1);
