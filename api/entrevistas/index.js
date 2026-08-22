// api/entrevistas/index.js
//
// Simulador de Entrevistas STAR — a diferencia de Bitácora y CV, este
// endpoint NO requiere sesión ni guarda nada en Supabase. Es la
// herramienta de "gancho gratuito" pensada para convertir hacia las
// asesorías de Tu Partner Laboral, así que la fricción de entrada debe
// ser cero: cualquiera puede practicar sin crear cuenta.
//
// POST /api/entrevistas   { accion: 'evaluar', pregunta, respuesta }

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

    const prompt = `Eres una psicóloga laboral especializada en entrevistas de trabajo. Evalúa esta respuesta de un candidato a una pregunta de entrevista conductual, usando el método STAR (Situación, Tarea, Acción, Resultado).

Pregunta: "${pregunta}"

Respuesta del candidato:
"""
${respuesta}
"""

Evalúa ÚNICAMENTE lo que el candidato escribió — no inventes ni asumas información que no está ahí. Para cada elemento STAR, indica si está presente, parcialmente presente, o ausente, con una nota breve basada en el texto real.

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
