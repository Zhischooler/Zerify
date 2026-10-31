'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.env.ZERIFY_PATH || '.');
const FORM_SELECTOR = process.env.ZERIFY_FORM_SELECTOR || '';
const EXCLUDE = (process.env.ZERIFY_EXCLUDE || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const DRY_RUN = process.env.ZERIFY_DRY_RUN === 'true';

const MARKER = 'data-zerify-injected';
const SCRIPT_PATH = path.join(__dirname, 'zerify.js');

function toRegExp(glob) {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp('^' + escaped + '$');
}

const EXCLUDE_RE = EXCLUDE.map(toRegExp);

function isExcluded(relPath) {
  return EXCLUDE_RE.some((re) => re.test(relPath.replace(/\\/g, '/')));
}

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (/\.html?$/i.test(name)) {
      out.push(full);
    }
  }
  return out;
}

function buildInjection() {
  const zerifySource = fs.readFileSync(SCRIPT_PATH, 'utf8');
  const mountSource = `
(function(){
  var FORM_SELECTOR = ${JSON.stringify(FORM_SELECTOR)};
  function mount(){
    var forms = FORM_SELECTOR
      ? Array.prototype.slice.call(document.querySelectorAll(FORM_SELECTOR))
      : Array.prototype.slice.call(document.querySelectorAll('form'));
    forms.forEach(function(form){
      if (form.hasAttribute('data-zerify-ignore')) return;
      if (form.querySelector('.zerify')) return;
      var submit = form.querySelector('button[type="submit"], input[type="submit"]');
      var wrap = document.createElement('div');
      wrap.style.margin = '14px 0';
      if (submit && submit.parentNode === form) {
        form.insertBefore(wrap, submit);
      } else {
        form.appendChild(wrap);
      }
      var verifier = new Zerify(wrap, {
        hint: '按住并水平拖动，画一条横线',
        successText: '验证通过',
        failPrefix: '验证失败：'
      });
      form.addEventListener('submit', function(e){
        if (!verifier.isVerified()) {
          e.preventDefault();
          e.stopImmediatePropagation();
          verifier.reset();
        }
      }, true);
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
`.trim();

  const body = (zerifySource + '\n' + mountSource).replace(/<\/script/gi, '<\\/script');
  return `<script ${MARKER}>\n${body}\n</script>\n`;
}

function injectInto(html, injection) {
  if (html.includes(MARKER)) return null;

  const bodyClose = /<\/body\s*>/i;
  if (bodyClose.test(html)) {
    return html.replace(bodyClose, (m) => injection + m);
  }

  const htmlClose = /<\/html\s*>/i;
  if (htmlClose.test(html)) {
    return html.replace(htmlClose, (m) => injection + m);
  }

  return html + '\n' + injection;
}

function main() {
  if (!fs.existsSync(ROOT)) {
    console.error(`[Zerify] path not found: ${ROOT}`);
    process.exit(1);
  }

  const files = walk(ROOT, []).filter((f) => !isExcluded(path.relative(ROOT, f)));
  const injection = buildInjection();

  let changed = 0;
  let skipped = 0;

  for (const file of files) {
    const rel = path.relative(ROOT, file);
    const original = fs.readFileSync(file, 'utf8');
    const next = injectInto(original, injection);

    if (next === null) {
      skipped++;
      console.log(`[Zerify] skip  ${rel}`);
      continue;
    }

    if (DRY_RUN) {
      console.log(`[Zerify] would inject ${rel}`);
      changed++;
      continue;
    }

    fs.writeFileSync(file, next, 'utf8');
    console.log(`[Zerify] inject ${rel}`);
    changed++;
  }

  console.log(
    `[Zerify] scanned ${files.length}, modified ${changed}, skipped ${skipped}${DRY_RUN ? ' (dry-run)' : ''}`
  );
}

main();
