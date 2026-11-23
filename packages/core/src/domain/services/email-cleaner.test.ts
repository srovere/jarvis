import { describe, expect, it } from "vitest";
import { EmailCleaner } from "./email-cleaner";

const htmlToText = (html: string) => html.replace(/<[^>]+>/g, "");
const cleaner = () => new EmailCleaner({ htmlToText });
const snippet = "snip";

describe("EmailCleaner", () => {
  it("prefers bodyText over bodyHtml", () => {
    expect(
      cleaner().clean({ bodyText: "texto", bodyHtml: "<p>html</p>", snippet }),
    ).toBe("texto");
  });

  it("uses htmlToText when only bodyHtml exists", () => {
    expect(cleaner().clean({ bodyHtml: "<p>hola</p>", snippet })).toBe("hola");
  });

  it("cuts at English quote header", () => {
    const body =
      "Thanks\n\nOn Mon, Nov 3, 2026 at 10:00 AM Ann <a@x.com> wrote:\n> old";
    expect(cleaner().clean({ bodyText: body, snippet })).toBe("Thanks");
  });

  it("cuts at Spanish quote header on one line", () => {
    const body =
      "Gracias\nEl lun, 3 nov 2026 a las 10:00, Ana <ana@x.com> escribió:\n> viejo";
    expect(cleaner().clean({ bodyText: body, snippet })).toBe("Gracias");
  });

  it("cuts at Spanish quote header wrapped across two lines", () => {
    const body =
      "Gracias\n\nEl lun, 3 nov 2026 a las 10:00, Ana Pérez <ana@x.com>\nescribió:\n> viejo";
    expect(cleaner().clean({ bodyText: body, snippet })).toBe("Gracias");
  });

  it("cuts at Original Message and De/Enviado headers", () => {
    expect(
      cleaner().clean({
        bodyText: "ok\n-----Original Message-----\nx",
        snippet,
      }),
    ).toBe("ok");
    expect(
      cleaner().clean({ bodyText: "ok\n--- Mensaje original ---\nx", snippet }),
    ).toBe("ok");
    expect(
      cleaner().clean({
        bodyText: "ok\nDe: a@x.com\nEnviado: ayer\nx",
        snippet,
      }),
    ).toBe("ok");
  });

  it("cuts at a block of > quoted lines", () => {
    expect(cleaner().clean({ bodyText: "ok\n> a\n> b", snippet })).toBe("ok");
  });

  it("removes signature and mobile footers", () => {
    expect(
      cleaner().clean({ bodyText: "ok\n-- \nSantiago\n555", snippet }),
    ).toBe("ok");
    expect(cleaner().clean({ bodyText: "ok\n--\nS", snippet })).toBe("ok");
    expect(
      cleaner().clean({ bodyText: "ok\nEnviado desde mi iPhone", snippet }),
    ).toBe("ok");
    expect(
      cleaner().clean({ bodyText: "ok\nSent from my iPhone", snippet }),
    ).toBe("ok");
  });

  it("collapses 3+ newlines and trims", () => {
    expect(cleaner().clean({ bodyText: "  a\n\n\n\n\nb  \n", snippet })).toBe(
      "a\n\nb",
    );
  });

  it("truncates long input with marker", () => {
    const out = cleaner().clean({ bodyText: "a".repeat(10000), snippet });
    expect(out.length).toBeLessThanOrEqual(4040);
    expect(out.endsWith("\n[… truncado, 10000 caracteres en total]")).toBe(
      true,
    );
  });

  it("handles HTML-only huge Spanish quoted message", () => {
    const html = `<p>${"x".repeat(5000)}</p>\nEl lun, 3 nov 2026, Ana ana@x.com\nescribió:\n${"y".repeat(9000)}`;
    const out = cleaner().clean({ bodyHtml: html, snippet });
    expect(out).toContain("[… truncado, 5000 caracteres en total]");
    expect(out).not.toContain("y");
  });

  it("falls back to decoded snippet when no body", () => {
    expect(
      cleaner().clean({
        snippet: "It&#39;s &quot;ok&quot; &amp; &lt;b&gt; &#233; ",
      }),
    ).toBe('It\'s "ok" & <b> é');
  });

  it("removes > lines without cutting the rest of the body", () => {
    expect(
      cleaner().clean({ bodyText: "Hi\n> note: x\nmore real text", snippet }),
    ).toBe("Hi\nmore real text");
    expect(
      cleaner().clean({ bodyText: "> quoted first\n\nMy reply", snippet }),
    ).toBe("My reply");
  });

  it("falls back to snippet when cleaned body is empty", () => {
    expect(
      cleaner().clean({
        bodyText: "> a\n> b\n-- \nSanti",
        snippet: "Hola &amp; chau",
      }),
    ).toBe("Hola & chau");
  });

  it("decodes hex entities and nbsp, ignores invalid code points", () => {
    const c = cleaner();
    expect(c.cleanSnippet("it&#x27;s&nbsp;ok")).toBe("it's ok");
    expect(c.cleanSnippet("a &#99999999; b")).toBe("a &#99999999; b");
    expect(c.cleanSnippet("a &#55357; b")).toBe("a &#55357; b");
    expect(c.cleanSnippet("a &#x110000; b")).toBe("a &#x110000; b");
  });

  it("keeps a legit sentence ending in escribió:", () => {
    const body =
      "El jueves nos vemos y te aviso que el cliente escribió:\nque sí";
    expect(cleaner().clean({ bodyText: body, snippet })).toBe(body);
  });

  it("cuts on header without @ when followed by a > line", () => {
    expect(
      cleaner().clean({
        bodyText: "Ok\nEl lunes Ana escribió:\n\n> viejo",
        snippet,
      }),
    ).toBe("Ok");
  });

  it("cuts on English header wrapped across two lines", () => {
    const body =
      "Thanks\nOn Mon, Nov 3, 2026 at 10:00 AM Bob <bob@x.com>\nwrote:\n> old";
    expect(cleaner().clean({ bodyText: body, snippet })).toBe("Thanks");
  });
});
