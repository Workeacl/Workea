// api/crear-pago.js — Genera una preferencia de pago en Mercado Pago
// con redirección automática al formulario de activación correspondiente.
//
// Maneja 2 productos en un solo endpoint (para no sumar funciones nuevas
// al plan Hobby de Vercel):
//   POST /api/crear-pago  { }                          → Workea Match (comportamiento original, sin cambios)
//   POST /api/crear-pago  { producto: 'cv', plan: 'diagnostico'|'optimizado'|'pro' }  → Workea CV

const PLANES_CV = {
  diagnostico: { titulo: 'Workea CV · Diagnóstico + Feedback', precio: 3490 },
  optimizado:  { titulo: 'Workea CV · Optimizado',             precio: 8990 },
  pro:         { titulo: 'Workea CV · Pro',                    precio: 11990 }
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'Falta configurar MP_ACCESS_TOKEN en Vercel' });
  }

  const { producto, plan } = req.body || {};
  const esCv = producto === 'cv';
  const esCareer = producto === 'career';

  let preferencia;

  if (esCv) {
    const planInfo = PLANES_CV[plan];
    if (!planInfo) {
      return res.status(400).json({ error: 'Plan de CV inválido. Usa diagnostico, optimizado o pro.' });
    }
    // El plan viaja en la URL de retorno para que el puente
    // (redirigir-formulario) sepa a qué formulario mandar a la persona.
    const REDIRECT_URL = `https://workea.cl/api/redirigir-formulario?producto=cv&plan=${encodeURIComponent(plan)}`;
    preferencia = {
      items: [{ title: planInfo.titulo, quantity: 1, unit_price: planInfo.precio, currency_id: 'CLP' }],
      back_urls: { success: REDIRECT_URL, pending: REDIRECT_URL, failure: 'https://workea.cl/workea-cv-planes.html' },
      auto_return: 'approved'
    };
  } else if (esCareer) {
    const REDIRECT_URL = 'https://workea.cl/api/redirigir-formulario?producto=career';
    preferencia = {
      items: [{ title: 'Workea Career · Ruta profesional', quantity: 1, unit_price: 4990, currency_id: 'CLP' }],
      back_urls: { success: REDIRECT_URL, pending: REDIRECT_URL, failure: 'https://workea.cl/career.html' },
      auto_return: 'approved'
    };
  } else {
    // ---------- Comportamiento original de Match, sin ningún cambio ----------
    const REDIRECT_URL = 'https://workea.cl/api/redirigir-formulario';
    preferencia = {
      items: [
        {
          title: 'Workea · Informe Match — Acceso 7 días',
          quantity: 1,
          unit_price: 2990,
          currency_id: 'CLP'
        }
      ],
      back_urls: {
        success: REDIRECT_URL,
        pending: REDIRECT_URL,
        failure: 'https://workea.cl'
      },
      auto_return: 'approved'
    };
  }

  try {
    const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token
      },
      body: JSON.stringify(preferencia)
    });
    const data = await r.json();
    if (!r.ok) {
      console.error('Error Mercado Pago:', JSON.stringify(data).substring(0, 300));
      return res.status(502).json({ error: 'No se pudo generar el link de pago' });
    }
    return res.status(200).json({ init_point: data.init_point });
  } catch (e) {
    console.error('Error:', e);
    return res.status(500).json({ error: 'No se pudo generar el link de pago' });
  }
}
