# Contributor instructions

- Sign every Git commit using the configured backend/key; never bypass signing. Verify each new signature. Preserve uncommitted files if signing fails, and report verifier/trust limitations without rewriting signed commits.
- Use English commit messages.
- Preserve existing Tasks IDs, task text, dependencies and unrelated note content. Never silently repair duplicate IDs or infer identity from similar titles.
- Record observation times, not invented edit/creation/completion times. Retain history after disappearance and distinguish it from known completion.
- Keep journals synchronized in the vault, with one writer per session. Do not put credentials or full notes in journals. Task titles and paths are sensitive vault content.
- Fail closed on corrupt or unknown journal data; never overwrite it. Use synthetic test fixtures.
- Do not monkey-patch Tasks internals or manipulate its dialog. Use public integration points only.
- Run npm ci and npm run check for a fresh checkout. Report automated checks separately from live desktop/mobile testing.
- Initial deployment is authorized only to C:/Users/mj/Obsidian/Test via ignored .env.local. Preserve settings, activation and workspace state; copy only the three build artifacts. Do not publish a release without authorization.
