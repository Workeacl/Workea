// api/profile.js — Workea Profile Check
// Usa Anthropic tool use para garantizar JSON valido sin parseo manual

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no permitido' });

  const { texto, codigo } = req.body || {};

  const listaCodigos = (process.env.WORKEA_CODIGO || '')
    .split(',').map(c => c.trim()).filter(Boolean);
  if (listaCodigos.length && !listaCodigos.includes((codigo || '').trim())) {
    return res.status(401).json({ error: 'Codigo de acceso invalido' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Falta ANTHROPIC_API_KEY' });

  const textoRec = String(texto || '').trim();
  if (!textoRec || textoRec.length < 50) {
    return res.status(400).json({ error: 'El perfil ingresado es muy breve' });
  }

  const system = 'Eres un experto en optimizacion de perfiles de LinkedIn con enfoque en el mercado latinoamericano. ' +
    'Analiza el perfil de LinkedIn proporcionado y genera un diagnostico claro, honesto y accionable usando la herramienta generar_analisis. ' +
    'El score va de 0 a 100. Verde=bien encaminado, amarillo=puede mejorar, rojo=requiere atencion. ' +
    'Se honesto pero constructivo. Las palabras clave encontradas deben ser terminos relevantes que realmente aparecen en el perfil. ' +
    'Las top_oportunidades deben ser especificas y accionables, no genericas.';

  const tool = {
    name: 'generar_analisis',
    description: 'Genera el analisis estructurado del perfil de LinkedIn',
    input_schema: {
      type: 'object',
      properties: {
        score: { type: 'integer', description: 'Score de optimizacion de 0 a 100' },
        titulo: { type: 'string', description: 'Frase de 1 linea sobre el estado general del perfil' },
        resumen_general: { type: 'string', description: '2-3 lineas explicando el score y lo mas importante' },
        primera_impresion: {
          type: 'object',
          properties: {
            descripcion: { type: 'string' },
            oportunidad: { type: 'string' }
          },
          required: ['descripcion', 'oportunidad']
        },
        titular: {
          type: 'object',
          properties: {
            estado: { type: 'string', enum: ['verde', 'amarillo', 'rojo'] },
            analisis: { type: 'string' },
            sugerencias: { type: 'array', items: { type: 'string' } }
          },
          required: ['estado', 'analisis', 'sugerencias']
        },
        acerca_de: {
          type: 'object',
          properties: {
            estado: { type: 'string', enum: ['verde', 'amarillo', 'rojo'] },
            analisis: { type: 'string' },
            recomendacion: { type: 'string' }
          },
          required: ['estado', 'analisis', 'recomendacion']
        },
        experiencia: {
          type: 'object',
          properties: {
            estado: { type: 'string', enum: ['verde', 'amarillo', 'rojo'] },
            analisis: { type: 'string' },
            oportunidad: { type: 'string' }
          },
          required: ['estado', 'analisis', 'oportunidad']
        },
        palabras_clave: {
          type: 'object',
          properties: {
            encontradas: { type: 'array', items: { type: 'string' } },
            oportunidad: { type: 'string' }
          },
          required: ['encontradas', 'oportunidad']
        },
        coherencia: {
          type: 'object',
          properties: {
            estado: { type: 'string', enum: ['verde', 'amarillo', 'rojo'] },
            descripcion: { type: 'string' }
          },
          required: ['estado', 'descripcion']
        },
        top_oportunidades: { type: 'array', items: { type: 'string' } }
      },
      required: ['score', 'titulo', 'resumen_general', 'primera_impresion', 'titular', 'acerca_de', 'experiencia', 'palabras_clave', 'coherencia', 'top_oportunidades']
    }
  };

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
        max_tokens: 1800,
        system,
        tools: [tool],
        tool_choice: { type: 'tool', name: 'generar_analisis' },
        messages: [{
          role: 'user',
          content: 'PERFIL DE LINKEDIN:\n' + textoRec
        }]
      })
    });

    const data = await r.json();
    if (!r.ok) {
      console.error('Anthropic error:', JSON.stringify(data).substring(0, 300));
      return res.status(502).json({ error: 'Error del servicio de análisis' });
    }

    const toolUse = (data.content || []).find(b => b.type === 'tool_use');
    if (!toolUse || !toolUse.input) {
      console.error('Sin tool_use en respuesta:', JSON.stringify(data).substring(0, 300));
      return res.status(500).json({ error: 'Respuesta inesperada del servicio' });
    }

    // toolUse.input ya viene como objeto JSON parseado por Anthropic — sin riesgo de comillas rotas
    return res.status(200).json(toolUse.input);
  } catch(e) {
    console.error('Profile error:', e.message);
    return res.status(500).json({ error: 'No se pudo analizar el perfil: ' + e.message });
  }
}
