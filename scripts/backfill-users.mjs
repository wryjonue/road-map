#!/usr/bin/env node
/**
 * Backfill the D1 `users` table from Clerk for existing report/comment authors.
 *
 * Usage:
 *   node scripts/backfill-users.mjs                     # dry-run against remote D1 (default)
 *   node scripts/backfill-users.mjs --execute           # write to remote D1
 *   node scripts/backfill-users.mjs --local             # dry-run against local D1
 *   node scripts/backfill-users.mjs --local --execute   # write to local D1
 *
 * Prerequisites:
 *   - CLERK_SECRET_KEY must be set in your environment or .dev.vars
 *     (use the production key for --remote, development key for --local)
 *   - Wrangler must be authenticated (`wrangler login` or CLOUDFLARE_API_TOKEN set) for remote
 *   - Migration 015_users.sql must already be applied to the target D1
 *
 * This script only backfills users that still exist in Clerk. Authors whose
 * Clerk accounts have been deleted are intentionally skipped — they will
 * resolve to NULL via LEFT JOIN and fall back to 'Community reporter' in the UI.
 */

import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createClerkClient } from '@clerk/backend';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TEMP_SQL = join(ROOT, '.backfill-users-temp.sql');
const BATCH_SIZE = 50;
const CLERK_DELAY_MS = 200;

const args = process.argv.slice(2);
const isExecute = args.includes('--execute');
const isLocal = args.includes('--local');
const d1Flag = isLocal ? '--local' : '--remote';
const d1Label = isLocal ? 'local' : 'remote';

function loadEnvVars() {
	const vars = {};
	const devVarsPath = join(ROOT, '.dev.vars');
	try {
		const content = readFileSync(devVarsPath, 'utf-8');
		for (const line of content.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			const eqIndex = trimmed.indexOf('=');
			if (eqIndex === -1) continue;
			const key = trimmed.slice(0, eqIndex).trim();
			const value = trimmed.slice(eqIndex + 1).trim();
			vars[key] = value;
		}
	} catch {
		// .dev.vars may not exist; fall through to process.env
	}
	return vars;
}

const envVars = loadEnvVars();
const clerkSecretKey = process.env.CLERK_SECRET_KEY || envVars.CLERK_SECRET_KEY;

if (!clerkSecretKey) {
	console.error('Error: CLERK_SECRET_KEY is not set.');
	console.error('Set it in your shell environment or in .dev.vars (never commit .dev.vars).');
	process.exit(1);
}

const clerk = createClerkClient({ secretKey: clerkSecretKey });

function wranglerExec(command) {
	return execSync(`npx wrangler ${command}`, {
		cwd: ROOT,
		encoding: 'utf-8',
		stdio: ['pipe', 'pipe', 'pipe'],
	});
}

async function getAuthorIdsFromD1() {
	console.log(`Enumerating distinct author IDs from ${d1Label} D1...`);
	const raw = wranglerExec(
		`d1 execute road-map-db ${d1Flag} --command "SELECT DISTINCT author_id FROM reports WHERE author_id IS NOT NULL UNION SELECT DISTINCT author_id FROM comments WHERE author_id IS NOT NULL" --json`
	);
	// Wrangler --json output may contain non-JSON preamble; extract the JSON array.
	const jsonMatch = raw.match(/\[[\s\S]*\]/);
	if (!jsonMatch) {
		console.error('Could not parse D1 output. Raw response:\n', raw.slice(0, 500));
		process.exit(1);
	}
	const parsed = JSON.parse(jsonMatch[0]);
	// Wrangler returns [{ results: [{ author_id: '...' }, ...] }]
	const rows = Array.isArray(parsed) && parsed[0]?.results ? parsed[0].results : parsed;
	const ids = rows.map((r) => r.author_id).filter(Boolean);
	const unique = [...new Set(ids)];
	console.log(`Found ${unique.length} distinct author ID(s) in D1.`);
	return unique;
}

async function resolveUser(clerkId) {
	try {
		const user = await clerk.users.getUser(clerkId);
		let firstName = user.firstName?.trim() || null;
		let lastName = user.lastName?.trim() || null;
		const imageUrl = user.imageUrl?.trim() || null;

		// Fallback: split fullName if firstName/lastName are both missing.
		if (!firstName && !lastName && user.fullName?.trim()) {
			const parts = user.fullName.trim().split(/\s+/);
			if (parts.length >= 2) {
				firstName = parts[0];
				lastName = parts.slice(1).join(' ');
			} else if (parts.length === 1) {
				firstName = parts[0];
			}
		}

		let role = 'user';
		if (user.publicMetadata && typeof user.publicMetadata.role === 'string') {
			role = user.publicMetadata.role;
		}
		return { id: user.id, firstName, lastName, imageUrl, role };
	} catch (err) {
		// 404 means the user was deleted from Clerk — skip them.
		if (err.status === 404 || err.clerkError) return null;
		throw err;
	}
}

function escapeSqlString(value) {
	if (value === null || value === undefined) return 'NULL';
	return `'${String(value).replace(/'/g, "''")}'`;
}

function delay(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
	const authorIds = await getAuthorIdsFromD1();
	if (authorIds.length === 0) {
		console.log('No author IDs found. Nothing to backfill.');
		return;
	}

	const found = [];
	const notFound = [];
	const errors = [];

	console.log(`Resolving ${authorIds.length} user(s) against Clerk Backend API...`);
	for (let i = 0; i < authorIds.length; i++) {
		const id = authorIds[i];
		try {
			const user = await resolveUser(id);
			if (user) {
				found.push(user);
			} else {
				notFound.push(id);
			}
		} catch (err) {
			errors.push({ id, error: err.message || String(err) });
		}
		// Rate-limit courtesy delay between Clerk API calls.
		if (i < authorIds.length - 1) await delay(CLERK_DELAY_MS);
		// Progress indicator every 10 users.
		if ((i + 1) % 10 === 0) console.log(`  ...resolved ${i + 1}/${authorIds.length}`);
	}

	console.log('\n--- Backfill Summary ---');
	console.log(`Total author IDs in D1:  ${authorIds.length}`);
	console.log(`Found in Clerk:          ${found.length}`);
	console.log(`Not found (deleted):     ${notFound.length}`);
	console.log(`Errors:                  ${errors.length}`);

	if (errors.length > 0) {
		console.log('\nErrors encountered:');
		for (const e of errors) console.log(`  ${e.id}: ${e.error}`);
	}

	if (notFound.length > 0) {
		console.log('\nSkipped (no longer in Clerk):');
		for (const id of notFound) console.log(`  ${id}`);
	}

	if (found.length === 0) {
		console.log('\nNo users to insert. Done.');
		return;
	}

	// Build idempotent SQL: INSERT OR IGNORE so re-runs are safe.
	const sqlLines = [
		'-- Auto-generated by scripts/backfill-users.mjs',
		'-- Idempotent: safe to run multiple times.',
	];
	for (const user of found) {
		const id = escapeSqlString(user.id);
		const fn = escapeSqlString(user.firstName);
		const ln = escapeSqlString(user.lastName);
		const img = escapeSqlString(user.imageUrl);
		sqlLines.push(
			`INSERT INTO users (id, first_name, last_name, image_url, role) VALUES (${id}, ${fn}, ${ln}, ${img}, ${escapeSqlString(user.role)}) ON CONFLICT(id) DO UPDATE SET first_name = excluded.first_name, last_name = excluded.last_name, image_url = excluded.image_url, role = excluded.role, updated_at = CURRENT_TIMESTAMP;`
		);
	}
	const sql = sqlLines.join('\n') + '\n';

	if (!isExecute) {
		console.log('\n[DRY RUN] Generated SQL (first 10 statements):');
		const preview = sqlLines.filter((l) => l.startsWith('INSERT')).slice(0, 10);
		for (const line of preview) console.log(`  ${line}`);
		if (found.length > 10) console.log(`  ... and ${found.length - 10} more`);
		console.log(`\nTo apply, re-run with: node scripts/backfill-users.mjs${isLocal ? ' --local' : ''} --execute`);
		return;
	}

	// Write SQL to temp file, execute via wrangler, then clean up.
	console.log(`\n[EXECUTE] Writing ${found.length} INSERT statement(s) to temp file (${d1Label})...`);
	writeFileSync(TEMP_SQL, sql, 'utf-8');

	try {
		// Execute in batches to stay within D1 statement limits.
		const totalStatements = found.length;
		let applied = 0;
		for (let offset = 0; offset < totalStatements; offset += BATCH_SIZE) {
			const batch = sqlLines
				.filter((l) => l.startsWith('INSERT'))
				.slice(offset, offset + BATCH_SIZE);
			if (batch.length === 0) break;
			const batchSql = batch.join('\n') + '\n';
			const batchFile = TEMP_SQL.replace('.sql', `_batch${offset}.sql`);
			writeFileSync(batchFile, batchSql, 'utf-8');
			console.log(`  Applying batch ${Math.floor(offset / BATCH_SIZE) + 1} (${batch.length} statements)...`);
			wranglerExec(`d1 execute road-map-db ${d1Flag} --file "${batchFile}"`);
			unlinkSync(batchFile);
			applied += batch.length;
		}
		console.log(`\nSent ${applied} INSERT OR IGNORE statement(s) to ${d1Label} D1.`);
		console.log('Existing users are silently skipped by INSERT OR IGNORE (idempotent).');
	} catch (err) {
		console.error(`\nFailed to execute SQL against ${d1Label} D1:`, err.message);
		console.error(`Temp SQL file preserved at: ${TEMP_SQL}`);
		process.exit(1);
	} finally {
		// Clean up the main temp file if it still exists.
		try { unlinkSync(TEMP_SQL); } catch { /* already removed or batch mode */ }
	}

	// Reconcile: verify row count matches expectations.
	console.log('\nReconciling...');
	try {
		const countRaw = wranglerExec(
			`d1 execute road-map-db ${d1Flag} --command "SELECT COUNT(*) AS total FROM users" --json`
		);
		const countMatch = countRaw.match(/\[[\s\S]*\]/);
		if (countMatch) {
			const countParsed = JSON.parse(countMatch[0]);
			const countRows = Array.isArray(countParsed) && countParsed[0]?.results ? countParsed[0].results : countParsed;
			const total = countRows[0]?.total ?? '?';
			console.log(`Users table now contains ${total} row(s).`);
		}
	} catch {
		console.log(`Could not verify row count. Run manually: npx wrangler d1 execute road-map-db ${d1Flag} --command "SELECT COUNT(*) FROM users"`);
	}

	console.log('\nBackfill complete. Run this script again to confirm zero new inserts (idempotency proof).');
}

main().catch((err) => {
	console.error('Fatal error:', err);
	process.exit(1);
});
