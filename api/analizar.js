// api/analizar.js — Función serverless de Workea (Vercel)
// Recibe {oferta, cv, codigo} y devuelve el análisis Workea en JSON.
// Usa Anthropic tool use para garantizar JSON valido sin parseo manual.
// Validación de código migrada a Supabase (tabla "codigos") — reemplaza WORKEA_CODIGO.
// La vigencia (vence) se fija en el primer uso real, no al momento de generar/enviar el código.

const SUPABASE_URL = 'https://pqelcrlxarendwearcwl.supabase.co';

// Deja un rastro de qué IPs han usado este código, sin bloquear nada.
// Si algún día ves 5 IPs distintas en un código de 1 solo cliente,
// eso es una señal de que probablemente se compartió — pero la
// decisión de qué hacer siempre la tomas tú, revisando el panel.
async function registrarUsoDelCodigo(codigoLimpio, ip, ipsVistasActual, usosActual, headers) {
  if (!ip) return;
  const ips = Array.isArray(ipsVistasActual) ? ipsVistasActual : [];
  if (!ips.includes(ip)) ips.push(ip);

  const patchUrl = `${SUPABASE_URL}/rest/v1/codigos?codigo=eq.${encodeURIComponent(codigoLimpio)}`;
  await fetch(patchUrl, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ ips_vistas: ips, usos_totales: (usosActual || 0) + 1 })
  });
}

async function validarCodigoEnSupabase(codigoLimpio, ip) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return { ok: false, status: 500, error: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en Vercel' };
  }

  const headers = {
    'apikey': serviceKey,
    'Authorization': `Bearer ${serviceKey}`
  };

  const url = `${SUPABASE_URL}/rest/v1/codigos?codigo=eq.${encodeURIComponent(codigoLimpio)}&select=codigo,plan,estado,vence,ips_vistas,usos_totales`;
  const r = await fetch(url, { headers });

  if (!r.ok) {
    return { ok: false, status: 502, error: 'No se pudo verificar el código. Intenta de nuevo.' };
  }

  const rows = await r.json();
  const fila = Array.isArray(rows) ? rows[0] : null;

  if (!fila) {
    return { ok: false, status: 401, error: 'Código de acceso inválido' };
  }

  // Registro de uso — NUNCA bloquea el acceso, solo deja un rastro para
  // que puedas notar patrones raros (ej: el mismo código usado desde
  // muchas IPs distintas) y decidir tú misma si vale la pena investigar.
  // No espera respuesta (no retrasa ni puede fallar la validación real).
  registrarUsoDelCodigo(codigoLimpio, ip, fila.ips_vistas, fila.usos_totales, headers).catch(() => {});

  // Si "vence" ya está fijado, revisamos si el código sigue vigente.
  if (fila.vence) {
    const vence = new Date(fila.vence);
    if (vence.getTime() < Date.now()) {
      return { ok: false, status: 401, error: 'Tu acceso venció. Reactívalo para seguir usando Workea.' };
    }
    return { ok: true, plan: fila.plan };
  }

  // Primer uso real: fijamos "vence" ahora mismo (7 días match/career, 30 días experto).
  const dias = fila.plan === 'experto' ? 30 : 7;
  const vence = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);

  const patchUrl = `${SUPABASE_URL}/rest/v1/codigos?codigo=eq.${encodeURIComponent(codigoLimpio)}&vence=is.null`;
  const patchR = await fetch(patchUrl, {
    method: 'PATCH',
    headers: { ...headers, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ vence: vence.toISOString() })
  });

  if (!patchR.ok) {
    // No bloqueamos el análisis por un error al guardar la fecha; solo lo dejamos registrado.
    console.error('No se pudo fijar "vence" para', codigoLimpio);
  }

  return { ok: true, plan: fila.plan };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { oferta, ofertas, imagenes, cv, codigo, modo } = req.body || {};
  const esencial = modo === 'esencial';

  // Códigos de acceso: se validan contra la tabla "codigos" de Supabase.
  if (!esencial) {
    const codigoLimpio = (codigo || '').trim();

    // El código maestro sigue funcionando igual que antes, sin pasar por Supabase.
    const esMaestro = codigoLimpio.toUpperCase() === 'WORKEA2026';

    if (!esMaestro) {
      if (!codigoLimpio) {
        return res.status(401).json({ error: 'Código de acceso inválido' });
      }

      // Restricción de prefijo: se mantiene igual que antes.
      const prefijoValido = ['WK-', 'EXP-', 'WC-'].some(p => codigoLimpio.toUpperCase().startsWith(p));
      if (!prefijoValido) {
        return res.status(401).json({ error: 'Este código no corresponde a Workea Match' });
      }

      const ipReq = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || null;
      const resultado = await validarCodigoEnSupabase(codigoLimpio.toUpperCase(), ipReq);
      if (!resultado.ok) {
        return res.status(resultado.status).json({ error: resultado.error });
      }
    }
  }

  // Ofertas en texto (hasta 3; esencial: 1)
  let listaOfertas = Array.isArray(ofertas) ? ofertas : (oferta ? [oferta] : []);
  listaOfertas = listaOfertas.map(o => String(o || '').trim()).filter(o => o.length >= 40)
    .slice(0, esencial ? 1 : 3);

  // Ofertas en imagen/captura (hasta 2)
  let listaImagenes = Array.isArray(imagenes) ? imagenes.slice(0, 2) : [];
  listaImagenes = listaImagenes.filter(im => im && typeof im.data === 'string'
    && im.data.length > 100 && im.data.length < 3000000
    && typeof im.media_type === 'string' && im.media_type.startsWith('image/'));

  if ((!listaOfertas.length && !listaImagenes.length) || !cv || cv.length < 40) {
    return res.status(400).json({ error: 'Falta la oferta (texto o captura) o el CV' });
  }
  if (listaOfertas.some(o => o.length > 20000) || cv.length > 20000) {
    return res.status(400).json({ error: 'El texto es demasiado largo' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'Falta configurar ANTHROPIC_API_KEY en Vercel' });
  }

  const system = `Eres el motor de análisis de Workea (by Tu Partner Laboral), una plataforma chilena de empleabilidad creada por especialistas en selección. Tu tarea: analizar una oferta laboral y compararla con el CV de la persona, siguiendo la metodología Workea, usando la herramienta generar_analisis.

PRINCIPIOS OBLIGATORIOS:
- La explicación cualitativa importa más que el porcentaje.
- NUNCA inventes experiencia, logros, habilidades o certificaciones que no estén en el CV.
- NUNCA asumas que la persona tiene una habilidad solo porque la oferta la pide.
- Para las brechas usa lenguaje cuidadoso: "no se identifica claramente en tu CV", nunca afirmes que la persona carece de algo.
- Nunca digas "no postules": la recomendación más baja es "revisa antes de postular".
- No recomiendes keyword stuffing: solo sugiere términos que describan experiencia real.
- Si la oferta tiene señales relevantes (contratación vía consultora externa, condiciones inusuales, información faltante), menciónalo en "observacion".
- Tono: cercano, claro, profesional, humano. Trata a la persona de "tú". Español de Chile neutro.
- IMPORTANTE: todos los campos marcados como obligatorios en el schema deben tener contenido real y específico. Nunca dejes "compatibilidad", "info" ni "recomendacion" vacíos o en 0 — son el corazón del informe.
- Para benchmark_salarial: si la oferta menciona sueldo, evalúa si está alineado, bajo o sobre el mercado para ese cargo y seniority. Si no lo menciona, entrega un rango referencial. Usa formulaciones honestas ("la mayoría de las ofertas similares ofrecen...") y nunca inventes porcentajes o estadísticas precisas que no puedas fundamentar.
- Para nivel_calibre: compara el seniority/experiencia real del CV con el nivel que pide la oferta. Sé honesta: si la persona tiene más experiencia de la que pide el cargo, es "sobrecalificado"; si tiene menos, "subcalificado"; si calza, "alineado".

${esencial ? 'MODO ESENCIAL: genera solo la orientación inicial. Incluye info, compatibilidad, fortalezas (máx 3), oportunidades (máx 2), brechas (máx 2) y recomendacion. Deja claves, cv, entrevista, insuficiente y comparacion como listas vacías. Deja nivel_calibre y benchmark_salarial con sus campos de texto vacíos y números en 0 (son funciones exclusivas del plan pagado). Sé breve y directo.' : 'Incluye 3-6 fortalezas, 2-4 oportunidades, 0-3 brechas, 0-3 insuficiente, 8-12 claves, 3-4 recomendaciones de CV y 5-6 preguntas de entrevista. Completa nivel_calibre y benchmark_salarial con contenido real y específico, nunca vacío.'}
Si recibes UNA sola oferta, deja "comparacion" como lista vacía. Si recibes VARIAS ofertas: incluye "comparacion" ordenada de mayor a menor prioridad de postulación, y desarrolla TODO el análisis detallado sobre la oferta prioritaria, indicando en compatibilidad.titulo a qué oferta corresponde.
Los campos de "info" que no aparezcan en la oferta déjalos como string vacío.`;

  const tool = {
    name: 'generar_analisis',
    description: 'Genera el análisis Workea completo de compatibilidad entre la oferta y el CV',
    input_schema: {
      type: 'object',
      properties: {
        info: {
          type: 'object',
          properties: {
            cargo: { type: 'string', description: 'OBLIGATORIO: nombre del cargo. Nunca dejar vacío si aparece en la oferta.' },
            empresa: { type: 'string' }, ubicacion: { type: 'string' },
            modalidad: { type: 'string' }, seniority: { type: 'string' }
          },
          required: ['cargo', 'empresa', 'ubicacion', 'modalidad', 'seniority']
        },
        compatibilidad: {
          type: 'object',
          properties: {
            porcentaje: { type: 'integer', description: 'OBLIGATORIO: porcentaje real entre 0 y 100 según el análisis. Nunca dejar en 0 salvo que el perfil realmente no tenga ninguna relación con el cargo.' },
            titulo: { type: 'string', description: 'OBLIGATORIO: frase resumen de una línea sobre el nivel de compatibilidad. Nunca dejar vacío.' },
            lectura: { type: 'string', description: 'OBLIGATORIO: párrafo explicativo de 3-5 líneas explicando el porcentaje. Nunca dejar vacío.' }
          },
          required: ['porcentaje', 'titulo', 'lectura']
        },
        observacion: { type: 'string', description: 'señal relevante sobre la oportunidad misma, string vacío si no aplica' },
        nivel_calibre: {
          type: 'object',
          properties: {
            nivel: { type: 'string', enum: ['sobrecalificado', 'alineado', 'subcalificado', ''] },
            detalle: { type: 'string', description: '1-2 líneas explicando por qué, comparando el nivel de experiencia del CV con lo que pide la oferta' }
          },
          required: ['nivel', 'detalle']
        },
        benchmark_salarial: {
          type: 'object',
          properties: {
            rango_min: { type: 'integer' },
            rango_max: { type: 'integer' },
            moneda: { type: 'string', description: 'CLP u otra según el país de la oferta' },
            lectura: { type: 'string', description: 'si la oferta menciona sueldo: si está alineado, bajo o sobre mercado. Si no lo menciona: nota de que es un rango referencial' }
          },
          required: ['rango_min', 'rango_max', 'moneda', 'lectura']
        },
        fortalezas: { type: 'array', items: { type: 'object', properties: { titulo: { type: 'string' }, detalle: { type: 'string' } }, required: ['titulo', 'detalle'] } },
        oportunidades: { type: 'array', items: { type: 'object', properties: { titulo: { type: 'string' }, detalle: { type: 'string' } }, required: ['titulo', 'detalle'] } },
        brechas: { type: 'array', items: { type: 'object', properties: { titulo: { type: 'string' }, detalle: { type: 'string' } }, required: ['titulo', 'detalle'] } },
        insuficiente: { type: 'array', items: { type: 'object', properties: { titulo: { type: 'string' }, detalle: { type: 'string' } }, required: ['titulo', 'detalle'] } },
        claves: { type: 'array', items: { type: 'object', properties: { palabra: { type: 'string' }, estado: { type: 'string', enum: ['presente', 'relacionada', 'no'] }, nota: { type: 'string' } }, required: ['palabra', 'estado', 'nota'] } },
        cv: { type: 'array', items: { type: 'object', properties: { seccion: { type: 'string' }, actual: { type: 'string' }, recomendacion: { type: 'string' }, porque: { type: 'string' } }, required: ['seccion', 'actual', 'recomendacion', 'porque'] } },
        entrevista: { type: 'array', items: { type: 'object', properties: { pregunta: { type: 'string' }, evalua: { type: 'string' }, preparar: { type: 'string' } }, required: ['pregunta', 'evalua', 'preparar'] } },
        recomendacion: {
          type: 'object',
          properties: {
            nivel: { type: 'string', enum: ['verde', 'amarillo', 'naranjo', 'rojo'] },
            titulo: { type: 'string', description: 'OBLIGATORIO: nunca dejar vacío' },
            detalle: { type: 'string', description: 'OBLIGATORIO: párrafo de cierre, nunca dejar vacío' }
          },
          required: ['nivel', 'titulo', 'detalle']
        },
        comparacion: { type: 'array', items: { type: 'object', properties: { oferta: { type: 'string' }, porcentaje: { type: 'integer' }, veredicto: { type: 'string' } }, required: ['oferta', 'porcentaje', 'veredicto'] } }
      },
      required: ['info', 'compatibilidad', 'observacion', 'nivel_calibre', 'benchmark_salarial', 'fortalezas', 'oportunidades', 'brechas', 'insuficiente', 'claves', 'cv', 'entrevista', 'recomendacion', 'comparacion']
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
        max_tokens: esencial ? 1600 : 5500,
        system,
        tools: [tool],
        tool_choice: { type: 'tool', name: 'generar_analisis' },
        messages: [{
          role: 'user',
          content: [
            ...listaImagenes.map(im => ({ type: 'image', source: { type: 'base64', media_type: im.media_type, data: im.data } })),
            ...(listaImagenes.length ? [{ type: 'text', text: 'Las imágenes anteriores son capturas de la oferta laboral: léelas como una oferta.' }] : []),
            ...listaOfertas.map((o, i) => ({ type: 'text', text: `OFERTA LABORAL ${i + 1}:\n${o}` })),
            { type: 'text', text: (esencial ? 'MODO ESENCIAL.\n\n' : '') + `CV DE LA PERSONA:\n${cv}\n\nGenera el análisis Workea.` }
          ]
        }]
      })
    });

    const data = await r.json();
    if (!r.ok) {
      console.error('Error Anthropic:', JSON.stringify(data).substring(0, 300));
      return res.status(502).json({ error: 'El servicio de análisis no respondió correctamente' });
    }

    const toolUse = (data.content || []).find(b => b.type === 'tool_use');
    if (!toolUse || !toolUse.input) {
      console.error('Sin tool_use en respuesta:', JSON.stringify(data).substring(0, 300));
      return res.status(500).json({ error: 'Respuesta inesperada del servicio. Intenta de nuevo.' });
    }

    return res.status(200).json(toolUse.input);
  } catch (e) {
    console.error('Error:', e);
    return res.status(500).json({ error: 'No se pudo generar el análisis. Intenta de nuevo.' });
  }
}
