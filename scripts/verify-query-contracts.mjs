import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const useSeries = fs.readFileSync("src/lib/hooks/use-series.ts", "utf8");

assert(
  !useSeries.includes("setInterval(refresh, 3000)") &&
    !useSeries.includes("setInterval(refresh, 2_000)") &&
    !useSeries.includes("setInterval(refresh, 2000)"),
  "Series detail realtime must not poll every few seconds"
);

// The self-host PostgREST (v12.2.3, pinned in docker-compose.yml) does not apply
// `.or()` / `.and()` logical filters to UPDATE/DELETE mutations: they silently
// match 0 rows. Such a claim works in CI/Cloud (newer PostgREST) but breaks on
// every self-host instance. Express conditional mutations as a SECURITY DEFINER
// RPC instead. Guard against the pattern regressing.
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = `${dir}/${e.name}`;
    if (e.isDirectory()) return walk(full);
    return e.isFile() && /\.tsx?$/.test(e.name) ? [full] : [];
  });
}
const mutationOrFilter = /\.(update|delete)\([\s\S]{0,400}?\.(or|and)\(/;
for (const file of walk("src")) {
  assert(
    !mutationOrFilter.test(fs.readFileSync(file, "utf8")),
    `${file}: do not chain .or()/.and() onto .update()/.delete(); self-host PostgREST ignores it on mutations. Use a SECURITY DEFINER RPC.`
  );
}

console.log("Query contracts verified");
