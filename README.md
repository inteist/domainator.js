# Domainator

Domainator is a fast, versatile, and unified Command Line Interface (CLI) Domain Availability Checker. Built to run perfectly under [Bun](https://bun.sh/) (or Node.js), it accepts standard inputs, domain expansion, and piped lists, delivering rich availability checks via RDAP, DNS DoH, WHOIS fallbacks, and multi-registrar API checks.

## Features
- **Flexible Inputs:** Accepts direct arguments, base names, full domains, and standard piped `stdin`.
- **Automated Expansions:** Easily expand base names against custom TLD lists or use practical defaults (`.com`, `.ai`, `.io`, `.net`, `.org`).
- **Deep Checking Logic:** 
  - Standard checks: RDAP-first lookup, DoH (DNS over HTTPS) verification, and WHOIS fallback.
  - Robust Registrar APIs: Optionally check availability against major providers (Cloudflare, GoDaddy, Namecheap, and more) if basic checks are inconclusive.

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
or
bun domainator.js -i
```

You can also use this tool directly with piped domains:
```bash
echo "example.com\nexample.net" | bun domainator.js
```

Or using pbpaste:

```bash
pbpaste | bun domainator.js
```


### Flags & Options

| Flag                | Name             | Description                          | Default                      |
| :------------------ | :--------------- | :----------------------------------- | :--------------------------- |
| `-i, --interactive` |                  | Run in interactive mode directly     |                              |
| `-t, --tlds`        | `<.tld ...>`     | TLD list                             | `.com, .ai, .io, .net, .org` |
| `-r, --registrar`   | `<provider,...>` | Registrar providers, comma-separated | `none`                       |
| `-v, --verbose`     |                  | Verbose diagnostics per lookup       |                              |
| `-d, --delay`       | `<seconds>`      | Delay between checks                 | `0.5`                        |
| `--no-whois`        |                  | Disable whois fallback               |                              |
| `-h, --help`        |                  | Show CLI help                        |                              |

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

**Basic domain checking with custom TLDs:**
```bash
# Check example.dev and example.run
bun domainator.js example --tlds .dev .run
```

**Checking multiple specific domains:**
```bash
# Check example.ai and example.dev
bun domainator.js example.ai example.dev
```

**Checking a domain using GoDaddy API:**
```bash
bun domainator.js example.dev -r godaddy --gd-key YOUR_KEY --gd-secret YOUR_SECRET
```

**Checking with multiple Registrars & Verbose Output:**
```bash
bun domainator.js example -r whoisxml,godaddy -v
```

**Checking via piped list:**
```bash
pbpaste | bun domainator.js
```
