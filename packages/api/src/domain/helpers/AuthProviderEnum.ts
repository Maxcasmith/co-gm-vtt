export const providers = {
  GOOGLE: "google",
  FACEBOOK: "facebook",
  X: "x_twitter",
} as const;

export type IProviders = (typeof providers)[keyof typeof providers];
