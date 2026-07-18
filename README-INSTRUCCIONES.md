# Workea — Fase 1: Análisis real con IA 🚀

Esta carpeta contiene tu plataforma Workea con análisis real:
- `index.html` → tu sitio (demo + modo análisis real con código de acceso)
- `api/analizar.js` → la función que llama a la IA de Claude con la metodología Workea

## Lo que necesitas (una sola vez)

1. **Cuenta en GitHub** (github.com, gratis)
2. **API key de Anthropic**: entra a console.anthropic.com → crea cuenta → Billing:
   carga crédito (con US$5 alcanza para cientos de análisis) → API Keys → Create Key.
   Copia la clave (empieza con `sk-ant-...`). ⚠️ Configura también un límite de gasto
   mensual en Billing para dormir tranquila.
3. Tu cuenta de Vercel (ya la tienes).

## Publicar (paso a paso)

1. En GitHub: **New repository** → nómbralo `workea` → público → Create.
2. Dentro del repo: **Add file → Upload files** → arrastra `index.html` Y la carpeta `api`
   (con `analizar.js` adentro) → Commit changes.
3. En Vercel: **Add New → Project → Import Git Repository** → autoriza GitHub → elige `workea`.
4. ANTES de presionar Deploy, abre **Environment Variables** y agrega:
   - `ANTHROPIC_API_KEY` → tu clave sk-ant-...
   - `WORKEA_CODIGO` → el código de acceso que tú inventes (ej: PILOTO2026).
     Si no defines esta variable, cualquiera con el link podrá usar el análisis real.
5. **Deploy**. Listo: misma dirección para siempre; para actualizar, solo reemplaza
   archivos en GitHub (Add file → Upload files) y Vercel publica solo.

## Cómo se usa el análisis real

1. En el sitio, en la pantalla "Analiza una oportunidad laboral", ingresa el código
   de acceso y presiona **Activar**.
2. Pega la oferta como TEXTO → continúa → pega el CV como texto → Comparar.
3. En ~30-60 segundos aparece el análisis completo generado por IA:
   compatibilidad explicada, fortalezas, brechas, claves, recomendaciones de CV,
   preparación de entrevista y recomendación final.
4. El botón "Imprimir / guardar PDF" permite descargar el resultado.

## Costos aproximados

Cada análisis cuesta centavos de dólar (típicamente US$0.03–0.08).
Con US$5 de crédito puedes hacer decenas de análisis de prueba.

## Importante

- El proyecto anterior de Vercel (subido por Drop) puedes borrarlo después de
  verificar que este funciona; este nuevo, al estar conectado a GitHub,
  mantiene siempre la misma dirección.
- Entrega el código de acceso solo a tus usuarios piloto.
