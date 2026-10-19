#!/usr/bin/env node
/**
 * Gives a Vercel preview's Convex backend the env vars it needs. Each git branch gets its own
 * Convex preview deployment (from `npx convex deploy` with a preview deploy key), and those start
 * with no env vars, so sign-in and AI calls fail there until this runs.
 *
 * - SITE_URL: the branch's stable Vercel URL, so Convex Auth sends people back to this preview.
 * - JWT_PRIVATE_KEY / JWKS: generated once per preview, then left alone so sessions survive redeploys.
 * - AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, ANTHROPIC_API_KEY: copied from Vercel's Preview env vars.
 *
 * Runs after `convex deploy` in the build command (vercel.json); does nothing outside previews.
 */
import { spawnSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";

const COPIED = ["AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET", "ANTHROPIC_API_KEY"];

const { VERCEL_ENV, VERCEL_GIT_COMMIT_REF, VERCEL_BRANCH_URL, VERCEL_URL } = process.env;
if (VERCEL_ENV !== "preview") process.exit(0);
if (!VERCEL_GIT_COMMIT_REF) fail("VERCEL_GIT_COMMIT_REF is not set, so the Convex preview can't be named.");

function convex(args, input) {
  const result = spawnSync("npx", ["convex", "env", ...args, "--preview-name", VERCEL_GIT_COMMIT_REF], {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "inherit"],
  });
  if (result.status !== 0) fail(`npx convex env ${args[0]} failed.`);
  return result.stdout;
}

// Values go in through stdin so they never show up in the build log or the process list.
function set(name, value) {
  convex(["set", name], value);
}

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

const existing = new Set(convex(["list", "--names-only"]).split(/\s+/).filter(Boolean));

set("SITE_URL", `https://${VERCEL_BRANCH_URL ?? VERCEL_URL}`);

if (!existing.has("JWT_PRIVATE_KEY") || !existing.has("JWKS")) {
  // Same shape as @convex-dev/auth's generateKeys: RS256, PEM with newlines folded to spaces.
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).trimEnd().replace(/\n/g, " ");
  set("JWT_PRIVATE_KEY", pem);
  set("JWKS", JSON.stringify({ keys: [{ use: "sig", ...publicKey.export({ format: "jwk" }) }] }));
}

for (const name of COPIED) {
  if (process.env[name]) set(name, process.env[name]);
  else console.warn(`! ${name} isn't in Vercel's Preview env vars, so it's not set on this preview.`);
}
