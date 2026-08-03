// api/bitacora/eliminar-evento.js
//
// POST — elimina un evento del timeline (para deshacer un cambio de
// estado por error, ej. tocaste "Rechazado" sin querer). El trigger de
// la base de datos solo actualiza estado_actual al INSERTAR, así que
// acá recalculamos a mano cuál es el estado vigente después de borrar.
//
// Body esperado (JSON): { evento_id: string }

const { getSupabaseForRequest } = require('./_supabaseClient');

const TIPOS_ESTADO = [
  'postule', 'me_contactaron', 'entrevista_rrhh', 'entrevista_tecnica',
  'entrevista_final', 'evaluacion', 'oferta_recibida', 'rechazado',
  'cancele_proceso', 'otro_paso'
];

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { supabase, error: authError } = getSupabaseForRequest(req);
    if (authError) return res.status(401).json({ error: authError });

    const { evento_id } = req.body || {};
    if (!evento_id) {
      return res.status(400).json({ error: 'evento_id es obligatorio' });
    }

    // Necesitamos saber a qué postulación pertenecía antes de borrarlo
    const { data: evento, error: findError } = await supabase
      .from('timeline_eventos')
      .select('postulacion_id')
      .eq('id', evento_id)
      .single();

    if (findError || !evento) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }
    const postulacionId = evento.postulacion_id;

    const { error: delError } = await supabase
      .from('timeline_eventos')
      .delete()
      .eq('id', evento_id);

    if (delError) {
      return res.status(500).json({ error: delError.message });
    }

    // Recalcular estado_actual: el evento de tipo-estado más reciente
    // que quede en el timeline de esta postulación.
    const { data: restantes } = await supabase
      .from('timeline_eventos')
      .select('tipo_evento, fecha, creado_en')
      .eq('postulacion_id', postulacionId)
      .in('tipo_evento', TIPOS_ESTADO.filter(t => t !== 'otro_paso'))
      .order('fecha', { ascending: false })
      .order('creado_en', { ascending: false })
      .limit(1);

    if (restantes && restantes.length > 0) {
      await supabase
        .from('postulaciones')
        .update({ estado_actual: restantes[0].tipo_evento })
        .eq('id', postulacionId);
    }
    // Si no queda ningún evento de estado, dejamos estado_actual como
    // está — evita que una postulación quede sin estado válido.

    return res.status(200).json({ ok: true });

  } catch (err) {
    console.error('eliminar-evento error:', err);
    return res.status(500).json({ error: 'Error interno: ' + (err.message || 'desconocido') });
  }
};
