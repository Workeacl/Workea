// api/bitacora/crear-postulacion.js
//
// POST — crea una postulación nueva. Cubre las 3 formas definidas en el
// diseño: origen 'match' (todo viene ya calculado de Workea Match),
// 'link' (la IA ya extrajo los datos antes de llamar a este endpoint) y
// 'manual' (solo empresa + cargo, el resto queda null).
//
// Body esperado (JSON):
// {
//   empresa: string,            (obligatorio)
//   cargo: string,               (obligatorio)
//   origen: 'match'|'link'|'manual',
//   link_oferta?: string,
//   modalidad?: 'presencial'|'remoto'|'hibrido',
//   seniority?: string,
//   compatibilidad?: number,     (0-100, solo si origen = 'match')
//   cv_usado_id?: string,
//   palabras_clave?: string[],
//   objetivo_id?: string
// }

const { getSupabaseForRequest } = require('./_supabaseClient');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  try {
    const { supabase, error: authError } = getSupabaseForRequest(req);
    if (authError) return res.status(401).json({ error: authError });

    const {
      empresa,
      cargo,
      origen = 'manual',
      link_oferta = null,
      modalidad = null,
      seniority = null,
      compatibilidad = null,
      cv_usado_id = null,
      palabras_clave = null,
      objetivo_id = null
    } = req.body || {};

    // Validación mínima — coherente con "nunca más de 2 campos obligatorios"
    if (!empresa || !cargo) {
      return res.status(400).json({ error: 'empresa y cargo son obligatorios' });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return res.status(401).json({ error: userError?.message || 'Sesión inválida o expirada' });
    }

    const { data, error } = await supabase
      .from('postulaciones')
      .insert({
        usuario_id: userData.user.id,
        empresa,
        cargo,
        origen,
        link_oferta,
        modalidad,
        seniority,
        compatibilidad,
        cv_usado_id,
        palabras_clave,
        objetivo_id,
        estado_actual: 'postule'
      })
      .select()
      .single();

    if (error) {
      return res.status(500).json({ error: error.message });
    }

    // Registrar el primer evento del timeline ("Postulaste")
    await supabase.from('timeline_eventos').insert({
      postulacion_id: data.id,
      tipo_evento: 'postule'
    });

    return res.status(201).json({ postulacion: data });

  } catch (err) {
    // Cualquier excepción inesperada (ej. fallo de red con Supabase, error
    // de formato en el token) queda capturada acá — nunca dejamos que la
    // función se caiga sin control devolviendo HTML en vez de JSON.
    console.error('crear-postulacion error:', err);
    return res.status(500).json({ error: 'Error interno: ' + (err.message || 'desconocido') });
  }
};
