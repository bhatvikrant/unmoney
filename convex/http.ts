import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { receive } from "./imports";

const http = httpRouter();

auth.addHttpRoutes(http);

// The iPhone "Send to unmoney" shortcut posts Money Manager exports here (see imports.ts).
http.route({ pathPrefix: "/import/", method: "POST", handler: receive });

export default http;
