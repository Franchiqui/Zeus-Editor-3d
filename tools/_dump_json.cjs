const fs = require('fs');
const file = process.argv[2];
const start = parseInt(process.argv[3], 10);
const end = parseInt(process.argv[4], 10);
const lines = fs.readFileSync(file, 'utf8').split('\n');
for (let i = start; i <= end && i <= lines.length; i++) {
  console.log(i + ': ' + JSON.stringify(lines[i - 1]));
}
