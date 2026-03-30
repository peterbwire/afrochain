# AfroChain Improvement Proposals

This directory is the governance-process home for AfroChain Improvement Proposals, or ACPs. It is the future extraction boundary for the `afrochain-improvement-proposals` repository.

ACPs are used for changes that should be written down, reviewed, archived, and discoverable over time.

## When to Use an ACP

Write an ACP when a change affects:

- protocol behavior
- staking or validator policy
- governance process
- treasury policy
- interface standards
- wallet or explorer standards that multiple repos should share
- organization or repository governance

If a change is small, local, and implementation-only, a normal pull request may be enough. If it changes how the ecosystem should work or coordinate, it should probably be an ACP.

## Current Directory Layout

- `drafts/`
  Active proposals under discussion.
- `accepted/`
  Proposals that have been accepted and should guide implementation or process.
- `rejected/`
  Proposals that were discussed and declined.
- `archive/`
  Historical records kept for reference.
- `TEMPLATE.md`
  The starting point for a new ACP.

## Current ACPs

- `drafts/ACP-0001-repo-organization-and-split-strategy.md`
  Documents the current monorepo-now, split-later strategy for future organization-level repositories.

## ACP Metadata

Each ACP should include:

- ACP number and title
- status
- type
- creation date
- author

The current template uses:

- `Draft`
- `Standards Track`
- `Governance`
- `Process`
- `Informational`

## Typical ACP Structure

The template currently includes:

- Summary
- Motivation
- Specification
- Rationale
- Backwards Compatibility
- Security Considerations
- Reference Implementation

That structure is intentionally lightweight so proposals stay easy to write, but still cover the practical questions that matter.

## Suggested Workflow

1. Copy `TEMPLATE.md`.
2. Create a draft under `drafts/` with the next ACP number.
3. Fill in the motivation, specification, risks, and migration story.
4. Discuss it in code review or contributor coordination.
5. Move it to `accepted/`, `rejected/`, or `archive/` when the decision is clear.

## Numbering Guidance

Use zero-padded numbering:

- `ACP-0001`
- `ACP-0002`
- `ACP-0003`

This keeps sorting stable over time and makes future repo extraction cleaner.

## Good ACP Characteristics

A strong ACP is:

- specific
- scoped
- explicit about tradeoffs
- honest about risks
- clear about migration or compatibility
- written so future contributors can understand why a decision was made

## What ACPs Are Not

ACPs are not:

- general brainstorming notes
- product marketing copy
- code comments in paragraph form
- a replacement for implementation docs

They are long-lived decision records.

## Relationship to On-Chain Governance

Not every ACP maps directly to an on-chain proposal, but many should influence or accompany one.

Examples:

- a protocol parameter change might have both:
  - an ACP describing the reasoning
  - an on-chain governance proposal applying the change
- a repository process change might only need an ACP and no on-chain vote

## Future Split Role

When the organization-level split happens, this directory should be able to move into its own repo with minimal cleanup.

To keep that easy:

- keep ACP text self-contained
- avoid coupling ACPs to local file paths unless necessary
- treat ACPs as project records, not implementation internals
