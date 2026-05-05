# Agent Teams

Multi-agent coordination for Claude Code, powered by [ppz](https://pipescloud.io). Define a team of AI agents with different roles, give them a goal, and watch them collaborate — a coordinator breaks down the work and delegates to specialist workers who communicate via ppz messaging.

Think of it as your own Claude Teams: a lead agent plans and delegates, worker agents execute in parallel, and ppz handles all the agent-to-agent communication and terminal sharing under the hood.

## Prerequisites

Install ppz from [pipescloud.io](https://pipescloud.io):

```bash
curl -fsSL https://raw.githubusercontent.com/pipescloud/ppz/main/install.sh | bash
```

## Build It Yourself

This repo was built entirely by AI agents, and you can do the same. Here's how:

### 1. Build the agent-teams tool

Give your agent the spec and let it build the coordination tool:

> Read SPEC.md and build agent-teams — a multi-agent coordination CLI that uses ppz for messaging between a coordinator agent and worker agents.

The agent will scaffold the CLI, define the team config format, wire up ppz for inter-agent communication, and implement the coordinator/worker lifecycle.

### 2. Build a project using an agent team

Once agent-teams is working, use it to build something real:

```bash
# Initialize a team config
agent-teams init my-project

# Start the team with a goal
agent-teams start team.yaml --goal "Build a URL shortener API with tests"
```

Or ask your agent to do it for you:

> Use agent-teams to spin up a team and build a URL shortener service with a REST API, persistent storage, and full test coverage.

The coordinator will break down the goal, assign tasks to workers, and bring it all together.
