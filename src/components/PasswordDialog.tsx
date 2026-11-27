import { useState } from 'react';
import { KeyRound, LogOut } from 'lucide-react';
import { useStore } from '../context/Store';
import { Button, Field, InfoBanner, Modal } from './UI';

/**
 * Live mode: change the signed-in user's password. When the account still has a temporary password
 * from an administrator (`required`), the dialog cannot be dismissed; the only other choice is to sign out.
 */
export function PasswordDialog({ open, onClose, required, onSignOut }: { open: boolean; onClose: () => void; required: boolean; onSignOut: () => void }) {
  const { changePassword, user } = useStore();
  const [current, setCurrent] = useState(''); const [next, setNext] = useState(''); const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const reset = () => { setCurrent(''); setNext(''); setConfirm(''); setError(''); };
  const submit = async () => {
    if (!current) { setError('Enter your current password'); return; }
    if (next.length < 8 || !/[A-Za-z]/.test(next) || !/\d/.test(next)) { setError('Use at least 8 characters with at least one letter and one digit'); return; }
    if (next !== confirm) { setError('The two new passwords do not match'); return; }
    setBusy(true);
    const problem = await changePassword(current, next);
    setBusy(false);
    if (problem) { setError(problem); return; }
    reset(); onClose();
  };
  const expires = user?.passwordExpiresAt ? new Date(user.passwordExpiresAt).toLocaleString() : null;
  return <Modal open={open} onClose={() => { if (!required) { reset(); onClose(); } }}
    title={required ? 'Choose a new password' : 'Change password'}
    description={required ? 'Your account uses a temporary password from an administrator' : `Signed in as ${user?.email ?? ''}`}
    footer={<>{required
      ? <Button variant="secondary" onClick={() => { reset(); onSignOut(); }}><LogOut size={16} /> Sign out</Button>
      : <Button variant="secondary" onClick={() => { reset(); onClose(); }}>Cancel</Button>}
      <Button onClick={() => void submit()} disabled={busy}><KeyRound size={16} /> {busy ? 'Saving…' : 'Change password'}</Button></>}>
    <div className="modal-fields">
      {required && <InfoBanner variant="warning">Choose your own password before you continue.{expires ? ` The temporary password stops working on ${expires}.` : ''}</InfoBanner>}
      <Field label={required ? 'Temporary password' : 'Current password'}><input type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} /></Field>
      <Field label="New password"><input type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} placeholder="At least 8 characters, a letter and a digit" /></Field>
      <Field label="Confirm new password"><input type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void submit(); }} /></Field>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  </Modal>;
}
