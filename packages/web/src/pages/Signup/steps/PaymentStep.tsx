import { Button } from '../../../components/Button/Button';
import { Input } from '../../../components/Input/Input';
import { AmazonIcon, AppleIcon, GoogleIcon, PayPalIcon } from '../../../components/icons/Icons';
import type { SignupForm } from '../journeyForm';

type Field = keyof Pick<SignupForm, 'cardholderName' | 'cardNumber' | 'expiry' | 'cvc'>;

const EXPRESS_PAYMENT_OPTIONS = [
  { id: 'paypal', label: 'Pay with PayPal', icon: PayPalIcon, brandClass: 'journey--pay-btn--paypal' },
  { id: 'apple', label: 'Pay with Apple Pay', icon: AppleIcon, brandClass: 'journey--pay-btn--apple' },
  { id: 'google', label: 'Pay with Google Pay', icon: GoogleIcon, brandClass: 'journey--pay-btn--google' },
  { id: 'amazon', label: 'Pay with Amazon Pay', icon: AmazonIcon, brandClass: 'journey--pay-btn--amazon' },
] as const;

// Card fields + express buttons are UI only — no real processor wired in yet. See
// ../../../payments/PaymentProvider.ts for the contract a real provider will implement.
export function PaymentStep() {
  return (
    <div className="journey--fields">
      <div className="journey--pay-buttons">
        {EXPRESS_PAYMENT_OPTIONS.map(opt => (
          <Button
            key={opt.id}
            className={`journey--pay-btn ${opt.brandClass}`}
            leftIcon={<opt.icon className="journey--pay-btn--icon" />}
            onClick={() => console.log(`${opt.label} — not wired up yet`)}
          >
            {opt.label}
          </Button>
        ))}
      </div>

      <div className="journey--divider">
        <hr />
        <span>or pay by card</span>
        <hr />
      </div>

      <Input<Field> name="cardholderName" label="Cardholder Name" className="journey--input" />
      <Input<Field> name="cardNumber" label="Card Number" placeholder="•••• •••• •••• ••••" className="journey--input" />
      <div className="journey--fields--row">
        <Input<Field> name="expiry" label="Expiry" placeholder="MM/YY" className="journey--input" />
        <Input<Field> name="cvc" label="CVC" placeholder="•••" className="journey--input" />
      </div>

      <p className="journey--powered-by">Powered by Stripe</p>
    </div>
  );
}
