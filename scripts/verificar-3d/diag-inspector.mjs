/** DIAG CONEXIONES — al abrir edit-3d DIRECTO no debe pedirse puerto 3030. */
import { abrirEditor, esperar } from './comun.mjs';

const R = [];
const check = (ok, okMsg, malMsg) => {
  console.log(ok ? `OK  ${okMsg}` : `MAL ${malMsg}`);
  R.push(ok);
};

const { browser, page } = await abrirEditor({ consola: false });
try {
  page.on('requestfailed', (req) => {
    console.log('REQUEST FAILED:', req.url(), '→', req.failure()?.errorText);
  });
  page.on('response', (res) => {
    if (res.status() >= 400) console.log('HTTP', res.status(), res.url());
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await esperar(4000);
  check(
    (await page.evaluate(() => !document.querySelector('script[src*="inspector-client"], script[src*=":3030"]'))) &&
      !R.some((v) => !v),
    'sin script inspector en modo standalone (fin del ERR_CONNECTION_REFUSED)',
    'sigue cargándose inspector-client fuera del editor — BUG'
  );
} finally {
  await browser.close();
}
console.log(`\n${R.every(Boolean) ? 'TODOS OK' : 'HAY FALLOS'} (${R.filter(Boolean).length}/${R.length})`);