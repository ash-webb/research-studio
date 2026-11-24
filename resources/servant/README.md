# Reviewed methods resources for Servant

This publishes authored methods guides for study planning, execution and analysis. It does not publish research evidence, survey responses, datasets, attachments or scripts.

1. Write or edit a JSON guide in `resources/servant/items/`, using the draft examples there. Keep its stable ID; bump its version when guidance changes. Drafts are excluded from the feed.
2. Complete your normal method/content review. An authorized reviewer can then set the guide status to `reviewed`.
3. Run `node scripts/publish-servant-resources.mjs`. This builds `resources/servant/catalog.json` and a **PENDING** approval request. It never grants approval or overwrites the live approval.
4. An authorized publication reviewer reviews the exact catalog and its intended human/model audience. Copy the pending request to `approvals/servant-resources.json`, choose a real approval ID, set `status` to `APPROVED`, identify the reviewer and set UTC `approvedAt` and `expiresAt` instants (maximum 90 days). Keep the generated content digest. Commit the guides, generated catalog and approval together through the repository's normal review process.
5. Run `node scripts/publish-servant-resources.mjs --check`. Once that reviewed release reaches main, the owner's configured Servant sync job picks it up within five minutes. No Servant catalog edit or app build is needed.

The approval audience is `servant-private-workspace-and-configured-researcher-model`. A reviewed label alone is insufficient. A content edit invalidates the old approval digest. Revoking/removing the approval or removing a guide withdraws it on the next sync. The consumer fails closed after ten minutes without a successful check and never extends an approval's expiry.

The approved record schema is version 1. Each guide has exactly: `id`, `version`, `status`, `title`, `summary`, `phases` (planning/execution/analysis), `steps`, `questions`, `example` and `sources` (title and optional HTTPS URL). Use the supplied draft JSON as the editing shape. The published catalog contains only reviewed guides. Do not add source datasets, participant identifiers, credentials, internal connection instructions, original course files or content not cleared for the repository's audience.

Servant authenticates every read and resolution using its existing device transport, Researcher/owner access and pilot hold. It re-resolves selected versions/content hashes before preparing a Researcher request. Guides are method references, never product findings, and are not automatically sent to an agent or installed as skills. Existing Research Hub evidence approvals remain separate and unchanged.

The v0.1.1 starter release contains 4 reviewed guides. Ashley approved its exact content for the Servant private-workspace/configured-Researcher-model audience on November 24, 2026, through December 24, 2026 at 22:54:22.053 UTC. The live content-bound record is approvals/servant-resources.json. The original PENDING request in review-candidate/ is retained as review history, not live authorization.

## Review a candidate before publication

Run `node scripts/publish-servant-resources.mjs --prepare-review` to validate all
items and prepare `review-candidate/catalog.json` and a PENDING
`review-candidate/approval-request.json`. This previews the exact reviewed release
without changing draft statuses, the live catalog or any approval. Servant never
reads the candidate directory. The normal `--check` rejects stale candidate copies.

The November 24, 2026 starter release is version 0.1.1 and is now approved as
recorded above. For future changes, review the candidate catalog and its full-content
digest before creating any new approval. Pending request files are never live
authorization; only the matching approvals/servant-resources.json grants delivery.

After an authorized human approves the exact candidate and its audience, mark only
those items reviewed, regenerate the live catalog, and verify it has the candidate
digest. Create the real approval with that digest, the authorized reviewer's name
and actual UTC approval/expiry instants. The proposed starter approval window is
30 days. Publish the matching catalog and approval together. Preparing a candidate
never authorizes this step. Any content edit requires a new review/digest.

Approval covers these guides in Servant's private workspace and configured
Researcher model. Existing Researcher/owner access, pilot hold, explicit selection
and evidence controls remain in force. It does not approve real study fielding,
raw data transfer, release of underlying evidence or new agent permissions.
