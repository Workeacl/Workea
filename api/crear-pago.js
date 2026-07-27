// api/crear-pago.js — Genera una preferencia de pago en Mercado Pago
// con redirección automática al formulario de activación tras el pago aprobado.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    return res.status(500).json({ error: 'Falta configurar MP_ACCESS_TOKEN en Vercel' });
  }

  const FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLSe9UDo4wpX6gPw0rFjdl4_Jyr9gB5AUwckhuhOsoF5Gk_gv6g/viewform';

  const preferencia = {
    items: [
      {
        title: 'Workea · Informe Match — Acceso 7 días',
        quantity: 1,
        unit_price: 2990,
        currency_id: 'CLP'
      }
    ],
    back_urls: {
      success: FORM_URL,
      pending: FORM_URL,
      failure: 'https://workea.cl'
    },
    auto_return: 'approved'
  };

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
