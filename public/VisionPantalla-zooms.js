/* Zoom automático por pantalla — generado por Visión Pantalla */
(function () {
  "use strict";
  var ZOOMS = {"4097x2160":0.5131581182307065};
  try {
    /* Dentro de un marco (iframe) el zoom lo pone quien incrusta la web
       (el visualizador de Visión Pantalla ya aplica el suyo): aquí sería
       zoom doble y provocaría scrollbars. Solo actúa en la página completa. */
    if (window.self !== window.top) return;
    var w = (window.screen && window.screen.width) || 0;
    var h = (window.screen && window.screen.height) || 0;
    if (!w || !h) return;
    var z = ZOOMS[w + "x" + h];
    if (!z) {
      var widths = Object.keys(ZOOMS).map(function (k) {
        var m = k.split("x");
        return { w: parseInt(m[0], 10), z: ZOOMS[k] };
      });
      var mismoAncho = widths.filter(function (o) { return o.w === w; });
      if (mismoAncho.length) z = mismoAncho[0].z;
      else {
        var cercanos = widths.filter(function (o) {
          return Math.abs(o.w - w) / w <= 0.1;
        }).sort(function (a, b) { return Math.abs(a.w - w) - Math.abs(b.w - w); });
        if (cercanos.length) z = cercanos[0].z;
      }
    }
    if (z && z !== 1) {
      var st = document.documentElement.style;
      var apply = function () {
        st.zoom = String(z);
        document.documentElement.setAttribute("data-vp-zoom", String(z));
      };
      apply();
      window.addEventListener("DOMContentLoaded", apply);
    }
  } catch (e) { /* nunca romper la web anfitriona */ }
})();
