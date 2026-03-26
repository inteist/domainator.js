#!/usr/bin/env bun

/*
  Domainator: flexible domain availability checker (Bun-friendly, Node-compatible)

  Sensible defaults:
  - Input from argv + piped stdin
  - Base names expand with default TLDs (.com, .ai)
  - Full domains (contains a dot) are checked directly
  - Strategy: Registrar(s) -> RDAP -> DoH(NS) -> WHOIS(optional fallback)

  Supported registrar providers:
    cloudflare, godaddy, namecheap, whoisxml, whoisfreaks,
    whoapi, apilayer, apininjas, jsonwhois, dynadot

  Interactive mode:
    Run with no arguments to enter interactive mode.
*/

import chalk from "chalk";
import ora from "ora";
import { input, select, checkbox, confirm, password } from "@inquirer/prompts";
import Table from "cli-table3";

// ─── Constants ───────────────────────────────────────────────────────────────

const APP_LABEL = "Domainator";
const USER_AGENT = "domainator/1.0";
const MAX_REPORT_ISSUES = 12;

const TLD_GROUPS = {
    minimal: [".com", ".net", ".org"],
    biz: [".com", ".io", ".ai", ".co", ".app"],
    common: [".com", ".net", ".org", ".io", ".ai", ".co", ".dev", ".me", ".app"],
    rust: [".com", ".rs", ".io", ".sh"],

    dev: [".com", ".dev", ".io", ".ai", ".rs", ".app", ".sh", ".tech", ".tools", ".cloud", ".studio"],
    general: [".com", ".net", ".org", ".biz", ".info", ".xyz", ".online", ".site", ".world", ".space", ".today", ".live", ".news", ".media", ".digital", ".blog", ".cc", ".tv", ".fm"],
};

const DEFAULT_TLDS = [".com", ".ai", ".io"];
const IANA_RDAP_BOOTSTRAP = "https://data.iana.org/rdap/dns.json";
const CLOUDFLARE_DOH = "https://cloudflare-dns.com/dns-query";

const AVAILABLE_PATTERNS =
    /no match|not found|no data found|domain not found|not registered|status:\s*free|object does not exist|no matching record/i;
const INCONCLUSIVE_WHOIS_PATTERNS =
    /% IANA WHOIS server|TLD is not supported|this query returned 1 object/i;

let rdapBootstrapCache = null;

// ─── Registrar Registry ─────────────────────────────────────────────────────

const REGISTRARS = {
    cloudflare: {
        name: "Cloudflare",
        credentialFields: [
            { key: "token", label: "API Token", env: "CLOUDFLARE_API_TOKEN" },
            { key: "accountId", label: "Account ID", env: "CLOUDFLARE_ACCOUNT_ID" },
        ],
        aliases: ["cf"],
    },
    godaddy: {
        name: "GoDaddy",
        credentialFields: [
            { key: "key", label: "API Key", env: "GODADDY_API_KEY" },
            { key: "secret", label: "API Secret", env: "GODADDY_API_SECRET" },
        ],
        aliases: ["gd"],
    },
    namecheap: {
        name: "Namecheap",
        credentialFields: [
            { key: "apiUser", label: "API User", env: "NAMECHEAP_API_USER" },
            { key: "apiKey", label: "API Key", env: "NAMECHEAP_API_KEY" },
        ],
        aliases: ["nc"],
    },
    whoisxml: {
        name: "WhoisXML API",
        credentialFields: [
            { key: "apiKey", label: "API Key", env: "WHOISXML_API_KEY" },
        ],
        aliases: ["wxml"],
    },
    whoisfreaks: {
        name: "WhoisFreaks",
        credentialFields: [
            { key: "apiKey", label: "API Key", env: "WHOISFREAKS_API_KEY" },
        ],
        aliases: ["wf"],
    },
    whoapi: {
        name: "WhoAPI",
        credentialFields: [
            { key: "apiKey", label: "API Key", env: "WHOAPI_API_KEY" },
        ],
        aliases: [],
    },
    apilayer: {
        name: "APILayer WHOIS",
        credentialFields: [
            { key: "apiKey", label: "API Key", env: "APILAYER_API_KEY" },
        ],
        aliases: ["al"],
    },
    apininjas: {
        name: "API Ninjas",
        credentialFields: [
            { key: "apiKey", label: "API Key", env: "APININJAS_API_KEY" },
        ],
        aliases: ["an"],
    },
    jsonwhois: {
        name: "JsonWhois",
        credentialFields: [
            { key: "apiKey", label: "API Key", env: "JSONWHOIS_API_KEY" },
        ],
        aliases: ["jw"],
    },
    dynadot: {
        name: "Dynadot",
        credentialFields: [
            { key: "apiKey", label: "API Key", env: "DYNADOT_API_KEY" },
        ],
        aliases: ["dd"],
    },
};

function resolveRegistrarName(val) {
    const lower = String(val).toLowerCase().trim();
    if (lower === "none") return "none";
    if (REGISTRARS[lower]) return lower;
    for (const [key, reg] of Object.entries(REGISTRARS)) {
        if (reg.aliases.includes(lower)) return key;
    }
    return null;
}

function allRegistrarNames() {
    return Object.keys(REGISTRARS);
}

function createResult(status, source, detail, extra = {}) {
    return { status, source, detail, ...extra };
}

function compactText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
}

function truncateText(value, maxLen = 180) {
    const clean = compactText(value);
    if (clean.length <= maxLen) return clean;
    return clean.slice(0, maxLen - 3) + "...";
}

function getErrorMessage(err) {
    if (err instanceof Error && err.message) return err.message;
    return String(err || "unknown error");
}

function extractApiErrorMessage(payload) {
    if (!payload) return "";
    if (typeof payload === "string") return compactText(payload);
    if (Array.isArray(payload)) {
        const merged = payload.map((item) => extractApiErrorMessage(item)).filter(Boolean).join("; ");
        return compactText(merged);
    }
    if (typeof payload !== "object") return compactText(payload);

    for (const key of ["messages", "message", "error", "detail", "status_desc", "description", "reason"]) {
        if (payload[key]) {
            const message = extractApiErrorMessage(payload[key]);
            if (message) return message;
        }
    }

    if (payload.errors) {
        const message = extractApiErrorMessage(payload.errors);
        if (message) return message;
    }

    try {
        return JSON.stringify(payload);
    } catch {
        return "";
    }
}

async function buildHttpErrorDetail(res) {
    // Providers return mixed payloads (JSON/XML/plain text); normalize to one readable line.
    let bodyText = "";
    try {
        bodyText = await res.text();
    } catch {
        return "api " + res.status;
    }

    if (!bodyText) return "api " + res.status;

    let detail = bodyText;
    try {
        const parsed = JSON.parse(bodyText);
        detail = extractApiErrorMessage(parsed) || bodyText;
    } catch {
        // Keep body text as-is when JSON parsing fails.
    }

    return "api " + res.status + ": " + truncateText(detail);
}

function withAttempts(result, attempts) {
    return { ...result, attempts };
}

function isIssueAttempt(attempt) {
    if (!attempt || attempt.status !== "unknown") return false;
    if (attempt.source === "pipeline") return false;
    return Boolean(compactText(attempt.detail));
}

// ─── Usage ───────────────────────────────────────────────────────────────────

function showUsage() {
    const registrarList = Object.entries(REGISTRARS)
        .map(([k, v]) => {
            const aliases = v.aliases.length ? "/" + v.aliases.join("/") : "";
            return k + aliases;
        })
        .join(", ");

    const flagsInfo = [
        { f: ["-t, --tlds", "<.tld ...>"], d: `TLD list (default: ${DEFAULT_TLDS.join(", ")})` },
        { f: ["-g, --group", "<name>"], d: `Thematic TLD group: ${Object.keys(TLD_GROUPS).join(", ")}` },
        { f: ["-r, --registrar", "<provider,...>"], d: "Registrar providers, comma-separated (default: none)" },
        { f: ["-v, --verbose", ""], d: "Verbose diagnostics per lookup" },
        { f: ["-cft, --cf-token", "<token>"], d: "Cloudflare API token (or $CLOUDFLARE_API_TOKEN)" },
        { f: ["-cfa, --cf-account-id", "<id>"], d: "Cloudflare Account ID (or $CLOUDFLARE_ACCOUNT_ID)" },
        { f: ["--gd-key", "<key>"], d: "GoDaddy API key (or $GODADDY_API_KEY)" },
        { f: ["--gd-secret", "<secret>"], d: "GoDaddy API secret (or $GODADDY_API_SECRET)" },
        { f: ["--nc-user", "<user>"], d: "Namecheap API user (or $NAMECHEAP_API_USER)" },
        { f: ["--nc-key", "<key>"], d: "Namecheap API key (or $NAMECHEAP_API_KEY)" },
        { f: ["--whoisxml-key", "<key>"], d: "WhoisXML API key (or $WHOISXML_API_KEY)" },
        { f: ["--whoisfreaks-key", "<key>"], d: "WhoisFreaks API key (or $WHOISFREAKS_API_KEY)" },
        { f: ["--whoapi-key", "<key>"], d: "WhoAPI key (or $WHOAPI_API_KEY)" },
        { f: ["--apilayer-key", "<key>"], d: "APILayer key (or $APILAYER_API_KEY)" },
        { f: ["--apininjas-key", "<key>"], d: "API Ninjas key (or $APININJAS_API_KEY)" },
        { f: ["--jsonwhois-key", "<key>"], d: "JsonWhois key (or $JSONWHOIS_API_KEY)" },
        { f: ["--dynadot-key", "<key>"], d: "Dynadot API key (or $DYNADOT_API_KEY)" },
        { f: ["--no-whois", ""], d: "Disable whois fallback" },
        { f: ["-i, --interactive", ""], d: "Run in interactive mode directly" },
        { f: ["-d, --delay", "<seconds>"], d: "Delay between checks (default: 0.5)" },
        { f: ["-h, --help", ""], d: "Show this help" }
    ];

    const maxFlagLen = Math.max(...flagsInfo.map(o => (o.f[0] + (o.f[1] ? " " + o.f[1] : "")).length));
    const flagsFormatted = flagsInfo.map(o => {
        const rawLeft = o.f[0] + (o.f[1] ? " " + o.f[1] : "");
        const pad = " ".repeat(maxFlagLen - rawLeft.length + 4);
        const coloredLeft = chalk.yellow(o.f[0]) + (o.f[1] ? " " + chalk.dim(o.f[1]) : "");
        return `  ${coloredLeft}${pad}${o.d}`;
    }).join("\n");



    console.log(`
${chalk.bold.cyan("\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557")}
${chalk.bold.cyan("\u2551")}  ${chalk.bold.white("\ud83c\udf10 " + APP_LABEL)} \u2014 ${chalk.dim("Domain Availability Checker")}                 ${chalk.bold.cyan("\u2551")}
${chalk.bold.cyan("\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d")}

${chalk.bold("Usage:")}
  ${chalk.green("bun domainator.js")} ${chalk.yellow("<name|domain>")} ${chalk.dim("[more names/domains] [flags]")}
  ${chalk.dim("pbpaste |")} ${chalk.green("bun domainator.js")}

${chalk.bold("Flags:")}
${flagsFormatted}

${chalk.bold("Registrars:")} ${chalk.dim(registrarList)}

${chalk.bold("Examples:")}
  ${chalk.green("bun domainator.js")} example ${chalk.yellow("--tlds")} .dev .run
  ${chalk.green("bun domainator.js")} example.ai example.dev
  ${chalk.green("bun domainator.js")} example.dev ${chalk.yellow("-r")} godaddy ${chalk.yellow("--gd-key")} KEY ${chalk.yellow("--gd-secret")} SECRET
  ${chalk.green("bun domainator.js")} example ${chalk.yellow("-r")} whoisxml,godaddy ${chalk.yellow("-v")}
  ${chalk.dim("pbpaste |")} ${chalk.green("bun domainator.js")}
`);
}

// ─── Token / Input parsing ───────────────────────────────────────────────────

function normalizeToken(raw) {
    if (!raw) return "";
    let token = String(raw).trim().toLowerCase();
    token = token.replace(/^["'`]+|["'`,;:!?]+$/g, "");
    token = token.replace(/^https?:\/\//, "");
    token = token.replace(/^www\./, "");
    token = token.split("/")[0].split("?")[0].split("#")[0];
    return token;
}

function splitLooseInput(text) {
    return String(text)
        .split(/[\s,]+/g)
        .map(normalizeToken)
        .filter(Boolean);
}

function isLikelyDomainToken(token) {
    if (!token) return false;
    if (token.startsWith("-")) return false;
    return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(token);
}

// ─── Argument Parsing ────────────────────────────────────────────────────────

function parseArgs(argv) {
    const options = {
        tlds: [...DEFAULT_TLDS],
        registrars: [],
        credentials: {
            cloudflare: {
                token: process.env.CLOUDFLARE_API_TOKEN || "",
                accountId: process.env.CLOUDFLARE_ACCOUNT_ID || "",
            },
            godaddy: {
                key: process.env.GODADDY_API_KEY || "",
                secret: process.env.GODADDY_API_SECRET || "",
            },
            namecheap: {
                apiUser: process.env.NAMECHEAP_API_USER || "",
                apiKey: process.env.NAMECHEAP_API_KEY || "",
            },
            whoisxml: { apiKey: process.env.WHOISXML_API_KEY || "" },
            whoisfreaks: { apiKey: process.env.WHOISFREAKS_API_KEY || "" },
            whoapi: { apiKey: process.env.WHOAPI_API_KEY || "" },
            apilayer: { apiKey: process.env.APILAYER_API_KEY || "" },
            apininjas: { apiKey: process.env.APININJAS_API_KEY || "" },
            jsonwhois: { apiKey: process.env.JSONWHOIS_API_KEY || "" },
            dynadot: { apiKey: process.env.DYNADOT_API_KEY || "" },
        },
        useWhois: true,
        delayMs: 500,
        verbose: false,
        interactive: false,
        help: false,
    };

    const inputTokens = [];

    const flagMap = {
        "-h": "--help",
        "-t": "--tlds",
        "-g": "--group",
        "-r": "--registrar",
        "-i": "--interactive",
        "-cft": "--cf-token",
        "-cfa": "--cf-account-id",
        "-d": "--delay",
        "-v": "--verbose",
    };

    for (let i = 0; i < argv.length; i++) {
        let arg = argv[i];
        if (flagMap[arg]) arg = flagMap[arg];

        if (arg === "--help") {
            options.help = true;
            continue;
        }

        if (arg === "--verbose") {
            options.verbose = true;
            continue;
        }

        if (arg === "--interactive") {
            options.interactive = true;
            continue;
        }

        if (arg === "--no-whois") {
            options.useWhois = false;
            continue;
        }

        if (arg === "--delay") {
            const value = Number(argv[i + 1]);
            if (!Number.isNaN(value) && value >= 0) {
                options.delayMs = value * 1000;
                i++;
            }
            continue;
        }

        if (arg === "--registrar") {
            // Accept comma-separated provider names/aliases and normalize to registry keys.
            const raw = String(argv[i + 1] || "none");
            const parts = raw.split(",").map((s) => s.trim().toLowerCase());
            for (const p of parts) {
                if (p === "none") continue;
                const resolved = resolveRegistrarName(p);
                if (resolved && !options.registrars.includes(resolved)) {
                    options.registrars.push(resolved);
                }
            }
            i++;
            continue;
        }

        if (arg === "--group") {
            const groupName = String(argv[i + 1] || "").toLowerCase();
            if (TLD_GROUPS[groupName]) {
                options.tlds = [...TLD_GROUPS[groupName]];
            }
            i++;
            continue;
        }

        if (arg === "--cf-token") { options.credentials.cloudflare.token = argv[++i] || ""; continue; }
        if (arg === "--cf-account-id") { options.credentials.cloudflare.accountId = argv[++i] || ""; continue; }
        if (arg === "--gd-key") { options.credentials.godaddy.key = argv[++i] || ""; continue; }
        if (arg === "--gd-secret") { options.credentials.godaddy.secret = argv[++i] || ""; continue; }
        if (arg === "--nc-user") { options.credentials.namecheap.apiUser = argv[++i] || ""; continue; }
        if (arg === "--nc-key") { options.credentials.namecheap.apiKey = argv[++i] || ""; continue; }
        if (arg === "--whoisxml-key") { options.credentials.whoisxml.apiKey = argv[++i] || ""; continue; }
        if (arg === "--whoisfreaks-key") { options.credentials.whoisfreaks.apiKey = argv[++i] || ""; continue; }
        if (arg === "--whoapi-key") { options.credentials.whoapi.apiKey = argv[++i] || ""; continue; }
        if (arg === "--apilayer-key") { options.credentials.apilayer.apiKey = argv[++i] || ""; continue; }
        if (arg === "--apininjas-key") { options.credentials.apininjas.apiKey = argv[++i] || ""; continue; }
        if (arg === "--jsonwhois-key") { options.credentials.jsonwhois.apiKey = argv[++i] || ""; continue; }
        if (arg === "--dynadot-key") { options.credentials.dynadot.apiKey = argv[++i] || ""; continue; }

        if (arg === "--tlds") {
            const newTlds = [];
            while (i + 1 < argv.length && !String(argv[i + 1]).startsWith("-")) {
                i++;
                const t = String(argv[i]).trim();
                if (t.startsWith(".")) newTlds.push(t.toLowerCase());
            }
            if (newTlds.length > 0) options.tlds = [...new Set(newTlds)];
            continue;
        }

        // Unknown flag — skip
        if (arg.startsWith("-")) continue;

        inputTokens.push(...splitLooseInput(arg));
    }

    return { options, inputTokens };
}

async function readPipedInput() {
    if (process.stdin.isTTY) return [];
    let text = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) {
        text += chunk;
    }
    return splitLooseInput(text);
}

function expandToDomains(tokens, tlds) {
    const domains = [];
    for (const token of tokens) {
        if (!isLikelyDomainToken(token)) continue;
        if (token.includes(".")) {
            domains.push(token);
        } else {
            for (const tld of tlds) {
                domains.push(token + tld);
            }
        }
    }
    return [...new Set(domains)];
}

// ─── RDAP ────────────────────────────────────────────────────────────────────

async function loadRdapBootstrap() {
    if (rdapBootstrapCache) return rdapBootstrapCache;
    try {
        const res = await fetch(IANA_RDAP_BOOTSTRAP);
        if (!res.ok) return null;
        rdapBootstrapCache = await res.json();
        return rdapBootstrapCache;
    } catch {
        return null;
    }
}

async function getRdapBaseUrlsForTld(tldLabel) {
    const bootstrap = await loadRdapBootstrap();
    if (!bootstrap || !Array.isArray(bootstrap.services)) return [];
    const matched = bootstrap.services.find((entry) => {
        const labels = entry[0] || [];
        return labels.map((x) => String(x).toLowerCase()).includes(tldLabel);
    });
    if (!matched) return [];
    return (matched[1] || []).map((x) => String(x));
}

async function checkViaRdap(domain) {
    const tld = domain.split(".").pop();
    if (!tld) return createResult("unknown", "rdap", "invalid domain");

    const baseUrls = await getRdapBaseUrlsForTld(tld.toLowerCase());
    if (baseUrls.length === 0) {
        return createResult("unknown", "rdap", "no rdap service");
    }

    for (const baseUrl of baseUrls) {
        const url = baseUrl.replace(/\/+$/, "") + "/domain/" + encodeURIComponent(domain);
        try {
            const res = await fetch(url, {
                headers: {
                    accept: "application/rdap+json, application/json;q=0.9, */*;q=0.1",
                    "user-agent": USER_AGENT,
                },
            });
            if (res.status === 404) {
                return createResult("available", "rdap", baseUrl + " -> 404", { httpStatus: 404 });
            }
            if (res.ok) {
                return createResult("taken", "rdap", baseUrl + " -> " + res.status, { httpStatus: res.status });
            }
            if (res.status === 429 || res.status >= 500) continue;

            const errDetail = await buildHttpErrorDetail(res);
            return createResult("unknown", "rdap", errDetail, { httpStatus: res.status });
        } catch {
            // Keep trying
        }
    }
    return createResult("unknown", "rdap", "inconclusive");
}

// ─── DoH ─────────────────────────────────────────────────────────────────────

async function checkViaCloudflareDoH(domain) {
    const params = new URLSearchParams({ name: domain, type: "NS" });
    const url = CLOUDFLARE_DOH + "?" + params.toString();
    try {
        const res = await fetch(url, {
            headers: { accept: "application/dns-json", "user-agent": USER_AGENT },
        });
        if (!res.ok) {
            const errDetail = await buildHttpErrorDetail(res);
            return createResult("unknown", "doh", errDetail, { httpStatus: res.status });
        }
        const body = await res.json();
        if (Array.isArray(body.Answer) && body.Answer.length > 0) {
            return createResult("taken", "doh", "NS answers found");
        }
        if (body.Status === 3) {
            return createResult("unknown", "doh", "NXDOMAIN (suggestive)");
        }
        return createResult("unknown", "doh", "no NS answers");
    } catch (err) {
        return createResult("unknown", "doh", "request failed: " + getErrorMessage(err));
    }
}

// ─── WHOIS (local binary) ───────────────────────────────────────────────────

async function checkViaWhois(domain) {
    try {
        if (typeof Bun !== "undefined" && typeof Bun.spawnSync === "function") {
            const proc = Bun.spawnSync(["whois", domain], { stdout: "pipe", stderr: "pipe" });
            const stdout = proc.stdout ? Buffer.from(proc.stdout).toString("utf8") : "";
            const stderr = proc.stderr ? Buffer.from(proc.stderr).toString("utf8") : "";
            const text = stdout + "\n" + stderr;
            if (INCONCLUSIVE_WHOIS_PATTERNS.test(text)) return { status: "unknown", source: "whois", detail: "iana-only/unsupported" };
            if (AVAILABLE_PATTERNS.test(text)) return { status: "available", source: "whois", detail: "available pattern match" };
            if (text.trim().length > 0) return { status: "taken", source: "whois", detail: "whois did not indicate free" };
            return { status: "unknown", source: "whois", detail: "empty output" };
        }
        const { execFile } = await import("node:child_process");
        const { promisify } = await import("node:util");
        const execFileAsync = promisify(execFile);
        const result = await execFileAsync("whois", [domain], { timeout: 12000, maxBuffer: 1024 * 1024 });
        const text = result.stdout + "\n" + result.stderr;
        if (INCONCLUSIVE_WHOIS_PATTERNS.test(text)) return { status: "unknown", source: "whois", detail: "iana-only/unsupported" };
        if (AVAILABLE_PATTERNS.test(text)) return { status: "available", source: "whois", detail: "available pattern match" };
        return { status: "taken", source: "whois", detail: "whois did not indicate free" };
    } catch {
        return { status: "unknown", source: "whois", detail: "whois unavailable/failed" };
    }
}

// ─── Registrar: Cloudflare ──────────────────────────────────────────────────

async function checkViaCloudflare(domain, creds) {
    if (!creds.token || !creds.accountId) {
        return createResult("unknown", "cloudflare", "missing token/account id");
    }
    const url = "https://api.cloudflare.com/client/v4/accounts/" +
        encodeURIComponent(creds.accountId) + "/registrar/domains/" + encodeURIComponent(domain);
    try {
        const res = await fetch(url, {
            headers: {
                Authorization: "Bearer " + creds.token,
                "content-type": "application/json",
                "user-agent": USER_AGENT,
            },
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.success === false) {
            const detail = "api " + res.status + ": " + truncateText(extractApiErrorMessage(body) || "request rejected");
            return createResult("unknown", "cloudflare", detail, { httpStatus: res.status });
        }
        const result = body.result || {};
        if (typeof result.available === "boolean") {
            return result.available
                ? createResult("available", "cloudflare", "available=true")
                : createResult("taken", "cloudflare", "available=false");
        }
        if (typeof result.can_register === "boolean") {
            return result.can_register
                ? createResult("available", "cloudflare", "can_register=true")
                : createResult("taken", "cloudflare", "can_register=false");
        }
        return createResult("unknown", "cloudflare", "no availability fields");
    } catch (err) {
        return createResult("unknown", "cloudflare", "request failed: " + getErrorMessage(err));
    }
}

// ─── Registrar: GoDaddy ─────────────────────────────────────────────────────

async function checkViaGoDaddy(domain, creds) {
    if (!creds.key || !creds.secret) {
        return createResult("unknown", "godaddy", "missing key/secret");
    }
    const url = "https://api.godaddy.com/v1/domains/available?domain=" + encodeURIComponent(domain);
    try {
        const res = await fetch(url, {
            headers: {
                Authorization: "sso-key " + creds.key + ":" + creds.secret,
                Accept: "application/json",
                "user-agent": USER_AGENT,
            },
        });
        if (!res.ok) {
            const errDetail = await buildHttpErrorDetail(res);
            return createResult("unknown", "godaddy", errDetail, { httpStatus: res.status });
        }
        const body = await res.json();
        if (typeof body.available === "boolean") {
            return body.available
                ? createResult("available", "godaddy", "available=true")
                : createResult("taken", "godaddy", "available=false");
        }
        return createResult("unknown", "godaddy", "unexpected response");
    } catch (err) {
        return createResult("unknown", "godaddy", "request failed: " + getErrorMessage(err));
    }
}

// ─── Registrar: Namecheap ───────────────────────────────────────────────────

async function checkViaNamecheap(domain, creds) {
    if (!creds.apiUser || !creds.apiKey) {
        return createResult("unknown", "namecheap", "missing apiUser/apiKey");
    }
    let clientIp = "127.0.0.1";
    try {
        const ipRes = await fetch("https://api.ipify.org?format=json");
        if (ipRes.ok) {
            const ipBody = await ipRes.json();
            clientIp = ipBody.ip || clientIp;
        }
    } catch { /* use default */ }

    const params = new URLSearchParams({
        ApiUser: creds.apiUser,
        ApiKey: creds.apiKey,
        UserName: creds.apiUser,
        ClientIp: clientIp,
        Command: "namecheap.domains.check",
        DomainList: domain,
    });

    const url = "https://api.namecheap.com/xml.response?" + params.toString();
    try {
        const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
        if (!res.ok) {
            const errDetail = await buildHttpErrorDetail(res);
            return createResult("unknown", "namecheap", errDetail, { httpStatus: res.status });
        }
        const text = await res.text();
        const availMatch = text.match(/Available="(true|false)"/i);
        if (availMatch) {
            return availMatch[1].toLowerCase() === "true"
                ? createResult("available", "namecheap", "Available=true")
                : createResult("taken", "namecheap", "Available=false");
        }
        if (text.includes("Error")) {
            const errMatch = text.match(/<Error[^>]*>(.*?)<\/Error>/);
            return createResult("unknown", "namecheap", errMatch ? compactText(errMatch[1]) : "api error");
        }
        return createResult("unknown", "namecheap", "unexpected response");
    } catch (err) {
        return createResult("unknown", "namecheap", "request failed: " + getErrorMessage(err));
    }
}

// ─── Registrar: WhoisXML API ────────────────────────────────────────────────

async function checkViaWhoisXml(domain, creds) {
    if (!creds.apiKey) {
        return createResult("unknown", "whoisxml", "missing apiKey");
    }
    const params = new URLSearchParams({
        apiKey: creds.apiKey,
        domainName: domain,
        credits: "DA",
        outputFormat: "JSON",
    });
    const url = "https://domain-availability-api.whoisxmlapi.com/api/v1?" + params.toString();
    try {
        const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
        if (!res.ok) {
            const errDetail = await buildHttpErrorDetail(res);
            return createResult("unknown", "whoisxml", errDetail, { httpStatus: res.status });
        }
        const body = await res.json();
        const da = body.DomainInfo || {};
        if (da.domainAvailability === "AVAILABLE") {
            return createResult("available", "whoisxml", "AVAILABLE");
        }
        if (da.domainAvailability === "UNAVAILABLE") {
            return createResult("taken", "whoisxml", "UNAVAILABLE");
        }
        return createResult("unknown", "whoisxml", da.domainAvailability || "unknown");
    } catch (err) {
        return createResult("unknown", "whoisxml", "request failed: " + getErrorMessage(err));
    }
}

// ─── Registrar: WhoisFreaks ─────────────────────────────────────────────────

async function checkViaWhoisFreaks(domain, creds) {
    if (!creds.apiKey) {
        return createResult("unknown", "whoisfreaks", "missing apiKey");
    }
    const params = new URLSearchParams({
        apiKey: creds.apiKey,
        domainName: domain,
    });
    const url = "https://api.whoisfreaks.com/v1.0/domain/availability?" + params.toString();
    try {
        const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
        if (!res.ok) {
            const errDetail = await buildHttpErrorDetail(res);
            return createResult("unknown", "whoisfreaks", errDetail, { httpStatus: res.status });
        }
        const body = await res.json();
        if (body.domain_availability === "available" || body.is_available === true) {
            return createResult("available", "whoisfreaks", "available");
        }
        if (body.domain_availability === "unavailable" || body.is_available === false) {
            return createResult("taken", "whoisfreaks", "unavailable");
        }
        return createResult("unknown", "whoisfreaks", body.domain_availability || "unknown");
    } catch (err) {
        return createResult("unknown", "whoisfreaks", "request failed: " + getErrorMessage(err));
    }
}

// ─── Registrar: WhoAPI ──────────────────────────────────────────────────────

async function checkViaWhoApi(domain, creds) {
    if (!creds.apiKey) {
        return createResult("unknown", "whoapi", "missing apiKey");
    }
    const params = new URLSearchParams({
        apikey: creds.apiKey,
        r: "taken",
        domain: domain,
    });
    const url = "https://api.whoapi.com/?" + params.toString();
    try {
        const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
        if (!res.ok) {
            const errDetail = await buildHttpErrorDetail(res);
            return createResult("unknown", "whoapi", errDetail, { httpStatus: res.status });
        }
        const body = await res.json();
        if (body.status === 0 || body.status_desc === "ok" || body.status_desc === "Ready") {
            if (body.taken === 0) {
                return createResult("available", "whoapi", "taken=0");
            }
            if (body.taken === 1) {
                return createResult("taken", "whoapi", "taken=1");
            }
        }
        return createResult("unknown", "whoapi", body.status_desc || "unknown");
    } catch (err) {
        return createResult("unknown", "whoapi", "request failed: " + getErrorMessage(err));
    }
}

// ─── Registrar: APILayer WHOIS ──────────────────────────────────────────────

async function checkViaApiLayer(domain, creds) {
    if (!creds.apiKey) {
        return createResult("unknown", "apilayer", "missing apiKey");
    }
    const url = "https://api.apilayer.com/whois/check?domain=" + encodeURIComponent(domain);
    try {
        const res = await fetch(url, {
            headers: { apikey: creds.apiKey, "user-agent": USER_AGENT },
        });
        if (!res.ok) {
            const errDetail = await buildHttpErrorDetail(res);
            return createResult("unknown", "apilayer", errDetail, { httpStatus: res.status });
        }
        const body = await res.json();
        if (body.result === "registered" || body.registered === true) {
            return createResult("taken", "apilayer", "registered");
        }
        if (body.result === "available" || body.registered === false) {
            return createResult("available", "apilayer", "available");
        }
        return createResult("unknown", "apilayer", body.result || "unknown");
    } catch (err) {
        return createResult("unknown", "apilayer", "request failed: " + getErrorMessage(err));
    }
}

// ─── Registrar: API Ninjas ──────────────────────────────────────────────────

async function checkViaApiNinjas(domain, creds) {
    if (!creds.apiKey) {
        return createResult("unknown", "apininjas", "missing apiKey");
    }
    const url = "https://api.api-ninjas.com/v1/whois?domain=" + encodeURIComponent(domain);
    try {
        const res = await fetch(url, {
            headers: { "X-Api-Key": creds.apiKey, "user-agent": USER_AGENT },
        });
        if (!res.ok) {
            if (res.status === 404) {
                return createResult("available", "apininjas", "404 - not found", { httpStatus: 404 });
            }
            const errDetail = await buildHttpErrorDetail(res);
            return createResult("unknown", "apininjas", errDetail, { httpStatus: res.status });
        }
        const body = await res.json();
        if (body.domain_name || body.registrar) {
            return createResult("taken", "apininjas", "whois data found");
        }
        if (!body.domain_name && Object.keys(body).length === 0) {
            return createResult("available", "apininjas", "no whois data");
        }
        return createResult("unknown", "apininjas", "inconclusive");
    } catch (err) {
        return createResult("unknown", "apininjas", "request failed: " + getErrorMessage(err));
    }
}

// ─── Registrar: JsonWhois ───────────────────────────────────────────────────

async function checkViaJsonWhois(domain, creds) {
    if (!creds.apiKey) {
        return createResult("unknown", "jsonwhois", "missing apiKey");
    }
    const url = "https://jsonwhois.com/api/v1/whois?domain=" + encodeURIComponent(domain);
    try {
        const res = await fetch(url, {
            headers: {
                Authorization: "Token token=" + creds.apiKey,
                Accept: "application/json",
                "user-agent": USER_AGENT,
            },
        });
        if (!res.ok) {
            if (res.status === 404) {
                return createResult("available", "jsonwhois", "404", { httpStatus: 404 });
            }
            const errDetail = await buildHttpErrorDetail(res);
            return createResult("unknown", "jsonwhois", errDetail, { httpStatus: res.status });
        }
        const body = await res.json();
        if (body.available === true) {
            return createResult("available", "jsonwhois", "available=true");
        }
        if (body.available === false || body.registered === true) {
            return createResult("taken", "jsonwhois", "registered");
        }
        if (body.registrar || body.created_on) {
            return createResult("taken", "jsonwhois", "whois data found");
        }
        return createResult("unknown", "jsonwhois", "inconclusive");
    } catch (err) {
        return createResult("unknown", "jsonwhois", "request failed: " + getErrorMessage(err));
    }
}

// ─── Registrar: Dynadot ─────────────────────────────────────────────────────

async function checkViaDynadot(domain, creds) {
    if (!creds.apiKey) {
        return createResult("unknown", "dynadot", "missing apiKey");
    }
    const params = new URLSearchParams({
        key: creds.apiKey,
        command: "search",
        domain0: domain,
    });
    const url = "https://api.dynadot.com/api3.json?" + params.toString();
    try {
        const res = await fetch(url, { headers: { "user-agent": USER_AGENT } });
        if (!res.ok) {
            const errDetail = await buildHttpErrorDetail(res);
            return createResult("unknown", "dynadot", errDetail, { httpStatus: res.status });
        }
        const body = await res.json();
        const searchResp = body.SearchResponse || body.searchResponse || {};
        const results = searchResp.SearchResults || searchResp.searchResults || [];
        const firstResult = Array.isArray(results) ? results[0] : results;
        if (firstResult) {
            const avail = firstResult.Available || firstResult.available;
            if (avail === "yes" || avail === true) {
                return createResult("available", "dynadot", "available=yes");
            }
            if (avail === "no" || avail === false) {
                return createResult("taken", "dynadot", "available=no");
            }
        }
        return createResult("unknown", "dynadot", "inconclusive");
    } catch (err) {
        return createResult("unknown", "dynadot", "request failed: " + getErrorMessage(err));
    }
}

// ─── Registrar Dispatch ─────────────────────────────────────────────────────

const REGISTRAR_CHECK_FNS = {
    cloudflare: checkViaCloudflare,
    godaddy: checkViaGoDaddy,
    namecheap: checkViaNamecheap,
    whoisxml: checkViaWhoisXml,
    whoisfreaks: checkViaWhoisFreaks,
    whoapi: checkViaWhoApi,
    apilayer: checkViaApiLayer,
    apininjas: checkViaApiNinjas,
    jsonwhois: checkViaJsonWhois,
    dynadot: checkViaDynadot,
};

// ─── Domain Check Pipeline ──────────────────────────────────────────────────

async function checkDomain(domain, options) {
    // Keep an ordered trace of each attempt so verbose mode and end-of-run notes
    // can explain why a domain ended as unknown.
    const attempts = [];

    for (const reg of options.registrars) {
        const fn = REGISTRAR_CHECK_FNS[reg];
        if (!fn) continue;
        const creds = options.credentials[reg] || {};
        const result = await fn(domain, creds);
        attempts.push(result);
        if (result.status !== "unknown") return withAttempts(result, attempts);
    }

    const rdap = await checkViaRdap(domain);
    attempts.push(rdap);
    if (rdap.status !== "unknown") return withAttempts(rdap, attempts);

    const doh = await checkViaCloudflareDoH(domain);
    attempts.push(doh);
    if (doh.status === "taken") return withAttempts(doh, attempts);

    if (options.useWhois) {
        const whois = await checkViaWhois(domain);
        attempts.push(whois);
        return withAttempts(whois, attempts);
    }

    return withAttempts(createResult("unknown", "pipeline", "all checks inconclusive"), attempts);
}

// ─── Output Formatting ──────────────────────────────────────────────────────

function formatResult(domain, result) {
    const src = chalk.dim("[" + result.source + "]");
    if (result.status === "available") {
        return chalk.green("\u2714 AVAILABLE") + "  " + chalk.bold(domain) + "  " + src;
    }
    if (result.status === "taken") {
        return chalk.red("\u2718 TAKEN    ") + "  " + chalk.bold(domain) + "  " + src;
    }
    return chalk.yellow("? UNKNOWN  ") + "  " + chalk.bold(domain) + "  " + src;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Interactive Mode ────────────────────────────────────────────────────────

async function interactiveMode() {
    console.log();
    console.log(chalk.bold.cyan("\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557"));
    console.log(chalk.bold.cyan("\u2551") + chalk.bold.white("  \ud83c\udf10 Domainator \u2014 Interactive Mode                            ") + chalk.bold.cyan("\u2551"));
    console.log(chalk.bold.cyan("\u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d"));
    console.log();

    const domainInput = await input({
        message: chalk.bold("Enter domains or base names") + chalk.dim(" (space/comma separated)") + ":",
        validate: (val) => {
            const tokens = splitLooseInput(val);
            if (tokens.length === 0) return "Please enter at least one domain or name";
            return true;
        },
    });

    const tokens = splitLooseInput(domainInput);
    const hasBaseNames = tokens.some((t) => !t.includes("."));

    let tlds = [...DEFAULT_TLDS];
    if (hasBaseNames) {
        const tldInput = await input({
            message: chalk.bold("TLDs for base names") + chalk.dim(" (default: " + DEFAULT_TLDS.join(" ") + ")") + ":",
            default: DEFAULT_TLDS.join(" "),
        });
        tlds = tldInput
            .split(/[\s,]+/)
            .map((t) => t.trim())
            .filter((t) => t.startsWith("."))
            .map((t) => t.toLowerCase());
        if (tlds.length === 0) tlds = [...DEFAULT_TLDS];
    }

    const registrarChoices = Object.entries(REGISTRARS).map(([key, reg]) => ({
        name: reg.name + " (" + key + ")",
        value: key,
    }));

    const selectedRegistrars = await checkbox({
        message: chalk.bold("Select registrar providers") + chalk.dim(" (space to toggle, enter to confirm)") + ":",
        choices: registrarChoices,
    });

    const credentials = {};
    for (const [key, reg] of Object.entries(REGISTRARS)) {
        credentials[key] = {};
        for (const field of reg.credentialFields) {
            credentials[key][field.key] = process.env[field.env] || "";
        }
    }

    for (const reg of selectedRegistrars) {
        const regInfo = REGISTRARS[reg];
        console.log(chalk.dim("\n  Credentials for " + regInfo.name + ":"));

        for (const field of regInfo.credentialFields) {
            const envVal = process.env[field.env] || "";
            if (envVal) {
                console.log(chalk.dim("    " + field.label + ": using $" + field.env));
                credentials[reg][field.key] = envVal;
            } else {
                const val = await password({
                    message: "  " + field.label + chalk.dim(" (or set $" + field.env + ")") + ":",
                    mask: "*",
                });
                credentials[reg][field.key] = val;
            }
        }
    }

    const useWhois = await confirm({
        message: "Enable WHOIS fallback?",
        default: true,
    });

    const verbose = await confirm({
        message: "Enable verbose diagnostics?",
        default: false,
    });

    const delayInput = await input({
        message: chalk.bold("Delay between checks") + chalk.dim(" (seconds, default: 0.5)") + ":",
        default: "0.5",
    });
    const delayMs = Math.max(0, parseFloat(delayInput) || 0.5) * 1000;

    const domains = expandToDomains(tokens, tlds);
    const cmdParts = ["bun domainator.js"];

    for (const t of tokens) {
        cmdParts.push(t);
    }

    if (hasBaseNames && JSON.stringify(tlds.sort()) !== JSON.stringify([...DEFAULT_TLDS].sort())) {
        cmdParts.push("--tlds");
        cmdParts.push(...tlds);
    }

    if (selectedRegistrars.length > 0) {
        cmdParts.push("-r");
        cmdParts.push(selectedRegistrars.join(","));
    }

    for (const reg of selectedRegistrars) {
        const regInfo = REGISTRARS[reg];
        for (const field of regInfo.credentialFields) {
            if (credentials[reg][field.key] && !process.env[field.env]) {
                const flagName = getCredentialFlagName(reg, field.key);
                if (flagName) {
                    cmdParts.push(flagName);
                    cmdParts.push("$" + field.env);
                }
            }
        }
    }

    if (!useWhois) cmdParts.push("--no-whois");
    if (verbose) cmdParts.push("--verbose");
    if (delayMs !== 500) cmdParts.push("-d", String(delayMs / 1000));

    console.log();
    console.log(chalk.bold("  Equivalent command:"));
    console.log();

    if (cmdParts.length > 4) {
        const lines = [chalk.green("  " + cmdParts[0])];
        let currentLine = "    ";
        for (let i = 1; i < cmdParts.length; i++) {
            const part = cmdParts[i];
            if (part.startsWith("-")) {
                if (currentLine.trim()) lines.push(chalk.yellow(currentLine));
                currentLine = "    " + part + " ";
            } else {
                currentLine += part + " ";
            }
        }
        if (currentLine.trim()) lines.push(chalk.yellow(currentLine));
        console.log(lines.join(" \\\n"));
    } else {
        console.log(chalk.green("  " + cmdParts.join(" ")));
    }
    console.log();

    const options = {
        tlds,
        registrars: selectedRegistrars,
        credentials,
        useWhois,
        delayMs,
        verbose,
        help: false,
    };

    await runChecks(domains, options);
}

function getCredentialFlagName(registrar, fieldKey) {
    const map = {
        "cloudflare.token": "--cf-token",
        "cloudflare.accountId": "--cf-account-id",
        "godaddy.key": "--gd-key",
        "godaddy.secret": "--gd-secret",
        "namecheap.apiUser": "--nc-user",
        "namecheap.apiKey": "--nc-key",
        "whoisxml.apiKey": "--whoisxml-key",
        "whoisfreaks.apiKey": "--whoisfreaks-key",
        "whoapi.apiKey": "--whoapi-key",
        "apilayer.apiKey": "--apilayer-key",
        "apininjas.apiKey": "--apininjas-key",
        "jsonwhois.apiKey": "--jsonwhois-key",
        "dynadot.apiKey": "--dynadot-key",
    };
    return map[registrar + "." + fieldKey] || null;
}

// ─── Check Execution ─────────────────────────────────────────────────────────

async function runChecks(domains, options) {
    console.log(chalk.bold("\n  Checking " + domains.length + " domain(s)...\n"));

    const registrarNames = options.registrars.length > 0
        ? options.registrars.map((r) => (REGISTRARS[r] ? REGISTRARS[r].name : r)).join(", ")
        : chalk.dim("none");

    console.log(chalk.dim("  TLDs: " + options.tlds.join(", ") +
        "  |  Registrars: " + registrarNames +
        "  |  WHOIS: " + (options.useWhois ? "on" : "off") +
        "  |  Verbose: " + (options.verbose ? "on" : "off")));
    console.log();

    const available = [];
    const taken = [];
    const unknown = [];
    const issues = [];

    for (let idx = 0; idx < domains.length; idx++) {
        const domain = domains[idx];
        const spinner = ora({
            text: chalk.dim("[" + (idx + 1) + "/" + domains.length + "]") + " " + domain,
            prefixText: " ",
        }).start();

        try {
            const result = await checkDomain(domain, options);
            spinner.stop();
            console.log("  " + formatResult(domain, result));

            if (result.status === "available") available.push(domain);
            else if (result.status === "taken") taken.push(domain);
            else unknown.push(domain);

            const attempts = Array.isArray(result.attempts) ? result.attempts : [result];
            if (options.verbose) {
                for (const attempt of attempts) {
                    if (!attempt || !attempt.source) continue;
                    console.log(chalk.dim("      - " + attempt.source + " => " + attempt.status + " | " + truncateText(attempt.detail, 220)));
                }
            }

            // Any unknown step with detail becomes an issue note for the final table.
            for (const attempt of attempts) {
                if (!isIssueAttempt(attempt)) continue;
                issues.push({
                    domain,
                    source: REGISTRARS[attempt.source] ? REGISTRARS[attempt.source].name : attempt.source,
                    detail: truncateText(attempt.detail, 220),
                });
            }
        } catch (err) {
            spinner.stop();
            const errMsg = getErrorMessage(err);
            console.log("  " + chalk.yellow("? ERROR    ") + "  " + chalk.bold(domain) + "  " + chalk.dim(errMsg));
            unknown.push(domain);
            issues.push({ domain, source: "runtime", detail: truncateText(errMsg, 220) });
        }

        if (idx < domains.length - 1 && options.delayMs > 0) {
            await sleep(options.delayMs);
        }
    }

    console.log();
    const table = new Table({
        head: [chalk.bold("Status"), chalk.bold("Count")],
        colWidths: [20, 10],
        style: { head: [], border: ["dim"] },
    });
    table.push(
        [chalk.green("Available"), available.length],
        [chalk.red("Taken"), taken.length],
        [chalk.yellow("Inconclusive"), unknown.length],
        [chalk.yellow("Issues"), issues.length],
    );
    console.log(table.toString());

    if (available.length > 0) {
        console.log(chalk.bold.green("\n  Available domains:"));
        for (const d of available) console.log(chalk.green("    " + d));
    }

    if (unknown.length > 0) {
        console.log(chalk.bold.yellow("\n  Inconclusive (verify at registrar):"));
        for (const d of unknown) console.log(chalk.yellow("    " + d));
    }

    if (issues.length > 0) {
        console.log(chalk.bold.yellow("\n  API/Lookup notes:"));
        const issueTable = new Table({
            head: [chalk.bold("Domain"), chalk.bold("Source"), chalk.bold("Detail")],
            colWidths: [30, 14, 70],
            style: { head: [], border: ["dim"] },
            wordWrap: true,
        });

        for (const issue of issues.slice(0, MAX_REPORT_ISSUES)) {
            issueTable.push([issue.domain, issue.source, issue.detail]);
        }
        console.log(issueTable.toString());

        if (issues.length > MAX_REPORT_ISSUES) {
            console.log(chalk.dim("  ... plus " + (issues.length - MAX_REPORT_ISSUES) + " more issues (use --verbose for full diagnostics)."));
        }
    }

    console.log();
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
    const { options, inputTokens } = parseArgs(process.argv.slice(2));

    if (options.help) {
        showUsage();
        process.exit(0);
    }

    for (const reg of options.registrars) {
        if (!REGISTRARS[reg]) {
            console.error(chalk.red("Unknown registrar: " + reg));
            console.error(chalk.dim("Available: " + allRegistrarNames().join(", ")));
            process.exit(1);
        }
    }

    if (options.interactive) {
        await interactiveMode();
        return;
    }

    const pipedTokens = await readPipedInput();
    const allTokens = [...inputTokens, ...pipedTokens];
    const domains = expandToDomains(allTokens, options.tlds);

    if (domains.length === 0 && process.stdin.isTTY) {
        showUsage();
        console.log();

        const action = await select({
            message: "What would you like to do?",
            choices: [
                { name: "\ud83d\ude80 Run interactive mode", value: "i" },
                { name: "\ud83d\udc4b Quit", value: "q" },
            ],
        });

        if (action === "q") {
            console.log(chalk.dim("\nGoodbye!\n"));
            process.exit(0);
        }

        await interactiveMode();
        return;
    }

    if (domains.length === 0) {
        showUsage();
        process.exit(1);
    }

    await runChecks(domains, options);
}

if (import.meta.main) {
    main().catch((err) => {
        console.error(chalk.red("Fatal error: " + getErrorMessage(err)));
        process.exit(1);
    });
}

// ─── Exports for testing ────────────────────────────────────────────────────

export {
    normalizeToken,
    splitLooseInput,
    isLikelyDomainToken,
    parseArgs,
    expandToDomains,
    resolveRegistrarName,
    allRegistrarNames,
    checkViaRdap,
    checkViaCloudflareDoH,
    checkViaWhois,
    checkViaCloudflare,
    checkViaGoDaddy,
    checkViaNamecheap,
    checkViaWhoisXml,
    checkViaWhoisFreaks,
    checkViaWhoApi,
    checkViaApiLayer,
    checkViaApiNinjas,
    checkViaJsonWhois,
    checkViaDynadot,
    checkDomain,
    formatResult,
    REGISTRARS,
    REGISTRAR_CHECK_FNS,
    DEFAULT_TLDS,
};
