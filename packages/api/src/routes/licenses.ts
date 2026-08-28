import { Router } from 'express';
import { createLicense, redeemLicense } from '../licenses/repository.ts';
import { redeemLicenseCode, checkStoredLicense } from '../licenses/licenseFile.ts';

export const licensesRouter = Router();

// App boot: is there already a locally-stored, still-valid license? If so, skip the modal.
licensesRouter.get('/status', async (req, res) => {
  res.json({ valid: await checkStoredLicense() });
});

licensesRouter.post('/check', async (req, res) => {
  const { licenseCode } = req.body as { licenseCode?: string };
  if (!licenseCode) {
    res.status(400).json({ error: 'licenseCode is required' });
    return;
  }
  res.json({ valid: await redeemLicenseCode(licenseCode) });
});

licensesRouter.post('/', async (req, res) => {
  const { name, emailAddress } = req.body as { name?: string; emailAddress?: string };
  if (!name || !emailAddress) {
    res.status(400).json({ error: 'name and emailAddress are required' });
    return;
  }
  res.json(await createLicense(name, emailAddress));
});

licensesRouter.post('/redeem', async (req, res) => {
  const { licenseCode } = req.body as { licenseCode?: string };
  if (!licenseCode) {
    res.status(400).json({ error: 'licenseCode is required' });
    return;
  }
  const result = await redeemLicense(licenseCode);
  if (result === null) {
    res.status(404).json({ error: 'License not found' });
    return;
  }
  if (result === 'already_redeemed') {
    res.status(409).json({ error: 'License already redeemed' });
    return;
  }
  res.json(result);
});
