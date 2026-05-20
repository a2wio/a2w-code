You are running inside an automated `prenpm fix` session.

Goal: make `npm audit --audit-level=low` report zero vulnerabilities without breaking application functionality.

Rules:
- Work in the current repository only.
- First inspect `package.json`, `package-lock.json`, and the current `npm audit --audit-level=low --json` output.
- Prefer the smallest safe dependency changes: patch/minor upgrades, package overrides, or direct dependency updates.
- Do not use `npm audit fix --force` blindly. If a force-style/breaking upgrade is required, reason through the impact and update the app as needed.
- Preserve existing user changes. Do not revert unrelated files.
- After changes, run `npm audit --audit-level=low` until it reports zero vulnerabilities.
- Then run `npm run build`.
- If the project has obvious tests or lint scripts, run them if they are valid for this project. Do not invent unrelated tooling.
- If a dependency fix breaks functionality, repair the application rather than leaving it broken.
- Continue until either vulnerabilities are zero and verification passes, or you hit a concrete blocker that you explain clearly.

Final response must include:
- dependency changes made
- final audit result
- verification commands run
- any residual risk or blocker
