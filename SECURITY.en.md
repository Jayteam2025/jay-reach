> [Français](SECURITY.md) | **English**

# Security Policy

## Reporting Vulnerabilities

Security is a priority for Jay Reach. If you discover a vulnerability, we ask you to report it **privately** and not open it in a public issue.

### How to Report

**Recommended option**: Use the GitHub Security Advisories in the repository
- Go to the **Security** tab of the repository
- Click on **Report a vulnerability**
- Describe the vulnerability in detail

**Alternative**: Send an email to **hey@jay-assistant.fr** with:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Your name and contact information to coordinate the fix

### Responsibility

- We will investigate each report seriously
- We will keep you updated on progress
- We will credit you in the fix (unless you request anonymity)
- We will publish a fix as soon as possible

### Reasonable Timeline

Please give us **90 days** to prepare and publish a fix before any public disclosure.

## Supported Versions

Only the `main` branch is currently supported. Security fixes are applied directly to this branch.

## Common Vulnerability Prevention

Jay Reach follows security best practices:

- **Row-Level Security (RLS)** enabled on all Supabase tables
- **Input validation** via Zod
- **No secrets committed** (API keys, tokens, passwords)
- **HTTPS required** for external redirects
- **JWT authentication** on all Edge Functions endpoints

For more information, see our security documentation in `docs/`.

---

Thank you for helping us keep Jay Reach secure.
