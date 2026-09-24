const ts = require('typescript');
const fs = require('fs');

const files = process.argv.slice(2);
let bad = 0;
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  const res = ts.transpileModule(src, {
    reportDiagnostics: true,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.ESNext,
      isolatedModules: true,
    },
    fileName: f,
  });
  const diags = (res.diagnostics || []).filter(
    (d) => d.category === ts.DiagnosticCategory.Error
  );
  if (diags.length) {
    bad++;
    console.log('ERRORES en ' + f + ' (' + diags.length + ')');
    for (const d of diags) {
      const pos =
        d.file && d.start != null
          ? d.file.getLineAndCharacterOfPosition(d.start)
          : null;
      console.log(
        `  ${pos ? 'L' + (pos.line + 1) + ':' + (pos.character + 1) + ' ' : ''}${ts.flattenDiagnosticMessageText(
          d.messageText,
          '\n'
        )}`
      );
    }
  } else {
    console.log('OK  ' + f);
  }
}
process.exit(bad ? 1 : 0);
