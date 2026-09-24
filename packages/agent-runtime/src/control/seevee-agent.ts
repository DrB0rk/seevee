import seeveeAgentInstructionsText from './seevee-agent.md?raw';

let cachedInstructions: string | null = null;

export function seeveeAgentInstructions(): string {
  cachedInstructions ??= seeveeAgentInstructionsText.trim();
  return cachedInstructions;
}
