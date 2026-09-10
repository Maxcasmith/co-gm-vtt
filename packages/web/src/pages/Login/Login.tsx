import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/Button/Button';
import { ContinueWithGoogleButton } from '../../components/Button/ContinueWithGoogle/ContinueWithGoogle';
import { Submit } from '../../components/Button/Submit/Submit';
import { Form } from '../../components/Form/Form';
import { Input } from '../../components/Input/Input';
import { ParchmentLayout } from '../../components/ParchmentLayout/ParchmentLayout';
import { PageHeader } from '../../components/PageHeader/PageHeader';
import { writeJourneySelection } from '../Signup/journeySession';
import api from '../../api/client';
import './Login.css';

const defaultForm = { email: '', password: '' };
type LoginField = keyof typeof defaultForm;

export function Login() {
  const navigate = useNavigate();
  const [loginError, setLoginError] = useState('');

  async function submit(form: typeof defaultForm) {
    setLoginError('');
    try {
      await api.auth.login(form);
      navigate('/profile');
    } catch (error) {
      console.error('Login failed:', error);
      setLoginError('Invalid email or password');
    }
  }

  return (
    <ParchmentLayout
      header={
        <PageHeader
          actions={<Button onClick={() => navigate('/signup')}>Sign Up</Button>}
        />
      }
      skeleton={
        <section className="login--hero">
          <div className="login--panel">
            <span className="skeleton login--skeleton--title" />
            <span className="skeleton login--skeleton--subtitle" />
            <span className="skeleton login--skeleton--field" />
            <span className="skeleton login--skeleton--field" />
            <span className="skeleton login--skeleton--submit" />
            <span className="skeleton login--skeleton--divider" />
            <span className="skeleton login--skeleton--submit" />
          </div>
        </section>
      }
    >
      <section className="login--hero">
        <div className="login--panel">
          <h1 className="login--panel--title">Welcome Back</h1>
          <p className="login--panel--subtitle">Log in to continue your adventure.</p>

          <Form defaultFormObject={defaultForm} submitAction={submit}>
            <div className="login--panel--fields">
              <Input<LoginField> name="email" label="Email" type="email" placeholder="you@example.com" className="login--panel--input" />
              <Input<LoginField> name="password" label="Password" type="password" placeholder="••••••••" className="login--panel--input" />
            </div>
            {loginError && <p className="login--panel--error">{loginError}</p>}
            <Submit className="login--panel--submit">Log In</Submit>
          </Form>

          <div className="login--panel--divider">
            <hr />
            <span>or</span>
            <hr />
          </div>

          <div className="login--panel--google">
            <ContinueWithGoogleButton
              onAuthenticated={code => {
                writeJourneySelection({ googleCode: code });
                navigate('/signup');
              }}
            />
          </div>
        </div>
      </section>
    </ParchmentLayout>
  );
}
