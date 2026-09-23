# CV drafting and review guidance

Use this reference when creating, tailoring, reviewing, or restructuring CV content.

If operating inside the Seevee repository/workspace and `docs/workspace-agent/CV_GUIDANCE.md` is available, read that document for the full researched sector/locale guidance and source list. This skill reference contains the core rules needed when the skill is used standalone.

## Authority and scope

This is agent guidance, not product validation.

- Do not create a user-facing resume score.
- Do not create a hidden standards/profile selector.
- Do not block export because a CV violates a generic career convention.
- Preserve intentional unconventional layouts/content choices.
- User intent, target role, market, sector, and factual source material are authoritative.
- Verify current primary sources when handling government/regulatory/form-specific CVs or biosketches.

Hard Seevee failures are data/reference errors, unsafe template behavior, or invalid rendering/export—not generic resume advice.

## Facts

Never invent:

- employers or job titles;
- dates;
- degrees/certifications;
- technologies;
- responsibilities;
- metrics;
- users/revenue/scale;
- performance improvements;
- awards;
- links/contact details.

A stronger-sounding unsupported metric is worse than a factual unquantified statement.

## Tailoring

Prefer separate CV JSON variants instead of one CV full of conditional flags.

Useful pattern:

~~~text
cvs/
  master.json
  backend.json
  security.json
  embedded.json
  target-company.json
~~~

A master CV may contain broader verified history. Tailored CVs should independently tell the story relevant to the target.

Current MIT guidance supports maintaining comprehensive/master material and saving tailored resume iterations for reuse.

## General content heuristics

When relevant:

- tailor to the role;
- make the strongest evidence easy to find;
- prefer concrete actions and outcomes over responsibility lists;
- use strong verbs when natural;
- quantify only when measured/supported;
- keep dates/names/links internally consistent;
- demonstrate important skills in experience/projects, not only a keyword list;
- use projects/research/open source/coursework when they are real evidence;
- remove repetition before shrinking typography/spacing.

Reverse chronology is a common default, not a requirement.

Page length is context-dependent. Do not enforce a universal one-page/two-page rule.

## Software engineering

Prioritize evidence of what the candidate can build, operate, debug, improve, secure, investigate, or lead.

Useful evidence:

- systems/components built;
- architecture/technical decisions;
- languages/frameworks;
- APIs/integrations;
- data stores;
- deployment/infrastructure;
- testing;
- performance;
- reliability;
- security;
- developer tooling;
- product/user context;
- collaboration/leadership;
- real measured outcomes.

Use MIT's PAR idea as a reasoning aid, not a rigid sentence template:

~~~text
context/project -> action -> result
~~~

### Frontend

Look for framework/language evidence plus component architecture, accessibility, browser/device behavior, state/data flow, API integration, testing, performance, rendering strategy, and design/product collaboration.

### Backend / distributed systems

Look for APIs/services, data modeling, databases, queues/events, concurrency, caching, consistency/failure handling, observability, reliability, migrations, security, performance, and operational ownership.

### Full-stack

Show complete outcomes and architecture boundaries rather than two keyword inventories.

### DevOps / SRE / platform

Look for IaC, cloud/platform ownership, CI/CD, containers/orchestration, observability, reliability/SLOs, incidents, developer experience, cost, security/policy, and automation.

### Cybersecurity

Identify the actual branch: offensive, appsec, cloud security, security engineering, detection/SOC, DFIR, threat intelligence, vulnerability management, GRC, or research.

Do not expose confidential customer/security information.

### Data / ML / AI

Distinguish data engineering, experimentation, model work, evaluation, serving/inference, monitoring, and production systems accurately. Calling an LLM API alone is not equivalent to training/evaluating a model.

### Embedded / firmware / robotics

Look for MCU/SoC, language, RTOS/bare metal, interfaces/buses, protocols, timing, memory, power, bring-up, instruments, debugging, signal/sensor work, manufacturing/reliability, and real hardware constraints.

### Mobile

Look for platform stack, architecture, offline/data synchronization, APIs, accessibility, performance, testing, release pipeline, reliability, and device constraints.

## Seniority

Student/junior:
- projects, coursework, research, open source, competitions, and volunteer work can be primary evidence;
- never mislabel coursework/projects as employment.

Mid-level:
- emphasize independent delivery, depth, system ownership, debugging, collaboration, and operations.

Senior/staff/principal:
- emphasize scope, architecture, ambiguous problems, migrations, cross-team influence, technical direction, mentoring, reliability/platform strategy, and product/business consequences without erasing hands-on engineering.

Engineering management:
- add team/org scope, hiring, mentoring, execution, process, technical/product strategy, and team outcomes.

## ATS/parser considerations

There is no universal ATS implementation.

For a deliberately conservative ATS-oriented variant, consider:

- conventional section labels;
- clear document reading order;
- selectable/searchable text;
- explicit employer/title/date fields;
- no critical fact represented only as an image/icon;
- requested upload file type;
- relevant role terminology used naturally.

Current Berkeley guidance recommends especially conservative formatting for maximum ATS compatibility, but that is a strategy—not a Seevee layout rule.

Do not claim an ATS score. A plain-text extraction/reading-order preview is more defensible.

## Locale/context differences

US commercial guidance often discourages photos and personal demographic data. Europass conventions can differ, including professional-photo guidance.

Therefore never make photo/no-photo a universal rule.

Current Dutch EURES guidance describes Dutch CVs as direct, tailored, usually one to two A4 pages, while allowing chronological, functional, analytical, historical, or creative layouts.

## Academic/research

Academic CVs can be long and cumulative. Do not apply commercial-resume length rules.

For NIH biosketch work, verify current NIH requirements at task time. As of September 2026, NIH's Biographical Sketch Common Form workflow requires SciENcv and cannot simply be replaced by an arbitrary Seevee PDF.

## US federal

Treat USAJOBS/federal resumes separately from commercial US resumes. Current USAJOBS guidance requires a resume of two pages or less and expects the resume to explicitly show how the applicant meets the announcement requirements.

Verify the current announcement/guidance whenever performing this task.

## Other sectors

Finance/consulting:
- emphasize analytical/commercial context, client/project scope, leadership, and real quantitative outcomes.

Healthcare:
- emphasize credentials, clinical/research context, safety/quality, systems/tools, and outcomes while protecting patient information.

Creative/design/media:
- portfolio/reel and project authorship can matter more; visual CVs may intentionally trade ATS conservatism for identity/presentation.

Sales/marketing/business development:
- emphasize market/account scope, pipeline/revenue/quota/campaign outcomes only when factual.

Trades/operations/logistics:
- emphasize licenses/certifications, equipment, safety, maintenance, throughput, quality, scheduling, and measurable improvements.

## Review questions

Before finalizing:

- Are all factual claims supported?
- Is the content relevant to the stated target?
- Is the strongest evidence easy to find?
- Can vague responsibilities become more concrete from available sources?
- Are important skills demonstrated in context?
- Is there duplicate/low-value content?
- Are dates/titles/links consistent?
- Does ordering support the intended story?
- Does the chosen visual design support that story?
- If parser compatibility matters, is underlying reading order sensible?
- Have you preserved intentional custom design choices?

Do not silently rewrite a user's strategy because generic guidance suggests another one.
