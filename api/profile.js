// api/profile.js — Workea Profile Check
// Análisis de perfil LinkedIn independiente de analizar.js y recruiter.js

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  const { texto, codigo } = req.body || {};

  const listaCodigos = (process.env.WORKEA_CODIGO || '')
    .split(',').map(c => c.trim()).filter(Boolean);
  if (listaCodigos.length && !listaCodigos.includes((codigo || '').trim())) {
    return res.status(401).json({ error: 'Código de acceso inválido' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Falta ANTHROPIC_API_KEY' });

  const textoRec = String(texto || '').trim();
  if (!textoRec || textoRec.length < 50) {
    return res.status(400).json({ error: 'El perfil ingresado es muy breve' });
  }

  const system = 'Eres un experto en optimizacion de perfiles de LinkedIn con enfoque en el mercado latinoamericano. ' +
    'Analiza el perfil de LinkedIn proporcionado y genera un diagnostico claro, honesto y accionable. ' +
    'Responde UNICAMENTE con JSON valido sin markdown. Esquema exacto: ' +
    '{"score":0,' +
    '"titulo":"frase de 1 linea sobre el estado general del perfil",' +
    '"resumen_general":"2-3 lineas explicando el score y lo mas importante",' +
    '"primera_impresion":{"descripcion":"que comunica el perfil en los primeros 3 segundos","oportunidad":"que podria estar mas claro o mejor"},' +
    '"titular":{"estado":"verde|amarillo|rojo","analisis":"que comunica el titular actual","sugerencias":["sugerencia 1","sugerencia 2"]},' +
    '"acerca_de":{"estado":"verde|amarillo|rojo","analisis":"evaluacion de la seccion","recomendacion":"que mejorar"},' +
    '"experiencia":{"estado":"verde|amarillo|rojo","analisis":"como esta presentada la experiencia","oportunidad":"que falta o puede mejorar"},' +
    '"palabras_clave":{"encontradas":["kw1","kw2","kw3"],"oportunidad":"descripcion general de lo que falta sin dar la lista completa"},' +
    '"coherencia":{"estado":"verde|amarillo|rojo","descripcion":"si el perfil cuenta una historia coherente o hay inconsistencias"},' +
    '"top_oportunidades":["oportunidad 1 concreta","oportunidad 2 concreta","oportunidad 3 concreta"]}. ' +
    'El score va de 0 a 100. Verde=bien encaminado, amarillo=puede mejorar, rojo=requiere atencion. ' +
    'Se honesto pero constructivo. Las palabras clave encontradas deben ser terminos relevantes que aparecen en el perfil. ' +
    'Las top_oportunidades deben ser especificas y accionables, no genericas.';

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1500,
        system,
        messages: [{
          role: 'user',
          content: 'PERFIL DE LINKEDIN:\n' + textoRec + '\n\nGenera el analisis en JSON.'
        }]
      })
    });

    const data = await r.json();
    if (!r.ok) {
      console.error('Anthropic error:', JSON.stringify(data));
      return res.status(502).json({ error: 'Error del servicio de análisis' });
    }

    const txt = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const clean = txt.replace(/```json|```/g, '').trim();
    const start = clean.indexOf('{');
    const end = clean.lastIndexOf('}');
    if (start === -1 || end === -1) {
      return res.status(500).json({ error: 'Respuesta inesperada del servicio' });
    }
    let jsonStr = clean.slice(start, end + 1)
      .replace(/[\u0000-\u001F\u007F]/g, ' ')
      .replace(/\n/g, ' ').replace(/\r/g, ' ').replace(/\t/g, ' ');
    return res.status(200).json(JSON.parse(jsonStr));
  } catch(e) {
    console.error('Profile error:', e.message);
    return res.status(500).json({ error: 'No se pudo analizar el perfil: ' + e.message });
  }
}
