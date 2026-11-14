/**
 * Every route an Express app serves, with whether it runs `authenticate`.
 *
 * Express keeps no list of its routes, only a stack of layers per router, each
 * matched by a regular expression; this walks those stacks and reads the mount
 * paths back out of the expressions. It is used by the tests that check every
 * signed-in route has been placed under a feature switch.
 */
function mountPath(layer) {
  if (layer.regexp?.fast_slash) return "";
  const source = layer.regexp?.source || "";
  return source
    .replace(/^\^/, "")
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, "")
    .replace(/\(\?:\\\/\(\?=\$\)\)\?\$$/, "")
    .replace(/\\\//g, "/");
}

function listRoutes(app, authenticate) {
  const out = [];
  const walk = (stack, prefix, signedIn) => {
    let guarded = signedIn;
    for (const layer of stack) {
      if (layer.route) {
        const own = layer.route.stack.some((l) => l.handle === authenticate);
        for (const method of Object.keys(layer.route.methods)) {
          out.push({ method: method.toUpperCase(), path: `${prefix}${layer.route.path}`, signedIn: guarded || own });
        }
      } else if (layer.handle === authenticate) {
        guarded = true;
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack, `${prefix}${mountPath(layer)}`, guarded);
      }
    }
  };
  walk(app._router.stack, "", false);
  return out;
}

module.exports = { listRoutes };
