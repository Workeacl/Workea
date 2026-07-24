// api/career.js — Workea Career (Ruta Profesional)
// Independiente de los demás endpoints

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no permitido' });

  const { cv, contexto, codigo } = req.body || {};

  const listaCodigos = (process.env.WORKEA_CODIGO || '')
    .split(',').map(c => c.trim()).filter(Boolean);
  if (listaCodigos.length && !listaCodigos.includes((codigo || '').trim())) {
    return res.status(401).json({ error: 'Codigo de acceso invalido' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'Falta ANTHROPIC_API_KEY' });

  const cvStr = String(cv || '').trim();
  if (!cvStr || cvStr.length < 80) {
    return res.status(400).json({ error: 'El CV ingresado es muy breve para construir tu ruta' });
  }

  const ctx = contexto || {};
  const ctxLines = [];
  if (ctx.cargo_actual) ctxLines.push('Cargo actual: ' + ctx.cargo_actual);
  if (ctx.cargo_ideal) ctxLines.push('Cargo ideal en 3-5 anios: ' + ctx.cargo_ideal);
  if (ctx.industria) ctxLines.push('Industria de interes: ' + ctx.industria);
  if (ctx.especializar_liderar) ctxLines.push('Preferencia: ' + ctx.especializar_liderar);
  if (ctx.habilidades_faltantes) ctxLines.push('Habilidades que siente que le faltan: ' + ctx.habilidades_faltantes);
  if (ctx.prioridades && ctx.prioridades.length) ctxLines.push('Prioridades: ' + ctx.prioridades.join(', '));
  if (ctx.ingles) ctxLines.push('Nivel de ingles: ' + ctx.ingles);
  if (ctx.dispuesto_estudiar) ctxLines.push('Disposicion a estudiar este anio: ' + ctx.dispuesto_estudiar);
  const ctxStr = ctxLines.length ? ctxLines.join('\n') : 'Sin cuestionario adicional — inferir todo desde el CV.';

  const systemParts = [
    'Eres una especialista en seleccion y desarrollo de carrera con anios de experiencia como reclutadora en Latinoamerica.',
    'Tu tarea: analizar el CV (y contexto opcional) de una persona y construir su ruta profesional completa.',
    'Tono: honesto, calido, concreto. Como una reclutadora experimentada que quiere genuinamente ayudar.',
    'IMPORTANTE sobre datos de mercado: cuando fundamentes una recomendacion, usa formulaciones honestas como "la gran mayoria de las ofertas para este cargo piden..." o "es uno de los requisitos mas frecuentes del mercado" — NUNCA inventes porcentajes especificos.',
    'Los rangos salariales son referenciales del mercado chileno en CLP salvo que el CV indique otro pais.',
    'Responde UNICAMENTE con JSON valido, sin markdown. Estructura exacta:',
    '{"titulo":"frase de 1 linea sobre el momento profesional de la persona",',
    '"resumen":"2-3 lineas sobre su situacion y potencial",',
    '"nivel_preparacion":0,',
    '"diagnostico":{"seniority":"","area":"","fortaleza_principal":"","experiencia":"X anios","competencias_fuertes":["max 5"],"competencias_debiles":["max 4"]},',
    '"cargos_hoy":[{"cargo":"","salario_ref":"$X.XXX.XXX - $X.XXX.XXX CLP aprox"}],',
    '"mapa_carrera":[{"nombre":"nombre del camino ej Camino de especializacion","descripcion":"1-2 lineas","cargos":["cargo1","cargo2","cargo3"]}],',
    '"brechas":[{"habilidad":"","nivel":"alto|medio|largo","razon":"por que importa, con contexto de mercado honesto"}],',
    '"simulaciones":[{"habilidad":"","beneficios":["beneficio concreto 1","beneficio 2","beneficio 3"]}],',
    '"riesgos":["riesgo concreto detectado en el CV, ej anios haciendo lo mismo, falta de logros cuantificables"],',
    '"oportunidades_ocultas":["camino lateral que la persona probablemente no ha considerado, con fundamento"],',
    '"plan_12_meses":[{"trimestre":"Q1","acciones":["accion 1","accion 2"]},{"trimestre":"Q2","acciones":[""]},{"trimestre":"Q3","acciones":[""]},{"trimestre":"Q4","acciones":[""]}],',
    '"consejo_reclutadora":"parrafo natural de 4-6 lineas, en primera persona, como si la persona estuviera sentada frente a ti. Honesto, especifico a SU caso, priorizando lo que mas impacto tendria. No generico."}',
    'Incluye: 3-4 cargos_hoy con salarios referenciales, 2-3 caminos en mapa_carrera, 4-7 brechas repartidas en niveles, 2-3 simulaciones de las habilidades de MAYOR impacto, 1-3 riesgos, 1-2 oportunidades ocultas.',
    'El consejo_reclutadora es la joya del informe: debe sentirse escrito para ESTA persona, no una plantilla.'
  ];
  const system = systemParts.join(' ');

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
        max_tokens: 3500,
        system,
        messages: [{
          role: 'user',
          content: 'CV DE LA PERSONA:\n' + cvStr + '\n\nCONTEXTO ADICIONAL:\n' + ctxStr + '\n\nConstruye la ruta profesional en JSON.'
        }]
      })
    });

    const data = await r.json();
    if (!r.ok) {
      console.error('Anthropic error:', JSON.stringify(data).substring(0, 200));
      return res.status(502).json({ error: 'Error del servicio: ' + (data.error?.message || 'desconocido') });
    }

    const txt = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    let jsonStr = txt.replace(/```json|```/g, '').trim();
    const start = jsonStr.indexOf('{');
    const end = jsonStr.lastIndexOf('}');
    if (start === -1 || end === -1) {
      return res.status(500).json({ error: 'Respuesta inesperada. Intenta de nuevo.' });
    }
    jsonStr = jsonStr.slice(start, end + 1);

    try {
      return res.status(200).json(JSON.parse(jsonStr));
    } catch(e1) {
      try {
        const clean = jsonStr
          .replace(/[\u0000-\u001F\u007F]/g, ' ')
          .replace(/\n/g, ' ').replace(/\r/g, ' ').replace(/\t/g, ' ');
        return res.status(200).json(JSON.parse(clean));
      } catch(e2) {
        console.error('Parse error:', e2.message);
        return res.status(500).json({ error: 'Error procesando tu ruta. Intenta de nuevo.' });
      }
    }
  } catch(e) {
    console.error('Career error:', e.message);
    return res.status(500).json({ error: 'Error interno: ' + e.message });
  }
}
