// api/recruiter.js — Workea Recruiter (herramienta interna)
// Usa Anthropic tool use para garantizar JSON valido sin parseo manual

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no permitido' });

  const { texto, imagenes, pais, codigo } = req.body || {};

  const listaCodigos = (process.env.WORKEA_CODIGO || '')
    .split(',').map(c => c.trim()).filter(Boolean);
  if (listaCodigos.length && !listaCodigos.includes((codigo || '').trim())) {
    return res.status(401).json({ error: 'Codigo de acceso invalido' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Falta ANTHROPIC_API_KEY' });

  const textoRec = String(texto || '').trim();
  const listaImagenes = Array.isArray(imagenes) ? imagenes.slice(0, 1) : [];
  if (!textoRec && !listaImagenes.length) {
    return res.status(400).json({ error: 'Falta el descriptor del cargo' });
  }
  const paisStr = String(pais || 'Chile').trim();

  const system = 'Eres un experto en reclutamiento de perfiles tecnologicos y digitales en Latinoamerica. ' +
    'Analiza el descriptor de cargo (puede ser formal, un correo o apuntes desordenados) y genera una estrategia de busqueda completa para el pais indicado, usando la herramienta generar_estrategia. ' +
    'Si el descriptor es informal o incompleto, infiere lo que puedas con criterio experto de reclutadora y marca las inferencias en alertas.';

  const tool = {
    name: 'generar_estrategia',
    description: 'Genera la estrategia de busqueda y atraccion de talento para el cargo analizado',
    input_schema: {
      type: 'object',
      properties: {
        cargo: { type: 'string' },
        empresa: { type: 'string', description: 'Nombre de la empresa si aparece, string vacio si no' },
        pais: { type: 'string' },
        seniority: { type: 'string', enum: ['Junior', 'Semi Senior', 'Senior', 'Lead', 'Manager'] },
        entendimiento: { type: 'string', description: 'Explicacion del rol en 3-4 lineas simples, sin tecnicismos' },
        criticos: {
          type: 'array', description: '3-4 requisitos criticos (excluyentes)',
          items: { type: 'object', properties: { requisito: { type: 'string' }, nota: { type: 'string', description: 'por que es critico' } }, required: ['requisito', 'nota'] }
        },
        deseables: {
          type: 'array', description: '2-3 requisitos deseables (no excluyentes)',
          items: { type: 'object', properties: { requisito: { type: 'string' } }, required: ['requisito'] }
        },
        competencias_tecnicas: { type: 'array', items: { type: 'string' } },
        competencias_conductuales: { type: 'array', items: { type: 'string' } },
        palabras_clave: {
          type: 'object',
          properties: {
            titulos_principales: { type: 'array', items: { type: 'string' }, description: '4-5 titulos exactos del cargo' },
            titulos_alternativos: { type: 'array', items: { type: 'string' }, description: '3 titulos alternativos con perfil similar' },
            terminos_tecnicos: { type: 'array', items: { type: 'string' } },
            booleana_sugerida: { type: 'string', description: 'busqueda booleana lista para usar en LinkedIn Recruiter' }
          },
          required: ['titulos_principales', 'titulos_alternativos', 'terminos_tecnicos', 'booleana_sugerida']
        },
        donde_buscar: {
          type: 'object',
          properties: {
            empresas: {
              type: 'array', description: '5 empresas donde suelen estar estos perfiles',
              items: { type: 'object', properties: { nombre: { type: 'string' }, razon: { type: 'string' } }, required: ['nombre', 'razon'] }
            },
            sectores_afines: { type: 'array', items: { type: 'string' } },
            comunidades: { type: 'array', items: { type: 'string' } },
            plataformas: { type: 'array', items: { type: 'string' } }
          },
          required: ['empresas', 'sectores_afines', 'comunidades', 'plataformas']
        },
        benchmark_salarial: {
          type: 'object',
          properties: {
            rango_min: { type: 'integer' },
            rango_max: { type: 'integer' },
            moneda: { type: 'string', description: 'CLP, COP, ARS, MXN, PEN o USD segun el pais' },
            fuente_referencial: { type: 'string' },
            lectura: { type: 'string', description: 'si hay salario propuesto: bajo, alineado o sobre mercado. Si no hay: rango sugerido' },
            argumento_cliente: { type: 'string' }
          },
          required: ['rango_min', 'rango_max', 'moneda', 'fuente_referencial', 'lectura', 'argumento_cliente']
        },
        preguntas_entrevista: {
          type: 'array', description: '4 preguntas, mix de tecnicas y por competencias',
          items: {
            type: 'object',
            properties: {
              pregunta: { type: 'string' },
              tipo: { type: 'string', enum: ['tecnica', 'competencia', 'situacional'] },
              que_evalua: { type: 'string' },
              respuesta_ideal: { type: 'string' }
            },
            required: ['pregunta', 'tipo', 'que_evalua', 'respuesta_ideal']
          }
        },
        alertas: { type: 'array', items: { type: 'string' }, description: 'senales de alerta del descriptor: requisitos contradictorios, expectativas irreales, inferencias hechas' },
        estrategia_resumen: { type: 'string', description: '3-4 lineas con el foco recomendado, que va a ser dificil y como abordarlo' }
      },
      required: ['cargo', 'empresa', 'pais', 'seniority', 'entendimiento', 'criticos', 'deseables', 'competencias_tecnicas', 'competencias_conductuales', 'palabras_clave', 'donde_buscar', 'benchmark_salarial', 'preguntas_entrevista', 'alertas', 'estrategia_resumen']
    }
  };

  try {
    const content = [
      ...listaImagenes.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } })),
      ...(listaImagenes.length ? [{ type: 'text', text: 'La imagen es el descriptor del cargo.' }] : []),
      { type: 'text', text: 'DESCRIPTOR DEL CARGO:\n' + textoRec + '\n\nPAIS: ' + paisStr }
    ];

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 4000,
        system,
        tools: [tool],
        tool_choice: { type: 'tool', name: 'generar_estrategia' },
        messages: [{ role: 'user', content }]
      })
    });

    const data = await r.json();
    if (!r.ok) {
      console.error('Anthropic error:', JSON.stringify(data).substring(0, 300));
      return res.status(502).json({ error: 'Error del servicio: ' + (data.error?.message || 'desconocido') });
    }

    const toolUse = (data.content || []).find(b => b.type === 'tool_use');
    if (!toolUse || !toolUse.input) {
      console.error('Sin tool_use en respuesta:', JSON.stringify(data).substring(0, 300));
      return res.status(500).json({ error: 'Respuesta inesperada. Intenta de nuevo.' });
    }

    return res.status(200).json(toolUse.input);
  } catch(e) {
    console.error('Recruiter error:', e.message);
    return res.status(500).json({ error: 'Error interno: ' + e.message });
  }
}
