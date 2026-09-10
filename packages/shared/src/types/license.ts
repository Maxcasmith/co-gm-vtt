import z from "zod";

// Shape returned by GET /licenses/mine (see routes/licenses.ts in packages/api).
export const GetLicenseResponse = z.object({
  licenseCode: z.string().nullable(),
});
