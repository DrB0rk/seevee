import type {
  CvDocument,
  WorkspaceDocument,
  CommentsDocument,
  ProvenanceDocument,
  PresentationDocument,
  Section,
  Experience,
  Project,
  SkillGroup,
} from '../index.js';

export type SemanticIssue = {
  code: string;
  severity: 'error' | 'warning';
  message: string;
  path?: string;
  relatedId?: string;
};

export type SemanticContext = {
  cv?: CvDocument;
  provenance?: ProvenanceDocument;
  comments?: CommentsDocument;
  presentation?: PresentationDocument;
  workspace?: WorkspaceDocument;
};

/**
 * Semantic validation runs AFTER structural schema validation passes.
 * It enforces cross-resource referential integrity that single-document
 * JSON Schema cannot express.
 *
 * Stable semantic IDs are the backbone: any reference must resolve inside
 * the same resource set, or validation must fail with a stable code.
 */
export function validateWorkspaceSemantics(ctx: SemanticContext): SemanticIssue[] {
  const issues: SemanticIssue[] = [];

  if (ctx.cv) {
    issues.push(...validateCvInternal(ctx.cv));
  }
  if (ctx.workspace && ctx.cv) {
    issues.push(...validateCvRegistered(ctx.workspace, ctx.cv));
  }
  if (ctx.cv && ctx.provenance) {
    issues.push(...validateProvenanceTargets(ctx.cv, ctx.provenance));
  }
  if (ctx.cv && ctx.comments) {
    issues.push(...validateCommentTargets(ctx.cv, ctx.comments));
  }
  if (ctx.cv && ctx.presentation) {
    issues.push(...validatePresentationCvBinding(ctx.cv, ctx.presentation));
  }

  return issues;
}

function collectCvNodeIds(cv: CvDocument): Set<string> {
  const ids = new Set<string>();
  ids.add(cv.data.identity.id);
  for (const sectionId of cv.data.sectionOrder) ids.add(sectionId);
  for (const section of Object.values(cv.data.sections)) {
    ids.add(section.id);
    for (const nodeId of section.nodeOrder ?? []) ids.add(nodeId);
  }
  const stores = cv.data.entities;
  for (const [storeName, store] of Object.entries(stores)) {
    if (storeName === 'extensions') continue;
    if (!store || typeof store !== 'object') continue;
    for (const entity of Object.values(store as Record<string, { id: string }>)) {
      ids.add(entity.id);
    }
  }
  return ids;
}

function collectCvSectionIds(cv: CvDocument): Set<string> {
  const ids = new Set<string>();
  for (const sectionId of cv.data.sectionOrder) ids.add(sectionId);
  for (const section of Object.values(cv.data.sections)) ids.add(section.id);
  return ids;
}

function validateCvInternal(cv: CvDocument): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  const nodeIds = collectCvNodeIds(cv);
  const sectionIds = collectCvSectionIds(cv);

  for (const sid of cv.data.sectionOrder) {
    if (!cv.data.sections[sid]) {
      issues.push({
        code: 'cv.sectionOrder.dangling',
        severity: 'error',
        message: 'sectionOrder references section `' + sid + '` not present in sections map',
        path: '/data/sectionOrder',
        relatedId: sid,
      });
    }
  }
  for (const sid of Object.keys(cv.data.sections)) {
    if (!cv.data.sectionOrder.includes(sid)) {
      issues.push({
        code: 'cv.sections.unordered',
        severity: 'warning',
        message: 'section `' + sid + '` exists in sections map but not in sectionOrder',
        path: '/data/sections',
        relatedId: sid,
      });
    }
  }

  for (const exp of Object.values(cv.data.entities.experience ?? {})) {
    checkBulletConsistency(exp, issues, '/data/entities/experience/' + exp.id);
    for (const techId of exp.technologyRefs) {
      if (!cv.data.entities.skills?.[techId]) {
        issues.push({
          code: 'cv.technologyRefs.dangling',
          severity: 'error',
          message:
            'experience `' + exp.id + '` technologyRef `' + techId + '` does not resolve to a skill',
          path: '/data/entities/experience/' + exp.id + '/technologyRefs',
          relatedId: techId,
        });
      }
    }
  }
  for (const proj of Object.values(cv.data.entities.projects ?? {})) {
    checkBulletConsistency(proj, issues, '/data/entities/projects/' + proj.id);
  }

  for (const group of Object.values(cv.data.entities.skillGroups ?? {})) {
    for (const skillRef of group.skillRefs) {
      if (!cv.data.entities.skills?.[skillRef]) {
        issues.push({
          code: 'cv.skillGroupRefs.dangling',
          severity: 'error',
          message:
            'skill group `' +
            group.id +
            '` skillRef `' +
            skillRef +
            '` does not resolve to a skill',
          path: '/data/entities/skillGroups/' + group.id + '/skillRefs',
          relatedId: skillRef,
        });
      }
    }
  }

  for (const section of Object.values(cv.data.sections)) {
    for (const nodeId of section.nodeOrder ?? []) {
      if (!nodeIds.has(nodeId)) {
        issues.push({
          code: 'cv.sectionNodeOrder.dangling',
          severity: 'error',
          message:
            'section `' +
            section.id +
            '` nodeOrder references missing node `' +
            nodeId +
            '`',
          path: '/data/sections/' + section.id + '/nodeOrder',
          relatedId: nodeId,
        });
      }
    }
  }

  // Touch sectionIds so the variable is referenced and TS does not complain
  // about an unused destructuring.
  if (sectionIds.size === 0 && cv.data.sectionOrder.length === 0) {
    // Empty CV: no-op.
  }

  return issues;
}

function checkBulletConsistency(
  owner: Experience | Project,
  issues: SemanticIssue[],
  ownerPath: string,
): void {
  const bulletOrder: readonly string[] = owner.bulletOrder ?? [];
  const bullets: Record<string, { id: string }> = owner.bullets ?? {};
  for (const bid of bulletOrder) {
    if (!bullets[bid]) {
      issues.push({
        code: 'cv.bulletOrder.dangling',
        severity: 'error',
        message:
          'bulletOrder references missing bullet `' + bid + '` in `' + ownerPath + '`',
        path: ownerPath,
        relatedId: bid,
      });
    }
  }
  for (const bid of Object.keys(bullets)) {
    if (!bulletOrder.includes(bid)) {
      issues.push({
        code: 'cv.bullets.unordered',
        severity: 'warning',
        message:
          'bullet `' + bid + '` exists in bullets map but not in bulletOrder in `' + ownerPath + '`',
        path: ownerPath,
        relatedId: bid,
      });
    }
  }
}

function validateCvRegistered(ws: WorkspaceDocument, cv: CvDocument): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  const reg = ws.data.resources.cvs[cv.id];
  if (!reg) {
    issues.push({
      code: 'workspace.cvNotRegistered',
      severity: 'error',
      message: 'CV `' + cv.id + '` is not registered in the workspace index',
      path: '/data/resources/cvs',
      relatedId: cv.id,
    });
    return issues;
  }
  if (reg.revision !== cv.revision) {
    issues.push({
      code: 'workspace.cvRevisionMismatch',
      severity: 'error',
      message:
        'CV `' +
        cv.id +
        '` revision `' +
        cv.revision +
        '` does not match workspace registration `' +
        reg.revision +
        '`',
      path: '/data/resources/cvs',
      relatedId: cv.id,
    });
  }
  return issues;
}

function validateProvenanceTargets(cv: CvDocument, prov: ProvenanceDocument): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  const nodeIds = collectCvNodeIds(cv);

  for (const assertion of Object.values(prov.data.assertions)) {
    const target = assertion.target;
    if (target.nodeId && !nodeIds.has(target.nodeId)) {
      issues.push({
        code: 'provenance.target.dangling',
        severity: 'error',
        message:
          'provenance assertion `' +
          assertion.id +
          '` targets missing CV node `' +
          target.nodeId +
          '`',
        path: '/data/assertions/' + assertion.id + '/target',
        relatedId: target.nodeId,
      });
    }
  }
  return issues;
}

function validateCommentTargets(cv: CvDocument, comments: CommentsDocument): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  const nodeIds = collectCvNodeIds(cv);
  const sectionIds = collectCvSectionIds(cv);

  for (const thread of Object.values(comments.data.threads)) {
    for (const sel of thread.target.selectors) {
      if (sel.type === 'NodeSelector' || sel.type === 'FieldSelector') {
        if (!nodeIds.has(sel.nodeId)) {
          issues.push({
            code: 'comments.target.dangling',
            severity: 'error',
            message:
              'comment thread `' +
              thread.id +
              '` selector targets missing node `' +
              sel.nodeId +
              '`',
            path: '/data/threads/' + thread.id + '/target/selectors',
            relatedId: sel.nodeId,
          });
        }
      } else if (sel.type === 'SectionSelector') {
        if (!sectionIds.has(sel.sectionId)) {
          issues.push({
            code: 'comments.sectionDangling',
            severity: 'warning',
            message:
              'comment thread `' +
              thread.id +
              '` targets missing section `' +
              sel.sectionId +
              '`',
            path: '/data/threads/' + thread.id + '/target/selectors',
            relatedId: sel.sectionId,
          });
        }
      } else if (sel.type === 'PageRegionSelector') {
        // Page-region comments point at render geometry, not CV nodes: fine.
        continue;
      }
    }
    for (const mid of thread.messageOrder) {
      if (!thread.messages[mid]) {
        issues.push({
          code: 'comments.messageOrder.dangling',
          severity: 'error',
          message:
            'thread `' + thread.id + '` messageOrder references missing message `' + mid + '`',
          path: '/data/threads/' + thread.id + '/messageOrder',
          relatedId: mid,
        });
      }
    }
  }
  return issues;
}

function validatePresentationCvBinding(
  cv: CvDocument,
  pres: PresentationDocument,
): SemanticIssue[] {
  const issues: SemanticIssue[] = [];
  if (pres.data.cvId !== cv.id) {
    issues.push({
      code: 'presentation.cvMismatch',
      severity: 'error',
      message:
        'presentation `' +
        pres.id +
        '` is bound to CV `' +
        pres.data.cvId +
        '` but validating against `' +
        cv.id +
        '`',
      path: '/data/cvId',
      relatedId: pres.data.cvId,
    });
  }
  return issues;
}

// Touch Section and SkillGroup exports so downstream consumers can rely on
// the public types re-exported here for ergonomic imports.
export type _TouchedSection = Section;
export type _TouchedSkillGroup = SkillGroup;
