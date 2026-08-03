// api/bitacora/agregar-objetivo.js
//
// POST — agrega un nuevo objetivo/rol de búsqueda (los chips del
// sidebar). Un solo campo obligatorio, coherente con el resto del
// diseño ("nunca más de 10 segundos").
//
// Body esperado (JSON):
// { cargo_objetivo: string }

const { getSupabaseForRequest } = require('./_supabaseClient');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { supabase, error: authError } = getSupabaseForRequest(req);
    if (authError) return res.status(401).json({ error: authError });

    const { cargo_objetivo } = req.body || {};
    if (!cargo_objetivo || !cargo_objetivo.trim()) {
      return res.status(400).json({ error: 'cargo_objetivo es obligatorio' });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return res.status(401).json({ error: userError?.message || 'Sesión inválida o expirada' });
    }

    const { data, error } = await supabase
      .from('bitacora_objetivos')
      .insert({ usuario_id: userData.user.id, cargo_objetivo: cargo_objetivo.trim() })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(201).json({ objetivo: data });

  } catch (err) {
    console.error('agregar-objetivo error:', err);
    return res.status(500).json({ error: 'Error interno: ' + (err.message || 'desconocido') });
  }
};
