// api/bitacora/_supabaseClient.js
//
// Cliente compartido para los endpoints de Bitácora. A diferencia de
// analizar.js (que valida códigos con la service role key), acá usamos
// la ANON key + el token del propio usuario, para que las políticas RLS
// que ya definimos en el esquema (auth.uid() = usuario_id) se apliquen
// automáticamente — cada request solo puede tocar sus propios datos,
// sin que el backend tenga que verificarlo a mano.

const { createClient } = require('@supabase/supabase-js');

function getSupabaseForRequest(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');

  if (!token) {
    return { error: 'Falta el token de sesión (Authorization: Bearer <token>)' };
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY,
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  return { supabase };
}

module.exports = { getSupabaseForRequest };
