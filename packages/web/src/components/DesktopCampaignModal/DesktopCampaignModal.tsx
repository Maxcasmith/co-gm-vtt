import { Button } from '../Button/Button';
import { Modal } from '../Modal/Modal';
import './DesktopCampaignModal.css';

interface DesktopCampaignModalProps {
  tags: string[];
  onClose: () => void;
}

// Desktop has no account-linked deep link to redirect into, so the handoff is manual:
// give the user their tags as one copy-pasteable line for the desktop app's own prompt step.
export function DesktopCampaignModal({ tags, onClose }: DesktopCampaignModalProps) {
  const line = tags.join(', ');

  return (
    <Modal isOpen onClose={onClose}>
      <div className="desktop-campaign-modal torn-parchment">
        <h2 className="desktop-campaign-modal--title">Continue in the Desktop App</h2>
        <p className="desktop-campaign-modal--body">
          Your desktop license doesn't create campaigns from the browser. Copy your tags below,
          then open the desktop app and paste them into the tags field on the Create Campaign screen.
        </p>
        <input
          className="desktop-campaign-modal--line"
          value={line}
          readOnly
          onFocus={e => e.currentTarget.select()}
        />
        <ol className="desktop-campaign-modal--steps">
          <li>Open the Untitled AI VTT desktop app</li>
          <li>Choose <strong>Create Campaign</strong> → <strong>New Campaign</strong></li>
          <li>Paste the copied line into the tags field</li>
        </ol>
        <Button onClick={onClose}>Got It</Button>
      </div>
    </Modal>
  );
}
