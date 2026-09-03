// api/entrevistas/index.js
//
// Simulador de Entrevistas STAR — beneficio incluido con Workea CV
// planes Optimizado o Pro, NO una herramienta gratuita abierta a
// cualquiera (a diferencia de lo que decía el comentario original
// de este archivo — el frontend real siempre exigió una orden paga).
//
// CAMBIO DE SEGURIDAD: antes, el "candado" de acceso vivía solo en el
// frontend, revisando si la URL tenía CUALQUIER texto en ?orden_id= y
// ?plan= — sin verificar que esa orden existiera ni estuviera pagada.
// Cualquiera podía escribir la URL a mano y entrar gratis. Ahora se
// valida la orden real contra Supabase antes de dar acceso o evaluar.
//
// CAMBIO DE DISEÑO: las "historias reales" del usuario (banco_historias)
// ya no viajan como un parámetro largo en la URL (fácil de alterar) —
// se leen directo desde la orden real en Supabase.

const SUPABASE_URL = 'https://pqelcrlxarendwearcwl.supabase.co';
const PLANES_CON_ACCESO = ['optimizado', 'pro'];

async function obtenerOrdenValida(ordenId) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return { ok: false, status: 500, error: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en Vercel' };
  }
  if (!ordenId) {
    return { ok: false, status: 401, error: 'Acceso inválido: falta la orden.' };
  }

  const headers = { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` };
  const url = `${SUPABASE_URL}/rest/v1/cv_ordenes?id=eq.${encodeURIComponent(ordenId)}&select=id,plan,estado,banco_historias`;
  const r = await fetch(url, { headers });
  if (!r.ok) return { ok: false, status: 502, error: 'No se pudo verificar tu acceso. Intenta de nuevo.' };

  const rows = await r.json();
  const orden = Array.isArray(rows) ? rows[0] : null;
  if (!orden) {
    return { ok: false, status: 401, error: 'No encontramos esa orden. Este beneficio es exclusivo de Workea CV.' };
  }
  if (orden.estado !== 'completo') {
    return { ok: false, status: 401, error: 'Termina tu CV en Workea CV (incluido tu mensaje de presentación) para desbloquear esta práctica.' };
  }
  if (!PLANES_CON_ACCESO.includes(orden.plan)) {
    return { ok: false, status: 401, error: 'Este beneficio está incluido solo en los planes Optimizado y Pro de Workea CV.' };
  }

  return { ok: true, orden };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }
  try {
    const { accion, orden_id, pregunta, respuesta } = req.body || {};

    // ===== Verificar acceso y entregar las historias reales =====
    if (accion === 'verificar_acceso') {
      const resultado = await obtenerOrdenValida(orden_id);
      if (!resultado.ok) return res.status(resultado.status).json({ error: resultado.error });
      return res.status(200).json({ ok: true, historias: resultado.orden.banco_historias || [] });
    }

    // ===== Evaluar una respuesta (exige la misma orden válida) =====
    if (accion === 'evaluar') {
      const resultado = await obtenerOrdenValida(orden_id);
      if (!resultado.ok) return res.status(resultado.status).json({ error: resultado.error });

      if (!pregunta || !respuesta) return res.status(400).json({ error: 'pregunta y respuesta son obligatorias' });
      if (respuesta.trim().length < 20) {
        return res.status(400).json({ error: 'Tu respuesta es muy corta para evaluarla — cuenta un poco más' });
      }

      const prompt = `Eres una psicóloga laboral especializada en entrevistas de trabajo. Evalúa esta respuesta de un candidato a una pregunta de entrevista conductual, usando el método STAR (Situación, Tarea, Acción, Resultado).
Pregunta: "${pregunta}"
Respuesta del candidato:
"""
${respuesta}
"""
Evalúa ÚNICAMENTE lo que el candidato escribió — no inventes ni asumas información que no está ahí. Para cada elemento STAR, indica si está presente, parcialmente presente, o ausente, con una nota breve basada en el texto real.
IMPORTANTE SOBRE EL FORMATO: dentro de cualquier valor de texto del JSON, nunca uses comillas dobles ("). Si necesitas citar una palabra o frase del candidato, usa comillas simples ('así') o simplemente omite las comillas. Comillas dobles sin escapar dentro de un valor de texto rompen el JSON completo.
Responde en JSON puro, sin texto adicional:
{
  "score": <número 0-100>,
  "situacion": {"presente": true/false, "nota": "comentario breve"},
  "tarea": {"presente": true/false, "nota": "comentario breve"},
  "accion": {"presente": true/false, "nota": "comentario breve"},
  "resultado": {"presente": true/false, "nota": "comentario breve"},
  "sugerencia_principal": "el consejo más importante para mejorar esta respuesta específica"
}`;
      const aiRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 900,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (!aiRes.ok) {
        const errText = await aiRes.text();
        console.error('Anthropic API error:', errText);
        return res.status(502).json({ error: 'No pudimos evaluar tu respuesta en este momento. Intenta de nuevo en un rato.' });
      }
      const data = await aiRes.json();
      let texto = data?.content?.[0]?.text || '{}';
      texto = texto.replace(/```json/gi, '').replace(/```/g, '').trim();
      if (data?.stop_reason === 'max_tokens') {
        console.error('Respuesta cortada por max_tokens:', texto);
        return res.status(502).json({ error: 'La evaluación quedó incompleta — intenta de nuevo' });
      }
      let evaluacion;
      try {
        evaluacion = JSON.parse(texto);
      } catch (e) {
        const match = texto.match(/\{[\s\S]*\}/);
        if (match) {
          try { evaluacion = JSON.parse(match[0]); } catch (e2) { /* cae abajo */ }
        }
        if (!evaluacion) {
          console.error('No se pudo parsear la evaluación:', texto);
          return res.status(502).json({ error: 'No se pudo interpretar la evaluación' });
        }
      }
      return res.status(200).json({ evaluacion });
    }

    return res.status(400).json({ error: 'Acción desconocida' });
  } catch (err) {
    console.error('entrevistas/index error:', err);
    return res.status(500).json({ error: 'Error interno: ' + (err.message || 'desconocido') });
  }
};
