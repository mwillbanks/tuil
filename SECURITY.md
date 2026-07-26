# Security Policy

The security of tuil is taken seriously. Responsible reports help protect
terminal applications and their users.

> [!IMPORTANT]
> Do not report suspected vulnerabilities through public issues, pull
> requests, discussions, or other public channels.

Use the private
[GitHub vulnerability reporting form](https://github.com/mwillbanks/tuil/security/advisories/new).

## Supported versions

Security updates are provided for the current major version and, for six
months after a new major release, the immediately preceding major version.
Pre-release and development versions receive best-effort support.

| Version | Support |
| --- | :---: |
| Current major | ✅ |
| Previous major within the six-month transition | ✅ |
| Older or expired majors | ❌ |
| Pre-release and development builds | Best effort |

## Reporting a vulnerability

Include enough evidence to reproduce and assess the report:

- affected package, version, or commit;
- environment and terminal/runtime configuration;
- prerequisites and detailed reproduction steps;
- a minimal proof of concept when practical;
- expected and actual behavior;
- potential impact and required attacker capabilities;
- relevant logs or traces with secrets removed; and
- known workarounds or mitigations.

Do not include real credentials, private keys, personal information,
proprietary source code, or unrelated sensitive data.

Maintainers will validate the report, determine affected supported versions,
develop and test a correction or mitigation, and coordinate disclosure when
practical. Investigation time depends on severity, reproducibility, and the
complexity of a safe fix.

## Scope

In-scope reports include reproducible vulnerabilities in:

- published tuil packages and official release artifacts;
- terminal input, escape-sequence, and output handling;
- registry installation, destination validation, and file replacement;
- plugin, command, event, routing, operation, and workflow boundaries;
- redaction and semantic inspection behavior;
- build, release, and dependency supply-chain automation; and
- dependencies reachable through supported tuil behavior.

Scanner output without evidence of applicability, unsupported releases,
social engineering, deliberately compromised hosts, and vulnerabilities that
exist only in unrelated third-party software are generally out of scope.

## Dependency security

The repository scans dependency lockfiles with OSV-Scanner in pull requests,
on `main`, and on a schedule. A vulnerability may be ignored only with a
documented technical justification and an expiration date in
`osv-scanner.toml`. A suppression must be removed when the affected path
becomes reachable or its applicability changes.

## Secure usage

- Keep tuil and its dependencies current.
- Treat terminal input, persisted workflow data, plugin metadata, and registry
  sources as untrusted.
- Avoid rendering unescaped control sequences from external data.
- Run applications with the least filesystem and process privileges required.
- Keep credentials out of application state, logs, stories, and snapshots.
- Review generated registry changes before executing or distributing them.
- Protect CI publishing credentials with least-privilege, short-lived tokens.

Confirmed vulnerabilities may be published through
[GitHub Security Advisories](https://github.com/mwillbanks/tuil/security/advisories)
after fixes and reasonable mitigations are available.
