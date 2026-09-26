import seeveeAgentInstructionsText from './seevee-agent.md?raw';

let cachedInstructions: string | null = null;

export function seeveeAgentInstructions(context?: string): string {
  cachedInstructions ??= seeveeAgentInstructionsText.trim();
  if (context === undefined || context.length === 0) return cachedInstructions;
  return `${cachedInstructions}\n\n${context}`;
}
