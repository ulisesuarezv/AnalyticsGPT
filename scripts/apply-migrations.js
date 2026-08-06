/**
 * Aplica las migraciones de supabase/migrations/ en orden alfabético, con la
 * conexión admin (`DATABASE_URL_ADMIN`).
 *
 * Además fija la contraseña del rol `query_runner` y compone
 * `DATABASE_URL_READONLY` en `.env.local`. La migración crea el rol SIN
 * contraseña a propósito: se pone aquí, por parámetro bindeado, para que nunca
 * acabe interpolada en un fichero versionado.
 *
 *   node --env-file=.env.local scripts/apply-migrations.js
 *
 * Con --rotate genera una contraseña nueva para query_runner aunque ya hubiera
 * una en .env.local.
 */

import { randomBytes } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');
const ENV_FILE = join(ROOT, '.env.local');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Falta ${name}. Ejecuta con: node --env-file=.env.local scripts/apply-migrations.js`);
    process.exit(1);
  }
  return value;
}

/** Contraseña sin caracteres que compliquen el URL-encoding ni el shell. */
function generatePassword() {
  return randomBytes(24).toString('base64url');
}

/** Lee una variable de .env.local sin depender de que esté cargada en el proceso. */
function readEnvFileVar(name) {
  try {
    const line = readFileSync(ENV_FILE, 'utf8')
      .split('\n')
      .find((l) => l.startsWith(`${name}=`));
    return line ? line.slice(name.length + 1).trim() : '';
  } catch {
    return '';
  }
}

function upsertEnvVar(name, value) {
  let content = readFileSync(ENV_FILE, 'utf8');
  const re = new RegExp(`^${name}=.*$`, 'm');
  content = re.test(content)
    ? content.replace(re, `${name}=${value}`)
    : `${content.replace(/\n*$/, '\n')}${name}=${value}\n`;
  writeFileSync(ENV_FILE, content);
}

/**
 * La URL readonly reusa host, puerto y base de la admin, cambiando usuario y
 * contraseña. El pooler de Supabase exige el sufijo del proyecto en el usuario
 * (`query_runner.<ref>`), que se saca del usuario admin.
 */
function composeReadonlyUrl(adminUrl, password) {
  const url = new URL(adminUrl);
  const projectRef = decodeURIComponent(url.username).split('.')[1];
  url.username = projectRef ? `query_runner.${projectRef}` : 'query_runner';
  url.password = encodeURIComponent(password);
  return url.toString();
}

async function main() {
  const adminUrl = requireEnv('DATABASE_URL_ADMIN');
  const rotate = process.argv.includes('--rotate');

  const existing = readEnvFileVar('DATABASE_URL_READONLY');
  let password;
  if (!rotate && existing) {
    password = decodeURIComponent(new URL(existing).password);
    console.log('· Reutilizando la contraseña de query_runner de .env.local');
  } else {
    password = generatePassword();
    console.log('· Contraseña nueva para query_runner');
  }

  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  if (files.length === 0) {
    console.error('No hay migraciones en supabase/migrations/');
    process.exit(1);
  }

  const sql = postgres(adminUrl, { max: 1, prepare: false, onnotice: () => {} });

  try {
    for (const file of files) {
      process.stdout.write(`· ${file} … `);
      await sql.unsafe(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
      console.log('ok');
    }

    // Contraseña del rol: bindeada, nunca interpolada en el .sql.
    await sql`select set_query_runner_password(${password})`;
    console.log('· query_runner: contraseña fijada');

    const readonlyUrl = composeReadonlyUrl(adminUrl, password);
    upsertEnvVar('DATABASE_URL_READONLY', readonlyUrl);
    console.log('· DATABASE_URL_READONLY escrita en .env.local');

    await verifyIsolation(sql, readonlyUrl);
  } finally {
    await sql.end();
  }
}

/**
 * Comprueba contra la base real lo que el schema promete. Si el rol pudiera
 * leer una tabla base, la capa 2 del aislamiento no existiría y no nos
 * enteraríamos hasta que se filtraran datos de un tenant a otro.
 */
async function verifyIsolation(adminSql, readonlyUrl) {
  console.log('\nVerificando el aislamiento del rol query_runner:');
  const ro = postgres(readonlyUrl, { max: 1, prepare: false, onnotice: () => {} });
  const results = [];

  const expectFailure = async (label, fn) => {
    try {
      await fn();
      results.push({ label, ok: false, detail: 'NO falló, y debería' });
    } catch (e) {
      results.push({ label, ok: true, detail: e.message.split('\n')[0] });
    }
  };

  try {
    await expectFailure('SELECT sobre la tabla base orders', () => ro`select * from orders limit 1`);
    await expectFailure('SELECT sobre stores (tokens de acceso)', () => ro`select access_token from stores limit 1`);
    await expectFailure('INSERT en orders', () => ro`insert into orders (platform_order_id) values ('x')`);
    await expectFailure('UPDATE sobre una vista', () => ro`update v_orders set total_price = 0`);
    await expectFailure('DROP de una vista', () => ro.unsafe('drop view v_orders'));

    // Sin app.store_id fijado, las vistas devuelven cero filas: fallo cerrado.
    const leaked = await ro`select count(*)::int as n from v_orders`;
    results.push({
      label: 'v_orders sin app.store_id devuelve 0 filas',
      ok: leaked[0].n === 0,
      detail: `${leaked[0].n} filas`,
    });

    for (const r of results) {
      console.log(`  ${r.ok ? '✓' : '✗'} ${r.label}${r.ok ? '' : ` — ${r.detail}`}`);
    }
    if (results.some((r) => !r.ok)) {
      console.error('\nEl aislamiento NO se sostiene. No sigas hasta arreglarlo.');
      process.exitCode = 1;
    } else {
      console.log('\nAislamiento verificado contra la base real.');
    }
  } finally {
    await ro.end();
  }
}

await main();
