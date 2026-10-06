// Ambient module declaration for the SDK's `.astro` components.
//
// `tsc` cannot parse `.astro` files, so it needs a declaration to resolve
// `import Page from './components/Page.astro'`. The declaration is structural
// rather than derived from `astro`'s own types on purpose: the SDK is
// consumed by packages that do not depend on Astro (renderer,
// template-compiler, export, cli), and pulling Astro's server types into
// those programs would make the SDK's type graph depend on a package they
// never declare.
//
// The shape below is the contract Astro's server renderer actually calls:
// a factory tagged `isAstroComponentFactory` that receives
// (result, props, slots) and returns something renderable. Typing it here
// keeps `Page`/`Section`/`Item`/`Field` assignable to Astro's
// `AstroComponentFactory` without a hard dependency — Astro's type is
// structurally the same function shape.
//
// This file must stay a global script (no top-level import/export): a
// wildcard `declare module '*.astro'` in a module file is a module
// augmentation, not an ambient declaration, and would not apply.

// Props bag a template passes to an SDK component.
type SeeveeAstroProps = Record<string, unknown>;

// Slot factories keyed by slot name (`'default'` for plain children).
type SeeveeAstroSlots = Record<string, (result: unknown) => unknown>;

// Structural stand-in for an Astro component factory. Kept deliberately
// permissive: `Astro.props` typing lives in the `.astro` files themselves,
// which only the Astro compiler ever reads.
interface SeeveeAstroComponent {
  (result: unknown, props: SeeveeAstroProps, slots: SeeveeAstroSlots): unknown;
  readonly isAstroComponentFactory: true;
  readonly name: string;
  readonly moduleId?: string;
  readonly propagation?: string;
}

declare module '*.astro' {
  const component: SeeveeAstroComponent;
  export default component;
}