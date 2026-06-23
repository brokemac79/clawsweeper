import { createHash } from "node:crypto";
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";

export type DecisionPacketLane =
  | "product_contract"
  | "security_boundary"
  | "maintainer_review"
  | "release_inclusion"
  | "proof_or_repro_decision";

export type DecisionPacketPriority = "P0" | "P1" | "P2" | "P3" | "none";
export type DecisionPacketEvidenceStrength = "low" | "medium" | "high";
export type DecisionPacketSubjectState = "open" | "closed" | "merged";

export interface DecisionPacketEvidence {
  label: string;
  detail: string;
  url?: string;
  file?: string;
  line?: number;
  sha?: string;
}

export interface DecisionPacketLinkedItem {
  repo: string;
  kind: "issue" | "pull_request";
  number: number;
  url: string;
  state?: DecisionPacketSubjectState;
  relationship: "fix" | "duplicate" | "dependency" | "prior_art" | "symptom" | "related";
}

export interface DecisionPacket {
  version: 1;
  generatedAt: string;
  updatedAt: string;
  subject: {
    repo: string;
    kind: "issue" | "pull_request";
    number: number;
    title: string;
    url: string;
    state: DecisionPacketSubjectState;
    labels: string[];
    createdAt?: string;
    updatedAt?: string;
    stateChangedAt?: string;
    headSha?: string;
  };
  lane: DecisionPacketLane;
  priority: DecisionPacketPriority;
  claim: string;
  maintainerQuestion: string;
  whyHuman: string;
  evidenceStrength: DecisionPacketEvidenceStrength;
  evidence: DecisionPacketEvidence[];
  linkedItems: DecisionPacketLinkedItem[];
  risks: string[];
  recommendedActions: string[];
  suggestedLabels: string[];
  source: {
    reportPath: string;
    reportUrl?: string;
    reviewCommentUrl?: string;
    reviewedAt?: string;
    mainSha?: string;
  };
}

export interface DecisionPacketBuildOptions {
  generatedAt?: string;
  reportPath?: string;
  reportUrl?: string;
  subjectState?: DecisionPacketSubjectState;
}

export interface DecisionPacketSyncOptions extends DecisionPacketBuildOptions {
  markdown: string;
  reportPath: string;
  packetsDir: string;
  repoRoot: string;
}

export interface DecisionPacketSyncResult {
  markdown: string;
  packet: DecisionPacket | null;
  packetPath?: string;
  packetSha256?: string;
}

const DECISION_LABEL_PREFIXES = [
  "clawsweeper:",
  "proof:",
  "status:",
  "app:",
  "channel:",
  "extensions:",
  "impact:",
  "merge-risk:",
  "triage:",
] as const;
const DECISION_LABEL_MATCHES = ["release-blocker", "beta-blocker"] as const;

export function buildDecisionPacketFromReport(
  markdown: string,
  options: DecisionPacketBuildOptions = {},
): DecisionPacket | null {
  const frontmatter = frontMatter(markdown);
  const repo = frontmatter.repository;
  const kind = frontmatter.type;
  const number = numberValue(frontmatter.number);
  if (!repo || (kind !== "issue" && kind !== "pull_request") || number === null) return null;

  const labels = stringArrayValue(frontmatter.labels);
  const lane = packetLane(frontmatter, markdown, labels);
  if (!lane) return null;

  const generatedAt = options.generatedAt ?? frontmatter.reviewed_at ?? new Date().toISOString();
  const updatedAt = frontmatter.reviewed_at ?? generatedAt;
  const subjectUpdatedAt =
    knownValue(frontmatter.current_item_updated_at) ?? knownValue(frontmatter.item_updated_at);
  const title = frontmatter.title ?? reportHeadingTitle(markdown) ?? `#${number}`;
  const url =
    frontmatter.url ??
    `https://github.com/${repo}/${kind === "pull_request" ? "pull" : "issues"}/${number}`;
  const reviewCommentUrl = knownValue(frontmatter.review_comment_url);
  const mainSha = knownValue(frontmatter.main_sha);
  const headSha = knownValue(frontmatter.pull_head_sha);
  const claim = firstSentence(sectionValue(markdown, "Summary")) || title;
  const recommendedActions = recommendedActionsFor(lane, markdown, frontmatter);
  const source: DecisionPacket["source"] = {
    reportPath: options.reportPath ?? "",
    ...(options.reportUrl ? { reportUrl: options.reportUrl } : {}),
    ...(reviewCommentUrl ? { reviewCommentUrl } : {}),
    ...(frontmatter.reviewed_at ? { reviewedAt: frontmatter.reviewed_at } : {}),
    ...(mainSha ? { mainSha } : {}),
  };

  return {
    version: 1,
    generatedAt,
    updatedAt,
    subject: {
      repo,
      kind,
      number,
      title,
      url,
      state: options.subjectState ?? stateFromReport(frontmatter),
      labels,
      ...(frontmatter.item_created_at ? { createdAt: frontmatter.item_created_at } : {}),
      ...(subjectUpdatedAt ? { updatedAt: subjectUpdatedAt } : {}),
      ...(frontmatter.current_item_closed_at
        ? { stateChangedAt: frontmatter.current_item_closed_at }
        : {}),
      ...(headSha ? { headSha } : {}),
    },
    lane,
    priority: priorityFrom(frontmatter, labels),
    claim,
    maintainerQuestion: maintainerQuestionFor(lane, frontmatter),
    whyHuman: whyHumanFor(lane),
    evidenceStrength: evidenceStrengthFrom(frontmatter),
    evidence: packetEvidence(markdown, frontmatter, labels),
    linkedItems: linkedItemsFrom(frontmatter, markdown),
    risks: risksFrom(markdown, frontmatter),
    recommendedActions,
    suggestedLabels: suggestedLabels(labels),
    source,
  };
}

export function renderDecisionPacketPublicBlock(markdown: string): string {
  const packet = buildDecisionPacketFromReport(markdown);
  if (!packet) return "";
  const action = packet.recommendedActions[0] ?? packet.maintainerQuestion;
  return [
    `- Lane: ${publicLaneName(packet.lane)}.`,
    `- Question: ${packet.maintainerQuestion}`,
    `- Evidence strength: ${packet.evidenceStrength}.`,
    `- Recommended action: ${action}`,
  ].join("\n");
}

export function syncDecisionPacketRecord(
  options: DecisionPacketSyncOptions,
): DecisionPacketSyncResult {
  const buildOptions: DecisionPacketBuildOptions = {
    reportPath: repoRelativePath(options.repoRoot, options.reportPath),
    ...(options.generatedAt ? { generatedAt: options.generatedAt } : {}),
    ...(options.reportUrl ? { reportUrl: options.reportUrl } : {}),
    ...(options.subjectState ? { subjectState: options.subjectState } : {}),
  };
  const packet = buildDecisionPacketFromReport(options.markdown, buildOptions);
  const frontmatter = frontMatter(options.markdown);
  const number = numberValue(frontmatter.number);
  const packetPath = number === null ? undefined : `${options.packetsDir}/${number}.json`;
  if (!packet || !packetPath) {
    if (packetPath && existsSync(packetPath)) unlinkSync(packetPath);
    return {
      markdown: replacePacketFrontmatter(options.markdown, "none", "none"),
      packet: null,
      ...(packetPath ? { packetPath } : {}),
    };
  }

  mkdirSync(dirname(packetPath), { recursive: true });
  const json = `${JSON.stringify(packet, null, 2)}\n`;
  writeFileSync(packetPath, json, "utf8");
  const packetSha256 = sha256(json);
  const markdown = replacePacketFrontmatter(
    options.markdown,
    repoRelativePath(options.repoRoot, packetPath),
    packetSha256,
  );
  return { markdown, packet, packetPath, packetSha256 };
}

function packetLane(
  frontmatter: Record<string, string>,
  markdown: string,
  labels: readonly string[],
): DecisionPacketLane | null {
  const normalizedLabels = labels.map((label) => label.toLowerCase());
  const securityStatus = sectionLineValue(sectionValue(markdown, "Security Review"), "Status");
  if (
    frontmatter.item_category === "security" ||
    securityStatus === "needs_attention" ||
    normalizedLabels.includes("clawsweeper:needs-security-review") ||
    normalizedLabels.some((label) => label.startsWith("merge-risk:") && label.includes("security"))
  ) {
    return "security_boundary";
  }
  if (
    frontmatter.requires_product_decision === "true" ||
    normalizedLabels.includes("clawsweeper:needs-product-decision")
  ) {
    return "product_contract";
  }
  if (
    normalizedLabels.includes("clawsweeper:needs-live-repro") ||
    normalizedLabels.includes("triage: needs-real-behavior-proof") ||
    normalizedLabels.some(
      (label) => label.startsWith("status:") && label.includes("needs proof"),
    ) ||
    frontmatter.real_behavior_proof_needs_contributor_action === "true"
  ) {
    return "proof_or_repro_decision";
  }
  if (
    frontmatter.work_status === "manual_review" ||
    frontmatter.work_candidate === "manual_review" ||
    normalizedLabels.includes("clawsweeper:needs-maintainer-review")
  ) {
    return "maintainer_review";
  }
  if (
    normalizedLabels.some(
      (label) => label.includes("release-blocker") || label.includes("beta-blocker"),
    )
  ) {
    return "release_inclusion";
  }
  return null;
}

function stateFromReport(frontmatter: Record<string, string>): DecisionPacketSubjectState {
  if (
    frontmatter.current_state === "open" ||
    frontmatter.current_state === "closed" ||
    frontmatter.current_state === "merged"
  ) {
    return frontmatter.current_state;
  }
  if (
    frontmatter.action_taken === "closed" ||
    frontmatter.action_taken === "skipped_already_closed"
  ) {
    return "closed";
  }
  return "open";
}

function priorityFrom(
  frontmatter: Record<string, string>,
  labels: readonly string[],
): DecisionPacketPriority {
  if (isPriority(frontmatter.triage_priority)) return frontmatter.triage_priority;
  const labelPriority = labels.find(isPriority);
  return labelPriority ?? "none";
}

function evidenceStrengthFrom(frontmatter: Record<string, string>): DecisionPacketEvidenceStrength {
  const confidence = frontmatter.confidence;
  return confidence === "high" || confidence === "medium" || confidence === "low"
    ? confidence
    : "medium";
}

function maintainerQuestionFor(
  lane: DecisionPacketLane,
  frontmatter: Record<string, string>,
): string {
  if (lane === "security_boundary") {
    return "Should this security or trust-boundary change be accepted before merge?";
  }
  if (lane === "product_contract") {
    return "Should this product/API contract direction be accepted?";
  }
  if (lane === "proof_or_repro_decision") {
    return "Is the available proof or reproduction enough for maintainer action?";
  }
  if (lane === "release_inclusion") {
    return "Should this item block or be included in the release?";
  }
  if (frontmatter.work_reason) return firstSentence(frontmatter.work_reason);
  return "What maintainer action should happen next for this item?";
}

function whyHumanFor(lane: DecisionPacketLane): string {
  switch (lane) {
    case "security_boundary":
      return "This affects a trust boundary or security-sensitive behavior that should not be decided by automation.";
    case "product_contract":
      return "This changes product/API direction and needs a maintainer ruling before automation can act safely.";
    case "proof_or_repro_decision":
      return "Automation can collect proof, but a maintainer must decide whether the proof is sufficient.";
    case "release_inclusion":
      return "Release inclusion and blocking decisions need maintainer judgment.";
    case "maintainer_review":
      return "ClawSweeper classified this as manual-review work.";
  }
}

function recommendedActionsFor(
  lane: DecisionPacketLane,
  markdown: string,
  frontmatter: Record<string, string>,
): string[] {
  const candidates = [
    sectionValue(markdown, "Best Possible Solution"),
    sectionValue(markdown, "Best Solution"),
    sectionValue(markdown, "Repair Work Prompt"),
    sectionLineValue(sectionValue(markdown, "Work Candidate"), "Reason"),
  ]
    .map(firstSentence)
    .filter(Boolean);
  if (candidates.length > 0) return uniqueStrings(candidates).slice(0, 3);
  if (frontmatter.work_status === "manual_review")
    return ["Assign a maintainer to review the item."];
  if (lane === "security_boundary")
    return ["Ask the security or owning maintainer to rule before merge."];
  if (lane === "product_contract")
    return ["Ask the owning maintainer to rule on the product/API contract."];
  if (lane === "proof_or_repro_decision")
    return ["Ask a maintainer whether the proof/reproduction is sufficient."];
  return ["Ask a maintainer for the next decision."];
}

function packetEvidence(
  markdown: string,
  frontmatter: Record<string, string>,
  labels: readonly string[],
): DecisionPacketEvidence[] {
  const evidence: DecisionPacketEvidence[] = [];
  addEvidence(evidence, "Summary", sectionValue(markdown, "Summary"));
  addEvidence(evidence, "Security review", compactLines(sectionValue(markdown, "Security Review")));
  addEvidence(
    evidence,
    "Real behavior proof",
    compactLines(sectionValue(markdown, "Real Behavior Proof")),
  );
  addEvidence(evidence, "Work candidate", compactLines(sectionValue(markdown, "Work Candidate")));
  const labelEvidence = suggestedLabels(labels).join(", ");
  addEvidence(evidence, "Decision labels", labelEvidence);
  if (frontmatter.review_comment_url && frontmatter.review_comment_url !== "unknown") {
    evidence.push({
      label: "Durable review comment",
      detail: "ClawSweeper durable review comment is available.",
      url: frontmatter.review_comment_url,
    });
  }
  return evidence.slice(0, 8);
}

function risksFrom(markdown: string, frontmatter: Record<string, string>): string[] {
  const risks = bulletLines(
    sectionValue(markdown, "Risks / Open Questions") || sectionValue(markdown, "Risks"),
  );
  const mergeRiskLabels = stringArrayValue(frontmatter.merge_risk_labels);
  return uniqueStrings([...risks, ...mergeRiskLabels]).slice(0, 8);
}

function linkedItemsFrom(
  frontmatter: Record<string, string>,
  markdown: string,
): DecisionPacketLinkedItem[] {
  const defaultRepo = subjectRepoFrom(frontmatter);
  const refs = [
    ...stringArrayValue(frontmatter.work_cluster_refs),
    ...rootCauseMemberRefs(frontmatter.root_cause_cluster),
    ...textRefs(sectionValue(markdown, "Root-Cause Cluster"), defaultRepo),
  ];
  const items: DecisionPacketLinkedItem[] = [];
  const seen = new Set<string>();
  for (const ref of refs) {
    const parsed = parseRepoRef(ref, defaultRepo);
    if (!parsed) continue;
    const key = `${parsed.repo}:${parsed.kind}:${parsed.number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      repo: parsed.repo,
      kind: parsed.kind,
      number: parsed.number,
      url: `https://github.com/${parsed.repo}/${parsed.kind === "pull_request" ? "pull" : "issues"}/${parsed.number}`,
      relationship: "related",
    });
  }
  return items.slice(0, 12);
}

function subjectRepoFrom(frontmatter: Record<string, string>): string | undefined {
  if (frontmatter.repository) return frontmatter.repository;
  return frontmatter.url?.match(/\bgithub\.com\/([a-z0-9_.-]+\/[a-z0-9_.-]+)\b/i)?.[1];
}

function suggestedLabels(labels: readonly string[]): string[] {
  return labels
    .filter(isDecisionLabel)
    .concat(labels.filter(isPriority))
    .filter((label, index, array) => array.indexOf(label) === index);
}

function isDecisionLabel(label: string): boolean {
  const normalized = label.toLowerCase();
  return (
    DECISION_LABEL_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    DECISION_LABEL_MATCHES.some((match) => normalized.includes(match))
  );
}

function frontMatter(markdown: string): Record<string, string> {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const block = match?.[1] ?? "";
  const values: Record<string, string> = {};
  for (const line of block.split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    values[key] = unquote(value);
  }
  return values;
}

function replacePacketFrontmatter(
  markdown: string,
  packetPath: string,
  packetSha256: string,
): string {
  let next = replaceFrontMatterValue(markdown, "decision_packet_path", packetPath);
  next = replaceFrontMatterValue(next, "decision_packet_sha256", packetSha256);
  return next;
}

function replaceFrontMatterValue(markdown: string, key: string, value: string): string {
  const line = `${key}: ${value}`;
  const pattern = new RegExp(`^${escapeRegExp(key)}:\\s*.*$`, "m");
  if (pattern.test(markdown)) return markdown.replace(pattern, line);
  return markdown.replace(/^---\r?\n/, `---\n${line}\n`);
}

function sectionValue(markdown: string, heading: string): string {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  const match = normalized.match(
    new RegExp(`(?:^|\\n)## ${escapeRegExp(heading)}\\n\\n([\\s\\S]*?)(?=\\n## |\\n?$)`),
  );
  return match?.[1]?.trim() ?? "";
}

function sectionLineValue(section: string, label: string): string {
  const pattern = new RegExp(`^${escapeRegExp(label)}:\\s*(.+)$`, "im");
  return pattern.exec(section)?.[1]?.trim() ?? "";
}

function stringArrayValue(value: string | undefined): string[] {
  if (!value || value === "unknown" || value === "none") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === "string");
    }
  } catch {
    // Older reports used plain comma-separated labels.
  }
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function numberValue(value: string | undefined): number | null {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function knownValue(value: string | undefined): string | undefined {
  return value && value !== "unknown" && value !== "none" ? value : undefined;
}

function firstSentence(value: string | undefined): string {
  const normalized = compactLines(value ?? "");
  if (!normalized || normalized === "- none" || normalized === "_Not provided._") return "";
  const sentence = normalized.match(/^(.+?[.!?])(?:\s|$)/)?.[1];
  return (sentence ?? normalized).trim();
}

function compactLines(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}

function addEvidence(items: DecisionPacketEvidence[], label: string, detail: string): void {
  const text = firstSentence(detail);
  if (text) items.push({ label, detail: text });
}

function bulletLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^-\s+/, ""))
    .filter((line) => line && line !== "none");
}

function rootCauseMemberRefs(value: string | undefined): string[] {
  if (!value || value === "unknown") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const members = (parsed as { members?: unknown }).members;
    if (!Array.isArray(members)) return [];
    return members
      .map((member) =>
        member && typeof member === "object" && "ref" in member
          ? (member as { ref?: unknown }).ref
          : undefined,
      )
      .filter((ref): ref is string => typeof ref === "string");
  } catch {
    return [];
  }
}

function textRefs(value: string, defaultRepo: string | undefined): string[] {
  const refs = [
    ...[
      ...value.matchAll(
        /\bhttps?:\/\/github\.com\/[a-z0-9_.-]+\/[a-z0-9_.-]+\/(?:issues|pull)\/\d+\b/gi,
      ),
    ].map((match) => match[0]),
    ...[...value.matchAll(/\b([a-z0-9_.-]+\/[a-z0-9_.-]+)#(\d+)\b/gi)].map(
      (match) => `${match[1]}#${match[2]}`,
    ),
  ];
  if (defaultRepo) {
    refs.push(
      ...[...value.matchAll(/(?:^|[^\w/])#(\d+)\b/g)].map((match) => `${defaultRepo}#${match[1]}`),
    );
  }
  return uniqueStrings(refs);
}

function parseRepoRef(
  value: string,
  defaultRepo?: string,
): { repo: string; kind: "issue" | "pull_request"; number: number } | null {
  const urlMatch = value.match(
    /\bhttps?:\/\/github\.com\/([a-z0-9_.-]+\/[a-z0-9_.-]+)\/(issues|pull)\/(\d+)\b/i,
  );
  if (urlMatch?.[1] && urlMatch[2] && urlMatch[3]) {
    return {
      repo: urlMatch[1],
      kind: urlMatch[2] === "pull" ? "pull_request" : "issue",
      number: Number(urlMatch[3]),
    };
  }
  const match = value.match(/\b([a-z0-9_.-]+\/[a-z0-9_.-]+)#(\d+)\b/i);
  if (match?.[1] && match[2]) return { repo: match[1], kind: "issue", number: Number(match[2]) };
  const shorthandMatch = value.match(/(?:^|[^\w/])#(\d+)\b/);
  if (defaultRepo && shorthandMatch?.[1]) {
    return { repo: defaultRepo, kind: "issue", number: Number(shorthandMatch[1]) };
  }
  return null;
}

function reportHeadingTitle(markdown: string): string | undefined {
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (!line.startsWith("#")) continue;
    const afterMarker = line.slice(1);
    if (!afterMarker.startsWith(" ") && !afterMarker.startsWith("\t")) continue;
    let heading = afterMarker.trimStart();
    if (heading.startsWith("#")) {
      const colonIndex = heading.indexOf(":");
      const issueNumber = colonIndex === -1 ? "" : heading.slice(1, colonIndex);
      if (issueNumber && isDecimalDigits(issueNumber))
        heading = heading.slice(colonIndex + 1).trimStart();
    }
    const trimmed = heading.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

function isDecimalDigits(value: string): boolean {
  for (const char of value) if (char < "0" || char > "9") return false;
  return value.length > 0;
}

function publicLaneName(lane: DecisionPacketLane): string {
  switch (lane) {
    case "product_contract":
      return "Product/API contract";
    case "security_boundary":
      return "Security boundary";
    case "maintainer_review":
      return "Maintainer review";
    case "release_inclusion":
      return "Release inclusion";
    case "proof_or_repro_decision":
      return "Proof/repro decision";
  }
}

function repoRelativePath(repoRoot: string, path: string): string {
  return relative(repoRoot, path).replace(/\\/g, "/");
}

function isPriority(value: string | undefined): value is DecisionPacketPriority {
  return value === "P0" || value === "P1" || value === "P2" || value === "P3";
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function unquote(value: string): string {
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "string") return parsed;
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
