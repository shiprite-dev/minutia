// The policy checker — PURE. Compares the observed authz matrix against the
// hand-audited policy.json and returns a flat list of violations. Default-deny:
// anything in the matrix that policy.json does not declare fails closed.

import { orgAId, orgBId } from "./scenarios.mjs";

const ORG_ID = { orgA: orgAId, orgB: orgBId };

function isDeny(outcome) {
  return outcome === "401" || outcome === "403" || String(outcome).startsWith("redirect:");
}

export function orgIdFor(identity, policy) {
  const orgKey = policy.orgOf?.[identity];
  return ORG_ID[orgKey] ?? null;
}

export function checkPolicy(matrix, policy, scenario) {
  const violations = [];

  for (const nodeId of Object.keys(policy.nodes)) {
    const node = policy.nodes[nodeId];
    const observedRow = matrix[nodeId];
    if (!observedRow) {
      violations.push({ type: "missing-node", node: nodeId });
      continue;
    }

    for (const identity of policy.identities) {
      const verdict = observedRow[identity] ?? {};
      const observed = verdict.outcome;
      const expected = node.expect[identity];

      if (observed !== expected) {
        if (isDeny(expected) && observed === "pass") {
          violations.push({ type: "reachability-leak", node: nodeId, identity, expected, observed });
        } else if (expected === "pass" && isDeny(observed)) {
          violations.push({ type: "reachability-regression", node: nodeId, identity, expected, observed });
        } else {
          violations.push({ type: "reachability-mismatch", node: nodeId, identity, expected, observed });
        }
      }

      // Tenant isolation: only meaningful on a reached tenant-scoped response.
      if (node.tenantScoped && observed === "pass") {
        const callerOrg = orgIdFor(identity, policy);

        // Vacuous-pass guard: a tenant-scoped handler that reaches but returns
        // ZERO rows across every declared bodyPath cannot prove isolation (there
        // is nothing to check). A real tenant-scoped handler here always returns
        // >=1 row (members includes the caller), so an all-empty pass is a defect.
        const totalRows = node.tenantScoped.reduce(
          (n, check) => n + (verdict.body?.[check.bodyPath] ?? []).length,
          0
        );
        if (totalRows === 0) {
          violations.push({
            type: "tenant-unverified",
            node: nodeId,
            identity,
            detail: "tenant-scoped pass returned no rows to verify isolation",
          });
        }

        for (const check of node.tenantScoped) {
          const rows = verdict.body?.[check.bodyPath] ?? [];
          for (const row of rows) {
            const item = row[check.idField];
            const entry = (scenario.db[check.entity] ?? []).find(
              (e) => e[check.entityMatchField] === item
            );
            if (!entry || entry.organization_id !== callerOrg) {
              violations.push({
                type: "tenant-leak",
                node: nodeId,
                identity,
                entity: check.entity,
                item,
                expectedOrg: callerOrg,
                foundOrg: entry?.organization_id ?? null,
              });
            }
          }
        }
      }
    }
  }

  // Default-deny: any crawled node not declared in policy fails closed.
  for (const nodeId of Object.keys(matrix)) {
    if (!policy.nodes[nodeId]) {
      violations.push({ type: "undeclared-node", node: nodeId });
    }
  }

  return violations;
}
