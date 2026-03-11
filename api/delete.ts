import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'DELETE') return res.status(405).json({ error: 'Method not allowed' });

  const { id, userId } = req.body;
  if (!id || !userId) return res.status(400).json({ error: 'id and userId required' });

  try {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/generations?id=eq.${id}&user_id=eq.${userId}`,
      {
        method: 'DELETE',
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Prefer': 'return=minimal',
        },
      }
    );

    if (!response.ok) throw new Error(`Supabase error: ${response.status}`);
    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Delete error:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}
