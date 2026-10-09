// Test helper: load the app's Giac build (vendor/giac) in Node, so the math engine can be tested without a browser.
const fs = require('fs'), path = require('path'), vm = require('vm');
module.exports = function loadGiac(dir) {
  return new Promise((resolve, reject) => {
    const self = { location: { href: 'file://' + dir + '/' } };
    const mod = self.__ggb__giac = {
      print() {}, printErr() {},
      instantiateWasm(imports, ok) { WebAssembly.instantiate(fs.readFileSync(path.join(dir, 'giac.wasm')), imports).then(r => ok(r.instance)).catch(reject); return {}; },
      onRuntimeInitialized() { resolve(mod.cwrap('caseval', 'string', ['string'])); }
    };
    const ctx = { self, console, WebAssembly, setTimeout, clearTimeout, TextDecoder, TextEncoder, performance, URL };
    ctx.__ggb__giac = mod; ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(dir, 'giac.glue.js'), 'utf8'), ctx, { filename: 'giac.glue.js' });
  });
};
