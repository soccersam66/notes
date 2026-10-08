// Runs the Giac math engine (GeoGebra's build, GPL-3) off the main thread.
let caseval = null;
const queue = [];

function handle(msg) {
  const t0 = Date.now();
  try {
    const result = caseval(msg.cmd);
    postMessage({ id: msg.id, result, ms: Date.now() - t0 });
  } catch (e) {
    postMessage({ id: msg.id, error: String(e && e.message || e) });
  }
}

self.__ggb__giac = {
  print() {}, printErr() {},
  locateFile: (p) => new URL('../vendor/giac/' + p, self.location.href).href,
  instantiateWasm(imports, ok) {
    fetch(new URL('../vendor/giac/giac.wasm', self.location.href).href)
      .then(r => { if (!r.ok) throw new Error('giac.wasm ' + r.status); return r.arrayBuffer(); })
      .then(b => WebAssembly.instantiate(b, imports))
      .then(r => ok(r.instance))
      .catch(e => postMessage({ type: 'fatal', error: String(e && e.message || e) }));
    return {};
  },
  onRuntimeInitialized() {
    caseval = self.__ggb__giac.cwrap('caseval', 'string', ['string']);
    postMessage({ type: 'ready' });
    while (queue.length) handle(queue.shift());
  }
};

importScripts('../vendor/giac/giac.glue.js');

onmessage = (e) => {
  if (!caseval) queue.push(e.data); else handle(e.data);
};
