import { useEffect, useState } from 'react';
import { Form, useFormContext } from '../../components/Form/Form';
import { Input } from '../../components/Input/Input';
import { Submit } from '../../components/Button/Submit/Submit';
import { Button } from '../../components/Button/Button';
import { ParchmentLayout } from '../../components/ParchmentLayout/ParchmentLayout';
import { SignedInHeader } from '../../components/SignedInHeader/SignedInHeader';
import api from '../../api/client';
import './Settings.css';

const defaultPasswordForm = { currentPassword: '', newPassword: '', confirmPassword: '' };
type PasswordField = keyof typeof defaultPasswordForm;

function ChangePasswordSection() {
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  async function submit(form: typeof defaultPasswordForm) {
    setError('');
    setSuccess(false);

    if (form.newPassword !== form.confirmPassword) {
      setError('New passwords do not match');
      return;
    }

    try {
      await api.auth.changePassword({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      setSuccess(true);
    } catch (err) {
      console.error('Change password failed:', err);
      setError('Current password is incorrect');
    }
  }

  return (
    <section className="settings--section">
      <h2 className="settings--section-title">Change Password</h2>
      <Form defaultFormObject={defaultPasswordForm} submitAction={submit}>
        <PasswordFields error={error} success={success} />
      </Form>
    </section>
  );
}

function PasswordFields({ error, success }: { error: string; success: boolean }) {
  const formContext = useFormContext() as
    | { form: typeof defaultPasswordForm; formActive: boolean }
    | undefined;

  return (
    <div className="settings--password-form">
      <Input<PasswordField> name="currentPassword" label="Current Password" type="password" placeholder="••••••••" />
      <Input<PasswordField> name="newPassword" label="New Password" type="password" placeholder="••••••••" />
      <Input<PasswordField> name="confirmPassword" label="Confirm New Password" type="password" placeholder="••••••••" />
      {error && <p className="settings--password-error">{error}</p>}
      {success && <p className="settings--password-success">Password updated.</p>}
      <Submit disabled={!formContext?.formActive}>Update Password</Submit>
    </div>
  );
}

interface Session {
  id: string;
  createdAt: string;
  expiresAt: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function SessionsSection() {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  useEffect(() => {
    api.auth.sessions().then(setSessions).catch(() => setSessions([]));
  }, []);

  async function revoke(id: string) {
    setRevokingId(id);
    try {
      await api.auth.revokeSession(id);
      setSessions(prev => (prev ?? []).filter(s => s.id !== id));
    } catch (err) {
      console.error('Revoke session failed:', err);
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <section className="settings--section">
      <h2 className="settings--section-title">Current Sessions</h2>
      {sessions === null && <p className="settings--sessions-empty">Loading…</p>}
      {sessions !== null && sessions.length === 0 && <p className="settings--sessions-empty">No open sessions.</p>}
      {sessions !== null && sessions.length > 0 && (
        <ul className="settings--sessions-list">
          {sessions.map(s => (
            <li className="settings--session-row" key={s.id}>
              <div>
                <p className="settings--session-started">Started {formatDate(s.createdAt)}</p>
                <p className="settings--session-expires">Expires {formatDate(s.expiresAt)}</p>
              </div>
              <Button
                variant="outline"
                color="danger"
                disabled={revokingId === s.id}
                onClick={() => revoke(s.id)}
              >
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Settings() {
  return (
    <ParchmentLayout
      header={<SignedInHeader />}
      skeleton={<section className="settings--body" />}
    >
      <section className="settings--body parchment-container">
        <h1 className="settings--title">Settings</h1>
        <ChangePasswordSection />
        <hr className="settings--divider" />
        <SessionsSection />
      </section>
    </ParchmentLayout>
  );
}
