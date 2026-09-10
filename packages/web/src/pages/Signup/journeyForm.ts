export interface SignupForm {
  productId: '' | 'cloud' | 'desktop';
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
  /** OAuth code from "Continue with Google" — non-empty means password auth is skipped. */
  googleCode: string;
  cardholderName: string;
  cardNumber: string;
  expiry: string;
  cvc: string;
  acceptedTerms: boolean;
}

export const defaultSignupForm: SignupForm = {
  productId: '',
  firstName: '',
  lastName: '',
  email: '',
  password: '',
  confirmPassword: '',
  googleCode: '',
  cardholderName: '',
  cardNumber: '',
  expiry: '',
  cvc: '',
  acceptedTerms: false,
};

export const STEPS = [
  { id: 'product', label: 'Choose Plan' },
  { id: 'info', label: 'Your Info' },
  { id: 'payment', label: 'Payment Information' },
  { id: 'terms', label: 'Terms of Service' },
] as const;

export type StepId = typeof STEPS[number]['id'];
