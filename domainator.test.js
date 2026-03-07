import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import {
    normalizeToken,
    splitLooseInput,
    isLikelyDomainToken,
    parseArgs,
    expandToDomains,
    resolveRegistrarName,
    allRegistrarNames,
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
    checkViaRdap,
    checkViaCloudflareDoH,
    checkDomain,
    formatResult,
    REGISTRARS,
    REGISTRAR_CHECK_FNS,
    DEFAULT_TLDS,
} from "./domainator.js";

// ─── normalizeToken ──────────────────────────────────────────────────────────

describe("normalizeToken", () => {
    test("returns empty for falsy input", () => {
        expect(normalizeToken("")).toBe("");
        expect(normalizeToken(null)).toBe("");
        expect(normalizeToken(undefined)).toBe("");
    });

    test("lowercases and trims", () => {
        expect(normalizeToken("  Hello  ")).toBe("hello");
        expect(normalizeToken("EXAMPLE.COM")).toBe("example.com");
    });

    test("strips surrounding quotes and special chars", () => {
        expect(normalizeToken('"example.com"')).toBe("example.com");
        expect(normalizeToken("'example.com'")).toBe("example.com");
        expect(normalizeToken("`example.com`")).toBe("example.com");
        expect(normalizeToken("example.com,")).toBe("example.com");
        expect(normalizeToken("example.com;")).toBe("example.com");
    });

    test("strips http/https protocol", () => {
        expect(normalizeToken("https://example.com")).toBe("example.com");
        expect(normalizeToken("http://example.com")).toBe("example.com");
    });

    test("strips www. prefix", () => {
        expect(normalizeToken("www.example.com")).toBe("example.com");
    });

    test("strips path, query, and hash", () => {
        expect(normalizeToken("example.com/path")).toBe("example.com");
        expect(normalizeToken("example.com?query=1")).toBe("example.com");
        expect(normalizeToken("example.com#hash")).toBe("example.com");
    });

    test("handles full URL normalization", () => {
        expect(normalizeToken("https://www.example.com/path?q=1#h")).toBe("example.com");
    });
});

// ─── splitLooseInput ─────────────────────────────────────────────────────────

describe("splitLooseInput", () => {
    test("splits on spaces", () => {
        expect(splitLooseInput("alpha beta gamma")).toEqual(["alpha", "beta", "gamma"]);
    });

    test("splits on commas", () => {
        expect(splitLooseInput("alpha,beta,gamma")).toEqual(["alpha", "beta", "gamma"]);
    });

    test("splits on mixed whitespace and commas", () => {
        expect(splitLooseInput("alpha, beta\tgamma\n  delta")).toEqual(["alpha", "beta", "gamma", "delta"]);
    });

    test("filters empty tokens", () => {
        expect(splitLooseInput("  ,, alpha ,, ")).toEqual(["alpha"]);
    });

    test("normalizes each token", () => {
        expect(splitLooseInput("https://www.EXAMPLE.COM, test.dev")).toEqual(["example.com", "test.dev"]);
    });
});

// ─── isLikelyDomainToken ────────────────────────────────────────────────────

describe("isLikelyDomainToken", () => {
    test("returns false for empty/null", () => {
        expect(isLikelyDomainToken("")).toBe(false);
        expect(isLikelyDomainToken(null)).toBe(false);
        expect(isLikelyDomainToken(undefined)).toBe(false);
    });

    test("returns false for flags", () => {
        expect(isLikelyDomainToken("--help")).toBe(false);
        expect(isLikelyDomainToken("-h")).toBe(false);
        expect(isLikelyDomainToken("--registrar")).toBe(false);
    });

    test("returns true for valid domain tokens", () => {
        expect(isLikelyDomainToken("example")).toBe(true);
        expect(isLikelyDomainToken("example.com")).toBe(true);
        expect(isLikelyDomainToken("my-domain")).toBe(true);
        expect(isLikelyDomainToken("sub.domain.com")).toBe(true);
    });

    test("returns true for single alphanumeric names", () => {
        expect(isLikelyDomainToken("shai")).toBe(true);
        expect(isLikelyDomainToken("test123")).toBe(true);
    });

    test("returns false for invalid patterns", () => {
        expect(isLikelyDomainToken("-startswithdash")).toBe(false);
    });
});

// ─── resolveRegistrarName ───────────────────────────────────────────────────

describe("resolveRegistrarName", () => {
    test("resolves direct names", () => {
        expect(resolveRegistrarName("cloudflare")).toBe("cloudflare");
        expect(resolveRegistrarName("godaddy")).toBe("godaddy");
        expect(resolveRegistrarName("namecheap")).toBe("namecheap");
        expect(resolveRegistrarName("whoisxml")).toBe("whoisxml");
        expect(resolveRegistrarName("whoisfreaks")).toBe("whoisfreaks");
        expect(resolveRegistrarName("whoapi")).toBe("whoapi");
        expect(resolveRegistrarName("apilayer")).toBe("apilayer");
        expect(resolveRegistrarName("apininjas")).toBe("apininjas");
        expect(resolveRegistrarName("jsonwhois")).toBe("jsonwhois");
        expect(resolveRegistrarName("dynadot")).toBe("dynadot");
    });

    test("resolves aliases", () => {
        expect(resolveRegistrarName("cf")).toBe("cloudflare");
        expect(resolveRegistrarName("gd")).toBe("godaddy");
        expect(resolveRegistrarName("nc")).toBe("namecheap");
        expect(resolveRegistrarName("wxml")).toBe("whoisxml");
        expect(resolveRegistrarName("wf")).toBe("whoisfreaks");
        expect(resolveRegistrarName("al")).toBe("apilayer");
        expect(resolveRegistrarName("an")).toBe("apininjas");
        expect(resolveRegistrarName("jw")).toBe("jsonwhois");
        expect(resolveRegistrarName("dd")).toBe("dynadot");
    });

    test("returns 'none' for none", () => {
        expect(resolveRegistrarName("none")).toBe("none");
    });

    test("returns null for unknown", () => {
        expect(resolveRegistrarName("unknown")).toBeNull();
        expect(resolveRegistrarName("foobar")).toBeNull();
    });

    test("is case-insensitive", () => {
        expect(resolveRegistrarName("CLOUDFLARE")).toBe("cloudflare");
        expect(resolveRegistrarName("GD")).toBe("godaddy");
    });
});

// ─── allRegistrarNames ──────────────────────────────────────────────────────

describe("allRegistrarNames", () => {
    test("returns all registrar keys", () => {
        const names = allRegistrarNames();
        expect(names).toContain("cloudflare");
        expect(names).toContain("godaddy");
        expect(names).toContain("namecheap");
        expect(names).toContain("whoisxml");
        expect(names).toContain("whoisfreaks");
        expect(names).toContain("whoapi");
        expect(names).toContain("apilayer");
        expect(names).toContain("apininjas");
        expect(names).toContain("jsonwhois");
        expect(names).toContain("dynadot");
        expect(names.length).toBe(10);
    });
});

// ─── parseArgs ───────────────────────────────────────────────────────────────

describe("parseArgs", () => {
    test("parses --help / -h", () => {
        expect(parseArgs(["--help"]).options.help).toBe(true);
        expect(parseArgs(["-h"]).options.help).toBe(true);
        expect(parseArgs(["test.com"]).options.help).toBe(false);
    });

    test("parses --no-whois", () => {
        expect(parseArgs(["--no-whois"]).options.useWhois).toBe(false);
        expect(parseArgs([]).options.useWhois).toBe(true);
    });

    test("parses --delay / -d in seconds", () => {
        expect(parseArgs(["-d", "1"]).options.delayMs).toBe(1000);
        expect(parseArgs(["--delay", "0.25"]).options.delayMs).toBe(250);
        expect(parseArgs(["--delay", "0"]).options.delayMs).toBe(0);
    });

    test("default delay is 500ms (0.5s)", () => {
        expect(parseArgs([]).options.delayMs).toBe(500);
    });

    test("parses --verbose / -v", () => {
        expect(parseArgs(["--verbose"]).options.verbose).toBe(true);
        expect(parseArgs(["-v"]).options.verbose).toBe(true);
        expect(parseArgs([]).options.verbose).toBe(false);
    });

    test("parses --tlds / -t", () => {
        const { options } = parseArgs(["--tlds", ".dev", ".run"]);
        expect(options.tlds).toEqual([".dev", ".run"]);
    });

    test("parses -t short alias", () => {
        const { options } = parseArgs(["-t", ".dev", ".run"]);
        expect(options.tlds).toEqual([".dev", ".run"]);
    });

    test("default TLDs", () => {
        expect(parseArgs([]).options.tlds).toEqual(DEFAULT_TLDS);
    });

    test("parses --registrar / -r with single value", () => {
        const { options } = parseArgs(["-r", "godaddy"]);
        expect(options.registrars).toEqual(["godaddy"]);
    });

    test("parses --registrar with comma-separated values", () => {
        const { options } = parseArgs(["--registrar", "godaddy,whoisxml,cf"]);
        expect(options.registrars).toEqual(["godaddy", "whoisxml", "cloudflare"]);
    });

    test("parses --registrar with alias", () => {
        const { options } = parseArgs(["-r", "cf"]);
        expect(options.registrars).toEqual(["cloudflare"]);
    });

    test("parses registrar none as empty list", () => {
        const { options } = parseArgs(["-r", "none"]);
        expect(options.registrars).toEqual([]);
    });

    test("parses Cloudflare credential flags", () => {
        const { options } = parseArgs(["--cf-token", "mytoken", "--cf-account-id", "myaccount"]);
        expect(options.credentials.cloudflare.token).toBe("mytoken");
        expect(options.credentials.cloudflare.accountId).toBe("myaccount");
    });

    test("parses -cft and -cfa short aliases", () => {
        const { options } = parseArgs(["-cft", "tok", "-cfa", "acc"]);
        expect(options.credentials.cloudflare.token).toBe("tok");
        expect(options.credentials.cloudflare.accountId).toBe("acc");
    });

    test("parses GoDaddy credential flags", () => {
        const { options } = parseArgs(["--gd-key", "k", "--gd-secret", "s"]);
        expect(options.credentials.godaddy.key).toBe("k");
        expect(options.credentials.godaddy.secret).toBe("s");
    });

    test("parses Namecheap credential flags", () => {
        const { options } = parseArgs(["--nc-user", "u", "--nc-key", "k"]);
        expect(options.credentials.namecheap.apiUser).toBe("u");
        expect(options.credentials.namecheap.apiKey).toBe("k");
    });

    test("parses WhoisXML key flag", () => {
        const { options } = parseArgs(["--whoisxml-key", "wxk"]);
        expect(options.credentials.whoisxml.apiKey).toBe("wxk");
    });

    test("parses WhoisFreaks key flag", () => {
        const { options } = parseArgs(["--whoisfreaks-key", "wfk"]);
        expect(options.credentials.whoisfreaks.apiKey).toBe("wfk");
    });

    test("parses WhoAPI key flag", () => {
        const { options } = parseArgs(["--whoapi-key", "wak"]);
        expect(options.credentials.whoapi.apiKey).toBe("wak");
    });

    test("parses APILayer key flag", () => {
        const { options } = parseArgs(["--apilayer-key", "alk"]);
        expect(options.credentials.apilayer.apiKey).toBe("alk");
    });

    test("parses API Ninjas key flag", () => {
        const { options } = parseArgs(["--apininjas-key", "ank"]);
        expect(options.credentials.apininjas.apiKey).toBe("ank");
    });

    test("parses JsonWhois key flag", () => {
        const { options } = parseArgs(["--jsonwhois-key", "jwk"]);
        expect(options.credentials.jsonwhois.apiKey).toBe("jwk");
    });

    test("parses Dynadot key flag", () => {
        const { options } = parseArgs(["--dynadot-key", "ddk"]);
        expect(options.credentials.dynadot.apiKey).toBe("ddk");
    });

    test("collects domain input tokens", () => {
        const { inputTokens } = parseArgs(["shai", "test.com", "hello"]);
        expect(inputTokens).toEqual(["shai", "test.com", "hello"]);
    });

    test("handles mixed flags and tokens", () => {
        const { options, inputTokens } = parseArgs([
            "shai", "-r", "godaddy", "--gd-key", "k", "--gd-secret", "s",
            "hello.com", "--no-whois", "-d", "0.1",
        ]);
        expect(inputTokens).toEqual(["shai", "hello.com"]);
        expect(options.registrars).toEqual(["godaddy"]);
        expect(options.credentials.godaddy.key).toBe("k");
        expect(options.credentials.godaddy.secret).toBe("s");
        expect(options.useWhois).toBe(false);
        expect(options.delayMs).toBe(100);
    });

    test("deduplicates TLDs", () => {
        const { options } = parseArgs(["--tlds", ".com", ".dev", ".com"]);
        expect(options.tlds).toEqual([".com", ".dev"]);
    });

    test("deduplicates registrars", () => {
        const { options } = parseArgs(["-r", "cf,cloudflare,cf"]);
        expect(options.registrars).toEqual(["cloudflare"]);
    });

    test("skips unknown flags", () => {
        const { inputTokens } = parseArgs(["--unknown-flag", "shai"]);
        expect(inputTokens).toEqual(["shai"]);
    });
});

// ─── expandToDomains ─────────────────────────────────────────────────────────

describe("expandToDomains", () => {
    test("expands base name with TLDs", () => {
        const result = expandToDomains(["shai"], [".com", ".ai"]);
        expect(result).toEqual(["shai.com", "shai.ai"]);
    });

    test("passes full domains through directly", () => {
        const result = expandToDomains(["shai.dev"], [".com", ".ai"]);
        expect(result).toEqual(["shai.dev"]);
    });

    test("mixes base names and full domains", () => {
        const result = expandToDomains(["shai", "test.org"], [".com"]);
        expect(result).toEqual(["shai.com", "test.org"]);
    });

    test("deduplicates results", () => {
        const result = expandToDomains(["shai", "shai"], [".com"]);
        expect(result).toEqual(["shai.com"]);
    });

    test("filters out invalid tokens", () => {
        const result = expandToDomains(["--flag", "", "valid"], [".com"]);
        expect(result).toEqual(["valid.com"]);
    });

    test("handles multiple TLDs", () => {
        const result = expandToDomains(["test"], [".com", ".ai", ".io"]);
        expect(result).toEqual(["test.com", "test.ai", "test.io"]);
    });

    test("returns empty for empty input", () => {
        expect(expandToDomains([], [".com"])).toEqual([]);
    });
});

// ─── REGISTRARS registry ────────────────────────────────────────────────────

describe("REGISTRARS registry", () => {
    test("all registrars have required fields", () => {
        for (const [key, reg] of Object.entries(REGISTRARS)) {
            expect(reg.name).toBeDefined();
            expect(Array.isArray(reg.credentialFields)).toBe(true);
            expect(Array.isArray(reg.aliases)).toBe(true);
            for (const field of reg.credentialFields) {
                expect(field.key).toBeDefined();
                expect(field.label).toBeDefined();
                expect(field.env).toBeDefined();
            }
        }
    });

    test("all registrars have a check function", () => {
        for (const key of Object.keys(REGISTRARS)) {
            expect(REGISTRAR_CHECK_FNS[key]).toBeDefined();
            expect(typeof REGISTRAR_CHECK_FNS[key]).toBe("function");
        }
    });

    test("no duplicate aliases across registrars", () => {
        const allAliases = [];
        for (const reg of Object.values(REGISTRARS)) {
            allAliases.push(...reg.aliases);
        }
        expect(allAliases.length).toBe(new Set(allAliases).size);
    });
});

// ─── formatResult ────────────────────────────────────────────────────────────

describe("formatResult", () => {
    test("formats available result", () => {
        const result = formatResult("test.com", { status: "available", source: "rdap", detail: "" });
        expect(result).toContain("AVAILABLE");
        expect(result).toContain("test.com");
        expect(result).toContain("rdap");
    });

    test("formats taken result", () => {
        const result = formatResult("test.com", { status: "taken", source: "doh", detail: "" });
        expect(result).toContain("TAKEN");
        expect(result).toContain("test.com");
        expect(result).toContain("doh");
    });

    test("formats unknown result", () => {
        const result = formatResult("test.com", { status: "unknown", source: "pipeline", detail: "" });
        expect(result).toContain("UNKNOWN");
        expect(result).toContain("test.com");
        expect(result).toContain("pipeline");
    });
});

// ─── Cloudflare

describe("checkViaCloudflare", () => {
    test("returns unknown when missing creds", async () => {
        const result = await checkViaCloudflare("test.com", {});
        expect(result.status).toBe("unknown");
        expect(result.source).toBe("cloudflare");
        expect(result.detail).toContain("missing");
    });

    test("returns available when API says available", async () => {
        globalThis.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ success: true, result: { available: true } }),
            })
        );
        const result = await checkViaCloudflare("test.com", { token: "t", accountId: "a" });
        expect(result.status).toBe("available");
        expect(result.source).toBe("cloudflare");
    });

    test("returns taken when API says not available", async () => {
        globalThis.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ success: true, result: { available: false } }),
            })
        );
        const result = await checkViaCloudflare("test.com", { token: "t", accountId: "a" });
        expect(result.status).toBe("taken");
    });

    test("returns available via can_register", async () => {
        globalThis.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ success: true, result: { can_register: true } }),
            })
        );
        const result = await checkViaCloudflare("test.com", { token: "t", accountId: "a" });
        expect(result.status).toBe("available");
    });

    test("handles API error", async () => {
        globalThis.fetch = mock(() =>
            Promise.resolve({
                ok: false,
                status: 403,
                json: () => Promise.resolve({ success: false }),
            })
        );
        const result = await checkViaCloudflare("test.com", { token: "t", accountId: "a" });
        expect(result.status).toBe("unknown");
    });

    test("handles fetch failure", async () => {
        globalThis.fetch = mock(() => Promise.reject(new Error("network error")));
        const result = await checkViaCloudflare("test.com", { token: "t", accountId: "a" });
        expect(result.status).toBe("unknown");
        expect(result.detail).toContain("request failed");
    });

    test("constructs correct URL and headers", async () => {
        let seenUrl = "";
        let seenHeaders = {};
        globalThis.fetch = mock((url, opts) => {
            seenUrl = String(url);
            seenHeaders = opts.headers || {};
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ success: true, result: { available: true } }) });
        });
        await checkViaCloudflare("example.com", { token: "tok", accountId: "acc" });
        expect(seenUrl).toContain("/accounts/acc/registrar/domains/example.com");
        expect(seenHeaders.Authorization).toBe("Bearer tok");
    });
});

// ─── GoDaddy

describe("checkViaGoDaddy", () => {
    test("returns unknown when missing creds", async () => {
        const result = await checkViaGoDaddy("test.com", {});
        expect(result.status).toBe("unknown");
        expect(result.detail).toContain("missing");
    });

    test("returns available", async () => {
        globalThis.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ available: true, domain: "test.com" }),
            })
        );
        const result = await checkViaGoDaddy("test.com", { key: "k", secret: "s" });
        expect(result.status).toBe("available");
        expect(result.source).toBe("godaddy");
    });

    test("returns taken", async () => {
        globalThis.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ available: false }),
            })
        );
        const result = await checkViaGoDaddy("test.com", { key: "k", secret: "s" });
        expect(result.status).toBe("taken");
    });

    test("handles API error", async () => {
        globalThis.fetch = mock(() =>
            Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({}) })
        );
        const result = await checkViaGoDaddy("test.com", { key: "k", secret: "s" });
        expect(result.status).toBe("unknown");
    });

    test("constructs correct URL and headers", async () => {
        let seenUrl = "";
        let seenHeaders = {};
        globalThis.fetch = mock((url, opts) => {
            seenUrl = String(url);
            seenHeaders = opts.headers || {};
            return Promise.resolve({ ok: true, json: () => Promise.resolve({ available: true, domain: "test.com" }) });
        });
        await checkViaGoDaddy("abc.com", { key: "k", secret: "s" });
        expect(seenUrl).toContain("https://api.godaddy.com/v1/domains/available?domain=abc.com");
        expect(seenHeaders.Authorization).toBe("sso-key k:s");
    });
});

// ─── Namecheap

describe("checkViaNamecheap", () => {
    test("returns unknown when missing creds", async () => {
        const result = await checkViaNamecheap("test.com", {});
        expect(result.status).toBe("unknown");
        expect(result.detail).toContain("missing");
    });

    test("returns available from XML", async () => {
        globalThis.fetch = mock((url) => {
            if (String(url).includes("ipify")) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ ip: "1.2.3.4" }) });
            }
            return Promise.resolve({
                ok: true,
                text: () =>
                    Promise.resolve('<DomainCheckResult Domain="test.com" Available="true" />'),
            });
        });
        const result = await checkViaNamecheap("test.com", { apiUser: "u", apiKey: "k" });
        expect(result.status).toBe("available");
        expect(result.source).toBe("namecheap");
    });

    test("returns taken from XML", async () => {
        globalThis.fetch = mock((url) => {
            if (String(url).includes("ipify")) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ ip: "1.2.3.4" }) });
            }
            return Promise.resolve({
                ok: true,
                text: () =>
                    Promise.resolve('<DomainCheckResult Domain="test.com" Available="false" />'),
            });
        });
        const result = await checkViaNamecheap("test.com", { apiUser: "u", apiKey: "k" });
        expect(result.status).toBe("taken");
    });

    test("handles error in XML", async () => {
        globalThis.fetch = mock((url) => {
            if (String(url).includes("ipify")) {
                return Promise.resolve({ ok: true, json: () => Promise.resolve({ ip: "1.2.3.4" }) });
            }
            return Promise.resolve({
                ok: true,
                text: () => Promise.resolve("<Error>Some error message</Error>"),
            });
        });
        const result = await checkViaNamecheap("test.com", { apiUser: "u", apiKey: "k" });
        expect(result.status).toBe("unknown");
        expect(result.detail).toContain("Some error message");
    });
});

// ─── WhoisXML

describe("checkViaWhoisXml", () => {
    test("returns unknown when missing creds", async () => {
        const result = await checkViaWhoisXml("test.com", {});
        expect(result.status).toBe("unknown");
    });

    test("returns available", async () => {
        let capturedUrl = "";
        globalThis.fetch = mock((url) => {
            capturedUrl = String(url);
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ DomainInfo: { domainAvailability: "AVAILABLE" } }),
            });
        });
        const result = await checkViaWhoisXml("test.com", { apiKey: "k" });
        expect(result.status).toBe("available");
        expect(result.source).toBe("whoisxml");
        // ensure URL contains query parameters
        expect(capturedUrl).toMatch(/^https:\/\/domain-availability-api\.whoisxmlapi\.com\/api\/v1\?/);
        expect(capturedUrl).toContain("domainName=test.com");
    });

    test("returns taken", async () => {
        let capturedUrl = "";
        globalThis.fetch = mock((url) => {
            capturedUrl = String(url);
            return Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ DomainInfo: { domainAvailability: "UNAVAILABLE" } }),
            });
        });
        const result = await checkViaWhoisXml("test.com", { apiKey: "k" });
        expect(result.status).toBe("taken");
        expect(capturedUrl).toContain("domainName=test.com");
    });

    test("constructs proper URL even with dummy key", async () => {
        let capturedUrl = "";
        globalThis.fetch = mock((url) => {
            capturedUrl = String(url);
            return Promise.resolve({
                ok: false,
                status: 422,
                text: () => Promise.resolve('{"code":422,"messages":"Input correct domain name."}'),
            });
        });
        const result = await checkViaWhoisXml("domanaika.com", { apiKey: "DUMMY" });
        expect(capturedUrl).toMatch(/^https:\/\/domain-availability-api\.whoisxmlapi\.com\/api\/v1\?/);
        expect(capturedUrl).toContain("domainName=domanaika.com");
        expect(capturedUrl).toContain("apiKey=DUMMY");
        expect(result.status).toBe("unknown");
        expect(result.detail).toContain("api 422");
        expect(result.detail).toContain("Input correct domain name");
    });

    // ─── WhoisFreaks

    describe("checkViaWhoisFreaks", () => {
        test("returns unknown when missing creds", async () => {
            const result = await checkViaWhoisFreaks("test.com", {});
            expect(result.status).toBe("unknown");
        });

        test("returns available via domain_availability", async () => {
            globalThis.fetch = mock(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ domain_availability: "available" }),
                })
            );
            const result = await checkViaWhoisFreaks("test.com", { apiKey: "k" });
            expect(result.status).toBe("available");
        });

        test("returns taken via domain_availability", async () => {
            globalThis.fetch = mock(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ domain_availability: "unavailable" }),
                })
            );
            const result = await checkViaWhoisFreaks("test.com", { apiKey: "k" });
            expect(result.status).toBe("taken");
        });

        test("returns available via is_available boolean", async () => {
            globalThis.fetch = mock(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ is_available: true }),
                })
            );
            const result = await checkViaWhoisFreaks("test.com", { apiKey: "k" });
            expect(result.status).toBe("available");
        });
    });

    // ─── WhoAPI

    describe("checkViaWhoApi", () => {
        test("returns unknown when missing creds", async () => {
            const result = await checkViaWhoApi("test.com", {});
            expect(result.status).toBe("unknown");
        });

        test("returns available (taken=0)", async () => {
            globalThis.fetch = mock(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ status: 0, taken: 0 }),
                })
            );
            const result = await checkViaWhoApi("test.com", { apiKey: "k" });
            expect(result.status).toBe("available");
            expect(result.source).toBe("whoapi");
        });

        test("returns taken (taken=1)", async () => {
            globalThis.fetch = mock(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ status: 0, taken: 1 }),
                })
            );
            const result = await checkViaWhoApi("test.com", { apiKey: "k" });
            expect(result.status).toBe("taken");
        });

        test("builds correct URL and propagates API error detail", async () => {
            let capturedUrl = "";
            globalThis.fetch = mock((url) => {
                capturedUrl = String(url);
                return Promise.resolve({
                    ok: false,
                    status: 401,
                    text: () => Promise.resolve('{"status_desc":"invalid api key"}'),
                });
            });
            const result = await checkViaWhoApi("test.com", { apiKey: "bad" });
            expect(capturedUrl).toContain("domain=test.com");
            expect(capturedUrl).toContain("apikey=bad");
            expect(result.status).toBe("unknown");
            expect(result.detail).toContain("api 401");
            expect(result.detail).toContain("invalid api key");
        });
    });

    // ─── APILayer

    describe("checkViaApiLayer", () => {
        test("returns unknown when missing creds", async () => {
            const result = await checkViaApiLayer("test.com", {});
            expect(result.status).toBe("unknown");
        });

        test("returns taken for registered", async () => {
            globalThis.fetch = mock(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ result: "registered" }),
                })
            );
            const result = await checkViaApiLayer("test.com", { apiKey: "k" });
            expect(result.status).toBe("taken");
            expect(result.source).toBe("apilayer");
        });

        test("returns available", async () => {
            globalThis.fetch = mock(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ result: "available" }),
                })
            );
            const result = await checkViaApiLayer("test.com", { apiKey: "k" });
            expect(result.status).toBe("available");
        });

        test("returns available via registered=false", async () => {
            globalThis.fetch = mock(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ registered: false }),
                })
            );
            const result = await checkViaApiLayer("test.com", { apiKey: "k" });
            expect(result.status).toBe("available");
        });
    });

    // ─── API Ninjas

    describe("checkViaApiNinjas", () => {
        test("returns unknown when missing creds", async () => {
            const result = await checkViaApiNinjas("test.com", {});
            expect(result.status).toBe("unknown");
        });

        test("returns taken when whois data found", async () => {
            globalThis.fetch = mock(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ domain_name: "test.com", registrar: "SomeRegistrar" }),
                })
            );
            const result = await checkViaApiNinjas("test.com", { apiKey: "k" });
            expect(result.status).toBe("taken");
        });

        test("returns available when empty response", async () => {
            globalThis.fetch = mock(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({}),
                })
            );
            const result = await checkViaApiNinjas("test.com", { apiKey: "k" });
            expect(result.status).toBe("available");
        });

        test("returns available on 404", async () => {
            globalThis.fetch = mock(() =>
                Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) })
            );
            const result = await checkViaApiNinjas("test.com", { apiKey: "k" });
            expect(result.status).toBe("available");
        });
    });

    // ─── JsonWhois

    describe("checkViaJsonWhois", () => {
        test("returns unknown when missing creds", async () => {
            const result = await checkViaJsonWhois("test.com", {});
            expect(result.status).toBe("unknown");
        });

        test("returns available when available=true", async () => {
            globalThis.fetch = mock(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ available: true }),
                })
            );
            const result = await checkViaJsonWhois("test.com", { apiKey: "k" });
            expect(result.status).toBe("available");
        });

        test("returns taken when available=false", async () => {
            globalThis.fetch = mock(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ available: false }),
                })
            );
            const result = await checkViaJsonWhois("test.com", { apiKey: "k" });
            expect(result.status).toBe("taken");
        });

        test("returns taken when registrar data present", async () => {
            globalThis.fetch = mock(() =>
                Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({ registrar: "SomeRegistrar" }),
                })
            );
            const result = await checkViaJsonWhois("test.com", { apiKey: "k" });
            expect(result.status).toBe("taken");
        });

        test("returns available on 404", async () => {
            globalThis.fetch = mock(() =>
                Promise.resolve({ ok: false, status: 404 })
            );
            const result = await checkViaJsonWhois("test.com", { apiKey: "k" });
            expect(result.status).toBe("available");
        });
    });

    // ─── Dynadot

    describe("checkViaDynadot", () => {
        test("returns unknown when missing creds", async () => {
            const result = await checkViaDynadot("test.com", {});
            expect(result.status).toBe("unknown");
        });

        test("returns available", async () => {
            globalThis.fetch = mock(() =>
                Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            SearchResponse: { SearchResults: [{ Available: "yes" }] },
                        }),
                })
            );
            const result = await checkViaDynadot("test.com", { apiKey: "k" });
            expect(result.status).toBe("available");
            expect(result.source).toBe("dynadot");
        });

        test("returns taken", async () => {
            globalThis.fetch = mock(() =>
                Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            SearchResponse: { SearchResults: [{ Available: "no" }] },
                        }),
                })
            );
            const result = await checkViaDynadot("test.com", { apiKey: "k" });
            expect(result.status).toBe("taken");
        });

        test("handles boolean available field", async () => {
            globalThis.fetch = mock(() =>
                Promise.resolve({
                    ok: true,
                    json: () =>
                        Promise.resolve({
                            SearchResponse: { SearchResults: [{ available: true }] },
                        }),
                })
            );
            const result = await checkViaDynadot("test.com", { apiKey: "k" });
            expect(result.status).toBe("available");
        });
    });
});

// ─── checkViaRdap ────────────────────────────────────────────────────────────

describe("checkViaRdap", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("returns unknown for domain with no TLD", async () => {
        const result = await checkViaRdap("");
        expect(result.status).toBe("unknown");
    });
});

// ─── checkViaCloudflareDoH ──────────────────────────────────────────────────

describe("checkViaCloudflareDoH", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("returns taken when NS answers found", async () => {
        globalThis.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ Status: 0, Answer: [{ type: 2, data: "ns1.example.com." }] }),
            })
        );
        const result = await checkViaCloudflareDoH("example.com");
        expect(result.status).toBe("taken");
        expect(result.source).toBe("doh");
    });

    test("returns unknown for NXDOMAIN", async () => {
        globalThis.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ Status: 3, Answer: null }),
            })
        );
        const result = await checkViaCloudflareDoH("nonexistent12345.com");
        expect(result.status).toBe("unknown");
        expect(result.detail).toContain("NXDOMAIN");
    });

    test("returns unknown on fetch error", async () => {
        globalThis.fetch = mock(() => Promise.reject(new Error("fail")));
        const result = await checkViaCloudflareDoH("test.com");
        expect(result.status).toBe("unknown");
        expect(result.detail).toContain("request failed");
    });
});

// ─── checkDomain (pipeline) ─────────────────────────────────────────────────

describe("checkDomain", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
        globalThis.fetch = originalFetch;
    });

    test("uses registrar first if configured", async () => {
        globalThis.fetch = mock(() =>
            Promise.resolve({
                ok: true,
                json: () => Promise.resolve({ available: true }),
            })
        );
        const options = {
            registrars: ["godaddy"],
            credentials: { godaddy: { key: "k", secret: "s" } },
            useWhois: false,
        };
        const result = await checkDomain("test.com", options);
        expect(result.status).toBe("available");
        expect(result.source).toBe("godaddy");
    });

    test("falls through to RDAP if registrar returns unknown", async () => {
        let callCount = 0;
        globalThis.fetch = mock((url) => {
            callCount++;
            const urlStr = String(url);
            // GoDaddy returns inconclusive
            if (urlStr.includes("godaddy")) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({}),
                });
            }
            // RDAP bootstrap
            if (urlStr.includes("iana.org/rdap")) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve({
                        services: [
                            [["com"], ["https://rdap.example.com/"]],
                        ],
                    }),
                });
            }
            // RDAP domain lookup - taken
            if (urlStr.includes("rdap.example.com")) {
                return Promise.resolve({ ok: true, status: 200 });
            }
            return Promise.resolve({ ok: false, status: 404 });
        });
        const options = {
            registrars: ["godaddy"],
            credentials: { godaddy: { key: "k", secret: "s" } },
            useWhois: false,
        };
        const result = await checkDomain("test.com", options);
        expect(result.source).not.toBe("godaddy");
    });

    test("returns unknown when all checks are inconclusive and whois off", async () => {
        globalThis.fetch = mock(() =>
            Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) })
        );
        const options = {
            registrars: [],
            credentials: {},
            useWhois: false,
        };
        // clear rdap cache
        const result = await checkDomain("xyznonexist12345.randomtld", options);
        expect(result.status).toBe("unknown");
    });
});

// ─── End-to-end CLI flag combinations ────────────────────────────────────────

describe("End-to-end flag combinations", () => {
    test("full complex command parsing", () => {
        const { options, inputTokens } = parseArgs([
            "shai", "myproject",
            "-t", ".dev", ".run", ".ai",
            "-r", "whoisxml,godaddy,cf",
            "--whoisxml-key", "wxkey",
            "--gd-key", "gdkey", "--gd-secret", "gdsecret",
            "-cft", "cftok", "-cfa", "cfacc",
            "--no-whois",
            "-d", "0.2",
        ]);
        expect(inputTokens).toEqual(["shai", "myproject"]);
        expect(options.tlds).toEqual([".dev", ".run", ".ai"]);
        expect(options.registrars).toEqual(["whoisxml", "godaddy", "cloudflare"]);
        expect(options.credentials.whoisxml.apiKey).toBe("wxkey");
        expect(options.credentials.godaddy.key).toBe("gdkey");
        expect(options.credentials.godaddy.secret).toBe("gdsecret");
        expect(options.credentials.cloudflare.token).toBe("cftok");
        expect(options.credentials.cloudflare.accountId).toBe("cfacc");
        expect(options.useWhois).toBe(false);
        expect(options.delayMs).toBe(200);
    });

    test("expands domains from complex parsed args", () => {
        const { options, inputTokens } = parseArgs([
            "shai", "test.dev",
            "-t", ".com", ".ai",
        ]);
        const domains = expandToDomains(inputTokens, options.tlds);
        expect(domains).toEqual(["shai.com", "shai.ai", "test.dev"]);
    });

    test("all registrar short aliases parse correctly", () => {
        const { options } = parseArgs(["-r", "cf,gd,nc,wxml,wf,al,an,jw,dd"]);
        expect(options.registrars).toEqual([
            "cloudflare", "godaddy", "namecheap", "whoisxml",
            "whoisfreaks", "apilayer", "apininjas", "jsonwhois", "dynadot",
        ]);
    });
});
