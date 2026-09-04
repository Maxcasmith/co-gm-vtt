import InfoTooltip from './InfoTooltip.tsx';
import { passwordsMismatch } from './passwordUtils.ts';

interface Props {
  password: string;
  onPasswordChange: (value: string) => void;
  confirmPassword: string;
  onConfirmPasswordChange: (value: string) => void;
}

export default function PasswordFields({
  password, onPasswordChange, confirmPassword, onConfirmPasswordChange,
}: Props) {
  return (
    <>
      <label className="modal-label">
        <span className="create-label-row">
          Game Password
          <InfoTooltip text="Players must enter this to join. Leave both fields blank for an open game." />
        </span>
        <input
          className="modal-input"
          type="password"
          value={password}
          onChange={e => onPasswordChange(e.target.value)}
          placeholder="Optional — leave blank for no password"
        />
      </label>
      <label className="modal-label">
        Confirm Password
        <input
          className="modal-input"
          type="password"
          value={confirmPassword}
          onChange={e => onConfirmPasswordChange(e.target.value)}
          placeholder="Repeat the password"
        />
      </label>
      {passwordsMismatch(password, confirmPassword) && (
        <p className="modal-error">Passwords don&apos;t match.</p>
      )}
    </>
  );
}
