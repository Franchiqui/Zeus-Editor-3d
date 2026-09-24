// Actualiza el texto de faceSelHint en los 7 idiomas (añade Escape y Ctrl+clic).
const fs = require('fs');
const ruta = 'F:/Zeus Media Studio-3D/lib/i18n/translations.ts';
let texto = fs.readFileSync(ruta, 'utf8');

const reemplazos = [
  [
    "faceSelHint: 'Arrastra para seleccionar; arrastra sobre la selección para moverla'",
    "faceSelHint: 'Arrastra para seleccionar; arrastra sobre la selección para moverla · Ctrl o Mayús+clic: añade o quita una a una · Escape: deselecciona todo'",
  ],
  [
    "faceSelHint: 'Drag to select; drag over the selection to move it'",
    "faceSelHint: 'Drag to select; drag over the selection to move it · Ctrl or Shift+click: add or remove one by one · Esc: deselect all'",
  ],
  [
    "faceSelHint: 'Glissez pour sélectionner ; glissez sur la sélection pour la déplacer'",
    "faceSelHint: 'Glissez pour sélectionner ; glissez sur la sélection pour la déplacer · Ctrl ou Maj+clic : ajoute ou retire un par un · Échap : tout désélectionner'",
  ],
  [
    "faceSelHint: 'Ziehen zum Auswählen; über der Auswahl ziehen zum Verschieben'",
    "faceSelHint: 'Ziehen zum Auswählen; über der Auswahl ziehen zum Verschieben · Strg oder Umschalt+Klick: einzeln hinzufügen/entfernen · Esc: alles abwählen'",
  ],
  [
    "faceSelHint: 'Trascina per selezionare; trascina sulla selezione per spostarla'",
    "faceSelHint: 'Trascina per selezionare; trascina sulla selezione per spostarla · Ctrl o Maiusc+clic: aggiunge o toglie uno a uno · Esc: deseleziona tutto'",
  ],
  [
    "faceSelHint: '拖动进行选择；在选区上拖动可移动它'",
    "faceSelHint: '拖动进行选择；在选区上拖动可移动它 · Ctrl 或 Shift+点击：逐个添加或移除 · Esc：全部取消选择'",
  ],
  [
    "faceSelHint: 'चयन के लिए खींचें; उसे हिलाने के लिए चयन पर खींचें'",
    "faceSelHint: 'चयन के लिए खींचें; उसे हिलाने के लिए चयन पर खींचें · Ctrl या Shift+क्लिक: एक-एक करके जोड़ें या हटाएँ · Esc: सब deselect करें'",
  ],
];

let total = 0;
for (const [viejo, nuevo] of reemplazos) {
  if (!texto.includes(viejo)) {
    console.error('NO ENCONTRADO:', viejo.slice(0, 60));
    process.exit(1);
  }
  texto = texto.replace(viejo, nuevo);
  total++;
}
fs.writeFileSync(ruta, texto, 'utf8');
console.log(`OK: ${total} avisos actualizados`);