# Workspace Agent CV Guidance

Audience: agents operating inside a user's initialized Seevee workspace.

This document is **not** for agents developing the Seevee repository itself. Repository-development agents should follow `.dev/AGENTS.md` and `.dev/`.

Status: agent-facing research and drafting reference
Reviewed: 2026-09-23

## Purpose

This document is for agents that create, tailor, review, or redesign CVs in Seevee.

It is not a validation specification. It must not become a user-facing profile selector, resume score, mandatory template style, or export blocker.

Use it as informed guidance. The user's stated intent, target role, actual experience, locale, and chosen visual direction remain authoritative.

Seevee's hard validation is reserved for data integrity, broken references, unsafe template execution, and invalid rendering/export. Career advice is not schema law.

## General principles

Current guidance from MIT, Harvard, Berkeley, Europass, EURES, USAJOBS, and other primary sources converges on several useful principles:

- Tailor content to the role instead of including every available detail.
- Put relevant information where a reviewer can find it quickly.
- Prefer specific, factual language.
- Show contributions and outcomes rather than listing only responsibilities.
- Use strong action verbs when they improve clarity.
- Quantify impact when a real and supportable measurement exists.
- Keep dates, names, links, spelling, and contact details accurate.
- Use reverse chronology as a common default, not an absolute requirement.
- Use projects, research, open source, coursework, volunteering, or independent work when they are meaningful evidence.
- Keep formatting internally consistent unless a deliberate design choice requires otherwise.
- Treat CV guidance as market- and sector-dependent.

Never invent metrics, technologies, dates, scope, users, revenue, performance gains, certifications, job titles, or other facts merely to make copy sound stronger.

## Master CV and tailored variants

MIT explicitly recommends keeping a master resume while tailoring application versions to specific roles. MIT also advises saving different iterations for reuse with similar positions.

Seevee should take advantage of its multi-CV model:

- A broad master CV can contain a user's full verified history.
- Separate CV JSON files can target backend, security, embedded, frontend, management, academic, or individual job applications.
- Tailoring can remove, reorder, summarize, or emphasize material.
- A tailored CV should remain independently understandable; do not depend on hidden data from another variant.
- Reuse stable semantic IDs where the copied fact is genuinely the same fact and the implementation supports lineage.
- Do not force every application into one CV full of conditional visibility flags.

## Length

Do not apply one universal page rule.

MIT currently recommends one page for many commercial resumes, while explicitly noting that two pages can be appropriate and that there is no absolute rule. Berkeley recommends a simple one-page format for college students. Current Dutch EURES guidance says a Dutch CV is normally one to two A4 pages. Academic CVs can be much longer.

Use length as an editorial trade-off:

- early career: usually concise;
- experienced engineers: one or two pages can both be reasonable;
- senior/staff/leadership: use the space required to communicate meaningful scope;
- academic CV: comprehensive and often multi-page;
- bespoke portfolio CV: content and visual strategy may justify a different structure.

Do not shrink type or destroy whitespace purely to meet an arbitrary page count.

## Software engineering: general

For software engineering, prioritize evidence of what the candidate can actually build, operate, improve, investigate, or lead.

Useful content may include:

- languages and major frameworks;
- systems/components built;
- architecture and technical decisions;
- projects and open-source work;
- APIs and integrations;
- data stores;
- deployment and infrastructure;
- testing and quality practices;
- performance;
- reliability;
- security;
- developer tooling;
- product/user context;
- collaboration;
- technical leadership;
- measurable results when real.

A list of technologies is useful for scanning, but experience and project entries should provide evidence that important technologies were actually used.

Technical resumes may legitimately emphasize projects and technical work. Berkeley's current technical-resume examples explicitly frame projects, technology-related skills, experience, and qualifications as central evidence for software development, engineering, IT, and data roles.

## Software bullet writing

MIT's current PAR guidance is useful as a thinking model:

Project/context -> Activity/action -> Result

Do not mechanically force every bullet into the same sentence shape. Use the model to check whether a statement communicates enough context and consequence.

A useful software bullet often answers some of:

- What did the candidate build/change/investigate?
- Why did it matter?
- What was technically difficult?
- What stack or system boundary was involved?
- What scale or constraint mattered?
- What improved?
- What did the candidate own?
- Was the result measured?

Good:
- Built a Rust service that normalized telemetry from three device protocols and exposed a stable API for the dashboard.

Potentially stronger when evidenced:
- Cut a deployment workflow from 20 minutes to 6 by replacing manual packaging steps with a reproducible CI pipeline.

Bad:
- Improved performance by 80 percent.

The last statement is unacceptable unless the source information supports that number and explains what was measured.

## Frontend engineering

Look for evidence of:

- TypeScript/JavaScript;
- relevant frameworks;
- component architecture;
- accessibility;
- design systems;
- browser/device behavior;
- state/data flow;
- API integration;
- testing;
- performance;
- rendering strategy;
- collaboration with design/product.

Do not reduce frontend experience to a list of UI libraries.

Useful project evidence includes shipped interfaces, design-system work, accessibility fixes, performance changes, complex interaction work, or ownership of frontend architecture.

## Backend and distributed systems

Look for:

- API/service design;
- data modeling and databases;
- concurrency;
- queues/event systems;
- distributed systems;
- caching;
- consistency/failure handling;
- observability;
- reliability;
- migrations;
- security;
- performance;
- operational ownership;
- scale when known.

Avoid generic phrases such as "worked on backend systems" when more concrete source material exists.

## Full-stack engineering

Full-stack CVs should show connected outcomes rather than two disconnected keyword inventories.

Useful evidence:

- owning a feature across UI, API, persistence, deployment, and monitoring;
- architectural boundaries;
- product-facing impact;
- integration work;
- trade-offs across frontend/backend concerns.

## DevOps, platform, cloud, and SRE

Look for:

- infrastructure as code;
- cloud/platform ownership;
- CI/CD;
- containers/orchestration;
- observability;
- reliability/SLO work;
- deployment architecture;
- incident response;
- developer experience;
- cost work;
- security/policy;
- operational automation.

Real before/after metrics are valuable, especially deployment time, incident frequency, reliability, cost, build time, or developer lead time. Never synthesize them.

## Cybersecurity

Identify the actual security branch rather than writing a generic "cybersecurity" CV:

- penetration testing / offensive security;
- application security;
- cloud security;
- security engineering;
- detection engineering / SOC;
- DFIR;
- threat intelligence;
- vulnerability management;
- GRC/risk;
- security research.

Useful evidence may include:

- authorized assessment scope;
- vulnerabilities discovered;
- remediation work;
- secure design;
- threat modeling;
- detection content;
- incident handling;
- automation;
- tooling;
- standards/frameworks;
- client/stakeholder communication.

Do not expose confidential customer data, exploit details that should remain private, or unsupported severity claims.

## Data engineering, ML, and AI

Look for:

- problem definition;
- datasets and data pipelines;
- scale;
- model/approach;
- evaluation method;
- reproducibility;
- serving/inference;
- monitoring;
- experimentation;
- data quality;
- productionization;
- user/business outcome.

Distinguish experiments, prototypes, research, and production systems accurately.

Do not imply that calling an LLM API is equivalent to training, evaluating, or deploying an ML model unless the work actually included those activities.

## Embedded, firmware, robotics, and electronics

Look for:

- MCU/SoC/platform;
- C/C++/Rust or relevant languages;
- RTOS/bare-metal work;
- hardware interfaces and buses;
- protocols;
- sensor/signal handling;
- timing;
- memory;
- power constraints;
- hardware bring-up;
- test equipment;
- debugging;
- manufacturing/reliability;
- control systems or robotics where relevant.

Concrete constraints are especially useful in this sector when known: sample rates, timing budgets, flash/RAM limits, current draw, communication rates, environmental constraints, or hardware revisions.

## Mobile engineering

Look for:

- iOS/Android or cross-platform stack;
- app architecture;
- offline/data synchronization;
- API integration;
- accessibility;
- performance;
- testing;
- release/store process;
- crash/reliability work;
- device/platform constraints.

## Game, graphics, media, and realtime software

Look for:

- engine/runtime;
- rendering;
- performance/frame budgets;
- networking;
- gameplay/system ownership;
- tooling;
- asset/content pipelines;
- platform constraints;
- shipped titles or interactive portfolio work.

## Student and junior software candidates

Projects can be primary evidence. MIT and Berkeley both explicitly treat class, personal, research, volunteer, and project work as valid experience when relevant.

Useful sections can include:

- education;
- relevant coursework;
- projects;
- internships;
- research;
- open source;
- competitions;
- volunteer work;
- technical skills.

Do not inflate class projects into professional employment. Describe them accurately and still make the engineering work concrete.

## Mid-level engineers

Prioritize:

- independently delivered work;
- system ownership;
- technical depth;
- debugging/problem solving;
- collaboration;
- testing/operations;
- design decisions;
- measurable outcomes when available.

## Senior, staff, and principal engineers

Look beyond implementation volume.

Useful evidence includes:

- architecture;
- ambiguous/high-risk technical problems;
- migrations;
- reliability/platform strategy;
- cross-team influence;
- technical direction;
- mentoring;
- design reviews;
- standards;
- incident leadership;
- long-term system improvements;
- business/product consequences.

Do not erase hands-on technical work merely because the person is senior.

## Engineering management

In addition to technical context, useful evidence includes:

- team/org scope;
- hiring;
- mentoring;
- delivery;
- engineering process;
- technical strategy;
- product partnership;
- prioritization;
- organizational improvement;
- team outcomes.

## ATS and parser considerations

There is no universal ATS implementation.

Berkeley currently recommends conservative formatting for maximum ATS compatibility: standard fonts and section names, conventional work-history structure, and avoiding headers, footers, text boxes, tables, colors, pictures, or graphics when ATS safety is the priority.

Treat that as a conservative strategy, not a global Seevee rule.

For an ATS-oriented variant, an agent should consider:

- conventional section labels;
- clear underlying reading order;
- selectable text;
- explicit employer/title/date fields;
- no critical information conveyed only by icons/images;
- avoiding a rasterized whole-page CV;
- relevant terminology from the job description used naturally;
- the requested upload file type.

For a design-led CV, portfolio CV, or human-first technical CV, the agent can intentionally make different trade-offs.

A useful future Seevee feature is a plain-text extraction preview. It is more defensible than an invented "ATS score."

## Reverse chronology

Reverse chronological ordering is a common default in MIT, Harvard, Berkeley, and Europass guidance.

It is not mandatory.

Functional, hybrid, project-first, skill-first, or custom ordering can make sense for:

- career changes;
- portfolio work;
- research;
- students;
- freelance/consulting;
- people with unusual career histories;
- bespoke technical storytelling.

Current Dutch EURES guidance explicitly notes that resume layout can be historical, analytical, chronological, functional, or creative.

## Photos and personal information

Conventions conflict by region.

Harvard's current US-oriented guidance says not to include a picture, age, or gender. Europass currently recommends a professional photograph.

Therefore:

- do not treat photo/no-photo as a global correctness rule;
- consider target market and user intent;
- avoid unnecessary sensitive personal information;
- do not infer demographic information;
- do not add a photograph unless the user supplied/approved one.

## Netherlands / EU

Current EURES Netherlands guidance says a Dutch CV should generally:

- be direct and professional;
- normally fit within one or two A4 pages;
- contain relevant and specific information;
- be adapted to the position;
- generally use recent-first education and work history.

EURES also says the user may choose chronological, functional, analytical, historical, or creative resume layouts.

Europass currently recommends tailoring, clear language, strong verbs, reverse chronology, proofreading, and maintaining a reusable underlying profile from which tailored CVs can be created.

Use these as contextual guidance, not hard constraints.

## US commercial resumes

Current Harvard guidance emphasizes:

- tailoring to the position;
- specific, active, fact-based language;
- results;
- organization and skimmability;
- reverse chronology;
- no photo/age/gender in its US-oriented guidance;
- attention to both human readers and scanning systems.

Do not import US conventions into all markets.

## US federal / USAJOBS

Treat federal resumes as a separate task.

Current USAJOBS guidance states that federal agencies accept resumes up to two pages and that USAJOBS will not allow a resume longer than two pages. It also emphasizes showing directly how the candidate meets the job announcement's qualifications and requirements.

When a user explicitly asks for a USAJOBS/federal resume, the agent should verify the current job announcement and current USAJOBS guidance at task time.

Do not apply the federal two-page requirement to ordinary US resumes.

## Academic CVs

Academic CVs are cumulative documents, not short commercial resumes.

Common content may include:

- education;
- appointments;
- research;
- publications;
- presentations;
- teaching;
- grants/fellowships;
- awards;
- service;
- professional memberships;
- languages/technical skills;
- references.

Do not shorten an academic CV to a commercial one-page resume unless that is explicitly the requested transformation.

## NIH and research biosketches

These are compliance documents and change over time.

As of September 2026, NIH's Biographical Sketch Common Form and NIH Biographical Sketch Supplement are prepared through SciENcv; NIH states that SciENcv must be used for the Common Form. The NIH transition rules changed during 2026, so an agent must verify current NIH instructions whenever the user requests an NIH biosketch.

Seevee can help organize source data or prepare content, but it must not imply that an arbitrary Seevee PDF is an NIH-compliant Common Form.

## Finance, banking, and consulting

Useful emphasis:

- analytical work;
- commercial/financial context;
- transactions or projects where disclosure is allowed;
- quantitative outcomes;
- client/stakeholder work;
- leadership;
- concise communication.

Berkeley currently notes that chronological resumes are commonly appropriate in conservative industries such as banking.

Do not force conservative visual styling if the user wants something else.

## Healthcare and clinical work

Useful evidence:

- credentials/licensure;
- clinical setting;
- specialties/procedures;
- systems/tools;
- safety/quality;
- research;
- team scope;
- outcome improvements where safe and factual.

Never include patient-identifying information.

## Creative, design, and media

Visual CVs may intentionally optimize for human review and portfolio identity.

Useful evidence:

- portfolio/reel;
- role in projects;
- shipped/published work;
- design/creative direction;
- tools;
- clients/brands where disclosure is permitted;
- reach/results where meaningful.

It can be sensible to keep both a highly designed CV and a conservative application variant.

## Sales, marketing, and business development

Useful evidence:

- account/market scope;
- pipeline/revenue when factual;
- quota attainment when factual;
- acquisition/retention;
- campaign performance;
- strategy;
- stakeholder ownership;
- team scope.

Never create missing percentages or currency figures.

## Skilled trades, operations, and logistics

Useful evidence:

- certifications/licenses;
- equipment/machinery;
- safety;
- maintenance;
- scheduling;
- throughput;
- quality;
- site/team scope;
- reductions or improvements when measured.

## Agent review checklist

Before finalizing a CV, ask:

- Is every factual claim supported by user-provided/source information?
- Is the content relevant to the stated target?
- Are the strongest pieces of evidence easy to find?
- Are vague responsibilities replaceable with more concrete source-backed statements?
- Are important skills demonstrated in context?
- Are there duplicate or low-value statements consuming space?
- Are links useful and correct?
- Are dates and titles internally consistent?
- Does the chosen order support the story the user wants to tell?
- Does the visual design support that story?
- If parser compatibility matters, is the underlying reading order sensible?
- Have market-specific conventions been considered without assuming they are universal?
- Has the agent preserved intentional unconventional design choices?

## Sources reviewed

MIT Career Advising & Professional Development:
https://capd.mit.edu/resources/resumes/
https://capd.mit.edu/resources/resumes-writing-about-your-skills/
https://capd.mit.edu/blog/2026/06/23/interphase-2026-resume-resources/

UC Berkeley Career Engagement:
https://career.berkeley.edu/prepare-for-success/resumes/
https://career.berkeley.edu/prepare-for-success/resumes/sample-resumes/

Harvard FAS Mignone Center:
https://careerservices.fas.harvard.edu/resources/create-a-strong-resume/

EURES Netherlands:
https://eures.europa.eu/living-and-working/living-and-working-conditions-europe/living-and-working-conditions-netherlands_en

Europass:
https://europass.europa.eu/en/create-europass-cv

USAJOBS:
https://help.usajobs.gov/faq/application/documents/resume/what-to-include

NIH:
https://grants.nih.gov/grants-process/write-application/forms-directory/biographical-sketch-common-form
https://grants.nih.gov/grants-process/write-application/forms-directory/biosketch
https://grants.nih.gov/grants/guide/notice-files/NOT-OD-26-079.html

## Maintenance rule

This reference is dated research, not timeless truth.

When an agent is handling a regulated/form-specific document, a government application, or a market convention that materially affects the output, verify current primary guidance before applying it.

For ordinary CV drafting, use this file as a practical baseline and preserve user intent.
