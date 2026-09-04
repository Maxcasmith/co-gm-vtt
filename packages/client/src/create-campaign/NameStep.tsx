import Badge from './Badge.tsx';
import InfoTooltip from './InfoTooltip.tsx';
import TypeBadge from './TypeBadge.tsx';
import PasswordFields from './PasswordFields.tsx';

interface EntityCount {
  npc: number;
  creature: number;
  faction: number;
  location: number;
}

interface Props {
  title: string;
  sourceType?: string;
  scenarioSynopsis?: string;
  partySize?: number;
  theme?: string;
  entityCount: EntityCount;
  campaignName: string;
  onCampaignNameChange: (name: string) => void;
  placeholder: string;
  password: string;
  onPasswordChange: (value: string) => void;
  confirmPassword: string;
  onConfirmPasswordChange: (value: string) => void;
  onSubmit: () => void;
}

export default function NameStep({
  title, sourceType, scenarioSynopsis, partySize, theme, entityCount, campaignName, onCampaignNameChange, placeholder,
  password, onPasswordChange, confirmPassword, onConfirmPasswordChange, onSubmit,
}: Props) {
  const entityLine = [
    entityCount.npc > 0 && `${entityCount.npc} NPCs`,
    entityCount.creature > 0 && `${entityCount.creature} creatures`,
    entityCount.faction > 0 && `${entityCount.faction} factions`,
    entityCount.location > 0 && `${entityCount.location} locations`,
  ].filter(Boolean).join(', ');

  return (
    <div className="create-step">
      <div className="modal-header">
        <h1 className="modal-title">{title}</h1>
        {entityLine && <p className="modal-hint">{entityLine}</p>}
      </div>
      <div className="create-badge-row">
        <TypeBadge sourceType={sourceType} />
        {partySize !== undefined && <Badge>Party of {partySize}</Badge>}
        {theme && <Badge>{theme}</Badge>}
      </div>
      {scenarioSynopsis && <p className="lobby-synopsis">{scenarioSynopsis}</p>}
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
          placeholder={placeholder}
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
