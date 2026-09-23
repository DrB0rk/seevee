
import { z } from 'zod';
import {
  idSchema,
  schemaVersionSchema,
  extensionsSchema,
  dateRangeSchema,
  linkSchema,
  jsonPointerSchema,
  envelopeSchema,
  partialDateSchema,
} from '../common/index.js';

// ─── Identity / contact ──────────────────────────────────────────────────────
const personNameSchema = z.object({
  given: z.string().nullable().optional(),
  middle: z.string().nullable().optional(),
  family: z.string().nullable().optional(),
  display: z.string().min(1),
  pronunciation: z.string().optional(),
}).strict();

const contactChannelSchema = z.object({
  kind: z.enum(['email', 'phone', 'website', 'linkedin', 'github', 'mastodon', 'orcid', 'other']),
  value: z.string().min(1),
  label: z.string().optional(),
  primary: z.boolean().optional(),
}).strict();

const locationSchema = z.object({
  city: z.string().optional(),
  region: z.string().optional(),
  country: z.string().min(2).optional(),
  countryCode: z.string().length(2).optional(),
  remote: z.boolean().optional(),
}).strict();

const identitySchema = z.object({
  id: idSchema,
  name: personNameSchema,
  contact: z.array(contactChannelSchema),
  location: locationSchema.optional(),
  headline: z.string().optional(),
  pronouns: z.string().optional(),
  summary: z.string().optional(),
  links: z.array(linkSchema).optional(),
}).strict();

// ─── Section ────────────────────────────────────────────────────────────────
const sectionSchema = z.object({
  id: idSchema,
  type: z.enum(['summary', 'experience', 'education', 'projects', 'skills', 'certifications', 'awards', 'languages', 'publications', 'volunteering', 'references', 'custom']),
  title: z.string().min(1),
  visible: z.boolean().default(true),
  collapsible: z.boolean().default(false),
  defaultCollapsed: z.boolean().default(false),
  nodeOrder: z.array(idSchema).optional(),
  extensions: extensionsSchema.optional(),
}).strict();

// ─── Entity stores (each is an object map keyed by entity ID) ───────────────
const organizationSchema = z.object({
  id: idSchema,
  type: z.literal('organization'),
  name: z.string().min(1),
  legalName: z.string().optional(),
  url: z.string().url().optional(),
  location: locationSchema.optional(),
  extensions: extensionsSchema.optional(),
}).strict();

const roleSchema = z.object({
  id: idSchema,
  type: z.literal('role'),
  title: z.string().min(1),
  level: z.string().optional(),
  employmentType: z.enum(['full-time', 'part-time', 'contract', 'internship', 'freelance', 'volunteer', 'apprenticeship', 'other']).optional(),
  extensions: extensionsSchema.optional(),
}).strict();

const bulletSchema = z.object({
  id: idSchema,
  text: z.string().min(1),
  tags: z.array(z.string()).optional(),
  evidence: z.array(idSchema).optional(), // provenance assertion IDs
  extensions: extensionsSchema.optional(),
}).strict();

const bulletCollectionSchema = z.object({
  id: idSchema,
  type: z.literal('bullet-collection'),
  bullets: z.record(idSchema, bulletSchema),
  bulletOrder: z.array(idSchema),
}).strict();

const experienceSchema = z.object({
  id: idSchema,
  type: z.literal('experience'),
  organization: organizationSchema,
  role: roleSchema,
  period: dateRangeSchema,
  summary: z.string().nullable().optional(),
  bulletOrder: z.array(idSchema),
  bullets: z.record(idSchema, bulletSchema),
  technologyRefs: z.array(idSchema),
  locationOverride: locationSchema.optional(),
  linkRefs: z.array(idSchema).optional(),
  extensions: extensionsSchema.optional(),
}).strict();

const educationSchema = z.object({
  id: idSchema,
  type: z.literal('education'),
  institution: z.object({
    name: z.string().min(1),
    location: z.string().nullable().optional(),
    url: z.string().url().nullable().optional(),
  }).strict(),
  program: z.object({
    name: z.string().min(1),
    degree: z.string().nullable().optional(),
    field: z.string().nullable().optional(),
  }).strict(),
  period: dateRangeSchema,
  details: z.array(z.string()),
  grade: z.string().optional(),
  linkRefs: z.array(idSchema).optional(),
  extensions: extensionsSchema.optional(),
}).strict();

const projectSchema = z.object({
  id: idSchema,
  type: z.literal('project'),
  name: z.string().min(1),
  summary: z.string().nullable().optional(),
  period: dateRangeSchema.nullable().optional(),
  linkRefs: z.array(idSchema),
  bulletOrder: z.array(idSchema).optional(),
  bullets: z.record(idSchema, bulletSchema).optional(),
  technologyRefs: z.array(idSchema),
  role: roleSchema.optional(),
  extensions: extensionsSchema.optional(),
}).strict();

const skillSchema = z.object({
  id: idSchema,
  type: z.literal('skill'),
  name: z.string().min(1),
  category: z.string().nullable().optional(),
  level: z.string().nullable().optional(),
  keywords: z.array(z.string()),
  extensions: extensionsSchema.optional(),
}).strict();

const skillGroupSchema = z.object({
  id: idSchema,
  type: z.literal('skill-group'),
  label: z.string().min(1),
  skillRefs: z.array(idSchema),
  extensions: extensionsSchema.optional(),
}).strict();

const certificationSchema = z.object({
  id: idSchema,
  type: z.literal('certification'),
  name: z.string().min(1),
  issuer: z.string().min(1),
  issued: partialDateSchema.nullable().optional(),
  expires: partialDateSchema.nullable().optional(),
  credentialId: z.string().nullable().optional(),
  linkRef: idSchema.nullable().optional(),
  extensions: extensionsSchema.optional(),
}).strict();

const awardSchema = z.object({
  id: idSchema,
  type: z.literal('award'),
  name: z.string().min(1),
  issuer: z.string().optional(),
  date: partialDateSchema.optional(),
  description: z.string().optional(),
  linkRef: idSchema.nullable().optional(),
  extensions: extensionsSchema.optional(),
}).strict();

const languageSchema = z.object({
  id: idSchema,
  type: z.literal('language'),
  name: z.string().min(1),
  proficiency: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'native', 'conversational', 'professional', 'basic']).optional(),
  cefr: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).optional(),
  extensions: extensionsSchema.optional(),
}).strict();

const publicationSchema = z.object({
  id: idSchema,
  type: z.literal('publication'),
  title: z.string().min(1),
  authors: z.array(z.string()),
  venue: z.string().optional(),
  date: partialDateSchema.optional(),
  doi: z.string().optional(),
  linkRef: idSchema.nullable().optional(),
  abstract: z.string().optional(),
  extensions: extensionsSchema.optional(),
}).strict();

const volunteeringSchema = z.object({
  id: idSchema,
  type: z.literal('volunteering'),
  organization: organizationSchema,
  role: roleSchema,
  period: dateRangeSchema,
  summary: z.string().optional(),
  linkRefs: z.array(idSchema).optional(),
  extensions: extensionsSchema.optional(),
}).strict();

const referenceSchema = z.object({
  id: idSchema,
  type: z.literal('reference'),
  name: z.string().min(1),
  relationship: z.string().optional(),
  contactChannels: z.array(contactChannelSchema),
  context: z.string().optional(),
  extensions: extensionsSchema.optional(),
}).strict();

const customEntitySchema = z.object({
  id: idSchema,
  type: z.literal('customEntity'),
  label: z.string().min(1),
  data: z.record(z.string(), z.unknown()),
  extensions: extensionsSchema.optional(),
}).strict();

// Discriminated union over entity types
const cvEntitySchema = z.discriminatedUnion('type', [
  experienceSchema,
  educationSchema,
  projectSchema,
  skillSchema,
  skillGroupSchema,
  certificationSchema,
  awardSchema,
  languageSchema,
  publicationSchema,
  volunteeringSchema,
  referenceSchema,
  organizationSchema,
  roleSchema,
  bulletCollectionSchema,
  customEntitySchema,
]);

const entityStoresSchema = z.object({
  experience: z.record(idSchema, experienceSchema).optional(),
  education: z.record(idSchema, educationSchema).optional(),
  projects: z.record(idSchema, projectSchema).optional(),
  skills: z.record(idSchema, skillSchema).optional(),
  skillGroups: z.record(idSchema, skillGroupSchema).optional(),
  certifications: z.record(idSchema, certificationSchema).optional(),
  awards: z.record(idSchema, awardSchema).optional(),
  languages: z.record(idSchema, languageSchema).optional(),
  publications: z.record(idSchema, publicationSchema).optional(),
  volunteering: z.record(idSchema, volunteeringSchema).optional(),
  references: z.record(idSchema, referenceSchema).optional(),
  organizations: z.record(idSchema, organizationSchema).optional(),
  roles: z.record(idSchema, roleSchema).optional(),
  bulletCollections: z.record(idSchema, bulletCollectionSchema).optional(),
  custom: z.record(idSchema, customEntitySchema).optional(),
  extensions: extensionsSchema.optional(),
}).strict();

const cvDataSchema = z.object({
  locale: z.string().min(2),
  identity: identitySchema,
  sectionOrder: z.array(idSchema),
  sections: z.record(idSchema, sectionSchema),
  entities: entityStoresSchema,
  extensions: extensionsSchema.optional(),
}).strict();

export const cvDocumentSchema = envelopeSchema(cvDataSchema, 'seevee.cv');
export type CvDocument = z.infer<typeof cvDocumentSchema>;
export type CvData = z.infer<typeof cvDataSchema>;
export type Identity = z.infer<typeof identitySchema>;
export type PersonName = z.infer<typeof personNameSchema>;
export type ContactChannel = z.infer<typeof contactChannelSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type EntityStores = z.infer<typeof entityStoresSchema>;
export type CvEntity = z.infer<typeof cvEntitySchema>;
export type Experience = z.infer<typeof experienceSchema>;
export type Education = z.infer<typeof educationSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Skill = z.infer<typeof skillSchema>;
export type SkillGroup = z.infer<typeof skillGroupSchema>;
export type Certification = z.infer<typeof certificationSchema>;
export type Award = z.infer<typeof awardSchema>;
export type Language = z.infer<typeof languageSchema>;
export type Publication = z.infer<typeof publicationSchema>;
export type Volunteering = z.infer<typeof volunteeringSchema>;
export type Reference = z.infer<typeof referenceSchema>;
export type Organization = z.infer<typeof organizationSchema>;
export type Role = z.infer<typeof roleSchema>;
export type Bullet = z.infer<typeof bulletSchema>;
export type BulletCollection = z.infer<typeof bulletCollectionSchema>;
export type CustomEntity = z.infer<typeof customEntitySchema>;
