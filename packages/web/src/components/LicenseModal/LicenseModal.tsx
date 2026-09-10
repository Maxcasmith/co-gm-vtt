import { useEffect, useState } from 'react';
import { Button } from '../Button/Button';
import { Modal } from '../Modal/Modal';
import api from '../../api/client';
import './LicenseModal.css';

interface LicenseModalProps {
  onClose: () => void;
}

export function LicenseModal({ onClose }: LicenseModalProps) {
  const [licenseCode, setLicenseCode] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api.licenses.mine()
      .then(setLicenseCode)
      .catch(() => setLicenseCode(null))
      .finally(() => setLoaded(true));
  }, []);

  function copy() {
    if (!licenseCode) return;
    navigator.clipboard.writeText(licenseCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }

  return (
    <Modal isOpen onClose={onClose}>
      <div className="license-modal torn-parchment">
        <h2 className="license-modal--title">Your License</h2>

        {!loaded && <p className="license-modal--body">Loading…</p>}

        {loaded && !licenseCode && (
          <p className="license-modal--body">No license is linked to this account.</p>
        )}

        {loaded && licenseCode && (
          <>
            <div className="license-modal--code-row">
              <input className="license-modal--code" value={licenseCode} readOnly onFocus={e => e.currentTarget.select()} />
              <Button variant="outline" onClick={copy}>{copied ? 'Copied' : 'Copy'}</Button>
            </div>
          </>
        )}

        <Button className="license-modal--close" variant="outline" color="secondary" onClick={onClose}>Close</Button>
      </div>
    </Modal>
  );
}
