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
    'IMPORTANTE: TODOS los campos de texto deben tener contenido sustancioso y especifico al perfil analizado — nunca dejes un campo vacio o generico. ' +
    'analisis debe explicar QUE dice esa seccion del perfil hoy, con al menos 1-2 frases concretas. ' +
    'sugerencias debe tener al menos 2 sugerencias especificas y accionables. ' +
    'palabras_clave.encontradas debe listar entre 3 y 8 terminos que SI aparecen en el texto del perfil (si el perfil menciona un rubro, herramienta o rol, esas son palabras clave). Solo dejar vacio si el perfil es extremadamente breve. ' +
    'top_oportunidades debe tener exactamente 3 elementos, especificos y accionables, no genericos. ' +
    'El score va de 0 a 100. Verde=bien encaminado, amarillo=puede mejorar, rojo=requiere atencion. ' +
    'Se honesta pero constructiva, como si fueras una reclutadora dando feedback directo.';

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
            analisis: { type: 'string', description: 'Explica que comunica el titular ACTUAL del perfil, citando o parafraseando su contenido real. Minimo 1-2 frases.' },
            sugerencias: { type: 'array', items: { type: 'string' }, description: 'Al menos 2 sugerencias concretas y accionables para mejorar el titular' }
          },
          required: ['estado', 'analisis', 'sugerencias']
        },
        acerca_de: {
          type: 'object',
          properties: {
            estado: { type: 'string', enum: ['verde', 'amarillo', 'rojo'] },
            analisis: { type: 'string', description: 'Evalua el contenido real de la seccion Acerca de del perfil, con al menos 1-2 frases especificas' },
            recomendacion: { type: 'string', description: 'Una recomendacion concreta de que mejorar en esta seccion' }
          },
          required: ['estado', 'analisis', 'recomendacion']
        },
        experiencia: {
          type: 'object',
          properties: {
            estado: { type: 'string', enum: ['verde', 'amarillo', 'rojo'] },
            analisis: { type: 'string', description: 'Como esta presentada la experiencia laboral en el perfil, con al menos 1-2 frases especificas' },
            oportunidad: { type: 'string', description: 'Que falta o podria mejorar en la presentacion de la experiencia' }
          },
          required: ['estado', 'analisis', 'oportunidad']
        },
        palabras_clave: {
          type: 'object',
          properties: {
            encontradas: { type: 'array', items: { type: 'string' }, description: 'Entre 3 y 8 terminos, roles, herramientas o rubros que SI aparecen mencionados en el perfil' },
            oportunidad: { type: 'string', description: 'Descripcion general de que tipo de palabras clave adicionales convendria incorporar' }
          },
          required: ['encontradas', 'oportunidad']
        },
        coherencia: {
          type: 'object',
          properties: {
            estado: { type: 'string', enum: ['verde', 'amarillo', 'rojo'] },
            descripcion: { type: 'string', description: 'Si el perfil cuenta una historia coherente entre titular, acerca de y experiencia, o hay inconsistencias especificas' }
          },
          required: ['estado', 'descripcion']
        },
        top_oportunidades: { type: 'array', items: { type: 'string' }, description: 'Exactamente 3 oportunidades de mejora especificas y accionables, en orden de prioridad' }
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
        model: 'claude-sonnet-4-6',
        max_tokens: 2500,
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
