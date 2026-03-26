# Domainator

Domainator is a fast, versatile, and unified Command Line Interface (CLI) Domain Availability Checker. Built to run perfectly under [Bun](https://bun.sh/) (or Node.js), it accepts standard inputs, domain expansion, and piped lists, delivering rich availability checks via RDAP, DNS DoH, WHOIS fallbacks, and multi-registrar API checks.

## Features
- **Flexible Inputs:** Accepts direct arguments, base names, full domains, and standard piped `stdin`.
- **Automated Expansions:** Easily expand base names against custom TLD lists or use practical thematic groups.
- **Deep Checking Logic:** 
  - Standard checks: RDAP-first lookup, DoH (DNS over HTTPS) verification, and WHOIS fallback.
  - Robust Registrar APIs: Optionally check availability against major providers (Cloudflare, GoDaddy, Namecheap, and more) if basic checks are inconclusive.
- **Interactive Mode:** User-friendly guided interface for selecting domains, TLDs, and providers.

## Installation

Ensure you have [Bun](https://bun.sh/) (or Node.js) installed. 

```bash
# Install dependencies
bun install
```

## Usage

Run in interactive mode:
```bash
bun domainator.js 
# or
bun domainator.js -i
```

**Note:** Domainator automatically enters interactive mode if no arguments are provided and it is running in a TTY.

Check specific domains or names:
```bash
bun domainator.js example.com myapp.ai
```

Expand names with TLDs:
```bash
bun domainator.js myapp --tlds .com .io .net
```

Use thematic groups:
```bash
bun domainator.js myapp -g dev
```

Piped input:
```bash
cat domains.txt | bun domainator.js
# or
pbpaste | bun domainator.js
```

### Flags & Options

| Flag                | Name             | Description                          | Default                      |
| :------------------ | :--------------- | :----------------------------------- | :--------------------------- |
| `-i, --interactive` |                  | Run in interactive mode directly     |                              |
| `-t, --tlds`        | `<.tld ...>`     | Custom TLD list                      | `.com, .ai, .io`             |
| `-g, --group`       | `<name>`         | Use a thematic TLD group             |                              |
| `-r, --registrar`   | `<provider,...>` | Registrar providers, comma-separated | `none`                       |
| `-v, --verbose`     |                  | Verbose diagnostics per lookup       |                              |
| `-d, --delay`       | `<seconds>`      | Delay between checks                 | `0.5`                        |
| `--no-whois`        |                  | Disable whois fallback               |                              |
| `-h, --help`        |                  | Show CLI help                        |                              |

### TLD Groups

Use the `-g, --group <name>` flag to quickly expand base names against curated sets of TLDs:

| Group     | Description                     | TLDs                                                                                           |
| :-------- | :------------------------------ | :--------------------------------------------------------------------------------------------- |
| `minimal` | Most common extensions          | `.com, .net, .org`                                                                             |
| `biz`     | Business and startup focus      | `.com, .io, .ai, .co, .app`                                                                    |
| `common`  | Standard tech extensions        | `.com, .net, .org, .io, .ai, .co, .dev, .me, .app`                                             |
| `rust`    | Rust ecosystem favorites        | `.com, .rs, .io, .sh`                                                                          |
| `dev`     | Comprehensive developer set     | `.com, .dev, .io, .ai, .rs, .app, .sh, .tech, .tools, .cloud, .studio`                         |
| `general` | Wide range of modern extensions | `.com, .net, .org, .biz, .info, .xyz, .online, .site, .world, .space, .today, .live, ...`      |

### Supported Registrars & API Keys

If you want to use the `--registrar` option, you can specify individual providers. You can pass credentials directly via flags, or export them securely as Environment Variables.

| Registrar       | Alias  | CLI Flags                                     | Environment Variables                             |
| :-------------- | :----- | :-------------------------------------------- | :------------------------------------------------ |
| **Cloudflare**  | `cf`   | `-cft, --cf-token`<br>`-cfa, --cf-account-id` | `CLOUDFLARE_API_TOKEN`<br>`CLOUDFLARE_ACCOUNT_ID` |
| **GoDaddy**     | `gd`   | `--gd-key`<br>`--gd-secret`                   | `GODADDY_API_KEY`<br>`GODADDY_API_SECRET`         |
| **Namecheap**   | `nc`   | `--nc-user`<br>`--nc-key`                     | `NAMECHEAP_API_USER`<br>`NAMECHEAP_API_KEY`       |
| **WhoisXML**    | `wxml` | `--whoisxml-key`                              | `WHOISXML_API_KEY`                                |
| **WhoisFreaks** | `wf`   | `--whoisfreaks-key`                           | `WHOISFREAKS_API_KEY`                             |
| **WhoAPI**      | -      | `--whoapi-key`                                | `WHOAPI_API_KEY`                                  |
| **APILayer**    | `al`   | `--apilayer-key`                              | `APILAYER_API_KEY`                                |
| **API Ninjas**  | `an`   | `--apininjas-key`                             | `APININJAS_API_KEY`                               |
| **JsonWhois**   | `jw`   | `--jsonwhois-key`                             | `JSONWHOIS_API_KEY`                               |
| **Dynadot**     | `dd`   | `--dynadot-key`                               | `DYNADOT_API_KEY`                                 |

## Examples

**Check using a TLD group:**
```bash
bun domainator.js mycoolapp -g dev
```

**Check with custom TLDs:**
```bash
bun domainator.js example --tlds .dev .run .app
```

**Check using GoDaddy API:**
```bash
bun domainator.js example.dev -r godaddy --gd-key YOUR_KEY --gd-secret YOUR_SECRET
```

**Check with multiple Registrars & Verbose Output:**
```bash
# Note: aliases like cf, gd, nc, etc. are supported
bun domainator.js example -r whoisxml,cf -v
```

**Checking via piped list:**
```bash
pbpaste | bun domainator.js
```

