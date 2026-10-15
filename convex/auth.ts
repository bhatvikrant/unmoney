import Google from "@auth/core/providers/google";
import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const email = String(params.email ?? "").trim().toLowerCase();
        const profile: { email: string; name?: string } = { email };
        if (params.name) profile.name = String(params.name);
        return profile as { email: string; name: string };
      },
    }),
    Google,
  ],
});
