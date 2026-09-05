// api/crear-pago.js — Genera una preferencia de pago en Mercado Pago
// con redirección automática al formulario de activación (uno solo,
// compartido por Match, CV y Career), con el texto exacto del plan
// prellenado para que la persona no tenga que elegirlo a mano.
//
// POST /api/crear-pago  { }                                    → Workea Match (comportamiento original)
// POST /api/crear-pago  { producto: 'cv', plan: 'diagnostico'|'optimizado'|'pro' }  → Workea CV
// POST /api/crear-pago  { producto: 'career' }                 → Workea Career

// El texto debe calzar EXACTO con las opciones del desplegable
// "Plan comprado" del formulario único.
const PLANES = {
  cv: {
    diagnostico: { titulo: 'Workea CV Diagnóstico', precio: 2990 },
    optimizado:  { titulo: 'Workea CV Optimizado',  precio: 6990 },
    pro:         { titulo: 'Workea CV Pro',          precio: 9990 }
  },
  career: {
    titulo: 'Workea Career',
    precio: 4990
  },
  profile: {
    titulo: 'Workea Profile Check',
    precio: 2990
  }
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

  let planTexto, precio;

  if (producto === 'cv') {
    const planInfo = PLANES.cv[plan];
    if (!planInfo) return res.status(400).json({ error: 'Plan de CV inválido. Usa diagnostico, optimizado o pro.' });
    planTexto = planInfo.titulo;
    precio = planInfo.precio;
  } else if (producto === 'career') {
    planTexto = PLANES.career.titulo;
    precio = PLANES.career.precio;
  } else if (producto === 'profile') {
    planTexto = PLANES.profile.titulo;
    precio = PLANES.profile.precio;
  } else {
    // ---------- Comportamiento original de Match, sin ningún cambio ----------
    planTexto = 'Informe Workea Match';
    precio = 2990;
  }

  const REDIRECT_URL = `https://workea.cl/api/redirigir-formulario?plan=${encodeURIComponent(planTexto)}`;

  const preferencia = {
    items: [{ title: 'Workea · ' + planTexto, quantity: 1, unit_price: precio, currency_id: 'CLP' }],
    back_urls: {
      success: REDIRECT_URL,
      pending: REDIRECT_URL,
      failure: producto === 'cv' ? 'https://workea.cl/workea-cv-planes.html'
             : producto === 'career' ? 'https://workea.cl/career.html'
             : producto === 'profile' ? 'https://workea.cl/profile.html'
             : 'https://workea.cl'
    },
    auto_return: 'approved'
  };

  try {
    const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
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
