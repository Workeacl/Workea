// api/bitacora/editar-postulacion.js
//
// POST — corrige datos de una postulación ya creada (típicamente
// empresa/cargo mal tipeados). Solo actualiza los campos que vengan
// en el body — no pisa el resto con null.
//
// Body esperado (JSON):
// {
//   postulacion_id: string,   (obligatorio)
//   empresa?: string,
//   cargo?: string,
//   modalidad?: 'presencial'|'remoto'|'hibrido',
//   seniority?: string,
//   link_oferta?: string
// }

const { getSupabaseForRequest } = require('./_supabaseClient');

const CAMPOS_EDITABLES = ['empresa', 'cargo', 'modalidad', 'seniority', 'link_oferta'];

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { supabase, error: authError } = getSupabaseForRequest(req);
    if (authError) return res.status(401).json({ error: authError });

    const { postulacion_id, ...cambios } = req.body || {};
    if (!postulacion_id) {
      return res.status(400).json({ error: 'postulacion_id es obligatorio' });
    }

    const update = {};
    for (const campo of CAMPOS_EDITABLES) {
      if (cambios[campo] !== undefined) update[campo] = cambios[campo];
    }
    if (Object.keys(update).length === 0) {
      return res.status(400).json({ error: 'No hay campos para actualizar' });
    }
    if ('empresa' in update && !update.empresa.trim()) {
      return res.status(400).json({ error: 'Empresa no puede quedar vacía' });
    }
    if ('cargo' in update && !update.cargo.trim()) {
      return res.status(400).json({ error: 'Cargo no puede quedar vacío' });
    }

    const { data, error } = await supabase
      .from('postulaciones')
      .update(update)
      .eq('id', postulacion_id)
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    return res.status(200).json({ postulacion: data });

  } catch (err) {
    console.error('editar-postulacion error:', err);
    return res.status(500).json({ error: 'Error interno: ' + (err.message || 'desconocido') });
  }
};
