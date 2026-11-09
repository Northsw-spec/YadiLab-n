import { EnterpriseImportError } from "./types.js";

export interface XmlNode {
  readonly name: string;
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: readonly XmlNode[];
  readonly text: string;
  readonly content: readonly (string | XmlNode)[];
}

interface MutableXmlNode {
  name: string;
  attributes: Record<string, string>;
  children: MutableXmlNode[];
  textParts: string[];
  contentParts: (string | MutableXmlNode)[];
}

const MAX_XML_NODES = 250_000;
// Deliberately separate S3 Office structural-only parser cap. NEVER increase
// the default parser budget: all v0/v1/v2 and unrelated XML stay at 250k.
const MAX_XML_S3_OFFICE_NODES = 600_000;
const MAX_XML_DEPTH = 128;
const MAX_XML_TAG_CHARS = 256 * 1024;
const MAX_XML_ATTRIBUTES_PER_ELEMENT = 256;
const MAX_XML_ATTRIBUTE_CHARS = 64 * 1024;
const MAX_XML_TEXT_CHARS_PER_ELEMENT = 1024 * 1024;
const MAX_XML_TOTAL_TEXT_CHARS = 16 * 1024 * 1024;

function fail(code: string, message: string): never { throw new EnterpriseImportError(code, message); }

function decodeEntity(entity: string): string {
  if (entity === "amp") return "&";
  if (entity === "lt") return "<";
  if (entity === "gt") return ">";
  if (entity === "quot") return '"';
  if (entity === "apos") return "'";
  if (/^#\d+$/.test(entity)) {
    const cp = Number(entity.slice(1));
    if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) fail("IMPORT_XML_INVALID_ENTITY", `Invalid numeric XML entity &${entity};.`);
    return String.fromCodePoint(cp);
  }
  if (/^#x[0-9a-fA-F]+$/.test(entity)) {
    const cp = Number.parseInt(entity.slice(2), 16);
    if (!Number.isInteger(cp) || cp < 0 || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) fail("IMPORT_XML_INVALID_ENTITY", `Invalid numeric XML entity &${entity};.`);
    return String.fromCodePoint(cp);
  }
  fail("IMPORT_XML_CUSTOM_ENTITY", `Unsupported/custom XML entity &${entity};.`);
}

function decodeXmlText(value: string): string {
  let decoded = "";
  let cursor = 0;
  while (cursor < value.length) {
    const amp = value.indexOf("&", cursor);
    if (amp < 0) return decoded + value.slice(cursor);
    decoded += value.slice(cursor, amp);
    const semicolon = value.indexOf(";", amp + 1);
    if (semicolon < 0) fail("IMPORT_XML_INVALID_ENTITY", "XML contains an unterminated entity reference.");
    decoded += decodeEntity(value.slice(amp + 1, semicolon));
    cursor = semicolon + 1;
  }
  return decoded;
}

function findTagEnd(xml: string, start: number, label: string): number {
  let quote: '"' | "'" | undefined;
  for (let i = start; i < xml.length; i++) {
    if (i - start > MAX_XML_TAG_CHARS) fail("IMPORT_XML_TAG_TOO_LARGE", `${label} contains an XML tag exceeding the size limit.`);
    const ch = xml[i]!;
    if (quote) { if (ch === quote) quote = undefined; continue; }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === ">") return i;
  }
  return -1;
}

function parseOpenTag(raw: string): { name: string; attributes: Record<string, string>; selfClosing: boolean } {
  let body = raw.trim();
  const selfClosing = body.endsWith("/");
  if (selfClosing) body = body.slice(0, -1).trimEnd();
  const nameMatch = /^([^\s/>]+)/.exec(body);
  if (!nameMatch) fail("IMPORT_XML_MALFORMED", "XML start tag has no name.");
  const name = nameMatch[1]!;
  let i = name.length;
  const attributes: Record<string, string> = Object.create(null) as Record<string, string>;
  let attributeCount = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i]!)) i++;
    if (i >= body.length) break;
    const attrMatch = /^([^\s=/>]+)/.exec(body.slice(i));
    if (!attrMatch) fail("IMPORT_XML_MALFORMED", `Malformed attribute in <${name}>.`);
    const attrName = attrMatch[1]!;
    if (Object.hasOwn(attributes, attrName)) fail("IMPORT_XML_DUPLICATE_ATTRIBUTE", `Duplicate XML attribute ${attrName} in <${name}>.`);
    attributeCount++;
    if (attributeCount > MAX_XML_ATTRIBUTES_PER_ELEMENT) fail("IMPORT_XML_TOO_MANY_ATTRIBUTES", `XML element <${name}> exceeds the attribute limit.`);
    i += attrName.length;
    while (i < body.length && /\s/.test(body[i]!)) i++;
    if (body[i] !== "=") fail("IMPORT_XML_MALFORMED", `XML attribute ${attrName} in <${name}> is missing '='.`);
    i++;
    while (i < body.length && /\s/.test(body[i]!)) i++;
    const quote = body[i];
    if (quote !== '"' && quote !== "'") fail("IMPORT_XML_MALFORMED", `XML attribute ${attrName} in <${name}> is not quoted.`);
    i++;
    const end = body.indexOf(quote, i);
    if (end < 0) fail("IMPORT_XML_MALFORMED", `XML attribute ${attrName} in <${name}> has an unterminated value.`);
    const value = decodeXmlText(body.slice(i, end));
    if (value.length > MAX_XML_ATTRIBUTE_CHARS) fail("IMPORT_XML_ATTRIBUTE_TOO_LARGE", `XML attribute ${attrName} in <${name}> exceeds the size limit.`);
    attributes[attrName] = value;
    i = end + 1;
  }
  return { name, attributes, selfClosing };
}

function freezeNode(node: MutableXmlNode): XmlNode {
  const childMap = new Map<MutableXmlNode, XmlNode>();
  const children = node.children.map((c) => { const frozen = freezeNode(c); childMap.set(c, frozen); return frozen; });
  const content = node.contentParts.map((part) => typeof part === "string" ? part : childMap.get(part)!);
  const attributes = Object.assign(Object.create(null), node.attributes) as Record<string, string>;
  return Object.freeze({ name: node.name, attributes: Object.freeze(attributes), children: Object.freeze(children), text: node.textParts.join(""), content: Object.freeze(content) });
}

function parseSafeXmlWithNodeLimit(bytes: Uint8Array, label: string, maxNodes: number): XmlNode {
  let xml: string;
  try { xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { fail("IMPORT_XML_INVALID_UTF8", `${label} is not valid UTF-8 XML.`); }
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) fail("IMPORT_XML_DTD_FORBIDDEN", `${label} contains a DTD/entity declaration; external/custom entities are forbidden.`);
  if (xml.includes("\0")) fail("IMPORT_XML_NUL_BYTE", `${label} contains a NUL byte.`);

  const synthetic: MutableXmlNode = { name: "#document", attributes: Object.create(null) as Record<string, string>, children: [], textParts: [], contentParts: [] };
  const stack: MutableXmlNode[] = [synthetic];
  let nodes = 0;
  let totalTextChars = 0;
  const appendText = (node: MutableXmlNode, raw: string, decode = true): void => {
    const text = decode ? decodeXmlText(raw) : raw;
    if (text.length > MAX_XML_TEXT_CHARS_PER_ELEMENT) fail("IMPORT_XML_TEXT_TOO_LARGE", `${label} contains an XML text node exceeding the size limit.`);
    totalTextChars += text.length;
    if (totalTextChars > MAX_XML_TOTAL_TEXT_CHARS) fail("IMPORT_XML_TEXT_TOO_LARGE", `${label} exceeds the total XML text limit.`);
    node.textParts.push(text); node.contentParts.push(text);
  };
  let pos = 0;
  while (pos < xml.length) {
    const lt = xml.indexOf("<", pos);
    if (lt < 0) { appendText(stack[stack.length - 1]!, xml.slice(pos)); break; }
    if (lt > pos) appendText(stack[stack.length - 1]!, xml.slice(pos, lt));

    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      if (end < 0) fail("IMPORT_XML_MALFORMED", `${label} contains an unterminated XML comment.`);
      pos = end + 3; continue;
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      if (end < 0) fail("IMPORT_XML_MALFORMED", `${label} contains unterminated CDATA.`);
      appendText(stack[stack.length - 1]!, xml.slice(lt + 9, end), false);
      pos = end + 3; continue;
    }
    if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt + 2);
      if (end < 0) fail("IMPORT_XML_MALFORMED", `${label} contains an unterminated processing instruction.`);
      const instruction = xml.slice(lt + 2, end).trim();
      if (!/^xml(?:\s|$)/i.test(instruction)) fail("IMPORT_XML_PROCESSING_INSTRUCTION_FORBIDDEN", `${label} contains a non-XML processing instruction.`);
      pos = end + 2; continue;
    }
    if (xml.startsWith("<!", lt)) fail("IMPORT_XML_DECLARATION_FORBIDDEN", `${label} contains an unsupported XML declaration.`);

    const gt = findTagEnd(xml, lt + 1, label);
    if (gt < 0) fail("IMPORT_XML_MALFORMED", `${label} contains an unterminated tag.`);
    const raw = xml.slice(lt + 1, gt);
    if (raw.startsWith("/")) {
      const closeName = raw.slice(1).trim();
      if (stack.length === 1) fail("IMPORT_XML_MALFORMED", `${label} contains an unexpected closing tag </${closeName}>.`);
      const current = stack.pop()!;
      if (current.name !== closeName) fail("IMPORT_XML_MALFORMED", `${label} closes </${closeName}> while <${current.name}> is open.`);
    } else {
      const parsed = parseOpenTag(raw);
      const node: MutableXmlNode = { name: parsed.name, attributes: parsed.attributes, children: [], textParts: [], contentParts: [] };
      stack[stack.length - 1]!.children.push(node); stack[stack.length - 1]!.contentParts.push(node);
      nodes++;
      if (nodes > maxNodes) fail("IMPORT_XML_TOO_COMPLEX", `${label} exceeds the XML node limit.`);
      if (!parsed.selfClosing) {
        stack.push(node);
        if (stack.length > MAX_XML_DEPTH + 1) fail("IMPORT_XML_TOO_DEEP", `${label} exceeds the XML nesting limit.`);
      }
    }
    pos = gt + 1;
  }
  if (stack.length !== 1) fail("IMPORT_XML_MALFORMED", `${label} ends before all XML elements are closed.`);
  if (synthetic.children.length !== 1) fail("IMPORT_XML_MALFORMED", `${label} must contain exactly one XML document element.`);
  return freezeNode(synthetic.children[0]!);
}

/** Existing default XML parser remains hard-limited to 250,000 nodes. */
export function parseSafeXml(bytes: Uint8Array, label: string): XmlNode {
  return parseSafeXmlWithNodeLimit(bytes, label, MAX_XML_NODES);
}

/** P4c1: higher but STILL HARD-BOUNDED 10k Office STRUCTURAL-ONLY XML.
 * A separate caller must opt in; no arbitrary numeric limit is exposed.
 * XML depth/DTD/entity/PI/UTF-8/malformed-tag restrictions are identical.
 */
export function parseSafeXmlOfficeS3(bytes: Uint8Array, label: string): XmlNode {
  return parseSafeXmlWithNodeLimit(bytes, label, MAX_XML_S3_OFFICE_NODES);
}

export function localName(name: string): string { const i = name.indexOf(":"); return i >= 0 ? name.slice(i + 1) : name; }
export function attr(node: XmlNode, exactOrLocal: string): string | undefined {
  if (Object.hasOwn(node.attributes, exactOrLocal)) return node.attributes[exactOrLocal];
  const matches = Object.entries(node.attributes).filter(([name]) => localName(name) === exactOrLocal);
  return matches.length === 1 ? matches[0]![1] : undefined;
}
export function childElements(node: XmlNode, wantedLocal?: string): readonly XmlNode[] { return wantedLocal ? node.children.filter((x) => localName(x.name) === wantedLocal) : node.children; }
export function descendants(node: XmlNode, wantedLocal: string): XmlNode[] {
  const out: XmlNode[] = [];
  const visit = (n: XmlNode): void => { for (const c of n.children) { if (localName(c.name) === wantedLocal) out.push(c); visit(c); } };
  visit(node); return out;
}
export function firstChild(node: XmlNode, wantedLocal: string): XmlNode | undefined { return node.children.find((x) => localName(x.name) === wantedLocal); }
export function xmlText(node: XmlNode): string { return node.content.map((part) => typeof part === "string" ? part : xmlText(part)).join(""); }
