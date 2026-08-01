import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { MessageCircle, X, Bug, Lightbulb, Sparkles, Loader2, Check } from 'lucide-react';
import { useCurrentUser } from '@/lib/auth';
import { apiSendFeedback, type FeedbackType } from '@/lib/api';

const TYPES: { value: FeedbackType; label: string; icon: typeof Bug }[] = [
  { value: 'bug', label: 'Bug', icon: Bug },
  { value: 'idee', label: 'Idée', icon: Lightbulb },
  { value: 'suggestion', label: 'Suggestion', icon: Sparkles },
];

// Bouton discret permettant à un testeur Alpha d'envoyer un retour à tout moment.
export default function FeedbackButton() {
  const { user } = useCurrentUser();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>('idee');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setOpen(false);
    setTimeout(() => { setSent(false); setMessage(''); setError(null); setType('idee'); }, 200);
  };

  const handleSubmit = async () => {
    if (!message.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      await apiSendFeedback({
        userId: user?.id,
        type,
        message: message.trim(),
        page: location.pathname,
      });
      setSent(true);
      setTimeout(close, 1800);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur lors de l\'envoi.');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full bg-mg-800 border border-white/10 text-mg-300 text-xs font-medium shadow-lg hover:text-accent hover:border-accent/25 transition-all"
      >
        <MessageCircle size={14} /> Envoyer un retour
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={close} />
          <div className="card relative w-full max-w-md p-6 animate-fade-in">
            <button onClick={close} className="absolute top-4 right-4 text-mg-400 hover:text-mg-100">
              <X size={18} />
            </button>

            {sent ? (
              <div className="text-center py-6">
                <div className="w-12 h-12 rounded-full bg-success/10 border border-success/20 flex items-center justify-center mx-auto mb-4">
                  <Check size={22} className="text-success" />
                </div>
                <p className="text-white font-semibold mb-1">Merci pour votre retour !</p>
                <p className="text-sm text-mg-400">Il a bien été transmis à l'équipe Magistra.</p>
              </div>
            ) : (
              <>
                <h2 className="text-lg text-white mb-1" style={{ fontFamily: 'var(--font-display)' }}>
                  Envoyer un retour
                </h2>
                <p className="text-xs text-mg-400 mb-4">
                  Un bug, une idée, une suggestion ? Chaque retour aide à améliorer Magistra.
                </p>

                <div className="grid grid-cols-3 gap-2 mb-4">
                  {TYPES.map(t => (
                    <button
                      key={t.value}
                      onClick={() => setType(t.value)}
                      className={`p-2.5 rounded-lg text-center border transition-all ${
                        type === t.value ? 'bg-accent/10 border-accent/25 text-white' : 'bg-mg-700 border-white/5 text-mg-300 hover:border-white/10'
                      }`}
                    >
                      <t.icon size={15} className={`mx-auto mb-1 ${type === t.value ? 'text-accent' : ''}`} />
                      <span className="text-xs">{t.label}</span>
                    </button>
                  ))}
                </div>

                <textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  rows={4}
                  placeholder="Décrivez votre retour le plus précisément possible…"
                  className="input-field resize-none text-sm"
                  autoFocus
                />

                {error && <p className="text-xs text-danger mt-2">{error}</p>}

                <button
                  onClick={handleSubmit}
                  disabled={!message.trim() || sending}
                  className="btn-primary w-full justify-center mt-4 py-2.5 text-sm"
                >
                  {sending ? <><Loader2 size={15} className="animate-spin" /> Envoi…</> : 'Envoyer'}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
