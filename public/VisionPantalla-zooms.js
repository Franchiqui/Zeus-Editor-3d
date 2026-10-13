/* Zoom automático por pantalla — generado por Visión Pantalla */
(function () {
  "use strict";
  var ZOOMS = {"4097x2160":0.5131581182307065,"1821x960":0.5131581182307065};
  try {
    /* Dentro de un marco (iframe) el zoom lo pone quien incrusta la web
       (el visualizador de Visión Pantalla ya aplica el suyo): aquí sería
       zoom doble y provocaría scrollbars. Solo actúa en la página completa. */
    if (window.self !== window.top) return;
    var w = (window.screen && window.screen.width) || 0;
    var h = (window.screen && window.screen.height) || 0;
    if (!w || !h) return;
    /* Visión Pantalla calibra con la resolución FÍSICA del monitor, pero el
       navegador da píxeles lógicos (el escalado de Windows los encoge:
       una TV 4K al 225% se reporta como 1821x960). Con devicePixelRatio
       reconstruimos la física; probamos ambas claves por si acaso. */
    var dpr = window.devicePixelRatio || 1;
    var wFisica = Math.round(w * dpr), hFisica = Math.round(h * dpr);
    var z = null;
    var claveFisica = wFisica + "x" + hFisica, claveCss = w + "x" + h;
    if (ZOOMS[claveFisica]) z = ZOOMS[claveFisica];
    else if (ZOOMS[claveCss]) z = ZOOMS[claveCss];
    if (!z) {
      var widths = Object.keys(ZOOMS).map(function (k) {
        var m = k.split("x");
        return { w: parseInt(m[0], 10), z: ZOOMS[k] };
      });
      var anchos = [wFisica, w];
      var cand = [];
      for (var j = 0; j < anchos.length; j++) {
        for (var i = 0; i < widths.length; i++) {
          var dif = Math.abs(widths[i].w - anchos[j]);
          if (dif / anchos[j] <= 0.1) cand.push({ d: dif, z: widths[i].z });
        }
      }
      if (cand.length) {
        cand.sort(function (a, b) { return a.d - b.d; });
        z = cand[0].z;
      }
    }
    if (z && z !== 1) {
      var st = document.documentElement.style;
      var apply = function () {
        st.zoom = String(z);
        st.setProperty("--vp-zoom", String(z));
        document.documentElement.setAttribute("data-vp-zoom", String(z));
        /* El zoom CSS rehace anchos en % pero NO las alturas en 100vh: sin
           esto la web se queda encogida en una franja y no llena la pantalla.
           Con body alto exacto (viewport/z) y margen 0, las apps que encadenan
           alturas en % llenan todo, como el zoom nativo del navegador (Ctrl -). */
        var css = document.getElementById("vp-zoom-style");
        if (!css) {
          css = document.createElement("style");
          css.id = "vp-zoom-style";
          document.head.appendChild(css);
        }
        css.textContent = "html[data-vp-zoom]>body{height:calc(100vh/var(--vp-zoom,1))!important;margin:0!important;}";
      };
      apply();
      window.addEventListener("DOMContentLoaded", apply);
    }
  } catch (e) { /* nunca romper la web anfitriona */ }
})();