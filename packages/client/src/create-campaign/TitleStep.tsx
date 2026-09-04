import InfoTooltip from './InfoTooltip.tsx';
import TypeBadge from './TypeBadge.tsx';
import PasswordFields from './PasswordFields.tsx';

interface Props {
  title: string;
  campaignType: 'campaign' | 'dungeon-crawl';
  campaignName: string;
  onCampaignNameChange: (name: string) => void;
  password: string;
  onPasswordChange: (value: string) => void;
  confirmPassword: string;
  onConfirmPasswordChange: (value: string) => void;
  onSubmit: () => void;
}

export default function TitleStep({
  title, campaignType, campaignName, onCampaignNameChange,
  password, onPasswordChange, confirmPassword, onConfirmPasswordChange, onSubmit,
}: Props) {
  return (
    <div className="create-step">
      <div className="modal-header">
        <h1 className="modal-title">{title}</h1>
        <p className="modal-hint">We&apos;ve suggested a name below — change it if you&apos;d like.</p>
      </div>
      <div className="create-badge-row">
        <TypeBadge sourceType={campaignType} />
      </div>
      <label className="modal-label">
        <span className="create-label-row">
          Campaign Name
          <InfoTooltip text="What this campaign will be called and saved as." />
        </span>
        <input
          className="modal-input"
          type="text"
          value={campaignName}
          onChange={e => onCampaignNameChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && campaignName.trim()) onSubmit(); }}
          autoFocus
        />
      </label>
      <PasswordFields
        password={password}
        onPasswordChange={onPasswordChange}
        confirmPassword={confirmPassword}
        onConfirmPasswordChange={onConfirmPasswordChange}
      />
    </div>
  );
}
