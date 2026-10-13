import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import { normalizeUsername } from "./shared/username";

// Users log in with USERNAME + password. The username is stored as the auth
// account id (the provider calls that field "email").
export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const username = normalizeUsername(String(params.username ?? ""));
        if (!username) throw new ConvexError("INVALID_USERNAME");
        return { email: username };
      },
      validatePasswordRequirements(password) {
        if (password.length < 8) throw new ConvexError("PASSWORD_TOO_SHORT");
      },
    }),
  ],
});
