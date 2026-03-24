# AgentFramework CLI Bootstrap

Install the global command:

```bash
npm install -g @losomz/agentframework-cli
```

Then run:

```bash
agent-menu
```

What the bootstrap does:

- clones or updates the AgentFramework git runtime
- checks whether the cached runtime version is behind the remote version
- installs runtime dependencies when needed
- launches the latest runtime CLI
- when you pull a template, syncs the selected skills into the current project's `.agents/skills`

Common commands:

```bash
agent-menu --list-templates
agent-menu --list-skills
```

Optional environment variables:

```bash
AGENTFRAMEWORK_REPO_URL=https://github.com/Losomz/AI-Agents.git
AGENTFRAMEWORK_HOME=C:\Users\<you>\.agentframework
```

Default cache location:

```text
%USERPROFILE%\.agentframework
```

Typical update behavior:

- update runtime/skills/templates in git: no npm republish needed
- update bootstrap entry behavior: publish a new npm package version
