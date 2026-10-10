import { paths } from './config.js';
import { readJson, writeJson } from './util.js';

/** Small JSON-file store with serialised read-modify-write, for state under /state. */
export function jsonStore(name, defaults) {
  let cache = null, chain = Promise.resolve();
  const file = () => paths.state(name);
  const load = async () => (cache ||= { ...structuredClone(defaults), ...(await readJson(file(), {})) });
  return {
    read: load,
    mutate(fn) {
      const run = chain.then(async () => { const d = await load(); const r = await fn(d); await writeJson(file(), d, 0o600); return r; });
      chain = run.catch(() => {});
      return run;
    },
  };
}
