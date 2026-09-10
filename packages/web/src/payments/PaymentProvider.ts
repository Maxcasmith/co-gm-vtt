export interface PaymentDetails {
  cardholderName: string;
  cardNumber: string;
  expiry: string;
  cvc: string;
}

export interface PaymentResult {
  token: string;
}

// Contract for whichever payment processor gets wired in later (Stripe, Paddle, ...).
// No concrete implementation yet — the payment step takes an optional provider and
// falls back to a stub until one is plugged in.
export abstract class PaymentProvider {
  abstract readonly name: string;
  abstract collectPayment(details: PaymentDetails): Promise<PaymentResult>;
}
