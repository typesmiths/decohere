import { WELL_KNOWN_FILES } from "../../models/const.js";
import type { KeyedModel, SourceFile } from "../../models/source-file.js";

/**
 * Minimal GitHub Actions for scaffolded apps: lint ∥ test, build gate on default branch,
 * npm publish after CI (skips private packages). No default forge docker --push.
 */
export class GithubCiWorkflows implements KeyedModel {
	public readonly key = WELL_KNOWN_FILES.GITHUB_CI;

	public files(): SourceFile[] {
		return [
			{
				filePath: ".github/actions/setup-node-pnpm/action.yml",
				content: `name: Setup Node + pnpm
description: Install pnpm and Node, configure npm registry auth, install deps
inputs:
  node-version:
    description: Node.js version
    required: false
    default: "24"
  pnpm-version:
    description: pnpm version
    required: false
    default: "10"
  install:
    description: Run pnpm install --frozen-lockfile
    required: false
    default: "true"

runs:
  using: composite
  steps:
    - uses: pnpm/action-setup@v4
      with:
        version: \${{ inputs.pnpm-version }}

    - uses: actions/setup-node@v4
      with:
        node-version: \${{ inputs.node-version }}
        cache: pnpm
        cache-dependency-path: pnpm-lock.yaml

    - name: Configure npm auth
      shell: bash
      run: |
        if [[ -n "\${NODE_AUTH_TOKEN:-}" ]]; then
          echo "//registry.npmjs.org/:_authToken=\${NODE_AUTH_TOKEN}" >> .npmrc
        fi

    - name: Install dependencies
      if: inputs.install == 'true'
      shell: bash
      run: |
        if [[ -f pnpm-lock.yaml ]]; then
          pnpm install --frozen-lockfile
        else
          pnpm install
        fi
`,
			},
			{
				filePath: ".github/workflows/ci.yml",
				content: `name: CI
on:
  push:
    branches:
      - "*"
  pull_request:
  workflow_dispatch:
concurrency:
  group: ci-\${{ github.ref }}
  cancel-in-progress: true
env:
  NODE_AUTH_TOKEN: \${{ secrets.NODE_AUTH_TOKEN }}
  SCRIBE_LOG_LEVEL: info

jobs:
  lint:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - uses: ./.github/actions/setup-node-pnpm

      - name: Lint and typecheck
        run: |
          set +e
          pnpm run lint:check &
          lint_pid=$!
          pnpm run typecheck &
          tsc_pid=$!
          wait "$lint_pid"
          lint_code=$?
          wait "$tsc_pid"
          tsc_code=$?
          set -e
          if [[ "$lint_code" -ne 0 || "$tsc_code" -ne 0 ]]; then
            exit 1
          fi

  test:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 1

      - uses: ./.github/actions/setup-node-pnpm

      - name: Test
        run: pnpm test

      - name: Build and package (default branch)
        if: github.ref == format('refs/heads/{0}', github.event.repository.default_branch)
        run: pnpm run package

  ci:
    needs: [lint, test]
    if: always()
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Aggregate
        run: |
          if [[ "\${{ needs.lint.result }}" != "success" || "\${{ needs.test.result }}" != "success" ]]; then
            echo "CI failed (lint=\${{ needs.lint.result }} test=\${{ needs.test.result }})"
            exit 1
          fi
          echo "CI passed"
`,
			},
			{
				filePath: ".github/workflows/publish.yml",
				content: `name: Publish

on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]

concurrency:
  group: publish-\${{ github.event.workflow_run.head_branch }}
  cancel-in-progress: false

env:
  NODE_AUTH_TOKEN: \${{ secrets.NODE_AUTH_TOKEN }}
  SCRIBE_LOG_LEVEL: info

jobs:
  publish:
    if: >
      github.event.workflow_run.conclusion == 'success' &&
      github.event.workflow_run.head_branch == github.event.repository.default_branch
    runs-on: ubuntu-latest
    timeout-minutes: 30
    permissions:
      contents: read
      id-token: write
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.workflow_run.head_sha }}
          fetch-depth: 1

      - uses: ./.github/actions/setup-node-pnpm

      - name: Build release
        run: pnpm run build

      - name: Publish packages
        run: pnpm exec forge publish --configuration release
        # Skips packages with "private": true (e.g. the webapi app).
        # Optional registry images: replace "Build release" above with \`pnpm run package\`, then add
        # \`pnpm exec forge docker --configuration release --push\` after configuring GHCR/OIDC.
        # Not enabled by default. Each API's Dockerfile copies .package/, which \`forge package\`
        # builds, so the image build itself needs no npm token.
`,
			},
		];
	}
}
