import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { receive } from "./imports";
import { callback as gmailCallback } from "./gmail";

const http = httpRouter();

auth.addHttpRoutes(http);

// The iPhone "Send to unmoney" shortcut posts Money Manager exports here (see imports.ts).
http.route({ pathPrefix: "/import/", method: "POST", handler: receive });

// Google sends the user back here after the Gmail consent screen (see gmail.ts).
http.route({ path: "/gmail/callback", method: "GET", handler: gmailCallback });

// Google Search Console checks this page for its meta tag to verify that we own this domain, which
// the OAuth redirect URIs live on (docs/google-verification.md). The token is the GOOGLE_SITE_VERIFICATION env var.
http.route({
  path: "/",
  method: "GET",
  handler: httpAction(async () => {
    const token = process.env.GOOGLE_SITE_VERIFICATION?.replace(/[^\w-]/g, "");
    if (!token) return new Response("Not found", { status: 404 });
    const html = `<!doctype html><html><head><meta name="google-site-verification" content="${token}" /><title>UnMoney</title></head><body>UnMoney's server. The app is at <a href="${process.env.SITE_URL ?? ""}">${process.env.SITE_URL ?? ""}</a>.</body></html>`;
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }),
});

export default http;
