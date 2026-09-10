import z from "zod";

export const AuthSSOGoogleRequest = z.object({
  code: z.string(),
  scope: z.string(),
});

export const AuthSignupRequest = z.object({
  productId: z.string().optional(),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  email: z.string().optional(),
  password: z.string().optional(),
  googleCode: z.string().optional(),
  scope: z.string().optional(),
});

export const AuthLoginRequest = z.object({
  email: z.string(),
  password: z.string(),
});

export const ChangePasswordRequest = z.object({
  currentPassword: z.string(),
  newPassword: z.string(),
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
  products: z.array(z.string()),
});

// One row per open login chain (root through however many refresh rotations) — see
// AuthController.getSessions in packages/api.
export const GetSessionsResponse = z.object({
  sessions: z.array(z.object({
    id: z.string(),
    createdAt: z.string(),
    expiresAt: z.string(),
  })),
});
