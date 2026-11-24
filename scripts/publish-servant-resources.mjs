#!/usr/bin/env node
// Portable publisher copied into each source repository. It prepares a review
// request, never an approval. Servant independently validates the publication.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const directory = path.join(root, "resources/servant");
const config = JSON.parse(fs.readFileSync(path.join(directory, "publication.json"), "utf8"));
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
const digest = value => crypto.createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const audience = "servant-private-workspace-and-configured-researcher-model";
const check = process.argv.length === 3 && process.argv[2] === "--check";
const prepareReview = process.argv.length === 3 && process.argv[2] === "--prepare-review";
if (process.argv.length > 2 && !check && !prepareReview) throw new Error("Usage: node scripts/publish-servant-resources.mjs [--check | --prepare-review]");
const resources = [];
const candidates = [];
const items = path.join(directory, "items");
if (fs.existsSync(items)) {
  if (fs.lstatSync(items).isSymbolicLink()) throw new Error("Resource items must not be a symlink");
  for (const name of fs.readdirSync(items).filter(name => name.endsWith(".json")).sort()) {
    const file = path.join(items, name), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 14000) throw new Error("Invalid resource item file");
    const resource = JSON.parse(fs.readFileSync(file, "utf8"));
    const expected = ["id", "version", "status", "title", "summary", "phases", "steps", "questions", "example", "sources"].sort().join("|");
    if (Object.keys(resource).sort().join("|") !== expected || !["draft", "reviewed"].includes(resource.status) || !/^[A-Za-z][A-Za-z0-9._-]{0,79}$/.test(resource.id) || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(resource.version)) throw new Error("Invalid resource identity or fields");
    if (![resource.title, resource.summary, resource.example].every(value => typeof value === "string" && value.trim() && value.length <= 2000)) throw new Error("Invalid resource text");
    for (const key of ["steps", "questions"]) if (!Array.isArray(resource[key]) || !resource[key].length || resource[key].length > 12 || !resource[key].every(value => typeof value === "string" && value.trim() && value.length <= 2000)) throw new Error("Invalid resource checklist");
    if (!Array.isArray(resource.phases) || !resource.phases.length || !resource.phases.every(value => ["planning", "execution", "analysis"].includes(value))) throw new Error("Invalid research phase");
    if (!Array.isArray(resource.sources) || !resource.sources.length || !resource.sources.every(source => typeof source.title === "string" && (!source.url || /^https:\/\//.test(source.url)))) throw new Error("Invalid source references");
    candidates.push({ ...resource, status: "reviewed" });
    if (resource.status === "reviewed") resources.push(resource);
  }
}
if (candidates.length > 200 || new Set(candidates.map(r => r.id)).size !== candidates.length) throw new Error("Too many or duplicate resource IDs");
const catalog = { schemaVersion: 1, version: config.version, updatedAt: config.updatedAt, origin: config.origin, autoAttach: false, resources };
const file = path.join(directory, "catalog.json"), content = JSON.stringify(catalog, null, 2) + "\n", catalogDigest = digest(catalog);
const candidateCatalog = { ...catalog, resources: candidates }, candidateContent = JSON.stringify(candidateCatalog, null, 2) + "\n";
const candidateDirectory = path.join(directory, "review-candidate");
const request = (catalogDigest, approvalId = "REPLACE-WITH-REVIEW-ID") => ({ schemaVersion: 1, approvalId, status: "PENDING", audience, repository: config.repository, catalogDigest, reviewer: null, approvedAt: null, expiresAt: null });
const candidateRequest = request(digest(candidateCatalog), `SR-${config.updatedAt.replaceAll("-", "")}-${config.repository.endsWith("/research-hub") ? "HUB" : "STUDIO"}-${config.version}`);
if (Math.max(Buffer.byteLength(content), Buffer.byteLength(candidateContent)) > 2 * 1024 * 1024) throw new Error("Resource publication exceeds the consumer's bounded feed size");
if (prepareReview) {
  // Review copies may say reviewed to preview the exact future release, but
  // draft items, the live catalog and the live approval are never changed.
  fs.mkdirSync(candidateDirectory, { recursive: true });
  fs.writeFileSync(path.join(candidateDirectory, "catalog.json"), candidateContent);
  fs.writeFileSync(path.join(candidateDirectory, "approval-request.json"), JSON.stringify(candidateRequest, null, 2) + "\n");
  console.log(`Prepared ${candidates.length} candidate guides for human review. Live publication and approval are unchanged.`);
} else if (!check) {
  fs.writeFileSync(file, content);
  // Kept outside the live approval path. An authorized human must review it.
  fs.writeFileSync(path.join(directory, "approval-request.json"), JSON.stringify(request(catalogDigest), null, 2) + "\n");
  console.log(`Prepared ${resources.length} reviewed guide records and a pending approval request. No approval was granted.`);
} else {
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content) throw new Error("Run the publisher and commit its generated catalog");
  if (fs.existsSync(candidateDirectory)) {
    if (fs.readFileSync(path.join(candidateDirectory, "catalog.json"), "utf8") !== candidateContent ||
        fs.readFileSync(path.join(candidateDirectory, "approval-request.json"), "utf8") !== JSON.stringify(candidateRequest, null, 2) + "\n") throw new Error("Review candidate is stale. Run the publisher with --prepare-review");
  }
  if (resources.length) {
    const approval = JSON.parse(fs.readFileSync(path.join(root, "approvals/servant-resources.json"), "utf8"));
    const start = Date.parse(approval.approvedAt), end = Date.parse(approval.expiresAt);
    if (approval.schemaVersion !== 1 || approval.status !== "APPROVED" || approval.audience !== audience || approval.repository !== config.repository || approval.catalogDigest !== catalogDigest ||
        !/^[A-Za-z][A-Za-z0-9._-]{0,79}$/.test(approval.approvalId) || typeof approval.reviewer !== "string" || !approval.reviewer.trim() || !Number.isFinite(start) || !Number.isFinite(end) || start > Date.now() || end <= Date.now() || end - start > 90 * 86400_000) throw new Error("Current content-bound Servant/model audience approval is required");
  }
  console.log(`Publication check passed: ${resources.length} reviewed resources. Drafts are excluded.`);
}
