'use strict';

const { SCOPES, scanScope } = require('../src/main/scanner');

async function main() {
  const scope = SCOPES.find((item) => item.label.indexOf('文件夹（Directory）') === 0) || SCOPES[0];
  console.log('Scanning:', scope.label);
  const items = await scanScope(scope);
  console.log('Total:', items.length);
  console.log(JSON.stringify(items.slice(0, 12), null, 2));
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
