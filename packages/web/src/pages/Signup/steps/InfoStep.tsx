import { ContinueWithGoogleButton } from '../../../components/Button/ContinueWithGoogle/ContinueWithGoogle';
import { useFormContext } from '../../../components/Form/Form';
import { Input } from '../../../components/Input/Input';
import type { SignupForm } from '../journeyForm';

type Field = keyof Pick<SignupForm, 'firstName' | 'lastName' | 'email' | 'password' | 'confirmPassword'>;

export function InfoStep() {
  const formContext = useFormContext() as
    | { form: SignupForm; setForm: (f: Partial<SignupForm>) => void }
    | undefined;
  const googleLinked = (formContext?.form.googleCode ?? '') !== '';

  return (
    <div className="journey--fields">
      <div className="journey--fields--row">
        <Input<Field> name="firstName" label="First Name" className="journey--input" />
        <Input<Field> name="lastName" label="Last Name" className="journey--input" />
      </div>
      <Input<Field> name="email" label="Email" type="email" placeholder="you@example.com" className="journey--input" />

      {googleLinked && (
        <p className="journey--google-linked">Signed in with Google — no password needed.</p>
      )}
      <Input<Field>
        name="password"
        label="Password"
        type="password"
        placeholder="••••••••"
        className="journey--input"
        disabled={googleLinked}
      />
      <Input<Field>
        name="confirmPassword"
        label="Confirm Password"
        type="password"
        placeholder="••••••••"
        className="journey--input"
        disabled={googleLinked}
      />

      <div className="journey--divider">
        <hr />
        <span>or</span>
        <hr />
      </div>

      <div className="journey--google">
        <ContinueWithGoogleButton
          onAuthenticated={code => formContext?.setForm({ googleCode: code, password: '', confirmPassword: '' })}
        />
      </div>
    </div>
  );
}
