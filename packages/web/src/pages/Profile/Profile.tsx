import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ParchmentLayout } from '../../components/ParchmentLayout/ParchmentLayout';
import { SignedInHeader } from '../../components/SignedInHeader/SignedInHeader';
import { DesktopCampaignModal } from '../../components/DesktopCampaignModal/DesktopCampaignModal';
import { LicenseModal } from '../../components/LicenseModal/LicenseModal';
import { Button } from '../../components/Button/Button';
import { CLIENT_URL } from '../../createCampaignHandoff';
import { PRODUCTS } from '../../data/products';
import { readUserSession } from '../../api/userSession';
import api from '../../api/client';
import './Profile.css';

interface ProfileLocationState {
  desktopCampaignTags?: string[];
}

function planDescription(products: string[] | null): string {
  if (products === null) return 'Loading your plan…';
  if (products.length === 0) return "You don't have an active plan yet.";
  const titles = products.map(code => PRODUCTS.find(p => p.id === code)?.title ?? code);
  return `You're on the ${titles.join(' + ')} plan.`;
}

export function Profile() {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state as ProfileLocationState | null;
  const [desktopModalTags, setDesktopModalTags] = useState<string[] | null>(state?.desktopCampaignTags ?? null);
  const [licenseModalOpen, setLicenseModalOpen] = useState(false);
  const [products, setProducts] = useState<string[] | null>(readUserSession()?.products ?? null);

  useEffect(() => {
    if (products !== null) return;
    api.auth.me().then(user => setProducts(user.products)).catch(() => setProducts([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function logOut() {
    api.auth.revokeTokens();
    navigate('/login');
  }

  return (
    <>
      <ParchmentLayout
        header={<SignedInHeader />}
        skeleton={<section className="profile--body" />}
      >
        <section className="profile--body parchment-container">
          <section className="profile--section">
            <h1 className="profile--section-title">Your Plan</h1>
            <p className="profile--section-body">{planDescription(products)}</p>
            <Link className="btn btn--outline btn--primary btn--md" to="/products">Change Plan</Link>
          </section>

          <section className="profile--section">
            <h1 className="profile--section-title">Play</h1>
            <p className="profile--section-body">Jump into the app to run or join a campaign.</p>
            <a className="btn btn--fill btn--primary btn--md" href={CLIENT_URL}>Play</a>
          </section>

          <section className="profile--section">
            <h1 className="profile--section-title">License</h1>
            <p className="profile--section-body">View or copy the license key linked to your account.</p>
            <Button variant="outline" onClick={() => setLicenseModalOpen(true)}>Show License</Button>
          </section>

          <section className="profile--section">
            <h1 className="profile--section-title">Log Out</h1>
            <p className="profile--section-body">Sign out of this account on this device.</p>
            <Button variant="outline" color="danger" onClick={logOut}>Log Out</Button>
          </section>
        </section>
      </ParchmentLayout>

      {desktopModalTags && (
        <DesktopCampaignModal tags={desktopModalTags} onClose={() => setDesktopModalTags(null)} />
      )}
      {licenseModalOpen && <LicenseModal onClose={() => setLicenseModalOpen(false)} />}
    </>
  );
}
