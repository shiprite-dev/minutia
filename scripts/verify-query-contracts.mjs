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

// Self-host PostgREST ignores .or()/.and() on UPDATE/DELETE (0 rows); use an RPC.
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
