// api/bitacora/eliminar-postulacion.js
//
// POST — elimina una postulación completa (y sus eventos de timeline,
// vía ON DELETE CASCADE ya definido en el esquema). Para cuando alguien
// se equivocó al agregarla o simplemente quiere quitarla.
//
// Body esperado (JSON):
// { postulacion_id: string }

const { getSupabaseForRequest } = require('./_supabaseClient');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { supabase, error: authError } = getSupabaseForRequest(req);
    if (authError) return res.status(401).json({ error: authError });

    const { postulacion_id } = req.body || {};
    if (!postulacion_id) {
      return res.status(400).json({ error: 'postulacion_id es obligatorio' });
    }

    const { error, count } = await supabase
      .from('postulaciones')
      .delete({ count: 'exact' })
      .eq('id', postulacion_id);

    if (error) {
      return res.status(500).json({ error: error.message });
    }
    if (count === 0) {
      // RLS bloqueó el delete (no es tuya) o no existe
      return res.status(404).json({ error: 'Postulación no encontrada' });
    }

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('eliminar-postulacion error:', err);
    return res.status(500).json({ error: 'Error interno: ' + (err.message || 'desconocido') });
  }
};
