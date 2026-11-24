# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Report them privately through
[GitHub Security Advisories](https://github.com/Techtix-UK/chinwag/security/advisories/new).

Include the version (`chinwag version`), a description, reproduction steps and the impact you expect. We aim to acknowledge reports within 3 working days and to ship a fix or mitigation for confirmed high-severity issues within 14 days. We'll credit you in the release notes unless you prefer otherwise.

## Supported versions

Security fixes are released for the latest minor release. Keep installations current with `sudo chinwag update`.

## Scope

In scope: the Chinwag server, dashboard, MCP/OAuth implementation, REST API, installer and scripts in this repository.
Out of scope: WhatsApp/Meta services, whatsapp-web.js itself (report upstream), and issues requiring root access to the host.

The security model is documented at https://techtix-uk.github.io/chinwag/reference/security.
