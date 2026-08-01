import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const VALID_TYPES = ['bug', 'idee', 'suggestion'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      console.error('Missing environment variables');
      return res.status(500).json({ error: 'Configuration serveur manquante.' });
    }

    const { userId, type, message, page } = req.body ?? {};

    if (!type || !VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Type de retour invalide.' });
    }
    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'Message requis.' });
    }

    const response = await fetch(`${SUPABASE_URL}/rest/v1/feedback`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal',
      },
      body: JSON.stringify({
        user_id: userId || null,
        type,
        message: message.trim().slice(0, 4000),
        page: typeof page === 'string' ? page.slice(0, 200) : null,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Supabase error ${response.status}: ${text}`);
    }

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Feedback error:', err);
    return res.status(500).json({ error: 'Erreur lors de l\'envoi du retour. Réessayez.' });
  }
}
