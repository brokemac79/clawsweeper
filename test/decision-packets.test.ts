import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  buildDecisionPacketFromReport,
  syncDecisionPacketRecord,
} from "../dist/decision-packets.js";
import { tmpPrefix } from "./helpers.ts";

test("decision packets derive product decision data from report labels and frontmatter", () => {
  const report = `${workPlanCandidateReport({
    number: 81234,
    repository: "openclaw/openclaw",
    type: "pull_request",
    title: "config.patch redacted array write",
    url: "https://github.com/openclaw/openclaw/pull/81234",
    labels: JSON.stringify(["clawsweeper:needs-product-decision", "app: web-ui", "P1"]),
    requires_product_decision: "true",
    confidence: "high",
    item_updated_at: "2026-06-20T00:00:00Z",
    current_item_updated_at: "2026-06-23T01:00:00Z",
    pull_head_sha: "abc123",
    main_sha: "main456",
    review_comment_url: "https://github.com/openclaw/openclaw/pull/81234#issuecomment-99",
    work_cluster_refs: JSON.stringify([
      "https://github.com/openclaw/openclaw/pull/81111",
      "#81112",
      "openclaw/clawhub#44",
    ]),
    root_cause_cluster: JSON.stringify({
      members: [{ ref: "https://github.com/openclaw/openclaw/issues/81113" }],
    }),
  })}

## Best Possible Solution

Ask the owning product maintainer to decide whether redacted full-array writes are valid.

## Risks / Open Questions

- The current implementation may overwrite redacted array entries.
`;

  const packet = buildDecisionPacketFromReport(report, {
    generatedAt: "2026-06-23T12:00:00.000Z",
    reportPath: "records/openclaw-openclaw/items/81234.md",
  });

  assert.ok(packet);
  assert.equal(packet.lane, "product_contract");
  assert.equal(packet.priority, "P1");
  assert.equal(packet.evidenceStrength, "high");
  assert.equal(packet.subject.repo, "openclaw/openclaw");
  assert.equal(packet.subject.kind, "pull_request");
  assert.equal(packet.subject.headSha, "abc123");
  assert.equal(packet.subject.updatedAt, "2026-06-23T01:00:00Z");
  assert.deepEqual(packet.subject.labels, [
    "clawsweeper:needs-product-decision",
    "app: web-ui",
    "P1",
  ]);
  assert.deepEqual(packet.suggestedLabels, [
    "clawsweeper:needs-product-decision",
    "app: web-ui",
    "P1",
  ]);
  assert.equal(
    packet.recommendedActions[0],
    "Ask the owning product maintainer to decide whether redacted full-array writes are valid.",
  );
  assert.deepEqual(packet.risks, [
    "The current implementation may overwrite redacted array entries.",
  ]);
  assert.deepEqual(
    packet.linkedItems.map((item) => ({
      repo: item.repo,
      kind: item.kind,
      number: item.number,
    })),
    [
      { repo: "openclaw/openclaw", kind: "pull_request", number: 81111 },
      { repo: "openclaw/openclaw", kind: "issue", number: 81112 },
      { repo: "openclaw/clawhub", kind: "issue", number: 44 },
      { repo: "openclaw/openclaw", kind: "issue", number: 81113 },
    ],
  );
  assert.equal(
    packet.linkedItems.every((item) => !("state" in item)),
    true,
  );
  assert.equal("areaLabel" in packet, false);
});

test("decision packets preserve legacy comma-separated labels", () => {
  const packet = buildDecisionPacketFromReport(
    workPlanCandidateReport({
      number: 81235,
      repository: "openclaw/openclaw",
      labels: "clawsweeper:needs-product-decision, status: needs proof, P2",
    }),
    {
      generatedAt: "2026-06-23T12:00:00.000Z",
      reportPath: "records/openclaw-openclaw/items/81235.md",
    },
  );

  assert.ok(packet);
  assert.equal(packet.lane, "product_contract");
  assert.deepEqual(packet.subject.labels, [
    "clawsweeper:needs-product-decision",
    "status: needs proof",
    "P2",
  ]);
});

test("decision packets prefer reconciled current state", () => {
  const packet = buildDecisionPacketFromReport(
    workPlanCandidateReport({
      number: 81236,
      repository: "openclaw/openclaw",
      labels: "clawsweeper:needs-product-decision",
      action_taken: "kept_open",
      current_state: "closed",
    }),
    {
      generatedAt: "2026-06-23T12:00:00.000Z",
      reportPath: "records/openclaw-openclaw/closed/81236.md",
    },
  );

  assert.ok(packet);
  assert.equal(packet.subject.state, "closed");
});

test("decision packets read CRLF report sections", () => {
  const report = `${workPlanCandidateReport({
    number: 81237,
    repository: "openclaw/openclaw",
    labels: JSON.stringify([]),
  })}

## Security Review

Status: needs_attention
Concern: Requires maintainer security review.
`.replace(/\n/g, "\r\n");
  const packet = buildDecisionPacketFromReport(report, {
    generatedAt: "2026-06-23T12:00:00.000Z",
    reportPath: "records/openclaw-openclaw/items/81237.md",
  });

  assert.ok(packet);
  assert.equal(packet.lane, "security_boundary");
});

test("decision packets surface proof and release trigger labels", () => {
  const packet = buildDecisionPacketFromReport(
    workPlanCandidateReport({
      number: 81238,
      repository: "openclaw/openclaw",
      labels: "release-blocker, beta-blocker, triage: needs-real-behavior-proof",
    }),
    {
      generatedAt: "2026-06-23T12:00:00.000Z",
      reportPath: "records/openclaw-openclaw/items/81238.md",
    },
  );

  assert.ok(packet);
  assert.equal(packet.lane, "proof_or_repro_decision");
  assert.deepEqual(packet.suggestedLabels, [
    "release-blocker",
    "beta-blocker",
    "triage: needs-real-behavior-proof",
  ]);
  assert.match(
    packet.evidence.find((entry) => entry.label === "Decision labels")?.detail ?? "",
    /triage: needs-real-behavior-proof/,
  );
});

test("decision packet sync writes packet JSON and frontmatter pointers", () => {
  const root = mkdtempSync(tmpPrefix);
  try {
    const packetsDir = join(root, "records", "openclaw-openclaw", "decision-packets");
    const reportPath = join(root, "records", "openclaw-openclaw", "items", "321.md");
    const markdown = workPlanCandidateReport({
      repository: "openclaw/openclaw",
      labels: JSON.stringify(["clawsweeper:needs-maintainer-review", "channel: telegram"]),
      work_status: "manual_review",
      confidence: "medium",
    });

    const result = syncDecisionPacketRecord({
      markdown,
      reportPath,
      packetsDir,
      repoRoot: root,
      generatedAt: "2026-06-23T12:00:00.000Z",
      subjectState: "open",
    });

    assert.ok(result.packet);
    assert.ok(result.packetPath);
    assert.ok(existsSync(result.packetPath));
    assert.match(
      result.markdown,
      /^decision_packet_path: records\/openclaw-openclaw\/decision-packets\/321\.json$/m,
    );
    assert.match(result.markdown, /^decision_packet_sha256: [a-f0-9]{64}$/m);
    const packet = JSON.parse(readFileSync(result.packetPath, "utf8"));
    assert.equal(packet.lane, "maintainer_review");
    assert.deepEqual(packet.subject.labels, [
      "clawsweeper:needs-maintainer-review",
      "channel: telegram",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function workPlanCandidateReport(overrides = {}) {
  const frontmatter = {
    number: 321,
    repository: "openclaw/clawsweeper",
    type: "issue",
    title: "Render work plans",
    reviewed_at: new Date().toISOString(),
    review_status: "complete",
    local_checkout_access: "verified",
    decision: "keep_open",
    action_taken: "kept_open",
    work_candidate: "queue_fix_pr",
    work_status: "candidate",
    work_priority: "medium",
    work_confidence: "high",
    work_likely_files: JSON.stringify(["src/clawsweeper.ts", "test/clawsweeper.test.ts"]),
    work_validation: JSON.stringify(["pnpm run check"]),
    work_cluster_refs: JSON.stringify(["openclaw/clawsweeper#26"]),
    ...overrides,
  };
  return `---
${Object.entries(frontmatter)
  .map(([key, value]) => `${key}: ${value}`)
  .join("\n")}
---

# #321: Render work plans

## Summary

The dashboard has queue_fix_pr candidates but no generated coding plan.

## Repair Work Prompt

Render generated plan markdown from existing report fields.
`;
}
