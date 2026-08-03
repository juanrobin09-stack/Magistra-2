import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL!;
const sql = neon(DATABASE_URL || '');

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const userId = req.query.userId as string;
  if (!userId) return res.status(400).json({ error: 'userId required' });

  try {
    if (!DATABASE_URL) {
      console.error('Missing environment variables');
      return res.status(500).json({ error: 'Configuration serveur manquante.' });
    }

    const rows = await sql`
      SELECT id, type, matiere, niveau, sujet, contenu, is_favorite, created_at
      FROM generations
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT 100
    `;
    return res.status(200).json(rows);
  } catch (err) {
    console.error('History error:', err);
    return res.status(500).json({ error: 'Erreur serveur.' });
  }
}
