/**
 * Source extractors — clean an LLM response down to valid diagram source.
 * Lifted from the ArchAI web app (the battle-tested logic incl. truncation
 * recovery for drawio) so both surfaces share one source of truth.
 */

export function extractDrawioXml(raw: string): string {
  let s = (raw || "").trim();
  s = s.replace(/```(?:xml|html)?\s*/gi, "").replace(/```/g, "").trim();

  // Case 1: full mxfile present.
  const mxfStart = s.indexOf("<mxfile");
  const mxfEnd = s.lastIndexOf("</mxfile>");
  if (mxfStart !== -1 && mxfEnd !== -1 && mxfEnd > mxfStart) {
    return s.slice(mxfStart, mxfEnd + "</mxfile>".length);
  }

  // Case 1b: <mxfile> opened but never closed — almost certainly truncated.
  if (mxfStart !== -1 && mxfEnd === -1) {
    let body = s.slice(mxfStart);
    const lastLT = body.lastIndexOf("<");
    const lastGT = body.lastIndexOf(">");
    if (lastLT > lastGT) body = body.slice(0, lastLT);
    const lastCellOpen = body.lastIndexOf("<mxCell");
    const lastCellClose = body.lastIndexOf("</mxCell>");
    if (lastCellOpen !== -1 && lastCellOpen > lastCellClose) {
      const tail = body.slice(lastCellOpen);
      if (tail.indexOf("/>") === -1) body = body.slice(0, lastCellOpen);
    }
    const closers: string[] = [];
    if (body.indexOf("<root") !== -1 && body.indexOf("</root>") === -1) closers.push("</root>");
    if (body.indexOf("<mxGraphModel") !== -1 && body.indexOf("</mxGraphModel>") === -1) closers.push("</mxGraphModel>");
    if (body.indexOf("<diagram") !== -1 && body.indexOf("</diagram>") === -1) closers.push("</diagram>");
    closers.push("</mxfile>");
    return body + closers.join("");
  }

  // Case 2: bare <mxGraphModel> — wrap in an mxfile envelope.
  const gmStart = s.indexOf("<mxGraphModel");
  const gmEnd = s.lastIndexOf("</mxGraphModel>");
  if (gmStart !== -1 && gmEnd !== -1 && gmEnd > gmStart) {
    const inner = s.slice(gmStart, gmEnd + "</mxGraphModel>".length);
    return '<mxfile host="embed.diagrams.net"><diagram id="d1" name="Page-1">' + inner + "</diagram></mxfile>";
  }

  const preview = s.slice(0, 300).replace(/\s+/g, " ");
  throw new Error("LLM did not return drawio XML. First 300 chars: " + preview);
}

const MERMAID_HEADERS_RE =
  /^\s*(architecture-beta|architecture|flowchart|graph|sequenceDiagram|classDiagram|erDiagram|stateDiagram(-v2)?|gantt|journey|gitGraph|mindmap|timeline|pie|quadrantChart|requirementDiagram|c4Context|sankey-beta)\b/;

export function extractMermaid(raw: string): string {
  let s = (raw || "").trim();
  s = s.replace(/^```(?:mermaid)?\s*\n?/i, "").replace(/```\s*$/i, "").trim();
  s = s.replace(/^<\/?(?:pre|code)[^>]*>/i, "").replace(/<\/?(?:pre|code)>\s*$/i, "").trim();
  if (!MERMAID_HEADERS_RE.test(s)) {
    const m = s.match(
      /(flowchart|graph|sequenceDiagram|classDiagram|erDiagram|stateDiagram(-v2)?|gantt|journey|gitGraph|mindmap|timeline|pie|quadrantChart|requirementDiagram|c4Context|sankey-beta|architecture-beta)\b[\s\S]*/,
    );
    if (m) s = m[0].trim();
  }
  if (!MERMAID_HEADERS_RE.test(s)) {
    const preview = s.slice(0, 200).replace(/\s+/g, " ");
    throw new Error("LLM did not return Mermaid source. First 200 chars: " + preview);
  }
  return s;
}

export function extractFor(format: "drawio" | "mermaid", raw: string): string {
  return format === "drawio" ? extractDrawioXml(raw) : extractMermaid(raw);
}
