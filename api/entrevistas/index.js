// api/entrevistas/index.js
//
// Simulador de Entrevistas STAR — a diferencia de Bitácora y CV, este
// endpoint NO requiere sesión ni guarda nada en Supabase. Es la
// herramienta de "gancho gratuito" pensada para convertir hacia las
// asesorías de Tu Partner Laboral, así que la fricción de entrada debe
// ser cero: cualquiera puede practicar sin crear cuenta.
//
// CAMBIO DE SEGURIDAD: se agregó un control de abuso por IP (igual
// criterio que el plan Esencial de Match) — generoso, porque practicar
// varias veces en una sesión es legítimo, pero con un techo para que
// nadie pueda automatizarlo sin límite. Nunca bloquea si algo falla del
// lado del servidor (prioriza que la herramienta gratuita siga abierta).
//
// CAMBIO DE FORMATO: se agregó la regla anti-comillas que ya usan CV,
// Career y Profile Check — evita que el JSON se rompa cuando el modelo
// usa comillas dobles dentro de un valor de texto.

const SUPABASE_URL = 'https://pqelcrlxarendwearcwl.supabase.co';

// Máximo 20 evaluaciones por IP cada 24 horas — generoso para practicar
// varias respuestas en una sesión, pero acotado contra scripts.
async function verificarLimiteEntrevistas(ip) {
  if (!ip) return { ok: true };

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return { ok: true }; // si falta la config, no bloqueamos la herramienta gratuita

  const headers = { 'apikey': serviceKey, 'Authorization': `Bearer ${serviceKey}` };
  const VEINTICUATRO_HORAS_MS = 24 * 60 * 60 * 1000;
  const LIMITE = 20;

  try {
    const url = `${SUPABASE_URL}/rest/v1/entrevistas_usos?ip=eq.${encodeURIComponent(ip)}&select=ip,usos_hoy,ultimo_uso`;
    const r = await fetch(url, { headers });
    if (r.ok) {
      const rows = await r.json();
      const fila = Array.isArray(rows) ? rows[0] : null;
      if (fila?.ultimo_uso) {
        const desdeUltimoUso = Date.now() - new Date(fila.ultimo_uso).getTime();
        if (desdeUltimoUso < VEINTICUATRO_HORAS_MS) {
          if ((fila.usos_hoy || 0) >= LIMITE) {
            return { ok: false, error: 'Alcanzaste el límite de práctica gratuita por hoy. Vuelve mañana, o escríbenos a workea@tupartnerlaboral.cl para conversar sobre una asesoría de entrevistas.' };
          }
          await fetch(`${SUPABASE_URL}/rest/v1/entrevistas_usos`, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({ ip, usos_hoy: (fila.usos_hoy || 0) + 1, ultimo_uso: fila.ultimo_uso })
          });
          return { ok: true };
        }
      }
    }

    await fetch(`${SUPABASE_URL}/rest/v1/entrevistas_usos`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ ip, usos_hoy: 1, ultimo_uso: new Date().toISOString() })
    });
    return { ok: true };
  } catch (e) {
    console.error('Error verificando límite de entrevistas:', e);
    return { ok: true };
  }
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }
  try {
    const { accion, pregunta, respuesta } = req.body || {};
    if (accion !== 'evaluar') return res.status(400).json({ error: 'Acción desconocida' });
    if (!pregunta || !respuesta) return res.status(400).json({ error: 'pregunta y respuesta son obligatorias' });
    if (respuesta.trim().length < 20) {
      return res.status(400).json({ error: 'Tu respuesta es muy corta para evaluarla — cuenta un poco más' });
    }

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || null;
    const limite = await verificarLimiteEntrevistas(ip);
    if (!limite.ok) {
      return res.status(429).json({ error: limite.error });
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
  } catch (err) {
    console.error('entrevistas/index error:', err);
    return res.status(500).json({ error: 'Error interno: ' + (err.message || 'desconocido') });
  }
};
