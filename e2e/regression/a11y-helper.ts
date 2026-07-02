import { expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

export async function expectNoCriticalA11y(
  page: Page,
  opts?: { disableRules?: string[] }
) {
  const results = await new AxeBuilder({ page })
    .disableRules(["color-contrast", ...(opts?.disableRules ?? [])])
    .analyze();

  const critical = results.violations.filter((v) => v.impact === "critical");
  const serious = results.violations.filter((v) => v.impact === "serious");

  if (serious.length > 0) {
    for (const violation of serious) {
      console.warn(
        `[a11y] serious: ${violation.id} (${violation.nodes.length} node(s)) - ${violation.help}`
      );
    }
  }

  expect(
    critical,
    critical
      .map(
        (v) =>
          `${v.id}: ${v.help} (${v.nodes.length} node(s): ${v.nodes
            .map((n) => n.target.join(" "))
            .join(", ")})`
      )
      .join("\n")
  ).toEqual([]);
}
