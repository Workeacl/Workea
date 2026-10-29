// api/keepalive.js
//
// Aviso automático (Vercel Cron) que consulta la base de datos una vez al día
// para que Supabase no la pause por falta de actividad (plan gratuito).
// No devuelve datos de usuarias: solo { ok: true }.

const SUPABASE_URL = 'https://pqelcrlxarendwearcwl.supabase.co';

module.exports = async (req, res) => {
  // Si defines CRON_SECRET en Vercel, solo Vercel puede llamar a este endpoint.
  const secreto = process.env.CRON_SECRET;
  if (secreto && req.headers.authorization !== `Bearer ${secreto}`) {
    return res.status(401).json({ ok: false });
  }

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return res.status(500).json({ ok: false, error: 'Falta SUPABASE_SERVICE_ROLE_KEY' });

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/codigos?select=codigo&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }
    });
    return res.status(r.ok ? 200 : 502).json({ ok: r.ok });
  } catch (e) {
    return res.status(502).json({ ok: false });
  }
};
