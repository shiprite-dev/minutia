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

console.log("Query contracts verified");
