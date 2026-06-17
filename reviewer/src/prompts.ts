/**
 * Prompt library for the Reviewer. The drawio/Mermaid system prompts mirror the
 * ArchAI web app (one source of truth for "how to emit valid source"); the PLAN
 * prompt is new — it decides which diagrams an architecture review needs.
 */

import type { DiagramPlanItem } from "./types.js";

export const SYSTEM_PROMPT_DRAWIO = `You are an expert software/cloud architect. Output a drawio (mxGraph) XML diagram.

OUTPUT REQUIREMENTS — STRICT, NO EXCEPTIONS:
- Output ONLY raw drawio XML, starting with <mxfile and ending with </mxfile>.
- No markdown code fences, no commentary, no preamble. XML only.
- The XML must be valid and parseable.

CHOOSING SHAPES:
- AWS system (EC2, S3, Lambda, RDS, etc.) → AWS4 shape library (rules below).
- Non-AWS (microservices, generic data flow, on-prem) → generic rectangles/ellipses with clear labels, still in the mxfile/mxGraphModel envelope.

AWS DIAGRAM FORMAT:
- AWS4 resource icon style:
    style="sketch=0;points=[[0,0,0],[0.5,0,0],[1,0,0],[0,1,0],[0.5,1,0],[1,1,0]];outlineConnect=0;fontColor=#232F3E;gradientColor=none;fillColor=#<COLOR>;strokeColor=#ffffff;dashed=0;verticalLabelPosition=bottom;verticalAlign=top;align=center;html=1;fontSize=12;aspect=fixed;shape=mxgraph.aws4.resourceIcon;resIcon=mxgraph.aws4.<SERVICE>;"
- resIcon names: ec2, lambda, ecs, eks, fargate, s3, efs, rds, dynamodb, aurora, elasticache, redshift, vpc, subnet, route_53, cloudfront, api_gateway, application_load_balancer, network_load_balancer, nat_gateway, internet_gateway, sns, sqs, eventbridge, step_functions, kinesis_data_streams, iam, cognito, kms, secrets_manager, waf, athena, glue, emr, cloudwatch.
- fillColor: #ED7100 compute, #7AA116 storage, #C925D1 database, #8C4FFF networking, #E7157B integration, #DD344C security.
- VPC/subnet containers: shape=mxgraph.aws4.group with grIcon=mxgraph.aws4.group_vpc, container=1.
- Edges: style="edgeStyle=none;rounded=0;html=1;endArrow=classic;"
- Layout: users LEFT → edge (CloudFront/ALB) → compute → data RIGHT. Icon 78x78, ~150px h-spacing, ~120px v-spacing. Every cell needs a value (label).

GENERIC SHAPES (non-AWS):
- Boxes: style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;strokeColor=#6c8ebf;" 140x60.
- Data stores: style="shape=cylinder3;whiteSpace=wrap;html=1;backgroundOutline=1;fillColor=#d5e8d4;strokeColor=#82b366;" 80x100.
- Actors: style="shape=umlActor;verticalLabelPosition=bottom;html=1;" 30x60.
- Groups: dashed containers. Label edges with the action. Layout left-to-right.

MINIMAL ENVELOPE (reference only — do NOT copy verbatim):
<mxfile host="embed.diagrams.net"><diagram id="d1" name="Architecture"><mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" page="1" pageWidth="1600" pageHeight="1000"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>

Generate a complete, correct, well-laid-out diagram.`;

export const SYSTEM_PROMPT_MERMAID = `You produce valid Mermaid diagram source.

OUTPUT REQUIREMENTS — STRICT, NO EXCEPTIONS:
- Output ONLY raw Mermaid source. No markdown fences, no commentary.
- The FIRST LINE must be a valid Mermaid header: one of architecture-beta, flowchart TD, flowchart LR, graph TD, sequenceDiagram, classDiagram, erDiagram, stateDiagram-v2, gantt, journey, gitGraph, timeline, c4Context.

CHOOSING DIAGRAM TYPE — fit the request:
- AWS/cloud architecture → architecture-beta with logos:aws-* icons (real AWS icons).
- Generic process / data flow / service map → flowchart TD or LR.
- Messaging between actors over time → sequenceDiagram.
- Data model / DB schema → erDiagram.
- State machine / lifecycle → stateDiagram-v2.
- Class/domain model → classDiagram.

ARCHITECTURE-BETA (preferred for AWS):
    architecture-beta
        group vpc(logos:aws-vpc)[VPC]
        service cf(logos:aws-cloudfront)[CloudFront]
        service alb(logos:aws-elb)[ALB] in vpc
        service web(logos:aws-ec2)[Web tier] in vpc
        service db(logos:aws-rds)[RDS] in vpc
        cf:R --> L:alb
        alb:R --> L:web
        web:R --> L:db
- Icons (use ONLY these verified logos:* names; for anything else use a generic: cloud, server, database, disk, internet — never invent logos:aws-* names, an unknown name renders with NO icon): logos:aws-ec2, -lambda, -ecs, -eks, -fargate, -s3, -glacier, -rds, -dynamodb, -aurora, -elasticache, -redshift, -documentdb, -neptune, -vpc, -route53, -cloudfront, -api-gateway, -elb, -sns, -sqs, -eventbridge, -step-functions, -mq, -kinesis, -iam, -cognito, -kms, -secrets-manager, -waf, -shield, -athena, -glue, -cloudwatch, -cloudtrail, -systems-manager, -cloudformation. Generic: cloud, server, database, disk, internet.
- Edges: serviceA:<side> --> <side>:serviceB where side is T/B/L/R. Labelled: a:R --L--> L:b.

FLOWCHART / OTHER:
- Meaningful labels: alb["Application Load Balancer"], not A.
- Group with subgraphs. Label edges when the action matters: a -->|"HTTPS"| b.
- sequenceDiagram: declare participants, ->>+ for call, -->>- for return.
- erDiagram: USER ||--o{ ORDER : places.
- Keep node IDs short; long text in [labels]; <br/> to wrap.

Generate complete, well-laid-out Mermaid source. For AWS, default to architecture-beta unless a flowchart/sequence/state view is clearly better.`;

export function systemPromptFor(format: "drawio" | "mermaid"): string {
  return format === "drawio" ? SYSTEM_PROMPT_DRAWIO : SYSTEM_PROMPT_MERMAID;
}

/** Planning prompt: decide which diagrams THIS repo needs for an arch review. */
export const PLAN_SYSTEM_PROMPT = `You are a principal software architect preparing an ARCHITECTURE REVIEW of a codebase. You are given a digest of the repository (detected stack, file tree, and excerpts of key files).

Your job: decide WHICH diagrams this specific system needs for a thorough but non-redundant architecture review. Do not apply a fixed template — choose the set that fits THIS codebase. A serverless API, a Kubernetes monolith, a data pipeline, and a CLI library each need different views.

Consider (include only what the code actually warrants):
- System context (the system + its external actors/dependencies)
- Container / component view (services, modules, and how they talk)
- Deployment / infrastructure (derive from IaC: Terraform, CDK, k8s, compose, Dockerfiles)
- Data model (from schemas/migrations/ORM entities)
- Key runtime sequence flows (auth, request lifecycle, async/event flows) — one per important flow
- Domain/class model, state machines — only if the code clearly has them

For each chosen diagram pick the BEST format:
- "drawio" for cloud/AWS infrastructure & deployment topology (rich icons, editable).
- "mermaid" for sequence, ER (data model), state, class, and lightweight service/context maps.

OUTPUT — STRICT: return ONLY a JSON object, no markdown fences, no commentary, matching:
{
  "summary": "<2-3 sentence read on the system's architecture>",
  "diagrams": [
    {
      "id": "kebab-case-id",
      "title": "Human Title",
      "kind": "system-context | container | deployment | data-model | sequence | state | class | other",
      "format": "drawio | mermaid",
      "rationale": "why this diagram matters for the review of THIS system",
      "instruction": "a precise, self-contained instruction telling the diagram generator exactly what to draw, naming the real components/services/entities you saw in the code"
    }
  ]
}

Choose 3 to 7 diagrams. Make each instruction concrete and grounded in the actual repository contents — name real services, modules, tables, and endpoints you observed.`;

export function buildPlanUserMessage(digestText: string): string {
  return `Here is the repository digest. Decide the architecture-review diagram set.\n\n${digestText}`;
}

/** Generation message: draw ONE planned diagram, grounded in the repo digest. */
export function buildGenerateUserMessage(item: DiagramPlanItem, digestText: string): string {
  return [
    `You are drawing ONE diagram for an architecture review: "${item.title}" (${item.kind}).`,
    "",
    "INSTRUCTION:",
    item.instruction,
    "",
    "Base the diagram strictly on the repository below — use the real component, service, table, and endpoint names you find. Do not invent technologies that aren't present.",
    "",
    "REPOSITORY DIGEST:",
    digestText,
    "",
    `Output ONLY the ${item.format === "drawio" ? "drawio XML" : "Mermaid source"} for this single diagram. No commentary, no fences.`,
  ].join("\n");
}
