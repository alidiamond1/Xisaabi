import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import { normalizeUsername } from "./shared/username";

const MAX_PASSWORD = 200;

/** profile() runs for every flow, so the cap also bounds sign-in (scrypt over a huge string is a DoS). */
export function checkPassword(flow: unknown, password: unknown, username: string) {
  if (typeof password === "string" && password.length > MAX_PASSWORD) throw new ConvexError("PASSWORD_TOO_LONG");
  if (flow === "signUp" && password === username) throw new ConvexError("PASSWORD_SAME_AS_USERNAME");
}

// Users log in with USERNAME + password. The username is stored as the auth
// account id (the provider calls that field "email").
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const username = normalizeUsername(String(params.username ?? ""));
        if (!username) throw new ConvexError("INVALID_USERNAME");
        checkPassword(params.flow, params.password, username);
        // ponytail: signupsOpen is not checked here: profile() is sync, so it cannot read the DB
        return { email: username };
      },
      validatePasswordRequirements(password) {
        if (password.length < 8) throw new ConvexError("PASSWORD_TOO_SHORT");
        if (password.length > MAX_PASSWORD) throw new ConvexError("PASSWORD_TOO_LONG");
      },
    }),
  ],
});
