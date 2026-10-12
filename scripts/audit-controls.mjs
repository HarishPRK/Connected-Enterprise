import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

// A review inventory, not a claim of browser coverage. Event delegation,
// form submission, refs, and gated controls require a human semantic check.
const root = process.cwd();
const controls = [];
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? files(target) : target.endsWith('.tsx') ? [target] : [];
  });
}
for (const file of files(path.join(root, 'src'))) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(source);
      if (['button', 'input', 'select', 'textarea'].includes(tag)) {
        const attributes = node.attributes.properties;
        const names = attributes.filter(ts.isJsxAttribute).map(item => item.name.getText(source));
        const spread = attributes.some(ts.isJsxSpreadAttribute);
        const attr = name => attributes.find(item => ts.isJsxAttribute(item) && item.name.getText(source) === name)?.initializer?.getText(source);
        const handlers = names.filter(name => /^on[A-Z]/.test(name));
        let form = node.parent;
        while (form && !(ts.isJsxElement(form) && form.openingElement.tagName.getText(source) === 'form')) form = form.parent;
        const gated = names.includes('disabled') || names.includes('readOnly') || attr('type') === '"hidden"';
        const hasAction = tag === 'button'
          ? handlers.some(name => /Click|Pointer|Mouse|Key/.test(name)) || (form && attr('type') !== '"button"')
          : handlers.some(name => /Change|Input|Key/.test(name)) || names.includes('ref') || Boolean(form);
        controls.push({
          file: path.relative(root, file).replaceAll('\\', '/'),
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          tag, handlers, gated, spread,
          review: !hasAction && !gated && !spread,
          source: node.getText(source).replace(/\s+/g, ' ').slice(0, 300),
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
const inventory = {
  generatedAt: new Date().toISOString(),
  totals: Object.fromEntries(['button', 'input', 'select', 'textarea'].map(tag => [tag, controls.filter(item => item.tag === tag).length])),
  requiresReview: controls.filter(item => item.review),
  controls,
};
if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(inventory, null, 2) + '\n');
console.log(JSON.stringify({ totals: inventory.totals, requiresReview: inventory.requiresReview }, null, 2));
