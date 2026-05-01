# Security Policy

## Supported Versions

| Version | Supported |
| ------- | --------- |
| latest  | Yes       |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email **security@shiprite.dev** with:

- Description of the vulnerability
- Steps to reproduce
- Impact assessment (what data or functionality is affected)
- Any suggested fix (optional)

## Response Timeline

- **Acknowledgment**: within 48 hours
- **Initial assessment**: within 5 business days
- **Fix for critical issues**: within 7 days
- **Fix for non-critical issues**: within 30 days

## Scope

In scope:

- Authentication bypass or session hijacking
- Row-Level Security (RLS) policy bypass
- Cross-site scripting (XSS)
- Cross-site request forgery (CSRF)
- Data leaks (accessing other users' data)
- Guest share token brute-force or enumeration
- SQL injection
- Server-side request forgery (SSRF)

Out of scope:

- Self-hosted misconfigurations (weak passwords, exposed ports, missing TLS)
- Social engineering attacks
- Denial of service (volumetric attacks)
- Vulnerabilities in upstream dependencies (report those to the upstream project)

## Disclosure

We follow coordinated disclosure. We will work with you on a timeline and credit you in the advisory (unless you prefer anonymity).
