import type { VercelRequest, VercelResponse } from '@vercel/node';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function supabaseFetch(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) throw new Error(`Supabase error: ${res.status}`);
  return res.json();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const userId = req.query.userId as string;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    const data = await supabaseFetch(
      `generations?user_id=eq.${userId}&order=created_at.desc&limit=100&select=id,type,matiere,niveau,sujet,contenu,is_favorite,created_at`
    );
    return res.status(200).json(data);
  } catch (err) {
    console.error('History error:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}
