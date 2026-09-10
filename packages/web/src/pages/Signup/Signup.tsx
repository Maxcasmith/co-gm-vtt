import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { Submit } from '../../components/Button/Submit/Submit';
import { Form, useFormContext } from '../../components/Form/Form';
import { Modal } from '../../components/Modal/Modal';
import { ProductStep } from './steps/ProductStep';
import { InfoStep } from './steps/InfoStep';
import { PaymentStep } from './steps/PaymentStep';
import { TermsStep } from './steps/TermsStep';
import { STEPS, defaultSignupForm, type SignupForm } from './journeyForm';
import { consumeJourneySelection, consumePendingCampaignTags } from './journeySession';
import { redirectToClientCreate } from '../../createCampaignHandoff';
import api from '../../api/client';
import '../../styles/parchment.css';
import './Signup.css';

export function Signup() {
  const navigate = useNavigate();

  async function submit(form: SignupForm) {
    try {
      await api.auth.signup({
        productId: form.productId || undefined,
        ...(form.googleCode
          ? { googleCode: form.googleCode, scope: '' }
          : {
            firstName: form.firstName,
            lastName: form.lastName,
            email: form.email,
            password: form.password,
          }),
      });

      const pendingTags = consumePendingCampaignTags();
      if (pendingTags.length && form.productId === 'cloud') {
        redirectToClientCreate(pendingTags);
        return;
      }
      if (pendingTags.length && form.productId === 'desktop') {
        navigate('/profile', { state: { desktopCampaignTags: pendingTags } });
        return;
      }
      navigate('/profile');
    } catch (error) {
      console.error('Signup failed:', error);
      alert('Failed to complete signup');
    }
  }

  return (
    <Form defaultFormObject={defaultSignupForm} submitAction={submit}>
      <SignupJourney />
    </Form>
  );
}

function SignupJourney() {
  const navigate = useNavigate();
  const formContext = useFormContext() as
    | { form: SignupForm; formActive: boolean; setForm: (f: Partial<SignupForm>) => void }
    | undefined;
  const [stepIndex, setStepIndex] = useState(0);
  const [cancelOpen, setCancelOpen] = useState(false);
  const step = STEPS[stepIndex]!;
  const form = formContext?.form ?? defaultSignupForm;

  // Consumed exactly once per mount — the appliedRef guard keeps a StrictMode double-effect
  // from reading the (already-cleared) sessionStorage a second time and wiping the selection.
  const appliedSelection = useRef(false);
  useEffect(() => {
    if (appliedSelection.current) return;
    appliedSelection.current = true;
    const selection = consumeJourneySelection();
    if (selection.productId || selection.googleCode) {
      formContext?.setForm({
        ...(selection.productId && { productId: selection.productId }),
        ...(selection.googleCode && { googleCode: selection.googleCode }),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const canAdvance = step.id === 'product'
    ? form.productId !== ''
    : step.id === 'info'
    ? form.firstName.trim() !== '' && form.lastName.trim() !== '' && form.email.trim() !== ''
      && (form.googleCode !== '' || (form.password !== '' && form.password === form.confirmPassword))
    : step.id === 'payment'
    ? form.cardholderName.trim() !== '' && form.cardNumber.trim() !== ''
      && form.expiry.trim() !== '' && form.cvc.trim() !== ''
    : form.acceptedTerms;

  function goBack() {
    if (stepIndex > 0) setStepIndex(i => i - 1);
  }

  function goNext() {
    if (stepIndex < STEPS.length - 1) setStepIndex(i => i + 1);
  }

  return (
    <div className="journey--page parchment-shell">
      <aside className="journey--rail">
        <span className="journey--rail--wordmark">Untitled AI VTT</span>
        <ol className="journey--rail--steps">
          {STEPS.map((s, i) => (
            <li
              key={s.id}
              className={`journey--rail--step${i === stepIndex ? ' journey--rail--step--current' : ''}${i < stepIndex ? ' journey--rail--step--done' : ''}`}
            >
              {s.label}
            </li>
          ))}
        </ol>
      </aside>

      <div className="journey--main">
        <div className="journey--atmosphere" aria-hidden="true" />
        <div className={`journey--body${step.id === 'product' ? ' journey--body--wide' : ''}`}>
          <h1 className="journey--title">{step.label}</h1>
          {step.id === 'product' && <ProductStep />}
          {step.id === 'info' && <InfoStep />}
          {step.id === 'payment' && <PaymentStep />}
          {step.id === 'terms' && <TermsStep />}
        </div>

        <footer className="journey--footer">
          <Button variant="outline" color="danger" onClick={() => setCancelOpen(true)}>Cancel</Button>
          <div className="journey--footer--actions">
            <Button variant="outline" color="secondary" onClick={goBack} disabled={stepIndex === 0}>Back</Button>
            {step.id === 'terms' ? (
              <Submit disabled={!formContext?.formActive || !canAdvance}>Complete Signup</Submit>
            ) : (
              <Button onClick={goNext} disabled={!canAdvance}>Next</Button>
            )}
          </div>
        </footer>
      </div>

      <Modal isOpen={cancelOpen} onClose={() => setCancelOpen(false)}>
        <div className="journey--cancel-modal torn-parchment">
          <h2 className="journey--cancel-modal--title">Leave Signup?</h2>
          <p className="journey--cancel-modal--body">Your progress on this signup will be lost.</p>
          <div className="journey--cancel-modal--actions">
            <Button variant="outline" color="secondary" onClick={() => setCancelOpen(false)}>Keep Going</Button>
            <Button color="danger" onClick={() => navigate('/')}>Discard</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
