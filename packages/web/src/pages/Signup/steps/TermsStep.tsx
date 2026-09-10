import { useFormContext } from '../../../components/Form/Form';
import type { SignupForm } from '../journeyForm';

// Placeholder copy — swap for the real Terms of Service before this ships.
const TERMS_TEXT = `
By creating an account you agree to these placeholder Terms of Service. This text stands in for
the real agreement and should be replaced before launch.

1. Your account and any campaigns, characters, or content you create remain yours.
2. Subscriptions renew automatically until cancelled; one-time licenses are billed once.
3. Don't abuse the service, attempt to circumvent usage limits, or share account access.
4. We may update these terms; material changes will be communicated before they take effect.
5. Either party may terminate the agreement at any time per the cancellation terms in your account settings.
`.trim();

export function TermsStep() {
  const formContext = useFormContext() as
    | { form: SignupForm; setForm: (f: Partial<SignupForm>) => void }
    | undefined;
  const accepted = formContext?.form.acceptedTerms ?? false;

  return (
    <div className="journey--terms">
      <div className="journey--terms--box torn-parchment">
        {TERMS_TEXT.split('\n\n').map(paragraph => (
          <p key={paragraph}>{paragraph}</p>
        ))}
      </div>

      <label className="journey--terms--checkbox">
        <input
          type="checkbox"
          checked={accepted}
          onChange={e => formContext?.setForm({ acceptedTerms: e.target.checked })}
        />
        I have read and agree to the Terms of Service and Privacy Policy.
      </label>
    </div>
  );
}
