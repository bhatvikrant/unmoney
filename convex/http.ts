import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { receive } from "./imports";
import { callback as gmailCallback } from "./gmail";

const http = httpRouter();

auth.addHttpRoutes(http);

// The iPhone "Send to unmoney" shortcut posts Money Manager exports here (see imports.ts).
http.route({ pathPrefix: "/import/", method: "POST", handler: receive });

// Google sends the user back here after the Gmail consent screen (see gmail.ts).
http.route({ path: "/gmail/callback", method: "GET", handler: gmailCallback });

export default http;
