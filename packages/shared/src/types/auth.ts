import z from "zod";

export const AuthSSOGoogleRequest = z.object({
  code: z.string(),
  scope: z.string(),
});

export const AuthSSOGoogleResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
});

export const AuthTokenResponse = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  token_type: z.literal("Bearer"),
  expires_in: z.number(),
});

// Shape returned by GET /users/me (see User.present() in packages/api/src/domain/entities/User/User.ts).
export const FindUserResponse = z.object({
  id: z.string().optional(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  mobile: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
  updatedAt: z.string().nullable().optional(),
});
