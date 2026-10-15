/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accountGroups from "../accountGroups.js";
import type * as accounts from "../accounts.js";
import type * as auth from "../auth.js";
import type * as backup from "../backup.js";
import type * as bookmarks from "../bookmarks.js";
import type * as budgets from "../budgets.js";
import type * as categories from "../categories.js";
import type * as crons from "../crons.js";
import type * as currencies from "../currencies.js";
import type * as files from "../files.js";
import type * as http from "../http.js";
import type * as lib_auth from "../lib/auth.js";
import type * as notes from "../notes.js";
import type * as repeats from "../repeats.js";
import type * as seed from "../seed.js";
import type * as settings from "../settings.js";
import type * as stats from "../stats.js";
import type * as transactions from "../transactions.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accountGroups: typeof accountGroups;
  accounts: typeof accounts;
  auth: typeof auth;
  backup: typeof backup;
  bookmarks: typeof bookmarks;
  budgets: typeof budgets;
  categories: typeof categories;
  crons: typeof crons;
  currencies: typeof currencies;
  files: typeof files;
  http: typeof http;
  "lib/auth": typeof lib_auth;
  notes: typeof notes;
  repeats: typeof repeats;
  seed: typeof seed;
  settings: typeof settings;
  stats: typeof stats;
  transactions: typeof transactions;
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
