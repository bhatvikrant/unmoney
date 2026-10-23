/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as account from "../account.js";
import type * as ai from "../ai.js";
import type * as auth from "../auth.js";
import type * as crons from "../crons.js";
import type * as files from "../files.js";
import type * as gmail from "../gmail.js";
import type * as http from "../http.js";
import type * as imports from "../imports.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_fxFeed from "../lib/fxFeed.js";
import type * as lib_gmailApi from "../lib/gmailApi.js";
import type * as lib_gmailCrypto from "../lib/gmailCrypto.js";
import type * as lib_snapshot from "../lib/snapshot.js";
import type * as migrations from "../migrations.js";
import type * as passcode from "../passcode.js";
import type * as repeats from "../repeats.js";
import type * as seed from "../seed.js";
import type * as sync from "../sync.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  account: typeof account;
  ai: typeof ai;
  auth: typeof auth;
  crons: typeof crons;
  files: typeof files;
  gmail: typeof gmail;
  http: typeof http;
  imports: typeof imports;
  "lib/auth": typeof lib_auth;
  "lib/fxFeed": typeof lib_fxFeed;
  "lib/gmailApi": typeof lib_gmailApi;
  "lib/gmailCrypto": typeof lib_gmailCrypto;
  "lib/snapshot": typeof lib_snapshot;
  migrations: typeof migrations;
  passcode: typeof passcode;
  repeats: typeof repeats;
  seed: typeof seed;
  sync: typeof sync;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
